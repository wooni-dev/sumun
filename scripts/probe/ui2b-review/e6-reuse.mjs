// e6: SO_REUSEADDR / SO_EXCLUSIVEADDRUSE 축. 다른 프로세스는 PowerShell(.NET 소켓, e6-reuse.ps1).
//  R1  startDashboard(127.0.0.1:Q) 뒤 다른 프로세스가 SO_REUSEADDR로 127.0.0.1:Q bind+listen → 되는가, 127.0.0.1:Q는 누가 답하나
//  R2  startProxy(127.0.0.1:P) 뒤 같은 시도
//  R3  다른 프로세스가 SO_REUSEADDR로 127.0.0.1:Q listen 중 → startDashboard({port:Q})
//  R4  다른 프로세스가 SO_EXCLUSIVEADDRUSE로 127.0.0.1:Q bind만(listen 안 함) → 검사 결과와 startDashboard
//  R5  다른 프로세스가 SO_REUSEADDR로 127.0.0.1:Q bind만 → startDashboard
// 실행: node e6-reuse.mjs
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  return P + 50;
};
function ps(port, mode, extra = []) {
  const ch = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'e6-reuse.ps1'), '-Port', String(port), '-Mode', mode, ...extra], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => ch.stdout.once('data', (d) => r({ ch, msg: String(d).trim() })));
}
const get = (port) =>
  new Promise((resolve) => {
    const q = http.get({ host: '127.0.0.1', port, path: '/', agent: false, timeout: 3000 }, (s) => {
      let b = '';
      s.on('data', (c) => (b += c));
      s.on('end', () => resolve(`${s.statusCode} ${b.slice(0, 20).replace(/\s+/g, ' ')}`));
    });
    q.on('error', (e) => resolve(`오류 ${e.code}`));
    q.on('timeout', () => q.destroy(new Error('timeout')));
  });
const answers = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => (s.destroy(), resolve(true)));
    s.setTimeout(500, () => (s.destroy(), resolve(false)));
    s.on('error', (e) => resolve(`false(${e.code})`));
  });
const tryStart = async (fn) => {
  try {
    const x = await fn();
    return { ok: true, x };
  } catch (e) {
    return { ok: false, why: `code=${e.code} "${String(e.message).slice(0, 45)}"` };
  }
};

// R1
{
  const d = await startDashboard({ store, port: await freePort() });
  const p = await ps(d.port, 'reuse');
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await get(d.port));
  console.log(`R1 대시보드 127.0.0.1:${d.port} 뒤 SO_REUSEADDR 시도 → ${p.msg} / 127.0.0.1 응답 4번: ${r.join(' | ')}`);
  p.ch.kill();
  await d.close();
}
// R2
{
  const pr = await startProxy({ port: await freePort() });
  const port = pr.address().port;
  const p = await ps(port, 'reuse');
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await get(port));
  console.log(`R2 프록시 127.0.0.1:${port} 뒤 SO_REUSEADDR 시도 → ${p.msg} / 127.0.0.1 응답 4번: ${r.join(' | ')}`);
  p.ch.kill();
  await pr.close();
}
// R3
{
  const Q = await freePort();
  const p = await ps(Q, 'reuse');
  const s = await tryStart(() => startDashboard({ store, port: Q }));
  console.log(`R3 ${p.msg} 상태에서 startDashboard(${Q}) → ${s.ok ? '시작됨' : '거부 ' + s.why}`);
  if (s.ok) await s.x.close();
  p.ch.kill();
}
// R4, R5
for (const [name, mode] of [
  ['R4', 'exclusive'],
  ['R5', 'reuse'],
]) {
  const Q = await freePort();
  const p = await ps(Q, mode, ['-NoListen']);
  const a = await answers(Q);
  const s = await tryStart(() => startDashboard({ store, port: Q }));
  console.log(`${name} ${p.msg} 상태: 접속 검사=${a} / startDashboard(${Q}) → ${s.ok ? '시작됨' : '거부 ' + s.why}`);
  if (s.ok) await s.x.close();
  p.ch.kill();
}
process.exit(0);
