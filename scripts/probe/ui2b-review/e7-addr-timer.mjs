// e7: self-connect 판정 정보의 표기 함정과 타임아웃 순서.
//  M1  '::ffff:127.0.0.1'로 접속: 127.0.0.1 리스너에 닿는가, local/remote 표기는? self-connect 때 표기는?
//  M2  'localhost'로 접속: 어느 주소로 가는가(remoteFamily), self-connect 때 표기는?
//  T1  접속을 건 뒤 자기 이벤트 루프가 600ms 막히면(동기 작업), 실제 리스너가 있어도 500ms 타이머가 먼저 불려 false가 되는가
// 실행: node e7-addr-timer.mjs
import net from 'node:net';

const info = (port, host, timeout = 500) =>
  new Promise((resolve) => {
    const c = net.connect({ port, host });
    c.once('connect', () => {
      const o = { r: 'connect', la: c.localAddress, lp: c.localPort, ra: c.remoteAddress, rp: c.remotePort, fam: c.remoteFamily };
      c.destroy();
      resolve(o);
    });
    c.once('error', (e) => resolve({ r: 'error', code: e.code }));
    c.setTimeout(timeout, () => (c.destroy(), resolve({ r: 'timeout' })));
  });
const freePort = async (host = '127.0.0.1') => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, host, r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P;
};

const srv = net.createServer((c) => c.destroy());
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const L = srv.address().port;
console.log(`M1 127.0.0.1:${L} 리스너에 '::ffff:127.0.0.1'로 →`, JSON.stringify(await info(L, '::ffff:127.0.0.1')));
{
  const P = await freePort();
  console.log(`M1 빈 포트 ${P + 1}에 '::ffff:127.0.0.1'로(self-connect 유도) →`, JSON.stringify(await info(P + 1, '::ffff:127.0.0.1')));
}
console.log(`M2 127.0.0.1:${L} 리스너에 'localhost'로 →`, JSON.stringify(await info(L, 'localhost')));
{
  const P = await freePort();
  console.log(`M2 빈 포트 ${P + 1}에 'localhost'로(self-connect 유도) →`, JSON.stringify(await info(P + 1, 'localhost')));
}

// T1
{
  const res = await new Promise((resolve) => {
    const s = net.connect(L, '127.0.0.1', () => (s.destroy(), resolve(true)));
    s.setTimeout(500, () => (s.destroy(), resolve(false)));
    s.on('error', () => resolve(false));
    const t = Date.now();
    while (Date.now() - t < 600); // 같은 프로세스의 동기 작업(예: 키 생성, 큰 파일 읽기)이 루프를 막음
  });
  console.log(`T1 실제 리스너 127.0.0.1:${L}, 접속 직후 루프 600ms 막힘 → portAnswers 방식 판정 = ${res}`);
}
srv.close();
