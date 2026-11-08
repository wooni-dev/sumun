// [STO-3] 필터와 페이지 (docs/ai/sto-cases.md 배정 "STO-3", 결정 S-3·S-6·S-8)
//   store.list({ host?, method?, status?, after?, limit? }) — 모두 AND. matchesFilter(summary, filter)는 알림 하나에 같은 규칙을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/store.ts';
import { matchesFilter } from '../../src/store/filter.ts';

type T = { scheme: 'http' | 'https'; host: string; port: number; path: string } | undefined;
let nextId = 1;
function add(store: any, o: { method?: string; url?: string; target?: T; status?: number; error?: any; noResponse?: boolean }) {
  const id = nextId++;
  const body = Buffer.allocUnsafeSlow(0);
  store.addFlow({
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 1,
    request: { method: o.method ?? 'GET', url: o.url ?? `http://x/${id}`, httpVersion: '1.1', headers: [], ...(o.target ? { target: o.target } : {}), body, bodySize: 0, bodyTruncated: false },
    ...(o.noResponse ? {} : { response: { httpVersion: '1.1', headers: [], body, bodySize: 0, bodyTruncated: false, status: o.status ?? 200, statusMessage: '' } }),
    ...(o.error ? { error: o.error } : {}),
  });
  return id;
}
const t = (host: string, port = 80, scheme: 'http' | 'https' = 'http'): T => ({ scheme, host, port, path: '/' });
const ids = (l: any[]) => l.map((s) => s.id);

test('D1: target이 없는 기록은 호스트 조건에 걸리지 않고, 메서드·상태 조건은 그대로 쓴다(예외 없음)', () => {
  const store = createStore();
  const a = add(store, { url: '/x', noResponse: true, error: { by: 'proxy', code: 'rejected', status: 400 } });
  const b = add(store, { target: t('example.com') });
  assert.deepEqual(ids(store.list({ host: 'example.com' })), [b]);
  assert.deepEqual(ids(store.list({ status: 400 })), [a]);
  assert.deepEqual(ids(store.list({ method: 'get' })), [a, b]);
});

test('D2·S-6: 끝 점과 대소문자를 무시한다 — 평문 example.com., CONNECT example.com., 터널 안 example.com이 같은 필터에', () => {
  const store = createStore();
  const all = [add(store, { target: t('example.com.') }), add(store, { method: 'CONNECT', url: 'example.com.:443', target: t('example.com.', 443, 'https') }), add(store, { target: t('example.com', 443, 'https') })];
  add(store, { target: t('other.test') });
  for (const q of ['example.com', 'Example.COM.', 'EXAMPLE.com']) assert.deepEqual(ids(store.list({ host: q })), all, q);
});

test('D3: IPv6 표기 차이를 맞춘다(대괄호 있음·없음, 대소문자, ::ffff:127.0.0.1 = ::ffff:7f00:1)', () => {
  const store = createStore();
  const all = [add(store, { target: t('[::ffff:7f00:1]') }), add(store, { method: 'CONNECT', target: t('[::FFFF:7f00:1]', 443) }), add(store, { target: t('[::ffff:127.0.0.1]', 443) })];
  add(store, { target: t('[::1]') });
  for (const q of ['::ffff:127.0.0.1', '[::FFFF:7F00:1]', '[::ffff:7f00:1]']) assert.deepEqual(ids(store.list({ host: q })), all, q);
  assert.equal(store.list({ host: '[::1]' }).length, 1);
});

test('D4: 국제화 도메인 — 입력 bücher.de는 기록의 punycode xn--bcher-kva.de에 걸린다', () => {
  const store = createStore();
  const a = add(store, { target: t('xn--bcher-kva.de') });
  add(store, { target: t('bucher.de') });
  for (const q of ['bücher.de', 'BÜCHER.de', 'xn--bcher-kva.de']) assert.deepEqual(ids(store.list({ host: q })), [a], q);
});

test('D5: 필터 기준은 url이 아니라 target — url http://2130706433/의 target 127.0.0.1은 입력 2130706433·127.0.0.1에 걸린다', () => {
  const store = createStore();
  const a = add(store, { url: 'http://2130706433/', target: t('127.0.0.1') });
  add(store, { url: 'http://example.com/2130706433', target: t('example.com') });
  for (const q of ['2130706433', '127.0.0.1']) assert.deepEqual(ids(store.list({ host: q })), [a], q);
});

test('D6: host:port 입력이면 포트도 비교한다(기본 포트 80도 그대로). 포트가 없으면 포트를 보지 않는다', () => {
  const store = createStore();
  const p3000 = add(store, { target: t('localhost', 3000) });
  const p8080 = add(store, { target: t('localhost', 8080) });
  const p80 = add(store, { target: t('localhost', 80) });
  const v6 = add(store, { target: t('[::1]', 3000) });
  assert.deepEqual(ids(store.list({ host: 'localhost' })), [p3000, p8080, p80]);
  assert.deepEqual(ids(store.list({ host: 'localhost:3000' })), [p3000]);
  assert.deepEqual(ids(store.list({ host: 'localhost:80' })), [p80]);
  assert.deepEqual(ids(store.list({ host: '[::1]:3000' })), [v6]);
  assert.deepEqual(ids(store.list({ host: 'localhost:9' })), []);
});

test('S-6: 이름은 같은 호스트와 하위 도메인에 걸리고(badexample.com은 아님), IP는 정확히 같을 때만', () => {
  const store = createStore();
  const root = add(store, { target: t('example.com') });
  const sub = add(store, { target: t('api.example.com') });
  const deep = add(store, { target: t('a.b.example.com') });
  add(store, { target: t('badexample.com') });
  const ip = add(store, { target: t('127.0.0.1') });
  assert.deepEqual(ids(store.list({ host: 'example.com' })), [root, sub, deep]);
  assert.deepEqual(ids(store.list({ host: 'api.example.com' })), [sub]);
  assert.deepEqual(ids(store.list({ host: '0.0.1' })), [], 'IP 뒷부분으로는 걸리지 않음');
  assert.deepEqual(ids(store.list({ host: '127.0.0.1' })), [ip]);
});

test('D7·S-3: 상태 코드는 브라우저가 받은 코드 — 프록시가 만든 502도 걸리고, 상태 없는 기록은 걸리지 않고, 응답 200 + aborted는 200', () => {
  const store = createStore();
  const proxy502 = add(store, { noResponse: true, error: { by: 'upstream', code: 'unreachable', status: 502 } });
  const up502 = add(store, { status: 502 });
  const none = add(store, { noResponse: true, error: { by: 'client', code: 'aborted' } });
  const ok = add(store, { status: 200, error: { by: 'client', code: 'aborted' } });
  assert.deepEqual(ids(store.list({ status: 502 })), [proxy502, up502]);
  assert.deepEqual(ids(store.list({ status: 200 })), [ok]);
  assert.ok(!ids(store.list({ status: 0 } as any)).includes(none));
  assert.equal(store.list().length, 4, '긍정 전제(O30)');
});

test('D8·S-8: 메서드는 대소문자를 무시하고, CONNECT 기록도 고를 수 있다', () => {
  const store = createStore();
  const g = add(store, {});
  const p = add(store, { method: 'POST' });
  const c = add(store, { method: 'CONNECT', url: 'example.com:443', target: t('example.com', 443, 'https') });
  assert.deepEqual(ids(store.list({ method: 'get' })), [g]);
  assert.deepEqual(ids(store.list({ method: 'Post' })), [p]);
  assert.deepEqual(ids(store.list({ method: 'connect' })), [c]);
});

test('여러 조건은 AND, 빈 문자열·undefined는 조건 없음', () => {
  const store = createStore();
  const a = add(store, { method: 'POST', status: 201, target: t('api.example.com') });
  add(store, { method: 'POST', status: 500, target: t('api.example.com') });
  add(store, { method: 'GET', status: 201, target: t('api.example.com') });
  add(store, { method: 'POST', status: 201, target: t('other.test') });
  assert.deepEqual(ids(store.list({ host: 'example.com', method: 'post', status: 201 })), [a]);
  assert.equal(store.list({ host: '', method: '', status: undefined }).length, 4);
});

test('D9: 페이지는 after(마지막으로 본 id)와 limit — 사이에 오래된 것이 빠져도 건너뜀·중복이 없다', () => {
  const store = createStore({ maxFlows: 6 });
  const first = Array.from({ length: 6 }, () => add(store, {}));
  const p1 = store.list({ limit: 2 });
  assert.deepEqual(ids(p1), first.slice(0, 2));
  add(store, {}); // 가장 오래된 first[0]이 빠진다
  add(store, {}); // first[1]도 빠진다
  const p2 = store.list({ after: p1.at(-1).id, limit: 2 });
  assert.deepEqual(ids(p2), first.slice(2, 4), '오프셋 방식이면 2개를 건너뛴다');
  const p3 = store.list({ after: p2.at(-1).id, limit: 10 });
  assert.deepEqual(ids(p3), [first[4], first[5], first[5] + 1, first[5] + 2]);
  assert.deepEqual(ids(store.list({ after: p3.at(-1).id })), []);
});

test('D10: matchesFilter(요약, 조건)는 list(조건)와 같은 결과 — 대시보드가 새 알림 하나만 보고 판단할 수 있다', () => {
  const store = createStore();
  const seen: any[] = [];
  store.subscribe((e: any) => e.type === 'done' && seen.push(e.summary));
  add(store, { target: t('api.example.com'), status: 404 });
  add(store, { method: 'POST', target: t('[::ffff:7f00:1]') });
  add(store, { noResponse: true, error: { by: 'upstream', code: 'unreachable', status: 502 } });
  add(store, { method: 'CONNECT', target: t('example.com.', 443, 'https') });
  const filters = [{ host: 'example.com' }, { host: '::ffff:127.0.0.1' }, { method: 'post' }, { status: 502 }, { status: 404, host: 'EXAMPLE.com' }, { host: 'nothing.test' }, {}];
  for (const f of filters) {
    assert.deepEqual(ids(seen.filter((s) => matchesFilter(s, f))), ids(store.list(f)), JSON.stringify(f));
  }
  assert.ok(seen.filter((s) => matchesFilter(s, { host: 'example.com' })).length === 2, '긍정 전제(O30)');
});

test('해석할 수 없는 호스트 입력은 아무것도 걸리지 않는다(예외 없음 — 입력 중인 글자)', () => {
  const store = createStore();
  add(store, { target: t('example.com') });
  for (const q of ['x y', '[[::', 'exa mple', '%%%', ':80']) assert.deepEqual(store.list({ host: q }), [], q);
  assert.equal(store.list().length, 1, '긍정 전제(O30)');
});

test('잘못된 조건 타입은 고정 문구 TypeError', () => {
  const store = createStore();
  add(store, {});
  for (const bad of [{ method: 5 }, { host: 1 }, { status: '200' }, { status: 99 }, { status: 1000 }, { status: 200.5 }, { after: -1 }, { after: 1.5 }, { limit: 0 }, { limit: -2 }, { limit: '3' }, 'x', 5]) {
    assert.throws(() => store.list(bad as any), TypeError, JSON.stringify(bad));
    assert.throws(() => matchesFilter({ id: 1 } as any, bad as any), TypeError, JSON.stringify(bad));
  }
  assert.equal(store.list(undefined).length, 1);
});
