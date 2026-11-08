// [UI-5b] 실측 E193·E194: headless Chrome(임시 프로필, scripts/probe/ui5b-review/cdp.mjs)으로 대시보드의 미리보기·압축 풀기를 실제로 본다.
// 목적지(fixtures)·프록시·저장소·대시보드는 이 프로세스 안에서 127.0.0.1로 띄운다. 외부로 나가지 않는다.
// 실행: node scripts/probe/ui5b-browser.mjs   출력: 단계별 JSON 한 줄씩
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, page } from './ui5b-review/cdp.mjs';
import { createStore } from '../../src/store/store.ts';
import { attachStore } from '../../src/store/attach.ts';
import { startProxy } from '../../src/proxy/server.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- PNG 만들기(진짜로 디코드되는 파일) ---
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function png(w, h, fill) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // 회색 8비트
  const raw = Buffer.alloc((w + 1) * h, fill);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0; // 줄마다 필터 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const text = '압축된 본문입니다 — sumun UI-5b 실측. '.repeat(200);
const FIX = {
  '/img.png': { type: 'text/plain', body: png(40, 30, 0x80) }, // ① Content-Type이 틀린 정상 이미지(Q7)
  '/gz': { type: 'text/plain; charset=utf-8', enc: 'gzip', body: zlib.gzipSync(text) }, // ②
  '/gzbomb': { type: 'text/plain', enc: 'gzip', body: zlib.gzipSync(Buffer.alloc(256 * 1024 * 1024)) }, // ③ 256MiB → 약 0.25MB
  '/bomb.png': { type: 'image/png', body: png(20000, 20000, 0) }, // ④ 픽셀 폭탄
  '/evil.svg': { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=\'SVG-RAN\'"><script>document.title=\'SVG-RAN\'</script><rect width="10" height="10"/></svg>') }, // ⑤
  '/br': { type: 'text/plain', enc: 'br', body: zlib.brotliCompressSync(text) }, // ⑥
};
for (const [p, f] of Object.entries(FIX)) log('fixture', { path: p, bytes: f.body.length });

const up = http.createServer((q, r) => {
  const f = FIX[q.url];
  if (!f) return void (r.statusCode = 404), r.end();
  r.writeHead(200, { 'Content-Type': f.type, ...(f.enc ? { 'Content-Encoding': f.enc } : {}), 'Content-Length': f.body.length });
  r.end(f.body);
});
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const U = up.address().port;
const echo = http.createServer((q, r) => (r.setHeader('content-type', 'text/plain'), r.end(JSON.stringify({ site: q.headers['sec-fetch-site'] ?? null }))));
await new Promise((r) => echo.listen(0, '127.0.0.1', r));

const store = createStore();
const dash = await startDashboard({ store, port: 0 });
const proxy = await startProxy({ port: 0, tunnel: true, dashboardPort: dash.port, ...attachStore(store) });
for (const p of Object.keys(FIX)) {
  await new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: proxy.port, path: `http://127.0.0.1:${U}${p}`, headers: { host: `127.0.0.1:${U}` }, agent: false }, (res) => (res.resume(), res.on('end', resolve)));
    q.on('error', reject);
    q.end();
  });
}
await sleep(300);
log('recorded', store.list().map((s) => [s.id, s.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), s.status, s.responseSize]));

const b = await launch();
log('browser', b.version);
const mem = () => {
  try {
    return Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process | ? { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${b.dir.split('\\').pop()}*' } | Measure-Object WorkingSetSize -Sum).Sum/1MB`]).toString().trim()));
  } catch {
    return -1;
  }
};
const problems = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') problems.push(['exception', m.params.exceptionDetails?.text]);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(['log', m.params.entry.text?.slice(0, 200)]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(['console', JSON.stringify(m.params.args?.map((a) => a.value)).slice(0, 200)]);
});
try {
  // E194 [탐색]: 브라우저가 연 탭(Target.createTarget)의 Sec-Fetch-Site
  const e = await page(b, `http://127.0.0.1:${echo.address().port}/`);
  log('E194-echo', await e.eval('document.body.innerText'));
  const t = await page(b, dash.url);
  await b.send('Log.enable', {}, t.s);
  await sleep(1500);
  const first = await t.eval('document.body.innerText.slice(0, 80)');
  log('E194-dashboard', first);
  if (/받지 않습니다/.test(first)) {
    await t.eval('location.reload()');
    await sleep(2000);
    log('E194-after-reload', await t.eval('document.body.innerText.slice(0, 40)'));
  }
  const open = async (p) =>
    t.eval(`(async()=>{const tr=[...document.querySelectorAll('tbody tr')].find(r=>r.children[2].textContent.endsWith(${JSON.stringify(p)}));if(!tr)return 'no-row';tr.click();await new Promise(r=>setTimeout(r,2500));const d=document.querySelector('.detail');return {buttons:[...d.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>b.textContent),notes:[...d.querySelectorAll('p.note')].map(n=>n.textContent).filter(Boolean).slice(-6),pre:(d.querySelectorAll('pre')[0]||{}).textContent?.slice(0,80)}})()`);
  log('①img.png', await open('/img.png'));
  log('①preview', await t.eval(`(async()=>{const b=[...document.querySelectorAll('.detail button')].find(x=>x.textContent==='이미지 미리보기'&&!x.hidden);if(!b)return 'no-button';b.click();await new Promise(r=>setTimeout(r,1000));const c=document.querySelector('.detail .preview canvas');return c?{w:c.width,h:c.height,label:document.querySelector('.detail .preview p').textContent}:'no-canvas'})()`));
  log('②gz', await open('/gz'));
  let m0 = mem();
  log('③gzbomb', await open('/gzbomb'));
  log('③mem', { before: m0, after: mem() });
  m0 = mem();
  log('④bomb.png', await open('/bomb.png'));
  log('④mem', { before: m0, after: mem() });
  log('⑤evil.svg', await open('/evil.svg'));
  log('⑥br', await open('/br'));
  log('⑦page', await t.eval(`({title:document.title,img:document.querySelectorAll('img').length,blob:document.querySelectorAll('[src^="blob:"],[href^="blob:"],[src^="data:"]').length,picker:typeof window.showSaveFilePicker})`));
  log('⑦problems', problems);
} finally {
  b.close();
  await sleep(500);
  try {
    fs.rmSync(b.dir, { recursive: true, force: true });
  } catch {}
  await proxy.close();
  await dash.close();
  up.close();
  echo.close();
}
