// [TLS-4c 실측, O31] 실제 클라이언트 openssl s_client가 복호화 터널에서 핸드셰이크만 하고 아무것도 보내지 않으면 h 안에 408을 받고 닫히는가(E116)
//   node scripts/probe/tls4c-openssl.mjs        (openssl이 PATH에 있어야 한다 — Git Bash의 openssl)
// 임시 폴더의 CA만 쓴다. Windows 인증서 저장소는 건드리지 않는다. 목적지에는 연결하지 않는다(요청을 보내지 않으므로).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const H = 2000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4c-ossl-'));
const ca = await loadOrCreateCA(path.join(base, 'ca'));
const caFile = path.join(base, 'root.pem');
fs.writeFileSync(caFile, ca.certPem);
const flows = [];
const proxy = await startProxy({ port: 0, ca, headersTimeoutMs: H, lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f) => flows.push(f) });
console.log(spawnSync('openssl', ['version'], { encoding: 'utf8' }).stdout.trim());

const args = ['s_client', '-proxy', `127.0.0.1:${proxy.port}`, '-connect', 'example.test:443', '-servername', 'example.test', '-CAfile', caFile, '-verify_return_error', '-ign_eof'];
console.log('명령: openssl', args.join(' ').replace(caFile, '<임시 루트 CA>'));
const t0 = Date.now();
// 아무것도 보내지 않는 클라이언트: stdin을 곧바로 닫고 -ign_eof로 연결은 유지한다.
// (stdin을 열어 둔 첫 실행에서는 프록시가 timeout으로 닫았는데도 openssl이 7초 동안 끝나지 않았다 — Windows의 s_client가 파이프 stdin을 기다리느라 소켓 닫힘을 못 보는 것으로 보인다 [추측])
const p = spawn('openssl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
p.stdin.end();
let out = '';
let handshakeAt = null;
p.stdout.on('data', (d) => {
  out += d;
  if (handshakeAt === null && /Verify return code: 0 \(ok\)|Verification: OK/.test(out)) handshakeAt = Date.now() - t0;
});
p.stderr.on('data', (d) => (out += d));
const exitAt = await new Promise((r) => (p.once('exit', () => r(Date.now() - t0)), setTimeout(() => (p.kill(), r(null)), H + 5000)));
await new Promise((r) => setTimeout(r, 200));
const has408 = out.includes('HTTP/1.1 408 Request Timeout');
console.log(`핸드셰이크·검증 성공 ${handshakeAt}ms / openssl 종료 ${exitAt}ms / 408 받음 ${has408}`);
console.log('기록:', JSON.stringify(flows.map((f) => [f.request.method, f.request.url, f.error])));
console.log(`E116(408 부분): ${handshakeAt !== null && exitAt !== null && exitAt < 3500 && has408 ? '일치' : '불일치'} — 기준: 연결 뒤 3500ms 안에 닫힘 + 출력에 408`);
await proxy.close();
fs.rmSync(base, { recursive: true, force: true });
process.exit(0);
