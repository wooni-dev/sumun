// [INFRA-11] PostToolUse hook(Bash|PowerShell): 규칙 C의 실행 뒤 검사(O47, 사용자 결정 D3).
// guard.mjs가 명령 직전에 기록한 HEAD·시각(.claude/state/commit-check.json) 뒤에 새로 생긴 병합 아닌 커밋의
// 실제 메시지(git이 저장한 바이트)를 scripts/commit-msg.mjs로 검사한다. 실행 전 검사가 못 보는 경로
// (별칭, cherry-pick·revert·am, sh -c, 스크립트 안의 커밋, git이 저장하며 바꾼 메시지)를 여기서 잡는다.
// 이미 생긴 커밋은 되돌리지 않는다 — 알리고 멈추게 한다(되돌리기는 사용자가 정한다, 한계 L2).
// 표시 파일 .claude/commit-rule.json이 없으면 아무것도 하지 않는다(D6).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { messageProblems } from '../../scripts/commit-msg.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function main() {
  try {
    fs.readFileSync(0); // 입력은 쓰지 않는다(기록이 기준)
  } catch {}
  if (!fs.existsSync(path.join(projectDir, '.claude', 'commit-rule.json'))) return;
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'state', 'commit-check.json'), 'utf8'));
  } catch {
    return; // 기록이 없으면 기준이 없다
  }
  const git = (args, encoding = 'utf8') => execFileSync('git', ['-C', projectDir, ...args], { encoding, stdio: ['ignore', 'pipe', 'ignore'] });
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    return;
  }
  if (!rec?.head || head === rec.head) return;
  let lines;
  try {
    // 기록한 HEAD에서 닿지 않는 새 커밋 중 병합이 아닌 것. 시각 = 커밋한 시각(초)
    lines = git(['rev-list', '--no-merges', '--format=%h %ct', `${rec.head}..HEAD`]).split('\n');
  } catch {
    return;
  }
  const since = Math.floor((rec.at ?? 0) / 1000);
  const bad = [];
  for (const l of lines) {
    const m = l.match(/^([0-9a-f]{4,}) (\d+)$/);
    if (!m || Number(m[2]) < since) continue; // 옮겨 간 브랜치의 옛 커밋은 보지 않는다
    const msg = git(['log', '-1', '--format=%B', m[1]], 'buffer');
    // %B 끝에 git이 붙이는 줄바꿈 하나는 메시지가 아니다
    const body = msg.length && msg[msg.length - 1] === 0x0a ? msg.subarray(0, msg.length - 1) : msg;
    const problems = messageProblems(body);
    if (problems.length) bad.push(`${m[1]}: ${problems.join(' / ')}`);
  }
  if (!bad.length) return;
  const reason =
    `규칙 C(INFRA-11): 방금 형식이 틀린 커밋이 생겼습니다 → ${bad.join(' | ')}. ` +
    '이미 생긴 커밋이므로 고치지 말고 멈추세요. 무엇이 생겼는지 docs/ai/progress.md에 기록하고 사용자에게 보고해 되돌릴지 정하세요.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

main();
