// [UI 큰 단위 끝 — 독립 검토] 공용 도우미: 목적지 fixtures, 실제 진입점(node src/index.ts) 띄우기, curl.exe, 요청 도우미.
// 모든 서버는 127.0.0.1에만 바인딩한다. 외부 네트워크로 나가지 않는다.
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const CURL = 'C:/Windows/System32/curl.exe';
export const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// 닫힌 포트: 잠깐 열었다 닫은 번호(아무도 듣지 않음)
export const closedPort = freePort;

export const XSS = `<img src=x onerror="document.title='XSS-IMG';window.__xss=1"><script>document.title='XSS-SCRIPT';window.__xss=2</script>`;

export function fixtures() {
  return {
    '/hello': { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('hello sumun') },
    '/json': { status: 201, headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ ok: true, msg: '한글 본문' })) },
    '/notfound': { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('nope') },
    '/xss': {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Evil': XSS, 'Set-Cookie': 'session=SECRET123; HttpOnly' },
      body: Buffer.from(`<!doctype html><html><body>${XSS}<a href="javascript:alert(1)">x</a></body></html>`),
    },
    '/svg': { status: 200, headers: { 'Content-Type': 'image/svg+xml' }, body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="document.title='SVG-RAN'"><script>document.title='SVG-RAN2'</script></svg>`) },
    // 숨은 문자: 방향 덮어쓰기(U+202E)·zero-width(U+200B)를 본문에. 헤더는 latin1만 되므로 본문으로 본다
    '/bidi': { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('invoice\u202Etxt.exe zero\u200Bwidth\u0007bell') },
    '/gz': { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Encoding': 'gzip' }, body: zlib.gzipSync(Buffer.from('압축 풀린 본문 '.repeat(50))) },
    '/bin': { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0x41, 0x42]) },
  };
}

export function startUpstream() {
  const FIX = fixtures();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const p = (req.url ?? '/').split('?')[0];
      const f = FIX[p];
      if (!f) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(`echo ${req.method} ${req.url} ${Buffer.concat(chunks).length}B`);
      }
      res.writeHead(f.status, { ...f.headers, 'Content-Length': f.body.length });
      res.end(f.body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) })));
}

// 실제 진입점(npm start와 같은 node src/index.ts). 시작 줄에서 대시보드 주소·토큰을 읽는다
export async function startApp(args = []) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.ts', '--port', String(port), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  for (let i = 0; i < 100 && !/대시보드: http/.test(out); i++) {
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  const m = out.match(/대시보드: (http:\/\/127\.0\.0\.1:(\d+)\/#t=([A-Za-z0-9_-]+))/);
  if (!m) throw new Error(`시작 줄을 못 찾음: out=${out} err=${err}`);
  return {
    proxyPort: port,
    dashUrl: m[1],
    dashPort: Number(m[2]),
    token: m[3],
    stdout: () => out,
    stderr: () => err,
    stop: async () => {
      child.kill();
      for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    },
    pid: child.pid,
  };
}

export function curl(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(CURL, ['-s', '-S', '--max-time', String(Math.ceil(timeoutMs / 1000)), ...args], { encoding: 'buffer', timeout: timeoutMs + 2000 }, (e, stdout, stderr) =>
      resolve({ code: e ? (e.code ?? 1) : 0, out: stdout.toString('utf8'), err: stderr.toString('utf8') }),
    );
  });
}

// Host·Origin 등을 그대로 보내는 원시 요청(Node http — Host를 덮어쓸 수 있다)
export function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, setHost: !('Host' in headers || 'host' in headers) }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body) req.write(body);
    req.end();
  });
}

export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
    s.setTimeout(500, () => (s.destroy(), resolve(false)));
  });
}
