// E7, E8a, E12, E13: 실제 startProxy로 (인터넷 없음, 127.0.0.1 목적지)
import http from 'node:http';
import net from 'node:net';
const { startProxy } = await import('../../../src/proxy/server.ts');
const up = http.createServer((req, res) => { if (req.url === '/slow') setTimeout(() => res.end('late'), 300); else res.end('ok'); });
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const U = up.address().port;
const get = (p, path) => new Promise((resolve) => { const t = performance.now(); const r = http.request({ host: '127.0.0.1', port: p, path: `http://127.0.0.1:${U}${path}` }, (res) => { res.resume(); res.on('end', () => resolve(performance.now() - t)); }); r.on('error', () => resolve(-1)); r.end(); });
// E7 동기로 느린 구독자(400ms)가 다른 요청 중계를 막는가
{ const p = await startProxy({ port: 0, onFlow: () => { const e = Date.now() + 400; while (Date.now() < e); } });
  const base = await get(p.port, '/a');
  const t = await Promise.all([get(p.port, '/b'), new Promise((r) => setTimeout(r, 5)).then(() => get(p.port, '/c'))]);
  console.log('E7 느린 동기 구독자: 첫 요청 ms', base.toFixed(0), '/ 뒤따른 두 요청 ms', t.map((x) => x.toFixed(0)).join(', '));
  await p.close(); }
// E8a onFlowStart만 주면
{ const starts = [], ends = []; const p = await startProxy({ port: 0, onFlowStart: (s) => starts.push(s.id) });
  await get(p.port, '/a'); await new Promise((r) => setTimeout(r, 50));
  console.log('E8a onFlowStart만: 시작', starts.length, '끝', ends.length); await p.close(); }
// E12 두 프록시의 id
{ const ids = []; const a = await startProxy({ port: 0, onFlow: (f) => ids.push(['A', f.id]) }); const b = await startProxy({ port: 0, onFlow: (f) => ids.push(['B', f.id]) });
  await get(a.port, '/a'); await get(b.port, '/a'); await new Promise((r) => setTimeout(r, 50));
  console.log('E12 두 프록시 id', JSON.stringify(ids)); await a.close(); await b.close(); }
// E13 close 뒤에 기록이 오는가 + 진행 중 요청의 기록
{ const ev = []; let closed = false; const p = await startProxy({ port: 0, onFlowStart: (s) => ev.push(`start${s.id}${closed ? '(close 뒤)' : ''}`), onFlow: (f) => ev.push(`flow${f.id}:${f.error?.code ?? 'ok'}${closed ? '(close 뒤)' : ''}`) });
  get(p.port, '/slow'); await new Promise((r) => setTimeout(r, 100));
  await p.close(); closed = true; await new Promise((r) => setTimeout(r, 50));
  console.log('E13 close 중 진행 요청:', ev.join(' ')); }
// E14 시작 → 끝 순서, 구독자가 시작에서 throw하면
{ const ev = []; const p = await startProxy({ port: 0, onFlowStart: (s) => { if (s.id === 1) throw new Error('x'); ev.push('s' + s.id); }, onFlow: (f) => ev.push('f' + f.id) });
  await Promise.all([get(p.port, '/a'), get(p.port, '/a'), get(p.port, '/a')]); await new Promise((r) => setTimeout(r, 50));
  console.log('E14 시작 구독자가 id1에서 throw:', ev.join(' ')); await p.close(); }
// E15 응답 없는 기록의 모양: 400(origin-form), 502(닫힌 포트)
{ const fl = []; const p = await startProxy({ port: 0, onFlow: (f) => fl.push(f) });
  await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: p.port, path: '/x' }, (res) => { res.resume(); res.on('end', resolve); }); r.end(); });
  const closedPort = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: p.port, path: `http://127.0.0.1:${closedPort}/` }, (res) => { res.resume(); res.on('end', resolve); }); r.end(); });
  await new Promise((r) => setTimeout(r, 50));
  for (const f of fl) console.log('E15', f.request.url, 'target', JSON.stringify(f.request.target), 'response', f.response, 'error', JSON.stringify(f.error));
  await p.close(); }
up.close();
