// [INFRA-1] 연속 실패 카운터와 junit 해석 테스트
// junit 예시는 2026-11-07 실측한 node v24.21.0의 실제 출력 형식이다(docs/ai/progress.md E2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJunit, updateStreak } from '../../scripts/streak.mjs';

const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="passes" time="0.001046" classname="test" file="D:\\secretary\\sumun\\test\\a.test.ts"/>
	<testcase name="fails" time="0.001159" classname="test" file="D:\\secretary\\sumun\\test\\a.test.ts" failure="1 !== 2">
		<failure type="testCodeFailure" message="1 !== 2">...</failure>
	</testcase>
	<testsuite name="묶음">
		<testcase name="안쪽 &amp; 실패" time="0.1" classname="test" file="D:\\secretary\\sumun\\test\\b.test.ts">
			<failure type="testCodeFailure" message="x">...</failure>
		</testcase>
	</testsuite>
</testsuites>`;

test('junit에서 테스트마다 파일::이름 키와 실패 여부를 뽑는다', () => {
  assert.deepEqual(parseJunit(JUNIT, 'D:\\secretary\\sumun'), [
    { key: 'test/a.test.ts::passes', failed: false },
    { key: 'test/a.test.ts::fails', failed: true },
    { key: 'test/b.test.ts::안쪽 & 실패', failed: true },
  ]);
});

test('실패하면 1 증가, 통과하면 지우고, 이번에 실행되지 않은 테스트는 그대로 둔다', () => {
  const prev = { 'k::fail': 2, 'k::pass': 1, 'k::notrun': 1 };
  const next = updateStreak(prev, [
    { key: 'k::fail', failed: true },
    { key: 'k::pass', failed: false },
    { key: 'k::new', failed: true },
  ]);
  assert.deepEqual(next, { 'k::fail': 3, 'k::notrun': 1, 'k::new': 1 });
});

test('이전 상태를 바꾸지 않는다(새 객체를 돌려준다)', () => {
  const prev = { 'k::a': 1 };
  updateStreak(prev, [{ key: 'k::a', failed: true }]);
  assert.deepEqual(prev, { 'k::a': 1 });
});
