// [STO 최종 검토] 구독자(대시보드)의 실수가 저장 상태·다른 구독자·출력에 번지는가.
// 실행: node scripts/probe/sto-final-review/r2-subscriber.mjs
import { createStore } from '../../../src/store/store.ts';
import { mkFlow, mkStart } from './_mk.mjs';

const out = [];
const origErr = process.stderr.write.bind(process.stderr);
const origOut = process.stdout.write.bind(process.stdout);
let captured = '';
const r = (k, v) => out.push(`${k.padEnd(48)} ${JSON.stringify(v)}`);
process.on('unhandledRejection', (e) => out.push(`!! unhandledRejection ${String(e)}`));

const s = createStore();
const seen = [];
// 1) 던지는 구독자(비밀이 담긴 오류), 2) reject, 3) then 접근이 던지는 값, 4) 받은 객체를 고침, 5) 정상
s.subscribe(() => { throw new Error('Cookie: SECRET=abc'); });
s.subscribe(async () => { throw new Error('Authorization: Bearer SECRET'); });
s.subscribe(() => ({ get then() { throw new Error('then getter SECRET'); } }));
s.subscribe((e) => { if (e.summary) { e.summary.url = 'MUTATED'; e.summary.status = 999; } });
s.subscribe((e) => seen.push(e));

process.stderr.write = (c, ...a) => ((captured += c), true);
process.stdout.write = (c, ...a) => ((captured += c), true);
s.addStart(mkStart(1, { url: 'http://u:p@example.com/?token=SECRET' }));
s.addFlow(mkFlow(1, { url: 'http://u:p@example.com/?token=SECRET', reqBody: 4 }));
await new Promise((res) => setTimeout(res, 50));
process.stderr.write = origErr;
process.stdout.write = origOut;

r('출력에 SECRET 포함?', captured.includes('SECRET'));
r('출력 길이', captured.length);
r('구독자 오류 셈(throw+reject+then getter 기대 = 2이벤트×3)', s.stats().subscriberErrors);
r('정상 구독자가 받은 이벤트', seen.map((e) => `${e.type}:${e.summary?.url}:${e.summary?.status}`));
r('저장된 요약이 고쳐졌나?', s.list()[0].url, );
r('상세 사본 고치기 → 저장본 영향?', (() => { const a = s.get(1); a.request.body.fill(0x7a); a.request.headers[0][1] = 'X'; const b = s.get(1); return [b.request.body[0], b.request.headers[0][1]]; })());

// 6) 구독자 안에서 다시 넣기·clear·해제 (재진입)
const s2 = createStore();
const order = [];
let unsubB;
s2.subscribe((e) => {
  order.push(`A:${e.type}:${e.summary?.id ?? ''}`);
  if (e.type === 'done' && e.summary.id === 1) s2.addFlow(mkFlow(2));
  if (e.type === 'done' && e.summary.id === 2) unsubB();
});
unsubB = s2.subscribe((e) => order.push(`B:${e.type}:${e.summary?.id ?? ''}`));
s2.addFlow(mkFlow(1));
s2.addFlow(mkFlow(3));
r('재진입 순서(A가 1에서 2를 넣고, 2에서 B 해제)', order);

// 7) 영원히 끝나지 않는 Promise를 돌려주는 구독자 10만 번 → 저장소가 Promise를 붙잡는가(힙 증가로 대략)
if (globalThis.gc) {
  const s3 = createStore({ maxFlows: 100 });
  s3.subscribe(() => new Promise(() => {}));
  globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 1; i <= 100_000; i++) s3.addFlow(mkFlow(i));
  globalThis.gc();
  r('끝나지 않는 Promise 10만 개 뒤 heap 증가 MB', +((process.memoryUsage().heapUsed - h0) / 1048576).toFixed(1));
}

// 8) 느린 구독자(동기 50ms) → addFlow가 그만큼 막힌다(같은 스레드). 프록시 쪽 영향은 r4에서
const s4 = createStore();
s4.subscribe(() => { const t = Date.now(); while (Date.now() - t < 50); });
const t0 = performance.now();
for (let i = 1; i <= 10; i++) s4.addFlow(mkFlow(i));
r('동기 50ms 구독자, addFlow 10회 ms', Math.round(performance.now() - t0));

console.log(out.join('\n'));
