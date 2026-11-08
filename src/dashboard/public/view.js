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
