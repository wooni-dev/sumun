// [STO 최종 검토] 순서·일관성: 시작/완료 순서, 같은 id, clear 뒤, 상한으로 빠진 뒤의 늦은 기록.
// 실행: node scripts/probe/sto-final-review/r3-order.mjs
import { createStore } from '../../../src/store/store.ts';
import { mkFlow, mkStart } from './_mk.mjs';

const r = (k, v) => console.log(k.padEnd(52), JSON.stringify(v));
const ev = (s) => { const a = []; s.subscribe((e) => a.push(e.type === 'evicted' ? `evicted:${e.ids}` : e.type === 'cleared' ? 'cleared' : `${e.type}:${e.summary.id}`)); return a; };

// 1. 정상: 시작 → 완료, 자리 유지
{ const s = createStore(); const a = ev(s); s.addStart(mkStart(1)); s.addStart(mkStart(2)); s.addFlow(mkFlow(2)); s.addFlow(mkFlow(1));
  r('1 이벤트', a); r('1 목록(id:state)', s.list().map((x) => `${x.id}:${x.state}`)); }

// 2. 같은 id: 두 번째 시작, 두 번째 완료(다른 내용)
{ const s = createStore(); const a = ev(s); s.addStart(mkStart(1)); s.addStart(mkStart(1, { host: 'other.test' })); s.addFlow(mkFlow(1, { status: 200 })); s.addFlow(mkFlow(1, { status: 500 }));
  r('2 이벤트', a); r('2 저장된 상태 코드', s.list()[0].status); }

// 3. 완료 뒤 늦은 시작
{ const s = createStore(); const a = ev(s); s.addFlow(mkFlow(1)); s.addStart(mkStart(1));
  r('3 이벤트', a); r('3 목록', s.list().map((x) => `${x.id}:${x.state}`)); }

// 4. clear 앞에 시작, 뒤에 완료 / clear 뒤 새 요청
{ const s = createStore(); const a = ev(s); s.addStart(mkStart(1)); s.addStart(mkStart(2)); s.clear(); s.addFlow(mkFlow(1)); s.addStart(mkStart(3)); s.addFlow(mkFlow(3)); s.addFlow(mkFlow(2));
  r('4 이벤트', a); r('4 목록', s.list().map((x) => `${x.id}:${x.state}`)); }

// 4b. clear 직전에 프록시가 id를 매겼지만 시작 알림(setImmediate)이 clear 뒤에 온 경우
{ const s = createStore(); s.addStart(mkStart(1)); s.clear(); s.addStart(mkStart(2)); s.addFlow(mkFlow(2));
  r('4b clear 뒤 도착한 id 2(이전에 매김)', s.list().map((x) => `${x.id}:${x.state}`)); }

// 5. 진행 중 상한으로 빠진 뒤 늦은 완료
{ const s = createStore({ maxPending: 2 }); const a = ev(s); s.addStart(mkStart(1)); s.addStart(mkStart(2)); s.addStart(mkStart(3)); s.addFlow(mkFlow(1)); s.addFlow(mkFlow(3));
  r('5 이벤트', a); r('5 목록', s.list().map((x) => `${x.id}:${x.state}`)); }

// 6. 완료 건수 상한으로 빠진 완료의 id에 늦은 시작 → 유령 진행 중이 생기나
{ const s = createStore({ maxFlows: 1 }); s.addFlow(mkFlow(1)); s.addFlow(mkFlow(2)); s.addStart(mkStart(1));
  r('6 빠진 완료 id 1에 늦은 시작', s.list().map((x) => `${x.id}:${x.state}`)); }

// 7. 바이트 상한: 하나가 상한보다 크면 그것만 남는가 / 진행 중이 바이트로 빠지면 기억되는가
{ const s = createStore({ maxBytes: 10_000 }); const a = ev(s); s.addStart(mkStart(1)); s.addFlow(mkFlow(2, { resBody: 50_000 }));
  r('7 이벤트', a); r('7 목록, bytes', [s.list().map((x) => `${x.id}:${x.state}`), s.stats().bytes]); s.addFlow(mkFlow(1)); r('7 바이트로 빠진 진행 중 1의 늦은 완료', s.list().map((x) => `${x.id}:${x.state}`)); }

// 8. 목록 순서(id) 대 빼는 순서(들어온 순서): 시작 없이 늦게 들어온 낮은 id
{ const s = createStore({ maxFlows: 2 }); const a = ev(s); s.addFlow(mkFlow(5)); s.addFlow(mkFlow(3)); s.addFlow(mkFlow(7));
  r('8 이벤트(빠진 것)', a); r('8 목록', s.list().map((x) => x.id)); }

// 9. 페이지: after 커서로 넘기는 중 앞쪽이 빠져도 중복·누락 없는가
{ const s = createStore({ maxFlows: 5 }); for (let i = 1; i <= 5; i++) s.addFlow(mkFlow(i));
  const p1 = s.list({ limit: 2 }); for (let i = 6; i <= 8; i++) s.addFlow(mkFlow(i)); const p2 = s.list({ after: p1.at(-1).id, limit: 2 });
  r('9 1쪽, 2쪽', [p1.map((x) => x.id), p2.map((x) => x.id)]); }

// 10. 진행 중 요약에는 요청 헤더가 없고 get()은 undefined → 진행 중 상세를 볼 수 없다
{ const s = createStore(); s.addStart(mkStart(1)); r('10 진행 중 get(1)', s.get(1) ?? 'undefined'); }

// 11. 실행 식별자: 저장소마다 다른가, 요약에 붙는가
{ const a = createStore(); const b = createStore(); a.addFlow(mkFlow(1)); r('11 runId 다름, 요약에 runId', [a.runId !== b.runId, a.list()[0].runId === a.runId]); }
