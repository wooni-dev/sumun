// [INFRA-1] 테스트 실행기 (npm test / npm run test:red)
//
//   npm test                       → 테스트 실행 + 연속 실패 카운터 갱신 + 실행 기록
//   npm run test:red -- <파일...>  → 구현 전 확인: 모든 테스트가 "실패"해야 성공
//                                    (개발 전부터 통과하는 테스트는 아무것도 검증하지 않을 수 있음, 개발 방식 6행)
//
// 결과는 .claude/state/ 에 남긴다. 이 폴더는 hook이 보호하므로 Claude가 직접 고칠 수 없다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseJunit, updateStreak, stopped, STOP_AFTER, bigUnitExempt, bigUnitsFromTree, bigTodoSummary } from './streak.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const stateDir = path.join(projectDir, '.claude', 'state');
const junitPath = path.join(stateDir, 'junit.xml');
const streakPath = path.join(stateDir, 'test-streak.json');

const args = process.argv.slice(2);
const red = args.includes('--red');
const files = args.filter((a) => a !== '--red');
// Node 24의 node --test는 폴더 인자를 파일로 취급한다 [확인됨] → glob으로 지정
const targets = files.length ? files : ['test/**/*.test.ts', 'test/**/*.test.mjs'];

fs.mkdirSync(stateDir, { recursive: true });
fs.rmSync(junitPath, { force: true });

const run = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${junitPath}`, ...targets],
  { cwd: projectDir, stdio: 'inherit' },
);

if (!fs.existsSync(junitPath)) {
  console.error('\n⛔ junit 결과가 없습니다. 테스트 실행기 자체가 실패했습니다.');
  process.exit(run.status ?? 1);
}

const results = parseJunit(fs.readFileSync(junitPath, 'utf8'), projectDir);

// [INFRA-9] 큰 단위 테스트의 대기(todo) 실패는 연속 실패에서 뺀다. 판정 근거(목적 나무, 파일 존재, -T 파일 내용)는 이 실행기가 직접 읽는다
let tree = '';
try {
  tree = fs.readFileSync(path.join(projectDir, 'docs', 'ai', 'purpose-tree.md'), 'utf8');
} catch {}
const bigCtx = {
  bigUnits: bigUnitsFromTree(tree),
  exists: (p) => fs.existsSync(path.join(projectDir, p)),
  readFile: (f) => fs.readFileSync(path.join(projectDir, f), 'utf8'),
};
const exempt = (r) => bigUnitExempt(r, bigCtx);
const failedCount = results.filter((r) => r.failed && !exempt(r)).length;
const exemptFailed = results.filter((r) => r.failed && exempt(r)).length;
const bigTodo = bigTodoSummary(results, bigCtx);

fs.writeFileSync(
  path.join(stateDir, 'last-run.json'),
  JSON.stringify(
    // full = 대상 인자 없이 전체를 실행했는가. 큰 단위가 끝날 때 check-method가 이 기록으로 "대기 0"을 확인한다(사례 23)
    { at: new Date().toISOString(), mode: red ? 'red' : 'normal', targets, full: files.length === 0, exitCode: run.status, total: results.length, failed: failedCount, exemptFailed, bigTodo },
    null,
    2,
  ),
);

// 사례 22: 대기 실패만 있으면 종료 코드가 0이라 "통과"로 오해하기 쉽다. 따로 보여 준다
for (const [id, { todo, failed }] of Object.entries(bigTodo)) {
  console.log(`\nℹ 큰 단위 대기(todo) ${id}: ${todo}개, 그중 실패 ${failed}개 — 대기 중인 파일이 생기면 실제 검사가 된다. 큰 단위가 끝날 때는 0개여야 한다`);
}
// 사례 18: 대기 중인데 통과하는 테스트는 아무것도 검사하지 않을 수 있다
for (const r of results.filter((r) => typeof r.todo === 'string' && !r.failed && bigUnitExempt({ ...r, failed: true }, bigCtx))) {
  console.log(`⚠ 대기 중인데 통과한 큰 단위 테스트: ${r.key} (빈 테스트인지 확인)`);
}

if (red) {
  const passed = results.filter((r) => !r.failed);
  if (results.length === 0) {
    console.error('\n⛔ [red] 실행된 테스트가 없습니다.');
    process.exit(1);
  }
  if (passed.length) {
    console.error(`\n⛔ [red] 구현 전인데 통과한 테스트가 ${passed.length}개 있습니다. 아무것도 검증하지 않는 테스트일 수 있습니다:`);
    for (const p of passed) console.error(`   - ${p.key}`);
    process.exit(1);
  }
  console.log(`\n✅ [red] ${results.length}개 모두 실패. 위 출력에서 실패 이유가 "올바른 이유"인지 확인하세요.`);
  process.exit(0);
}

const prev = fs.existsSync(streakPath) ? JSON.parse(fs.readFileSync(streakPath, 'utf8')).counts : {};
const counts = updateStreak(prev, results, exempt);
fs.writeFileSync(streakPath, JSON.stringify({ counts }, null, 2));

const hit = stopped(counts);
if (hit.length) {
  console.error(`\n⛔ 같은 테스트가 ${STOP_AFTER}회 연속 실패했습니다. 멈추고 사용자에게 보고하세요 (코드 수정과 테스트 재실행은 hook이 막습니다):`);
  for (const [key, n] of hit) console.error(`   - ${key} (${n}회)`);
}
process.exit(run.status ?? 1);
