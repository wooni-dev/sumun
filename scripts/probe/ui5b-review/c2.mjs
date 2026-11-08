// C5: 대시보드(CSP 있음)가 만든 blob: 문서를 최상위로 열 때 스크립트가 도는가, CSP가 따라오는가, 대시보드 탭의 데이터에 닿는가
import http from 'node:http';
import { launch, page } from './cdp.mjs';
const hits = [];
const CSP0 = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/beacon')) { hits.push(req.url); res.end('ok'); return; }
  if (req.url.startsWith('/nocsp')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><p>nocsp</p>'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP0 });
  res.end('<!doctype html><title>dash</title><p>test</p>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const b = await launch();
const violations = [];
b.on(d => { if (d.method === 'Runtime.consoleAPICalled' || d.method === 'Runtime.exceptionThrown') violations.push(JSON.stringify(d.params).slice(0, 200)); });
const blobOf = (body, type) => `URL.createObjectURL(new Blob([${JSON.stringify(body)}],{type:${JSON.stringify(type)}}))`;
const html = `<!doctype html><script>window.RAN_INLINE=1;fetch('/beacon?inline')</script><img src=x onerror="window.RAN_ATTR=1">`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="window.RAN_ATTR=1"><script>window.RAN_INLINE=1</script></svg>`;
for (const origin of ['/dash', '/nocsp']) {
  const p = await page(b, O + origin);
  await p.eval(`window.SECRET='token-in-dashboard-tab'; 1`);
  for (const [name, body, type] of [['html', html, 'text/html'], ['svg', svg, 'image/svg+xml']]) {
    const url = await p.eval(blobOf(body, type));
    const t = await page(b, url);
    await b.send('Log.enable', {}, t.s);
    const info = await t.eval(`JSON.stringify({origin:location.origin,inline:!!window.RAN_INLINE,attr:!!window.RAN_ATTR,
      evalAllowed:(()=>{try{return eval('1')===1}catch(e){return e.name}})(),
      canFetchSameOrigin:'pending'})`);
    const f = await t.eval(`fetch('/beacon?from-blob-doc-'+${JSON.stringify(name)}).then(r=>r.status).catch(e=>e.name)`);
    console.log(`C5 creator=${origin} ${name}:`, info, 'devtools-fetch:', f);
  }
  await new Promise(r => setTimeout(r, 300));
  console.log('  hits', JSON.stringify(hits)); hits.length = 0;
}
// C6: 사용자가 "이미지를 새 탭에서 열기"를 하면 blob의 type대로 열린다. type을 기록의 Content-Type에서 가져오면? (type=text/html, 바이트는 HTML)
// → 위 C5의 html 경우와 같다. 대시보드 탭의 SECRET은 다른 탭에서 직접 읽히지 않음(opener 없음)을 확인
const p = await page(b, O + '/dash');
await p.eval(`window.SECRET='tok'; window.name='dashwin'; 1`);
const url = await p.eval(blobOf('<!doctype html><p>x</p>', 'text/html'));
const t = await page(b, url);
console.log('C6 newtab blob: opener', await t.eval(`String(window.opener)`), 'open by name:', await t.eval(`(()=>{try{const w=window.open('','dashwin');return w&&w.SECRET?'READ '+w.SECRET:'no access ('+(w?w.location.href:'null')+')'}catch(e){return e.name}})()`));
console.log('console/exception events (first 6):', violations.slice(0, 6));
b.close(); srv.close();
