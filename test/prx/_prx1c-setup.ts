// [PRX-1c] 테스트 공통 준비: 짧은 타임아웃을 건 프록시 + 목적지, 원시 목적지 도우미
import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { startUpstream, viaProxy } from './_upstream.ts';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';

export function setup() {
  const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; up: Awaited<ReturnType<typeof startUpstream>> };
  let mark = 0;
  before(async () => {
    // 타임아웃 옵션은 PRX-1c에서 생긴다. 그 전에는 무시된다(타입 검사를 하지 않으므로 실행은 됨)
    ctx.proxy = await startProxy({ port: 0, upstreamTimeoutMs: 300, headersTimeoutMs: 300 } as Parameters<typeof startProxy>[0]);
    ctx.up = await startUpstream();
  });
  after(async () => {
    await ctx.proxy.close();
    await ctx.up.close();
  });
  beforeEach(() => (mark = ctx.up.seen.length));
  const U = () => `127.0.0.1:${ctx.up.port}`;
  return {
    ctx,
    U,
    arrived: () => ctx.up.seen.slice(mark),
    alive: async () => assert.equal((await viaProxy(ctx.proxy.port, { target: `http://${U()}/alive` })).status, 201, '프록시가 계속 동작해야 함'),
    // 원시 목적지를 하나 띄우고, 그 목적지로 프록시 경유 원시 요청을 보낸다
    withRaw: async (respond: (s: net.Socket, req: string) => void, request: (port: number) => string, waitMs = 1000) => {
      const raw = await startRawUpstream(respond);
      try {
        return await rawRequest(ctx.proxy.port, request(raw.port), waitMs);
      } finally {
        await raw.close();
      }
    },
    get: (path = '/') => (port: number) => `GET http://127.0.0.1:${port}${path} HTTP/1.1\r\nHost: x\r\n\r\n`,
  };
}
