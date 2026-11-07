// [PRX-1 실측] 실제 curl로 프록시를 시험한다 (O17, O19: 실측 스크립트는 저장소에 둔다)
//   node scripts/probe/prx1-curl.mjs
// 같은 프로세스에서 프록시를 띄우므로 curl은 반드시 비동기(execFile)로 실행한다.
// execFileSync를 쓰면 이벤트 루프가 멈춰 프록시가 응답하지 못한다 [확인됨: PRX-1 실측 방법 오류].
import http from 'node:http';
import { execFile } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';

const UP_PORT = 18090;
const PROXY_PORT = 18088;

const up = http.createServer((q, s) => {
  console.log(`[목적지가 받음] ${q.method} ${q.url}  via=${q.headers.via}  host=${q.headers.host}  proxy-connection=${q.headers['proxy-connection']}`);
  s.end('hi from upstream\n');
});
await new Promise((r) => up.listen(UP_PORT, '127.0.0.1', r));
const proxy = await startProxy({ port: PROXY_PORT });

const curl = (...args) =>
  new Promise((resolve) =>
    execFile('curl.exe', ['-s', '-i', '-m', '3', ...args], { encoding: 'utf8' }, (e, out) => resolve(`${e ? `(curl 종료 코드 ${e.code})\n` : ''}${out}`)),
  );
const px = ['-x', `http://127.0.0.1:${PROXY_PORT}`];

console.log(`=== 1) 일반 HTTP 중계 ===\n${await curl(...px, `http://127.0.0.1:${UP_PORT}/hello?q=1`)}`);
console.log(`=== 2) HTTPS (CONNECT) ===\n${await curl(...px, 'https://example.com/')}`);
console.log(`=== 3) 프록시 자기 자신 (루프) ===\n${await curl(...px, `http://127.0.0.1:${PROXY_PORT}/`)}`);
console.log(`=== 4) CONNECT 뒤에도 살아 있나 ===\n${await curl(...px, `http://127.0.0.1:${UP_PORT}/still-alive`)}`);
console.log(`=== 5) 프록시를 웹 서버처럼 직접 호출 (origin-form) ===\n${await curl(`http://127.0.0.1:${PROXY_PORT}/x`)}`);

await proxy.close();
up.close();
