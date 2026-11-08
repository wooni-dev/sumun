// [SEC-3 실측] 테스트가 덮지 못한 사례(B6·E1): 이름에 진짜 UTF-8 키릴 문자·U+202E·ESC가 든 인증서를 status가 "비슷한 이름"으로 경고하고 이스케이프하는가
//   node scripts/probe/sec3-lookalike.mjs
// 이유: test/ca/SEC-3.test.ts의 forgeCert는 이름을 그대로 넘겨 forge가 0xFF 위 글자를 아래 바이트로 자른다('ѕ' → 'U', U+202E → '.')
// [확인됨: 구현 중 디버그]. 여기서는 forge.util.encodeUtf8 + UTF8String으로 진짜 글자를 넣는다. 가짜 저장소만 쓴다(진짜 저장소 안 건드림).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto, { X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { loadOrCreateCA } from '../../src/ca/ca.ts';
import { runCaCommand } from '../../src/ca/command.ts';

function cert(cn) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  const name = [{ name: 'commonName', value: forge.util.encodeUtf8(cn), valueTagClass: forge.asn1.Type.UTF8 }];
  c.setSubject(name);
  c.setIssuer(name);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' })), forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary');
}
const sha1 = (d) => crypto.createHash('sha1').update(d).digest('hex').toUpperCase();
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-sec3-look-'));
const dir = path.join(base, 'ca');
await loadOrCreateCA(dir);
const cases = [['키릴 ѕ', 'ѕumun local CA 2026-11-08'], ['U+202E', 'abc‮evil'], ['ESC', 'x\x1b[2Kevil'], ['제로폭', 'sum​un local CA 2026-11-08'], ['(대조) 평범한 이름', 'Example Root CA']];
const certs = cases.map(([label, cn]) => ({ label, cn, der: cert(cn) }));
for (const c of certs) console.log(`만든 인증서 ${c.label}: Node subject = ${JSON.stringify(new X509Certificate(c.der).subject)}`);
let out = '';
const store = { userRoot: async () => certs.map((c) => ({ sha1: sha1(c.der), der: c.der })), machineRootThumbprints: async () => [], add: async () => ({ code: 0 }), remove: async () => ({ code: 0 }), elevated: async () => false };
await runCaCommand('status', { store, caDir: dir, loadCA: loadOrCreateCA, checkDir: async () => null, input: { isTTY: false, readLine: async () => null }, write: (s) => (out += s) });
for (const c of certs) console.log(`${c.label}: 경고 목록에 ${out.includes(sha1(c.der)) ? '있음' : '없음'}`);
console.log(`출력에 그대로 나온 ESC ${out.includes('\x1b')}, U+202E ${out.includes('‮')}, U+200B ${out.includes('​')}, 키릴 ѕ ${out.includes('ѕ')}`);
fs.rmSync(base, { recursive: true, force: true });
