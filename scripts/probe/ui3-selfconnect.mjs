// [UI-3에서 발견한 UI-2 결함 진단] Windows는 빈 포트를 연속 번호로 준다(ui1-ports.mjs). listen(0)으로 P를 받고 닫은 뒤
// 127.0.0.1:P+1로 접속해 보면(대시보드 portAnswers와 같은 방식), 나가는 소켓이 마침 P+1을 받아 자기 자신에게 연결(TCP self-connect)되는가.
// 그러면 아무도 듣지 않는 P+1이 "누가 응답한다"로 보인다.
// 실행: node scripts/probe/ui3-selfconnect.mjs
import net from 'node:net';

const tries = 10;
let self = 0;
for (let i = 0; i < tries; i++) {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const P = s.address().port;
  await new Promise((r) => s.close(r));
  const r = await new Promise((resolve) => {
    const c = net.connect(P + 1, '127.0.0.1', () => {
      const out = { connected: true, local: c.localPort, remote: c.remotePort };
      c.destroy();
      resolve(out);
    });
    c.on('error', (e) => resolve({ connected: false, code: e.code, local: c.localPort }));
    c.setTimeout(500, () => (c.destroy(), resolve({ connected: false, code: 'timeout' })));
  });
  if (r.connected && r.local === r.remote) self++;
  console.log(`P=${P} 접속 ${P + 1} →`, JSON.stringify(r));
}
console.log(`self-connect ${self} / ${tries}`);
