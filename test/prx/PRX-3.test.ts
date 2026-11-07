// [PRX-3] 새 동작: Flow 모양 보완 — 시작 알림(onFlowStart), 목적지 칸(request.target), 본문 도중 타임아웃(upstreamBodyTimeoutMs),
// 실패 코드 bad-response. PRX 중간 확인 보고서 결정 2, 3, 4, 10.
//
//   onFlowStart(start)  요청을 받자마자 1번: { id, startedAt, request: { method, url, httpVersion, headers, target } }
//   onFlow(flow)        끝났을 때 1번(PRX-2와 같음). 같은 요청이면 start.id === flow.id
//   request.target      { scheme, host, port, path } — absolute-form을 해석한 값. 해석할 수 없으면 없음
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startProxy } from '../../src/proxy/server.ts';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';
import { startByteUpstream, send } from './_flow.ts';

type Got = { at: number; v: any };
const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; up: Awaited<ReturnType<typeof startByteUpstream>>; starts: Got[]; ends: Got[] };
let mark = { s: 0, e: 0 };
before(async () => {
  ctx.starts = [];
  ctx.ends = [];
  ctx.proxy = await startProxy({
    port: 0,
    upstreamTimeoutMs: 300,
    onFlowStart: (v: any) => void ctx.starts.push({ at: Date.now(), v }),
    onFlow: (v: any) => void ctx.ends.push({ at: Date.now(), v }),
  } as Parameters<typeof startProxy>[0]);
  ctx.up = await startByteUpstream();
});
after(async () => {
  await ctx.proxy.close();
  await ctx.up.close();
});
beforeEach(() => (mark = { s: ctx.starts.length, e: ctx.ends.length }));
const U = () => `127.0.0.1:${ctx.up.port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 이 테스트에서 생긴 시작 알림 s개와 끝 기록 e개를 기다린다. 시간 안에 못 받으면 assertion으로 실패한다
async function take(s: number, e: number, ms = 2000) {
  const until = Date.now() + ms;
  while ((ctx.starts.length - mark.s < s || ctx.ends.length - mark.e < e) && Date.now() < until) await sleep(20);
  assert.equal(ctx.starts.length - mark.s, s, `시작 알림 ${s}개를 기다렸지만 ${ctx.starts.length - mark.s}개`);
  assert.equal(ctx.ends.length - mark.e, e, `끝 기록 ${e}개를 기다렸지만 ${ctx.ends.length - mark.e}개`);
  return { starts: ctx.starts.slice(mark.s), ends: ctx.ends.slice(mark.e) };
}

// --- 결정 2: 시작 알림 ---
test('결정 2: 응답이 끝나기 전에 시작 알림이 오고, 끝 기록과 같은 id를 갖는다', async () => {
  const r = await send(ctx.proxy.port, { target: `http://${U()}/slow`, headers: { cookie: 'k=1' } }); // 목적지가 100ms 기다림
  const responded = Date.now();
  const { starts, ends } = await take(1, 1);
  const [s] = starts;
  assert.equal(r.status, 200);
  assert.ok(s.at < responded - 50, `시작 알림이 응답보다 먼저 와야 함 (차이 ${responded - s.at}ms)`);
  assert.equal(s.v.id, ends[0].v.id);
  assert.equal(s.v.request.method, 'GET');
  assert.equal(s.v.request.url, `http://${U()}/slow`);
  assert.ok(s.v.request.headers.some(([n, v]: [string, string]) => n === 'cookie' && v === 'k=1'));
  assert.equal(typeof s.v.startedAt, 'number');
  assert.equal(s.v.response, undefined);
  assert.equal(s.v.request.body, undefined, '시작 알림에는 본문이 없다');
});
test('결정 2: 프록시가 거절하는 요청(origin-form 400)도 시작 알림과 끝 기록이 한 쌍이다', async () => {
  await rawRequest(ctx.proxy.port, 'GET /x HTTP/1.1\r\nHost: x\r\n\r\n', 700);
  const { starts, ends } = await take(1, 1);
  assert.equal(starts[0].v.id, ends[0].v.id);
});
test('결정 2: onFlowStart가 함수가 아니면 시작하지 않는다', async () => {
  const started = startProxy({ port: 0, onFlowStart: 42 } as unknown as Parameters<typeof startProxy>[0]).then(async (p) => (await p.close(), 'started'));
  await assert.rejects(started, TypeError);
});

// --- 결정 3: 목적지 칸 ---
test('결정 3: absolute-form → target { scheme, host, port, path }(경로는 정규화하지 않은 원문, #조각 제외). 시작·끝 모두', async () => {
  await rawRequest(ctx.proxy.port, `GET http://${U()}/a/../b?x=1#f HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1000);
  const { starts, ends } = await take(1, 1);
  const want = { scheme: 'http', host: '127.0.0.1', port: ctx.up.port, path: '/a/../b?x=1' };
  assert.deepEqual(starts[0].v.request.target, want);
  assert.deepEqual(ends[0].v.request.target, want);
});
test('결정 3: https absolute-form(501)도 target을 남긴다 — 호스트는 소문자, 포트 생략 시 443', async () => {
  await rawRequest(ctx.proxy.port, 'GET https://Example.COM/x HTTP/1.1\r\nHost: x\r\n\r\n', 700);
  const { ends } = await take(1, 1);
  assert.deepEqual(ends[0].v.request.target, { scheme: 'https', host: 'example.com', port: 443, path: '/x' });
});
test('결정 3: http 포트를 생략하면 80', async () => {
  await rawRequest(ctx.proxy.port, 'GET http://sumun-test.invalid/p HTTP/1.1\r\nHost: x\r\n\r\n', 2500);
  const { ends } = await take(1, 1, 3000);
  assert.deepEqual(ends[0].v.request.target, { scheme: 'http', host: 'sumun-test.invalid', port: 80, path: '/p' });
});

// --- 결정 4: 본문 도중 타임아웃 ---
test('결정 4: 응답 헤더를 받은 뒤에는 upstreamTimeoutMs(300ms)보다 오래 쉬어도 끊지 않는다', async () => {
  const raw = await startRawUpstream((s) => {
    s.write('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\npart1');
    setTimeout(() => s.end('part2'), 600);
  });
  try {
    const r = await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 2000);
    assert.match(r.raw, /\r\n\r\npart1part2$/);
    const { ends } = await take(1, 1);
    assert.equal(ends[0].v.error, undefined);
    assert.equal(ends[0].v.response.bodySize, 10);
  } finally {
    await raw.close();
  }
});
test('결정 4: 응답 본문 도중에는 upstreamBodyTimeoutMs 동안 아무것도 오지 않으면 끊고 error { by: upstream, code: timeout }', async () => {
  const ends: any[] = [];
  const p = await startProxy({ port: 0, upstreamTimeoutMs: 5000, upstreamBodyTimeoutMs: 300, onFlow: (f: any) => void ends.push(f) } as Parameters<typeof startProxy>[0]);
  const raw = await startRawUpstream((s) => s.write('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\npart1'));
  try {
    await rawRequest(p.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, 1500);
    for (let i = 0; i < 50 && !ends.length; i++) await sleep(20);
    assert.equal(ends.length, 1, '1.5초 안에 끝 기록이 와야 함');
    assert.deepEqual(ends[0].error, { by: 'upstream', code: 'timeout' });
  } finally {
    await raw.close();
    await p.close();
  }
});

// --- 결정 10: bad-response ---
for (const [name, data] of [
  ['깨진 상태 줄', 'NOT HTTP\r\n\r\n'],
  ['응답 헤더 크기 초과', `HTTP/1.1 200 OK\r\n${'a:1\r\n'.repeat(10000)}\r\n`],
] as const) {
  test(`결정 10: ${name} → 502, error { by: upstream, code: bad-response, status: 502 } (연결 실패 unreachable과 구분)`, async () => {
    const raw = await startRawUpstream((s) => s.end(data));
    try {
      const r = await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, 1000);
      assert.equal(r.status, 502);
      const { ends } = await take(1, 1);
      assert.deepEqual(ends[0].v.error, { by: 'upstream', code: 'bad-response', status: 502 });
    } finally {
      await raw.close();
    }
  });
}
