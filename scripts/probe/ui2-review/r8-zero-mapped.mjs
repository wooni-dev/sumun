// r8: 0.0.0.0의 IPv4-mapped 표기(::ffff:0.0.0.0)가 127.0.0.1 리스너에 닿는지, 지금의 isLoopTarget(자기 주소 판정)이 그것을 자기 주소로 보는지
import net from 'node:net';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
const { isLoopTarget } = await import(pathToFileURL(repo + '/src/tls/tunnel.ts').href);
const srv = net.createServer((s) => s.end());
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const p = srv.address().port;
for (const a of ['::ffff:0.0.0.0', '::ffff:0:0', '0.0.0.0', '::ffff:127.0.0.1', '::ffff:127.1.2.3', '::']) {
  const r = await new Promise((ok) => { const s = net.connect({ host: a, port: p }, () => (s.destroy(), ok('connected'))); s.setTimeout(1500, () => (s.destroy(), ok('timeout'))); s.on('error', (e) => ok('error ' + e.code)); });
  console.log(a.padEnd(20), '->', r.padEnd(22), 'isLoopTarget(self port)=', isLoopTarget([a], p, p));
}
for (const h of ['[::ffff:0.0.0.0]', '0x0', '00', '0.0', '[::ffff:0:0]']) { try { console.log('URL', h, '->', new URL(`http://${h}:${p}/`).hostname); } catch { console.log('URL', h, '-> 오류'); } }
srv.close();
