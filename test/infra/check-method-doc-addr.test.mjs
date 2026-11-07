// [INFRA-7] user-doc-lines: 주소:포트, URL은 파일:줄이 아니다 (INFRA-6 감사 지적)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommits } from '../../scripts/check-method.mjs';

const MSG = '- 왜: 이유\n- 검증: 결과';
const COMMITS = [
  { hash: 'a1', subject: '[PRX-1] 테스트: x', body: MSG, files: ['test/PRX-1.test.ts'] },
  { hash: 'b2', subject: '[PRX-1] 문서', body: MSG, files: ['docs/for-me/PRX-1.md', 'docs/ai/progress.md', 'docs/ai/purpose-tree.md'] },
];
const linesRule = (section) =>
  checkCommits({ id: 'PRX-1', commits: COMMITS, docExists: true, docText: `# x\n\n## 먼저 볼 코드\n${section}\n\n## 파일별 변경\n` }).find((r) => r.rule === 'user-doc-lines');

for (const [name, section] of [
  ['IP 주소:포트', '- `127.0.0.1:8080` 으로 프록시를 연다'],
  ['호스트:포트', '- `localhost:3000` 대시보드'],
  ['URL', '- `http://localhost:8080` 으로 접속'],
]) {
  test(`${name}만 있으면 파일:줄로 인정하지 않는다`, () => {
    assert.equal(linesRule(section).ok, false, linesRule(section).detail);
  });
}
