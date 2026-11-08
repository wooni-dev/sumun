// C11: Chrome의 DecompressionStream — 조각 크기, 상한에서 멈추기, 잘림·뒤 찌꺼기·여러 멤버·raw deflate, 1MiB gzip 폭탄 / Node: Content-Disposition 헤더 주입
import http from 'node:http'; import zlib from 'node:zlib';
import { launch } from './cdp.mjs';
const text = Buffer.from('hello world '.repeat(1000));
const gz = zlib.gzipSync(text);
const bomb = zlib.gzipSync(Buffer.alloc(1024 * 1024 * 1024), { level: 9 }); // 1GiB zeros
console.log('1GiB zeros gzip size', bomb.length, '(1MiB 이하?', bomb.length <= 1 << 20, ')');
const nested = zlib.gzipSync(zlib.gzipSync(Buffer.alloc(1024 * 1024 * 1024), { level: 9 }), { level: 9 });
console.log('gzip(gzip(1GiB)) size', nested.length);
const bodies = {
  ok: gz, truncated: gz.subarray(0, gz.length - 10), trailing: Buffer.concat([gz, Buffer.from('<script>')]), twoMembers: Buffer.concat([gz, gz]),
  rawAsDeflate: zlib.deflateRawSync(text), bomb, nested, brotli: zlib.brotliCompressSync(text), zstdMagic: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0]),
};
const srv = http.createServer((req, res) => { const k = req.url.slice(1); if (bodies[k]) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(bodies[k]); } res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'" }); res.end('<p>x'); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const b = await launch();
const t = await b.send('Target.createTarget', { url: O + '/' }); await new Promise(r => setTimeout(r, 900));
const s = (await b.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
const ev = async (e) => (await b.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
const run = (k, fmt, limit = 1e18) => ev(`(async()=>{const buf=await (await fetch('/${k}')).arrayBuffer();const r=new Blob([buf]).stream().pipeThrough(new DecompressionStream('${fmt}')).getReader();let n=0,c=0,max=0;const t0=performance.now();try{for(;;){const {value,done}=await r.read();if(done)break;n+=value.length;c++;max=Math.max(max,value.length);if(n>${limit}){await r.cancel();return JSON.stringify({stopped:true,n,c,max,ms:Math.round(performance.now()-t0)})}}return JSON.stringify({ok:true,n,c,max,ms:Math.round(performance.now()-t0)})}catch(e){return JSON.stringify({err:e.name+': '+e.message.slice(0,70),n,c,max})}})()`);
for (const [k, f] of [['ok', 'gzip'], ['truncated', 'gzip'], ['trailing', 'gzip'], ['twoMembers', 'gzip'], ['rawAsDeflate', 'deflate'], ['rawAsDeflate', 'deflate-raw'], ['ok', 'deflate'], ['brotli', 'gzip']]) console.log(`C11 ${k} as ${f}:`, await run(k, f));
console.log('C11 1GiB bomb, 10MiB limit:', await run('bomb', 'gzip', 10 * 1024 * 1024));
console.log('C11 1GiB bomb, no limit (count only):', await Promise.race([run('bomb', 'gzip'), new Promise(r => setTimeout(() => r('60초 초과'), 60000))]));
console.log('C11 nested, first layer only:', await run('nested', 'gzip'));
// 한 번에 모으면(new Response(stream).arrayBuffer()) 상한 검사 기회가 없다
console.log('C11 bomb via Response.arrayBuffer():', await Promise.race([ev(`(async()=>{const buf=await (await fetch('/bomb')).arrayBuffer();const t0=performance.now();try{const a=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return 'got '+a.byteLength+' '+Math.round(performance.now()-t0)+'ms'}catch(e){return e.name+' '+e.message}})()`), new Promise(r => setTimeout(() => r('60초 초과'), 60000))]));
b.close(); srv.close();
// Node: 기록에서 온 파일 이름을 Content-Disposition에 넣으면
for (const name of ['a"; filename*=UTF-8\'\'evil.html', 'a\r\nSet-Cookie: x=1', '한글.png', 'a‮gnp.exe']) {
  const res = new http.ServerResponse(new http.IncomingMessage(null));
  try { res.setHeader('Content-Disposition', `attachment; filename="${name}"`); console.log('N2 setHeader ok:', JSON.stringify(res.getHeader('Content-Disposition'))); } catch (e) { console.log('N2 setHeader throws', e.code, JSON.stringify(name)); }
}
process.exit(0);
