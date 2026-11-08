// [TLS-4 실측] MITM에 쓸 Node TLS 동작 (E95~E98)
//   node scripts/probe/tls4-node.mjs
// 임시 폴더의 CA만 쓴다. Windows 인증서 저장소는 건드리지 않는다. 인터넷에 연결하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { Duplex } from 'node:stream';
import forge from 'node-forge';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4-probe-'));
const proxyCA = await loadOrCreateCA(path.join(base, 'proxy'));
const upCA = await loadOrCreateCA(path.join(base, 'up'));
const otherCA = await loadOrCreateCA(path.join(base, 'other'));

// ---- E96·E97: CONNECT와 같은 write로 온 ClientHello(head) + 안쪽 HTTP 서버 keep-alive ----
const inner = http.createServer((req, res) => res.end(`inner ${req.url}`));
const leaf = await issueCert(proxyCA, ['localhost']);
let headLen = -1;
const front = http.createServer();
front.on('connect', (req, socket, head) => {
  headLen = head.length;
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length) socket.unshift(head);
  const t = new tls.TLSSocket(socket, { isServer: true, cert: leaf.certPem, key: leaf.keyPem, ALPNProtocols: ['http/1.1'] });
  t.on('error', () => {});
  inner.emit('connection', t);
});
await new Promise((r) => front.listen(0, '127.0.0.1', r));

// 클라이언트: CONNECT 줄과 ClientHello를 한 번에 보낸다. 받은 200 줄은 걷어 내고 나머지를 TLS에 넘긴다
const raw = net.connect(front.address().port, '127.0.0.1');
await new Promise((r) => raw.once('connect', r));
let first = true;
let gotHead = false;
let pending = Buffer.alloc(0);
const bridge = new Duplex({
  write(chunk, _e, cb) {
    raw.write(first ? Buffer.concat([Buffer.from('CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n'), chunk]) : chunk);
    first = false;
    cb();
  },
  read() {},
});
raw.on('data', (d) => {
  if (gotHead) return bridge.push(d);
  pending = Buffer.concat([pending, d]);
  const i = pending.indexOf('\r\n\r\n');
  if (i >= 0) ((gotHead = true), bridge.push(pending.subarray(i + 4)));
});
const c = tls.connect({ socket: bridge, servername: 'localhost', ca: proxyCA.certPem, ALPNProtocols: ['h2', 'http/1.1'] });
await new Promise((r, j) => (c.once('secureConnect', r), c.once('error', j)));
let got = '';
c.on('data', (d) => (got += d));
for (const p of ['/1', '/2', '/3']) {
  const before = (got.match(/HTTP\/1\.1 200/g) ?? []).length;
  c.write(`GET ${p} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  for (let k = 0; k < 100 && (got.match(/HTTP\/1\.1 200/g) ?? []).length === before; k++) await new Promise((r) => setTimeout(r, 10));
}
console.log(`E96 head 길이 ${headLen}(> 0이면 ClientHello가 CONNECT와 함께 옴), 핸드셰이크 authorized=${c.authorized}, ALPN=${c.alpnProtocol}`);
console.log(`E97 keep-alive 응답 ${(got.match(/HTTP\/1\.1 200/g) ?? []).length}개, 본문 ${JSON.stringify(got.match(/inner \/\d/g))}`);
c.destroy();
front.close();

// ---- E95·E98: 목적지 인증서 문제별 오류 코드(검증 명시 + NODE_TLS_REJECT_UNAUTHORIZED=0) ----
function forgeLeaf(signer, { notBefore, notAfter, selfSigned = false }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = notBefore;
  c.validity.notAfter = notAfter;
  c.setSubject([{ name: 'commonName', value: 'localhost' }]);
  c.setIssuer(selfSigned ? c.subject.attributes : forge.pki.certificateFromPem(signer.certPem).subject.attributes);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]);
  c.sign(forge.pki.privateKeyFromPem(selfSigned ? keyPem : signer.keyPem), forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(c), keyPem };
}
const DAY = 86400_000;
const servers = {
  정상: await issueCert(upCA, ['localhost', '127.0.0.1']),
  만료: forgeLeaf(upCA, { notBefore: new Date(Date.now() - 10 * DAY), notAfter: new Date(Date.now() - DAY) }),
  자체서명: forgeLeaf(null, { notBefore: new Date(Date.now() - DAY), notAfter: new Date(Date.now() + DAY), selfSigned: true }),
  이름불일치: await issueCert(upCA, ['other.test']),
  모르는CA: await issueCert(otherCA, ['localhost']),
  프록시CA: await issueCert(proxyCA, ['localhost']),
};
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // E95: 이 환경 변수가 검증을 끄지 못해야 한다
const trust = [...tls.rootCertificates, upCA.certPem];
for (const [name, pair] of Object.entries(servers)) {
  const s = https.createServer({ cert: pair.certPem, key: pair.keyPem }, (_q, r) => r.end('secret-body'));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  for (const [label, extra] of [['명시 true', { rejectUnauthorized: true }], ['기본값', {}]]) {
    const r = await new Promise((resolve) => {
      const q = https.request({ host: '127.0.0.1', port: s.address().port, servername: 'localhost', ca: trust, agent: false, ...extra }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(`성공 ${res.statusCode} ${b}`));
      });
      q.on('error', (e) => resolve(`실패 ${e.code}`));
      q.end();
    });
    console.log(`E95/E98 ${name.padEnd(5)} [${label}] → ${r}`);
  }
  s.close();
}
// A11: 목적지가 IP(servername 없이)
{
  const s = https.createServer({ cert: servers.정상.certPem, key: servers.정상.keyPem }, (_q, r) => r.end('ip-ok'));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const r = await new Promise((resolve) => {
    const q = https.request({ host: '127.0.0.1', port: s.address().port, ca: trust, agent: false, rejectUnauthorized: true }, (res) => (res.resume(), resolve(`성공 ${res.statusCode}`)));
    q.on('error', (e) => resolve(`실패 ${e.code}`));
    q.end();
  });
  console.log(`A11 IP 목적지(IP SAN, servername 없음) → ${r}`);
  s.close();
}
fs.rmSync(base, { recursive: true, force: true });
