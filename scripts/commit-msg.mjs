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

// [INFRA-13] O54 규칙 D: 커밋 제목의 [ID]가 지금 브랜치에 맞는지. 사례·결정: docs/ai/infra13-cases.md
//   branch = 브랜치 이름(refs/heads/ 뒤), detached HEAD면 null. 대소문자를 구별한다(Q3)
const ID = '[A-Za-z0-9][A-Za-z0-9-]*';
const FEAT_RE = new RegExp(`^feat/(${ID})$`);
const TITLE_ID_RE = /^\[([^\]]*)\]/;
// main 허용 목록(Q4): 큰 단위 기록, 세션 기록, 첫 커밋, 보고서, 병합(충돌 뒤 마무리), 병합 뒤 기록(O50)
const MAIN_OK_RE = [new RegExp(`^\\[(AUDIT-\\d+|SESSION|INIT|REPORT-${ID})\\] \\S`), new RegExp(`^\\[${ID}\\] 병합( 뒤 기록)?: \\S`)];
// 다른 노드의 테스트를 사용자 허용으로 고친 커밋(F2, Q2) — 허용 상태가 켜져 있을 때만
const TEST_FIX_RE = new RegExp(`^\\[${ID}\\] 테스트 수정\\(사용자 허용`);

export function branchProblems({ branch, title, unlocked = false }) {
  const t = String(title ?? '');
  if (!branch) return ['detached HEAD(브랜치 없음, 리베이스 중 포함)에서는 커밋하지 않습니다(규칙 D, INFRA-13). 브랜치로 돌아가서 커밋하세요.'];
  if (branch === 'main') {
    if (MAIN_OK_RE.some((re) => re.test(t))) return [];
    return [`main의 커밋 제목은 [AUDIT-n]·[SESSION]·[REPORT-…]·"[ID] 병합: …"·"[ID] 병합 뒤 기록: …"만 됩니다(규칙 D, INFRA-13). 제목: ${t}`];
  }
  const m = branch.match(FEAT_RE);
  if (m) {
    const id = t.match(TITLE_ID_RE)?.[1];
    if (id === m[1] || id === 'RULE') return [];
    if (unlocked && TEST_FIX_RE.test(t)) return [];
    return [`지금 브랜치 ${branch}의 커밋 제목은 [${m[1]}](또는 [RULE])로 시작해야 합니다(규칙 D, INFRA-13). 제목: ${t} — 옛 메시지 파일이 아닌지 확인하세요(O54).`];
  }
  if (branch.toLowerCase().startsWith('feat')) return [`브랜치 이름 ${branch}이 feat/<노드ID>(ASCII, 한 마디) 모양이 아닙니다(규칙 D, INFRA-13). 새 작업은 새 노드 ID의 feat/<ID> 브랜치에서 하세요.`];
  return []; // 그 밖의 브랜치(probe/… 등)는 보지 않는다(F9, 한계 L11)
}

// main에서 feat/<ID>를 병합할 때 메시지 제목(Q5). title = 메시지 첫 줄, 메시지가 없으면 null
export function mergeProblems({ branch, target, title }) {
  if (branch !== 'main' || !target) return [];
  const m = target.match(FEAT_RE);
  if (!m) return target.toLowerCase().startsWith('feat') ? [`병합 대상 ${target}이 feat/<노드ID> 모양이 아닙니다(규칙 D, INFRA-13).`] : [];
  if (new RegExp(`^\\[${m[1]}\\] 병합: \\S`).test(String(title ?? ''))) return [];
  return [`${target} 병합 메시지 제목은 "[${m[1]}] 병합: …"이어야 합니다(규칙 D, INFRA-13). -F "<절대 경로>"로 메시지를 주세요. 제목: ${title ?? '(메시지 없음)'}`];
}
