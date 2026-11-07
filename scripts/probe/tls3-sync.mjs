// [TLS-3 실측] issueCert 한 번 안의 동기 구간별 시간(이벤트 루프를 막는 몫). issueCert와 같은 단계를 따라 한다
//   node scripts/probe/tls3-sync.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const { pki, asn1 } = forge;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3-sync-'));
const root = await loadOrCreateCA(path.join(base, 'ca'));
const keys = await Promise.all(Array.from({ length: 21 }, () => new Promise((r) => crypto.generateKeyPair('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }, (e, pub, priv) => r({ pub, priv })))));

const t = {};
const time = (k, f) => {
  const s = performance.now();
  const v = f();
  t[k] = (t[k] ?? 0) + performance.now() - s;
  return v;
};
for (let i = 0; i < 21; i++) {
  if (i === 1) for (const k of Object.keys(t)) t[k] = 0; // 첫 번(JIT 준비)은 뺀다
  const x = time('루트 X509 파싱+짝 검사', () => {
    const x = new crypto.X509Certificate(root.certPem);
    x.checkPrivateKey(crypto.createPrivateKey(root.keyPem));
    return x;
  });
  time('루트 정책 검사(forge 파싱 포함)', () => pki.certificateFromPem(root.certPem));
  const r = time('루트 forge 파싱(checkIssuer)', () => pki.certificateFromPem(root.certPem));
  const c = time('말단 공개키 forge 파싱', () => {
    const c = pki.createCertificate();
    c.publicKey = pki.publicKeyFromPem(keys[i].pub);
    return c;
  });
  time('말단 칸 채우기', () => {
    c.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
    c.validity.notBefore = new Date();
    c.validity.notAfter = new Date(Date.now() + 86400_000);
    c.setSubject([{ name: 'commonName', value: `h${i}.example.com` }]);
    c.setIssuer(r.subject.attributes);
    c.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: `h${i}.example.com` }] },
      { name: 'subjectKeyIdentifier' },
    ]);
    c.siginfo.algorithmOid = c.signatureOid = pki.oids.sha256WithRSAEncryption;
  });
  const tbs = time('TBS DER 만들기', () => Buffer.from(asn1.toDer(pki.getTBSCertificate(c)).getBytes(), 'binary'));
  c.signature = crypto.sign('sha256', tbs, crypto.createPrivateKey(root.keyPem)).toString('binary');
  time('PEM 만들기', () => pki.certificateToPem(c));
  void x;
}
const total = Object.values(t).reduce((a, b) => a + b, 0);
console.log(Object.entries(t).map(([k, v]) => `${k} ${(v / 20).toFixed(2)}ms`).join('\n'));
console.log(`합계(1회 평균, 동기) ${(total / 20).toFixed(2)}ms → 20개가 한 번에 몰리면 약 ${((total / 20) * 20).toFixed(0)}ms`);
fs.rmSync(base, { recursive: true, force: true });
