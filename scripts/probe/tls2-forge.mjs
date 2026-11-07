// [TLS-2 실측] node-forge로 루트 CA를 만들 때의 함정과 호환성 (E69~E74)
//   node scripts/probe/tls2-forge.mjs
// 임시 폴더에만 쓰고 끝나면 지운다. Windows 인증서 저장소는 읽기만 한다(certutil -user -store Root의 줄 수를 전후 비교).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import forge from 'node-forge';

const { pki } = forge;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2-probe-'));
const run = (cmd, args) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
};
const openssl = (pem) => {
  const f = path.join(dir, `c${Math.random().toString(16).slice(2)}.pem`);
  fs.writeFileSync(f, pem);
  return run('openssl', ['x509', '-in', f, '-noout', '-text']).out;
};

// E74: Node 비동기 키 생성 + forge 서명 시간, 이벤트 루프 지연
let maxLag = 0;
let last = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  maxLag = Math.max(maxLag, now - last - 10);
  last = now;
}, 10);
const t0 = performance.now();
const { privateKey, publicKey } = await new Promise((r, j) =>
  crypto.generateKeyPair('rsa', { modulusLength: 2048, publicExponent: 0x10001, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }, (e, pub, priv) => (e ? j(e) : r({ publicKey: pub, privateKey: priv }))),
);
const tKey = performance.now() - t0;

// E71: forge가 Node의 PKCS#8을 읽는가
const fKey = pki.privateKeyFromPem(privateKey);
const fPub = pki.publicKeyFromPem(publicKey);

function make({ serialHex, md, ext = true }) {
  const c = pki.createCertificate();
  c.publicKey = fPub;
  c.serialNumber = serialHex;
  const attrs = [{ name: 'commonName', value: 'sumun probe CA' }];
  c.setSubject(attrs);
  c.setIssuer(attrs);
  if (ext) {
    c.validity.notBefore = new Date(Date.now() - 86400_000);
    c.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
    c.setExtensions([
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectKeyIdentifier' },
    ]);
  }
  md ? c.sign(fKey, md) : c.sign(fKey);
  return c;
}

const tSign0 = performance.now();
const good = make({ serialHex: '01' + crypto.randomBytes(15).toString('hex'), md: forge.md.sha256.create() });
const tSign = performance.now() - tSign0;
const goodPem = pki.certificateToPem(good);
await new Promise((r) => setTimeout(r, 30)); // 서명은 동기라 그동안 막힌 지연은 타이머가 다음에 돌 때 잡힌다 — 멈추기 전에 한 번 더 돌린다
clearInterval(timer);
console.log(`E74 키 생성 ${tKey.toFixed(0)}ms, forge 서명 ${tSign.toFixed(0)}ms, 이벤트 루프 최대 지연 ${maxLag.toFixed(0)}ms`);

const x = new crypto.X509Certificate(goodPem);
console.log(`E71 forge가 PKCS#8 읽음: 예 / Node verify(자기 공개키): ${x.verify(x.publicKey)} / checkPrivateKey: ${x.checkPrivateKey(crypto.createPrivateKey(privateKey))} / ca: ${x.ca}`);

// E69: md 없이 서명
const noMd = make({ serialHex: '01', md: undefined });
const sigNoMd = openssl(pki.certificateToPem(noMd)).match(/Signature Algorithm: (\S+)/)?.[1];
const sigGood = openssl(goodPem).match(/Signature Algorithm: (\S+)/)?.[1];
console.log(`E69 md 없이 서명 → ${sigNoMd} / sha256을 넘기면 → ${sigGood}`);

// E70: 첫 hex가 8~f인 일련번호
const neg = make({ serialHex: 'ff' + '00'.repeat(15), md: forge.md.sha256.create() });
// 두 개의 독립 파서(Node, openssl)가 일련번호를 어떻게 읽는지 본다
console.log(`E70 일련번호 "ff00…" → Node serialNumber ${new crypto.X509Certificate(pki.certificateToPem(neg)).serialNumber.slice(0, 8)}… / openssl: ${openssl(pki.certificateToPem(neg)).match(/Serial Number:\s*\n?\s*(.+)/)?.[1]?.slice(0, 30)}`);

// 기본 유효 기간(notAfter = notBefore인지)
const def = pki.createCertificate();
console.log(`forge 기본 유효 기간: notBefore=${def.validity.notBefore.toISOString()} notAfter=${def.validity.notAfter.toISOString()}`);

// E72: openssl로 확장 확인
const text = openssl(goodPem);
for (const k of ['CA:TRUE, pathlen:0', 'Certificate Sign, CRL Sign', 'TLS Web Server Authentication', 'Subject Key Identifier']) console.log(`E72 openssl에 "${k}": ${text.includes(k)}`);
console.log(`E72 critical 표시: basicConstraints ${/Basic Constraints: critical/.test(text)}, keyUsage ${/Key Usage: critical/.test(text)}`);

// E73: certutil -dump는 파일만 읽는가
const before = run('certutil', ['-user', '-store', 'Root']).out.split('\n').length;
const f = path.join(dir, 'ca-cert.pem');
fs.writeFileSync(f, goodPem);
const dump = run('certutil', ['-dump', f]);
const after = run('certutil', ['-user', '-store', 'Root']).out.split('\n').length;
// certutil 출력은 이 PC에서 CP949라 한글 비교 대신 OID(2.5.29.19 = Basic Constraints)로 찾는다.
// CurrentUser\Root는 직접 등록한 것이 없으면 머리말 몇 줄뿐이다 — 줄 수가 같으면 바뀌지 않은 것
console.log(`E73 certutil -dump 종료 코드 ${dump.code}, Basic Constraints(2.5.29.19) 포함 ${dump.out.includes('2.5.29.19')} / 저장소 줄 수 전 ${before} 후 ${after}`);

fs.rmSync(dir, { recursive: true, force: true });
