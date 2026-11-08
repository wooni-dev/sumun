// [UI-6 검토] 요구 3: #을 지운 페이지(http://127.0.0.1:P/)에 같은 주소 + #t=<새 토큰>으로 이동하면 페이지가 다시 로드되는지(스크립트가 새 토큰을 읽는지) 본다.
// 가짜 페이지 서버(127.0.0.1)만. 실행: node scripts/probe/ui6-review/fragment-nav.mjs
import http from 'node:http';
import { launch, page } from '../ui5b-review/cdp.mjs';

let loads = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/s.js')) return res.writeHead(200, { 'Content-Type': 'text/javascript' }), res.end("window.seen = location.hash; history.replaceState(null, '', location.pathname);");
  loads++;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html>ok<script src="/s.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const b = await launch();
const p = await page(b, 'about:blank');
await b.send('Page.enable', {}, p.s);
await b.send('Page.navigate', { url: `${base}#t=OLDTOKENxxxxxxxxxxxxxxxxxxxx` }, p.s);
await new Promise((r) => setTimeout(r, 1000));
console.log('1차:', await p.eval('JSON.stringify({ href: location.href, seen: window.seen })'), '문서 요청 수', loads);
await b.send('Page.navigate', { url: `${base}#t=NEWTOKENxxxxxxxxxxxxxxxxxxxx` }, p.s);
await new Promise((r) => setTimeout(r, 1000));
console.log('2차(같은 주소 + 새 #):', await p.eval('JSON.stringify({ href: location.href, seen: window.seen })'), '문서 요청 수', loads);
b.close();
server.close();
