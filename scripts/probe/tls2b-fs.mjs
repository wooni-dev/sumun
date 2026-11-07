// [TLS-2b 실측] CA 파일을 안전하게 배치하기 위한 Windows 파일 동작 (E77~E81)
//   node scripts/probe/tls2b-fs.mjs
// 임시 폴더에서만 한다. 키는 쓰지 않는다(평범한 글자만).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Windows 도구는 절대 경로로 부른다: Git Bash의 whoami가 PATH에서 먼저 잡혀 Windows whoami.exe를 가린다 [확인됨: 첫 실행]
const SYS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const WHOAMI = path.join(SYS, 'whoami.exe');
const ICACLS = path.join(SYS, 'icacls.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2b-probe-'));
const p = (n) => path.join(dir, n);
const acl = (f) =>
  execFileSync(ICACLS, [f], { encoding: 'latin1' })
    .split('\n')
    .map((l) => l.replace(f, '').trim())
    .filter((l) => /:\(/.test(l));

// E77: rename은 대상이 있어도 덮어쓰는가
fs.writeFileSync(p('a'), 'A');
fs.writeFileSync(p('b'), 'B');
let r77;
try {
  fs.renameSync(p('a'), p('b'));
  r77 = `덮어씀(b="${fs.readFileSync(p('b'), 'utf8')}")`;
} catch (e) {
  r77 = `실패 ${e.code}`;
}
console.log(`E77 renameSync(a → 있는 b): ${r77}`);

// E78: link는 대상이 있으면 EEXIST인가, 하드 링크는 ACL을 공유하는가
fs.writeFileSync(p('c'), 'C');
fs.writeFileSync(p('d'), 'D');
let r78;
try {
  fs.linkSync(p('c'), p('d'));
  r78 = '성공(덮어씀?)';
} catch (e) {
  r78 = e.code;
}
fs.linkSync(p('c'), p('c-link'));
console.log(`E78 linkSync(c → 있는 d): ${r78} / 하드 링크 ACL 같음: ${JSON.stringify(acl(p('c'))) === JSON.stringify(acl(p('c-link')))} / nlink ${fs.statSync(p('c')).nlink}`);

// E79: 상속을 끊고 내 SID만 남기기
const sid = execFileSync(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'latin1' }).trim().split(',').pop().replace(/"/g, '');
fs.writeFileSync(p('k'), '');
const before = acl(p('k'));
execFileSync(ICACLS, [p('k'), '/inheritance:r', '/grant:r', `*${sid}:(F)`], { stdio: 'ignore' });
fs.writeFileSync(p('k'), 'secret-after-acl'); // 권한을 바꾼 뒤 내용을 쓴다 — 'w'로 다시 열어도 ACL이 남는가
console.log(`E79 SID ${sid.replace(/-\d+$/, '-…')} / 전: ${before.length}줄 ${JSON.stringify(before)} / 후: ${JSON.stringify(acl(p('k')))} / 내용 다시 쓴 뒤 읽기 "${fs.readFileSync(p('k'), 'utf8')}"`);

// E79b: /grant:r은 다른 계정의 직접 권한을 지우지 않는다(위 결과).
//   첫 시도: SDDL을 `icacls /restore`로 덮어쓰기 → 종료 코드 1300(ERROR_NOT_ALL_ASSIGNED: 관리자 특권 SeRestorePrivilege 필요) [확인됨]
//   두 번째: `/save`로 남은 권한을 SDDL(SID로 적힘 — 언어와 무관)로 읽고, 내 SID가 아닌 것을 `/remove:g`로 하나씩 지운다
const ALIAS = { SY: 'S-1-5-18', BA: 'S-1-5-32-544', BU: 'S-1-5-32-545', AU: 'S-1-5-11', WD: 'S-1-1-0', CO: 'S-1-3-0', OW: 'S-1-3-4' };
const sddl = (f) => {
  const out = p('save.txt');
  execFileSync(ICACLS, [f, '/save', out], { stdio: 'ignore' });
  const text = fs.readFileSync(out).toString('utf16le');
  fs.rmSync(out);
  return text.split(/\r?\n/)[1] ?? '';
};
const sids = (d) => [...d.matchAll(/\(([^;]*);[^;]*;[^;]*;[^;]*;[^;]*;([^)]*)\)/g)].map((m) => ({ type: m[1], sid: ALIAS[m[2]] ?? m[2] }));
fs.writeFileSync(p('k2'), '');
const t79 = performance.now();
execFileSync(ICACLS, [p('k2'), '/inheritance:r', '/grant:r', `*${sid}:(F)`], { stdio: 'ignore' });
const others = [...new Set(sids(sddl(p('k2'))).map((a) => a.sid).filter((s) => s !== sid))];
if (others.length) execFileSync(ICACLS, [p('k2'), '/remove:g', ...others.map((s) => `*${s}`)], { stdio: 'ignore' });
const ms79 = performance.now() - t79;
fs.writeFileSync(p('k2'), 'secret-after-acl');
const final = sddl(p('k2'));
console.log(`E79b 지운 계정 ${JSON.stringify(others)} → icacls ${JSON.stringify(acl(p('k2')))} / SDDL 보호(P) ${/^D:P/.test(final.replace(/^.*?(D:)/, '$1'))} ACE ${JSON.stringify(sids(final))} / 내용 다시 쓴 뒤 읽기 "${fs.readFileSync(p('k2'), 'utf8')}" / ${ms79.toFixed(0)}ms`);

// E80: 파일 자리에 만든 디렉터리 정션
fs.mkdirSync(p('elsewhere'));
fs.symlinkSync(p('elsewhere'), p('ca-key.pem'), 'junction');
const st = fs.lstatSync(p('ca-key.pem'));
console.log(`E80 정션: lstat isSymbolicLink ${st.isSymbolicLink()}, isFile ${st.isFile()}, existsSync ${fs.existsSync(p('ca-key.pem'))}`);
let r80;
try {
  fs.linkSync(p('c'), p('ca-key.pem'));
  r80 = '성공';
} catch (e) {
  r80 = e.code;
}
console.log(`E80 정션 자리에 link: ${r80}`);

// E81: Users에 읽기를 상속으로 준 폴더에 만든 파일
fs.mkdirSync(p('shared'));
execFileSync(ICACLS, [p('shared'), '/grant', '*S-1-5-32-545:(OI)(CI)R'], { stdio: 'ignore' });
fs.writeFileSync(p('shared/f'), 'x');
console.log(`E81 상속받은 파일 ACL: ${JSON.stringify(acl(p('shared/f')))}`);

fs.rmSync(dir, { recursive: true, force: true });
