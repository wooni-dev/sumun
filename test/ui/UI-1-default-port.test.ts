// [UI-1] 결함 재현(O26, 7e0c9e1 기록): 대시보드 기본 포트(프록시 + 1)를 다른 프로그램이 쓰고 있으면 npm start가 종료했다.
// 기대: 기본으로 정한 포트가 차 있으면 다른 빈 포트에서 열고, 시작 줄(한 줄)에 그 주소를 보인다. 차 있는 포트는 쓰지 않는다(U41).
// 직접 준 --dashboard-port가 차 있을 때 멈추는 것은 UI-1.test.ts가 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

const get = (port: number, p: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => (res.resume(), resolve(res.statusCode!)));
    r.on('error', reject);
    r.end();
  });

test('npm start: 기본 대시보드 포트(P+1)를 다른 프로그램이 쓰면 다른 빈 포트에서 열고 시작 줄에 그 주소를 보인다', async () => {
  const holder = net.createServer((s) => s.destroy());
  let P = 0;
  let H = 0;
  // P+1을 잡아 두고, P는 비어 있어야 한다
  for (;;) {
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', () => r()));
    H = (holder.address() as net.AddressInfo).port;
    P = H - 1;
    const free = await new Promise<boolean>((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(P, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) break;
    await new Promise<void>((r) => holder.close(() => r()));
  }
  const child = spawn(process.execPath, ['src/index.ts', '--port', String(P)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let code: number | null = null;
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('exit', (c) => (code = c ?? -1));
  try {
    const end = Date.now() + 5000;
    while (!out.includes('\n') && code === null && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.equal(code, null, `종료하면 안 됨: 종료 ${code}, stderr ${err}`);
    const lines = out.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, out);
    assert.ok(lines[0].includes(`127.0.0.1:${P}`), lines[0]);
    const m = lines[0].match(/http:\/\/127\.0\.0\.1:(\d+)\/#t=([A-Za-z0-9_-]{43,})/);
    assert.ok(m, `대시보드 주소가 있어야 함: ${lines[0]}`);
    const D = Number(m![1]);
    assert.notEqual(D, H, '차 있는 포트는 쓰지 않는다');
    assert.notEqual(D, P);
    assert.equal(await get(D, '/'), 200);
    assert.equal(await get(D, '/api/ping', { authorization: `Bearer ${m![2]}` }), 200);
  } finally {
    if (code === null) child.kill();
    holder.close();
  }
});
