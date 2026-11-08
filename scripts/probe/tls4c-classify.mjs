// [TLS-4c 실측] 목적지 인증서 분류(E113): Node가 인증서 검증으로 실패시킬 때 목적지 TLS 소켓의 authorizationError에 코드가 남는가, 인증서가 아닌 실패에서는 비어 있는가
//   node scripts/probe/tls4c-classify.mjs
// 요청 옵션은 server.ts의 터널 안 목적지 요청과 같게(rejectUnauthorized: true, checkServerIdentity, ca = 공개 CA + 시험 CA, agent: false).
// 시험 인증서는 node-forge와 Node crypto로 임시로 만든다. Windows 인증서 저장소는 건드리지 않는다. 인터넷에 연결하지 않는다.
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import forge from 'node-forge';

const { pki, asn1 } = forge;
const DAY = 86_400_000;
const keyPair = (bits = 2048) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const priv = pki.privateKeyFromPem(pem);
  return { pem, priv, pub: pki.setRsaPublicKey(priv.n, priv.e) };
};
let serial = 1;
// issuer가 없으면 자체 서명
function cert({ cn, keys, issuer, ca = false, sans = ['localhost'], from = -DAY, to = 30 * DAY, exts = [], md = 'sha256' }) {
  const c = pki.createCertificate();
  c.publicKey = keys.pub;
  c.serialNumber = (serial++).toString(16).padStart(4, '0');
  c.validity.notBefore = new Date(Date.now() + from);
  c.validity.notAfter = new Date(Date.now() + to);
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer(issuer ? issuer.cert.subject.attributes : [{ name: 'commonName', value: cn }]);
  const base = ca
    ? [{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }]
    : [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: sans.map((value) => ({ type: 2, value })) }, { name: 'extKeyUsage', serverAuth: true }];
  c.setExtensions([...base, ...exts]);
  c.sign(issuer ? issuer.keys.priv : keys.priv, forge.md[md].create());
  return { cert: c, keys, pem: pki.certificateToPem(c) };
}

const rootKeys = keyPair();
const root = cert({ cn: 'sumun probe root', keys: rootKeys, ca: true });
const otherRoot = cert({ cn: 'sumun probe other root', keys: keyPair(), ca: true });
const leaf = (o = {}) => cert({ cn: 'localhost', keys: o.keys ?? keyPair(), issuer: o.issuer ?? root, ...o });

// 이름 제약 중간 CA(permitted DNS:.example.com) — forge가 모르는 확장이라 DER을 직접 만든다
const ncDer = asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
  asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, '.example.com')])]),
])).getBytes();
const ncInt = cert({ cn: 'sumun probe nc int', keys: keyPair(), issuer: root, ca: true, exts: [{ id: '2.5.29.30', critical: true, value: ncDer }] });
const critExt = { id: '1.2.3.4.5', critical: true, value: asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')).getBytes() };

const good = leaf();
const serve = (chain, keys, extra = {}) => () => https.createServer({ cert: chain.map((c) => c.pem).join(''), key: keys.pem, ...extra }, (_q, r) => r.end('ok'));
const cases = [
  ['(기준) 정상', serve([good], good.keys), 'none'],
  ['만료', (() => { const l = leaf({ from: -3 * DAY, to: -DAY }); return serve([l], l.keys); })(), 'cert'],
  ['자체 서명', (() => { const k = keyPair(); const l = cert({ cn: 'localhost', keys: k }); return serve([l], k); })(), 'cert'],
  ['이름 불일치', (() => { const l = leaf({ sans: ['other.test'] }); return serve([l], l.keys); })(), 'cert'],
  ['모르는 CA', (() => { const l = leaf({ issuer: otherRoot }); return serve([l], l.keys); })(), 'cert'],
  ['C1 이름 제약 위반', (() => { const l = leaf({ issuer: ncInt }); return serve([l, ncInt], l.keys); })(), 'cert'],
  ['C2 모르는 critical 확장', (() => { const l = leaf({ exts: [critExt] }); return serve([l], l.keys); })(), 'cert'],
  ['C3 SHA-1 서명', (() => { const l = leaf({ md: 'sha1' }); return serve([l], l.keys); })(), 'cert'],
  ['C4 RSA 1024', (() => { const l = leaf({ keys: keyPair(1024) }); return serve([l], l.keys, { ciphers: 'DEFAULT@SECLEVEL=0' }); })(), 'cert'],
  ['C7 중간 CA 빠짐', (() => { const l = leaf({ issuer: ncInt, sans: ['a.example.com'] }); return serve([l], l.keys); })(), 'cert'],
  ['C12 (반대) TLS 1.3 클라이언트 인증서 요구', serve([good], good.keys, { requestCert: true, rejectUnauthorized: true, ca: [root.pem] }), 'other'],
  ['C13 (반대) TLS 1.2 클라이언트 인증서 요구', serve([good], good.keys, { requestCert: true, rejectUnauthorized: true, ca: [root.pem], maxVersion: 'TLSv1.2' }), 'other'],
  ['C14 (반대) ClientHello 직후 RST', () => net.createServer((s) => (s.on('error', () => {}), s.once('data', () => s.resetAndDestroy()))), 'other'],
];

let allMatch = true;
for (const [label, make, kind] of cases) {
  const s = make();
  s.on('error', () => {});
  s.on('tlsClientError', () => {});
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const out = await new Promise((resolve) => {
    let sock;
    const rq = https.request({
      host: '127.0.0.1', port: s.address().port, servername: 'localhost',
      checkServerIdentity: (_h, c) => tls.checkServerIdentity('localhost', c),
      ca: [...tls.rootCertificates, root.pem], rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], agent: false,
    }, (r) => (r.resume(), resolve({ ok: r.statusCode })));
    rq.on('socket', (x) => (sock = x));
    rq.on('error', (e) => resolve({ code: e.code, authorizationError: sock?.authorizationError, authorized: sock?.authorized }));
    rq.end();
  });
  // 판정(E113): 인증서 사례는 authorizationError === code, 반대 사례는 authorizationError 없음
  const match = kind === 'none' ? 'ok' in out : kind === 'cert' ? out.code !== undefined && out.authorizationError === out.code : out.code !== undefined && !out.authorizationError;
  allMatch &&= match;
  console.log(`${match ? '일치' : '불일치'} ${label}: ${JSON.stringify(out)}`);
  s.close();
}
console.log(`E113: ${allMatch ? '모두 일치' : '불일치 있음'}`);
process.exit(0);
