// [INFRA-4] 계획 커밋(O3) 인식: PR 첫 커밋이 "계획:"이면 그다음 커밋을 테스트 커밋으로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));

const PLAN = c('p0', '[PRX-1] 계획: 요청 중계', ['docs/ai/progress.md']);
const TEST = c('a1', '[PRX-1] 테스트: 요청 중계', ['test/PRX-1.test.ts']);
const IMPL = c('b2', '[PRX-1] 프록시 서버', ['src/proxy/server.ts']);
const DOCS = c('c3', '[PRX-1] 문서', ['docs/for-me/PRX-1.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']);

test('계획 커밋이 먼저 있으면 plan-first ok', () => {
  const r = byRule(checkCommits({ id: 'PRX-1', commits: [PLAN, TEST, IMPL, DOCS], docExists: true }));
  assert.equal(r['plan-first']?.ok, true);
});

test('계획 커밋 다음이 테스트 커밋이면 test-first ok', () => {
  const r = byRule(checkCommits({ id: 'PRX-1', commits: [PLAN, TEST, IMPL, DOCS], docExists: true }));
  assert.equal(r['test-first'].ok, true, r['test-first'].detail);
});

test('계획 커밋이 없으면 plan-first는 위반으로 알려 준다', () => {
  const r = byRule(checkCommits({ id: 'PRX-1', commits: [TEST, IMPL, DOCS], docExists: true }));
  assert.equal(r['plan-first']?.ok, false);
});

test('"계획:"이라도 docs/ 밖 파일을 바꾸면 계획 커밋이 아니다', () => {
  const fake = c('p0', '[PRX-1] 계획: 요청 중계', ['docs/ai/progress.md', 'src/proxy/server.ts']);
  const r = byRule(checkCommits({ id: 'PRX-1', commits: [fake, TEST, IMPL, DOCS], docExists: true }));
  assert.equal(r['plan-first']?.ok, false);
  assert.equal(r['test-first'].ok, false);
});
