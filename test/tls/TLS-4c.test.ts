// [TLS-4c] 새 동작: 복호화 터널 안 헤더 제한, 목적지 인증서 검증 실패 분류. 사례는 docs/ai/tls4c-cases.md(배정 "4c"), 실측 scripts/probe/tls4c-*.mjs.
//   터널 안에서도 평문처럼: 핸드셰이크가 끝난 뒤 요청 헤더를 headersTimeoutMs(h) 안에 다 보내지 않으면 408을 보내고 닫는다(D-2)
//   요청 없이 시간 초과로 닫힌 터널의 CONNECT 기록 = { by: 'client', code: 'timeout' }(D-1). 요청 뒤 유휴로 닫히면 CONNECT 기록 없음(TLS 보고서 결정 6)
//   목적지 인증서를 Node가 검증으로 실패시키면 코드와 상관없이 bad-certificate, tls.upstreamError = 코드(D-5)
// 시간 기준: h = 500ms, 검사 주기 250ms. 닫힘 판정은 LIMIT(2500ms) 안 — 지금은 닫히지 않거나 keep-alive(5초)가 닫으므로 구별된다
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA } from '../../src/ca/ca.ts';
import { exchange, GET } from './_mitm.ts';
import { sleep, until, drip, statuses, tunnel, badUpstreams, httpsUp } from './_tls4c.ts';

const H = 500;
const LIMIT = 2500;
const temps: string[] = [];
const ctx = {} as { ca: { certPem: string; keyPem: string }; bad: ReturnType<typeof badUpstreams>; proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[]; up: Awaited<ReturnType<typeof httpsUp>> };
let mark = 0;
before(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4c-'));
  temps.push(d);
  ctx.ca = await loadOrCreateCA(path.join(d, 'ca'));
  ctx.bad = badUpstreams();
  ctx.up = await httpsUp(ctx.bad.good, 'ok');
  ctx.flows = [];
  ctx.proxy = await startProxy({
    port: 0,
    ca: ctx.ca,
    upstreamCA: [ctx.bad.rootPem],
    headersTimeoutMs: H,
    tlsHandshakeTimeoutMs: 1000,
    upstreamTimeoutMs: 3000,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    onFlow: (f: any) => void ctx.flows.push(f),
  } as Parameters<typeof startProxy>[0]);
});
after(async () => {
  await ctx.proxy?.close();
  await ctx.up?.close();
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
beforeEach(() => (mark = ctx.flows.length));
const newFlows = () => ctx.flows.slice(mark);
const connects = () => newFlows().filter((f) => f.request.method === 'CONNECT');
const open = async (o: { delayMs?: number; tls?: object } = {}) => {
  const tn = await tunnel(ctx.proxy.port, 'localhost', ctx.up.port, { ca: ctx.ca.certPem, ...o });
  assert.equal(tn.tlsError, undefined, `전제: 핸드셰이크 성공 (${tn.tlsError})`);
  return tn;
};
const HOST = () => `localhost:${ctx.up.port}`;
const HALF = () => `GET /b HTTP/1.1\r\nHost: ${HOST()}\r\nX-A: 1\r\n`;
const PAD = 'X-Pad: ' + 'a'.repeat(200) + '\r\n';

test('I3·I16·D-1: 핸드셰이크 뒤 아무것도 보내지 않으면 h 안에 408을 보내고 닫는다, CONNECT 기록 client timeout', async () => {
  const tn = await open();
  await until(() => tn.w.closed, LIMIT + 1000);
  assert.equal(tn.w.closed, true, '열린 채로 남지 않는다');
  assert.ok(tn.w.closedAt! - tn.securedAt! < LIMIT, `${tn.w.closedAt! - tn.securedAt!}ms`);
  assert.deepEqual(statuses(tn.w.data), [408], '평문 프록시처럼 408(D-2)');
  await until(() => connects().length >= 1);
  assert.equal(connects().length, 1, '전제: CONNECT 기록이 있다');
  assert.deepEqual(connects()[0].error, { by: 'client', code: 'timeout' });
});

test('I1·I2: 헤더를 1바이트씩(200ms·450ms 간격 — h보다 짧게) 보내도 메시지 시작부터 h 안에 408로 닫는다', async () => {
  const a = await open();
  const b = await open();
  const t0 = Date.now();
  for (const [tn, ms] of [[a, 200], [b, H - 50]] as const) {
    tn.t.write('GET / HTTP/1.1\r\n');
    drip(tn.t, PAD.repeat(5), ms, () => tn.w.data.length > 0); // 응답을 받으면 멈춘다(_tls4c.ts drip 주석)
  }
  await until(() => a.w.closed && b.w.closed, LIMIT + 1000);
  for (const [label, tn] of [['200ms', a], ['450ms', b]] as const) {
    assert.equal(tn.w.closed, true, `${label}: 닫힌다`);
    assert.ok(tn.w.closedAt! - t0 < LIMIT, `${label}: ${tn.w.closedAt! - t0}ms`);
    assert.deepEqual(statuses(tn.w.data), [408], label);
  }
  await until(() => connects().length >= 2);
  assert.deepEqual(connects().map((f) => f.error), [{ by: 'client', code: 'timeout' }, { by: 'client', code: 'timeout' }]);
});

test('I4: keep-alive 첫 요청 200 뒤 둘째 요청 헤더 반쪽 → 둘째 시작부터 h 안에(keep-alive 5초보다 빨리) 408, 기록은 첫 요청 200 하나, CONNECT 기록 없음', async () => {
  const tn = await open();
  tn.t.write(GET('/a', HOST()));
  await until(() => statuses(tn.w.data).length >= 1);
  assert.deepEqual(statuses(tn.w.data), [200], '전제: 첫 요청은 정상');
  await sleep(300);
  const t2 = Date.now();
  tn.t.write(HALF());
  await until(() => tn.w.closed, LIMIT + 1000);
  assert.equal(tn.w.closed, true);
  assert.ok(tn.w.closedAt! - t2 < LIMIT, `${tn.w.closedAt! - t2}ms`);
  assert.deepEqual(statuses(tn.w.data), [200, 408]);
  await sleep(200);
  assert.deepEqual(newFlows().map((f) => [f.request.method, f.request.url, f.response?.status]), [['GET', '/a', 200]], '첫 요청 기록만(긍정 전제 포함), CONNECT 기록 없음');
});

test('I5: keep-alive 첫 요청 뒤 둘째 요청 헤더를 200ms마다 1바이트 → 둘째 시작부터 h 안에 408', async () => {
  const tn = await open();
  tn.t.write(GET('/a', HOST()));
  await until(() => statuses(tn.w.data).length >= 1);
  assert.deepEqual(statuses(tn.w.data), [200], '전제');
  await sleep(300);
  const t2 = Date.now();
  tn.t.write('GET /b HTTP/1.1\r\n');
  drip(tn.t, PAD.repeat(5), 200, () => statuses(tn.w.data).length >= 2);
  await until(() => tn.w.closed, LIMIT + 1000);
  assert.equal(tn.w.closed, true, '바이트마다 유휴 타이머가 다시 시작되어 끝없이 열려 있지 않다');
  assert.ok(tn.w.closedAt! - t2 < LIMIT, `${tn.w.closedAt! - t2}ms`);
  assert.deepEqual(statuses(tn.w.data), [200, 408]);
});

test('I6: 완전한 요청과 반쪽 요청을 한 번에 보내면 첫 응답 200, 그 뒤 h 안에 408', async () => {
  const tn = await open();
  const t0 = Date.now();
  tn.t.write(GET('/a', HOST()) + `GET /b HTTP/1.1\r\nHost: lo`);
  await until(() => tn.w.closed, LIMIT + 1000);
  assert.equal(tn.w.closed, true);
  assert.ok(tn.w.closedAt! - t0 < LIMIT, `${tn.w.closedAt! - t0}ms`);
  assert.deepEqual(statuses(tn.w.data), [200, 408]);
});

test('I8: 핸드셰이크 뒤 TLS 레코드 일부만 보내고 멈춰도(HTTP 해석기에 바이트가 닿지 않음) h 안에 닫고 CONNECT 기록 client timeout', async () => {
  const tn = await open();
  await sleep(100);
  tn.raw.write(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x40, 1, 2, 3]));
  await until(() => tn.rawW.closed, LIMIT + 1000);
  assert.equal(tn.rawW.closed, true);
  assert.ok(tn.rawW.closedAt! - tn.securedAt! < LIMIT, `${tn.rawW.closedAt! - tn.securedAt!}ms`);
  await until(() => connects().length >= 1);
  assert.deepEqual(connects()[0]?.error, { by: 'client', code: 'timeout' });
});

test('I9: TLS 1.2 재협상을 반복해도 헤더 시계가 다시 시작되지 않는다 — h 안에 닫히고 CONNECT 기록은 한 번', async () => {
  const tn = await open({ tls: { maxVersion: 'TLSv1.2' } });
  const t0 = Date.now();
  tn.t.write('GET / HTTP/1.1\r\n');
  let n = 0;
  const iv = setInterval(() => (n++ >= 6 || tn.t.destroyed ? clearInterval(iv) : tn.t.renegotiate({}, () => {})), 200);
  await until(() => tn.w.closed, LIMIT + 1000);
  clearInterval(iv);
  assert.ok(n >= 1, '전제: 재협상을 시도했다');
  assert.equal(tn.w.closed, true);
  assert.ok(tn.w.closedAt! - t0 < LIMIT, `${tn.w.closedAt! - t0}ms`);
  await sleep(200);
  assert.equal(connects().length, 1, '기록 한 번');
  assert.deepEqual(connects()[0].error, { by: 'client', code: 'timeout' });
});

test('I12·K10: ClientHello를 h보다 늦게(700ms) 보내도 핸드셰이크는 성공하고, 헤더 시계는 핸드셰이크가 끝난 뒤부터 센다 → 그 뒤 h 안에 408', async () => {
  const tn = await open({ delayMs: 700 }); // 핸드셰이크 제한은 1000ms
  tn.t.write(HALF());
  await until(() => tn.w.closed, LIMIT + 1000);
  assert.equal(tn.w.closed, true);
  assert.ok(tn.w.closedAt! - tn.securedAt! < LIMIT, `${tn.w.closedAt! - tn.securedAt!}ms`);
  assert.deepEqual(statuses(tn.w.data), [408]);
});

test('R1: 헤더 반쪽으로 멈춘 터널 50개가 모두 h 안에 닫힌다', async () => {
  const all = [];
  for (let i = 0; i < 2; i++) all.push(...(await Promise.all(Array.from({ length: 25 }, () => open()))));
  const t0 = Date.now();
  for (const tn of all) tn.t.write(HALF());
  await until(() => all.every((tn) => tn.w.closed), LIMIT + 1000);
  assert.equal(all.filter((tn) => !tn.w.closed).length, 0, `${Date.now() - t0}ms 뒤 살아 있는 터널`);
});

for (const [id, key, label] of [
  ['C1', 'nameConstraint', '이름 제약 위반(중간 CA permitted .example.com, leaf localhost)'],
  ['C2', 'criticalExt', '모르는 critical 확장'],
  ['C3', 'sha1', 'SHA-1 서명'],
  ['C4', 'rsa1024', 'RSA 1024 키'],
] as const) {
  test(`${id}·C17(D-5): 목적지 인증서 ${label} → 502 bad-certificate, upstreamError UNSPECIFIED, 목적지 본문은 클라이언트에 0바이트`, async () => {
    const up = await httpsUp(ctx.bad[key], 'upstream-secret-body');
    try {
      const tn = await tunnel(ctx.proxy.port, 'localhost', up.port, { ca: ctx.ca.certPem });
      assert.equal(tn.tlsError, undefined, '전제: 프록시와의 핸드셰이크');
      const r = await exchange(tn.t, GET('/', `localhost:${up.port}`));
      assert.match(r, /^HTTP\/1\.1 502 /);
      assert.ok(r.includes('목적지 서버의 인증서를 믿을 수 없습니다'), '인증서 문구');
      assert.ok(!r.includes('upstream-secret-body'), '목적지 본문이 새지 않는다');
      tn.t.destroy();
      await until(() => newFlows().some((f) => f.request.method === 'GET'));
      const f = newFlows().find((x) => x.request.method === 'GET');
      assert.deepEqual(f?.error, { by: 'upstream', code: 'bad-certificate', status: 502 });
      assert.equal(f?.tls?.upstreamError, 'UNSPECIFIED');
    } finally {
      await up.close();
    }
  });
}
