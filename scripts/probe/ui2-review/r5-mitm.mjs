// r5: 복호화 켬(ca 옵션). CA는 OS 임시 폴더(sumun-ui2-review-ca)에 만든다 — 저장소 안에 개인키를 두지 않는다(저장소로 옮길 때 바꿈). Windows 저장소는 건드리지 않음, 클라이언트는 rejectUnauthorized:false
//  (a) CONNECT 127.0.0.1:<대시> → 터널 안 요청이 대시보드(평문 HTTP)에 무엇을 보내고, 무엇이 기록되는가
//  (b) 시작 순서: 아무도 안 듣는 포트로 CONNECT·핸드셰이크를 먼저 끝내 두고, 그 뒤에 그 포트에 서버가 뜨면 터널 안 요청이 거기에 닿는가
//      (복호화 경로는 CONNECT 때 TCP 연결을 하지 않고 터널 안 요청마다 새로 연결한다)
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
import os from 'node:os';
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);
const { loadOrCreateCA } = await import(pathToFileURL(repo + '/src/ca/ca.ts').href);
const ca = await loadOrCreateCA(path.join(os.tmpdir(), 'sumun-ui2-review-ca'), { onWarning: () => {} });

const got = [];
const fake = net.createServer((s) => { s.once('data', (d) => got.push({ port: s.localPort, first: d.subarray(0, 3).toString('hex'), len: d.length })); s.on('data', () => s.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')); s.on('error', () => {}); });
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const dp = fake.address().port;
const flows = []; const starts = [];
const proxy = await startProxy({ port: 0, ca, onFlow: (f) => flows.push(f), onFlowStart: (s) => starts.push(s) });

function mitm(target, servername) {
  return new Promise((ok, no) => {
    const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = '';
    const onData = (c) => {
      buf += c;
      if (!buf.includes('\r\n\r\n')) return;
      s.off('data', onData);
      if (!buf.startsWith('HTTP/1.1 200')) return ok({ refused: buf.split('\r\n')[0] });
      const t = tls.connect({ socket: s, servername, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] }, () => ok({ t }));
      t.on('error', no);
    };
    s.on('data', onData);
  });
}
const send = (t, req) => new Promise((ok) => { let b = ''; t.on('data', (c) => (b += c)); t.on('close', () => ok(b.split('\r\n')[0] + ' | ' + b.split('\r\n\r\n')[1]?.trim())); t.write(req); });

// (a)
const a = await mitm(`127.0.0.1:${dp}`);
const ra = await send(a.t, `GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:${dp}\r\nAuthorization: Bearer DASHTOKEN\r\nCookie: c=1\r\nConnection: close\r\n\r\n`);
await new Promise((r) => setTimeout(r, 300));
console.log('(a) client got:', ra);
console.log('(a) dashboard port received:', JSON.stringify(got), '(16030x = TLS ClientHello)');
const fa = flows.find((f) => f.request.target?.port === dp);
console.log('(a) record:', JSON.stringify({ url: fa?.request.url, target: fa?.request.target, error: fa?.error, tls: fa?.tls, headers: fa?.request.headers }));

// (b) 아무도 안 듣는 포트
const free = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const b = await mitm(`127.0.0.1:${free}`);
console.log('(b) CONNECT to closed port', free, '->', b.refused ?? 'tunnel up (200 + handshake ok) while nothing listens');
const late = net.createServer((s) => { got.push({ late: true, port: free }); s.on('data', () => s.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')); s.on('error', () => {}); });
await new Promise((r) => late.listen(free, '127.0.0.1', r));
const rb = await send(b.t, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${free}\r\nConnection: close\r\n\r\n`);
await new Promise((r) => setTimeout(r, 300));
console.log('(b) inner request after server started ->', rb, '| late server got connection:', got.some((g) => g.late));
console.log('starts', starts.length, 'flows', flows.length);
await proxy.close(); fake.close(); late.close();
