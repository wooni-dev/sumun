// [TLS-4b 실측] 핸드셰이크 타임아웃(D4): 200 뒤 ClientHello를 보내지 않는 원시 클라이언트
//   node scripts/probe/tls4b-timeout.mjs
// TLS-4b.test.ts의 D4는 도우미 connectMitm이 200 뒤 곧바로 TLS를 시작해(ClientHello를 보냄) 이 상황을 만들지 못한다 — 그 대신 확인한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4b-to-'));
const ca = await loadOrCreateCA(path.join(base, 'ca'));
const flows = [];
const proxy = await startProxy({ port: 0, ca, tlsHandshakeTimeoutMs: 300, lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f) => flows.push(f) });
const raw = net.connect(proxy.port, '127.0.0.1');
raw.on('error', () => {});
await new Promise((r) => raw.once('connect', r));
raw.write('CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n');
const head = await new Promise((r) => raw.once('data', (d) => r(String(d))));
const t0 = Date.now();
const closedAfter = await new Promise((r) => (raw.once('close', () => r(Date.now() - t0)), setTimeout(() => r('3초 동안 안 닫힘'), 3000)));
await new Promise((r) => setTimeout(r, 200));
console.log(`CONNECT 응답 ${head.slice(0, 12)} / ClientHello 없이 기다림 → ${closedAfter}ms 뒤 닫힘 / 기록 ${JSON.stringify(flows.map((f) => [f.request.method, f.error]))}`);
await proxy.close();
fs.rmSync(base, { recursive: true, force: true });
