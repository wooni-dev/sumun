// e9:
//  C1  다른 프로세스가 [::1]:Q에 SO_CONDITIONAL_ACCEPT 리스너(3초 동안 Accept 안 부름) → 접속 검사 결과, startDashboard({port:Q}), 3초 뒤 localhost:Q는 누가 답하나
//  C2  같은 리스너를 127.0.0.1:Q에 → 접속 검사 결과와 startDashboard
//  S1  npm start -- --port P 순서 흉내: startDashboard({port:P+1}) 다음 startProxy({port:P}). 다음 임시 포트가 P가 되도록 맞추면
//      (대시보드 검사 2번이 임시 포트 2개를 쓴다) 프록시 검사가 self-connect로 "점유"가 되는가
// 실행: node e9-conditional.mjs
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

const nextEphemeral = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P + 1; // 다음에 나올 것으로 예상되는 번호
};
const answers = (port, host) =>
  new Promise((resolve) => {
    const s = net.connect(port, host, () => (s.destroy(), resolve(true)));
    s.setTimeout(500, () => (s.destroy(), resolve('false(timeout)')));
    s.on('error', (e) => resolve(`false(${e.code})`));
  });
const fetchLocalhost = async (port) => {
  try {
    const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) });
    return `${r.status} ${(await r.text()).slice(0, 20).replace(/\s+/g, ' ')}`;
  } catch (e) {
    return `오류 ${e.cause?.code ?? e.name}`;
  }
};

for (const [name, addr] of [
  ['C1', '::1'],
  ['C2', '127.0.0.1'],
]) {
  const Q = (await nextEphemeral()) + 60;
  const ch = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'e9-conditional.ps1'), '-Port', String(Q), '-Addr', addr, '-DelayMs', '3000'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const msg = await new Promise((r) => ch.stdout.once('data', (d) => r(String(d).trim())));
  const a = await answers(Q, addr);
  let out;
  try {
    const d = await startDashboard({ store, port: Q });
    out = `시작됨(127.0.0.1:${d.port})`;
    await new Promise((r) => setTimeout(r, 3500));
    out += ` / 3.5초 뒤 fetch localhost:${Q} → ${await fetchLocalhost(Q)}`;
    await d.close();
  } catch (e) {
    out = `거부 code=${e.code} "${String(e.message).slice(0, 45)}"`;
  }
  console.log(`${name} ${msg}: 접속 검사=${a} / startDashboard → ${out}`);
  ch.kill();
}

// S1
{
  const tally = {};
  for (let i = 0; i < 5; i++) {
    const E = await nextEphemeral(); // 대시보드 검사: 127.0.0.1 → E, [::1] → E+1, 프록시 검사 → E+2
    const P = E + 2;
    let out;
    let d;
    try {
      d = await startDashboard({ store, port: P + 1 });
      const p = await startProxy({ port: P, dashboardPort: d.port });
      out = '둘 다 시작';
      await p.close();
    } catch (e) {
      out = `거부 ${e.code} "${String(e.message).slice(0, 30)}"`;
    }
    if (d) await d.close();
    tally[out] = (tally[out] ?? 0) + 1;
  }
  console.log('S1 대시보드(P+1) → 프록시(P), 아무도 없는 포트, 5번:', JSON.stringify(tally));
}
process.exit(0);
