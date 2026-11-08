// [INFRA-12] O50 병합 뒤 기록 — 새 동작(구현 전에는 실패해야 정상)
//   checkCommits({ mergeRecord: { applies, merged, recorded } }) → 규칙 merge-record
//     규칙 도입 전 ➖ / 병합 전 ➖ / 기록 있음 ✅ / 병합했는데 기록 없음 ➖ "기록 대기" + pending: true
//   checkBigUnit → 규칙 merge-records: 하위 노드에 "기록 대기"가 있으면 ❌
//   CLI는 실제 저장소 이력으로 확인한다: STO-5는 규칙 도입(INFRA-12 계획) 전 작업
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
const rule = (mergeRecord) => {
  const r = checkCommits({ id: 'PRX-9', commits: COMMITS, docExists: true, mergeRecord }).find((x) => x.rule === 'merge-record');
  assert.ok(r, 'merge-record 규칙이 결과에 있어야 함');
  return r;
};

test('O50: 규칙 도입 전 작업은 merge-record ➖ "규칙 도입 전"', () => {
  const r = rule({ applies: false, merged: true, recorded: false });
  assert.equal(r.ok, null);
  assert.match(r.detail, /도입 전/);
  assert.notEqual(r.pending, true);
});

test('O50: 아직 병합 전이면 ➖ "병합 전"', () => {
  const r = rule({ applies: true, merged: false, recorded: false });
  assert.equal(r.ok, null);
  assert.match(r.detail, /병합 전/);
  assert.notEqual(r.pending, true);
});

test('O50: 병합 뒤 기록 커밋이 있으면 ✅', () => {
  const r = rule({ applies: true, merged: true, recorded: true });
  assert.equal(r.ok, true, r.detail);
});

test('O50: 병합했는데 기록이 없으면 ➖ "기록 대기"(pending) — 이름 "[ID] 병합 뒤 기록"을 안내한다', () => {
  const r = rule({ applies: true, merged: true, recorded: false });
  assert.equal(r.ok, null);
  assert.equal(r.pending, true);
  assert.match(r.detail, /기록 대기/);
  assert.match(r.detail, /\[PRX-9\] 병합 뒤 기록/);
});

test('O50: 큰 단위 merge-records — 하위 노드에 "기록 대기"가 있으면 ❌(그 노드 ID를 적음), 없으면 ✅', () => {
  const ok = { rule: 'merge-record', ok: true, detail: '', basis: '' };
  const wait = { rule: 'merge-record', ok: null, pending: true, detail: '기록 대기', basis: '' };
  const lastRun = { full: true, failed: 0, bigTodo: {} };
  const find = (subnodes) => {
    const r = checkBigUnit({ id: 'PRX', subnodes, reportText: '검토 에이전트 확인', lastRun }).find((x) => x.rule === 'merge-records');
    assert.ok(r, 'merge-records 규칙이 결과에 있어야 함');
    return r;
  };
  const bad = find([{ id: 'PRX-T', results: [ok] }, { id: 'PRX-9', results: [wait] }]);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /PRX-9/);
  assert.doesNotMatch(bad.detail, /PRX-T/);
  assert.equal(find([{ id: 'PRX-T', results: [ok] }, { id: 'PRX-9', results: [ok] }]).ok, true, '긍정 전제(O30)의 반대: 기록이 다 있으면 통과');
});

// --- CLI(실제 저장소) ---
const ROOT = path.resolve(import.meta.dirname, '../..');
const cli = (id) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-method.mjs'), '--id', id, '--json'], { cwd: ROOT, encoding: 'utf8' }));

test('CLI: STO-5(규칙 도입 전 작업)는 merge-record ➖ "규칙 도입 전"', () => {
  const r = cli('STO-5').results.find((x) => x.rule === 'merge-record');
  assert.ok(r, 'merge-record 규칙이 결과에 있어야 함');
  assert.equal(r.ok, null);
  assert.match(r.detail, /도입 전/);
});

test('CLI: STO 큰 단위는 merge-records ✅(하위 노드가 모두 규칙 도입 전)', () => {
  const r = cli('STO').results.find((x) => x.rule === 'merge-records');
  assert.ok(r, 'merge-records 규칙이 결과에 있어야 함');
  assert.equal(r.ok, true, r.detail);
});
