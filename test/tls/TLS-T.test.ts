// [TLS-T] TLS 큰 단위 테스트: HTTPS 사용자 흐름을 처음부터 끝까지 확인한다.
//
//   클라이언트 ──CONNECT localhost:U──▶ [프록시 127.0.0.1]
//      │ 같은 소켓에서 TLS (프록시 CA가 서명한 localhost 인증서를 믿음)
//      └─ GET /hello?q=1 ──▶ 프록시가 복호화 → 기록(Flow) → 목적지 인증서를 검증하고 HTTPS로 중계 ──▶ 로컬 HTTPS 목적지
//
// 마지막 작은 단위(TLS-4)가 src/tls/mitm.ts를 만들기 전까지는 대기(todo)다. 실행기가 그 파일이 없음을 직접 확인한다(INFRA-9).
// 테스트는 임시 폴더에 매번 새 CA를 만든다. Windows 인증서 저장소와 %APPDATA%\sumun\ca\는 절대 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';

const P = 'src/tls/mitm.ts';
const WAIT = { todo: !existsSync(P) && `대기: ${P}` };

type Pem = { certPem: string; keyPem: string };

// 임시 폴더 두 개에 CA 두 개를 만든다: 프록시 CA(클라이언트가 믿음), 목적지 CA(프록시가 upstreamCA로 믿음)
async function setup(opts: { trustUpstream: boolean }) {
  const { loadOrCreateCA, issueCert } = (await import('../../src/ca/ca.ts')) as {
    loadOrCreateCA: (dir: string) => Promise<Pem>;
    issueCert: (ca: Pem, hosts: string[]) => Promise<Pem>;
  };
  const { startProxy } = await import('../../src/proxy/server.ts');
  const dirs = [mkdtempSync(path.join(os.tmpdir(), 'sumun-tlst-proxy-')), mkdtempSync(path.join(os.tmpdir(), 'sumun-tlst-up-'))];
  const proxyCA = await loadOrCreateCA(dirs[0]);
  const upCA = await loadOrCreateCA(dirs[1]);
  const upCert = await issueCert(upCA, ['localhost', '127.0.0.1']);

  const got: { url: string; cookie?: string }[] = [];
  const up = https.createServer({ cert: upCert.certPem, key: upCert.keyPem }, (req, res) => {
    got.push({ url: req.url ?? '', cookie: req.headers.cookie });
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'text/plain' }).end('secure-hello'));
  });
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()));
  const U = (up.address() as net.AddressInfo).port;

  const flows: any[] = [];
  const proxy = await startProxy({
    port: 0,
    ca: proxyCA,
    upstreamCA: opts.trustUpstream ? [upCA.certPem] : [],
    onFlow: (f: any) => void flows.push(f),
  } as Parameters<typeof startProxy>[0]);

  return {
    proxyCA,
    U,
    got,
    flows,
    proxyPort: proxy.port,
    close: async () => {
      await proxy.close();
      await new Promise<void>((r) => (up.closeAllConnections(), up.close(() => r())));
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    },
  };
}

// CONNECT → 같은 소켓에서 TLS(프록시 CA만 믿음) → HTTP 요청 원문 → 응답 원문
async function httpsViaProxy(proxyPort: number, host: string, port: number, ca: string, request: string) {
  const { status, socket } = await new Promise<{ status: number; socket: net.Socket }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}`, agent: false });
    req.on('connect', (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('CONNECT 응답 없음(3초)')));
    req.end();
  });
  assert.equal(status, 200, 'CONNECT에 200이 와야 함');
  const t = tls.connect({ socket, servername: host, ca, ALPNProtocols: ['http/1.1'] });
  await new Promise<void>((resolve, reject) => (t.once('secureConnect', () => resolve()), t.once('error', reject)));
  const peer = t.getPeerCertificate();
  const raw = await new Promise<string>((resolve) => {
    let buf = '';
    t.on('data', (c) => (buf += c));
    t.on('end', () => resolve(buf));
    t.on('close', () => resolve(buf));
    t.on('error', () => resolve(buf));
    t.write(request);
  });
  return { authorized: t.authorized, peer, raw };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

// 응답 원문의 본문. Transfer-Encoding: chunked면 조각을 풀어서 본다(목적지가 길이 없이 보내면 프록시는 HTTP 규칙대로 chunked로 전달한다)
// [TLS-4에서 고침, 사용자 허용 2026-11-08: 처음에는 본문이 원문 끝에 그대로 있다고 가정했다]
function bodyOf(raw: string) {
  const i = raw.indexOf('\r\n\r\n');
  let rest = raw.slice(i + 4);
  if (!/\r\ntransfer-encoding: *chunked\r\n/i.test(`${raw.slice(0, i)}\r\n`)) return rest;
  let out = '';
  for (;;) {
    const j = rest.indexOf('\r\n');
    const n = parseInt(rest.slice(0, j), 16);
    if (!n) return out;
    out += rest.slice(j + 2, j + 2 + n);
    rest = rest.slice(j + 2 + n + 2);
  }
}

test('TLS 흐름: 브라우저처럼 CONNECT 뒤 TLS로 보낸 요청이 복호화되어 기록되고, 검증한 HTTPS 목적지로 중계된다', WAIT, async () => {
  const t = await setup({ trustUpstream: true });
  try {
    const r = await httpsViaProxy(t.proxyPort, 'localhost', t.U, t.proxyCA.certPem, `GET /hello?q=1 HTTP/1.1\r\nHost: localhost:${t.U}\r\nCookie: k=SECRET\r\nConnection: close\r\n\r\n`);

    // 1) 클라이언트: 프록시 CA가 서명한 localhost 인증서를 믿었고, 목적지의 응답을 받았다
    assert.equal(r.authorized, true, '프록시가 낸 인증서를 프록시 CA로 검증할 수 있어야 함');
    assert.match(r.raw, /^HTTP\/1\.1 200/);
    assert.equal(bodyOf(r.raw), 'secure-hello');

    // 2) 목적지: 터널 안의 경로와 쿠키를 그대로 받았다
    assert.deepEqual(t.got.at(-1), { url: '/hello?q=1', cookie: 'k=SECRET' });

    // 3) 기록: 복호화한 요청과 응답, 목적지 칸
    await until(() => t.flows.length > 0);
    const f = t.flows.find((x) => x.request?.target?.scheme === 'https');
    assert.ok(f, `https 기록이 있어야 함: ${JSON.stringify(t.flows.map((x) => x.request?.url))}`);
    assert.equal(f.request.method, 'GET');
    assert.equal(f.request.url, '/hello?q=1');
    assert.deepEqual(f.request.target, { scheme: 'https', host: 'localhost', port: t.U, path: '/hello?q=1' });
    assert.ok(f.request.headers.some(([n, v]: [string, string]) => n === 'Cookie' && v === 'k=SECRET'));
    assert.equal(f.response.status, 200);
    assert.equal(f.response.body.toString(), 'secure-hello');
    assert.equal(f.error, undefined);
  } finally {
    await t.close();
  }
});

test('TLS 흐름: 목적지 인증서를 믿을 수 없으면 중계하지 않고 502, 기록에 bad-certificate', WAIT, async () => {
  const t = await setup({ trustUpstream: false });
  try {
    const r = await httpsViaProxy(t.proxyPort, 'localhost', t.U, t.proxyCA.certPem, `GET /x HTTP/1.1\r\nHost: localhost:${t.U}\r\nConnection: close\r\n\r\n`);
    assert.equal(r.authorized, true);
    assert.match(r.raw, /^HTTP\/1\.1 502/);
    assert.equal(t.got.length, 0, '목적지는 요청을 받지 않아야 함(TLS 핸드셰이크에서 끊음)');
    await until(() => t.flows.length > 0);
    const f = t.flows.find((x) => x.request?.target?.scheme === 'https');
    assert.ok(f);
    assert.deepEqual(f.error, { by: 'upstream', code: 'bad-certificate', status: 502 });
  } finally {
    await t.close();
  }
});
