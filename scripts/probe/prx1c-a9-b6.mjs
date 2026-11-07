// [PRX-1c 실측] E27: A9(다른 프로세스가 0.0.0.0:P를 쓰는 중 시작), B6(환경 프록시 변수가 이 프록시를 가리킬 때)
//   node scripts/probe/prx1c-a9-b6.mjs
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';

// A9: 다른 "프로세스"가 0.0.0.0:P를 점유 (같은 프로세스면 결과가 다를 수 있어 자식 프로세스로)
const holder = spawn(process.execPath, ['-e', "require('net').createServer().listen(0,'0.0.0.0',function(){console.log(this.address().port)})"]);
const P = Number(await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim()))));
try {
  const p = await startProxy({ port: P });
  console.log(`A9: 0.0.0.0:${P} 점유 중 127.0.0.1:${P} 시작 → 성공(같은 포트를 나눠 씀) address=${JSON.stringify(p.address())}`);
  await p.close();
} catch (e) {
  console.log(`A9: 0.0.0.0:${P} 점유 중 127.0.0.1:${P} 시작 → 실패 ${e.code}`);
}
holder.kill();

// B6: NODE_USE_ENV_PROXY=1, HTTP_PROXY=이 프록시 자신 → 바깥 요청이 환경 프록시를 따르면 루프(508)가 된다
const up = http.createServer((q, s) => s.end('upstream-ok'));
await new Promise((r) => up.listen(0, '127.0.0.1', r));
const free = net.createServer();
await new Promise((r) => free.listen(0, '127.0.0.1', r));
const PP = free.address().port;
await new Promise((r) => free.close(r));
const child = spawn(process.execPath, ['--input-type=module', '-e', `import { startProxy } from './src/proxy/server.ts'; await startProxy({ port: ${PP} }); console.log('ready');`], {
  env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: `http://127.0.0.1:${PP}`, http_proxy: `http://127.0.0.1:${PP}`, NO_PROXY: '' },
});
child.stderr.on('data', (d) => process.stderr.write(`[자식 stderr] ${d}`));
await new Promise((r) => child.stdout.once('data', r));
const res = await new Promise((resolve) => {
  const q = http.request({ host: '127.0.0.1', port: PP, path: `http://127.0.0.1:${up.address().port}/b6`, agent: false }, (s) => {
    let b = '';
    s.on('data', (c) => (b += c));
    s.on('end', () => resolve(`${s.statusCode} ${b.trim()}`));
  });
  q.on('error', (e) => resolve(`오류 ${e.code}`));
  q.end();
});
console.log(`B6: NODE_USE_ENV_PROXY=1 + HTTP_PROXY=자기 자신 → 응답 ${res}`);
child.kill();
up.close();
