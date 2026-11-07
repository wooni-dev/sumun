// [TLS-1b 실측] 실제 curl로 터널 견고성 확인 (E67, E68, O31)
//   node scripts/probe/tls1b-curl.mjs [MB, 기본 100]
// E67: 터널로 로컬 HTTPS에서 큰 본문을 받고(다운로드) 보낸다(업로드). 받은·보낸 바이트와 프록시 프로세스의 최대 메모리(RSS)
// E68: 응답하지 않는 주소(10.255.255.1:443)로 터널 → 연결 타임아웃 뒤 504. 환경에 따라 바로 거절(502)될 수 있다
// 프록시는 npm start와 같은 구성(tunnel: true)을 별도 프로세스로 띄운다. 연결 타임아웃만 2초로 줄인다(기본 30초).
// 시험용 자체 서명 인증서는 임시 폴더에 openssl로 만들고 끝나면 지운다(Windows 인증서 저장소는 건드리지 않음). curl은 -k.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFile, execFileSync } from 'node:child_process';

const SIZE_MB = Number(process.argv[2] ?? 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls1b-'));
const key = path.join(dir, 'k.pem');
const cert = path.join(dir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const upload = path.join(dir, 'up.bin');
fs.writeFileSync(upload, Buffer.alloc(SIZE_MB * 1024 * 1024, 0x62));

const chunk = Buffer.alloc(1024 * 1024, 0x61);
const up = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (q, res) => {
  if (q.method === 'PUT') {
    let n = 0;
    q.on('data', (d) => (n += d.length));
    return q.on('end', () => res.end(`received ${n}`));
  }
  res.writeHead(200, { 'content-length': SIZE_MB * chunk.length });
  let sent = 0;
  const pump = () => {
    while (sent < SIZE_MB) {
      sent++;
      if (!res.write(chunk)) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
});
await new Promise((r) => up.listen(18097, '127.0.0.1', r));

const P = 18096;
const child = spawn(process.execPath, ['--input-type=module', '-e', `
  import { startProxy } from './src/proxy/server.ts';
  const flows = [];
  await startProxy({ port: ${P}, tunnel: true, upstreamTimeoutMs: 2000, onFlow: (f) => flows.push(f) });
  let max = 0;
  setInterval(() => (max = Math.max(max, process.memoryUsage().rss)), 20);
  console.log('ready ' + Math.round(process.memoryUsage().rss / 1048576));
  process.stdin.on('data', () => console.log('max ' + Math.round(max / 1048576) + ' ' + JSON.stringify(flows.map((f) => ({ url: f.request.url, tunnel: f.tunnel, error: f.error })))));
`], { stdio: ['pipe', 'pipe', 'inherit'] });
const startRss = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim().split(' ')[1])));
const curl = (...a) => new Promise((r) => execFile('curl.exe', ['-s', '-k', '-m', '60', '-x', `http://127.0.0.1:${P}`, ...a], (e, o) => r(o || `종료 코드 ${e?.code}`)));

let t0 = Date.now();
console.log(`E67 다운로드(상태 받은바이트): ${await curl('-o', 'NUL', '-w', '%{http_code} %{size_download}', 'https://127.0.0.1:18097/big')}  ${((Date.now() - t0) / 1000).toFixed(1)}초`);
t0 = Date.now();
console.log(`E67 업로드: ${await curl('-T', upload, '-w', ' [%{http_code}]', 'https://127.0.0.1:18097/up')}  ${((Date.now() - t0) / 1000).toFixed(1)}초`);
t0 = Date.now();
console.log(`E68 응답 없는 주소: ${await curl('-o', 'NUL', '-w', 'CONNECT %{http_connect}', 'https://10.255.255.1/')}  ${((Date.now() - t0) / 1000).toFixed(1)}초`);

child.stdin.write('report\n');
const report = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim())));
const [, maxRss, flowsJson] = report.match(/^max (\d+) (.*)$/);
console.log(`프록시 프로세스 메모리: 시작 ${startRss}MB → 최대 ${maxRss}MB (중계한 본문 각 방향 ${SIZE_MB}MB)`);
console.log('기록:', flowsJson);
child.kill();
up.close();
fs.rmSync(dir, { recursive: true, force: true });
