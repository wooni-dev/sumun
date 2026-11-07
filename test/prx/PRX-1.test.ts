// [PRX-1] 요청 중계 + 열린 프록시·루프·Host·hop-by-hop·오류 응답
// 사례 번호는 docs/ai/prx1-cases.md (검토 에이전트 제안)와 같다. 인터넷에 접속하지 않는다.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startProxy } from '../../src/proxy/server.ts';
import { startUpstream, viaProxy, connectViaProxy, closedPort } from './_upstream.ts';

let proxy: Awaited<ReturnType<typeof startProxy>>;
let up: Awaited<ReturnType<typeof startUpstream>>;
before(async () => {
  proxy = await startProxy({ port: 0 });
  up = await startUpstream();
});
after(async () => {
  await proxy.close();
  await up.close();
});
const target = (path = '/hello?q=1') => `http://127.0.0.1:${up.port}${path}`;
// 이번 테스트가 시작된 뒤에 목적지에 도착한 마지막 요청. 이전 테스트의 요청을 잘못 읽지 않게 한다(red에서 발견)
let mark = 0;
beforeEach(() => (mark = up.seen.length));
const last = () => {
  assert.ok(up.seen.length > mark, '이번 테스트의 요청이 목적지에 도착하지 않음');
  return up.seen.at(-1)!;
};

// --- 기본 중계 ---

test('A1: 127.0.0.1(IPv4 루프백)에만 바인딩한다', () => {
  assert.equal(proxy.address().address, '127.0.0.1');
});

test('absolute-form GET을 목적지에 origin-form으로 넘기고 응답(상태, 헤더, 본문)을 그대로 돌려준다', async () => {
  const r = await viaProxy(proxy.port, { target: target() });
  assert.equal(last().method, 'GET');
  assert.equal(last().url, '/hello?q=1');
  assert.equal(r.status, 201);
  assert.equal(r.headers['x-up'], 'yes');
  assert.equal(r.body, 'from-upstream');
});

test('C8: URL의 #fragment는 넘기지 않는다', async () => {
  await viaProxy(proxy.port, { target: target('/hello?q=1#frag') });
  assert.equal(last().url, '/hello?q=1');
});

test('C10: 경로가 없으면 / 로 넘긴다', async () => {
  await viaProxy(proxy.port, { target: `http://127.0.0.1:${up.port}` });
  assert.equal(last().url, '/');
});

test('C14: Host 헤더는 요청 URL의 호스트로 바꿔 넘긴다', async () => {
  await viaProxy(proxy.port, { target: target(), headers: { host: 'b.example' } });
  assert.equal(last().headers.host, `127.0.0.1:${up.port}`);
});

test('C19: POST 본문을 그대로 넘긴다', async () => {
  await viaProxy(proxy.port, { target: target('/submit'), method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello body' });
  assert.equal(last().method, 'POST');
  assert.equal(last().body, 'hello body');
});

// --- hop-by-hop ---

test('E1/E2: hop-by-hop 헤더(Proxy-Authorization 포함)는 목적지에 하나도 넘기지 않는다', async () => {
  // Trailer 헤더는 chunked 본문일 때만 보낼 수 있어서(Node 클라이언트 제약) POST + chunked로 보낸다
  await viaProxy(proxy.port, {
    target: target('/e1'),
    method: 'POST',
    body: 'x',
    headers: {
      connection: 'keep-alive',
      'proxy-connection': 'Keep-Alive',
      'keep-alive': 'timeout=5',
      te: 'trailers',
      'transfer-encoding': 'chunked',
      trailer: 'x-t',
      upgrade: 'h2c',
      'proxy-authorization': 'Basic dTpw',
    },
  });
  assert.equal(last().url, '/e1', '먼저 정상 중계돼야 함');
  for (const h of ['proxy-connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authorization']) {
    assert.equal(last().headers[h], undefined, `${h}가 목적지에 넘어감`);
  }
});

test('E3: Connection 헤더에 나열된 헤더도 지운다', async () => {
  await viaProxy(proxy.port, { target: target(), headers: { connection: 'keep-alive, X-Secret', 'x-secret': 'v' } });
  assert.equal(last().headers['x-secret'], undefined);
});

test('E5: Connection에 Host, Content-Length가 나열돼도 Host와 본문 경계는 지키고 본문은 온전하다', async () => {
  await viaProxy(proxy.port, { target: target('/e5'), method: 'POST', headers: { connection: 'Host, Content-Length', 'content-length': '5' }, body: 'abcde' });
  assert.equal(last().headers.host, `127.0.0.1:${up.port}`);
  assert.equal(last().body, 'abcde');
});

test('E8: 목적지 응답의 Connection에 나열된 헤더는 클라이언트에 넘기지 않는다', async () => {
  const u = await startUpstream((_q, res) => {
    res.setHeader('connection', 'X-Foo');
    res.setHeader('x-foo', '1');
    res.end('ok');
  });
  try {
    const r = await viaProxy(proxy.port, { target: `http://127.0.0.1:${u.port}/` });
    // 먼저 정상 중계됐는지 확인한다. 이게 없으면 아무 응답도 안 넘기는 프록시도 통과한다(red에서 발견)
    assert.equal(r.status, 200);
    assert.equal(r.body, 'ok');
    assert.equal(r.headers['x-foo'], undefined);
  } finally {
    await u.close();
  }
});

test('E13: 요청과 응답에 Via: 1.1 sumun을 붙이고, 기존 Via는 보존한다', async () => {
  const r = await viaProxy(proxy.port, { target: target(), headers: { via: '1.0 other' } });
  assert.equal(last().headers.via, '1.0 other, 1.1 sumun');
  assert.match(String(r.headers.via), /1\.1 sumun/);
});

// --- 거부해야 하는 요청 ---

test('A11: origin-form 요청(웹페이지 fetch와 같은 형태)은 Host를 믿지 않고 400', async () => {
  const before = up.seen.length;
  const r = await viaProxy(proxy.port, { target: '/x', headers: { host: `127.0.0.1:${up.port}` } });
  assert.equal(r.status, 400);
  assert.equal(up.seen.length, before, '목적지로 넘어가면 안 됨');
});

test('A12: origin-form + 다른 Host(DNS 리바인딩)도 400', async () => {
  const r = await viaProxy(proxy.port, { target: '/x', headers: { host: 'evil.example:8080' } });
  assert.equal(r.status, 400);
});

test('C3: http가 아닌 scheme(ftp, file)은 400', async () => {
  assert.equal((await viaProxy(proxy.port, { target: 'ftp://example.com/x' })).status, 400);
  assert.equal((await viaProxy(proxy.port, { target: 'file:///C:/Windows/win.ini' })).status, 400);
});

test('C4: absolute-form https 요청은 평문으로 넘기지 않고 501', async () => {
  assert.equal((await viaProxy(proxy.port, { target: 'https://example.com/' })).status, 501);
});

test('C18: CONNECT는 501로 답한다(응답 없이 끊거나 멈추지 않음)', async () => {
  assert.equal(await connectViaProxy(proxy.port, 'example.com:443'), 501);
});

// --- 루프 ---

test('B1/B5: 프록시 자기 자신(127.0.0.1:<프록시 포트>)으로의 요청은 508', async () => {
  assert.equal((await viaProxy(proxy.port, { target: `http://127.0.0.1:${proxy.port}/` })).status, 508);
});

test('B2: localhost, [::1] 표기로 자기 자신을 가리켜도 508', async () => {
  assert.equal((await viaProxy(proxy.port, { target: `http://localhost:${proxy.port}/` })).status, 508);
  assert.equal((await viaProxy(proxy.port, { target: `http://[::1]:${proxy.port}/` })).status, 508);
});

test('B4: 이미 이 프록시의 Via가 붙은 요청은 508', async () => {
  const before = up.seen.length;
  const r = await viaProxy(proxy.port, { target: target(), headers: { via: '1.1 sumun' } });
  assert.equal(r.status, 508);
  assert.equal(up.seen.length, before);
});

// --- 오류 응답 ---

test('B10: 목적지에 연결할 수 없으면 502 (text/plain)', async () => {
  const port = await closedPort();
  const r = await viaProxy(proxy.port, { target: `http://127.0.0.1:${port}/` });
  assert.equal(r.status, 502);
  assert.match(String(r.headers['content-type']), /^text\/plain/);
});

test('B12: 오류 응답은 요청 URL이나 로컬 경로·스택을 반영하지 않는다', async () => {
  const port = await closedPort();
  const r = await viaProxy(proxy.port, { target: `http://127.0.0.1:${port}/<script>alert(1)</script>` });
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.body, /<script>|alert|[A-Z]:\\|\bat \S+:\d+/);
});
