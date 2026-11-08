// [INFRA-11] PostToolUse hook(Bash|PowerShell): 규칙 C의 실행 뒤 검사(O47, 사용자 결정 D3).
// guard.mjs가 명령 직전에 기록한 HEAD·시각(.claude/state/commit-check.json) 뒤에 새로 생긴 병합 아닌 커밋의
// 실제 메시지(git이 저장한 바이트)를 scripts/commit-msg.mjs로 검사한다. 실행 전 검사가 못 보는 경로
// (별칭, cherry-pick·revert·am, sh -c, 스크립트 안의 커밋, git이 저장하며 바꾼 메시지)를 여기서 잡는다.
// 이미 생긴 커밋은 되돌리지 않는다 — 알리고 멈추게 한다(되돌리기는 사용자가 정한다, 한계 L2).
// 표시 파일 .claude/commit-rule.json이 없으면 아무것도 하지 않는다(D6).
// [INFRA-13] 규칙 D(표시 파일에 "branch": true): guard가 기록한 브랜치·HEAD reflog 항목 수 뒤의 새 reflog 항목으로
// 명령 중 생긴 커밋을 찾는다. 그 사이 checkout이 있었거나 브랜치가 바뀌었으면 알리고, 아니면 제목을 branchProblems로 본다
// (Q8, docs/ai/infra13-cases.md). 병합 커밋은 보지 않는다(L10).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { messageProblems, branchProblems } from '../../scripts/commit-msg.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = path.join(projectDir, '.claude', 'state');
// 커밋을 만드는 reflog 항목(병합 "commit (merge)"·"merge …"은 빼고)
const MADE_RE = /^(commit( \((amend|initial)\))?|cherry-pick|revert|am|rebase \((pick|reword|squash|fixup|edit|continue)\)):/;

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

function main() {
  try {
    fs.readFileSync(0); // 입력은 쓰지 않는다(기록이 기준)
  } catch {}
  const marker = path.join(projectDir, '.claude', 'commit-rule.json');
  if (!fs.existsSync(marker)) return;
  const rec = readJson(path.join(stateDir, 'commit-check.json'));
  if (!rec) return; // 기록이 없으면 기준이 없다
  const git = (args, encoding = 'utf8') => execFileSync('git', ['-C', projectDir, ...args], { encoding, stdio: ['ignore', 'pipe', 'ignore'] });
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    return;
  }
  const reasons = [];
  const bad = ruleC(rec, head, git);
  if (bad.length)
    reasons.push(
      `규칙 C(INFRA-11): 방금 형식이 틀린 커밋이 생겼습니다 → ${bad.join(' | ')}.`,
    );
  const badD = readJson(marker)?.branch === true ? ruleD(rec, git) : [];
  if (badD.length) reasons.push(`규칙 D(INFRA-13): 방금 브랜치에 맞지 않는 커밋이 생겼습니다 → ${badD.join(' | ')}.`);
  if (!reasons.length) return;
  const reason =
    `${reasons.join(' ')} ` +
    '이미 생긴 커밋이므로 고치지 말고 멈추세요. 무엇이 생겼는지 docs/ai/progress.md에 기록하고 사용자에게 보고해 되돌릴지 정하세요.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function ruleC(rec, head, git) {
  if (!rec.head || head === rec.head) return [];
  let lines;
  try {
    // 기록한 HEAD에서 닿지 않는 새 커밋 중 병합이 아닌 것. 시각 = 커밋한 시각(초)
    lines = git(['rev-list', '--no-merges', '--format=%h %ct', `${rec.head}..HEAD`]).split('\n');
  } catch {
    return [];
  }
  const since = Math.floor((rec.at ?? 0) / 1000);
  const bad = [];
  for (const l of lines) {
    const m = l.match(/^([0-9a-f]{4,}) (\d+)$/);
    if (!m || Number(m[2]) < since) continue; // 옮겨 간 브랜치의 옛 커밋은 보지 않는다
    const problems = messageProblems(bodyOf(git, m[1]));
    if (problems.length) bad.push(`${m[1]}: ${problems.join(' / ')}`);
  }
  return bad;
}

// %B 끝에 git이 붙이는 줄바꿈 하나는 메시지가 아니다
function bodyOf(git, hash) {
  const msg = git(['log', '-1', '--format=%B', hash], 'buffer');
  return msg.length && msg[msg.length - 1] === 0x0a ? msg.subarray(0, msg.length - 1) : msg;
}

function ruleD(rec, git) {
  if (typeof rec.reflog !== 'number') return [];
  let all;
  try {
    all = git(['reflog', 'show', '--format=%h%x09%gs', 'HEAD']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const n = all.length - rec.reflog;
  if (n <= 0) return [];
  const entries = all.slice(0, n).map((l) => {
    const t = l.indexOf('\t');
    return { h: l.slice(0, t), gs: l.slice(t + 1) };
  });
  const made = entries.filter((e) => MADE_RE.test(e.gs));
  if (!made.length) return [];
  let branch = null;
  try {
    branch = git(['symbolic-ref', '-q', 'HEAD']).trim().replace(/^refs\/heads\//, '') || null;
  } catch {}
  const checkedOut = entries.some((e) => e.gs.startsWith('checkout:'));
  if (checkedOut || branch !== (rec.branch ?? null))
    return [
      `명령 중 브랜치가 바뀐 뒤 커밋이 생겼습니다(명령 전 ${rec.branch ?? 'detached'} → 지금 ${branch ?? 'detached'}${checkedOut ? ', 그 사이 checkout 있음' : ''}): ${made.map((e) => e.h).join(', ')}`,
    ];
  const unlocked = (readJson(path.join(stateDir, 'tests-unlocked.json'))?.until ?? 0) > Date.now();
  const out = [];
  for (const e of made) {
    const title = bodyOf(git, e.h).toString('utf8').split(/\r?\n/)[0];
    const p = branchProblems({ branch, title, unlocked });
    if (p.length) out.push(`${e.h}: ${p.join(' / ')}`);
  }
  return out;
}

main();
