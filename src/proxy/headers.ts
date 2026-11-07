// [PRX-1] 구간마다 다시 정해야 하는 헤더(hop-by-hop)를 정리하고, 이 프록시를 지났다는 표시(Via)를 붙인다.
//
// "curl ↔ 프록시"와 "프록시 ↔ 목적지"는 서로 다른 연결이다. 연결 관리 헤더는 한 구간에서만 의미가 있어서
// 다음 구간으로 넘기면 안 된다 (RFC 9110 7.6.1). 넘기면 자격증명이 새거나(Proxy-Authorization) 연결이 꼬인다.
import type { IncomingHttpHeaders } from 'node:http';

export const VIA_ID = '1.1 sumun';

// 항상 지우는 헤더. transfer-encoding도 지운다: 본문 경계(chunked 등)는 Node가 구간마다 다시 만든다.
const HOP_BY_HOP = new Set(['connection', 'proxy-connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);

// Connection 헤더에 나열돼도 지우지 않는 헤더 (사례 E5).
// 이걸 지우게 만들면 목적지와 본문 경계·라우팅 해석이 어긋나는 공격이 된다.
const PROTECTED = new Set(['host', 'content-length']);

export type Headers = Record<string, string | string[]>;

export function stripHopByHop(headers: IncomingHttpHeaders): Headers {
  // Connection: keep-alive, X-Secret  →  x-secret도 이 구간 전용이라는 뜻
  const listed = new Set(
    [headers.connection ?? []]
      .flat()
      .flatMap((v) => v.split(','))
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  const out: Headers = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(key)) continue;
    if (listed.has(key) && !PROTECTED.has(key)) continue;
    out[key] = value;
  }
  return out;
}

// 기존 Via는 보존하고 뒤에 이 프록시를 덧붙인다 (RFC 9110 7.6.3)
export function addVia(existing: string | string[] | undefined): string {
  const prev = [existing ?? []].flat().join(', ');
  return prev ? `${prev}, ${VIA_ID}` : VIA_ID;
}

// 요청이 이미 이 프록시를 지나온 적이 있는가 (루프의 두 번째 방어선, 사례 B4)
export function hasOwnVia(via: string | string[] | undefined): boolean {
  return [via ?? []]
    .flat()
    .flatMap((v) => v.split(','))
    .some((hop) => hop.trim().toLowerCase().replace(/\s+/g, ' ') === VIA_ID);
}
