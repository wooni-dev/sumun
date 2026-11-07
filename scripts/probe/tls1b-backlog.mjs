// [TLS-1b 실측] 이 PC가 한순간에 몰린 TCP 연결을 몇 개까지 받는가(listen backlog별). 프록시 없이 net 서버만
//   node scripts/probe/tls1b-backlog.mjs
import net from 'node:net';
for (const backlog of [undefined, 100, 1024]) {
  const server = net.createServer((s) => s.on('error', () => {}));
  await new Promise((r) => server.listen({ port: 0, host: '127.0.0.1', backlog }, r));
  let ok = 0, bad = 0;
  const cs = Array.from({ length: 300 }, () => { const s = net.connect(server.address().port, '127.0.0.1'); s.on('connect', () => ok++); s.on('error', () => bad++); return s; });
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`backlog=${backlog}: 성공 ${ok}, 거절 ${bad}`);
  cs.forEach((s) => s.destroy()); server.close();
}
