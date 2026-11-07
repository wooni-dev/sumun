// [INFRA-3] 회귀 테스트: 오탐을 고친 뒤에도 "진짜 파일 쓰기"는 계속 막아야 한다.
// 수정 전에도 통과하는 게 정상이므로 test:red 대상이 아니다(새 동작 테스트와 파일을 나눈 이유).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, guardDecision } from './_hook-fixture.mjs';

let fx;
before(() => (fx = makeRepo()));
after(() => fx.cleanup());

test('heredoc으로 테스트 파일을 덮어쓰는 것(cat > test/... <<EOF)은 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'Bash', `cat > test/a.test.ts <<'EOF'\nx\nEOF`), 'deny');
});

test('heredoc 표식 뒤에 리다이렉트가 오는 것(cat <<EOF > test/...)도 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'Bash', `cat <<'EOF' > test/a.test.ts\nx\nEOF`), 'deny');
});

test('here-string을 테스트 파일로 보내는 것(Set-Content)도 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'PowerShell', `@'\nx\n'@ | Set-Content test\\a.test.ts`), 'deny');
});

test('메시지가 아닌 일반 리다이렉트(echo > test/...)는 계속 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'Bash', 'echo x > test/a.test.ts'), 'deny');
});

test('-m 메시지가 있어도 같은 명령의 진짜 쓰기(> test/...)는 막는다', () => {
  assert.equal(guardDecision(fx.repo, 'Bash', 'git commit -m "msg" && echo x > test/a.test.ts'), 'deny');
});
