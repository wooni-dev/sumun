// [STO-4] 프록시 연결 (docs/ai/sto-cases.md 배정 "STO-4", 결정 S-7)
//   attachStore(store) → { onFlowStart, onFlow } — startProxy 옵션에 그대로 펼친다. 같은 저장소에 두 번은 거부
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import util from 'node:util';
import { startProxy } from '../../src/proxy/server.ts';
import { createStore } from '../../src/store/store.ts';
import { attachStore } from '../../src/store/attach.ts';

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};
async function upstream(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}
// 프록시를 거쳐 평문 GET. 응답 본문(실패하면 오류 이름)
const viaProxy = (proxyPort: number, url: string, headers: Record<string, string> = {}) =>
  new Promise<string>((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers, agent: false }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(`${res.statusCode} ${b}`));
      res.on('error', () => resolve('error'));
    });
    req.on('error', (e) => resolve(`error ${e.name}`));
    req.end();
  });

test('B2: attachStore는 시작·끝 콜백 두 개를 함께 돌려주고, 저장소에 그대로 넣는다', () => {
  const store = createStore();
  const hooks = attachStore(store);
  assert.equal(typeof hooks.onFlowStart, 'function');
  assert.equal(typeof hooks.onFlow, 'function');
  const body = Buffer.allocUnsafeSlow(0);
  hooks.onFlowStart({ id: 1, startedAt: 1, request: { method: 'GET', url: 'http://a.test/', httpVersion: '1.1', headers: [] } } as any);
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[1, 'pending']]);
  hooks.onFlow({ id: 1, startedAt: 1, durationMs: 1, request: { method: 'GET', url: 'http://a.test/', httpVersion: '1.1', headers: [], body, bodySize: 0, bodyTruncated: false } } as any);
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[1, 'done']]);
});

test('S-7·B3·F2: 같은 저장소를 두 번 연결하면 고정 문구 오류 — 프록시 둘의 id(각자 1부터)가 섞이지 않게. 다른 저장소는 따로 연결된다', () => {
  const a = createStore();
  attachStore(a);
  assert.throws(() => attachStore(a), (e: any) => e instanceof Error && /이미/.test(e.message) && !util.inspect(e).includes(a.runId));
  const b = createStore();
  assert.doesNotThrow(() => attachStore(b));
  assert.throws(() => attachStore({} as any), TypeError, '저장소가 아닌 것');
  assert.throws(() => attachStore(undefined as any), TypeError);
});

test('B2: 실제 프록시에 연결하면 요청 하나가 start → done 알림과 완료 기록 1건이 된다', async () => {
  const up = await upstream((req, res) => (req.resume(), req.on('end', () => res.end('hi'))));
  const store = createStore();
  const ev: string[] = [];
  store.subscribe((e: any) => void ev.push(`${e.type}:${e.summary?.id}`));
  const proxy = await startProxy({ port: 0, ...attachStore(store) });
  try {
    assert.equal(await viaProxy(proxy.port, `http://127.0.0.1:${up.port}/x?y=1`), '200 hi');
    await until(() => store.list().some((s: any) => s.state === 'done'));
    const l = store.list();
    assert.equal(l.length, 1);
    assert.equal(l[0].state, 'done');
    assert.equal(l[0].url, `http://127.0.0.1:${up.port}/x?y=1`);
    assert.equal(l[0].status, 200);
    assert.deepEqual(ev, [`start:${l[0].id}`, `done:${l[0].id}`]);
    assert.equal(store.get(l[0].id).response.body.toString(), 'hi');
  } finally {
    await proxy.close();
    await up.close();
  }
});

test('B7·F1: 프록시 close 뒤에 도착한 기록(진행 중이던 요청의 aborted)도 보통 기록처럼 저장되고, 예외·구독자 오류가 없다', async () => {
  const up = await upstream(() => {}); // 응답하지 않는 목적지
  const store = createStore();
  const unhandled: unknown[] = [];
  const onU = (r: unknown) => void unhandled.push(r);
  process.on('unhandledRejection', onU);
  const proxy = await startProxy({ port: 0, ...attachStore(store) });
  let closed = false;
  try {
    const pending = viaProxy(proxy.port, `http://127.0.0.1:${up.port}/slow`);
    await until(() => store.list().some((s: any) => s.state === 'pending'));
    assert.deepEqual(store.list().map((s: any) => s.state), ['pending'], '긍정 전제(O30): 진행 중이 보인다');
    const id = store.list()[0].id;
    closed = true;
    await proxy.close();
    await pending;
    await until(() => store.list()[0]?.state === 'done');
    const s = store.list()[0];
    assert.equal(s.id, id);
    assert.equal(s.state, 'done', 'close 뒤 도착한 완료가 저장됨');
    assert.ok(s.error, `실패 원인이 있다: ${JSON.stringify(s)}`);
    assert.equal(store.stats().subscriberErrors, 0);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onU);
    if (!closed) await proxy.close(); // 앞에서 실패해도 프록시를 닫는다(응답 없는 목적지 연결이 남아 실행이 끝나지 않음)
    await up.close();
  }
});
