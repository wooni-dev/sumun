// e1: self-connect가 생길 때 소켓 정보(local/remote 주소·포트), ::1에서도 생기는지,
// self-connect 직후 같은 포트에 listen이 되는지(TIME_WAIT), 아무도 없는 포트의 거절 지연.
// 실행: node e1-selfconnect-detail.mjs
import net from 'node:net';

const probe = (port, host, timeout = 500) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const c = net.connect(port, host);
    c.once('connect', () => {
      const o = { r: 'connect', la: c.localAddress, lp: c.localPort, ra: c.remoteAddress, rp: c.remotePort, fam: c.remoteFamily, ms: Math.round(performance.now() - t0) };
      c.destroy();
      resolve(o);
    });
    c.once('error', (e) => resolve({ r: 'error', code: e.code, ms: Math.round(performance.now() - t0) }));
    c.setTimeout(timeout, () => (c.destroy(), resolve({ r: 'timeout', ms: Math.round(performance.now() - t0) })));
  });

const freePort = async (host) => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, host, r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  return P;
};
const tryListen = (port, host) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e.code));
    s.listen(port, host, () => s.close(() => resolve('ok')));
  });

for (const host of ['127.0.0.1', '::1']) {
  let self = 0, listenAfter = {};
  const N = 10;
  for (let i = 0; i < N; i++) {
    const P = await freePort(host);
    const o = await probe(P + 1, host);
    const isSelf = o.r === 'connect' && o.lp === o.rp && o.la === o.ra;
    if (isSelf) self++;
    const l = await tryListen(P + 1, host);
    listenAfter[l] = (listenAfter[l] ?? 0) + 1;
    if (i < 3 || isSelf) console.log(host, `P=${P} probe ${P + 1}:`, JSON.stringify(o), 'self=', isSelf, 'listen직후=', l);
  }
  console.log(`[${host}] self-connect ${self}/${N}, 직후 listen 결과`, JSON.stringify(listenAfter));
}

// 아무도 없는 포트(동적 범위 밖)의 거절 지연: Windows는 RST를 받고도 SYN을 재시도한다고 알려져 있다
for (const host of ['127.0.0.1', '::1']) {
  const o = await probe(1, host, 5000); // 1번 포트: 보통 비어 있음
  console.log(`[${host}] 빈 포트 1 거절 지연(timeout 5000):`, JSON.stringify(o));
  const o2 = await probe(1, host, 500);
  console.log(`[${host}] 빈 포트 1 (timeout 500):`, JSON.stringify(o2));
}
