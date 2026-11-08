// [INFRA-14] O58 계획 제목의 예상 E번호 대조 — 새 동작(구현 전에는 실패해야 정상)
//   checkCommits: 계획 커밋 제목 "예상 E<a>~E<b>"(범위)·"E<n>, E<m>"·"E<n>·E<m>"의 번호 중 계획 절에서 예상으로 읽지 못한 것이 있으면
//     - 그 밖에는 ✅였을 때·예상이 하나도 없을 때 → ok 'check'("⚠ 확인 필요"), 근거에 그 번호와 O58
//     - ❌(실측 없음)는 그대로 ❌, 근거에 읽지 못한 번호를 덧붙임
//   checkBigUnit: 'check'는 위반으로 세지 않고 "⚠ 확인 필요 → <노드> <규칙>"으로 따로 적는다
//   CLI: 실제 저장소 — UI-1 계획 제목 "예상 E170~E172"인데 E172가 계획 절에서 읽히지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkCommits, checkBigUnit } from '../../scripts/check-method.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const commitsWith = (planSubject) => [
  c('p0', planSubject, ['docs/ai/progress.md']),
  c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']),
  c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']),
  c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']),
];
const section = (preds, measured) =>
  ['### [PRX-9] 계획', '- 예상 [추측]:', ...preds.map((e) => `  - ${e}: 무엇이 나온다. 판정: 그러면 일치.`), '- 실측 (명령 원문):', ...measured.map((e) => `  - ${e} 일치: 결과`)].join('\n');
const rule = (planSubject, preds, measured) => {
  const r = checkCommits({ id: 'PRX-9', commits: commitsWith(planSubject), docExists: true, progressSection: section(preds, measured), verdictRuleApplies: true }).find(
    (x) => x.rule === 'predictions-measured',
  );
  assert.ok(r, 'predictions-measured 규칙이 결과에 있어야 함');
  return r;
};
const cli = (...args) => {
  try {
    return execFileSync(process.execPath, ['scripts/check-method.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    return String(e.stdout ?? '');
  }
};

test('O58: 제목 범위 E170~E172 중 E172를 계획 절에서 읽지 못하면 ⚠ 확인 필요(근거에 E172·O58)', () => {
  const r = rule('[PRX-9] 계획: 무엇, 예상 E170~E172', ['E170', 'E171'], ['E170', 'E171']);
  assert.equal(r.ok, 'check', r.detail);
  assert.match(r.detail, /E172/);
  assert.match(r.detail, /O58/);
});

test('O58: 제목의 낱개 번호(쉼표·가운뎃점 구분)도 대조한다', () => {
  for (const subject of ['[PRX-9] 계획: 무엇 — 예상 E5, E7', '[PRX-9] 계획: 무엇 — 예상 E5·E7']) {
    const r = rule(subject, ['E5'], ['E5']);
    assert.equal(r.ok, 'check', `${subject}: ${r.detail}`);
    assert.match(r.detail, /E7/, subject);
  }
});

test('O58: 계획 절에서 예상을 하나도 읽지 못했는데 제목에 E번호가 있으면 ➖가 아니라 ⚠ 확인 필요', () => {
  const r = rule('[PRX-9] 계획: 무엇, 예상 E10~E11', [], []);
  assert.equal(r.ok, 'check', r.detail);
  assert.match(r.detail, /E10/);
  assert.match(r.detail, /E11/);
});

test('O58: 실측이 빠진 ❌는 그대로 ❌이고, 근거에 읽지 못한 제목 번호를 덧붙인다', () => {
  const r = rule('[PRX-9] 계획: 무엇, 예상 E1~E2', ['E1'], []);
  assert.equal(r.ok, false, r.detail);
  assert.match(r.detail, /E1/);
  assert.match(r.detail, /E2/);
});

test('O58: 큰 단위 sub-nodes — ⚠ 확인 필요는 위반이 아니고 "⚠ 확인 필요 → 노드 규칙"으로 따로, ⚠ 허용됨과 구별', () => {
  const r = checkBigUnit({
    id: 'UI',
    subnodes: [
      { id: 'UI-1', results: [{ rule: 'predictions-measured', ok: 'check', detail: '', basis: '' }, { rule: 'test-unchanged', ok: 'warn', detail: '', basis: '' }] },
      { id: 'UI-2', results: [{ rule: 'predictions-measured', ok: true, detail: '', basis: '' }] },
    ],
    reportText: '검토 에이전트 확인',
    lastRun: { full: true, failed: 0, bigTodo: {} },
  }).find((x) => x.rule === 'sub-nodes');
  assert.ok(r, 'sub-nodes 규칙이 결과에 있어야 함');
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /⚠ 확인 필요 → UI-1 predictions-measured/);
  assert.match(r.detail, /⚠ 허용됨 → UI-1 test-unchanged/);
  assert.doesNotMatch(r.detail, /⚠ 허용됨 → [^/]*predictions-measured/);
});

test('O58 CLI: 실제 저장소 UI-1 — predictions-measured가 "⚠ 확인 필요"이고 근거에 E172', () => {
  const out = cli('--id', 'UI-1');
  assert.match(out, /\| predictions-measured \|/, '긍정 전제: 표에 규칙 줄이 있어야 함');
  const line = out.split('\n').find((l) => l.startsWith('| predictions-measured |'));
  assert.match(line, /\| ⚠ 확인 필요 \|/);
  assert.match(line, /E172/);
});

test('O58 CLI: 실제 저장소 UI 큰 단위 — sub-nodes 근거에 "⚠ 확인 필요 → UI-1 predictions-measured"', () => {
  const out = cli('--id', 'UI');
  const line = out.split('\n').find((l) => l.startsWith('| sub-nodes |'));
  assert.ok(line, '긍정 전제: 큰 단위 표에 sub-nodes 줄이 있어야 함');
  assert.match(line, /⚠ 확인 필요 → UI-1 predictions-measured/);
});
