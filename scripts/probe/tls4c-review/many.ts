// 검토 실험: 핸드셰이크 뒤 헤더 반쪽으로 멈춘 복호화 터널 N개를 열고 메모리·정상 요청 지연·close() 시간을 잰다(같은 프로세스라 대략값)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net'; import tls from 'node:tls'; import https from 'node:https';
import { loadOrCreateCA, issueCert } from '../../../src/ca/ca.ts';
import { startProxy } from '../../../src/proxy/server.ts';
const N = Number(process.argv[2] ?? 300);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-rv5-'));
const pca = await loadOrCreateCA(tmp()); const uca = await loadOrCreateCA(tmp()); const leaf = await issueCert(uca, ['good.test']);
const ups = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, (_q, r) => r.end('ok')); await new Promise<void>((r) => ups.listen(0, '127.0.0.1', () => r()));
const UP = (ups.address() as net.AddressInfo).port;
const p = await startProxy({ port: 0, ca: pca, upstreamCA: [uca.certPem], lookup: async () => [{ address: '127.0.0.1', family: 4 }], headersTimeoutMs: 1000 } as any);
async function open(sendHalf: boolean) {
  const s = net.connect(p.port, '127.0.0.1'); s.on('error', () => {}); await new Promise<void>((r) => s.once('connect', () => r()));
  s.write(`CONNECT good.test:${UP} HTTP/1.1\r\nHost: good.test:${UP}\r\n\r\n`); await new Promise<void>((r) => s.once('data', () => r()));
  const t = tls.connect({ socket: s, servername: 'good.test', ca: pca.certPem }); t.on('error', () => {}); await new Promise<void>((r) => t.once('secureConnect', () => r()));
  if (sendHalf) t.write('GET / HTTP/1.1\r\nHost: good'); return t;
}
async function oneRequest() { const t0 = performance.now(); const t = await open(false); let g = ''; t.on('data', (d) => (g += d)); t.write(`GET / HTTP/1.1\r\nHost: good.test:${UP}\r\nConnection: close\r\n\r\n`); await new Promise((r) => t.once('close', r)); return `${g.split('\r\n')[0]} ${(performance.now() - t0).toFixed(0)}ms`; }
console.log('기준 요청:', await oneRequest());
const m0 = process.memoryUsage(); const ts0 = performance.now();
const socks: tls.TLSSocket[] = []; for (let i = 0; i < N; i += 50) socks.push(...(await Promise.all(Array.from({ length: Math.min(50, N - i) }, () => open(true)))));
console.log(`${N}개 열기 ${(performance.now() - ts0).toFixed(0)}ms`);
await new Promise((r) => setTimeout(r, 3000)); // headersTimeout(1초)의 3배
const alive = socks.filter((s) => !s.destroyed).length; const m1 = process.memoryUsage();
console.log(`3초 뒤 살아 있는 터널: ${alive}/${N}, rss +${((m1.rss - m0.rss) / 1048576).toFixed(1)}MB (클라이언트 쪽 포함, 대략)`);
console.log('부하 중 정상 요청:', await oneRequest());
const c0 = performance.now(); await p.close(); await new Promise((r) => setTimeout(r, 300)); console.log(`close() ${(performance.now() - c0).toFixed(0)}ms(300ms 대기 포함), 닫힌 뒤 살아 있는 터널: ${socks.filter((s) => !s.destroyed).length}`);
ups.close(); process.exit(0);
