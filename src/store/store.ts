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
// [STO-2] 상한: 바이트·완료 건수·진행 중 개수(STORE_LIMITS). 필터(STO-3), 프록시 연결(STO-4)은 다른 단위다.
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
  stats(): { flows: number; pending: number; bytes: number; subscriberErrors: number };
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

// [STO-2] 결정 S-1·S-2: 기본 상한
export const STORE_LIMITS = { maxBytes: 256 * 1_048_576, maxFlows: 10_000, maxPending: 1_000 };
export type StoreOptions = Partial<typeof STORE_LIMITS>;

// [STO-2] 항목의 메모리 비용 추정(바이트). 실제 힙 크기와 정확히 같지는 않다 — 상한이 "대략 이만큼"을 지키게 하는 값
//   본문: 저장된 body.length(오간 전체 크기 bodySize가 아님 — A2)
//   헤더: 쌍마다 64 + 2×(이름+값 길이). [string, string] 배열은 힙에서 쌍당 약 74바이트를 쓴다(sto-cases A3: 3,000쌍 건당 약 222KB)
//   문자열: UTF-16으로 보고 2배
const ENTRY_COST = 256;
const PAIR_COST = 64;
const pairsCost = (h: HeaderPairs | undefined) => {
  let n = 0;
  for (const p of h ?? []) n += PAIR_COST + 2 * ((p?.[0]?.length ?? 0) + (p?.[1]?.length ?? 0));
  return n;
};
function costOf(e: Entry): number {
  if (e.state === 'pending') return ENTRY_COST + 2 * (e.url.length + (e.target ? e.target.host.length + e.target.path.length : 0));
  const f = e.flow;
  return ENTRY_COST + 2 * f.request.url.length + f.request.body.length + pairsCost(f.request.headers) + (f.response ? f.response.body.length + pairsCost(f.response.headers) : 0);
}

function readOptions(o: unknown) {
  if (o === undefined) return { ...STORE_LIMITS };
  if (!o || typeof o !== 'object') throw new TypeError('저장소 옵션은 객체여야 합니다.');
  const out = { ...STORE_LIMITS };
  for (const key of Object.keys(STORE_LIMITS) as (keyof typeof STORE_LIMITS)[]) {
    const v = (o as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new TypeError(`저장소 옵션 ${key}는 1 이상의 정수여야 합니다.`);
    out[key] = v;
  }
  return out;
}

// [STO-2] 상한으로 뺀 진행 중 id를 기억하는 개수(늦은 완료를 버리기 위해 — S-5). 넘으면 가장 오래된 기억부터 잊는다
const EVICTED_PENDING_MEMORY = 10_000;

export function createStore(options?: StoreOptions): Store {
  const limits = readOptions(options);
  const runId = crypto.randomBytes(8).toString('hex');
  // 항목은 저장소에 먼저 들어온 순서(Map 삽입 순서)로 놓인다. 진행 중이 완료로 바뀌어도 자리는 그대로(Map.set은 기존 키의 순서를 지킨다)
  const entries = new Map<number, Entry>();
  const costs = new Map<number, number>();
  let bytes = 0;
  let pendingCount = 0;
  const evictedPending = new Set<number>();
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

  // [STO-2] 항목 넣기·빼기는 여기로만: 비용·개수를 함께 맞춘다
  function put(id: number, e: Entry) {
    const old = entries.get(id);
    if (old) remove(id, false);
    entries.set(id, e); // 지운 뒤 다시 넣으면 순서가 바뀌므로, 바꿔 끼울 때는 아래 replace를 쓴다
    const c = costOf(e);
    costs.set(id, c);
    bytes += c;
    if (e.state === 'pending') pendingCount++;
  }
  function replace(id: number, e: Done) {
    // 진행 중 → 완료: 같은 자리(Map 순서)에 둔다
    const old = entries.get(id)!;
    bytes -= costs.get(id) ?? 0;
    if (old.state === 'pending') pendingCount--;
    entries.set(id, e);
    const c = costOf(e);
    costs.set(id, c);
    bytes += c;
  }
  function remove(id: number, rememberPending: boolean) {
    const e = entries.get(id);
    if (!e) return;
    entries.delete(id);
    bytes -= costs.get(id) ?? 0;
    costs.delete(id);
    if (e.state === 'pending') {
      pendingCount--;
      if (rememberPending) {
        evictedPending.add(id);
        if (evictedPending.size > EVICTED_PENDING_MEMORY) evictedPending.delete(evictedPending.values().next().value!);
      }
    }
  }
  // 먼저 들어온 항목부터(조건에 맞는 것 중) 하나 고른다. 방금 넣은 항목(keep)은 고르지 않는다
  function oldest(keep: number, want?: Entry['state']) {
    for (const [id, e] of entries) if (id !== keep && (want === undefined || e.state === want)) return id;
    return undefined;
  }
  // S-1·S-2: 진행 중 → 완료 건수 → 바이트 순으로 상한을 맞추고, 뺀 id를 그 넣기의 알림 뒤에 한 번에 알린다
  function enforce(keep: number) {
    const out: number[] = [];
    const drop = (id: number | undefined) => {
      if (id === undefined) return false;
      remove(id, true);
      out.push(id);
      return true;
    };
    while (pendingCount > limits.maxPending && drop(oldest(keep, 'pending')));
    while (entries.size - pendingCount > limits.maxFlows && drop(oldest(keep, 'done')));
    while (bytes > limits.maxBytes && drop(oldest(keep)));
    if (out.length) emit({ type: 'evicted', ids: out.sort((a, b) => a - b) });
  }

  const store: Store = {
    runId,
    addStart(start) {
      checkStart(start);
      if (!accept(start.id)) return;
      if (entries.has(start.id) || evictedPending.has(start.id)) return; // B6: 완료 뒤 늦게 온 시작, 중복 시작
      const r = start.request;
      if (r.method === 'CONNECT') return; // S-2·A4
      const p: Pending = { state: 'pending', id: start.id, startedAt: start.startedAt, method: r.method, url: r.url, ...(r.target ? { target: copyTarget(r.target) } : {}) };
      put(start.id, p);
      emit({ type: 'start', summary: summaryOf(p, runId) });
      enforce(start.id);
    },
    addFlow(flow) {
      checkFlow(flow);
      if (!accept(flow.id)) return;
      if (evictedPending.delete(flow.id)) return; // S-5: 상한으로 뺀 진행 중의 늦은 완료는 버린다
      const prev = entries.get(flow.id);
      if (prev?.state === 'done') return; // 같은 id의 두 번째 완료는 무시
      const d: Done = { state: 'done', flow };
      // 진행 중 항목(시작 알림의 칸)을 같은 자리에 바꿔 끼운다 — A8. 시작 없이 온 완료도 저장 — B1
      if (prev) replace(flow.id, d);
      else put(flow.id, d);
      emit({ type: 'done', summary: summaryOf(d, runId) });
      enforce(flow.id);
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
      costs.clear();
      bytes = 0;
      pendingCount = 0;
      evictedPending.clear(); // clear 기준선(floor)이 그 id들을 이미 덮는다
      floor = seenMax;
      emit({ type: 'cleared' });
    },
    stats() {
      return { flows: entries.size - pendingCount, pending: pendingCount, bytes, subscriberErrors };
    },
  };
  return store;
}
