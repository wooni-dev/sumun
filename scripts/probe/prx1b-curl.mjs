// [PRX-1b 실측] 요청 쪽 새 동작을 실제 curl로 확인한다 (O17, O19, O31)
//   node scripts/probe/prx1b-curl.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';

const up = http.createServer((q, s) => {
  console.log(`[목적지가 받음] ${q.method} ${q.url}`);
  s.end('ok\n');
});
await new Promise((r) => up.listen(18091, '127.0.0.1', r));
const proxy = await startProxy({ port: 18089 });
const curl = (...args) =>
  new Promise((resolve) => execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '-m', '3', '-x', 'http://127.0.0.1:18089', ...args], (e, out) => resolve(out || `종료 코드 ${e?.code}`)));

console.log('정상 요청                                ', await curl('http://127.0.0.1:18091/ok'));
console.log('Host: a, b (C16)                         ', await curl('-H', 'Host: a, b', 'http://127.0.0.1:18091/c16'));
console.log('포트 0 (C5)                              ', await curl('http://127.0.0.1:0/'));
console.log('HTTP/1.0 + Transfer-Encoding (D5)        ', await curl('-0', '-H', 'Transfer-Encoding: chunked', '--data-binary', 'abc', 'http://127.0.0.1:18091/d5'));
console.log('그 뒤에도 정상 요청                       ', await curl('http://127.0.0.1:18091/still-ok'));

await proxy.close();
up.close();
