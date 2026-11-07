// [PRX-2b] 새 동작: 배정 "2b" 사례 중 현재 구현이 못 하는 것 [확인됨: 2026-11-07 실측, scripts/probe/prx2b-g9.mjs]
// 사례 번호는 docs/ai/prx2-cases.md. 이미 되는 사례는 PRX-2b-regression.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawRequest } from './_raw.ts';
import { startRawUpstream } from './_raw-upstream.ts';
import { recordingSetup } from './_flow.ts';

const { ctx, take } = recordingSetup();

// 실측: Node 클라이언트는 응답 헤더가 1,000개를 넘으면 나머지를 오류 없이 버린다(뒤에 있던 Content-Length까지).
// 크기 제한(maxHeaderSize 16KB)은 따로 있으므로, 개수 제한을 풀어도 메모리는 그 안에서 묶인다.
test('G9: 목적지가 응답 헤더를 2,500개 보내도 몰래 버리지 않는다(중계·기록 모두)', async () => {
  const N = 2500;
  const raw = await startRawUpstream((s) => s.end(`HTTP/1.1 200 OK\r\n${'a:1\r\n'.repeat(N)}Content-Length: 2\r\n\r\nok`));
  try {
    const r = await rawRequest(ctx.proxy.port, `GET http://127.0.0.1:${raw.port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, 1500);
    assert.equal(r.status, 200);
    const relayed = (r.raw.match(/^a: (.*)$/im)?.[1] ?? '').split(',').filter((v) => v.trim() === '1').length;
    assert.equal(relayed, N, '클라이언트가 받은 a 헤더 값 수');
    const [f] = await take(1);
    assert.equal(f.response.headers.filter(([n]: [string]) => n === 'a').length, N, '기록된 a 헤더 수');
  } finally {
    await raw.close();
  }
});

