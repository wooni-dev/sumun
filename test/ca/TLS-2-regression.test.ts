// [TLS-2] 회귀: 구현 전에도 통과해야 정상(O9). 사례 번호는 docs/ai/tls2-cases.md.
//   C45 .gitignore가 CA 파일 이름을 무시한다 / C47 git이 추적하는 파일에 개인키 PEM이 없다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args: string[]) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });

test('C45: ca-cert.pem·ca-key.pem은 저장소 어디에 있어도 git이 무시한다(어떤 규칙에 걸리는지까지)', () => {
  for (const f of ['ca-key.pem', 'ca-cert.pem', 'src/ca/ca-key.pem', 'some/dir/ca/ca-key.pem']) {
    const r = git('check-ignore', '-v', '--no-index', f);
    assert.equal(r.status, 0, `${f}: 무시되지 않음`);
    assert.match(r.stdout, /\.gitignore:\d+:\*\.pem/, f);
  }
  // 전제: 무시되지 않는 파일은 status 1로 구분된다
  assert.equal(git('check-ignore', '--no-index', 'src/ca/ca.ts').status, 1);
});

test('C47: git이 추적하는 파일 어디에도 개인키 PEM 머리말이 없다', () => {
  const header = ['-----BEGIN', '(RSA |EC |ENCRYPTED )?PRIVATE KEY-----'].join(' ');
  const r = git('grep', '-l', '-E', '-e', header); // -e: 패턴이 "-----"로 시작해 옵션으로 읽히지 않게
  assert.equal(r.status, 1, `개인키 머리말이 든 추적 파일: ${r.stdout}`);
  // 전제: 같은 검색이 있는 것은 찾는다(추적 중인 CLAUDE.md의 문장)
  const hit = git('grep', '-l', '-E', '-e', '루트 CA 개인키는 저장소 밖');
  assert.equal(hit.status, 0);
  assert.match(hit.stdout, /CLAUDE\.md/);
});
