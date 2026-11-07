// [PRX-1c] 회귀: 목적지 쪽·견고성 중 현재 구현(PRX-1 + Node 기본값)이 이미 올바르게 처리하는 것 [확인됨: 2026-11-07 실측]
// red 대상이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { startUpstream, viaProxy, closedPort } from './_upstream.ts';
import { rawRequest } from './_raw.ts';
import { setup } from './_prx1c-setup.ts';

const { ctx, U, arrived, alive, withRaw, get } = setup();

// --- A. 바인딩·포트 ---
test('A2: LAN 주소로는 프록시에 접속할 수 없다', async (t) => {
  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && !a.internal && a.family === 'IPv4');
  if (!lan) return t.skip('LAN IPv4 주소 없음');
  const err = await new Promise<string>((r) => {
    const s = net.connect(ctx.proxy.port, lan.address, () => (s.destroy(), r('연결됨')));
    s.on('error', (e: NodeJS.ErrnoException) => r(e.code ?? 'error'));
  });
  assert.equal(err, 'ECONNREFUSED');
});
test('A7: 다른 프로그램이 같은 127.0.0.1 포트를 쓰면 시작에 실패한다(다른 포트로 몰래 뜨지 않음)', async () => {
  await assert.rejects(startProxy({ port: ctx.up.port }));
});
test('A8: 같은 포트로 프록시 두 개를 띄우면 두 번째는 실패한다', async () => {
  await assert.rejects(startProxy({ port: ctx.proxy.port }));
});

// --- B. 루프·견고성 ---
// WHATWG URL이 127.1, 2130706433, 0x7f000001을 127.0.0.1로 정규화한다 → 508. 127.0.0.2는 아무도 듣지 않아 502
for (const host of ['127.1', '2130706433', '0x7f000001', '127.0.0.2']) {
  test(`B2: ${host}:<프록시 포트>는 루프로 막히거나(508) 닿지 않는다(502). 무한 반복 없음`, async () => {
    const r = await rawRequest(ctx.proxy.port, `GET http://${host}:${ctx.proxy.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`, 2000);
    assert.ok([502, 508].includes(r.status), `상태 ${r.status}`);
    await alive();
  });
}
test('B6: NODE_USE_ENV_PROXY=1 + HTTP_PROXY가 이 프록시를 가리켜도 바깥 연결은 환경 프록시를 따르지 않는다', async () => {
  const PP = await closedPort();
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { startProxy } from './src/proxy/server.ts'; await startProxy({ port: ${PP} }); console.log('ready');`], {
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: `http://127.0.0.1:${PP}`, http_proxy: `http://127.0.0.1:${PP}`, NO_PROXY: '' },
  });
  try {
    await new Promise((r) => child.stdout.once('data', r));
    assert.equal((await viaProxy(PP, { target: `http://${U()}/b6` })).status, 201);
  } finally {
    child.kill();
  }
});
test('B7: 목적지가 응답 없이 바로 끊으면 502', async () => {
  const r = await withRaw((s) => s.destroy(), get());
  assert.equal(r.status, 502);
  await alive();
});
test('B7: 목적지가 응답 도중 끊으면, 클라이언트에 잘린 응답을 완전한 것처럼 끝내지 않는다', async () => {
  const r = await withRaw((s) => {
    s.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial');
    setTimeout(() => s.destroy(), 50);
  }, get());
  assert.equal(r.status, 200);
  assert.ok(!/\r\n0\r\n\r\n$/.test(r.raw), '정상 종료(마지막 chunk)처럼 보이면 안 됨');
  assert.ok(r.raw.length < 200, '본문 100바이트를 다 받은 것처럼 보이면 안 됨');
  await alive();
});
test('B7: 클라이언트가 업로드 도중 끊어도 프록시는 계속 동작한다', async () => {
  await new Promise<void>((r) => {
    const s = net.connect(ctx.proxy.port, '127.0.0.1', () => {
      s.write(`POST http://${U()}/b7 HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nabc`);
      setTimeout(() => (s.resetAndDestroy(), setTimeout(r, 200)), 100);
    });
    s.on('error', () => {});
  });
  await alive();
});
test('B9: 큰 본문(업로드 20MB, 다운로드 20MB)을 바이트 그대로 전달한다', async () => {
  const size = 20 * 1024 * 1024;
  const big = crypto.randomBytes(size);
  const hash = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('x-upload-sha', hash(Buffer.concat(chunks)));
      res.end(big);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  try {
    const port = (server.address() as net.AddressInfo).port;
    const { sha, down } = await new Promise<{ sha: string; down: Buffer }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ctx.proxy.port, method: 'POST', path: `http://127.0.0.1:${port}/big`, agent: false, headers: { 'content-length': size } });
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ sha: String(res.headers['x-upload-sha']), down: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(big);
    });
    assert.equal(sha, hash(big), '업로드 바이트가 다름');
    assert.equal(hash(down), hash(big), '다운로드 바이트가 다름');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('B10: 존재하지 않는 도메인(.invalid)은 502', async () => {
  const r = await rawRequest(ctx.proxy.port, `GET http://nonexistent.invalid/ HTTP/1.1\r\nHost: x\r\n\r\n`, 5000);
  assert.equal(r.status, 502);
});
for (const [name, resp] of [
  ['상태줄이 없음', 'garbage\r\n\r\n'],
  ['CL과 TE가 함께 있음', 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n'],
  ['서로 다른 CL 두 개', 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nabcdef'],
]) {
  test(`B11: 목적지 응답이 깨져 있으면(${name}) 502`, async () => {
    const r = await withRaw((s) => s.end(resp), get());
    assert.equal(r.status, 502);
  });
}

// --- C11 IPv6 목적지 ---
test('C11: IPv6 목적지 [::1]에 연결하고 Host를 [::1]:P로 넘긴다', async (t) => {
  let host = '';
  const server = http.createServer((q, s) => ((host = q.headers.host ?? ''), s.end('v6')));
  try {
    await new Promise<void>((r, j) => (server.once('error', j), server.listen(0, '::1', () => r())));
  } catch {
    return t.skip('이 PC에서 ::1에 바인딩할 수 없음');
  }
  const port = (server.address() as net.AddressInfo).port;
  try {
    const r = await viaProxy(ctx.proxy.port, { target: `http://[::1]:${port}/` });
    assert.equal(r.status, 200);
    assert.equal(host, `[::1]:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// --- D. 경계 ---
test('D11: Expect: 100-continue + 본문 요청이 멈추지 않고 끝까지 완료된다', async () => {
  const r = await new Promise<{ status: number; continued: boolean }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: ctx.proxy.port, method: 'POST', path: `http://${U()}/d11`, agent: false, headers: { expect: '100-continue', 'content-length': 4 } });
    let continued = false;
    req.on('continue', () => ((continued = true), req.end('body')));
    req.on('response', (res) => (res.resume(), res.on('end', () => resolve({ status: res.statusCode ?? 0, continued }))));
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('3초 안에 끝나지 않음')));
  });
  assert.equal(r.continued, true);
  assert.equal(r.status, 201);
  assert.equal(arrived()[0].body, 'body');
});
test('D12: HEAD 응답에 목적지가 Content-Length를 붙여도 본문 바이트가 가지 않고, 다음 요청이 꼬이지 않는다', async () => {
  const r = await withRaw((s, req) => {
    if (req.startsWith('HEAD')) s.write('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n');
  }, (port) => `HEAD http://127.0.0.1:${port}/ HTTP/1.1\r\nHost: x\r\n\r\nGET http://${U()}/after-head HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(r.responses, 2);
  assert.equal(arrived()[0]?.url, '/after-head');
});
for (const code of [204, 304]) {
  test(`D12: ${code} 응답에는 본문이 없고 다음 요청이 꼬이지 않는다`, async () => {
    const r = await withRaw((s) => s.write(`HTTP/1.1 ${code} X\r\n\r\n`), (port) => `GET http://127.0.0.1:${port}/ HTTP/1.1\r\nHost: x\r\n\r\nGET http://${U()}/after HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.equal(r.responses, 2);
    assert.equal(arrived()[0]?.url, '/after');
  });
}
test('D13: 목적지 응답에 CL도 TE도 없으면(연결 종료로 끝) 본문을 온전히 받는다', async () => {
  const r = await withRaw((s) => s.end('HTTP/1.1 200 OK\r\n\r\nuntil-close-body'), get());
  assert.equal(r.status, 200);
  assert.match(r.raw, /until-close-body/);
});
test('D16: 목적지 응답 헤더가 한도를 넘으면 502', async () => {
  const r = await withRaw((s) => s.end(`HTTP/1.1 200 OK\r\nX-Big: ${'a'.repeat(70_000)}\r\nContent-Length: 0\r\n\r\n`), get());
  assert.equal(r.status, 502);
});

// --- E. 업그레이드·응답 헤더 ---
test('E7: 클라이언트의 Upgrade 요청(websocket)도 Upgrade를 넘기지 않고 일반 요청으로 처리하거나 거부한다', async () => {
  const r = await rawRequest(ctx.proxy.port, `GET http://${U()}/ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.ok(r.status >= 200, `응답이 있어야 함(상태 ${r.status})`);
  for (const s of arrived()) assert.equal(s.headers.upgrade, undefined, 'Upgrade가 목적지로 넘어감');
  await alive();
});
test('E9: 목적지의 chunked 응답을 넘길 때 경계는 하나뿐이다(CL과 TE가 함께 있지 않음, 이중 chunked 없음)', async () => {
  const r = await withRaw((s) => s.end('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n0\r\n\r\n'), get());
  const head = r.raw.split('\r\n\r\n')[0].toLowerCase();
  assert.equal(r.status, 200);
  assert.ok(!(head.includes('content-length') && head.includes('transfer-encoding')), head);
  assert.ok((head.match(/transfer-encoding/g) ?? []).length <= 1);
  assert.match(r.raw, /hello/);
});
test('E10: 클라이언트가 Connection: close를 보내면 응답 뒤 클라이언트 연결이 닫힌다', async () => {
  const r = await rawRequest(ctx.proxy.port, `GET http://${U()}/e10 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 2000);
  assert.equal(r.status, 201);
});
test('E11: keep-alive 연결 하나로 서로 다른 목적지 A, B에 연달아 요청해도 섞이지 않는다', async () => {
  const b = await startUpstream((_q, res) => res.end('from-B'));
  try {
    const r = await rawRequest(ctx.proxy.port, `GET http://${U()}/a HTTP/1.1\r\nHost: x\r\n\r\nGET http://127.0.0.1:${b.port}/b HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.equal(r.responses, 2);
    assert.ok(r.raw.indexOf('from-upstream') < r.raw.indexOf('from-B'), '순서와 내용이 맞아야 함');
    assert.equal(arrived()[0].url, '/a');
    assert.equal(b.seen[0].url, '/b');
  } finally {
    await b.close();
  }
});
test('E12: 응답의 Set-Cookie 여러 줄을 합치지 않고 순서대로 보존한다', async () => {
  const r = await withRaw((s) => s.end('HTTP/1.1 200 OK\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'), get());
  const cookies = [...r.raw.matchAll(/^set-cookie: (.*)$/gim)].map((m) => m[1].trim());
  assert.deepEqual(cookies, ['a=1', 'b=2']);
});
