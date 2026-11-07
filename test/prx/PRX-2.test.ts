// [PRX-2] 새 동작: 프록시가 처리한 요청마다 기록(Flow) 하나를 구독자(onFlow)에게 넘긴다.
// 사례 번호는 docs/ai/prx2-cases.md. 구현 전에도 통과하는 사례는 PRX-2-regression.test.ts.
//
// 기대하는 Flow 형태:
//   { id, startedAt, durationMs,
//     request:  { method, url, httpVersion, headers: [이름, 값][], body: Buffer, bodySize, bodyTruncated },
//     response?: { status, statusMessage, httpVersion, headers, body, bodySize, bodyTruncated }   ← 목적지가 보낸 것만
//     error?:    { by: 'proxy' | 'client' | 'upstream', code, status? } }                        ← status = 프록시가 직접 보낸 응답 코드
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { FLOW_BODY_LIMIT, createBodyCapture, headerPairs } from '../../src/flow/flow.ts';
import { closedPort } from './_upstream.ts';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';
import { recordingSetup, send, secret, sha, pattern, header, childProxy } from './_flow.ts';

const { ctx, take, U } = recordingSetup();
const L = FLOW_BODY_LIMIT;

// --- 기록 단위 함수 ---
test('createBodyCapture: 한도를 넘는 청크는 경계에서 잘라 앞부분만 남기고, 전체 크기와 잘림을 알려 준다(H2)', () => {
  const c = createBodyCapture(10);
  for (const s of ['abcd', 'efgh', 'ijkl']) c.push(Buffer.from(s));
  const r = c.result();
  assert.equal(r.body.toString(), 'abcdefghij');
  assert.equal(r.size, 12);
  assert.equal(r.truncated, true);
});
test('createBodyCapture: 정확히 한도만큼이면 잘림이 아니다(H2)', () => {
  const c = createBodyCapture(8);
  c.push(Buffer.from('abcd'));
  c.push(Buffer.from('efgh'));
  assert.deepEqual([c.result().body.toString(), c.result().size, c.result().truncated], ['abcdefgh', 8, false]);
});
test('createBodyCapture: 글자가 아니라 바이트 기준으로 자른다(H3: 한글 3바이트가 경계에 걸림)', () => {
  const src = Buffer.from('가나다'); // 9바이트
  const c = createBodyCapture(4);
  c.push(src);
  assert.deepEqual(c.result().body, src.subarray(0, 4));
  assert.equal(c.result().size, 9);
});
test('createBodyCapture: 기록은 넘겨받은 청크와 메모리를 공유하지 않고, 8KB 공유 풀의 일부도 아니다(F9, I4)', () => {
  const chunk = Buffer.from('secret-bytes');
  const c = createBodyCapture(100);
  c.push(chunk);
  chunk.fill(0x58); // 중계 쪽 청크가 나중에 바뀌어도
  const { body } = c.result();
  assert.equal(body.toString(), 'secret-bytes', '기록이 바뀌면 안 됨');
  assert.equal(body.byteOffset, 0);
  assert.equal(body.buffer.byteLength, body.length, '다른 연결의 바이트가 같은 ArrayBuffer에 있으면 안 됨');
});
test('headerPairs: rawHeaders 평면 배열을 [이름, 값] 쌍으로 바꾼다(순서·대소문자·중복 보존)', () => {
  assert.deepEqual(headerPairs(['A', '1', 'a', '2', 'Set-Cookie', 'x']), [['A', '1'], ['a', '2'], ['Set-Cookie', 'x']]);
});

// --- 기본 ---
test('정상 요청 하나 → 기록 하나: 메서드, 받은 URL, 버전, 상태, 본문, 시각, 소요 시간', async () => {
  const t0 = Date.now();
  const r = await send(ctx.proxy.port, { target: `http://${U()}/hello?q=1` });
  assert.equal(r.status, 201);
  const [f] = await take(1);
  assert.equal(f.request.method, 'GET');
  assert.equal(f.request.url, `http://${U()}/hello?q=1`);
  assert.equal(f.request.httpVersion, '1.1');
  assert.equal(f.response.status, 201);
  assert.equal(f.response.statusMessage, 'Created');
  assert.equal(f.response.body.toString(), 'from-upstream');
  assert.equal(f.error, undefined);
  assert.equal(typeof f.id, 'number');
  assert.ok(f.startedAt >= t0 && f.startedAt <= Date.now(), `startedAt ${f.startedAt}`);
  assert.ok(Number.isFinite(f.durationMs) && f.durationMs >= 0, `durationMs ${f.durationMs}`);
});
test('기록마다 id가 다르다', async () => {
  await send(ctx.proxy.port, { target: `http://${U()}/a` });
  await send(ctx.proxy.port, { target: `http://${U()}/b` });
  const [a, b] = await take(2);
  assert.notEqual(a.id, b.id);
});

// --- H. 정확성 ---
test('H1: 바이너리·깨진 UTF-8 본문을 바이트 그대로 기록한다(요청·응답)', async () => {
  const body = Buffer.concat([pattern(1024), Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0x00])]);
  await send(ctx.proxy.port, { target: `http://${U()}/echo`, method: 'POST', body });
  const [f] = await take(1);
  assert.ok(Buffer.isBuffer(f.request.body));
  assert.deepEqual(f.request.body, body);
  assert.deepEqual(f.response.body, body);
});
for (const n of [L - 1, L, L + 1]) {
  test(`H2/H4: 본문 ${n}바이트(chunked, 청크 경계가 한도와 안 맞음) → 기록은 앞 ${Math.min(n, L)}바이트, 중계는 전체`, async () => {
    const body = pattern(n);
    const chunks = [];
    for (let i = 0; i < n; i += 300_000) chunks.push(body.subarray(i, i + 300_000));
    const r = await send(ctx.proxy.port, { target: `http://${U()}/echo`, method: 'POST', chunks });
    assert.equal(sha(r.body), sha(body), '클라이언트는 전체를 받아야 함');
    assert.equal(sha(ctx.up.got.at(-1)!.body), sha(body), '목적지는 전체를 받아야 함');
    const [f] = await take(1);
    for (const side of [f.request, f.response]) {
      assert.equal(side.body.length, Math.min(n, L));
      assert.deepEqual(side.body, body.subarray(0, L));
      assert.equal(side.bodySize, n);
      assert.equal(side.bodyTruncated, n > L);
    }
  });
}
test('H4: chunked 응답은 디코딩된 본문으로 기록한다(결정 D2), 헤더는 목적지가 보낸 그대로', async () => {
  const body = pattern(200_000);
  await send(ctx.proxy.port, { target: `http://${U()}/echo-chunked`, method: 'POST', body });
  const [f] = await take(1);
  assert.deepEqual(f.response.body, body);
  assert.deepEqual(header(f.response.headers, 'transfer-encoding'), ['chunked']);
});
test('H5: 요청 헤더를 클라이언트가 보낸 순서·대소문자·중복 그대로 기록한다', async () => {
  const hostLine = `127.0.0.1:${ctx.up.port}`;
  await rawRequest(ctx.proxy.port, `GET http://${U()}/ HTTP/1.1\r\nHost: ${hostLine}\r\nX-A: 1\r\nCookie: c=1\r\nx-a: 2\r\nConnection: close\r\n\r\n`, 1000);
  const [f] = await take(1);
  assert.deepEqual(f.request.headers, [['Host', hostLine], ['X-A', '1'], ['Cookie', 'c=1'], ['x-a', '2'], ['Connection', 'close']]);
});
test('H5: 응답 헤더를 목적지가 보낸 순서·대소문자·중복 그대로 기록한다(Set-Cookie 3개)', async () => {
  const raw = await startRawUpstream((s) =>
    s.end('HTTP/1.1 200 OK\r\nSet-Cookie: a=1\r\nX-B: 1\r\nset-cookie: b=2\r\nx-b: 2\r\nSet-Cookie: c=3\r\nContent-Length: 2\r\n\r\nok'),
  );
  try {
    await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1000);
    const [f] = await take(1);
    assert.deepEqual(f.response.headers, [['Set-Cookie', 'a=1'], ['X-B', '1'], ['set-cookie', 'b=2'], ['x-b', '2'], ['Set-Cookie', 'c=3'], ['Content-Length', '2']]);
  } finally {
    await raw.close();
  }
});
test('H7: 받은 URL을 정규화하지 않고 원문 그대로 기록한다(대문자 scheme, .., %41, #조각)', async () => {
  const target = `HTTP://${U()}/a/../b?x=%41#f`;
  await rawRequest(ctx.proxy.port, `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1000);
  const [f] = await take(1);
  assert.equal(f.request.url, target);
});
for (const [line, status, msg, ver] of [
  ['HTTP/1.1 200 Totally Fine', 200, 'Totally Fine', '1.1'],
  ['HTTP/1.1 200 ', 200, '', '1.1'],
  ['HTTP/1.0 404 Nope', 404, 'Nope', '1.0'],
] as const) {
  test(`H8: 상태 줄 "${line}" → 상태 ${status}, 문구 "${msg}", 버전 ${ver}를 목적지가 보낸 그대로 기록`, async () => {
    const raw = await startRawUpstream((s) => s.end(`${line}\r\nContent-Length: 2\r\n\r\nok`));
    try {
      await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1000);
      const [f] = await take(1);
      assert.deepEqual([f.response.status, f.response.statusMessage, f.response.httpVersion], [status, msg, ver]);
    } finally {
      await raw.close();
    }
  });
}
test('H9: hop-by-hop 헤더는 목적지에 넘기지 않지만, 기록에는 클라이언트가 보낸 원문이 남는다', async () => {
  await rawRequest(ctx.proxy.port, `GET http://${U()}/ HTTP/1.1\r\nHost: x\r\nConnection: x-secret\r\nX-Secret: v\r\nProxy-Connection: keep-alive\r\n\r\n`, 1000);
  const [f] = await take(1);
  assert.deepEqual(f.request.headers, [['Host', 'x'], ['Connection', 'x-secret'], ['X-Secret', 'v'], ['Proxy-Connection', 'keep-alive']]);
  assert.equal(ctx.up.got.at(-1)!.headers['x-secret'], undefined);
});
test('H10/I5: 클라이언트가 요청 본문 도중에 끊으면 기록 1번, 실패 = 클라이언트 중단, 받은 만큼의 본문(잘림과 구분)', async () => {
  await new Promise<void>((resolve) => {
    const s = net.connect(ctx.proxy.port, '127.0.0.1', () => {
      s.write(`POST http://${U()}/echo HTTP/1.1\r\nHost: x\r\nContent-Length: 1000000\r\n\r\n`);
      s.write(pattern(512_000), () => setTimeout(() => (s.destroy(), resolve()), 200));
    });
    s.on('error', () => {});
  });
  const [f] = await take(1);
  assert.equal(f.error?.by, 'client');
  assert.equal(f.error?.code, 'aborted');
  assert.equal(f.request.bodySize, 512_000);
  assert.equal(f.request.bodyTruncated, false);
  assert.equal(f.response, undefined);
});
test('H11/I5: 목적지가 응답 본문 도중에 끊으면 상태·헤더는 기록하고, 실패 = 목적지 중단, 부분 본문', async () => {
  const raw = await startRawUpstream((s) => (s.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n' + 'x'.repeat(500)), setTimeout(() => s.destroy(), 50)));
  try {
    await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, 1000);
    const [f] = await take(1);
    assert.equal(f.response.status, 200);
    assert.equal(f.response.bodySize, 500);
    assert.deepEqual([f.error?.by, f.error?.code], ['upstream', 'aborted']);
  } finally {
    await raw.close();
  }
});

// H12: 프록시가 직접 만든 응답은 response 칸에 넣지 않는다. 목적지가 504를 보낸 것과 프록시가 504를 낸 것을 구분하기 위해서다.
const rejected: [string, () => Promise<{ data: string; close?: () => Promise<void> }>, { by: string; code: string; status: number }][] = [
  ['origin-form → 400', async () => ({ data: 'GET /x HTTP/1.1\r\nHost: x\r\n\r\n' }), { by: 'proxy', code: 'rejected', status: 400 }],
  ['https absolute-form → 501', async () => ({ data: 'GET https://127.0.0.1:1/ HTTP/1.1\r\nHost: x\r\n\r\n' }), { by: 'proxy', code: 'rejected', status: 501 }],
  ['자기 자신 → 508', async () => ({ data: `GET http://127.0.0.1:${ctx.proxy.port}/ HTTP/1.1\r\nHost: x\r\n\r\n` }), { by: 'proxy', code: 'loop', status: 508 }],
  ['닫힌 포트 → 502', async () => ({ data: `GET http://127.0.0.1:${await closedPort()}/ HTTP/1.1\r\nHost: x\r\n\r\n` }), { by: 'upstream', code: 'unreachable', status: 502 }],
  [
    '무응답 목적지 → 504',
    async () => {
      const raw = await startRawUpstream(() => {});
      return { data: `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, close: raw.close };
    },
    { by: 'upstream', code: 'timeout', status: 504 },
  ],
  [
    '목적지 101 → 502',
    async () => {
      const raw = await startRawUpstream((s) => s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
      return { data: `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, close: raw.close };
    },
    { by: 'upstream', code: 'upgrade', status: 502 },
  ],
];
for (const [name, make, expected] of rejected) {
  test(`H12: ${name} — 기록은 남기되 response는 비우고 error에 적는다`, async () => {
    const { data, close } = await make();
    try {
      const r = await rawRequest(ctx.proxy.port, data, 1500);
      assert.equal(r.status, expected.status);
      const [f] = await take(1);
      assert.equal(f.response, undefined);
      assert.deepEqual({ by: f.error?.by, code: f.error?.code, status: f.error?.status }, expected);
    } finally {
      await close?.();
    }
  });
}
test('H14: 한 연결에 이어 보낸(파이프라이닝) 요청 3개 → 기록 3개, 순서대로, 본문이 섞이지 않음', async () => {
  const req = (path: string, body: string) => `POST http://${U()}${path} HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
  await rawRequest(ctx.proxy.port, req('/echo', 'aaa') + req('/echo', 'bbbb') + `GET http://${U()}/third HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1500);
  const fs = await take(3);
  assert.deepEqual(
    fs.map((f) => [new URL(f.request.url).pathname, f.request.body.toString(), f.response.body.toString()]),
    [['/echo', 'aaa', 'aaa'], ['/echo', 'bbbb', 'bbbb'], ['/third', '', 'from-upstream']],
  );
});
for (const [method, path] of [['HEAD', '/status/200'], ['GET', '/status/204'], ['GET', '/status/304']] as const) {
  test(`H15: ${method} ${path} — 본문 없는 응답은 빈 본문, 실패·잘림 아님(Content-Length와 비교해 불완전으로 보지 않음)`, async () => {
    await send(ctx.proxy.port, { target: `http://${U()}${path}`, method });
    const [f] = await take(1);
    assert.equal(f.response.body.length, 0);
    assert.equal(f.response.bodySize, 0);
    assert.equal(f.response.bodyTruncated, false);
    assert.equal(f.error, undefined);
  });
}

// --- F. 유출 ---
test('F8: 동시에 처리되는 두 요청의 기록이 섞이지 않는다', async () => {
  const [a, b] = [secret(), secret()];
  await Promise.all([a, b].map((s) => send(ctx.proxy.port, { target: `http://${U()}/slow`, headers: { cookie: `k=${s}` } })));
  const fs = await take(2);
  for (const s of [a, b]) {
    const other = s === a ? b : a;
    const f = fs.find((x) => JSON.stringify(x.request.headers).includes(s));
    assert.ok(f, `${s}가 든 기록이 있어야 함`);
    assert.equal(f.response.body.toString(), `k=${s}`);
    assert.ok(!JSON.stringify(f.request.headers).includes(other) && !f.response.body.toString().includes(other), '다른 연결의 값이 섞이면 안 됨');
  }
});
test('F9: 프록시가 넘긴 기록의 본문은 공유 풀이 아닌 별도 메모리다(작은 본문)', async () => {
  await send(ctx.proxy.port, { target: `http://${U()}/echo`, method: 'POST', body: Buffer.from('hello') });
  const [f] = await take(1);
  for (const b of [f.request.body, f.response.body]) {
    assert.equal(b.toString(), 'hello');
    assert.equal(b.buffer.byteLength, b.length);
  }
});

// --- I. 구독자 ---
for (const mode of ['throw', 'reject'] as const) {
  test(`I1/I2/F4: 구독자가 기록 전체를 담은 오류를 ${mode === 'throw' ? '던져도' : 'reject해도'} 중계·프로세스는 멀쩡하고 출력에 기록 내용이 없다`, async () => {
    const c = await childProxy(mode);
    const s = secret();
    try {
      for (let i = 0; i < 2; i++) {
        const r = await send(c.port, {
          target: `http://${U()}/echo?t=${s}`,
          method: 'POST',
          headers: { cookie: `k=${s}`, authorization: `Bearer ${s}` },
          body: Buffer.from(s),
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.toString(), s);
      }
      const until = Date.now() + 2000;
      while (c.state.flows < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 300)); // 처리되지 않은 reject로 죽는 데 걸리는 시간
      assert.equal(c.state.flows, 2, '구독자가 요청마다 불려야 함');
      assert.equal(c.state.exited, null, '프록시 프로세스가 살아 있어야 함');
      assert.ok(!c.state.out.includes(s), `출력에 기록 내용이 나오면 안 됨:\n${c.state.out.slice(0, 500)}`);
    } finally {
      await c.stop();
    }
  });
}
test('I4: 구독자가 기록을 고쳐도 다음 요청의 중계와 기록에 영향이 없다', async () => {
  const seen: any[] = [];
  const p = await startProxy({
    port: 0,
    onFlow: (f: any) => {
      seen.push({ req: Buffer.from(f.request.body), res: Buffer.from(f.response.body) });
      f.request.body.fill(0);
      f.response.body.fill(0);
      f.request.headers.push(['X-Injected', '1']);
      f.response.status = 999;
    },
  } as Parameters<typeof startProxy>[0]);
  try {
    for (const word of ['first-body', 'second-body']) {
      const r = await send(p.port, { target: `http://${U()}/echo`, method: 'POST', body: Buffer.from(word) });
      assert.equal(r.status, 200);
      assert.equal(r.body.toString(), word);
      assert.equal(ctx.up.got.at(-1)!.headers['x-injected'], undefined);
    }
    const until = Date.now() + 2000;
    while (seen.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.map((x) => [x.req.toString(), x.res.toString()]), [['first-body', 'first-body'], ['second-body', 'second-body']]);
  } finally {
    await p.close();
  }
});
test('I7: onFlow가 함수가 아니면 시작하지 않는다', async () => {
  const started = startProxy({ port: 0, onFlow: 'not-a-function' } as unknown as Parameters<typeof startProxy>[0]).then(async (p) => (await p.close(), 'started'));
  await assert.rejects(started, TypeError);
});
