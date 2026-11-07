// [PRX-4] 새 동작: 실행 진입점. 사례 번호는 docs/ai/prx4-cases.md.
//   src/cli.ts   parseArgs(argv) → { port } | { error }, safeText(s, max), formatSummary(flow) → 요약 한 줄
//   src/index.ts node src/index.ts [--port N] — 시작 줄 1개, 요청마다 요약 줄 1개(메서드, 호스트:포트, 상태 또는 실패 코드, 소요 시간)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parseArgs, safeText, formatSummary } from '../../src/cli.ts';
import { closedPort } from './_upstream.ts';
import { startByteUpstream } from './_flow.ts';

// 출력 가능한 ASCII(0x20~0x7E) 밖의 글자가 하나라도 있는가 — 제어 문자, C1, U+2028, bidi를 모두 잡는다
const UNSAFE = /[^\x20-\x7e]/;

// --- L. 인자 ---
test('L: 인자가 없으면 8080, --port N과 --port=N, 경계 1과 65535는 받는다', () => {
  assert.deepEqual(parseArgs([]), { port: 8080 });
  assert.deepEqual(parseArgs(['--port', '9000']), { port: 9000 });
  assert.deepEqual(parseArgs(['--port=9000']), { port: 9000 });
  assert.deepEqual(parseArgs(['--port', '1']), { port: 1 });
  assert.deepEqual(parseArgs(['--port', '65535']), { port: 65535 });
});
const BAD: string[][] = [
  ['--port', '0'], ['--port', '65536'], ['--port', '-1'], ['--port=-1'], // L1
  ['--port', '8080abc'], ['--port', '80 80'], ['--port', '8080.0'], ['--port', '1e3'], ['--port', '0x1F90'], ['--port', '+8080'], ['--port', '08080'], ['--port', 'NaN'], ['--port', 'Infinity'], // L2
  ['--port', ''], ['--port', ' 8080 '], ['--port', '\t8080'], ['--port'], ['--port', '--port'], // L3
  ['--port', '99999999999999999999'], // L4
  ['--port', '８０８０'], ['--port', '٨٠٨٠'], // L5
  ['--port', '9000', '--port', '9001'], ['--port=9000', '--port', '9001'], // L6
  ['--host', '0.0.0.0'], ['--Port', '9000'], ['-p', '9000'], ['--port9000'], ['9000'], // L7
];
for (const argv of BAD) {
  test(`L: ${JSON.stringify(argv)} → 거부(error)`, () => {
    const r = parseArgs(argv);
    assert.equal(typeof r?.error, 'string', JSON.stringify(r));
    assert.equal(r.port, undefined);
  });
}
test('L8/D5: 환경 변수 PORT는 무시한다', () => {
  const before = process.env.PORT;
  process.env.PORT = '9000';
  try {
    assert.deepEqual(parseArgs([]), { port: 8080 });
  } finally {
    if (before === undefined) delete process.env.PORT;
    else process.env.PORT = before;
  }
});
test('L10: 오류 메시지 속 입력값도 이스케이프하고 길이를 제한한다', () => {
  const r = parseArgs(['--port', `\x1b]52;c;${'A'.repeat(10_000)}\x07`]);
  assert.equal(typeof r?.error, 'string');
  assert.ok(!UNSAFE.test(r.error.replace(/[가-힣]/g, '')), `제어 문자가 남음: ${JSON.stringify(r.error.slice(0, 80))}`);
  assert.ok(r.error.length <= 300, `길이 ${r.error.length}`);
});

// --- safeText (D1, D6) ---
test('D1: safeText는 출력 가능한 ASCII 밖의 글자를 \\xNN / \\u{N}로 바꾼다(ESC, BEL, CR, LF, TAB, C1, U+2028, bidi, 한글)', () => {
  for (const s of ['\x1b[2J', '\x1b]52;c;x\x07', 'a\rb\nc\td', '\x9b31m', '\u0085', 'a b', 'moc‮knab', '⁦x', '한']) {
    const out = safeText(s, 100);
    assert.equal(typeof out, 'string');
    assert.ok(!UNSAFE.test(out), `${JSON.stringify(s)} → ${JSON.stringify(out)}`);
  }
  assert.equal(safeText('\x1b', 100), '\\x1b');
  assert.equal(safeText('한', 100), '\\u{d55c}');
  assert.equal(safeText('example.com', 100), 'example.com');
});
test('D6: safeText는 max보다 길면 잘라서 …를 붙인다(결과 길이 ≤ max)', () => {
  const out = safeText('a'.repeat(1000), 255);
  assert.equal(typeof out, 'string');
  assert.ok(out.length <= 255, `길이 ${out.length}`);
  assert.ok(out.endsWith('…'));
});

// --- K. 요약 줄 ---
const CANARY = 'CANARY_';
const flow = (over: any = {}) => ({
  id: 1,
  startedAt: Date.now(),
  durationMs: 12.3,
  request: {
    method: 'GET',
    url: `http://user:${CANARY}pw@example.com/a?token=${CANARY}q`,
    httpVersion: '1.1',
    headers: [['Cookie', `${CANARY}c`], ['Authorization', `${CANARY}a`]],
    body: Buffer.from(`${CANARY}b`),
    bodySize: 9,
    bodyTruncated: false,
    target: { scheme: 'http', host: 'example.com', port: 80, path: `/a?token=${CANARY}q` },
    ...over.request,
  },
  response: 'response' in over ? over.response : { status: 200, statusMessage: `${CANARY}OK`, headers: [['Set-Cookie', `${CANARY}s`]], body: Buffer.from(`${CANARY}rb`), bodySize: 10, bodyTruncated: false },
  error: over.error,
});
test('K14/K1: 요약 줄은 메서드·호스트:포트·상태·소요 시간만 담고, 경로·쿼리·헤더·본문·userinfo·상태 문구는 없다', () => {
  const line = formatSummary(flow());
  assert.equal(typeof line, 'string');
  assert.ok(!line.includes(CANARY), line);
  for (const part of ['GET', 'example.com:80', '200', '12ms']) assert.ok(line.includes(part), `${part} 없음: ${line}`);
  assert.ok(!/[\r\n]/.test(line), '한 줄이어야 함');
});
test('K2: target이 없으면(origin-form 등) 호스트 칸은 -', () => {
  const line = formatSummary(flow({ request: { target: undefined, url: `/path?token=${CANARY}q` }, response: undefined, error: { by: 'proxy', code: 'rejected', status: 400 } }));
  assert.equal(typeof line, 'string');
  assert.ok(!line.includes(CANARY), line);
  assert.match(line, / - /);
  assert.ok(line.includes('rejected') && line.includes('400'), line);
});
test('K12: 실패 칸에는 정해진 코드와 상태만(오류 객체에 다른 값이 붙어 있어도 출력하지 않음)', () => {
  const line = formatSummary(flow({ response: undefined, error: { by: 'upstream', code: 'unreachable', status: 502, message: `${CANARY}m`, input: `${CANARY}i` } }));
  assert.equal(typeof line, 'string');
  assert.ok(line.includes('unreachable') && line.includes('502'), line);
  assert.ok(!line.includes(CANARY), line);
});
test('K4~K11: 호스트·메서드에 제어 문자가 있어도 이스케이프되어 한 줄로 나온다', () => {
  const line = formatSummary(flow({ request: { method: 'G\x1bET', target: { scheme: 'http', host: 'a\x1b[2J\r\nGET bank.com 200 ‮', port: 80, path: '/' } } }));
  assert.equal(typeof line, 'string');
  assert.ok(!UNSAFE.test(line.replace(/…/g, '')), JSON.stringify(line));
  assert.ok(line.includes('\\x1b'), line);
});
test('K9: 아주 긴 호스트도 줄 전체가 512자 이하', () => {
  const line = formatSummary(flow({ request: { target: { scheme: 'http', host: 'a'.repeat(5000), port: 80, path: '/' } } }));
  assert.equal(typeof line, 'string');
  assert.ok(line.length <= 512, `길이 ${line.length}`);
  assert.ok(line.includes('…'));
});
test('M8: 모양이 깨진 기록을 넣어도 예외를 던지지 않고 고정 문구를 돌려준다', () => {
  for (const bad of [undefined, null, {}, { request: null }, { request: { target: { host: Symbol('x') } } }]) {
    let line: unknown;
    assert.doesNotThrow(() => (line = formatSummary(bad as any)));
    assert.equal(typeof line, 'string');
  }
});

// --- index.ts (자식 프로세스) ---
function startCli(args: string[]) {
  const child = spawn(process.execPath, ['src/index.ts', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { out: '', err: '', code: null as number | null };
  child.stdout.on('data', (d) => (st.out += d));
  child.stderr.on('data', (d) => (st.err += d));
  const exited = new Promise<void>((r) => child.on('exit', (code) => ((st.code = code ?? -1), r())));
  const lines = () => st.out.split(/\r?\n/).filter(Boolean);
  // n줄이 나오거나 프로세스가 끝날 때까지(최대 ms) 기다린다
  const waitLines = async (n: number, ms = 3000) => {
    const until = Date.now() + ms;
    while (lines().length < n && st.code === null && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    return lines();
  };
  return { st, lines, waitLines, exited, stop: async () => (st.code === null && child.kill(), await exited) };
}
const raw = (port: number, data: string) =>
  new Promise<void>((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    s.on('data', () => {});
    s.on('close', () => resolve());
    s.on('error', () => resolve());
    setTimeout(() => (s.destroy(), resolve()), 1500);
  });

test('M2/E47: 시작하면 실제 주소가 든 시작 줄 1개, stderr는 비어 있다(경고 없음)', async () => {
  const P = await closedPort();
  const c = startCli(['--port', String(P)]);
  try {
    const ls = await c.waitLines(1);
    assert.equal(ls.length, 1, `stdout: ${c.st.out} / stderr: ${c.st.err} / 종료 ${c.st.code}`);
    assert.ok(ls[0].includes(`127.0.0.1:${P}`), ls[0]);
    assert.equal(c.st.err, '');
  } finally {
    await c.stop();
  }
});
test('K1/K14/E49: 실제 요청의 요약 줄에 userinfo·경로·쿼리·쿠키가 없고, 요청마다 정확히 한 줄', async () => {
  const up = await startByteUpstream();
  const P = await closedPort();
  const c = startCli(['--port', String(P)]);
  try {
    assert.equal((await c.waitLines(1)).length, 1, `시작 줄 없음: ${c.st.err}`);
    await raw(P, `GET http://user:SECRET1@127.0.0.1:${up.port}/p?t=SECRET2 HTTP/1.1\r\nHost: x\r\nCookie: k=SECRET3\r\nConnection: close\r\n\r\n`);
    await raw(P, `GET /p?t=SECRET4 HTTP/1.1\r\nHost: 127.0.0.1:${up.port}\r\nConnection: close\r\n\r\n`);
    const ls = await c.waitLines(3);
    assert.equal(ls.length, 3, `줄 수: ${JSON.stringify(ls)}`);
    assert.ok(!c.st.out.includes('SECRET'), c.st.out);
    assert.ok(ls[1].includes(`127.0.0.1:${up.port}`) && ls[1].includes('201'), ls[1]);
    assert.ok(/ - /.test(ls[2]) && ls[2].includes('400'), ls[2]);
  } finally {
    await c.stop();
    await up.close();
  }
});
for (const args of [['--port', 'abc'], ['--host', '0.0.0.0'], ['--port', '0']]) {
  test(`L/M10: ${args.join(' ')} → 시작하지 않고 종료 코드 1, 스택 트레이스 없음`, async () => {
    const c = startCli(args);
    await Promise.race([c.exited, new Promise((r) => setTimeout(r, 3000))]);
    await c.stop();
    assert.equal(c.st.code, 1, `종료 코드 ${c.st.code}`);
    assert.equal(c.st.out, '');
    assert.ok(c.st.err.length > 0, 'stderr에 이유가 있어야 함');
    assert.ok(!/^\s+at /m.test(c.st.err), c.st.err);
  });
}
test('M1: 포트를 이미 쓰고 있으면 한 줄 오류, 종료 코드 1, 스택 트레이스 없음', async () => {
  const holder = net.createServer();
  await new Promise<void>((r) => holder.listen(0, '127.0.0.1', () => r()));
  const P = (holder.address() as net.AddressInfo).port;
  const c = startCli(['--port', String(P)]);
  try {
    await Promise.race([c.exited, new Promise((r) => setTimeout(r, 3000))]);
    await c.stop();
    assert.equal(c.st.code, 1);
    assert.equal(c.st.out, '');
    assert.match(c.st.err, /이미/);
    assert.ok(!/^\s+at /m.test(c.st.err), c.st.err);
  } finally {
    holder.close();
  }
});
