// 검토 에이전트용 검증 스크립트(TLS 큰 단위). 실행: node scripts/review/tls/review-mitm.ts
// 임시 폴더에만 CA를 만든다. Windows 인증서 저장소와 실제 %LOCALAPPDATA%\sumun\ca는 건드리지 않는다. 인터넷을 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { loadOrCreateCA, issueCert, defaultCADir } from '../../../src/ca/ca.ts';
import { startProxy } from '../../../src/proxy/server.ts';

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, info = '') => (results.push([name, ok, info]), console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const proxyCA = await loadOrCreateCA(tmp('sumun-rv-proxy-'));
const upCA = await loadOrCreateCA(tmp('sumun-rv-up-'));
const goodCert = await issueCert(upCA, ['good.test', 'localhost', '127.0.0.1']);
const otherCert = await issueCert(upCA, ['other.test']);

async function upstream(pair: { certPem: string; keyPem: string }) {
  const got: { url: string; host?: string; body: string }[] = [];
  const s = https.createServer({ cert: pair.certPem, key: pair.keyPem }, (req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => (got.push({ url: req.url ?? '', host: req.headers.host, body: b }), res.writeHead(201, { 'x-up': 'yes', 'content-type': 'text/plain' }).end('resp-body')));
  });
  s.on('tlsClientError', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { port: (s.address() as net.AddressInfo).port, got, close: () => (s.closeAllConnections(), s.close()) };
}
const good = await upstream(goodCert);
const other = await upstream(otherCert);
const NAMES = new Set(['good.test', 'other.test', 'mismatch.test']);
const lookup = async (h: string) => {
  if (NAMES.has(h)) return [{ address: '127.0.0.1', family: 4 }];
  throw new Error('no');
};

async function mitm(proxyPort: number, connectTo: string, servername: string | undefined, raw: string) {
  const s = net.connect(proxyPort, '127.0.0.1');
  s.on('error', () => {});
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.write(`CONNECT ${connectTo} HTTP/1.1\r\nHost: ${connectTo}\r\n\r\n`);
  const head = await new Promise<string>((r) => {
    let b = '';
    const on = (d: Buffer) => {
      b += d.toString('latin1');
      if (b.includes('\r\n\r\n')) (s.off('data', on), r(b));
    };
    s.on('data', on);
    s.once('close', () => r(b));
  });
  if (!head.startsWith('HTTP/1.1 200')) return { head, out: '', san: '' };
  const t = tls.connect({ socket: s, servername, ca: proxyCA.certPem, ALPNProtocols: ['http/1.1'], checkServerIdentity: () => undefined });
  const err = await new Promise<string | undefined>((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e: any) => r(e.code))));
  if (err) return { head, out: `TLSERR ${err}`, san: '' };
  const san = String(t.getPeerCertificate().subjectaltname);
  let out = '';
  t.on('data', (d) => (out += d));
  t.write(raw);
  await new Promise<void>((r) => (t.once('close', () => r()), setTimeout(r, 2000)));
  t.destroy();
  return { head, out, san };
}
const line1 = (s: string) => s.split('\r\n')[0];

const flows: any[] = [];
const proxy = await startProxy({ port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], lookup, onFlow: (f) => void flows.push(f) });
check('바인딩 주소 127.0.0.1', proxy.address().address === '127.0.0.1', proxy.address().address);

// 1. 정상: POST가 복호화되어 기록되고 목적지로 간다
const P = good.port;
let r = await mitm(proxy.port, `good.test:${P}`, 'good.test', `POST /a?q=1 HTTP/1.1\r\nHost: good.test:${P}\r\nCookie: s=1\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello`);
await sleep(200);
const f = flows.find((x) => x.request.method === 'POST');
check('정상 요청 응답 201', r.out.startsWith('HTTP/1.1 201'), line1(r.out));
check(
  '기록: 메서드·대상·상태·헤더·본문',
  !!f && f.request.target?.scheme === 'https' && f.request.target.host === 'good.test' && f.request.target.path === '/a?q=1' && f.response?.status === 201 &&
    f.request.body.toString() === 'hello' && f.response.body.toString() === 'resp-body' && f.response.headers.some(([k]: string[]) => k === 'x-up') &&
    f.request.headers.some(([k, v]: string[]) => k === 'Cookie' && v === 's=1'),
  JSON.stringify(f && { t: f.request.target, st: f.response?.status, tls: f.tls }),
);
check('목적지가 받은 요청', good.got[0]?.url === '/a?q=1' && good.got[0]?.body === 'hello', JSON.stringify(good.got[0]));

// 2. SNI를 다른 이름으로: 인증서·목적지는 CONNECT 이름
flows.length = 0;
r = await mitm(proxy.port, `good.test:${P}`, 'evil.example', `GET /sni HTTP/1.1\r\nHost: good.test:${P}\r\nConnection: close\r\n\r\n`);
await sleep(200);
check('SNI 달라도 인증서는 CONNECT 이름', r.san.includes('good.test') && !r.san.includes('evil'), r.san);
check('SNI는 기록에 남음', flows[0]?.tls?.sni === 'evil.example', JSON.stringify(flows[0]?.tls));

// 3. 터널 안 Host를 다른 사이트로 → 421, 목적지에 가지 않음
const before = good.got.length + other.got.length;
r = await mitm(proxy.port, `good.test:${P}`, 'good.test', `GET /x HTTP/1.1\r\nHost: other.test:${other.port}\r\nConnection: close\r\n\r\n`);
check('Host 바꾸기 → 421', r.out.startsWith('HTTP/1.1 421') && good.got.length + other.got.length === before, line1(r.out));
r = await mitm(proxy.port, `good.test:${P}`, 'good.test', `GET https://other.test:${other.port}/x HTTP/1.1\r\nHost: good.test:${P}\r\nConnection: close\r\n\r\n`);
check('absolute-form 다른 사이트 → 421', r.out.startsWith('HTTP/1.1 421'), line1(r.out));

// 4. 목적지 인증서 이름 불일치(mismatch.test → other.test 인증서) → 502 bad-certificate
flows.length = 0;
r = await mitm(proxy.port, `mismatch.test:${other.port}`, 'mismatch.test', `GET / HTTP/1.1\r\nHost: mismatch.test:${other.port}\r\nConnection: close\r\n\r\n`);
await sleep(200);
check('이름 불일치 → 502', r.out.startsWith('HTTP/1.1 502') && flows[0]?.error?.code === 'bad-certificate', JSON.stringify({ e: flows[0]?.error, u: flows[0]?.tls }));

// 5. 루프: CONNECT 127.0.0.1:프록시포트 → 508
r = await mitm(proxy.port, `127.0.0.1:${proxy.port}`, undefined, '');
check('자기 자신 CONNECT → 508', r.head.startsWith('HTTP/1.1 508'), line1(r.head));
await proxy.close();

// 6. 목적지 CA를 믿지 않는 프록시 + NODE_TLS_REJECT_UNAUTHORIZED=0 → 그래도 502
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const flows2: any[] = [];
const p2 = await startProxy({ port: 0, ca: proxyCA, lookup, onFlow: (x) => void flows2.push(x) });
r = await mitm(p2.port, `good.test:${P}`, 'good.test', `GET / HTTP/1.1\r\nHost: good.test:${P}\r\nConnection: close\r\n\r\n`);
await sleep(200);
check('NODE_TLS_REJECT_UNAUTHORIZED=0이어도 검증', r.out.startsWith('HTTP/1.1 502') && flows2[0]?.error?.code === 'bad-certificate', JSON.stringify({ e: flows2[0]?.error, tls: flows2[0]?.tls }));
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
await p2.close();

// 7. 자원: 핸드셰이크 뒤 아무 요청도 보내지 않는 연결이 닫히는가(headersTimeoutMs 500)
const p3 = await startProxy({ port: 0, ca: proxyCA, lookup, headersTimeoutMs: 500, tlsHandshakeTimeoutMs: 500 });
const idle: tls.TLSSocket[] = [];
let closedIdle = 0;
for (let i = 0; i < 5; i++) {
  const s = net.connect(p3.port, '127.0.0.1');
  s.on('error', () => {});
  await new Promise<void>((res) => s.once('connect', () => res()));
  s.write(`CONNECT good.test:${P} HTTP/1.1\r\nHost: good.test:${P}\r\n\r\n`);
  await new Promise<void>((res) => s.once('data', () => res()));
  const t = tls.connect({ socket: s, servername: 'good.test', ca: proxyCA.certPem, checkServerIdentity: () => undefined });
  t.on('error', () => {});
  t.once('close', () => closedIdle++);
  t.resume();
  await new Promise<void>((res) => t.once('secureConnect', () => res()));
  idle.push(t);
}
const t0 = Date.now();
while (closedIdle < 5 && Date.now() - t0 < 10_000) await sleep(100);
check('핸드셰이크 뒤 무요청 연결이 10초 안에 닫힘(5개)', closedIdle === 5, `닫힘 ${closedIdle}/5, ${Date.now() - t0}ms`);
idle.forEach((t) => t.destroy());
// 핸드셰이크를 시작하지 않는 연결
const s4 = net.connect(p3.port, '127.0.0.1');
let c4 = false;
s4.on('error', () => {});
s4.once('close', () => (c4 = true));
s4.resume();
await new Promise<void>((res) => s4.once('connect', () => res()));
s4.write(`CONNECT good.test:${P} HTTP/1.1\r\nHost: good.test:${P}\r\n\r\n`);
await sleep(1500);
check('ClientHello 없는 연결이 닫힘', c4);
await p3.close();

// 8. CA 폴더 규칙
let code = '';
try {
  await loadOrCreateCA(path.join(process.cwd(), 'tmp-review-ca'));
} catch (e: any) {
  code = e.code;
}
check('저장소 안 CA 폴더 거부', code === 'CA_DIR_IN_REPO' && !fs.existsSync(path.join(process.cwd(), 'tmp-review-ca')), code);
const d = defaultCADir({ LOCALAPPDATA: 'C:\\X\\Local' });
check('기본 CA 폴더 = %LOCALAPPDATA%\\sumun\\ca', d === 'C:\\X\\Local\\sumun\\ca', d);
code = '';
try {
  defaultCADir({ APPDATA: 'C:\\X\\Roaming' });
} catch (e: any) {
  code = e.code;
}
check('LOCALAPPDATA 없으면 거부(APPDATA로 대신하지 않음)', code === 'CA_ENV_MISSING', code);

good.close();
other.close();
const failed = results.filter((x) => !x[1]).length;
console.log(`\n합계 ${results.length}개, 실패 ${failed}개`);
process.exit(failed ? 1 : 0);
