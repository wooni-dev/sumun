// [INFRA-6] 회귀: guard-bypass-cases.md "계속 허용해야 하는 정상 명령" 중 INFRA-5 회귀에서 빠졌던 것 (INFRA-5 감사 지적). red 대상 아님.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, guardDecision } from './_hook-fixture.mjs';

let fx;
before(() => (fx = makeRepo()));
after(() => fx.cleanup());

const ALLOW = [
  ['PowerShell 오류 출력 버리기', 'PowerShell', 'node --test test/a.test.ts 2>$null'],
  ['커밋된 테스트 내용 보기', 'Bash', 'git show HEAD:test/a.test.ts'],
  ['테스트 폴더 이력 보기', 'Bash', 'git log -- test/'],
  ['stash 목록', 'Bash', 'git stash list'],
  ['<메일> 출력', 'Bash', "echo '<a@b.com>'"],
];

for (const [name, tool, cmd] of ALLOW) {
  test(`정상 명령 허용: ${name}`, () => {
    assert.equal(guardDecision(fx.repo, tool, cmd), 'allow', JSON.stringify(cmd));
  });
}
