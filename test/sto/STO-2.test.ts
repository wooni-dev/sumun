// [STO-2] 보관 상한 (docs/ai/sto-cases.md 배정 "STO-2", 결정 S-1·S-2·S-5)
//   createStore({ maxBytes = 256MiB, maxFlows = 10_000, maxPending = 1_000 })
//   비용 = 저장된 본문(body.length) + 헤더 쌍마다 64 + 2×(이름+값 길이) + 고정 비용. 먼저 들어온 항목부터 뺀다. 방금 넣은 항목은 빼지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createStore } from '../../src/store/store.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const MiB = 1_048_576;

const own = (n: number, fill = 0x61) => Buffer.allocUnsafeSlow(n).fill(fill);
function flow(id: number, o: { body?: Buffer; resBody?: Buffer; bodySize?: number; headers?: [string, string][]; url?: string } = {}) {
  const body = o.body ?? own(4);
  const resBody = o.resBody ?? own(4);
  return {
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 1,
    request: { method: 'GET', url: o.url ?? `http://example.test/${id}`, httpVersion: '1.1', headers: o.headers ?? [['Host', 'example.test']], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` }, body, bodySize: o.bodySize ?? body.length, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [['Content-Type', 'text/plain']] as [string, string][], body: resBody, bodySize: resBody.length, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  };
}
const start = (id: number, url = `http://example.test/${id}`) => ({ id, startedAt: 1_700_000_000_000 + id, request: { method: 'GET', url, httpVersion: '1.1', headers: [['Host', 'example.test']] as [string, string][], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` } } });
const ids = (store: any) => store.list().map((s: any) => s.id);

test('S-1·A1: 기본 바이트 상한 256MiB — 요청·응답 각 1MiB 기록 300건(약 600MiB)을 넣으면 최근 것만 120~128건 남고 bytes는 256MiB 이하', () => {
  const store = createStore();
  const big = own(MiB); // 같은 Buffer를 나눠 써서 테스트 자체의 메모리는 작게. 저장소는 body.length로 센다
  for (let id = 1; id <= 300; id++) store.addFlow(flow(id, { body: big, resBody: big }));
  const kept = ids(store);
  assert.ok(kept.length >= 120 && kept.length <= 128, `남은 건수 ${kept.length}`);
  assert.deepEqual(kept, Array.from({ length: kept.length }, (_, i) => 300 - kept.length + 1 + i), '가장 최근 것들이 연속으로 남는다');
  assert.ok(store.stats().bytes <= 256 * MiB, `bytes ${store.stats().bytes}`);
  assert.ok(store.stats().bytes > 250 * MiB, `긍정 전제(O30): 상한 근처까지 채운다 — bytes ${store.stats().bytes}`);
});

test('S-1: 건수 상한(maxFlows) — 넘으면 먼저 들어온 완료부터 빠지고, 넣기마다 그 넣기의 알림 뒤에 evicted 알림', () => {
  const store = createStore({ maxFlows: 3 });
  const ev: string[] = [];
  store.subscribe((e: any) => void ev.push(e.type === 'evicted' ? `evicted:${e.ids.join(',')}` : `${e.type}:${e.summary?.id}`));
  for (let id = 1; id <= 5; id++) store.addFlow(flow(id));
  assert.deepEqual(ids(store), [3, 4, 5]);
  assert.deepEqual(ev, ['done:1', 'done:2', 'done:3', 'done:4', 'evicted:1', 'done:5', 'evicted:2']);
  assert.equal(store.get(1), undefined, '빠진 기록은 상세도 없다');
  assert.equal(store.stats().flows, 3);
});

test('A2: 바이트는 오간 크기(bodySize)가 아니라 저장된 본문(body.length)으로 센다', () => {
  const store = createStore({ maxBytes: MiB });
  for (let id = 1; id <= 10; id++) store.addFlow(flow(id, { body: own(10), bodySize: 2_000_000_000 }));
  assert.equal(ids(store).length, 10, 'bodySize 2GB라도 저장된 본문이 10바이트면 다 남는다');
  store.addFlow(flow(11, { body: own(MiB) }));
  assert.deepEqual(ids(store), [11], '긍정 전제(O30): 저장된 본문이 1MiB면 상한에 걸려 앞의 것이 모두 빠진다');
});

test('A3: 헤더 비용을 센다 — 헤더 3,000쌍(본문 없음) 기록은 1MiB 상한에 5건 넘게 들어가지 않는다', () => {
  const store = createStore({ maxBytes: MiB });
  const headers = Array.from({ length: 3000 }, (_, i) => [`X-H-${i}`, 'v'] as [string, string]);
  for (let id = 1; id <= 20; id++) store.addFlow(flow(id, { body: own(0), resBody: own(0), headers }));
  const n = ids(store).length;
  assert.ok(n >= 1 && n <= 5, `남은 건수 ${n}(헤더 3,000쌍은 힙에서 건당 약 222KB — sto-cases A3)`);
});

test('S-2·A5·S-5: 진행 중 상한(maxPending) — 먼저 시작한 진행 중부터 빠지고, 뺀 요청의 늦은 완료는 버린다', () => {
  const store = createStore({ maxPending: 3 });
  const ev: string[] = [];
  store.subscribe((e: any) => void ev.push(e.type === 'evicted' ? `evicted:${e.ids.join(',')}` : `${e.type}:${e.summary?.id}`));
  for (let id = 1; id <= 5; id++) store.addStart(start(id));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[3, 'pending'], [4, 'pending'], [5, 'pending']]);
  store.addFlow(flow(1));
  store.addFlow(flow(4));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[3, 'pending'], [4, 'done'], [5, 'pending']], '뺀 진행 중(1)의 완료는 버리고, 남은 진행 중(4)의 완료는 저장');
  assert.deepEqual(ev, ['start:1', 'start:2', 'start:3', 'start:4', 'evicted:1', 'start:5', 'evicted:2', 'done:4']);
  assert.equal(store.stats().pending, 2);
});

test('S-2: 진행 중도 바이트 상한에 들어간다 — 긴 url의 진행 중이 쌓이면 먼저 들어온 것부터 빠진다', () => {
  const store = createStore({ maxBytes: MiB });
  const longUrl = (id: number) => `http://example.test/${id}?${'q'.repeat(100_000)}`;
  for (let id = 1; id <= 20; id++) store.addStart(start(id, longUrl(id)));
  const n = ids(store).length;
  assert.ok(n >= 1 && n < 20, `남은 진행 중 ${n}(url 10만 자 × 20개는 1MiB를 넘는다)`);
  assert.equal(ids(store).at(-1), 20, '가장 최근 것은 남는다');
});

test('먼저 들어온 순서: 완료로 바뀐 항목은 시작 알림이 들어온 자리를 지킨다', () => {
  const store = createStore({ maxFlows: 2 });
  store.addStart(start(1));
  store.addFlow(flow(2));
  store.addFlow(flow(1)); // 1은 먼저 들어왔으므로 가장 오래된 항목
  store.addFlow(flow(3));
  assert.deepEqual(ids(store), [2, 3]);
});

test('방금 넣은 항목은 빼지 않는다 — 한 건이 상한보다 커도 마지막 하나는 남는다', () => {
  const store = createStore({ maxBytes: 1000 });
  store.addFlow(flow(1, { body: own(5000) }));
  assert.deepEqual(ids(store), [1]);
  store.addFlow(flow(2, { body: own(5000) }));
  assert.deepEqual(ids(store), [2]);
  assert.equal(store.get(2).request.body.length, 5000);
});

test('A6: 뺀 기록의 본문은 저장소가 붙잡지 않아 메모리가 실제로 풀린다', async () => {
  const store = createStore({ maxFlows: 1 });
  let body: Buffer | null = own(MiB);
  const ref = new WeakRef(body);
  store.addFlow(flow(1, { body }));
  body = null;
  store.list();
  store.get(1);
  store.addFlow(flow(2));
  assert.deepEqual(ids(store), [2], '긍정 전제(O30): 1이 빠졌다');
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
  assert.equal(ref.deref(), undefined, '뺀 기록의 본문이 풀려야 함');
});

test('clear()는 bytes를 0으로 되돌린다', () => {
  const store = createStore();
  store.addFlow(flow(1, { body: own(1000) }));
  assert.ok(store.stats().bytes >= 1000);
  store.clear();
  assert.equal(store.stats().bytes, 0);
});

test('옵션 검사: 상한은 양의 정수만 — 아니면 TypeError', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '10', null]) {
    for (const key of ['maxBytes', 'maxFlows', 'maxPending']) {
      assert.throws(() => createStore({ [key]: bad } as any), TypeError, `${key}: ${String(bad)}`);
    }
  }
  assert.throws(() => createStore('x' as any), TypeError);
  assert.doesNotThrow(() => createStore({ maxBytes: 1, maxFlows: 1, maxPending: 1 }));
});
