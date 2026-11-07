// [INFRA-1] UserPromptSubmit hook: 사용자가 메시지를 보낼 때 실행된다.
// Claude의 도구로는 이 hook을 실행시킬 수 없다. 그래서 "사용자만 할 수 있는 결정"을 여기에 둔다.
//
//  - "테스트 수정 허용" → 커밋된 테스트 수정을 30분간 허용
//  - "테스트 잠금"      → 즉시 다시 잠금
//  - 무엇이든 입력      → 연속 실패 카운터 초기화 (사용자가 보고를 받고 답했다는 뜻)
import fs from 'node:fs';
import path from 'node:path';

const UNLOCK_MINUTES = 30;
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = path.join(projectDir, '.claude', 'state');
const unlockPath = path.join(stateDir, 'tests-unlocked.json');
const streakPath = path.join(stateDir, 'test-streak.json');

const { prompt = '' } = JSON.parse(fs.readFileSync(0, 'utf8'));
const notes = [];
fs.mkdirSync(stateDir, { recursive: true });

if (/테스트\s*수정\s*허용/.test(prompt)) {
  fs.writeFileSync(unlockPath, JSON.stringify({ until: Date.now() + UNLOCK_MINUTES * 60_000 }));
  notes.push(`[hook] 사용자가 커밋된 테스트 수정을 ${UNLOCK_MINUTES}분간 허용했습니다. 수정한 테스트와 이유를 커밋 메시지에 남기세요.`);
} else if (/테스트\s*잠금/.test(prompt)) {
  fs.rmSync(unlockPath, { force: true });
  notes.push('[hook] 테스트 수정이 다시 잠겼습니다.');
}

if (fs.existsSync(streakPath)) {
  const { counts = {} } = JSON.parse(fs.readFileSync(streakPath, 'utf8'));
  if (Object.keys(counts).length) {
    fs.writeFileSync(streakPath, JSON.stringify({ counts: {} }, null, 2));
    notes.push('[hook] 연속 실패 카운터를 초기화했습니다.');
  }
}

if (notes.length) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notes.join('\n') } }));
}
