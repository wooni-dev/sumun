// [UI 보고서] O52 실측: UI-T 흐름의 경로마다 실제 클라이언트(headless Chrome 156, curl.exe)로 한 번씩 본다.
//   경로: 평문 HTTP, HTTPS 복호화, 닫힌 포트 → 대시보드(목록·상세·실시간·필터·지우기), 보호(다른 출처 페이지·리바인딩 Host·Via·프록시를 거친 대시보드)
//   함께 보는 것: Chrome이 --proxy-server만 줬을 때 loopback(127.0.0.1·localhost)을 프록시에서 빼는지.
// 목적지·프록시·저장소·대시보드는 이 프로세스 안에서 127.0.0.1로 띄운다. CA는 임시 폴더에 새로 만든다
// (Windows 인증서 저장소·%LOCALAPPDATA%\sumun은 건드리지 않는다). 그래서 브라우저는 --ignore-certificate-errors로 프록시 인증서를 받는다
// — Windows 저장소로 믿는 경로는 사용자가 CA를 등록한 뒤에만 볼 수 있다.
// 실행: node scripts/probe/ui-report/browser.mjs   출력: 단계별 JSON 한 줄씩
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { launch, page } from '../ui5b-review/cdp.mjs';
import { createStore } from '../../../src/store/store.ts';
import { attachStore } from '../../../src/store/attach.ts';
import { startProxy } from '../../../src/proxy/server.ts';
import { startDashboard } from '../../../src/dashboard/server.ts';
import { loadOrCreateCA, issueCert } from '../../../src/ca/ca.ts';

const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 같은 프로세스의 프록시·대시보드가 응답할 수 있게 비동기로 실행한다
const curl = (args) => new Promise((resolve) => execFile('curl.exe', ['-s', '-m', '5', '-o', 'NUL', '-w', '%{http_code}', ...args], (e, out) => resolve(e && !out ? `err:${e.code}` : String(out))));

const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-uirep-proxy-')), fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-uirep-up-'))];
const proxyCA = await loadOrCreateCA(dirs[0]);
const upCA = await loadOrCreateCA(dirs[1]);
const upCert = await issueCert(upCA, ['localhost', '127.0.0.1']);

// 목적지: 평문(받은 본문을 돌려줌), HTTPS, 닫힌 포트, 다른 출처 페이지(같은 PC의 다른 포트)
const plain = http.createServer((q, r) => {
  const c = [];
  q.on('data', (d) => c.push(d));
  q.on('end', () => r.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`plain-saw:${q.method} ${q.url} ${Buffer.concat(c)}`));
});
const secure = https.createServer({ cert: upCert.certPem, key: upCert.keyPem }, (q, r) => (q.resume(), r.writeHead(200, { 'content-type': 'text/plain' }).end('secure-hello')));
const other = http.createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>other</title><p>other origin</p>'));
for (const s of [plain, secure, other]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
const [PU, SU, OU] = [plain, secure, other].map((s) => s.address().port);
const closed = await new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});

const store = createStore();
const dash = await startDashboard({ store, port: 0, decrypt: true });
const proxy = await startProxy({ port: 0, ca: proxyCA, upstreamCA: [upCA.certPem], dashboardPort: dash.port, ...attachStore(store) });
const P = proxy.port;
log('ports', { proxy: P, dashboard: dash.port, plain: PU, secure: SU, closed, other: OU });
// 새 프로필 Chrome의 Google 백그라운드 요청은 빼고, 이 실측이 만든 127.0.0.1·localhost 기록만 본다
const LOCAL = /^\w+:\/\/(127\.0\.0\.1|localhost)[:/]/;
const isLocal = "/127\\.0\\.0\\.1|localhost/";
const recorded = () => store.list().filter((s) => LOCAL.test(s.url)).map((s) => `${s.method} ${s.url.replace(/:\d+/, ':<포트>')} ${s.status ?? '-'}`);

// A = 대시보드를 보는 브라우저(--proxy-server만: loopback 예외가 기본인지 본다)
// B = 요청을 만드는 브라우저(<-loopback>으로 loopback도 프록시로, 프록시 CA 경고 무시)
const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--disable-domain-reliability', '--disable-features=OptimizationGuideModelDownloading,OptimizationHints,Translate,MediaRouter,AutofillServerCommunication'];
const A = await launch([...QUIET, `--proxy-server=http://127.0.0.1:${P}`]);
const B = await launch([...QUIET, `--proxy-server=http://127.0.0.1:${P}`, '--proxy-bypass-list=<-loopback>', '--ignore-certificate-errors']);
log('browser', A.version);
const problems = [];
A.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') problems.push(['exception', m.params.exceptionDetails?.text]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(['console', JSON.stringify(m.params.args?.map((a) => a.value)).slice(0, 200)]);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(['log', `${m.params.entry.text?.slice(0, 120)} ${m.params.entry.url ?? ''}`]);
});
const go = async (b, url) => {
  const p = await page(b, url);
  await sleep(1200);
  return p.eval('document.body ? document.body.innerText.slice(0, 120) : "(본문 없음)"');
};
try {
  // 0. loopback 예외 실측: A(--proxy-server만)로 127.0.0.1·localhost 목적지를 연다 → 프록시 기록이 늘었는지
  const n0 = recorded().length;
  log('0-A-127.0.0.1', await go(A, `http://127.0.0.1:${PU}/loopback-check`));
  log('0-A-localhost', await go(A, `http://localhost:${PU}/loopback-check2`));
  await sleep(300);
  log('0-recorded-delta', { before: n0, after: recorded().length, rows: recorded() });

  // 1. 경로마다 실제 브라우저 B로 요청(평문 GET, HTTPS, 닫힌 포트) + curl 평문 POST(쿠키·본문)
  log('1-B-plain', await go(B, `http://127.0.0.1:${PU}/from-browser?q=1`));
  log('1-B-https', await go(B, `https://localhost:${SU}/hello?q=1`));
  log('1-B-closed', await go(B, `http://127.0.0.1:${closed}/nobody`));
  log('1-curl-post', await curl(['-x', `http://127.0.0.1:${P}`, '-H', 'Cookie: k=CURL-COOKIE', '--data-binary', 'curl-body', `http://127.0.0.1:${PU}/submit`]));
  await sleep(500);
  log('1-recorded', recorded());

  // 2. A로 대시보드를 연다(loopback 예외라 프록시를 거치지 않음)
  const t = await page(A, dash.url);
  await A.send('Log.enable', {}, t.s);
  await sleep(2000);
  const ev = (x) => t.eval(x);
  log('2-dashboard', await ev(`({head:document.body.innerText.slice(0,60),rows:[...document.querySelectorAll('section.list tbody tr')].map(r=>[...r.children].map(c=>c.textContent).slice(1,4).join(' | ').replace(/:\\d+/,':<포트>')).filter(x=>${isLocal}.test(x)),notice:[...document.querySelectorAll('.notice')].filter(n=>!n.hidden).map(n=>n.textContent)})`));
  const detail = (suffix) =>
    ev(`(async()=>{const tr=[...document.querySelectorAll('section.list tbody tr')].find(r=>r.children[2].textContent.includes(${JSON.stringify(suffix)}));if(!tr)return 'no-row';tr.click();await new Promise(r=>setTimeout(r,1500));return document.querySelector('.detail').innerText.replace(/:\\d{4,5}/g,':<포트>').slice(0,700)})()`);
  log('2-detail-post', await detail('/submit'));
  log('2-detail-https', await detail('/hello?q=1'));
  log('2-detail-closed', await detail('/nobody'));

  // 3. 실시간: 대시보드를 그대로 둔 채 B로 새 요청 → 새로고침 없이 줄이 생기는지
  const before = await ev(`document.querySelectorAll('section.list tbody tr').length`);
  await go(B, `http://127.0.0.1:${PU}/live-new`);
  await sleep(1500);
  log('3-live', { before, after: await ev(`document.querySelectorAll('section.list tbody tr').length`), hasLive: await ev(`[...document.querySelectorAll('section.list tbody tr')].some(r=>r.children[2].textContent.endsWith('/live-new'))`) });

  // 4. 필터: 상태 502 → 닫힌 포트만
  log('4-filter-502', await ev(`(async()=>{document.querySelector('input.status').value='502';document.querySelector('form.filters').requestSubmit();await new Promise(r=>setTimeout(r,1500));const rows=[...document.querySelectorAll('section.list tbody tr')].map(r=>r.children.length<4?'(안내 줄) '+r.textContent:r.children[2].textContent.replace(/:\\d+/,':<포트>')+' '+r.children[3].textContent);document.querySelector('input.status').value='';document.querySelector('form.filters').requestSubmit();await new Promise(r=>setTimeout(r,1000));return JSON.stringify({rows:rows.filter(x=>${isLocal}.test(x)),all:rows.length,count:(document.querySelector('.count')||{}).textContent})})().catch(e=>'error: '+e.message)`));

  // 5. 보호
  //  5a. 다른 출처 페이지(127.0.0.1:<다른 포트>)에서 대시보드 API를 fetch → 막혀야 함
  const o = await page(A, `http://127.0.0.1:${OU}/`);
  await sleep(800);
  log('5a-other-origin-fetch', await o.eval(`fetch('http://127.0.0.1:${dash.port}/api/flows').then(r=>'status '+r.status).catch(e=>'blocked: '+e.message)`));
  //  5b. 다른 출처 페이지의 링크로 대시보드 페이지로 이동 → 403 고정 문구여야 함
  await o.eval(`location.href=${JSON.stringify(dash.url)}`);
  await sleep(1500);
  log('5b-other-origin-link', await o.eval('document.body.innerText.slice(0,80)'));
  //  5c. curl: 리바인딩 Host, Via, 프록시를 거친 대시보드(평문·CONNECT)
  log('5c-curl-direct', await curl([`http://127.0.0.1:${dash.port}/`]));
  log('5c-curl-rebind-host', await curl(['-H', 'Host: evil.example:' + dash.port, `http://127.0.0.1:${dash.port}/`]));
  log('5c-curl-via', await curl(['-H', 'Via: 1.1 sumun', `http://127.0.0.1:${dash.port}/`]));
  const n5 = recorded().length;
  log('5c-curl-through-proxy', await curl(['-x', `http://127.0.0.1:${P}`, `http://127.0.0.1:${dash.port}/`]));
  log('5c-curl-connect-through-proxy', await curl(['-w', 'code=%{http_code} connect=%{http_connect}', '-x', `http://127.0.0.1:${P}`, '-p', `http://127.0.0.1:${dash.port}/`]));
  //  5d. 브라우저 B(<-loopback>)로 대시보드 주소를 열면 프록시를 거친다 → 어떻게 보이는지
  log('5d-B-dashboard-through-proxy', await go(B, dash.url));
  await sleep(300);
  log('5-recorded-delta', { before: n5, after: recorded().length, rows: recorded().slice(n5) });

  // 6. 지우기(두 번 누르기) → 목록 0
  log('6-clear', await ev(`(async()=>{const b=document.querySelector('button.danger');b.click();await new Promise(r=>setTimeout(r,200));b.click();await new Promise(r=>setTimeout(r,1500));return {rows:document.querySelectorAll('section.list tbody tr').length,store:${'0'}}})()`));
  log('6-store-after-clear', { all: store.list().length, local: recorded().length });
  log('7-problems', problems);
} finally {
  A.close();
  B.close();
  await sleep(700);
  for (const d of [A.dir, B.dir, ...dirs]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  await proxy.close();
  await dash.close();
  for (const s of [plain, secure, other]) (s.closeAllConnections?.(), s.close());
}
