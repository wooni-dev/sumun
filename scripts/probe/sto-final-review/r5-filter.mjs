// [STO 최종 검토] 필터: 호스트 표기 차이, 상태 코드 출처, 메서드, 페이지.
// 실행: node scripts/probe/sto-final-review/r5-filter.mjs
import { createStore } from '../../../src/store/store.ts';
import { matchesFilter, normHost } from '../../../src/store/filter.ts';
import { mkFlow } from './_mk.mjs';

const r = (k, v) => console.log(k.padEnd(46), JSON.stringify(v));
const s = createStore();
// 프록시가 실제로 만드는 target.host 표기: 평문은 WHATWG hostname, CONNECT는 소문자+끝 점 유지, IPv6 원표기
const rows = [
  [1, 'example.com', 80, 'http'],
  [2, 'api.example.com', 443, 'https'],
  [3, 'example.com.', 443, 'https'], // CONNECT 끝 점
  [4, '[::1]', 8080, 'http'],
  [5, '[0:0:0:0:0:0:0:1]', 443, 'https'], // CONNECT IPv6 원표기
  [6, 'xn--3e0b707e.kr', 443, 'https'], // 한국.kr
  [7, '127.0.0.1', 3000, 'http'],
  [8, 'notexample.com', 80, 'http'],
  [9, '[::ffff:127.0.0.1]', 443, 'https'],
];
for (const [id, host, port, scheme] of rows) s.addFlow(mkFlow(id, { host, port, scheme }));
s.addFlow(mkFlow(10, { host: 'example.com', noResponse: true, error: { by: 'proxy', code: 'unreachable', status: 502 } }));
s.addFlow(mkFlow(11, { host: 'example.com', status: 502 }));
s.addFlow(mkFlow(12, { host: 'example.com', method: 'post' }));
s.addFlow(mkFlow(13, { host: 'example.com', noResponse: true, error: { by: 'client', code: 'aborted' } }));

const q = (f) => { try { return s.list(f).map((x) => x.id); } catch (e) { return `${e.name}: ${e.message}`; } };
for (const h of ['EXAMPLE.com', 'example.com.', 'example.com:443', 'example.com:80', '::1', '[::1]', '0:0::1', '[::1]:8080', '한국.kr', 'xn--3e0b707e.kr', '127.1', '2130706433', '127.0.0.1:3000', '::ffff:127.0.0.1', '*.example.com', '.example.com', 'exa', 'example.com:', 'http://example.com', 'com', ' example.com ']) r(`host=${JSON.stringify(h)}`, q({ host: h }));
r('status=502 (upstream 11 + proxy 10)', q({ status: 502 }).concat(s.list({ status: 502 }).map((x) => x.statusFrom)));
r('status 없는 기록(13 aborted) 고르기 방법?', s.list().find((x) => x.id === 13).status ?? 'status 없음');
r('method=POST (기록은 post)', q({ method: 'POST' }));
r('method=" get "', q({ method: ' get ' }));
r('status="200"(문자열)', q({ status: '200' }));
r('limit=0', q({ limit: 0 }));
r('host 숫자', q({ host: 1 }));
r('알 수 없는 키 {hots:"x"}', q({ hots: 'x' }).length);
r('matchesFilter(요약, 같은 필터) == list', s.list().filter((x) => matchesFilter(x, { host: 'example.com', status: 502 })).map((x) => x.id));
r('normHost 예', ['EXAMPLE.COM.', '[0:0::1]', '한국.KR', '0x7f.1', 'a..b'].map(normHost));
