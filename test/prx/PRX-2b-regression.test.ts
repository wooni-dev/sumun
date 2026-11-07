// [PRX-2b] 회귀: 배정 "2b" 사례 중 PRX-2 구현이 이미 올바르게 처리하는 것 [확인됨: 2026-11-07 실측]. red 대상이 아니다.
// 사례 번호는 docs/ai/prx2-cases.md. 새 동작은 PRX-2b.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { startProxy } from '../../src/proxy/server.ts';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';
import { recordingSetup, send, secret, childProxy } from './_flow.ts';

const { ctx, take, U } = recordingSetup();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- F. 유출 ---
test('F3/H13: Node 파서가 거절한 요청(잘못된 헤더 줄) → 400, 응답·출력에 요청 값이 없고 기록도 없다', async () => {
  const c = await childProxy('ok');
  const s = secret();
  try {
    const r = await rawRequest(c.port, `GET http://${U()}/ HTTP/1.1\r\nAuthorization: Bearer ${s}\r\nBad Header Line\r\n\r\n`, 1000);
    assert.equal(r.status, 400);
    assert.ok(!r.raw.includes(s), '응답에 요청 값이 나오면 안 됨');
    await sleep(200);
    assert.equal(c.state.flows, 0, '파서 단계에서 거절된 요청은 기록하지 않는다(D4)');
    assert.equal(c.state.out, '');
  } finally {
    await c.stop();
  }
});
test('F5: 요청을 처리하는 도중에 프록시 프로세스를 끝내도 기록 내용을 출력하지 않는다', async () => {
  const c = await childProxy('ok');
  const s = secret();
  const silent = await startRawUpstream(() => {});
  try {
    const sock = net.connect(c.port, '127.0.0.1', () => sock.write(`POST http://127.0.0.1:${silent.port}/?t=${s} HTTP/1.1\r\nHost: x\r\nCookie: k=${s}\r\nContent-Length: 100\r\n\r\n${s}`));
    sock.on('error', () => {});
    await sleep(150);
    await c.stop();
    sock.destroy();
    assert.ok(!c.state.out.includes(s), `출력: ${c.state.out.slice(0, 300)}`);
  } finally {
    await silent.close();
  }
});
test('F7: 실행 스크립트에 힙 스냅샷·진단 리포트 플래그가 없다(메모리의 기록이 디스크로 나가는 길)', () => {
  const FLAGS = /--(heapsnapshot|heap-prof|cpu-prof|report-on|report-uncaught|report-dir|diagnostic-dir|prof\b)/;
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) assert.ok(!FLAGS.test(String(cmd)), `package.json scripts.${name}`);
  for (const f of fs.readdirSync('scripts', { recursive: true }) as string[]) {
    const p = path.join('scripts', f);
    if (fs.statSync(p).isFile()) assert.ok(!FLAGS.test(fs.readFileSync(p, 'utf8')), p);
  }
});

// --- G. 자원 ---
test('G3: 거짓 Content-Length(9999999999)로 기록 메모리를 미리 잡지 않는다(연결 50개)', async () => {
  const before = process.memoryUsage().arrayBuffers;
  const socks = Array.from({ length: 50 }, () => {
    const s = net.connect(ctx.proxy.port, '127.0.0.1', () => s.write(`POST http://${U()}/echo HTTP/1.1\r\nHost: x\r\nContent-Length: 9999999999\r\n\r\n0123456789`));
    s.on('error', () => {});
    return s;
  });
  await sleep(150);
  const grown = process.memoryUsage().arrayBuffers - before;
  for (const s of socks) s.destroy();
  await take(50, 3000); // 끊긴 연결 50개의 기록이 다음 테스트로 넘어가지 않게 여기서 받는다
  assert.ok(grown < 10 * 1048576, `arrayBuffers ${Math.round(grown / 1048576)}MB 늘어남`);
});
test('G4: gzip 응답은 압축된 그대로 기록한다(기록 단계에서 풀지 않음 — 압축 폭탄)', async () => {
  const gz = zlib.gzipSync(Buffer.alloc(50 * 1048576)); // 풀면 50MB
  const raw = await startRawUpstream((s) => s.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${gz.length}\r\n\r\n`), gz])));
  try {
    const r = await send(ctx.proxy.port, { target: `http://127.0.0.1:${raw.port}/` });
    assert.deepEqual(r.body, gz, '클라이언트도 압축된 그대로 받는다');
    const [f] = await take(1);
    assert.deepEqual(f.response.body, gz);
    assert.equal(f.response.bodySize, gz.length);
  } finally {
    await raw.close();
  }
});
test('G7: 요청 본문을 보내다 멈추면 정해진 시간 뒤 끝나고 기록 1번(504)', async () => {
  const s = net.connect(ctx.proxy.port, '127.0.0.1', () => s.write(`POST http://${U()}/echo HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\na`));
  s.on('error', () => {});
  try {
    const [f] = await take(1, 3000);
    assert.deepEqual(f.error, { by: 'upstream', code: 'timeout', status: 504 });
    assert.equal(f.request.bodySize, 1);
  } finally {
    s.destroy();
  }
});
test('G8: 구독자에게 넘긴 뒤에는 프록시가 기록을 붙잡지 않는다(gc 뒤 남지 않음)', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const refs: WeakRef<object>[] = [];
  const p = await startProxy({ port: 0, onFlow: (f: any) => void refs.push(new WeakRef(f)) } as Parameters<typeof startProxy>[0]);
  try {
    for (let i = 0; i < 20; i++) await send(p.port, { target: `http://${U()}/echo`, method: 'POST', body: Buffer.alloc(10_000, 0x61) });
    await sleep(100);
    assert.equal(refs.length, 20);
    for (let i = 0; i < 3; i++) (gc(), await sleep(20));
    assert.equal(refs.filter((r) => r.deref()).length, 0, '남은 기록 수');
  } finally {
    await p.close();
  }
});
// --- H. 정확성 ---
test('H6: 헤더 값의 앞뒤 공백은 지워지고(D8), 0x80~0xFF 바이트는 latin1로 손실 없이 복원된다', async () => {
  const value = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0xff]);
  const req = Buffer.concat([Buffer.from(`GET http://${U()}/ HTTP/1.1\r\nHost: x\r\nX-Pad:   v  \r\nX-Latin: `), value, Buffer.from('\r\nConnection: close\r\n\r\n')]);
  await new Promise<void>((resolve) => {
    const s = net.connect(ctx.proxy.port, '127.0.0.1', () => s.write(req));
    s.on('data', () => {});
    s.on('close', () => resolve());
    s.on('error', () => resolve());
  });
  const [f] = await take(1);
  const get = (n: string) => f.request.headers.find(([k]: [string]) => k === n)?.[1];
  assert.equal(get('X-Pad'), 'v');
  assert.deepEqual(Buffer.from(get('X-Latin'), 'latin1'), value);
});
test('H16: Expect: 100-continue 요청은 최종 응답(200)을 기록한다', async () => {
  const r = await rawRequest(ctx.proxy.port, `POST http://${U()}/echo HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello`, 1500);
  assert.match(r.raw, /HTTP\/1\.1 200/);
  const [f] = await take(1);
  assert.equal(f.response.status, 200);
  assert.equal(f.response.body.toString(), 'hello');
});
test('H16: 목적지가 103 Early Hints 뒤에 200을 보내면 200을 기록하고, 103의 헤더는 섞이지 않는다(D9)', async () => {
  const raw = await startRawUpstream((s) => s.end('HTTP/1.1 103 Early Hints\r\nLink: </a.css>; rel=preload\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'));
  try {
    const r = await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1500);
    assert.match(r.raw, /HTTP\/1\.1 200/);
    const [f] = await take(1);
    assert.equal(f.response.status, 200);
    assert.equal(f.response.headers.some(([n]: [string]) => n.toLowerCase() === 'link'), false);
  } finally {
    await raw.close();
  }
});

// --- I. 구독자 ---
test('I3: async 구독자가 오래 걸려도(3초) 다음 요청이 늦어지지 않는다', async () => {
  const p = await startProxy({ port: 0, onFlow: async () => sleep(3000) } as Parameters<typeof startProxy>[0]);
  try {
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) assert.equal((await send(p.port, { target: `http://${U()}/x` })).status, 201);
    assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0}ms`);
  } finally {
    await p.close();
  }
});
test('I7: 구독자 안에서 프록시를 닫아도 프로세스가 죽지 않고 닫기가 끝난다', async () => {
  let closed: Promise<void> | undefined;
  const p = await startProxy({ port: 0, onFlow: () => void (closed = p.close()) } as Parameters<typeof startProxy>[0]);
  const r = await send(p.port, { target: `http://${U()}/x` });
  assert.equal(r.status, 201);
  for (let i = 0; i < 100 && !closed; i++) await sleep(20);
  assert.ok(closed, '구독자가 불려야 함');
  await Promise.race([closed, sleep(2000).then(() => assert.fail('2초 안에 닫혀야 함'))]);
});
