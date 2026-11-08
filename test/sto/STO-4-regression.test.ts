// [STO-4] 회귀: 실행 진입점(src/index.ts)에 저장소를 연결해도 터미널 출력은 그대로다 — 시작 줄 + 요청마다 요약 줄, 쿠키·본문 없음(F3, prx2-cases F)
// 구현 전에도 통과해야 정상(O9). 저장소는 아직 바깥에서 볼 수 없다(UI 단계).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

async function freePort() {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

test('F3: 저장소를 연결한 npm start — 출력은 시작 줄 1개와 요청마다 요약 줄 1개뿐이고, 쿠키·본문 표식이 stdout·stderr에 없다', async () => {
  const mark = `SUMUN-SECRET-${crypto.randomBytes(8).toString('hex')}`;
  const up = http.createServer((req, res) => (req.resume(), req.on('end', () => res.end(`${mark}-response`))));
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()));
  const upPort = (up.address() as net.AddressInfo).port;
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.ts', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const lines = () => out.split(/\r?\n/).filter(Boolean);
  const wait = async (n: number) => {
    const end = Date.now() + 5000;
    while (lines().length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };
  try {
    await wait(1);
    for (const path of ['/a', '/b']) {
      await new Promise<void>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `http://127.0.0.1:${upPort}${path}?token=${mark}`, headers: { cookie: `k=${mark}` }, agent: false }, (res) => (res.resume(), res.on('end', () => resolve())));
        req.on('error', () => resolve());
        req.end(`${mark}-body`);
      });
    }
    await wait(3);
    assert.equal(lines().length, 3, `출력: ${JSON.stringify(lines())}`);
    assert.match(lines()[0], /127\.0\.0\.1:\d+/);
    for (const l of lines().slice(1)) assert.match(l, /POST 127\.0\.0\.1:\d+ 200 \d+ms$/);
    assert.ok(!out.includes(mark) && !err.includes(mark), '표식이 출력에 없다');
    assert.equal(err, '');
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    await new Promise<void>((r) => (up.closeAllConnections(), up.close(() => r())));
  }
});
