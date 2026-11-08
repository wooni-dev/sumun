// [STO-T] STO 큰 단위 테스트: 저장소 사용자 흐름을 처음부터 끝까지 확인한다.
//
//   실제 curl(평문 POST, 닫힌 포트) ─┐
//   CONNECT + TLS(GET /hello) ──────┼─▶ [프록시 127.0.0.1] ── attachStore(store) ──▶ [저장소]
//                                    │                                                │ 알림(요약만)
//                                    ▼                                                ▼
//                                 목적지(평문·HTTPS)                 구독자 / list(필터) / get(id) 사본
//
// 이전 큰 단위의 사용자 행동(PRX-T 1·2: curl 평문 POST·닫힌 포트, TLS-T 1: 복호화한 HTTPS GET)을 같은 실행 안에서 다시 하고(O42),
// 그 뒤에 저장소 단계(알림·목록·필터·상세·상한)를 붙인다.
// 마지막 작은 단위(STO-4)가 src/store/attach.ts를 만들기 전까지는 대기(todo)다(INFRA-9).
// CA는 임시 폴더에 매번 새로 만든다. Windows 인증서 저장소와 %LOCALAPPDATA%\sumun은 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';

const P = 'src/store/attach.ts';
const WAIT = { todo: !existsSync(P) && `대기: ${P}` };

type Pem = { certPem: string; keyPem: string };

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

// 평문 목적지: 받은 본문을 그대로 돌려준다
async function plainUpstream() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

// 아무도 듣지 않는 포트
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
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}`, agent: false });
    req.on('connect', (res, s) => (res.statusCode === 200 ? resolve(s) : reject(new Error(`CONNECT ${res.statusCode}`))));
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('CONNECT 응답 없음(3초)')));
    req.end();
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

async function modules() {
  const { createStore } = await import('../../src/store/store.ts');
  const { attachStore } = await import('../../src/store/attach.ts');
  const { startProxy } = await import('../../src/proxy/server.ts');
  const { loadOrCreateCA, issueCert } = (await import('../../src/ca/ca.ts')) as {
    loadOrCreateCA: (dir: string) => Promise<Pem>;
    issueCert: (ca: Pem, hosts: string[]) => Promise<Pem>;
  };
  return { createStore, attachStore, startProxy, loadOrCreateCA, issueCert } as any;
}

test('STO 흐름: 평문·HTTPS·닫힌 포트 요청이 저장소에 쌓이고, 알림은 요약만, 필터와 상세(사본)로 다시 볼 수 있다', WAIT, async () => {
  const m = await modules();
  const dirs = [mkdtempSync(path.join(os.tmpdir(), 'sumun-stot-proxy-')), mkdtempSync(path.join(os.tmpdir(), 'sumun-stot-up-'))];
  const proxyCA = await m.loadOrCreateCA(dirs[0]);
  const upCA = await m.loadOrCreateCA(dirs[1]);
  const upCert = await m.issueCert(upCA, ['localhost', '127.0.0.1']);
  const secure = https.createServer({ cert: upCert.certPem, key: upCert.keyPem }, (req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'text/plain' }).end('secure-hello'));
  });
  await new Promise<void>((r) => secure.listen(0, '127.0.0.1', () => r()));
  const U = (secure.address() as net.AddressInfo).port;
  const plain = await plainUpstream();
  const closed = await closedPort();

  const store = m.createStore();
  const events: any[] = [];
  const off = store.subscribe((e: any) => void events.push(e));
  const proxy = await m.startProxy({ port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], ...m.attachStore(store) });
  const done = () => store.list().filter((s: any) => s.state === 'done' && s.method !== 'CONNECT');
  try {
    // --- 이전 큰 단위의 사용자 행동(O42) ---
    // PRX-T 1: curl 평문 POST(쿠키·쿼리·본문)
    const postUrl = `http://127.0.0.1:${plain.port}/submit?x=1`;
    const a = await curl(proxy.port, ['-H', 'Cookie: k=PLAIN-COOKIE', '--data-binary', 'hello-sumun', postUrl]);
    assert.equal(a.status, 200);
    assert.equal(a.body, 'hello-sumun');
    // PRX-T 2: curl 닫힌 포트 → 502
    const b = await curl(proxy.port, [`http://127.0.0.1:${closed}/`]);
    assert.equal(b.status, 502);
    // TLS-T 1: CONNECT → TLS → GET /hello?q=1 + 쿠키
    const raw = await httpsViaProxy(proxy.port, 'localhost', U, proxyCA.certPem, `GET /hello?q=1 HTTP/1.1\r\nHost: localhost:${U}\r\nCookie: k=TLS-COOKIE\r\nConnection: close\r\n\r\n`);
    assert.match(raw, /^HTTP\/1\.1 200/);
    assert.ok(raw.endsWith('secure-hello') || raw.includes('secure-hello'));

    // --- 저장소 단계 ---
    await until(() => done().length >= 3);
    const list = store.list();
    const ids = list.map((s: any) => s.id);
    assert.deepEqual(ids, [...ids].sort((x: number, y: number) => x - y), '목록은 id 오름차순');
    assert.equal(done().length, 3, `완료 3건: ${JSON.stringify(list.map((s: any) => [s.method, s.url, s.state]))}`);
    for (const s of list) assert.equal(s.runId, store.runId, '요약에 실행 식별자');

    // 알림: 요청마다 시작이 완료보다 먼저, 요약에는 본문·헤더(쿠키)가 없다(S-4)
    for (const s of done()) {
      const iStart = events.findIndex((e) => e.type === 'start' && e.summary?.id === s.id);
      const iDone = events.findIndex((e) => e.type === 'done' && e.summary?.id === s.id);
      assert.ok(iStart >= 0 && iDone > iStart, `id ${s.id}: 시작 알림(${iStart})이 완료 알림(${iDone})보다 먼저`);
    }
    const said = JSON.stringify(events);
    assert.ok(said.includes('/submit?x=1') && said.includes('/hello?q=1'), '긍정 전제(O30): 알림에 요청 요약은 있다');
    for (const leak of ['hello-sumun', 'secure-hello', 'PLAIN-COOKIE', 'TLS-COOKIE']) assert.ok(!said.includes(leak), `알림에 본문·쿠키(${leak})가 없다`);

    // 필터: 메서드(대소문자 무시), 호스트(target), 상태 코드(브라우저가 받은 코드, 출처 표시 — S-3)
    const posts = store.list({ method: 'post' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, postUrl);
    assert.equal(posts[0].status, 200);
    assert.equal(posts[0].statusFrom, 'upstream');
    const local = store.list({ host: 'localhost' }).filter((s: any) => s.method !== 'CONNECT');
    assert.equal(local.length, 1);
    assert.equal(local[0].url, '/hello?q=1');
    assert.deepEqual(local[0].target, { scheme: 'https', host: 'localhost', port: U, path: '/hello?q=1' });
    const bad = store.list({ status: 502 });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].statusFrom, 'proxy');
    assert.equal(bad[0].error?.code, 'unreachable');

    // 상세: 본문·쿠키까지 있는 사본. 고쳐도 저장된 기록은 그대로
    const d = store.get(posts[0].id);
    assert.equal(d.request.body.toString(), 'hello-sumun');
    assert.ok(d.request.headers.some(([n, v]: [string, string]) => n === 'Cookie' && v === 'k=PLAIN-COOKIE'));
    assert.equal(d.response.body.toString(), 'hello-sumun');
    d.request.body.fill(0);
    d.request.headers.push(['X-Changed', '1']);
    const again = store.get(posts[0].id);
    assert.equal(again.request.body.toString(), 'hello-sumun', '받은 사본을 고쳐도 저장된 본문은 그대로');
    assert.ok(!again.request.headers.some(([n]: [string]) => n === 'X-Changed'));
    assert.equal(store.get(local[0].id).response.body.toString(), 'secure-hello');

    // 구독 해제 뒤에는 알림이 오지 않지만 저장은 계속된다
    off();
    const before = events.length;
    const c = await curl(proxy.port, ['--data-binary', 'after-off', `http://127.0.0.1:${plain.port}/again`]);
    assert.equal(c.status, 200);
    await until(() => done().length >= 4);
    assert.equal(done().length, 4, '해제 뒤 요청도 저장됨');
    assert.equal(events.length, before, '해제 뒤 알림 없음');
  } finally {
    await proxy.close();
    await plain.close();
    await new Promise<void>((r) => (secure.closeAllConnections(), secure.close(() => r())));
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});

test('STO 흐름: 바이트 상한에 닿으면 가장 오래된 기록부터 빠지고 evicted 알림이 온다', WAIT, async () => {
  const m = await modules();
  const plain = await plainUpstream();
  const store = m.createStore({ maxBytes: 1_048_576 });
  const events: any[] = [];
  store.subscribe((e: any) => void events.push(e));
  const proxy = await m.startProxy({ port: 0, ...m.attachStore(store) });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sumun-stot-body-'));
  const file = path.join(dir, 'body.bin');
  writeFileSync(file, Buffer.alloc(200 * 1024, 0x61)); // 요청 200KiB + 응답 200KiB = 기록 하나 약 400KiB
  const posts = () => store.list({ method: 'POST' }).filter((s: any) => s.state === 'done');
  try {
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await curl(proxy.port, ['--data-binary', `@${file}`, `http://127.0.0.1:${plain.port}/big/${i}`]);
      assert.equal(r.status, 200);
      await until(() => events.some((e) => e.type === 'done' && e.summary?.url?.endsWith(`/big/${i}`)));
      const s = events.find((e) => e.type === 'done' && e.summary?.url?.endsWith(`/big/${i}`));
      assert.ok(s, `긍정 전제(O30): /big/${i} 완료 알림`);
      seen.push(s.summary.id);
    }
    // 세 건(약 1.2MiB)은 1MiB에 다 들어가지 않는다 → 가장 오래된 /big/0만 빠지고 둘이 남는다
    assert.deepEqual(posts().map((s: any) => s.id), seen.slice(1));
    assert.ok(events.some((e) => e.type === 'evicted' && e.ids.includes(seen[0])), 'evicted 알림에 가장 오래된 id');
    assert.equal(store.get(seen[0]), undefined, '빠진 기록은 상세로도 없다');
    assert.equal(store.get(seen[2]).request.body.length, 200 * 1024);
  } finally {
    await proxy.close();
    await plain.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
