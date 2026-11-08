// C7 다시: 대시보드 페이지가 연 blob 창 안에서 스크립트가 돌았는지 새 대상에 붙어 직접 본다
// C9: 내려받기 MOTW ReferrerUrl에 #t=토큰이 남는가(Referrer-Policy 있음/없음)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';
const CSP0 = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const hits = [];
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/beacon')) { hits.push(req.url); return res.end('ok'); }
  const h = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP0 };
  if (req.url.startsWith('/rp')) h['Referrer-Policy'] = 'no-referrer';
  res.writeHead(200, h); res.end('<!doctype html><title>dash</title><p>test</p>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const b = await launch();
await b.send('Target.setDiscoverTargets', { discover: true });
const created = [];
b.on(d => { if (d.method === 'Target.targetCreated' && d.params.targetInfo.url.startsWith('blob:')) created.push(d.params.targetInfo.targetId); });
async function attach(targetId) {
  const a = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const s = a.result.sessionId;
  return async (expr, gesture = false) => { const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gesture }, s); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r); };
}
async function open(url) { const t = await b.send('Target.createTarget', { url }); await new Promise(r => setTimeout(r, 900)); return { id: t.result.targetId, ev: await attach(t.result.targetId) }; }
const evil = `<!doctype html><script>window.RAN=1;try{window.STOLE=opener?opener.location.hash:'no-opener'}catch(e){window.STOLE='blocked '+e.name}</script><img src=x onerror="window.ATTR=1">`;
const seen = new Set();
const dash = await open(O + '/dash#t=SECRET_TOKEN_abcdefghijklmnopqrstuv');
for (const [name, code] of [
  ['window.open(u)', `window.open(u)`],
  ['window.open(u,_blank,noopener)', `window.open(u,'_blank','noopener')`],
  ['<a target=_blank> (암묵 noopener)', `(()=>{const a=document.createElement('a');a.href=u;a.target='_blank';document.body.append(a);a.click()})()`],
  ['<a target=_blank rel=opener>', `(()=>{const a=document.createElement('a');a.href=u;a.target='_blank';a.rel='opener';document.body.append(a);a.click()})()`],
]) {
  created.length = 0;
  await dash.ev(`(()=>{const u=URL.createObjectURL(new Blob([${JSON.stringify(evil)}],{type:'text/html'}));${code};return 1})()`, true);
  await new Promise(r => setTimeout(r, 1200));
  const tg = (await b.send("Target.getTargets")).result.targetInfos.filter(t => t.url.startsWith("blob:") && !seen.has(t.targetId)); tg.forEach(t => seen.add(t.targetId)); created.splice(0, 9, ...tg.map(t => t.targetId));
  if (!created.length) { console.log(`C7 ${name}: 새 창 없음`); continue; }
  const ev = await attach(created[0]);
  console.log(`C7 ${name}:`, await ev(`JSON.stringify({origin:location.origin,RAN:!!window.RAN,ATTR:!!window.ATTR,STOLE:window.STOLE||null})`));
}
b.close(); srv.close(); process.exit(0);
// C9
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-ui5b-dl2-'));
await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
for (const p of ['/dash#t=TOKEN_NO_RP_abcdefghijklmnop', '/rp#t=TOKEN_WITH_RP_abcdefghijklm']) {
  const t = await open(O + p);
  await t.ev(`(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['x'],{type:'application/octet-stream'}));a.download=${JSON.stringify(p.slice(1, 5) + '.bin')};document.body.append(a);a.click();return 1})()`, true);
  await new Promise(r => setTimeout(r, 1500));
}
for (const f of fs.readdirSync(dl)) {
  let z; try { z = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Content -LiteralPath '${path.join(dl, f)}' -Stream Zone.Identifier) -join ' | '`]).toString().trim(); } catch { z = '(없음)'; }
  console.log('C9', f, '=>', z);
}
b.close(); srv.close();
