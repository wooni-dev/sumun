// [TLS-1b 실측] R12: 동시 터널 N개 중 데이터를 못 받는 것이 생기는지, 생기면 어느 단계에서 멈췄는지
//   node scripts/probe/tls1b-concurrency.mjs [N, 기본 300] [direct]
//   direct를 주면 프록시 없이 목적지에 바로 N개를 연결해 비교한다(환경 한계인지 가르기 위해)
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';

const N = Number(process.argv[2] ?? 300);
const direct = process.argv[3] === 'direct';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let upConns = 0;
const server = net.createServer((s) => (upConns++, s.on('error', () => {}), s.on('data', (d) => s.write(d))));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const flows = [];
const proxy = await startProxy({ port: 0, tunnel: true, onFlow: (f) => flows.push(f) });
let proxyConns = 0;
const cs = Array.from({ length: N }, (_, i) => {
  const s = net.connect(direct ? port : proxy.port, '127.0.0.1');
  const st = { i, connected: false, buf: '', err: null, closed: false };
  s.on('connect', () => ((st.connected = true), proxyConns++));
  s.on('data', (d) => (st.buf += d));
  s.on('error', (e) => (st.err = e.code));
  s.on('close', () => (st.closed = true));
  s.write(direct ? `p${i}` : `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\np${i}`);
  return { s, st };
});
await sleep(5000);
const bad = cs.filter(({ st }) => !st.buf.endsWith(`p${st.i}`));
console.log(`N=${N} ${direct ? '직접' : '프록시 경유'}: 클라이언트 연결 성공 ${proxyConns}, 목적지가 받은 연결 ${upConns}, 실패 ${bad.length}`);
const kinds = {};
for (const { st } of bad) {
  const k = `connected=${st.connected} 받은것=${st.buf ? JSON.stringify(st.buf.slice(0, 40)) : '없음'} err=${st.err} closed=${st.closed}`;
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log(kinds);
console.log(`기록 ${flows.length}개`, flows.length ? [...new Set(flows.map((f) => JSON.stringify(f.error)))] : '');
cs.forEach(({ s }) => s.destroy());
await proxy.close();
server.close();
process.exit(0);
