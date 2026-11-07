// [INFRA-5] 새 동작: 실행 전 검사(guard)가 막아야 하는 우회 사례
// 출처: docs/ai/guard-bypass-cases.md (별도 검토 에이전트 제안, 번호 동일)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, guardDecision } from './_hook-fixture.mjs';

let fx;
before(() => (fx = makeRepo()));
after(() => fx.cleanup());

const CASES = [
  ['4', 'Bash', 'cat <<<EOF\nrm test/a.test.ts\nEOF'],
  ['6', 'Bash', "bash <<'EOF'\nrm test/a.test.ts\nEOF"],
  ["6'", 'Bash', "node <<'EOF'\nrequire('fs').writeFileSync('test/a.test.ts','')\nEOF"],
  ['7', 'Bash', 'xargs rm -f <<EOF\ntest/a.test.ts\nEOF'],
  ['8', 'Bash', 'xargs touch <<EOF\n.claude/state/x.json\nEOF'],
  ['9', 'Bash', 'while read f; do rm "$f"; done <<EOF\ntest/a.test.ts\nEOF'],
  ['10', 'Bash', 'cat <<EOF\n$(rm test/a.test.ts)\nEOF'],
  ['11', 'Bash', 'git commit --allow-empty -m "$(rm test/a.test.ts)"'],
  ['12', 'Bash', 'git commit -m "`echo x > test/a.test.ts`"'],
  ['13', 'PowerShell', 'git commit --allow-empty -m "$(Remove-Item test/a.test.ts)"'],
  ['14', 'PowerShell', 'git commit -m "a\\" ; Remove-Item test/a.test.ts ; echo \\"b"'],
  ['15', 'Bash', "git checkout -m 'test/a.test.ts'"],
  ['16', 'PowerShell', "@'\ntest/a.test.ts\n'@ | Remove-Item"],
  ['17', 'PowerShell', "@'\n.claude/state/x.json\n'@ | % { Set-Content $_ '{}' }"],
  ['18', 'PowerShell', "iex @'\nRemove-Item test/a.test.ts\n'@"],
  ['19', 'PowerShell', '$x = @"\n$(Remove-Item test/a.test.ts)\n"@'],
  ['22', 'Bash', "# @'\nrm test/a.test.ts\n'@'"],
  ['23', 'PowerShell', "Write-Output '<<EOF'\nRemove-Item test/a.test.ts\nEOF"],
  ['24', 'Bash', 'mkdir -p 1; echo x >&1/../test/a.test.ts'],
  ['26', 'Bash', 'echo x >test/a.test.ts'],
  ['27', 'Bash', "cat <<'EOF' >test/a.test.ts\nnew\nEOF"],
];

for (const [no, tool, cmd] of CASES) {
  test(`우회 사례 ${no} (${tool})는 실행 전에 막는다`, () => {
    assert.equal(guardDecision(fx.repo, tool, cmd), 'deny', JSON.stringify(cmd));
  });
}
