// [UI-7] 실측 E205: headless Chrome 156(임시 프로필, scripts/probe/ui5b-review/cdp.mjs)으로 호스트 필터 0건 안내를 실제로 본다.
//   프록시의 lookup을 바꿔 example.com·www.example.com을 이 프로세스의 127.0.0.1 서버로 보낸다(인터넷에 묻지 않음).
//   ① 호스트 "example"(이름 일부) → 0건 + 안내 ② "example.com" → 2건 이상, 안내 없음 ③ 필터 끄기 → 안내 없음
// 실행: node scripts/probe/ui7-browser.mjs   출력: 단계별 JSON 한 줄씩
import http from 'node:http';
import { launch, page } from './ui5b-review/cdp.mjs';
import { createStore } from '../../src/store/store.ts';
import { attachStore } from '../../src/store/attach.ts';
import { startProxy } from '../../src/proxy/server.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--disable-domain-reliability'];

const plain = http.createServer((q, r) => (q.resume(), q.on('end', () => r.writeHead(200, { 'content-type': 'text/plain' }).end(`plain:${q.headers.host}${q.url}`))));
await new Promise((r) => plain.listen(0, '127.0.0.1', r));
const PU = plain.address().port;

const store = createStore();
const dash = await startDashboard({ store, port: 0 });
const lookup = async (h) => (/(^|\.)example\.com$/.test(h) ? [{ address: '127.0.0.1', family: 4 }] : []);
const proxy = await startProxy({ port: 0, tunnel: true, dashboardPort: dash.port, lookup, ...attachStore(store) });
const viaProxy = (host, p) =>
  new Promise((resolve) => {
    const q = http.request({ host: '127.0.0.1', port: proxy.port, path: `http://${host}:${PU}${p}`, headers: { host: `${host}:${PU}` }, agent: false }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode))));
    q.on('error', (e) => resolve(e.code));
    q.end();
  });
log('requests', [await viaProxy('example.com', '/a'), await viaProxy('www.example.com', '/b'), await viaProxy('www.example.com', '/c')]);
log('store-hosts', store.list().map((s) => s.target?.host));

const A = await launch(QUIET);
log('browser', A.version);
try {
  const t = await page(A);
  await A.send('Page.navigate', { url: dash.url }, t.s);
  await sleep(2500);
  const state = () =>
    t.eval(`JSON.stringify({count:document.querySelector('.count')?.textContent, rows:document.querySelectorAll('section.list tbody tr').length, more:document.querySelector('.more')?.textContent})`).then(JSON.parse);
  const filter = async (v) => {
    await t.eval(`(()=>{document.querySelector('input.host').value=${JSON.stringify(v)};document.querySelector('form.filters').requestSubmit();})()`);
    await sleep(1500);
    return state();
  };
  log('0-start', await state());
  log('1-name-part', await filter('example'));
  log('2-full-domain', await filter('example.com'));
  await t.eval(`[...document.querySelectorAll('form.filters button')].find(b=>b.textContent==='필터 끄기').click()`);
  await sleep(1500);
  log('3-filter-off', await state());
  log('4-typed-not-applied', await (async () => {
    await filter('example');
    await t.eval(`document.querySelector('input.host').value='example.com'`); // 칸만 바꾸고 적용하지 않음
    await sleep(500);
    return state();
  })());
} finally {
  A.close();
  await proxy.close?.();
  await dash.close?.();
  plain.close();
  setTimeout(() => process.exit(0), 300);
}
