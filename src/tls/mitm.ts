// [TLS-4] HTTPS 복호화(MITM): CONNECT 뒤 같은 소켓에서 프록시가 TLS 서버가 되어 터널 안 HTTP 요청을 꺼낸다. 사례·결정은 docs/ai/tls4-cases.md.
//
//   브라우저 ── CONNECT a.com:443 ──▶ [checkConnect: 형식·이름 한 번 해석·루프 — TLS-1과 같은 규칙]
//            ◀── 200 ──  ── TLS(a.com 인증서: issueCert, 호스트별 캐시) ──▶ 안쪽 HTTP 서버(server.ts의 요청 처리기)
//                                                                        └─ 목적지에는 새 TLS(검증 명시) — server.ts
//
// 인증서와 목적지는 SNI가 아니라 CONNECT 이름으로 정한다(사용자 결정 1): SNI를 따르면 CONNECT에서 한 주소 검사를 비켜 간다.
// 터널 안 요청이 쓸 목적지(검사한 주소)는 TLS 소켓에 붙여 두고 요청 처리기가 읽는다 — 요청마다 이름을 다시 해석하지 않는다(사례 C1).
import tls from 'node:tls';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { issueCert, type CA } from '../ca/ca.ts';
import { checkConnect, writeRefusal, type Lookup } from './tunnel.ts';
import type { Flow } from '../flow/flow.ts';

// 호스트별 인증서. 같은 호스트의 동시 요청은 발급 하나를 기다린다(single-flight, 사례 G1). 실패는 기억하지 않는다(G2).
// 프록시마다 따로 만든다 — CA가 다른 프록시끼리 섞이지 않게(G4). 상한·만료 임박 재발급은 TLS-4b(G3·G5)
export type CertCache = { get(host: string): Promise<tls.SecureContext> };
const cacheKey = (host: string) => host.toLowerCase().replace(/\.$/, '');
export function createCertCache(ca: CA): CertCache {
  const map = new Map<string, Promise<tls.SecureContext>>();
  return {
    get(host) {
      const key = cacheKey(host);
      let p = map.get(key);
      if (!p) {
        p = issueCert(ca, [key]).then((c) => tls.createSecureContext({ cert: c.certPem, key: c.keyPem }));
        map.set(key, p);
        p.catch(() => map.delete(key));
      }
      return p;
    },
  };
}

// 터널 안 요청의 목적지. host = CONNECT 이름(소문자, 끝점 제거, IPv6는 [::1]), address = CONNECT 때 검사한 주소
export type MitmRoute = { host: string; port: number; address: string; requests: number; sni: () => string | null };
const ROUTE = Symbol('sumun.mitm.route');
export const routeOf = (socket: unknown): MitmRoute | undefined => (socket as { [ROUTE]?: MitmRoute } | undefined)?.[ROUTE];

// CONNECT 하나의 수명. finish는 정확히 한 번 부른다. 터널 안 요청이 하나라도 있었으면 CONNECT 기록은 남기지 않는다(결정 7 — 요청마다 기록이 있다)
export async function openMitm(o: {
  req: IncomingMessage;
  socket: Socket;
  head: Buffer;
  selfPort: number;
  lookup: Lookup;
  viaId: string;
  rejected?: { status: number; message: string; code: 'rejected' | 'loop' };
  certs: CertCache;
  inner: Server;
  track: (s: Socket) => void;
  finish: (end: Pick<Flow, 'error'> | undefined) => void;
}) {
  const { socket } = o;
  let done = false;
  const finish = (end: Pick<Flow, 'error'> | undefined) => (done ? undefined : ((done = true), o.finish(end)));
  o.track(socket);
  let wrapped = false;
  socket.on('close', () => wrapped || finish({ error: { by: 'client', code: 'aborted' } })); // 검사·발급 도중에 끊음

  const checked = await checkConnect(o);
  if ('refuse' in checked) return (writeRefusal(socket, checked.refuse.status, checked.refuse.message, o.viaId), finish({ error: checked.refuse.error }));
  if ('aborted' in checked) return finish({ error: { by: 'client', code: 'aborted' } });
  const { port, address } = checked.ok;
  const host = cacheKey(checked.ok.host);

  // 200을 보내기 전에 인증서를 준비한다: 클라이언트는 200을 받은 뒤에 ClientHello를 보내므로, 그사이 받은 바이트가 버려지지 않는다
  let context: tls.SecureContext;
  try {
    context = await o.certs.get(host);
  } catch {
    writeRefusal(socket, 502, '이 이름으로는 인증서를 만들 수 없습니다.', o.viaId);
    return finish({ error: { by: 'proxy', code: 'rejected', status: 502 } });
  }
  if (socket.destroyed) return finish({ error: { by: 'client', code: 'aborted' } });
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  // 사례 D6: CONNECT와 같은 write로 온 ClientHello는 head로만 온다 → 소켓에 되돌려 넣고 TLS로 감싼다 [확인됨: scripts/probe/tls4-node.mjs E96]
  if (o.head.length) socket.unshift(o.head);
  const t = new tls.TLSSocket(socket, { isServer: true, secureContext: context, ALPNProtocols: ['http/1.1'] }); // ALPN은 http/1.1만(HTTP/2는 범위 밖)
  wrapped = true;
  o.track(t);
  const route: MitmRoute = { host, port, address, requests: 0, sni: () => (typeof t.servername === 'string' && t.servername ? t.servername : null) };
  (t as unknown as { [ROUTE]: MitmRoute })[ROUTE] = route;
  let failed = false;
  t.on('error', () => ((failed = true), t.destroy())); // 클라이언트가 우리 인증서를 거부(사례 D3) 등. 목적지에는 아직 연결하지 않았다
  t.once('close', () => (route.requests > 0 ? finish(undefined) : finish(failed ? { error: { by: 'client', code: 'tls-handshake' } } : {})));
  o.inner.emit('connection', t); // 안쪽 HTTP 서버가 터널 안 요청을 해석한다 [확인됨: E97 keep-alive 3개]
}
