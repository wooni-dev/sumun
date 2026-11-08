// [INFRA-12] 회귀(O9, 구현 전에도 통과해야 정상): merge-record를 더해도 기존 규칙의 결과는 그대로다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkCommits, checkBigUnit } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const c = (hash, subject, files) => ({ hash, subject, body: MSG, files });
const COMMITS = [
  c('p0', '[PRX-9] 계획: 무엇', ['docs/ai/progress.md']),
  c('a1', '[PRX-9] 테스트: 무엇', ['test/prx/PRX-9.test.ts']),
  c('b2', '[PRX-9] server.ts: 무엇', ['src/proxy/server.ts']),
  c('c3', '[PRX-9] 문서', ['docs/for-me/PRX-9.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']),
];
const OLD = ['plan-first', 'test-first', 'test-commits-test-only', 'test-unchanged', 'message-format', 'user-doc', 'progress-updated', 'tree-updated'];

test('기존 작은 단위 규칙은 mergeRecord가 있든 없든 같은 결과', () => {
  const pick = (rs) => Object.fromEntries(rs.filter((r) => OLD.includes(r.rule)).map((r) => [r.rule, r.ok]));
  const base = pick(checkCommits({ id: 'PRX-9', commits: COMMITS, docExists: true }));
  assert.deepEqual(Object.keys(base).sort(), [...OLD].sort());
  for (const k of OLD) assert.equal(base[k], true, k);
  for (const mergeRecord of [{ applies: true, merged: true, recorded: false }, { applies: false, merged: false, recorded: false }])
    assert.deepEqual(pick(checkCommits({ id: 'PRX-9', commits: COMMITS, docExists: true, mergeRecord })), base);
});

test('기존 큰 단위 규칙(sub-nodes·big-unit-*)은 그대로', () => {
  const lastRun = { full: true, failed: 0, bigTodo: {} };
  const rs = checkBigUnit({ id: 'PRX', subnodes: [{ id: 'PRX-T', results: [{ rule: 'x', ok: true }] }], reportText: '검토 에이전트 확인', lastRun });
  const by = Object.fromEntries(rs.map((r) => [r.rule, r.ok]));
  for (const k of ['sub-nodes', 'big-unit-test', 'big-unit-report', 'big-unit-review', 'big-unit-todo']) assert.equal(by[k], true, k);
});

test('CLI: STO-5의 기존 규칙 11개는 모두 ✅ 그대로', () => {
  const ROOT = path.resolve(import.meta.dirname, '../..');
  const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-method.mjs'), '--id', 'STO-5', '--json'], { cwd: ROOT, encoding: 'utf8' }));
  const old = out.results.filter((r) => r.rule !== 'merge-record');
  assert.equal(old.length, 11);
  for (const r of old) assert.equal(r.ok, true, `${r.rule}: ${r.detail}`);
});
