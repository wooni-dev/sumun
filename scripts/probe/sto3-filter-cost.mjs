// [STO-3 실측 E147 탐색] 기록 10,000건에서 list(조건) 한 번, 알림 하나에 matchesFilter 한 번이 얼마나 걸리는가
//   node scripts/probe/sto3-filter-cost.mjs
// 가짜 기록만 쓴다. 프록시·디스크·네트워크를 쓰지 않는다.
import { createStore } from '../../src/store/store.ts';
import { matchesFilter } from '../../src/store/filter.ts';

const store = createStore();
const hosts = ['example.com', 'api.example.com', 'cdn.other.test', '127.0.0.1', '[::1]', 'xn--bcher-kva.de'];
const empty = Buffer.allocUnsafeSlow(0);
for (let id = 1; id <= 10_000; id++) {
  const host = hosts[id % hosts.length];
  store.addFlow({
    id,
    startedAt: Date.now(),
    durationMs: 1,
    request: { method: id % 3 ? 'GET' : 'POST', url: `http://${host}/${id}`, httpVersion: '1.1', headers: [], target: { scheme: 'http', host, port: 80, path: `/${id}` }, body: empty, bodySize: 0, bodyTruncated: false },
    response: { httpVersion: '1.1', headers: [], body: empty, bodySize: 0, bodyTruncated: false, status: id % 7 ? 200 : 404, statusMessage: '' },
  });
}
const time = (label, fn, n = 20) => {
  fn();
  const t0 = performance.now();
  let r;
  for (let i = 0; i < n; i++) r = fn();
  console.log(`E147 ${label}: ${((performance.now() - t0) / n).toFixed(2)}ms (결과 ${Array.isArray(r) ? `${r.length}건` : r})`);
};
console.log(`E147 저장된 기록 ${store.stats().flows}건`);
time('list()', () => store.list());
time("list({ host: 'example.com' })", () => store.list({ host: 'example.com' }));
time("list({ method: 'post', status: 404 })", () => store.list({ method: 'post', status: 404 }));
time("list({ host: 'example.com', limit: 50 })", () => store.list({ host: 'example.com', limit: 50 }));
const one = store.list({ limit: 1 })[0];
time("matchesFilter(요약 1개, { host: 'example.com' })", () => matchesFilter(one, { host: 'example.com' }), 10_000);
