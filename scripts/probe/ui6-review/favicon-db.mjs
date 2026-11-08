// [UI-6 검토] 요구 3·4: <link rel=icon>이 있는 페이지를 #t=<토큰>으로 열고 replaceState로 지웠을 때, Chrome Favicons DB 등에 토큰 주소가 남는지 본다.
// 가짜 페이지 서버(127.0.0.1)만 쓴다. 임시 Chrome 프로필은 끝나면 지운다. 실행: node scripts/probe/ui6-review/favicon-db.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, page } from '../ui5b-review/cdp.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/icon.png')) return res.writeHead(200, { 'Content-Type': 'image/png' }), res.end(PNG);
  if (req.url.startsWith('/s.js')) return res.writeHead(200, { 'Content-Type': 'text/javascript' }), res.end("history.replaceState(null, '', location.pathname);");
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><link rel="icon" href="/icon.png"><title>t</title>ok<script src="/s.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const tok = `FAVTOKEN${'y'.repeat(30)}`;
const b = await launch();
const p = await page(b, 'about:blank');
await b.send('Page.enable', {}, p.s);
await b.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/#t=${tok}` }, p.s);
await new Promise((r) => setTimeout(r, 2500));
console.log('href =', await p.eval('location.href'));
await b.send('Browser.close');
await new Promise((r) => setTimeout(r, 3000));
const found = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else { try { if (fs.readFileSync(q).includes(Buffer.from(tok))) found.push(path.relative(b.dir, q)); } catch {} } } };
walk(b.dir);
console.log('토큰이 남은 파일:', found);
fs.rmSync(b.dir, { recursive: true, force: true });
server.close();
