// [UI-6] 회귀(구현 전에도 통과해야 정상, O9): 토큰을 숨길 곳(저장소·window.name·history.state·pushState)을 쓰지 않는다,
//   403 문구는 원인과 입력에 상관없이 같은 바이트·text/plain·nosniff, 모르는 경로도 요청 검사를 먼저 탄다.
// 사례: docs/ai/ui6-cases.md K15·K16·K23·K30·K36, 사용자 결정(UI 보고서 결정 4 다시 여쭘: "메모리에만")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

function code(file: string) {
  const p = `src/dashboard/public/${file}`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function req(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('화면 소스: 토큰을 숨길 곳을 쓰지 않는다 — 저장소·쿠키·window.name·history.state 쓰기·pushState(K15·K16, D-11)', () => {
  const app = code('app.js');
  const vw = code('view.js');
  assert.ok(app.includes('tokenFromHash'), '긍정 전제(O30): app.js가 토큰을 읽는다');
  for (const [name, src] of [['app.js', app], ['view.js', vw]] as const) {
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|\bcaches\./.test(src), `${name}: 브라우저 저장소`);
    assert.ok(!/window\.name|\bself\.name\b/.test(src), `${name}: window.name`);
    assert.ok(!/pushState\s*\(/.test(src), `${name}: pushState`);
    assert.ok(!/replaceState\s*\(\s*(?!null\b)/.test(src), `${name}: replaceState에 state를 실음`);
  }
});

test('403 문구: 원인·입력과 상관없이 같은 바이트, text/plain·nosniff, 입력이 섞이지 않는다(K30·K36)', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    const bodies = new Set<string>();
    const cases: Record<string, string>[] = [
      { host: `evil.example:${d.port}` },
      { host: `<script>x</script>:${d.port}` },
      { origin: 'http://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { via: '1.1 sumun' },
    ];
    for (const h of cases) {
      const r = await req(d.port, '/', h);
      assert.equal(r.status, 403, JSON.stringify(h));
      assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.ok(!r.body.includes('evil') && !r.body.includes('<script>'), `입력 없음: ${r.body}`);
      bodies.add(r.body);
    }
    assert.equal(bodies.size, 1, `한 가지 문구: ${[...bodies].join(' | ')}`);
    assert.ok(!/프록시를 거치지 않고/.test([...bodies][0]), '대시보드 자신의 403에는 프록시 안내 표지가 없다(UI-2)');
  } finally {
    await d.close();
  }
});

test('모르는 경로·아이콘 경로도 요청 검사가 먼저다(K23): 나쁜 Host는 403, 좋은 Host의 없는 경로는 404', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    for (const p of ['/favicon.ico', '/favicon.svg', '/nope']) assert.equal((await req(d.port, p, { host: `evil.example:${d.port}` })).status, 403, p);
    assert.equal((await req(d.port, '/nope')).status, 404, '긍정 전제: 좋은 Host면 검사를 지나 404');
  } finally {
    await d.close();
  }
});
