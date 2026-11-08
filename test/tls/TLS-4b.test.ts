// [TLS-4b] 새 동작: 복호화·터널 견고성. 사례 번호는 docs/ai/tls4-cases.md(배정 "4b"), 실측 scripts/probe/tls4b-node.mjs.
//   startProxy({ tlsHandshakeTimeoutMs }) — 200 뒤 이 시간 안에 TLS 핸드셰이크가 끝나지 않으면 닫고 CONNECT 기록 { by: 'client', code: 'timeout' }
//   터널 안 Upgrade(WebSocket·h2c) → 501(결정 6), 목적지 TLS 실패(인증서가 아닌 것) → 502 tls-handshake, 실패 원인 코드 → 기록 tls.upstreamError(결정 9 조정)
//   createCertCache(ca, { max, now }) — LRU 상한(기본 1000, 결정 8), 만료 1일 전이면 다시 발급(G5)
//   불투명 터널: 검사한 주소들을 차례로 시도(TLS-4에서 넘긴 범위 밖 결함)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import http2 from 'node:http2';
import { startProxy } from '../../src/proxy/server.ts';
import { createCertCache } from '../../src/tls/mitm.ts';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';
import { DAY, sleep, until, upstream, badLeaf, connectMitm, exchange, GET, type Pair } from './_mitm.ts';

const temps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4b-'));
  temps.push(d);
  return d;
};
const ctx = {} as { proxyCA: Pair; upCA: Pair; proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[] };
let mark = 0;
before(async () => {
  ctx.proxyCA = await loadOrCreateCA(path.join(tmp(), 'p'));
  ctx.upCA = await loadOrCreateCA(path.join(tmp(), 'u'));
  ctx.flows = [];
  ctx.proxy = await startProxy({
    port: 0,
    ca: ctx.proxyCA,
    upstreamCA: [ctx.upCA.certPem],
    upstreamTimeoutMs: 3000,
    tlsHandshakeTimeoutMs: 300,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    onFlow: (f: any) => void ctx.flows.push(f),
  } as Parameters<typeof startProxy>[0]);
});
after(async () => {
  await ctx.proxy?.close();
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
beforeEach(() => (mark = ctx.flows.length));
const newFlows = () => ctx.flows.slice(mark);
const open = async (host: string, port: number, o: tls.ConnectionOptions = {}) => {
  const m = await connectMitm(ctx.proxy.port, host, port, { ca: ctx.proxyCA.certPem, ...o });
  assert.equal(m.status, 200, `CONNECT ${m.status}`);
  assert.equal(m.tlsError, undefined, `핸드셰이크 ${m.tlsError}`);
  return m.t!;
};

test('D4: 200 뒤 ClientHello가 오지 않으면 tlsHandshakeTimeoutMs(300ms) 뒤 닫고 CONNECT 기록 timeout / 핸드셰이크가 끝난 연결은 그보다 오래 쉬어도 유지', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm(ctx.proxy.port, 'localhost', up.port);
    assert.equal(m.status, 200, '전제: CONNECT는 받았다');
    let closed = false;
    m.raw.once('close', () => (closed = true));
    const t0 = Date.now();
    await until(() => closed, 3000);
    assert.equal(closed, true, '핸드셰이크 없이 열린 채로 남지 않는다');
    assert.ok(Date.now() - t0 < 2500, `${Date.now() - t0}ms`);
    await until(() => newFlows().length >= 1);
    assert.deepEqual(newFlows()[0]?.error, { by: 'client', code: 'timeout' });

    const t = await open('localhost', up.port, { servername: 'localhost' });
    await sleep(700);
    assert.match(await exchange(t, GET('/idle', `localhost:${up.port}`)), /^HTTP\/1\.1 200 /, '핸드셰이크 뒤에는 핸드셰이크 타임아웃이 걸리지 않는다');
    t.destroy();
  } finally {
    await up.close();
  }
});

test('E10: 터널 안 Upgrade(WebSocket) 요청은 501로 거부하고 목적지에 보내지 않는다(결정 6), 기록 rejected 501', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const t = await open('localhost', up.port, { servername: 'localhost' });
    const r = await exchange(t, `GET /ws HTTP/1.1\r\nHost: localhost:${up.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    assert.match(r, /^HTTP\/1\.1 501 /);
    assert.match(r, /content-type: text\/plain/i);
    assert.equal(up.got.length, 0, '목적지는 받지 않는다(실측 E105: 지금은 일반 GET으로 바뀌어 간다)');
    t.destroy();
    await until(() => newFlows().length >= 1);
    assert.deepEqual(newFlows()[0]?.error, { by: 'proxy', code: 'rejected', status: 501 });
  } finally {
    await up.close();
  }
});

test('C5·A13·A7·A15: 목적지가 h2만 / 평문 TCP / TLS 1.0만 / 클라이언트 인증서 요구 → 502(TLS 연결 실패 문구), 기록 tls-handshake와 원인 코드', async () => {
  const leaf = await issueCert(ctx.upCA, ['localhost', '127.0.0.1']);
  const servers: [string, net.Server][] = [
    ['h2만', http2.createSecureServer({ cert: leaf.certPem, key: leaf.keyPem, allowHTTP1: false })],
    ['평문 TCP', net.createServer((s) => (s.on('error', () => {}), s.end('HTTP/1.1 200 OK\r\n\r\nplain')))],
    ['TLS 1.0만', tls.createServer({ cert: leaf.certPem, key: leaf.keyPem, minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' }, (s) => s.end())],
    ['클라이언트 인증서 요구', https.createServer({ cert: leaf.certPem, key: leaf.keyPem, requestCert: true, rejectUnauthorized: true, ca: [ctx.upCA.certPem] }, (_q, r) => r.end('x'))],
  ];
  for (const [label, s] of servers) {
    mark = ctx.flows.length;
    s.on('error', () => {});
    s.on('tlsClientError', () => {});
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const port = (s.address() as net.AddressInfo).port;
    try {
      const t = await open('localhost', port, { servername: 'localhost' });
      const r = await exchange(t, GET('/', `localhost:${port}`));
      assert.match(r, /^HTTP\/1\.1 502 /, label);
      assert.ok(r.includes('목적지 서버와 TLS 연결을 맺지 못했습니다'), `${label}: 고정 문구`);
      t.destroy();
      await until(() => newFlows().length >= 1);
      const f = newFlows()[0];
      assert.deepEqual(f?.error, { by: 'upstream', code: 'tls-handshake', status: 502 }, label);
      assert.equal(typeof f?.tls?.upstreamError, 'string', `${label}: 원인 코드`);
      assert.match(f.tls.upstreamError, /^[A-Z0-9_]{3,64}$/, `${label}: 코드 모양만(문구·입력 없음)`);
    } finally {
      s.close();
    }
  }
});

test('결정 9: bad-certificate 기록에 원인 코드(tls.upstreamError) — error 모양은 그대로', async () => {
  const now = Date.now();
  const cases: [string, Pair, string][] = [
    ['만료', badLeaf(ctx.upCA, new Date(now - 10 * DAY), new Date(now - DAY)), 'CERT_HAS_EXPIRED'],
    ['자체 서명', badLeaf(null, new Date(now - DAY), new Date(now + DAY)), 'DEPTH_ZERO_SELF_SIGNED_CERT'],
    ['이름 불일치', await issueCert(ctx.upCA, ['other.test']), 'ERR_TLS_CERT_ALTNAME_INVALID'],
  ];
  for (const [label, pair, code] of cases) {
    mark = ctx.flows.length;
    const up = await upstream(pair);
    try {
      const t = await open('localhost', up.port, { servername: 'localhost' });
      assert.match(await exchange(t, GET('/', `localhost:${up.port}`)), /^HTTP\/1\.1 502 /);
      t.destroy();
      await until(() => newFlows().length >= 1);
      const f = newFlows()[0];
      assert.deepEqual(f?.error, { by: 'upstream', code: 'bad-certificate', status: 502 }, label);
      assert.equal(f?.tls?.upstreamError, code, label);
    } finally {
      await up.close();
    }
  }
});

test('G3: 인증서 캐시는 상한(max)을 넘으면 가장 오래 안 쓴 것부터 버린다(LRU) — 기본 상한 1000', async () => {
  const cache = (createCertCache as any)(ctx.proxyCA, { max: 3 });
  const a1 = cache.get('a.test');
  await a1;
  for (const h of ['b.test', 'c.test']) await cache.get(h);
  assert.equal(cache.get('a.test'), a1, '전제: 상한 안에서는 같은 발급을 다시 쓴다');
  await cache.get('d.test'); // 상한 3을 넘음 → 가장 오래 안 쓴 b.test가 빠진다(a.test는 방금 썼다)
  assert.equal(cache.get('a.test'), a1, '최근에 쓴 것은 남는다');
  const b2 = cache.get('b.test');
  assert.notEqual(b2, undefined);
  assert.equal(cache.size, 3, '항목 수는 상한 이하');
  assert.equal((createCertCache as any)(ctx.proxyCA).max, 1000, '기본 상한');
});

test('G5: 캐시된 인증서가 만료 1일 전이 되면 다시 발급한다(가짜 시계)', async () => {
  let fake = Date.now();
  const cache = (createCertCache as any)(ctx.proxyCA, { now: () => fake });
  const p1 = cache.get('exp.test');
  await p1;
  fake += 28 * DAY;
  assert.equal(cache.get('exp.test'), p1, '전제: 2일 남으면 그대로 쓴다');
  fake += 1.5 * DAY; // 말단 유효 기간 30일(TLS-3) → 남은 기간 0.5일
  const p2 = cache.get('exp.test');
  assert.notEqual(p2, p1, '1일 안으로 들어오면 다시 발급');
  await p2;
});

test('터널(복호화 없음): 이름이 여러 주소로 풀리면 차례로 시도한다 — localhost가 ::1, 127.0.0.1 순서여도 127.0.0.1의 목적지에 닿고, 기록에 실제 주소', async () => {
  const echo = net.createServer((s) => (s.on('error', () => {}), s.on('data', (d) => s.write(d))));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
  const port = (echo.address() as net.AddressInfo).port;
  const flows: any[] = [];
  const p = await startProxy({
    port: 0,
    tunnel: true,
    lookup: async () => [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }],
    onFlow: (f: any) => void flows.push(f),
  } as Parameters<typeof startProxy>[0]);
  const c = net.connect(p.port, '127.0.0.1');
  try {
    await new Promise<void>((r) => c.once('connect', () => r()));
    let got = '';
    c.on('data', (d) => (got += d));
    c.write(`CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\nping`);
    await until(() => got.endsWith('ping'));
    assert.match(got, /^HTTP\/1\.1 200 /, `응답: ${got.slice(0, 60)}`);
    assert.ok(got.endsWith('ping'));
    c.end();
    await until(() => flows.length >= 1);
    assert.equal(flows[0]?.tunnel?.address, '127.0.0.1');
  } finally {
    c.destroy();
    await p.close();
    echo.close();
  }
});
