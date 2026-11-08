// [UI-5] 화면의 순수 함수(DOM 없음 — Node 테스트가 직접 부른다). 사례·결정: docs/ai/ui-cases.md(배정 "UI-5", D-3, D-14, D-16)
//
// 이 파일은 글자를 "보이게" 바꿀 뿐 HTML을 만들지 않는다. 화면에 넣는 일은 app.js가 textContent로만 한다(U19).
// 헤더·기록은 배열과 Map으로만 다룬다 — 기록에서 온 이름을 객체 키로 쓰지 않는다(U24: __proto__ 같은 이름).
// 빌드·라이브러리 없이 브라우저가 그대로 읽는 ES 모듈이다(D-16, U18, U23).

// D-3: 주소의 # 뒤 "t=<토큰>"만. 다른 모양이면 토큰이 없는 것으로 본다
export function tokenFromHash(hash) {
  const m = /^#t=([A-Za-z0-9_-]{22,128})$/.exec(String(hash ?? ''));
  return m ? m[1] : null;
}

// D-14, U25, U26: 보이지 않거나 글자 방향·터미널을 바꾸는 문자를 ⟨U+XXXX⟩로 보인다.
//   C0 제어(줄바꿈·탭 포함)·DEL·C1 제어, 소프트 하이픈, 아랍 글자 표시, zero-width·방향 표시(200B~200F), 방향 덮어쓰기(202A~202E),
//   단어 잇기·보이지 않는 연산자(2060~2064), 방향 격리(2066~2069), BOM(FEFF)
// keepLines: 본문처럼 여러 줄인 칸에서는 줄바꿈·탭·CR을 그대로 둔다(그 밖은 똑같이 보인다)
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const mark = (c) => `⟨U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`;
export function showHidden(s, { keepLines = false } = {}) {
  return String(s ?? '').replace(HIDDEN, (c) => (keepLines && (c === '\n' || c === '\r' || c === '\t') ? c : mark(c)));
}

// RFC 3492 punycode 풀기(브라우저에는 domainToUnicode가 없다). 잘못된 입력은 throw — 부르는 쪽이 받는다
const BASE = 36, T_MIN = 1, T_MAX = 26, SKEW = 38, DAMP = 700, MAX = 0x7fffffff;
function adapt(delta, points, first) {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}
function digit(c) {
  if (c >= 48 && c <= 57) return c - 22; // 0~9 → 26~35
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 97;
  return BASE;
}
function punyDecode(input) {
  const out = [];
  const b = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(b, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('punycode');
    out.push(c);
  }
  let n = 128, i = 0, bias = 72;
  for (let idx = b >= 0 ? b + 1 : 0; idx < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) throw new Error('punycode');
      const d = digit(input.charCodeAt(idx++));
      if (d >= BASE || d > Math.floor((MAX - i) / w)) throw new Error('punycode');
      i += d * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      if (w > Math.floor(MAX / (BASE - t))) throw new Error('punycode');
      w *= BASE - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    if (Math.floor(i / len) > MAX - n) throw new Error('punycode');
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error('punycode');
    out.splice(i, 0, n);
    i++;
  }
  if (!out.length) throw new Error('punycode');
  return String.fromCodePoint(...out);
}

// D-14, U26: 기록의 호스트는 ASCII(punycode)다. xn-- 라벨이 있으면 유니코드도 함께 보인다(аррӏе.com 같은 동형 문자 속임을 알아볼 수 있게).
// 풀 수 없는 라벨이 있으면 ASCII만
export function hostLabel(host) {
  const h = String(host ?? '');
  const labels = h.split('.');
  if (!labels.some((l) => /^xn--/i.test(l))) return h;
  try {
    const u = labels.map((l) => (/^xn--/i.test(l) ? punyDecode(l.slice(4)) : l)).join('.');
    return `${h} (유니코드: ${showHidden(u)})`;
  } catch {
    return h;
  }
}

// 목적지(target)가 있으면 그것으로 URL을 보인다(복호화한 터널 안 요청은 url이 "/path"뿐이다). 기본 포트는 생략
export function displayUrl(s) {
  const t = s?.target;
  if (!t) return String(s?.url ?? '');
  const def = t.scheme === 'https' ? 443 : 80;
  return `${t.scheme}://${t.host}${t.port === def ? '' : `:${t.port}`}${t.path}`;
}

// U27: 긴 값은 max 글자(UTF-16 단위)까지. 이모지 같은 서로게이트 쌍을 반으로 가르지 않는다
export function clip(s, max) {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  let end = max;
  const c = str.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${str.slice(0, end)}… (+${str.length - end}자)`;
}

// 16바이트 줄: "오프셋  16진 16개  |ASCII|". max 바이트까지만
export function hexDump(bytes, max = 65536) {
  const n = Math.min(bytes.length, max);
  const lines = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(row, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return { text: lines.join('\n'), truncated: bytes.length > max };
}

// 본문을 글로: UTF-8로 풀고(잘못된 바이트는 U+FFFD) 숨은 문자를 보인다. NUL이 있거나 풀 수 없는 바이트가 많으면 binary(화면은 16진을 먼저 보임)
export function bodyText(bytes, max = 262144) {
  const part = bytes.subarray(0, max);
  const raw = new TextDecoder('utf-8').decode(part);
  const head = part.subarray(0, 8192);
  let bad = 0;
  for (const ch of raw) if (ch === '�') bad++;
  const binary = head.includes(0) || (raw.length > 0 && bad / raw.length > 0.1);
  return { text: showHidden(raw, { keepLines: true }), binary, truncated: bytes.length > max };
}

// U24: 헤더는 받은 쌍 배열 그대로. 이름은 대소문자를 무시하고, 같은 이름은 모두
export function headerValues(pairs, name) {
  const want = String(name).toLowerCase();
  const out = [];
  for (const p of Array.isArray(pairs) ? pairs : []) if (Array.isArray(p) && String(p[0]).toLowerCase() === want) out.push(String(p[1]));
  return out;
}

// 필터 → 조회 조건. 서버(STO-3)가 다시 검사한다. 여기서는 화면이 고정 문구로 바로 알려 줄 수 있는 것만 거른다(null)
export function buildQuery({ host, method, status } = {}) {
  const q = new URLSearchParams();
  const h = String(host ?? '').trim();
  const m = String(method ?? '').trim();
  const st = String(status ?? '').trim();
  if (h) q.append('host', h);
  if (m) {
    if (!/^[A-Za-z]{1,20}$/.test(m)) return null;
    q.append('method', m);
  }
  if (st) {
    if (!/^[0-9]{1,3}$/.test(st)) return null;
    q.append('status', st);
  }
  return q.toString();
}

// SSE 읽기(D-4: fetch 스트림이라 EventSource 대신 직접). 빈 줄에서 메시지 하나. data 줄 여럿은 줄바꿈으로 잇는다. 주석(:)은 버림.
// JSON이 아닌 메시지는 건너뛴다
export function createSSEParser(onMessage) {
  let buf = '';
  let id;
  let data = [];
  const field = (line, name) => {
    const v = line.slice(name.length + 1);
    return v.startsWith(' ') ? v.slice(1) : v;
  };
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line === '') {
          if (data.length) {
            let v;
            let ok = true;
            try {
              v = JSON.parse(data.join('\n'));
            } catch {
              ok = false;
            }
            if (ok) onMessage({ id, data: v });
          }
          id = undefined;
          data = [];
        } else if (line.startsWith('data:')) data.push(field(line, 'data'));
        else if (line.startsWith('id:')) id = field(line, 'id');
      }
    },
  };
}

// 목록 모델: id → 요약(Map). 완료를 진행 중이 덮지 않는다(늦게 온 시작 알림, 다시 받은 목록). 상한을 넘으면 id가 작은 것부터 뺀다(U27)
export function createModel({ maxRows = 10000 } = {}) {
  const map = new Map();
  let runId;
  function put(s) {
    if (!s || typeof s.id !== 'number') return;
    const old = map.get(s.id);
    if (old && old.state === 'done' && s.state !== 'done') return;
    map.set(s.id, s);
    while (map.size > maxRows) {
      let min = Infinity;
      for (const k of map.keys()) if (k < min) min = k;
      map.delete(min);
    }
  }
  const model = {
    get runId() {
      return runId;
    },
    get size() {
      return map.size;
    },
    // F10, U34: 실행이 바뀌면(프로그램을 다시 시작) 목록을 비운다
    setRun(r) {
      if (r === runId) return false;
      runId = r;
      map.clear();
      return true;
    },
    load(items) {
      for (const s of items ?? []) put(s);
    },
    apply(e) {
      if (!e) return;
      if (e.type === 'start' || e.type === 'done') put(e.summary);
      else if (e.type === 'evicted') for (const id of e.ids ?? []) map.delete(id);
      else if (e.type === 'cleared') map.clear();
      else if (e.type === 'hello') model.setRun(e.runId);
    },
    rows(limit = Infinity) {
      return [...map.values()].sort((a, b) => b.id - a.id).slice(0, limit);
    },
    get(id) {
      return map.get(id);
    },
  };
  return model;
}


// ---------------------------------------------------------------------------
// [UI-5b] 미리보기·압축 풀기·내려받기. 사례·설계: docs/ai/ui5b-cases.md(P1~P19, Q1~Q13, B-1~B-7)
// 화면은 blob:·data: URL을 만들지 않는다(B-1 — 최상위로 열린 blob 문서는 대시보드 출처에서 스크립트가 돈다, P1).
// 그래서 CSP를 바꾸지 않고, 이미지는 createImageBitmap → canvas로 그린다(app.js). 여기서는 그 전에 볼 것만 판정한다.

const ascii = (b, i, s) => i + s.length <= b.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const i32le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

// B-2, P2: 매직 바이트만 본다. 기록의 Content-Type은 공격자가 고른다. SVG·HTML·AVIF·ICO는 미리보기 대상이 아니다
export function sniffImage(b) {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, k) => b[k] === x)) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return 'gif';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (b.length >= 26 && ascii(b, 0, 'BM')) return 'bmp';
  return null;
}

// JPEG: SOS 전의 모든 SOF 중 가장 큰 크기(작은 프레임 뒤에 큰 프레임을 숨기는 속임 — P4)
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegSize(b) {
  let i = 2;
  let w = 0;
  let h = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) break;
    while (b[i] === 0xff) i++;
    const m = b[i++];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xda || m === 0xd9 || i + 2 > b.length) break;
    const len = u16be(b, i);
    if (len < 2) break;
    if (SOF.has(m) && i + 7 <= b.length) {
      h = Math.max(h, u16be(b, i + 3));
      w = Math.max(w, u16be(b, i + 5));
    }
    i += len;
  }
  return w && h ? { width: w, height: h } : null;
}

// 디코드하지 않고 머리에서 가로·세로를 읽는다. 못 읽으면 null
export function imageSize(b) {
  const type = sniffImage(b);
  if (type === 'png') return b.length >= 24 && ascii(b, 12, 'IHDR') ? { width: u32be(b, 16), height: u32be(b, 20) } : null;
  if (type === 'gif') return b.length >= 10 ? { width: u16le(b, 6), height: u16le(b, 8) } : null;
  if (type === 'bmp') return { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
  if (type === 'jpeg') return jpegSize(b);
  if (type === 'webp') {
    if (ascii(b, 12, 'VP8X') && b.length >= 30) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
    if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
      const [b1, b2, b3, b4] = [b[21], b[22], b[23], b[24]];
      return { width: 1 + (b1 | ((b2 & 0x3f) << 8)), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
    }
    if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

// B-3, P4: 디코드 전에 판정한다. 5천만 픽셀 ≈ RGBA 200MB(사진 8000×6000은 됨, 20000×20000 픽셀 폭탄은 안 됨 — Q8)
export function previewDecision(b, maxPixels = 50_000_000) {
  const type = sniffImage(b);
  if (!type) return { ok: false, reason: 'not-image' };
  const s = imageSize(b);
  if (!s || !s.width || !s.height) return { ok: false, reason: 'unknown-size' };
  if (s.width * s.height > maxPixels) return { ok: false, reason: 'too-large' };
  return { ok: true, type, width: s.width, height: s.height };
}

// B-4, Q5·Q13: Content-Encoding 줄을 모두 쉼표로 잇고, 소문자로 나눠 identity·빈 값을 뺀다(적용된 순서 그대로)
export function contentEncodings(headers) {
  return headerValues(headers, 'content-encoding')
    .join(',')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== 'identity');
}

// B-4, P6·P8: 정확히 한 층만 푼다. Chrome의 DecompressionStream은 gzip·deflate·deflate-raw뿐(br·zstd 없음)
export function decompressPlan(encodings) {
  if (!encodings.length) return { format: null, reason: 'none' };
  if (encodings.length > 1) return { format: null, reason: 'layered' };
  const e = encodings[0];
  if (e === 'gzip' || e === 'x-gzip') return { format: 'gzip' };
  if (e === 'deflate') return { format: 'deflate' };
  return { format: null, reason: 'unsupported' };
}

// B-5, P5·P7: 조각마다 읽고 합계가 max를 넘으면 그 자리에서 멈춘다(Response.arrayBuffer()는 중간에 멈출 수 없다).
// 오류(잘림·찌꺼기·형식 아님)는 throw하지 않고 그때까지 나온 앞부분과 error: true
async function inflateOnce(bytes, format, max) {
  const chunks = [];
  let n = 0;
  let limitHit = false;
  let error = false;
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (n + value.length > max) {
        chunks.push(value.subarray(0, max - n));
        n = max;
        limitHit = true;
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      n += value.length;
    }
  } catch {
    error = true;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { bytes: out, limitHit, error };
}
// deflate 라벨에 zlib 머리 없는(raw) 본문을 보내는 서버가 있다(Q2, P9): 아무것도 못 풀었으면 deflate-raw로 한 번만 더
export async function inflate(bytes, format, max = 10 * 1024 * 1024) {
  if (!bytes.length) return { bytes: new Uint8Array(0), limitHit: false, error: false };
  const first = await inflateOnce(bytes, format, max);
  if (format === 'deflate' && first.error && first.bytes.length === 0) {
    const raw = await inflateOnce(bytes, 'deflate-raw', max);
    if (!raw.error || raw.bytes.length) return raw;
  }
  return first;
}

// B-6, P13·P15: 저장 이름은 기록과 무관하게 고정. 확장자 .bin(기록 형식에 따라 .htm·.svg가 붙지 않게)
export function downloadName(id, part) {
  return Number.isSafeInteger(id) && id >= 0 && (part === 'request' || part === 'response') ? `sumun-${id}-${part}.bin` : 'sumun-body.bin';
}
