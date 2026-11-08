// [UI-1] 회귀(구현 전에도 통과해야 정상, O9): 대시보드는 127.0.0.1에만 열리고, close 뒤에는 닫힌다(SEC-1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';

const connects = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, host, () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => (s.destroy(), resolve(false)));
  });

test('회귀: 127.0.0.1로는 접속되고 [::1]로는 안 된다, close 뒤에는 127.0.0.1도 안 된다', async () => {
  const d = await startDashboard({ store: createStore(), port: 0 });
  try {
    assert.equal(await connects('127.0.0.1', d.port), true, '긍정 전제(O30)');
    assert.equal(await connects('::1', d.port), false);
  } finally {
    await d.close();
  }
  assert.equal(await connects('127.0.0.1', d.port), false);
});
