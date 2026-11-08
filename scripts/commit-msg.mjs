// [INFRA-11] O47 커밋 메시지 형식 검사(규칙 C). 실행 전 hook(guard.mjs)과 실행 뒤 hook(commit-check.mjs)이 같은 함수를 쓴다.
//   형식(CLAUDE.md "커밋 메시지 형식"):  [노드ID] 한 줄 / 빈 줄 / "- 왜: …" / "- 검증: …"
//   사례와 기본 답: docs/ai/infra11-cases.md. 정규화(NFC)·디코딩 추측을 하지 않는다 — git에 들어가는 바이트 그대로 본다(사례 37~40, 44)
// check-method의 message-format 규칙은 이것보다 느슨하다(옛 커밋 판정을 바꾸지 않으려고 그대로 둔다).

const TITLE_RE = /^\[[A-Za-z0-9][A-Za-z0-9-]*\] \S/;
const WHY_RE = /^- 왜: \S/;
const CHECK_RE = /^- 검증: \S/;

// 문제 문구 배열을 돌려준다. 빈 배열이면 통과
export function messageProblems(input) {
  let text;
  if (Buffer.isBuffer(input)) {
    if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) return ['메시지 맨 앞에 BOM이 있습니다. BOM 없는 UTF-8로 쓰세요.'];
    if (input.includes(0)) return ['메시지에 NUL 바이트가 있습니다(UTF-16 등). BOM 없는 UTF-8로 쓰세요.'];
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      return ['메시지가 올바른 UTF-8이 아닙니다(CP949 등). BOM 없는 UTF-8로 쓰세요.'];
    }
  } else text = String(input ?? '');

  if (text.startsWith('﻿')) return ['메시지 맨 앞에 BOM이 있습니다. BOM 없는 UTF-8로 쓰세요.'];
  if (/\r(?!\n)/.test(text)) return ['줄바꿈이 \\r만 있는 곳이 있습니다. LF(또는 CRLF)로 쓰세요.'];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  const out = [];
  if (!TITLE_RE.test(lines[0])) out.push('첫 줄은 "[노드ID] 무엇을 했는지 한 줄" 형식이어야 합니다.');
  if (lines.length < 2 || lines[1] !== '') out.push('제목 다음 줄은 빈 줄이어야 합니다(아니면 git이 첫 문단 전체를 제목으로 봅니다).');
  const rest = lines.slice(2);
  const need = [
    ['- 왜:', WHY_RE, /^- 왜/],
    ['- 검증:', CHECK_RE, /^- 검증/],
  ];
  for (const [label, re, near] of need) {
    if (rest.some((l) => re.test(l))) continue;
    if (rest.some((l) => near.test(l))) out.push(`"${label}" 줄은 줄 맨 앞에 글자 그대로 쓰고 콜론 뒤에 한 칸 띄어 내용을 씁니다. "- 검증(…):"처럼 콜론 앞에 글자를 넣지 마세요.`);
    else out.push(`"${label} …" 줄이 없습니다(줄 맨 앞에 글자 그대로).`);
  }
  return out;
}
