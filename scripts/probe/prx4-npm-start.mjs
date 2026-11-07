// [PRX-4 실측] 실제 `npm start -- --port P`로 띄우고 curl로 요청해서 터미널 출력을 본다 (E49, O31)
//   node scripts/probe/prx4-npm-start.mjs
// 요청에는 시험용 표식(SUMUN-PROBE-SECRET)을 userinfo·경로·쿼리·쿠키에 넣는다. 출력에 나오면 유출이다.
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';

const P = 18096;
const up = http.createServer((q, s) => (q.resume(), q.on('end', () => s.end('ok\n'))));
await new Promise((r) => up.listen(18097, '127.0.0.1', r));

const child = spawn(`npm start -- --port ${P}`, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
for (let i = 0; i < 100 && !out.includes('127.0.0.1:'); i++) await new Promise((r) => setTimeout(r, 50));

const curl = (...a) => new Promise((r) => execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '-m', '5', '-x', `http://127.0.0.1:${P}`, ...a], (e, o) => r(o || `종료 코드 ${e?.code}`)));
const S = 'SUMUN-PROBE-SECRET';
console.log('curl 1) 정상:', await curl('-H', `Cookie: k=${S}`, `http://u:${S}@127.0.0.1:18097/p/${S}?t=${S}`));
console.log('curl 2) 닫힌 포트:', await curl(`http://127.0.0.1:1/?t=${S}`));
await new Promise((r) => setTimeout(r, 200));

// npm은 node를 자식으로 띄우므로 프로세스 나무째 끝낸다(Windows)
try {
  execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
} catch {}
up.close();
console.log('--- npm start의 stdout (npm 자체 머리글 포함) ---');
console.log(out.trimEnd());
console.log(`--- stderr: ${JSON.stringify(err)}`);
console.log(`표식이 stdout에 나온 횟수: ${out.split(S).length - 1}`);
