// [UI-3] 조회 API: 목록·상세·본문·지우기. 사례·결정: docs/ai/ui-cases.md(배정 "UI-3": U7, U8, U20, U30, U35, D-8, D-9, D-13), STO 보고서 결정 6.
//
//   GET  /api/flows?host=&method=&status=&after=&limit=  → { runId, items: 요약[], next }   (id 오름차순, limit 기본·최대 500)
//   GET  /api/flows/<id>                                  → 상세(요청·응답 머리, 본문 대신 bodySize·bodyTruncated)
//   GET  /api/flows/<id>/body/request|response            → 원본 바이트(server.ts가 octet-stream + attachment로 보냄)
//   POST /api/clear  (Content-Type: application/json)     → 204
//
// 접근 검사(Host·Origin·Sec-Fetch-Site·Via·토큰)는 server.ts의 guard·authorized가 먼저 끝냈다. 여기서는 경로·메서드·입력만 본다.
// 응답 쓰기(보안 헤더·고정 문구)는 server.ts가 한다 — 여기서는 결과만 돌려준다. 입력 값을 결과 문구에 넣지 않는다(U30).
import type { Store } from '../store/store.ts';
import type { Flow } from '../flow/flow.ts';

export const API_LIMITS = { pageMax: 500 }; // D-13 [추측 수치] — 목록 한 번에 최대 500건

export type ApiResult =
  | { status: 200; json: unknown }
  | { status: 200; bytes: Buffer }
  | { status: 204 }
  | { status: 400; reason: 'query' }
  | { status: 404 }
  | { status: 405; allow: string }
  | { status: 415 };

const QUERY_KEYS = new Set(['host', 'method', 'status', 'after', 'limit']);
const NUMBER = /^[0-9]{1,15}$/;

// 목록 조건. 모르는 이름·같은 이름 두 번·숫자가 아닌 수는 거절한다 — 오타가 조용히 "전체"가 되거나 두 값 중 하나가 몰래 쓰이지 않게.
// 값의 범위(status 0·100~999, limit 1 이상)는 저장소의 parseFilter가 같은 규칙으로 본다(STO-3·STO-5)
export function parseQuery(query: string): Record<string, string | number> | undefined {
  const params = new URLSearchParams(query);
  const out: Record<string, string | number> = {};
  for (const [k, v] of params) {
    if (!QUERY_KEYS.has(k) || k in out) return undefined;
    if (k === 'host' || k === 'method') out[k] = v;
    else {
      if (!NUMBER.test(v)) return undefined;
      out[k] = Number(v);
    }
  }
  // U35: 한 번에 너무 많이 주지 않는다. 더 큰 값은 거절하지 않고 줄인다(화면이 "많이"를 달라고 해도 동작하게)
  out.limit = Math.min(typeof out.limit === 'number' ? out.limit : API_LIMITS.pageMax, API_LIMITS.pageMax);
  return out;
}

// 상세: 본문은 따로 받는다(U35 — 1MiB 본문 둘을 JSON 문자열로 바꾸면 커지고 느리다). 헤더는 받은 쌍 배열 그대로(중복·대소문자·__proto__도 데이터 — U24)
export function detailOf(f: Flow, runId: string) {
  const { body: _rq, ...request } = f.request;
  const response = f.response && (({ body: _rs, ...rest }) => rest)(f.response);
  return {
    id: f.id,
    runId,
    startedAt: f.startedAt,
    durationMs: f.durationMs,
    request,
    ...(response ? { response } : {}),
    ...(f.error ? { error: f.error } : {}),
    ...(f.tunnel ? { tunnel: f.tunnel } : {}),
    ...(f.tls ? { tls: f.tls } : {}),
  };
}

const ID = /^[1-9][0-9]{0,15}$/;
const READ_ONLY: ApiResult = { status: 405, allow: 'GET' };

export function handleApi(store: Store, method: string, pathname: string, query: string, headers: { 'content-type'?: string }): ApiResult {
  // 지우기(D-8). U6·U7: 폼·no-cors 요청은 application/json을 보낼 수 없다(보내려면 사전 확인이 필요하고, 그건 405로 답한다)
  if (pathname === '/api/clear') {
    if (method !== 'POST') return { status: 405, allow: 'POST' };
    const type = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return { status: 415 };
    store.clear();
    return { status: 204 };
  }

  if (pathname === '/api/flows') {
    if (method !== 'GET') return READ_ONLY;
    const q = parseQuery(query);
    if (!q) return { status: 400, reason: 'query' };
    let items;
    try {
      items = store.list(q);
    } catch {
      return { status: 400, reason: 'query' }; // parseFilter의 TypeError(범위 밖 값) — 문구는 고정
    }
    const limit = q.limit as number;
    // 다음 쪽: 받은 수가 limit과 같으면 더 있을 수 있다 → after=next로 이어 받는다(STO 결정 6: 오래된 것부터, 전체 개수 없음)
    return { status: 200, json: { runId: store.runId, items, next: items.length === limit ? items[items.length - 1].id : null } };
  }

  const m = pathname.match(/^\/api\/flows\/([^/]+)(?:\/body\/(request|response))?$/);
  if (m && ID.test(m[1])) {
    if (method !== 'GET') return READ_ONLY;
    const id = Number(m[1]);
    const f = Number.isSafeInteger(id) ? store.get(id) : undefined; // 진행 중이거나 없거나 빠진(evicted) 기록이면 undefined
    if (!f) return { status: 404 };
    if (!m[2]) return { status: 200, json: detailOf(f, store.runId) };
    const part = m[2] === 'request' ? f.request : f.response;
    if (!part) return { status: 404 }; // 응답을 받지 못한 기록
    return { status: 200, bytes: part.body };
  }
  return { status: 404 };
}
