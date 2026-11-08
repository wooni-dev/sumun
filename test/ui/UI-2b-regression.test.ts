// [UI-2b] 회귀(구현 전에도 통과해야 정상, O9) — 긍정 전제(O30): self-connect를 "응답 없음"으로 봐도, 실제로 듣고 있는 다른 프로그램은 계속 잡힌다(U41, ui2b-cases F-b)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import { startProxy } from '../../src/proxy/server.ts';

async function holder(host: string) {
  const s = net.createServer((c) => c.destroy());
  await new Promise<void>((r) => s.listen(0, host, () => r()));
  return { port: (s.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => s.close(() => r())) };
}
const code = <T>(p: Promise<T>) => p.then(async (v: any) => (await v.close(), 'started'), (e: NodeJS.ErrnoException) => e.code);

test('다른 프로그램이 127.0.0.1:Q에서 들으면 대시보드·프록시 모두 EADDRINUSE', async () => {
  const h = await holder('127.0.0.1');
  try {
    assert.equal(await code(startDashboard({ store: createStore(), port: h.port })), 'EADDRINUSE');
    assert.equal(await code(startProxy({ port: h.port })), 'EADDRINUSE');
  } finally {
    await h.close();
  }
});

test('다른 프로그램이 [::1]:Q에서 들으면 대시보드는 EADDRINUSE(U42)', async () => {
  const h = await holder('::1');
  try {
    assert.equal(await code(startDashboard({ store: createStore(), port: h.port })), 'EADDRINUSE');
  } finally {
    await h.close();
  }
});
