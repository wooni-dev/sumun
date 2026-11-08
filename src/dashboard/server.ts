// [UI-1] 대시보드 서버 골격과 요청 보호. 사례·결정: docs/ai/ui-cases.md(배정 "UI-1", D-1~D-3, D-5~D-7, D-11~D-13)
//
// 저장소에는 방문한 모든 사이트의 쿠키·Authorization·본문이 원본으로 있다. 127.0.0.1 바인딩만으로는 부족하다:
//   - 다른 웹사이트가 DNS 리바인딩으로 같은 출처인 척하거나(U1·U2), 다른 포트의 개발 서버가 같은 사이트가 된다(U11)
//   - 프록시를 거친 요청은 늘 127.0.0.1에서 온다(실험 E5) — 주소로는 구별할 수 없다
//   - 같은 PC의 다른 Windows 사용자도 127.0.0.1을 쓴다(U39)
// 그래서 모든 요청을 처리 전에 검사한다(guard): 대상 형식 → Via → Host → Origin → Sec-Fetch-Site → 본문 크기 → (API면) 토큰.
// 토큰은 실행마다 새로 만들고(D-2), 쿠키가 아니라 요청 헤더로만 받는다(D-3 — CSRF와 다른 포트로 새는 쿠키를 원리상 없앤다).
// 응답에는 CORS 헤더를 붙이지 않는다(D-7). 오류 문구는 고정이고 입력을 되돌리지 않는다. 로그를 찍지 않는다(U30, U31, U51).
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../store/store.ts';
import { handleApi, type ApiResult } from './api.ts';
import { createEventHub, type EventOptions } from './events.ts';

const BIND_HOST = '127.0.0.1';
export const DASHBOARD_LIMITS = { bodyBytes: 16 * 1024, headerBytes: 16 * 1024 }; // D-13 [추측 수치]
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
// 정적 파일은 정해 둔 목록만(경로를 파일 이름으로 바꾸지 않는다 — 경로 조작 없음)
const PUBLIC: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/view.js': ['view.js', 'text/javascript; charset=utf-8'], // [UI-5] 화면 순수 함수(app.js가 import)
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};

// 모든 응답에 붙인다(D-7, D-11, D-16, U10, U18, U50)
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
function secureHeaders(res: http.ServerResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

const TEXT: Record<number, string> = {
  400: '잘못된 요청입니다. 대시보드는 프록시가 아닙니다.',
  401: '접속 토큰이 필요합니다. 터미널에 나온 대시보드 주소(#t=…)로 여세요.',
  403: '이 요청은 대시보드에서 받지 않습니다(다른 사이트·다른 주소·프록시를 거친 요청). 브라우저 프록시 설정의 우회 목록에 127.0.0.1과 localhost를 넣고, 터미널에 나온 주소로 여세요.',
  404: '없는 경로입니다.',
  405: '이 경로에서 쓸 수 없는 메서드입니다.',
  413: '요청 본문이 너무 큽니다.',
  415: '이 요청은 Content-Type: application/json으로만 받습니다.',
  500: '대시보드에서 오류가 났습니다.',
  503: '실시간 연결이 너무 많습니다. 쓰지 않는 대시보드 탭을 닫고 다시 여세요.', // [UI-4] 연결 상한(U32)
};
// [UI-3] 같은 상태 코드의 다른 고정 문구(입력을 넣지 않는다 — U30)
const TEXT_QUERY = '조회 조건이 올바르지 않습니다. host, method, status, after, limit을 한 번씩만 쓸 수 있고, status·after·limit은 숫자입니다.';
function fail(res: http.ServerResponse, status: number, extra: Record<string, string> = {}, text?: string) {
  if (res.headersSent) return void res.destroy();
  const body = text ?? TEXT[status] ?? TEXT[500];
  res.writeHead(status, { ...extra, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function json(res: http.ServerResponse, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// 요청 검사: 막을 상태 코드 또는 0. 토큰 검사는 API에서 따로(401)
function guard(req: http.IncomingMessage, port: number): number {
  const url = req.url ?? '';
  if (!url.startsWith('/')) return 400; // 절대 형식(프록시처럼 쓰기)·`*`
  const via = req.headers.via;
  if (via && /\bsumun\b/i.test(String(via))) return 403; // 프록시를 거친 요청(D-5, U14)
  const host = String(req.headers.host ?? '').toLowerCase();
  if (host !== `${BIND_HOST}:${port}` && host !== `localhost:${port}`) return 403; // 리바인딩(U1·U2, D-6)
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${BIND_HOST}:${port}` && origin !== `http://localhost:${port}`) return 403; // 다른 출처·다른 포트(U4~U6, U11)
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403; // 교차·같은 사이트(D-7, U9)
  const len = Number(req.headers['content-length'] ?? 0);
  if (!(len <= DASHBOARD_LIMITS.bodyBytes)) return 413; // U37
  return 0;
}

// Authorization: Bearer <토큰> — 길이가 다르면 바로 거절, 같으면 timingSafeEqual(U46)
function authorized(req: http.IncomingMessage, token: Buffer): boolean {
  const m = String(req.headers.authorization ?? '').match(/^Bearer +(\S+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1]);
  return given.length === token.length && crypto.timingSafeEqual(given, token);
}

// [UI-3] api.ts의 결과를 응답으로. 본문은 원래 Content-Type으로 보내지 않는다 — octet-stream + attachment(+ UI-1의 nosniff·CSP).
// 브라우저가 주소창에서 열어도 렌더링하지 않고 내려받는다(U20: 기록된 HTML·SVG가 대시보드 출처에서 실행되지 않게)
function sendApi(res: http.ServerResponse, r: ApiResult) {
  if (r.status === 204) return void (res.writeHead(204), res.end());
  if (r.status === 200 && 'bytes' in r) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="body.bin"', 'Content-Length': r.bytes.length });
    return void res.end(r.bytes);
  }
  if (r.status === 200) return json(res, r.json);
  if (r.status === 405) return fail(res, 405, { Allow: r.allow });
  if (r.status === 400) return fail(res, 400, {}, TEXT_QUERY);
  fail(res, r.status);
}

function servePublic(res: http.ServerResponse, method: string, file: string, type: string) {
  let body: Buffer;
  try {
    body = fs.readFileSync(path.join(PUBLIC_DIR, file));
  } catch {
    return fail(res, 404); // 아직 없는 파일(app.js는 UI-5)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
  res.end(method === 'HEAD' ? undefined : body);
}

// [PRX-1c] A9와 같다: Windows는 다른 프로그램이 0.0.0.0:P를 쓰는 중에도 127.0.0.1:P 바인딩을 허용한다(U41).
// localhost는 ::1부터 풀리므로 [::1]:P도 본다(U42). 누가 응답하면 시작하지 않는다
// [UI-2b] B-1: 자기 자신에게 연결된 것(TCP self-connect — 나가는 소켓의 로컬 포트가 마침 P)은 응답이 아니다. Windows는 로컬 포트를 연속 번호로 줘서
// 직전에 받은 임시 포트의 다음 번호를 검사하면 이렇게 된다 [확인됨: scripts/probe/ui3-selfconnect.mjs 10/10]. 실제 리스너가 있는 번호는 로컬 포트로 주지 않으므로
// 이 비교는 남이 흉내 낼 수 없다(ui2b-cases F-b). 값은 destroy 전에 읽는다 — 뒤에 읽으면 로컬 쪽이 사라진다(Z4). 주소는 글자 상수가 아니라 서로 비교한다(Z5)
function portAnswers(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => {
      const self = s.localPort === s.remotePort && s.localAddress === s.remoteAddress;
      s.destroy();
      resolve(!self);
    });
    s.setTimeout(500, () => (s.destroy(), resolve(false)));
    s.on('error', () => resolve(false));
  });
}

export async function startDashboard({
  store,
  port = 8081,
  headersTimeoutMs = 10_000, // 이 시간 안에 헤더를 다 보내지 않으면 닫는다(U37)
  events, // [UI-4] 실시간 통로 상한(기본 EVENT_LIMITS)
  decrypt = false, // [UI-5] HTTPS 복호화를 켰는지 — 화면이 "복호화 꺼짐" 안내를 보일지 정한다(STO 결정 4)
}: {
  store: Store;
  port?: number;
  headersTimeoutMs?: number;
  events?: EventOptions;
  decrypt?: boolean;
}): Promise<{ port: number; token: string; url: string; close: () => Promise<void> }> {
  if (port !== 0 && ((await portAnswers(port, BIND_HOST)) || (await portAnswers(port, '::1'))))
    throw Object.assign(new Error(`대시보드 포트 ${port}를 이미 다른 프로그램이 쓰고 있습니다.`), { code: 'EADDRINUSE' });

  const token = crypto.randomBytes(32).toString('base64url'); // 43자, 실행마다 새로(D-2)
  const tokenBuf = Buffer.from(token);
  let actualPort = port;
  const hub = createEventHub(store, events);

  const server = http.createServer(
    { maxHeaderSize: DASHBOARD_LIMITS.headerBytes, connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(headersTimeoutMs / 3))) },
    (req, res) => {
      secureHeaders(res);
      try {
        const blocked = guard(req, actualPort);
        if (blocked) {
          fail(res, blocked, { Connection: 'close' });
          req.resume();
          return;
        }
        // 길이 없이 오는 본문도 상한을 넘으면 끊는다
        let seen = 0;
        req.on('data', (c: Buffer) => {
          seen += c.length;
          if (seen > DASHBOARD_LIMITS.bodyBytes) fail(res, 413, { Connection: 'close' }), req.destroy();
        });
        const method = req.method ?? 'GET';
        const pathname = (req.url ?? '/').split('?')[0];
        // CORS 사전 확인(OPTIONS)에는 토큰이 붙지 않는다 — 어느 경로든 답하지 않는다(D-7)
        if (method === 'OPTIONS') return fail(res, 405, { Allow: 'GET, HEAD, POST' });
        if (pathname.startsWith('/api/')) {
          if (!authorized(req, tokenBuf)) return fail(res, 401);
          if (pathname === '/api/ping') return method === 'GET' ? json(res, { runId: store.runId, decrypt: decrypt === true }) : fail(res, 405, { Allow: 'GET' });
          // [UI-4] 실시간 통로(events.ts). 위의 검사를 모두 통과한 GET만 자리를 받는다(U32). 자리가 차면 503 — 오래된 연결을 끊지 않는다
          if (pathname === '/api/events') {
            if (method !== 'GET') return fail(res, 405, { Allow: 'GET' });
            if (!hub.open(res)) fail(res, 503);
            return;
          }
          // [UI-3] 조회 API(api.ts). 요청 본문은 쓰지 않는다(지우기는 Content-Type만 본다) — 본문 상한은 위의 'data'가 지킨다
          return sendApi(res, handleApi(store, method, pathname, (req.url ?? '').slice(pathname.length + 1), req.headers));
        }
        const pub = PUBLIC[pathname];
        if (!pub) return fail(res, 404);
        if (method !== 'GET' && method !== 'HEAD') return fail(res, 405, { Allow: 'GET, HEAD' });
        servePublic(res, method, pub[0], pub[1]);
      } catch {
        fail(res, 500); // 오류 내용은 응답·터미널에 내보내지 않는다(U51)
      }
    },
  );
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = Math.max(30_000, headersTimeoutMs * 2);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, BIND_HOST, () => (server.off('error', reject), resolve()));
  });
  actualPort = (server.address() as net.AddressInfo).port;
  return {
    port: actualPort,
    token,
    url: `http://${BIND_HOST}:${actualPort}/#t=${token}`,
    // [UI-4] 허브를 먼저 닫는다(하트비트 타이머·저장소 구독을 풀고 스트림을 끝냄)
    close: () => new Promise<void>((r) => (hub.close(), server.closeAllConnections(), server.close(() => r()))),
  };
}
