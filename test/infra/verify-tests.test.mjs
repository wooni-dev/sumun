// [INFRA-5] 새 동작: 명령 실행 후, 잠금 상태에서 커밋된 테스트 파일이 바뀌었으면 HEAD로 복구하고 차단 사유를 돌려준다.
// 명령을 어떻게 썼든(glob, cd, python, base64 …) 결과는 git이 알려 준다.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo } from './_hook-fixture.mjs';
import { runVerify } from './_verify-fixture.mjs';

let fx;
let file;
const ORIGINAL = '// committed test\n';
beforeEach(() => {
  fx = makeRepo();
  file = path.join(fx.repo, 'test', 'a.test.ts');
});
afterEach(() => fx.cleanup());

test('커밋된 테스트 파일 내용이 바뀌면 HEAD 내용으로 복구하고 block을 돌려준다', () => {
  fs.writeFileSync(file, 'tampered\n');
  const r = runVerify(fx.repo, 'rm te?t/a.test.ts');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out?.decision, 'block');
  assert.match(r.out.reason, /test\/a\.test\.ts/);
  assert.equal(fs.readFileSync(file, 'utf8'), ORIGINAL);
});

test('커밋된 테스트 파일이 삭제되면 되살리고 block을 돌려준다', () => {
  fs.rmSync(file);
  const r = runVerify(fx.repo, 'cd test && rm a.test.ts');
  assert.equal(r.out?.decision, 'block');
  assert.equal(fs.readFileSync(file, 'utf8'), ORIGINAL);
});
