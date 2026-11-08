// [UI-3] 회귀(구현 전에도 통과해야 정상, O9): 새 경로도 UI-1의 보호(토큰 401, 다른 출처·리바인딩 Host 403)를 먼저 거친다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

function status(port: number, p: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => (res.resume(), resolve(res.statusCode!)));
    r.on('error', reject);
    r.end(method === 'POST' ? '{}' : undefined);
  });
}

test('새 경로(/api/flows, 상세, 본문, 지우기)는 토큰이 없거나 틀리면 401, 토큰이 맞아도 다른 Origin·Host면 403', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  const auth = { authorization: `Bearer ${d.token}` };
  const json = { 'content-type': 'application/json' };
  try {
    const routes: [string, string][] = [['GET', '/api/flows'], ['GET', '/api/flows?method=GET'], ['GET', '/api/flows/1'], ['GET', '/api/flows/1/body/request'], ['POST', '/api/clear']];
    for (const [m, p] of routes) {
      assert.equal(await status(d.port, p, m, json), 401, `${m} ${p} 토큰 없음`);
      assert.equal(await status(d.port, p, m, { ...json, authorization: 'Bearer wrong' }), 401, `${m} ${p} 틀린 토큰`);
      assert.equal(await status(d.port, p, m, { ...json, ...auth, origin: 'http://evil.example' }), 403, `${m} ${p} 다른 Origin`);
      assert.equal(await status(d.port, p, m, { ...json, ...auth, host: `evil.example:${d.port}` }), 403, `${m} ${p} 리바인딩 Host`);
    }
  } finally {
    await d.close();
  }
});
