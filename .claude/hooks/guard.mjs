// [INFRA-1] PreToolUse hook: Claude가 도구를 쓰기 직전에 실행된다.
// 지침(CLAUDE.md)은 권고일 뿐이라, 반드시 지켜야 할 규칙은 여기서 기계적으로 막는다(개발 방식 7~9행, 27행).
//
//  1. 커밋된 테스트 파일 수정 금지  — 사용자가 "테스트 수정 허용"이라고 입력하면 30분간 해제
//  2. hook 상태 폴더(.claude/state/) 쓰기 금지 — 항상
//  3. 같은 테스트가 3회 연속 실패하면 멈춤 — 진행 기록 작성과 읽기 명령만 허용, 사용자가 답하면 초기화
//
// 판정: 막을 때만 JSON을 출력한다. 아무것도 출력하지 않으면 허용이다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stopped, STOP_AFTER } from '../../scripts/streak.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = path.join(projectDir, '.claude', 'state');

const WRITE_RE =
  /(>|\btee\b|\bsed\b[^|]*\s-i|\brm\b|\bmv\b|\bcp\b|\bdel\b|\btouch\b|\btruncate\b|Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item|\bgit\s+(checkout|restore|reset|rm|mv|stash|apply)\b|writeFile|appendFile|unlink|rmSync|\[IO\.File\])/i;
// [INFRA-5] 앞 글자에 > , { 추가: `echo x >test/...`, `Remove-Item x,test/...`, `rm {test,x}/...` (우회 사례 26, 29)
const TEST_PATH_RE = /(^|[\s"'=:(\\/>,{])test[\\/]/i;
const STATE_PATH_RE = /\.claude[\\/]state/i;
const TEST_RUN_RE = /\bnpm\s+(run\s+)?test\b|\bnode\s+--test\b|scripts[\\/]test\.mjs/i;
const PROGRESS = 'docs/ai/progress.md';
// [INFRA-5] heredoc을 소비하는 실행기 / 셸 확장 (stripData에서 사용)
const CONSUMER_RE =
  /\b(bash|sh|zsh|dash|ksh|fish|node|deno|bun|tsx|python[\d.]*|py|perl|ruby|php|pwsh|powershell|cmd|xargs|read|source|eval|exec|iex|Invoke-Expression)\b|(^|[;&|]\s*)\.\s/i;
const EXPANDS_RE = /\$\(|`/;

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { tool_name: tool, tool_input: ti = {} } = input;

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

const readJson = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
  } catch {
    return null;
  }
};

const rel = (p) => path.relative(projectDir, path.resolve(projectDir, p)).replaceAll('\\', '/');
const unlocked = () => (readJson('tests-unlocked.json')?.until ?? 0) > Date.now();
const streakHit = stopped(readJson('test-streak.json')?.counts ?? {});

function isCommittedTest(r) {
  if (!r.startsWith('test/')) return false;
  try {
    execFileSync('git', ['-C', projectDir, 'cat-file', '-e', `HEAD:${r}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const MSG_TEST =
  '커밋된 테스트 파일은 수정할 수 없습니다(개발 방식: 개발 중 테스트를 고쳐서 통과시키지 않는다). 테스트가 틀렸다고 판단되면 멈추고, 이유를 사용자에게 보고하세요. 사용자가 "테스트 수정 허용"이라고 입력하면 30분간 풀립니다.';
const MSG_STATE = 'hook 상태 폴더(.claude/state/)는 프로그램과 사용자 입력으로만 바뀝니다. Claude는 직접 쓸 수 없습니다.';
const msgStreak = () =>
  `같은 테스트가 ${STOP_AFTER}회 연속 실패해서 멈춘 상태입니다: ${streakHit.map(([k, n]) => `${k}(${n}회)`).join(', ')}. ` +
  `코드 수정과 테스트 재실행은 막혀 있습니다. 시도한 것과 막힌 이유를 ${PROGRESS}에 기록하고 사용자에게 보고하세요. 사용자가 답하면 초기화됩니다.`;

if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const r = rel(ti.file_path ?? ti.notebook_path ?? '');
  if (r.startsWith('.claude/state/')) deny(MSG_STATE);
  if (streakHit.length && r !== PROGRESS) deny(msgStreak());
  if (isCommittedTest(r) && !unlocked()) deny(MSG_TEST);
} else if (['Bash', 'PowerShell'].includes(tool)) {
  const cmd = String(ti.command ?? '');
  // 2>&1, >/dev/null 같은 출력 정리는 파일 쓰기가 아니므로 빼고 판단한다
  // [INFRA-5] `>&1/../test/x`처럼 숫자 뒤에 경로가 이어지면 파일 쓰기라서 지우지 않는다 (우회 사례 24)
  const cleaned = stripData(cmd, tool)
    .replace(/\d*>&\d(?![\w./\\-])/g, '')
    .replace(/\d*>\s*(\/dev\/null|\$null|NUL)\b/gi, '');
  const writes = WRITE_RE.test(cleaned);
  if (writes && STATE_PATH_RE.test(cleaned)) deny(MSG_STATE);
  if (streakHit.length && TEST_RUN_RE.test(cmd)) deny(msgStreak());
  if (writes && TEST_PATH_RE.test(cleaned) && !unlocked()) deny(MSG_TEST);
}

// [INFRA-3 → INFRA-5] 명령 안의 "데이터"를 지운다. 데이터 안의 '>'나 경로는 파일 쓰기가 아니다.
// (예: 커밋 메시지의 "<noreply@anthropic.com>"를 리다이렉트로 오해하던 오탐)
//
// INFRA-5: 데이터인지 "실행될 코드"인지 확실하지 않으면 지우지 않는다(지우지 않으면 검사 대상으로 남을 뿐이다).
//  - heredoc 본문을 셸이나 인터프리터가 소비하면 코드다 (bash <<EOF, node <<EOF, xargs, while read …)
//  - 따옴표 없는 heredoc이나 큰따옴표 안의 $( ), 백틱은 실행된다
//  - here-string을 파이프로 넘기거나 iex로 실행하면 코드다
// 이 검사로 못 막는 우회는 실행 후 검사(verify-tests.mjs)가 결과로 잡는다.
// (CONSUMER_RE, EXPANDS_RE는 파일 위쪽에 선언. 아래에 두면 초기화 전에 쓰여 오류가 난다)
function stripData(s, tool) {
  const lineBefore = (str, offset) => str.slice(str.lastIndexOf('\n', offset - 1) + 1, offset);

  if (tool === 'Bash') {
    // heredoc: <<'EOF' 표식 줄의 나머지(리다이렉트 등)는 남기고 본문만 지운다. <<<(here-string)는 heredoc이 아니다.
    s = s.replace(/(^|[^<])<<-?(?!<)[ \t]*(['"]?)([A-Za-z_]\w*)\2([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g, (m, pre, q, tag, rest, body, offset) => {
      const line = lineBefore(s, offset) + pre + rest;
      if (CONSUMER_RE.test(line)) return m;
      if (!q && EXPANDS_RE.test(body)) return m;
      return `${pre}<<${tag}${rest}`;
    });
  }

  if (tool === 'PowerShell') {
    // here-string: @' ... '@ / @" ... "@
    s = s.replace(/@(['"])\r?\n([\s\S]*?)\r?\n\1@([^\n]*)/g, (m, q, body, rest, offset) => {
      const prefix = lineBefore(s, offset);
      if (rest.includes('|') || /\b(iex|Invoke-Expression|pwsh|powershell)\b|[&.]\s*$/i.test(prefix)) return m;
      if (q === '"' && /\$\(/.test(body)) return m;
      return `@HERE@${rest}`;
    });
  }

  // -m "..." / --message='...' 는 git commit/tag/merge의 메시지일 때만 데이터다 (git checkout -m 은 플래그라서 아님)
  if (/\bgit\s+(commit|tag|merge)\b/i.test(s)) {
    // PowerShell에서는 \" 가 이스케이프가 아니다 (우회 사례 14)
    const quoted = tool === 'PowerShell' ? `"[^"]*"|'[^']*'` : `"(?:[^"\\\\]|\\\\.)*"|'[^']*'`;
    s = s.replace(new RegExp(`(^|\\s)(-m|--message)(\\s+|=)(${quoted})`, 'g'), (m, pre, flag, sep, arg) =>
      arg.startsWith('"') && EXPANDS_RE.test(arg) ? m : `${pre}${flag} MSG`,
    );
  }
  return s;
}
