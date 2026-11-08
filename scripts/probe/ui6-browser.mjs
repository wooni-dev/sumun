// [UI-6] 실측 E197·E198: headless Chrome 156(임시 프로필, scripts/probe/ui5b-review/cdp.mjs)으로 화면 고침을 실제로 본다.
//   ① 필터 켠 채 요청 폭주 ② 주소의 토큰 지우기 ③ 다시 시작 뒤 같은 탭에 새 주소 ④ 새로고침 ⑤ 콘솔·아이콘 ⑥ 헤더 UTF-8
//   ⑦ 터널 끝남·터널 실패 ⑧ 다른 출처 링크의 403 문구 ⑨ <-loopback>;127.0.0.1:D;localhost:D 설정 · E198 [탐색] 프로필에 남은 토큰
// 목적지·프록시·저장소·대시보드는 이 프로세스 안에서 127.0.0.1로 띄운다. 외부로 나가지 않게 Chrome 배경 요청을 줄이는 플래그를 준다.
// 실행: node scripts/probe/ui6-browser.mjs   출력: 단계별 JSON 한 줄씩
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { launch, page } from './ui5b-review/cdp.mjs';
import { createStore } from '../../src/store/store.ts';
import { attachStore } from '../../src/store/attach.ts';
import { startProxy } from '../../src/proxy/server.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--disable-domain-reliability', '--disable-features=OptimizationGuideModelDownloading,OptimizationHints,Translate,MediaRouter,AutofillServerCommunication'];
const latin1 = (s) => Buffer.from(s, 'utf8').toString('latin1'); // UTF-8 바이트를 Node 헤더 글자로(한 글자 = 한 바이트)

// 목적지: 평문(UTF-8 바이트가 든 헤더·상태 문구), 터널용 echo·도중 RST, 다른 출처 페이지
const plain = http.createServer((q, r) => {
  q.resume();
  q.on('end', () => {
    if (q.url.startsWith('/utf8')) {
      r.writeHead(200, latin1('OK ‮gnp.exe 완료'), { 'content-type': 'text/plain', 'x-evil': latin1('a‮b 한글'), 'x-latin': 'café' });
      return r.end('utf8');
    }
    r.writeHead(200, { 'content-type': 'text/plain' }).end(`plain:${q.url}`);
  });
});
const echo = net.createServer((s) => (s.on('error', () => {}), s.on('data', (d) => s.write(d))));
const resetter = net.createServer((s) => (s.on('error', () => {}), s.once('data', () => (s.write('partial'), setTimeout(() => s.resetAndDestroy(), 50)))));
const other = http.createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>other</title><p>other</p>'));
for (const s of [plain, echo, resetter, other]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
const [PU, EU, RU, OU] = [plain, echo, resetter, other].map((s) => s.address().port);

const store = createStore();
let dash = await startDashboard({ store, port: 0 });
const D = dash.port;
const proxy = await startProxy({ port: 0, tunnel: true, dashboardPort: D, ...attachStore(store) });
const P = proxy.port;
log('ports', { proxy: P, dashboard: D, plain: PU, echo: EU, resetter: RU, other: OU });

const viaProxy = (p) =>
  new Promise((resolve) => {
    const q = http.request({ host: '127.0.0.1', port: P, path: `http://127.0.0.1:${PU}${p}`, headers: { host: `127.0.0.1:${PU}` }, agent: false }, (res) => (res.resume(), res.on('end', resolve)));
    q.on('error', resolve);
    q.end();
  });
const tunnel = (port, act) =>
  new Promise((resolve) => {
    const c = net.connect(P, '127.0.0.1', () => c.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
    c.on('error', () => {});
    c.once('data', async () => (await act(c), setTimeout(resolve, 300)));
  });

const problems = [];
const net200 = [];
const A = await launch(QUIET);
log('browser', A.version);
A.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') problems.push(['exception', m.params.exceptionDetails?.text]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(['console', JSON.stringify(m.params.args?.map((a) => a.value)).slice(0, 200)]);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(['log', `${m.params.entry.text?.slice(0, 120)} ${m.params.entry.url ?? ''}`]);
  if (m.method === 'Network.responseReceived' && /favicon/.test(m.params.response.url)) net200.push([m.params.response.url.replace(/:\d+/, ':<D>'), m.params.response.status]);
});
let C;
try {
  await viaProxy('/before-open');
  const t = await page(A);
  await A.send('Log.enable', {}, t.s);
  await A.send('Network.enable', {}, t.s);
  await A.send('Page.enable', {}, t.s);
  await A.send('Page.navigate', { url: dash.url }, t.s);
  await sleep(2500);
  const ev = (x) => t.eval(x);
  const rowsOf = `[...document.querySelectorAll('section.list tbody tr')]`;

  // ② 주소의 토큰
  log('②address', await ev(`({href: location.href.replace(/:\\d+/, ':<D>'), hash: location.hash, state: history.state, name: window.name, len: history.length, conn: document.querySelector('.conn')?.textContent})`));

  // ⑤ 아이콘(콘솔은 끝에서 한꺼번에)
  log('⑤favicon', net200);

  // ① 필터(상태 200) 켠 채 0.15초마다 4초
  await ev(`(()=>{document.querySelector('input.status').value='200';document.querySelector('form.filters').requestSubmit();})()`);
  await sleep(1200);
  const samples = [];
  const count = () => ev(`document.querySelector('.count')?.textContent`);
  let sending = true;
  const sender = (async () => {
    for (let i = 0; sending; i++) (viaProxy(`/burst-${i}`), await sleep(150));
  })();
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) (samples.push([Date.now() - t0, await count()]), await sleep(500));
  sending = false;
  await sender;
  await sleep(1500);
  const total = store.list({ status: 200 }).length;
  const after = await count();
  const nums = samples.map((s) => Number(String(s[1]).match(/\d+/)?.[0]));
  let rises = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) rises++;
  log('①filter-burst', { samples, rises, after, storeStatus200: total });
  await ev(`(()=>{document.querySelector('input.status').value='';document.querySelector('form.filters').requestSubmit();})()`);
  await sleep(800);

  // ⑥ 헤더 UTF-8
  await viaProxy('/utf8');
  await sleep(800);
  const detail = (match) =>
    ev(`(async()=>{const tr=${rowsOf}.find(r=>r.children[2]&&r.children[2].textContent.includes(${JSON.stringify(match)}));if(!tr)return 'no-row';tr.click();await new Promise(r=>setTimeout(r,1500));return document.querySelector('.detail').innerText})()`);
  const u = await detail('/utf8');
  log('⑥utf8', {
    marked: u.includes('⟨U+202E⟩'),
    note: u.includes('UTF-8로 풀어 보임'),
    rawRLO: [...u].filter((c) => c === '‮').length,
    lines: u.split('\n').filter((l) => /x-evil|응답 200|x-latin/i.test(l)),
  });

  // ⑦ 터널: T1(데이터 뒤 브라우저 RST), T5(목적지가 일부 보낸 뒤 RST)
  await tunnel(EU, async (c) => (c.write('hello'), await sleep(150), c.resetAndDestroy()));
  await tunnel(RU, async (c) => (c.write('x'), await sleep(400)));
  await sleep(800);
  log('⑦tunnel-rows', await ev(`${rowsOf}.filter(r=>/CONNECT/.test(r.children[1]?.textContent)).map(r=>[r.children[2].textContent.replace(/:\\d+/,':<포트>'), r.children[3].textContent, r.children[3].className])`));
  log('⑦T1-detail', (await detail(`:${EU}`)).split('\n').filter((l) => /끝남|실패|터널/.test(l)));
  log('⑦T5-detail', (await detail(`:${RU}`)).split('\n').filter((l) => /끝남|실패|터널/.test(l)));

  // ④ 새로고침
  await A.send('Page.reload', {}, t.s);
  await sleep(2000);
  log('④reload', await ev(`document.body.innerText.slice(0, 160)`));

  // ③ 대시보드를 같은 포트로 다시 시작 → 같은 탭에 새 주소(먼저 옛 주소로 열어 둔 상태에서)
  await A.send('Page.navigate', { url: dash.url }, t.s);
  await sleep(2000);
  const oldToken = dash.token;
  await dash.close();
  dash = await startDashboard({ store, port: D });
  await sleep(500);
  await A.send('Page.navigate', { url: dash.url }, t.s);
  await sleep(3000);
  log('③restart-same-tab', await ev(`({href: location.href.replace(/:\\d+/, ':<D>'), conn: document.querySelector('.conn')?.textContent, body: document.body.innerText.slice(0, 60)})`));

  // ⑧ 다른 출처 페이지의 링크로 대시보드
  const o = await page(A, `http://127.0.0.1:${OU}/`);
  await sleep(800);
  await o.eval(`location.href=${JSON.stringify(dash.url)}`);
  await sleep(1500);
  log('⑧other-origin-403', await o.eval('document.body.innerText.slice(0, 120)'));
  log('⑤console-problems', problems);

  // ⑨ <-loopback>;127.0.0.1:D;localhost:D
  C = await launch([...QUIET, `--proxy-server=http://127.0.0.1:${P}`, `--proxy-bypass-list=<-loopback>;127.0.0.1:${D};localhost:${D}`]);
  const n0 = store.list().filter((s) => s.url.includes('/devapp')).length;
  const cd = await page(C, dash.url);
  await sleep(2500);
  const cdText = await cd.eval(`document.querySelector('.conn')?.textContent ?? document.body.innerText.slice(0, 80)`);
  const dev = await page(C, `http://127.0.0.1:${PU}/devapp`);
  await sleep(1200);
  log('⑨bypass-combo', { dashboard: cdText, devPage: await dev.eval('document.body.innerText'), devRecorded: store.list().filter((s) => s.url.includes('/devapp')).length - n0 });

  // E198 [탐색]: 브라우저를 정상 종료한 뒤 프로필 파일에서 토큰 찾기
  await A.send('Browser.close');
  await sleep(2500);
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const b = fs.readFileSync(p);
          for (const [label, tok] of [['old', oldToken], ['new', dash.token]]) if (b.includes(tok)) found.push([path.relative(A.dir, p), label]);
        } catch {}
      }
    }
  };
  walk(A.dir);
  log('E198-profile-token', found);
} finally {
  A.close();
  C?.close();
  await sleep(700);
  for (const d of [A.dir, C?.dir].filter(Boolean)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  await proxy.close();
  await dash.close();
  for (const s of [plain, other]) (s.closeAllConnections?.(), s.close());
  for (const s of [echo, resetter]) s.close();
}
