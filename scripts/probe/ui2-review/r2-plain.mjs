// r2: 평문 absolute-form으로 프록시를 거쳐 127.0.0.1의 가짜 대시보드에 닿는 표기. 기록(onFlowStart·onFlow)에 무엇이 남는지도 본다
import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);

const seen = [];
const dash = http.createServer((req, res) => { seen.push({ url: req.url, host: req.headers.host, via: req.headers.via ?? null, auth: req.headers.authorization ?? null }); res.end('{"secret":"DASH"}'); });
await new Promise((r) => dash.listen(0, '127.0.0.1', r));
const dp = dash.address().port;
const starts = []; const flows = [];
const proxy = await startProxy({ port: 0, tunnel: true, onFlowStart: (s) => starts.push(s), onFlow: (f) => flows.push(f) });

const raw = (reqLine, extra = '') => new Promise((ok) => {
  const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`${reqLine}\r\nHost: x\r\nAuthorization: Bearer TOKEN123\r\nConnection: close\r\n${extra}\r\n`));
  let b = ''; s.on('data', (c) => (b += c)); s.on('close', () => ok(b.split('\r\n')[0] + ' | ' + b.split('\r\n\r\n')[1]?.trim().slice(0, 60)));
  s.on('error', () => ok('socket error'));
});
const cases = ['127.0.0.1', 'LOCALHOST', 'localhost', '127.1', '2130706433', '0x7f000001', '%31%32%37.0.0.1', '\uFF11\uFF12\uFF17\uFF0E\uFF10\uFF0E\uFF10\uFF0E\uFF11', '127.0.0.1.', '0.0.0.0', '0', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::1]', '127.0.0.2', 'evil.com@127.0.0.1'];
for (const h of cases) {
  const before = seen.length;
  const r = await raw(`GET http://${h}:${dp}/api/ping HTTP/1.1`);
  console.log(`${JSON.stringify(h).padEnd(26)} -> ${r.padEnd(70)} reached=${seen.length > before}`);
}
for (const line of [`GET http://127.0.0.1:0${dp}/x HTTP/1.1`, `GET http://127.0.0.1:${dp}\\@evil.com/x HTTP/1.1`, `GET HTTP://127.0.0.1:${dp}/x HTTP/1.1`]) {
  const before = seen.length;
  const r = await raw(line);
  console.log(`${JSON.stringify(line).padEnd(60)} -> ${r.slice(0, 50)} reached=${seen.length > before}`);
}
await new Promise((r) => setTimeout(r, 200));
console.log('\ndashboard saw (first 3):', JSON.stringify(seen.slice(0, 3)));
console.log('onFlowStart count', starts.length, 'first start headers:', JSON.stringify(starts[0]?.request.headers), 'target:', JSON.stringify(starts[0]?.request.target));
console.log('onFlow first response body:', flows[0]?.response?.body?.toString(), 'status', flows[0]?.response?.status);
console.log('record target for 0.0.0.0 case:', JSON.stringify(flows.find((f) => f.request.url.includes('0.0.0.0'))?.request.target));
await proxy.close(); dash.close();
