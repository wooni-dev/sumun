// [INFRA-2] 개발 방식 기계 검사
//   node scripts/check-method.mjs --id PRX-1 [--json]
//
// 커밋 제목이 [ID]로 시작하는 커밋(병합 커밋 제외)을 오래된 순으로 모아서 검사한다.
// 결과는 모두 프로그램이 낸 것이므로 [확인됨]이다. 의미 판단(의도 하나인가, 범위를 벗어났나)은 method-auditor가 한다.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const TEST_COMMIT = '테스트:';
const PLAN_COMMIT = '계획:';
const PROGRESS = 'docs/ai/progress.md';
const TREE = 'docs/ai/purpose-tree.md';

// 계획 커밋 규칙이 처음 적용된 커밋(INFRA-3 계획). 이보다 앞선 작업은 plan-first를 판정하지 않는다(O14)
export const PLAN_RULE_SINCE = '77161c1';

export function checkCommits({ id, commits, docExists, docText, planRuleApplies = true }) {
  const results = [];
  const add = (rule, ok, detail) => results.push({ rule, ok, detail });

  // [INFRA-4] O3: PR 첫 커밋이 계획 커밋(제목에 "계획:", docs/만 변경)이면 그다음부터 테스트 커밋을 찾는다
  const isPlan = (x) => x.subject.includes(PLAN_COMMIT) && x.files.length > 0 && x.files.every((f) => f.startsWith('docs/'));
  const planned = !!commits[0] && isPlan(commits[0]);
  if (planned) add('plan-first', true, `계획 커밋 ${commits[0].hash} (예상값을 실측보다 먼저 커밋)`);
  else if (!planRuleApplies) add('plan-first', null, `규칙 도입(${PLAN_RULE_SINCE}) 전 작업이라 건너뜀`);
  else add('plan-first', false, '계획 커밋 없음');
  const rest = planned ? commits.slice(1) : commits;
  const first = rest[0];

  const firstIsTest = !!first && first.subject.includes(TEST_COMMIT) && first.files.length > 0 && first.files.every((f) => f.startsWith('test/'));
  add('test-first', firstIsTest, first ? `첫 커밋 ${first.hash}: ${first.subject} (${first.files.join(', ')})` : '이 ID의 커밋이 없음');

  const testFiles = new Set((first?.files ?? []).filter((f) => f.startsWith('test/')));
  const touched = rest.slice(1).flatMap((x) => x.files.filter((f) => testFiles.has(f)).map((f) => `${x.hash}: ${f}`));
  add('test-unchanged', touched.length === 0, touched.length ? `테스트 커밋 이후 변경됨 → ${touched.join(', ')}` : `테스트 파일 ${testFiles.size}개 변경 없음`);

  const badMsg = commits.filter((x) => !/^- 왜:/m.test(x.body) || !/^- 검증:/m.test(x.body)).map((x) => x.hash);
  add('message-format', badMsg.length === 0, badMsg.length ? `"왜/검증" 누락 → ${badMsg.join(', ')}` : `${commits.length}개 커밋 모두 형식 준수`);

  add('user-doc', !!docExists, `docs/for-me/${id}.md ${docExists ? '있음' : '없음'}`);

  // [INFRA-6] O12: "## 먼저 볼 코드" 절에 `파일:줄` 형식이 하나 이상 있는가 (다른 절에 있는 것은 인정하지 않음)
  if (docText === undefined) add('user-doc-lines', null, '문서 본문을 읽지 않아 건너뜀');
  else {
    const start = docText.indexOf('## 먼저 볼 코드');
    const section = start < 0 ? '' : docText.slice(start).split(/\n## /)[0];
    const hit = section.match(/`[^`\s]+:\d+/);
    add('user-doc-lines', !!hit, start < 0 ? '"먼저 볼 코드" 절 없음' : hit ? `파일:줄 있음 (예: ${hit[0]}\`)` : '"먼저 볼 코드"에 파일:줄 없음');
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
  const commits = loadCommits(id, cwd);
  const last = commits.at(-1);
  const docPath = `docs/for-me/${id}.md`;
  // 문서 형식(O12)은 HEAD 기준으로 본다. 나중 PR에서 문서를 보충해도 반영되게 하기 위해서다.
  let docText = '';
  try {
    docText = execFileSync('git', ['show', `HEAD:${docPath}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {}
  // 규칙 도입 커밋이 이 작업 첫 커밋의 조상(또는 같은 커밋)이면 규칙이 적용된다
  let planRuleApplies = false;
  try {
    if (commits[0]) {
      execFileSync('git', ['merge-base', '--is-ancestor', PLAN_RULE_SINCE, commits[0].hash], { cwd, stdio: 'ignore' }); // 조상이 아니면 예외
      planRuleApplies = true;
    }
  } catch {}
  const results = checkCommits({ id, commits, docExists: last ? docExistsAt(cwd, last.hash, docPath) : false, docText, planRuleApplies });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ id, commits, results }, null, 2));
  } else {
    console.log(`## [${id}] 기계 검사 [확인됨: scripts/check-method.mjs]\n`);
    console.log('| 규칙 | 결과 | 근거 |\n|---|---|---|');
    for (const r of results) console.log(`| ${r.rule} | ${r.ok === null ? '➖ 건너뜀' : r.ok ? '✅' : '❌'} | ${r.detail} |`);
    console.log(`\n### 커밋 (${commits.length}개, 오래된 순)`);
    for (const x of commits) console.log(`- ${x.hash} ${x.subject}  — 파일 ${x.files.length}개: ${x.files.join(', ')}`);
  }
}
