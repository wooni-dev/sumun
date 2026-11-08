// [UI-5] 화면 — 새 동작(구현 전에는 실패해야 정상). 사례: docs/ai/ui-cases.md U13·U18·U19·U22~U27·U30·U49·U50, 결정 D-3·D-11·D-14~D-16, STO 보고서 결정 4
//   view.js = DOM 없는 순수 함수(여기서 직접 부른다), app.js = DOM 연결(브라우저 실측 E190 + 아래 소스 검사)
//   U21·U28(이미지·압축)은 UI-5b
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { domainToUnicode } from 'node:url';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import * as view from '../../src/dashboard/public/view.js';

const V = view as any;

type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function req(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error(`응답 없음: ${urlPath}`)));
    r.end();
  });
}
// 화면 소스(없으면 빈 문자열 — 긍정 전제가 assertion으로 실패한다). 줄 전체 주석(//, /* */)은 빼고 본다
function code(file: string) {
  const p = `src/dashboard/public/${file}`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// --- 서버: 정적 파일과 /api/ping ---
test('정적 파일: /app.js·/view.js는 javascript, /app.css는 text/css, 모두 토큰 없이 200 + no-store', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    for (const [p, type] of [['/app.js', /javascript/], ['/view.js', /javascript/], ['/app.css', /text\/css/]] as const) {
      const r = await req(d.port, p);
      assert.equal(r.status, 200, p);
      assert.match(String(r.headers['content-type']), type, p);
      assert.match(String(r.headers['cache-control']), /no-store/, p);
      assert.ok(r.body.length > 0, p);
    }
  } finally {
    await d.close();
  }
});

test('"복호화 꺼짐" 안내(STO 결정 4): /api/ping → { runId, decrypt } — 기본 false, startDashboard({ decrypt: true })면 true', async () => {
  for (const decrypt of [undefined, true]) {
    const store = createStore();
    const d = await startDashboard({ store, port: 0, ...(decrypt ? { decrypt } : {}) } as Parameters<typeof startDashboard>[0]);
    try {
      const r = await req(d.port, '/api/ping', { authorization: `Bearer ${d.token}` });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body.toString()), { runId: store.runId, decrypt: decrypt === true });
    } finally {
      await d.close();
    }
  }
});

// --- 화면 소스 검사(U13·U18·U19·U22·U23·U49·U50, D-11·D-16) ---
test('화면 소스: HTML로 넣는 API·eval·postMessage·브라우저 저장소·서비스 워커 등록·데이터로 링크/src 만들기·외부 주소가 없다', () => {
  const app = code('app.js');
  const vw = code('view.js');
  const css = code('app.css');
  // 긍정 전제(O30): 실제로 화면을 그리고 API·실시간 통로를 토큰 헤더로 부른다
  assert.ok(app.includes('textContent'), 'app.js는 textContent로 출력');
  assert.ok(app.includes('createElement'), 'app.js는 createElement로 만든다');
  assert.ok(app.includes('Authorization') && app.includes('Bearer'), '토큰은 Authorization 헤더로(D-3)');
  assert.ok(app.includes('/api/events') && app.includes('/api/flows'), 'API와 실시간 통로');
  assert.ok(/cache:\s*'no-store'/.test(app), "fetch는 cache: 'no-store'(U50)");
  assert.ok(/from '\.\/view\.js'/.test(app), 'app.js는 view.js를 같은 출처에서 import');
  assert.ok(vw.includes('export function'), 'view.js 함수');
  assert.ok(css.length > 0, 'app.css 있음');
  const banned: [RegExp, string][] = [
    [/innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|document\.write/, 'HTML로 넣기(U19)'],
    [/\beval\s*\(|new\s+Function\b|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, '문자열 실행(U23)'],
    [/srcdoc|<iframe|<script/i, 'iframe·script 만들기(U20·U21)'],
    [/postMessage|addEventListener\s*\(\s*['"]message['"]|onmessage/, 'postMessage(U13)'],
    [/localStorage|sessionStorage|indexedDB|\bcaches\./, '브라우저 저장소(D-11, U50)'],
    [/serviceWorker\.register/, '서비스 워커 등록(U49)'],
    [/\.href\s*=|\.src\s*=|setAttribute\s*\(\s*['"](href|src|style|on\w+)['"]/, '데이터로 링크·src·style·이벤트 속성(U22)'],
    [/javascript:|window\.open|\bimport\s*\(/, 'javascript: 링크·새 창·동적 import'],
    [/https?:\/\//i, '외부 주소(U18)'],
  ];
  for (const [re, why] of banned) {
    assert.ok(!re.test(app), `app.js: ${why}`);
    assert.ok(!re.test(vw), `view.js: ${why}`);
  }
  assert.ok(!/@import|url\s*\(/i.test(css), 'app.css: 외부 자원(@import·url())');
});

// --- view.js ---
test('tokenFromHash(D-3): "#t=<22~128자 base64url>"만 토큰, 그 밖은 null', () => {
  const t = 'A'.repeat(21) + 'b-_9';
  assert.equal(V.tokenFromHash(`#t=${t}`), t);
  for (const bad of ['', '#', '#t=', `#t=${'a'.repeat(21)}`, `#t=${'a'.repeat(129)}`, `#t=${t}&x=1`, `#x=${t}`, `#t=${t}<`, `#t=${t.slice(0, 22)} `]) assert.equal(V.tokenFromHash(bad), null, JSON.stringify(bad));
});

test('showHidden(D-14, U25·U26): 제어·bidi·zero-width 문자를 ⟨U+XXXX⟩로 보이고, 보통 글자는 그대로. keepLines면 줄바꿈·탭 유지', () => {
  assert.equal(V.showHidden('abc‮gpj.exe'), 'abc⟨U+202E⟩gpj.exe');
  assert.equal(V.showHidden('\x1b[31mred'), '⟨U+001B⟩[31mred');
  for (const c of ['\x00', '\x7f', '\u0085', '​', '‌', '‍', '⁠', '﻿', '‎', '‏', '؜', '‪', '‭', '⁦', '⁩', '­']) {
    const hex = c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    assert.equal(V.showHidden(`x${c}y`), `x⟨U+${hex}⟩y`, `U+${hex}`);
  }
  assert.equal(V.showHidden('한글 😀 café <b>'), '한글 😀 café <b>', '보통 글자·꺾쇠는 그대로(출력은 textContent가 맡는다)');
  assert.equal(V.showHidden('a\nb\tc\r\n'), 'a⟨U+000A⟩b⟨U+0009⟩c⟨U+000D⟩⟨U+000A⟩', '한 줄 칸(URL·헤더)에서는 줄바꿈도 보인다');
  assert.equal(V.showHidden('a\nb\tc\r\n', { keepLines: true }), 'a\nb\tc\r\n', '본문은 줄바꿈·탭 유지');
  assert.equal(V.showHidden('a‮b\x00', { keepLines: true }), 'a⟨U+202E⟩b⟨U+0000⟩', '본문에서도 그 밖은 보인다');
});

test('hostLabel(D-14, U26): xn-- 이름은 ASCII와 유니코드를 함께, 보통 이름은 그대로, 잘못된 punycode도 예외 없이', () => {
  assert.equal(V.hostLabel('example.com'), 'example.com');
  assert.equal(V.hostLabel('127.0.0.1'), '127.0.0.1');
  assert.equal(V.hostLabel('[::1]'), '[::1]');
  for (const h of ['xn--80ak6aa92e.com', 'xn--hxajbheg2az3al.xn--jxalpdlp', 'www.xn--bcher-kva.example', 'xn--mnchen-3ya.de', 'xn--3e0b707e']) {
    const u = domainToUnicode(h);
    assert.ok(u !== '' && u !== h, `긍정 전제(O30): ${h}는 유니코드로 풀린다(${u})`);
    const label = V.hostLabel(h);
    assert.ok(typeof label === 'string' && label.includes(h) && label.includes(u), `${h} → ${label} (기대: ${u}도)`);
  }
  for (const bad of ['xn--', 'xn--a-', 'xn--zzzzzzzzzzzzzzzzzzzz.com', 'xn--ab-$$.com']) assert.equal(typeof V.hostLabel(bad), 'string', bad);
});

test('displayUrl: target이 있으면 scheme://host[:기본 포트 아니면 포트]path, 없으면 원문 url', () => {
  assert.equal(V.displayUrl({ url: '/x?q=1', target: { scheme: 'https', host: 'a.test', port: 443, path: '/x?q=1' } }), 'https://a.test/x?q=1');
  assert.equal(V.displayUrl({ url: 'http://a.test:8080/p', target: { scheme: 'http', host: 'a.test', port: 8080, path: '/p' } }), 'http://a.test:8080/p');
  assert.equal(V.displayUrl({ url: 'http://a.test/p', target: { scheme: 'http', host: 'a.test', port: 80, path: '/p' } }), 'http://a.test/p');
  assert.equal(V.displayUrl({ url: 'example.com:443' }), 'example.com:443');
});

test('clip(U27): 긴 값은 자르고 남은 글자 수를 붙인다. 서로게이트 쌍을 가르지 않는다', () => {
  assert.equal(V.clip('abc', 5), 'abc');
  assert.equal(V.clip('abcdefgh', 5), 'abcde… (+3자)');
  const s = 'abcd😀xyz'; // 😀는 두 칸
  const c = V.clip(s, 5);
  assert.ok(typeof c === 'string' && !/[\ud800-\udbff]…/.test(c), `서로게이트 반쪽 없음: ${JSON.stringify(c)}`);
  assert.ok(c.startsWith('abcd'));
});

test('hexDump: 16바이트 줄(오프셋·16진·ASCII), 상한을 넘으면 truncated', () => {
  const r = V.hexDump(new Uint8Array([0x48, 0x69, 0x00, 0xff]));
  assert.match(r.text, /^00000000  48 69 00 ff\s+\|Hi\.\.\|$/);
  assert.equal(r.truncated, false);
  const big = V.hexDump(new Uint8Array(40).fill(0x41), 32);
  const lines = big.text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^00000010  (41 ){15}41\s+\|A{16}\|$/);
  assert.equal(big.truncated, true);
});

test('bodyText: UTF-8 글(줄바꿈 유지·숨은 문자 표시), NUL이 있으면 binary, 상한을 넘으면 truncated', () => {
  const t = V.bodyText(new TextEncoder().encode('안녕\n<script>‮'));
  assert.equal(t.text, '안녕\n<script>⟨U+202E⟩');
  assert.equal(t.binary, false);
  assert.equal(t.truncated, false);
  assert.equal(V.bodyText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00])).binary, true);
  const cut = V.bodyText(new TextEncoder().encode('a'.repeat(100)), 10);
  assert.equal(cut.text, 'a'.repeat(10));
  assert.equal(cut.truncated, true);
});

test('headerValues(U24): 이름 대소문자 무시·중복은 모두, __proto__·constructor 이름도 데이터일 뿐 객체를 오염시키지 않는다', () => {
  const pairs = [['Content-Type', 'text/html'], ['__proto__', 'polluted'], ['constructor', 'x'], ['set-cookie', 'a=1'], ['Set-Cookie', 'b=2']];
  assert.deepEqual(V.headerValues(pairs, 'content-type'), ['text/html']);
  assert.deepEqual(V.headerValues(pairs, 'SET-COOKIE'), ['a=1', 'b=2']);
  assert.deepEqual(V.headerValues(pairs, '__proto__'), ['polluted']);
  assert.deepEqual(V.headerValues(pairs, 'x-none'), []);
  assert.equal(({} as any).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('buildQuery: host·method·status만, 빈 값은 빼고 인코딩. status가 숫자가 아니거나 method가 글자가 아니면 null(고정 문구로 알림 — U30)', () => {
  assert.equal(V.buildQuery({}), '');
  assert.equal(V.buildQuery({ host: ' ', method: '', status: '' }), '');
  const q = new URLSearchParams(V.buildQuery({ host: ' a.test&x=1 ', method: 'post', status: '502' }));
  assert.deepEqual([...q.entries()], [['host', 'a.test&x=1'], ['method', 'post'], ['status', '502']]);
  assert.equal(V.buildQuery({ status: '20x' }), null);
  assert.equal(V.buildQuery({ status: '1000' }), null);
  assert.equal(V.buildQuery({ method: 'GET<' }), null);
});

test('createSSEParser: 줄이 쪼개져 와도, CRLF·주석 줄·여러 data 줄을 처리하고, JSON이 아니면 건너뛴다', () => {
  const got: any[] = [];
  const p = V.createSSEParser((m: any) => got.push(m));
  p.push('data: {"type":"hel');
  p.push('lo","runId":"r1"}\n\n: ping\n\nid: 7\r\ndata: {"type":"done",\r\ndata: "summary":{"id":1}}\r\n\r\n');
  p.push('data: not-json\n\nid: 8\ndata: {"type":"cleared"}\n');
  assert.equal(got.length, 2, `아직 빈 줄이 안 온 메시지는 내보내지 않는다: ${JSON.stringify(got)}`);
  p.push('\n');
  assert.deepEqual(got, [
    { id: undefined, data: { type: 'hello', runId: 'r1' } },
    { id: '7', data: { type: 'done', summary: { id: 1 } } },
    { id: '8', data: { type: 'cleared' } },
  ]);
});

const S = (id: number, state: 'pending' | 'done', extra: Record<string, unknown> = {}) => ({ id, runId: 'r1', state, startedAt: id, method: 'GET', url: `/p${id}`, ...extra });
test('createModel: load·start·done·evicted·cleared를 Map으로 맞추고, rows는 최신 순, 늦은 start는 done을 덮지 않는다', () => {
  const m = V.createModel();
  m.load([S(1, 'done', { status: 200 }), S(2, 'pending')]);
  m.apply({ type: 'start', summary: S(3, 'pending') });
  m.apply({ type: 'done', summary: S(2, 'done', { status: 404 }) });
  m.apply({ type: 'start', summary: S(1, 'pending') }); // 늦게 온 시작
  assert.deepEqual(m.rows().map((r: any) => [r.id, r.state]), [[3, 'pending'], [2, 'done'], [1, 'done']]);
  assert.equal(m.get(2).status, 404);
  m.load([S(3, 'pending')]); // 다시 받은 목록의 진행 중이 이미 받은 완료를 덮지 않는다
  m.apply({ type: 'done', summary: S(3, 'done') });
  m.load([S(3, 'pending')]);
  assert.equal(m.get(3).state, 'done');
  m.apply({ type: 'evicted', ids: [1, 3] });
  assert.deepEqual(m.rows().map((r: any) => r.id), [2]);
  m.apply({ type: 'cleared' });
  assert.equal(m.rows().length, 0);
  assert.equal(m.get(2), undefined);
});

test('createModel: maxRows를 넘으면 가장 오래된(id가 작은) 것부터 뺀다, rows(n)은 최신 n개(U27)', () => {
  const m = V.createModel({ maxRows: 3 });
  for (let i = 1; i <= 5; i++) m.apply({ type: 'done', summary: S(i, 'done') });
  assert.deepEqual(m.rows().map((r: any) => r.id), [5, 4, 3]);
  assert.deepEqual(m.rows(2).map((r: any) => r.id), [5, 4]);
  assert.equal(m.size, 3);
});

test('createModel.setRun(F10, U34): 같은 runId면 false(그대로), 바뀌면 true이고 목록을 비운다', () => {
  const m = V.createModel();
  assert.equal(m.setRun('r1'), true, '처음');
  m.apply({ type: 'done', summary: S(1, 'done') });
  assert.equal(m.setRun('r1'), false);
  assert.equal(m.size, 1);
  assert.equal(m.setRun('r2'), true);
  assert.equal(m.size, 0);
  assert.equal(m.runId, 'r2');
});
