// [SEC-3 실측] 저장소를 바꾸지 않고 읽기만 한다(E121~E124): 레지스트리의 Root 인증서 Blob 해석, PowerShell 합친 보기와 비교, 사용자 Root 개수, 승격 여부 SID
//   node scripts/probe/sec3-reg.mjs
// 쓰는 도구: reg.exe query, whoami.exe /groups, powershell Get-ChildItem Cert:(읽기). 등록·삭제 명령은 쓰지 않는다.
import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';

const SYS = 'C:\\Windows\\System32';
const run = (exe, args) => execFileSync(`${SYS}\\${exe}`, args, { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024, windowsHide: true });

// reg query <키> /s /v Blob 출력 → [{ key, sha1(키 이름), blobHex }]
function parseReg(out) {
  const items = [];
  let key = null;
  for (const line of out.split(/\r?\n/)) {
    const k = line.match(/^HKEY_[A-Z_]+\\.*\\Certificates\\([0-9A-Fa-f]{40})$/);
    if (k) key = k[1].toUpperCase();
    const b = line.match(/^\s+Blob\s+REG_BINARY\s+([0-9A-Fa-f]*)\s*$/);
    if (b && key) items.push({ sha1: key, blobHex: b[1] }), (key = null);
  }
  return items;
}
// Blob = [속성 ID u32][예약 u32][길이 u32][데이터]… 의 반복. 속성 32 = 인증서 DER [추측: 이 실측으로 확인]
function blobToDer(hex) {
  const b = Buffer.from(hex, 'hex');
  for (let i = 0; i + 12 <= b.length; ) {
    const id = b.readUInt32LE(i);
    const len = b.readUInt32LE(i + 8);
    if (i + 12 + len > b.length) return null;
    if (id === 32) return b.subarray(i + 12, i + 12 + len);
    i += 12 + len;
  }
  return null;
}
function readStore(root) {
  let out = '';
  try {
    out = run('reg.exe', ['query', `${root}\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates`, '/s', '/v', 'Blob']);
  } catch (e) {
    out = String(e.stdout ?? ''); // 항목이 없으면 reg가 종료 코드 1을 낸다 [추측]
    console.log(`  (reg 종료 코드 ${e.status})`);
  }
  return parseReg(out);
}

console.log('명령: reg.exe query HKLM\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates /s /v Blob');
const hklm = readStore('HKLM');
let same = 0;
const bad = [];
for (const it of hklm) {
  const der = blobToDer(it.blobHex);
  const got = der && createHash('sha1').update(der).digest('hex').toUpperCase();
  let cn = '';
  try {
    cn = der ? new X509Certificate(der).subject.split('\n').find((l) => l.startsWith('CN=')) ?? '' : '';
  } catch {}
  if (got === it.sha1) same++;
  else bad.push(`${it.sha1} → ${got}`);
  if (same <= 3 && got === it.sha1) console.log(`  예: ${it.sha1} ${cn}`);
}
console.log(`E121: HKLM 항목 ${hklm.length}개, Blob 속성 32의 SHA-1 = 키 이름 ${same}개, 다름 ${bad.length}개 ${bad.slice(0, 3).join(' / ')} → ${hklm.length >= 1 && bad.length === 0 ? '일치' : '불일치'}`);

const ps = execFileSync(`${SYS}\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-Command', 'Get-ChildItem Cert:\\LocalMachine\\Root | ForEach-Object { $_.Thumbprint }'], { encoding: 'latin1' })
  .split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const missing = hklm.filter((it) => !ps.includes(it.sha1)).map((it) => it.sha1);
console.log(`E122: Cert:\\LocalMachine\\Root(합친 보기) ${ps.length}개, 레지스트리 항목 중 거기에 없는 것 ${missing.length}개 → ${missing.length === 0 ? '일치' : '불일치'}`);

console.log('명령: reg.exe query HKCU\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates /s /v Blob');
const hkcu = readStore('HKCU');
console.log(`E123: HKCU(사용자 물리 Root) 항목 ${hkcu.length}개 → ${hkcu.length === 0 ? '일치' : '불일치'}`);

const groups = run('whoami.exe', ['/groups', '/fo', 'csv', '/nh']);
const levels = [...groups.matchAll(/"(S-1-16-\d+)"/g)].map((m) => m[1]);
console.log(`명령: whoami.exe /groups /fo csv /nh → 무결성 SID ${levels.join(', ')}`);
console.log(`E124: S-1-16-8192 있음 ${levels.includes('S-1-16-8192')}, S-1-16-12288 있음 ${levels.includes('S-1-16-12288')} → ${levels.includes('S-1-16-8192') && !levels.includes('S-1-16-12288') ? '일치' : '불일치'}`);
