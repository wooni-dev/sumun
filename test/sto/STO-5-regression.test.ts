// [STO-5] 회귀(O9): 구현 전에도 통과해야 정상인 것
//   - 아는 조건 다섯 개(host·method·status·after·limit)와 빈 값, 상속된 속성은 지금처럼 받는다(R7 오류는 자기 속성의 모르는 이름에만)
//   - 바이트 상한: 방금 넣은 것 말고 남길 완료가 없으면 진행 중을 뺀다(사용자 답 "완료 먼저, 그다음 진행 중")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/store.ts';
import { matchesFilter } from '../../src/store/filter.ts';

const own = (n: number) => Buffer.allocUnsafeSlow(n).fill(0x61);
function flow(id: number, bodyLen = 4) {
  const body = own(bodyLen);
  return {
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 1,
    request: { method: 'GET', url: `http://example.test/${id}`, httpVersion: '1.1', headers: [] as [string, string][], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` }, body, bodySize: body.length, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [] as [string, string][], body: own(4), bodySize: 4, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  };
}
const start = (id: number) => ({ id, startedAt: 1_700_000_000_000 + id, request: { method: 'GET', url: `http://example.test/${id}`, httpVersion: '1.1', headers: [] as [string, string][], target: { scheme: 'http' as const, host: 'example.test', port: 80, path: `/${id}` } } });

test('아는 조건 다섯 개, 빈 값, 상속된 속성은 그대로 받는다', () => {
  const store = createStore();
  store.addFlow(flow(1));
  store.addFlow(flow(2));
  const all = { host: 'example.test', method: 'get', status: 200, after: 0, limit: 1 };
  assert.deepEqual(store.list(all).map((s: any) => s.id), [1]);
  assert.equal(matchesFilter(store.list()[1], all), true);
  assert.equal(store.list({ host: '', method: '' }).length, 2);
  assert.equal(store.list({ host: undefined, status: undefined }).length, 2);
  assert.equal(store.list(Object.create({ hots: 'x' })).length, 2, '상속된 속성은 조건으로 보지 않는다');
  assert.equal(store.list(null as any).length, 2);
});

test('남길 완료가 없으면 바이트 상한은 진행 중을 뺀다(방금 넣은 완료는 남는다)', () => {
  const store = createStore({ maxBytes: 10_000 });
  const ev: string[] = [];
  store.subscribe((e: any) => void ev.push(e.type === 'evicted' ? `evicted:${e.ids.join(',')}` : `${e.type}:${e.summary?.id}`));
  store.addStart(start(1));
  store.addFlow(flow(2, 50_000));
  assert.deepEqual(ev, ['start:1', 'done:2', 'evicted:1']);
  assert.deepEqual(store.list().map((s: any) => s.id), [2]);
});
