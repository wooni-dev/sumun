// e3: accept하지 않는(이벤트 루프가 멈춘) 리스너에 접속을 쌓아 backlog가 차면 새 접속이 어떻게 되는가(거절/시간초과).
// 차 있으면 "접속해 보기" 검사는 아무도 없다고 본다.
// 실행: node e3-backlog.mjs [host] [최대 접속 수]
import net from 'node:net';
import { spawn } from 'node:child_process';

const host = process.argv[2] ?? '127.0.0.1';
const MAX = Number(process.argv[3] ?? 600);
const ch = spawn(
  process.execPath,
  ['-e', `const s=require('net').createServer();s.listen({port:0,host:'${host}',backlog:1},()=>{console.log(s.address().port);setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000),50)})`],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const port = Number(await new Promise((r) => ch.stdout.once('data', (d) => r(String(d).trim()))));
await new Promise((r) => setTimeout(r, 300));
const held = [];
const counts = {};
let firstFail;
for (let i = 0; i < MAX; i++) {
  const res = await new Promise((resolve) => {
    const c = net.connect(port, host);
    c.once('connect', () => (held.push(c), resolve('connect')));
    c.once('error', (e) => resolve(e.code));
    c.setTimeout(500, () => (c.destroy(), resolve('timeout')));
  });
  counts[res] = (counts[res] ?? 0) + 1;
  if (res !== 'connect' && firstFail === undefined) firstFail = { i, res };
  if (firstFail && i > firstFail.i + 3) break;
}
console.log(`[${host}:${port}] accept 안 하는 리스너(backlog 1 요청): 결과`, JSON.stringify(counts), '처음 실패', JSON.stringify(firstFail));
// 이 상태에서 sumun 방식의 검사 한 번
const one = await new Promise((resolve) => {
  const c = net.connect(port, host, () => (c.destroy(), resolve(true)));
  c.setTimeout(500, () => (c.destroy(), resolve(false)));
  c.on('error', () => resolve(false));
});
console.log(`backlog가 찬 상태에서 portAnswers 방식 판정 = ${one} (false면 "아무도 없음"으로 봄)`);
held.forEach((c) => c.destroy());
ch.kill();
