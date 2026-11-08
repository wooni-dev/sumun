// [INFRA-13] 규칙 D 회귀(구현 전에도 통과해야 정상, O9) — 키가 없으면 꺼짐, 맞는 커밋·보지 않는 브랜치는 허용
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBranchRepo, preAt, postAt, msgOf } from './_branch-fixture.mjs';

const allows = (fx, tool, cmd) => assert.equal(preAt(fx.repo, tool, cmd).decision, 'allow', `${tool}: ${cmd}`);

test('회귀: 표시 파일에 "branch" 키가 없으면(INFRA-11 그대로) main의 [X-1] 커밋, 다른 ID 커밋, 같은 명령 안 checkout도 막지 않는다(Q11)', () =>
  withBranchRepo({ branch: false, on: 'feat/X-2' }, (fx) => {
    const G = fx.msg(msgOf('[X-1] 다른 ID'));
    allows(fx, 'Bash', `git commit -q -F "${G}"`);
    allows(fx, 'Bash', `git checkout -q feat/X-2 && git commit -q -F "${G}"`);
    preAt(fx.repo, 'Bash', 'git status');
    fx.commit(msgOf('[X-9] 형식은 맞음'));
    assert.equal(postAt(fx.repo), null);
  }));

test('회귀: 규칙 D가 켜져도 feat/<ID>의 맞는 제목, [RULE], 커밋 아닌 명령은 허용한다(F1, F10)', () =>
  withBranchRepo({ on: 'feat/X-1' }, (fx) => {
    allows(fx, 'Bash', `git add a.txt && git commit -q -F "${fx.msg(msgOf('[X-1] 계획: x'))}"`);
    allows(fx, 'PowerShell', `git commit -q --allow-empty -F "${fx.msg(msgOf('[RULE] 지침'))}"`);
    allows(fx, 'Bash', 'git checkout -q main');
    allows(fx, 'Bash', 'git status && git log --oneline -3');
  }));

test('회귀: 규칙 D가 켜져도 feat가 아닌 브랜치(probe/…)의 커밋은 보지 않는다(F9)', () =>
  withBranchRepo({ on: 'probe/x' }, (fx) => {
    allows(fx, 'Bash', `git commit -q --allow-empty -F "${fx.msg(msgOf('[PRX-2b] probe'))}"`);
  }));
