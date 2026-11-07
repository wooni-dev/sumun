// [PRX-2] 회귀: 기록 기능이 생겨도 계속 지켜야 하고, 기록 기능이 없는 지금도 성립하는 것 (예상 E29). red 대상이 아니다.
// 사례 번호는 docs/ai/prx2-cases.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProxy } from '../../src/proxy/server.ts';
import { closedPort } from './_upstream.ts';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';
import { recordingSetup, send, secret, sha, pattern, childProxy } from './_flow.ts';

const { ctx, U } = recordingSetup();

test('F1: 오류 응답(400, 502, 504)에는 요청에 있던 값(쿼리, Authorization, Cookie)이 나오지 않는다', async () => {
  const s = secret();
  const silent = await startRawUpstream(() => {});
  try {
    const hdr = `Host: x\r\nAuthorization: Bearer ${s}\r\nCookie: k=${s}\r\n\r\n`;
    for (const line of [`GET /x?t=${s} HTTP/1.1`, `GET http://127.0.0.1:${await closedPort()}/?t=${s} HTTP/1.1`, `GET http://127.0.0.1:${silent.port}/?t=${s} HTTP/1.1`]) {
      const r = await rawRequest(ctx.proxy.port, `${line}\r\n${hdr}`, 1500);
      assert.ok([400, 502, 504].includes(r.status), `상태 ${r.status}`);
      assert.ok(!r.raw.includes(s), `응답에 요청 값이 나옴: ${r.raw.slice(0, 300)}`);
    }
  } finally {
    await silent.close();
  }
});

test('F2/D12: 정상·오류·타임아웃 요청을 처리하는 동안 프록시 프로세스는 아무것도 출력하지 않는다', async () => {
  const c = await childProxy('ok');
  const s = secret();
  const silent = await startRawUpstream(() => {});
  try {
    const h = { cookie: `k=${s}`, authorization: `Bearer ${s}` };
    await send(c.port, { target: `http://${U()}/echo?t=${s}`, method: 'POST', headers: h, body: Buffer.from(s) });
    await send(c.port, { target: `http://127.0.0.1:${await closedPort()}/?t=${s}`, headers: h });
    await send(c.port, { target: `http://127.0.0.1:${silent.port}/?t=${s}`, headers: h });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(c.state.out, '');
    assert.equal(c.state.exited, null);
  } finally {
    await silent.close();
    await c.stop();
  }
});

// 시험하는 동안 바뀐 파일 중에 표식이 든 것이 있는지 본다. 임시 폴더는 다른 프로그램도 쓰므로 "새 파일이 없음"이 아니라 "표식이 든 파일이 없음"으로 본다.
function changedFiles(dirs: { dir: string; depth: number }[], since: number) {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0 && e.name !== '.git' && e.name !== 'node_modules') walk(p, depth - 1);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= since - 1000 && st.size < 50_000_000) out.push(p);
        } catch {}
      }
    }
  };
  for (const d of dirs) walk(d.dir, d.depth);
  return out;
}
test('F6: 한도(1MB)보다 큰 본문을 중계해도 기록 내용이 디스크(임시 폴더, 작업 폴더, %APPDATA%\\sumun)에 남지 않는다', async () => {
  const s = secret();
  const since = Date.now();
  const body = Buffer.concat([Buffer.from(s), pattern(1_500_000), Buffer.from(s)]);
  const r = await send(ctx.proxy.port, { target: `http://${U()}/echo`, method: 'POST', headers: { cookie: `k=${s}` }, body });
  assert.equal(sha(r.body), sha(body));
  await new Promise((r) => setTimeout(r, 300));
  const dirs = [
    { dir: os.tmpdir(), depth: 1 },
    { dir: process.cwd(), depth: 6 },
    { dir: path.join(process.env.APPDATA ?? os.homedir(), 'sumun'), depth: 4 },
  ];
  const leaked = changedFiles(dirs, since).filter((p) => {
    try {
      return fs.readFileSync(p).includes(s);
    } catch {
      return false;
    }
  });
  assert.deepEqual(leaked, []);
});

test('I7: onFlow 없이 시작해도 지금처럼 중계한다', async () => {
  const p = await startProxy({ port: 0 });
  try {
    const r = await send(p.port, { target: `http://${U()}/echo`, method: 'POST', body: Buffer.from('no-subscriber') });
    assert.equal(r.body.toString(), 'no-subscriber');
  } finally {
    await p.close();
  }
});
