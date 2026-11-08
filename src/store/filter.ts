// [STO-3] 목록 필터: 호스트·메서드·상태 코드(모두 AND)와 id 기준 페이지(after·limit).
//
// 결정(docs/ai/sto-cases.md):
//   S-6 호스트 표기는 저장소가 맞춘다 — 입력과 기록의 target.host를 같은 함수(normHost)로 정규화한다.
//       프록시가 만드는 표기는 기록마다 다르다(평문은 WHATWG hostname, CONNECT는 끝 점·IPv6 표기 그대로 — X3).
//   S-3 상태 코드 = 요약의 status(목적지 응답, 없으면 프록시가 보낸 코드)
//   S-8 메서드는 대소문자를 무시한다. CONNECT도 고를 수 있다
// 기준 칸은 url이 아니라 request.target(D5). target 없는 기록은 호스트 조건에 걸리지 않는다(D1).
import type { Summary } from './store.ts';

export type Filter = { host?: string; method?: string; status?: number; after?: number; limit?: number };
type HostQuery = { host: string; port?: number; ip: boolean } | 'never';
export type ParsedFilter = { host?: HostQuery; method?: string; status?: number; after?: number; limit?: number };

const bad = (what: string) => new TypeError(`필터 조건 ${what}의 형식이 올바르지 않습니다.`);

// 소문자, 끝 점 제거, URL 규칙(IPv6 대괄호·표기, 국제화 도메인 → punycode, 숫자 IPv4 → 점 표기). 해석할 수 없으면 undefined
export function normHost(h: string): string | undefined {
  let s = h.trim().toLowerCase();
  if (!s || /[/?#@\\\s]/.test(s)) return undefined; // URL이 호스트 밖으로 읽을 글자
  if (s.includes(':') && !s.startsWith('[')) s = `[${s}]`; // 대괄호 없는 IPv6
  let host: string;
  try {
    const u = new URL(`http://${s}/`);
    if (u.port || u.username || u.password) return undefined;
    host = u.hostname;
  } catch {
    return undefined;
  }
  if (!host) return undefined;
  return host.startsWith('[') ? host : host.replace(/\.+$/, '') || undefined;
}

const isIp = (h: string) => h.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(h);

// "host", "host:port", "[v6]", "[v6]:port", 대괄호 없는 IPv6. 포트는 URL 객체가 기본 포트(80·443)를 지우므로 직접 읽는다
function parseHost(q: string): HostQuery {
  const s = q.trim();
  let host = s;
  let portText: string | undefined;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return 'never';
    host = s.slice(0, end + 1);
    const rest = s.slice(end + 1);
    if (rest) {
      if (!rest.startsWith(':')) return 'never';
      portText = rest.slice(1);
    }
  } else if (s.split(':').length === 2) {
    [host, portText] = s.split(':');
  }
  let port: number | undefined;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) return 'never';
    port = Number(portText);
  }
  const h = normHost(host);
  if (!h) return 'never'; // 입력 중인 글자 — 예외 없이 아무것도 걸리지 않는다
  return { host: h, ...(port === undefined ? {} : { port }), ip: isIp(h) };
}

export function parseFilter(f: unknown): ParsedFilter {
  if (f === undefined || f === null) return {};
  if (typeof f !== 'object' || Array.isArray(f)) throw new TypeError('필터는 객체여야 합니다.');
  const o = f as Record<string, unknown>;
  const out: ParsedFilter = {};
  if (o.host !== undefined && o.host !== '') {
    if (typeof o.host !== 'string') throw bad('host');
    out.host = parseHost(o.host);
  }
  if (o.method !== undefined && o.method !== '') {
    if (typeof o.method !== 'string') throw bad('method');
    out.method = o.method.trim().toUpperCase();
  }
  if (o.status !== undefined) {
    // 0은 기록에 실제로 나올 수 있는 값이다(응답 상태를 못 읽은 경우 — sto-cases D7). 그 밖에는 100~999
    const v = o.status;
    if (typeof v !== 'number' || !Number.isInteger(v) || !(v === 0 || (v >= 100 && v <= 999))) throw bad('status');
    out.status = v;
  }
  if (o.after !== undefined) {
    if (typeof o.after !== 'number' || !Number.isSafeInteger(o.after) || o.after < 0) throw bad('after');
    out.after = o.after;
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== 'number' || !Number.isSafeInteger(o.limit) || o.limit < 1) throw bad('limit');
    out.limit = o.limit;
  }
  return out;
}

function hostMatches(q: HostQuery, s: Summary): boolean {
  if (q === 'never' || !s.target) return false;
  const h = normHost(s.target.host);
  if (!h) return false;
  if (q.port !== undefined && s.target.port !== q.port) return false;
  if (h === q.host) return true;
  return !q.ip && !isIp(h) && h.endsWith(`.${q.host}`); // 하위 도메인. IP는 정확히 같을 때만
}

// limit은 목록에서만 쓴다(요약 하나에는 의미가 없다)
export function matchesParsed(p: ParsedFilter, s: Summary): boolean {
  if (p.after !== undefined && !(s.id > p.after)) return false;
  if (p.method !== undefined && s.method.toUpperCase() !== p.method) return false;
  if (p.status !== undefined && s.status !== p.status) return false;
  if (p.host !== undefined && !hostMatches(p.host, s)) return false;
  return true;
}

// D10: 대시보드가 새 알림 하나만 보고 지금 필터에 맞는지 판단할 때. store.list(f)와 같은 규칙
export function matchesFilter(summary: Summary, filter: unknown): boolean {
  return matchesParsed(parseFilter(filter), summary);
}
