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
import type { AddressInfo, Socket } from 'node:net';
import { stripHopByHop, addVia, hasOwnVia, VIA_ID } from './headers.ts';

const BIND_HOST = '127.0.0.1';
const SELF_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function reply(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', via: VIA_ID });
  res.end(`${message}\n`);
}

// "http://host:port/path?q#frag" → 경로 부분 원문 "/path?q". URL 객체로 다시 조립하지 않는다:
// URL은 ".."을 정리하고 일부 문자를 인코딩해서, 목적지가 받는 경로가 원래와 달라진다 (사례 C9).
function rawPath(target: string): string {
  const rest = target.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').replace(/#.*$/s, '');
  return rest.startsWith('/') ? rest : `/${rest}`;
}

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

export async function startProxy({ port = 8080 }: { port?: number } = {}) {
  const server = http.createServer();
  let selfPort = 0;

  server.on('request', (req, res) => {
    const target = req.url ?? '';
    const rejected = validateHost(req) ?? validateFraming(req);
    if (rejected) return reply(res, rejected.status, rejected.message);
    const checked = validateTarget(target);
    if ('status' in checked) return reply(res, checked.status, checked.message);
    const url = checked.url;

    const port = url.port ? Number(url.port) : 80;
    // 자기 자신으로 보내면 끝없이 자신에게 요청을 보내다 자원이 바닥난다 (B1, B2). 주소로 못 잡은 루프는 Via로 잡는다 (B4)
    if ((SELF_HOSTS.has(url.hostname.toLowerCase()) && port === selfPort) || hasOwnVia(req.headers.via)) {
      return reply(res, 508, '508 Loop Detected: 요청이 이 프록시로 되돌아옵니다.');
    }

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

    upstream.on('response', (up) => {
      const h = stripHopByHop(up.headers);
      h.via = addVia(up.headers.via);
      res.writeHead(up.statusCode ?? 502, up.statusMessage, h);
      up.pipe(res);
      up.on('error', () => res.destroy());
    });
    upstream.on('error', () => {
      if (!res.headersSent) reply(res, 502, '502 Bad Gateway: 목적지 서버에 연결할 수 없습니다.');
      else res.destroy(); // 응답 도중에 끊기면, 잘린 응답을 완전한 것처럼 끝내지 않는다
    });
    req.on('error', () => upstream.destroy());
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
