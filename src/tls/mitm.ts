// [TLS-4] HTTPS 복호화(MITM): CONNECT 뒤 같은 소켓에서 프록시가 TLS 서버가 되어 터널 안 HTTP 요청을 꺼낸다. 사례·결정은 docs/ai/tls4-cases.md.
//
//   브라우저 ── CONNECT a.com:443 ──▶ [checkConnect: 형식·이름 한 번 해석·루프 — TLS-1과 같은 규칙]
//            ◀── 200 ──  ── TLS(a.com 인증서: issueCert, 호스트별 캐시) ──▶ 안쪽 HTTP 서버(server.ts의 요청 처리기)
//                                                                        └─ 목적지에는 새 TLS(검증 명시) — server.ts
//
// 인증서와 목적지는 SNI가 아니라 CONNECT 이름으로 정한다(사용자 결정 1): SNI를 따르면 CONNECT에서 한 주소 검사를 비켜 간다.
// 터널 안 요청이 쓸 목적지(검사한 주소)는 TLS 소켓에 붙여 두고 요청 처리기가 읽는다 — 요청마다 이름을 다시 해석하지 않는다(사례 C1).
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { issueCert, type CA } from '../ca/ca.ts';
import { checkConnect, writeRefusal, type Lookup } from './tunnel.ts';
import type { Flow } from '../flow/flow.ts';

// 호스트별 인증서. 같은 호스트의 동시 요청은 발급 하나를 기다린다(single-flight, 사례 G1). 실패는 기억하지 않는다(G2).
// 프록시마다 따로 만든다 — CA가 다른 프록시끼리 섞이지 않게(G4).
// [TLS-4b] 상한(기본 1000, 결정 8)을 넘으면 가장 오래 안 쓴 것부터 버린다(LRU, G3). 만료 1일 전이면 다시 발급한다(G5 — 말단은 30일)
export type CertCache = { get(host: string): Promise<tls.SecureContext>; readonly size: number; readonly max: number };
const cacheKey = (host: string) => host.toLowerCase().replace(/\.$/, '');
const DAY = 86_400_000;
export function createCertCache(ca: CA, opts: { max?: number; now?: () => number } = {}): CertCache {
  const max = opts.max ?? 1000;
  const now = opts.now ?? Date.now;
  const map = new Map<string, { p: Promise<tls.SecureContext>; notAfter?: number }>(); // Map은 넣은 순서를 지킨다 → 맨 앞이 가장 오래 안 쓴 것
  return {
    get(host) {
      const key = cacheKey(host);
      const hit = map.get(key);
      if (hit && !(hit.notAfter !== undefined && now() > hit.notAfter - DAY)) {
        map.delete(key);
        map.set(key, hit); // 방금 썼다 → 맨 뒤로
        return hit.p;
      }
      if (hit) map.delete(key);
      const entry: { p: Promise<tls.SecureContext>; notAfter?: number } = {
        p: issueCert(ca, [key]).then((c) => ((entry.notAfter = Date.parse(new X509Certificate(c.certPem).validTo)), tls.createSecureContext({ cert: c.certPem, key: c.keyPem }))),
      };
      map.set(key, entry);
      entry.p.catch(() => map.get(key) === entry && map.delete(key));
      while (map.size > max) map.delete(map.keys().next().value!);
      return entry.p;
    },
    get size() {
      return map.size;
    },
    max,
  };
}

// 터널 안 요청의 목적지. host = CONNECT 이름(소문자, 끝점 제거, IPv6는 [::1]), address = CONNECT 때 검사한 주소
// addresses = 검사한 주소 전부. localhost가 ::1, 127.0.0.1 순서로 풀리는 것처럼 첫 주소에 목적지가 없을 수 있어 차례로 시도한다
// [확인됨: 이 PC에서 dns.lookup('localhost', { all: true }) → ::1, 127.0.0.1]
export type MitmRoute = { host: string; port: number; addresses: string[]; requests: number; sni: () => string | null };
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
  handshakeTimeoutMs: number; // [TLS-4b] 200 뒤 이 시간 안에 핸드셰이크가 끝나지 않으면 닫는다(사례 D4)
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
  const { port, addresses } = checked.ok;
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
  const route: MitmRoute = { host, port, addresses, requests: 0, sni: () => (typeof t.servername === 'string' && t.servername ? t.servername : null) };
  (t as unknown as { [ROUTE]: MitmRoute })[ROUTE] = route;
  // 핸드셰이크가 끝나지 않고 닫히면 실패다. 클라이언트가 우리 인증서를 거부하면(사례 D3) 서버 쪽에는 오류 이벤트 없이 닫히기만 할 수 있다
  let secured = false;
  let timedOut = false;
  // [TLS-4b] 사례 D4: ClientHello를 보내지 않거나 아주 느린 클라이언트가 소켓을 붙잡고 있지 않게
  const timer = setTimeout(() => secured || ((timedOut = true), t.destroy()), o.handshakeTimeoutMs);
  t.once('secure', () => ((secured = true), clearTimeout(timer)));
  t.on('error', () => t.destroy()); // 목적지에는 아직 연결하지 않았다
  t.once('close', () => {
    clearTimeout(timer);
    if (route.requests > 0) return finish(undefined);
    finish(secured ? {} : { error: { by: 'client', code: timedOut ? 'timeout' : 'tls-handshake' } });
  });
  o.inner.emit('connection', t); // 안쪽 HTTP 서버가 터널 안 요청을 해석한다 [확인됨: E97 keep-alive 3개]
}
