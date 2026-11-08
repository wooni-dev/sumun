// C1~C4: Chrome에서 압축 형식, CSP와 blob/data 이미지, blob URL 최상위 열기(새 탭)
import http from 'node:http';
import { launch, page } from './cdp.mjs';
const hits = [];
const CSP0 = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const CSP1 = "default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/beacon')) { hits.push(req.url); res.end('ok'); return; }
  const csp = req.url.startsWith('/p1') ? CSP1 : CSP0;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' });
  res.end('<!doctype html><title>t</title><p>test</p>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const b = await launch(); console.log('browser', b.version);
const p0 = await page(b, O + '/p0');
console.log('C1 formats', await p0.eval(`JSON.stringify(['gzip','deflate','deflate-raw','brotli','br','zstd','x-gzip'].map(f=>{try{new DecompressionStream(f);return f+':OK'}catch(e){return f+':NO'}}))`));
const png1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imgTest = (src) => `new Promise(r=>{const v=[];document.addEventListener('securitypolicyviolation',e=>v.push(e.violatedDirective+' '+e.blockedURI.slice(0,10)),{once:true});const i=new Image();i.onload=()=>setTimeout(()=>r('load '+i.naturalWidth+' '+v),50);i.onerror=()=>setTimeout(()=>r('error '+v),50);i.src=${src};document.body.append(i)})`;
const pngBytes = `Uint8Array.from(atob('${png1}'),c=>c.charCodeAt(0))`;
const blobPng = (type) => `URL.createObjectURL(new Blob([${pngBytes}],{type:'${type}'}))`;
console.log('C2 CSP0 img blob:png', await p0.eval(imgTest(blobPng('image/png'))));
console.log('C2 CSP0 img data:png', await p0.eval(imgTest(`'data:image/png;base64,${png1}'`)));
console.log('C2 CSP0 createImageBitmap(blob)+canvas', await p0.eval(`(async()=>{const bm=await createImageBitmap(new Blob([${pngBytes}]));const c=document.createElement('canvas');c.width=bm.width;c.getContext('2d').drawImage(bm,0,0);document.body.append(c);return 'bitmap '+bm.width+'x'+bm.height})()`));
const p1 = await page(b, O + '/p1');
console.log('C3 CSP1 img blob:png', await p1.eval(imgTest(blobPng('image/png'))));
console.log('C3 CSP1 img data:png', await p1.eval(imgTest(`'data:image/png;base64,${png1}'`)));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="fetch('/beacon?svg-onload')"><script>fetch('/beacon?svg-script')</script><image href="${O}/beacon?svg-image-ext" width="5" height="5"/><rect width="10" height="10" fill="red"/></svg>`;
const blobOf = (body, type) => `URL.createObjectURL(new Blob([${JSON.stringify(body)}],{type:${JSON.stringify(type)}}))`;
console.log('C3 CSP1 img blob svg(image/svg+xml)', await p1.eval(imgTest(blobOf(svg, 'image/svg+xml'))));
console.log('C3 CSP1 img blob svg bytes typed image/png', await p1.eval(imgTest(blobOf(svg, 'image/png'))));
console.log('C3 CSP1 img blob svg bytes typed ""', await p1.eval(imgTest(blobOf(svg, ''))));
console.log('C3 CSP1 img blob png bytes typed image/gif', await p1.eval(imgTest(blobPng('image/gif'))));
console.log('C3 CSP1 img blob png bytes typed text/html', await p1.eval(imgTest(blobPng('text/html'))));
console.log('C3 CSP1 img blob png bytes typed ""', await p1.eval(imgTest(blobPng(''))));
await new Promise(r => setTimeout(r, 500));
console.log('hits after img tests', JSON.stringify(hits)); hits.length = 0;
const html = `<!doctype html><p id=x>h</p><script>fetch('/beacon?html-inline');document.title='RAN'</script><img src=x onerror="fetch('/beacon?html-onerror')">`;
for (const [name, body, type] of [['svg image/svg+xml', svg, 'image/svg+xml'], ['html text/html', html, 'text/html'], ['html typed ""', html, ''], ['html typed image/png', html, 'image/png'], ['svg typed application/octet-stream', svg, 'application/octet-stream'], ['html typed text/plain', html, 'text/plain']]) {
  for (const csp of ['p0', 'p1']) {
    const pg = csp === 'p0' ? p0 : p1;
    const url = await pg.eval(blobOf(body, type));
    const t = await page(b, url);
    const info = await t.eval(`JSON.stringify({origin:location.origin,title:document.title,ct:document.contentType,ls:(()=>{try{localStorage.setItem('k','v');return 'ok'}catch(e){return e.name}})()})`);
    console.log(`C4 newtab ${csp} ${name}:`, info, 'hits', JSON.stringify(hits)); hits.length = 0;
    await b.send('Target.closeTarget', { targetId: t.targetId });
  }
}
// C4b: 페이지가 window.open(blob) — opener 있음
const r = await p1.eval(`new Promise(r=>{window.SECRET='tok123';const u=${blobOf(html, 'text/html')};const w=window.open(u);setTimeout(()=>{try{r('opened title='+(w?w.document.title+' origin='+w.location.origin+' childReadsOpener='+w.eval('opener.SECRET'):'null'))}catch(e){r('err '+e.name+' '+e.message)}},900)})`);
console.log('C4b window.open blob html from CSP1 page:', r, 'hits', JSON.stringify(hits)); hits.length = 0;
// C4c: 같은 출처의 다른 탭(이름 없이 열린 blob 문서)이 대시보드 탭을 찾을 수 있는가 — BroadcastChannel/열린 창 이름
b.close(); srv.close();
