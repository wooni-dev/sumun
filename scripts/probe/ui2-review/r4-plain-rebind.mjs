// r4: 평문 경로는 startProxy의 lookup 옵션을 쓰지 않고, 연결할 때 Node(dns.lookup)가 이름을 다시 해석한다.
// 검사가 lookup 옵션(또는 따로 한 해석)으로 "공인 주소"를 보고 통과시켜도 연결은 127.0.0.1로 갈 수 있다(DNS 리바인딩 TOCTOU).
// 인터넷에 묻지 않도록 dns.lookup을 이 프로세스 안에서 바꿔 끼운다: rebind.test → 첫 해석 203.0.113.9, 그다음부터 127.0.0.1
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';

let calls = 0;
const orig = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (typeof opts === 'function') (cb = opts), (opts = {});
  if (host === 'rebind.test') {
    calls++;
    const addr = calls === 1 ? '203.0.113.9' : '127.0.0.1';
    return process.nextTick(() => (opts?.all ? cb(null, [{ address: addr, family: 4 }]) : cb(null, addr, 4)));
  }
  return orig.call(this, host, opts, cb);
};
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);
const seen = [];
const dash = http.createServer((req, res) => { seen.push(req.headers.host); res.end('DASH-SECRET'); });
await new Promise((r) => dash.listen(0, '127.0.0.1', r));
const dp = dash.address().port;
let injected = 0;
const proxy = await startProxy({ port: 0, tunnel: true, lookup: async () => (injected++, [{ address: '203.0.113.9', family: 4 }]), onFlow: () => {} });

// "검사" 흉내: 연결 전에 한 번 해석해서 공인 주소를 본다(첫 호출 = 203.0.113.9)
const checkSaw = await new Promise((ok) => dns.lookup('rebind.test', {}, (e, a) => ok(a)));
const get = (url) => new Promise((ok) => { const r = http.request({ host: '127.0.0.1', port: proxy.port, path: url }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok(res.statusCode + ' ' + b.trim().slice(0, 40))); }); r.on('error', (e) => ok('err ' + e.code)); r.end(); });
const r = await get(`http://rebind.test:${dp}/api/ping`);
console.log('check-time lookup saw:', checkSaw, '| proxy result:', r, '| dns.lookup calls for rebind.test:', calls, '| injected lookup option calls:', injected, '| dashboard saw Host:', JSON.stringify(seen));
const r2 = await get(`http://localhost:${dp}/x`);
console.log('localhost with injected lookup returning 203.0.113.9 ->', r2, 'injected calls', injected);
await proxy.close(); dash.close();
