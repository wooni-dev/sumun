// [UI 큰 단위 끝 — 독립 검토] headless Chrome으로 대시보드 사용자 흐름을 본다.
//   1단계: 실제 진입점(node src/index.ts, 복호화 꺼짐). 프록시를 쓰는 Chrome(B)이 목적지를 열고, 다른 Chrome(A, 프록시 없음)이 대시보드를 본다.
//          목록·실시간 갱신·상세·본문(텍스트·16진·압축)·숨은 문자·XSS 문자열·닫힌 포트·필터·지우기·터널·"복호화 꺼짐" 안내.
//          B가 대시보드 주소를 열면 프록시가 막는지. 다른 출처(evil.test)·리바인딩(rebind.test → 127.0.0.1) 공격 페이지.
//   2단계: 같은 프로세스 안에서 임시 CA로 복호화를 켜고(Windows 저장소·%LOCALAPPDATA%\sumun 미사용) B가 HTTPS를 열면 대시보드에 내용이 나오는지.
//          B는 --ignore-certificate-errors(임시 프로필)로 임시 루트를 믿지 않은 채 진행한다.
// 실행: node scripts/probe/ui-final-review/browser.mjs     출력: 단계별 JSON 한 줄씩
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, page } from './_cdp.mjs';
import { startUpstream, startApp, closedPort, log, sleep, portOpen, freePort } from './_env.mjs';
import { createStore } from '../../../src/store/store.ts';
import { attachStore } from '../../../src/store/attach.ts';
import { startProxy } from '../../../src/proxy/server.ts';
import { startDashboard } from '../../../src/dashboard/server.ts';
import { loadOrCreateCA, issueCert } from '../../../src/ca/ca.ts';

const ROWS = `[...document.querySelectorAll('section.list tbody tr')].map(tr=>[...tr.cells].map(c=>c.textContent))`;
const DANGER = `({xss: window.__xss ?? null, title: document.title, imgs: document.querySelectorAll('img,iframe,object,embed,svg,a[href]').length, inlineScripts: [...document.scripts].filter(s=>!s.src).length})`;
const clickRow = (pred) => `(()=>{const tr=[...document.querySelectorAll('section.list tbody tr')].find(tr=>(${pred})([...tr.cells].map(c=>c.textContent)));if(!tr)return 'no-row';tr.click();return tr.dataset.id})()`;
const DETAIL = `document.querySelector('section.detail')?.innerText ?? ''`;

// 공격 페이지(evil.test:A에서 연다): 토큰 없이 대시보드 API를 읽거나 지우려 한다
function attackerServer(dashPort) {
  const html = `<!doctype html><meta charset=utf-8><body><script>
  (async () => {
    const D = 'http://127.0.0.1:${dashPort}';
    const out = {};
    try { const r = await fetch(D + '/api/flows', { mode: 'no-cors' }); out.noCors = { type: r.type, status: r.status }; } catch (e) { out.noCors = 'err ' + e.name; }
    try { const r = await fetch(D + '/api/flows', { headers: { Authorization: 'Bearer guess' } }); out.cors = r.status; } catch (e) { out.cors = 'err ' + e.name; }
    try { const r = await fetch(D + '/'); out.corsRoot = r.status; } catch (e) { out.corsRoot = 'err ' + e.name; }
    try { const r = await fetch('http://rebind.test:${dashPort}/api/flows'); out.rebindFetch = r.status; } catch (e) { out.rebindFetch = 'err ' + e.name; }
    // 폼 CSRF(text/plain)로 지우기
    const f = document.createElement('form'); f.method = 'POST'; f.action = D + '/api/clear'; f.enctype = 'text/plain'; f.target = 'sink';
    const i = document.createElement('input'); i.name = '{"a":"'; i.value = '"}'; f.append(i);
    const fr = document.createElement('iframe'); fr.name = 'sink'; document.body.append(fr, f); f.submit();
    // 대시보드를 iframe에(토큰은 모름)
    const fr2 = document.createElement('iframe'); fr2.src = D + '/'; document.body.append(fr2);
    await new Promise(r => setTimeout(r, 1500));
    try { out.iframeReadable = !!fr2.contentDocument; } catch (e) { out.iframeReadable = 'blocked ' + e.name; }
    window.__attack = out;
  })();
  </script>`;
  const s = http.createServer((q, r) => (r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }), r.end(html)));
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, close: () => new Promise((r) => (s.closeAllConnections(), s.close(() => r()))) })));
}

async function httpsUpstream(cert) {
  const s = https.createServer({ cert: cert.certPem, key: cert.keyPem }, (q, r) => {
    const body = `secure body for ${q.url} <script>window.__xss=9</script>`;
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'sid=HTTPS-SECRET', 'Content-Length': Buffer.byteLength(body) });
    r.end(body);
  });
  s.on('tlsClientError', () => {});
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, close: () => new Promise((r) => (s.closeAllConnections(), s.close(() => r()))) })));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-uifinal-ca-'));
const upCA = await loadOrCreateCA(path.join(tmp, 'up'), { onWarning: () => {} });
const upCert = await issueCert(upCA, ['localhost', '127.0.0.1']);
const up = await startUpstream();
const hup = await httpsUpstream(upCert);
const cleanup = [];

try {
  // ===================== 1단계: 실제 진입점, 복호화 꺼짐 =====================
  const app = await startApp();
  cleanup.push(() => app.stop());
  const atk = await attackerServer(app.dashPort);
  cleanup.push(() => atk.close());
  log('phase1', { proxy: app.proxyPort, dash: app.dashPort, up: up.port, httpsUp: hup.port, attacker: atk.port });

  const A = await launch(['--no-proxy-server', '--host-resolver-rules=MAP evil.test 127.0.0.1, MAP rebind.test 127.0.0.1']);
  cleanup.push(() => A.close());
  const B = await launch([`--proxy-server=http://127.0.0.1:${app.proxyPort}`, '--proxy-bypass-list=<-loopback>', '--ignore-certificate-errors']);
  cleanup.push(() => B.close());
  log('chrome', A.version);

  const dash = await page(A, app.dashUrl);
  log('p1-initial', await dash.waitFor(`document.querySelector('.conn')?.textContent==='실시간' && ({conn: document.querySelector('.conn').textContent, notice: document.querySelector('.notice')?.hidden ? null : document.querySelector('.notice')?.textContent, rows: ${ROWS}.length})`));

  // B(프록시를 쓰는 브라우저)가 목적지를 연다 — 대시보드는 새로고침 없이 갱신되어야 한다
  const surf = await page(B);
  const U = `http://127.0.0.1:${up.port}`;
  for (const p of ['/hello?q=1', '/xss', '/bidi', '/gz', '/bin', '/svg', '/notfound']) await surf.go(U + p);
  await surf.go(`https://localhost:${hup.port}/tunnel-path`); // 복호화 꺼짐 → 터널
  log('p1-surf-https-tunnel-page', await surf.eval(`document.body?.innerText?.slice(0,60)`));
  const cp = await closedPort();
  await surf.go(`http://127.0.0.1:${cp}/closed`);
  log('p1-surf-closed-page', await surf.eval(`document.body?.innerText?.slice(0,80)`));
  await sleep(800);
  const rows = await dash.eval(ROWS);
  log('p1-live-rows', rows);
  log('p1-danger-after-list', await dash.eval(DANGER));

  // 상세: XSS 문자열이 든 헤더·본문
  log('p1-click-xss', await dash.eval(clickRow(`c=>c[2].includes('/xss')`)));
  await dash.waitFor(`document.querySelector('pre.body')?.textContent && document.querySelector('pre.body').textContent!=='불러오는 중…'`);
  const det = await dash.eval(DETAIL);
  log('p1-detail-xss', { hasEvilHeaderText: det.includes(`onerror="document.title='XSS-IMG'`), hasCookie: det.includes('SECRET123'), body: await dash.eval(`document.querySelector('pre.body').textContent.slice(0,120)`) });
  log('p1-danger-after-xss', await dash.eval(DANGER));
  // 16진 탭
  await dash.eval(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='16진').click()`);
  log('p1-hex', await dash.eval(`document.querySelector('pre.body').textContent.split('\\n')[0]`));
  // 숨은 문자
  await dash.eval(clickRow(`c=>c[2].includes('/bidi')`));
  await dash.waitFor(`document.querySelector('pre.body')?.textContent?.includes('invoice')`);
  log('p1-bidi', await dash.eval(`document.querySelector('pre.body').textContent`));
  // 압축
  await dash.eval(clickRow(`c=>c[2].includes('/gz')`));
  await dash.waitFor(`[...document.querySelectorAll('section.detail p.note')].some(p=>p.textContent.startsWith('압축'))`);
  log('p1-gz', { enc: await dash.eval(`[...document.querySelectorAll('section.detail p.note')].map(p=>p.textContent).filter(t=>t.startsWith('압축'))`), body: await dash.eval(`document.querySelector('pre.body').textContent.slice(0,30)`) });
  // 이진
  await dash.eval(clickRow(`c=>c[2].endsWith('/bin')`));
  await dash.waitFor(`document.querySelector('pre.body.hex')`);
  log('p1-bin', await dash.eval(`document.querySelector('pre.body').textContent`));
  // SVG: 미리보기 버튼이 없어야 하고 실행되지 않아야 한다
  await dash.eval(clickRow(`c=>c[2].endsWith('/svg')`));
  await dash.waitFor(`document.querySelector('pre.body')?.textContent?.includes('svg')`);
  log('p1-svg', { previewBtnVisible: await dash.eval(`[...document.querySelectorAll('.tabs button')].some(b=>b.textContent==='이미지 미리보기'&&!b.hidden)`), danger: await dash.eval(DANGER) });
  // 터널·닫힌 포트
  await dash.eval(clickRow(`c=>c[3]==='터널'`));
  await sleep(500);
  log('p1-tunnel-detail', (await dash.eval(DETAIL)).slice(0, 400));
  await dash.eval(clickRow(`c=>c[2].includes('/closed')`));
  await sleep(500);
  log('p1-closed-detail', (await dash.eval(DETAIL)).slice(0, 400));

  // 필터: 상태 404 → 한 건, 메서드 POST → 0, 잘못된 값 → 고정 문구
  await dash.eval(`document.querySelector('input.status').value='404';document.querySelector('form.filters').requestSubmit()`);
  await sleep(700);
  log('p1-filter-404', { rows: await dash.eval(ROWS), count: await dash.eval(`document.querySelector('.count').textContent`) });
  await dash.eval(`document.querySelector('input.status').value='';document.querySelector('input.host').value='localhost';document.querySelector('form.filters').requestSubmit()`);
  await sleep(700);
  log('p1-filter-host-localhost', { rows: await dash.eval(ROWS), count: await dash.eval(`document.querySelector('.count').textContent`) });
  await dash.eval(`document.querySelector('input.host').value='';document.querySelector('input.method').value='G;T';document.querySelector('form.filters').requestSubmit()`);
  await sleep(300);
  log('p1-filter-bad', await dash.eval(`document.querySelector('.err').textContent`));
  // 필터를 켠 채 실시간: 메서드 GET 필터 + 새 요청 1건
  await dash.eval(`document.querySelector('input.method').value='GET';document.querySelector('form.filters').requestSubmit()`);
  await sleep(700);
  const c0 = await dash.eval(`document.querySelector('.count').textContent`);
  await surf.go(U + '/hello?live-under-filter');
  await sleep(1200);
  log('p1-filter-live', { before: c0, after: await dash.eval(`document.querySelector('.count').textContent`), top: (await dash.eval(ROWS))[0] });

  // 필터를 켠 채 요청이 계속 오면(0.15초 간격, 4초) 그 동안 필터 목록이 바뀌는가
  const burst = [];
  const t0 = Date.now();
  const agent = new http.Agent({ keepAlive: false });
  const fire = () => new Promise((r) => http.get({ host: '127.0.0.1', port: app.proxyPort, path: `${U}/hello?burst`, agent }, (res) => (res.resume(), res.on('end', r))).on('error', r));
  const before = await dash.eval(`document.querySelector('.count').textContent`);
  while (Date.now() - t0 < 4000) {
    await fire();
    await sleep(150);
    if ((Date.now() - t0) % 1000 < 200) burst.push([Date.now() - t0, await dash.eval(`document.querySelector('.count').textContent`), await dash.eval(`document.querySelector('.conn').textContent`)]);
  }
  burst.push(['burst-end', await dash.eval(`document.querySelector('.count').textContent`)]);
  await sleep(1000);
  burst.push(['+1s', await dash.eval(`document.querySelector('.count').textContent`)]);
  log('p1-filter-burst', { before, samples: burst });
  await dash.eval(`[...document.querySelectorAll('form.filters button')].find(b=>b.textContent==='필터 끄기').click()`);
  await sleep(400);
  log('p1-filter-off', await dash.eval(`document.querySelector('.count').textContent`));

  // 지우기: 두 번 누르기
  await dash.eval(`document.querySelector('button.danger').click()`);
  log('p1-clear-armed', await dash.eval(`document.querySelector('button.danger').textContent`));
  await dash.eval(`document.querySelector('button.danger').click()`);
  await sleep(600);
  log('p1-clear', { rows: (await dash.eval(ROWS)).length, count: await dash.eval(`document.querySelector('.count').textContent`) });
  await surf.go(U + '/hello?after-clear');
  await sleep(800);
  log('p1-after-clear-live', await dash.eval(ROWS));

  // 프록시를 쓰는 B가 대시보드 주소(토큰 포함)를 연다 → 프록시가 403, 기록 없음, 터미널 안내 한 번
  await surf.go(app.dashUrl);
  log('p1-B-opens-dashboard', { text: await surf.eval(`document.body?.innerText?.slice(0,120)`), appRan: await surf.eval(`!!document.querySelector('header.top')`) });
  await surf.go(`http://localhost:${app.dashPort}/#t=${app.token}`);
  await surf.go(`http://127.0.0.1:${app.dashPort}/api/flows`);
  await sleep(500);
  log('p1-after-B-dashboard', { rows: (await dash.eval(ROWS)).length, guidanceLines: app.stdout().split('\n').filter((l) => l.includes('대시보드로 가는 요청이 프록시로')).length });

  // 공격 페이지(다른 출처)와 리바인딩
  const evil = await page(A, `http://evil.test:${atk.port}/`);
  log('p1-attacker', await evil.waitFor(`window.__attack`, 6000));
  const rebind = await page(A, `http://rebind.test:${app.dashPort}/#t=${app.token}`);
  log('p1-rebind-navigate', { text: await rebind.eval(`document.body?.innerText?.slice(0,80)`), appRan: await rebind.eval(`!!document.querySelector('header.top')`) });
  log('p1-rows-after-attack', (await dash.eval(ROWS)).length);
  // 토큰 없이 열기
  const notoken = await page(A, `http://127.0.0.1:${app.dashPort}/`);
  log('p1-no-token', await notoken.eval(`document.body.innerText`));
  // 다시 시작 감지: 같은 탭은 그대로 두고 프로그램만 다시 띄우면(포트가 같지 않으므로) 끊김 표시
  log('p1-console-problems', { dash: dash.problems, evil: evil.problems.length, rebind: rebind.problems.length });
  await app.stop();
  await sleep(2500);
  log('p1-after-app-stop', await dash.eval(`document.querySelector('.conn').textContent`));
  log('p1-ports-after-stop', { proxy: await portOpen(app.proxyPort), dash: await portOpen(app.dashPort) });
  await dash.close();
  await surf.close();

  // ===================== 2단계: 복호화(임시 CA, 같은 프로세스) =====================
  const proxyCA = await loadOrCreateCA(path.join(tmp, 'proxy'), { onWarning: () => {} });
  const store = createStore();
  const d2 = await startDashboard({ store, port: 0, decrypt: true });
  cleanup.push(() => d2.close());
  const pport = await freePort();
  const p2 = await startProxy({ port: pport, tunnel: true, ca: proxyCA, upstreamCA: [upCA.certPem], dashboardPort: d2.port, ...attachStore(store) });
  cleanup.push(() => p2.close());
  log('phase2', { proxy: p2.port, dash: d2.port });
  const C = await launch([`--proxy-server=http://127.0.0.1:${p2.port}`, '--proxy-bypass-list=<-loopback>', '--ignore-certificate-errors']);
  cleanup.push(() => C.close());
  const dash2 = await page(A, d2.url);
  await dash2.waitFor(`document.querySelector('.conn')?.textContent==='실시간'`);
  log('p2-notice', await dash2.eval(`document.querySelector('.notice').hidden ? 'hidden' : document.querySelector('.notice').textContent`));
  const s2 = await page(C);
  await s2.go(`https://localhost:${hup.port}/secure/page?x=1`);
  log('p2-browser-page', await s2.eval(`document.body?.innerText?.slice(0,80)`));
  await sleep(800);
  const r2 = await dash2.eval(ROWS);
  log('p2-rows', r2);
  await dash2.eval(clickRow(`c=>c[2].includes('/secure/page')`));
  await dash2.waitFor(`document.querySelector('pre.body')?.textContent?.includes('secure')`);
  const det2 = await dash2.eval(DETAIL);
  log('p2-detail', { https: det2.includes('https://localhost'), sni: /TLS SNI\s*localhost/.test(det2), cookie: det2.includes('HTTPS-SECRET'), body: await dash2.eval(`document.querySelector('pre.body').textContent.slice(0,80)`), danger: await dash2.eval(DANGER) });
  // 복호화 프록시를 쓰는 브라우저가 대시보드를 열면
  await s2.go(d2.url);
  log('p2-C-opens-dashboard', await s2.eval(`document.body?.innerText?.slice(0,80)`));
  log('p2-console-problems', dash2.problems);
} finally {
  for (const f of cleanup.reverse()) {
    try {
      await f();
    } catch {}
  }
  await hup.close();
  await up.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  log('done', { httpsUp: await portOpen(hup.port), up: await portOpen(up.port) });
  setTimeout(() => process.exit(0), 300);
}
