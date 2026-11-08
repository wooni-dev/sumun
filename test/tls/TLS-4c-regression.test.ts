// [TLS-4c] 회귀: 헤더 제한을 고쳐도 깨지면 안 되는 정상 동작과 지금도 맞는 분류(O9). 사례는 docs/ai/tls4c-cases.md의 K·C·I10.
// 지금 터널 안에서 이것들이 통과하는 것은 헤더 제한이 아예 듣지 않기 때문이기도 하다 — 고친 뒤에 처음으로 진짜 시험이 된다.
// 시간 기준: h = 500ms. "닫지 않는다"는 h의 3배 이상 지켜보고, 마지막에 정상 응답을 받아 연결이 살아 있었음을 확인한다(긍정 전제, O30)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA } from '../../src/ca/ca.ts';
import { exchange, GET } from './_mitm.ts';
import { sleep, until, drip, statuses, watch, tunnel, badUpstreams, httpsUp } from './_tls4c.ts';

const H = 500;
const LIMIT = 2500;
const temps: string[] = [];
type Proxy = Awaited<ReturnType<typeof startProxy>>;
const ctx = {} as { ca: { certPem: string; keyPem: string }; bad: ReturnType<typeof badUpstreams>; proxy: Proxy; flows: any[]; up: number; plainUp: number; servers: (https.Server | http.Server)[] };
let mark = 0;

// 목적지: /slow = 1200ms 뒤 응답, /sse = 200ms마다 조각 6개, 그 밖은 본문을 끝까지 읽고 받은 크기를 돌려준다
const app = (req: http.IncomingMessage, res: http.ServerResponse) => {
  let n = 0;
  req.on('data', (c: Buffer) => (n += c.length));
  req.on('end', () => {
    if (req.url === '/slow') return void setTimeout(() => res.writeHead(200, { 'content-length': 4 }).end('slow'), 1200);
    if (req.url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const iv = setInterval(() => (++i > 6 ? (clearInterval(iv), res.end()) : res.write(`data: ${i}\n\n`)), 200);
      return;
    }
    const body = `got ${n}`;
    res.writeHead(200, { 'content-length': body.length }).end(body);
  });
};
const listen = async (s: https.Server | http.Server) => {
  s.on('tlsClientError', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  ctx.servers.push(s);
  return (s.address() as net.AddressInfo).port;
};
const proxies: Proxy[] = [];
const makeProxy = async (o: object, flows: any[] = []) => {
  const p = await startProxy({ port: 0, ca: ctx.ca, upstreamCA: [ctx.bad.rootPem], tlsHandshakeTimeoutMs: 1000, upstreamTimeoutMs: 1500, lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f: any) => void flows.push(f), ...o } as Parameters<typeof startProxy>[0]);
  proxies.push(p);
  return p;
};
before(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4cr-'));
  temps.push(d);
  ctx.ca = await loadOrCreateCA(path.join(d, 'ca'));
  ctx.bad = badUpstreams();
  ctx.servers = [];
  ctx.up = await listen(https.createServer(ctx.bad.good, app));
  ctx.plainUp = await listen(http.createServer(app));
  ctx.flows = [];
  ctx.proxy = await makeProxy({ headersTimeoutMs: H }, ctx.flows);
});
after(async () => {
  for (const p of proxies) await p.close().catch(() => {});
  for (const s of ctx.servers) (s.closeAllConnections(), s.close());
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
beforeEach(() => (mark = ctx.flows.length));
const newFlows = () => ctx.flows.slice(mark);
const HOST = () => `localhost:${ctx.up}`;
const open = async (p: Proxy = ctx.proxy, o: { delayMs?: number } = {}) => {
  const tn = await tunnel(p.port, 'localhost', ctx.up, { ca: ctx.ca.certPem, ...o });
  assert.equal(tn.tlsError, undefined, `전제: 핸드셰이크 성공 (${tn.tlsError})`);
  return tn;
};

test('K1: 터널 안에서 헤더를 다 보낸 뒤 목적지가 h보다 늦게(1200ms) 응답해도 200', async () => {
  const tn = await open();
  assert.match(await exchange(tn.t, GET('/slow', HOST())), /^HTTP\/1\.1 200 [\s\S]*slow$/);
  tn.t.destroy();
});

test('K2·K3: keep-alive — h보다 긴 1000ms 쉼 뒤 둘째 요청, 120ms 간격 요청 8개(전체 > h) 모두 200', async () => {
  const tn = await open();
  assert.match(await exchange(tn.t, GET('/a', HOST())), /^HTTP\/1\.1 200 /);
  await sleep(1000);
  assert.match(await exchange(tn.t, GET('/b', HOST())), /^HTTP\/1\.1 200 /);
  for (let i = 0; i < 8; i++) {
    await sleep(120);
    assert.match(await exchange(tn.t, GET(`/c${i}`, HOST())), /^HTTP\/1\.1 200 /, `${i}번째`);
  }
  tn.t.destroy();
});

test('K4: SSE — 1200ms 동안 응답 조각이 오고 클라이언트는 아무것도 보내지 않아도 끝까지 받는다', async () => {
  const tn = await open();
  tn.t.write(GET('/sse', HOST()));
  await until(() => tn.w.data.includes('data: 6'), 4000);
  assert.match(tn.w.data, /^HTTP\/1\.1 200 /);
  assert.ok(tn.w.data.includes('data: 6'), '마지막 조각까지');
  tn.t.destroy();
});

test('K5·K6: 2MB 업로드, 본문 20바이트를 100ms마다 1바이트(2초 > h) — 헤더 제한으로 끊지 않고 200(D-3)', async () => {
  const a = await open();
  const size = 2 * 1024 * 1024;
  const r1 = exchange(a.t, `POST /up HTTP/1.1\r\nHost: ${HOST()}\r\nContent-Length: ${size}\r\n\r\n`, 1, 8000);
  for (let i = 0; i < 32; i++) a.t.write(Buffer.alloc(65536, 97));
  assert.match(await r1, new RegExp(`^HTTP/1\\.1 200 [\\s\\S]*got ${size}$`));
  const b = await open();
  b.t.write(`POST /slowbody HTTP/1.1\r\nHost: ${HOST()}\r\nContent-Length: 20\r\n\r\n`);
  drip(b.t, 'b'.repeat(20), 100);
  await until(() => statuses(b.w.data).length >= 1, 5000);
  assert.deepEqual(statuses(b.w.data), [200], '느린 본문은 408이 아니라 끝까지 받아 200');
  assert.ok(b.w.data.endsWith('got 20'));
  a.t.destroy();
  b.t.destroy();
});

test('I10·K14: Expect: 100-continue — 본문을 안 보내면 100 뒤 목적지 제한으로 504(408 아님), 본문을 보내면 100 뒤 200', async () => {
  const a = await open();
  a.t.write(`POST /e HTTP/1.1\r\nHost: ${HOST()}\r\nContent-Length: 10\r\nExpect: 100-continue\r\n\r\n`);
  await until(() => statuses(a.w.data).length >= 2, 5000);
  assert.deepEqual(statuses(a.w.data), [100, 504]);
  const b = await open();
  b.t.write(`POST /e HTTP/1.1\r\nHost: ${HOST()}\r\nContent-Length: 10\r\nExpect: 100-continue\r\n\r\n`);
  await until(() => statuses(b.w.data).length >= 1);
  assert.deepEqual(statuses(b.w.data), [100]);
  b.t.write('0123456789');
  await until(() => statuses(b.w.data).length >= 2);
  assert.deepEqual(statuses(b.w.data), [100, 200]);
  a.t.destroy();
  b.t.destroy();
});

test('K7: 평문 프록시 — 헤더를 1바이트씩 보내면 h 안에 408, keep-alive 둘째 요청 반쪽도 h 안에 408', async () => {
  const conn = async () => {
    const s = net.connect(ctx.proxy.port, '127.0.0.1');
    s.on('error', () => {});
    await new Promise<void>((r) => s.once('connect', () => r()));
    return { s, w: watch(s) };
  };
  const a = await conn();
  const t0 = Date.now();
  a.s.write(`GET http://127.0.0.1:${ctx.plainUp}/a HTTP/1.1\r\n`);
  drip(a.s, 'X-Pad: ' + 'a'.repeat(100) + '\r\n', 200, () => a.w.data.length > 0);
  const b = await conn();
  b.s.write(`GET http://127.0.0.1:${ctx.plainUp}/a HTTP/1.1\r\nHost: x\r\n\r\n`);
  await until(() => statuses(b.w.data).length >= 1);
  b.s.write(`GET http://127.0.0.1:${ctx.plainUp}/b HTTP/1.1\r\nHo`);
  await until(() => a.w.closed && b.w.closed, LIMIT + 1000);
  assert.ok(a.w.closed && a.w.closedAt! - t0 < LIMIT, '1바이트씩');
  assert.deepEqual(statuses(a.w.data), [408]);
  assert.ok(b.w.closed, 'keep-alive 반쪽');
  assert.deepEqual(statuses(b.w.data), [200, 408]);
});

test('K8·K9: headersTimeoutMs 0(제한 없음)·3e9 — 터널에서 헤더 반쪽으로 1500ms 쉬어도 닫지 않고, 나머지를 보내면 200', async () => {
  for (const h of [0, 3e9]) {
    const p = await makeProxy({ headersTimeoutMs: h });
    const tn = await open(p);
    tn.t.write(`GET /k8 HTTP/1.1\r\nHost: ${HOST()}\r\n`);
    await sleep(1500);
    assert.equal(tn.w.closed, false, `h=${h}: 바로 닫히지 않는다`);
    tn.t.write('\r\n');
    await until(() => statuses(tn.w.data).length >= 1);
    assert.deepEqual(statuses(tn.w.data), [200], `h=${h}: 긍정 전제 — 연결이 살아 있었다`);
    tn.t.destroy();
  }
});

test('K10: headersTimeoutMs=1이어도 터널의 TLS 핸드셰이크(ClientHello를 200ms 늦게)는 끊기지 않는다', async () => {
  const p = await makeProxy({ headersTimeoutMs: 1 });
  const tn = await tunnel(p.port, 'localhost', ctx.up, { ca: ctx.ca.certPem, delayMs: 200 });
  assert.equal(tn.tlsError, undefined, '헤더 시계가 핸드셰이크를 끊지 않는다');
  assert.ok(tn.securedAt, '핸드셰이크 완료 시각');
  tn.t.destroy();
});

test('K11: close() — 붙잡힌 터널(무요청·헤더 반쪽·1바이트씩)이 모두 닫히고 CONNECT 기록은 터널마다 하나', async () => {
  const flows: any[] = [];
  const p = await makeProxy({ headersTimeoutMs: 10_000 }, flows);
  const tns = [await open(p), await open(p), await open(p)];
  tns[1].t.write(`GET / HTTP/1.1\r\nHost: ${HOST()}\r\n`);
  tns[2].t.write('GET / HTTP/1.1\r\n');
  drip(tns[2].t, 'X-Pad: aaaaaaaaaaaaaaaaaaaa\r\n', 100);
  await sleep(200);
  assert.equal(tns.filter((t) => t.w.closed).length, 0, '전제: close 전에는 열려 있다');
  await p.close();
  await until(() => tns.every((t) => t.rawW.closed), 1000);
  assert.equal(tns.filter((t) => !t.rawW.closed).length, 0);
  await sleep(200);
  assert.equal(flows.filter((f) => f.request.method === 'CONNECT').length, 3);
});

test('빈 터널: 핸드셰이크 뒤 요청 없이 클라이언트가 바로 끊으면 CONNECT 기록에 오류 없음(TLS 보고서 결정 7)', async () => {
  const tn = await open();
  tn.t.end();
  await until(() => newFlows().some((f) => f.request.method === 'CONNECT'));
  const c = newFlows().find((f) => f.request.method === 'CONNECT');
  assert.ok(c, '전제: CONNECT 기록이 있다');
  assert.equal(c.error, undefined);
});

for (const [id, label, opts, error, code] of [
  ['C6', 'EKU clientAuth만', () => ctx.bad.ekuClientOnly, { by: 'upstream', code: 'bad-certificate', status: 502 }, 'INVALID_PURPOSE'],
  ['C7', '중간 CA를 보내지 않음', () => ctx.bad.missingIntermediate, { by: 'upstream', code: 'bad-certificate', status: 502 }, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
  ['C12', '(반대) TLS 1.3 클라이언트 인증서 요구', () => ({ ...ctx.bad.good, requestCert: true, rejectUnauthorized: true, ca: [ctx.bad.rootPem] }), { by: 'upstream', code: 'tls-handshake', status: 502 }, 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED'],
  ['C13', '(반대) TLS 1.2 클라이언트 인증서 요구', () => ({ ...ctx.bad.good, requestCert: true, rejectUnauthorized: true, ca: [ctx.bad.rootPem], maxVersion: 'TLSv1.2' as const }), { by: 'upstream', code: 'tls-handshake', status: 502 }, 'EPROTO'],
] as const) {
  test(`${id}: 목적지 ${label} → ${error.code}, upstreamError ${code}`, async () => {
    const up = await httpsUp(opts() as https.ServerOptions);
    try {
      const tn = await tunnel(ctx.proxy.port, 'localhost', up.port, { ca: ctx.ca.certPem });
      assert.match(await exchange(tn.t, GET('/', `localhost:${up.port}`)), /^HTTP\/1\.1 502 /);
      tn.t.destroy();
      await until(() => newFlows().some((f) => f.request.method === 'GET'));
      const f = newFlows().find((x) => x.request.method === 'GET');
      assert.deepEqual(f?.error, error);
      assert.equal(f?.tls?.upstreamError, code);
    } finally {
      await up.close();
    }
  });
}

test('C14: (반대) ClientHello 직후 목적지가 연결을 리셋 → unreachable, upstreamError 없음', async () => {
  const s = net.createServer((c) => (c.on('error', () => {}), c.once('data', () => c.resetAndDestroy())));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  try {
    const tn = await tunnel(ctx.proxy.port, 'localhost', port, { ca: ctx.ca.certPem });
    assert.match(await exchange(tn.t, GET('/', `localhost:${port}`)), /^HTTP\/1\.1 502 /);
    tn.t.destroy();
    await until(() => newFlows().some((f) => f.request.method === 'GET'));
    const f = newFlows().find((x) => x.request.method === 'GET');
    assert.deepEqual(f?.error, { by: 'upstream', code: 'unreachable', status: 502 });
    assert.equal(f?.tls?.upstreamError, undefined);
  } finally {
    s.close();
  }
});
