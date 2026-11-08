// [TLS-4c 실측] 결함 1의 원인(E110~E112): listen하지 않은 http 서버에 TLS 소켓을 'connection'으로 넘기면 headersTimeout이 듣는가
//   node scripts/probe/tls4c-cause.mjs
// server.ts·mitm.ts와 같은 구조(listen하지 않는 안쪽 http 서버 + 서버 쪽 TLSSocket)를 따로 만들어, 연결 검사를 켜기('listening' emit) 전후를 비교한다.
// 임시 폴더의 CA만 쓴다. Windows 인증서 저장소는 건드리지 않는다. 인터넷에 연결하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4c-cause-'));
const ca = await loadOrCreateCA(path.join(base, 'ca'));
const leaf = await issueCert(ca, ['good.test']);
const context = tls.createSecureContext({ cert: leaf.certPem, key: leaf.keyPem });

// h = headersTimeout, listening = 연결 검사를 켜는지, send = 핸드셰이크 뒤 보낼 바이트(null = 아무것도 안 보냄)
// delayHello = 연결 뒤 ClientHello를 늦추는 시간(ms). 0이면 바로 핸드셰이크
async function run({ h, listening, send, wait = 3000, delayHello = 0 }) {
  const inner = http.createServer({ headersTimeout: h, requestTimeout: 0, connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(h / 2))) }, (_q, r) => r.end('ok'));
  inner.on('clientError', (_e, s) => s.destroy()); // server.ts의 inner와 같음
  if (listening) inner.emit('listening');
  const front = net.createServer((s) => {
    s.on('error', () => {});
    const t = new tls.TLSSocket(s, { isServer: true, secureContext: context, ALPNProtocols: ['http/1.1'] });
    t.on('error', () => t.destroy());
    inner.emit('connection', t); // mitm.ts처럼 핸드셰이크 전에 넘긴다
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  const raw = net.connect(front.address().port, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise((r) => raw.once('connect', r));
  let rawClosedMs = null;
  raw.once('close', () => (rawClosedMs = Date.now() - t0));
  if (delayHello) await new Promise((r) => setTimeout(r, delayHello));
  const c = tls.connect({ socket: raw, servername: 'good.test', ca: ca.certPem });
  let bytes = 0;
  let handshake = 'pending';
  c.on('data', (d) => (bytes += d.length));
  c.on('error', (e) => handshake === 'pending' && (handshake = `실패(${e.code})`));
  c.once('secureConnect', () => {
    handshake = 'ok';
    if (send) c.write(send);
  });
  const closed = await new Promise((r) => (c.once('close', () => r(Date.now() - t0)), setTimeout(() => r(null), wait)));
  if (handshake === 'pending' && closed !== null) handshake = '실패(오류 없이 닫힘)';
  c.destroy();
  inner.close(); // 'listening'을 emit했으면 검사 타이머를 정리한다(httpServerPreClose)
  front.close();
  return { h, listening, delayHello, send: send === null ? '없음' : JSON.stringify(send), handshake, closedMs: closed, rawClosedMs, bytes };
}

const HALF = 'GET / HTTP/1.1\r\nHost: good';
const rows = [];
// E110 ①: 지금 구조 그대로
rows.push(['E110-1', await run({ h: 500, listening: false, send: null })]);
rows.push(['E110-1', await run({ h: 500, listening: false, send: HALF })]);
// E110 ②, E111: 검사를 켬
rows.push(['E110-2', await run({ h: 500, listening: true, send: null })]);
rows.push(['E110-2', await run({ h: 500, listening: true, send: HALF })]);
// E112: 검사를 켜고 h=1
rows.push(['E112', await run({ h: 1, listening: true, send: null, wait: 1500 })]);
// E112 추가 관찰: 이 PC에서는 핸드셰이크가 첫 검사(50ms)보다 빨리 끝난다 → ClientHello를 300ms 늦춘 클라이언트(느린 망·느린 클라이언트)
rows.push(['E112-지연', await run({ h: 1, listening: true, send: null, wait: 1500, delayHello: 300 })]);
rows.push(['E112-지연', await run({ h: 1000, listening: true, send: null, wait: 3000, delayHello: 300 })]);
for (const [id, r] of rows) console.log(id, JSON.stringify(r));
fs.rmSync(base, { recursive: true, force: true });
process.exit(0);
