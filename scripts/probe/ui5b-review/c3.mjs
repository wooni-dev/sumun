// C7: 대시보드가 사용자 클릭으로 window.open(blob) / <a target=_blank href=blob> 할 때 — CSP 상속, opener로 토큰 읽기, 절대 주소 fetch
// C8: <a download> 파일 이름·확장자, Zone.Identifier(MOTW)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { launch, page } from './cdp.mjs';
const hits = [];
const CSP0 = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/beacon')) { hits.push(req.url + ' origin=' + req.headers.origin + ' sfs=' + req.headers['sec-fetch-site']); res.end('ok'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP0 });
  res.end('<!doctype html><title>dash</title><p>test</p>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const b = await launch();
const ev = async (p, expr) => { const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, p.s); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r); };
const evil = `<!doctype html><script>window.RAN=1;try{window.STOLE=opener&&opener.location.hash}catch(e){window.STOLE='blocked '+e.name}
fetch(location.origin+'/beacon?abs-fetch&stole='+encodeURIComponent(window.STOLE||'')).catch(()=>{})</script>`;
const p = await page(b, O + '/dash#t=SECRET_TOKEN_abcdefghijklmnopqrstuv');
for (const [name, code] of [
  ['window.open', `const w=window.open(u);`],
  ['window.open noopener', `const w=window.open(u,'_blank','noopener');`],
  ['a target=_blank (default rel)', `const a=document.createElement('a');a.href=u;a.target='_blank';document.body.append(a);a.click();`],
  ['a target=_blank rel=opener', `const a=document.createElement('a');a.href=u;a.target='_blank';a.rel='opener';document.body.append(a);a.click();`],
  ['location.assign (same tab)', null],
]) {
  if (!code) continue;
  const r = await ev(p, `new Promise(res=>{const u=URL.createObjectURL(new Blob([${JSON.stringify(evil)}],{type:'text/html'}));${code} setTimeout(()=>res('done'),1200)})`);
  await new Promise(r => setTimeout(r, 400));
  console.log(`C7 ${name}:`, r, 'hits', JSON.stringify(hits)); hits.length = 0;
}
// 같은 탭 이동: 대시보드 탭 자체가 blob 문서로 바뀜(뒤로 가기로 돌아오면 토큰은 history의 URL에 그대로)
const p2 = await page(b, O + '/dash#t=SECRET2');
await ev(p2, `location.assign(URL.createObjectURL(new Blob([${JSON.stringify(evil.replace('opener&&opener.location.hash', "'(history.length='+history.length+')'"))}],{type:'text/html'})));1`);
await new Promise(r => setTimeout(r, 1200));
console.log('C7 same-tab navigation hits', JSON.stringify(hits)); hits.length = 0;

// C8: 내려받기
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-ui5b-dl-'));
await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
const done = [];
b.on(d => { if (d.method === 'Browser.downloadWillBegin') done.push('begin:' + d.params.suggestedFilename); });
const p3 = await page(b, O + '/dash');
const cases = [
  ['body.bin', 'application/octet-stream', 'x'],
  ['body', 'text/html', '<script>alert(1)</script>'],
  ['body', 'image/svg+xml', '<svg/>'],
  ['body', 'application/x-msdownload', 'MZ'],
  ['..\\..\\evil.bat', 'application/octet-stream', 'calc'],
  ['report.pdf.exe', 'application/octet-stream', 'MZ'],
  ['evil.html', 'application/octet-stream', '<script>1</script>'],
  ['a\u202Etxt.exe', 'application/octet-stream', 'MZ'],
  ['photo.png', 'text/html', '<script>1</script>'],
  ['CON', 'application/octet-stream', 'x'],
  ['run.lnk', 'application/octet-stream', 'x'],
  ['x.url', 'application/octet-stream', '[InternetShortcut]\r\nURL=file:///C:/Windows/System32/calc.exe'],
  ['한글 이름.txt', 'text/plain', 'x'],
  ['', 'text/html', '<p>'],
];
for (const [n, t, body] of cases) {
  await ev(p3, `(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([${JSON.stringify(body)}],{type:${JSON.stringify(t)}}));a.download=${JSON.stringify(n)};document.body.append(a);a.click();return 1})()`);
  await new Promise(r => setTimeout(r, 700));
}
await new Promise(r => setTimeout(r, 1500));
console.log('C8 suggested names:', JSON.stringify(done));
console.log('C8 files on disk:', JSON.stringify(fs.readdirSync(dl)));
console.log('C8 dir', dl);
b.close(); srv.close();
