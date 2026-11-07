// [PRX-3] 회귀(O30 긍정 전제): 출력 유출 테스트(PRX-2 F2·I1·I2, PRX-2b F3·F5)는 "자식 프록시의 출력에 표식이 없다"만 본다.
// 출력 수집이 고장 나도 그 assertion은 통과하므로, 수집이 실제로 작동한다는 것을 따로 확인한다. PRX-2 구현에서 이미 성립한다(red 대상 아님).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProxy } from '../../src/proxy/server.ts';
import { childProxy, send, startByteUpstream } from './_flow.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('O30: 구독자가 throw하면 자식 프록시의 stderr에 고정 문구가 나오고, 부모가 그것을 받는다(출력 수집이 작동함)', async () => {
  const up = await startByteUpstream();
  const c = await childProxy('throw');
  try {
    assert.equal((await send(c.port, { target: `http://127.0.0.1:${up.port}/x` })).status, 201);
    for (let i = 0; i < 100 && !c.state.out.includes('[sumun]'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(c.state.out, /\[sumun\] 기록 구독자에서 오류/);
    assert.equal(c.state.flows, 1, 'IPC로 센 구독자 호출 수도 작동해야 함');
  } finally {
    await c.stop();
    await up.close();
  }
});

// 구현 전에도 통과한다(onFlowStart를 아직 부르지 않으므로). 구현 뒤에도 지켜야 한다
test('결정 2: onFlowStart가 예외를 던져도 중계와 끝 기록은 그대로다', async () => {
  const up = await startByteUpstream();
  const ends: any[] = [];
  const p = await startProxy({ port: 0, onFlowStart: () => { throw new Error('boom'); }, onFlow: (f: any) => void ends.push(f) } as Parameters<typeof startProxy>[0]);
  try {
    for (let i = 0; i < 2; i++) assert.equal((await send(p.port, { target: `http://127.0.0.1:${up.port}/x` })).status, 201);
    for (let i = 0; i < 50 && ends.length < 2; i++) await sleep(20);
    assert.equal(ends.length, 2);
  } finally {
    await p.close();
    await up.close();
  }
});
