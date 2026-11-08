// [UI-6 검토] 요구 2: 불투명 터널(복호화 안 함)에서 끊는 방식별로 기록의 error·tunnel이 어떻게 남는지 본다.
// 실제 startProxy(tunnel: true)를 127.0.0.1:0에 열고, 가짜 목적지도 127.0.0.1에만. 끝나면 모두 닫는다.
// 실행: node scripts/probe/ui6-review/tunnel-abort.mjs
import net from 'node:net';
import { startProxy } from '../../../src/proxy/server.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flows = [];
const proxy = await startProxy({ port: 0, tunnel: true, onFlow: (f) => flows.push(f) });
const mk = (onConn) => new Promise((r) => { const s = net.createServer({ allowHalfOpen: true }, onConn); s.listen(0, '127.0.0.1', () => r(s)); });
const echo = await mk((s) => { s.on('data', (d) => s.write(d)); s.on('end', () => s.end()); s.on('error', () => {}); });
const silent = await mk((s) => { s.on('error', () => {}); });
const resetter = await mk((s) => { s.on('error', () => {}); s.once('data', () => (s.write('partial'), setTimeout(() => s.resetAndDestroy(), 50))); });

function tunnel(port) {
  return new Promise((r) => {
    const c = net.connect(proxy.port, '127.0.0.1', () => c.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
    c.on('error', () => {});
    c.once('data', () => r(c));
  });
}
async function run(name, port, act) {
  const before = flows.length;
  const c = await tunnel(port);
  await act(c);
  for (let i = 0; i < 40 && flows.length === before; i++) await sleep(50);
  const f = flows[before];
  console.log(`${name}: error=${JSON.stringify(f?.error)} tunnel=${JSON.stringify(f?.tunnel && { up: f.tunnel.bytesUp, down: f.tunnel.bytesDown })}`);
}
await run('T1 데이터 오간 뒤 클라이언트 RST', echo.address().port, async (c) => { c.write('hello'); await sleep(150); c.resetAndDestroy(); });
await run('T2 데이터 오간 뒤 클라이언트 FIN', echo.address().port, async (c) => { c.write('hello'); await sleep(150); c.end(); });
await run('T3 보냈지만 목적지 무응답 → 클라이언트 RST', silent.address().port, async (c) => { c.write('ClientHello...'); await sleep(300); c.resetAndDestroy(); });
await run('T4 아무것도 안 보내고 클라이언트 RST', silent.address().port, async (c) => { await sleep(100); c.resetAndDestroy(); });
await run('T5 목적지가 일부 보낸 뒤 RST', resetter.address().port, async (c) => { c.write('x'); await sleep(400); });
await proxy.close();
for (const s of [echo, silent, resetter]) s.close();
