// [UI-1] 진단: 다른 프로그램이 P+1을 쓰는 중에 npm start -- --port P를 띄우면 어떻게 되는지(종료 코드·stdout·stderr)
// --dashboard-port를 주지 않았으므로 대시보드 기본 포트는 P+1이다
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const holder = net.createServer((s) => s.destroy());
await new Promise((r) => holder.listen(0, '127.0.0.1', r));
const H = holder.address().port;
const P = H - 1;
const child = spawn(process.execPath, ['src/index.ts', '--port', String(P)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const code = await new Promise((resolve) => {
  child.on('exit', (c) => resolve(c));
  setTimeout(() => (child.kill(), resolve('3초 안에 끝나지 않음')), 3000);
});
console.log(`P=${P}, P+1=${H}(사용 중) → 종료 ${code}, stdout ${JSON.stringify(out.trim().slice(0, 200))}, stderr ${JSON.stringify(err.trim().slice(0, 200))}`);
holder.close();
