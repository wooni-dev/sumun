// [PRX-2 실측] 실제 curl로 보낸 요청이 기록(Flow)으로 어떻게 남는지 확인한다 (O17, O19)
//   node scripts/probe/prx2-curl.mjs
// 기록 내용 중 헤더 이름·크기·상태만 출력한다(값은 출력하지 않음). 이 스크립트는 시험용 가짜 값만 보낸다.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';

const up = http.createServer((q, s) => {
  q.resume();
  q.on('end', () => s.writeHead(200, { 'set-cookie': ['a=1', 'b=2'] }).end(q.url === '/big' ? Buffer.alloc(2_000_000, 0x61) : 'ok\n'));
});
await new Promise((r) => up.listen(18093, '127.0.0.1', r));
const flows = [];
const proxy = await startProxy({ port: 18092, upstreamTimeoutMs: 1000, onFlow: (f) => flows.push(f) });
const curl = (...args) =>
  new Promise((resolve) => execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code} %{size_download}', '-m', '3', '-x', 'http://127.0.0.1:18092', ...args], (e, out) => resolve(out || `종료 코드 ${e?.code}`)));
const show = (label, out) => {
  const f = flows.at(-1);
  const side = (m) => m && `${m.status ?? ''} 헤더 [${m.headers.map(([n]) => n).join(', ')}] 본문 ${m.body.length}/${m.bodySize}${m.bodyTruncated ? ' 잘림' : ''}`;
  console.log(`${label}\n  curl: ${out}\n  기록 #${f?.id}: ${f?.request.method} ${f?.request.url} HTTP/${f?.request.httpVersion}\n  요청: ${side(f?.request)}\n  응답: ${side(f?.response) ?? '없음'}\n  실패: ${JSON.stringify(f?.error ?? null)}  소요 ${f?.durationMs.toFixed(1)}ms`);
};
const settle = () => new Promise((r) => setTimeout(r, 100));

let out = await curl('-H', 'Cookie: fake=1', '--data-binary', 'hello', 'http://127.0.0.1:18093/post?q=1');
await settle(); show('1) POST 본문 5바이트', out);
out = await curl('http://127.0.0.1:18093/big');
await settle(); show('2) 응답 2,000,000바이트(한도 1,048,576)', out);
out = await curl('http://127.0.0.1:1/');
await settle(); show('3) 닫힌 포트', out);
console.log(`기록 수: ${flows.length} (curl 3번)`);

await proxy.close();
up.close();
