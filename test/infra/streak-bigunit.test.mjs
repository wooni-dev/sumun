// [INFRA-9] 큰 단위 테스트(<ID>-T.test.*)의 todo 실패를 연속 실패로 세지 않는 좁은 예외. 사례는 docs/ai/infra9-cases.md.
// 판정은 테스트 코드를 믿지 않고 실행기가 한다: todo 이유가 정확히 "대기: src/…"이고 그 파일이 실제로 없을 때만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as streak from '../../scripts/streak.mjs';
import * as method from '../../scripts/check-method.mjs';

const DIR = 'D:\\secretary\\sumun';
const fn = (name) => {
  assert.equal(typeof streak[name], 'function', `streak.mjs에 ${name}이 있어야 함`);
  return streak[name];
};

const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="흐름" time="0.1" classname="test" file="D:\\secretary\\sumun\\test\\tls\\TLS-T.test.ts" failure="x">
		<skipped type="todo" message="대기: src/tls/mitm.ts"/>
		<failure type="testCodeFailure" message="x">...</failure>
	</testcase>
	<testcase name="가짜" time="0.1" classname="test" file="D:\\secretary\\sumun\\test\\tls\\TLS-T.test.ts" failure="&lt;skipped type=&quot;todo&quot;/>">
		<failure type="testCodeFailure" message="&lt;skipped type=&quot;todo&quot;/>">
&lt;skipped type="todo" message="대기: src/tls/mitm.ts"/>
		</failure>
	</testcase>
	<testcase name="보통" time="0.1" classname="test" file="D:\\secretary\\sumun\\test\\a.test.ts"/>
</testsuites>`;

// --- parseJunit ---
test('parseJunit: todo 테스트에는 todo 칸(이유)을 붙이고, todo가 아닌 결과는 모양을 바꾸지 않는다', () => {
  const rs = streak.parseJunit(JUNIT, DIR);
  assert.deepEqual(rs[0], { key: 'test/tls/TLS-T.test.ts::흐름', failed: true, todo: '대기: src/tls/mitm.ts' });
  assert.deepEqual(rs[2], { key: 'test/a.test.ts::보통', failed: false });
});
// --- bigUnitsFromTree (사례 2) ---
test('bigUnitsFromTree: 목적 나무의 큰 단위(맨 위 가지)만 고른다', () => {
  const tree = ' ├ [PRX] HTTP 프록시\n │   ├ [PRX-1] 요청 중계\n │   └ [PRX-T] 큰 단위 테스트\n ├ [TLS] HTTPS 복호화\n │   ├ [TLS-1] CONNECT\n └ [SEC] 안전장치\n     ├ [SEC-1] 바인딩\n';
  assert.deepEqual([...fn('bigUnitsFromTree')(tree)].sort(), ['PRX', 'SEC', 'TLS']);
});

// --- bigUnitExempt ---
const ctx = (over = {}) => ({ bigUnits: new Set(['TLS', 'PRX']), exists: () => false, readFile: () => "import { test } from 'node:test';\n", ...over });
const R = (over = {}) => ({ key: 'test/tls/TLS-T.test.ts::흐름', failed: true, todo: '대기: src/tls/mitm.ts', ...over });
test('예외: 큰 단위 -T 파일, todo 이유 "대기: src/…", 그 파일이 없음 → 예외', () => {
  assert.equal(fn('bigUnitExempt')(R(), ctx()), true);
});
test('사례 14: 대기 중인 파일이 생기면(todo가 풀렸어야 함) 예외가 아니다', () => {
  assert.equal(fn('bigUnitExempt')(R(), ctx({ exists: (p) => p === 'src/tls/mitm.ts' })), false);
});
for (const todo of ['x', '대기:src/tls/mitm.ts', '대기: src/tls/mitm.ts 그리고', '대기: ../x.ts', '대기: src/../x.ts', '대기: test/x.ts', '대기: C:/x.ts', '대기: /src/x.ts', '대기: src\\tls\\mitm.ts', 'true', '']) {
  test(`사례 4·5·8: todo 이유 ${JSON.stringify(todo)} → 예외 아님`, () => {
    assert.equal(fn('bigUnitExempt')(R({ todo }), ctx()), false);
  });
}
for (const key of [
  'test/tls/TLS-t.test.ts::흐름', // 사례 6 대소문자
  'test/tls/tls-T.test.ts::흐름',
  'test/prx/PRX-T-regression.test.ts::흐름', // 사례 7 실제로 있는 파일
  'test/tls/TLS-T.test.ts.test.ts::흐름',
  'test/tls/-T.test.ts::흐름',
  'test/tls/TLS--T.test.ts::흐름',
  'src/tls/TLS-T.test.ts::흐름', // 사례 8 test/ 밖
  '../x/TLS-T.test.ts::흐름',
  'test/TLS-T.test.ts::흐름', // 폴더 없음
  '?::흐름', // 사례 9
  'test/tls/FOO-T.test.ts::흐름', // 사례 2 큰 단위가 아님
  'test/tls/TLS-1-T.test.ts::흐름',
]) {
  test(`사례 2·6~9: ${key.split('::')[0]} → 예외 아님`, () => {
    assert.equal(fn('bigUnitExempt')(R({ key }), ctx()), false);
  });
}
test('사례 3: -T 파일에 export가 있으면(다른 파일이 그 함수로 테스트를 등록할 수 있음) 예외 아님', () => {
  assert.equal(fn('bigUnitExempt')(R(), ctx({ readFile: () => 'export function reg() {}\n' })), false);
  assert.equal(fn('bigUnitExempt')(R(), ctx({ readFile: () => 'const a = 1;\n  export { a };\n' })), false);
});
test('todo가 아닌 결과는 예외 아님', () => {
  const r = R();
  delete r.todo;
  assert.equal(fn('bigUnitExempt')(r, ctx()), false);
});
test('.mjs 큰 단위 파일도 같은 규칙', () => {
  assert.equal(fn('bigUnitExempt')(R({ key: 'test/prx/PRX-T.test.mjs::a' }), ctx()), true);
});

// --- updateStreak (사례 15) ---
test('사례 15·a: 예외 실패는 셈을 그대로 둔다(늘리지도 지우지도 않음). 예외가 아닌 실패는 지금처럼 +1', () => {
  const exempt = (r) => r.key === 'k::exempt' || r.key === 'k::exemptNew';
  const next = streak.updateStreak({ 'k::exempt': 2, 'k::other': 1 }, [
    { key: 'k::exempt', failed: true, todo: '대기: src/x.ts' },
    { key: 'k::exemptNew', failed: true, todo: '대기: src/x.ts' },
    { key: 'k::other', failed: true },
  ], exempt);
  assert.deepEqual(next, { 'k::exempt': 2, 'k::other': 2 });
});

// --- bigTodoSummary (사례 22·h) ---
test('사례 22·h: 큰 단위별 대기(todo) 수와 그중 실패 수를 센다', () => {
  const sum = fn('bigTodoSummary');
  const rs = [
    { key: 'test/tls/TLS-T.test.ts::a', failed: true, todo: '대기: src/tls/mitm.ts' },
    { key: 'test/tls/TLS-T.test.ts::b', failed: false, todo: '대기: src/tls/mitm.ts' },
    { key: 'test/tls/TLS-T.test.ts::c', failed: false },
    { key: 'test/a.test.ts::d', failed: true, todo: 'x' },
  ];
  assert.deepEqual(sum(rs, ctx()), { TLS: { todo: 2, failed: 1 } });
});

// --- check-method big-unit-todo (사례 23~27·i) ---
const SUB = [{ id: 'TLS-T', results: [] }];
const REPORT = '## 결과 요약\n- 검토 에이전트 확인: 일치 1개\n';
const rule = (lastRun) => method.checkBigUnit({ id: 'TLS', subnodes: SUB, reportText: REPORT, lastRun }).find((r) => r.rule === 'big-unit-todo');
test('i: 마지막 실행이 전체 대상이고 실패 0, 그 큰 단위 대기 0이면 big-unit-todo 통과', () => {
  assert.equal(rule({ full: true, failed: 0, bigTodo: {} })?.ok, true);
  assert.equal(rule({ full: true, failed: 0, bigTodo: { PRX: { todo: 3, failed: 0 } } })?.ok, true, '다른 큰 단위의 대기는 상관없음');
});
test('사례 23: 일부 파일만 실행한 결과로는 통과하지 않는다', () => {
  assert.equal(rule({ full: false, failed: 0, bigTodo: {} })?.ok, false);
});
test('사례 24~26: 실패가 있거나, 그 큰 단위의 대기가 남았거나, 실행 기록이 없으면 위반', () => {
  assert.equal(rule({ full: true, failed: 1, bigTodo: {} })?.ok, false);
  assert.equal(rule({ full: true, failed: 0, bigTodo: { TLS: { todo: 1, failed: 0 } } })?.ok, false);
  assert.equal(rule(undefined)?.ok, false);
});
