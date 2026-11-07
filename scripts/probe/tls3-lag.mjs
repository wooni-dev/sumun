// [TLS-3 실측] issueCert 동시 20개의 이벤트 루프 지연 — 한가할 때와 CPU가 바쁠 때(npm test 전체처럼)
//   node scripts/probe/tls3-lag.mjs [바쁜 프로세스 수, 기본 = CPU 코어 수]
// 병합 뒤 npm test 전체에서 E45가 "20개 동시 182ms"로 실패했다(c3a1459). 이 파일만 돌리면 통과했다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const BUSY = Number(process.argv[2] ?? os.cpus().length);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3-lag-'));
const root = await loadOrCreateCA(path.join(base, 'ca'));
const lagMeter = () => {
  let max = 0;
  let last = performance.now();
  const t = setInterval(() => {
    const n = performance.now();
    max = Math.max(max, n - last - 5);
    last = n;
  }, 5);
  return async () => (await new Promise((r) => setTimeout(r, 20)), clearInterval(t), max);
};
async function measure(label) {
  await issueCert(root, ['warm.example.com']);
  // 기준선: 아무 일도 안 할 때의 지연(바쁠 때는 OS 스케줄링만으로도 늦어진다)
  let stop0 = lagMeter();
  await new Promise((r) => setTimeout(r, 500));
  const rows = [`기준선 ${(await stop0()).toFixed(0)}ms`];
  for (let k = 0; k < 3; k++) {
    let stop = lagMeter();
    await issueCert(root, [`one${k}.example.com`]);
    const one = await stop();
    stop = lagMeter();
    await Promise.all(Array.from({ length: 20 }, (_, i) => issueCert(root, [`c${k}-${i}.example.com`])));
    rows.push(`1회 ${one.toFixed(0)}ms / 20개 ${(await stop()).toFixed(0)}ms`);
  }
  console.log(`${label}: ${rows.join(' | ')}`);
}

await measure('한가함');
const kids = Array.from({ length: BUSY }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 300));
await measure(`바쁨(바쁜 프로세스 ${BUSY}개, 코어 ${os.cpus().length}개)`);
kids.forEach((k) => k.kill());
fs.rmSync(base, { recursive: true, force: true });
