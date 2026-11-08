// [INFRA-13] 규칙 D(브랜치·제목 ID 일치) 테스트 도우미: 키 "branch"로 켠 임시 저장소, 브랜치 바꾸기, cwd를 고른 hook 실행
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo } from './_commit-fixture.mjs';

const HOOKS = path.resolve(import.meta.dirname, '../../.claude/hooks');

// 형식(규칙 C)이 맞는 메시지. 제목만 바꾼다
export const msgOf = (title) => `${title}\n\n- 왜: 이유\n- 검증: npm test → 1 / 1\n`;

// branch: 규칙 D 키를 둘지. on: 시작 브랜치(없으면 main)
export function makeBranchRepo({ branch = true, on } = {}) {
  const fx = makeRepo();
  fs.writeFileSync(path.join(fx.repo, '.claude', 'commit-rule.json'), JSON.stringify(branch ? { enabled: true, branch: true } : { enabled: true }) + '\n');
  if (on) fx.git('checkout', '-q', '-b', on);
  // 테스트 수정 허용 상태(on-prompt.mjs가 쓰는 파일과 같은 모양)
  fx.unlock = (on2 = true) => fs.writeFileSync(path.join(fx.repo, '.claude', 'state', 'tests-unlocked.json'), JSON.stringify({ until: on2 ? Date.now() + 600_000 : 0 }));
  return fx;
}

export function withBranchRepo(opts, fn) {
  const fx = makeBranchRepo(opts);
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}

function run(hook, repo, input) {
  const r = spawnSync('node', [path.join(HOOKS, hook)], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, encoding: 'utf8', cwd: repo });
  if (r.status !== 0) throw new Error(`${hook} 비정상 종료 (${r.status}): ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

// 실행 전: { decision: 'allow' | 'deny', reason }. cwd = hook 입력의 cwd(기본 저장소)
export function preAt(repo, tool_name, command, { cwd = repo } = {}) {
  const out = run('guard.mjs', repo, { hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd });
  const h = out?.hookSpecificOutput;
  return { decision: h?.permissionDecision ?? 'allow', reason: h?.permissionDecisionReason ?? '' };
}

// 실행 뒤: 알림이 있으면 { decision, reason }, 없으면 null
export function postAt(repo) {
  const out = run('commit-check.mjs', repo, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, tool_response: {}, cwd: repo });
  return out ? { decision: out.decision, reason: out.reason ?? '' } : null;
}
