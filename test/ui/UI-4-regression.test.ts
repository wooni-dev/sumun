// [UI-4] 회귀(구현 전에도 통과해야 정상, O9): 실시간 통로도 UI-1의 보호(토큰 401, 다른 출처·같은 사이트·리바인딩 Host·프록시를 거친 요청 403)를 먼저 거친다(U3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

function status(port: number, p: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => (res.resume(), resolve(res.statusCode!), r.destroy()));
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error('응답 없음')));
    r.end();
  });
}

test('/api/events: 토큰이 없거나 틀리면 401, 토큰이 맞아도 다른 Origin·cross-site·same-site·리바인딩 Host·Via sumun이면 403', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  const auth = { authorization: `Bearer ${d.token}` };
  try {
    assert.equal(await status(d.port, '/api/events'), 401, '토큰 없음');
    assert.equal(await status(d.port, '/api/events', { authorization: 'Bearer wrong' }), 401, '틀린 토큰');
    assert.equal(await status(d.port, '/api/events', { ...auth, origin: 'http://evil.example' }), 403, '다른 Origin(U3)');
    assert.equal(await status(d.port, '/api/events', { ...auth, origin: `http://127.0.0.1:${d.port + 1}` }), 403, '다른 포트 Origin');
    assert.equal(await status(d.port, '/api/events', { ...auth, 'sec-fetch-site': 'cross-site' }), 403, 'cross-site');
    assert.equal(await status(d.port, '/api/events', { ...auth, 'sec-fetch-site': 'same-site' }), 403, 'same-site');
    assert.equal(await status(d.port, '/api/events', { ...auth, host: `evil.example:${d.port}` }), 403, '리바인딩 Host');
    assert.equal(await status(d.port, '/api/events', { ...auth, via: '1.1 sumun' }), 403, '프록시를 거친 요청');
  } finally {
    await d.close();
  }
});
