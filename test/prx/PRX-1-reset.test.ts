// [PRX-1] 새 동작: 클라이언트가 연결을 강제로 끊어도(ECONNRESET) 프록시는 죽지 않는다.
// 실측에서 발견(2026-11-07): curl이 CONNECT의 501 응답을 받은 직후 연결을 리셋하자 프록시 프로세스가 종료됐다.
// 이 테스트는 프록시와 같은 프로세스에서 돈다. 처리되지 않은 소켓 오류가 나면 테스트 프로세스 자체가 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { startUpstream, viaProxy } from './_upstream.ts';

// CONNECT를 보내고, 응답 첫 바이트를 받자마자 RST로 끊는다(curl이 한 것과 같은 방식)
function connectThenReset(port: number): Promise<void> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));
    s.once('data', () => {
      s.resetAndDestroy();
      setTimeout(resolve, 200); // 프록시 쪽에서 오류가 처리될 시간을 준다
    });
    s.on('error', () => {});
  });
}

test('C18 견고성: CONNECT 응답 직후 클라이언트가 연결을 리셋해도 프록시는 계속 동작한다', async () => {
  const proxy = await startProxy({ port: 0 });
  const up = await startUpstream();
  try {
    await connectThenReset(proxy.port);
    await connectThenReset(proxy.port);
    const r = await viaProxy(proxy.port, { target: `http://127.0.0.1:${up.port}/after-reset` });
    assert.equal(r.status, 201, '리셋 뒤에도 정상 요청을 중계해야 함');
  } finally {
    await proxy.close();
    await up.close();
  }
});
