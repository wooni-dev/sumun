// [INFRA-5] verify-tests.mjs(PostToolUse) 테스트 도우미
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HOOK = path.resolve(import.meta.dirname, '../../.claude/hooks/verify-tests.mjs');

// 실행 후 hook을 돌리고 { status, out(JSON 또는 null) }을 돌려준다
export function runVerify(repo, command = 'echo') {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: {} }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
