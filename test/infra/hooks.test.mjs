// [INFRA-1] 1차 hook 테스트
// guard.mjs(PreToolUse)와 on-prompt.mjs(UserPromptSubmit)를 실제 프로세스로 실행해서 판정을 확인한다.
// 실제 저장소 대신 임시 git 저장소(fixture)를 CLAUDE_PROJECT_DIR로 넘긴다.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '../../.claude/hooks');
let repo;
let stateDir;

function git(...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-hook-'));
  stateDir = path.join(repo, '.claude', 'state');
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, 'test'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'test', 'a.test.ts'), '// committed test\n');
  fs.writeFileSync(path.join(repo, 'src', 'x.ts'), '// src\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
});

after(() => fs.rmSync(repo, { recursive: true, force: true }));

beforeEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

function run(script, payload) {
  const r = spawnSync('node', [path.join(HOOKS, script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `hook 프로세스가 정상 종료해야 함. stderr: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

function decision(payload) {
  const out = run('guard.mjs', { hook_event_name: 'PreToolUse', ...payload });
  return out?.hookSpecificOutput?.permissionDecision ?? 'allow';
}

const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path, content: 'x' } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const pwsh = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });

function writeState(name, data) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, name), JSON.stringify(data));
}

// --- 테스트 파일 수정 차단 ---

test('커밋된 테스트 파일 Edit는 차단한다', () => {
  assert.equal(decision(edit(path.join(repo, 'test', 'a.test.ts'))), 'deny');
});

test('Windows 역슬래시 절대 경로로 와도 차단한다', () => {
  assert.equal(decision(edit(`${repo}\\test\\a.test.ts`.replaceAll('/', '\\'))), 'deny');
});

test('커밋된 테스트 파일을 Write로 덮어쓰는 것도 차단한다', () => {
  assert.equal(decision(write(path.join(repo, 'test', 'a.test.ts'))), 'deny');
});

test('아직 커밋되지 않은 새 테스트 파일 작성은 허용한다', () => {
  assert.equal(decision(write(path.join(repo, 'test', 'new.test.ts'))), 'allow');
});

test('src 파일 Edit는 허용한다', () => {
  assert.equal(decision(edit(path.join(repo, 'src', 'x.ts'))), 'allow');
});

test('유효한 해제 상태에서는 커밋된 테스트 Edit를 허용한다', () => {
  writeState('tests-unlocked.json', { until: Date.now() + 60_000 });
  assert.equal(decision(edit(path.join(repo, 'test', 'a.test.ts'))), 'allow');
});

test('만료된 해제 상태는 무시하고 차단한다', () => {
  writeState('tests-unlocked.json', { until: Date.now() - 1 });
  assert.equal(decision(edit(path.join(repo, 'test', 'a.test.ts'))), 'deny');
});

test('셸로 테스트 파일을 고치는 명령(sed -i)은 차단한다', () => {
  assert.equal(decision(bash('sed -i s/a/b/ test/a.test.ts')), 'deny');
});

test('PowerShell Set-Content로 테스트 파일을 고치는 것도 차단한다', () => {
  assert.equal(decision(pwsh('Set-Content test\\a.test.ts "x"')), 'deny');
});

test('테스트 실행 명령(2>&1 포함)은 허용한다', () => {
  assert.equal(decision(bash('node --test test/ 2>&1')), 'allow');
});

test('git add test/... 는 허용한다', () => {
  assert.equal(decision(bash('git add test/a.test.ts')), 'allow');
});

// --- hook 상태 파일 보호 (해제 여부와 상관없이 항상) ---

test('상태 폴더 파일을 Edit/Write로 만드는 것은 항상 차단한다', () => {
  writeState('tests-unlocked.json', { until: Date.now() + 60_000 });
  assert.equal(decision(write(path.join(stateDir, 'tests-unlocked.json'))), 'deny');
});

test('셸로 상태 폴더에 쓰는 것도 항상 차단한다', () => {
  assert.equal(decision(bash('echo {} > .claude/state/tests-unlocked.json')), 'deny');
});

// --- 같은 테스트 연속 실패 시 멈춤 ---

test('연속 실패가 3회에 도달하면 코드 Edit를 차단한다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 3 } });
  assert.equal(decision(edit(path.join(repo, 'src', 'x.ts'))), 'deny');
});

test('연속 실패 상태에서도 진행 기록(progress.md) 작성은 허용한다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 3 } });
  assert.equal(decision(edit(path.join(repo, 'docs', 'ai', 'progress.md'))), 'allow');
});

test('연속 실패 상태에서 테스트를 다시 실행하는 것은 차단한다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 3 } });
  assert.equal(decision(bash('npm test')), 'deny');
});

test('연속 실패 상태에서도 읽기 명령(git status)은 허용한다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 3 } });
  assert.equal(decision(bash('git status')), 'allow');
});

test('연속 실패 2회까지는 차단하지 않는다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 2 } });
  assert.equal(decision(edit(path.join(repo, 'src', 'x.ts'))), 'allow');
});

// --- 사용자 입력 hook ---

test('사용자가 "테스트 수정 허용"이라고 쓰면 30분 해제 상태를 만든다', () => {
  run('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '이유 확인했어. 테스트 수정 허용' });
  const s = JSON.parse(fs.readFileSync(path.join(stateDir, 'tests-unlocked.json'), 'utf8'));
  const remain = s.until - Date.now();
  assert.ok(remain > 29 * 60_000 && remain <= 30 * 60_000, `남은 시간: ${remain}ms`);
});

test('사용자가 "테스트 잠금"이라고 쓰면 해제 상태를 지운다', () => {
  writeState('tests-unlocked.json', { until: Date.now() + 60_000 });
  run('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '테스트 잠금' });
  assert.equal(fs.existsSync(path.join(stateDir, 'tests-unlocked.json')), false);
});

test('사용자가 무엇이든 입력하면 연속 실패 카운터를 초기화한다', () => {
  writeState('test-streak.json', { counts: { 'test/a.test.ts::x': 3 } });
  run('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '계속해' });
  const s = JSON.parse(fs.readFileSync(path.join(stateDir, 'test-streak.json'), 'utf8'));
  assert.deepEqual(s.counts, {});
});
