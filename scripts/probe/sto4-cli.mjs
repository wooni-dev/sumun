// [STO-4 실측 E150, O31] 실제 클라이언트(curl.exe)로 npm start(src/index.ts)를 거친다 — 저장소를 연결한 뒤에도 출력이 시작 줄 + 요약 줄뿐이고 표식이 없는가
//   node scripts/probe/sto4-cli.mjs
// 목적지는 127.0.0.1의 로컬 서버와 닫힌 포트뿐이다(인터넷 없음). 진입점은 끝에 종료한다.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';

const mark = `SUMUN-SECRET-${crypto.randomBytes(8).toString('hex')}`;
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const up = http.createServer((req, res) => (req.resume(), req.on('end', () => res.end(`${mark}-response`))));
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const upPort = up.address().port;
const closed = await freePort();
const port = await freePort();
const child = spawn(process.execPath, ['src/index.ts', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const lines = () => out.split(/\r?\n/).filter(Boolean);
const wait = async (n) => {
  const end = Date.now() + 8000;
  while (lines().length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};
const curl = (args) =>
  new Promise((resolve) => execFile('curl.exe', ['-s', '-m', '5', '-o', 'NUL', '-w', '%{http_code}', '-x', `http://127.0.0.1:${port}`, ...args], (_e, o) => resolve(o)));
await wait(1);
const a = await curl(['-H', `Cookie: k=${mark}`, '--data-binary', `${mark}-body`, `http://127.0.0.1:${upPort}/submit?token=${mark}`]);
const b = await curl([`http://127.0.0.1:${closed}/`]);
await wait(3);
child.kill();
await new Promise((r) => child.once('exit', r));
up.close();
console.log(`E150 curl 상태: 목적지 ${a}, 닫힌 포트 ${b}`);
console.log(`E150 출력 줄 ${lines().length}개:`);
for (const l of lines()) console.log(`  ${l.replace(/:\d{4,5}/g, ':<포트>')}`);
console.log(`E150 표식이 stdout에 ${out.includes(mark)}, stderr에 ${err.includes(mark)}, stderr 길이 ${err.length}`);
