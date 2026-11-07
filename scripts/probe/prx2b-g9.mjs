// [PRX-2b 실측] G9: 목적지가 응답 헤더를 많이(같은 이름 N개) 보낼 때 프록시가 무엇을 돌려주고 무엇을 기록하는지
//   node scripts/probe/prx2b-g9.mjs [N, 기본 2500]
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';

const N = Number(process.argv[2] ?? 2500);
const up = net.createServer((s) => {
  s.on('error', () => {});
  s.once('data', () => s.end(`HTTP/1.1 200 OK\r\n${'a:1\r\n'.repeat(N)}Content-Length: 2\r\n\r\nok`));
});
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const flows = [];
const proxy = await startProxy({ port: 0, onFlow: (f) => flows.push(f) });
const raw = await new Promise((resolve) => {
  let buf = '';
  const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`GET http://127.0.0.1:${up.address().port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  s.on('data', (c) => (buf += c));
  s.on('close', () => resolve(buf));
  s.on('error', () => resolve(buf));
});
await new Promise((r) => setTimeout(r, 100));
const head = raw.split('\r\n\r\n')[0];
const aLine = head.split('\r\n').find((l) => /^a:/i.test(l)) ?? '';
console.log(`N=${N} 상태 줄: ${head.split('\r\n')[0]}`);
console.log(`클라이언트가 받은 a 헤더: 줄 ${head.split('\r\n').filter((l) => /^a:/i.test(l)).length}개, 값 ${aLine ? aLine.split(',').length : 0}개`);
console.log(`기록: ${flows.length}개, 기록된 a 헤더 ${flows[0]?.response?.headers.filter(([n]) => n === 'a').length ?? '-'}개, error ${JSON.stringify(flows[0]?.error ?? null)}`);
await proxy.close();
up.close();
