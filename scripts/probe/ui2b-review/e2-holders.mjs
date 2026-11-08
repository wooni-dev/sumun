// e2: 다른 프로세스(자식)가 포트를 잡은 여러 상태에서 "접속해 보기" 판정이 어떻게 나오는지.
//  (a) 듣기만 하고 accept하지 않음(이벤트 루프 막음, backlog 1) → backlog가 차면 접속이 거절/시간초과되는가
//  (b) 에코 서버 → "보낸 바이트가 그대로 돌아오면 self-connect" 판정을 흉내 낼 수 있는가
//  (c) self-connect 판정 정보: destroy 뒤 localPort, error 때 localPort
//  (d) 대시보드 검사 순서(127.0.0.1 → ::1)에서 다음 임시 포트가 P-1이면 ::1 쪽이 self-connect 되는가
//  (e) [::1]:Q를 남이 잡은 상태에서 127.0.0.1:Q로 접속하면 IPv4 임시 포트로 Q를 받아 self-connect 되는가
// 실행: node e2-holders.mjs   (127.0.0.1, ::1만 쓴다)
import net from 'node:net';
import { spawn } from 'node:child_process';

const probe = (port, host, timeout = 500) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const c = net.connect(port, host);
    c.once('connect', () => {
      const o = { r: 'connect', la: c.localAddress, lp: c.localPort, ra: c.remoteAddress, rp: c.remotePort };
      c.destroy();
      o.lpAfterDestroy = c.localPort;
      resolve(o);
    });
    c.once('error', (e) => resolve({ r: 'error', code: e.code, lpOnError: c.localPort, ms: Math.round(performance.now() - t0) }));
    c.setTimeout(timeout, () => (c.destroy(), resolve({ r: 'timeout', ms: Math.round(performance.now() - t0) })));
  });

function holder(code) {
  const ch = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => ch.stdout.once('data', (d) => r({ ch, port: Number(String(d).trim()) })));
}
const freePort = async (host) => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, host, r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P;
};

// (a) accept하지 않는 리스너: listen 뒤 이벤트 루프를 20초 막는다
for (const host of ['127.0.0.1', '::1']) {
  const { ch, port } = await holder(
    `const s=require('net').createServer();s.listen({port:0,host:'${host}',backlog:1},()=>{console.log(s.address().port);setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20000),50)})`,
  );
  await new Promise((r) => setTimeout(r, 300));
  const held = [];
  const results = [];
  for (let i = 0; i < 12; i++) {
    const res = await new Promise((resolve) => {
      const c = net.connect(port, host);
      c.once('connect', () => (held.push(c), resolve('connect')));
      c.once('error', (e) => resolve(e.code));
      c.setTimeout(500, () => (c.destroy(), resolve('timeout')));
    });
    results.push(res);
  }
  console.log(`(a) [${host}] accept 안 하는 리스너(backlog 1)에 12번 접속(앞 접속은 열어 둠):`, results.join(','));
  held.forEach((c) => c.destroy());
  ch.kill();
}

// (b) 에코 서버: 보낸 nonce가 그대로 돌아온다 — self-connect와 구별되는가
{
  const { ch, port } = await holder(`const s=require('net').createServer(c=>c.pipe(c));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))`);
  const echo = (p) =>
    new Promise((resolve) => {
      const c = net.connect(p, '127.0.0.1', () => c.write('nonce-123'));
      c.once('data', (d) => (resolve({ back: String(d), lp: c.localPort, rp: c.remotePort }), c.destroy()));
      c.once('error', (e) => resolve({ err: e.code }));
      c.setTimeout(500, () => (c.destroy(), resolve({ r: 'timeout' })));
    });
  console.log('(b) 에코 서버(다른 프로세스)에 nonce 보냄 →', JSON.stringify(await echo(port)));
  const P = await freePort('127.0.0.1');
  console.log('(b) self-connect에 nonce 보냄 →', JSON.stringify(await echo(P + 1)));
  ch.kill();
}

// (c)는 위 probe 결과의 lpAfterDestroy/lpOnError로 본다
{
  const P = await freePort('127.0.0.1');
  console.log('(c) self-connect: destroy 뒤 localPort =', JSON.stringify(await probe(P + 1, '127.0.0.1')));
  console.log('(c) 거절: error 때 localPort =', JSON.stringify(await probe(1, '127.0.0.1')));
}

// (d) 대시보드 검사 순서: 127.0.0.1:T 다음 [::1]:T. 다음 임시 포트가 T-1이면 첫 접속이 T-1을 쓰고(거절), 둘째(::1)가 T를 받는가
{
  let selfV6 = 0;
  for (let i = 0; i < 10; i++) {
    const P = await freePort('127.0.0.1'); // 다음 임시 포트는 P+1로 예상
    const T = P + 2;
    const a = await probe(T, '127.0.0.1');
    const b = await probe(T, '::1');
    const s = b.r === 'connect' && b.lp === b.rp;
    if (s) selfV6++;
    if (i < 2) console.log(`(d) T=${T}: v4`, JSON.stringify(a), ' v6', JSON.stringify(b));
  }
  console.log(`(d) 둘째 검사([::1])에서 self-connect ${selfV6}/10`);
}

// (e) 남이 [::1]:Q를 잡은 상태에서 127.0.0.1:Q 접속 — IPv4 임시 포트로 Q가 나와 self-connect 되는가
{
  let selfV4 = 0, n = 0;
  for (let i = 0; i < 5; i++) {
    const P = await freePort('127.0.0.1');
    const Q = P + 2; // 자식이 Q를 잡는 동안 임시 포트가 몇 개 더 쓰일 수 있어 정확히 맞지 않을 수 있다
    const { ch } = await holder(`const s=require('net').createServer();s.on('error',e=>{console.log(-1)});s.listen(${Q},'::1',()=>console.log(${Q}))`);
    const r = await probe(Q, '127.0.0.1');
    n++;
    if (r.r === 'connect' && r.lp === r.rp) selfV4++;
    console.log(`(e) [::1]:${Q} 점유 중 127.0.0.1:${Q} →`, JSON.stringify(r));
    ch.kill();
  }
  console.log(`(e) self-connect ${selfV4}/${n}`);
}
