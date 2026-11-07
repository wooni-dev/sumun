// [PRX-3 실측] E43: 목적지 응답을 해석할 수 없을 때 Node HTTP 클라이언트가 내는 오류 코드
//   node scripts/probe/prx3-errcode.mjs
// 연결 실패(닫힌 포트)와 구분할 수 있는지 본다. 결과로 실패 코드 bad-response / unreachable을 나눈다.
import http from 'node:http';
import net from 'node:net';

const cases = {
  '깨진 상태 줄(NOT HTTP)': 'NOT HTTP\r\n\r\n',
  '헤더 크기 초과(a:1 × 10000)': `HTTP/1.1 200 OK\r\n${'a:1\r\n'.repeat(10000)}\r\n`,
  'CL과 TE 함께': 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\nok',
  '헤더 전에 연결 끊김': '',
};
const codeFor = (port) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', agent: false });
    req.on('response', (res) => (res.resume(), resolve(`응답 ${res.statusCode}`)));
    req.on('error', (e) => resolve(e.code ?? e.message));
    req.end();
  });

for (const [name, data] of Object.entries(cases)) {
  const server = net.createServer((s) => {
    s.on('error', () => {});
    s.once('data', () => (data ? s.end(data) : s.destroy()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  console.log(`${name.padEnd(28)} → ${await codeFor(server.address().port)}`);
  server.close();
}
const closed = net.createServer();
await new Promise((r) => closed.listen(0, '127.0.0.1', r));
const port = closed.address().port;
await new Promise((r) => closed.close(r));
console.log(`${'닫힌 포트'.padEnd(28)} → ${await codeFor(port)}`);
