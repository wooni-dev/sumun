// [INFRA-5] 회귀: 실행 후 검사가 정상 작업을 방해하면 안 된다. red 대상 아님(stub 상태에서도 통과해야 정상).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo } from './_hook-fixture.mjs';
import { runVerify } from './_verify-fixture.mjs';

let fx;
beforeEach(() => (fx = makeRepo()));
afterEach(() => fx.cleanup());

test('아무것도 바뀌지 않았으면 아무것도 출력하지 않는다', () => {
  const r = runVerify(fx.repo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out, null);
});

test('새(커밋 안 된) 테스트 파일은 건드리지 않는다', () => {
  const f = path.join(fx.repo, 'test', 'new.test.ts');
  fs.writeFileSync(f, 'new\n');
  const r = runVerify(fx.repo);
  assert.equal(r.out, null);
  assert.equal(fs.readFileSync(f, 'utf8'), 'new\n');
});

test('사용자가 잠금을 풀었으면 바뀐 테스트 파일을 그대로 둔다', () => {
  fs.mkdirSync(path.join(fx.repo, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(fx.repo, '.claude', 'state', 'tests-unlocked.json'), JSON.stringify({ until: Date.now() + 60_000 }));
  const f = path.join(fx.repo, 'test', 'a.test.ts');
  fs.writeFileSync(f, 'edited with permission\n');
  const r = runVerify(fx.repo);
  assert.equal(r.out, null);
  assert.equal(fs.readFileSync(f, 'utf8'), 'edited with permission\n');
});

test('test/ 밖의 파일 변경은 신경 쓰지 않는다', () => {
  fs.writeFileSync(path.join(fx.repo, 'x.txt'), 'x\n');
  assert.equal(runVerify(fx.repo).out, null);
});
