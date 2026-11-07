// [PRX-3 실측] 실제 curl로 시작 알림(onFlowStart)이 응답보다 먼저 오는지, target이 어떻게 남는지 (O31)
//   node scripts/probe/prx3-curl.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';

const t0 = Date.now();
const ms = () => `${String(Date.now() - t0).padStart(4)}ms`;
// 목적지: 헤더를 바로 보내고 본문은 300ms 간격으로 3번 (실시간 스트림 흉내)
const up = http.createServer((q, s) => {
  s.writeHead(200, { 'content-type': 'text/plain' });
  let n = 0;
  const tick = setInterval(() => (s.write(`chunk${++n}\n`), n === 3 && (clearInterval(tick), s.end())), 300);
});
await new Promise((r) => up.listen(18095, '127.0.0.1', r));
const proxy = await startProxy({
  port: 18094,
  onFlowStart: (s) => console.log(`${ms()} 시작 알림 #${s.id} ${s.request.method} target=${JSON.stringify(s.request.target)}`),
  onFlow: (f) => console.log(`${ms()} 끝 기록   #${f.id} 상태 ${f.response?.status ?? '-'} 본문 ${f.response?.body.length ?? 0}바이트 error=${JSON.stringify(f.error ?? null)}`),
});
const curl = (url) =>
  new Promise((resolve) => execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '-m', '5', '-x', 'http://127.0.0.1:18094', url], (e, out) => resolve(out || `종료 코드 ${e?.code}`)));

const r1 = await curl('http://127.0.0.1:18095/stream?x=1');
console.log(`${ms()} curl 1) 300ms 간격 스트림 응답 끝 → ${r1}`);
const r2 = await curl('http://sumun-probe.invalid/p');
console.log(`${ms()} curl 2) 없는 도메인(포트 생략) → ${r2}`);
await new Promise((r) => setTimeout(r, 100));
await proxy.close();
up.close();
