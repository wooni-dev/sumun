// [PRX-1b] 테스트 공통 준비: 프록시 + 목적지 서버, 이번 테스트에 도착한 요청만 보기
import { before, after, beforeEach } from 'node:test';
import { startProxy } from '../../src/proxy/server.ts';
import { startUpstream } from './_upstream.ts';
import { rawRequest } from './_raw.ts';

export function setup() {
  const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; up: Awaited<ReturnType<typeof startUpstream>> };
  let mark = 0;
  before(async () => {
    ctx.proxy = await startProxy({ port: 0 });
    ctx.up = await startUpstream();
  });
  after(async () => {
    await ctx.proxy.close();
    await ctx.up.close();
  });
  beforeEach(() => (mark = ctx.up.seen.length));
  return {
    ctx,
    arrived: () => ctx.up.seen.slice(mark),
    U: () => `127.0.0.1:${ctx.up.port}`,
    send: (data: string) => rawRequest(ctx.proxy.port, data),
  };
}
