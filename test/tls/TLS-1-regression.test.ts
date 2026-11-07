// [TLS-1] 회귀: 터널을 켜도 지켜야 하고, 지금도 성립하는 것(red 대상 아님). 사례 번호는 docs/ai/tls1-cases.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { rawRequest } from '../prx/_raw.ts';

let proxy: Awaited<ReturnType<typeof startProxy>>;
let conns = 0;
let target: net.Server;
let T = 0;
before(async () => {
  target = net.createServer((s) => (conns++, s.destroy()));
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
  T = (target.address() as net.AddressInfo).port;
  proxy = await startProxy({ port: 0, tunnel: true } as Parameters<typeof startProxy>[0]);
});
after(async () => {
  await proxy.close();
  await new Promise<void>((r) => target.close(() => r()));
});

// E57: 요청줄 자체가 깨진 CONNECT는 Node 파서가 먼저 막는다
for (const [name, line] of [
  ['P6 대상 안의 공백', `CONNECT 127.0.0.1 :${0} HTTP/1.1`],
  ['P6 NUL', `CONNECT 127.0.0.1\x00:${0} HTTP/1.1`],
  ['P6 ESC', `CONNECT \x1b[2J127.0.0.1:${0} HTTP/1.1`],
] as const) {
  test(`${name}: 400이고 목적지에 연결하지 않는다`, async () => {
    const r = await rawRequest(proxy.port, `${line.replace(':0', `:${T}`)}\r\nHost: x\r\n\r\n`, 1000);
    assert.equal(r.status, 400);
    assert.equal(conns, 0);
  });
}
test('P9: 16KB가 넘는 CONNECT 요청은 431(Node)', async () => {
  const r = await rawRequest(proxy.port, `CONNECT ${'a'.repeat(20_000)}:443 HTTP/1.1\r\nHost: x\r\n\r\n`, 1500);
  assert.ok([431, 400, 0].includes(r.status), `상태 ${r.status}`);
  assert.equal(conns, 0);
});
test('Q6: 웹페이지가 보낼 수 있는 origin-form 요청(본문 안에 CONNECT 글자)은 400이고 본문을 해석하지 않는다', async () => {
  const body = `CONNECT 127.0.0.1:${T} HTTP/1.1\r\n\r\n`;
  const r = await rawRequest(proxy.port, `POST / HTTP/1.1\r\nHost: 127.0.0.1:${proxy.port}\r\nContent-Length: ${body.length}\r\n\r\n${body}`, 1000);
  assert.equal(r.status, 400);
  assert.equal(conns, 0);
});
