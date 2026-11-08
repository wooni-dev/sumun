// e10: destroy 뒤·close 이벤트 때 local/remote 주소·포트 값. 실제 리스너(다른 상대)에 접속했을 때
// "localPort === remotePort && localAddress === remoteAddress"를 destroy 뒤에 계산하면 무엇이 나오는가.
// 실행: node e10-after-destroy.mjs
import net from 'node:net';

const srv = net.createServer((c) => c.on('error', () => {}));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const L = srv.address().port;
const pick = (c) => ({ la: c.localAddress, lp: c.localPort, ra: c.remoteAddress, rp: c.remotePort });
const out = await new Promise((resolve) => {
  const c = net.connect(L, '127.0.0.1', () => {
    const before = pick(c);
    c.destroy();
    const after = pick(c);
    c.once('close', () => resolve({ before, after, onClose: pick(c) }));
  });
});
const same = (o) => o.lp === o.rp && o.la === o.ra;
console.log(`실제 리스너 127.0.0.1:${L}`);
console.log(' connect 콜백 안(destroy 전):', JSON.stringify(out.before), 'self 판정=', same(out.before));
console.log(' destroy 직후:', JSON.stringify(out.after), 'undefined 표시:', String(out.after.lp), 'self 판정=', same(out.after));
console.log(' close 이벤트:', JSON.stringify(out.onClose), 'self 판정=', same(out.onClose));
srv.close();
