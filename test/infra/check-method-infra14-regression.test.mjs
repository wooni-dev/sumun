// [INFRA-14] O58 회귀 — 구현 전에도 통과해야 정상(O9): 제목 번호 대조가 기존 판정을 바꾸지 않는 경우
//   제목 번호를 모두 읽음 → ✅ / 제목에 "예상"이 없음 → ✅ / 계획 커밋이 없음 → 대조하지 않음 / [탐색] 번호도 읽은 것으로 침
//   계획 절에만 있고 제목에 없는 추가 예상은 경고하지 않음 / 판정 없는 ❌ 그대로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const REST = [
  c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']),
  c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']),
  c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']),
];
const plan = (subject) => [c('p0', subject, ['docs/ai/progress.md']), ...REST];
const section = (preds, measured) =>
  ['### [PRX-9] 계획', '- 예상 [추측]:', ...preds.map((e) => `  - ${e}: 무엇`), '- 실측 (명령 원문):', ...measured].join('\n');
const rule = (commits, sec) => {
  const r = checkCommits({ id: 'PRX-9', commits, docExists: true, progressSection: sec, verdictRuleApplies: true }).find((x) => x.rule === 'predictions-measured');
  assert.ok(r, 'predictions-measured 규칙이 결과에 있어야 함');
  return r;
};

test('O58 회귀: 제목 E1~E3을 모두 읽고 판정이 있으면 ✅', () => {
  const r = rule(plan('[PRX-9] 계획: 무엇, 예상 E1~E3'), section(['E1', 'E2', 'E3'], ['  - E1 일치', '  - E2 일치', '  - E3 불일치']));
  assert.equal(r.ok, true, r.detail);
});

test('O58 회귀: [탐색] 예상도 읽은 번호로 친다', () => {
  const r = rule(plan('[PRX-9] 계획: 무엇, 예상 E1~E2'), section(['E1', 'E2 [탐색]'], ['  - E1 일치', '  - E2 [탐색] 기록']));
  assert.equal(r.ok, true, r.detail);
});

test('O58 회귀: 제목에 "예상"이 없으면 ✅ 그대로', () => {
  const r = rule(plan('[PRX-9] 계획: 무엇'), section(['E1'], ['  - E1 일치']));
  assert.equal(r.ok, true, r.detail);
});

test('O58 회귀: 계획 절에만 있는 추가 예상(제목에 없음)은 경고하지 않는다', () => {
  const r = rule(plan('[PRX-9] 계획: 무엇, 예상 E1~E2'), section(['E1', 'E2', 'E3'], ['  - E1 일치', '  - E2 일치', '  - E3 일치']));
  assert.equal(r.ok, true, r.detail);
});

test('O58 회귀: 계획 커밋이 없으면 제목 대조를 하지 않는다', () => {
  const commits = [c('a1', '[PRX-9] 테스트: 예상 E1~E5', ['test/prx/PRX-9.test.ts']), ...REST.slice(1)];
  const r = rule(commits, section(['E1'], ['  - E1 일치']));
  assert.equal(r.ok, true, r.detail);
});

test('O58 회귀: 판정이 없는 실측은 ❌ 그대로', () => {
  const r = rule(plan('[PRX-9] 계획: 무엇, 예상 E1'), section(['E1'], ['  - E1 결과만']));
  assert.equal(r.ok, false, r.detail);
  assert.match(r.detail, /판정/);
});
