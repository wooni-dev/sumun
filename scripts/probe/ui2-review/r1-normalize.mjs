// r1: 주소 표기가 WHATWG URL에서 어떻게 정규화되는지, 그리고 Node가 그 주소로 연결하면 127.0.0.1에 열린 서버에 닿는지
// 인터넷 접속 없음: IP 리터럴과 localhost만 연결해 본다
import net from 'node:net';
import os from 'node:os';
import dns from 'node:dns';

const srv = net.createServer((s) => { hits++; s.end(); });
let hits = 0;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const dp = srv.address().port;
console.log('fake dashboard 127.0.0.1:' + dp);

const SELF_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hosts = ['127.0.0.1', 'LOCALHOST', 'localhost.', 'LocalHost.', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', '0x7f.1', '%31%32%37.0.0.1', '１２７．０．０．１', '127.0.0.1.', '127.0.0.2', '127.255.255.254', '0.0.0.0', '0', '[::1]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::127.0.0.1]', '[::]', 'a.localhost', 'evil.com@127.0.0.1'];
console.log('\n## 평문 absolute-form URL 정규화 (hostname / port) — 현재 isSelf식 SELF_HOSTS 비교로 잡히는가');
for (const h of hosts) {
  for (const p of [`${dp}`, `0${dp}`, `000${dp}`]) {
    try {
      const u = new URL(`http://${h}:${p}/x`);
      if (p !== `${dp}` && h !== '127.0.0.1') continue;
      console.log(`${JSON.stringify(h + ':' + p).padEnd(48)} -> hostname=${u.hostname} port=${u.port} selfHostsMatch=${SELF_HOSTS.has(u.hostname)}`);
    } catch (e) { console.log(`${JSON.stringify(h + ':' + p).padEnd(48)} -> URL 오류 ${e.code}`); }
  }
}
for (const raw of [`http://127.0.0.1:${dp}\\@evil.com/`, `http://evil.com\\@127.0.0.1:${dp}/`, `http://127.0.0.1:80/`, `http://127.0.0.1/`, `http://127.0.0.1:${dp}.`, `http://127.0.0.1:+${dp}/`]) {
  try { const u = new URL(raw); console.log(`${JSON.stringify(raw).padEnd(48)} -> hostname=${u.hostname} port=${JSON.stringify(u.port)}`); } catch (e) { console.log(`${JSON.stringify(raw).padEnd(48)} -> URL 오류`); }
}

console.log('\n## Node net.connect로 127.0.0.1 리스너에 닿는가');
const lan = Object.values(os.networkInterfaces()).flat().filter((i) => !i.internal).map((i) => i.address);
const targets = ['127.0.0.1', '127.0.0.2', '127.255.255.254', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::7f00:1', '::', 'localhost', ...lan.slice(0, 3)];
for (const t of targets) {
  const before = hits;
  const r = await new Promise((ok) => {
    const s = net.connect({ host: t, port: dp }, () => { s.destroy(); ok('connected'); });
    s.setTimeout(1500, () => { s.destroy(); ok('timeout'); });
    s.on('error', (e) => ok('error ' + e.code));
  });
  await new Promise((r) => setTimeout(r, 50));
  console.log(`${t.padEnd(28)} -> ${r} reachedListener=${hits > before}`);
}
console.log('\n## localhost 해석 순서(로컬)');
console.log(JSON.stringify(await dns.promises.lookup('localhost', { all: true })));
srv.close();
