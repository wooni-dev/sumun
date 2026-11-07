// [INFRA-6] O12: 사용자 문서의 "먼저 볼 코드"에 `파일:줄`이 있는지 / O14: 규칙 도입 전 작업의 plan-first는 ➖(null)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));
const COMMITS = [
  c('a1', '[PRX-1] 테스트: 요청 중계', ['test/PRX-1.test.ts']),
  c('b2', '[PRX-1] 문서', ['docs/for-me/PRX-1.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']),
];
const run = (extra) => byRule(checkCommits({ id: 'PRX-1', commits: COMMITS, docExists: true, ...extra }));

test('"먼저 볼 코드"에 `파일:줄`이 있으면 user-doc-lines ok', () => {
  const docText = '# x\n\n## 먼저 볼 코드\n- `src/proxy/server.ts:12` — 127.0.0.1에만 연다\n\n## 파일별 변경\n';
  assert.equal(run({ docText })['user-doc-lines']?.ok, true);
});

test('"먼저 볼 코드"에 줄 번호 없이 이름만 있으면 user-doc-lines 위반', () => {
  const docText = '# x\n\n## 먼저 볼 코드\n- `src/proxy/server.ts`의 `listen()` — 설명\n\n## 파일별 변경\n- `a.ts:3` 은 다른 절이라 인정하지 않음\n';
  assert.equal(run({ docText })['user-doc-lines']?.ok, false);
});

test('"먼저 볼 코드" 절이 없으면 user-doc-lines 위반', () => {
  assert.equal(run({ docText: '# x\n\n## 작업 흐름\n1. a\n' })['user-doc-lines']?.ok, false);
});

test('문서 본문을 넘기지 않으면 user-doc-lines는 건너뛴다(null)', () => {
  const r = run({});
  assert.ok('user-doc-lines' in r, 'user-doc-lines 규칙이 결과에 있어야 함');
  assert.equal(r['user-doc-lines'].ok, null);
});

test('계획 커밋 규칙이 생기기 전 작업이면 plan-first는 건너뛴다(null)', () => {
  assert.equal(run({ planRuleApplies: false })['plan-first'].ok, null);
});
