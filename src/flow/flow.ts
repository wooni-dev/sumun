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

export type Flow = {
  id: number;
  startedAt: number; // epoch ms (화면 표시용)
  durationMs: number; // 단조 시계로 잰 시간. 시스템 시계가 바뀌어도 음수가 되지 않는다
  request: Message & { method: string; url: string }; // url = 받은 요청 대상 원문(정규화하지 않음)
  response?: Message & { status: number; statusMessage: string }; // 목적지가 보낸 응답만. 프록시가 만든 응답은 넣지 않는다 (H12)
  // by = 실패가 일어난 쪽, status = 프록시가 클라이언트에게 직접 보낸 응답 코드(보냈을 때만)
  error?: { by: 'proxy' | 'client' | 'upstream'; code: 'rejected' | 'loop' | 'unreachable' | 'timeout' | 'upgrade' | 'aborted'; status?: number };
};

// 본문을 엿보며 앞 limit바이트만 모은다.
// - 청크를 배열에 쌓지 않고 한 덩어리에 복사한다: 작은 청크 수백만 개가 객체 오버헤드로 메모리를 키우지 않게 (G2)
// - 덩어리는 allocUnsafeSlow로 만든다: Node의 작은 Buffer는 8KB 풀을 다른 연결과 나눠 쓰므로, 풀의 일부를 넘기면
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
