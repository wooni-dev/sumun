// [UI-1] 대시보드 서버 골격과 요청 보호 — 새 동작(구현 전에는 실패해야 정상). 사례·결정: docs/ai/ui-cases.md(U·F 번호, D-1~D-13)
//   src/dashboard/server.ts startDashboard({ store, port, headersTimeoutMs }) → { port, token, url, close() }
//   src/cli.ts parseArgs: --no-dashboard, --dashboard-port N.  src/index.ts: 대시보드 기본 켬, 포트 = 프록시 + 1, 주소는 시작 줄 끝
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import { parseArgs } from '../../src/cli.ts';

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };
function req(port: number, urlPath: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error(`응답 없음: ${method} ${urlPath}`)));
    r.end(body);
  });
}
// 원문 요청 → 응답 원문(닫히거나 ms가 지나면)
function raw(port: number, data: string, ms = 2000) {
  return new Promise<{ text: string; closedMs: number }>((resolve) => {
    const t0 = Date.now();
    let text = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    s.on('data', (c) => (text += c));
    const done = () => resolve({ text, closedMs: Date.now() - t0 });
    s.on('close', done);
    s.on('error', () => {});
    s.setTimeout(ms, () => s.destroy());
  });
}
async function withDash(fn: (d: any, auth: Record<string, string>) => Promise<void>, opts: Record<string, unknown> = {}) {
  const d = await startDashboard({ store: createStore(), port: 0, ...opts });
  try {
    await fn(d, { authorization: `Bearer ${d.token}` });
  } finally {
    await d.close();
  }
}
const SEC = (r: Res, where: string) => {
  const csp = String(r.headers['content-security-policy'] ?? '');
  assert.match(csp, /default-src 'self'/, `${where}: CSP`);
  assert.match(csp, /frame-ancestors 'none'/, `${where}: frame-ancestors`);
  assert.match(String(r.headers['cache-control']), /no-store/, `${where}: no-store`);
  assert.equal(r.headers['x-content-type-options'], 'nosniff', `${where}: nosniff`);
  assert.equal(r.headers['x-frame-options'], 'DENY', `${where}: X-Frame-Options`);
  assert.equal(r.headers['referrer-policy'], 'no-referrer', `${where}: Referrer-Policy`);
  assert.equal(r.headers['access-control-allow-origin'], undefined, `${where}: CORS 없음`);
  assert.equal(r.headers['set-cookie'], undefined, `${where}: 쿠키 없음`);
};

// --- 토큰 (D-2, D-3, U43, U46) ---
test('토큰: 실행마다 새로 만든 base64url 43자 이상, url = http://127.0.0.1:<port>/#t=<토큰>', async () => {
  const a = await startDashboard({ store: createStore(), port: 0 });
  const b = await startDashboard({ store: createStore(), port: 0 });
  try {
    assert.match(a.token, /^[A-Za-z0-9_-]{43,}$/);
    assert.notEqual(a.token, b.token);
    assert.equal(a.url, `http://127.0.0.1:${a.port}/#t=${a.token}`);
  } finally {
    await a.close();
    await b.close();
  }
});

test('API: 토큰이 없거나 틀리거나 길이가 다르거나 URL 쿼리에 있으면 401, Bearer 헤더면 200 { runId }', () =>
  withDash(async (d, auth) => {
    for (const h of [{}, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${d.token}x` }, { authorization: `Bearer ${d.token.slice(0, -1)}` }, { authorization: d.token }, { authorization: `Basic ${d.token}` }])
      assert.equal((await req(d.port, '/api/ping', { headers: h })).status, 401, JSON.stringify(h));
    assert.equal((await req(d.port, `/api/ping?t=${d.token}`)).status, 401, '쿼리 토큰은 받지 않는다');
    const ok = await req(d.port, '/api/ping', { headers: auth });
    assert.equal(ok.status, 200, '긍정 전제(O30)');
    assert.match(String(ok.headers['content-type']), /application\/json/);
    assert.equal(typeof JSON.parse(ok.body).runId, 'string');
    assert.equal((await req(d.port, '/api/ping', { headers: { authorization: `bearer ${d.token}` } })).status, 200, '방식 이름은 대소문자 무시');
  }));

// --- Host·Origin·Sec-Fetch-Site·Via (U1, U2, U4~U6, U11, U14, D-5~D-7) ---
test('Host: 127.0.0.1:<P>·localhost:<P>만 받고 리바인딩 이름·다른 포트·포트 없음·[::1]·숫자 표기·Host 없음은 403', () =>
  withDash(async (d, auth) => {
    const P = d.port;
    for (const host of [`127.0.0.1:${P}`, `localhost:${P}`, `LOCALHOST:${P}`]) assert.equal((await req(P, '/api/ping', { headers: { ...auth, host } })).status, 200, host);
    for (const host of [`evil.example:${P}`, `127.0.0.1.nip.io:${P}`, `127.0.0.1:${P + 1}`, '127.0.0.1', `[::1]:${P}`, `0x7f000001:${P}`, `2130706433:${P}`, `localhost.:${P}`])
      assert.equal((await req(P, '/api/ping', { headers: { ...auth, host } })).status, 403, host);
    const r = await raw(P, `GET /api/ping HTTP/1.0\r\nAuthorization: Bearer ${d.token}\r\n\r\n`);
    assert.match(r.text, /^HTTP\/1\.\d 403/, 'Host 없음');
    assert.equal((await req(P, '/', { headers: { host: `evil.example:${P}` } })).status, 403, '페이지도 같은 검사');
  }));

test('Origin·Sec-Fetch-Site: 자기 출처와 same-origin·none만 받고, 다른 사이트·다른 포트·null·https·same-site·cross-site는 토큰이 있어도 403', () =>
  withDash(async (d, auth) => {
    const P = d.port;
    for (const h of [{ origin: `http://127.0.0.1:${P}` }, { origin: `http://localhost:${P}` }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }])
      assert.equal((await req(P, '/api/ping', { headers: { ...auth, ...h } })).status, 200, JSON.stringify(h));
    for (const h of [
      { origin: 'http://evil.example' },
      { origin: `http://127.0.0.1:${P + 1}` },
      { origin: 'null' },
      { origin: `https://127.0.0.1:${P}` },
      { origin: `http://127.0.0.1:${P}/` },
      { origin: `http://evil.example, http://127.0.0.1:${P}` },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
    ])
      assert.equal((await req(P, '/api/ping', { headers: { ...auth, ...h } })).status, 403, JSON.stringify(h));
    assert.equal((await req(P, '/', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, '페이지도 같은 검사(U9, U10)');
  }));

test('Via: sumun이 들어 있으면(프록시를 거친 요청) 403, 다른 프록시 이름은 통과(D-5)', () =>
  withDash(async (d, auth) => {
    for (const via of ['1.1 sumun', '1.0 corp, 1.1 sumun', '1.1 SUMUN']) assert.equal((await req(d.port, '/api/ping', { headers: { ...auth, via } })).status, 403, via);
    assert.equal((await req(d.port, '/api/ping', { headers: { ...auth, via: '1.1 corp-proxy' } })).status, 200, '긍정 전제');
  }));

// --- 응답 헤더·페이지·오류 (D-7, D-11, D-16, U10, U30, U50, U51) ---
test('보안 헤더: 페이지 200·401·403·404·405 응답 모두 CSP·no-store·nosniff·X-Frame-Options·Referrer-Policy, CORS·쿠키 없음', () =>
  withDash(async (d) => {
    const page = await req(d.port, '/');
    assert.equal(page.status, 200, '페이지는 토큰 없이');
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.match(page.body, /app\.js/, '페이지가 app.js를 부른다');
    SEC(page, '페이지');
    SEC(await req(d.port, '/api/ping'), '401');
    SEC(await req(d.port, '/api/ping', { headers: { origin: 'http://evil.example' } }), '403');
    SEC(await req(d.port, '/nope'), '404');
    SEC(await req(d.port, '/', { method: 'POST' }), '405');
  }));

test('경로·메서드: 모르는 경로 404(경로를 되돌리지 않음, text/plain), 정적 파일 밖은 404, POST /·OPTIONS는 405, 절대 형식 대상은 400', () =>
  withDash(async (d, auth) => {
    const nf = await req(d.port, '/x%3Cscript%3Ealert(1)%3C/script%3E', { headers: auth });
    assert.equal(nf.status, 404);
    assert.match(String(nf.headers['content-type']), /text\/plain/);
    assert.ok(!nf.body.includes('script') && !nf.body.includes('alert'), nf.body);
    for (const p of ['/..%2f..%2fpackage.json', '/../package.json', '/index.html/../../package.json', '/%2e%2e/%2e%2e/package.json', '/server.ts'])
      assert.ok(!(await req(d.port, p)).body.includes('"name"'), `${p}: 저장소 파일이 나오면 안 됨`);
    assert.equal((await req(d.port, '/../package.json')).status, 404);
    assert.equal((await req(d.port, '/', { method: 'POST' })).status, 405);
    const opt = await req(d.port, '/api/ping', { method: 'OPTIONS', headers: { origin: `http://127.0.0.1:${d.port}`, 'access-control-request-method': 'GET' } });
    assert.equal(opt.status, 405);
    assert.equal(opt.headers['access-control-allow-origin'], undefined);
    const abs = await raw(d.port, `GET http://127.0.0.1:${d.port}/api/ping HTTP/1.1\r\nHost: 127.0.0.1:${d.port}\r\nAuthorization: Bearer ${d.token}\r\nConnection: close\r\n\r\n`);
    assert.match(abs.text, /^HTTP\/1\.1 400/, '대시보드는 프록시가 아니다');
  }));

// --- 자원 (U37, D-13) ---
test('자원: 본문 16KB 초과 413, 헤더 16KB 초과 431, 헤더를 headersTimeoutMs 안에 다 보내지 않으면 닫는다', () =>
  withDash(
    async (d, auth) => {
      const big = await req(d.port, '/api/ping', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: 'x'.repeat(20_000) });
      assert.equal(big.status, 413);
      const hdr = await raw(d.port, `GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:${d.port}\r\nX-Big: ${'a'.repeat(20_000)}\r\n\r\n`);
      assert.match(hdr.text, /^HTTP\/1\.1 431/);
      const slow = await raw(d.port, `GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:${d.port}\r\n`, 5000);
      assert.ok(slow.closedMs < 3000, `느린 헤더 연결이 ${slow.closedMs}ms 뒤에 닫힘`);
    },
    { headersTimeoutMs: 300 },
  ));

// --- 포트 (U41, U42) ---
test('포트: 다른 프로그램이 0.0.0.0:P 또는 [::1]:P를 쓰고 있으면 시작하지 않는다(EADDRINUSE)', async () => {
  const holder = net.createServer((s) => s.destroy());
  await new Promise<void>((r) => holder.listen(0, '0.0.0.0', () => r()));
  const P = (holder.address() as net.AddressInfo).port;
  // 시작해 버리면 닫고 'started'를 돌려준다(열린 채로 남아 실행이 끝나지 않는 것을 막는다)
  const outcome = (port: number) => startDashboard({ store: createStore(), port }).then(async (d: any) => (await d.close(), 'started'), (e: any) => e?.code);
  try {
    assert.equal(await outcome(P), 'EADDRINUSE');
  } finally {
    holder.close();
  }
  const v6 = net.createServer((s) => s.destroy());
  const ok6 = await new Promise<boolean>((r) => (v6.once('error', () => r(false)), v6.listen(0, '::1', () => r(true))));
  if (ok6) {
    const Q = (v6.address() as net.AddressInfo).port;
    try {
      assert.equal(await outcome(Q), 'EADDRINUSE', '[::1]:Q');
    } finally {
      v6.close();
    }
  }
});

// --- 인자 (D-1, D-12) ---
test('인자: --no-dashboard, --dashboard-port N(=N도), 프록시 포트와 같거나 둘을 함께 주거나 값이 틀리면 오류', () => {
  assert.deepEqual(parseArgs(['--no-dashboard']), { port: 8080, dashboard: false });
  assert.deepEqual(parseArgs(['--dashboard-port', '9001']), { port: 8080, dashboardPort: 9001 });
  assert.deepEqual(parseArgs(['--port', '9000', '--dashboard-port=9002']), { port: 9000, dashboardPort: 9002 });
  for (const a of [['--dashboard-port', '8080'], ['--port', '9000', '--dashboard-port', '9000'], ['--no-dashboard', '--dashboard-port', '9001'], ['--dashboard-port', '0'], ['--dashboard-port', 'x'], ['--dashboard-port'], ['--no-dashboard', '--no-dashboard'], ['--dashboard-port', '9001', '--dashboard-port', '9002']])
    assert.ok('error' in parseArgs(a), JSON.stringify(a));
});

// --- 실행 진입점 (D-12) ---
function startCli(args: string[]) {
  const child = spawn(process.execPath, ['src/index.ts', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { out: '', err: '', code: null as number | null };
  child.stdout.on('data', (d) => (st.out += d));
  child.stderr.on('data', (d) => (st.err += d));
  const exited = new Promise<void>((r) => child.on('exit', (code) => ((st.code = code ?? -1), r())));
  const waitOut = async (ms = 5000) => {
    const end = Date.now() + ms;
    while (!st.out.includes('\n') && st.code === null && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };
  return { st, exited, waitOut, stop: async () => (st.code === null && child.kill(), await exited) };
}
async function freePortPair() {
  for (;;) {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const p = (s.address() as net.AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));
    if (p < 65535) return p;
  }
}

test('npm start: 대시보드가 프록시 포트 + 1에 기본으로 켜지고, 주소(#t=토큰)는 시작 줄 끝에 있다 — 시작 출력은 한 줄', async () => {
  const P = await freePortPair();
  const c = startCli(['--port', String(P)]);
  try {
    await c.waitOut();
    const lines = c.st.out.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `stdout: ${c.st.out} / stderr: ${c.st.err}`);
    const m = lines[0].match(new RegExp(`http://127\\.0\\.0\\.1:${P + 1}/#t=([A-Za-z0-9_-]{43,})`));
    assert.ok(m, lines[0]);
    assert.equal((await req(P + 1, '/')).status, 200);
    assert.equal((await req(P + 1, '/api/ping', { headers: { authorization: `Bearer ${m![1]}` } })).status, 200);
  } finally {
    await c.stop();
  }
});

test('npm start: --no-dashboard면 주소가 없고 P+1은 닫혀 있다, --dashboard-port Q면 Q에 열린다', async () => {
  const P = await freePortPair();
  const c = startCli(['--port', String(P), '--no-dashboard']);
  try {
    await c.waitOut();
    assert.ok(c.st.out.includes(`127.0.0.1:${P}`), `긍정 전제: 시작함 ${c.st.out} ${c.st.err}`);
    assert.ok(!c.st.out.includes('#t='), c.st.out);
    await assert.rejects(req(P + 1, '/'));
  } finally {
    await c.stop();
  }
  const Q = await freePortPair();
  const c2 = startCli(['--port', String(P), '--dashboard-port', String(Q)]);
  try {
    await c2.waitOut();
    assert.ok(c2.st.out.includes(`http://127.0.0.1:${Q}/#t=`), c2.st.out + c2.st.err);
    assert.equal((await req(Q, '/')).status, 200);
  } finally {
    await c2.stop();
  }
});

test('npm start: 대시보드 포트를 이미 쓰고 있으면 한 줄 오류, 종료 코드 1, stdout 없음, 스택 트레이스 없음', async () => {
  const holder = net.createServer((s) => s.destroy());
  await new Promise<void>((r) => holder.listen(0, '127.0.0.1', () => r()));
  const Q = (holder.address() as net.AddressInfo).port;
  const P = await freePortPair();
  const c = startCli(['--port', String(P), '--dashboard-port', String(Q)]);
  try {
    await Promise.race([c.exited, new Promise((r) => setTimeout(r, 5000))]);
    await c.stop();
    assert.equal(c.st.code, 1);
    assert.equal(c.st.out, '');
    assert.match(c.st.err, /이미/);
    assert.ok(!/^\s+at /m.test(c.st.err), c.st.err);
  } finally {
    holder.close();
  }
});
