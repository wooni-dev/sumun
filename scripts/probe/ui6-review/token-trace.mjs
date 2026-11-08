// [UI-6 검토] 요구 3·4: 주소의 #t=<토큰>을 지우는 여러 방식 뒤에 토큰이 어디에 남는지, favicon 요청·CSP 오류가 나는지 본다.
// 가짜 페이지 서버(127.0.0.1)만 쓴다. 실제 대시보드·저장소는 쓰지 않는다. Chrome 프로필은 임시 폴더(끝나면 지운다).
// 실행: node scripts/probe/ui6-review/token-trace.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, page } from '../ui5b-review/cdp.mjs';

const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const variants = {
  // A: replaceState로 # 지우기
  a: `history.replaceState(null, '', location.pathname + location.search);`,
  // B: location.hash = '' (새 기록 항목이 생기는지)
  b: `location.hash = '';`,
  // C: replaceState에 토큰을 state로 보관(브라우저 저장소 우회 사례)
  c: `history.replaceState({ t: location.hash.slice(3) }, '', location.pathname);`,
  // D: window.name에 보관
  d: `window.name = location.hash.slice(3); history.replaceState(null, '', location.pathname);`,
  // N: 아무것도 안 함(대조군)
  n: ``,
};
const favicon = { f1: '', f2: '<link rel="icon" href="data:,">', f3: '<link rel="icon" href="/icon.svg">' };
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  const u = new URL(req.url, 'http://x');
  const h = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (u.pathname === '/icon.svg') return res.writeHead(200, { ...h, 'Content-Type': 'image/svg+xml' }), res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  if (u.pathname === '/s.js') return res.writeHead(200, { ...h, 'Content-Type': 'text/javascript' }), res.end(variants[u.searchParams.get('v')] ?? '');
  if (u.pathname.startsWith('/p')) {
    const v = u.searchParams.get('v'), f = u.searchParams.get('f') ?? 'f1';
    return res.writeHead(200, { ...h, 'Content-Type': 'text/html; charset=utf-8' }), res.end(`<!doctype html><html><head><meta charset="utf-8">${favicon[f]}<title>t</title></head><body>ok<script src="/s.js?v=${v}"></script></body></html>`);
  }
  res.writeHead(404, h); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const b = await launch();
const logs = [];
b.on((d) => {
  if (d.method === 'Log.entryAdded') logs.push(`${d.params.entry.level}: ${d.params.entry.text}`.slice(0, 160));
  if (d.method === 'Runtime.consoleAPICalled') logs.push(`console.${d.params.type}`);
});
const tokens = {};
for (const v of Object.keys(variants)) {
  const tok = `TOKEN${v.toUpperCase()}${'x'.repeat(30)}`;
  tokens[v] = tok;
  const p = await page(b, 'about:blank');
  await b.send('Log.enable', {}, p.s);
  await b.send('Page.enable', {}, p.s);
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/p${v}?v=${v}#t=${tok}` }, p.s);
  await new Promise((r) => setTimeout(r, 1200));
  const info = await p.eval(`JSON.stringify({ href: location.href, len: history.length, state: history.state, name: window.name, navEntries: (window.navigation ? navigation.entries().map(e => e.url) : null) })`);
  const hist = await b.send('Page.getNavigationHistory', {}, p.s);
  const entries = hist.result.entries.map((e) => `${e.url}${e.originalURL && e.originalURL !== e.url ? ` (original ${e.originalURL})` : ''}`);
  console.log(`[${v}] page=${info}`);
  console.log(`[${v}] CDP 기록 항목=${JSON.stringify(entries)}`);
  if (v === 'b' && hist.result.currentIndex > 0) {
    await b.send('Page.navigateToHistoryEntry', { entryId: hist.result.entries[hist.result.currentIndex - 1].id }, p.s);
    await new Promise((r) => setTimeout(r, 800));
    console.log(`[b] 뒤로 간 뒤 href=${await p.eval('location.href')}`);
  }
}
// favicon: 각 변형을 새 탭으로 열고 /favicon.ico 요청·CSP 오류를 본다
for (const f of Object.keys(favicon)) {
  hits.length = 0; logs.length = 0;
  const p = await page(b, 'about:blank');
  await b.send('Log.enable', {}, p.s);
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/pfav?v=n&f=${f}` }, p.s);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`[favicon ${f}: ${favicon[f] || '(link 없음)'}] 서버가 받은 경로=${JSON.stringify(hits)} 로그=${JSON.stringify(logs)}`);
}
// 정상 종료해서 프로필을 디스크에 쓰게 한 뒤 토큰 문자열을 찾는다
await b.send('Browser.close');
await new Promise((r) => setTimeout(r, 3000));
const found = {};
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      let buf;
      try { buf = fs.readFileSync(p); } catch { continue; }
      for (const [v, t] of Object.entries(tokens)) {
        if (buf.includes(Buffer.from(t, 'latin1')) || buf.includes(Buffer.from(t, 'utf16le'))) (found[v] ??= []).push(path.relative(b.dir, p));
      }
    }
  }
};
walk(b.dir);
console.log('프로필에서 토큰이 발견된 파일:', JSON.stringify(found, null, 1));
fs.rmSync(b.dir, { recursive: true, force: true });
server.close();
