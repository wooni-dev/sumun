// r3: CONNECT(불투명 터널, tunnel: true) 대상 표기와 이름 해석 결과별로 대시보드(진짜 startDashboard)에 닿는가.
// 다중 주소: 첫 주소(가짜 공인 주소)가 연결 거부면 다음 주소(127.0.0.1)로 넘어가는지 — connectUpstream을 바꿔 끼워 인터넷에 나가지 않게 흉내 낸다
import net from 'node:net';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);
const { startDashboard } = await import(pathToFileURL(repo + '/src/dashboard/server.ts').href);
const { parseConnectTarget } = await import(pathToFileURL(repo + '/src/tls/tunnel.ts').href);
const { createStore } = await import(pathToFileURL(repo + '/src/store/store.ts').href);

const store = createStore();
const dash = await startDashboard({ store, port: 0 });
const dp = dash.port;
const closed = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const FAKE = { 'multi.test': ['203.0.113.7', '127.0.0.1'], 'rebind.test': ['127.0.0.1'], 'mapped.test': ['::ffff:127.0.0.1'], 'zero.test': ['0.0.0.0'] };
const lookup = async (h) => {
  const k = h.replace(/\.$/, '');
  if (FAKE[k]) return FAKE[k].map((a) => ({ address: a, family: net.isIP(a) }));
  if (k === 'localhost') return [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }];
  throw new Error('no internet in this experiment');
};
// 203.0.113.7(TEST-NET-3)로는 실제로 나가지 않고 닫힌 로컬 포트로 연결해 ECONNREFUSED를 받는다
const connectUpstream = (o) => net.connect(o.host === '203.0.113.7' ? { host: '127.0.0.1', port: closed, allowHalfOpen: true } : o);
const flows = []; const starts = [];
const proxy = await startProxy({ port: 0, tunnel: true, lookup, connectUpstream, onFlow: (f) => flows.push(f), onFlowStart: (s) => starts.push(s) });

const tunnelGet = (target, inner) => new Promise((ok) => {
  const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  let buf = ''; let sent = false;
  s.on('data', (c) => { buf += c; if (!sent && buf.startsWith('HTTP/1.1 200') && buf.includes('\r\n\r\n')) { sent = true; s.write(inner); } });
  s.setTimeout(3000, () => s.destroy());
  s.on('close', () => ok(buf)); s.on('error', () => {});
});
const ping = `GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:${dp}\r\nAuthorization: Bearer ${dash.token}\r\nConnection: close\r\n\r\n`;
const summary = (b) => { const parts = b.split('HTTP/1.1 ').filter(Boolean).map((x) => x.split('\r\n')[0]); const body = b.slice(b.lastIndexOf('\r\n\r\n') + 4).trim().slice(0, 50); return parts.join(' -> ') + ' | ' + body; };

console.log('dashboard 127.0.0.1:' + dp, 'proxy', proxy.port);
const targets = [`127.0.0.1:${dp}`, `localhost:${dp}`, `LOCALHOST:${dp}`, `localhost.:${dp}`, `127.0.0.1.:${dp}`, `0.0.0.0:${dp}`, `[::ffff:127.0.0.1]:${dp}`, `[::ffff:7f00:1]:${dp}`, `[::1]:${dp}`, `127.0.0.2:${dp}`, `multi.test:${dp}`, `mapped.test:${dp}`, `zero.test:${dp}`, `rebind.test:${dp}`,
  `127.1:${dp}`, `2130706433:${dp}`, `0x7f000001:${dp}`, `127.0.0.1:0${dp}`, `127.000.000.001:${dp}`];
for (const t of targets) {
  const p = parseConnectTarget(t);
  const r = await tunnelGet(t, ping);
  console.log(`${t.padEnd(30)} parse=${JSON.stringify(p).slice(0, 60).padEnd(62)} => ${summary(r)}`);
}
// Host 헤더를 바꿔 보내면? (터널 안이라 프록시는 보지 않는다 — 대시보드의 Host 검사만 남는다)
const r2 = await tunnelGet(`127.0.0.1:${dp}`, `GET /api/ping HTTP/1.1\r\nHost: anything.evil\r\nAuthorization: Bearer ${dash.token}\r\nConnection: close\r\n\r\n`);
console.log('inner Host anything.evil =>', summary(r2));
// 토큰 없이 페이지(/) — 정적 파일은 토큰 없이 받는다
const r3 = await tunnelGet(`127.0.0.1:${dp}`, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${dp}\r\nConnection: close\r\n\r\n`);
console.log('inner GET / no token =>', summary(r3).slice(0, 80));
await new Promise((r) => setTimeout(r, 300));
console.log('\nCONNECT records:', flows.length, 'sample:', JSON.stringify(flows.slice(0, 2).map((f) => ({ url: f.request.url, target: f.request.target, tunnel: f.tunnel, error: f.error }))));
console.log('starts', starts.length);
await proxy.close(); await dash.close();
