// [TLS-4 실측] curl(Schannel)이 --ssl-no-revoke 없이 실패하는 이유(오류 문구). node scripts/probe/tls4-curl-revoke.mjs — LOCALAPPDATA는 임시 폴더, Windows 저장소는 건드리지 않음
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
const local = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-why60-'));
const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close())); });
const child = spawn(process.execPath, ['src/index.ts', '--port', String(port), '--decrypt'], { env: { ...process.env, LOCALAPPDATA: local } });
let out = ''; child.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 200 && !out.includes('복호화'); i++) await new Promise((r) => setTimeout(r, 50));
const r = await new Promise((res) => execFile('curl.exe', ['-sS', '-m', '20', '-x', `http://127.0.0.1:${port}`, '--cacert', path.join(local, 'sumun', 'ca', 'ca-cert.pem'), '-o', 'NUL', 'https://example.com/'], { encoding: 'buffer' }, (e, o, er) => res(er)));
console.log(new TextDecoder('euc-kr').decode(r).trim());
child.kill(); fs.rmSync(local, { recursive: true, force: true });
