// [TLS-1] 새 동작: CONNECT 불투명 터널. 사례 번호는 docs/ai/tls1-cases.md.
//   startProxy({ tunnel: true }) — CONNECT host:port → 목적지 TCP 연결 → "200 Connection Established" → 바이트를 해석 없이 이어 줌
//   기록: { request: { method: 'CONNECT', url, target: { scheme: 'https', host, port, path: '' } }, tunnel: { bytesUp, bytesDown, address }, error? }
//   lookup 옵션: 테스트용 이름 해석(인터넷에 묻지 않음). 한 번만 해석하고 검사한 주소로 연결한다(Q5)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { parseConnectTarget, isLoopTarget } from '../../src/tls/tunnel.ts';
import { formatSummary } from '../../src/cli.ts';
import { closedPort } from '../prx/_upstream.ts';
import { startByteUpstream } from '../prx/_flow.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- 단위: 대상 해석 (P1~P9) ---
test('P: 받는 대상 — host:port, 대문자는 소문자로, [IPv6]:port, punycode', () => {
  assert.deepEqual(parseConnectTarget('example.com:443'), { host: 'example.com', port: 443 });
  assert.deepEqual(parseConnectTarget('EXAMPLE.com:8443'), { host: 'example.com', port: 8443 });
  assert.deepEqual(parseConnectTarget('127.0.0.1:1'), { host: '127.0.0.1', port: 1 });
  assert.deepEqual(parseConnectTarget('[::1]:443'), { host: '[::1]', port: 443 });
  assert.deepEqual(parseConnectTarget('xn--r8jz45g.jp:65535'), { host: 'xn--r8jz45g.jp', port: 65535 });
  assert.deepEqual(parseConnectTarget('localhost.:443'), { host: 'localhost.', port: 443 });
});
const REJECT = [
  'example.com', 'example.com:', ':443', 'example.com:0', 'example.com:65536', 'example.com:-1', 'example.com:+443', 'example.com:443abc', 'example.com:0x1bb', 'example.com:00443', // P1
  'user:pass@example.com:443', // P2
  '[::1]', '::1:443', '[fe80::1%25eth0]:443', '[::1]:443x', '[nothex]:443', // P3
  'example.com:443/path', 'example.com:443?x=1', 'example.com:443#f', 'http://example.com:443', '/', '*', // P4
  'good.com:443@evil.com:443', 'evil.com\\@good.com:443', // P5
  'ex%61mple.com:443', '%31%32%37.0.0.1:443', '例え.jp:443', // P7
  '2130706433:443', '0x7f000001:443', '0177.0.0.1:443', '127.1:443', '127.0.0.01:443', '256.0.0.1:443', // P8
  `${'a'.repeat(64)}.com:443`, `${'a.'.repeat(127)}com:443`, `${'a'.repeat(10_000)}:443`, // P9
  'exa mple.com:443', 'example..com:443', '-bad.com:443',
];
for (const t of REJECT) {
  test(`P: ${JSON.stringify(t.length > 60 ? `${t.slice(0, 57)}...` : t)} → 거절`, () => {
    assert.equal(typeof parseConnectTarget(t)?.error, 'string');
  });
}

// --- 단위: 루프 판정 (Q1, Q5) ---
test('Q1·Q5: 해석한 주소 중 하나라도 이 PC 자신(127/8, ::1, IPv4-mapped, 0.0.0.0, ::)이고 포트가 프록시 포트면 루프', () => {
  for (const a of [['127.0.0.1'], ['127.0.0.2'], ['::1'], ['::ffff:127.0.0.1'], ['0.0.0.0'], ['::'], ['93.184.216.34', '127.0.0.1']]) {
    assert.equal(isLoopTarget(a, 8080, 8080), true, JSON.stringify(a));
  }
  assert.equal(isLoopTarget(['127.0.0.1'], 9000, 8080), false, '같은 PC의 다른 포트는 루프 아님(결정 2)');
  assert.equal(isLoopTarget(['192.168.0.1'], 8080, 8080), false);
});

// --- 통합 ---
type Echo = { port: number; received: Buffer[]; conns: number; close: () => Promise<void> };
// 받은 바이트를 그대로 돌려주는 목적지. mode로 다른 동작
async function startEcho(mode: 'echo' | 'end-after-first' | 'reset-after-first' = 'echo'): Promise<Echo> {
  const sockets = new Set<net.Socket>();
  const e = { received: [] as Buffer[], conns: 0 } as Echo;
  const server = net.createServer((s) => {
    e.conns++;
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    s.on('data', (d) => {
      e.received.push(d);
      if (mode === 'echo') s.write(d);
      if (mode === 'end-after-first') s.end(d);
      if (mode === 'reset-after-first') (s.write('partial'), setTimeout(() => s.resetAndDestroy(), 50));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  e.port = (server.address() as net.AddressInfo).port;
  e.close = () => new Promise<void>((r) => (sockets.forEach((s) => s.destroy()), server.close(() => r())));
  return e;
}

const NAMES: Record<string, { address: string; family: number }[]> = {
  localhost: [{ address: '127.0.0.1', family: 4 }],
  'localhost.': [{ address: '127.0.0.1', family: 4 }],
  'rebind.test': [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
};
const ctx = {} as { proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[]; starts: any[] };
let mark = 0;
before(async () => {
  ctx.flows = [];
  ctx.starts = [];
  ctx.proxy = await startProxy({
    port: 0,
    tunnel: true,
    upstreamTimeoutMs: 300,
    lookup: async (host: string) => {
      const r = NAMES[host];
      if (!r) throw Object.assign(new Error('없는 이름'), { code: 'ENOTFOUND' });
      return r;
    },
    onFlow: (f: any) => void ctx.flows.push(f),
    onFlowStart: (s: any) => void ctx.starts.push(s),
  } as Parameters<typeof startProxy>[0]);
});
after(async () => ctx.proxy.close());
beforeEach(() => (mark = ctx.flows.length));
async function take(n: number, ms = 2000) {
  const end = Date.now() + ms;
  while (ctx.flows.length - mark < n && Date.now() < end) await sleep(20);
  assert.equal(ctx.flows.length - mark, n, `기록 ${n}개를 기다렸지만 ${ctx.flows.length - mark}개`);
  await sleep(100);
  assert.equal(ctx.flows.length - mark, n, '기록이 더 많다(같은 터널을 두 번 기록)');
  return ctx.flows.slice(mark);
}

// 원시 소켓: 보낸 뒤 받은 바이트를 모은다
function client(port = ctx.proxy.port) {
  const s = net.connect(port, '127.0.0.1');
  const st = { buf: Buffer.alloc(0), closed: false, hadError: false };
  s.on('data', (d) => (st.buf = Buffer.concat([st.buf, d])));
  s.on('error', () => (st.hadError = true));
  s.on('close', (e) => ((st.closed = true), (st.hadError ||= e)));
  const until = async (cond: () => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(10);
  };
  return { s, st, text: () => st.buf.toString('latin1'), until, ready: new Promise<void>((r) => s.once('connect', () => r())) };
}
const head = (raw: string) => raw.split('\r\n\r\n')[0];

test('기본: CONNECT → 200 Connection Established(CL·TE 없음) → 바이트가 그대로 오가고, 기록 1개(바이트 수, 연결한 주소)', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: 127.0.0.1:${echo.port}\r\n\r\n`);
    await c.until(() => c.text().includes('\r\n\r\n'));
    assert.match(c.text(), /^HTTP\/1\.1 200 Connection Established\r\n/);
    assert.ok(!/content-length|transfer-encoding/i.test(head(c.text())), `R4: ${JSON.stringify(head(c.text()))}`);
    const before200 = c.st.buf.length;
    c.s.write('ping-1234');
    await c.until(() => c.st.buf.length >= before200 + 9);
    assert.equal(c.st.buf.subarray(before200).toString(), 'ping-1234');
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.request.method, 'CONNECT');
    assert.equal(f.request.url, `127.0.0.1:${echo.port}`);
    assert.deepEqual(f.request.target, { scheme: 'https', host: '127.0.0.1', port: echo.port, path: '' });
    assert.deepEqual(f.tunnel, { bytesUp: 9, bytesDown: 9, address: '127.0.0.1' });
    assert.equal(f.response, undefined, '200은 프록시가 만든 응답이라 response에 넣지 않는다(PRX-2 H12)');
    assert.equal(f.error, undefined);
    assert.ok(f.durationMs >= 0);
    assert.ok(ctx.starts.some((s) => s.id === f.id), '시작 알림도 같은 id로 와야 함');
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R1·S1: CONNECT와 같은 write로 보낸 데이터(head)는 목적지에 정확히 한 번, 먼저 가고 바이트 수에 포함된다', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\nEARLY`);
    await c.until(() => c.text().includes('EARLY'));
    c.s.write('LATE');
    await c.until(() => c.text().includes('LATE'));
    assert.equal(Buffer.concat(echo.received).toString(), 'EARLYLATE');
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.tunnel.bytesUp, 9);
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R3: CONNECT 뒤에 이어 온 HTTP 요청 글자는 프록시 요청이 아니라 터널 데이터다(기록은 터널 1개뿐)', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    const smuggled = 'GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: x\r\n\r\n';
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\n${smuggled}`);
    await c.until(() => Buffer.concat(echo.received).length >= smuggled.length);
    assert.equal(Buffer.concat(echo.received).toString(), smuggled);
    c.s.end();
    const fs = await take(1);
    assert.equal(fs[0].request.method, 'CONNECT');
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R3: keep-alive 연결에서 평문 GET을 처리한 뒤 같은 연결로 CONNECT도 된다', async () => {
  const up = await startByteUpstream();
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`GET http://127.0.0.1:${up.port}/x HTTP/1.1\r\nHost: x\r\n\r\n`);
    await c.until(() => c.text().includes('from-upstream'));
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    await c.until(() => c.text().includes('Connection Established'));
    c.s.write('after');
    await c.until(() => c.text().endsWith('after'));
    c.s.end();
    const fs = await take(2);
    assert.deepEqual(fs.map((f) => f.request.method), ['GET', 'CONNECT']);
  } finally {
    c.s.destroy();
    await echo.close();
    await up.close();
  }
});

// 한 번 보내고 응답 상태 줄만 본다
async function connectStatus(target: string, extra = '') {
  const c = client();
  await c.ready;
  c.s.write(`CONNECT ${target} HTTP/1.1\r\nHost: x\r\n${extra}\r\n`);
  await c.until(() => c.st.closed || /\r\n\r\n/.test(c.text()), 3000);
  c.s.destroy();
  return Number(c.text().match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0);
}
test('P2·P8: userinfo, 숫자 IP 변형은 400이고 연결하지 않는다', async () => {
  const echo = await startEcho();
  try {
    for (const t of [`user:pass@127.0.0.1:${echo.port}`, `2130706433:${echo.port}`, `127.1:${echo.port}`]) {
      assert.equal(await connectStatus(t), 400, t);
    }
    assert.equal(echo.conns, 0);
    const fs = await take(3);
    for (const f of fs) assert.deepEqual([f.error?.by, f.error?.code, f.error?.status], ['proxy', 'rejected', 400]);
  } finally {
    await echo.close();
  }
});
test('Q1·Q5·P8: 자기 자신으로 가는 터널은 508 — 주소 표기, 이름(대소문자·끝점), 여러 주소 중 하나만 자기인 경우', async () => {
  const self = ctx.proxy.port;
  for (const t of [`127.0.0.1:${self}`, `127.0.0.2:${self}`, `[::1]:${self}`, `[::ffff:127.0.0.1]:${self}`, `0.0.0.0:${self}`, `localhost:${self}`, `LOCALHOST:${self}`, `localhost.:${self}`, `rebind.test:${self}`]) {
    assert.equal(await connectStatus(t), 508, t);
  }
  const fs = await take(9);
  for (const f of fs) assert.deepEqual([f.error?.code, f.error?.status], ['loop', 508]);
});
test('Q2·Q4: 같은 PC의 다른 포트(443이 아닌 포트)는 허용한다(결정 1, 2)', async () => {
  const echo = await startEcho();
  try {
    assert.equal(await connectStatus(`localhost:${echo.port}`), 200);
    await take(1);
  } finally {
    await echo.close();
  }
});
test('R2: CONNECT에 Content-Length나 Transfer-Encoding이 있으면 400(본문 없음 — RFC 9110 9.3.6)', async () => {
  const echo = await startEcho();
  try {
    assert.equal(await connectStatus(`127.0.0.1:${echo.port}`, 'Content-Length: 5\r\n'), 400);
    assert.equal(await connectStatus(`127.0.0.1:${echo.port}`, 'Transfer-Encoding: chunked\r\n'), 400);
    assert.equal(echo.conns, 0);
    await take(2);
  } finally {
    await echo.close();
  }
});
test('P10: Host 헤더가 대상과 달라도 대상 기준으로 연결·기록하고, Host가 두 개면 400', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: other.test:1\r\n\r\n`);
    await c.until(() => c.text().includes('\r\n\r\n'));
    assert.match(c.text(), /^HTTP\/1\.1 200/);
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.request.target.host, '127.0.0.1');
    mark = ctx.flows.length;
    const d = client();
    await d.ready;
    d.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n`);
    await d.until(() => d.text().includes('\r\n\r\n') || d.st.closed);
    assert.match(d.text(), /^HTTP\/1\.1 400/);
    d.s.destroy();
    await take(1);
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R10: 닫힌 포트, 없는 이름 → 502(고정 문구), 기록 unreachable', async () => {
  assert.equal(await connectStatus(`127.0.0.1:${await closedPort()}`), 502);
  assert.equal(await connectStatus('nonexistent.invalid:443'), 502);
  const fs = await take(2);
  for (const f of fs) assert.deepEqual(f.error, { by: 'upstream', code: 'unreachable', status: 502 });
});
test('R9: 연결된 뒤에는 연결 타임아웃(300ms)보다 오래 쉬어도 끊지 않는다', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    await c.until(() => c.text().includes('\r\n\r\n'));
    await sleep(700);
    c.s.write('late');
    await c.until(() => c.text().endsWith('late'));
    assert.ok(c.text().endsWith('late'), '쉰 뒤에도 데이터가 오가야 함');
    c.s.end();
    const [f] = await take(1);
    assert.equal(f.error, undefined);
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R5a: 목적지가 먼저 끝내면 클라이언트 쪽도 끝나고 기록 1개(실패 아님)', async () => {
  const echo = await startEcho('end-after-first');
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\nbye`);
    await c.until(() => c.st.closed, 2000);
    assert.equal(c.st.closed, true);
    const [f] = await take(1);
    assert.equal(f.error, undefined);
    assert.equal(f.tunnel.bytesDown, 3);
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('R5c·R11: 클라이언트 RST → 기록 by client aborted / 200 뒤 목적지 RST → 클라이언트를 정상 종료로 위장하지 않고 끊음, 기록 by upstream aborted', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\nhi`);
    await c.until(() => c.text().endsWith('hi'));
    c.s.resetAndDestroy();
    const [f1] = await take(1);
    assert.deepEqual(f1.error, { by: 'client', code: 'aborted' });
  } finally {
    c.s.destroy();
    await echo.close();
  }

  mark = ctx.flows.length;
  const bad = await startEcho('reset-after-first');
  const d = client();
  try {
    await d.ready;
    d.s.write(`CONNECT 127.0.0.1:${bad.port} HTTP/1.1\r\nHost: x\r\n\r\nhi`);
    await d.until(() => d.st.closed, 2000);
    assert.equal(d.st.hadError, true, '잘린 데이터를 완전한 것처럼 끝내면 안 됨(destroy)');
    const [f2] = await take(1);
    assert.deepEqual(f2.error, { by: 'upstream', code: 'aborted' });
  } finally {
    d.s.destroy();
    await bad.close();
  }
});
test('S3: 터널로 오간 내용은 기록에 들어가지 않는다', async () => {
  const echo = await startEcho();
  const c = client();
  try {
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\nSECRET-MARKER-7f3a`);
    await c.until(() => c.text().includes('SECRET-MARKER-7f3a'));
    c.s.end();
    const [f] = await take(1);
    const json = JSON.stringify(f, (_k, v) => (v?.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v));
    assert.ok(!json.includes('SECRET-MARKER-7f3a'), json.slice(0, 300));
  } finally {
    c.s.destroy();
    await echo.close();
  }
});
test('S4: 터널 기록의 요약 줄은 CONNECT, 대상, 바이트 수만(userinfo·Proxy-Authorization 없음)', () => {
  const line = formatSummary({
    id: 1, startedAt: Date.now(), durationMs: 5,
    request: { method: 'CONNECT', url: 'example.com:443', httpVersion: '1.1', headers: [['Proxy-Authorization', 'Basic SECRET']], body: Buffer.alloc(0), bodySize: 0, bodyTruncated: false, target: { scheme: 'https', host: 'example.com', port: 443, path: '' } },
    tunnel: { bytesUp: 517, bytesDown: 4096, address: '93.184.216.34' },
  } as any);
  assert.equal(typeof line, 'string');
  for (const part of ['CONNECT', 'example.com:443', 'tunnel', '517', '4096']) assert.ok(line.includes(part), `${part}: ${line}`);
  assert.ok(!line.includes('SECRET'), line);
});
test('npm start(src/index.ts)는 터널을 켠다', async () => {
  const echo = await startEcho();
  const P = await closedPort();
  const child = spawn(process.execPath, ['src/index.ts', '--port', String(P)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  try {
    for (let i = 0; i < 150 && !out.includes('127.0.0.1:'); i++) await sleep(20);
    const c = client(P);
    await c.ready;
    c.s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    await c.until(() => c.text().includes('\r\n\r\n'));
    assert.match(c.text(), /^HTTP\/1\.1 200/);
    c.s.destroy();
  } finally {
    child.kill();
    await echo.close();
  }
});
