// [INFRA-8] 승인된 방식 보정의 기계 검사: O22(기준 시점), O24(예상마다 실측), O27(테스트 커밋은 test/만),
// O32(큰 단위 ID), O34(문서의 파일:줄이 실제로 있는가), O35(계획 뒤 실측 커밋 허용)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../scripts/check-method.mjs';

const { checkCommits } = mod;
const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));

const PLAN = c('p0', '[PRX-9] 계획: 무엇', ['docs/ai/progress.md']);
const PROBE = c('m1', '[PRX-9] 실측: 구현 전 동작', ['scripts/probe/prx9.mjs']);
const TEST = c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']);
const IMPL = c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']);
const DOCS = c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']);
const run = (extra = {}, commits = [PLAN, TEST, IMPL, DOCS]) => byRule(checkCommits({ id: 'PRX-9', commits, docExists: true, ...extra }));

// --- O35 ---
test('O35: 계획 뒤의 "실측:" 커밋(scripts/probe/만)은 건너뛰고 그다음을 테스트 커밋으로 본다', () => {
  const r = run({}, [PLAN, PROBE, TEST, IMPL, DOCS]);
  assert.equal(r['test-first'].ok, true, r['test-first'].detail);
});
// --- O27 ---
test('O27: 두 번째 "테스트:" 커밋이 test/ 밖을 바꾸면 test-commits-test-only 위반', () => {
  const t2 = c('a2', '[PRX-9] 테스트: 추가 사례', ['test/prx/PRX-9b.test.ts', 'src/proxy/server.ts']);
  const r = run({}, [PLAN, TEST, IMPL, t2, DOCS]);
  assert.equal(r['test-commits-test-only']?.ok, false);
  assert.match(r['test-commits-test-only'].detail, /a2/);
});
test('O27: "테스트:" 커밋이 모두 test/만 바꾸면 test-commits-test-only 통과', () => {
  const t2 = c('a2', '[PRX-9] 테스트: 추가 사례', ['test/prx/PRX-9b.test.ts']);
  assert.equal(run({}, [PLAN, TEST, IMPL, t2, DOCS])['test-commits-test-only']?.ok, true);
});

// --- O24 ---
const SECTION = (measured) => `### [PRX-9] 계획
- 한 줄 보고: 실측으로 나눈다
- 예상 [추측]:
  - E1: 무엇이 된다
  - E2: 무엇은 안 된다
- 실측 (명령 원문):
${measured}
`;
test('O24: 예상 E번호 중 실측 줄이 없는 것이 있으면 predictions-measured 위반(빠진 번호를 알려 줌)', () => {
  const r = run({ progressSection: SECTION('  - E1 일치: `node x` → 1') });
  assert.equal(r['predictions-measured']?.ok, false);
  assert.match(r['predictions-measured'].detail, /E2/);
});
test('O24: 모든 예상 E번호에 실측 줄이 있으면 통과', () => {
  const r = run({ progressSection: SECTION('  - E1 일치: `node x` → 1\n  - E2 불일치: `node y` → 2') });
  assert.equal(r['predictions-measured']?.ok, true, r['predictions-measured']?.detail);
});
test('O24: 계획 절에 예상 E번호가 없으면 건너뜀(➖)', () => {
  const r = run({ progressSection: '### [PRX-9] 계획\n- 한 줄 보고: 문서만\n' });
  assert.equal(r['predictions-measured']?.ok, null);
});

// --- O34 ---
const DOC = '# [PRX-9]\n\n## 먼저 볼 코드\n- `src/proxy/server.ts:3` — 무엇\n- `src/flow/flow.ts:9` — 무엇\n\n## 다음\n';
test('O34: "먼저 볼 코드"의 파일:줄이 문서 커밋 시점에 없거나 빈 줄이면 user-doc-lines-valid 위반', () => {
  const lines = { 'src/proxy/server.ts': ['a', 'b', 'export function x() {}'], 'src/flow/flow.ts': ['a'] };
  const readLine = (f, n) => lines[f]?.[n - 1];
  const r = run({ docText: DOC, docAtCommit: DOC, readLine });
  assert.equal(r['user-doc-lines-valid']?.ok, false);
  assert.match(r['user-doc-lines-valid'].detail, /flow\.ts:9/);
});
test('O34: 인용한 줄이 모두 실제로 있고 비어 있지 않으면 통과', () => {
  const readLine = () => 'export const X = 1;';
  assert.equal(run({ docText: DOC, docAtCommit: DOC, readLine })['user-doc-lines-valid']?.ok, true);
});
test('O34: 공백만 있는 줄은 빈 줄로 본다', () => {
  const readLine = (f) => (f.endsWith('flow.ts') ? '   ' : 'x');
  assert.equal(run({ docText: DOC, docAtCommit: DOC, readLine })['user-doc-lines-valid']?.ok, false);
});

// --- O22 ---
test('O22: 모든 결과에 기준 시점(basis)이 적혀 있다', () => {
  const rs = checkCommits({ id: 'PRX-9', commits: [PLAN, TEST, IMPL, DOCS], docExists: true, docText: DOC, docAtCommit: DOC, readLine: () => 'x', progressSection: SECTION('  - E1\n  - E2') });
  for (const r of rs) assert.ok(typeof r.basis === 'string' && r.basis.length > 0, `${r.rule}에 basis 없음`);
});

// --- O32 ---
const ok = (rule) => ({ rule, ok: true, detail: '', basis: '작업 커밋' });
const REPORT = '# 보고서\n## 결과 요약\n- 검토 에이전트 확인: 일치 3개, 불일치 0개\n';
test('O32: checkBigUnit이 있다', () => {
  assert.equal(typeof mod.checkBigUnit, 'function');
});
test('O32: 하위 노드가 모두 통과하고, <ID>-T 노드와 검토 결과가 든 보고서가 있으면 큰 단위 규칙 통과', () => {
  assert.equal(typeof mod.checkBigUnit, 'function');
  const subnodes = [{ id: 'PRX-1', results: [ok('test-first')] }, { id: 'PRX-T', results: [ok('test-first')] }];
  const r = byRule(mod.checkBigUnit({ id: 'PRX', subnodes, reportText: REPORT }));
  for (const rule of ['sub-nodes', 'big-unit-test', 'big-unit-report', 'big-unit-review']) assert.equal(r[rule]?.ok, true, `${rule}: ${r[rule]?.detail}`);
});
test('O32: 하위 노드에 위반이 있으면 sub-nodes 위반(노드와 규칙을 알려 줌)', () => {
  assert.equal(typeof mod.checkBigUnit, 'function');
  const subnodes = [{ id: 'PRX-1', results: [ok('test-first'), { rule: 'plan-first', ok: false, detail: '', basis: '작업 커밋' }] }, { id: 'PRX-T', results: [] }];
  const r = byRule(mod.checkBigUnit({ id: 'PRX', subnodes, reportText: REPORT }));
  assert.equal(r['sub-nodes']?.ok, false);
  assert.match(r['sub-nodes'].detail, /PRX-1.*plan-first/);
});
test('O32: <ID>-T 노드가 없으면 big-unit-test 위반, 보고서가 없으면 big-unit-report·big-unit-review 위반', () => {
  assert.equal(typeof mod.checkBigUnit, 'function');
  const r = byRule(mod.checkBigUnit({ id: 'PRX', subnodes: [{ id: 'PRX-1', results: [ok('test-first')] }], reportText: undefined }));
  assert.equal(r['big-unit-test']?.ok, false);
  assert.equal(r['big-unit-report']?.ok, false);
  assert.equal(r['big-unit-review']?.ok, false);
});
test('O32: 보고서에 검토 에이전트 확인 줄이 없으면 big-unit-review 위반', () => {
  assert.equal(typeof mod.checkBigUnit, 'function');
  const r = byRule(mod.checkBigUnit({ id: 'PRX', subnodes: [{ id: 'PRX-T', results: [] }], reportText: '# 보고서\n## 결과 요약\n' }));
  assert.equal(r['big-unit-report']?.ok, true);
  assert.equal(r['big-unit-review']?.ok, false);
});
