// [INFRA-10] 회귀: 구현 전에도 통과해야 정상인 판정(O9). 허용 조건이 하나라도 빠지면 위반, 판정 요구가 적용되지 않는 옛 작업은 지금처럼, 탐색이어도 기록이 없으면 위반
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../scripts/check-method.mjs';

const { checkCommits } = mod;
const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));
const PLAN = c('p0', '[PRX-9] 계획: 무엇', ['docs/ai/progress.md']);
const TEST = c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']);
const IMPL = c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']);
const DOCS = c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']);
const run = (extra = {}, commits = [PLAN, TEST, IMPL, DOCS]) => byRule(checkCommits({ id: 'PRX-9', commits, docExists: true, ...extra }));

test('O40 회귀: 제목에 "(사용자 허용"이 있어도 progress.md에 그 해시와 "허용" 기록이 없으면 위반', () => {
  const e5 = c('e5', '[PRX-9] 테스트 수정(사용자 허용): 도우미', ['test/prx/PRX-9.test.ts']);
  const commits = [PLAN, TEST, IMPL, e5, DOCS];
  assert.equal(run({ laterCommits: commits.slice(2), progressText: '- e5에서 고침\n' }, commits)['test-unchanged'].ok, false);
});
test('O40 회귀: progress.md에 "허용" 기록이 있어도 제목에 "(사용자 허용"이 없으면 위반', () => {
  const e5 = c('e5', '[PRX-9] 테스트 고침: 도우미', ['test/prx/PRX-9.test.ts']);
  const commits = [PLAN, TEST, IMPL, e5, DOCS];
  assert.equal(run({ laterCommits: commits.slice(2), progressText: '- "테스트 수정 허용" 뒤 e5\n' }, commits)['test-unchanged'].ok, false);
});
test('O40 회귀: 허용된 수정과 허용되지 않은 수정이 섞이면 위반', () => {
  const e5 = c('e5', '[PRX-9] 테스트 수정(사용자 허용): 도우미', ['test/prx/PRX-9.test.ts']);
  const e6 = c('e6', '[PRX-9] server.ts: 또', ['src/proxy/server.ts', 'test/prx/PRX-9.test.ts']);
  const commits = [PLAN, TEST, IMPL, e5, e6, DOCS];
  assert.equal(run({ laterCommits: commits.slice(2), progressText: '- "테스트 수정 허용" 뒤 e5\n' }, commits)['test-unchanged'].ok, false);
});
test('회귀: 테스트 파일을 아무도 바꾸지 않으면 test-unchanged 통과', () => {
  assert.equal(run({ laterCommits: [IMPL, DOCS], progressText: '' })['test-unchanged'].ok, true);
});

const SECTION = (preds, measured) => `### [PRX-9] 계획\n- 예상 [추측]:\n${preds}\n- 실측 (명령 원문):\n${measured}\n`;
test('O46 회귀: 판정 요구가 적용되지 않는 옛 작업은 판정 없는 기록도 통과(지금처럼)', () => {
  const r = run({ verdictRuleApplies: false, progressSection: SECTION('  - E1: 무엇', '  - E1: `node x` → 기록') });
  assert.equal(r['predictions-measured'].ok, true, r['predictions-measured'].detail);
});
test('O46 회귀: [탐색] 예상이라도 실측 기록이 전혀 없으면 위반', () => {
  const r = run({ verdictRuleApplies: true, progressSection: SECTION('  - E1 [탐색]: 무엇이 나오는지', '  - (아직 없음)') });
  assert.equal(r['predictions-measured'].ok, false, r['predictions-measured'].detail);
});
test('O46 회귀: 판정 요구가 적용돼도 "일치"·"불일치"가 있으면 통과', () => {
  const r = run({ verdictRuleApplies: true, progressSection: SECTION('  - E1: 무엇\n  - E2: 무엇', '  - E1 일치: → 1\n  - E2 불일치: → 2(원인 기록)') });
  assert.equal(r['predictions-measured'].ok, true, r['predictions-measured'].detail);
});
