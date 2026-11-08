// [UI-4] 실측: 읽지 않는 연결(slow)과 읽는 연결(fast)을 함께 열고 큰 알림을 쏟아 넣는다.
// 출력: 몇 차례 만에 자리가 났는지(slow가 끊김), fast가 끝까지 받았는지, fast가 끊겼는지.
// 실행: node scripts/probe/ui4-slow.mjs [bufferBytes=65536] [urlBytes=16384]
import http from 'node:http';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

const bufferBytes = Number(process.argv[2] ?? 65536);
const urlBytes = Number(process.argv[3] ?? 16384);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = createStore({ maxFlows: 5 });
const d = await startDashboard({ store, port: 0, events: { maxStreams: 2, bufferBytes } });
const auth = { authorization: `Bearer ${d.token}` };

function open(pause) {
  const s = { status: 0, text: '', ended: false, r: null };
  s.r = http.request({ host: '127.0.0.1', port: d.port, path: '/api/events', headers: auth, agent: false }, (res) => {
    s.status = res.statusCode;
    res.on('close', () => (s.ended = true));
    if (pause) return void res.pause();
    res.setEncoding('utf8');
    res.on('data', (c) => (s.text += c.length > 200 ? c.slice(0, 100) + c.slice(-100) : c));
  });
  s.r.on('error', () => (s.ended = true));
  s.r.end();
  return s;
}
const statusOf = () =>
  new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: d.port, path: '/api/events', headers: auth, agent: false }, (res) => (resolve(res.statusCode), r.destroy()));
    r.on('error', () => resolve(-1));
    r.end();
  });

let id = 1;
const flow = (path) => {
  const i = id++;
  return { id: i, startedAt: Date.now(), durationMs: 1, request: { method: 'GET', url: `http://example.test${path}`, httpVersion: '1.1', headers: [], body: Buffer.alloc(0), bodySize: 0, bodyTruncated: false } };
};
const slow = open(true);
const fast = open(false);
while (!slow.status || !fast.status) await sleep(5);
const big = 'x'.repeat(urlBytes);
let round = 0;
let freed = false;
for (; round < 200 && !freed; round++) {
  for (let i = 0; i < 16; i++) store.addFlow(flow(`/big?${big}`));
  await sleep(10);
  freed = (await statusOf()) === 200;
}
store.addFlow(flow('/last'));
const t0 = Date.now();
while (!fast.text.includes('/last') && Date.now() - t0 < 5000) await sleep(10);
console.log(JSON.stringify({ bufferBytes, urlBytes, freedAtRound: freed ? round : null, fastGotLast: fast.text.includes('/last'), fastEnded: fast.ended, slowEnded: slow.ended }));
slow.r.destroy();
fast.r.destroy();
await d.close();
