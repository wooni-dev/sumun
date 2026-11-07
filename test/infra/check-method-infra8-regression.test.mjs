// [INFRA-8] 회귀: O35(실측 커밋 건너뛰기)를 넣어도 지켜야 하고, 지금도 성립하는 것. red 대상이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));
const PLAN = c('p0', '[PRX-9] 계획: 무엇', ['docs/ai/progress.md']);
const TEST = c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']);
const IMPL = c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']);
const DOCS = c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']);
const run = (extra = {}, commits = [PLAN, TEST, IMPL, DOCS]) => byRule(checkCommits({ id: 'PRX-9', commits, docExists: true, ...extra }));

test('O35: "실측:"이라도 scripts/probe/ 밖을 바꾸면 건너뛰지 않는다', () => {
  const bad = c('m1', '[PRX-9] 실측: 구현 전 동작', ['scripts/probe/prx9.mjs', 'src/proxy/server.ts']);
  const r = run({}, [PLAN, bad, TEST, IMPL, DOCS]);
  assert.equal(r['test-first'].ok, false);
  assert.match(r['test-first'].detail, /m1/);
});

