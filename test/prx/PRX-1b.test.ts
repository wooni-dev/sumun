// [PRX-1b] 새 동작: 요청 쪽 방어 중 현재 구현(PRX-1 + Node 기본값)이 막지 못하는 것 [확인됨: 2026-11-07 실측]
// 사례 번호는 docs/ai/prx1-cases.md. 이미 막히는 사례는 PRX-1b-regression.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './_prx1b-setup.ts';

const { arrived, U, send } = setup();

const CASES: [string, () => string][] = [
  // WHATWG URL은 "http:///path"를 호스트 "path"로 해석한다 → DNS 조회를 시도함 [확인됨: 실측에서 응답이 늦음]
  ['C2 호스트 없음 http:///path', () => `GET http:///path HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C5 포트 0', () => `GET http://127.0.0.1:0/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  // RFC 9112 3.2: Host가 여러 개이거나 값이 잘못됐으면 400 (MUST). Node는 막지 않는다 [확인됨]
  ['C16 Host 두 줄', () => `GET http://${U()}/c16 HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n`],
  ['C16 Host: a, b', () => `GET http://${U()}/c16 HTTP/1.1\r\nHost: a, b\r\n\r\n`],
  ['C16 Host: a b', () => `GET http://${U()}/c16 HTTP/1.1\r\nHost: a b\r\n\r\n`],
  // RFC 9112 6.1: HTTP/1.0 메시지의 Transfer-Encoding은 잘못된 메시지로 다룬다. Node는 그대로 받아 넘긴다 [확인됨]
  ['D5 HTTP/1.0 + TE chunked', () => `POST http://${U()}/d5 HTTP/1.0\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n`],
];

for (const [name, req] of CASES) {
  test(`${name} → 400, 목적지로 넘기지 않음`, async () => {
    const r = await send(req());
    assert.equal(r.status, 400);
    assert.equal(arrived().length, 0, '목적지로 넘어감');
  });
}
