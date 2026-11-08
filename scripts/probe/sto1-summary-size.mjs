// [STO-1 실측 E141 탐색] 1MiB 본문 기록 1,000건에서 목록(요약)을 JSON으로 만들면 얼마나 큰가 — 본문이 실리지 않는지 크기로 본다
//   node scripts/probe/sto1-summary-size.mjs
// 가짜 기록만 쓴다. 프록시·디스크·네트워크를 쓰지 않는다.
import { createStore } from '../../src/store/store.ts';

const store = createStore();
const body = Buffer.allocUnsafeSlow(1_048_576).fill(0x41);
for (let id = 1; id <= 1000; id++) {
  store.addFlow({
    id,
    startedAt: Date.now(),
    durationMs: 5,
    request: { method: 'POST', url: `http://example.test/upload/${id}?q=1`, httpVersion: '1.1', headers: [['Host', 'example.test'], ['Cookie', 'k=v']], target: { scheme: 'http', host: 'example.test', port: 80, path: `/upload/${id}?q=1` }, body, bodySize: body.length, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [['Content-Type', 'text/plain']], body, bodySize: body.length, bodyTruncated: false, status: 200, statusMessage: 'OK' },
  });
}
const t0 = performance.now();
const json = JSON.stringify(store.list());
const ms = performance.now() - t0;
console.log(`E141 기록 1,000건(본문 각 1MiB×2): 목록 JSON ${json.length.toLocaleString()}자, 건당 ${Math.round(json.length / 1000)}자, list()+stringify ${ms.toFixed(1)}ms, 본문 글자(AAAA…) 포함 ${json.includes('AAAAAAAA')}`);
