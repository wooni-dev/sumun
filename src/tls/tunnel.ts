// [TLS-1] CONNECT 불투명 터널: 목적지에 TCP로 연결하고 양쪽 바이트를 해석 없이 이어 준다(복호화는 TLS-4).
// 사례·결정은 docs/ai/tls1-cases.md.
//
//   클라이언트 ── CONNECT host:port ──▶ [검사: 대상 해석 → 이름 해석(한 번) → 루프] ──TCP──▶ 목적지
//                ◀── 200 Connection Established ──   이후 바이트는 그대로(head 포함), 양방향 바이트 수만 센다
import net from 'node:net';
import dns from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Flow } from '../flow/flow.ts';

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
export const defaultLookup: Lookup = (host) => dns.promises.lookup(host, { all: true });
// [TLS-1b] 목적지 TCP 연결 함수. 테스트에서 "연결이 끝나지 않는 목적지"를 흉내 내려고 바꿔 끼운다(사례 R8)
export type ConnectUpstream = (o: { host: string; port: number; allowHalfOpen: boolean }) => Socket;
export const defaultConnect: ConnectUpstream = (o) => net.connect(o);

type Rejection = { error: string };
const bad = (why: string): Rejection => ({ error: `CONNECT 대상이 올바르지 않습니다(${why}).` });
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

// authority-form(RFC 9112 3.2.3) = host ":" port 만 받는다. 기본 포트·userinfo·경로가 없다.
// 느슨하게 해석하면 검사와 연결이 서로 다른 대상을 보게 된다(사례 P1~P9) — 그래서 URL 파서를 쓰지 않고 글자부터 본다.
export function parseConnectTarget(t: string): { host: string; port: number } | Rejection {
  const m = t.match(/^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9.-]+)):([1-9][0-9]{0,4})$/);
  if (!m) return bad('host:port 형식이 아님');
  const port = Number(m[3]);
  if (port > 65535) return bad('포트 범위');
  if (m[1] !== undefined) return net.isIPv6(m[1]) ? { host: `[${m[1].toLowerCase()}]`, port } : bad('IPv6 주소');
  const host = m[2].toLowerCase();
  const name = host.endsWith('.') ? host.slice(0, -1) : host;
  if (!name || name.length > 253) return bad('이름 길이');
  const labels = name.split('.');
  if (labels.some((l) => !LABEL.test(l))) return bad('이름 형식');
  // 결정 10: 숫자처럼 보이는 이름은 점 4개 10진수만. 2130706433, 0x7f000001, 0177.0.0.1, 127.1은 OS가 127.0.0.1로 받을 수 있다(SSRF 우회 기법)
  if (labels.every((l) => /^(?:0x[0-9a-f]*|[0-9]+)$/.test(l)) && !(labels.length === 4 && labels.every((l) => /^(?:0|[1-9][0-9]{0,2})$/.test(l) && Number(l) <= 255))) {
    return bad('숫자 주소 표기');
  }
  return { host, port };
}

// 이 PC 자신을 뜻하는 주소인가: 127/8, ::1, 0.0.0.0, ::, IPv4-mapped(::ffff:127.0.0.1, ::ffff:7f00:1)
function isSelfAddress(a: string): boolean {
  const s = a.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(s)) return s.startsWith('127.') || s === '0.0.0.0';
  if (!net.isIPv6(s)) return false;
  const full = new URL(`http://[${s}]/`).hostname.slice(1, -1); // 정규화: ::ffff:127.0.0.1 → ::ffff:7f00:1
  if (full === '::1' || full === '::') return true;
  const mapped = full.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  return !!mapped && parseInt(mapped[1], 16) >> 8 === 127;
}

// 해석한 주소 중 하나라도 자기 자신이고 포트가 프록시 포트면 루프다(사례 Q1, Q5). 터널 안은 해석하지 않아서 Via를 붙일 수 없으니 주소로만 막는다
export function isLoopTarget(addresses: string[], port: number, selfPort: number): boolean {
  return port === selfPort && addresses.some(isSelfAddress);
}

type End = Pick<Flow, 'error' | 'tunnel'>;
const REASON: Record<number, string> = { 400: 'Bad Request', 502: 'Bad Gateway', 504: 'Gateway Timeout', 508: 'Loop Detected' };

// 터널 하나의 수명. 결과는 finish로 정확히 한 번 알린다(사례 S2)
export async function openTunnel(o: {
  req: IncomingMessage;
  socket: Socket;
  head: Buffer;
  selfPort: number;
  lookup: Lookup;
  connect: ConnectUpstream;
  connectTimeoutMs: number;
  viaId: string;
  rejected?: { status: number; message: string; code: 'rejected' | 'loop' }; // 호출한 쪽이 먼저 거절한 경우(Host 중복 등)
  track: (s: Socket) => void; // 프록시를 닫을 때 남은 터널 소켓을 정리하기 위해
  finish: (end: End) => void;
}) {
  const { socket } = o;
  let done = false;
  const finish = (end: End) => (done ? undefined : ((done = true), o.finish(end)));
  // 고정 문구로 거절하고 끝낸다(입력을 반영하지 않음 — PRX-1 B12)
  const refuse = (status: number, message: string, error: NonNullable<Flow['error']>) => {
    const body = `${status} ${REASON[status]}: ${message}\n`;
    if (!socket.destroyed) {
      socket.end(`HTTP/1.1 ${status} ${REASON[status]}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nvia: ${o.viaId}\r\nconnection: close\r\n\r\n${body}`);
    }
    finish({ error });
  };
  o.track(socket);

  let upstream: Socket | undefined;
  let established = false;
  let failure: Flow['error'];
  const fail = (e: NonNullable<Flow['error']>) => (failure ??= e);
  socket.on('error', () => (fail({ by: 'client', code: 'aborted' }), upstream?.destroy())); // 클라이언트 RST (사례 R5c)
  socket.on('close', () => {
    if (!established) (upstream?.destroy(), finish({ error: failure ?? { by: 'client', code: 'aborted' } })); // 연결 전에 끊음 (R5d)
  });

  if (o.rejected) return refuse(o.rejected.status, o.rejected.message, { by: 'proxy', code: o.rejected.code, status: o.rejected.status });
  // 결정 5: CONNECT에는 본문이 없다(RFC 9110 9.3.6). 본문 헤더가 있으면 경계 해석이 갈려 스머글링의 재료가 된다 (R2)
  if (o.req.headers['content-length'] !== undefined || o.req.headers['transfer-encoding'] !== undefined) {
    return refuse(400, 'CONNECT 요청에는 본문을 쓸 수 없습니다.', { by: 'proxy', code: 'rejected', status: 400 });
  }
  const parsed = parseConnectTarget(o.req.url ?? '');
  if ('error' in parsed) return refuse(400, parsed.error, { by: 'proxy', code: 'rejected', status: 400 });
  const { host, port } = parsed;

  // 결정 12: 이름은 한 번만 해석하고, 검사한 그 주소로 연결한다(검사 뒤 다시 해석하면 DNS 리바인딩으로 루프 검사를 비켜 간다 — Q5)
  const bare = host.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = net.isIP(bare) ? [bare] : (await o.lookup(host)).map((a) => a.address);
    if (!addresses.length) throw new Error('주소 없음');
  } catch {
    return refuse(502, '목적지 서버에 연결할 수 없습니다.', { by: 'upstream', code: 'unreachable', status: 502 });
  }
  if (socket.destroyed) return finish({ error: failure ?? { by: 'client', code: 'aborted' } });
  if (isLoopTarget(addresses, port, o.selfPort)) return refuse(508, '요청이 이 프록시로 되돌아옵니다.', { by: 'proxy', code: 'loop', status: 508 });

  const address = addresses[0];
  // 결정 6(사례 R6): 반쪽 닫기를 허용한다. 기본값(false)이면 목적지의 FIN을 받는 순간 목적지 쪽 쓰기도 닫혀서
  // 클라이언트가 그 뒤 보낸 바이트가 목적지에 닿지 않고, pipe가 풀려 클라이언트 쪽 소켓과 기록이 남는다 [확인됨: scripts/probe/tls1b-leak.mjs]
  const up = o.connect({ host: address, port, allowHalfOpen: true });
  upstream = up;
  o.track(up);
  let bytesUp = 0;
  let bytesDown = 0;
  let closed = 0;
  const onClose = () => ++closed === 2 && finish({ error: failure, tunnel: { bytesUp, bytesDown, address } });

  up.setTimeout(o.connectTimeoutMs, () => up.destroy(Object.assign(new Error('timeout'), { code: 'SUMUN_CONNECT_TIMEOUT' })));
  up.on('error', (err: NodeJS.ErrnoException) => {
    if (!established) {
      const timeout = err.code === 'SUMUN_CONNECT_TIMEOUT';
      return refuse(timeout ? 504 : 502, timeout ? '목적지 서버가 응답하지 않습니다.' : '목적지 서버에 연결할 수 없습니다.', { by: 'upstream', code: timeout ? 'timeout' : 'unreachable', status: timeout ? 504 : 502 });
    }
    // 사례 R11: 200을 보낸 뒤 목적지가 끊으면 클라이언트도 RST로 끊는다. 정상 종료(FIN)로 닫으면 잘린 데이터를 완전한 것으로 오인한다
    fail({ by: 'upstream', code: 'aborted' });
    if (!socket.destroyed) socket.resetAndDestroy();
  });
  up.once('connect', () => {
    if (socket.destroyed) return up.destroy();
    established = true;
    up.setTimeout(0); // 결정 7: 연결된 뒤에는 유휴로 끊지 않는다 (R9)
    // 사례 R4: 연결이 성공한 뒤에만, 상태 줄만(Content-Length·Transfer-Encoding 없음 — RFC 9110 9.3.6 MUST NOT)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // 사례 R1: CONNECT와 같은 write로 온 바이트는 head로만 온다. 버리면 잃는다 [확인됨: scripts/probe/tls1-head.mjs]
    if (o.head.length) (up.write(o.head), (bytesUp += o.head.length));
    socket.on('data', (d: Buffer) => (bytesUp += d.length));
    up.on('data', (d: Buffer) => (bytesDown += d.length));
    socket.pipe(up);
    up.pipe(socket);
    socket.on('close', onClose);
    up.on('close', onClose);
  });
}
