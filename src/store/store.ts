// [STO-1] 저장소: 프록시의 시작 알림(FlowStart)과 기록(Flow)을 메모리에 모아 두고, 대시보드에 요약 알림·목록·상세를 준다.
//
// 사용자 결정(2026-11-08, docs/ai/sto-cases.md):
//   S-2 시작 알림은 "진행 중" 요약이 되고 완료가 오면 바뀐다. CONNECT의 시작 알림은 넣지 않는다(복호화 터널은 끝 기록이 오지 않음 — X1)
//   S-3 상태 코드 = 목적지 응답이 있으면 그 코드(upstream), 없으면 프록시가 보낸 error.status(proxy)
//   S-4 알림·목록은 본문·헤더 없는 작은 요약(매번 새 객체), 상세는 본문까지 복사한 사본
//   S-5 clear() 전에 시작한 요청의 늦은 완료는 버린다
//   S-9 저장소마다 실행 식별자(runId)
//   S-10 구독자의 throw·reject는 저장 상태·다른 구독자·프록시에 번지지 않고, 아무것도 출력하지 않는다(셈만)
// 디스크에 쓰지 않고 아무것도 출력하지 않는다(PRX-2 결정). 기록에는 쿠키·토큰이 원본 그대로 있다.
// 상한(STO-2), 필터(STO-3), 프록시 연결(STO-4)은 다른 단위다.
import crypto from 'node:crypto';
import type { Flow, FlowStart, HeaderPairs, Target } from '../flow/flow.ts';

export type Summary = {
  id: number;
  runId: string;
  state: 'pending' | 'done';
  startedAt: number;
  method: string;
  url: string;
  target?: Target;
  status?: number;
  statusFrom?: 'upstream' | 'proxy';
  error?: Flow['error'];
  durationMs?: number;
  requestSize?: number;
  responseSize?: number;
  tunnel?: Flow['tunnel'];
};

export type StoreEvent = { type: 'start' | 'done'; summary: Summary } | { type: 'evicted'; ids: number[] } | { type: 'cleared' };

export type Store = {
  readonly runId: string;
  addStart(start: FlowStart): void;
  addFlow(flow: Flow): void;
  list(filter?: unknown): Summary[];
  get(id: number): Flow | undefined;
  subscribe(fn: (event: StoreEvent) => unknown): () => void;
  clear(): void;
  stats(): { flows: number; pending: number; subscriberErrors: number };
};

// 항목: 진행 중이면 시작 알림에서 꺼낸 칸만(헤더 배열은 붙잡지 않는다 — A8), 완료면 기록 전체
type Pending = { state: 'pending'; id: number; startedAt: number; method: string; url: string; target?: Target };
type Done = { state: 'done'; flow: Flow };
type Entry = Pending | Done;

// E2: 잘못된 입력의 오류 문구는 고정. 입력 내용(쿠키·url)을 문구나 속성에 넣지 않는다
const badShape = () => new TypeError('저장소에 넣을 기록의 모양이 올바르지 않습니다.');

const isId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;
function checkHead(r: unknown) {
  const q = r as { method?: unknown; url?: unknown; headers?: unknown } | null;
  if (!q || typeof q !== 'object' || typeof q.method !== 'string' || typeof q.url !== 'string' || !Array.isArray(q.headers)) throw badShape();
}
function checkStart(s: unknown): asserts s is FlowStart {
  const x = s as { id?: unknown; request?: unknown } | null;
  if (!x || typeof x !== 'object' || !isId(x.id)) throw badShape();
  checkHead(x.request);
}
function checkFlow(f: unknown): asserts f is Flow {
  const x = f as { id?: unknown; request?: { body?: unknown }; response?: { body?: unknown } } | null;
  if (!x || typeof x !== 'object' || !isId(x.id)) throw badShape();
  checkHead(x.request);
  if (!Buffer.isBuffer(x.request!.body)) throw badShape();
  if (x.response !== undefined && (!x.response || !Buffer.isBuffer(x.response.body))) throw badShape();
}

// C10: 본문 사본은 자기 메모리(allocUnsafeSlow). Buffer.from은 작은 본문을 공유 풀에 넣어 .buffer로 다른 기록에 닿게 한다
function copyBuf(b: Buffer): Buffer {
  const out = Buffer.allocUnsafeSlow(b.length);
  b.copy(out);
  return out;
}
const copyPairs = (h: HeaderPairs): HeaderPairs => h.map(([n, v]) => [n, v]);
const copyTarget = (t: Target | undefined) => (t ? { scheme: t.scheme, host: t.host, port: t.port, path: t.path } : undefined);
const copyError = (e: Flow['error']) => (e ? { by: e.by, code: e.code, ...(e.status === undefined ? {} : { status: e.status }) } : undefined);
const copyTunnel = (t: Flow['tunnel']) => (t ? { bytesUp: t.bytesUp, bytesDown: t.bytesDown, address: t.address } : undefined);

// 상세 사본(C9): 받은 쪽이 고쳐도 저장된 기록에 번지지 않는다
function copyFlow(f: Flow): Flow {
  const r = f.request;
  const out: Flow = {
    id: f.id,
    startedAt: f.startedAt,
    durationMs: f.durationMs,
    request: {
      method: r.method,
      url: r.url,
      httpVersion: r.httpVersion,
      headers: copyPairs(r.headers),
      ...(r.target ? { target: copyTarget(r.target) } : {}),
      body: copyBuf(r.body),
      bodySize: r.bodySize,
      bodyTruncated: r.bodyTruncated,
    },
  };
  if (f.response) {
    const s = f.response;
    out.response = { httpVersion: s.httpVersion, headers: copyPairs(s.headers), body: copyBuf(s.body), bodySize: s.bodySize, bodyTruncated: s.bodyTruncated, status: s.status, statusMessage: s.statusMessage };
  }
  if (f.error) out.error = copyError(f.error);
  if (f.tunnel) out.tunnel = copyTunnel(f.tunnel);
  if (f.tls) out.tls = { sni: f.tls.sni, ...(f.tls.upstreamError === undefined ? {} : { upstreamError: f.tls.upstreamError }) };
  return out;
}

// 요약(S-3, S-4): 본문·헤더 없음. 매번 새 객체
function summaryOf(e: Entry, runId: string): Summary {
  if (e.state === 'pending') {
    return { id: e.id, runId, state: 'pending', startedAt: e.startedAt, method: e.method, url: e.url, ...(e.target ? { target: copyTarget(e.target) } : {}) };
  }
  const f = e.flow;
  const s: Summary = { id: f.id, runId, state: 'done', startedAt: f.startedAt, method: f.request.method, url: f.request.url, durationMs: f.durationMs, requestSize: f.request.bodySize };
  if (f.request.target) s.target = copyTarget(f.request.target);
  if (f.response) {
    s.status = f.response.status;
    s.statusFrom = 'upstream';
    s.responseSize = f.response.bodySize;
  } else if (f.error?.status !== undefined) {
    s.status = f.error.status;
    s.statusFrom = 'proxy';
  }
  if (f.error) s.error = copyError(f.error);
  if (f.tunnel) s.tunnel = copyTunnel(f.tunnel);
  return s;
}

export function createStore(_options?: unknown): Store {
  const runId = crypto.randomBytes(8).toString('hex');
  const entries = new Map<number, Entry>();
  // S-5: clear() 때까지 본 가장 큰 id. 그 이하의 시작·완료는 clear 전에 시작한 요청이므로 버린다(프록시 id는 늘기만 한다)
  let floor = -1;
  let seenMax = -1;
  let subscriberErrors = 0;

  // 구독자: 해제하면 active = false로 바로 꺼지고 목록에서 빠진다(참조를 남기지 않음 — C5)
  type Listener = { fn: (e: StoreEvent) => unknown; active: boolean };
  const listeners = new Set<Listener>();
  // C8: 알림 중에 생긴 알림은 지금 알림이 모든 구독자에게 간 뒤에 보낸다
  const queue: StoreEvent[] = [];
  let delivering = false;
  const failed = () => void subscriberErrors++;

  function call(l: Listener, e: StoreEvent) {
    try {
      // S-4·C9: 구독자마다 자기 사본. 앞 구독자가 고쳐도 뒤 구독자에게 번지지 않는다
      const r = l.fn(structuredClone(e)) as PromiseLike<unknown> | undefined;
      if (r && typeof r.then === 'function') r.then(undefined, failed); // C3: reject도 여기서 받는다
    } catch {
      failed(); // C2·S-10: 출력하지 않는다(오류에 기록 내용이 들어 있을 수 있음)
    }
  }
  function emit(e: StoreEvent) {
    queue.push(e);
    if (delivering) return;
    delivering = true;
    try {
      while (queue.length) {
        const next = queue.shift()!;
        // C6·C7: 알림을 시작할 때의 구독자에게만. 그 사이 해제된 구독자는 부르지 않는다
        for (const l of [...listeners]) if (l.active) call(l, next);
      }
    } finally {
      delivering = false;
    }
  }

  const accept = (id: number) => {
    if (id <= floor) return false;
    if (id > seenMax) seenMax = id;
    return true;
  };

  const store: Store = {
    runId,
    addStart(start) {
      checkStart(start);
      if (!accept(start.id)) return;
      if (entries.has(start.id)) return; // B6: 완료 뒤 늦게 온 시작, 중복 시작
      const r = start.request;
      if (r.method === 'CONNECT') return; // S-2·A4
      const p: Pending = { state: 'pending', id: start.id, startedAt: start.startedAt, method: r.method, url: r.url, ...(r.target ? { target: copyTarget(r.target) } : {}) };
      entries.set(start.id, p);
      emit({ type: 'start', summary: summaryOf(p, runId) });
    },
    addFlow(flow) {
      checkFlow(flow);
      if (!accept(flow.id)) return;
      if (entries.get(flow.id)?.state === 'done') return; // 같은 id의 두 번째 완료는 무시
      const d: Done = { state: 'done', flow };
      entries.set(flow.id, d); // 진행 중 항목(시작 알림의 칸)을 바꿔 끼운다 — A8. 시작 없이 온 완료도 저장 — B1
      emit({ type: 'done', summary: summaryOf(d, runId) });
    },
    list() {
      return [...entries.keys()].sort((a, b) => a - b).map((id) => summaryOf(entries.get(id)!, runId));
    },
    get(id) {
      if (!isId(id)) return undefined;
      const e = entries.get(id);
      return e?.state === 'done' ? copyFlow(e.flow) : undefined;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('구독자는 함수여야 합니다.');
      const l: Listener = { fn, active: true };
      listeners.add(l);
      return () => {
        l.active = false;
        listeners.delete(l);
        l.fn = () => {}; // 해제한 함수를 붙잡지 않는다
      };
    },
    clear() {
      entries.clear();
      floor = seenMax;
      emit({ type: 'cleared' });
    },
    stats() {
      let pending = 0;
      for (const e of entries.values()) if (e.state === 'pending') pending++;
      return { flows: entries.size - pending, pending, subscriberErrors };
    },
  };
  return store;
}
