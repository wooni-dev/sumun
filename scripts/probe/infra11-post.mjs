// [INFRA-11] 실측: 실행 뒤 hook(commit-check.mjs)이 실제 세션에서 도는지.
//   node scripts/probe/infra11-post.mjs          → 임시 브랜치 probe/infra11-post를 만들고, 형식이 틀린 빈 커밋 하나(실행 전 검사가 못 보는 경로: node가 git을 부름)
//   node scripts/probe/infra11-post.mjs cleanup  → 원래 브랜치로 돌아가고 임시 브랜치를 지운다
// 기대: 첫 명령 뒤 Claude Code에 "규칙 C(INFRA-11): 방금 형식이 틀린 커밋이 생겼습니다 → <해시>" 알림
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const BRANCH = 'probe/infra11-post';
const back = path.join(root, '.git', 'infra11-probe-back');

if (process.argv[2] === 'cleanup') {
  const to = fs.readFileSync(back, 'utf8').trim();
  git('checkout', '-q', to);
  git('branch', '-D', BRANCH);
  fs.rmSync(back);
  console.log(`돌아감: ${to}, 지움: ${BRANCH}`);
} else {
  fs.writeFileSync(back, git('branch', '--show-current'));
  git('checkout', '-q', '-b', BRANCH);
  git('commit', '-q', '--allow-empty', '-m', 'probe: 형식이 틀린 메시지');
  console.log(`만든 커밋: ${git('rev-parse', '--short', 'HEAD')} (${BRANCH})`);
}
