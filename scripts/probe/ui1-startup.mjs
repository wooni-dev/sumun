// [UI-1] 진단: npm start(src/index.ts)를 띄운 뒤 시작 줄이 나오기까지 걸리는 시간(ms). 인자: 반복 횟수(기본 5), 그 뒤 index.ts 인자
// TLS-1 "npm start는 터널을 켠다"는 시작 줄을 3초까지만 기다린다 — 대시보드가 생긴 뒤 이 시간을 넘는지 본다
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const n = Number(process.argv[2] ?? 5);
const extra = process.argv.slice(3);
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
for (let i = 0; i < n; i++) {
  const P = await freePort();
  const t0 = Date.now();
  const child = spawn(process.execPath, ['src/index.ts', '--port', String(P), ...extra], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const ms = await new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => ((out += d), out.includes('\n') && resolve(Date.now() - t0)));
    child.on('exit', () => resolve(-1));
  });
  child.kill();
  console.log(`시작 줄까지 ${ms}ms${extra.length ? ` (${extra.join(' ')})` : ''}`);
}
