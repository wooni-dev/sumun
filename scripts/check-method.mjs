// [INFRA-2] 개발 방식 기계 검사
//   node scripts/check-method.mjs --id PRX-1 [--json]     작은 단위
//   node scripts/check-method.mjs --id PRX [--json]       큰 단위: [PRX-*] 하위 노드를 모아 보고, 큰 단위 규칙을 따로 본다 (INFRA-8, O32)
//
// 커밋 제목이 [ID]로 시작하는 커밋(병합 커밋 제외)을 오래된 순으로 모아서 검사한다.
// 결과는 모두 프로그램이 낸 것이므로 [확인됨]이다. 의미 판단(의도 하나인가, 범위를 벗어났나)은 method-auditor가 한다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_COMMIT = '테스트:';
const PLAN_COMMIT = '계획:';
const PROBE_COMMIT = '실측:'; // [INFRA-8] O35: 계획 뒤, 테스트 전에 둘 수 있는 실측 커밋(scripts/probe/만)
const PROBE_DIR = 'scripts/probe/';
const PROGRESS = 'docs/ai/progress.md';
const TREE = 'docs/ai/purpose-tree.md';

// 계획 커밋 규칙이 처음 적용된 커밋(INFRA-3 계획). 이보다 앞선 작업은 plan-first를 판정하지 않는다(O14)
export const PLAN_RULE_SINCE = '77161c18e74d265ac56eeca3d8bd3863f621ece5'; // [INFRA-7] 커밋이 늘어도 모호하지 않게 전체 해시로

// [INFRA-8] O34: "## 먼저 볼 코드" 절과 그 안의 `파일:줄`
// 파일 부분은 경로(/ 포함)이거나 확장자(.md, .mjs …)로 끝나야 한다. 127.0.0.1:8080, localhost:3000, http://… 은 제외 (INFRA-7)
const FILE_LINE = /`(?![^`]*:\/\/)([^`\s]*(?:\/[^`\s]*|\.[A-Za-z][\w-]*)):(\d+)/g;
function codeSection(docText) {
  const start = docText.indexOf('## 먼저 볼 코드');
  return start < 0 ? undefined : docText.slice(start).split(/\n## /)[0];
}

// basis(O22) = 이 규칙을 어느 시점의 상태로 판정했는가
//   작업 커밋: 이 ID의 커밋들 / 마지막 커밋: 이 ID의 마지막 커밋 / 문서 커밋: 사용자용 문서를 마지막으로 바꾼 커밋 / HEAD: 지금
export function checkCommits({ id, commits, docExists, docText, planRuleApplies = true, progressSection, docAtCommit, readLine }) {
  const results = [];
  const add = (rule, ok, detail, basis = '작업 커밋') => results.push({ rule, ok, detail, basis });

  // [INFRA-4] O3: PR 첫 커밋이 계획 커밋(제목에 "계획:", docs/만 변경)이면 그다음부터 테스트 커밋을 찾는다
  const isPlan = (x) => x.subject.includes(PLAN_COMMIT) && x.files.length > 0 && x.files.every((f) => f.startsWith('docs/'));
  const planned = !!commits[0] && isPlan(commits[0]);
  if (planned) add('plan-first', true, `계획 커밋 ${commits[0].hash} (예상값을 실측보다 먼저 커밋)`);
  else if (!planRuleApplies) add('plan-first', null, `규칙 도입(${PLAN_RULE_SINCE}) 전 작업이라 건너뜀`);
  else add('plan-first', false, '계획 커밋 없음');
  let rest = planned ? commits.slice(1) : commits;
  // [INFRA-8] O35: 계획 바로 뒤의 실측 커밋들은 건너뛴다. scripts/probe/ 밖을 바꾸면 실측 커밋이 아니다
  const isProbe = (x) => x.subject.includes(PROBE_COMMIT) && x.files.length > 0 && x.files.every((f) => f.startsWith(PROBE_DIR));
  const probes = [];
  if (planned) while (rest[0] && isProbe(rest[0])) probes.push(rest.shift().hash);
  const first = rest[0];

  const firstIsTest = !!first && first.subject.includes(TEST_COMMIT) && first.files.length > 0 && first.files.every((f) => f.startsWith('test/'));
  const skipped = probes.length ? ` (실측 커밋 ${probes.join(', ')} 건너뜀)` : '';
  add('test-first', firstIsTest, first ? `첫 커밋 ${first.hash}: ${first.subject} (${first.files.join(', ')})${skipped}` : '이 ID의 커밋이 없음');

  // [INFRA-8] O27: "테스트:" 커밋은 모두 test/만 바꾼다(첫 테스트 커밋만이 아니라)
  const dirtyTests = commits.filter((x) => x.subject.includes(TEST_COMMIT) && x.files.some((f) => !f.startsWith('test/'))).map((x) => x.hash);
  const testCommits = commits.filter((x) => x.subject.includes(TEST_COMMIT)).length;
  add('test-commits-test-only', dirtyTests.length === 0, dirtyTests.length ? `test/ 밖을 바꾼 테스트 커밋 → ${dirtyTests.join(', ')}` : `테스트 커밋 ${testCommits}개 모두 test/만 변경`);

  const testFiles = new Set((first?.files ?? []).filter((f) => f.startsWith('test/')));
  const touched = rest.slice(1).flatMap((x) => x.files.filter((f) => testFiles.has(f)).map((f) => `${x.hash}: ${f}`));
  add('test-unchanged', touched.length === 0, touched.length ? `테스트 커밋 이후 변경됨 → ${touched.join(', ')}` : `테스트 파일 ${testFiles.size}개 변경 없음`);

  const badMsg = commits.filter((x) => !/^- 왜:/m.test(x.body) || !/^- 검증:/m.test(x.body)).map((x) => x.hash);
  add('message-format', badMsg.length === 0, badMsg.length ? `"왜/검증" 누락 → ${badMsg.join(', ')}` : `${commits.length}개 커밋 모두 형식 준수`);

  add('user-doc', !!docExists, `docs/for-me/${id}.md ${docExists ? '있음' : '없음'}`, '마지막 커밋');

  // [INFRA-6] O12: "## 먼저 볼 코드" 절에 `파일:줄` 형식이 하나 이상 있는가 (다른 절에 있는 것은 인정하지 않음)
  if (docText === undefined) add('user-doc-lines', null, '문서 본문을 읽지 않아 건너뜀', 'HEAD');
  else {
    const section = codeSection(docText);
    const hit = [...(section ?? '').matchAll(FILE_LINE)][0];
    add('user-doc-lines', !!hit, section === undefined ? '"먼저 볼 코드" 절 없음' : hit ? `파일:줄 있음 (예: ${hit[0]}\`)` : '"먼저 볼 코드"에 파일:줄 없음', 'HEAD');
  }

  // [INFRA-8] O34: 인용한 줄이 문서 커밋 시점에 실제로 있고 비어 있지 않은가. 형식만 보면 짐작으로 적은 줄 번호도 통과한다(PRX-T 실제 사례)
  if (docAtCommit === undefined || !readLine) add('user-doc-lines-valid', null, '문서 커밋 시점 파일을 읽지 않아 건너뜀', '문서 커밋');
  else {
    const cited = [...(codeSection(docAtCommit) ?? '').matchAll(FILE_LINE)].map((m) => ({ file: m[1], line: Number(m[2]) }));
    const bad = cited.filter(({ file, line }) => !readLine(file, line)?.trim()).map(({ file, line }) => `${file}:${line}`);
    if (!cited.length) add('user-doc-lines-valid', null, '인용한 파일:줄 없음', '문서 커밋');
    else add('user-doc-lines-valid', bad.length === 0, bad.length ? `없거나 빈 줄 → ${bad.join(', ')}` : `인용 ${cited.length}개 모두 실제 줄`, '문서 커밋');
  }

  // [INFRA-8] O24: progress.md의 이 노드 계획 절에서, "- 실측" 줄 앞에 예상한 E번호마다 그 뒤에 실측 기록이 있는가
  if (progressSection === undefined) add('predictions-measured', null, 'progress.md에 이 노드의 계획 절 없음', 'HEAD');
  else {
    const lines = progressSection.split('\n');
    const at = lines.findIndex((l) => /^- 실측/.test(l));
    const before = at < 0 ? lines : lines.slice(0, at);
    const after = at < 0 ? '' : lines.slice(at).join('\n');
    const predicted = [...new Set(before.flatMap((l) => [...l.matchAll(/^\s*-\s*\**(E\d+)\b/g)].map((m) => m[1])))];
    const missing = predicted.filter((e) => !new RegExp(`\\b${e}\\b`).test(after));
    if (!predicted.length) add('predictions-measured', null, '예상 E번호 없음', 'HEAD');
    else add('predictions-measured', missing.length === 0, missing.length ? `실측 기록 없음 → ${missing.join(', ')}` : `예상 ${predicted.join(', ')} 모두 실측 기록 있음`, 'HEAD');
  }

  const progress = commits.some((x) => x.files.includes(PROGRESS));
  add('progress-updated', progress, progress ? '진행 기록 갱신됨' : '진행 기록을 한 번도 갱신하지 않음');

  if (id.startsWith('INFRA')) add('tree-updated', null, '작업 환경(INFRA)은 목적 나무 노드가 아니라서 건너뜀');
  else {
    const tree = commits.some((x) => x.files.includes(TREE));
    add('tree-updated', tree, tree ? '목적 나무 갱신됨' : '목적 나무(상태)를 갱신하지 않음');
  }
  return results;
}

// [INFRA-8] O32: 큰 단위. 하위 노드 결과를 모으고, 큰 단위 절차(decisions 7~9행)를 따로 본다
//   subnodes = [{ id, results }], reportText = docs/for-me/<ID>-report.md 본문(없으면 undefined)
// lastRun = .claude/state/last-run.json (마지막 npm test). [INFRA-9] 큰 단위가 끝날 때 그 큰 단위 테스트의 대기(todo)가 0이어야 한다
export function checkBigUnit({ id, subnodes, reportText, lastRun }) {
  const results = [];
  const add = (rule, ok, detail, basis = 'HEAD') => results.push({ rule, ok, detail, basis });
  const failed = subnodes.flatMap((n) => n.results.filter((r) => r.ok === false).map((r) => `${n.id} ${r.rule}`));
  add('sub-nodes', failed.length === 0, failed.length ? `위반 → ${failed.join(', ')}` : `하위 노드 ${subnodes.length}개(${subnodes.map((n) => n.id).join(', ')}) 위반 없음`, '하위 노드');
  const t = subnodes.some((n) => n.id === `${id}-T`);
  add('big-unit-test', t, t ? `큰 단위 테스트 노드 ${id}-T 있음` : `큰 단위 테스트 노드 ${id}-T 없음`);
  add('big-unit-report', reportText !== undefined, `docs/for-me/${id}-report.md ${reportText !== undefined ? '있음' : '없음'}`);
  const reviewed = reportText !== undefined && /검토 에이전트 확인/.test(reportText);
  add('big-unit-review', reviewed, reviewed ? '보고서에 검토 에이전트 확인 결과 있음' : '보고서에 "검토 에이전트 확인" 없음');
  // 사례 23~26: 일부만 실행한 기록, 실패가 남은 기록, 기록 없음으로는 통과하지 않는다. 판정 근거는 실행기가 쓴 기록이다(문구가 아니라)
  const wait = lastRun?.bigTodo?.[id]?.todo ?? 0;
  const todoOk = !!lastRun && lastRun.full === true && lastRun.failed === 0 && wait === 0;
  add(
    'big-unit-todo',
    todoOk,
    !lastRun ? '마지막 실행 기록(.claude/state/last-run.json) 없음' : `마지막 npm test: 전체 실행 ${lastRun.full === true ? '예' : '아니오'}, 실패 ${lastRun.failed}, ${id} 대기 ${wait}개`,
    '마지막 npm test',
  );
  return results;
}

function loadCommits(id, cwd) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const esc = id.replace(/[.*[\]\\^$]/g, '\\$&');
  const raw = git('log', '--all', '--no-merges', '--reverse', `--grep=^\\[${esc}\\]`, '--format=%h%x1f%s%x1f%b%x1e');
  return raw
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, subject, body = ''] = rec.split('\x1f');
      const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', hash).split('\n').filter(Boolean);
      return { hash, subject, body, files };
    })
    .filter((x) => x.subject.startsWith(`[${id}]`));
}

function docExistsAt(cwd, hash, file) {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}:${file}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 직접 실행했을 때만 동작한다(테스트에서 import할 때는 실행하지 않음)
if (process.argv[1]?.endsWith('check-method.mjs')) {
  const args = process.argv.slice(2);
  const id = args[args.indexOf('--id') + 1];
  if (!args.includes('--id') || !id) {
    console.error('사용법: node scripts/check-method.mjs --id <노드ID> [--json]');
    process.exit(2);
  }
  const cwd = path.resolve(import.meta.dirname, '..');
  const show = (spec) => {
    try {
      return execFileSync('git', ['show', spec], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return undefined;
    }
  };
  const progressHead = show(`HEAD:${PROGRESS}`) ?? '';

  const checkNode = (nodeId) => {
    const commits = loadCommits(nodeId, cwd);
    const last = commits.at(-1);
    const docPath = `docs/for-me/${nodeId}.md`;
    // 문서 형식(O12)은 HEAD 기준으로 본다. 나중 PR에서 문서를 보충해도 반영되게 하기 위해서다.
    const docText = show(`HEAD:${docPath}`) ?? '';
    // [INFRA-8] O34: 문서를 마지막으로 바꾼 커밋 시점의 문서와 코드로 인용 줄을 확인한다
    const docCommit = [...commits].reverse().find((x) => x.files.includes(docPath));
    const cache = new Map();
    const readLine = (file, n) => {
      if (!cache.has(file)) cache.set(file, show(`${docCommit.hash}:${file}`)?.split(/\r?\n/));
      return cache.get(file)?.[n - 1];
    };
    // [INFRA-8] O24: 이 노드의 계획 절(### [ID] 계획 ~ 다음 ### 또는 ##)
    const head = progressHead.indexOf(`### [${nodeId}] 계획`);
    const progressSection = head < 0 ? undefined : progressHead.slice(head).split(/\n(?=##+ )/).slice(0, 1)[0];
    // 규칙 도입 커밋이 이 작업 첫 커밋의 조상(또는 같은 커밋)이면 규칙이 적용된다
    let planRuleApplies = false;
    try {
      if (commits[0]) {
        execFileSync('git', ['merge-base', '--is-ancestor', PLAN_RULE_SINCE, commits[0].hash], { cwd, stdio: 'ignore' }); // 조상이 아니면 예외
        planRuleApplies = true;
      }
    } catch {}
    const results = checkCommits({
      id: nodeId,
      commits,
      docExists: last ? docExistsAt(cwd, last.hash, docPath) : false,
      docText,
      planRuleApplies,
      progressSection,
      docAtCommit: docCommit ? show(`${docCommit.hash}:${docPath}`) : undefined,
      readLine: docCommit ? readLine : undefined,
    });
    return { id: nodeId, commits, results };
  };

  const mark = (r) => (r.ok === null ? '➖ 건너뜀' : r.ok ? '✅' : '❌');
  const table = (results) => {
    console.log('| 규칙 | 결과 | 기준 | 근거 |\n|---|---|---|---|');
    for (const r of results) console.log(`| ${r.rule} | ${mark(r)} | ${r.basis} | ${r.detail} |`);
  };

  // [INFRA-8] O32: [ID] 커밋이 없고 [ID-…] 커밋이 있으면 큰 단위로 본다
  const own = loadCommits(id, cwd);
  const esc = id.replace(/[.*[\]\\^$]/g, '\\$&');
  const subIds = own.length
    ? []
    : [...new Set(execFileSync('git', ['log', '--all', '--no-merges', '--reverse', `--grep=^\\[${esc}-`, '--format=%s'], { cwd, encoding: 'utf8' })
        .split('\n')
        .map((l) => l.match(new RegExp(`^\\[(${esc}-[A-Za-z0-9]+)\\]`))?.[1])
        .filter(Boolean))];

  if (subIds.length) {
    const subnodes = subIds.map(checkNode);
    let lastRun;
    try {
      lastRun = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'state', 'last-run.json'), 'utf8'));
    } catch {}
    const results = checkBigUnit({ id, subnodes, reportText: show(`HEAD:docs/for-me/${id}-report.md`), lastRun });
    if (args.includes('--json')) console.log(JSON.stringify({ id, bigUnit: true, subnodes, results }, null, 2));
    else {
      console.log(`## [${id}] 큰 단위 기계 검사 [확인됨: scripts/check-method.mjs]\n`);
      table(results);
      console.log(`\n### 하위 노드 (${subnodes.length}개)\n| 노드 | ${subnodes[0].results.map((r) => r.rule).join(' | ')} |\n|---|${subnodes[0].results.map(() => '---').join('|')}|`);
      for (const n of subnodes) console.log(`| ${n.id} | ${n.results.map(mark).join(' | ')} |`);
    }
  } else {
    const { commits, results } = checkNode(id);
    if (args.includes('--json')) console.log(JSON.stringify({ id, commits, results }, null, 2));
    else {
      console.log(`## [${id}] 기계 검사 [확인됨: scripts/check-method.mjs]\n`);
      table(results);
      console.log(`\n### 커밋 (${commits.length}개, 오래된 순)`);
      for (const x of commits) console.log(`- ${x.hash} ${x.subject}  — 파일 ${x.files.length}개: ${x.files.join(', ')}`);
    }
  }
}
