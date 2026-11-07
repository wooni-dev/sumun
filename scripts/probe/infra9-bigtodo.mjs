// [INFRA-9 실측] 대기 중인 큰 단위 테스트가 3번 연속 실패해도 멈춤이 걸리지 않는지, 일반 실패는 여전히 걸리는지
//   node scripts/probe/infra9-bigtodo.mjs
// 저장소의 .claude/state를 건드리지 않도록 임시 폴더에 작은 프로젝트(실행기 복사본 + 목적 나무 + 테스트 2개)를 만들어 실행한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-infra9-'));
fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
for (const f of ['test.mjs', 'streak.mjs']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(dir, 'scripts', f));
fs.mkdirSync(path.join(dir, 'docs', 'ai'), { recursive: true });
fs.writeFileSync(path.join(dir, 'docs', 'ai', 'purpose-tree.md'), ' ├ [TLS] HTTPS\n │   └ [TLS-1] 터널\n');
fs.mkdirSync(path.join(dir, 'test', 'tls'), { recursive: true });
fs.writeFileSync(
  path.join(dir, 'test', 'tls', 'TLS-T.test.mjs'),
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { existsSync } from 'node:fs';\nconst P = 'src/tls/mitm.ts';\ntest('큰 단위 흐름', { todo: !existsSync(P) && `대기: ${P}` }, () => assert.equal(1, 2));\n",
);
fs.writeFileSync(path.join(dir, 'test', 'tls', 'plain.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('일반 실패', () => assert.equal(1, 2));\n");

const run = (...files) => {
  const r = spawnSync(process.execPath, ['scripts/test.mjs', ...files], { cwd: dir, encoding: 'utf8' });
  const counts = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'state', 'test-streak.json'), 'utf8')).counts;
  return { exit: r.status, counts, stop: /연속 실패했습니다/.test(r.stderr), wait: (r.stdout.match(/큰 단위 대기\(todo\) TLS: .*?개, 그중 실패 \d+개/) ?? [''])[0] };
};

console.log('1) 대기 중인 큰 단위 테스트만 3번 실행');
for (let i = 1; i <= 3; i++) console.log(`   ${i}회:`, JSON.stringify(run('test/tls/TLS-T.test.mjs')));
console.log('2) 일반 실패 테스트를 3번 실행(지금처럼 멈춰야 함)');
for (let i = 1; i <= 3; i++) console.log(`   ${i}회:`, JSON.stringify(run('test/tls/plain.test.mjs')));
console.log('3) 대기 파일을 만들어 todo를 풀고 큰 단위 테스트 실행(이제 세야 함)');
fs.mkdirSync(path.join(dir, 'src', 'tls'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src', 'tls', 'mitm.ts'), '');
console.log('   1회:', JSON.stringify(run('test/tls/TLS-T.test.mjs')));
fs.rmSync(dir, { recursive: true, force: true });
