// [STO 최종 검토] 헤더가 아주 많은 응답(16KB 안에 짧은 헤더 약 3,000쌍)에서 추정 비용 대 실제 힙.
// 실행: node --expose-gc scripts/probe/sto-final-review/r1b-header-ratio.mjs
import { createStore } from '../../../src/store/store.ts';

const gc = () => { for (let i = 0; i < 4; i++) globalThis.gc(); };
const heap = () => (gc(), process.memoryUsage().heapUsed);

const base = heap();
const s = createStore();
for (let id = 1; id <= 3000; id++) {
  // Node가 만드는 rawHeaders처럼 매번 새 문자열(짧은 이름·값)
  const hs = [];
  for (let i = 0; i < 3000; i++) hs.push([`a${(i % 10)}`.slice(0, 2) + String.fromCharCode(97 + (id % 26)), `${i}`]);
  s.addFlow({
    id, startedAt: Date.now(), durationMs: 1,
    request: { method: 'GET', url: 'http://x.test/', httpVersion: '1.1', headers: [['Host', 'x.test']], target: { scheme: 'http', host: 'x.test', port: 80, path: '/' }, body: Buffer.allocUnsafeSlow(0), bodySize: 0, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: hs, body: Buffer.allocUnsafeSlow(0), bodySize: 0, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  });
}
const st = s.stats();
const real = heap() - base;
console.log(JSON.stringify({ flows: st.flows, estMB: +(st.bytes / 1048576).toFixed(1), realHeapMB: +(real / 1048576).toFixed(1), ratio: +(real / st.bytes).toFixed(2) }));
