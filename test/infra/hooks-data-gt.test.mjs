// [INFRA-3] 새 동작: 명령 안의 "데이터"(커밋 메시지, heredoc 본문, here-string)에 있는 '>'는 파일 쓰기가 아니다.
// 수정 전 guard.mjs는 이 명령들을 모두 "테스트 파일 수정"으로 차단했다(2026-11-07 실제 발생).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, guardDecision } from './_hook-fixture.mjs';

let fx;
before(() => (fx = makeRepo()));
after(() => fx.cleanup());

const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

test('heredoc 커밋 메시지에 test/ 경로와 <메일>이 있어도 허용한다', () => {
  const cmd = `git add test/a.test.ts && git commit -q -F - <<'EOF'\n[X] 테스트 추가\n\n- 검증: npm run test:red -- test/a.test.ts → 실패\n\n${TRAILER}\nEOF`;
  assert.equal(guardDecision(fx.repo, 'Bash', cmd), 'allow');
});

test('따옴표 없는 heredoc 표식(<<EOF)도 같다', () => {
  const cmd = `git commit -F - <<EOF\nsee test/a.test.ts\n${TRAILER}\nEOF`;
  assert.equal(guardDecision(fx.repo, 'Bash', cmd), 'allow');
});

test('git commit -m "..." 메시지 안의 > 와 test/ 는 허용한다', () => {
  const cmd = `git add test/a.test.ts && git commit -m "test/a.test.ts 추가" -m "${TRAILER}"`;
  assert.equal(guardDecision(fx.repo, 'Bash', cmd), 'allow');
});

test("PowerShell here-string(@'...'@) 커밋 메시지도 허용한다", () => {
  const cmd = `git add test\\a.test.ts; git commit -F - @'\n[X] test/a.test.ts\n${TRAILER}\n'@`;
  assert.equal(guardDecision(fx.repo, 'PowerShell', cmd), 'allow');
});
