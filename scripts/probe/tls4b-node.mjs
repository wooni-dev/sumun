// [TLS-4b 실측] 지금 구현(TLS-4)의 복호화가 이상한 클라이언트·목적지에서 어떻게 되는가 (E102~E107)
//   node scripts/probe/tls4b-node.mjs
// 임시 폴더의 CA만 쓴다. Windows 인증서 저장소는 건드리지 않는다. 인터넷에 연결하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import http2 from 'node:http2';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

process.emitWarning = () => {}; // Node 경고(IP SNI 등)를 출력에서 숨긴다 — 아래에서 따로 적는다
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4b-'));
const proxyCA = await loadOrCreateCA(path.join(base, 'p'));
const upCA = await loadOrCreateCA(path.join(base, 'u'));
const flows = [];
const proxy = await startProxy({ port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], upstreamTimeoutMs: 3000, lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f) => flows.push(f) });
const leaf = await issueCert(upCA, ['localhost', '127.0.0.1']);
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

async function connect(host, port, tlsOpts = {}, afterOk) {
  const raw = net.connect(proxy.port, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise((r) => raw.once('connect', r));
  raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  const head = await new Promise((r) => raw.once('data', (d) => r(String(d))));
  if (afterOk) return afterOk(raw, head);
  const t = tls.connect({ socket: raw, host, ca: proxyCA.certPem, ...tlsOpts });
  const err = await new Promise((r) => (t.once('secureConnect', () => r(null)), t.once('error', (e) => r(e.code ?? e.message))));
  return { t, err };
}
const inTunnel = (t, req) =>
  new Promise((resolve) => {
    let out = '';
    t.on('data', (d) => (out += d));
    t.on('close', () => resolve(out));
    t.write(req);
    setTimeout(() => resolve(out), 2000);
  });
const lastFlow = async () => (await new Promise((r) => setTimeout(r, 300)), flows.at(-1));

const okUp = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, (req, res) => res.end(`up got ${req.method} ${req.url} upgrade=${req.headers.upgrade ?? '-'}`));
const okPort = await listen(okUp);

// E102 D8: 클라이언트가 ALPN h2만
{
  const { t, err } = await connect('localhost', okPort, { servername: 'localhost', ALPNProtocols: ['h2'] });
  console.log(`E102 ALPN h2만 → 클라이언트 ${err ?? `성공(alpn=${t.alpnProtocol})`}`);
  t.destroy();
}
// E103 D2: 클라이언트가 TLS 1.1 이하
{
  const { t, err } = await connect('localhost', okPort, { servername: 'localhost', minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
  console.log(`E103 TLS 1.1 이하 → 클라이언트 ${err ?? '성공'}, 기록 ${JSON.stringify((await lastFlow())?.error)}`);
  t.destroy();
}
// E104 D1: 200 뒤 평문 바이트
{
  const n = flows.length;
  const r = await connect('localhost', okPort, {}, async (raw) => {
    raw.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    const got = await new Promise((res) => {
      let o = '';
      raw.on('data', (d) => (o += d.toString('latin1')));
      raw.once('close', () => res(`닫힘(받은 ${o.length}바이트)`));
      setTimeout(() => res(`3초 동안 안 닫힘(받은 ${o.length}바이트)`), 3000);
    });
    return got;
  });
  await new Promise((res) => setTimeout(res, 300));
  console.log(`E104 200 뒤 평문 → ${r}, 새 기록 ${flows.length - n}개 ${JSON.stringify(flows.at(-1)?.error)}`);
}
// E105 E10: 터널 안 Upgrade
{
  const { t, err } = await connect('localhost', okPort, { servername: 'localhost' });
  const out = await inTunnel(t, `GET /ws HTTP/1.1\r\nHost: localhost:${okPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  console.log(`E105 터널 안 Upgrade → 핸드셰이크 ${err ?? 'ok'}, 응답 ${JSON.stringify(out.slice(0, 120))}`);
}
// E106 C5·A13·A7·A15: 목적지 TLS 실패 종류별 오류 코드(server.ts와 같은 옵션으로 직접)
const trust = [...tls.rootCertificates, upCA.certPem];
const servers = {
  h2만: http2.createSecureServer({ cert: leaf.certPem, key: leaf.keyPem, allowHTTP1: false }),
  평문TCP: net.createServer((s) => (s.on('error', () => {}), s.end('HTTP/1.1 200 OK\r\n\r\nplain'))),
  'TLS1.0만': tls.createServer({ cert: leaf.certPem, key: leaf.keyPem, minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' }, (s) => s.end()),
  클라이언트인증서요구: https.createServer({ cert: leaf.certPem, key: leaf.keyPem, requestCert: true, rejectUnauthorized: true, ca: [upCA.certPem] }, (_q, r) => r.end('x')),
};
for (const [name, s] of Object.entries(servers)) {
  s.on('error', () => {});
  s.on('tlsClientError', () => {});
  const port = await listen(s);
  const direct = await new Promise((resolve) => {
    const q = https.request({ host: '127.0.0.1', port, servername: 'localhost', ca: trust, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], agent: false, path: '/' }, (res) => (res.resume(), resolve(`응답 ${res.statusCode}`)));
    q.on('error', (e) => resolve(e.code ?? e.message));
    q.end();
  });
  const { t } = await connect('localhost', port, { servername: 'localhost' });
  const out = await inTunnel(t, `GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
  console.log(`E106 목적지 ${name} → https.request 오류 ${direct} / 프록시 ${out.slice(9, 12)} 기록 ${JSON.stringify((await lastFlow())?.error)}`);
  s.close();
}
// E107 B4: SNI가 IP
{
  const { t, err } = await connect('localhost', okPort, { servername: '127.0.0.1' }).catch((e) => ({ err: `예외 ${e.code ?? e.message}` }));
  if (t && !err) {
    await inTunnel(t, `GET /sni HTTP/1.1\r\nHost: localhost:${okPort}\r\nConnection: close\r\n\r\n`);
    console.log(`E107 servername '127.0.0.1' → 핸드셰이크 ok, 받은 인증서 SAN ${t.getPeerCertificate()?.subjectaltname}, 기록 sni ${JSON.stringify((await lastFlow())?.tls)}`);
  } else console.log(`E107 servername '127.0.0.1' → 핸드셰이크 ${err}, 기록 ${JSON.stringify((await lastFlow())?.error)}`);
  // 같은 요청을 host: 'localhost'(IP 아님)로 검사하게 하면? — 실패 원인이 이름 검사인지 가른다
  const r2 = await connect('localhost', okPort, { servername: '127.0.0.1', checkServerIdentity: () => undefined });
  console.log(`E107' 이름 검사를 끄고 servername '127.0.0.1' → ${r2.err ?? `ok, 인증서 SAN ${r2.t.getPeerCertificate()?.subjectaltname}`}`);
  r2.t?.destroy();
}
okUp.close();
await proxy.close();
fs.rmSync(base, { recursive: true, force: true });
