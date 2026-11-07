// [TLS-1b] 새 동작: 터널 견고성. 사례 번호는 docs/ai/tls1-cases.md.
//   R6(결정 6): 반쪽 닫기(FIN)를 해석 없이 넘긴다. 목적지가 먼저 쓰기를 닫아도 클라이언트 → 목적지 방향은 계속 흐른다
//   R8: startProxy({ connectUpstream }) — 목적지 TCP 연결 함수(테스트 주입, 기본 net.connect).
//       검사한 주소로 부르고, 연결이 upstreamTimeoutMs 안에 끝나지 않으면 504
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { closedPort } from '../prx/_upstream.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}

type Call = { host?: string; port?: number };
const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[]; hang: boolean; calls: Call[]; sockets: net.Socket[] };
let mark = 0;
before(async () => {
  ctx.flows = [];
  ctx.hang = false;
  ctx.calls = [];
  ctx.sockets = [];
  ctx.proxy = await startProxy({
    port: 0,
    tunnel: true,
    upstreamTimeoutMs: 300,
    lookup: async (host: string) => {
      if (host === 'hang.test') return [{ address: '127.0.0.1', family: 4 }];
      throw Object.assign(new Error('없는 이름'), { code: 'ENOTFOUND' });
    },
    // hang이면 연결이 영영 끝나지 않는 소켓을 준다(SYN에 답이 없는 목적지 흉내)
    connectUpstream: (o: net.NetConnectOpts & Call) => {
      ctx.calls.push({ host: o.host, port: o.port });
      const s = ctx.hang ? new net.Socket() : net.connect(o);
      ctx.sockets.push(s);
      return s;
    },
    onFlow: (f: any) => void ctx.flows.push(f),
  } as Parameters<typeof startProxy>[0]);
});
after(async () => ctx.proxy.close());
beforeEach(() => ((mark = ctx.flows.length), (ctx.hang = false), (ctx.calls = []), (ctx.sockets = [])));
async function take(n: number, ms = 2000) {
  await until(() => ctx.flows.length - mark >= n, ms);
  assert.equal(ctx.flows.length - mark, n, `기록 ${n}개를 기다렸지만 ${ctx.flows.length - mark}개`);
  await sleep(100);
  assert.equal(ctx.flows.length - mark, n, '기록이 더 많다(같은 터널을 두 번 기록)');
  return ctx.flows.slice(mark);
}

// 반쪽 닫기를 허용하는 원시 클라이언트: FIN을 받아도 스스로 쓰기를 닫지 않는다
function client() {
  const s = net.connect({ port: ctx.proxy.port, host: '127.0.0.1', allowHalfOpen: true });
  const st = { buf: Buffer.alloc(0), ended: false, closed: false };
  s.on('data', (d) => (st.buf = Buffer.concat([st.buf, d])));
  s.on('end', () => (st.ended = true));
  s.on('error', () => {});
  s.on('close', () => (st.closed = true));
  const text = () => st.buf.toString('utf8');
  return { s, st, text, body: () => text().split('\r\n\r\n').slice(1).join('\r\n\r\n') };
}

test('R6b: 목적지가 먼저 쓰기를 닫아도(FIN) 클라이언트가 그 뒤 보낸 데이터는 목적지에 닿고, 클라이언트가 닫으면 기록 1개(실패 아님)', async () => {
  let received = '';
  let upstreamEnded = false;
  const server = net.createServer({ allowHalfOpen: true }, (s) => {
    s.on('error', () => {});
    s.on('data', (d) => (received += d));
    s.on('end', () => ((upstreamEnded = true), s.end()));
    s.end('greeting'); // 인사만 보내고 쓰기를 닫는다(읽기는 계속)
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const c = client();
  try {
    c.s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    await until(() => c.st.ended);
    assert.equal(c.st.ended, true, '전제: 목적지의 FIN이 클라이언트까지 온다');
    assert.equal(c.body(), 'greeting');
    c.s.write('after-fin');
    await until(() => received === 'after-fin');
    assert.equal(received, 'after-fin', '목적지가 FIN을 보낸 뒤에도 클라이언트 → 목적지 방향은 열려 있어야 한다');
    c.s.end();
    await until(() => upstreamEnded);
    assert.equal(upstreamEnded, true, '클라이언트의 FIN도 목적지로 넘어간다');
    const [f] = await take(1);
    assert.equal(f.error, undefined);
    assert.equal(f.tunnel.bytesUp, 'after-fin'.length);
    assert.equal(f.tunnel.bytesDown, 'greeting'.length);
    await until(() => c.st.closed);
    assert.equal(c.st.closed, true, '양쪽이 다 닫힌 뒤에는 클라이언트 연결도 끝난다');
  } finally {
    c.s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('R8: 연결이 끝나지 않는 목적지 → upstreamTimeoutMs(300ms) 뒤 504(고정 문구), 기록 timeout, 연결 소켓 정리', async () => {
  ctx.hang = true;
  const port = await closedPort();
  const c = client();
  try {
    const t0 = Date.now();
    c.s.write(`CONNECT hang.test:${port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    await until(() => c.st.ended, 3000);
    const elapsed = Date.now() - t0;
    assert.match(c.text(), /^HTTP\/1\.1 504 /);
    assert.ok(c.text().includes('목적지 서버가 응답하지 않습니다.'));
    assert.equal(c.text().includes('hang.test'), false, '입력을 응답에 반영하지 않는다(고정 문구)');
    assert.ok(elapsed >= 250 && elapsed < 2000, `타임아웃 시간을 지킨다: ${elapsed}ms`);
    assert.deepEqual(ctx.calls, [{ host: '127.0.0.1', port }], '검사한 주소로 연결 함수를 한 번 부른다(결정 12)');
    assert.equal(ctx.sockets[0]?.destroyed, true, '연결하지 못한 소켓은 destroy한다');
    const [f] = await take(1);
    assert.deepEqual(f.error, { by: 'upstream', code: 'timeout', status: 504 });
  } finally {
    c.s.destroy();
  }
});

test('R8: connectUpstream으로 연결해도 터널은 평소처럼 동작한다(주입한 함수의 소켓으로 바이트가 오간다)', async () => {
  const server = net.createServer((s) => (s.on('error', () => {}), s.on('data', (d) => s.write(d))));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const c = client();
  try {
    c.s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\nping`);
    await until(() => c.body() === 'ping');
    assert.equal(c.body(), 'ping');
    assert.equal(ctx.calls.length, 1, '주입한 연결 함수를 썼다');
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.error, undefined);
    assert.deepEqual([f.tunnel.bytesUp, f.tunnel.bytesDown], [4, 4]);
  } finally {
    c.s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
