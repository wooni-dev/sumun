// [INFRA-9] 회귀: todo 판정을 넣어도 지켜야 하고, 지금도 성립하는 것(red 대상 아님). 사례는 docs/ai/infra9-cases.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as streak from '../../scripts/streak.mjs';

const DIR = 'D:\\secretary\\sumun';
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

test('사례 10: 오류 메시지 안의 <skipped type="todo"> 글자는 todo로 보지 않는다(태그만 인정)', () => {
  const rs = streak.parseJunit(JUNIT, DIR);
  assert.equal(rs[1].key, 'test/tls/TLS-T.test.ts::가짜');
  assert.equal(rs[1].failed, true);
  assert.equal('todo' in rs[1], false, JSON.stringify(rs[1]));
});

