// [UI-5] 회귀(구현 전에도 통과해야 정상, O9): 페이지 뼈대(index.html)는 토큰 없이 받고, 인라인 스크립트·외부 자원이 없다(D-16, U18)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

test('index.html: 토큰 없이 200 text/html, 스크립트는 같은 출처 파일(/app.js)뿐, 외부 주소·인라인 스크립트·인라인 이벤트 없음', async () => {
  const html = readFileSync('src/dashboard/public/index.html', 'utf8');
  assert.ok(html.includes('src="/app.js"'), '긍정 전제(O30): app.js를 부른다');
  assert.ok(!/https?:\/\//i.test(html), '외부 주소 없음');
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1, '스크립트 태그 하나');
  assert.ok(/<script type="module" src="\/app\.js"><\/script>/.test(html), '그 하나는 src만 있고 내용이 없다');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), '인라인 이벤트 속성 없음');

  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    const r = await new Promise<{ status: number; type: string }>((resolve, reject) => {
      const q = http.request({ host: '127.0.0.1', port: d.port, path: '/', agent: false }, (res) => (res.resume(), resolve({ status: res.statusCode!, type: String(res.headers['content-type']) })));
      q.on('error', reject);
      q.end();
    });
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/html/);
  } finally {
    await d.close();
  }
});
