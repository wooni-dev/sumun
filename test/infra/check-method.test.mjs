// [INFRA-2] 개발 방식 기계 검사 테스트
// checkCommits는 git에서 읽어 온 커밋 목록(오래된 순)을 받아 규칙별 결과를 돌려준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG_OK = '- 왜: 이유\n- 검증: npm test 3/3';
const c = (hash, subject, files, body = MSG_OK) => ({ hash, subject, body, files });

const GOOD = {
  id: 'PRX-1',
  commits: [
    c('a1', '[PRX-1] 테스트: 요청 중계', ['test/PRX-1.test.ts'], '- 왜: 명세 고정\n- 검증: npm run test:red → 2개 모두 실패'),
    c('b2', '[PRX-1] 프록시 서버 열기', ['src/proxy/server.ts']),
    c('c3', '[PRX-1] 문서와 기록', ['docs/for-me/PRX-1.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md']),
  ],
  docExists: true,
};

const byRule = (results) => Object.fromEntries(results.map((r) => [r.rule, r]));

test('규칙을 모두 지킨 PR은 전부 ok', () => {
  const r = byRule(checkCommits(GOOD));
  for (const rule of ['test-first', 'test-unchanged', 'message-format', 'user-doc', 'progress-updated', 'tree-updated']) {
    assert.equal(r[rule]?.ok, true, `${rule}: ${JSON.stringify(r[rule])}`);
  }
});

test('첫 커밋이 테스트 커밋이 아니면 test-first 위반', () => {
  const commits = [GOOD.commits[1], GOOD.commits[0], GOOD.commits[2]];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['test-first'].ok, false);
});

test('테스트 커밋에 test/ 밖의 파일이 섞이면 test-first 위반', () => {
  const commits = [c('a1', '[PRX-1] 테스트: 요청 중계', ['test/PRX-1.test.ts', 'src/proxy/server.ts']), ...GOOD.commits.slice(1)];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['test-first'].ok, false);
});

test('테스트 커밋 이후 그 테스트 파일을 다시 바꾸면 test-unchanged 위반이고 커밋을 알려 준다', () => {
  const commits = [...GOOD.commits, c('d4', '[PRX-1] 고침', ['test/PRX-1.test.ts', 'src/proxy/server.ts'])];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['test-unchanged'].ok, false);
  assert.match(r['test-unchanged'].detail, /d4/);
});

test('이후 커밋에서 새 테스트 파일을 추가하는 것은 test-unchanged 위반이 아니다', () => {
  const commits = [...GOOD.commits, c('d4', '[PRX-1] 추가 테스트', ['test/PRX-1-extra.test.ts'])];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['test-unchanged'].ok, true);
});

test('"왜"나 "검증"이 없는 커밋이 있으면 message-format 위반이고 커밋을 알려 준다', () => {
  const commits = [...GOOD.commits.slice(0, 2), c('c3', '[PRX-1] 문서', ['docs/for-me/PRX-1.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md'], '- 왜: 이유만 있음')];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['message-format'].ok, false);
  assert.match(r['message-format'].detail, /c3/);
});

test('사용자용 문서가 없으면 user-doc 위반', () => {
  const r = byRule(checkCommits({ ...GOOD, docExists: false }));
  assert.equal(r['user-doc'].ok, false);
});

test('진행 기록을 한 번도 갱신하지 않았으면 progress-updated 위반', () => {
  const commits = [...GOOD.commits.slice(0, 2), c('c3', '[PRX-1] 문서', ['docs/for-me/PRX-1.md', 'docs/ai/purpose-tree.md'])];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['progress-updated'].ok, false);
});

test('목적 나무 노드(INFRA 아님)인데 purpose-tree.md를 갱신하지 않았으면 tree-updated 위반', () => {
  const commits = [...GOOD.commits.slice(0, 2), c('c3', '[PRX-1] 문서', ['docs/for-me/PRX-1.md', 'docs/ai/progress.md'])];
  const r = byRule(checkCommits({ ...GOOD, commits }));
  assert.equal(r['tree-updated'].ok, false);
});

test('INFRA 작업은 목적 나무 노드가 아니므로 tree-updated 검사를 건너뛴다', () => {
  const commits = GOOD.commits.map((x) => ({ ...x, subject: x.subject.replace('PRX-1', 'INFRA-9'), files: x.files.filter((f) => !f.includes('purpose-tree')) }));
  const r = byRule(checkCommits({ id: 'INFRA-9', commits, docExists: true }));
  assert.equal(r['tree-updated'].ok, null);
});

test('커밋이 하나도 없으면 test-first 위반으로 알려 준다', () => {
  const r = byRule(checkCommits({ id: 'PRX-1', commits: [], docExists: false }));
  assert.equal(r['test-first'].ok, false);
});
