// [UI-6 검토] 요구 6: 어떤 진입 경로가 대시보드 403이 되는지, 그때 Chrome이 보낸 Sec-Fetch-Site와 403 뒤 주소창(#t= 남는지)을 본다.
// 실제 startDashboard(빈 저장소, 127.0.0.1:0)와 링크를 가진 가짜 페이지 서버(127.0.0.1)만 쓴다. 끝나면 모두 닫는다.
// 실행: node scripts/probe/ui6-review/entry-403.mjs
import http from 'node:http';
import { createStore } from '../../../src/store/store.ts';
import { startDashboard } from '../../../src/dashboard/server.ts';
import { launch, page } from '../ui5b-review/cdp.mjs';

const dash = await startDashboard({ store: createStore(), port: 0 });
const link = (href, extra = '') => `<!doctype html><a id="l" href="${href}" ${extra}>go</a>`;
const other = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const href = u.searchParams.get('to');
  if (u.pathname === '/redirect') return res.writeHead(302, { Location: href }), res.end();
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(link(href, u.searchParams.get('x') ?? ''));
});
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const O = other.address().port;
const D = dash.port;
const tokUrl = (host) => `http://${host}:${D}/#t=${dash.token}`;
const b = await launch();
const sites = [];
const docIds = new Set();
b.on((d) => {
  if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes(`:${D}/`) && d.params.type === 'Document') docIds.add(d.params.requestId);
  if (d.method === 'Network.requestWillBeSentExtraInfo' && docIds.has(d.params.requestId)) sites.push(d.params.headers['Sec-Fetch-Site'] ?? d.params.headers['sec-fetch-site'] ?? '(없음)');
});

async function viaClick(name, from) {
  sites.length = 0;
  const p = await page(b, 'about:blank');
  await b.send('Network.enable', {}, p.s);
  await b.send('Page.navigate', { url: from }, p.s);
  await new Promise((r) => setTimeout(r, 700));
  await p.eval(`document.getElementById('l') && document.getElementById('l').click()`);
  await new Promise((r) => setTimeout(r, 1200));
  const text = String(await p.eval('document.body ? document.body.innerText.slice(0, 40) : ""'));
  const href = String(await p.eval('location.href')).replace(dash.token, '<토큰>');
  console.log(`${name}: Sec-Fetch-Site=${sites.join(',')} → 화면="${text.replace(/\n/g, ' ')}" 주소=${href}`);
}
await viaClick('직접 열기(주소창 입력에 해당)', tokUrl('127.0.0.1'));
await viaClick('다른 포트(127.0.0.1:O)의 링크', `http://127.0.0.1:${O}/?to=${encodeURIComponent(tokUrl('127.0.0.1'))}`);
await viaClick('localhost:O의 링크 → 127.0.0.1:D', `http://localhost:${O}/?to=${encodeURIComponent(tokUrl('127.0.0.1'))}`);
await viaClick('다른 포트의 링크(rel=noreferrer, target=_self)', `http://127.0.0.1:${O}/?to=${encodeURIComponent(tokUrl('127.0.0.1'))}&x=rel%3Dnoreferrer`);
await viaClick('다른 포트의 302 리다이렉트', `http://127.0.0.1:${O}/redirect?to=${encodeURIComponent(tokUrl('127.0.0.1'))}`);
await viaClick('localhost:D로 직접', tokUrl('localhost'));
b.close();
await dash.close();
other.close();
