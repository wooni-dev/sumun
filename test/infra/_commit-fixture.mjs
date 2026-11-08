// [INFRA-11] 규칙 C(커밋 메시지 형식) 테스트 도우미: 임시 저장소, 메시지 파일, guard.mjs(실행 전)·commit-check.mjs(실행 뒤) 판정
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '../../.claude/hooks');
export const GOOD = '[X-1] 제목\n\n- 왜: 이유\n- 검증: npm test → 1 / 1\n\nCo-Authored-By: A <a@b.c>\n';

// marker: 규칙 C를 켜는 표시 파일(.claude/commit-rule.json)을 둘지
export function makeRepo({ marker = true } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-cmsg-repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'x@example.com');
  git('config', 'user.name', 'x');
  fs.mkdirSync(path.join(repo, '.claude', 'state'), { recursive: true });
  if (marker) fs.writeFileSync(path.join(repo, '.claude', 'commit-rule.json'), '{ "enabled": true }\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', '[X-0] 시작\n\n- 왜: a\n- 검증: b');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-cmsg-'));
  let n = 0;
  // 메시지 파일(저장소 밖). 돌려주는 경로는 / 구분의 절대 경로(C:/…)
  const msg = (content) => {
    const p = path.join(dir, `m${n++}.txt`);
    fs.writeFileSync(p, content);
    return p.replaceAll('\\', '/');
  };
  // 메시지를 직접 넣어 커밋(hook을 거치지 않음 — 실행 뒤 검사가 볼 커밋을 만든다)
  let k = 0;
  const commit = (message, env = {}) => {
    fs.writeFileSync(path.join(repo, `f${k++}.txt`), String(k));
    git('add', '-A');
    execFileSync('git', ['-C', repo, 'commit', '-q', '-F', '-'], { input: message, env: { ...process.env, ...env }, stdio: ['pipe', 'ignore', 'ignore'] });
    return git('rev-parse', '--short', 'HEAD');
  };
  const cleanup = () => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { repo, git, msg, commit, cleanup };
}

function run(hook, repo, input) {
  const r = spawnSync('node', [path.join(HOOKS, hook)], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, encoding: 'utf8', cwd: repo });
  if (r.status !== 0) throw new Error(`${hook} 비정상 종료 (${r.status}): ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

// 실행 전: { decision: 'allow' | 'deny', reason }
export function pre(repo, tool_name, command) {
  const out = run('guard.mjs', repo, { hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: repo });
  const h = out?.hookSpecificOutput;
  return { decision: h?.permissionDecision ?? 'allow', reason: h?.permissionDecisionReason ?? '' };
}

// 실행 뒤: 알림이 있으면 { decision, reason }, 없으면 null
export function post(repo, tool_name = 'Bash', command = 'git status') {
  const out = run('commit-check.mjs', repo, { hook_event_name: 'PostToolUse', tool_name, tool_input: { command }, tool_response: {}, cwd: repo });
  return out ? { decision: out.decision, reason: out.reason ?? '' } : null;
}
