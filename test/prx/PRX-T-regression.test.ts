// [PRX-T] PRX 큰 단위 테스트: 사용자 흐름을 처음부터 끝까지 한 번에 확인한다.
//
//   실제 curl ──(-x 프록시)──▶ [프록시 127.0.0.1] ──▶ 로컬 목적지 서버
//                                   │
//                                   └── 기록(Flow) 1건 → onFlow
//
// 작은 단위(PRX-1~2b)가 각각 검증한 것을 이어 붙여 확인하므로 구현 전에도 통과하는 게 정상이다(회귀, red 대상 아님 — O9).
// TLS, STO, UI 단계는 이 흐름에 이어 붙인다(목적 나무 의존 관계).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { startProxy } from '../../src/proxy/server.ts';
import { closedPort } from './_upstream.ts';
import { startByteUpstream } from './_flow.ts';

const hasCurl = (() => {
  try {
    execFileSync('curl.exe', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// 같은 프로세스의 프록시가 응답할 수 있게 비동기로 실행한다(execFileSync를 쓰면 프록시가 멈춘다 — PRX-1 실측)
const curl = (proxyPort: number, args: string[]) =>
  new Promise<{ status: number; body: string }>((resolve) =>
    execFile('curl.exe', ['-s', '-m', '5', '-x', `http://127.0.0.1:${proxyPort}`, '-w', '\n%{http_code}', ...args], (_e, out) => {
      const i = out.lastIndexOf('\n');
      resolve({ body: out.slice(0, i), status: Number(out.slice(i + 1)) });
    }),
  );

async function setup() {
  const flows: any[] = [];
  const up = await startByteUpstream();
  const proxy = await startProxy({ port: 0, onFlow: (f) => void flows.push(f) });
  const waitFlow = async () => {
    for (let i = 0; i < 100 && flows.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    return flows;
  };
  return { up, proxy, flows, waitFlow, close: async () => (await proxy.close(), await up.close()) };
}

test('PRX 흐름: curl의 POST(쿠키·쿼리·본문)가 목적지에 중계되고, 같은 내용이 기록 1건으로 남는다', { skip: !hasCurl && 'curl.exe 없음' }, async () => {
  const t = await setup();
  try {
    const url = `http://127.0.0.1:${t.up.port}/echo?q=1`;
    const r = await curl(t.proxy.port, ['-H', 'Cookie: session=abc', '--data-binary', 'hello-sumun', url]);

    // 1) 사용자(curl)가 보는 것
    assert.equal(r.status, 200);
    assert.equal(r.body, 'hello-sumun');

    // 2) 목적지가 받은 것: origin-form 경로, 쿠키·본문 그대로, Via 추가, 프록시 전용 헤더 제거
    const got = t.up.got.at(-1)!;
    assert.equal(got.method, 'POST');
    assert.equal(got.url, '/echo?q=1');
    assert.equal(got.headers.cookie, 'session=abc');
    assert.equal(got.headers.via, '1.1 sumun');
    assert.equal(got.headers['proxy-connection'], undefined);
    assert.equal(got.body.toString(), 'hello-sumun');

    // 3) 기록(Flow): 요청 원문, 응답, 실패 없음
    const flows = await t.waitFlow();
    assert.equal(flows.length, 1);
    const f = flows[0];
    assert.equal(f.request.method, 'POST');
    assert.equal(f.request.url, url);
    const names = f.request.headers.map(([n]: [string]) => n);
    for (const n of ['Host', 'User-Agent', 'Proxy-Connection', 'Cookie', 'Content-Length']) assert.ok(names.includes(n), `기록에 ${n} 헤더`);
    assert.equal(f.request.body.toString(), 'hello-sumun');
    assert.equal(f.response.status, 200);
    assert.equal(f.response.body.toString(), 'hello-sumun');
    assert.equal(f.error, undefined);
  } finally {
    await t.close();
  }
});

test('PRX 흐름: 닿지 않는 목적지 → curl은 502, 기록에는 응답 없이 실패 원인이 남는다', { skip: !hasCurl && 'curl.exe 없음' }, async () => {
  const t = await setup();
  try {
    const url = `http://127.0.0.1:${await closedPort()}/x`;
    const r = await curl(t.proxy.port, [url]);
    assert.equal(r.status, 502);
    const [f] = await t.waitFlow();
    assert.equal(f.request.url, url);
    assert.equal(f.response, undefined);
    assert.deepEqual(f.error, { by: 'upstream', code: 'unreachable', status: 502 });
  } finally {
    await t.close();
  }
});
