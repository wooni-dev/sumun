// [PRX-1] HTTP 포워드 프록시: absolute-form 요청을 받아 목적지로 중계한다.
//
//   curl ── GET http://example.com/hello?q=1 ──▶ [이 프록시 127.0.0.1:8080] ── GET /hello?q=1 ──▶ example.com:80
//                                                     │ 거부: origin-form 400, https 501, CONNECT 501, 루프 508, 연결 실패 502
//
// 보안 규칙 (CLAUDE.md, 사례는 docs/ai/prx1-cases.md):
//  - 항상 127.0.0.1에만 연다. 0.0.0.0에 열면 같은 네트워크의 누구나 내 PC를 경유하는 "열린 프록시"가 된다.
//    그래서 바인딩 주소 옵션을 일부러 두지 않는다 (A1, A3).
//  - 오류 응답은 고정 문구의 text/plain이다. 요청 내용을 되돌려 보내지 않는다 (B12: 브라우저는 프록시의 오류 페이지를
//    목적지 사이트의 출처로 보여 주므로, 입력을 반영하면 그 사이트에 XSS가 생긴다).
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { stripHopByHop, addVia, hasOwnVia, VIA_ID } from './headers.ts';
import { createBodyCapture, headerPairs, rawPath, parseTarget, type Flow, type FlowStart } from '../flow/flow.ts';

const BIND_HOST = '127.0.0.1';
const SELF_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function reply(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', via: VIA_ID });
  res.end(`${message}\n`);
}

// rawPath(경로 원문, 사례 C9)는 [PRX-3]에서 flow.ts로 옮겼다. 기록의 target.path와 같은 규칙을 쓰기 위해서다

type Rejection = { status: number; message: string };
const bad = (message: string): Rejection => ({ status: 400, message: `400 Bad Request: ${message}` });

// [PRX-1b] 요청 대상(URL) 검사. Node가 막지 않는 것만 여기서 막는다 (이미 막히는 것은 PRX-1b-regression.test.ts)
function validateTarget(target: string): { url: URL } | Rejection {
  // origin-form(GET /x)은 웹페이지의 fetch나 DNS 리바인딩이 보낼 수 있는 형태다. Host를 믿고 중계하지 않는다 (A11, A12)
  const authority = target.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (authority === undefined) return bad('이 프록시는 absolute-form 요청(GET http://...)만 받습니다.');
  // "http:///path"를 WHATWG URL은 호스트 "path"로 해석한다 [확인됨: 실측]. 원문의 authority에서 호스트가 비었는지 직접 본다 (C2)
  if (!authority.replace(/^.*@/, '').replace(/:[^\]]*$/, '')) return bad('요청 URL에 호스트가 없습니다.');

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return bad('요청 URL을 해석할 수 없습니다.');
  }
  // https를 평문으로 내려 보내면 다운그레이드다. HTTPS는 CONNECT 터널(TLS 단계)로만 다룬다 (C4)
  if (url.protocol === 'https:') return { status: 501, message: '501 Not Implemented: HTTPS는 아직 지원하지 않습니다.' };
  if (url.protocol !== 'http:' || !url.hostname) return bad('http:// 요청만 지원합니다.');
  if (url.port === '0') return bad('포트 0으로는 연결할 수 없습니다.'); // (C5)
  return { url };
}

// [PRX-1b] Host 헤더 검사 — RFC 9112 3.2: 여러 개이거나 값이 잘못되면 400 (MUST). Node는 막지 않는다 [확인됨] (C16)
// 이 프록시는 Host를 요청 URL로 다시 쓰지만(C14), 해석이 갈리는 요청 자체를 받지 않는 게 안전하다.
function validateHost(req: http.IncomingMessage): Rejection | undefined {
  const values = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length;
  if (values > 1) return bad('Host 헤더가 여러 개입니다.');
  const host = req.headers.host;
  if (host !== undefined && /[,\s]/.test(host.trim())) return bad('Host 헤더 값이 올바르지 않습니다.');
}

// [PRX-1b] 본문 경계 검사 — RFC 9112 6.1: HTTP/1.0 메시지의 Transfer-Encoding은 잘못된 메시지다.
// Node는 그대로 받아들인다 [확인됨]. 경계 해석이 갈리면 요청 스머글링의 재료가 된다 (D5)
function validateFraming(req: http.IncomingMessage): Rejection | undefined {
  if (req.httpVersion === '1.0' && req.headers['transfer-encoding'] !== undefined) return bad('HTTP/1.0 요청에는 Transfer-Encoding을 쓸 수 없습니다.');
}

const LOOP = { status: 508, message: '508 Loop Detected: 요청이 이 프록시로 되돌아옵니다.' };

// [PRX-2] 구독자를 부른다. 중계가 끝난 뒤(setImmediate) 부르고, 구독자의 예외·reject는 삼킨다.
// 오류 내용은 출력하지 않는다: 구독자가 기록을 담은 오류를 던질 수 있고, 기록에는 쿠키·토큰이 원본 그대로 있다 (I1, I2, D12)
// [PRX-3] 시작 알림(onFlowStart)에도 같은 방식을 쓴다
function emitFlow<T>(onFlow: (flow: T) => unknown, flow: T) {
  const failed = () => process.stderr.write('[sumun] 기록 구독자에서 오류가 났습니다(내용은 출력하지 않음).\n');
  setImmediate(() => {
    try {
      const r = onFlow(flow) as PromiseLike<unknown> | undefined;
      if (r && typeof r.then === 'function') r.then(undefined, failed);
    } catch {
      failed();
    }
  });
}
const TIMEOUT = 'SUMUN_UPSTREAM_TIMEOUT';

// [PRX-1c] A9: Windows는 다른 프로세스가 0.0.0.0:P를 쓰는 중에도 127.0.0.1:P 바인딩을 허용한다 [확인됨: scripts/probe/prx1c-a9-b6.mjs].
// 그러면 브라우저 트래픽이 어느 프로그램으로 갈지 예측할 수 없다. 그래서 시작하기 전에 그 포트로 접속해 보고, 누가 응답하면 시작하지 않는다.
// (0.0.0.0에 잠깐 바인딩해 보는 방법은 Windows 방화벽 "액세스 허용" 창을 띄울 수 있어서 쓰지 않는다 — 사례 A3)
function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, BIND_HOST, () => (s.destroy(), resolve(true)));
    s.setTimeout(500, () => (s.destroy(), resolve(false)));
    s.on('error', () => resolve(false));
  });
}

export async function startProxy({
  port = 8080,
  upstreamTimeoutMs = 30_000, // 목적지가 이 시간 동안 아무것도 보내지 않으면 504 (B8)
  headersTimeoutMs = 30_000, // 클라이언트가 이 시간 안에 헤더를 다 보내지 않으면 408 (D17)
  onFlow, // [PRX-2] 요청마다 완료(또는 실패) 때 한 번 기록(Flow)을 받는다. 없으면 기록하지 않는다
  onFlowStart, // [PRX-3] 결정 2: 요청을 받자마자 한 번 시작 알림을 받는다(같은 요청의 Flow와 id가 같다). 실시간 목록용
  upstreamBodyTimeoutMs = 300_000, // [PRX-3] 결정 4: 응답 헤더를 받은 뒤에는 이 시간(5분) 동안 아무것도 오지 않을 때만 끊는다(SSE·롱폴)
}: {
  port?: number;
  upstreamTimeoutMs?: number;
  headersTimeoutMs?: number;
  onFlow?: (flow: Flow) => unknown;
  onFlowStart?: (start: FlowStart) => unknown;
  upstreamBodyTimeoutMs?: number;
} = {}) {
  if (onFlow !== undefined && typeof onFlow !== 'function') throw new TypeError('onFlow는 함수여야 합니다.');
  if (onFlowStart !== undefined && typeof onFlowStart !== 'function') throw new TypeError('onFlowStart는 함수여야 합니다.');
  if (port !== 0 && (await portAnswers(port))) {
    throw Object.assign(new Error(`포트 ${port}를 이미 다른 프로그램이 쓰고 있습니다.`), { code: 'EADDRINUSE' });
  }
  const server = http.createServer({
    headersTimeout: headersTimeoutMs,
    requestTimeout: 0, // 요청 전체 시간은 제한하지 않는다(큰 업로드). 느린 "헤더"만 끊는다
    connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(headersTimeoutMs / 2))), // 타임아웃을 검사하는 주기
  });
  let selfPort = 0;
  let nextFlowId = 1;
  // 자기 자신으로 보내면 끝없이 자신에게 요청을 보내다 자원이 바닥난다 (B1, B2)
  const isSelf = (url: URL, port: number) => SELF_HOSTS.has(url.hostname.toLowerCase()) && port === selfPort;

  server.on('request', (req, res) => {
    const target = req.url ?? '';

    // [PRX-2] 기록. 중계(pipe)는 그대로 두고 'data'를 엿본다. 본문은 앞 1MiB만 별도 메모리에 복사한다 (flow.ts)
    const startedAt = Date.now();
    const t0 = performance.now();
    const id = nextFlowId++; // [PRX-3] 시작 알림과 끝 기록이 같은 id를 갖도록 요청을 받을 때 매긴다
    // 요청 머리. 시작 알림과 끝 기록에 따로 만들어 넘긴다: 한 구독자가 고쳐도 다른 쪽에 번지지 않게 (PRX-2 I4)
    const head = () => ({ method: req.method ?? '', url: target, httpVersion: req.httpVersion, headers: headerPairs(req.rawHeaders), target: parseTarget(target) });
    if (onFlowStart) emitFlow(onFlowStart, { id, startedAt, request: head() });
    const reqBody = createBodyCapture();
    const resBody = createBodyCapture();
    let response: Omit<NonNullable<Flow['response']>, 'body' | 'bodySize' | 'bodyTruncated'> | undefined;
    let error: Flow['error'];
    const fail = (e: NonNullable<Flow['error']>) => (error ??= e); // 처음 일어난 실패가 원인이다
    if (onFlow) {
      req.on('data', (c: Buffer) => reqBody.push(c));
      // 'close'는 응답을 다 보냈을 때와 중간에 끊겼을 때 모두 한 번 온다 → 요청당 정확히 한 번 기록한다 (I5)
      res.once('close', () => {
        if (!error && !res.writableFinished) fail({ by: 'client', code: 'aborted' }); // 다 보내기 전에 클라이언트가 끊음 (H10)
        const rq = reqBody.result();
        const rs = resBody.result();
        emitFlow(onFlow, {
          id,
          startedAt,
          durationMs: performance.now() - t0,
          request: { ...head(), body: rq.body, bodySize: rq.size, bodyTruncated: rq.truncated },
          response: response && { ...response, body: rs.body, bodySize: rs.size, bodyTruncated: rs.truncated },
          error,
        });
      });
    }
    // 프록시가 직접 거절할 때. 기록의 response 칸은 비워 두고 error에 적는다 (H12)
    const refuse = (r: Rejection, code: 'rejected' | 'loop' = 'rejected') => (fail({ by: 'proxy', code, status: r.status }), reply(res, r.status, r.message));

    // [PRX-1c] Via 검사를 맨 앞에 둔다. 0.0.0.0, localhost. 처럼 주소로 못 알아본 루프는 되돌아온 요청에 붙은 Via로 알아본다 (B3, B4).
    // 다른 검사보다 늦으면, 되돌아온 요청이 다른 이유(origin-form 등)로 400이 되어 루프라는 사실이 가려진다 [확인됨: 실측]
    if (hasOwnVia(req.headers.via)) return refuse(LOOP, 'loop');
    const rejected = validateHost(req) ?? validateFraming(req);
    if (rejected) return refuse(rejected);
    const checked = validateTarget(target);
    if ('status' in checked) return refuse(checked);
    const url = checked.url;

    const port = url.port ? Number(url.port) : 80;
    if (isSelf(url, port)) return refuse(LOOP, 'loop');

    const headers = stripHopByHop(req.headers);
    headers.host = url.host; // 요청 URL의 호스트가 기준이다. 클라이언트가 보낸 Host는 무시한다 (C14, RFC 9112 3.2.2)
    headers.via = addVia(req.headers.via);

    const upstream = http.request({
      host: url.hostname.replace(/^\[|\]$/g, ''), // IPv6 리터럴 [::1] → ::1
      port,
      method: req.method,
      path: rawPath(target),
      headers,
      agent: false,
    });
    // [PRX-2b] Node 클라이언트는 응답 헤더가 1,000개를 넘으면 나머지를 오류 없이 버린다(뒤에 있던 Content-Length까지)
    // [확인됨: scripts/probe/prx2b-g9.mjs]. 그러면 브라우저와 기록이 목적지가 보낸 것과 달라진다 (G9).
    // 개수 제한을 풀어도 헤더 전체 크기 제한(maxHeaderSize 16KB, 넘으면 502 — PRX-1c D16)이 메모리를 묶는다.
    upstream.maxHeadersCount = 0;

    upstream.on('response', (up) => {
      // [PRX-3] 결정 4: 응답 헤더가 왔으니 본문 도중 무응답 제한으로 바꾼다. 30초 넘게 쉬는 SSE·롱폴이 끊기지 않게 [확인됨: 검토 에이전트 실측]
      upstream.setTimeout(upstreamBodyTimeoutMs);
      response = { status: up.statusCode ?? 0, statusMessage: up.statusMessage ?? '', httpVersion: up.httpVersion, headers: headerPairs(up.rawHeaders) };
      if (onFlow) up.on('data', (c: Buffer) => resBody.push(c));
      const h = stripHopByHop(up.headers);
      h.via = addVia(up.headers.via);
      res.writeHead(up.statusCode ?? 502, up.statusMessage, h);
      up.pipe(res);
      up.on('error', () => (fail({ by: 'upstream', code: 'aborted' }), res.destroy())); // 목적지가 본문 도중에 끊음 (H11)
    });
    // [PRX-1c] 목적지가 연결만 받고 아무것도 보내지 않으면 끝없이 기다리게 된다 (B8)
    upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy(Object.assign(new Error('timeout'), { code: TIMEOUT })));
    // [PRX-1c] 목적지가 101(프로토콜 전환)을 보내면 Node는 'upgrade'를 낸다. 처리하지 않으면 클라이언트에 아무 응답도 가지 않는다
    // [확인됨: 실측]. 터널로 바꾸면 기록·검사를 벗어난 통로가 생기므로 전환하지 않는다 (E7, h2c 스머글링)
    upstream.on('upgrade', (_up, socket) => {
      socket.destroy();
      fail({ by: 'upstream', code: 'upgrade', status: 502 });
      if (!res.headersSent) reply(res, 502, '502 Bad Gateway: 목적지가 프로토콜 전환(101)을 요청했지만 이 프록시는 지원하지 않습니다.');
    });
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      const timeout = err.code === TIMEOUT;
      if (res.headersSent) return fail({ by: 'upstream', code: timeout ? 'timeout' : 'aborted' }), res.destroy(); // 응답 도중에 끊기면, 잘린 응답을 완전한 것처럼 끝내지 않는다
      if (res.destroyed) return; // 클라이언트가 먼저 끊어서 우리가 목적지 요청을 멈춘 경우(아래 req 'error'). 원인은 클라이언트다
      // [PRX-3] 결정 10: 응답은 왔지만 HTTP로 해석할 수 없으면(Node의 HPE_* 오류) bad-response, 연결 자체가 안 되면 unreachable
      // [확인됨: scripts/probe/prx3-errcode.mjs — 깨진 상태 줄 HPE_INVALID_CONSTANT, 헤더 초과 HPE_HEADER_OVERFLOW, 닫힌 포트 ECONNREFUSED]
      const code = timeout ? 'timeout' : err.code?.startsWith('HPE_') ? 'bad-response' : 'unreachable';
      fail({ by: 'upstream', code, status: timeout ? 504 : 502 });
      if (timeout) reply(res, 504, '504 Gateway Timeout: 목적지 서버가 응답하지 않습니다.');
      else reply(res, 502, '502 Bad Gateway: 목적지 서버에 연결할 수 없습니다.');
    });
    req.on('error', () => (fail({ by: 'client', code: 'aborted' }), upstream.destroy()));
    req.pipe(upstream);
  });

  // CONNECT(HTTPS 터널)는 TLS 단계에서 만든다. 처리기가 없으면 Node는 응답 없이 연결을 끊으므로(실측), 501을 직접 보낸다 (C18)
  server.on('connect', (_req, socket: Socket) => {
    // 이 소켓은 http 서버의 관리에서 벗어난 원시 소켓이다. 클라이언트가 응답을 받자마자 연결을 리셋하면(curl이 실제로 그렇게 함)
    // 'error'가 나는데, 처리기가 없으면 Node가 프로세스를 종료한다 [확인됨: PRX-1 실측]. 여기서는 정리만 하면 된다.
    socket.on('error', () => socket.destroy());
    const body = '501 Not Implemented: HTTPS(CONNECT)는 아직 지원하지 않습니다.\n';
    socket.end(
      `HTTP/1.1 501 Not Implemented\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nvia: ${VIA_ID}\r\nconnection: close\r\n\r\n${body}`,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, BIND_HOST, () => resolve());
  });
  selfPort = (server.address() as AddressInfo).port;

  return {
    port: selfPort,
    address: () => server.address() as AddressInfo,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}
