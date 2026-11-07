// [TLS-1 실측] 실제 curl이 npm start의 터널을 통해 로컬 HTTPS 서버에 닿는지 (E59, O31)
//   node scripts/probe/tls1-curl.mjs
// 시험용 자체 서명 인증서는 임시 폴더에 openssl로 만들고 끝나면 지운다(Windows 인증서 저장소는 건드리지 않음).
// curl은 이 인증서를 모르므로 -k로 검증을 끈다 — 여기서 보는 것은 "터널이 바이트를 그대로 잇는가"뿐이다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFile, execFileSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls1-'));
const key = path.join(dir, 'k.pem');
const cert = path.join(dir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const up = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (q, s) => s.end(`secure ${q.url}\n`));
await new Promise((r) => up.listen(18099, '127.0.0.1', r));

const P = 18098;
const child = spawn(`npm start -- --port ${P}`, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 100 && !out.includes('127.0.0.1:'); i++) await new Promise((r) => setTimeout(r, 50));
const curl = (...a) => new Promise((r) => execFile('curl.exe', ['-s', '-k', '-m', '5', '-x', `http://127.0.0.1:${P}`, '-w', ' [%{http_code}]', ...a], (e, o) => r(o || `종료 코드 ${e?.code}`)));
console.log('curl 1) https://127.0.0.1:18099/hello?q=1 →', await curl('https://127.0.0.1:18099/hello?q=1'));
console.log('curl 2) 자기 자신으로 터널 →', await curl(`https://127.0.0.1:${P}/`));
await new Promise((r) => setTimeout(r, 200));
try {
  execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
} catch {}
up.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('--- npm start의 요약 줄 ---');
console.log(out.split('\n').filter((l) => /^\d\d:\d\d:\d\d /.test(l)).join('\n'));
console.log(`경로·쿼리(hello, q=1)가 요약 줄에 나온 횟수: ${(out.match(/hello|q=1/g) ?? []).length}`);
