// [INFRA-5] PostToolUse hook: 셸 명령을 실행한 "뒤에" 결과를 확인한다.
//
// guard.mjs(실행 전)는 명령 문자열의 모양으로 판단해서, 셸 문법을 다 알 수 없는 한계가 있다(docs/ai/guard-bypass-cases.md).
// 그래서 마지막 판단은 "실제로 무엇이 바뀌었나"로 한다. 결과는 git이 정확히 알려 준다.
//
//   잠금 상태에서 커밋된 test/ 파일이 HEAD와 다르면 → HEAD 내용으로 복구 + Claude에게 차단 사유 전달
//
// 복구해도 잃는 것은 없다. 원본이 HEAD에 있고, 잠금 상태에서 바꾼 것은 그 자체로 규칙 위반이기 때문이다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
fs.readFileSync(0, 'utf8'); // 입력은 쓰지 않는다. 명령이 무엇이었든 결과만 본다.

const git = (...a) => execFileSync('git', ['-C', projectDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function unlocked() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'state', 'tests-unlocked.json'), 'utf8'));
    return (s.until ?? 0) > Date.now();
  } catch {
    return false;
  }
}

if (unlocked()) process.exit(0);

let changed;
try {
  // HEAD와 다른 커밋된 test/ 파일 (수정, 삭제, staged 여부 상관없이). 커밋되지 않은 새 파일은 나오지 않는다.
  changed = git('diff', 'HEAD', '--name-only', '--', 'test/').split('\n').filter(Boolean);
} catch {
  process.exit(0); // HEAD가 없는 저장소 등
}
if (!changed.length) process.exit(0);

// 커밋된 내용을 바이트 그대로 되돌린다. Windows의 core.autocrlf가 켜져 있으면 LF가 CRLF로 바뀌어 원본과 달라지므로 끈다 [확인됨: INFRA-5 실측]
// checkout은 작업 트리와 index(staged)를 모두 되돌린다. staged된 변조가 다음 커밋에 섞이지 않게 하기 위해서다.
git('-c', 'core.autocrlf=false', 'checkout', 'HEAD', '--', ...changed);

const reason =
  `[실행 후 검사] 커밋된 테스트 파일이 바뀌어서 HEAD 내용으로 되돌렸습니다: ${changed.join(', ')}. ` +
  '개발 중에는 테스트를 고쳐서 통과시키지 않습니다. 테스트가 틀렸다고 판단되면 멈추고 이유를 사용자에게 보고하세요. ' +
  '사용자가 "테스트 수정 허용"이라고 입력하면 30분간 풀립니다.';
process.stdout.write(JSON.stringify({ decision: 'block', reason, systemMessage: `⚠ 테스트 파일 변경을 되돌림: ${changed.join(', ')}` }));
