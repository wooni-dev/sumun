// [PRX-2b 실측] 기록(onFlow)을 켠 프록시의 메모리: G1 큰 응답, G2 1바이트 청크 폭탄, G5 읽지 않는 클라이언트, G6 동시 연결
//   node scripts/probe/prx2b-memory.mjs [g1|g2|g5|g6 ...]   (기본: 모두)
// 시나리오마다 프록시를 새 자식 프로세스로 띄우고, 그 프로세스의 최대 RSS(20ms 간격)를 잰다. 구독자는 기록을 받기만 하고 버린다.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

const MB = 1048576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = Buffer.alloc(MB, 0x61);

// 목적지: /big?mb=N → N MB를 역압을 지키며 보낸다 / /sink → 본문을 읽어 버리고 끝나면 ok
const up = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/big') {
    const total = Number(u.searchParams.get('mb'));
    res.writeHead(200, { 'content-length': total * MB });
    let sent = 0;
    const pump = () => {
      while (sent < total) {
        sent++;
        if (!res.write(chunk)) return res.once('drain', pump);
      }
      res.end();
    };
    res.on('error', () => {});
    return pump();
  }
  req.resume();
  req.on('end', () => res.end('ok'));
});
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const UP = `127.0.0.1:${up.address().port}`;

async function startChild() {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startProxy } from './src/proxy/server.ts';
    let flows = 0;
    const p = await startProxy({ port: 0, onFlow: () => void flows++ });
    let max = 0;
    setInterval(() => (max = Math.max(max, process.memoryUsage().rss)), 20);
    console.log('ready ' + p.port + ' ' + Math.round(process.memoryUsage().rss / ${MB}));
    process.stdin.on('data', () => console.log('max ' + Math.round(max / ${MB}) + ' ' + flows));
  `], { stdio: ['pipe', 'pipe', 'inherit'] });
  const [, port, rss] = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim().split(' '))));
  return {
    port: Number(port),
    startRss: Number(rss),
    report: async () => {
      child.stdin.write('r\n');
      const [, max, flows] = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim().split(' '))));
      return { max: Number(max), flows: Number(flows) };
    },
    kill: () => child.kill(),
  };
}

const scenarios = {
  // G1: 512MB 응답을 빠르게 읽는 클라이언트
  async g1(c) {
    let got = 0;
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: c.port, path: `http://${UP}/big?mb=512`, agent: false }, (res) => {
        res.on('data', (d) => (got += d.length));
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });
    return `512MB 응답, 받은 바이트 ${got}`;
  },
  // G2: chunked 요청 본문을 1바이트 청크 100만 개로
  async g2(c) {
    const s = net.connect(c.port, '127.0.0.1');
    await new Promise((r) => s.once('connect', r));
    s.write(`POST http://${UP}/sink HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`);
    const block = Buffer.from('1\r\na\r\n'.repeat(10_000));
    for (let i = 0; i < 100; i++) if (!s.write(block)) await new Promise((r) => s.once('drain', r));
    s.write('0\r\n\r\n');
    const reply = await new Promise((r) => {
      let b = '';
      s.on('data', (d) => (b += d));
      s.on('close', () => r(b.split('\r\n')[0]));
    });
    return `1바이트 청크 1,000,000개, 응답 "${reply}"`;
  },
  // G5: 512MB 응답을 요청하고 3초 동안 읽지 않는 클라이언트
  async g5(c) {
    const s = net.connect(c.port, '127.0.0.1');
    await new Promise((r) => s.once('connect', r));
    s.pause();
    s.write(`GET http://${UP}/big?mb=512 HTTP/1.1\r\nHost: x\r\n\r\n`);
    await sleep(3000);
    s.destroy();
    await sleep(200);
    return '512MB 응답을 요청하고 3초 동안 읽지 않음';
  },
  // G6: 연결 200개가 각각 1MiB-1 본문을 보내고 멈춤(Content-Length는 2MiB라 끝나지 않음)
  async g6(c) {
    const body = Buffer.alloc(MB - 1, 0x62);
    const socks = [];
    for (let i = 0; i < 200; i++) {
      const s = net.connect(c.port, '127.0.0.1');
      s.on('error', () => {});
      await new Promise((r) => s.once('connect', r));
      s.write(`POST http://${UP}/sink HTTP/1.1\r\nHost: x\r\nContent-Length: ${2 * MB}\r\n\r\n`);
      s.write(body);
      socks.push(s);
    }
    await sleep(2000);
    const r = await c.report();
    for (const s of socks) s.destroy();
    await sleep(300);
    return `연결 200개 × 본문 ${MB - 1}바이트에서 멈춤 (그 시점 최대 ${r.max}MB)`;
  },
};

const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
for (const name of pick) {
  const c = await startChild();
  const t0 = Date.now();
  const what = await scenarios[name](c);
  const r = await c.report();
  console.log(`${name.toUpperCase()}: ${what}\n   프록시 메모리 시작 ${c.startRss}MB → 최대 ${r.max}MB, 기록 ${r.flows}개, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  c.kill();
}
up.close();
