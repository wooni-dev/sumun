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

export async function startProxy({ port = 8080 }: { port?: number } = {}) {
  const server = http.createServer();
  let selfPort = 0;

  server.on('request', (req, res) => {
    const target = req.url ?? '';
    // origin-form(GET /x)은 웹페이지의 fetch나 DNS 리바인딩이 보낼 수 있는 형태다. Host를 믿고 중계하지 않는다 (A11, A12)
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return reply(res, 400, '400 Bad Request: 이 프록시는 absolute-form 요청(GET http://...)만 받습니다.');

    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return reply(res, 400, '400 Bad Request: 요청 URL을 해석할 수 없습니다.');
    }
    // https를 평문으로 내려 보내면 다운그레이드다. HTTPS는 CONNECT 터널(TLS 단계)로만 다룬다 (C4)
    if (url.protocol === 'https:') return reply(res, 501, '501 Not Implemented: HTTPS는 아직 지원하지 않습니다.');
    if (url.protocol !== 'http:' || !url.hostname) return reply(res, 400, '400 Bad Request: http:// 요청만 지원합니다.');

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
