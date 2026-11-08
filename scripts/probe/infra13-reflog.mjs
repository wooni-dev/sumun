// [INFRA-13] 진단: 실행 뒤 검사에서 "다른 브랜치로 가서 커밋하고 돌아옴"(사례 1, 24)이 왜 알리지 않는지 — reflog와 기록을 출력
import { makeBranchRepo, preAt, postAt, msgOf } from '../../test/infra/_branch-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
const fx = makeBranchRepo({ on: 'feat/X-1' });
try {
  fx.git('branch', 'feat/PRX-2b');
  preAt(fx.repo, 'Bash', 'git status');
  console.log('rec', fs.readFileSync(path.join(fx.repo, '.claude', 'state', 'commit-check.json'), 'utf8'));
  fx.git('checkout', '-q', 'feat/PRX-2b');
  fx.commit(msgOf('[PRX-2b] 옛 메시지'));
  fx.git('checkout', '-q', 'feat/X-1');
  console.log(fx.git('reflog', 'show', '--format=%h%x09%gs', 'HEAD'));
  console.log('post', JSON.stringify(postAt(fx.repo)));
} finally {
  if (!process.env.KEEP) fx.cleanup(); else console.log("repo", fx.repo);
}
