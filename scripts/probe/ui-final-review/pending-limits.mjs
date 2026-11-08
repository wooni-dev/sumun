// [UI 큰 단위 끝 — 독립 검토] 진행 중 표시, 이상한 상태 문구, 실시간 연결 상한, 많은 기록(1000건 넘음), punycode 표시.
// 실제 진입점(node src/index.ts) + headless Chrome(프록시 없음)으로 대시보드를 본다. 요청은 Node가 프록시로 보낸다(외부로 나가지 않음).
// 실행: node scripts/probe/ui-final-review/pending-limits.mjs
import http from 'node:http';
import net from 'node:net';
import { launch, page } from './_cdp.mjs';
import { startApp, log, sleep, portOpen } from './_env.mjs';
import { hostLabel, displayUrl } from '../../../src/dashboard/public/view.js';

const ROWS = `[...document.querySelectorAll('section.list tbody tr')].map(tr=>[...tr.cells].map(c=>c.textContent))`;

// 목적지: /slow는 3초 뒤 응답, /weird는 상태 문구에 HTML·방향 바꿈 바이트, 그 밖은 바로 응답
const up = net.createServer((sock) => {
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    if (!buf.includes('\r\n\r\n')) return;
    const p = buf.split(' ')[1];
    buf = '';
    const send = (status, body) => sock.write(`HTTP/1.1 ${status}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`, 'latin1', () => sock.end());
    if (p === '/slow') setTimeout(() => send('200 OK', 'slow'), 3000);
    else if (p === '/weird') send('200 <img src=x onerror=alert(1)>\xe2\x80\xae', 'w');
    else send('200 OK', 'ok');
  });
  sock.on('error', () => {});
});
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const U = `http://127.0.0.1:${up.address().port}`;

const app = await startApp();
const A = await launch(['--no-proxy-server']);
const fire = (p) => new Promise((r) => http.get({ host: '127.0.0.1', port: app.proxyPort, path: U + p, agent: false }, (res) => (res.resume(), res.on('end', r))).on('error', r));
try {
  const dash = await page(A, app.dashUrl);
  await dash.waitFor(`document.querySelector('.conn')?.textContent==='실시간'`);
  // 진행 중
  const slow = fire('/slow');
  await sleep(700);
  log('pending-row', (await dash.eval(ROWS))[0]);
  await slow;
  await sleep(500);
  log('pending-done-row', (await dash.eval(ROWS))[0]);
  // 상태 문구
  await fire('/weird');
  await sleep(500);
  await dash.eval(`[...document.querySelectorAll('section.list tbody tr')][0].click()`);
  await sleep(700);
  log('weird-status', await dash.eval(`[...document.querySelectorAll('section.detail h3')].map(h=>h.textContent)`));
  log('weird-danger', await dash.eval(`({imgs: document.querySelectorAll('img').length, problems: 0})`));
  log('weird-dialogs', dash.problems.filter((p) => p.kind === 'dialog'));

  // 실시간 연결 상한: 탭 하나가 이미 1개를 쓴다. Node로 15개 더 → 16개, 17번째는 503
  const socks = [];
  const statuses = [];
  for (let i = 0; i < 16; i++) {
    const st = await new Promise((resolve) => {
      const q = http.get({ host: '127.0.0.1', port: app.dashPort, path: '/api/events', headers: { Authorization: `Bearer ${app.token}` }, agent: false }, (res) => (socks.push(res), resolve(res.statusCode)));
      q.on('error', () => resolve(0));
    });
    statuses.push(st);
  }
  log('sse-limit', { statuses });
  const tab2 = await page(A, app.dashUrl);
  await sleep(1500);
  log('sse-limit-new-tab', await tab2.eval(`document.querySelector('.conn')?.textContent`));
  for (const s of socks) s.destroy();
  await sleep(2500);
  log('sse-limit-new-tab-after-free', await tab2.eval(`document.querySelector('.conn')?.textContent`));
  await tab2.close();

  // 1200건: 화면은 1000줄까지만, 안내 문구
  const t0 = Date.now();
  for (let i = 0; i < 1200; i += 20) await Promise.all(Array.from({ length: 20 }, (_, k) => fire(`/n${i + k}`)));
  log('bulk-sent-ms', Date.now() - t0);
  await sleep(1500);
  log('bulk', { rows: (await dash.eval(ROWS)).length, count: await dash.eval(`document.querySelector('.count').textContent`), more: await dash.eval(`document.querySelector('.more').textContent`), conn: await dash.eval(`document.querySelector('.conn').textContent`) });
  log('dash-problems', dash.problems.filter((p) => !/favicon/.test(p.url ?? '')));

  // punycode·표시 함수(순수 함수 직접)
  log('hostLabel', { cyr: hostLabel('xn--80ak6aa92e.com'), bad: hostLabel('xn--zz.com'), plain: hostLabel('example.com') });
  log('displayUrl-list-uses-ascii', displayUrl({ target: { scheme: 'https', host: 'xn--80ak6aa92e.com', port: 443, path: '/' } }));
} finally {
  await A.close();
  await app.stop();
  up.close();
  await sleep(300);
  log('ports-after-stop', { proxy: await portOpen(app.proxyPort), dash: await portOpen(app.dashPort) });
  setTimeout(() => process.exit(0), 200);
}
