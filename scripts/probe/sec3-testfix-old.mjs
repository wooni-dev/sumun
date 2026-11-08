// [SEC-3 테스트 수정 실측] 옛 forgeCert 방식(태그 없이 이름, 일련번호 그대로)으로 만든 인증서가 새 긍정 전제를 통과하는가(E133)
//   node scripts/probe/sec3-testfix-old.mjs
// 통과하지 못하면 = 옛 테스트가 그 사례를 시험하지 못했다는 증거. 가짜 인증서만 만들고 저장소는 건드리지 않는다.
import crypto, { X509Certificate } from 'node:crypto';
import forge from 'node-forge';

function oldForge(cn, serialHex) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  c.serialNumber = serialHex ?? '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer([{ name: 'commonName', value: cn }]);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' })), forge.md.sha256.create());
  return new X509Certificate(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary'));
}
const look = oldForge('ѕumun local CA 2026-11-08');
console.log(`키릴: subject ${JSON.stringify(look.subject)} → 긍정 전제(ѕumun 포함) ${look.subject.includes('ѕumun')}`);
const evil = String(oldForge('x\x1b[2K‮evil').toLegacyObject().subject.CN);
console.log(`U+202E·ESC: CN ${JSON.stringify(evil)} → 긍정 전제 ${evil.includes('‮') && evil.includes('\x1b')}`);
const hi = 'a' + crypto.randomBytes(19).toString('hex');
const s = oldForge('other', hi).serialNumber.toLowerCase();
console.log(`일련번호 ${hi.slice(0, 8)}…(첫 hex a) → Node ${s.slice(0, 9)}… → 긍정 전제(같음) ${s === hi}`);
