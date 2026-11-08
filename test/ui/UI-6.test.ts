// [UI-6] 화면 고침 — 새 동작(구현 전에는 실패해야 정상). 사례: docs/ai/ui6-cases.md K1~K37, 설계 G-1~G-7
//   view.js 순수 함수는 직접 부르고(가짜 시계로 시간을 돌린다 — O43: 절대 시간이 아니라 호출 횟수·순서로 판정),
//   서버·프록시 문구는 실제로 띄워 받고, app.js는 소스 검사(긍정 전제)와 브라우저 실측(E197)으로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as view from '../../src/dashboard/public/view.js';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import { DASHBOARD_REFUSAL } from '../../src/tls/tunnel.ts';

const V = view as any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function code(file: string) {
  const p = `src/dashboard/public/${file}`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// 가짜 시계: setTimeout·clearTimeout·now를 주입하고 advance(ms)로 시간을 돌린다
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock = {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => (timers.set(++seq, { at: t + Math.max(0, ms), fn }), seq),
    clearTimeout: (id: number) => void timers.delete(id),
  };
  async function advance(ms: number) {
    const end = t + ms;
    for (;;) {
      await flush();
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
    await flush();
  }
  return { clock, advance, get t() { return t; } };
}

function req(port: number, urlPath: string, { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

// --- G-1 필터 갱신 ---
test('createRefresher(G-1, K1·K4): 알림이 200ms마다 3초 동안 와도 1초 안에는 실행하고, 끝난 뒤에도 마지막 요청을 반영한다', async () => {
  const c = fakeClock();
  const runs: number[] = [];
  const r = V.createRefresher(async () => void runs.push(c.t), { waitMs: 300, maxWaitMs: 1000, timers: c.clock });
  assert.equal(typeof r?.request, 'function', 'request()가 있다');
  for (let i = 0; i < 15; i++) {
    r.request();
    await c.advance(200);
  }
  assert.ok(runs.length >= 3, `3초 동안 3번 이상 실행(K1): ${JSON.stringify(runs)}`);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i] - runs[i - 1] <= 1000, `실행 간격 1초 이하: ${JSON.stringify(runs)}`);
  const lastRequest = c.t - 200;
  await c.advance(400);
  assert.ok(runs.at(-1)! >= lastRequest, `마지막 요청(${lastRequest}) 뒤에 한 번 더 실행(K4): ${JSON.stringify(runs)}`);
  const n = runs.length;
  await c.advance(5000);
  assert.equal(runs.length, n, '요청이 없으면 더 실행하지 않는다');
});

test('createRefresher(G-1, K2·K5·K6): 실행은 한 번에 하나, 실행 중 온 요청은 끝난 뒤 한 번만 더, throw해도 다음 요청을 받는다, now()는 기다리지 않는다', async () => {
  const c = fakeClock();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  let release: (() => void) | undefined;
  let fail = false;
  const r = V.createRefresher(
    () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (fail) {
        active--;
        throw new Error('조회 실패');
      }
      return new Promise<void>((res) => (release = () => (active--, res())));
    },
    { waitMs: 300, maxWaitMs: 1000, timers: c.clock },
  );
  assert.equal(typeof r?.now, 'function', 'now()가 있다');
  r.now();
  await c.advance(0);
  assert.equal(calls, 1, 'now()는 바로 실행');
  for (let i = 0; i < 10; i++) (r.request(), await c.advance(200));
  assert.equal(calls, 1, '실행 중에는 새로 시작하지 않는다(K2·K6)');
  release!();
  await c.advance(1000);
  assert.equal(calls, 2, '끝난 뒤 밀린 요청을 한 번에');
  assert.equal(maxActive, 1, '동시 실행 1개');
  release!();
  await c.advance(10);
  fail = true;
  r.request();
  await c.advance(1000);
  assert.equal(calls, 3, '실패하는 실행');
  fail = false;
  r.request();
  await c.advance(1000);
  assert.equal(calls, 4, '실패 뒤에도 다음 요청을 받는다(K5)');
  release!();
});

// --- G-2 터널 표시 ---
test('tunnelOutcome(G-2, K31~K34): 터널에서 ↑↓ 모두 있고 client aborted일 때만 closed, 목적지가 끊음·응답 없음·빈 터널은 failed, 터널이 아니면 null', () => {
  const t = (up: number, down: number, error?: object) => ({ method: 'CONNECT', tunnel: { bytesUp: up, bytesDown: down, address: '1.2.3.4' }, ...(error ? { error } : {}) });
  const ca = { by: 'client', code: 'aborted' };
  assert.equal(V.tunnelOutcome(t(5, 5, ca))?.kind, 'closed', 'T1 데이터 뒤 브라우저 RST');
  assert.equal(V.tunnelOutcome(t(5, 5))?.kind, 'ok', 'T2 FIN');
  assert.equal(V.tunnelOutcome(t(14, 0, ca))?.kind, 'failed', 'T3 목적지 무응답(K32)');
  assert.equal(V.tunnelOutcome(t(0, 0, ca))?.kind, 'failed', 'T4 아무것도 없음(K32)');
  assert.equal(V.tunnelOutcome(t(1, 7, { by: 'upstream', code: 'aborted' }))?.kind, 'failed', 'T5 목적지가 끊음(K31)');
  assert.equal(V.tunnelOutcome(t(5, 5, { by: 'proxy', code: 'timeout' }))?.kind, 'failed', '그 밖의 오류');
  const closed = V.tunnelOutcome(t(5, 5, ca));
  assert.ok(/브라우저/.test(closed.text) && /닫/.test(closed.text), `closed 문구: ${closed.text}`);
  assert.ok(!/정상/.test(closed.text), '"정상"이라 하지 않는다(K33)');
  assert.equal(V.tunnelOutcome({ method: 'GET', error: ca }), null, '터널이 아닌 기록(K34)');
  assert.equal(V.tunnelOutcome({ method: 'CONNECT', error: ca }), null, '복호화 CONNECT(tunnel 칸 없음)(K34)');
});

// --- G-5 헤더 UTF-8 ---
test('utf8View(G-5, K10~K13): U+00FF 이하 글자만이고 U+0080 이상이 있을 때만 엄격하게 풀고, 원래 바이트는 글자 코드 그대로 16진', () => {
  assert.deepEqual(V.utf8View('aâ\u0080®b'), { text: 'a‮b', hex: '61 e2 80 ae 62' }, 'U+202E(E2 80 AE)');
  assert.deepEqual(V.utf8View('í\u0095\u009cê¸\u0080'), { text: '한글', hex: 'ed 95 9c ea b8 80' });
  assert.deepEqual(V.utf8View('Ã©'), { text: 'é', hex: 'c3 a9' }, '진짜 latin1과 구별할 수 없으므로 표시와 원본을 함께(K12)');
  assert.equal(V.utf8View('plain ascii'), null, 'ASCII만이면 풀지 않음');
  assert.equal(V.utf8View('À¯'), null, '잘못된 UTF-8(C0 AF)은 풀지 않음(K11)');
  assert.equal(V.utf8View('a\u0080b'), null, '홀로 있는 이어짐 바이트(K11)');
  assert.equal(V.utf8View('í \u0080'), null, '서로게이트(ED A0 80)(K11)');
  assert.equal(V.utf8View('aŁbâ\u0080®'), null, 'U+00FF보다 큰 글자가 있으면 풀지 않음(K13)');
  assert.equal(V.utf8View(''), null);
});

test('showHidden 넓힘(G-5, K8·K9): 다시 푼 글자의 보이지 않는 문자도 ⟨U+…⟩, 이모지 표시 선택자는 그대로', () => {
  for (const cp of [0x034f, 0x115f, 0x1160, 0x180e, 0x2028, 0x2029, 0x206a, 0x206f, 0x3164, 0xffa0, 0xfff9, 0xfffb, 0xe0001, 0xe0041, 0xe007f]) {
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    assert.equal(V.showHidden(`a${String.fromCodePoint(cp)}b`), `a⟨U+${hex}⟩b`, `U+${hex}`);
  }
  assert.equal(V.showHidden('❤️ 👍🏽'), '❤️ 👍🏽', 'U+FE0F·피부색은 그대로(G-5 결정)');
  assert.equal(V.showHidden('a‮b'), 'a⟨U+202E⟩b', '긍정 전제: 기존 표시');
  const v = V.utf8View('OK â\u0080®gnp.exe');
  assert.equal(V.showHidden(v?.text), 'OK ⟨U+202E⟩gnp.exe', '다시 푼 상태 문구(K9)');
});

// --- G-4·G-6 서버 ---
test('아이콘(G-4, K21~K23): /favicon.svg는 스크립트 없는 SVG 200, /favicon.ico는 204, 둘 다 요청 검사·메서드·보안 헤더를 탄다', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    const svg = await req(d.port, '/favicon.svg');
    assert.equal(svg.status, 200);
    assert.equal(svg.headers['content-type'], 'image/svg+xml');
    assert.equal(svg.headers['x-content-type-options'], 'nosniff');
    assert.ok(String(svg.headers['content-security-policy']).startsWith("default-src 'self'"));
    assert.ok(svg.body.toString().includes('<svg'), '긍정 전제: SVG 본문');
    assert.ok(!/<script|\son\w+\s*=|href|xlink|url\(|<foreignObject/i.test(svg.body.toString()), 'SVG에 스크립트·이벤트·링크·외부 자원 없음');
    for (const p of ['/favicon.ico', '/favicon.ico?v=1']) {
      const ico = await req(d.port, p);
      assert.equal(ico.status, 204, p);
      assert.equal(ico.body.length, 0, p);
      assert.equal(ico.headers['x-content-type-options'], 'nosniff', p);
    }
    for (const p of ['/favicon.svg', '/favicon.ico']) {
      assert.equal((await req(d.port, p, { headers: { host: `evil.example:${d.port}` } })).status, 403, `${p} Host`);
      assert.equal((await req(d.port, p, { headers: { via: '1.1 sumun' } })).status, 403, `${p} Via`);
      assert.equal((await req(d.port, p, { method: 'POST' })).status, 405, `${p} POST`);
    }
    assert.ok(/<link\s+rel="icon"\s+href="\/favicon\.svg"/.test(readFileSync('src/dashboard/public/index.html', 'utf8')), 'index.html이 아이콘을 가리킨다(K22)');
  } finally {
    await d.close();
  }
});

test('403 문구(G-6, K35~K37): 원인과 상관없이 "터미널에 나온 대시보드 주소를 주소창에 직접"으로 시작, 복사하라고 하지 않음', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    const cases: Record<string, string>[] = [{ host: `evil.example:${d.port}` }, { origin: 'http://evil.example' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { via: '1.1 sumun' }];
    for (const h of cases) {
      const r = await req(d.port, '/', { headers: h });
      assert.equal(r.status, 403, JSON.stringify(h));
      const text = r.body.toString();
      assert.ok(text.startsWith('터미널에 나온 대시보드 주소'), `${JSON.stringify(h)}: ${text}`);
      assert.ok(/주소창/.test(text), '주소창에 직접');
      assert.ok(!/복사/.test(text), '복사하라고 하지 않는다(K37)');
    }
  } finally {
    await d.close();
  }
});

// --- G-7 loopback 안내 ---
test('프록시 거절 문구(G-7, K25~K27·K29·K30): <-loopback> 뒤에 대시보드 주소(포트 붙음)를 덧붙이라는 고정 문구', () => {
  const s = String(DASHBOARD_REFUSAL);
  assert.ok(s.includes('프록시를 거치지 않고'), '긍정 전제: UI-2의 안내 표지');
  const ex = '<-loopback>;127.0.0.1:<대시보드 포트>;localhost:<대시보드 포트>';
  assert.ok(s.includes(ex), `예시 그대로(K25·K26 순서): ${s}`);
  assert.ok(/뒤에/.test(s), '순서를 말한다(K26)');
  assert.ok(/Chrome/.test(s) && /Edge/.test(s), '범위를 말한다(K29)');
  assert.ok(!s.includes('\n'), '한 줄');
});

function startCli(args: string[]) {
  const child = spawn(process.execPath, ['src/index.ts', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { out: '', err: '', code: null as number | null };
  child.stdout.on('data', (d) => (st.out += d));
  child.stderr.on('data', (d) => (st.err += d));
  const exited = new Promise<void>((r) => child.on('exit', (code) => ((st.code = code ?? -1), r())));
  const waitOut = async (ms = 5000) => {
    const end = Date.now() + ms;
    while (!st.out.includes('\n') && st.code === null && Date.now() < end) await wait(20);
  };
  return { st, waitOut, stop: async () => (st.code === null && child.kill(), await exited) };
}
function raw(port: number, data: string, ms = 3000) {
  return new Promise<string>((resolve) => {
    let text = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    s.on('data', (c) => (text += c));
    s.on('close', () => resolve(text));
    s.on('error', () => {});
    s.setTimeout(ms, () => s.destroy());
  });
}

// 포트가 비었는지(잠깐 열었다 닫아 본다)
const portFree = (p: number) =>
  new Promise<boolean>((r) => {
    const s = net.createServer();
    s.once('error', () => r(false));
    s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
  });
// 임시 포트 범위(49152~) 밖에서 P와 P+1이 모두 빈 번호. 임시 포트(port 0)를 비워 쓰면 npm start의 점유 검사가 P+1에 연결할 때
// 병렬로 도는 다른 테스트가 port 0으로 받은 서버와 겹친다(Windows는 임시 포트를 연속 번호로 준다 — UI-2:172 실패, 6cbe3dc 기록)
async function freePortPairOutsideEphemeral() {
  for (let i = 0; i < 200; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if ((await portFree(p)) && (await portFree(p + 1))) return p;
  }
  throw new Error('빈 포트 쌍을 찾지 못했습니다');
}

test('터미널 안내(G-7, K28): 프록시를 거친 대시보드 요청이 오면 실제 대시보드 포트로 <-loopback> 예시를 한 줄로', async () => {
  const P = await freePortPairOutsideEphemeral();
  const c = startCli(['--port', String(P)]);
  try {
    await c.waitOut();
    const D = Number(c.st.out.match(/http:\/\/127\.0\.0\.1:(\d+)\/#t=/)?.[1]);
    assert.ok(D > 0, `시작 줄: ${c.st.out} / ${c.st.err}`);
    await raw(P, `GET http://127.0.0.1:${D}/ HTTP/1.1\r\nHost: 127.0.0.1:${D}\r\nConnection: close\r\n\r\n`);
    await wait(300);
    const guide = c.st.out.split(/\r?\n/).find((l) => l.includes('프록시를 거치지 않고'));
    assert.ok(guide, `안내 줄: ${c.st.out}`);
    assert.ok(guide.includes(`<-loopback>;127.0.0.1:${D};localhost:${D}`), `실제 포트로: ${guide}`);
  } finally {
    await c.stop();
  }
});

// --- G-1·G-2·G-3·G-5 화면 소스 ---
test('화면 소스(G-1~G-3, G-5): 토큰을 읽자마자 replaceState(null)로 주소에서 지우고, hashchange면 다시 읽기, refresher·tunnelOutcome·utf8View를 쓴다', () => {
  const app = code('app.js');
  assert.ok(app.includes('textContent'), '긍정 전제(O30): app.js가 있다');
  assert.ok(/tokenFromHash\(location\.hash\);?\s*\n[\s\S]{0,400}?history\.replaceState\(null,/.test(app), '토큰을 읽은 바로 뒤에 replaceState(null, …)(K15·K16·K18)');
  assert.ok(/addEventListener\(\s*['"]hashchange['"]/.test(app) && /location\.reload\(\)/.test(app), '같은 탭의 새 #t=는 다시 읽기(K17)');
  assert.ok(/새로고침/.test(app), '토큰 없음 문구가 새로고침을 말한다(K20)');
  assert.ok(/createRefresher\(/.test(app), '필터 갱신은 refresher로(G-1)');
  assert.ok(!/filterTimer/.test(app), '알림마다 타이머를 다시 거는 방식은 없앤다(K1)');
  assert.ok(/tunnelOutcome\(/.test(app) && /터널 실패/.test(app), '터널 표시(G-2)');
  assert.ok(/utf8View\(/.test(app) && /UTF-8로 풀어 보임/.test(app), '헤더 UTF-8 표시(G-5)');
});
