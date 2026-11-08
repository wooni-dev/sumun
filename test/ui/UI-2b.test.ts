// [UI-2b] 결함 재현(구현 전에는 실패해야 정상): 점유 검사가 자기 자신에게 연결(TCP self-connect)되면 아무도 없는 포트를 점유로 본다.
// 사례·설계: docs/ai/ui2b-cases.md Z1·Z2·Z3, B-1·B-2.
// Windows는 나가는 소켓의 로컬 포트를 연속 번호로 준다 — listen(0)으로 P를 받고 닫은 직후 P+1(또는 P+2)에 검사하면 로컬 포트가 그 번호가 된다.
// 병렬 실행에서는 다른 테스트가 임시 포트를 써서 재현되지 않을 수 있다(그때는 그냥 통과한다). 결함 여부는 혼자 돌린 red로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import { startProxy } from '../../src/proxy/server.ts';

const canListen = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
// 임시 포트 P를 받아 닫는다. P+1..P+k가 127.0.0.1·::1 모두 비어 있을 때만 돌려준다
async function freshBase(k: number) {
  for (;;) {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const P = (s.address() as net.AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));
    if (P + k > 65535) continue;
    let ok = true;
    for (let i = 1; i <= k && ok; i++) ok = (await canListen(P + i, '127.0.0.1')) && (await canListen(P + i, '::1'));
    if (ok) return P;
  }
}
const outcome = <T>(p: Promise<T>) => p.then((v) => ({ v }), (e: NodeJS.ErrnoException) => ({ e }));

test('대시보드: 직전에 받은 임시 포트 P의 다음 번호 P+1로 시작하면, 127.0.0.1 검사가 자기 자신에 연결돼도 점유로 보지 않는다(Z1) — 5번', async () => {
  for (let i = 0; i < 5; i++) {
    const P = await freshBase(1);
    const r = await outcome(startDashboard({ store: createStore(), port: P + 1 }));
    assert.ok('v' in r, `P+1=${P + 1}: 시작해야 함 — ${'e' in r ? r.e.code : ''}`);
    assert.equal(r.v.port, P + 1);
    await r.v.close();
  }
});

test('대시보드: P+2로 시작하면 127.0.0.1 검사는 거절되고 [::1] 검사가 자기 자신에 연결된다 — 그래도 점유로 보지 않는다(Z2) — 5번', async () => {
  for (let i = 0; i < 5; i++) {
    const P = await freshBase(2);
    const r = await outcome(startDashboard({ store: createStore(), port: P + 2 }));
    assert.ok('v' in r, `P+2=${P + 2}: 시작해야 함 — ${'e' in r ? r.e.code : ''}`);
    assert.equal(r.v.port, P + 2);
    await r.v.close();
  }
});

test('프록시: 직전에 받은 임시 포트 P의 다음 번호 P+1로 시작하면 점유로 보지 않는다(Z3) — 5번', async () => {
  for (let i = 0; i < 5; i++) {
    const P = await freshBase(1);
    const r = await outcome(startProxy({ port: P + 1 }));
    assert.ok('v' in r, `P+1=${P + 1}: 시작해야 함 — ${'e' in r ? r.e.code : ''}`);
    assert.equal(r.v.port, P + 1);
    await r.v.close();
  }
});
