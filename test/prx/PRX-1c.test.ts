// [PRX-1c] 새 동작: 목적지 쪽·견고성 중 현재 구현이 못 하는 것 [확인됨: 2026-11-07 실측]
// 사례 번호는 docs/ai/prx1-cases.md. 이미 되는 사례는 PRX-1c-regression.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { rawRequest } from './_raw.ts';
import { setup } from './_prx1c-setup.ts';

const { ctx, alive, withRaw, get } = setup();

// Windows는 다른 프로세스가 0.0.0.0:P를 쓰는 중에도 127.0.0.1:P 바인딩을 허용한다 [확인됨: scripts/probe/prx1c-a9-b6.mjs]
test('A9: 다른 프로세스가 0.0.0.0:P를 쓰는 중이면 127.0.0.1:P로 시작하지 않는다(포트를 나눠 쓰지 않음)', async () => {
  const holder = spawn(process.execPath, ['-e', "require('net').createServer().listen(0,'0.0.0.0',function(){console.log(this.address().port)})"]);
  try {
    const P = Number(await new Promise<string>((r) => holder.stdout.once('data', (d) => r(String(d).trim()))));
    await assert.rejects(startProxy({ port: P }));
  } finally {
    holder.kill();
  }
});

// 실측: 0.0.0.0, localhost. 은 프록시 자신에게 되돌아오는데, 되돌아온 요청이 origin-form이라 400으로 막혔다(무한 반복은 없음).
// 루프라는 사실을 정확히 알려야 하므로 508이어야 한다.
for (const host of ['0.0.0.0', 'localhost.']) {
  test(`B2/B3: ${host}:<프록시 포트>는 자기 자신으로 되돌아오는 루프로 알려 준다(508)`, async () => {
    const r = await rawRequest(ctx.proxy.port, `GET http://${host}:${ctx.proxy.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, 2000);
    assert.equal(r.status, 508);
    await alive();
  });
}

test('B8: 목적지가 연결은 받았지만 응답하지 않으면 정해진 시간(upstreamTimeoutMs) 뒤 504', async () => {
  const r = await withRaw(() => {}, get(), 1500);
  assert.equal(r.status, 504);
  await alive();
});

test('D17: 헤더를 아주 느리게 보내면 정해진 시간(headersTimeoutMs) 뒤 408 또는 연결 종료', async () => {
  const r = await new Promise<{ status: number; closed: boolean }>((resolve) => {
    let raw = '';
    const s = net.connect(ctx.proxy.port, '127.0.0.1', () => s.write('GET http://x/ HTTP/1.1\r\nHost:'));
    const t = setTimeout(() => (s.destroy(), resolve({ status: 0, closed: false })), 3000);
    s.on('data', (c) => (raw += c));
    s.on('close', () => (clearTimeout(t), resolve({ status: Number(raw.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0), closed: true })));
    s.on('error', () => {});
  });
  assert.ok(r.closed, '3초 안에 연결을 정리해야 함');
  assert.ok(r.status === 408 || r.status === 0, `상태 ${r.status}`);
});

// 실측: 지금은 101을 받으면 클라이언트에 아무 응답도 보내지 않고 멈춘다(상태 0)
test('E7: 목적지가 101(프로토콜 전환)을 보내도 터널로 전환하지 않고 502', async () => {
  const r = await withRaw((s) => s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'), get());
  assert.equal(r.status, 502);
  await alive();
});
