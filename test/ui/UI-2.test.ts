// [UI-2] 프록시 쪽 대시보드 차단 — 새 동작(구현 전에는 실패해야 정상). 사례·결정: docs/ai/ui2-cases.md(V·G 번호, E-1~E-9)
//   startProxy({ dashboardPort, onDashboardRefused }) — 이 PC 자신의 주소 + 대시보드 포트로 가는 평문·CONNECT(터널·복호화)는 403과 우회 안내.
//   글자로 알아볼 수 있는 대상(IP 표기, localhost, localhost.)은 기록·시작 알림 전에 막고, 그 밖의 이름은 한 번 해석한 주소로 막는다(거절 기록).
//   src/index.ts: 대시보드를 먼저 열고 실제 포트를 넘긴다. 첫 거절 때 안내 줄 한 번.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const GUIDE = '프록시를 거치지 않고'; // 우회 안내 문구의 표지(대시보드 자신의 403 문구에는 없다)

// 연결 수와 요청 수를 세는 가짜 대시보드(127.0.0.1에만)
async function server(body: string) {
  const st = { connections: 0, requests: 0 };
  const s = http.createServer((_q, r) => (st.requests++, r.end(body)));
  s.on('connection', () => st.connections++);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { st, port: (s.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r()))) };
}
// 원문을 보내고 응답 원문(닫히거나 ms가 지나면)
function raw(port: number, data: string, ms = 3000) {
  return new Promise<string>((resolve) => {
    let text = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    s.on('data', (c) => (text += c));
    s.on('close', () => resolve(text));
    s.on('error', () => {});
    s.setTimeout(ms, () => s.destroy());
  });
}
// CONNECT의 첫 응답 줄(그 줄을 받으면 바로 끊는다)
function connectLine(port: number, target: string) {
  return new Promise<string>((resolve) => {
    let buf = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const done = () => (s.destroy(), resolve(buf.split('\r\n')[0]));
    s.on('data', (c) => ((buf += c), buf.includes('\r\n') && done()));
    s.on('close', done);
    s.on('error', done);
    s.setTimeout(3000, done);
  });
}
const plainGet = (url: string, extra = '') => `GET ${url} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer DASH-TOKEN\r\n${extra}Connection: close\r\n\r\n`;
const statusLine = (text: string) => text.split('\r\n')[0];
const bodyOf = (text: string) => text.slice(text.indexOf('\r\n\r\n') + 4);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 프록시 + 수집(시작 알림·기록·거절 알림)
async function proxyWith(opts: Record<string, unknown>) {
  const got = { starts: [] as any[], flows: [] as any[], refused: 0 };
  const proxy = await startProxy({
    port: 0,
    onFlowStart: (s) => void got.starts.push(s),
    onFlow: (f) => void got.flows.push(f),
    onDashboardRefused: () => void got.refused++,
    ...opts,
  } as any);
  return { proxy, got };
}
// 주입 lookup: 이름 → 주소 목록. 부른 횟수를 센다
function fakeLookup(map: Record<string, string[]>) {
  const calls: Record<string, number> = {};
  const lookup = async (host: string) => {
    calls[host] = (calls[host] ?? 0) + 1;
    const a = map[host.toLowerCase()];
    if (!a) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return a.map((address) => ({ address, family: net.isIP(address) }));
  };
  return { lookup, calls };
}

// --- 평문 (V1~V7, E-1, E-2, E-3, E-7) ---
test('평문: 대시보드 포트로 가는 글자 표기(IP 변형·localhost·userinfo·앞자리 0 포트)는 403 우회 안내, 대시보드에 닿지 않고 기록·시작 알림도 없다', async () => {
  const dash = await server('DASH-SECRET');
  const other = await server('OTHER');
  const D = dash.port;
  const { proxy, got } = await proxyWith({ dashboardPort: D });
  try {
    const urls = [
      `http://127.0.0.1:${D}/api/ping`,
      `http://localhost:${D}/api/ping`,
      `http://LOCALHOST:${D}/api/ping`,
      `http://localhost.:${D}/api/ping`,
      `HTTP://127.0.0.1:${D}/api/ping`,
      `http://127.1:${D}/api/ping`,
      `http://2130706433:${D}/api/ping`,
      `http://0x7f000001:${D}/api/ping`,
      `http://0.0.0.0:${D}/api/ping`,
      `http://[::ffff:127.0.0.1]:${D}/api/ping`,
      `http://[::1]:${D}/api/ping`,
      `http://127.0.0.2:${D}/api/ping`,
      `http://evil.example@127.0.0.1:${D}/api/ping`,
      `http://127.0.0.1:0${D}/api/ping`,
      `http://127.0.0.1:${D}/api/flows?q=<script>alert(1)</script>`,
    ];
    for (const u of urls) {
      const r = await raw(proxy.port, plainGet(u));
      assert.equal(statusLine(r), 'HTTP/1.1 403 Forbidden', `${u}: ${statusLine(r)}`);
      assert.ok(bodyOf(r).includes(GUIDE), `${u}: 우회 안내 — ${bodyOf(r)}`);
      assert.ok(!r.includes('<script>') && !r.includes('evil.example'), `${u}: 입력을 되돌리지 않는다(V23)`);
      assert.match(r, /\r\nx-content-type-options: nosniff\r\n/i, `${u}: nosniff`);
      assert.match(r, /\r\ncache-control: no-store\r\n/i, `${u}: no-store`);
    }
    await wait(100);
    assert.equal(dash.st.connections, 0, '대시보드에 연결하지 않는다');
    assert.equal(got.starts.length + got.flows.length, 0, '기록·시작 알림 없음(V21)');
    assert.equal(got.refused, urls.length, '거절마다 onDashboardRefused');

    // 긍정 전제(O30): 같은 프록시로 루프백의 다른 포트(G1)는 중계되고 기록된다
    const ok = await raw(proxy.port, plainGet(`http://127.0.0.1:${other.port}/`));
    assert.equal(statusLine(ok), 'HTTP/1.1 200 OK');
    assert.ok(ok.endsWith('OTHER'));
    await wait(100);
    assert.equal(got.flows.length, 1, '수집은 동작한다');
  } finally {
    await proxy.close();
    await dash.close();
    await other.close();
  }
});

test('평문: 루프백으로 풀리는 이름은 주입 lookup으로 한 번만 해석해 막는다(거절 기록 403), 다른 포트·원격 주소는 막지 않는다', async () => {
  const dash = await server('DASH-SECRET');
  const other = await server('OTHER');
  const D = dash.port;
  const { lookup, calls } = fakeLookup({
    'rebind.test': ['127.0.0.1'],
    'multi.test': ['203.0.113.7', '127.0.0.1'], // V11: 둘째 주소가 루프백
    'six.test': ['::1', '127.0.0.1'], // V12: localhost와 같은 순서
    'zero.test': ['0.0.0.0'],
    'remote.test': ['203.0.113.9'], // G2: 원격 주소의 같은 포트 번호
  });
  const { proxy, got } = await proxyWith({ dashboardPort: D, lookup, upstreamTimeoutMs: 500 });
  try {
    for (const h of ['rebind.test', 'multi.test', 'six.test', 'zero.test']) {
      const r = await raw(proxy.port, plainGet(`http://${h}:${D}/api/ping`));
      assert.equal(statusLine(r), 'HTTP/1.1 403 Forbidden', `${h}: ${statusLine(r)}`);
      assert.ok(bodyOf(r).includes(GUIDE), h);
      assert.equal(calls[h], 1, `${h}: 한 번만 해석(V10)`);
    }
    await wait(100);
    assert.equal(dash.st.connections, 0, '대시보드에 연결하지 않는다');
    assert.equal(got.refused, 4);
    assert.equal(got.flows.length, 4, '이름은 해석한 뒤에 알 수 있으므로 거절 기록이 남는다(E-3)');
    for (const f of got.flows) {
      assert.deepEqual(f.error, { by: 'proxy', code: 'rejected', status: 403 });
      assert.equal(f.response, undefined, '응답 칸 없음');
    }

    // 주입 lookup이 평문 경로에 쓰인다(긍정 전제): 루프백으로 풀리는 이름의 다른 포트는 중계된다(G1)
    const ok = await raw(proxy.port, plainGet(`http://rebind.test:${other.port}/`));
    assert.equal(statusLine(ok), 'HTTP/1.1 200 OK', ok);
    assert.ok(ok.endsWith('OTHER'));
    // G2: 원격 주소로 풀리는 이름은 같은 포트 번호여도 대시보드 거절이 아니다
    const far = await raw(proxy.port, plainGet(`http://remote.test:${D}/`));
    assert.notEqual(statusLine(far), 'HTTP/1.1 403 Forbidden', far);
    assert.equal(got.refused, 4);
  } finally {
    await proxy.close();
    await dash.close();
    await other.close();
  }
});

// --- CONNECT (V13~V15, E-4) ---
test('CONNECT(불투명 터널): 대시보드 포트의 글자 표기는 200 전에 403, 연결·기록 없음 — 이름은 해석 뒤 403(거절 기록)', async () => {
  const dash = await server('DASH-SECRET');
  const other = await server('OTHER');
  const D = dash.port;
  const { lookup } = fakeLookup({ 'rebind.test': ['127.0.0.1'], 'multi.test': ['203.0.113.7', '127.0.0.1'], localhost: ['::1', '127.0.0.1'] });
  const { proxy, got } = await proxyWith({ dashboardPort: D, tunnel: true, lookup });
  try {
    const literal = [`127.0.0.1:${D}`, `localhost:${D}`, `LOCALHOST:${D}`, `localhost.:${D}`, `[::1]:${D}`, `[::ffff:127.0.0.1]:${D}`, `0.0.0.0:${D}`];
    for (const t of literal) assert.equal(await connectLine(proxy.port, t), 'HTTP/1.1 403 Forbidden', t);
    await wait(100);
    assert.equal(got.starts.length + got.flows.length, 0, '글자 표기는 기록·시작 알림 없음');
    for (const t of [`rebind.test:${D}`, `multi.test:${D}`]) assert.equal(await connectLine(proxy.port, t), 'HTTP/1.1 403 Forbidden', t);
    await wait(100);
    assert.equal(dash.st.connections, 0, '대시보드에 연결하지 않는다');
    assert.equal(got.refused, literal.length + 2);
    assert.equal(got.flows.length, 2);
    for (const f of got.flows) assert.deepEqual(f.error, { by: 'proxy', code: 'rejected', status: 403 });

    // 긍정 전제: 루프백의 다른 포트는 터널이 열린다
    assert.equal(await connectLine(proxy.port, `127.0.0.1:${other.port}`), 'HTTP/1.1 200 Connection Established');
    assert.equal(await connectLine(proxy.port, `rebind.test:${other.port}`), 'HTTP/1.1 200 Connection Established');
  } finally {
    await proxy.close();
    await dash.close();
    await other.close();
  }
});

test('CONNECT(복호화 켬): 대시보드 포트는 인증서·200 전에 403 — 글자 표기는 기록 없음, 이름은 거절 기록(U16, V14, V15)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sumun-ui2-ca-'));
  const dash = await server('DASH-SECRET');
  const other = await server('OTHER');
  const D = dash.port;
  const { lookup } = fakeLookup({ 'rebind.test': ['127.0.0.1'], localhost: ['::1', '127.0.0.1'] });
  const ca = await loadOrCreateCA(dir);
  const { proxy, got } = await proxyWith({ dashboardPort: D, ca, lookup });
  try {
    for (const t of [`127.0.0.1:${D}`, `localhost:${D}`, `[::1]:${D}`]) assert.equal(await connectLine(proxy.port, t), 'HTTP/1.1 403 Forbidden', t);
    await wait(100);
    assert.equal(got.starts.length + got.flows.length, 0, '글자 표기는 기록·시작 알림 없음');
    assert.equal(await connectLine(proxy.port, `rebind.test:${D}`), 'HTTP/1.1 403 Forbidden');
    await wait(100);
    assert.equal(got.flows.length, 1);
    assert.deepEqual(got.flows[0].error, { by: 'proxy', code: 'rejected', status: 403 });
    assert.equal(got.refused, 4);
    assert.equal(dash.st.connections, 0);
    // 긍정 전제: 다른 포트는 200(복호화 시작)
    assert.equal(await connectLine(proxy.port, `127.0.0.1:${other.port}`), 'HTTP/1.1 200 Connection Established');
  } finally {
    await proxy.close();
    await dash.close();
    await other.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onDashboardRefused가 예외를 던져도 거절 응답은 나가고 프록시는 계속 동작한다', async () => {
  const dash = await server('DASH-SECRET');
  const other = await server('OTHER');
  let called = 0;
  const proxy = await startProxy({ port: 0, tunnel: true, dashboardPort: dash.port, onDashboardRefused: () => (called++, assert.fail('구독자 예외')) } as any);
  try {
    assert.equal(statusLine(await raw(proxy.port, plainGet(`http://127.0.0.1:${dash.port}/`))), 'HTTP/1.1 403 Forbidden');
    assert.equal(await connectLine(proxy.port, `127.0.0.1:${dash.port}`), 'HTTP/1.1 403 Forbidden');
    await wait(50);
    assert.equal(called, 2);
    assert.equal(statusLine(await raw(proxy.port, plainGet(`http://127.0.0.1:${other.port}/`))), 'HTTP/1.1 200 OK');
  } finally {
    await proxy.close();
    await dash.close();
    await other.close();
  }
});

// --- API 검사 (V18, E-6) ---
test('startProxy: dashboardPort가 1~65535 정수가 아니거나 프록시 포트와 같으면 시작하지 않는다(TypeError)', async () => {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
  const P = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const outcome = (o: Record<string, unknown>) => startProxy(o as any).then(async (p) => (await p.close(), 'started'), (e) => e);
  for (const bad of [0, 65536, 1.5, -1, '8081', Number.NaN]) {
    const r = await outcome({ port: 0, dashboardPort: bad });
    assert.ok(r instanceof TypeError, `dashboardPort ${String(bad)}: ${r}`);
  }
  const same = await outcome({ port: P, dashboardPort: P });
  assert.ok(same instanceof TypeError, `같은 포트: ${same}`);
});

// --- 실행 진입점 (E-5, E-8, G9, G10, V17) ---
function startCli(args: string[]) {
  const child = spawn(process.execPath, ['src/index.ts', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { out: '', err: '', code: null as number | null };
  child.stdout.on('data', (d) => (st.out += d));
  child.stderr.on('data', (d) => (st.err += d));
  const exited = new Promise<void>((r) => child.on('exit', (code) => ((st.code = code ?? -1), r())));
  const waitOut = async (ms = 5000) => {
    const end = Date.now() + ms;
    while (!st.out.includes('\n') && st.code === null && Date.now() < end) await wait(20);
  };
  return { st, waitOut, stop: async () => (st.code === null && child.kill(), await exited) };
}
async function freePort() {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
const dashFrom = (line: string) => Number(line.match(/http:\/\/127\.0\.0\.1:(\d+)\/#t=/)?.[1]);

test('npm start: 프록시를 거친 대시보드 요청(평문·CONNECT)은 프록시가 403 안내, 터미널 안내 줄은 한 번만, 요약 줄 없음 — 직접 접속은 200', async () => {
  const P = await freePort();
  const c = startCli(['--port', String(P)]);
  try {
    await c.waitOut();
    const first = c.st.out.split(/\r?\n/)[0];
    const D = dashFrom(first);
    assert.ok(D > 0, `시작 줄에 대시보드 주소: ${first} / ${c.st.err}`);
    for (const h of ['127.0.0.1', 'localhost']) {
      const r = await raw(P, plainGet(`http://${h}:${D}/`));
      assert.equal(statusLine(r), 'HTTP/1.1 403 Forbidden', `${h}: ${statusLine(r)}`);
      assert.ok(bodyOf(r).includes(GUIDE), `${h}: 프록시의 안내(대시보드 자신의 403이 아님) — ${bodyOf(r)}`);
    }
    assert.equal(await connectLine(P, `127.0.0.1:${D}`), 'HTTP/1.1 403 Forbidden');
    await wait(300);
    const lines = c.st.out.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.filter((l) => l.includes(GUIDE)).length, 1, `안내 줄은 한 번: ${c.st.out}`);
    assert.equal(lines.length, 2, `시작 줄 + 안내 줄만(요약 줄 없음): ${c.st.out}`);
    // G10: 직접 접속은 그대로
    assert.equal(statusLine(await raw(D, 'GET / HTTP/1.1\r\nHost: 127.0.0.1:' + D + '\r\nConnection: close\r\n\r\n')), 'HTTP/1.1 200 OK');
  } finally {
    await c.stop();
  }
});

test('npm start: 기본 대시보드 포트(P+1)가 차서 다른 포트에 열려도 막는 것은 실제 대시보드 포트다(V17) — P+1의 다른 프로그램은 중계된다(G4)', async () => {
  const holder = http.createServer((_q, r) => r.end('HOLDER'));
  let P = 0;
  let H = 0;
  for (;;) {
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', () => r()));
    H = (holder.address() as net.AddressInfo).port;
    P = H - 1;
    const free = await new Promise<boolean>((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(P, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) break;
    await new Promise<void>((r) => holder.close(() => r()));
  }
  const c = startCli(['--port', String(P)]);
  try {
    await c.waitOut();
    const D = dashFrom(c.st.out.split(/\r?\n/)[0]);
    assert.ok(D > 0 && D !== H, `대체 포트: ${c.st.out} / ${c.st.err}`);
    const r = await raw(P, plainGet(`http://127.0.0.1:${D}/`));
    assert.equal(statusLine(r), 'HTTP/1.1 403 Forbidden');
    assert.ok(bodyOf(r).includes(GUIDE), bodyOf(r));
    const h = await raw(P, plainGet(`http://127.0.0.1:${H}/`));
    assert.equal(statusLine(h), 'HTTP/1.1 200 OK');
    assert.ok(h.endsWith('HOLDER'));
  } finally {
    await c.stop();
    holder.closeAllConnections();
    holder.close();
  }
});
