// C10: 픽셀 폭탄 — 1MiB 안의 PNG가 30000x30000(디코딩 시 RGBA 3.6GB)일 때 img·createImageBitmap 동작, 시간, Chrome 메모리
import http from 'node:http'; import zlib from 'node:zlib'; import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; // gray 8bit
  const row = Buffer.alloc(w + 1); const raw = Buffer.alloc((w + 1) * h); // all zero
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [[20000, 20000], [30000, 30000]];
const imgs = sizes.map(([w, h]) => png(w, h));
imgs.forEach((b, i) => console.log(`PNG ${sizes[i].join('x')}: ${b.length} bytes (기록 상한 1MiB=${1 << 20} 이하? ${b.length <= 1 << 20})`));
const CSP1 = "default-src 'self'; img-src 'self' blob:";
const srv = http.createServer((req, res) => {
  const m = req.url.match(/^\/png(\d)/); if (m) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(imgs[+m[1]]); }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP1 }); res.end('<!doctype html><p>x</p>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const mem = (pid) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process | ? { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*sumun-ui5b-chrome-*' } | Measure-Object WorkingSetSize -Sum).Sum/1MB`]).toString().trim(); } catch { return '?'; } };
const b = await launch();
const t = await b.send('Target.createTarget', { url: O + '/' }); await new Promise(r => setTimeout(r, 900));
const s = (await b.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
const ev = async (e) => (await b.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
console.log('chrome MB 시작', mem());
for (let i = 0; i < imgs.length; i++) {
  for (const how of ['img', 'bitmap']) {
    const expr = how === 'img'
      ? `(async()=>{const buf=await (await fetch('/png${i}')).arrayBuffer();const u=URL.createObjectURL(new Blob([buf],{type:'image/png'}));const im=new Image();im.style.width='300px';im.src=u;document.body.append(im);const t0=performance.now();try{await im.decode();return 'decode ok '+im.naturalWidth+'x'+im.naturalHeight+' '+Math.round(performance.now()-t0)+'ms'}catch(e){return 'decode fail '+e.name+' '+Math.round(performance.now()-t0)+'ms'}})()`
      : `(async()=>{const buf=await (await fetch('/png${i}')).arrayBuffer();const t0=performance.now();try{const bm=await createImageBitmap(new Blob([buf]));return 'bitmap ok '+bm.width+'x'+bm.height+' '+Math.round(performance.now()-t0)+'ms'}catch(e){return 'bitmap fail '+e.name+' '+e.message.slice(0,60)+' '+Math.round(performance.now()-t0)+'ms'}})()`;
    const r = await Promise.race([ev(expr), new Promise(r => setTimeout(() => r('60초 안에 끝나지 않음'), 60000))]);
    console.log(`C10 ${sizes[i].join('x')} ${how}:`, r, '| chrome MB', mem());
  }
}
b.close(); srv.close(); process.exit(0);
