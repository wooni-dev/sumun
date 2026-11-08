// [UI-3] 조회 API — 새 동작(구현 전에는 실패해야 정상). 사례: docs/ai/ui-cases.md U7·U8·U20·U24·U30·U35, 결정 D-8·D-9·D-13, STO 보고서 결정 6
//   GET /api/flows?host=&method=&status=&after=&limit= → { runId, items, next }   (limit 기본·최대 500, 순서는 id 오름차순)
//   GET /api/flows/<id> → 상세(본문 없음, 헤더 쌍 그대로)   GET /api/flows/<id>/body/request|response → octet-stream + attachment
//   POST /api/clear (Content-Type: application/json) → 204
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../../src/store/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import type { Flow } from '../../src/flow/flow.ts';

type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function req(port: number, urlPath: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(new Error(`응답 없음: ${method} ${urlPath}`)));
    r.end(body);
  });
}
const json = (r: Res) => JSON.parse(r.body.toString());

// 저장소에 완료 기록을 직접 넣는다(프록시 없이)
let nextId = 1;
function flow(o: { method?: string; host?: string; path?: string; status?: number; reqBody?: Buffer; resBody?: Buffer; headers?: [string, string][]; resHeaders?: [string, string][]; error?: Flow['error'] }): Flow {
  const id = nextId++;
  const host = o.host ?? 'example.test';
  const path = o.path ?? `/p${id}`;
  const reqBody = o.reqBody ?? Buffer.alloc(0);
  const f: Flow = {
    id,
    startedAt: 1_700_000_000_000 + id,
    durationMs: 5,
    request: { method: o.method ?? 'GET', url: `http://${host}${path}`, httpVersion: '1.1', headers: o.headers ?? [['Host', host]], target: { scheme: 'http', host, port: 80, path }, body: reqBody, bodySize: reqBody.length, bodyTruncated: false },
  };
  if (o.error) f.error = o.error;
  else {
    const resBody = o.resBody ?? Buffer.from('ok');
    f.response = { status: o.status ?? 200, statusMessage: 'OK', httpVersion: '1.1', headers: o.resHeaders ?? [['Content-Type', 'text/plain']], body: resBody, bodySize: resBody.length, bodyTruncated: false };
  }
  return f;
}
async function withDash(fill: (store: ReturnType<typeof createStore>) => void, fn: (port: number, auth: Record<string, string>, store: ReturnType<typeof createStore>) => Promise<void>) {
  const store = createStore();
  fill(store);
  const d = await startDashboard({ store, port: 0 });
  try {
    await fn(d.port, { authorization: `Bearer ${d.token}` }, store);
  } finally {
    await d.close();
  }
}

// --- 목록 ---
test('목록: { runId, items, next } JSON(no-store), id 오름차순, 요약에 본문·헤더(쿠키) 없음', async () => {
  await withDash(
    (s) => {
      s.addFlow(flow({ path: '/a', headers: [['Host', 'example.test'], ['Cookie', 'sid=LIST-COOKIE']], resBody: Buffer.from('LIST-BODY') }));
      s.addFlow(flow({ method: 'POST', path: '/b', reqBody: Buffer.from('POST-BODY') }));
      s.addFlow(flow({ path: '/c', status: 404 }));
    },
    async (port, auth, store) => {
      const r = await req(port, '/api/flows', { headers: auth });
      assert.equal(r.status, 200);
      assert.match(String(r.headers['content-type']), /^application\/json/);
      assert.match(String(r.headers['cache-control']), /no-store/);
      const v = json(r);
      assert.equal(v.runId, store.runId);
      assert.deepEqual(v.items.map((s: any) => s.url.replace(/^http:\/\/example\.test/, '')), ['/a', '/b', '/c']);
      assert.ok(v.items[0].id < v.items[1].id && v.items[1].id < v.items[2].id);
      assert.equal(v.next, null);
      const text = r.body.toString();
      assert.ok(text.includes('/a'), '긍정 전제(O30): 요약은 있다');
      for (const leak of ['LIST-COOKIE', 'LIST-BODY', 'POST-BODY']) assert.ok(!text.includes(leak), `목록에 ${leak} 없음`);
    },
  );
});

test('목록 필터·페이지: method·status·host, limit·next·after, limit 상한 500(U35)', async () => {
  await withDash(
    (s) => {
      s.addFlow(flow({ host: 'a.test', method: 'GET' }));
      s.addFlow(flow({ host: 'b.test', method: 'POST' }));
      s.addFlow(flow({ host: 'sub.a.test', status: 502 }));
      for (let i = 0; i < 520; i++) s.addFlow(flow({ host: 'many.test' }));
    },
    async (port, auth) => {
      const get = async (q: string) => {
        const r = await req(port, `/api/flows${q}`, { headers: auth });
        assert.equal(r.status, 200, `/api/flows${q}`);
        return json(r);
      };
      assert.deepEqual((await get('?method=POST')).items.map((s: any) => s.target.host), ['b.test']);
      assert.deepEqual((await get('?method=post')).items.map((s: any) => s.target.host), ['b.test'], '메서드는 대소문자 무시(STO-3)');
      assert.deepEqual((await get('?status=502')).items.map((s: any) => s.target.host), ['sub.a.test']);
      assert.deepEqual((await get('?host=a.test')).items.map((s: any) => s.target.host), ['a.test', 'sub.a.test']);

      const p1 = await get('?host=a.test&limit=1');
      assert.equal(p1.items.length, 1);
      assert.equal(p1.next, p1.items[0].id, '받은 수 = limit이면 next = 마지막 id');
      const p2 = await get(`?host=a.test&limit=1&after=${p1.next}`);
      assert.deepEqual(p2.items.map((s: any) => s.target.host), ['sub.a.test']);

      const all = await get('');
      assert.equal(all.items.length, 500, '기본 limit 500');
      assert.equal(all.next, all.items[499].id);
      const big = await get('?limit=100000');
      assert.equal(big.items.length, 500, '500보다 큰 limit은 500');
      const rest = await get(`?after=${all.next}`);
      assert.equal(rest.items.length, 523 - 500);
      assert.equal(rest.next, null);
    },
  );
});

test('목록 조건이 잘못되면 400 고정 문구 — 모르는 이름·같은 이름 두 번·숫자 아님·범위 밖, 입력을 되돌리지 않는다(U30)', async () => {
  await withDash(
    (s) => s.addFlow(flow({})),
    async (port, auth) => {
      assert.equal((await req(port, '/api/flows?method=GET&status=200&limit=10&after=0&host=example.test', { headers: auth })).status, 200, '긍정 전제: 올바른 조건 200');
      for (const q of ['foo=1', 'x<script>=1', 'method=GET&method=POST', 'status=abc', 'status=1000', 'status=20O', 'limit=0', 'limit=1e3', 'after=-1', 'after=1.5', 'limit=', 'host=a&host=b']) {
        const r = await req(port, `/api/flows?${q}`, { headers: auth });
        assert.equal(r.status, 400, q);
        assert.match(String(r.headers['content-type']), /^text\/plain/);
        assert.ok(!r.body.toString().includes('script') && !r.body.toString().includes('abc') && !r.body.toString().includes('20O'), `${q}: 입력 반사 없음`);
      }
    },
  );
});

// --- 상세 ---
test('상세: 완료 기록의 요청·응답 머리(헤더 쌍 그대로 — 쿠키·__proto__ 포함), 본문 대신 크기·잘림만', async () => {
  let id = 0;
  await withDash(
    (s) => {
      const f = flow({ method: 'POST', headers: [['Host', 'example.test'], ['Cookie', 'sid=DETAIL-COOKIE'], ['__proto__', 'x'], ['X-A', '1'], ['x-a', '2']], reqBody: Buffer.from('REQ-BODY'), resBody: Buffer.from('RES-BODY'), resHeaders: [['Set-Cookie', 'k=v']] });
      id = f.id;
      s.addFlow(f);
    },
    async (port, auth, store) => {
      const r = await req(port, `/api/flows/${id}`, { headers: auth });
      assert.equal(r.status, 200);
      assert.match(String(r.headers['content-type']), /^application\/json/);
      const v = json(r);
      assert.equal(v.id, id);
      assert.equal(v.runId, store.runId);
      assert.deepEqual(v.request.headers, [['Host', 'example.test'], ['Cookie', 'sid=DETAIL-COOKIE'], ['__proto__', 'x'], ['X-A', '1'], ['x-a', '2']]);
      assert.deepEqual(v.response.headers, [['Set-Cookie', 'k=v']]);
      assert.equal(v.request.method, 'POST');
      assert.equal(v.request.bodySize, 8);
      assert.equal(v.request.bodyTruncated, false);
      assert.equal(v.response.status, 200);
      assert.equal(v.response.bodySize, 8);
      assert.equal('body' in v.request || 'body' in v.response, false, '상세에 본문 없음(U35)');
      assert.ok(!r.body.toString().includes('REQ-BODY') && !r.body.toString().includes('RES-BODY'));
    },
  );
});

test('상세·본문: 없는 id, 진행 중인 요청, id 모양이 아닌 경로는 404', async () => {
  let pendingId = 0;
  let doneId = 0;
  await withDash(
    (s) => {
      const f = flow({});
      doneId = f.id;
      s.addFlow(f);
      pendingId = nextId++;
      s.addStart({ id: pendingId, startedAt: Date.now(), request: { method: 'GET', url: 'http://example.test/wait', httpVersion: '1.1', headers: [], target: { scheme: 'http', host: 'example.test', port: 80, path: '/wait' } } });
    },
    async (port, auth) => {
      assert.equal((await req(port, `/api/flows/${doneId}`, { headers: auth })).status, 200, '긍정 전제');
      for (const p of [`${pendingId}`, '999999', '0', `0${doneId}`, 'abc', '1.5', '-1', '1'.repeat(30), `${doneId}/`, `${doneId}/body`, `${doneId}/body/other`]) {
        assert.equal((await req(port, `/api/flows/${p}`, { headers: auth })).status, 404, p);
      }
      assert.equal((await req(port, `/api/flows/${pendingId}/body/request`, { headers: auth })).status, 404, '진행 중 본문');
    },
  );
});

// --- 본문 (D-9, U20) ---
test('본문: 원본 바이트 그대로 application/octet-stream + Content-Disposition attachment(원래 Content-Type으로 렌더하지 않음), 응답 없는 기록은 404', async () => {
  const bin = Buffer.from([0x00, 0xff, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e, 0x0d, 0x0a]); // NUL, 0xFF, "<script>\r\n"
  let id = 0;
  let errId = 0;
  await withDash(
    (s) => {
      const f = flow({ method: 'POST', reqBody: Buffer.from('요청 본문'), resBody: bin, resHeaders: [['Content-Type', 'text/html']] });
      id = f.id;
      s.addFlow(f);
      const e = flow({ error: { by: 'upstream', code: 'unreachable', status: 502 } });
      errId = e.id;
      s.addFlow(e);
    },
    async (port, auth) => {
      const rq = await req(port, `/api/flows/${id}/body/request`, { headers: auth });
      assert.equal(rq.status, 200);
      assert.equal(rq.body.toString(), '요청 본문');
      const rs = await req(port, `/api/flows/${id}/body/response`, { headers: auth });
      assert.equal(rs.status, 200);
      assert.ok(rs.body.equals(bin), '바이트 그대로');
      for (const r of [rq, rs]) {
        assert.match(String(r.headers['content-type']), /^application\/octet-stream/);
        assert.match(String(r.headers['content-disposition']), /^attachment/);
        assert.equal(r.headers['x-content-type-options'], 'nosniff');
      }
      assert.equal((await req(port, `/api/flows/${errId}/body/response`, { headers: auth })).status, 404, '응답 없는 기록');
      assert.equal((await req(port, `/api/flows/${errId}/body/request`, { headers: auth })).status, 200, '요청 본문은 있다(빈 본문)');
    },
  );
});

// --- 지우기 (D-8, U6, U7) ---
test('지우기: POST + Content-Type application/json만 204 — GET·다른 메서드 405, 다른 Content-Type 415, 막힌 요청은 지우지 않는다', async () => {
  await withDash(
    (s) => s.addFlow(flow({})),
    async (port, auth, store) => {
      const g = await req(port, '/api/clear', { headers: auth });
      assert.equal(g.status, 405);
      assert.match(String(g.headers.allow), /POST/);
      assert.equal((await req(port, '/api/clear', { method: 'PUT', headers: auth })).status, 405);
      for (const ct of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp']) {
        const r = await req(port, '/api/clear', { method: 'POST', headers: { ...auth, ...(ct ? { 'content-type': ct } : {}) }, body: '{}' });
        assert.equal(r.status, 415, `Content-Type ${ct}`);
      }
      assert.equal(store.list().length, 1, '막힌 요청은 지우지 않았다(긍정 전제: 기록 있음)');
      const ok = await req(port, '/api/clear', { method: 'POST', headers: { ...auth, 'content-type': 'application/json; charset=utf-8' }, body: '{}' });
      assert.equal(ok.status, 204);
      assert.equal(ok.body.length, 0);
      assert.equal(store.list().length, 0);
      assert.equal(json(await req(port, '/api/flows', { headers: auth })).items.length, 0);
    },
  );
});

test('읽기 경로는 GET만: POST·DELETE는 405 + Allow: GET, GET 요청은 아무것도 바꾸지 않는다(U7)', async () => {
  let id = 0;
  await withDash(
    (s) => {
      const f = flow({});
      id = f.id;
      s.addFlow(f);
    },
    async (port, auth, store) => {
      for (const [m, p] of [['POST', '/api/flows'], ['DELETE', '/api/flows'], ['DELETE', `/api/flows/${id}`], ['POST', `/api/flows/${id}/body/request`]]) {
        const r = await req(port, p, { method: m, headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 405, `${m} ${p}`);
        assert.equal(r.headers.allow, 'GET', `${m} ${p}`);
      }
      for (const p of ['/api/flows', `/api/flows/${id}`, `/api/flows/${id}/body/request`, `/api/flows/${id}/body/response`]) assert.equal((await req(port, p, { headers: auth })).status, 200, p);
      assert.equal(store.list().length, 1, 'GET 뒤에도 기록 그대로');
    },
  );
});
