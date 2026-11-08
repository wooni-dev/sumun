// [STO 최종 검토] 실제 실행: node src/index.ts --port <빈 포트> + curl.exe. 출력에 비밀이 나오는가, 파일을 쓰는가, 큰 기록에서 메모리가 멈추는가.
// 목적지는 127.0.0.1 로컬 서버뿐. --decrypt는 쓰지 않는다(%LOCALAPPDATA%\sumun을 건드리지 않기 위해).
// 실행: node scripts/probe/sto-final-review/r6-index-curl.mjs
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const r = (k, v) => console.log(k.padEnd(48), JSON.stringify(v));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).split('\n').filter((l) => l && !l.includes('scripts/probe/sto-final-review/')).join('\n');

const MiB = Buffer.alloc(1048576, 0x62);
const up = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Set-Cookie', 'sid=SECRET_SETCOOKIE');
    if (req.url.startsWith('/big')) return res.end(MiB);
    res.end('hello');
  });
});
await new Promise((res) => up.listen(0, '127.0.0.1', res));
const upPort = up.address().port;

const before = gitStatus();
const port = await freePort();
const child = spawn(process.execPath, ['src/index.ts', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (c) => (out += c));
child.stderr.on('data', (c) => (err += c));
await new Promise((res, rej) => { const t = setInterval(() => out.includes('127.0.0.1:') && (clearInterval(t), res()), 50); setTimeout(() => rej(new Error('시작 안 됨')), 10_000); });

const curl = (args) => new Promise((resolve) => execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '20', '-x', `http://127.0.0.1:${port}`, ...args], { encoding: 'utf8' }, (_e, o) => resolve(o)));
const codes = [];
codes.push(await curl(['-H', 'Cookie: sid=SECRET_COOKIE', '-H', 'Authorization: Bearer SECRET_AUTH', '-d', 'password=SECRET_BODY', `http://user:SECRET_PW@127.0.0.1:${upPort}/login?token=SECRET_Q`]));
const closed = await freePort();
codes.push(await curl([`http://127.0.0.1:${closed}/x?token=SECRET_Q2`]));
codes.push(await curl(['-p', `https://127.0.0.1:${closed}/`])); // CONNECT 터널(닫힌 포트)
codes.push(await curl(['-X', 'DELETE', `http://127.0.0.1:${upPort}/item/1`]));

// 메모리: 1MiB 응답 + 1MiB 요청 본문 기록을 두 번에 걸쳐 각 200건(상한이 없으면 각 단계마다 약 400MiB씩 늘어남)
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const big = (n) => Promise.all(Array.from({ length: n }, () => new Promise((res) => {
  const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: `http://127.0.0.1:${upPort}/big`, agent }, (rs) => { rs.resume(); rs.on('end', res); });
  q.on('error', res);
  q.end(MiB);
})));
const ws = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).WorkingSet64`], { encoding: 'utf8' }).trim()) / 1048576;
const ws0 = ws();
await big(200);
await new Promise((res) => setTimeout(res, 1500));
const ws1 = ws();
await big(200);
await new Promise((res) => setTimeout(res, 1500));
const ws2 = ws();
await big(200);
await new Promise((res) => setTimeout(res, 1500));
const ws3 = ws();
r('작업 집합 MB: 시작 / 200 / 400 / 600건 뒤', [ws0, ws1, ws2, ws3].map((x) => Math.round(x)));

child.kill();
await new Promise((res) => child.once('exit', res));
up.close();
agent.destroy();

const lines = out.trim().split(/\r?\n/);
r('curl 상태 코드(평문, 닫힌 포트, CONNECT 닫힌 포트, DELETE)', codes);
r('stdout 줄 수(시작 1 + 요청 4 + 큰 요청 600 기대)', lines.length);
r('stdout 처음 5줄', lines.slice(0, 5));
r('stdout/stderr에 SECRET?', (out + err).includes('SECRET'));
r('stdout/stderr에 경로·쿼리(login, token)?', /login|token|\/item/.test(out + err));
r('stderr', err);
r('작업 트리 변화(검증 폴더 제외)', before === gitStatus() ? '변화 없음' : gitStatus());
