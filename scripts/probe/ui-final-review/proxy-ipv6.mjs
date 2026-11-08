// [UI 큰 단위 끝 — 독립 검토] curl.exe가 [::1] 절대 URL을 프록시로 못 보내서(curl: (27)) 원시 소켓으로 같은 요청을 보낸다.
// 실행: node scripts/probe/ui-final-review/proxy-ipv6.mjs
import net from 'node:net';
import { startApp, log, sleep, portOpen } from './_env.mjs';

const app = await startApp();
const send = (text) =>
  new Promise((resolve) => {
    const s = net.connect(app.proxyPort, '127.0.0.1', () => s.write(text));
    let out = '';
    s.on('data', (d) => (out += d));
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
    s.setTimeout(4000, () => s.destroy());
  });
try {
  for (const h of ['[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[0:0:0:0:0:0:0:1]', '[::]', '[::127.0.0.1]']) {
    const out = await send(`GET http://${h}:${app.dashPort}/api/flows HTTP/1.1\r\nHost: ${h}:${app.dashPort}\r\nAuthorization: Bearer ${app.token}\r\nConnection: close\r\n\r\n`);
    log('plain-absolute', { host: h, status: out.split('\r\n')[0], leaked: out.includes('"items"') });
  }
  // Host 헤더만 다른 경우(평문 대상은 절대 URL 기준이어야 한다)
  const out = await send(`GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:${app.dashPort}\r\nConnection: close\r\n\r\n`);
  log('host-mismatch', { status: out.split('\r\n')[0] });
} finally {
  await app.stop();
  await sleep(300);
  log('ports-after-stop', { proxy: await portOpen(app.proxyPort), dashboard: await portOpen(app.dashPort) });
}
