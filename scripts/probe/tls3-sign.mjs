// [TLS-3 실측] 말단 인증서를 forge로 짜고 서명은 Node crypto.sign(콜백, 스레드 풀)으로 할 수 있는가 (E85~E90)
//   node scripts/probe/tls3-sign.mjs
// 루트 CA는 임시 폴더에 loadOrCreateCA로 만든다. Windows 인증서 저장소는 건드리지 않는다. 키는 출력하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import forge from 'node-forge';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const { pki, asn1 } = forge;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3-probe-'));
const root = await loadOrCreateCA(path.join(base, 'ca'));
const rootCert = pki.certificateFromPem(root.certPem);
const rootKey = crypto.createPrivateKey(root.keyPem);
const rootSki = rootCert.getExtension('subjectKeyIdentifier').subjectKeyIdentifier; // hex
const openssl = (pem) => {
  const f = path.join(base, `c${Math.random().toString(16).slice(2)}.pem`);
  fs.writeFileSync(f, pem);
  return execFileSync('openssl', ['x509', '-in', f, '-noout', '-text'], { encoding: 'utf8' });
};
const lagMeter = () => {
  let max = 0;
  let last = performance.now();
  const t = setInterval(() => {
    const n = performance.now();
    max = Math.max(max, n - last - 5);
    last = n;
  }, 5);
  return async () => (await new Promise((r) => setTimeout(r, 20)), clearInterval(t), max);
};

async function leaf(hosts, mode) {
  const { privateKey, publicKey } = await new Promise((r, j) =>
    crypto.generateKeyPair('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }, (e, pub, priv) => (e ? j(e) : r({ publicKey: pub, privateKey: priv }))),
  );
  const c = pki.createCertificate();
  c.publicKey = pki.publicKeyFromPem(publicKey);
  const sn = crypto.randomBytes(16);
  sn[0] = sn[0] & 0x7f || 1;
  c.serialNumber = sn.toString('hex');
  c.validity.notBefore = new Date(Date.now() - 3600_000);
  c.validity.notAfter = new Date(Date.now() + 30 * 86400_000);
  c.setSubject([{ name: 'commonName', value: hosts[0] }]);
  c.setIssuer(rootCert.subject.attributes);
  c.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: hosts.map((h) => (/^[\d.]+$|:/.test(h) ? { type: 7, ip: h } : { type: 2, value: h })) },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: forge.util.hexToBytes(rootSki) },
  ]);
  if (mode === 'forge') {
    c.sign(pki.privateKeyFromPem(root.keyPem), forge.md.sha256.create());
  } else {
    // forge가 서명할 때와 같은 칸을 채운다: TBS 안의 서명 알고리즘(siginfo)과 바깥 signatureOid
    c.siginfo.algorithmOid = c.signatureOid = pki.oids.sha256WithRSAEncryption;
    const tbs = Buffer.from(asn1.toDer(pki.getTBSCertificate(c)).getBytes(), 'binary');
    const sig = await new Promise((r, j) => crypto.sign('sha256', tbs, rootKey, (e, s) => (e ? j(e) : r(s))));
    c.signature = sig.toString('binary');
  }
  return { certPem: pki.certificateToPem(c), keyPem: privateKey };
}

// E85·E86: 두 방식의 검증과 지연
for (const mode of ['node', 'forge']) {
  const stop = lagMeter();
  const t0 = performance.now();
  const l = await leaf(['localhost', '127.0.0.1', '::1'], mode);
  const ms = performance.now() - t0;
  const lag = await stop();
  const x = new crypto.X509Certificate(l.certPem);
  const text = openssl(l.certPem);
  console.log(`E85/E86 ${mode}: verify(루트)=${x.verify(new crypto.X509Certificate(root.certPem).publicKey)} checkIssued=${x.checkIssued(new crypto.X509Certificate(root.certPem))} sig=${text.match(/Signature Algorithm: (\S+)/)[1]} / ${ms.toFixed(0)}ms, 이벤트 루프 최대 지연 ${lag.toFixed(0)}ms`);
  if (mode === 'node') {
    // E87: IP SAN
    console.log(`E87 checkIP 127.0.0.1=${x.checkIP('127.0.0.1')} ::1=${x.checkIP('::1')} checkHost localhost=${x.checkHost('localhost')} / openssl SAN: ${text.match(/Subject Alternative Name:\s*\n\s*(.+)/)[1].trim()}`);
    // E88: AKI = 루트 SKI
    const aki = text.match(/Authority Key Identifier:\s*\n\s*(?:keyid:)?([0-9A-F:]+)/)?.[1];
    const ski = openssl(root.certPem).match(/Subject Key Identifier:\s*\n\s*([0-9A-F:]+)/)?.[1];
    console.log(`E88 AKI ${aki} / 루트 SKI ${ski} / 같음 ${aki === ski}`);
    // E89: issuer DN 바이트
    const der = (n) => Buffer.from(asn1.toDer(pki.distinguishedNameToAsn1(n)).getBytes(), 'binary').toString('hex');
    console.log(`E89 issuer DN 바이트 = 루트 subject DN 바이트: ${der(pki.certificateFromPem(l.certPem).issuer) === der(rootCert.subject)}`);
    // E90: 실제 TLS 핸드셰이크
    const srv = tls.createServer({ cert: l.certPem, key: l.keyPem }, (s) => s.end('ok'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const hs = (servername) =>
      new Promise((r) => {
        const s = tls.connect({ port, host: '127.0.0.1', ca: root.certPem, servername }, () => (r(`성공 authorized=${s.authorized}`), s.destroy()));
        s.on('error', (e) => r(`실패 ${e.code}`));
      });
    console.log(`E90 servername localhost → ${await hs('localhost')} / other.test → ${await hs('other.test')}`);
    srv.close();
  }
}
fs.rmSync(base, { recursive: true, force: true });
