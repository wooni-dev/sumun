// e5: e4의 W-a·W-d 보정. 가짜 서버(자식)가 listen 직후 이벤트 루프를 holdMs 동안 멈추고,
// 공격자 도우미(여기서는 부모)가 접속 40개로 backlog를 채운 뒤 startDashboard/startProxy를 부른다.
//  W-a  [::1]:Q 가짜 + backlog 참 → startDashboard({port:Q})
//  W-d  127.0.0.1:Q 가짜 + backlog 참 → startDashboard({port:Q}) (검사는 통과하지만 listen이 막는가 — 메시지로 구분)
//  W-e  127.0.0.1:P 가짜 + backlog 참 → startProxy({port:P})
// 실행: node e5-backlog-start.mjs
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SRC = 'D:/secretary/sumun/src';
const { startDashboard } = await import(pathToFileURL(`${SRC}/dashboard/server.ts`).href);
const { startProxy } = await import(pathToFileURL(`${SRC}/proxy/server.ts`).href);
const { createStore } = await import(pathToFileURL(`${SRC}/store/store.ts`).href);
const store = createStore();

const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P;
};
function fakeBlocked(host, port, holdMs) {
  const code = `const s=require('http').createServer((q,r)=>r.end('FAKE'));s.on('error',e=>console.log('ERR '+e.code));
    s.listen({port:${port},host:'${host}',backlog:1},()=>{console.log('READY');setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${holdMs}),20)});`;
  const ch = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => ch.stdout.once('data', (d) => r({ ch, msg: String(d).trim() })));
}
async function fill(host, port) {
  await new Promise((r) => setTimeout(r, 150)); // 자식이 멈출 때까지
  const held = [];
  let refused = 0;
  for (let i = 0; i < 45 && refused < 2; i++) {
    const r = await new Promise((resolve) => {
      const c = net.connect(port, host);
      c.once('connect', () => (held.push(c), resolve('c')));
      c.once('error', () => resolve('x'));
      c.setTimeout(500, () => (c.destroy(), resolve('t')));
    });
    if (r !== 'c') refused++;
  }
  return { held, n: held.length, refused };
}
const get = (host, port) =>
  new Promise((resolve) => {
    const q = http.get({ host, port, path: '/', agent: false, timeout: 3000 }, (s) => {
      let b = '';
      s.on('data', (c) => (b += c));
      s.on('end', () => resolve(`${s.statusCode} ${b.slice(0, 30).replace(/\s+/g, ' ')}`));
    });
    q.on('error', (e) => resolve(`오류 ${e.code}`));
    q.on('timeout', () => q.destroy(new Error('timeout')));
  });
const fetchLocalhost = async (port) => {
  try {
    const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) });
    return `${r.status} ${(await r.text()).slice(0, 30).replace(/\s+/g, ' ')}`;
  } catch (e) {
    return `오류 ${e.cause?.code ?? e.name}`;
  }
};

for (const [name, host, kind] of [
  ['W-a', '::1', 'dash'],
  ['W-d', '127.0.0.1', 'dash'],
  ['W-e', '127.0.0.1', 'proxy'],
  ['W-e6', '::1', 'proxy'],
]) {
  const Q = (await freePort()) + 50;
  const f = await fakeBlocked(host, Q, 3000);
  const fl = await fill(host, Q);
  let out;
  try {
    if (kind === 'dash') {
      const d = await startDashboard({ store, port: Q });
      out = `시작됨(127.0.0.1:${d.port})`;
      fl.held.forEach((c) => c.destroy());
      await new Promise((r) => setTimeout(r, 3500)); // 가짜가 깨어나 accept를 다시 할 때까지
      out += ` / 깨어난 뒤 http://[::1]:${Q} → ${await get('::1', Q)} / fetch localhost → ${await fetchLocalhost(Q)} / http://127.0.0.1:${Q} → ${await get('127.0.0.1', Q)}`;
      await d.close();
    } else {
      const p = await startProxy({ port: Q });
      out = `시작됨 ${JSON.stringify(p.address())}`;
      await p.close();
    }
  } catch (e) {
    out = `거부 code=${e.code} message="${String(e.message).slice(0, 50)}"`;
  }
  fl.held.forEach((c) => c.destroy());
  console.log(`${name} ${host}:${Q} 가짜(${f.msg}), backlog 채움(열린 접속 ${fl.n}, 거절 ${fl.refused}) → ${kind}: ${out}`);
  f.ch.kill();
}
process.exit(0);
