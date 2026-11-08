// e8: 임시 포트 번호를 IPv4·IPv6가 따로 고르는가 — 127.0.0.1:Q에 리스너가 있어도 [::1] 쪽 나가는 소켓이 Q를 받아 self-connect 되는가.
//  F1  127.0.0.1:Q(다음 임시 포트로 예상되는 번호)를 다른 프로세스가 listen → [::1]:Q로 접속
//  F2  같은 상태에서 'localhost':Q로 접속 — ::1 self-connect가 나면 127.0.0.1의 실제 리스너까지 가지 않는가
//  F3  [::1]:Q를 다른 프로세스가 listen → 127.0.0.1:Q로 접속(IPv4 쪽 self-connect)
// 실행: node e8-family-ephemeral.mjs
import net from 'node:net';
import { spawn } from 'node:child_process';

const info = (port, host) =>
  new Promise((resolve) => {
    const c = net.connect({ port, host });
    c.once('connect', () => {
      const o = { r: 'connect', la: c.localAddress, lp: c.localPort, ra: c.remoteAddress, rp: c.remotePort };
      c.destroy();
      resolve(o);
    });
    c.once('error', (e) => resolve({ r: 'error', code: e.code }));
    c.setTimeout(500, () => (c.destroy(), resolve({ r: 'timeout' })));
  });
function holder(host, port) {
  const ch = spawn(process.execPath, ['-e', `const s=require('net').createServer(c=>c.end('HELD'));s.on('error',e=>console.log('ERR'));s.listen(${port},'${host}',()=>console.log('READY'))`], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => ch.stdout.once('data', (d) => r({ ch, msg: String(d).trim() })));
}
// 자식이 뜨는 동안 임시 포트가 소비될 수 있어서, 자식이 뜬 "뒤에" 다음 임시 포트를 재고 그 번호를 노린다:
// 다음 임시 포트 N을 listen(0)로 확인 → 자식에게 N+1... 은 경쟁이 생기므로, 대신 자식이 Q를 잡은 뒤 listen(0)을 반복해 Q-1이 나올 때까지 넘긴다.
async function advanceTo(target, host) {
  for (let i = 0; i < 400; i++) {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, host, r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    if (p === target - 1) return true;
    if (p >= target) return false; // 지나침(건너뜀)
  }
  return false;
}
async function base() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

for (const [name, holdHost, probeHost] of [
  ['F1', '127.0.0.1', '::1'],
  ['F2', '127.0.0.1', 'localhost'],
  ['F3', '::1', '127.0.0.1'],
]) {
  const tally = {};
  for (let i = 0; i < 5; i++) {
    const Q = (await base()) + 30;
    const h = await holder(holdHost, Q);
    const ok = await advanceTo(Q, probeHost === '127.0.0.1' ? '127.0.0.1' : '::1');
    const r = await info(Q, probeHost);
    const key = !ok ? '맞추기 실패' : r.r === 'connect' ? (r.lp === r.rp ? `self-connect(${r.la})` : `실제 리스너(${r.ra})`) : r.code ?? r.r;
    tally[key] = (tally[key] ?? 0) + 1;
    if (i === 0) console.log(`${name} 예: ${holdHost}:${Q} 점유, 다음 임시 포트를 ${Q}로 맞춤=${ok}, ${probeHost}:${Q} 접속 →`, JSON.stringify(r));
    h.ch.kill();
  }
  console.log(`${name} ${holdHost} 점유 + ${probeHost} 접속 5번:`, JSON.stringify(tally));
}
