// [UI-4] 실시간 통로(SSE). 사례·결정: docs/ai/ui-cases.md(배정 "UI-4": U3, U32~U34, U36, U38, D-4, D-13), STO 보고서 결정 1.
//
//   GET /api/events → 200 text/event-stream
//     data: {"type":"hello","runId":"…"}            ← 연결마다 먼저. 화면은 이것을 받으면 목록을 API로 다시 받는다(재연결 — U34)
//     id: <n>  data: <저장소 알림 JSON>              ← start·done(요약), evicted, cleared. 본문·헤더 없음(STO S-4)
//     : ping                                        ← 하트비트(heartbeatMs마다). 오래 열어 둔 연결이 끊겼는지 알 수 있게(F8)
//
// 접근 검사(Host·Origin·Sec-Fetch-Site·Via·토큰)는 server.ts가 먼저 끝냈다. 통과한 요청만 open에 온다 — 거절된 요청은 자리를 쓰지 않는다(U32).
// 저장소는 알림을 동기로 모든 구독자에게 돌린다. 여기서 쓰기·직렬화를 하면 그 시간만큼 프록시가 늦어진다(STO 결정 1, U38):
//   허브는 저장소를 한 번만 구독하고(연결이 있을 때만), 알림을 배열에 넣고 바로 돌아온다. setImmediate에서 모인 알림을 한 번 JSON으로 바꿔
//   모든 연결에 같은 덩어리를 쓴다(연결 수만큼 직렬화하지 않음).
// 지난 알림을 다시 보내지 않는다(Last-Event-ID 없음). 끊긴 동안의 일은 hello 뒤 목록을 다시 받아 맞춘다. runId가 바뀌면 새 실행이다(F10).
import type http from 'node:http';
import type { Store, StoreEvent } from '../store/store.ts';

// D-13 [추측 수치]: 실시간 연결 16, 연결마다 보내지 못하고 쌓인 바이트 1MiB(넘으면 그 연결을 끊는다 — 화면은 다시 연결해 목록을 맞춘다)
export const EVENT_LIMITS = { maxStreams: 16, bufferBytes: 1_048_576, heartbeatMs: 15_000 };
export type EventOptions = Partial<typeof EVENT_LIMITS>;

// 허브가 응답에서 쓰는 것만(테스트는 이 모양의 가짜로 확인한다)
type Sink = Pick<http.ServerResponse, 'writeHead' | 'write' | 'end' | 'destroy' | 'once' | 'writableLength'>;

function readOptions(o: unknown) {
  const out = { ...EVENT_LIMITS };
  if (o === undefined) return out;
  if (!o || typeof o !== 'object') throw new TypeError('실시간 통로 옵션은 객체여야 합니다.');
  for (const key of Object.keys(EVENT_LIMITS) as (keyof typeof EVENT_LIMITS)[]) {
    const v = (o as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new TypeError(`실시간 통로 옵션 ${key}는 1 이상의 정수여야 합니다.`);
    out[key] = v;
  }
  return out;
}

export function createEventHub(store: Store, options?: EventOptions) {
  const limits = readOptions(options);
  const streams = new Set<Sink>();
  let queue: StoreEvent[] = [];
  let scheduled = false;
  let seq = 0; // 이 실행에서 보낸 알림의 일련번호(id 줄)
  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;

  // 저장소 구독자: 넣고 바로 돌아온다. 던지지 않는다
  function onEvent(e: StoreEvent) {
    queue.push(e);
    if (!scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  }
  function flush() {
    scheduled = false;
    const batch = queue;
    queue = [];
    if (!streams.size || !batch.length) return;
    let chunk = '';
    // JSON.stringify는 문자열 안의 CR·LF를 \r·\n으로 바꾼다 — 기록 내용이 SSE 줄을 끊거나 새 필드를 만들 수 없다
    for (const e of batch) chunk += `id: ${++seq}\ndata: ${JSON.stringify(e)}\n\n`;
    send(chunk);
  }
  // 느린 구독자(U33): 앞서 쓴 것 중 아직 보내지 못하고 쌓인 바이트가 상한을 넘으면 그 연결만 끊는다.
  // 이번 덩어리를 쓰기 **전에** 본다 — 쓴 뒤에 보면 한 차례 알림이 상한보다 클 때 잘 읽는 연결까지 끊긴다
  function send(chunk: string) {
    for (const s of [...streams]) {
      if (s.writableLength > limits.bufferBytes) {
        streams.delete(s);
        s.destroy();
        continue;
      }
      s.write(chunk);
    }
    idle();
  }
  // 연결이 없으면 구독·타이머를 풀고 쌓인 알림을 버린다(아무도 안 볼 때 일하지 않는다 — U38)
  function idle() {
    if (streams.size) return;
    unsubscribe?.();
    unsubscribe = undefined;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    queue = [];
  }

  return {
    // 자리가 있으면 스트림을 열고 true, 차 있으면(또는 닫는 중이면) 아무것도 쓰지 않고 false — 응답(503)은 server.ts가 쓴다
    open(res: Sink): boolean {
      if (closed || streams.size >= limits.maxStreams) return false;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write(`data: ${JSON.stringify({ type: 'hello', runId: store.runId })}\n\n`);
      streams.add(res);
      res.once('close', () => {
        if (streams.delete(res)) idle();
      });
      unsubscribe ??= store.subscribe(onEvent);
      if (!heartbeat) {
        heartbeat = setInterval(() => send(': ping\n\n'), limits.heartbeatMs);
        heartbeat.unref();
      }
      return true;
    },
    close() {
      closed = true;
      for (const s of [...streams]) {
        streams.delete(s);
        s.end();
      }
      idle();
    },
    stats() {
      return { streams: streams.size };
    },
  };
}
