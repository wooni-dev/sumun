// [INFRA-3] hook 테스트 공통 도우미: 임시 git 저장소를 만들고 guard.mjs 판정을 돌려준다.
// (hooks.test.mjs는 커밋된 테스트라 수정하지 않고, 새 테스트에서만 이 도우미를 쓴다)
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '../../.claude/hooks');

export function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-hook-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'test', 'a.test.ts'), '// committed test\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
  return { repo, cleanup: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

export function guardDecision(repo, tool_name, command) {
  const r = spawnSync('node', [path.join(HOOKS, 'guard.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`guard.mjs 비정상 종료 (${r.status}): ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
}
