// [INFRA-11] O47 규칙 C — 새 동작(구현 전에는 실패해야 정상). 사례 번호는 docs/ai/infra11-cases.md(검토 에이전트)
//   scripts/commit-msg.mjs messageProblems(text | Buffer) → 문제 문구 배열(빈 배열 = 통과)
//   guard.mjs(실행 전): 표시 파일 .claude/commit-rule.json이 있으면 커밋은 `git commit -F <절대 경로>` 모양만, 그 파일은 형식 검사
//   commit-check.mjs(실행 뒤): guard가 기록한 HEAD·시각 뒤에 새로 생긴 병합 아닌 커밋의 실제 메시지를 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { messageProblems } from '../../scripts/commit-msg.mjs';
import { makeRepo, pre, post, GOOD } from './_commit-fixture.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const bad = (m) => assert.ok(messageProblems(m).length > 0, `통과하면 안 됨: ${JSON.stringify(typeof m === 'string' ? m : [...m])}`);
const body = (b) => `[X-1] 제목\n\n${b}\n`;

// --- 메시지 내용 ---
test('내용: "- 검증(…):"처럼 콜론 앞에 글자를 넣으면 위반이고, 문구가 그 실수를 가리킨다(사례 1)', () => {
  const p = messageProblems(body('- 왜: a\n- 검증(실행 불가): b'));
  assert.ok(p.length > 0);
  assert.match(p.join(' '), /검증/);
});

test('내용: "- 왜:" 또는 "- 검증:" 줄이 없으면 위반(사례 45)', () => {
  bad(body('- 검증: b'));
  bad(body('- 왜: a'));
  bad('[X-1] 제목\n');
});

test('내용: 제목 다음 줄이 빈 줄이 아니면 위반(사례 41 — git이 첫 문단 전체를 제목으로 본다)', () => {
  bad('[X-1] 제목\n- 왜: a\n- 검증: b\n');
});

test('내용: 줄 맨 앞이 아니거나, 콜론 뒤가 비었으면 위반(사례 42, 45)', () => {
  bad(body('- 왜: a - 검증: b'));
  bad(body('- 왜: a\n- 검증: '));
  bad(body('- 왜: a\n- 검증:'));
  bad(body('- 왜:\n- 검증: b'));
});

test('내용: 비슷해 보이는 글자는 위반(사례 43 — 띄어쓰기, 별표, 전각 콜론, 다른 하이픈, NBSP)', () => {
  for (const w of ['- 왜 : a', ' - 왜: a', '-  왜: a', '* 왜: a', '- 왜： a', '\u2010 왜: a', '\u2013 왜: a', '-\u00a0왜: a', '\t- 왜: a']) bad(body(`${w}\n- 검증: b`));
});

test('내용: NFD로 분해된 "왜"는 위반(사례 44 — 정규화하지 않는다)', () => {
  bad(body(`- ${'왜'.normalize('NFD')}: a\n- 검증: b`));
});

test('내용: 제목은 "[ID] 제목" — 공백 없음, 앞 공백, 다른 괄호, 대괄호 없음, 빈 ID·빈 제목은 위반(사례 46)', () => {
  for (const t of ['[STO-5]제목', ' [STO-5] 제목', '【STO-5】 제목', 'STO-5: 제목', '[] 제목', '[STO-5] ', '[STO 5] 제목', '']) bad(`${t}\n\n- 왜: a\n- 검증: b\n`);
});

test('내용: BOM, UTF-16, 깨진 UTF-8, \\r만 있는 줄바꿈, 빈 메시지는 위반(사례 33, 37~40)', () => {
  const good = Buffer.from(body('- 왜: a\n- 검증: b'));
  bad(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good]));
  bad(`\ufeff${body('- 왜: a\n- 검증: b')}`);
  bad(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body('- 왜: a\n- 검증: b'), 'utf16le')]));
  bad(Buffer.concat([Buffer.from('[X-1] t\n\n- '), Buffer.from([0xbf, 0xd6]), Buffer.from(': a\n- 검증: b\n')])); // CP949 바이트
  bad('[X-1] 제목\r\r- 왜: a\r- 검증: b\r');
  bad('');
  bad(Buffer.alloc(0));
});

// --- 실행 전(guard.mjs) ---
function withRepo(fn) {
  const fx = makeRepo();
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}
const denies = (fx, tool, cmd) => {
  const r = pre(fx.repo, tool, cmd);
  assert.equal(r.decision, 'deny', `${tool}: ${cmd}`);
  return r.reason;
};

test('실행 전: 형식이 틀린 메시지 파일, 없는 파일은 막는다(Bash·PowerShell)', () =>
  withRepo((fx) => {
    const B = fx.msg(body('- 왜: a\n- 검증(x): b'));
    const reason = denies(fx, 'Bash', `git commit -q -F "${B}"`);
    assert.match(reason, /검증/, '이유에 문제가 들어 있다');
    denies(fx, 'PowerShell', `git commit -q -F "${B}"`);
    denies(fx, 'Bash', `git commit -F "${fx.msg('x').replace(/m\d+\.txt$/, 'none.txt')}"`);
    denies(fx, 'Bash', `git commit -F ${fx.msg(Buffer.from(GOOD, 'utf16le'))}`);
  }));

test('실행 전: -m은 형식이 맞아도 막고, 이유는 `git commit -F <절대 경로>`를 안내한다(사례 1~4, 12, 13, D2·11)', () =>
  withRepo((fx) => {
    const reason = denies(fx, 'Bash', 'git commit -m "[X-1] t" -m "- 왜: a" -m "- 검증: b"');
    assert.match(reason, /git commit -F/);
    for (const c of ['git commit -mbad', 'git commit -am "bad"', 'git commit -qsm "bad"', 'git commit --message bad', 'git commit --message=bad', 'git commit --mess=bad', "git commit -m $'[X-1] t\\n\\n- 왜: a\\n- 검증: b'"]) denies(fx, 'Bash', c);
    denies(fx, 'PowerShell', 'git commit -m "[X-1] t`n`n- 왜: a`n- 검증: b"');
    denies(fx, 'PowerShell', "git commit -m @'\n[X-1] t\n\n- 왜: a\n- 검증: b\n'@");
  }));

test('실행 전: 메시지를 다른 곳에서 가져오거나 바꾸는 옵션은 막는다(사례 25~33, 48)', () =>
  withRepo((fx) => {
    const G = fx.msg(GOOD);
    for (const opt of ['--amend', '-C HEAD', '--reuse-message=HEAD', '-c HEAD', '--fixup=HEAD', '--squash=HEAD', '--no-edit', '-e', '-t x.txt', '--allow-empty-message', '--cleanup=strip', '--trailer "검증: x"', '-s', '--fil=x'])
      denies(fx, 'Bash', `git commit ${opt} -F "${G}"`);
    denies(fx, 'Bash', 'git commit --no-edit');
    denies(fx, 'Bash', 'git commit');
  }));

test('실행 전: 표준입력·변수·명령 치환·상대 경로·~·/tmp 경로의 메시지는 막는다(사례 6, 7, 9~11, 15~17, 24)', () =>
  withRepo((fx) => {
    for (const c of [
      "git commit -F - <<'EOF'\n[X-1] t\n\n- 왜: a\n- 검증: b\nEOF",
      "printf '[X-1] t\\n\\n- 왜: a\\n- 검증: b\\n' | git commit -F -",
      'msg="[X-1] t"; git commit -m "$msg"',
      'git commit -m "$(cat /tmp/bad.txt)"',
      'git commit -F <(echo bad)',
      'git commit -F "$TEMP/m.txt"',
      'git commit -F m.txt',
      'cd /tmp && git commit -F m.txt',
      'git commit -F ~/m.txt',
      'git commit -F /tmp/m.txt',
      'for f in a b; do git commit -F $f.txt; done',
    ])
      denies(fx, 'Bash', c);
    denies(fx, 'PowerShell', 'git commit -F $env:TEMP\\m.txt');
    denies(fx, 'PowerShell', '$m = Get-Content bad.txt -Raw; git commit -m $m');
    denies(fx, 'PowerShell', 'Get-Content C:/x/m.txt | git commit -F -');
  }));

test('실행 전: 같은 명령 안에서 메시지 파일 이름이 또 나오면 막는다(사례 19, 20)', () =>
  withRepo((fx) => {
    const G = fx.msg(GOOD);
    denies(fx, 'Bash', `echo "[X-1] bad" > "${G}" && git commit -F "${G}"`);
    denies(fx, 'Bash', `cp bad.txt ${G}; git commit -F ${G}`);
  }));

test('실행 전: git 설정·편집기를 바꾸는 접두어와 전역 -c는 막는다(사례 29, 30, 34, 36)', () =>
  withRepo((fx) => {
    const G = fx.msg(GOOD);
    for (const c of [`git -c core.commentChar=- commit -F "${G}"`, `git -c i18n.commitEncoding=euc-kr commit -F "${G}"`, `GIT_EDITOR=true git commit -F "${G}"`, `git --git-dir=x commit -F "${G}"`, `git -C sub commit -F "${G}"`])
      denies(fx, 'Bash', c);
  }));

test('실행 전: 한 명령의 커밋 여러 개는 모두 검사한다(사례 22, 23)', () =>
  withRepo((fx) => {
    const G = fx.msg(GOOD);
    denies(fx, 'Bash', `git commit -F "${G}" && git commit --allow-empty -m bad`);
    denies(fx, 'Bash', `git commit -F "${G}"\ngit commit -m bad`);
    denies(fx, 'PowerShell', `git commit -F "${G}"; git commit -m bad`);
  }));

test('실행 전: git이나 commit을 따옴표·경로·호출 연산자·전역 옵션으로 감싸도 찾는다(사례 65~68)', () =>
  withRepo((fx) => {
    for (const c of ['"git" commit -m bad', 'git "commit" -m bad', "git 'co'mmit -m bad", 'g\\it commit -m bad', 'git --no-pager commit -m bad', 'git -P commit -m bad', 'git.exe commit -m bad', '/mingw64/bin/git commit -m bad', 'env git commit -m bad', 'command git commit -m bad'])
      denies(fx, 'Bash', c);
    denies(fx, 'PowerShell', '& git commit -m bad');
    denies(fx, 'PowerShell', '& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m bad');
  }));

test('실행 전: 표시 파일이 있는 저장소에서만 켜진다(D6) — 같은 명령이 표시 파일 없는 저장소에서는 막히지 않는다', () => {
  const on = makeRepo();
  const off = makeRepo({ marker: false });
  try {
    assert.equal(pre(on.repo, 'Bash', 'git commit -m bad').decision, 'deny', '긍정 전제(O30): 켜진 저장소에서는 막는다');
    assert.equal(pre(off.repo, 'Bash', 'git commit -m bad').decision, 'allow');
  } finally {
    on.cleanup();
    off.cleanup();
  }
});

test('실행 전: Bash·PowerShell 명령마다 지금 HEAD와 시각을 .claude/state/commit-check.json에 기록한다', () =>
  withRepo((fx) => {
    const before = Date.now();
    pre(fx.repo, 'Bash', 'git status');
    const file = path.join(fx.repo, '.claude', 'state', 'commit-check.json');
    assert.ok(fs.existsSync(file), '기록 파일이 있어야 함');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(s.head, fx.git('rev-parse', 'HEAD'));
    assert.ok(s.at >= before - 1000 && s.at <= Date.now(), `at ${s.at}`);
  }));

// --- 실행 뒤(commit-check.mjs) ---
test('실행 뒤: 기록 뒤에 생긴 형식이 틀린 커밋을 알린다(해시와 "사용자에게 보고"), 맞는 커밋은 이유에 없다(사례 49~51, 55~62, 73)', () =>
  withRepo((fx) => {
    pre(fx.repo, 'Bash', 'git status');
    const good = fx.commit(GOOD);
    const badHash = fx.commit('[X-1] 제목\n\n- 왜: a\n- 검증(x): b\n');
    const r = post(fx.repo);
    assert.ok(r, '알림이 있어야 함');
    assert.equal(r.decision, 'block');
    assert.match(r.reason, new RegExp(badHash));
    assert.match(r.reason, /사용자/);
    assert.doesNotMatch(r.reason, new RegExp(good));
  }));

test('실행 뒤: 맞는 커밋만 생기면 알리지 않는다 — 그다음 틀린 커밋은 알린다', () =>
  withRepo((fx) => {
    pre(fx.repo, 'Bash', 'git status');
    fx.commit(GOOD);
    assert.equal(post(fx.repo), null);
    pre(fx.repo, 'Bash', 'git status');
    const b = fx.commit('bad');
    assert.match(post(fx.repo)?.reason ?? '', new RegExp(b), '긍정 전제(O30)');
  }));

test('실행 뒤: 기록 전에 생긴 커밋(사용자가 직접 한 커밋)과 병합 커밋은 보지 않는다', () =>
  withRepo((fx) => {
    const userBad = fx.commit('user made this');
    fx.git('checkout', '-q', '-b', 'side');
    fx.commit(GOOD);
    fx.git('checkout', '-q', 'main');
    pre(fx.repo, 'Bash', 'git merge');
    fx.git('merge', '--no-ff', '-q', '-m', '[X-1] 병합: side', 'side');
    const merge = fx.git('rev-parse', '--short', 'HEAD');
    assert.equal(post(fx.repo), null, '병합과 기록 전 커밋은 알리지 않는다');
    pre(fx.repo, 'Bash', 'git status');
    const b = fx.commit('bad again');
    const r = post(fx.repo);
    assert.match(r?.reason ?? '', new RegExp(b), '긍정 전제(O30)');
    assert.doesNotMatch(r.reason, new RegExp(`${userBad}|${merge}`));
  }));

test('실행 뒤: 오래된 브랜치로 옮기기만 하면(새 커밋 없음) 그 브랜치의 옛 커밋을 알리지 않는다', () =>
  withRepo((fx) => {
    fx.git('checkout', '-q', '-b', 'old');
    fx.commit('old bad', { GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' });
    fx.git('checkout', '-q', 'main');
    pre(fx.repo, 'Bash', 'git checkout old');
    fx.git('checkout', '-q', 'old');
    assert.equal(post(fx.repo), null);
    pre(fx.repo, 'Bash', 'git status');
    const b = fx.commit('new bad');
    assert.match(post(fx.repo)?.reason ?? '', new RegExp(b), '긍정 전제(O30)');
  }));

test('실행 뒤: 표시 파일이 없으면 알리지 않는다 — 있으면 알린다', () => {
  const on = makeRepo();
  const off = makeRepo({ marker: false });
  try {
    for (const fx of [on, off]) {
      pre(fx.repo, 'Bash', 'git status');
      fx.commit('bad');
    }
    assert.ok(post(on.repo), '긍정 전제(O30)');
    assert.equal(post(off.repo), null);
  } finally {
    on.cleanup();
    off.cleanup();
  }
});

// --- 이 저장소의 설정 ---
test('이 저장소: 표시 파일이 있고, settings.json의 PostToolUse(Bash|PowerShell)에 commit-check.mjs가 있다(L1)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'commit-rule.json')), '.claude/commit-rule.json');
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const entries = s.hooks.PostToolUse.filter((e) => /Bash/.test(e.matcher) && /PowerShell/.test(e.matcher));
  assert.ok(entries.some((e) => e.hooks.some((h) => /commit-check\.mjs/.test(h.command))));
});
