// [PRX-1c 실측] B9: 큰 응답을 중계할 때 프록시가 본문을 메모리에 모으지 않는지(스트리밍) 확인한다
//   node scripts/probe/prx1c-stream.mjs [MB, 기본 512]
// 프록시는 별도 프로세스에서 띄우고, 그 프로세스의 최대 메모리(RSS)를 잰다. 실제 클라이언트로 curl을 쓴다.
// 판단 기준: 크기를 바꿔 여러 번 재서, 최대 메모리가 본문 크기에 비례해서 늘지 않으면 스트리밍이다.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';

const SIZE_MB = Number(process.argv[2] ?? 512);
const chunk = Buffer.alloc(1024 * 1024, 0x61);
const up = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-length': SIZE_MB * chunk.length });
  let sent = 0;
  const pump = () => {
    while (sent < SIZE_MB) {
      sent++;
      if (!res.write(chunk)) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
});
await new Promise((r) => up.listen(18092, '127.0.0.1', r));

const child = spawn(process.execPath, ['--input-type=module', '-e', `
  import { startProxy } from './src/proxy/server.ts';
  await startProxy({ port: 18093 });
  let max = 0;
  setInterval(() => (max = Math.max(max, process.memoryUsage().rss)), 20);
  console.log('ready ' + Math.round(process.memoryUsage().rss / 1048576));
  process.stdin.on('data', () => console.log('max ' + Math.round(max / 1048576)));
`], { stdio: ['pipe', 'pipe', 'inherit'] });
const startRss = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim().split(' ')[1])));

const t0 = Date.now();
const out = await new Promise((r) =>
  execFile('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code} %{size_download}', '-x', 'http://127.0.0.1:18093', 'http://127.0.0.1:18092/big'], (e, o) => r(o || `오류 ${e?.code}`)),
);
child.stdin.write('report\n');
const maxRss = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim().split(' ')[1])));
console.log(`curl 결과(상태 받은바이트): ${out}  /  ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`프록시 프로세스 메모리: 시작 ${startRss}MB → 최대 ${maxRss}MB  (중계한 본문 ${SIZE_MB}MB)`);
child.kill();
up.close();
