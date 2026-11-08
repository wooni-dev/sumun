// [TLS-4 실측] 남은 실패 5개가 테스트 쪽 결함 때문인지 — 같은 시나리오를 "고친 클라이언트"로 지금 구현에 돌려 본다
//   node scripts/probe/tls4-test-defects.mjs
// 결함 후보:
//   ① TLS-T 1번, TLS-4 E11·B2: 목적지 시험 서버가 writeHead() 뒤 end()라 응답이 chunked인데, 테스트는 본문이 원문 끝에 그대로 있다고 본다
//   ② TLS-4 A11: tls.connect에 socket만 주고 host를 안 주면 Node는 'localhost'로 이름을 검사한다(IP 인증서와 안 맞음)
//   ③ TLS-4 G1: 테스트의 가짜 lookup에 'localhost.'(끝점) 항목이 없다
// 임시 폴더의 CA만 쓴다. Windows 인증서 저장소는 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4-defects-'));
const proxyCA = await loadOrCreateCA(path.join(base, 'proxy'));
const upCA = await loadOrCreateCA(path.join(base, 'up'));
const flows = [];
const NAMES = { localhost: ['127.0.0.1'], 'localhost.': ['127.0.0.1'] };
const proxy = await startProxy({
  port: 0,
  ca: proxyCA,
  upstreamCA: [upCA.certPem],
  lookup: async (h) => (NAMES[h] ?? []).map((address) => ({ address, family: 4 })),
  onFlow: (f) => flows.push(f),
});
async function up(pair) {
  const s = https.createServer({ cert: pair.certPem, key: pair.keyPem }, (req, res) => (req.resume(), req.on('end', () => res.writeHead(200, { 'content-type': 'text/plain' }).end('secure-hello'))));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { port: s.address().port, close: () => (s.closeAllConnections(), s.close()) };
}
async function mitm(host, port, tlsOpts) {
  const raw = net.connect(proxy.port, '127.0.0.1');
  await new Promise((r) => raw.once('connect', r));
  raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  const head = await new Promise((r) => raw.once('data', (d) => r(String(d))));
  const t = tls.connect({ socket: raw, ca: proxyCA.certPem, ...tlsOpts });
  const err = await new Promise((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e) => r(e.code))));
  return { status: head.slice(9, 12), t, err };
}
const fetchIn = (t, raw) =>
  new Promise((resolve) => {
    let out = '';
    t.on('data', (d) => (out += d));
    t.on('end', () => resolve(out));
    t.on('close', () => resolve(out));
    t.write(raw);
  });
// chunked 본문을 풀어 본문만 얻는다
const dechunk = (body) => {
  let out = '';
  for (let rest = body; ; ) {
    const i = rest.indexOf('\r\n');
    const n = parseInt(rest.slice(0, i), 16);
    if (!n) return out;
    out += rest.slice(i + 2, i + 2 + n);
    rest = rest.slice(i + 2 + n + 2);
  }
};

// ① chunked
{
  const u = await up(await issueCert(upCA, ['localhost']));
  const m = await mitm('localhost', u.port, { servername: 'localhost' });
  const r = await fetchIn(m.t, `GET /hello?q=1 HTTP/1.1\r\nHost: localhost:${u.port}\r\nConnection: close\r\n\r\n`);
  const [h, body] = [r.slice(0, r.indexOf('\r\n\r\n')), r.slice(r.indexOf('\r\n\r\n') + 4)];
  console.log(`① 상태 ${r.slice(9, 12)}, Transfer-Encoding: ${/transfer-encoding: chunked/i.test(h) ? 'chunked' : '없음'}, 원문 끝이 secure-hello? ${r.endsWith('secure-hello')}, chunked를 푼 본문 = ${JSON.stringify(dechunk(body))}`);
  await new Promise((r) => setTimeout(r, 100));
  const f = flows.at(-1);
  console.log(`   기록: ${f.request.method} ${f.request.url} target=${JSON.stringify(f.request.target)} 응답 ${f.response?.status} 본문 ${JSON.stringify(f.response?.body.toString())} sni=${JSON.stringify(f.tls)}`);
  u.close();
}
// ② IP: host를 주면 IP SAN으로 검증된다
{
  const u = await up(await issueCert(upCA, ['127.0.0.1']));
  const a = await mitm('127.0.0.1', u.port, {});
  const b = await mitm('127.0.0.1', u.port, { host: '127.0.0.1' });
  console.log(`② host 없이 → ${a.err ?? '성공'} / host: '127.0.0.1' → ${b.err ?? '성공'}, 받은 인증서 SAN ${b.t.getPeerCertificate().subjectaltname}`);
  const r = await fetchIn(b.t, `GET /ip HTTP/1.1\r\nHost: 127.0.0.1:${u.port}\r\nConnection: close\r\n\r\n`);
  console.log(`   IP 목적지 응답 ${r.slice(9, 12)}`);
  a.t.destroy();
  u.close();
}
// ③ 'localhost.'를 lookup이 알면 20개 모두 같은 인증서
{
  const u = await up(await issueCert(upCA, ['localhost']));
  const names = Array.from({ length: 20 }, (_, i) => ['localhost', 'LOCALHOST', 'localhost.'][i % 3]);
  const all = await Promise.all(names.map((h) => mitm(h, u.port, { servername: 'localhost' })));
  console.log(`③ 상태 ${[...new Set(all.map((m) => m.status))]}, 오류 ${all.filter((m) => m.err).length}개, 인증서 종류 ${new Set(all.map((m) => m.t.getPeerCertificate().fingerprint256)).size}`);
  all.forEach((m) => m.t.destroy());
  u.close();
}
await proxy.close();
fs.rmSync(base, { recursive: true, force: true });
