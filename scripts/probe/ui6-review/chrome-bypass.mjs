// [UI-6 검토] Chrome의 --proxy-bypass-list 설정별로 127.0.0.1·localhost 요청이 프록시로 가는지 본다(요구 7).
// 가짜 프록시(받은 요청 줄을 기록), 가짜 대시보드 포트 D, 가짜 개발 서버 포트 S — 모두 127.0.0.1에만 열고 끝나면 닫는다.
// 실행: node scripts/probe/ui6-review/chrome-bypass.mjs
import http from 'node:http';
import { launch, page } from '../ui5b-review/cdp.mjs';

const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const seen = [];
const proxy = await listen((req, res) => { seen.push(req.url); res.end('VIA-PROXY'); });
const dash = await listen((req, res) => res.end('DIRECT-DASH'));
const dev = await listen((req, res) => res.end('DIRECT-DEV'));
const P = proxy.address().port, D = dash.address().port, S = dev.address().port;

const configs = {
  'A: --proxy-server만': [],
  'B: <-loopback>': ['--proxy-bypass-list=<-loopback>'],
  'C: <-loopback>;127.0.0.1:D;localhost:D': [`--proxy-bypass-list=<-loopback>;127.0.0.1:${D};localhost:${D}`],
  'D: 127.0.0.1:D;<-loopback>(순서 반대)': [`--proxy-bypass-list=127.0.0.1:${D};<-loopback>`],
  'E: <-loopback>;127.0.0.1(포트 없이)': ['--proxy-bypass-list=<-loopback>;127.0.0.1'],
};
const urls = { 'dash 127': `http://127.0.0.1:${D}/`, 'dash localhost': `http://localhost:${D}/`, 'dev 127': `http://127.0.0.1:${S}/`, 'dev localhost': `http://localhost:${S}/` };
for (const [name, extra] of Object.entries(configs)) {
  const b = await launch([`--proxy-server=127.0.0.1:${P}`, ...extra]);
  const row = [];
  for (const [k, u] of Object.entries(urls)) {
    seen.length = 0;
    const p = await page(b, u);
    await new Promise((r) => setTimeout(r, 600));
    const text = await p.eval('document.body ? document.body.innerText : ""');
    row.push(`${k}=${String(text).slice(0, 12)}`);
    await b.send('Target.closeTarget', { targetId: p.targetId });
  }
  console.log(`${name} (Chrome ${b.version}) → ${row.join(', ')}`);
  b.close();
}
proxy.close(); dash.close(); dev.close();
