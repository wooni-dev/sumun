// [PRX-1b] 회귀: 현재 구현(PRX-1 + Node 24 기본 파서)이 이미 막거나 올바르게 처리하는 요청 쪽 사례 [확인됨: 2026-11-07 실측]
// red 대상이 아니다. Node 버전이 바뀌어 방어가 약해지면 여기서 알 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './_prx1b-setup.ts';
import { viaProxy } from './_upstream.ts';

const { ctx, arrived, U, send } = setup();

// --- 거부 (목적지로 넘어가면 안 됨) ---
const REJECT: [string, () => string][] = [
  ['C1 GET *', () => `GET * HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C1 OPTIONS *', () => `OPTIONS * HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C2 호스트 없음 http://:80/', () => `GET http://:80/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C5 포트 65536', () => `GET http://127.0.0.1:65536/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C5 포트 abc', () => `GET http://127.0.0.1:abc/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C5 포트 -1', () => `GET http://127.0.0.1:-1/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C5 포트 80:81', () => `GET http://127.0.0.1:80:81/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C7 요청 대상에 제어문자', () => `GET http://${U()}/a\x01b HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C11 IPv6 zone ID', () => `GET http://[fe80::1%25eth0]/ HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['C15 HTTP/1.1인데 Host 없음', () => `GET http://${U()}/c15 HTTP/1.1\r\n\r\n`],
  ['D1 CL + TE 함께', () => `POST http://${U()}/d1 HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`],
  ['D2 다른 CL 두 줄', () => `POST http://${U()}/d2 HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nabcdef`],
  ['D2 Content-Length: 5, 6', () => `POST http://${U()}/d2 HTTP/1.1\r\nHost: x\r\nContent-Length: 5, 6\r\n\r\nabcdef`],
  ['D3 CL +5', () => `POST http://${U()}/d3 HTTP/1.1\r\nHost: x\r\nContent-Length: +5\r\n\r\nabcde`],
  ['D3 CL -1', () => `POST http://${U()}/d3 HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n`],
  ['D3 CL 0x5', () => `POST http://${U()}/d3 HTTP/1.1\r\nHost: x\r\nContent-Length: 0x5\r\n\r\nabcde`],
  ['D3 CL 5a', () => `POST http://${U()}/d3 HTTP/1.1\r\nHost: x\r\nContent-Length: 5a\r\n\r\nabcde`],
  ['D4 TE: chunked, identity', () => `POST http://${U()}/d4 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked, identity\r\n\r\n0\r\n\r\n`],
  ['D4 TE: identity', () => `POST http://${U()}/d4 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: identity\r\n\r\nabc`],
  ['D4 TE: xchunked', () => `POST http://${U()}/d4 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: xchunked\r\n\r\n0\r\n\r\n`],
  ['D6 헤더 이름 뒤 공백', () => `POST http://${U()}/d6 HTTP/1.1\r\nHost: x\r\nContent-Length : 5\r\n\r\nabcde`],
  ['D7 obs-fold', () => `GET http://${U()}/d7 HTTP/1.1\r\nHost: x\r\nX-A: b\r\n  c\r\n\r\n`],
  ['D8 LF만 있는 줄바꿈', () => `GET http://${U()}/d8 HTTP/1.1\nHost: x\n\n`],
  ['D8 헤더 값에 NUL', () => `GET http://${U()}/d8 HTTP/1.1\r\nHost: x\r\nX-A: a\x00b\r\n\r\n`],
  ['D9 잘못된 chunk 크기', () => `POST http://${U()}/d9 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\nabc\r\n0\r\n\r\n`],
  ['D15 작은 헤더 3,000개(크기 한도 안, 개수 한도 초과)', () => `GET http://${U()}/d15 HTTP/1.1\r\nHost: x\r\n${'a:1\r\n'.repeat(3000)}\r\n`],
];
for (const [name, req] of REJECT) {
  test(`${name} → 400대 거부, 목적지로 넘기지 않음`, async () => {
    const r = await send(req());
    assert.ok(r.status >= 400 && r.status < 500, `상태 ${r.status}`);
    assert.equal(arrived().length, 0, '목적지로 넘어감');
  });
}

// 큰 요청: Node는 431로 거부하고 연결을 끊는다. 클라이언트가 아직 쓰는 중이면 Windows에서는 RST가 응답 바이트를 지울 수 있다
// (실측에서 상태 0으로 보임). 그래서 "목적지로 넘어가지 않음 + 프록시가 계속 동작함"으로 확인한다.
for (const [name, req] of [
  ['C13 100KB URL', () => `GET http://${U()}/${'a'.repeat(100_000)} HTTP/1.1\r\nHost: x\r\n\r\n`],
  ['D14 64KB 쿠키', () => `GET http://${U()}/d14 HTTP/1.1\r\nHost: x\r\nCookie: ${'a'.repeat(65_536)}\r\n\r\n`],
] as [string, () => string][]) {
  test(`${name} → 거부(414/431 또는 연결 종료), 목적지로 넘기지 않고, 프록시는 계속 동작`, async () => {
    const r = await send(req());
    assert.ok([0, 414, 431].includes(r.status), `상태 ${r.status}`);
    assert.equal(arrived().length, 0, '목적지로 넘어감');
    const ok = await send(`GET http://${U()}/alive HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.equal(ok.status, 201, '이후 정상 요청이 처리돼야 함');
  });
}

// --- 정상 처리 ---
test('C6 userinfo(user:pass@)는 요청줄과 Host에 남기지 않는다', async () => {
  const r = await send(`GET http://user:pass@${U()}/c6 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(r.status, 201);
  assert.equal(arrived()[0].url, '/c6');
  assert.equal(arrived()[0].headers.host, U());
});
test('C6 good.example@127.0.0.1 은 실제 연결 대상(127.0.0.1)과 Host가 일치한다', async () => {
  const r = await send(`GET http://good.example@${U()}/c6b HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(r.status, 201);
  assert.equal(arrived()[0].headers.host, U());
});
test('C9 경로와 쿼리를 정규화하지 않고 그대로 넘긴다', async () => {
  await send(`GET http://${U()}/a%2Fb/../c?x=%20&y= HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(arrived()[0].url, '/a%2Fb/../c?x=%20&y=');
});
test('C12 대문자 scheme HTTP:// 도 정상 처리', async () => {
  const r = await send(`GET HTTP://${U()}/c12 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(r.status, 201);
  assert.equal(arrived()[0].url, '/c12');
});
test('C17 HTTP/1.0 + Host 없음은 정상 처리하고 Host를 만들어 넘긴다', async () => {
  const r = await send(`GET http://${U()}/c17 HTTP/1.0\r\n\r\n`);
  assert.equal(r.status, 201);
  assert.equal(arrived()[0].headers.host, U());
});
for (const method of ['PUT', 'DELETE', 'PATCH']) {
  // Node 클라이언트는 DELETE에 본문 길이를 자동으로 붙이지 않으므로 Content-Length를 명시한다(실측에서 발견한 테스트 결함)
  test(`C19 ${method} + 본문을 그대로 넘긴다`, async () => {
    await viaProxy(ctx.proxy.port, { target: `http://${U()}/c19`, method, body: 'payload', headers: { 'content-length': '7' } });
    assert.equal(arrived()[0].method, method);
    assert.equal(arrived()[0].body, 'payload');
  });
}
test('D10 파이프라인: 한 패킷의 두 요청을 따로, 순서대로 처리하고 본문이 섞이지 않는다', async () => {
  const r = await send(`POST http://${U()}/p1 HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\n\r\nabcGET http://${U()}/p2 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(r.responses, 2);
  assert.deepEqual(arrived().map((s) => [s.url, s.body]), [['/p1', 'abc'], ['/p2', '']]);
});
test('E4 소문자, 빈 토큰, 여러 줄의 Connection 토큰을 모두 지운다', async () => {
  await send(`GET http://${U()}/e4 HTTP/1.1\r\nHost: x\r\nconnection: x-a\r\nConnection: ,, X-B ,\r\nx-a: 1\r\nx-b: 2\r\n\r\n`);
  assert.equal(arrived()[0].headers['x-a'], undefined);
  assert.equal(arrived()[0].headers['x-b'], undefined);
});
test('E6 Connection에 나열된 Cookie, Authorization은 RFC대로 지운다(PRX-1 결정)', async () => {
  await send(`GET http://${U()}/e6 HTTP/1.1\r\nHost: x\r\nConnection: Cookie, Authorization\r\nCookie: s=1\r\nAuthorization: Basic eA==\r\n\r\n`);
  assert.equal(arrived()[0].headers.cookie, undefined);
  assert.equal(arrived()[0].headers.authorization, undefined);
});
test('E14 X-Forwarded-For, Forwarded를 추가하지 않는다', async () => {
  await send(`GET http://${U()}/e14 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.equal(arrived()[0].headers['x-forwarded-for'], undefined);
  assert.equal(arrived()[0].headers.forwarded, undefined);
});
