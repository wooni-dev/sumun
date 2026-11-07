// [TLS-1b] 회귀: 구현 전에도 통과해야 정상인 터널 견고성(O9). 사례 번호는 docs/ai/tls1-cases.md.
//   R6a 클라이언트가 먼저 쓰기를 닫음 [확인됨: scripts/probe/tls1b-halfclose.mjs E60]
//   R7  양방향 50MB, 느린 클라이언트 역압 [E63: 멈춘 동안 차이 1.3MB → 상한 8MB]
//   R12 동시 터널 300개 / R13 열린 터널이 있는 채로 close()
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { startProxy } from '../../src/proxy/server.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}
const MB = 1024 * 1024;
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[] };
let mark = 0;
before(async () => {
  ctx.flows = [];
  ctx.proxy = await startProxy({ port: 0, tunnel: true, onFlow: (f: any) => void ctx.flows.push(f) } as Parameters<typeof startProxy>[0]);
});
after(async () => ctx.proxy.close());
beforeEach(() => (mark = ctx.flows.length));
async function take(n: number, ms = 5000) {
  await until(() => ctx.flows.length - mark >= n, ms);
  assert.equal(ctx.flows.length - mark, n, `기록 ${n}개를 기다렸지만 ${ctx.flows.length - mark}개`);
  await sleep(100);
  assert.equal(ctx.flows.length - mark, n, '기록이 더 많다');
  return ctx.flows.slice(mark);
}
async function listen(server: net.Server) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return (server.address() as net.AddressInfo).port;
}
function client(proxyPort = ctx.proxy.port) {
  const s = net.connect({ port: proxyPort, host: '127.0.0.1', allowHalfOpen: true });
  const st = { chunks: [] as Buffer[], size: 0, ended: false, closed: false };
  s.on('data', (d) => (st.chunks.push(d), (st.size += d.length)));
  s.on('end', () => (st.ended = true));
  s.on('error', () => {});
  s.on('close', () => (st.closed = true));
  // 200 줄을 뺀 터널 데이터
  const body = () => {
    const all = Buffer.concat(st.chunks);
    const i = all.indexOf('\r\n\r\n');
    return i < 0 ? Buffer.alloc(0) : all.subarray(i + 4);
  };
  return { s, st, body };
}
const CONNECT = (port: number) => `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\n`;

test('R6a: 클라이언트가 먼저 쓰기를 닫으면(FIN) 목적지는 FIN을 받은 뒤 답할 수 있고, 클라이언트가 답을 다 받는다', async () => {
  const server = net.createServer({ allowHalfOpen: true }, (s) => {
    let got = '';
    s.on('error', () => {});
    s.on('data', (d) => (got += d));
    s.on('end', () => s.end(`got:${got}`));
  });
  const port = await listen(server);
  const c = client();
  try {
    c.s.write(CONNECT(port));
    await until(() => c.st.size > 0);
    c.s.end('hello');
    await until(() => c.st.closed);
    assert.equal(c.body().toString(), 'got:hello');
    const [f] = await take(1);
    assert.equal(f.error, undefined);
    assert.deepEqual([f.tunnel.bytesUp, f.tunnel.bytesDown], [5, 9]);
  } finally {
    c.s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('R7: 양방향 50MB를 동시에 보내도 바이트가 그대로(sha256 같음)이고 기록의 바이트 수가 맞다', async () => {
  const SIZE = 50 * MB;
  const down = crypto.randomBytes(SIZE);
  const up = crypto.randomBytes(SIZE);
  let upstreamGot: Buffer[] = [];
  let upstreamSize = 0;
  const server = net.createServer({ allowHalfOpen: true }, (s) => {
    s.on('error', () => {});
    s.on('data', (d) => (upstreamGot.push(d), (upstreamSize += d.length)));
    s.on('end', () => s.end());
    s.write(down);
  });
  const port = await listen(server);
  const c = client();
  try {
    c.s.write(CONNECT(port));
    await until(() => c.st.size > 0);
    c.s.write(up);
    await until(() => upstreamSize >= SIZE && c.body().length >= SIZE, 30_000);
    assert.equal(sha(Buffer.concat(upstreamGot)), sha(up), '클라이언트 → 목적지');
    assert.equal(sha(c.body()), sha(down), '목적지 → 클라이언트');
    c.s.end();
    const [f] = await take(1);
    assert.deepEqual([f.tunnel.bytesUp, f.tunnel.bytesDown], [SIZE, SIZE]);
    assert.equal(f.error, undefined);
  } finally {
    upstreamGot = [];
    c.s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('R7: 클라이언트가 읽기를 멈추면 목적지도 멈춘다(역압 — 쌓이는 양 8MB 이하), 다시 읽으면 전부 온다', async () => {
  const TOTAL = 32 * MB;
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let written = 0;
  const server = net.createServer((s) => {
    s.on('error', () => {});
    const pump = () => {
      while (written < TOTAL) {
        written += chunk.length;
        if (!s.write(chunk)) return s.once('drain', pump);
      }
      s.end();
    };
    pump();
  });
  const port = await listen(server);
  const c = client();
  try {
    c.s.write(CONNECT(port));
    await until(() => c.st.size > 0);
    c.s.pause();
    await sleep(1000);
    const backlog = written - c.st.size;
    assert.ok(written > 0, '전제: 목적지가 쓰기 시작했다');
    assert.ok(written < TOTAL, `전제: 멈춘 동안 다 보내지 못했다(written ${written})`);
    assert.ok(backlog <= 8 * MB, `멈춘 동안 쌓인 양 ${(backlog / MB).toFixed(1)}MB`);
    c.s.resume();
    await until(() => c.st.ended, 10_000);
    assert.equal(c.body().length, TOTAL);
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.tunnel.bytesDown, TOTAL);
  } finally {
    c.s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('R12: 동시 터널 300개 — 서로 섞이지 않고 기록 300개의 바이트 수가 각각 맞다', async () => {
  const N = 300;
  const server = net.createServer({ allowHalfOpen: true }, (s) => {
    s.on('error', () => {});
    s.on('data', (d) => s.write(d));
    s.on('end', () => s.end());
  });
  const port = await listen(server);
  const clients: ReturnType<typeof client>[] = [];
  try {
    const payload = (i: number) => `tunnel-${i}-`.repeat(1 + (i % 7));
    // 300개를 같은 순간에 열면 프록시가 없어도 이 PC가 일부를 ECONNREFUSED로 거절한다(프록시 → 목적지 쪽도 같다)
    // [확인됨: scripts/probe/tls1b-concurrency.mjs 300 direct → 232개만 연결, tls1b-backlog.mjs → backlog를 올려도 232].
    // 그래서 50개씩 열고 그 묶음의 터널이 이어진 것을 본 뒤 다음 묶음을 연다. 검사는 300개를 모두 연 채로 한다
    for (let b = 0; b < N; b += 50) {
      const batch = Array.from({ length: 50 }, () => client());
      clients.push(...batch);
      batch.forEach((c, k) => c.s.write(CONNECT(port) + payload(b + k)));
      await until(() => batch.every((c, k) => c.body().toString() === payload(b + k)), 5000);
    }
    assert.ok(clients.every((c) => !c.st.closed && !c.st.ended), '전제: 300개 모두 열려 있다');
    clients.forEach((c, i) => assert.equal(c.body().toString(), payload(i), `터널 ${i}`));
    clients.forEach((c) => c.s.end());
    const flows = await take(N, 10_000);
    const sizes = flows.map((f) => f.tunnel.bytesUp).sort((a, b) => a - b);
    const want = clients.map((_, i) => payload(i).length).sort((a, b) => a - b);
    assert.deepEqual(sizes, want);
    assert.ok(flows.every((f) => f.error === undefined && f.tunnel.bytesUp === f.tunnel.bytesDown));
  } finally {
    clients.forEach((c) => c.s.destroy());
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('R13: 열린 터널 20개가 있는 채로 close() → 1초 안에 끝나고 클라이언트 20개가 모두 닫힌다', async () => {
  const upSockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    upSockets.add(s);
    s.on('close', () => upSockets.delete(s));
    s.on('error', () => {});
    s.on('data', (d) => s.write(d));
  });
  const port = await listen(server);
  const proxy = await startProxy({ port: 0, tunnel: true } as Parameters<typeof startProxy>[0]);
  const clients = Array.from({ length: 20 }, () => client(proxy.port));
  try {
    clients.forEach((c) => c.s.write(CONNECT(port) + 'x'));
    await until(() => clients.every((c) => c.body().toString() === 'x'));
    assert.ok(clients.every((c) => c.body().toString() === 'x' && !c.st.closed), '전제: 20개 모두 열려 있고 데이터가 오간다');
    const t0 = Date.now();
    await Promise.race([proxy.close(), sleep(3000)]);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1000, `close() ${elapsed}ms`);
    // 클라이언트는 반쪽 닫기를 허용하므로 스스로 닫지 않는다 — 프록시가 보낸 FIN(end)이나 끊김(close)으로 본다
    await until(() => clients.every((c) => c.st.ended || c.st.closed));
    assert.equal(clients.filter((c) => c.st.ended || c.st.closed).length, 20);
  } finally {
    clients.forEach((c) => c.s.destroy());
    upSockets.forEach((s) => s.destroy());
    await new Promise<void>((r) => server.close(() => r()));
  }
});
