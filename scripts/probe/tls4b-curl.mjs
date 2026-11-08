// [TLS-4b 실측] 실제 curl로: 복호화 없는 npm start의 터널이 localhost(::1, 127.0.0.1 순서)를 써도 127.0.0.1의 서버에 닿는가 (O31)
//   node scripts/probe/tls4b-curl.mjs
// 시험용 HTTPS 서버는 127.0.0.1에만 연다. curl은 -k(시험 서버 인증서를 모르므로) — 여기서 보는 것은 터널이 닿는지뿐이다.
// 인증서는 임시 폴더의 CA로 만들고 지운다. Windows 인증서 저장소와 실제 %LOCALAPPDATA%\sumun\ca는 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls4b-curl-'));
const ca = await loadOrCreateCA(path.join(dir, 'ca'));
const leaf = await issueCert(ca, ['localhost']);
const up = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, (q, r) => r.end(`secure ${q.url}`));
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const U = up.address().port;
const P = await new Promise((r) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()));
});
const child = spawn(process.execPath, ['src/index.ts', '--port', String(P)], { env: { ...process.env, LOCALAPPDATA: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 100 && !out.includes('시작했습니다'); i++) await new Promise((r) => setTimeout(r, 50));
const r = await new Promise((res) => execFile('curl.exe', ['-s', '-k', '-m', '10', '-x', `http://127.0.0.1:${P}`, '-w', ' [%{http_code}]', `https://localhost:${U}/hello`], (e, o) => res(o || `종료 코드 ${e?.code}`)));
console.log(`curl -x 프록시 https://localhost:${U}/hello → ${r}`);
await new Promise((res) => setTimeout(res, 300));
console.log(`요약 줄: ${out.split('\n').filter((l) => /^\d\d:\d\d:\d\d /.test(l)).join(' / ')}`);
child.kill();
up.close();
fs.rmSync(dir, { recursive: true, force: true });
