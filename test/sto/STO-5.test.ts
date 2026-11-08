// [STO-5] STO 보고서 결정 2(R2)·7(R7)
//   R2: 바이트 상한은 먼저 들어온 "완료"부터 뺀다. 방금 넣은 것 말고 완료가 하나도 없는데도 넘칠 때만 진행 중을 뺀다
//       (사용자 답 2026-11-08 "완료 먼저, 그다음 진행 중"). 그래서 오래 걸리는 요청(큰 다운로드, SSE)이 바이트 때문에 사라지지 않는다
//   R7: 필터에 모르는 조건 이름(오타 등)이 있으면 조용히 무시하지 않고 고정 문구 TypeError
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/store.ts';
import { matchesFilter } from '../../src/store/filter.ts';

const MiB = 1_048_576;
const own = (n: number) => Buffer.allocUnsafeSlow(n).fill(0x61);
function flow(id: number, bodyLen = 4) {
  const body = own(bodyLen);
  return {
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 1,
    request: { method: 'GET', url: `http://example.test/${id}`, httpVersion: '1.1', headers: [['Host', 'example.test']] as [string, string][], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` }, body, bodySize: body.length, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [] as [string, string][], body: own(4), bodySize: 4, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  };
}
const start = (id: number) => ({ id, startedAt: 1_700_000_000_000 + id, request: { method: 'GET', url: `http://example.test/${id}`, httpVersion: '1.1', headers: [['Host', 'example.test']] as [string, string][], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` } } });
const states = (store: any) => store.list().map((s: any) => [s.id, s.state]);
function events(store: any) {
  const ev: string[] = [];
  store.subscribe((e: any) => void ev.push(e.type === 'evicted' ? `evicted:${e.ids.join(',')}` : `${e.type}:${e.summary?.id}`));
  return ev;
}

test('R2: 바이트 상한을 넘으면 먼저 시작한 진행 중보다 먼저 들어온 완료가 빠진다', () => {
  const store = createStore({ maxBytes: MiB });
  const ev = events(store);
  store.addStart(start(1)); // 오래 걸리는 요청(아직 진행 중)
  store.addFlow(flow(2, 600_000));
  store.addFlow(flow(3, 600_000)); // 합이 1MiB를 넘는다
  assert.deepEqual(states(store), [[1, 'pending'], [3, 'done']]);
  assert.deepEqual(ev, ['start:1', 'done:2', 'done:3', 'evicted:2'], '긍정 전제(O30): 상한에 걸려 무언가 빠졌다 — 빠진 것은 완료 2뿐');
  assert.ok(store.stats().bytes <= MiB, `bytes ${store.stats().bytes}`);
});

test('R2: 바이트 상한을 넘긴 뒤에도 남은 진행 중 요청이 끝나면 그 기록이 저장된다', () => {
  const store = createStore({ maxBytes: MiB });
  store.addStart(start(1));
  store.addFlow(flow(2, 600_000));
  store.addFlow(flow(3, 600_000));
  store.addFlow(flow(1));
  assert.deepEqual(states(store), [[1, 'done'], [3, 'done']]);
  assert.equal(store.get(1)?.id, 1, '끝난 요청의 상세가 있다');
  assert.equal(store.stats().pending, 0);
});

test('R7: 모르는 조건 이름이 있으면 list와 matchesFilter 모두 TypeError', () => {
  const store = createStore();
  store.addFlow(flow(1));
  const summary = store.list()[0];
  for (const bad of [{ hots: 'example.test' }, { host: 'example.test', Method: 'GET' }, { statuss: 200 }, { limit: 1, page: 2 }, { extra: undefined }]) {
    assert.throws(() => store.list(bad as any), TypeError, JSON.stringify(bad));
    assert.throws(() => matchesFilter(summary, bad), TypeError, JSON.stringify(bad));
  }
});

test('R7: 모르는 조건 이름 오류의 문구에는 그 이름과 값이 들어가지 않는다(고정 문구)', () => {
  const store = createStore();
  store.addFlow(flow(1));
  const check = (e: unknown) => {
    assert.ok(e instanceof TypeError, '오류 종류는 TypeError');
    assert.ok(!e.message.includes('SECRET'), `문구: ${e.message}`);
    assert.ok(!JSON.stringify(Object.entries(e)).includes('SECRET'), '오류 속성에도 없다');
    return true;
  };
  assert.throws(() => store.list({ 'SECRET-NAME': 'SECRET-VALUE' } as any), check);
  assert.throws(() => matchesFilter(store.list()[0], { 'SECRET-NAME': 'SECRET-VALUE' }), check);
});
