// [PRX-2] 테스트 도우미: 기록(Flow)을 모으는 프록시 + 바이트 그대로 다루는 목적지
import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { startProxy } from '../../src/proxy/server.ts';

// 매번 새로 만드는 표식. 기록 밖(콘솔, 응답, 디스크, 다른 연결)에 나타나면 유출이다 (prx2-cases.md 공통 방법)
export const secret = () => `SUMUN-SECRET-${crypto.randomBytes(8).toString('hex')}`;

export const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

// 0x00~0xFF가 반복되는 n바이트
export const pattern = (n: number) => {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
};

export type Got = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

// 목적지. 경로로 동작을 고른다:
//   /echo         받은 본문을 그대로 돌려준다(Content-Length)
//   /echo-chunked 받은 본문을 여러 조각(chunked)으로 돌려준다
//   /bytes?n=N    pattern(N)을 돌려준다
//   /slow         100ms 기다린 뒤 받은 Cookie를 본문으로 돌려준다(동시 요청이 겹치게)
//   /status/N     상태 N, Content-Length 5000 + 본문(HEAD·204·304는 Node가 본문을 보내지 않음)
//   그 밖          201 "from-upstream"
export async function startByteUpstream() {
  const got: Got[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      got.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const u = new URL(req.url ?? '/', 'http://x');
      if (u.pathname === '/echo') return res.writeHead(200, { 'content-length': body.length }).end(body);
      if (u.pathname === '/echo-chunked') {
        res.writeHead(200);
        for (let i = 0; i < body.length; i += 70_000) res.write(body.subarray(i, i + 70_000));
        return res.end();
      }
      if (u.pathname === '/bytes') {
        const b = pattern(Number(u.searchParams.get('n')));
        return res.writeHead(200, { 'content-length': b.length }).end(b);
      }
      if (u.pathname === '/slow') return setTimeout(() => res.writeHead(200).end(String(req.headers.cookie ?? '')), 100);
      const st = u.pathname.match(/^\/status\/(\d{3})$/);
      if (st) {
        res.writeHead(Number(st[1]), { 'content-length': 5000 });
        return res.end(Number(st[1]) === 200 ? Buffer.alloc(5000, 0x61) : undefined);
      }
      res.writeHead(201, { 'content-type': 'text/plain' }).end('from-upstream');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    got,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

// 프록시 경유 요청. 본문을 Buffer로 받는다. chunks를 주면 Content-Length 없이(chunked) 나눠 보낸다.
export function send(
  proxyPort: number,
  o: { target: string; method?: string; headers?: Record<string, string | string[]>; body?: Buffer; chunks?: Buffer[] },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: o.method ?? 'GET', path: o.target, agent: false });
    for (const [k, v] of Object.entries(o.headers ?? {})) req.setHeader(k, v);
    req.on('response', (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    if (o.chunks) {
      for (const c of o.chunks) req.write(c);
      req.end();
    } else req.end(o.body);
  });
}

// 기록을 모으는 프록시 + 목적지. 각 테스트는 take(n)으로 그 테스트에서 생긴 기록만 받는다.
export function recordingSetup() {
  const ctx = {} as {
    proxy: Awaited<ReturnType<typeof startProxy>>;
    up: Awaited<ReturnType<typeof startByteUpstream>>;
    flows: any[];
  };
  let mark = 0;
  before(async () => {
    ctx.flows = [];
    // onFlow는 PRX-2에서 생긴다. 그 전에는 무시된다(타입 검사를 하지 않으므로 실행은 됨)
    ctx.proxy = await startProxy({ port: 0, upstreamTimeoutMs: 300, headersTimeoutMs: 300, onFlow: (f: any) => ctx.flows.push(f) } as Parameters<
      typeof startProxy
    >[0]);
    ctx.up = await startByteUpstream();
  });
  after(async () => {
    await ctx.proxy.close();
    await ctx.up.close();
  });
  beforeEach(() => (mark = ctx.flows.length));

  // 이 테스트에서 생긴 기록이 n개가 될 때까지 기다린다. 시간 안에 못 받으면 assertion으로 실패한다(오류가 아니라).
  // 받은 뒤 150ms 더 기다려서 n개보다 많이 오지 않는지(요청당 정확히 1번, I5)도 본다.
  const take = async (n: number, ms = 2000) => {
    const until = Date.now() + ms;
    while (ctx.flows.length - mark < n && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    assert.equal(ctx.flows.length - mark, n, `기록 ${n}개를 기다렸지만 ${ctx.flows.length - mark}개를 받음`);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(ctx.flows.length - mark, n, '요청 수보다 기록이 많다(같은 요청을 두 번 기록)');
    return ctx.flows.slice(mark, mark + n);
  };
  return { ctx, take, U: () => `127.0.0.1:${ctx.up.port}` };
}

// 헤더 목록 [이름, 값][]에서 이름(대소문자 무시)으로 값 찾기
export const header = (pairs: [string, string][], name: string) => pairs.filter(([n]) => n.toLowerCase() === name).map(([, v]) => v);

// 자식 프로세스로 기록 프록시를 띄운다. out = 프록시 프로세스의 stdout+stderr 전체, flows = 구독자가 불린 횟수
export async function childProxy(mode: 'ok' | 'throw' | 'reject') {
  const { fork } = await import('node:child_process');
  const child = fork(new URL('./_flow-child.ts', import.meta.url), [mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const state = { out: '', flows: 0, exited: null as number | null };
  child.stdout!.on('data', (c) => (state.out += c));
  child.stderr!.on('data', (c) => (state.out += c));
  child.on('exit', (code) => (state.exited = code ?? -1));
  child.on('message', (m: any) => m?.type === 'flow' && state.flows++);
  const port = await new Promise<number>((resolve, reject) => {
    child.on('message', (m: any) => m?.type === 'ready' && resolve(m.port));
    child.on('exit', () => reject(new Error(`자식 프록시가 시작 전에 끝남: ${state.out}`)));
  });
  return {
    port,
    state,
    stop: () => new Promise<void>((r) => (state.exited !== null ? r() : (child.once('exit', () => r()), child.kill()))),
  };
}
