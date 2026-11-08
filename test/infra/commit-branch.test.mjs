// [INFRA-13] O54 규칙 D — 새 동작(구현 전에는 실패해야 정상). 사례·결정 번호는 docs/ai/infra13-cases.md(검토 에이전트)
//   scripts/commit-msg.mjs branchProblems({ branch, title, unlocked }) / mergeProblems({ branch, target, title }) → 문제 문구 배열(빈 배열 = 통과)
//   guard.mjs(실행 전): 표시 파일에 "branch": true면 커밋 제목이 지금 브랜치에 맞는지, 같은 명령 안 위치·브랜치 바꾸기, -C·cwd, main의 git merge 메시지
//   commit-check.mjs(실행 뒤): 명령 중 생긴 커밋(HEAD reflog)의 제목·브랜치 변화
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { branchProblems, mergeProblems } from '../../scripts/commit-msg.mjs';
import { makeRepo } from './_commit-fixture.mjs';
import { withBranchRepo, preAt, postAt, msgOf } from './_branch-fixture.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const bad = (a) => assert.ok(branchProblems(a).length > 0, `막혀야 함: ${JSON.stringify(a)}`);
const ok = (a) => assert.deepEqual(branchProblems(a), [], `통과해야 함: ${JSON.stringify(a)}`);
const denies = (fx, tool, cmd, opts) => {
  const r = preAt(fx.repo, tool, cmd, opts);
  assert.equal(r.decision, 'deny', `${tool}: ${cmd}`);
  return r.reason;
};
const allows = (fx, tool, cmd, opts) => assert.equal(preAt(fx.repo, tool, cmd, opts).decision, 'allow', `긍정 전제(O30) ${tool}: ${cmd}`);

// --- 순수 함수 ---
test('함수: feat/<ID>에서 제목 ID가 완전히 같지 않으면 문제 — 다른 ID, 접두, 대소문자, 0·하이픈 붙임(사례 18~20, Q1·Q3)', () => {
  for (const title of ['[PRX-2b] 실측', '[INFRA-1] x', '[INFRA-130] x', '[infra-13] x', '[Infra-13] x', '[INFRA-013] x', '[INFRA-13-] x', '[INFRA--13] x', '[INFRA-13x] x'])
    bad({ branch: 'feat/INFRA-13', title, unlocked: false });
  bad({ branch: 'feat/PRX-1b', title: '[PRX-1B] x', unlocked: false });
  ok({ branch: 'feat/INFRA-13', title: '[INFRA-13] x', unlocked: false });
  ok({ branch: 'feat/INFRA-13', title: '[RULE] x', unlocked: false }); // F1
  ok({ branch: 'feat/PRX-1b', title: '[PRX-1b] x', unlocked: false }); // F8
  ok({ branch: 'feat/TLS-T', title: '[TLS-T] x', unlocked: false }); // F7
});

test('함수: main은 허용 목록만 — AUDIT-n, SESSION, INIT, REPORT-…, [ID] 병합, [ID] 병합 뒤 기록(사례 11, F4~F6, Q4)', () => {
  for (const title of ['[X-1] 제목', '[PRX-2b] 실측 스크립트', '[RULE] x', '[AUDIT] x', '[AUDIT-x] x', '[SESSIONS] x', '[INFRA-12] 병합x', '[INFRA-12] 병합 뒤: x'])
    bad({ branch: 'main', title, unlocked: false });
  for (const title of ['[AUDIT-13] x', '[SESSION] x', '[INIT] x', '[REPORT-PRX] x', '[INFRA-12] 병합: x', '[INFRA-12] 병합 뒤 기록: x', '[PRX-1b] 병합 뒤 기록: x'])
    ok({ branch: 'main', title, unlocked: false });
});

test('함수: detached HEAD와 feat처럼 보이지만 feat/<ASCII ID>가 아닌 브랜치는 문제, 그 밖의 브랜치는 보지 않는다(사례 4~9, F9, Q4)', () => {
  for (const branch of [null, 'Feat/X-1', 'FEAT/X-1', 'feat/X-1/y', 'feat/x/X-1', 'feat/ІNFRA-12', 'feat/INFRA‑12', 'feat-X-1', 'feat/', 'feature/X-1'])
    bad({ branch, title: '[X-1] x', unlocked: false });
  ok({ branch: 'probe/infra11-post', title: '[PRX-2b] probe', unlocked: false });
  ok({ branch: 'wip', title: '[X-1] x', unlocked: false });
});

test('함수: 다른 노드의 "테스트 수정(사용자 허용" 커밋은 허용이 켜져 있을 때만(F2, Q2)', () => {
  ok({ branch: 'feat/TLS-4', title: '[TLS-3] 테스트 수정(사용자 허용·결정): x', unlocked: true });
  bad({ branch: 'feat/TLS-4', title: '[TLS-3] 테스트 수정(사용자 허용·결정): x', unlocked: false });
  bad({ branch: 'feat/TLS-4', title: '[TLS-3] 테스트 수정: x', unlocked: true });
  bad({ branch: 'feat/TLS-4', title: '[TLS-3] 실측 테스트 수정(사용자 허용): x', unlocked: true });
});

test('함수: main에서 feat/<ID>를 병합하면 제목이 "[<ID>] 병합: …"이어야 한다 — 메시지 없음도 문제(사례 26, Q5)', () => {
  assert.deepEqual(mergeProblems({ branch: 'main', target: 'feat/X-1', title: '[X-1] 병합: x' }), [], '긍정 전제');
  for (const title of ['[X-2] 병합: x', '[X-1] 병합 뒤 기록: x', '[X-1] 계획: x', "Merge branch 'feat/X-1'", '', null])
    assert.ok(mergeProblems({ branch: 'main', target: 'feat/X-1', title }).length > 0, `막혀야 함: ${title}`);
  assert.ok(mergeProblems({ branch: 'main', target: 'feat/X-1/y', title: '[X-1] 병합: x' }).length > 0, 'feat 모양이 아닌 대상');
});

// --- 실행 전(guard.mjs) ---
test('실행 전: feat/<ID>에서 다른 ID 제목의 메시지 파일로 커밋하면 막고, 이유에 규칙 D와 브랜치 ID가 나온다(INFRA-11 사고 재현)', () =>
  withBranchRepo({ on: 'feat/INFRA-11' }, (fx) => {
    allows(fx, 'Bash', `git commit -q -F "${fx.msg(msgOf('[INFRA-11] 맞는 제목'))}"`);
    const P = fx.msg(msgOf('[PRX-2b] 실측 스크립트: 옛 메시지'));
    const reason = denies(fx, 'Bash', `git add a.txt && git commit -q -F "${P}"`);
    assert.match(reason, /규칙 D/);
    assert.match(reason, /INFRA-11/);
    denies(fx, 'PowerShell', `git commit -q -F "${P}"`);
  }));

test('실행 전: main에서 허용 목록 밖 제목, detached HEAD, feat처럼 보이는 다른 이름 브랜치에서는 막는다(사례 4, 6, 11)', () => {
  withBranchRepo({}, (fx) => {
    allows(fx, 'Bash', `git commit -q --allow-empty -F "${fx.msg(msgOf('[X-1] 병합 뒤 기록: 결과'))}"`);
    denies(fx, 'Bash', `git commit -q --allow-empty -F "${fx.msg(msgOf('[X-1] 제목'))}"`);
    fx.git('checkout', '-q', '--detach');
    denies(fx, 'Bash', `git commit -q --allow-empty -F "${fx.msg(msgOf('[AUDIT-1] 기록'))}"`);
  });
  withBranchRepo({ on: 'Feat/X-1' }, (fx) => denies(fx, 'Bash', `git commit -q --allow-empty -F "${fx.msg(msgOf('[X-1] x'))}"`));
});

test('실행 전: 커밋·병합과 같은 명령 안에서 브랜치·위치·환경을 바꾸면 막는다(사례 1, 2, 13, 15, 25, Q6)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    const G = fx.msg(msgOf('[X-1] 맞는 제목'));
    const R = fx.repo.replaceAll('\\', '/');
    allows(fx, 'Bash', `git add a.txt && git commit -q -F "${G}"`);
    for (const c of [
      `git checkout -q feat/X-1 && git commit -q -F "${G}"`,
      `git switch -c feat/X-9 && git commit -q -F "${G}"`,
      `git branch -f feat/X-1 HEAD; git commit -q -F "${G}"`,
      `git update-ref refs/heads/feat/X-1 HEAD; git commit -q -F "${G}"`,
      `git symbolic-ref HEAD refs/heads/feat/X-1; git commit -q -F "${G}"`,
      `cd "${R}" && git commit -q -F "${G}"`,
      `pushd "${R}"; git commit -q -F "${G}"`,
      `export GIT_DIR=x; git commit -q -F "${G}"`,
      `GIT_COMMITTER_DATE=2020-01-01; git commit -q -F "${G}"`,
      `git commit -q -F "${G}"; git checkout main`,
    ])
      denies(fx, 'Bash', c);
    for (const c of [`Set-Location "${R}"; git commit -q -F "${G}"`, `sl "${R}"; git commit -q -F "${G}"`, `$env:GIT_DIR='x'; git commit -q -F "${G}"`, `Push-Location "${R}"; git commit -q -F "${G}"`])
      denies(fx, 'PowerShell', c);
  }));

test('실행 전: -C는 이 저장소 경로만, hook 입력의 cwd가 이 저장소가 아니면 막는다(사례 12~14, Q7)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    const other = makeRepo();
    try {
      const G = fx.msg(msgOf('[X-1] 맞는 제목'));
      const R = fx.repo.replaceAll('\\', '/');
      allows(fx, 'Bash', `git -C "${R}" commit -q -F "${G}"`);
      denies(fx, 'Bash', `git -C "${other.repo.replaceAll('\\', '/')}" commit -q -F "${G}"`);
      denies(fx, 'Bash', `git commit -q -F "${G}"`, { cwd: other.repo });
      denies(fx, 'Bash', `git commit -q -F "${G}"`, { cwd: path.join(fx.repo, '.claude') });
    } finally {
      other.cleanup();
    }
  }));

test('실행 전: main의 git merge feat/<ID>는 메시지 제목이 "[<ID>] 병합: …"이어야 한다 — 다른 ID·메시지 없음은 막는다(사례 26, Q5)', () =>
  withBranchRepo({}, (fx) => {
    fx.git('branch', 'feat/X-1');
    allows(fx, 'Bash', `git merge --no-ff -q -F "${fx.msg(msgOf('[X-1] 병합: 내용'))}" feat/X-1`);
    denies(fx, 'Bash', `git merge --no-ff -q -F "${fx.msg(msgOf('[X-2] 병합: 옛 메시지'))}" feat/X-1`);
    denies(fx, 'Bash', 'git merge --no-ff -m "[X-2] 병합: 옛" feat/X-1');
    denies(fx, 'Bash', 'git merge --no-ff --no-edit feat/X-1');
    denies(fx, 'PowerShell', `git merge --no-ff -F "${fx.msg(msgOf('[PRX-2b] 병합: x'))}" feat/X-1`);
  }));

test('실행 전: 다른 노드의 "테스트 수정(사용자 허용" 커밋은 허용 상태일 때만 통과한다(F2, Q2)', () =>
  withBranchRepo({ on: 'feat/TLS-4' }, (fx) => {
    const T = fx.msg(msgOf('[TLS-3] 테스트 수정(사용자 허용·결정): 기대값'));
    denies(fx, 'Bash', `git commit -q -F "${T}"`);
    fx.unlock(true);
    allows(fx, 'Bash', `git commit -q -F "${T}"`);
    fx.unlock(false);
    denies(fx, 'Bash', `git commit -q -F "${T}"`);
  }));

// --- 실행 뒤(commit-check.mjs) ---
test('실행 뒤: hook을 거치지 않고 feat/<ID>에 생긴 다른 ID 커밋을 알린다(해시, 규칙 D, 사용자 보고) — 맞는 커밋만이면 알리지 않는다(사례 28~30)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    preAt(fx.repo, 'Bash', 'git status');
    const h = fx.commit(msgOf('[PRX-2b] 실측 스크립트'));
    const r = postAt(fx.repo);
    assert.ok(r, '알림이 있어야 함');
    assert.equal(r.decision, 'block');
    assert.match(r.reason, new RegExp(h));
    assert.match(r.reason, /규칙 D/);
    assert.match(r.reason, /사용자/);
    preAt(fx.repo, 'Bash', 'git status');
    fx.commit(msgOf('[X-1] 맞는 제목'));
    assert.equal(postAt(fx.repo), null);
  }));

test('실행 뒤: 명령 안에서 다른 브랜치로 가서 커밋하고 돌아와도(HEAD가 그대로여도) 알린다(사례 1, 24)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    fx.git('branch', 'feat/PRX-2b');
    preAt(fx.repo, 'Bash', 'git status');
    const head = fx.git('rev-parse', 'HEAD');
    fx.git('checkout', '-q', 'feat/PRX-2b');
    fx.commit(msgOf('[PRX-2b] 옛 메시지'));
    fx.git('checkout', '-q', 'feat/X-1');
    assert.equal(fx.git('rev-parse', 'HEAD'), head, '전제: HEAD가 그대로');
    const r = postAt(fx.repo);
    assert.ok(r, '알림이 있어야 함');
    assert.match(r.reason, /규칙 D/);
  }));

test('실행 뒤: 기록한 브랜치와 지금 브랜치가 다르고 새 커밋이 있으면 제목이 새 브랜치에 맞아도 알린다(사례 16)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    fx.git('branch', 'feat/X-2');
    preAt(fx.repo, 'Bash', 'git status');
    fx.git('symbolic-ref', 'HEAD', 'refs/heads/feat/X-2');
    fx.commit(msgOf('[X-2] 새 브랜치에 맞는 제목'));
    const r = postAt(fx.repo);
    assert.ok(r, '알림이 있어야 함');
    assert.match(r.reason, /feat\/X-1/);
  }));

test('실행 뒤: main에 생긴 허용 목록 밖 커밋을 알린다 — 허용 목록 커밋은 알리지 않는다(사례 11, F4·F5)', () =>
  withBranchRepo({}, (fx) => {
    preAt(fx.repo, 'Bash', 'git status');
    fx.commit(msgOf('[AUDIT-9] 기록'));
    fx.commit(msgOf('[X-1] 병합 뒤 기록: 결과'));
    assert.equal(postAt(fx.repo), null);
    preAt(fx.repo, 'Bash', 'git status');
    const h = fx.commit(msgOf('[X-1] 계획: main에서'));
    const r = postAt(fx.repo);
    assert.ok(r, '알림이 있어야 함');
    assert.match(r.reason, new RegExp(h));
  }));

// --- 이 저장소 설정 ---
test('이 저장소: 표시 파일 .claude/commit-rule.json에 "branch": true가 있어 규칙 D가 켜져 있다(L1)', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'commit-rule.json'), 'utf8'));
  assert.equal(j.branch, true);
});
