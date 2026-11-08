// [PRX-2] 기록 객체(Flow): 프록시가 처리한 요청 하나와 그 응답. TLS, 저장소(STO), 대시보드가 모두 이 모양에 기댄다(#공유).
//
// 사용자 결정(2026-11-07): 메모리에만 둔다 / 본문은 요청·응답 각 1MiB까지 기록(중계는 전체) / 민감한 값도 원본 그대로.
// 그래서 이 모듈은 아무것도 출력하거나 파일로 쓰지 않는다. 사례·결정 항목은 docs/ai/prx2-cases.md.

// D1: 1MiB. 이보다 긴 본문은 앞부분만 기록하고 bodyTruncated = true
export const FLOW_BODY_LIMIT = 1_048_576;

export type HeaderPairs = [string, string][];

type Message = {
  httpVersion: string;
  headers: HeaderPairs; // 보낸 쪽이 보낸 순서·대소문자·중복 그대로 (Node rawHeaders 수준, D8)
  body: Buffer; // chunked는 디코딩된 본문, gzip 등은 압축된 원본 그대로 (D2)
  bodySize: number; // 잘렸어도 실제로 오간 전체 바이트 수 (D3)
  bodyTruncated: boolean;
};

// [PRX-3] 결정 3: 요청이 향한 목적지. 호스트 필터와 HTTPS 터널 안의 요청(url이 /path 형태)에서 쓴다.
// host = WHATWG URL의 hostname(소문자, IPv6는 [::1]처럼 대괄호), port = 숫자(생략하면 http 80, https 443), path = 정규화하지 않은 원문(#조각 제외)
export type Target = { scheme: 'http' | 'https'; host: string; port: number; path: string };

type RequestHead = { method: string; url: string; httpVersion: string; headers: HeaderPairs; target?: Target }; // url = 받은 요청 대상 원문

export type Flow = {
  id: number;
  startedAt: number; // epoch ms (화면 표시용)
  durationMs: number; // 단조 시계로 잰 시간. 시스템 시계가 바뀌어도 음수가 되지 않는다
  request: Message & RequestHead;
  response?: Message & { status: number; statusMessage: string }; // 목적지가 보낸 응답만. 프록시가 만든 응답은 넣지 않는다 (H12)
  // by = 실패가 일어난 쪽, status = 프록시가 클라이언트에게 직접 보낸 응답 코드(보냈을 때만)
  // [PRX-3] bad-response = 목적지가 응답했지만 HTTP로 해석할 수 없음(Node의 HPE_* 오류). unreachable = 연결 자체가 안 됨
  // [TLS-4] bad-certificate = 목적지 인증서를 믿을 수 없음(검증은 끄지 않는다). tls-handshake = 클라이언트와의 TLS 핸드셰이크 실패(CONNECT 기록에만)
  error?: { by: 'proxy' | 'client' | 'upstream'; code: 'rejected' | 'loop' | 'unreachable' | 'bad-response' | 'timeout' | 'upgrade' | 'aborted' | 'bad-certificate' | 'tls-handshake'; status?: number };
  // [TLS-1] CONNECT 불투명 터널: 내용은 기록하지 않고 양방향 바이트 수와 실제로 연결한 주소만(CONNECT 헤더·200 줄은 세지 않음, head는 셈)
  tunnel?: { bytesUp: number; bytesDown: number; address: string };
  // [TLS-4] 복호화한 터널 안의 요청: 클라이언트가 TLS에서 보낸 SNI(없으면 null). 인증서·목적지는 SNI가 아니라 CONNECT 기준(사용자 결정 1)
  // [TLS-4b] upstreamError = 목적지 TLS가 실패했을 때 Node가 낸 코드(예 CERT_HAS_EXPIRED, EPROTO). 대문자·숫자·밑줄만(결정 9 조정 — error 모양은 그대로)
  tls?: { sni: string | null; upstreamError?: string };
};

// [PRX-3] 결정 2: 요청을 받자마자 보내는 시작 알림. 같은 요청의 Flow와 id가 같다. 본문·응답은 아직 없다
export type FlowStart = { id: number; startedAt: number; request: RequestHead };

// "http://host:port/path?q#frag" → 경로 부분 원문 "/path?q". URL 객체로 다시 조립하지 않는다:
// URL은 ".."을 정리하고 일부 문자를 인코딩해서, 목적지가 받는 경로가 원래와 달라진다 (PRX-1 사례 C9)
export function rawPath(target: string): string {
  const rest = target.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').replace(/#.*$/s, '');
  return rest.startsWith('/') ? rest : `/${rest}`;
}

// absolute-form 요청 대상 → Target. http/https가 아니거나 해석할 수 없으면 undefined (origin-form 포함)
export function parseTarget(target: string): Target | undefined {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return undefined;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }
  const scheme = url.protocol === 'http:' ? 'http' : url.protocol === 'https:' ? 'https' : undefined;
  if (!scheme || !url.hostname) return undefined;
  return { scheme, host: url.hostname, port: url.port ? Number(url.port) : scheme === 'https' ? 443 : 80, path: rawPath(target) };
}

// 본문을 엿보며 앞 limit바이트만 모은다.
// - 청크를 배열에 쌓지 않고 한 덩어리에 복사한다: 작은 청크 수백만 개가 객체 오버헤드로 메모리를 키우지 않게 (G2)
// - 덩어리는 allocUnsafeSlow로 만든다: Node의 작은 Buffer는 공유 풀(실측 64KB, scripts/probe/prx2-node.mjs)을 다른 연결과 나눠 쓰므로, 풀의 일부를 넘기면
//   기록을 통해 이웃 연결의 바이트에 닿을 수 있다 (F9). 복사본이라 중계 쪽 청크와도 메모리를 공유하지 않는다 (I4)
// - 선언된 Content-Length로 미리 할당하지 않는다: 받은 만큼 두 배씩 늘린다 (G3)
export function createBodyCapture(limit: number = FLOW_BODY_LIMIT) {
  let buf = Buffer.allocUnsafeSlow(0);
  let kept = 0;
  let size = 0;
  return {
    push(chunk: Buffer) {
      size += chunk.length;
      const n = Math.min(chunk.length, limit - kept);
      if (n <= 0) return;
      if (kept + n > buf.length) {
        const next = Buffer.allocUnsafeSlow(Math.min(limit, Math.max(kept + n, buf.length * 2, 4096)));
        buf.copy(next, 0, 0, kept);
        buf = next;
      }
      chunk.copy(buf, kept, 0, n);
      kept += n;
    },
    result() {
      // 남는 자리를 잘라낸 별도 메모리로 돌려준다(buffer.byteLength === length)
      const body = Buffer.allocUnsafeSlow(kept);
      buf.copy(body, 0, 0, kept);
      return { body, size, truncated: size > limit };
    },
  };
}

// Node rawHeaders(['Host', 'a', 'X-A', '1', ...]) → [['Host', 'a'], ['X-A', '1'], ...]
export function headerPairs(raw: string[]): HeaderPairs {
  const out: HeaderPairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}
