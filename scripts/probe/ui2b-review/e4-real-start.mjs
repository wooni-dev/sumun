// e4: 실제 startDashboard / startProxy(저장소 src, 수정 없이 import)로 놓침 사례를 끝까지 확인한다.
//  W-a  다른 프로세스가 [::1]:Q를 잡았는데 backlog를 스스로 채워 둠 → startDashboard({port:Q}) 시작되는가, 그 뒤 localhost:Q는 누가 답하나
//  W-b  startDashboard({port:Q}) 시작 "뒤에" 다른 프로세스가 [::1]:Q listen → 되는가, localhost:Q는 누가 답하나
//  W-c  다른 프로세스가 [::1]:P를 잡은 상태에서 startProxy({port:P}) → 시작되는가(프록시 검사는 127.0.0.1만 본다)
//  W-d  다른 프로세스가 127.0.0.1:Q를 잡고 backlog를 채움 → 검사는 통과, listen은?
//  Z-x  다른 연결의 "나가는 쪽 로컬 포트"로만 쓰이는 X(듣는 사람 없음) → 검사는 비어 있다고 보고 listen은?
// 실행: node e4-real-start.mjs
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SRC = 'D:/secretary/sumun/src';
const { startDashboard } = await import(pathToFileURL(`${SRC}/dashboard/server.ts`).href);
const { startProxy } = await import(pathToFileURL(`${SRC}/proxy/server.ts`).href);
const { createStore } = await import(pathToFileURL(`${SRC}/store/store.ts`).href);

const freePort = async (host) => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, host, r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P;
};
// 가짜 서버(자식 프로세스): host:port에서 듣고 'FAKE'로 답한다. fill=true면 자기 backlog를 스스로 채운 채 holdMs 동안 accept를 멈췄다가 다시 받는다
function fake(host, port, { fill = false, holdMs = 0 } = {}) {
  const code = `
    const net=require('net'),http=require('http');
    const s=http.createServer((q,r)=>r.end('FAKE'));
    s.on('error',e=>{console.log('ERR '+e.code)});
    s.listen({port:${port},host:'${host}',backlog:1},async()=>{
      if(${fill}){
        // 자기 자신에게 접속을 쌓아 backlog를 채운 뒤 이벤트 루프를 멈춘다(그동안 커널이 새 SYN을 거절)
        for(let i=0;i<40;i++){const c=net.connect(${port},'${host}');c.on('error',()=>{});}
        setTimeout(()=>{console.log('READY');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${holdMs});},200);
      } else console.log('READY');
    });`;
  const ch = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => ch.stdout.once('data', (d) => r({ ch, msg: String(d).trim() })));
}
const get = (host, port) =>
  new Promise((resolve) => {
    const q = http.get({ host, port, path: '/', agent: false, timeout: 3000 }, (s) => {
      let b = '';
      s.on('data', (c) => (b += c));
      s.on('end', () => resolve(`${s.statusCode} ${b.slice(0, 40).replace(/\s+/g, ' ')}`));
    });
    q.on('error', (e) => resolve(`오류 ${e.code}`));
    q.on('timeout', () => q.destroy(new Error('timeout')));
  });
const viaLocalhostFetch = async (port) => {
  try {
    const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) });
    return `${r.status} ${(await r.text()).slice(0, 40).replace(/\s+/g, ' ')}`;
  } catch (e) {
    return `오류 ${e.cause?.code ?? e.name}`;
  }
};
const store = createStore();

// W-a
{
  const Q = (await freePort('127.0.0.1')) + 50;
  const f = await fake('::1', Q, { fill: true, holdMs: 1500 });
  let out;
  try {
    const d = await startDashboard({ store, port: Q });
    out = `시작됨(port ${d.port})`;
    await new Promise((r) => setTimeout(r, 2500)); // 가짜가 다시 accept하기 시작할 때까지
    out += ` / 그 뒤 http://[::1]:${Q} → ${await get('::1', Q)} / fetch localhost:${Q} → ${await viaLocalhostFetch(Q)} / http://127.0.0.1:${Q} → ${await get('127.0.0.1', Q)}`;
    await d.close();
  } catch (e) {
    out = `시작 거부 ${e.code}`;
  }
  console.log(`W-a [::1]:${Q} 가짜(${f.msg}, backlog 채움) → startDashboard: ${out}`);
  f.ch.kill();
}

// W-b
{
  const d = await startDashboard({ store, port: 0 });
  const f = await fake('::1', d.port);
  console.log(`W-b startDashboard(127.0.0.1:${d.port}) 뒤 다른 프로세스 [::1]:${d.port} listen → ${f.msg} / http://[::1]:${d.port} → ${await get('::1', d.port)} / fetch localhost:${d.port} → ${await viaLocalhostFetch(d.port)} / http://127.0.0.1:${d.port} → ${await get('127.0.0.1', d.port)}`);
  f.ch.kill();
  await d.close();
}

// W-c
{
  const P = (await freePort('127.0.0.1')) + 50;
  const f = await fake('::1', P);
  let out;
  try {
    const p = await startProxy({ port: P });
    out = `시작됨 address=${JSON.stringify(p.address())}`;
    await p.close();
  } catch (e) {
    out = `시작 거부 ${e.code}`;
  }
  console.log(`W-c [::1]:${P} 가짜(${f.msg}) → startProxy: ${out}`);
  f.ch.kill();
}

// W-d
{
  const Q = (await freePort('127.0.0.1')) + 50;
  const f = await fake('127.0.0.1', Q, { fill: true, holdMs: 1500 });
  let out;
  try {
    const d = await startDashboard({ store, port: Q });
    out = `시작됨(port ${d.port})`;
    await d.close();
  } catch (e) {
    out = `거부 ${e.code} (${e.message.slice(0, 40)}) — 검사 통과 여부와 무관하게 listen 단계에서 막혔는지는 message로 구분 불가`;
  }
  console.log(`W-d 127.0.0.1:${Q} 가짜(${f.msg}, backlog 채움) → startDashboard: ${out}`);
  f.ch.kill();
}

// Z-x: 나가는 연결의 로컬 포트로만 쓰이는 X
{
  const srv = net.createServer((c) => c.on('error', () => {}));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const c = net.connect(srv.address().port, '127.0.0.1');
  await new Promise((r) => c.once('connect', r));
  const X = c.localPort;
  const probe = await new Promise((resolve) => {
    const s = net.connect(X, '127.0.0.1', () => (s.destroy(), resolve('connect')));
    s.on('error', (e) => resolve(e.code));
    s.setTimeout(500, () => (s.destroy(), resolve('timeout')));
  });
  let lis;
  try {
    const d = await startDashboard({ store, port: X });
    lis = `시작됨`;
    await d.close();
  } catch (e) {
    lis = `거부 ${e.code}`;
  }
  c.destroy();
  console.log(`Z-x 나가는 연결의 로컬 포트 X=${X}(듣는 사람 없음): 접속 검사=${probe} / startDashboard(X) → ${lis}`);
  srv.close();
}
process.exit(0);
