// [UI 큰 단위 끝 — 독립 검토] 실제 진입점(node src/index.ts) + curl.exe로 사용자 흐름과 대시보드 보호를 본다.
// 실행: node scripts/probe/ui-final-review/api-flow.mjs     출력: 단계별 JSON 한 줄씩
import { startUpstream, startApp, curl, raw, closedPort, log, sleep, portOpen } from './_env.mjs';

const up = await startUpstream();
const app = await startApp();
const D = app.dashPort;
const P = app.proxyPort;
const AUTH = { Authorization: `Bearer ${app.token}` };
const H = { Host: `127.0.0.1:${D}` };
log('start', { proxyPort: P, dashPort: D, upstream: up.port, startLine: app.stdout().trim() });

try {
  // 1) 평문 HTTP 요청 여러 개(curl -x)
  const U = `http://127.0.0.1:${up.port}`;
  for (const p of ['/hello?q=secret-token-in-query', '/json', '/notfound', '/xss', '/svg', '/bidi', '/gz', '/bin']) {
    const r = await curl(['-x', `http://127.0.0.1:${P}`, '-o', 'NUL', '-w', '%{http_code}', `${U}${p}`]);
    log('curl', { path: p, http: r.out, code: r.code });
  }
  const post = await curl(['-x', `http://127.0.0.1:${P}`, '-o', 'NUL', '-w', '%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/json', '-H', `X-Req: <img src=x onerror=alert(1)>`, '--data', '{"password":"hunter2"}', `${U}/post`]);
  log('curl-post', { http: post.out });
  const pathXss = await curl(['-x', `http://127.0.0.1:${P}`, '-o', 'NUL', '-w', '%{http_code}', `${U}/%3Cscript%3Ealert(1)%3C/script%3E`]);
  log('curl-path-xss', { http: pathXss.out });
  // 2) 닫힌 포트
  const cp = await closedPort();
  const closed = await curl(['-x', `http://127.0.0.1:${P}`, '-w', '\n%{http_code}', `http://127.0.0.1:${cp}/`]);
  log('curl-closed-port', { port: cp, out: closed.out.slice(-200) });
  await sleep(300);

  // 3) API: 목록·필터·상세·본문
  const list = await raw(D, { path: '/api/flows', headers: { ...H, ...AUTH } });
  const items = JSON.parse(list.body).items;
  log('list', { status: list.status, n: items.length, rows: items.map((s) => [s.id, s.method, s.target?.path ?? s.url, s.status ?? s.error?.code]) });
  log('list-summary-keys', Object.keys(items[0] ?? {}));
  for (const q of ['host=127.0.0.1', 'method=POST', 'status=404', 'status=502', 'host=nope.example', 'methd=GET', 'status=abc', 'status=200&status=404']) {
    const r = await raw(D, { path: `/api/flows?${q}`, headers: { ...H, ...AUTH } });
    log('filter', { q, status: r.status, n: r.status === 200 ? JSON.parse(r.body).items.length : r.body.toString().slice(0, 60) });
  }
  const xssRow = items.find((s) => (s.target?.path ?? '').startsWith('/xss'));
  const det = await raw(D, { path: `/api/flows/${xssRow.id}`, headers: { ...H, ...AUTH } });
  const dj = JSON.parse(det.body);
  log('detail', { status: det.status, keys: Object.keys(dj), respHeaders: dj.response?.headers, bodySize: dj.response?.bodySize, hasBodyField: 'body' in (dj.response ?? {}) });
  const body = await raw(D, { path: `/api/flows/${xssRow.id}/body/response`, headers: { ...H, ...AUTH } });
  log('body', { status: body.status, ct: body.headers['content-type'], cd: body.headers['content-disposition'], csp: body.headers['content-security-policy'], nosniff: body.headers['x-content-type-options'], len: body.body.length });
  const postRow = items.find((s) => s.method === 'POST');
  const rb = await raw(D, { path: `/api/flows/${postRow.id}/body/request`, headers: { ...H, ...AUTH } });
  log('req-body', { status: rb.status, text: rb.body.toString() });
  const closedRow = items.find((s) => s.target?.port === cp);
  log('closed-row', closedRow);

  // 4) 보호: 토큰·Host·Origin·Sec-Fetch-Site·Via·CORS·폼 CSRF
  const cases = [
    ['정적 / 토큰 없이', { path: '/', headers: H }],
    ['API 토큰 없음', { path: '/api/flows', headers: H }],
    ['API 틀린 토큰', { path: '/api/flows', headers: { ...H, Authorization: 'Bearer ' + 'A'.repeat(43) } }],
    ['리바인딩 Host evil.test', { path: '/api/flows', headers: { Host: `evil.test:${D}`, ...AUTH } }],
    ['리바인딩 Host 127.0.0.1(포트 없음)', { path: '/api/flows', headers: { Host: '127.0.0.1', ...AUTH } }],
    ['리바인딩 Host evil.test → 정적 /', { path: '/', headers: { Host: `evil.test:${D}` } }],
    ['Origin 다른 사이트', { path: '/api/flows', headers: { ...H, ...AUTH, Origin: 'http://evil.test' } }],
    ['Origin 다른 포트 localhost', { path: '/api/flows', headers: { ...H, ...AUTH, Origin: 'http://localhost:3000' } }],
    ['Origin null', { path: '/api/flows', headers: { ...H, ...AUTH, Origin: 'null' } }],
    ['Sec-Fetch-Site cross-site', { path: '/api/flows', headers: { ...H, ...AUTH, 'Sec-Fetch-Site': 'cross-site' } }],
    ['Sec-Fetch-Site same-site', { path: '/', headers: { ...H, 'Sec-Fetch-Site': 'same-site' } }],
    ['Via sumun', { path: '/api/flows', headers: { ...H, ...AUTH, Via: '1.1 sumun' } }],
    ['OPTIONS 사전 확인', { method: 'OPTIONS', path: '/api/clear', headers: { ...H, Origin: 'http://evil.test', 'Access-Control-Request-Method': 'POST' } }],
    ['폼 CSRF clear text/plain(토큰 있음이라 가정)', { method: 'POST', path: '/api/clear', headers: { ...H, ...AUTH, 'Content-Type': 'text/plain' }, body: '{}' }],
    ['clear 토큰 없음', { method: 'POST', path: '/api/clear', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' }],
    ['절대 형식 대상', { path: `http://127.0.0.1:${D}/api/flows`, headers: { ...H, ...AUTH } }],
    ['정적 경로 조작', { path: '/..%2f..%2fpackage.json', headers: H }],
  ];
  for (const [name, o] of cases) {
    const r = await raw(D, o);
    log('guard', { name, status: r.status, acao: r.headers?.['access-control-allow-origin'] ?? null, body: r.body?.toString().slice(0, 50) });
  }
  const root = await raw(D, { path: '/', headers: H });
  log('security-headers', Object.fromEntries(Object.entries(root.headers).filter(([k]) => /security|frame|nosniff|referrer|cache|cross-origin|content-type-options/i.test(k))));

  // 5) 프록시를 거친 대시보드 요청(여러 주소 표기) — 403이고 기록이 남지 않아야 한다
  const before = JSON.parse((await raw(D, { path: '/api/flows', headers: { ...H, ...AUTH } })).body).items.length;
  const hosts = ['127.0.0.1', 'localhost', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '127.0.0.2', '0.0.0.0', 'localhost.', 'LOCALHOST'];
  for (const h of hosts) {
    const r = await curl(['-x', `http://127.0.0.1:${P}`, '-H', `Authorization: Bearer ${app.token}`, '-w', '\n%{http_code}', `http://${h}:${D}/api/flows`]);
    const lines = r.out.split('\n');
    log('via-proxy', { host: h, http: lines.at(-1), leaked: /"items"/.test(r.out), head: lines[0].slice(0, 60), err: r.err.slice(0, 80) });
  }
  for (const h of ['127.0.0.1', 'localhost', '127.1', '[::1]', '2130706433']) {
    const r = await curl(['-p', '-x', `http://127.0.0.1:${P}`, '-H', `Authorization: Bearer ${app.token}`, '-w', '\n%{http_code}', `http://${h}:${D}/api/flows`]);
    log('connect-proxy', { host: h, http: r.out.split('\n').at(-1), leaked: /"items"/.test(r.out), err: r.err.slice(0, 100) });
  }
  const after = JSON.parse((await raw(D, { path: '/api/flows', headers: { ...H, ...AUTH } })).body).items;
  log('records-after-proxy-attempts', { before, after: after.length, newRows: after.slice(before).map((s) => [s.method, s.target?.host, s.target?.port, s.status ?? s.error?.code]) });

  // 6) 지우기
  const clr = await raw(D, { method: 'POST', path: '/api/clear', headers: { ...H, ...AUTH, 'Content-Type': 'application/json' }, body: '{}' });
  const afterClear = JSON.parse((await raw(D, { path: '/api/flows', headers: { ...H, ...AUTH } })).body).items.length;
  log('clear', { status: clr.status, afterClear });

  // 7) 터미널 출력: 경로·쿼리·헤더가 나오지 않는지
  const so = app.stdout();
  log('stdout', { hasQuerySecret: so.includes('secret-token-in-query'), hasPassword: so.includes('hunter2'), hasXss: so.includes('onerror'), lines: so.trim().split('\n').slice(0, 4) });
} finally {
  await app.stop();
  await up.close();
  await sleep(300);
  log('ports-after-stop', { proxy: await portOpen(P), dashboard: await portOpen(D), upstream: await portOpen(up.port) });
}
