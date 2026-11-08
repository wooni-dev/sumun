// [TLS-4b] 회귀: TLS-4 구현으로 이미 되는 견고성(O9). 실측 scripts/probe/tls4b-node.mjs(E102~E104, E107)와 사례 A14·E5·E7·E8·E9·E14·D5·D9.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';
import { DAY, sleep, until, upstream, badLeaf, connectMitm, exchange, GET, type Pair } from './_mitm.ts';

const temps: string[] = [];
const ctx = {} as { proxyCA: Pair; upCA: Pair; proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[] };
let mark = 0;
before(async () => {
  for (const k of ['proxyCA', 'upCA'] as const) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4br-'));
    temps.push(d);
    ctx[k] = await loadOrCreateCA(path.join(d, 'ca'));
  }
  ctx.flows = [];
  ctx.proxy = await startProxy({ port: 0, ca: ctx.proxyCA, upstreamCA: [ctx.upCA.certPem], lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f: any) => void ctx.flows.push(f) } as Parameters<typeof startProxy>[0]);
});
after(async () => {
  await ctx.proxy?.close();
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
beforeEach(() => (mark = ctx.flows.length));
const newFlows = () => ctx.flows.slice(mark);
const connect = (host: string, port: number, o = {}) => connectMitm(ctx.proxy.port, host, port, { ca: ctx.proxyCA.certPem, servername: 'localhost', ...o });

test('D8·D2: 클라이언트가 ALPN h2만 / TLS 1.1 이하면 핸드셰이크 실패, CONNECT 기록 tls-handshake, 목적지 연결 0', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const a = await connect('localhost', up.port, { ALPNProtocols: ['h2'] });
    assert.equal(a.status, 200);
    assert.match(String(a.tlsError), /NO_APPLICATION_PROTOCOL/);
    const b = await connect('localhost', up.port, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
    assert.match(String(b.tlsError), /PROTOCOL_VERSION|UNSUPPORTED_PROTOCOL/);
    await until(() => newFlows().length >= 2);
    assert.deepEqual(newFlows().map((f) => f.error), [{ by: 'client', code: 'tls-handshake' }, { by: 'client', code: 'tls-handshake' }]);
    assert.equal(up.conns, 0);
  } finally {
    await up.close();
  }
});

test('D1: 200 뒤 TLS가 아닌 평문 바이트가 오면 닫고 CONNECT 기록 tls-handshake(결정 3)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm(ctx.proxy.port, 'localhost', up.port, {});
    // connectMitm은 200 뒤 TLS를 시작하므로, 여기서는 원시 소켓을 따로 쓴다
    m.t?.destroy();
    mark = ctx.flows.length;
    const raw = (await import('node:net')).default.connect(ctx.proxy.port, '127.0.0.1');
    raw.on('error', () => {});
    await new Promise<void>((r) => raw.once('connect', () => r()));
    raw.write(`CONNECT localhost:${up.port} HTTP/1.1\r\nHost: localhost:${up.port}\r\n\r\n`);
    await new Promise((r) => raw.once('data', r));
    let closed = false;
    raw.once('close', () => (closed = true));
    raw.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await until(() => closed, 3000);
    assert.equal(closed, true);
    await until(() => newFlows().length >= 1);
    assert.deepEqual(newFlows()[0]?.error, { by: 'client', code: 'tls-handshake' });
    assert.equal(up.got.length, 0);
  } finally {
    await up.close();
  }
});

test('B4: SNI가 IP 문자열이어도 프록시 인증서는 CONNECT 이름 기준', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connect('localhost', up.port, { servername: '127.0.0.1', checkServerIdentity: () => undefined });
    assert.equal(m.tlsError, undefined);
    assert.match(m.t!.getPeerCertificate().subjectaltname, /^DNS:localhost$/);
    m.t!.destroy();
  } finally {
    await up.close();
  }
});

test('A14·E5·E7: 같은 터널에서 실패 뒤 두 번째 요청도 502 / OPTIONS *는 400 / 파이프라이닝 두 요청은 순서대로', async () => {
  const bad = await upstream(badLeaf(null, new Date(Date.now() - DAY), new Date(Date.now() + DAY)), 'secret-body');
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connect('localhost', bad.port);
    const h = `localhost:${bad.port}`;
    assert.match(await exchange(m.t!, GET('/1', h)), /^HTTP\/1\.1 502 /);
    assert.match(await exchange(m.t!, GET('/2', h)), /^HTTP\/1\.1 502 /, '예외 기억 없음');
    m.t!.destroy();
    const n = await connect('localhost', up.port);
    assert.match(await exchange(n.t!, `OPTIONS * HTTP/1.1\r\nHost: localhost:${up.port}\r\n\r\n`), /^HTTP\/1\.1 400 /);
    n.t!.destroy();
    const p = await connect('localhost', up.port);
    const hp = `localhost:${up.port}`;
    const r = await exchange(p.t!, GET('/first', hp) + GET('/second', hp), 2);
    assert.equal((r.match(/HTTP\/1\.1 200 /g) ?? []).length, 2);
    assert.deepEqual(up.got.map((g) => g.url), ['/first', '/second']);
    p.t!.destroy();
  } finally {
    await bad.close();
    await up.close();
  }
});

test('E8·E9·E14: 터널 안 CL·TE 충돌은 목적지에 가지 않는다 / 2MB 본문은 전부 전달·기록은 잘림 표시 / Expect: 100-continue', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  const h = `localhost:${up.port}`;
  try {
    const a = await connect('localhost', up.port);
    const r = await exchange(a.t!, `POST /smuggle HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`);
    assert.equal(/^HTTP\/1\.1 200 /.test(r), false, `응답: ${r.slice(0, 40)}`);
    assert.equal(up.got.length, 0);
    a.t!.destroy();

    mark = ctx.flows.length;
    const b = await connect('localhost', up.port);
    const body = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const r2 = await exchange(b.t!, Buffer.concat([Buffer.from(`POST /big HTTP/1.1\r\nHost: ${h}\r\nContent-Length: ${body.length}\r\n\r\n`), body]), 1, 10_000);
    assert.match(r2, /^HTTP\/1\.1 200 /);
    assert.equal(up.got.at(-1)?.bodySize, body.length);
    b.t!.destroy();
    await until(() => newFlows().length >= 1);
    assert.deepEqual([newFlows()[0].request.bodySize, newFlows()[0].request.bodyTruncated], [body.length, true]);

    const c = await connect('localhost', up.port);
    const r3 = await exchange(c.t!, `POST /cont HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 2\r\nExpect: 100-continue\r\n\r\nhi`, 2);
    assert.match(r3, /HTTP\/1\.1 200 /);
    c.t!.destroy();
  } finally {
    await up.close();
  }
});

test('D5·D9: 발급 도중에 끊어도 프록시는 계속 동작하고, 핸드셰이크 100개(50개씩)도 모두 성공한다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const net = (await import('node:net')).default;
    for (let i = 0; i < 5; i++) {
      const s = net.connect(ctx.proxy.port, '127.0.0.1');
      s.on('error', () => {});
      s.write(`CONNECT new${i}.test:${up.port} HTTP/1.1\r\nHost: new${i}.test:${up.port}\r\n\r\n`);
      setTimeout(() => s.destroy(), 1);
    }
    await sleep(300);
    const all = [];
    for (let b = 0; b < 2; b++) all.push(...(await Promise.all(Array.from({ length: 50 }, () => connect('localhost', up.port)))));
    assert.equal(all.filter((m) => m.status === 200 && m.tlsError === undefined).length, 100);
    all.forEach((m) => m.t?.destroy());
  } finally {
    await up.close();
  }
});
