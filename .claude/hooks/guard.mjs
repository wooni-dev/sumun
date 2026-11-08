// [INFRA-1] PreToolUse hook: Claude가 도구를 쓰기 직전에 실행된다.
// 지침(CLAUDE.md)은 권고일 뿐이라, 반드시 지켜야 할 규칙은 여기서 기계적으로 막는다(개발 방식 7~9행, 27행).
//
//  1. 커밋된 테스트 파일 수정 금지  — 사용자가 "테스트 수정 허용"이라고 입력하면 30분간 해제
//  2. hook 상태 폴더(.claude/state/) 쓰기 금지 — 항상
//  3. 같은 테스트가 3회 연속 실패하면 멈춤 — 진행 기록 작성과 읽기 명령만 허용, 사용자가 답하면 초기화
//  C. [INFRA-11] 커밋 메시지 형식(O47) — 표시 파일 .claude/commit-rule.json이 있을 때만. 커밋은 `git commit -F <절대 경로>` 모양만,
//     그 파일은 scripts/commit-msg.mjs로 검사. 실행 뒤 검사(commit-check.mjs)의 기준으로 지금 HEAD·시각을 기록한다
//     (사례·한계: docs/ai/infra11-cases.md)
//  D. [INFRA-13] 커밋 제목 ID가 브랜치에 맞는지(O54) — 표시 파일에 "branch": true일 때만. 제목은 scripts/commit-msg.mjs branchProblems,
//     main의 git merge feat/<ID>는 mergeProblems. 같은 명령 안 위치·브랜치·환경 바꾸기, 다른 경로 -C, 다른 cwd는 막는다
//     (사례·한계: docs/ai/infra13-cases.md)
//
// 판정: 막을 때만 JSON을 출력한다. 아무것도 출력하지 않으면 허용이다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stopped, STOP_AFTER } from '../../scripts/streak.mjs';
import { messageProblems, branchProblems, mergeProblems } from '../../scripts/commit-msg.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = path.join(projectDir, '.claude', 'state');

const WRITE_RE =
  /(>|\btee\b|\bsed\b[^|]*\s-i|\brm\b|\bmv\b|\bcp\b|\bdel\b|\btouch\b|\btruncate\b|Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item|\bgit\s+(checkout|restore|reset|rm|mv|stash|apply)\b|writeFile|appendFile|unlink|rmSync|\[IO\.File\])/i;
// [INFRA-5] 앞 글자에 > , { 추가: `echo x >test/...`, `Remove-Item x,test/...`, `rm {test,x}/...` (우회 사례 26, 29)
const TEST_PATH_RE = /(^|[\s"'=:(\\/>,{])test[\\/]/i;
const STATE_PATH_RE = /\.claude[\\/]state/i;
const TEST_RUN_RE = /\bnpm\s+(run\s+)?test\b|\bnode\s+--test\b|scripts[\\/]test\.mjs/i;
const PROGRESS = 'docs/ai/progress.md';
// [INFRA-5] heredoc을 소비하는 실행기 / 셸 확장 (stripData에서 사용)
const CONSUMER_RE =
  /\b(bash|sh|zsh|dash|ksh|fish|node|deno|bun|tsx|python[\d.]*|py|perl|ruby|php|pwsh|powershell|cmd|xargs|read|source|eval|exec|iex|Invoke-Expression)\b|(^|[;&|]\s*)\.\s/i;
const EXPANDS_RE = /\$\(|`/;
// [INFRA-11] 규칙 C (commitProblem에서 사용 — 아래 함수보다 먼저 초기화되어야 한다)
const COMMIT_RULE_FILE = path.join(projectDir, '.claude', 'commit-rule.json');
const GIT_RE = /^(?:.*[\\/])?git(?:\.exe)?$/i;
const SKIP_WORD_RE = /^(do|then|else|elif|if|while|until|env|command|exec|time|nohup|sudo)$/;
const ENV_ASSIGN_RE = /^[A-Za-z_]\w*=/;
const UNSAFE_PATH_RE = /[$`%~*?(){}<>]/;
const COMMIT_OK_FLAGS = new Set(['-q', '--quiet', '--allow-empty']);
const MSG_COMMIT_SHAPE =
  '커밋은 `git commit -F "<절대 경로>"` 모양만 허용합니다(-q, --allow-empty는 함께 써도 됨. 규칙 C, INFRA-11). 메시지는 Write 도구로 저장소 밖 임시 파일에 쓰세요. ' +
  '-m, --amend, -C, --no-edit, --fixup, 표준입력(-F -), 변수·상대 경로, git 앞의 환경 변수·-c 설정, 같은 명령 안에서 메시지 파일 쓰기는 막습니다.';
// [INFRA-13] 규칙 D (branchRuleProblem·recordHead에서 사용 — 같은 이유로 여기서 초기화)
const gitOut = (args) => execFileSync('git', ['-C', projectDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// 경로 비교(Windows: 대소문자·구분자 무시, Git Bash /d/… 표기)
const normPath = (p) => path.resolve(absPath(p) ?? p).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const CHANGER_WORD_RE = /^(cd|pushd|popd|chdir|set|export|unset|Set-Location|sl|Push-Location|Pop-Location)$/i;
const CHANGER_GIT_RE = /^(checkout|switch|branch|update-ref|symbolic-ref|worktree|rebase)$/;
const MSG_D_SAME_CMD =
  '커밋·병합과 같은 명령 안에서 브랜치·작업 위치·환경 변수를 바꿀 수 없습니다(규칙 D, INFRA-13 — checkout·switch·branch·cd·Set-Location·export·$env: 등). 명령을 둘로 나누세요.';
const firstLine = (s) => s.replace(/^﻿/, '').split(/\r?\n/)[0];

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { tool_name: tool, tool_input: ti = {} } = input;

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

const readJson = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
  } catch {
    return null;
  }
};

const rel = (p) => path.relative(projectDir, path.resolve(projectDir, p)).replaceAll('\\', '/');
const unlocked = () => (readJson('tests-unlocked.json')?.until ?? 0) > Date.now();
const streakHit = stopped(readJson('test-streak.json')?.counts ?? {});

function isCommittedTest(r) {
  if (!r.startsWith('test/')) return false;
  try {
    execFileSync('git', ['-C', projectDir, 'cat-file', '-e', `HEAD:${r}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const MSG_TEST =
  '커밋된 테스트 파일은 수정할 수 없습니다(개발 방식: 개발 중 테스트를 고쳐서 통과시키지 않는다). 테스트가 틀렸다고 판단되면 멈추고, 이유를 사용자에게 보고하세요. 사용자가 "테스트 수정 허용"이라고 입력하면 30분간 풀립니다.';
const MSG_STATE = 'hook 상태 폴더(.claude/state/)는 프로그램과 사용자 입력으로만 바뀝니다. Claude는 직접 쓸 수 없습니다.';
const msgStreak = () =>
  `같은 테스트가 ${STOP_AFTER}회 연속 실패해서 멈춘 상태입니다: ${streakHit.map(([k, n]) => `${k}(${n}회)`).join(', ')}. ` +
  `코드 수정과 테스트 재실행은 막혀 있습니다. 시도한 것과 막힌 이유를 ${PROGRESS}에 기록하고 사용자에게 보고하세요. 사용자가 답하면 초기화됩니다.`;

if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const r = rel(ti.file_path ?? ti.notebook_path ?? '');
  if (r.startsWith('.claude/state/')) deny(MSG_STATE);
  if (streakHit.length && r !== PROGRESS) deny(msgStreak());
  if (isCommittedTest(r) && !unlocked()) deny(MSG_TEST);
} else if (['Bash', 'PowerShell'].includes(tool)) {
  const cmd = String(ti.command ?? '');
  // 2>&1, >/dev/null 같은 출력 정리는 파일 쓰기가 아니므로 빼고 판단한다
  // [INFRA-5] `>&1/../test/x`처럼 숫자 뒤에 경로가 이어지면 파일 쓰기라서 지우지 않는다 (우회 사례 24)
  const cleaned = stripData(cmd, tool)
    .replace(/\d*>&\d(?![\w./\\-])/g, '')
    .replace(/\d*>\s*(\/dev\/null|\$null|NUL)\b/gi, '');
  const writes = WRITE_RE.test(cleaned);
  if (writes && STATE_PATH_RE.test(cleaned)) deny(MSG_STATE);
  if (streakHit.length && TEST_RUN_RE.test(cmd)) deny(msgStreak());
  if (writes && TEST_PATH_RE.test(cleaned) && !unlocked()) deny(MSG_TEST);
  // [INFRA-11] 규칙 C: 기록은 막는 판정보다 먼저(막히면 명령이 실행되지 않으니 기록이 남아도 해가 없다)
  if (fs.existsSync(COMMIT_RULE_FILE)) {
    recordHead();
    const why = commitProblem(cmd, tool);
    if (why) deny(why);
    // [INFRA-13] 규칙 D: 형식(규칙 C)을 통과한 커밋·병합만 본다
    if (ruleDOn()) {
      const whyD = branchRuleProblem(cmd, tool);
      if (whyD) deny(whyD);
    }
  }
}

// [INFRA-11] 실행 뒤 검사(commit-check.mjs)의 기준: 이 명령 직전의 HEAD와 시각
function recordHead() {
  try {
    const head = execFileSync('git', ['-C', projectDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    fs.mkdirSync(stateDir, { recursive: true });
    // [INFRA-13] 규칙 D의 실행 뒤 검사 기준: 브랜치(detached면 null)와 HEAD reflog 항목 수
    const rec = { head, at: Date.now() };
    if (ruleDOn()) Object.assign(rec, { branch: currentBranch(), reflog: reflogCount() });
    fs.writeFileSync(path.join(stateDir, 'commit-check.json'), JSON.stringify(rec));
  } catch {}
}

// [INFRA-13] 규칙 D ----------------------------------------------------------
function ruleDOn() {
  try {
    return JSON.parse(fs.readFileSync(COMMIT_RULE_FILE, 'utf8')).branch === true;
  } catch {
    return false;
  }
}
function currentBranch() {
  try {
    return gitOut(['symbolic-ref', '-q', 'HEAD']).trim().replace(/^refs\/heads\//, '') || null;
  } catch {
    return null; // detached HEAD(리베이스 중 포함)
  }
}
function reflogCount() {
  try {
    return gitOut(['reflog', 'show', '--format=%h', 'HEAD']).split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
// 조각의 git 명령: { sub, rest(하위 명령 뒤 낱말), cPath(-C 값) } 또는 null. 앞 낱말이 위치·환경 바꾸기면 changer
function gitOf(words) {
  let i = 0;
  let changer = false;
  while (i < words.length && (SKIP_WORD_RE.test(words[i].v) || /^[({!&]/.test(words[i].v) || ENV_ASSIGN_RE.test(words[i].v))) {
    if (ENV_ASSIGN_RE.test(words[i].v)) changer = true;
    i++;
  }
  const w0 = words[i]?.v ?? '';
  if (CHANGER_WORD_RE.test(w0) || /^\$env:/i.test(w0)) changer = true;
  if (!GIT_RE.test(w0)) return { changer, git: null };
  i++;
  let cPath;
  while (i < words.length && words[i].v.startsWith('-')) {
    if (words[i].v === '-C') {
      cPath = words[i + 1]?.v ?? '';
      i += 2;
    } else i += words[i].v === '-c' ? 2 : 1;
  }
  const sub = words[i]?.v;
  if (CHANGER_GIT_RE.test(sub ?? '')) changer = true;
  return { changer, git: { sub, rest: words.slice(i + 1), cPath } };
}

function fileTitle(p) {
  const abs = p && absPath(p);
  if (!abs) return null;
  try {
    return firstLine(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

// 막을 이유(문구) 또는 null
function branchRuleProblem(cmd, tool) {
  const stripped = segmentsOf(stripData(cmd, tool).replace(/\d*>&\d/g, ' '), tool).map(gitOf);
  // git merge의 -m 값은 stripData가 지우므로 원문에서 읽는다
  const raw = segmentsOf(cmd, tool).map(gitOf);
  const commits = stripped.filter((g) => g.git?.sub === 'commit');
  const merges = raw.filter((g) => g.git?.sub === 'merge');
  if (!commits.length && !merges.length) return null;
  if (stripped.some((g) => g.changer)) return MSG_D_SAME_CMD;
  if (input.cwd && normPath(input.cwd) !== normPath(projectDir))
    return `작업 위치(${input.cwd})가 이 저장소(${projectDir})가 아니라서 커밋·병합을 막습니다(규칙 D, INFRA-13). 저장소 폴더에서 실행하세요.`;
  for (const g of [...commits, ...merges])
    if (g.git.cPath !== undefined && normPath(g.git.cPath) !== normPath(projectDir))
      return `git -C는 이 저장소 경로(${projectDir})만 됩니다(규칙 D, INFRA-13): ${g.git.cPath}`;
  const branch = currentBranch();
  for (const g of commits) {
    const r = g.git.rest;
    let file;
    for (let i = 0; i < r.length; i++) {
      if (r[i].v === '-F' || r[i].v === '--file') file = r[i + 1]?.v;
      else if (r[i].v.startsWith('--file=')) file = r[i].v.slice(7);
    }
    const title = fileTitle(file);
    if (title === null) continue; // 메시지 파일 문제는 규칙 C가 본다
    const p = branchProblems({ branch, title, unlocked: unlocked() });
    if (p.length) return p.join(' / ');
  }
  for (const g of merges) {
    const r = g.git.rest;
    let title = null;
    const targets = [];
    for (let i = 0; i < r.length; i++) {
      const v = r[i].v;
      if (v === '-F' || v === '--file') title = fileTitle(r[++i]?.v);
      else if (v.startsWith('--file=')) title = fileTitle(v.slice(7));
      else if (v === '-m' || v === '--message') title ??= firstLine(r[++i]?.v ?? '');
      else if (v.startsWith('--message=')) title ??= firstLine(v.slice(10));
      else if (/^-m./.test(v)) title ??= firstLine(v.slice(2));
      else if (!v.startsWith('-') && !/^[)}]+$/.test(v)) targets.push(v);
    }
    for (const target of targets) {
      const p = mergeProblems({ branch, target, title });
      if (p.length) return p.join(' / ');
    }
  }
  return null;
}

// [INFRA-11] 명령을 따옴표 밖의 ; & | 줄바꿈에서 조각으로 나누고, 조각을 낱말로 나눈다.
//   낱말 = { v: 따옴표·이스케이프를 푼 값, raw: 원문 }. Bash는 백슬래시 이스케이프, PowerShell은 아니다(경로 구분자)
function segmentsOf(s, tool) {
  const segs = [];
  let words = [];
  let v = '';
  let raw = '';
  let q = '';
  let has = false;
  const endWord = () => {
    if (has) words.push({ v, raw });
    v = raw = '';
    has = false;
  };
  const endSeg = () => {
    endWord();
    if (words.length) segs.push(words);
    words = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      raw += c;
      if (c === q) q = '';
      else if (q === '"' && c === '\\' && tool === 'Bash' && i + 1 < s.length) v += s[++i], (raw += s[i]);
      else v += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      raw += c;
      has = true;
    } else if (c === '\\' && tool === 'Bash' && i + 1 < s.length) {
      raw += c + s[i + 1];
      v += s[++i];
      has = true;
    } else if (/[;&|\n]/.test(c)) endSeg();
    else if (/\s/.test(c)) endWord();
    else {
      v += c;
      raw += c;
      has = true;
    }
  }
  endSeg();
  return segs;
}

// [INFRA-11] 규칙 C 판정. 막을 이유(문구) 또는 null
function commitProblem(cmd, tool) {
  // heredoc·here-string 본문 같은 데이터는 stripData로 지운다(메시지 내용을 명령에서 읽지 않으므로 지워도 판정은 그대로다 — -m·-F -는 내용과 상관없이 막는다)
  const text = stripData(cmd, tool).replace(/\d*>&\d/g, ' ');
  for (const words of segmentsOf(text, tool)) {
    let i = 0;
    let envPrefix = false;
    while (i < words.length && (SKIP_WORD_RE.test(words[i].v) || /^[({!]/.test(words[i].v) || ENV_ASSIGN_RE.test(words[i].v))) {
      if (ENV_ASSIGN_RE.test(words[i].v)) envPrefix = true;
      i++;
    }
    if (i >= words.length || !GIT_RE.test(words[i].v)) continue;
    i++;
    // git 전역 옵션: --no-pager·-P와 절대 경로 -C만 허용
    let badGlobal = false;
    while (i < words.length && words[i].v.startsWith('-')) {
      const o = words[i].v;
      if (o === '-C') {
        const p = words[i + 1];
        if (!p || UNSAFE_PATH_RE.test(p.raw) || !absPath(p.v)) badGlobal = true;
        i += 2;
      } else {
        if (o !== '--no-pager' && o !== '-P') badGlobal = true;
        i += o === '-c' ? 2 : 1;
      }
    }
    if (words[i]?.v !== 'commit') continue;
    i++;
    if (envPrefix || badGlobal) return MSG_COMMIT_SHAPE;
    let file;
    let count = 0;
    for (; i < words.length; i++) {
      const w = words[i];
      if (w.v === '-h' || w.v === '--help') return null;
      if (COMMIT_OK_FLAGS.has(w.v) || /^[)}]+$/.test(w.v)) continue;
      if (/^\d*>>?$/.test(w.v)) {
        i++; // 출력 리다이렉트와 그 대상
        continue;
      }
      if (w.v === '-F' || w.v === '--file') {
        file = words[++i];
        count++;
      } else if (w.v.startsWith('--file=')) {
        file = { v: w.v.slice(7), raw: w.raw.slice(w.raw.indexOf('=') + 1) };
        count++;
      } else return MSG_COMMIT_SHAPE;
    }
    if (count !== 1 || !file || file.v === '-' || UNSAFE_PATH_RE.test(file.raw)) return MSG_COMMIT_SHAPE;
    const abs = absPath(file.v);
    if (!abs) return MSG_COMMIT_SHAPE;
    const base = abs.split(/[\\/]/).pop();
    if (cmd.split(base).length - 1 > 1) return `${MSG_COMMIT_SHAPE} (메시지 파일 이름 ${base}이 명령에 두 번 이상 나옵니다)`;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return `메시지 파일을 읽을 수 없습니다(규칙 C): ${abs}`;
    }
    const problems = messageProblems(buf);
    if (problems.length) return `커밋 메시지 형식이 틀렸습니다(규칙 C, CLAUDE.md "커밋 메시지 형식"): ${problems.join(' / ')}`;
  }
  return null;
}

// 드라이브 문자로 시작하는 절대 경로(C:/…, C:\…), Git Bash 표기 /c/…. 그 밖(상대 경로, /tmp)은 undefined
function absPath(p) {
  if (/^[A-Za-z]:[\\/]/.test(p)) return p;
  const m = p.match(/^\/([A-Za-z])\/(.*)$/);
  return m ? `${m[1].toUpperCase()}:/${m[2]}` : undefined;
}

// [INFRA-3 → INFRA-5] 명령 안의 "데이터"를 지운다. 데이터 안의 '>'나 경로는 파일 쓰기가 아니다.
// (예: 커밋 메시지의 "<noreply@anthropic.com>"를 리다이렉트로 오해하던 오탐)
//
// INFRA-5: 데이터인지 "실행될 코드"인지 확실하지 않으면 지우지 않는다(지우지 않으면 검사 대상으로 남을 뿐이다).
//  - heredoc 본문을 셸이나 인터프리터가 소비하면 코드다 (bash <<EOF, node <<EOF, xargs, while read …)
//  - 따옴표 없는 heredoc이나 큰따옴표 안의 $( ), 백틱은 실행된다
//  - here-string을 파이프로 넘기거나 iex로 실행하면 코드다
// 이 검사로 못 막는 우회는 실행 후 검사(verify-tests.mjs)가 결과로 잡는다.
// (CONSUMER_RE, EXPANDS_RE는 파일 위쪽에 선언. 아래에 두면 초기화 전에 쓰여 오류가 난다)
function stripData(s, tool) {
  const lineBefore = (str, offset) => str.slice(str.lastIndexOf('\n', offset - 1) + 1, offset);

  if (tool === 'Bash') {
    // heredoc: <<'EOF' 표식 줄의 나머지(리다이렉트 등)는 남기고 본문만 지운다. <<<(here-string)는 heredoc이 아니다.
    s = s.replace(/(^|[^<])<<-?(?!<)[ \t]*(['"]?)([A-Za-z_]\w*)\2([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g, (m, pre, q, tag, rest, body, offset) => {
      const line = lineBefore(s, offset) + pre + rest;
      if (CONSUMER_RE.test(line)) return m;
      if (!q && EXPANDS_RE.test(body)) return m;
      return `${pre}<<${tag}${rest}`;
    });
  }

  if (tool === 'PowerShell') {
    // here-string: @' ... '@ / @" ... "@
    s = s.replace(/@(['"])\r?\n([\s\S]*?)\r?\n\1@([^\n]*)/g, (m, q, body, rest, offset) => {
      const prefix = lineBefore(s, offset);
      if (rest.includes('|') || /\b(iex|Invoke-Expression|pwsh|powershell)\b|[&.]\s*$/i.test(prefix)) return m;
      if (q === '"' && /\$\(/.test(body)) return m;
      return `@HERE@${rest}`;
    });
  }

  // -m "..." / --message='...' 는 git commit/tag/merge의 메시지일 때만 데이터다 (git checkout -m 은 플래그라서 아님)
  if (/\bgit\s+(commit|tag|merge)\b/i.test(s)) {
    // PowerShell에서는 \" 가 이스케이프가 아니다 (우회 사례 14)
    const quoted = tool === 'PowerShell' ? `"[^"]*"|'[^']*'` : `"(?:[^"\\\\]|\\\\.)*"|'[^']*'`;
    s = s.replace(new RegExp(`(^|\\s)(-m|--message)(\\s+|=)(${quoted})`, 'g'), (m, pre, flag, sep, arg) =>
      arg.startsWith('"') && EXPANDS_RE.test(arg) ? m : `${pre}${flag} MSG`,
    );
  }
  return s;
}
