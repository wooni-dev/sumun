// [STO 최종 검토] 메모리 상한과 해제 실측.
// 실행: node --expose-gc scripts/probe/sto-final-review/r1-memory.mjs
import { createStore } from '../../../src/store/store.ts';
import { mkFlow, mkStart } from './_mk.mjs';

const gc = () => {
  for (let i = 0; i < 4; i++) globalThis.gc();
};
const mem = () => {
  gc();
  const m = process.memoryUsage();
  return { heapMB: +(m.heapUsed / 1048576).toFixed(1), abMB: +(m.arrayBuffers / 1048576).toFixed(1), rssMB: +(m.rss / 1048576).toFixed(1) };
};
const log = (k, v) => console.log(k.padEnd(44), JSON.stringify(v));

// A. 작은 기록 50,000건(헤더 20쌍) → 10,000건 상한
{
  const base = mem();
  const s = createStore();
  for (let i = 1; i <= 50_000; i++) s.addFlow(mkFlow(i, { headers: 20 }));
  const st = s.stats();
  const m = mem();
  log('A 작은 기록 50k: stats', st);
  log('A 증가(heap MB / 추정 bytes MB)', { heap: +(m.heapMB - base.heapMB).toFixed(1), est: +(st.bytes / 1048576).toFixed(1) });
  s.clear();
  const m2 = mem();
  log('A clear 뒤 heap 증가분 MB', +(m2.heapMB - base.heapMB).toFixed(1));
}

// B. 큰 본문 1,000건(요청 1MiB + 응답 1MiB) → 256MiB 상한
{
  const base = mem();
  const s = createStore();
  for (let i = 1; i <= 1000; i++) s.addFlow(mkFlow(i, { reqBody: 1048576, resBody: 1048576 }));
  const st = s.stats();
  const m = mem();
  log('B 큰 본문 1000건: stats', { flows: st.flows, bytesMB: +(st.bytes / 1048576).toFixed(1) });
  log('B arrayBuffers 증가 MB', +(m.abMB - base.abMB).toFixed(1));
  s.clear();
  const m2 = mem();
  log('B clear 뒤 arrayBuffers 증가분 MB', +(m2.abMB - base.abMB).toFixed(1));
}

// C. 헤더가 많은 기록: 추정 비용과 실제 힙 비교(요청 100쌍 + 응답 100쌍, 짧은 값)
{
  const base = mem();
  const s = createStore();
  const flows = [];
  for (let i = 1; i <= 10_000; i++) s.addFlow(mkFlow(i, { headers: 100 }));
  const st = s.stats();
  const m = mem();
  log('C 헤더 100쌍×10k: stats', { flows: st.flows, estMB: +(st.bytes / 1048576).toFixed(1) });
  log('C 실제 heap 증가 MB', +(m.heapMB - base.heapMB).toFixed(1));
  s.clear();
}

// D. 끝나지 않는 진행 중 100,000개 → 진행 중 1,000개 상한. 뺀 id 기억(evictedPending)은 10,000개까지
{
  const base = mem();
  const s = createStore();
  for (let i = 1; i <= 100_000; i++) s.addStart(mkStart(i));
  const m = mem();
  log('D 진행 중 100k: stats', s.stats());
  log('D heap 증가 MB', +(m.heapMB - base.heapMB).toFixed(1));
  // 기억에서 잊힌 오래된 진행 중(1번)의 늦은 완료 → 시작 없는 완료로 저장되는가
  s.addFlow(mkFlow(1));
  s.addFlow(mkFlow(99_000)); // 기억 안에 있는 뺀 진행 중 → 버려져야 함
  log('D 잊힌 id 1의 늦은 완료 저장?', s.get(1) !== undefined);
  log('D 기억 안 id 99000의 늦은 완료 저장?', s.get(99_000) !== undefined);
}

// E. 구독자 사본 비용: 구독자 3개일 때 50k 넣기 시간(structuredClone)
{
  const s = createStore();
  for (let k = 0; k < 3; k++) s.subscribe(() => {});
  const t = performance.now();
  for (let i = 1; i <= 50_000; i++) {
    s.addStart(mkStart(i));
    s.addFlow(mkFlow(i));
  }
  log('E 구독자 3개, 50k 시작+완료 ms', Math.round(performance.now() - t));
}

// F. list 비용: 10,000건에서 limit 50 / 전체, 반복 100회 평균
{
  const s = createStore();
  for (let i = 1; i <= 10_000; i++) s.addFlow(mkFlow(i, { host: i % 2 ? 'a.example.com' : 'b.test' }));
  let t = performance.now();
  for (let k = 0; k < 100; k++) s.list({ limit: 50 });
  log('F list({limit:50}) 평균 ms', +((performance.now() - t) / 100).toFixed(2));
  t = performance.now();
  for (let k = 0; k < 100; k++) s.list({ after: 9_950, limit: 50 });
  log('F list({after:9950,limit:50}) 평균 ms', +((performance.now() - t) / 100).toFixed(2));
  t = performance.now();
  for (let k = 0; k < 100; k++) s.list({ host: 'example.com' });
  log('F list({host}) 전체 평균 ms', +((performance.now() - t) / 100).toFixed(2));
  t = performance.now();
  for (let k = 0; k < 20; k++) s.list();
  log('F list() 전체 평균 ms', +((performance.now() - t) / 20).toFixed(2));
  // 최신 50개를 얻는 방법: 전체를 받아 뒤에서 자르는 수밖에 없다
  const all = s.list();
  log('F 최신 50개 = 전체 목록 뒤 50개, 전체 길이', all.length);
}
