// [INFRA-10] 승인된 방식 보정의 기계 검사(새 동작): O39(test-unchanged를 파일 기준으로), O40(사용자 허용 수정은 ⚠ 허용됨), O46(탐색 예상 구별·판정 요구)
//   checkCommits({ laterCommits, progressText, verdictRuleApplies }) — 새 인자
//   ok === 'warn' = ⚠ 허용됨(위반 아님). checkBigUnit의 sub-nodes는 'warn'을 위반으로 세지 않고 근거에 따로 적는다
//   CLI는 실제 저장소 이력으로 확인한다: TLS-T(9d8a528이 [TLS-4] 이름으로 고침), TLS-2b(a3cf4eb 허용 수정)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as mod from '../../scripts/check-method.mjs';

const { checkCommits, checkBigUnit } = mod;
const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const byRule = (rs) => Object.fromEntries(rs.map((r) => [r.rule, r]));

const PLAN = c('p0', '[PRX-9] 계획: 무엇', ['docs/ai/progress.md']);
const TEST = c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']);
const IMPL = c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']);
const DOCS = c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']);
const run = (extra = {}, commits = [PLAN, TEST, IMPL, DOCS]) => byRule(checkCommits({ id: 'PRX-9', commits, docExists: true, ...extra }));

// --- O39 ---
test('O39: 다른 ID의 나중 커밋이 이 노드의 테스트 파일을 바꾸면 test-unchanged 위반(허용 기록 없음)', () => {
  const other = c('d4', '[PRX-10] server.ts: 무엇', ['src/proxy/server.ts', 'test/prx/PRX-9.test.ts']);
  const r = run({ laterCommits: [IMPL, DOCS, other], progressText: '' });
  assert.equal(r['test-unchanged'].ok, false, r['test-unchanged'].detail);
  assert.match(r['test-unchanged'].detail, /d4/);
});

// --- O40 ---
const ALLOWED = c('e5', '[PRX-9] 테스트 수정(사용자 허용): 도우미 결함', ['test/prx/PRX-9.test.ts']);
const ALLOW_LOG = '- 재개(2026-11-08): "테스트 수정 허용" → 도우미를 고침(e5). 고친 테스트가 구현 전 src에서 실패함을 확인.\n';
test('O40: 테스트 파일을 바꾼 커밋이 모두 허용된 수정(제목 "(사용자 허용" + progress.md에 해시와 "허용")이면 ⚠ 허용됨(warn)', () => {
  const commits = [PLAN, TEST, IMPL, ALLOWED, DOCS];
  const r = run({ laterCommits: commits.slice(2), progressText: ALLOW_LOG }, commits);
  assert.equal(r['test-unchanged'].ok, 'warn', r['test-unchanged'].detail);
  assert.match(r['test-unchanged'].detail, /허용/);
  assert.match(r['test-unchanged'].detail, /e5/);
});
test('O39·O40: 다른 ID 이름으로 한 허용된 수정도(9d8a528처럼) ⚠ 허용됨', () => {
  const other = c('f6', '[PRX-10] 테스트 수정(사용자 허용): PRX-9 큰 단위 가정', ['test/prx/PRX-9.test.ts']);
  const r = run({ laterCommits: [IMPL, DOCS, other], progressText: '- "테스트 수정 허용" 뒤 f6에서 고침\n' });
  assert.equal(r['test-unchanged'].ok, 'warn', r['test-unchanged'].detail);
});

// --- O46 ---
const SECTION = (preds, measured) => `### [PRX-9] 계획
- 예상 [추측]:
${preds}
- 실측 (명령 원문):
${measured}
`;
test('O46: 판정 요구가 적용되는 작업에서, 탐색이 아닌 예상의 실측 기록에 일치/불일치가 없으면 predictions-measured 위반', () => {
  const r = run({ verdictRuleApplies: true, progressSection: SECTION('  - E1: 무엇이 된다', '  - E1: `node x` → 1을 기록') });
  assert.equal(r['predictions-measured'].ok, false, r['predictions-measured'].detail);
  assert.match(r['predictions-measured'].detail, /판정/);
  assert.match(r['predictions-measured'].detail, /E1/);
});
test('O46: [탐색] 예상은 판정 없이 기록만 있어도 되고, 근거에 탐색으로 따로 적는다', () => {
  const r = run({
    verdictRuleApplies: true,
    progressSection: SECTION('  - E1: 무엇이 된다\n  - E2 [탐색]: 무엇이 나오는지 본다', '  - E1 일치: `node x` → 1\n  - E2: `node y` → 결과 기록'),
  });
  assert.equal(r['predictions-measured'].ok, true, r['predictions-measured'].detail);
  assert.match(r['predictions-measured'].detail, /탐색 E2/);
});

// --- 큰 단위 ---
test('O40: 큰 단위 sub-nodes는 ⚠ 허용됨을 위반으로 세지 않고 근거에 따로 적는다', () => {
  const sub = (id, ok) => ({ id, results: [{ rule: 'test-unchanged', ok, detail: '', basis: '작업 커밋' }] });
  const r = byRule(checkBigUnit({ id: 'PRX', subnodes: [sub('PRX-1', true), sub('PRX-2', 'warn')], reportText: undefined, lastRun: undefined }));
  assert.equal(r['sub-nodes'].ok, true, r['sub-nodes'].detail);
  assert.match(r['sub-nodes'].detail, /허용됨/);
  assert.match(r['sub-nodes'].detail, /PRX-2 test-unchanged/);
});

// --- CLI(실제 저장소 이력) ---
const root = path.resolve(import.meta.dirname, '../..');
const cli = (id) => execFileSync(process.execPath, ['scripts/check-method.mjs', '--id', id], { cwd: root, encoding: 'utf8' });
const rowOf = (out, rule) => out.split('\n').find((l) => l.startsWith(`| ${rule} |`)) ?? '';
test('O39 CLI: TLS-T는 9d8a528([TLS-4] 이름, 사용자 허용)이 테스트 파일을 고쳤으므로 test-unchanged가 ⚠ 허용됨', () => {
  const row = rowOf(cli('TLS-T'), 'test-unchanged');
  assert.match(row, /⚠ 허용됨/, row);
  assert.match(row, /9d8a528/, row);
});
test('O40 CLI: TLS-2b(a3cf4eb 사용자 허용 수정)의 test-unchanged가 ❌가 아니라 ⚠ 허용됨', () => {
  const row = rowOf(cli('TLS-2b'), 'test-unchanged');
  assert.match(row, /⚠ 허용됨/, row);
});
