// [UI-T] UI 큰 단위 테스트: 대시보드 사용자 흐름과 보호를 처음부터 끝까지 확인한다.
//
//   실제 curl(평문 POST, 닫힌 포트) ─┐
//   CONNECT + TLS(GET /hello) ──────┼─▶ [프록시 127.0.0.1] ── attachStore ──▶ [저장소] ──▶ [대시보드 127.0.0.1:<포트>]
//                                    ▼                                                       │ 페이지(토큰 없이), API·SSE(Authorization: Bearer)
//                                 목적지(평문·HTTPS)                                          ▼
//                                                                            목록·필터·상세·본문·실시간 알림·지우기
//   막는 것: 리바인딩 Host, 다른 Origin(다른 포트 포함), Sec-Fetch-Site cross-site·same-site, Via sumun, 프록시를 거친 대시보드 요청(평문·CONNECT)
//
// 이전 큰 단위의 사용자 행동(PRX-T 1·2, TLS-T 1, STO-T 1)을 같은 실행 안에서 다시 하고(O42), 그 뒤에 대시보드 단계를 붙인다.
// 마지막 작은 단위(UI-5)가 src/dashboard/public/app.js를 만들기 전까지는 대기(todo)다(INFRA-9).
// 사례·결정: docs/ai/ui-cases.md(D-1~D-16). CA는 임시 폴더에 매번 새로 만든다. Windows 인증서 저장소와 %LOCALAPPDATA%\sumun은 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';

const P = 'src/dashboard/public/app.js';
const WAIT = { todo: !existsSync(P) && `대기: ${P}` };

type Pem = { certPem: string; keyPem: string };
type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

// 같은 프로세스의 프록시가 응답할 수 있게 비동기로 실행한다(PRX-T와 같은 방식)
const curl = (proxyPort: number, args: string[]) =>
  new Promise<{ status: number; body: string }>((resolve) =>
    execFile('curl.exe', ['-s', '-m', '10', '-x', `http://127.0.0.1:${proxyPort}`, '-w', '\n%{http_code}', ...args], { maxBuffer: 16 * 1024 * 1024 }, (_e, out) => {
      const i = out.lastIndexOf('\n');
      resolve({ body: out.slice(0, i), status: Number(out.slice(i + 1)) });
    }),
  );

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

// 대시보드에 직접(프록시 없이) 보내는 요청. headers에 host를 주면 Host를 바꾼다
function req(port: number, urlPath: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error(`대시보드 응답 없음(5초): ${method} ${urlPath}`)));
    r.end(body);
  });
}

// SSE: 줄 "data: <JSON>"을 모은다
function sse(port: number, token: string) {
  const events: any[] = [];
  let text = '';
  let status = 0;
  let type = '';
  const r = http.request({ host: '127.0.0.1', port, path: '/api/events', headers: { authorization: `Bearer ${token}` }, agent: false }, (res) => {
    status = res.statusCode!;
    type = String(res.headers['content-type'] ?? '');
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c: string) => {
      text += c;
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) {
          try {
            events.push(JSON.parse(line.slice(5).trim()));
          } catch {}
        }
      }
    });
  });
  r.on('error', () => {});
  r.end();
  return { events, get text() { return text; }, get status() { return status; }, get type() { return type; }, close: () => r.destroy() };
}

// 평문 목적지: 받은 본문을 그대로 돌려준다
async function plainUpstream() {
  const server = http.createServer((q, res) => {
    const chunks: Buffer[] = [];
    q.on('data', (c: Buffer) => chunks.push(c));
    q.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

async function closedPort() {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// CONNECT → 같은 소켓에서 TLS(프록시 CA만 믿음) → HTTP 요청 원문 → 응답 원문 (TLS-T와 같은 방식)
async function httpsViaProxy(proxyPort: number, host: string, port: number, ca: string, request: string) {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}`, agent: false });
    r.on('connect', (res, s) => (res.statusCode === 200 ? resolve(s) : reject(new Error(`CONNECT ${res.statusCode}`))));
    r.on('error', reject);
    r.setTimeout(3000, () => r.destroy(new Error('CONNECT 응답 없음(3초)')));
    r.end();
  });
  const t = tls.connect({ socket, servername: host, ca, ALPNProtocols: ['http/1.1'] });
  await new Promise<void>((resolve, reject) => (t.once('secureConnect', () => resolve()), t.once('error', reject)));
  return new Promise<string>((resolve) => {
    let buf = '';
    t.on('data', (c) => (buf += c));
    for (const ev of ['end', 'close', 'error']) t.on(ev, () => resolve(buf));
    t.write(request);
  });
}

// 프록시에 CONNECT만 보내고 첫 응답 줄을 돌려준다(닫히면 빈 문자열)
function connectLine(proxyPort: number, target: string) {
  return new Promise<string>((resolve) => {
    const s = net.connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = '';
    const done = () => (s.destroy(), resolve(buf.split('\r\n')[0]));
    s.on('data', (c) => ((buf += c), buf.includes('\r\n') && done()));
    s.on('close', done);
    s.on('error', done);
    s.setTimeout(3000, done);
  });
}

async function modules() {
  const { createStore } = await import('../../src/store/store.ts');
  const { attachStore } = await import('../../src/store/attach.ts');
  const { startProxy } = await import('../../src/proxy/server.ts');
  const { startDashboard } = await import('../../src/dashboard/server.ts' as string);
  const { loadOrCreateCA, issueCert } = (await import('../../src/ca/ca.ts')) as {
    loadOrCreateCA: (dir: string) => Promise<Pem>;
    issueCert: (ca: Pem, hosts: string[]) => Promise<Pem>;
  };
  return { createStore, attachStore, startProxy, startDashboard, loadOrCreateCA, issueCert } as any;
}

test('UI 흐름: 평문·HTTPS·닫힌 포트 기록을 대시보드 페이지·API(토큰)로 목록·필터·상세·본문으로 보고, 새 요청은 실시간 알림으로 오고, 모두 지울 수 있다', WAIT, async () => {
  const m = await modules();
  const dirs = [mkdtempSync(path.join(os.tmpdir(), 'sumun-uit-proxy-')), mkdtempSync(path.join(os.tmpdir(), 'sumun-uit-up-'))];
  const proxyCA = await m.loadOrCreateCA(dirs[0]);
  const upCA = await m.loadOrCreateCA(dirs[1]);
  const upCert = await m.issueCert(upCA, ['localhost', '127.0.0.1']);
  const secure = https.createServer({ cert: upCert.certPem, key: upCert.keyPem }, (q, res) => {
    q.resume();
    q.on('end', () => res.writeHead(200, { 'content-type': 'text/plain' }).end('secure-hello'));
  });
  await new Promise<void>((r) => secure.listen(0, '127.0.0.1', () => r()));
  const U = (secure.address() as net.AddressInfo).port;
  const plain = await plainUpstream();
  const closed = await closedPort();

  const store = m.createStore();
  const dash = await m.startDashboard({ store, port: 0 });
  const proxy = await m.startProxy({ port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], dashboardPort: dash.port, ...m.attachStore(store) });
  const done = () => store.list().filter((s: any) => s.state === 'done' && s.method !== 'CONNECT');
  const auth = { authorization: `Bearer ${dash.token}` };
  let stream: ReturnType<typeof sse> | undefined;
  try {
    // --- 이전 큰 단위의 사용자 행동(O42) ---
    const postUrl = `http://127.0.0.1:${plain.port}/submit?x=1`;
    const a = await curl(proxy.port, ['-H', 'Cookie: k=PLAIN-COOKIE', '--data-binary', 'hello-sumun', postUrl]); // PRX-T 1
    assert.equal(a.status, 200);
    assert.equal(a.body, 'hello-sumun');
    const b = await curl(proxy.port, [`http://127.0.0.1:${closed}/`]); // PRX-T 2
    assert.equal(b.status, 502);
    const raw = await httpsViaProxy(proxy.port, 'localhost', U, proxyCA.certPem, `GET /hello?q=1 HTTP/1.1\r\nHost: localhost:${U}\r\nCookie: k=TLS-COOKIE\r\nConnection: close\r\n\r\n`); // TLS-T 1
    assert.match(raw, /^HTTP\/1\.1 200/);
    assert.ok(raw.includes('secure-hello'));
    await until(() => done().length >= 3); // STO-T 1
    assert.equal(done().length, 3, '저장소에 완료 3건');

    // --- 대시보드 단계 ---
    // 시작 주소: 127.0.0.1 + # 뒤 토큰(D-3)
    assert.match(dash.url, new RegExp(`^http://127\\.0\\.0\\.1:${dash.port}/#t=[A-Za-z0-9_-]{22,}$`));
    assert.ok(dash.url.endsWith(dash.token));

    // 페이지: 토큰 없이 받고, 보안 헤더가 있다(D-7, D-11, D-16)
    const page = await req(dash.port, '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-type']), /text\/html/);
    const csp = String(page.headers['content-security-policy'] ?? '');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(String(page.headers['cache-control']), /no-store/);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['access-control-allow-origin'], undefined, 'CORS 헤더 없음');
    const js = await req(dash.port, '/app.js');
    assert.equal(js.status, 200);
    assert.match(String(js.headers['content-type']), /javascript/);

    // API: 토큰이 없거나 틀리면 401
    assert.equal((await req(dash.port, '/api/flows')).status, 401);
    assert.equal((await req(dash.port, '/api/flows', { headers: { authorization: 'Bearer wrong-token' } })).status, 401);

    // 목록: 완료 3건, 요약에 본문·쿠키 없음
    const listRes = await req(dash.port, '/api/flows', { headers: auth });
    assert.equal(listRes.status, 200, '긍정 전제(O30): 토큰이 맞으면 200');
    assert.match(String(listRes.headers['content-type']), /application\/json/);
    assert.match(String(listRes.headers['cache-control']), /no-store/);
    const list = JSON.parse(listRes.body.toString());
    assert.equal(list.runId, store.runId);
    const items = list.items.filter((s: any) => s.state === 'done' && s.method !== 'CONNECT');
    assert.equal(items.length, 3, JSON.stringify(list.items.map((s: any) => [s.method, s.url])));
    const listText = listRes.body.toString();
    assert.ok(listText.includes('/submit?x=1'), '긍정 전제(O30): 목록에 요청 요약은 있다');
    for (const leak of ['hello-sumun', 'secure-hello', 'PLAIN-COOKIE', 'TLS-COOKIE']) assert.ok(!listText.includes(leak), `목록에 본문·쿠키(${leak})가 없다`);

    // 필터
    const posts = JSON.parse((await req(dash.port, '/api/flows?method=POST', { headers: auth })).body.toString()).items;
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, postUrl);
    const bad = JSON.parse((await req(dash.port, '/api/flows?status=502', { headers: auth })).body.toString()).items;
    assert.equal(bad.length, 1);
    assert.equal(bad[0].error?.code, 'unreachable');
    const local = JSON.parse((await req(dash.port, '/api/flows?host=localhost', { headers: auth })).body.toString()).items.filter((s: any) => s.method !== 'CONNECT');
    assert.equal(local.length, 1);

    // 상세(헤더 포함)와 본문(원본 바이트, octet-stream — D-9)
    const detail = await req(dash.port, `/api/flows/${posts[0].id}`, { headers: auth });
    assert.equal(detail.status, 200);
    assert.ok(detail.body.toString().includes('PLAIN-COOKIE'), '상세에는 쿠키가 있다');
    const reqBody = await req(dash.port, `/api/flows/${posts[0].id}/body/request`, { headers: auth });
    assert.equal(reqBody.status, 200);
    assert.match(String(reqBody.headers['content-type']), /application\/octet-stream/);
    assert.equal(reqBody.body.toString(), 'hello-sumun');
    assert.equal((await req(dash.port, `/api/flows/${posts[0].id}/body/response`, { headers: auth })).body.toString(), 'hello-sumun');
    assert.equal((await req(dash.port, `/api/flows/${local[0].id}/body/response`, { headers: auth })).body.toString(), 'secure-hello');

    // 실시간 알림(D-4): 연결한 뒤 새 요청의 done 알림이 온다. 알림에는 본문이 없다
    stream = sse(dash.port, dash.token);
    await until(() => stream!.status !== 0);
    assert.equal(stream.status, 200);
    assert.match(stream.type, /text\/event-stream/);
    const c = await curl(proxy.port, ['--data-binary', 'after-sse', `http://127.0.0.1:${plain.port}/again`]);
    assert.equal(c.status, 200);
    await until(() => stream!.events.some((e) => e.type === 'done' && String(e.summary?.url).includes('/again')));
    assert.ok(stream.events.some((e) => e.type === 'done' && String(e.summary?.url).includes('/again')), `알림: ${stream.text.slice(0, 300)}`);
    assert.ok(!stream.text.includes('after-sse'), '알림에 본문 없음');

    // 지우기(D-8): GET은 405, POST(JSON)는 204 → 목록이 빈다
    assert.equal((await req(dash.port, '/api/clear', { headers: auth })).status, 405);
    const cleared = await req(dash.port, '/api/clear', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(cleared.status, 204);
    assert.equal(JSON.parse((await req(dash.port, '/api/flows', { headers: auth })).body.toString()).items.length, 0);
    assert.equal(store.list().length, 0);
  } finally {
    stream?.close();
    await proxy.close();
    await dash.close();
    await plain.close();
    await new Promise<void>((r) => (secure.closeAllConnections(), secure.close(() => r())));
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});

test('UI 보호: 리바인딩 Host·다른 출처·Via는 토큰이 있어도 403, 프록시를 거친 대시보드 요청(평문·CONNECT)은 중계되지 않고 기록도 늘지 않는다', WAIT, async () => {
  const m = await modules();
  const plain = await plainUpstream();
  const store = m.createStore();
  const dash = await m.startDashboard({ store, port: 0 });
  const proxy = await m.startProxy({ port: 0, tunnel: true, dashboardPort: dash.port, ...m.attachStore(store) });
  const auth = { authorization: `Bearer ${dash.token}` };
  const D = dash.port;
  try {
    // 기록 하나(긍정 전제의 데이터)
    assert.equal((await curl(proxy.port, ['--data-binary', 'x', `http://127.0.0.1:${plain.port}/one`])).status, 200);
    await until(() => store.list().some((s: any) => s.state === 'done'));

    // 긍정 전제(O30): 정상 출처·Host·Sec-Fetch-Site는 200(F1, F3, F4)
    for (const h of [{}, { host: `localhost:${D}` }, { origin: `http://127.0.0.1:${D}` }, { origin: `http://localhost:${D}`, host: `localhost:${D}` }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }])
      assert.equal((await req(D, '/api/flows', { headers: { ...auth, ...h } })).status, 200, `허용: ${JSON.stringify(h)}`);

    // 토큰이 맞아도 403: 리바인딩 Host(U1·U2), 다른 Origin·다른 포트(U4~U6, U11), 교차·같은 사이트(D-7), Via(D-5)
    for (const h of [
      { host: `evil.example:${D}` },
      { host: `127.0.0.1.nip.io:${D}` },
      { host: `127.0.0.1:${D + 1}` },
      { origin: 'http://evil.example' },
      { origin: `http://127.0.0.1:${D + 1}` },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { via: '1.1 sumun' },
    ])
      assert.equal((await req(D, '/api/flows', { headers: { ...auth, ...h } })).status, 403, `막음: ${JSON.stringify(h)}`);
    assert.equal((await req(D, '/api/events', { headers: { ...auth, origin: 'http://evil.example' } })).status, 403, '실시간 통로도 같은 검사(U3)');
    assert.equal((await req(D, '/api/clear', { method: 'POST', headers: { ...auth, origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403, '지우기도(U6)');
    assert.ok(store.list().length > 0, '막힌 지우기는 실행되지 않았다');

    // 프록시를 거친 대시보드 요청(U14, U15): 중계되지 않고 기록도 늘지 않는다
    const before = store.list().length;
    for (const host of ['127.0.0.1', 'localhost']) {
      const r = await curl(proxy.port, ['-H', `Authorization: Bearer ${dash.token}`, `http://${host}:${D}/api/flows`]);
      assert.notEqual(r.status, 200, `프록시를 거친 ${host}:${D}`);
      assert.ok(!r.body.includes(store.runId), '대시보드 응답이 돌아오지 않는다');
    }
    const line = await connectLine(proxy.port, `127.0.0.1:${D}`);
    assert.doesNotMatch(line, / 200 /, `CONNECT 대시보드 포트: ${line}`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(store.list().length, before, '프록시를 거친 대시보드 요청은 기록되지 않는다');
  } finally {
    await proxy.close();
    await dash.close();
    await plain.close();
  }
});
