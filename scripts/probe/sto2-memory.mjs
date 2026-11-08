// [STO-2 실측 E144] 기본 상한 저장소에 서로 다른 본문(요청·응답 각 1MiB) 기록 400건(약 800MiB)을 넣으면 메모리가 상한 근처에서 멈추는가
//   node --expose-gc scripts/probe/sto2-memory.mjs
// 가짜 기록만 쓴다. 프록시·디스크·네트워크를 쓰지 않는다. 본문은 기록마다 새 allocUnsafeSlow(프록시가 주는 것과 같은 방식).
import { createStore } from '../../src/store/store.ts';

if (typeof globalThis.gc !== 'function') throw new Error('node --expose-gc 로 실행하세요');
const MiB = 1_048_576;
const mem = () => {
  globalThis.gc();
  const m = process.memoryUsage();
  return { arrayBuffers: m.arrayBuffers, rss: m.rss, heapUsed: m.heapUsed };
};
const fmt = (n) => `${(n / MiB).toFixed(0)}MiB`;
const base = mem();
const store = createStore();
let evicted = 0;
store.subscribe((e) => void (e.type === 'evicted' && (evicted += e.ids.length)));
const marks = [];
for (let id = 1; id <= 400; id++) {
  const body = Buffer.allocUnsafeSlow(MiB).fill(id & 0xff);
  const res = Buffer.allocUnsafeSlow(MiB).fill((id + 1) & 0xff);
  store.addFlow({
    id,
    startedAt: Date.now(),
    durationMs: 1,
    request: { method: 'POST', url: `http://example.test/${id}`, httpVersion: '1.1', headers: [['Host', 'example.test']], target: { scheme: 'http', host: 'example.test', port: 80, path: `/${id}` }, body, bodySize: MiB, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [['Content-Type', 'application/octet-stream']], body: res, bodySize: MiB, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  });
  if (id % 100 === 0) {
    const m = mem();
    marks.push(`${id}건: arrayBuffers +${fmt(m.arrayBuffers - base.arrayBuffers)}, rss +${fmt(m.rss - base.rss)}`);
  }
}
const end = mem();
const s = store.stats();
for (const line of marks) console.log(`E144 ${line}`);
console.log(`E144 끝: 남은 ${s.flows}건, stats.bytes ${fmt(s.bytes)}, 뺀 ${evicted}건, arrayBuffers 증가 ${fmt(end.arrayBuffers - base.arrayBuffers)} (판정 기준 300MB 이하, 120~128건)`);
