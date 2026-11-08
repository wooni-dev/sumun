// [UI 큰 단위 끝 — 독립 검토] ① 바인딩 주소(netstat) ② 같은 대시보드 포트로 다시 시작했을 때 열려 있던 탭(옛 토큰)이 어떻게 보이는지
// ③ 주소창의 토큰(#t=)이 페이지를 연 뒤에도 남는지.
// 실행: node scripts/probe/ui-final-review/restart-bind.mjs
import { execFileSync } from 'node:child_process';
import { launch, page } from './_cdp.mjs';
import { startApp, freePort, log, sleep, portOpen } from './_env.mjs';

const dport = await freePort();
const app1 = await startApp(['--dashboard-port', String(dport)]);
const ns = execFileSync('C:/Windows/System32/netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
  .split('\n')
  .filter((l) => /LISTENING/.test(l) && (l.includes(`:${app1.proxyPort} `) || l.includes(`:${dport} `)))
  .map((l) => l.trim().replace(/\s+/g, ' '));
const ns6 = execFileSync('C:/Windows/System32/netstat.exe', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8' })
  .split('\n')
  .filter((l) => /LISTENING/.test(l) && (l.includes(`:${app1.proxyPort} `) || l.includes(`:${dport} `)));
log('netstat', { v4: ns, v6: ns6.length });

const A = await launch(['--no-proxy-server']);
try {
  const tab = await page(A, app1.dashUrl);
  await tab.waitFor(`document.querySelector('.conn')?.textContent==='실시간'`);
  log('address-bar-after-load', await tab.eval(`location.href.replace(/#t=.*/, '#t=<토큰 '+ (location.hash.length-3) +'자>')`));
  await app1.stop();
  await sleep(1500);
  log('old-tab-after-stop', await tab.eval(`document.querySelector('.conn')?.textContent`));
  const app2 = await startApp(['--dashboard-port', String(dport)]);
  await sleep(12000); // 다시 연결 간격(최대 10초)
  log('old-tab-after-restart', { text: await tab.eval(`document.getElementById('app').innerText.slice(0,120)`), tokenChanged: app2.token !== app1.token });
  const tab2 = await page(A, app2.dashUrl);
  await tab2.waitFor(`document.querySelector('.conn')?.textContent==='실시간'`);
  log('new-tab', await tab2.eval(`document.querySelector('.conn').textContent`));
  await app2.stop();
} finally {
  await A.close();
  await sleep(300);
  log('ports-after-stop', { proxy: await portOpen(app1.proxyPort), dash: await portOpen(dport) });
  setTimeout(() => process.exit(0), 200);
}
