// [TLS-1b 실측] R6b에서 기록이 안 나오는 원인: 프록시와 같은 모양(http 'connect' + 양방향 pipe)의 최소 재현
//   node scripts/probe/tls1b-leak.mjs
// 목적지가 먼저 FIN → 목적지 쪽 소켓(allowHalfOpen 기본 false)이 스스로 닫힘 → pipe가 풀리며 클라이언트 쪽 읽기가 멈춤
// → 클라이언트의 FIN을 읽지 못해 클라이언트 쪽 소켓이 'close'되지 않는다(마지막 줄 client-side destroyed false).
import net from 'node:net';
import http from 'node:http';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = net.createServer({ allowHalfOpen: true }, (s) => { s.on('error', () => {}); s.on('end', () => s.end()); s.end('greeting'); });
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const srv = http.createServer();
let ps, us;
srv.on('connect', (req, socket, head) => {
  ps = socket;
  const u = net.connect({ host: '127.0.0.1', port: up.address().port });
  us = u;
  for (const [n, x] of [['client-side', socket], ['up-side', u]]) for (const e of ['end', 'finish', 'close', 'error']) x.on(e, (a) => console.log(n, e, a?.code ?? ''));
  u.once('connect', () => { socket.write('HTTP/1.1 200 OK\r\n\r\n'); socket.pipe(u); u.pipe(socket); });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const c = net.connect({ port: srv.address().port, host: '127.0.0.1', allowHalfOpen: true });
c.on('error', () => {});
c.write(`CONNECT x:1 HTTP/1.1\r\nHost: x\r\n\r\n`);
await sleep(300); c.write('after'); await sleep(300); c.end(); await sleep(800);
console.log('client-side destroyed', ps.destroyed, 'allowHalfOpen', ps.allowHalfOpen, 'up destroyed', us.destroyed);
process.exit(0);
