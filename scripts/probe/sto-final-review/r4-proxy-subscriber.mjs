// [STO 최종 검토] 실제 프록시 + 저장소 + 실제 curl.exe: 구독자 실수(throw·reject·느림·수정)가 중계와 저장에 번지는가.
// 목적지는 127.0.0.1 로컬 서버뿐. 실행: node scripts/probe/sto-final-review/r4-proxy-subscriber.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { startProxy } from '../../../src/proxy/server.ts';
import { createStore } from '../../../src/store/store.ts';
import { attachStore } from '../../../src/store/attach.ts';

const r = (k, v) => console.log(k.padEnd(50), JSON.stringify(v));
const up = http.createServer((req, res) => {
  let n = 0;
  req.on('data', (c) => (n += c.length));
  req.on('end', () => { res.setHeader('Set-Cookie', 'sid=SECRET_SETCOOKIE'); res.end(`ok ${n}`); });
});
await new Promise((res) => up.listen(0, '127.0.0.1', res));
const upPort = up.address().port;

let errOut = '';
const origErr = process.stderr.write.bind(process.stderr);
process.stderr.write = (c, ...a) => ((errOut += c), origErr(c, ...a));

const store = createStore();
let slowMs = 0;
store.subscribe(() => { throw new Error('SECRET in error'); });
store.subscribe(async () => { throw new Error('SECRET reject'); });
store.subscribe((e) => { if (e.summary) e.summary.status = 1; });
store.subscribe(() => { const t = Date.now(); while (Date.now() - t < slowMs); });
const proxy = await startProxy({ port: 0, tunnel: true, ...attachStore(store) });

// curl은 비동기로 부른다(같은 프로세스의 프록시가 응답할 수 있게)
const curl = (extra = []) => new Promise((resolve) => {
  const t = performance.now();
  execFile('curl.exe', ['-s', '-o', '-', '-w', ' %{http_code}', '--max-time', '20', '-x', `http://127.0.0.1:${proxy.port}`, ...extra], { encoding: 'utf8' }, (_e, out) => resolve({ out, ms: Math.round(performance.now() - t) }));
});
const url = `http://127.0.0.1:${upPort}/p?token=SECRET_Q`;

const a = await curl(['-H', 'Cookie: sid=SECRET_COOKIE', '-d', 'pw=SECRET_BODY', url]);
await new Promise((res) => setTimeout(res, 100));
r('구독자 throw·reject·수정 중 curl 결과', a.out);
const list = store.list();
r('저장 요약(상태는 고쳐지지 않아야)', list.map((s) => [s.id, s.state, s.status, s.statusFrom]));
r('subscriberErrors', store.stats().subscriberErrors);
const d = store.get(list[0].id);
r('상세에 요청 쿠키·본문·응답 Set-Cookie가 원본으로(설계)', [d.request.headers.some(([n, v]) => /cookie/i.test(n) && v.includes('SECRET')), d.request.body.toString(), d.response.headers.find(([n]) => /set-cookie/i.test(n))?.[1]]);

// 기준선 vs 느린 구독자(이벤트마다 동기 200ms): 요청 1개 지연
const base = await curl([url]);
slowMs = 200;
const slow = await curl([url]);
slowMs = 0;
await new Promise((res) => setTimeout(res, 600));
r('기준선 ms / 느린 구독자(200ms×2 이벤트) ms', [base.ms, slow.ms]);

// 느린 구독자 + 동시 요청 5개: 다른 연결의 중계도 같이 늦어지는가
slowMs = 200;
const t0 = performance.now();
await Promise.all(Array.from({ length: 5 }, () => new Promise((res) => {
  http.get({ host: '127.0.0.1', port: proxy.port, path: url }, (rs) => { rs.resume(); rs.on('end', res); });
})));
const conc = Math.round(performance.now() - t0);
slowMs = 0;
r('느린 구독자 + 동시 5개 전체 ms(5×2×200=2000 근처면 직렬화)', conc);

// 닫힌 포트(프록시 502) → statusFrom proxy
const closed = http.createServer();
await new Promise((res) => closed.listen(0, '127.0.0.1', res));
const cp = closed.address().port;
await new Promise((res) => closed.close(res));
const c = await curl([`http://127.0.0.1:${cp}/`]);
await new Promise((res) => setTimeout(res, 100));
const last = store.list().at(-1);
r('닫힌 포트 curl / 저장 요약', [c.out.trim().slice(-3), last.status, last.statusFrom, last.error]);

r('stderr에 SECRET?', errOut.includes('SECRET'));
r('stderr 내용 길이', errOut.length);
await proxy.close();
up.close();
process.stderr.write = origErr;
