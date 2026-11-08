// [TLS-4 실측] 실제 curl(이 PC는 Schannel)로 npm start --decrypt를 거쳐 HTTPS에 접속한다 (E99, O31)
//   node scripts/probe/tls4-curl.mjs
// LOCALAPPDATA를 임시 폴더로 바꿔 실제 %LOCALAPPDATA%\sumun\ca를 건드리지 않는다. Windows 인증서 저장소도 건드리지 않는다(--cacert로만 믿게 함).
// 1) 실제 사이트 https://example.com/ (인터넷 필요) — 공개 CA로 검증된 목적지 → 200, 요약 줄에 기록
// 2) 로컬 자체 서명 HTTPS — 목적지를 믿을 수 없음 → 502 bad-certificate
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const local = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4-curl-'));
const port = await new Promise((r) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()));
});
const child = spawn(process.execPath, ['src/index.ts', '--port', String(port), '--decrypt'], { env: { ...process.env, LOCALAPPDATA: local }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 200 && !out.includes('복호화를 켰습니다'); i++) await new Promise((r) => setTimeout(r, 50));
const caFile = path.join(local, 'sumun', 'ca', 'ca-cert.pem');
console.log(`시작 줄: ${out.trim().split('\n').join(' / ')}`);

const curl = (...a) =>
  new Promise((r) => execFile('curl.exe', ['-s', '-m', '20', '-x', `http://127.0.0.1:${port}`, '--cacert', caFile, '-o', 'NUL', '-w', 'HTTP %{http_code} / CONNECT %{http_connect} / 검증 %{ssl_verify_result}', ...a], (e, o, er) => r(`${o}${e ? ` (종료 코드 ${e.code}${er ? `: ${er.trim()}` : ''})` : ''}`)));

console.log(`1) curl --cacert https://example.com/ → ${await curl('https://example.com/')}`);
const noRevoke = await curl('--ssl-no-revoke', 'https://example.com/');
console.log(`1') 같은 요청 + --ssl-no-revoke → ${noRevoke}`);

// 2) 로컬 자체 서명 목적지
const tmpCA = await loadOrCreateCA(path.join(local, 'self'));
const leaf = await issueCert(tmpCA, ['localhost']);
const up = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, (_q, r) => r.end('secret-body'));
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const body = await new Promise((r) => execFile('curl.exe', ['-s', '-m', '10', '-x', `http://127.0.0.1:${port}`, '--cacert', caFile, '--ssl-no-revoke', `https://localhost:${up.address().port}/`], (e, o) => r(o || `종료 코드 ${e?.code}`)));
console.log(`2) 믿을 수 없는 로컬 목적지 → 본문 "${body.trim()}"`);

await new Promise((r) => setTimeout(r, 300));
console.log('--- npm start의 요약 줄 ---');
console.log(out.split('\n').filter((l) => /^\d\d:\d\d:\d\d /.test(l)).join('\n'));
console.log(`요약 줄에 경로·쿠키·본문 글자(secret-body) 나온 횟수: ${(out.match(/secret-body/g) ?? []).length}`);
child.kill();
up.close();
fs.rmSync(local, { recursive: true, force: true });
