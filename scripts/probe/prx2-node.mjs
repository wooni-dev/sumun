// [PRX-2 실측] Node 동작에 대한 예상 E30, E33을 확인한다 (O17, O19)
//   node scripts/probe/prx2-node.mjs
import { fork } from 'node:child_process';

// E30: Buffer.concat으로 작은 본문을 합치면 8KB 공유 풀의 일부인가
const small = Buffer.concat([Buffer.from('hel'), Buffer.from('lo')]);
console.log(`E30 Buffer.concat(5바이트): length=${small.length}, buffer.byteLength=${small.buffer.byteLength}, byteOffset=${small.byteOffset}`);

// E33: async 구독자의 reject를 아무도 잡지 않으면 프로세스가 죽고, reason이 출력되는가
if (process.argv[2] === 'child') {
  Promise.reject(new Error('SUMUN-SECRET-probe'));
  setTimeout(() => {}, 1000);
} else {
  const c = fork(import.meta.filename, ['child'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let err = '';
  c.stderr.on('data', (d) => (err += d));
  c.on('exit', (code) => console.log(`E33 처리되지 않은 reject: 종료 코드 ${code}, stderr에 표식 ${err.includes('SUMUN-SECRET-probe') ? '있음' : '없음'}`));
}
