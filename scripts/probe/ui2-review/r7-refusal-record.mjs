// r7: 지금 프록시가 "거절"하는 요청(루프 508 — 대시보드 차단도 같은 자리에 둔다고 가정)에 무엇이 기록·알림되는가,
// 그리고 writeRefusal에 지금 REASON 표에 없는 상태(예 403)를 넘기면 무엇이 나가는가
import net from 'node:net';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);
const { writeRefusal } = await import(pathToFileURL(repo + '/src/tls/tunnel.ts').href);
const starts = []; const flows = [];
const proxy = await startProxy({ port: 0, tunnel: true, onFlowStart: (s) => starts.push(s), onFlow: (f) => flows.push(f) });
const raw = (text) => new Promise((ok) => { const s = net.connect(proxy.port, '127.0.0.1', () => s.write(text)); let b = ''; s.on('data', (c) => (b += c)); s.on('close', () => ok(b)); s.on('error', () => ok(b)); });
const r1 = await raw(`GET http://127.0.0.1:${proxy.port}/api/flows?q=<script>alert(1)</script> HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer SECRET-TOKEN\r\nCookie: sid=abc\r\nConnection: close\r\n\r\n`);
const r2 = await raw(`CONNECT 127.0.0.1:${proxy.port} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: Basic dXNlcjpwYXNz\r\nX-Note: <b>hi</b>\r\n\r\n`);
await new Promise((r) => setTimeout(r, 200));
console.log('plain refusal response:\n' + r1.replace(/\r\n/g, '\n'));
console.log('CONNECT refusal response:\n' + r2.replace(/\r\n/g, '\n'));
console.log('onFlowStart count', starts.length, JSON.stringify(starts.map((s) => ({ url: s.request.url, headers: s.request.headers }))));
console.log('onFlow count', flows.length, JSON.stringify(flows.map((f) => ({ url: f.request.url, headers: f.request.headers, error: f.error }))));
await proxy.close();

// writeRefusal(403)
const srv = net.createServer((s) => writeRefusal(s, 403, '대시보드 차단', '1.1 sumun'));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const out = await new Promise((ok) => { const c = net.connect(srv.address().port, '127.0.0.1'); let b = ''; c.on('data', (d) => (b += d)); c.on('close', () => ok(b)); });
console.log('writeRefusal(403) ->', JSON.stringify(out.split('\r\n')[0]), '| body', JSON.stringify(out.split('\r\n\r\n')[1]));
srv.close();
