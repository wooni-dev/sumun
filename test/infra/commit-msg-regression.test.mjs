// [INFRA-11] 규칙 C — 회귀(O9, 구현 전에도 통과해야 정상): 맞는 메시지는 통과하고, 맞는 모양의 커밋과 커밋이 아닌 명령은 막지 않는다
//   (오탐 사례 F1~F24 — docs/ai/infra11-cases.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageProblems } from '../../scripts/commit-msg.mjs';
import { makeRepo, pre, GOOD } from './_commit-fixture.mjs';

const ok = (m) => assert.deepEqual(messageProblems(m), [], JSON.stringify(m));

test('내용: 맞는 메시지는 통과한다 — 트레일러, "실행 불가(이유)", 본문 안의 형식 설명, CRLF, 순서, Buffer(F3~F7)', () => {
  ok(GOOD);
  ok(Buffer.from(GOOD));
  ok(GOOD.replaceAll('\n', '\r\n'));
  ok('[X-1] 제목\n\n- 왜: a\n- 검증: 실행 불가(서버 없음)\n');
  ok('[X-1] 제목\n\n- 왜: `- 검증(…):` 형식을 막는다\n- 검증: b\n');
  ok('[X-1] 제목\n\n- 검증: b\n- 왜: a\n');
  for (const t of ['[RULE] 규칙', '[AUDIT-10] 감사', '[PRX-1b] 무엇', '[REPORT-PRX] 보고서', '[STO-T] 큰 단위', '[X-1] 테스트 수정(사용자 허용): 도우미']) ok(`${t}\n\n- 왜: a\n- 검증: b\n`);
});

function withRepo(fn) {
  const fx = makeRepo();
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}
const allows = (fx, tool, cmd) => assert.equal(pre(fx.repo, tool, cmd).decision, 'allow', `${tool}: ${cmd}`);

test('실행 전: `git commit -F <절대 경로>` 모양의 맞는 커밋은 막지 않는다(F1, F2의 글자 경로, F21~F23)', () =>
  withRepo((fx) => {
    const G = fx.msg(GOOD);
    allows(fx, 'Bash', `git commit -q -F "${G}"`);
    allows(fx, 'Bash', `git commit -F ${G}`);
    allows(fx, 'Bash', `git add -A && git commit -q -F "${G}" && git log --oneline -1`);
    allows(fx, 'Bash', `git commit --allow-empty --quiet --file="${G}"`);
    allows(fx, 'Bash', `git commit --file "${G}"`);
    allows(fx, 'Bash', `git commit -q -F "/${G[0].toLowerCase()}${G.slice(2)}"`); // Git Bash 표기 /c/…
    allows(fx, 'Bash', `git -C "${fx.repo.replaceAll('\\', '/')}" commit -F "${G}"`);
    allows(fx, 'Bash', `git --no-pager commit -F "${G}"`);
    allows(fx, 'Bash', `git revert -n HEAD && git commit -F "${G}"`);
    allows(fx, 'PowerShell', `git commit -q -F "${G}"`);
    allows(fx, 'PowerShell', `git commit -q -F "${G.replaceAll('/', '\\')}"`);
    allows(fx, 'PowerShell', `git add -A; if ($?) { git commit -q -F '${G}' }`);
  }));

test('실행 전: 커밋을 만들지 않는 명령, 병합, 글자로만 나오는 "git commit"은 막지 않는다(F8, F10~F20)', () =>
  withRepo((fx) => {
    for (const c of [
      'git merge --no-ff -m "[X-1] 병합: y" feat/x',
      'git merge --abort',
      'git merge-base main HEAD',
      'git log --grep commit',
      'git log --format=%B -3',
      'git show HEAD',
      'git cat-file commit HEAD',
      'git commit-graph write',
      'git config --get commit.template',
      'grep -n "git commit -m" CLAUDE.md',
      'echo "git commit 예시"',
      'git stash push -m "wip"',
      'git tag -a v1 -m "x"',
      'git revert --abort',
      'git add -A && git status',
      'git checkout -b feat/X',
      'node scripts/check-method.mjs --id STO-5',
      'git commit -h',
    ])
      allows(fx, 'Bash', c);
    allows(fx, 'PowerShell', "Select-String -Path CLAUDE.md -Pattern 'git commit'");
  }));
