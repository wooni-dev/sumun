// 검토 실험(평문 기준 동작): 첫 요청은 느린 목적지(2.5초), 바로 뒤에 둘째 요청 헤더 반쪽을 파이프라이닝 — headersTimeoutMs=1000
import net from 'node:net'; import http from 'node:http';
import { startProxy } from '../../../src/proxy/server.ts';
const up = http.createServer((_q, r) => setTimeout(() => r.writeHead(200, { 'content-length': 2 }).end('ok'), 2500)); await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()));
const UP = (up.address() as net.AddressInfo).port;
const flows: any[] = [];
const p = await startProxy({ port: 0, headersTimeoutMs: 1000, onFlow: (f: any) => flows.push(f) } as any);
for (const half of [true, false]) {
  const s = net.connect(p.port, '127.0.0.1'); s.on('error', () => {}); let got = ''; s.on('data', (d) => (got += d));
  const t0 = Date.now(); let closed: number | null = null; s.once('close', () => (closed = Date.now() - t0));
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.write(`GET http://127.0.0.1:${UP}/a HTTP/1.1\r\nHost: x\r\n\r\n` + (half ? 'GET /b HTTP/1.1\r\nHo' : ''));
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`둘째 반쪽=${half}: 닫힘 ${closed}ms, 응답 ${JSON.stringify([...got.matchAll(/HTTP\/1\.1 (\d+)/g)].map((m) => m[1]))}`);
  s.destroy();
}
await new Promise((r) => setTimeout(r, 200));
console.log('flows:', JSON.stringify(flows.map((f) => ({ u: f.request.url, st: f.response?.status, err: f.error }))));
await p.close(); up.close(); process.exit(0);
