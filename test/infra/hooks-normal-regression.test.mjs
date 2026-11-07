// [INFRA-5] 회귀: 실행 전 검사를 강화해도 정상 명령은 계속 허용해야 한다(오탐 금지). red 대상 아님.
// 출처: docs/ai/guard-bypass-cases.md "계속 허용해야 하는 정상 명령"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, guardDecision } from './_hook-fixture.mjs';

let fx;
before(() => (fx = makeRepo()));
after(() => fx.cleanup());

const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const ALLOW = [
  ['Claude Code 표준 커밋', 'Bash', `git commit -m "$(cat <<'EOF'\nfix: handle a > b in test/a.test.ts\n\n${TRAILER}\nEOF\n)"`],
  ['-m 메시지 속 > 와 경로', 'Bash', 'git commit -m "test: a > b 비교 수정 (test/a.test.ts)"'],
  ['PowerShell here-string 커밋', 'PowerShell', `git commit -m @'\nfix: x > y in test/a.test.ts\n\n${TRAILER}\n'@`],
  ['진행 기록 heredoc 작성', 'Bash', "cat <<'EOF' > docs/ai/progress.md\ntest/a.test.ts 3회 실패, 원인: a > b\nEOF"],
  ['gh pr 본문', 'Bash', `gh pr create --title "x" --body "$(cat <<'EOF'\n- test/a.test.ts 추가\n- a > b 처리\nEOF\n)"`],
  ['테스트 실행 출력 정리', 'Bash', 'node --test test/a.test.ts 2>&1'],
  ['출력 버리기', 'Bash', 'npm test > /dev/null 2>&1'],
  ['테스트 읽기', 'Bash', 'git diff HEAD -- test/a.test.ts'],
  ['브랜치 만들기', 'Bash', 'git checkout -b feature/x'],
  ['태그 메시지 속 <메일>', 'Bash', "git tag -a v1 -m 'release <x@y>'"],
];

for (const [name, tool, cmd] of ALLOW) {
  test(`정상 명령 허용: ${name}`, () => {
    assert.equal(guardDecision(fx.repo, tool, cmd), 'allow', JSON.stringify(cmd));
  });
}

test('heredoc으로 상태 폴더에 쓰는 것은 계속 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'Bash', 'cat <<EOF > .claude/state/x.json\n{}\nEOF'), 'deny');
});
