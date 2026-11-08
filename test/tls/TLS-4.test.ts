// [TLS-4] 새 동작: CONNECT 뒤 TLS를 종료하고, 복호화한 요청을 기록·중계한다. 사례 번호는 docs/ai/tls4-cases.md(배정 "4").
//   startProxy({ ca, upstreamCA }) — 클라이언트에는 issueCert로 만든 인증서, 목적지에는 새 TLS(검증 명시, 공개 CA + upstreamCA)
//   기록: 요청마다 { request: { url: 터널 안 원문, target: { scheme: 'https', host, port, path } }, tls: { sni } }
//         CONNECT 기록은 터널 안 요청이 하나도 없을 때만(거절·핸드셰이크 실패) — 결정 7
//   사용자 결정(2026-11-08): SNI ≠ CONNECT면 CONNECT 기준 / 터널 안 Host가 다르면 421 / 목적지 불신은 터널 안 502 / npm start는 --decrypt일 때만
// 모든 CA는 임시 폴더. Windows 인증서 저장소와 실제 %LOCALAPPDATA%\sumun\ca는 건드리지 않는다. 인터넷에 연결하지 않는다.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';
import { parseArgs } from '../../src/cli.ts';
import { closedPort } from '../prx/_upstream.ts';

type Pair = { certPem: string; keyPem: string };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}
const temps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4-'));
  temps.push(d);
  return d;
};

// 목적지: 받은 요청을 적어 두는 HTTPS 서버. TCP 접속 수도 센다(사례 D3: 목적지 연결 0회)
type Up = { port: number; got: { url: string; host?: string; cookie?: string }[]; conns: number; close: () => Promise<void> };
async function upstream(pair: Pair, body = 'secure-hello', extraHeaders: Record<string, string> = {}): Promise<Up> {
  const u = { got: [], conns: 0 } as unknown as Up;
  const s = https.createServer({ cert: pair.certPem, key: pair.keyPem }, (req, res) => {
    u.got.push({ url: req.url ?? '', host: req.headers.host, cookie: req.headers.cookie });
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'text/plain', ...extraHeaders }).end(body));
  });
  s.on('connection', () => u.conns++);
  s.on('tlsClientError', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  u.port = (s.address() as net.AddressInfo).port;
  u.close = () => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())));
  return u;
}
// 일부러 잘못 만든 말단 인증서(만료·자체 서명) — 사례 A1·A2
function badLeaf(signer: Pair | null, notBefore: Date, notAfter: Date): Pair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = notBefore;
  c.validity.notAfter = notAfter;
  c.setSubject([{ name: 'commonName', value: 'localhost' }]);
  c.setIssuer(signer ? forge.pki.certificateFromPem(signer.certPem).subject.attributes : c.subject.attributes);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(forge.pki.privateKeyFromPem(signer ? signer.keyPem : keyPem), forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(c), keyPem };
}

const ctx = {} as { proxyCA: Pair; upCA: Pair; otherCA: Pair; proxy: Awaited<ReturnType<typeof startProxy>>; flows: any[]; lookups: Record<string, number> };
let mark = 0;
// 'localhost.'(끝점): G1이 CONNECT에 그대로 보내는 변형 [TLS-4 구현 뒤 추가, 사용자 허용 2026-11-08: 처음에는 빠져 그 변형만 502였다]
const NAMES: Record<string, string[]> = { localhost: ['127.0.0.1'], 'localhost.': ['127.0.0.1'], 'evil.test': ['127.0.0.1'], 'rebind.test': ['127.0.0.1', '127.0.0.2'], 'myhost': ['127.0.0.1'] };
before(async () => {
  ctx.proxyCA = await loadOrCreateCA(path.join(tmp(), 'proxy'));
  ctx.upCA = await loadOrCreateCA(path.join(tmp(), 'up'));
  ctx.otherCA = await loadOrCreateCA(path.join(tmp(), 'other'));
  ctx.flows = [];
  ctx.lookups = {};
  ctx.proxy = await startProxy({
    port: 0,
    ca: ctx.proxyCA,
    upstreamCA: [ctx.upCA.certPem],
    upstreamTimeoutMs: 2000,
    // rebind.test: 처음엔 127.0.0.1, 그다음부터 127.0.0.2 — 다시 해석하면 다른 곳으로 간다(사례 C1)
    lookup: async (host: string) => {
      const n = (ctx.lookups[host] = (ctx.lookups[host] ?? 0) + 1);
      const list = NAMES[host];
      if (!list) throw Object.assign(new Error('없는 이름'), { code: 'ENOTFOUND' });
      return [{ address: list[Math.min(n - 1, list.length - 1)], family: 4 }];
    },
    onFlow: (f: any) => void ctx.flows.push(f),
  } as Parameters<typeof startProxy>[0]);
});
after(async () => {
  await ctx.proxy?.close();
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
beforeEach(() => (mark = ctx.flows.length));
const newFlows = () => ctx.flows.slice(mark);

// 클라이언트: CONNECT → 200을 읽고 → 같은 소켓에서 TLS(기본은 프록시 CA만 믿음)
type Mitm = { status: number; head: string; t?: tls.TLSSocket; tlsError?: string };
async function connectMitm(host: string, port: number, o: { servername?: string | null; ca?: string; alpn?: string[]; anyName?: boolean; proxyPort?: number } = {}): Promise<Mitm> {
  const raw = net.connect(o.proxyPort ?? ctx.proxy.port, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise<void>((r) => raw.once('connect', () => r()));
  raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  let buf = Buffer.alloc(0);
  await new Promise<void>((resolve) => {
    const on = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.includes('\r\n\r\n')) (raw.off('data', on), resolve());
    };
    raw.on('data', on);
    raw.once('close', () => resolve());
    setTimeout(resolve, 3000);
  });
  const head = buf.toString('latin1');
  const status = Number(head.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0);
  if (status !== 200) return (raw.destroy(), { status, head });
  const servername = o.servername === null ? undefined : (o.servername ?? (net.isIP(host) ? undefined : host));
  // host: 소켓만 주면 Node는 이름 검사를 'localhost'로 한다 → IP로 접속할 때는 그 IP로 검사하게 넘긴다
  // [TLS-4 구현 뒤 고침, 사용자 허용 2026-11-08: 처음에는 host를 넘기지 않아 IP 인증서가 항상 이름 불일치였다(A11)]
  const t = tls.connect({ socket: raw, host, servername, ca: o.ca ?? ctx.proxyCA.certPem, ALPNProtocols: o.alpn ?? ['http/1.1'], ...(o.anyName ? { checkServerIdentity: () => undefined } : {}) });
  const tlsError = await new Promise<string | undefined>((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e: any) => r(e.code ?? e.message))));
  return { status, head, t, tlsError };
}
// 응답 하나의 본문. Transfer-Encoding: chunked면 조각을 풀어서 본다(목적지가 길이 없이 보내면 프록시는 HTTP 규칙대로 chunked로 전달한다)
// [TLS-4 구현 뒤 고침, 사용자 허용 2026-11-08: 처음에는 본문이 원문 끝에 그대로 있다고 가정했다(E11·B2)]
const isChunked = (head: string) => /\r\ntransfer-encoding: *chunked\r\n/i.test(`${head}\r\n`);
function bodyOf(raw: string) {
  const i = raw.indexOf('\r\n\r\n');
  let rest = raw.slice(i + 4);
  if (!isChunked(raw.slice(0, i))) return rest;
  let out = '';
  for (;;) {
    const j = rest.indexOf('\r\n');
    const n = parseInt(rest.slice(0, j), 16);
    if (!n) return out;
    out += rest.slice(j + 2, j + 2 + n);
    rest = rest.slice(j + 2 + n + 2);
  }
}
// 터널 안에서 요청 원문을 보내고 응답 n개를 받는다(Content-Length로, chunked면 마지막 조각으로 끝을 안다)
async function exchange(t: tls.TLSSocket, raw: string, n = 1) {
  let out = '';
  const on = (d: Buffer) => (out += d.toString('utf8'));
  t.on('data', on);
  t.write(raw);
  const done = () => {
    const parts = out.split(/(?=HTTP\/1\.1 \d{3} )/).filter(Boolean);
    return parts.length >= n && parts.slice(0, n).every((p) => {
      const i = p.indexOf('\r\n\r\n');
      if (i < 0) return false;
      if (isChunked(p.slice(0, i))) return p.includes('\r\n0\r\n\r\n', i);
      const len = Number(p.match(/content-length: (\d+)/i)?.[1] ?? NaN);
      return Number.isNaN(len) ? true : Buffer.byteLength(p.slice(i + 4)) >= len;
    });
  };
  await until(done, 4000);
  t.off('data', on);
  return out;
}
const GET = (p: string, host: string, extra = '') => `GET ${p} HTTP/1.1\r\nHost: ${host}\r\n${extra}\r\n`;

// ---------------- 기본 흐름 ----------------
test('E11·B1·D7·E13: CONNECT → 프록시 CA가 서명한 그 사이트 인증서(ALPN http/1.1) → 복호화한 GET이 목적지로 가고, 요청마다 기록(url 원문, target, sni, 쿠키 원본)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost', '127.0.0.1']));
  try {
    const m = await connectMitm('localhost', up.port, { alpn: ['h2', 'http/1.1'] });
    assert.equal(m.status, 200, `CONNECT 응답: ${m.head.slice(0, 80)}`);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    assert.equal(m.t!.authorized, true, '프록시 CA로 검증된다');
    assert.equal(m.t!.alpnProtocol, 'http/1.1');
    assert.match(m.t!.getPeerCertificate().subjectaltname, /DNS:localhost/);
    const r = await exchange(m.t!, GET('/hello?q=1', `localhost:${up.port}`, 'Cookie: k=SECRET\r\n'));
    assert.match(r, /^HTTP\/1\.1 200 /);
    assert.equal(bodyOf(r), 'secure-hello');
    assert.deepEqual(up.got, [{ url: '/hello?q=1', host: `localhost:${up.port}`, cookie: 'k=SECRET' }]);
    m.t!.destroy();
    await until(() => newFlows().length >= 1);
    await sleep(100);
    const fs_ = newFlows();
    assert.equal(fs_.length, 1, `기록 1개(CONNECT 기록 없음, 결정 7): ${JSON.stringify(fs_.map((f) => f.request.method))}`);
    const f = fs_[0];
    assert.equal(f.request.method, 'GET');
    assert.equal(f.request.url, '/hello?q=1');
    assert.deepEqual(f.request.target, { scheme: 'https', host: 'localhost', port: up.port, path: '/hello?q=1' });
    assert.deepEqual(f.tls, { sni: 'localhost' });
    assert.ok(f.request.headers.some(([n, v]: string[]) => n === 'Cookie' && v === 'k=SECRET'));
    assert.equal(f.response.status, 200);
    assert.equal(f.response.body.toString(), 'secure-hello');
    assert.equal(f.error, undefined);
  } finally {
    await up.close();
  }
});

test('E6: 같은 터널에서 keep-alive로 요청 3개 → 응답 3개, 기록 3개(경로가 각각 맞음)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm('localhost', up.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    const h = `localhost:${up.port}`;
    for (const p of ['/a', '/b', '/c']) assert.match(await exchange(m.t!, GET(p, h)), /^HTTP\/1\.1 200 /, p);
    m.t!.destroy();
    await until(() => newFlows().length >= 3);
    assert.deepEqual(newFlows().map((f) => f.request.target?.path), ['/a', '/b', '/c']);
    assert.deepEqual(up.got.map((g) => g.url), ['/a', '/b', '/c']);
  } finally {
    await up.close();
  }
});

// ---------------- A. 목적지 인증서 검증 ----------------
test('A1·A2·A3·A10·A16: 만료, 자체 서명, 이름 불일치, 프록시 자신의 CA가 서명 → 터널 안 502(고정 문구), 목적지 본문 0바이트, 기록 bad-certificate', async () => {
  const now = Date.now();
  const cases: [string, Pair][] = [
    ['만료', badLeaf(ctx.upCA, new Date(now - 10 * DAY), new Date(now - DAY))],
    ['자체 서명', badLeaf(null, new Date(now - DAY), new Date(now + DAY))],
    ['이름 불일치', await issueCert(ctx.upCA, ['other.test'])],
    ['프록시 CA가 서명', await issueCert(ctx.proxyCA, ['localhost'])],
  ];
  for (const [label, pair] of cases) {
    mark = ctx.flows.length;
    const up = await upstream(pair, 'secret-body');
    try {
      const m = await connectMitm('localhost', up.port);
      assert.equal(m.status, 200, `CONNECT ${m.status}`);
      assert.equal(m.tlsError, undefined, `${label}: 클라이언트 쪽 핸드셰이크는 된다`);
      const r = await exchange(m.t!, GET('/x', `localhost:${up.port}`));
      assert.match(r, /^HTTP\/1\.1 502 /, label);
      assert.match(r, /content-type: text\/plain/i, label);
      assert.ok(r.includes('목적지 서버의 인증서를 믿을 수 없습니다'), `${label}: 고정 문구`);
      assert.equal(r.includes('secret-body'), false, `${label}: 목적지 본문이 새지 않는다`);
      assert.equal(up.got.length, 0, `${label}: 목적지는 요청을 받지 않는다`);
      m.t!.destroy();
      await until(() => newFlows().length >= 1);
      assert.deepEqual(newFlows()[0]?.error, { by: 'upstream', code: 'bad-certificate', status: 502 }, label);
    } finally {
      await up.close();
    }
  }
});

test('A8: NODE_TLS_REJECT_UNAUTHORIZED=0이어도 목적지 검증은 꺼지지 않는다', async () => {
  const up = await upstream(badLeaf(null, new Date(Date.now() - DAY), new Date(Date.now() + DAY)), 'secret-body');
  const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const warn = process.emitWarning;
  process.emitWarning = () => {}; // Node가 내는 경고 한 줄을 테스트 출력에서 숨긴다
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const m = await connectMitm('localhost', up.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    const r = await exchange(m.t!, GET('/x', `localhost:${up.port}`));
    assert.match(r, /^HTTP\/1\.1 502 /);
    assert.equal(r.includes('secret-body'), false);
    m.t!.destroy();
  } finally {
    if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
    process.emitWarning = warn;
    await up.close();
  }
});

test('A11·A12·B5: CONNECT가 IP면 클라이언트에 IP SAN 인증서. 목적지 인증서에 IP SAN이 있으면 200, DNS 이름뿐이면 502', async () => {
  const good = await upstream(await issueCert(ctx.upCA, ['127.0.0.1']));
  const dnsOnly = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm('127.0.0.1', good.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined, 'IP로 접속해도 프록시 인증서가 검증된다(IP SAN)');
    assert.match(m.t!.getPeerCertificate().subjectaltname, /IP Address:127\.0\.0\.1/);
    assert.match(await exchange(m.t!, GET('/ip', `127.0.0.1:${good.port}`)), /^HTTP\/1\.1 200 /);
    m.t!.destroy();
    const m2 = await connectMitm('127.0.0.1', dnsOnly.port);
    assert.equal(m2.status, 200, `CONNECT ${m2.status}`);
    assert.equal(m2.tlsError, undefined);
    assert.match(await exchange(m2.t!, GET('/ip', `127.0.0.1:${dnsOnly.port}`)), /^HTTP\/1\.1 502 /);
    m2.t!.destroy();
  } finally {
    await good.close();
    await dnsOnly.close();
  }
});

// ---------------- B. SNI ----------------
test('B2·B3: SNI가 CONNECT와 달라도 인증서와 목적지는 CONNECT 기준이고, 기록에 SNI가 남는다 / SNI가 없어도 된다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  const evil = await upstream(await issueCert(ctx.upCA, ['evil.test']), 'evil-body');
  try {
    const m = await connectMitm('localhost', up.port, { servername: 'evil.test', anyName: true });
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    assert.match(m.t!.getPeerCertificate().subjectaltname, /^DNS:localhost$/, 'SNI가 아니라 CONNECT 이름의 인증서');
    const r = await exchange(m.t!, GET('/s', `localhost:${up.port}`));
    assert.equal(bodyOf(r), 'secure-hello');
    assert.equal(evil.got.length + evil.conns, 0, 'SNI의 이름으로 연결하지 않는다');
    m.t!.destroy();
    await until(() => newFlows().length >= 1);
    assert.deepEqual(newFlows()[0].tls, { sni: 'evil.test' });

    mark = ctx.flows.length;
    const n = await connectMitm('localhost', up.port, { servername: null });
    assert.equal(n.status, 200, `CONNECT ${n.status}`);
    assert.equal(n.tlsError, undefined, 'SNI 없이도 핸드셰이크');
    assert.match(n.t!.getPeerCertificate().subjectaltname, /DNS:localhost/);
    assert.match(await exchange(n.t!, GET('/n', `localhost:${up.port}`)), /^HTTP\/1\.1 200 /);
    n.t!.destroy();
    await until(() => newFlows().length >= 1);
    assert.deepEqual(newFlows()[0].tls, { sni: null });
  } finally {
    await up.close();
    await evil.close();
  }
});

// ---------------- G. 캐시 ----------------
test('G1·B6: 같은 호스트(대소문자·끝점 변형 포함)로 동시에 CONNECT 20개 → 모두 같은 인증서(발급 1번)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const names = Array.from({ length: 20 }, (_, i) => ['localhost', 'LOCALHOST', 'localhost.'][i % 3]);
    const all = await Promise.all(names.map((h) => connectMitm(h, up.port, { servername: 'localhost' })));
    assert.ok(all.every((m) => m.status === 200 && m.tlsError === undefined), `모두 성공: ${all.map((m) => m.status + (m.tlsError ?? '')).join(',')}`);
    const fps = new Set(all.map((m) => m.t!.getPeerCertificate().fingerprint256));
    assert.equal(fps.size, 1, `인증서 ${fps.size}종류`);
    all.forEach((m) => m.t!.destroy());
  } finally {
    await up.close();
  }
});

test('G4: CA가 다른 프록시 둘은 인증서를 섞지 않는다(각자의 CA로만 검증된다)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  const p2 = await startProxy({ port: 0, ca: ctx.otherCA, upstreamCA: [ctx.upCA.certPem] } as Parameters<typeof startProxy>[0]);
  try {
    const a = await connectMitm('localhost', up.port);
    const b = await connectMitm('localhost', up.port, { proxyPort: p2.port, ca: ctx.otherCA.certPem });
    assert.equal(a.status, 200, `CONNECT ${a.status}`);
    assert.equal(a.tlsError, undefined);
    assert.equal(b.status, 200, `CONNECT ${b.status}`);
    assert.equal(b.tlsError, undefined);
    assert.notEqual(a.t!.getPeerCertificate().fingerprint256, b.t!.getPeerCertificate().fingerprint256);
    a.t!.destroy();
    b.t!.destroy();
    const c = await connectMitm('localhost', up.port, { proxyPort: p2.port }); // 첫 프록시의 CA만 믿으면 실패해야 한다
    assert.ok(c.tlsError, '다른 CA의 인증서는 믿지 않는다');
  } finally {
    await p2.close();
    await up.close();
  }
});

// ---------------- C. 목적지 연결 ----------------
test('C1: 터널 안 두 번째 요청도 CONNECT 때 검사한 주소로 간다(이름을 다시 해석하지 않음)', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['rebind.test']));
  try {
    ctx.lookups['rebind.test'] = 0;
    const m = await connectMitm('rebind.test', up.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    const h = `rebind.test:${up.port}`;
    assert.match(await exchange(m.t!, GET('/1', h)), /^HTTP\/1\.1 200 /);
    assert.match(await exchange(m.t!, GET('/2', h)), /^HTTP\/1\.1 200 /, '다시 해석했다면 127.0.0.2로 가서 실패한다');
    assert.equal(ctx.lookups['rebind.test'], 1, '이름 해석은 한 번');
    assert.equal(up.got.length, 2);
    m.t!.destroy();
  } finally {
    await up.close();
  }
});

test('C2·C3·C4: CONNECT가 프록시 자신이면 200 전에 508 / 터널 안 요청에 이 프록시의 Via면 508 / 닫힌 포트면 터널 안 502 unreachable', async () => {
  const self = await connectMitm('127.0.0.1', ctx.proxy.port);
  assert.equal(self.status, 508);
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm('localhost', up.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    assert.match(await exchange(m.t!, GET('/v', `localhost:${up.port}`, 'Via: 1.1 sumun\r\n')), /^HTTP\/1\.1 508 /);
    assert.equal(up.got.length, 0);
    m.t!.destroy();
  } finally {
    await up.close();
  }
  const closed = await closedPort();
  mark = ctx.flows.length;
  const c = await connectMitm('localhost', closed);
  assert.equal(c.status, 200, `CONNECT ${c.status}`);
  assert.equal(c.tlsError, undefined);
  assert.match(await exchange(c.t!, GET('/c', `localhost:${closed}`)), /^HTTP\/1\.1 502 /);
  c.t!.destroy();
  await until(() => newFlows().length >= 1);
  assert.deepEqual(newFlows()[0].error, { by: 'upstream', code: 'unreachable', status: 502 });
});

// ---------------- D. 클라이언트 핸드셰이크 ----------------
test('D3: 클라이언트가 프록시 인증서를 믿지 않으면 핸드셰이크 실패 — 목적지 연결 0회, CONNECT 기록 tls-handshake', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  try {
    const m = await connectMitm('localhost', up.port, { ca: ctx.otherCA.certPem });
    assert.equal(m.status, 200, '전제: CONNECT는 받았다');
    assert.ok(m.tlsError, '클라이언트가 거부');
    await until(() => newFlows().length >= 1);
    await sleep(200);
    assert.equal(up.conns, 0, '목적지에 연결하지 않는다');
    const f = newFlows()[0];
    assert.equal(f?.request.method, 'CONNECT');
    assert.deepEqual(f?.error, { by: 'client', code: 'tls-handshake' });
  } finally {
    await up.close();
  }
});

test('D6: CONNECT와 같은 write로 보낸 ClientHello(head)로도 핸드셰이크·요청이 된다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  const raw = net.connect(ctx.proxy.port, '127.0.0.1');
  try {
    await new Promise<void>((r) => raw.once('connect', () => r()));
    let first = true;
    let gotHead = false;
    let pending = Buffer.alloc(0);
    const bridge = new Duplex({
      write(chunk, _e, cb) {
        raw.write(first ? Buffer.concat([Buffer.from(`CONNECT localhost:${up.port} HTTP/1.1\r\nHost: localhost:${up.port}\r\n\r\n`), chunk]) : chunk);
        first = false;
        cb();
      },
      read() {},
    });
    raw.on('data', (d) => {
      if (gotHead) return void bridge.push(d);
      pending = Buffer.concat([pending, d]);
      const i = pending.indexOf('\r\n\r\n');
      if (i >= 0) ((gotHead = true), bridge.push(pending.subarray(i + 4)));
    });
    const t = tls.connect({ socket: bridge as any, servername: 'localhost', ca: ctx.proxyCA.certPem });
    const err = await new Promise<string | undefined>((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e: any) => r(e.code ?? e.message))));
    assert.equal(err, undefined);
    assert.ok(pending.toString('latin1').startsWith('HTTP/1.1 200'), '전제: 200을 받았다');
    assert.match(await exchange(t, GET('/head', `localhost:${up.port}`)), /^HTTP\/1\.1 200 /);
    t.destroy();
  } finally {
    raw.destroy();
    await up.close();
  }
});

// ---------------- E. 터널 안 요청 ----------------
test('E1·E2·E3·E4: 터널 안 Host·대상이 CONNECT와 다르면 421, Host 없음·두 개는 400, 같은 대상의 absolute-form은 처리, 중첩 CONNECT는 거부 — 다른 곳으로 연결하지 않는다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']));
  const evil = await upstream(await issueCert(ctx.upCA, ['evil.test']), 'evil-body');
  const h = `localhost:${up.port}`;
  try {
    const cases: [string, string, RegExp][] = [
      ['Host 다름', GET('/x', `evil.test:${up.port}`), /^HTTP\/1\.1 421 /],
      ['Host 포트 다름', GET('/x', 'localhost:1'), /^HTTP\/1\.1 421 /],
      ['absolute-form 다른 대상', `GET https://evil.test:${evil.port}/x HTTP/1.1\r\nHost: evil.test:${evil.port}\r\n\r\n`, /^HTTP\/1\.1 421 /],
      ['absolute-form http', `GET http://${h}/x HTTP/1.1\r\nHost: ${h}\r\n\r\n`, /^HTTP\/1\.1 421 /],
      ['Host 없음', 'GET /x HTTP/1.1\r\n\r\n', /^HTTP\/1\.1 400 /],
      ['Host 두 개', `GET /x HTTP/1.1\r\nHost: ${h}\r\nHost: ${h}\r\n\r\n`, /^HTTP\/1\.1 400 /],
      ['중첩 CONNECT', `CONNECT evil.test:${evil.port} HTTP/1.1\r\nHost: evil.test:${evil.port}\r\n\r\n`, /^HTTP\/1\.1 4\d\d /],
    ];
    for (const [label, req, want] of cases) {
      const m = await connectMitm('localhost', up.port);
      assert.equal(m.status, 200, `CONNECT ${m.status}`);
      assert.equal(m.tlsError, undefined, label);
      assert.match(await exchange(m.t!, req), want, label);
      m.t!.destroy();
    }
    assert.equal(up.got.length + evil.got.length + evil.conns, 0, '어느 경우에도 목적지로 보내지 않는다');
    const ok = await connectMitm('localhost', up.port);
    assert.equal(ok.status, 200, `CONNECT ${ok.status}`);
    assert.equal(ok.tlsError, undefined);
    assert.match(await exchange(ok.t!, `GET https://${h}/abs HTTP/1.1\r\nHost: ${h}\r\n\r\n`), /^HTTP\/1\.1 200 /, '같은 대상의 absolute-form');
    assert.deepEqual(up.got.map((g) => g.url), ['/abs'], '목적지에는 경로만');
    ok.t!.destroy();
  } finally {
    await up.close();
    await evil.close();
  }
});

// ---------------- F·H ----------------
test('F3·F5·H2: 기록에 키가 없고(긍정 전제), 복호화 동안 디스크에 쓰지 않고, 목적지의 Strict-Transport-Security를 그대로 전달한다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']), 'hsts', { 'strict-transport-security': 'max-age=31536000' });
  const names = ['writeFileSync', 'writeFile', 'openSync', 'createWriteStream', 'appendFileSync'] as const;
  const orig = Object.fromEntries(names.map((n) => [n, (fs as any)[n]]));
  let writes = 0;
  try {
    const m = await connectMitm('localhost', up.port);
    assert.equal(m.status, 200, `CONNECT ${m.status}`);
    assert.equal(m.tlsError, undefined);
    for (const n of names) (fs as any)[n] = (...a: unknown[]) => (writes++, orig[n](...a));
    const r = await exchange(m.t!, GET('/h', `localhost:${up.port}`));
    for (const n of names) (fs as any)[n] = orig[n];
    assert.match(r, /strict-transport-security: max-age=31536000/i);
    assert.equal(writes, 0, '디스크에 쓰지 않는다');
    m.t!.destroy();
    await until(() => newFlows().length >= 1);
    assert.ok(ctx.proxyCA.keyPem.includes('PRIVATE KEY'), '전제: 키 PEM에는 머리말이 있다');
    const all = JSON.stringify(ctx.flows, (_k, v) => (v?.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v));
    assert.ok(all.includes('hsts'), '전제: 직렬화에 기록 내용이 들어 있다');
    assert.equal(all.includes('PRIVATE KEY'), false);
  } finally {
    for (const n of names) (fs as any)[n] = orig[n];
    await up.close();
  }
});

// ---------------- npm start --decrypt ----------------
test('cli: --decrypt를 줄 때만 decrypt: true(없으면 지금과 같은 모양), 두 번이면 오류', () => {
  assert.deepEqual(parseArgs(['--decrypt']), { port: 8080, decrypt: true });
  assert.deepEqual(parseArgs(['--port', '9000', '--decrypt']), { port: 9000, decrypt: true });
  assert.deepEqual(parseArgs([]), { port: 8080 });
  assert.equal(typeof (parseArgs(['--decrypt', '--decrypt']) as any).error, 'string');
});

test('index: --decrypt면 LOCALAPPDATA 아래에 CA를 만들고 복호화한다(목적지는 공개 CA만 믿으므로 로컬 시험 서버는 bad-certificate). 없으면 CA를 만들지 않는다', async () => {
  const up = await upstream(await issueCert(ctx.upCA, ['localhost']), 'secret-body');
  const run = async (decrypt: boolean) => {
    const local = tmp();
    const port = await closedPort();
    const child = spawn(process.execPath, [path.join(REPO, 'src', 'index.ts'), '--port', String(port), ...(decrypt ? ['--decrypt'] : [])], { cwd: REPO, env: { ...process.env, LOCALAPPDATA: local } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    await until(() => out.includes('프록시를 시작했습니다') || child.exitCode !== null, 8000);
    return { local, port, child, out: () => out };
  };
  try {
    const on = await run(true);
    try {
      assert.ok(on.out().includes('프록시를 시작했습니다'), `시작 줄: ${on.out().slice(0, 300)}`);
      const caCert = path.join(on.local, 'sumun', 'ca', 'ca-cert.pem');
      assert.ok(fs.existsSync(caCert), 'LOCALAPPDATA 아래에 CA를 만들었다');
      const m = await connectMitm('localhost', up.port, { proxyPort: on.port, ca: fs.readFileSync(caCert, 'utf8') });
      assert.equal(m.status, 200, `CONNECT ${m.status}`);
      assert.equal(m.tlsError, undefined, '그 CA로 프록시 인증서가 검증된다(복호화 중)');
      const r = await exchange(m.t!, GET('/x', `localhost:${up.port}`));
      assert.match(r, /^HTTP\/1\.1 502 /);
      assert.equal(r.includes('secret-body'), false);
      m.t!.destroy();
    } finally {
      on.child.kill();
    }
    const off = await run(false);
    try {
      assert.ok(off.out().includes('프록시를 시작했습니다'));
      assert.equal(fs.existsSync(path.join(off.local, 'sumun')), false, '--decrypt가 없으면 CA를 만들지 않는다');
    } finally {
      off.child.kill();
    }
  } finally {
    await up.close();
  }
});
