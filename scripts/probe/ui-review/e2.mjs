// [UI-T] 검토 에이전트 실험(docs/ai/ui-cases.md E1~E9). 저장소 경로 인자가 없으면 이 파일 기준으로 찾는다
import http from 'node:http'; import net from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { startProxy } = await import(pathToFileURL((process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))) + '/src/proxy/server.ts').href);
const seen = [];
const dash = http.createServer((req, res) => { seen.push({ host: req.headers.host, via: req.headers.via ?? null }); res.end('SECRET'); });
await new Promise(r => dash.listen(0, '127.0.0.1', r));
const dp = dash.address().port;
const proxy = await startProxy({ port: 0, tunnel: true, onFlow: () => {} });
const out = await new Promise((ok) => {
  const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT 127.0.0.1:${dp} HTTP/1.1\r\nHost: 127.0.0.1:${dp}\r\n\r\n`));
  let buf = ''; let sent = false;
  s.on('data', (c) => { buf += c; if (!sent && buf.includes('\r\n\r\n')) { sent = true; s.write('GET /api HTTP/1.1\r\nHost: anything.evil\r\nConnection: close\r\n\r\n'); } });
  s.on('close', () => ok(buf.replace(/\r\n/g, ' / ')));
});
console.log('E8 opaque tunnel to dash ->', out.slice(0, 200));
console.log('E9 dash saw', JSON.stringify(seen));
await proxy.close(); dash.close();
