// 검토 실험: 복호화 터널/평문 프록시에서 느린·유휴 연결 변형이 언제 닫히는지 잰다. 임시 CA만 쓴다.
// 실행: node scripts/probe/tls4c-review/idle-variants.ts [대기초=20]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { loadOrCreateCA, issueCert } from '../../../src/ca/ca.ts';
import { startProxy } from '../../../src/proxy/server.ts';

const WAIT = Number(process.argv[2] ?? 20) * 1000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-rv2-'));
const proxyCA = await loadOrCreateCA(path.join(tmp(), 'p'));
const upCA = await loadOrCreateCA(path.join(tmp(), 'u'));
const leaf = await issueCert(upCA, ['good.test', '127.0.0.1']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 목적지: /slow 는 4초 뒤 응답, 그 외 즉시. 본문은 끝까지 읽은 뒤 응답
const app = (req: http.IncomingMessage, res: http.ServerResponse) => {
  let n = 0;
  req.on('data', (c) => (n += c.length));
  req.on('end', () => {
    const send = () => res.writeHead(200, { 'content-length': 2 }).end('ok');
    if (req.url === '/slow') setTimeout(send, 2500);
    else if (req.url === '/sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); let i = 0; const iv = setInterval(() => (++i > 8 ? (clearInterval(iv), res.end()) : res.write(`data: ${i}

`)), 500); }
    else send();
  });
};
const ups = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, app);
ups.on('tlsClientError', () => {});
await new Promise<void>((r) => ups.listen(0, '127.0.0.1', () => r()));
const UP = (ups.address() as net.AddressInfo).port;
const plainUp = http.createServer(app);
await new Promise<void>((r) => plainUp.listen(0, '127.0.0.1', () => r()));
const PUP = (plainUp.address() as net.AddressInfo).port;

const flows: any[] = [];
const p = await startProxy({
  port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  headersTimeoutMs: 1000, tlsHandshakeTimeoutMs: 1000, upstreamTimeoutMs: 3000, onFlow: (f: any) => flows.push(f),
} as any);
const start = Date.now();
const res: Record<string, { closedAt: number | null; got: string; openedAt: number }> = {};
const now = () => Date.now() - start;

async function tunnel(key: string, tlsOpts: tls.ConnectionOptions = {}) {
  const s = net.connect(p.port, '127.0.0.1');
  s.on('error', () => {});
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.write(`CONNECT good.test:${UP} HTTP/1.1\r\nHost: good.test:${UP}\r\n\r\n`);
  await new Promise<void>((r) => s.once('data', () => r()));
  const t = tls.connect({ socket: s, servername: 'good.test', ca: proxyCA.certPem, ...tlsOpts });
  t.on('error', () => {});
  res[key] = { closedAt: null, got: '', openedAt: now() };
  t.on('data', (d) => (res[key].got += d.toString('latin1')));
  t.once('close', () => (res[key].closedAt ??= now()));
  await new Promise<void>((r) => t.once('secureConnect', () => r()));
  return { t, raw: s };
}
async function plain(key: string) {
  const s = net.connect(p.port, '127.0.0.1');
  s.on('error', () => {});
  await new Promise<void>((r) => s.once('connect', () => r()));
  res[key] = { closedAt: null, got: '', openedAt: now() };
  s.on('data', (d) => (res[key].got += d.toString('latin1')));
  s.once('close', () => (res[key].closedAt ??= now()));
  return s;
}
const drip = (w: { write: (s: string) => unknown; destroyed: boolean }, text: string, ms: number) => {
  let i = 0;
  const iv = setInterval(() => (w.destroyed || i >= text.length ? clearInterval(iv) : w.write(text[i++])), ms);
};
const REQ = (p0: string, extra = '') => `GET ${p0} HTTP/1.1\r\nHost: good.test:${UP}\r\n${extra}\r\n`;
const LONG = 'X-Pad: ' + 'a'.repeat(200) + '\r\n';

// I-a: 핸드셰이크 뒤 헤더를 400ms마다 1바이트
{ const { t } = await tunnel('Ia_drip'); t.write('GET / HTTP/1.1\r\n'); drip(t, LONG, 400); }
// I-b: 첫 요청 정상 → 응답 뒤 둘째 요청 헤더 반만
{ const { t } = await tunnel('Ib_ka_half'); t.write(REQ('/a')); await sleep(300); t.write('GET /b HTTP/1.1\r\nHost: good'); }
// I-c: 첫 요청 정상 → 둘째 요청 헤더를 400ms마다 1바이트
{ const { t } = await tunnel('Ic_ka_drip'); t.write(REQ('/a')); await sleep(300); t.write('GET /b HTTP/1.1\r\n'); drip(t, LONG, 400); }
// I-d: 첫 요청 정상 → 아무것도 안 보냄(keep-alive 유휴)
{ const { t } = await tunnel('Id_ka_idle'); t.write(REQ('/a')); }
// I-e: 파이프라이닝: 완전한 요청 + 반쪽 요청을 한 번에
{ const { t } = await tunnel('Ie_pipeline'); t.write(REQ('/a') + 'GET /b HTTP/1.1\r\nHost: go'); }
// I-f: 핸드셰이크 뒤 TLS 레코드 헤더(5바이트) + 일부만 원시 소켓에 쓰고 멈춤
{ const { raw } = await tunnel('If_tls_partial_record'); await sleep(500); raw.write(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x40, 1, 2, 3])); }
// I-g: Expect: 100-continue + Content-Length 10, 본문 안 보냄
{ const { t } = await tunnel('Ig_expect_nobody'); t.write(`POST / HTTP/1.1\r\nHost: good.test:${UP}\r\nContent-Length: 10\r\nExpect: 100-continue\r\n\r\n`); }
// I-h: Content-Length 100 본문을 400ms마다 1바이트(느린 업로드)
{ const { t } = await tunnel('Ih_slow_body'); t.write(`POST / HTTP/1.1\r\nHost: good.test:${UP}\r\nContent-Length: 100\r\n\r\n`); drip(t, 'b'.repeat(100), 400); }
// I-i: 헤더 반만 보내고 TLS 1.2 재협상 3번(2초마다)
{ const { t } = await tunnel('Ii_reneg', { maxVersion: 'TLSv1.2' }); t.write('GET / HTTP/1.1\r\n');
  let k = 0; const iv = setInterval(() => (k++ >= 3 || t.destroyed ? clearInterval(iv) : t.renegotiate({}, (e) => console.log('reneg', k, e?.code ?? 'ok', now()))), 2000); }
// I-z: 기준: 핸드셰이크 뒤 아무것도 안 보냄
{ await tunnel('Iz_nothing'); }
// K-c: SSE 4초 스트리밍, 클라이언트는 그동안 아무것도 안 보냄
{ const { t } = await tunnel('Kc_sse'); t.write(REQ('/sse')); }
// K-d: 2MB 업로드를 64KB씩 빠르게
{ const { t } = await tunnel('Kd_upload'); t.write(`POST / HTTP/1.1\r\nHost: good.test:${UP}\r\nContent-Length: ${2*1024*1024}\r\n\r\n`); for (let i = 0; i < 32; i++) t.write(Buffer.alloc(65536, 97)); }
// P-d: 평문 느린 본문
{ const s = await plain('Pd_plain_slow_body'); s.write(`POST http://127.0.0.1:${PUP}/ HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n`); drip(s, 'b'.repeat(100), 400); }
// K-a: 느린 목적지(4초) — headersTimeout 1초가 끊으면 안 됨
{ const { t } = await tunnel('Ka_slow_upstream'); t.write(REQ('/slow')); }
// K-b: keep-alive: 첫 요청 → 3초 쉼 → 둘째 요청(keepAlive 5초 안)
{ const { t } = await tunnel('Kb_ka_3s'); t.write(REQ('/a')); setTimeout(() => t.write(REQ('/b')), 3000); }
// 비교 P-a: 평문 프록시에서 헤더 1바이트씩
{ const s = await plain('Pa_plain_drip'); s.write(`GET http://127.0.0.1:${PUP}/ HTTP/1.1\r\n`); drip(s, LONG, 400); }
// 비교 P-b: 평문 첫 요청 → 둘째 반만
{ const s = await plain('Pb_plain_ka_half'); s.write(`GET http://127.0.0.1:${PUP}/a HTTP/1.1\r\nHost: x\r\n\r\n`); await sleep(300); s.write(`GET http://127.0.0.1:${PUP}/b HTTP/1.1\r\nHo`); }
// 비교 P-c: 평문 첫 요청 → 둘째 1바이트씩
{ const s = await plain('Pc_plain_ka_drip'); s.write(`GET http://127.0.0.1:${PUP}/a HTTP/1.1\r\nHost: x\r\n\r\n`); await sleep(300); s.write(`GET http://127.0.0.1:${PUP}/b HTTP/1.1\r\n`); drip(s, LONG, 400); }

const t0 = Date.now();
while (Object.values(res).some((v) => v.closedAt === null) && Date.now() - t0 < WAIT) await sleep(100);
for (const [k, v] of Object.entries(res)) {
  const statuses = [...v.got.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1]).join(',');
  if (k.startsWith('Pd') || k.startsWith('Kd')) console.log(JSON.stringify(v.got.slice(0,300)));
  console.log(k.padEnd(24), 'open->close(ms)=', String(v.closedAt === null ? null : v.closedAt - v.openedAt).padEnd(6), 'statuses=', statuses || '-');
}
console.log('flows:', JSON.stringify(flows.map((f) => ({ m: f.request.method, u: f.request.url, st: f.response?.status, err: f.error }))));
const before = Object.entries(res).filter(([, v]) => v.closedAt === null).map(([k]) => k);
const c0 = now(); await p.close(); await sleep(300);
console.log('close() 전 열린 것:', before.join(','), '| close() 뒤 300ms에도 열린 것:', Object.entries(res).filter(([, v]) => v.closedAt === null).map(([k]) => k).join(',') || '없음', '| close() 걸린 ms', now() - c0);
console.log('close 뒤 flows:', JSON.stringify(flows.slice(-12).map((f) => ({ m: f.request.method, u: f.request.url, st: f.response?.status, err: f.error }))));
ups.closeAllConnections(); ups.close(); plainUp.closeAllConnections(); plainUp.close();
process.exit(0);
