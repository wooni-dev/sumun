// [UI-5b] 회귀(구현 전에도 통과해야 정상, O9): CSP는 그대로(blob:·data: 없음), 화면은 blob/객체 URL·<img>·다운로드 링크를 만들지 않는다
// 사례: docs/ai/ui5b-cases.md P1·P2·P10·P13·P17, 설계 B-1·B-6
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

test('CSP는 UI-1 그대로: default-src \'self\', blob:·data:·img-src 완화 없음(B-1, P10)', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    for (const p of ['/', '/app.js', '/api/ping']) {
      const csp = await new Promise<string>((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: d.port, path: p, agent: false }, (res) => (res.resume(), resolve(String(res.headers['content-security-policy'] ?? ''))));
        r.on('error', reject);
        r.end();
      });
      assert.equal(csp, "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", p);
    }
  } finally {
    await d.close();
  }
});

test('화면 소스: 객체 URL·<img>·new Image·다운로드 링크를 만들지 않는다(P1·P2·P13·P17)', () => {
  const app = code('app.js');
  const vw = code('view.js');
  assert.ok(app.includes('textContent'), '긍정 전제(O30): app.js가 있다');
  for (const [name, src] of [['app.js', app], ['view.js', vw]] as const) {
    assert.ok(!/createObjectURL|revokeObjectURL/.test(src), `${name}: 객체 URL`);
    assert.ok(!/createElement\s*\(\s*['"]img['"]\s*\)|new\s+Image\s*\(/.test(src), `${name}: <img>`);
    assert.ok(!/\.download\s*=|setAttribute\s*\(\s*['"]download['"]/.test(src), `${name}: 다운로드 링크`);
    assert.ok(!/['"`]data:[a-z-]+\//i.test(src), `${name}: data: URL(data:<형식>/…)`);
  }
});
