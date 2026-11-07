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
const TEST_PATH_RE = /(^|[\s"'=:(\\/])test[\\/]/i;
const STATE_PATH_RE = /\.claude[\\/]state/i;
const TEST_RUN_RE = /\bnpm\s+(run\s+)?test\b|\bnode\s+--test\b|scripts[\\/]test\.mjs/i;
const PROGRESS = 'docs/ai/progress.md';

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
  const cleaned = stripData(cmd).replace(/\d*>&\d/g, '').replace(/\d*>\s*(\/dev\/null|\$null|NUL)\b/gi, '');
  const writes = WRITE_RE.test(cleaned);
  if (writes && STATE_PATH_RE.test(cleaned)) deny(MSG_STATE);
  if (streakHit.length && TEST_RUN_RE.test(cmd)) deny(msgStreak());
  if (writes && TEST_PATH_RE.test(cleaned) && !unlocked()) deny(MSG_TEST);
}

// [INFRA-3] 명령 안의 "데이터"를 지운다. 데이터 안의 '>'나 경로는 파일 쓰기가 아니다.
// (예: 커밋 메시지의 "<noreply@anthropic.com>"를 리다이렉트로 오해하던 오탐)
// 명령 줄 자체는 남기므로 `cat > test/x <<EOF`, `cat <<EOF > test/x` 같은 진짜 쓰기는 그대로 잡힌다.
function stripData(s) {
  return (
    s
      // bash heredoc: <<'EOF' 표식 줄의 나머지(리다이렉트 등)는 남기고 본문만 지운다
      .replace(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '<<$2$3')
      // PowerShell here-string: @' ... '@ / @" ... "@
      .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, '@HERE@')
      // git commit/merge/tag 의 -m "..." / --message='...'
      .replace(/(^|\s)(-m|--message)(\s+|=)("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1$2 MSG')
  );
}
