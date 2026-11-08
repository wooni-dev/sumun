// [UI-4] 실시간 통로 — 새 동작(구현 전에는 실패해야 정상). 사례: docs/ai/ui-cases.md U3·U32~U34·U36·U38, 결정 D-4·D-13, STO 보고서 결정 1
//   GET /api/events (Authorization: Bearer) → 200 text/event-stream
//     첫 메시지 data: {"type":"hello","runId":…}, 그 뒤 저장소 알림(start·done 요약, evicted, cleared)을 "id: <n>" + "data: <JSON>"으로, 하트비트 주석 ": …"
//   연결 상한(자리가 차면 503), 검사 뒤 수락, 느린 연결은 버퍼 상한에서 끊음, 저장소 알림은 큐에 넣고 바로 반환
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import { createEventHub } from '../../src/dashboard/events.ts';
import type { Flow, FlowStart } from '../../src/flow/flow.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (f()) return true;
    await sleep(10);
  }
  return f();
}

type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function req(port: number, urlPath: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error(`응답 없음: ${method} ${urlPath}`)));
    r.end(body);
  });
}
// 상태 코드만 보고 바로 끊는다(스트림이 열려도 기다리지 않음)
function statusOf(port: number, urlPath: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, headers, agent: false }, (res) => (resolve(res.statusCode!), r.destroy()));
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error('응답 없음')));
    r.end();
  });
}

// SSE 읽기: 빈 줄로 나뉜 메시지마다 { sseId, data }, 주석 줄(":")은 comments
type Stream = { status: number; headers: http.IncomingHttpHeaders; text: string; events: { sseId?: string; data: any }[]; comments: string[]; ended: boolean; close: () => void };
function sse(port: number, token: string, headers: Record<string, string> = {}, { pause = false } = {}): Stream {
  const s: Stream = { status: 0, headers: {}, text: '', events: [], comments: [], ended: false, close: () => {} };
  const r = http.request({ host: '127.0.0.1', port, path: '/api/events', headers: { authorization: `Bearer ${token}`, ...headers }, agent: false }, (res) => {
    s.status = res.statusCode!;
    s.headers = res.headers;
    res.on('close', () => (s.ended = true));
    if (pause) return void res.pause(); // 느린 구독자: 읽지 않는다
    res.setEncoding('utf8');
    let buf = '';
    let id: string | undefined;
    let data: string[] = [];
    res.on('data', (c: string) => {
      s.text += c;
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line === '') {
          if (data.length) {
            let v: any;
            try {
              v = JSON.parse(data.join('\n'));
            } catch {
              v = { unparsed: data.join('\n') };
            }
            s.events.push({ sseId: id, data: v });
          }
          id = undefined;
          data = [];
        } else if (line.startsWith(':')) s.comments.push(line);
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('id:')) id = line.slice(3).trim();
      }
    });
  });
  r.on('error', () => (s.ended = true));
  r.end();
  s.close = () => r.destroy();
  return s;
}
const types = (s: Stream) => s.events.map((e) => e.data?.type);
const hasHello = (s: Stream) => s.events.some((e) => e.data?.type === 'hello');
const sawUrl = (s: Stream, type: string, part: string) => s.events.some((e) => e.data?.type === type && String(e.data?.summary?.url).includes(part));

let nextId = 1;
function flow(o: { id?: number; method?: string; path?: string; reqBody?: Buffer; resBody?: Buffer; headers?: [string, string][] } = {}): Flow {
  const id = o.id ?? nextId++;
  const host = 'example.test';
  const path = o.path ?? `/p${id}`;
  const reqBody = o.reqBody ?? Buffer.alloc(0);
  const resBody = o.resBody ?? Buffer.from('ok');
  return {
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 5,
    request: { method: o.method ?? 'GET', url: `http://${host}${path}`, httpVersion: '1.1', headers: o.headers ?? [['Host', host]], target: { scheme: 'http', host, port: 80, path }, body: reqBody, bodySize: reqBody.length, bodyTruncated: false },
    response: { status: 200, statusMessage: 'OK', httpVersion: '1.1', headers: [['Content-Type', 'text/plain']], body: resBody, bodySize: resBody.length, bodyTruncated: false },
  };
}

type Dash = Awaited<ReturnType<typeof startDashboard>>;
async function withDash(opts: { store?: ReturnType<typeof createStore>; events?: Record<string, number> }, fn: (d: Dash, auth: Record<string, string>, store: ReturnType<typeof createStore>, open: (h?: Record<string, string>, o?: { pause?: boolean }) => Stream) => Promise<void>) {
  const store = opts.store ?? createStore();
  const d = await startDashboard({ store, port: 0, ...(opts.events ? { events: opts.events } : {}) } as Parameters<typeof startDashboard>[0]);
  const streams: Stream[] = [];
  const open = (h: Record<string, string> = {}, o: { pause?: boolean } = {}) => {
    const s = sse(d.port, d.token, h, o);
    streams.push(s);
    return s;
  };
  try {
    await fn(d, { authorization: `Bearer ${d.token}` }, store, open);
  } finally {
    for (const s of streams) s.close();
    await d.close();
  }
}

test('스트림: 200 text/event-stream(no-store·nosniff), 첫 메시지 hello(runId), 그 뒤 start·done 요약이 id가 늘어나는 순서로, 본문·쿠키 없음', async () => {
  await withDash({}, async (d, _auth, store, open) => {
    const s = open();
    assert.ok(await until(() => s.status !== 0), '응답 상태');
    assert.equal(s.status, 200);
    assert.match(String(s.headers['content-type']), /^text\/event-stream/);
    assert.match(String(s.headers['cache-control']), /no-store/);
    assert.equal(s.headers['x-content-type-options'], 'nosniff');
    assert.ok(await until(() => hasHello(s)), `hello: ${s.text.slice(0, 200)}`);
    assert.equal(s.events[0].data.type, 'hello', '첫 메시지는 hello');
    assert.equal(s.events[0].data.runId, store.runId);

    const id = nextId++;
    const start: FlowStart = { id, startedAt: 1_700_000_000_000, request: { method: 'POST', url: 'http://example.test/sse', httpVersion: '1.1', headers: [['Host', 'example.test'], ['Cookie', 'sid=SSE-COOKIE']], target: { scheme: 'http', host: 'example.test', port: 80, path: '/sse' } } };
    store.addStart(start);
    store.addFlow(flow({ id, method: 'POST', path: '/sse', headers: [['Host', 'example.test'], ['Cookie', 'sid=SSE-COOKIE']], reqBody: Buffer.from('SSE-BODY'), resBody: Buffer.from('SSE-RES') }));
    assert.ok(await until(() => sawUrl(s, 'done', '/sse')), `done: ${s.text.slice(0, 400)}`);
    assert.deepEqual(types(s), ['hello', 'start', 'done']);
    assert.equal(s.events[1].data.summary.id, id);
    assert.equal(s.events[2].data.summary.state, 'done');
    const ids = s.events.slice(1).map((e) => Number(e.sseId));
    assert.ok(ids.every((n) => Number.isSafeInteger(n)) && ids[0] < ids[1], `id 줄: ${ids}`);
    assert.ok(s.text.includes('/sse'), '긍정 전제(O30): 요약은 있다');
    for (const leak of ['SSE-COOKIE', 'SSE-BODY', 'SSE-RES']) assert.ok(!s.text.includes(leak), `알림에 ${leak} 없음`);
  });
});

test('evicted·cleared 알림도 그대로 온다(화면이 목록을 맞출 수 있게)', async () => {
  await withDash({ store: createStore({ maxFlows: 1 }) }, async (d, auth, store, open) => {
    const s = open();
    assert.ok(await until(() => hasHello(s)), `hello: ${s.text.slice(0, 200)}`);
    const a = flow();
    store.addFlow(a);
    store.addFlow(flow());
    assert.equal((await req(d.port, '/api/clear', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).status, 204);
    assert.ok(await until(() => types(s).includes('cleared')), `cleared: ${s.text.slice(0, 400)}`);
    assert.deepEqual(types(s), ['hello', 'done', 'done', 'evicted', 'cleared']);
    assert.deepEqual(s.events[3].data.ids, [a.id]);
  });
});

test('탭 두 개(F7): 두 스트림이 같은 알림을 받는다', async () => {
  await withDash({}, async (_d, _auth, store, open) => {
    const s1 = open();
    const s2 = open();
    assert.ok(await until(() => hasHello(s1) && hasHello(s2)), 'hello 둘');
    store.addFlow(flow({ path: '/both' }));
    assert.ok(await until(() => sawUrl(s1, 'done', '/both') && sawUrl(s2, 'done', '/both')), `둘 다: ${s1.text.slice(0, 200)} | ${s2.text.slice(0, 200)}`);
  });
});

test('연결 상한(U32, D-13): 자리가 차면 새 연결은 503 고정 문구(event-stream 아님), 하나를 닫으면 다시 받는다', async () => {
  await withDash({ events: { maxStreams: 2 } }, async (d, auth, _store, open) => {
    const s1 = open();
    const s2 = open();
    assert.ok(await until(() => hasHello(s1) && hasHello(s2)), 'hello 둘');
    const full = await req(d.port, '/api/events', { headers: auth });
    assert.equal(full.status, 503);
    assert.doesNotMatch(String(full.headers['content-type']), /event-stream/);
    assert.ok(full.body.length > 0, '고정 문구');
    assert.ok(!full.body.toString().includes(d.token), '문구에 토큰 없음');
    s1.close();
    let st = 0;
    for (let i = 0; i < 50 && st !== 200; i++) {
      st = await statusOf(d.port, '/api/events', auth);
      if (st !== 200) await sleep(20);
    }
    assert.equal(st, 200, '닫은 뒤 다시 받는다');
  });
});

test('검사 뒤 수락(U32): 토큰 없음·다른 Origin으로 거절된 요청은 자리를 쓰지 않는다', async () => {
  await withDash({ events: { maxStreams: 1 } }, async (d, auth, _store, open) => {
    for (let i = 0; i < 5; i++) assert.equal(await statusOf(d.port, '/api/events', {}), 401);
    for (let i = 0; i < 5; i++) assert.equal(await statusOf(d.port, '/api/events', { ...auth, origin: 'http://evil.example' }), 403);
    const s = open();
    assert.ok(await until(() => hasHello(s)), `거절 뒤에도 자리가 있다: ${s.status} ${s.text.slice(0, 200)}`);
    assert.equal(await statusOf(d.port, '/api/events', auth), 503, '긍정 전제(O30): 상한 1은 실제로 작동한다');
  });
});

test('GET만: POST·HEAD /api/events는 405 + Allow: GET', async () => {
  await withDash({}, async (d, auth) => {
    for (const method of ['POST', 'HEAD']) {
      const r = await req(d.port, '/api/events', { method, headers: { ...auth, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, 'GET', method);
    }
  });
});

test('느린 구독자(U33): 읽지 않는 연결은 버퍼가 상한을 넘으면 그 연결만 끊기고, 다른 연결은 계속 받는다', async () => {
  await withDash({ store: createStore({ maxFlows: 5 }), events: { maxStreams: 2, bufferBytes: 64 * 1024 } }, async (d, auth, store, open) => {
    const slow = open({}, { pause: true });
    const fast = open();
    assert.ok(await until(() => slow.status !== 0 && hasHello(fast)), `둘 다 열림: ${slow.status} ${fast.status}`);
    assert.equal(slow.status, 200);
    const big = 'x'.repeat(16 * 1024);
    let freed = false;
    for (let round = 0; round < 200 && !freed; round++) {
      for (let i = 0; i < 16; i++) store.addFlow(flow({ path: `/big?${big}` }));
      await sleep(10);
      freed = (await statusOf(d.port, '/api/events', auth)) === 200; // 느린 연결이 끊겨야 자리가 난다(상한 2)
    }
    assert.ok(freed, '느린 연결이 끊겨 자리가 났다');
    store.addFlow(flow({ path: '/last' }));
    assert.ok(await until(() => sawUrl(fast, 'done', '/last'), 5000), '빠른 연결은 계속 받는다');
    assert.equal(fast.ended, false, '빠른 연결은 끊기지 않았다');
  });
});

test('큐에 넣고 바로 반환(STO 결정 1, U38): 저장소 알림 중에는 쓰지 않고, 같은 차례의 알림을 연결마다 한 덩어리로 쓴다', async () => {
  // 가짜 응답: 허브가 쓰는 것(writeHead, write, end, destroy, on/once('close'), writableLength)만
  function fakeRes() {
    const handlers: (() => void)[] = [];
    const f = {
      writes: [] as string[],
      status: 0,
      writableLength: 0,
      ended: false,
      writeHead(s: number) {
        f.status = s;
        return f;
      },
      setHeader() {},
      flushHeaders() {},
      write(c: unknown) {
        f.writes.push(String(c));
        return true;
      },
      end(c?: unknown) {
        if (c !== undefined) f.writes.push(String(c));
        f.ended = true;
        return f;
      },
      destroy() {
        f.ended = true;
        f.fireClose();
        return f;
      },
      on(ev: string, fn: () => void) {
        if (ev === 'close') handlers.push(fn);
        return f;
      },
      once(ev: string, fn: () => void) {
        return f.on(ev, fn);
      },
      fireClose() {
        for (const h of handlers.splice(0)) h();
      },
    };
    return f;
  }
  const store = createStore();
  const hub = createEventHub(store, { heartbeatMs: 60_000 });
  const a = fakeRes();
  const b = fakeRes();
  try {
    assert.equal(hub.open(a as any), true);
    assert.equal(hub.open(b as any), true);
    assert.equal(a.status, 200);
    assert.ok(a.writes.join('').includes('"hello"'), '긍정 전제(O30): 열 때 hello를 쓴다');
    const base = a.writes.length;
    store.addFlow(flow({ path: '/q1' }));
    store.addFlow(flow({ path: '/q2' }));
    store.addFlow(flow({ path: '/q3' }));
    assert.equal(a.writes.length, base, '저장소 알림 중에는 쓰지 않는다(큐에 넣고 바로 반환)');
    await sleep(20);
    assert.equal(a.writes.length, base + 1, '같은 차례의 알림 셋은 한 번에 쓴다');
    const chunk = a.writes.at(-1)!;
    assert.equal((chunk.match(/^data: /gm) ?? []).length, 3, chunk.slice(0, 300));
    assert.ok(chunk.includes('/q1') && chunk.includes('/q3'));
    assert.equal(b.writes.at(-1), chunk, '연결마다 같은 덩어리');

    a.fireClose(); // 탭을 닫음
    const aCount = a.writes.length;
    store.addFlow(flow({ path: '/after-close' }));
    await sleep(20);
    assert.ok(b.writes.at(-1)!.includes('/after-close'), '긍정 전제(O30): 남은 연결은 받는다');
    assert.equal(a.writes.length, aCount, '닫은 연결에는 쓰지 않는다');
    assert.equal(hub.stats().streams, 1);
  } finally {
    hub.close();
  }
  assert.ok(b.ended, 'close()는 열린 연결을 끝낸다');
});

test('하트비트: heartbeatMs마다 주석 줄(:)을 보낸다(몇 시간 열어 둬도 끊김을 알 수 있게 — F8)', async () => {
  await withDash({ events: { heartbeatMs: 50 } }, async (_d, _auth, _store, open) => {
    const s = open();
    assert.ok(await until(() => hasHello(s)), 'hello');
    assert.ok(await until(() => s.comments.length >= 2, 2000), `주석 줄: ${JSON.stringify(s.text.slice(0, 200))}`);
  });
});

test('재연결(U34): 다시 열면 hello가 같은 runId로 오고, 끊긴 동안의 알림은 다시 보내지 않는다(목록 API로 맞춘다). 다른 실행은 runId가 다르다(F10)', async () => {
  await withDash({}, async (d, auth, store, open) => {
    const s1 = open();
    assert.ok(await until(() => hasHello(s1)), 'hello 1');
    s1.close();
    await sleep(50);
    store.addFlow(flow({ path: '/while-away' }));
    const s2 = open();
    assert.ok(await until(() => hasHello(s2)), 'hello 2');
    assert.equal(s2.events[0].data.runId, s1.events[0].data.runId);
    store.addFlow(flow({ path: '/after' }));
    assert.ok(await until(() => sawUrl(s2, 'done', '/after')), '긍정 전제(O30): 다시 연 뒤의 알림은 온다');
    assert.ok(!s2.text.includes('/while-away'), '끊긴 동안의 알림은 다시 보내지 않는다');
    const list = await req(d.port, '/api/flows', { headers: auth });
    assert.ok(list.body.toString().includes('/while-away'), '목록 API에는 있다');

    const other = await startDashboard({ store: createStore(), port: 0 });
    const s3 = sse(other.port, other.token);
    try {
      assert.ok(await until(() => hasHello(s3)), 'hello 3');
      assert.notEqual(s3.events[0].data.runId, s1.events[0].data.runId);
    } finally {
      s3.close();
      await other.close();
    }
  });
});

test('대시보드 close(): 열린 스트림이 있어도 1초 안에 끝나고 스트림도 끝난다', async () => {
  const store = createStore();
  const d = await startDashboard({ store, port: 0, events: { heartbeatMs: 60_000 } } as Parameters<typeof startDashboard>[0]);
  const s = sse(d.port, d.token);
  try {
    assert.ok(await until(() => hasHello(s)), `hello: ${s.status}`);
  } finally {
    const t0 = Date.now();
    await d.close();
    assert.ok(Date.now() - t0 < 1000, `close 시간 ${Date.now() - t0}ms`);
  }
  assert.ok(await until(() => s.ended, 1000), '스트림이 끝났다');
});
