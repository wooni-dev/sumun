// [STO-1] 저장소 핵심: 진행 중 → 완료, 요약 알림, 상세 사본, 구독자 격리, 출력 안전 (docs/ai/sto-cases.md 배정 "STO-1")
//
// 프록시 없이 가짜 기록(Flow)과 시작 알림(FlowStart)을 직접 넣는다. 상한(STO-2)·필터(STO-3)·프록시 연결(STO-4)은 여기서 보지 않는다.
//   createStore() → { runId, addStart, addFlow, list(), get(id), subscribe(fn) → 해제, clear(), stats() }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import v8 from 'node:v8';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createStore } from '../../src/store/store.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const collect = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
};

const secret = () => `SUMUN-SECRET-${crypto.randomBytes(8).toString('hex')}`;
const own = (s: string | Buffer) => {
  const src = Buffer.isBuffer(s) ? s : Buffer.from(s);
  const b = Buffer.allocUnsafeSlow(src.length);
  src.copy(b);
  return b;
};

type Opt = { method?: string; url?: string; status?: number; error?: any; body?: string | Buffer; resBody?: string | Buffer; cookie?: string; tunnel?: any };
function start(id: number, o: Opt = {}) {
  const method = o.method ?? 'GET';
  const url = o.url ?? `http://example.test/p/${id}`;
  return {
    id,
    startedAt: 1_700_000_000_000 + id,
    request: { method, url, httpVersion: '1.1', headers: [['Host', 'example.test'], ['Cookie', o.cookie ?? 'k=v']] as [string, string][], target: method === 'CONNECT' ? undefined : { scheme: 'http' as const, host: 'example.test', port: 80, path: `/p/${id}` } },
  };
}
function flow(id: number, o: Opt = {}) {
  const s = start(id, o);
  const body = own(o.body ?? `req-${id}`);
  const resBody = own(o.resBody ?? `res-${id}`);
  return {
    id,
    startedAt: s.startedAt,
    durationMs: 12,
    request: { ...s.request, body, bodySize: body.length, bodyTruncated: false },
    ...(o.status === undefined && o.error ? {} : { response: { httpVersion: '1.1', headers: [['Content-Type', 'text/plain']] as [string, string][], body: resBody, bodySize: resBody.length, bodyTruncated: false, status: o.status ?? 200, statusMessage: 'OK' } }),
    ...(o.error ? { error: o.error } : {}),
    ...(o.tunnel ? { tunnel: o.tunnel } : {}),
  };
}
const collectEvents = (store: any) => {
  const ev: any[] = [];
  store.subscribe((e: any) => void ev.push(e));
  return ev;
};
const kinds = (ev: any[]) => ev.map((e) => (e.type === 'start' || e.type === 'done' ? `${e.type}:${e.summary.id}` : e.type === 'evicted' ? `evicted:${e.ids}` : e.type));

// 출력 감시: 테스트 동안 stdout·stderr·console에 쓴 것을 모은다
function watchOutput() {
  const out: string[] = [];
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  const cw = console.warn;
  const ce = console.error;
  const cl = console.log;
  (process.stdout as any).write = (c: any, ...r: any[]) => (out.push(String(c)), true);
  (process.stderr as any).write = (c: any, ...r: any[]) => (out.push(String(c)), true);
  console.warn = console.error = console.log = (...a: any[]) => void out.push(a.join(' '));
  return {
    out,
    stop: () => {
      (process.stdout as any).write = ow;
      (process.stderr as any).write = ew;
      console.warn = cw;
      console.error = ce;
      console.log = cl;
    },
  };
}

test('S-2·A4: 시작 알림은 진행 중 요약이 되고 완료가 오면 같은 id가 done으로 바뀐다. CONNECT 시작은 진행 중에 넣지 않고, CONNECT 완료(터널 요약)는 저장한다', () => {
  const store = createStore();
  const ev = collectEvents(store);
  store.addStart(start(1));
  store.addStart(start(2, { method: 'CONNECT', url: 'example.test:443' }));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[1, 'pending']]);
  assert.equal(store.list()[0].method, 'GET');
  store.addFlow(flow(1));
  store.addFlow(flow(3, { method: 'CONNECT', url: 'other.test:443', tunnel: { bytesUp: 10, bytesDown: 20, address: '127.0.0.1:443' } }));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[1, 'done'], [3, 'done']]);
  assert.deepEqual(kinds(ev), ['start:1', 'done:1', 'done:3']);
  assert.deepEqual(store.list()[1].tunnel, { bytesUp: 10, bytesDown: 20, address: '127.0.0.1:443' });
});

test('B1·B6: 시작 없이 온 완료도 저장하고, 완료 뒤 늦게 온 시작은 무시한다(done이 pending으로 되돌아가지 않음)', () => {
  const store = createStore();
  const ev = collectEvents(store);
  store.addFlow(flow(5));
  store.addStart(start(5));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[5, 'done']]);
  assert.deepEqual(kinds(ev), ['done:5']);
});

test('S-5·B5: clear() 뒤에는 그 전에 시작한 요청의 완료를 버린다. clear 뒤에 시작한 요청은 정상 저장', () => {
  const store = createStore();
  const ev = collectEvents(store);
  store.addStart(start(1));
  store.addFlow(flow(2));
  store.clear();
  assert.equal(store.list().length, 0);
  store.addFlow(flow(1));
  assert.equal(store.list().length, 0, 'clear 전에 시작한 요청의 늦은 완료는 버림');
  assert.equal(store.get(1), undefined);
  store.addStart(start(3));
  store.addFlow(flow(3));
  assert.deepEqual(store.list().map((s: any) => [s.id, s.state]), [[3, 'done']], '긍정 전제(O30): clear 뒤 요청은 저장됨');
  assert.deepEqual(kinds(ev), ['start:1', 'done:2', 'cleared', 'start:3', 'done:3']);
});

test('B8: 목록은 완료 순서와 상관없이 id 오름차순', () => {
  const store = createStore();
  for (const id of [1, 2, 3]) store.addStart(start(id));
  store.addFlow(flow(3));
  store.addFlow(flow(1));
  store.addFlow(flow(4));
  assert.deepEqual(store.list().map((s: any) => s.id), [1, 2, 3, 4]);
});

test('B4·S-9: runId는 저장소마다 다른 비어 있지 않은 문자열이고 모든 요약에 들어 있다', () => {
  const a = createStore();
  const b = createStore();
  assert.equal(typeof a.runId, 'string');
  assert.ok(a.runId.length >= 8);
  assert.notEqual(a.runId, b.runId);
  a.addStart(start(1));
  a.addFlow(flow(2));
  const ev = collectEvents(a);
  a.addFlow(flow(1));
  for (const s of a.list()) assert.equal(s.runId, a.runId);
  assert.equal(ev[0].summary.runId, a.runId);
});

test('S-3·S-4·D11·A9: 요약에는 본문·헤더가 없고, 상태 코드는 목적지 응답(upstream) 또는 프록시가 보낸 코드(proxy)', () => {
  const store = createStore();
  const ev = collectEvents(store);
  const mark = secret();
  const big = own(Buffer.alloc(1_048_576, 0x41));
  store.addFlow(flow(1, { body: big, resBody: `${mark}-body`, cookie: mark, status: 404 }));
  store.addFlow(flow(2, { error: { by: 'upstream', code: 'unreachable', status: 502 } }));
  store.addFlow(flow(3, { error: { by: 'client', code: 'aborted' } }));
  assert.equal(store.list().length, 3);
  const [s1, s2, s3] = store.list();
  assert.equal(s1.status, 404);
  assert.equal(s1.statusFrom, 'upstream');
  assert.equal(s1.method, 'GET');
  assert.equal(s1.url, 'http://example.test/p/1');
  assert.deepEqual(s1.target, { scheme: 'http', host: 'example.test', port: 80, path: '/p/1' });
  assert.equal(s1.requestSize, 1_048_576);
  assert.equal(s1.durationMs, 12);
  assert.equal(s2.status, 502);
  assert.equal(s2.statusFrom, 'proxy');
  assert.deepEqual(s2.error, { by: 'upstream', code: 'unreachable', status: 502 });
  assert.equal(s3.status, undefined);
  assert.equal(s3.statusFrom, undefined);
  for (const s of [...store.list(), ...ev.map((e) => e.summary)]) {
    assert.ok(!('request' in s) && !('response' in s) && !('headers' in s) && !('body' in s), `요약 칸: ${Object.keys(s)}`);
  }
  const json = JSON.stringify({ list: store.list(), ev });
  assert.ok(json.length < 10_000, `요약 JSON ${json.length}자`);
  assert.ok(!json.includes(mark), '요약·알림에 쿠키·본문 표식이 없다');
});

test('S-4·C9: list()와 알림의 요약은 매번 새 객체 — 고쳐도 저장소에 번지지 않는다', () => {
  const store = createStore();
  const seen: any[] = [];
  store.subscribe((e: any) => {
    e.summary.status = 999;
    e.summary.target.host = 'changed';
  });
  store.subscribe((e: any) => void seen.push(e));
  store.addFlow(flow(1));
  assert.equal(seen.length, 1, '긍정 전제(O30): 뒤 구독자도 알림을 받음');
  assert.equal(seen[0].summary.status, 200, '앞 구독자가 고친 요약이 뒤 구독자에게 번지지 않는다');
  assert.equal(seen[0].summary.target.host, 'example.test');
  const l = store.list();
  l[0].status = 1;
  assert.equal(store.list()[0].status, 200);
  assert.equal(store.list()[0].target.host, 'example.test');
});

test('C9·C10: get(id)는 본문까지 복사한 사본 — 고쳐도 저장된 기록은 그대로이고, 본문은 각자 자기 메모리(공유 풀 아님)', () => {
  const store = createStore();
  store.addFlow(flow(1, { body: 'abc', resBody: 'xyz' }));
  const d = store.get(1);
  assert.ok(d, '완료된 기록은 상세가 있다');
  assert.equal(d.request.body.toString(), 'abc');
  assert.equal(d.response.body.toString(), 'xyz');
  assert.equal(d.request.body.buffer.byteLength, d.request.body.length, '작은 본문도 공유 풀(8KB·64KB)이 아닌 자기 메모리');
  assert.equal(d.response.body.buffer.byteLength, d.response.body.length);
  d.request.body.fill(0x30);
  d.response.body.fill(0x30);
  d.request.headers.push(['X', '1']);
  d.request.headers[0][1] = 'changed';
  d.request.target.host = 'changed';
  d.response.status = 1;
  const e = store.get(1);
  assert.equal(e.request.body.toString(), 'abc');
  assert.equal(e.response.body.toString(), 'xyz');
  assert.deepEqual(e.request.headers, [['Host', 'example.test'], ['Cookie', 'k=v']]);
  assert.equal(e.request.target.host, 'example.test');
  assert.equal(e.response.status, 200);
  assert.notEqual(d.request.body.buffer, e.request.body.buffer);
  assert.equal(store.get(2), undefined);
  store.addStart(start(3));
  assert.equal(store.get(3), undefined, '진행 중인 요청은 상세가 없다(완료 전)');
});

test('A8: 완료가 오면 시작 알림의 요청(헤더 배열)을 붙잡지 않는다', async () => {
  const store = createStore();
  let s: any = start(1);
  const headers = new WeakRef(s.request.headers);
  store.addStart(s);
  s = null;
  store.addFlow(flow(1));
  assert.deepEqual(store.list().map((x: any) => x.state), ['done'], '긍정 전제(O30): 완료가 저장됨');
  await collect();
  assert.equal(headers.deref(), undefined, '시작 알림의 헤더 배열이 풀려야 함');
});

test('C2·S-10: 구독자 하나가 throw해도 다른 구독자는 알림을 받고, 저장은 되고, 아무것도 출력하지 않으며 오류 수만 센다', () => {
  const store = createStore();
  const mark = secret();
  const got: string[] = [];
  store.subscribe(() => {
    throw new Error(mark);
  });
  store.subscribe((e: any) => void got.push(`${e.type}:${e.summary?.id}`));
  const w = watchOutput();
  try {
    store.addFlow(flow(1));
    store.addFlow(flow(2));
  } finally {
    w.stop();
  }
  assert.deepEqual(got, ['done:1', 'done:2']);
  assert.equal(store.list().length, 2);
  assert.equal(store.stats().subscriberErrors, 2);
  assert.deepEqual(w.out, [], '출력 없음');
});

test('C3: 비동기 구독자가 reject해도 처리되지 않은 reject가 생기지 않고 오류 수만 센다', async () => {
  const store = createStore();
  const unhandled: unknown[] = [];
  const on = (r: unknown) => void unhandled.push(r);
  process.on('unhandledRejection', on);
  try {
    store.subscribe(async () => {
      throw new Error('async boom');
    });
    store.subscribe(() => Promise.reject(new Error('plain reject')));
    store.addFlow(flow(1));
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off('unhandledRejection', on);
  }
  assert.deepEqual(unhandled, []);
  assert.equal(store.stats().subscriberErrors, 2);
});

test('C4: 실패한 기록도 구독자가 없을 때 예외·출력 없이 저장된다(error 이벤트 없음)', () => {
  const store = createStore();
  const w = watchOutput();
  try {
    store.addFlow(flow(1, { error: { by: 'proxy', code: 'rejected', status: 400 } }));
  } finally {
    w.stop();
  }
  assert.deepEqual(store.list().map((s: any) => s.status), [400]);
  assert.deepEqual(w.out, []);
});

test('C5: 구독자 20개에도 경고 출력이 없고, 해제한 구독자는 저장소가 붙잡지 않는다', async () => {
  const store = createStore();
  const w = watchOutput();
  const offs: (() => void)[] = [];
  let count = 0;
  try {
    // 가로채는 동안에는 await하지 않는다(테스트 실행기의 결과 출력까지 가로채게 됨)
    for (let i = 0; i < 20; i++) offs.push(store.subscribe(() => void count++));
    store.addFlow(flow(1));
  } finally {
    w.stop();
  }
  assert.equal(count, 20);
  assert.deepEqual(w.out, []);
  let fn: any = () => {};
  const ref = new WeakRef(fn);
  const off = store.subscribe(fn);
  fn = null;
  off();
  off(); // 두 번 해제해도 괜찮다
  for (const o of offs) o();
  store.addFlow(flow(2));
  await collect();
  assert.equal(ref.deref(), undefined, '해제한 구독자 함수가 풀려야 함');
  assert.equal(count, 20, '해제 뒤에는 불리지 않음');
});

test('C6: 알림 중에 추가한 구독자는 다음 알림부터 받는다', () => {
  const store = createStore();
  let calls = 0;
  let added = 0;
  store.subscribe(() => {
    if (added < 1000) {
      added++;
      store.subscribe(() => void calls++);
    }
  });
  store.addFlow(flow(1));
  assert.equal(calls, 0, '같은 알림에서 새 구독자는 불리지 않는다');
  assert.equal(added, 1);
  store.addFlow(flow(2));
  assert.equal(calls, 1);
});

test('C7: 알림 중에 스스로 해제해도 다른 구독자는 그 알림을 받는다', () => {
  const store = createStore();
  const got: number[] = [];
  const offs: (() => void)[] = [];
  for (let i = 1; i <= 4; i++)
    offs.push(
      store.subscribe(() => {
        got.push(i);
        if (i === 1) offs[0]();
      }),
    );
  store.addFlow(flow(1));
  assert.deepEqual(got, [1, 2, 3, 4]);
  store.addFlow(flow(2));
  assert.deepEqual(got, [1, 2, 3, 4, 2, 3, 4]);
});

test('C8: 구독자가 알림 안에서 저장소를 다시 조작하면, 지금 알림이 모든 구독자에게 간 뒤에 다음 알림이 간다', () => {
  const store = createStore();
  const a: string[] = [];
  const b: string[] = [];
  store.subscribe((e: any) => {
    a.push(e.type === 'done' ? `done:${e.summary.id}` : e.type);
    if (e.type === 'done' && e.summary.id === 1) {
      store.clear();
      store.addFlow(flow(9));
    }
  });
  store.subscribe((e: any) => void b.push(e.type === 'done' ? `done:${e.summary.id}` : e.type));
  store.addFlow(flow(1));
  assert.deepEqual(a, ['done:1', 'cleared', 'done:9']);
  assert.deepEqual(b, ['done:1', 'cleared', 'done:9'], '두 번째 구독자도 같은 순서');
  assert.deepEqual(store.list().map((s: any) => s.id), [9]);
});

test('E1·E3·E5: 저장소를 util.inspect·String·JSON.stringify해도 기록 내용(쿠키·본문·url의 비밀번호)이 나오지 않는다', () => {
  const store = createStore();
  const mark = secret();
  store.addStart(start(1, { cookie: mark, url: `http://user:${mark}@example.test/a` }));
  store.addFlow(flow(2, { cookie: mark, body: mark, resBody: mark, url: `http://user:${mark}@example.test/b` }));
  assert.ok(store.list().some((s: any) => s.url.includes(mark)), '긍정 전제(O30): 요약 url에는 원문이 있다(S-4, 원본 기록 허용)');
  for (const text of [util.inspect(store, { depth: 10, showHidden: true }), String(store), JSON.stringify(store) ?? '', `${store}`]) {
    assert.ok(!text.includes(mark), `저장소 출력에 표식: ${text.slice(0, 200)}`);
  }
});

test('E2: 잘못된 입력은 고정 문구의 TypeError이고 문구에 입력 내용이 없다. 저장 상태는 그대로', () => {
  const store = createStore();
  store.addFlow(flow(1));
  const mark = secret();
  for (const bad of [null, undefined, 42, { id: 'x', request: { url: mark } }, { id: 1.5, request: { url: mark } }, { id: 2 }, { id: 3, request: null }]) {
    assert.throws(
      () => store.addFlow(bad as any),
      (e: any) => e instanceof TypeError && !String(e.message).includes(mark) && !util.inspect(e).includes(mark),
    );
    assert.throws(() => store.addStart(bad as any), (e: any) => e instanceof TypeError && !util.inspect(e).includes(mark));
  }
  assert.deepEqual(store.list().map((s: any) => s.id), [1]);
  assert.throws(() => store.subscribe('x' as any), TypeError);
  assert.equal(store.get('1' as any), undefined);
});
