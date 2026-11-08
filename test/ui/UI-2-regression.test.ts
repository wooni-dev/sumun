// [UI-2] 회귀(구현 전에도 통과해야 정상, O9): 대시보드 차단이 막으면 안 되는 것. 사례: docs/ai/ui2-cases.md G3·G5·G7·G8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';

async function server(body: string) {
  const s = http.createServer((_q, r) => r.end(body));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { port: (s.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r()))) };
}
function raw(port: number, data: string, ms = 3000) {
  return new Promise<string>((resolve) => {
    let text = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    s.on('data', (c) => (text += c));
    s.on('close', () => resolve(text));
    s.on('error', () => {});
    s.setTimeout(ms, () => s.destroy());
  });
}
function connectLine(port: number, target: string) {
  return new Promise<string>((resolve) => {
    let buf = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const done = () => (s.destroy(), resolve(buf.split('\r\n')[0]));
    s.on('data', (c) => ((buf += c), buf.includes('\r\n') && done()));
    s.on('close', done);
    s.on('error', done);
    s.setTimeout(3000, done);
  });
}
const get = (url: string, host = 'x') => `GET ${url} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

test('dashboardPort를 주지 않으면 그 포트 번호는 일반 목적지다(G3·G5): 평문 200, CONNECT 200', async () => {
  const app = await server('APP');
  const proxy = await startProxy({ port: 0, tunnel: true });
  try {
    const r = await raw(proxy.port, get(`http://127.0.0.1:${app.port}/`));
    assert.equal(r.split('\r\n')[0], 'HTTP/1.1 200 OK');
    assert.ok(r.endsWith('APP'));
    assert.equal(await connectLine(proxy.port, `127.0.0.1:${app.port}`), 'HTTP/1.1 200 Connection Established');
  } finally {
    await proxy.close();
    await app.close();
  }
});

test('dashboardPort가 있어도 Host 헤더만 대시보드인 요청은 URL의 목적지로 간다(G7), 프록시 자기 포트는 508(G8)', async () => {
  const app = await server('APP');
  const dash = await server('DASH');
  const proxy = await startProxy({ port: 0, tunnel: true, dashboardPort: dash.port } as any);
  try {
    const r = await raw(proxy.port, get(`http://127.0.0.1:${app.port}/`, `127.0.0.1:${dash.port}`));
    assert.equal(r.split('\r\n')[0], 'HTTP/1.1 200 OK');
    assert.ok(r.endsWith('APP'));
    assert.equal((await raw(proxy.port, get(`http://127.0.0.1:${proxy.port}/`))).split('\r\n')[0], 'HTTP/1.1 508 Loop Detected');
    assert.equal(await connectLine(proxy.port, `127.0.0.1:${proxy.port}`), 'HTTP/1.1 508 Loop Detected');
  } finally {
    await proxy.close();
    await dash.close();
    await app.close();
  }
});
