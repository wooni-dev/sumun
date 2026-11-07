# 진행 기록

단서로만 쓴다. 세션을 시작할 때 git 이력과 테스트 결과로 대조한다.

## 현재
- 작업: [TLS-T] 완료(main에 병합). 다음은 [TLS-1] CONNECT 터널.
- 다음 할 일: TLS 큰 단위 — TLS-1(CONNECT 터널) → TLS-2(루트 CA) → TLS-3 → TLS-4. 진행 상황은 `npm test`의 "큰 단위 대기 TLS" 줄. TLS-2(루트 CA)는 개인키 보관 위치와 Windows 인증서 저장소 등록을 사용자에게 먼저 설명·확인(보류 중인 O22~O31 검토 포함)
- 새 세션 시작 순서(개발 방식 7~9행): ① docs/ai/purpose-tree.md → ② 이 파일(단서로만) → ③ `git log --oneline -15`로 대조 → ④ `npm test` → ⑤ 아래 미확인 항목부터 처리(O6)
- 미확인:
  - ai-research Read 규칙 — 세션 밖 조건 필요(자동 승인 모드가 아닌 새 세션에서 읽을 때 권한 창이 뜨는지)
  - method-auditor 이름 호출 — 2026-11-07 새 세션에서 **안 됨** [확인됨: Agent 종류 목록에 없음]. 정의 파일 앞머리(name, description, tools)는 형식이 맞다. 원인은 모른다 [추측: 백그라운드 세션이라 프로젝트 에이전트를 싣지 않았을 수 있음]. 범용 에이전트가 정의 파일을 읽는 방식으로 계속한다.
  - on-prompt.mjs — 세션 밖 조건 필요("테스트 수정 허용" 입력 또는 연속 실패 카운터 > 0)
  - Ctrl+C 종료(PRX-4) — 세션 밖 조건 필요: 사용자가 실제 터미널에서 `npm start` 후 Ctrl+C. 2초 안에 끝나는지
  - 예약 포트 EACCES 메시지(PRX-4) — 환경 의존: `netsh int ipv4 show excludedportrange protocol=tcp`의 포트로 시작해 볼 때

## 로그
### 2026-11-07
- 한 줄 보고: git 저장소를 만들고 설계 지도와 목적 나무 초안을 작성한다. hook과 코딩은 하지 않는다.
- 사용자 승인 사항(1~10): docs 구조, git init, 로컬 브랜치로 PR, hook 단계적 도입, node:test, 중간 커밋은 빌드만 유지, 감사 에이전트 + 기록 파일, PR 끝과 큰 단위 끝에 감사, 기계적 확인은 스크립트로, ai-research 폴더 읽기 허용.

- 사용자 확인: 지도와 목적 나무 "맞음" → 첫 커밋 7d042b1
- 한 줄 보고: [INFRA-1] 1차 hook(테스트 수정 차단, 연속 실패 시 멈춤)을 만든다. 목표: 기계적으로 막기 / 범위: `.claude/`, `scripts/`, `test/infra/` / 하지 않을 것: 2차 hook, 프록시 코드.
- 실측 전 예상 [추측]:
  - E1: Node 24는 `node --test x.test.ts`를 플래그 없이 실행한다. 경고는 나오지 않는다.
  - E2: `--test-reporter=junit`의 결과에는 테스트마다 `<testcase name="...">`가 있고, 실패한 테스트 안에는 `<failure`가 있다.
- 실측 결과: E1, E2 일치 [확인됨: 임시 폴더에서 node v24.21.0으로 실행, 2026-11-07]. junit에는 `file` 속성(절대 경로)과 `failure` 속성도 있다.
- 예상 밖 결과 (불일치 이력):
  - `node --test test/infra/`처럼 폴더를 주면 "Cannot find module"이 난다. 폴더를 파일로 취급한다 → glob(`"test/**/*.test.mjs"`)으로 지정한다 [확인됨].
  - Bash 도구로 `echo`/`printf`에 `\\`가 든 JSON을 넘기면 역슬래시가 하나로 줄어 JSON이 깨진다 → 시험할 때는 슬래시 경로를 쓴다. 역슬래시 경로는 단위 테스트로 검증한다.
  - 여러 커밋을 heredoc + `&& \`로 이어 붙이면 bash 문법이 깨진다 → 커밋은 명령 하나에 하나씩 한다. (그 과정에서 401539b의 메시지가 깨져 amend로 고쳤다)
- [INFRA-1] 완료: d73d44c..4ae378b, npm test 24/24. 실제 작동 확인: 커밋된 테스트 파일 touch가 hook에 막힘 [확인됨].
- 미확인: on-prompt.mjs의 실제 작동(다음 사용자 메시지에서 확인 가능), ai-research Read 허용 규칙(새 세션에서 재확인).
- 병합: INFRA-1 → main (5dcb404). 주의: 병합 전 main으로 전환한 동안에는 `.claude/` 설정이 작업 트리에 없어서 hook이 꺼져 있었다 [추측]. 이제는 main에 들어갔으니 이후 브랜치에서는 문제없다.
- 한 줄 보고: [INFRA-2] 감사 에이전트와 기계 검사 스크립트. 범위: `scripts/check-method.mjs`, `test/infra/`, `.claude/agents/` / 하지 않을 것: 2차 hook, INFRA-1 결함 수정(범위 밖).
- 관찰: `test:red`는 import 단계에서 실패하면 파일 전체를 실패 1개로 센다 → "구현 전부터 통과하는 테스트"를 개별로 걸러내지 못한다(방식 피드백 후보).
- 실측 전 예상 [추측] E3: `check-method --id INFRA-1` → test-first ✅, test-unchanged ✅, message-format ✅, user-doc ✅, progress-updated ✅, tree-updated ➖, 커밋 7개(병합 제외).
- 실측 결과: E3 일치 [확인됨: 3c02aac에서 실행].
- [INFRA-2] 완료: 20ae0c7..e9b3197, npm test 35/35.
- 감사(INFRA-1, INFRA-2) → docs/method-feedback.md. 정정 기록:
  - ~~401539b, d1df48a, eb7eb8d의 "검증: npm test 24/24 통과"~~ → 사실과 다르다 [확인됨: git ls-tree]. 실제로는 모든 파일이 있는 작업 트리에서 실행한 결과다. 각 커밋 시점의 실제 상태: 401539b에는 실행기가 없어 실행할 수 없음, d1df48a에서는 hook이 없어 hooks 테스트 실패 예상, eb7eb8d에서는 on-prompt 테스트 3개 실패 예상 [추측: 다시 실행하지 않음]. 원인은 테스트를 돌린 뒤 커밋을 나눈 것이다.
  - d73d44c의 "22개 중 22개 실패" = hooks 21개 + import 단계에서 실패한 streak 파일 1개. 실제 테스트 수는 24개이고, streak 3개가 개별로 실패하는 것은 확인하지 않았다.

- 사용자 승인(AUDIT-1 보고서 1~6 모두 추천대로): INFRA-3 오탐 수정, O1(중간 커밋은 그 시점에 실행 가능한 결과만), O2(stub을 둔 뒤 red), O3(PR 첫 커밋 = 계획 커밋), O4~O8 반영, decisions.md 반영은 사용자가 ai-research에서 직접.
- 미확인 항목 처리(O6): on-prompt.mjs → 사용자 메시지("승인") 뒤 `.claude/state/`에 관찰할 수 있는 변화가 없었다(카운터가 이미 비어 있었음). hook 오류도 표시되지 않았다. 작동 여부는 아직 미확인이고, 카운터가 차 있을 때나 "테스트 수정 허용"을 입력했을 때 확인할 수 있다.

### [INFRA-3] 계획
- 한 줄 보고: guard.mjs가 **데이터 안의 `>`**(heredoc 본문, `-m "..."`, PowerShell here-string)를 리다이렉트로 보는 오탐을 고친다. 범위: `.claude/hooks/guard.mjs`, `test/infra/` 새 파일 2개, `docs/` / 하지 않을 것: 다른 hook 규칙 변경, 2차 hook.
- 테스트 구성: 새 동작(현재 막히지만 허용해야 함)은 red 대상이고, 회귀 테스트(지금도 막고 앞으로도 막아야 함)는 red 대상에서 뺀다. 회귀 테스트는 구현 전에도 통과하는 게 정상이기 때문이다.
- 예상 [추측]:
  - E4: 새 동작 테스트는 구현 전에 모두 **assertion 단계**에서 실패한다(deny가 나오는데 allow를 기대). guard.mjs가 이미 있어서 stub이 필요 없다.
  - E5: 회귀 테스트는 구현 전후 모두 통과한다.
  - E6: 병합 뒤 heredoc 커밋 메시지에 `test/` 경로와 `<...>`가 있어도 실제 커밋이 막히지 않는다.
- 실측: E4 일치(4개 모두 actual deny / expected allow로 실패), E5 일치(회귀 5개가 수정 전후 모두 통과), E6 일치(593fdf2를 heredoc + test/ 경로 + 메일 주소로 커밋 → 통과. 병합 전 브랜치에서 확인했다. hook은 작업 트리의 파일을 실행하기 때문). 회귀 실측: `cat > test/infra/hooks.test.mjs <<EOF`는 실제로 막힘 [확인됨].
- [INFRA-3] 완료: 77161c1..(문서 커밋), npm test 44/44. 이제 `.git/SUMUN_MSG` 우회는 필요 없다.

### [INFRA-4] 계획
- 한 줄 보고: 승인된 방식 보정 O1~O8을 반영한다. (1) check-method가 계획 커밋을 인식하고 `plan-first` 규칙을 추가, (2) CLAUDE.md에 관례 추가, (3) method-auditor 절차 갱신. 범위: `scripts/check-method.mjs`, `test/infra/` 새 파일, `CLAUDE.md`, `.claude/agents/method-auditor.md`, `docs/` / 하지 않을 것: 2차 hook, 기존 테스트 수정, ai-research 수정.
- 추가 관찰 O9 (INFRA-3에서): 회귀 테스트는 구현 전에도 통과하는 게 정상이라 red 대상이 아니다 → 새 동작 테스트와 파일을 나눈다.
- 예상 [추측]:
  - E7: 새 테스트 4개는 구현 전에 assertion 단계에서 실패한다(plan-first 규칙이 없어 undefined, 계획 커밋이 있으면 test-first가 ❌).
  - E8: 구현 뒤 `check-method --id INFRA-3` → plan-first ✅, test-first ✅(38dc06a), 나머지도 ✅.
  - E9: `--id INFRA-1` → plan-first ❌(규칙 도입 전 작업), 나머지는 이전과 같다.

- 실측: E7 일치(4개 모두 assertion 단계 실패), E8 일치(INFRA-3 모든 규칙 ✅/➖), E9 일치(INFRA-1은 plan-first ❌, 나머지 같음) [확인됨: 4928efc].
- [INFRA-4] 완료: 7cc1607..(문서 커밋), npm test 48/48.

### [INFRA-5] 계획
- 사용자 승인(2026-11-07): AUDIT-2 보고서 1~5, 설계 결정 1~4 모두 추천대로. ① 실행 전 패턴 검사 + 실행 후 git 결과 확인, ② 위반하면 자동 복구 + 보고, ③ 데이터 지우기를 좁게 적용, ④ 상태 폴더는 패턴 검사 유지 + 한계로 기록.
- 우회 사례: `docs/ai/guard-bypass-cases.md` (O10. 별도 검토 에이전트가 제안, 40개 [추측: 코드만 읽고 추론])
- 한 줄 보고: 목표 = 테스트 파일 보호를 결과 확인 중심으로 / 범위 = `guard.mjs`의 `stripData()`, 출력 정리 정규식, `TEST_PATH_RE` + 새 `.claude/hooks/verify-tests.mjs` + `.claude/settings.json`의 PostToolUse + `test/infra/` 새 파일 3개 + docs / 하지 않을 것 = 상태 폴더 규칙 강화, 기존 테스트 수정
- 설계:
  - 실행 전(guard): heredoc 본문은 **소비하는 명령이 실행기가 아닐 때만**(bash, sh, node, python, xargs, while read, eval 등이 아닐 때) 그리고 확장(`$(`, 백틱)이 없을 때만 지운다. here-string은 PowerShell에서만, 파이프나 iex 없이 쓸 때만 지운다. `-m`은 git commit/tag/merge에서만 지우고, `$(`나 백틱이 있으면 지우지 않는다. PowerShell에서는 `\"`를 이스케이프로 보지 않는다. `>&숫자` 뒤에 경로가 이어지면 지우지 않는다. `TEST_PATH_RE` 앞 글자에 `>` `,` `{`를 추가한다.
  - 실행 후(verify-tests, PostToolUse Bash|PowerShell): 잠금 상태에서 `git diff HEAD --name-only -- test/`에 파일이 있으면 `git checkout HEAD -- <파일>`로 복구하고 block 사유를 돌려준다.
- 미확인 항목(O13 분류): on-prompt 작동 → 세션 밖 조건 필요(사용자가 "테스트 수정 허용"을 입력하거나 카운터가 0보다 클 때) / ai-research Read 규칙, method-auditor 이름 호출 → 세션 밖 조건 필요(새 세션)
- 예상 [추측]:
  - E10: 새 동작(red) 테스트로 넣을 우회 사례 21개(4, 6, 6′, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 24, 26, 27)는 수정 전 guard에서 모두 allow라서 red 실패한다. **검토자의 추론이 틀려 이미 deny인 사례가 있으면, red가 "구현 전 통과"로 알려 줄 것이다** → 그 사례는 회귀 파일로 옮긴다.
  - E11: 정상 명령 회귀 10개는 수정 전후 모두 allow다.
  - E12: verify-tests 테스트는 stub(아무것도 안 함) 상태에서 "복구됨/차단" 사례만 실패하고, "변경 없음/잠금 해제/새 파일" 사례는 통과한다 → 앞의 것은 red 파일, 뒤의 것은 회귀 파일로 나눈다(O9, O15).
  - E13: 실행 전 검사로 못 막는 사례(1, 2, 3, 5, 20, 21, (다)·(라)의 규칙 A 위반)는 실행 후 검사가 복구한다. 대표로 `rm te?t/...` 형태를 실제 저장소에서 실측한다.
- 실측 (O17: 명령 원문 포함):
  - E10 일치: `npm run test:red -- test/infra/hooks-bypass.test.mjs test/infra/verify-tests.test.mjs` → 23개 모두 실패. 검토자가 추론한 우회 21개는 실제로도 모두 allow였다 [확인됨].
  - E11, E12 일치: `node --test test/infra/hooks-normal-regression.test.mjs test/infra/verify-tests-regression.test.mjs` → 수정 전 15/15.
  - E13 일치: `sed -i '1s/^/TAMPERED /' te?t/infra/hooks.test.mjs` → 실행 전 통과 → 실행 후 hook이 복구하고 block → `git diff HEAD -- test/` 비어 있음 [확인됨: b7c7d2d].
  - 예상 밖 1: 복구가 CRLF로 나와 2개 실패. 원인은 이 PC의 core.autocrlf → `-c core.autocrlf=false checkout`으로 해결.
  - 예상 밖 2: 상수를 사용 위치보다 아래에 선언해서 TDZ 오류 → 22개 실패. 그동안 실제 hook도 heredoc 명령에서 오류가 났고, `onFailure: block`이라 막히는 쪽(fail-closed)으로 동작했다 [추측: 그 사이 heredoc 명령을 실행하지 않음].
  - 예상 밖 3: E13을 처음 시도할 때 확인 명령(`head ... test/infra/...`)을 같은 줄에 붙였더니 실행 전 검사에 걸렸다 → 명령을 나눴다.
- [INFRA-5] 완료: 5254eb5..(문서 커밋), npm test 86/86. INFRA-3, INFRA-4 문서에 줄 번호를 보충했다(AUDIT-2 고칠 것).

### [INFRA-6] 계획
- 근거: AUDIT-2 보고서 2~4 승인(O10~O17) + INFRA-5 감사의 "고칠 것". 승인 상태는 이제 `docs/method-feedback.md` 한 곳에만 적는다(INFRA-5 감사 관찰).
- 한 줄 보고: 목표 = 승인된 O10~O17을 규칙과 검사에 반영 / 범위(O11 형식) =
  - `scripts/check-method.mjs`: `checkCommits()`에 규칙 `user-doc-lines`(O12: "먼저 볼 코드"에 `파일:줄`이 있는가) 추가, `plan-first`의 규칙 도입 전 작업은 ➖(O14). `loadCommits` 밖에서 문서 본문을 읽고 도입 시점을 판정한다
  - `test/infra/check-method-doc.test.mjs`(새 동작), `test/infra/hooks-normal-regression-2.test.mjs`(회귀: INFRA-5 감사가 지적한 빠진 정상 명령 5개)
  - `CLAUDE.md` 개발 방식 절(O10, O11, O13, O15, O17), `.claude/agents/method-auditor.md` 원칙 절(O16)
  - `docs/method-feedback.md`, `docs/ai/progress.md`, `docs/for-me/INFRA-6.md`
  - 하지 않을 것 = 새 관찰 O18~O21 반영(승인 전), hook 동작 변경
- 미확인 항목(O13): 세 항목 모두 "세션 밖 조건 필요". 바뀐 것 없음.
- 예상 [추측]:
  - E14: check-method-doc 테스트는 구현 전에 assertion 단계에서 모두 실패한다(`user-doc-lines` 규칙 없음, plan-first가 ➖가 아닌 ❌).
  - E15: 회귀 5개(pwsh `2>$null`, `git show HEAD:test/...`, `git log -- test/`, `git stash list`, `echo '<a@b.com>'`)는 지금도 allow라서 통과한다.
  - E16: 구현 뒤 `--id INFRA-1`과 `INFRA-2`는 plan-first ➖, `INFRA-3~5`는 ✅. `user-doc-lines`는 INFRA-1~5 모두 ✅다(INFRA-3, 4는 INFRA-5에서 줄 번호를 보충했고, HEAD 기준으로 판정하기 때문).
- 실측 (명령 원문):
  - E14 일치: `npm run test:red -- test/infra/check-method-doc.test.mjs` → 5개 모두 assertion 실패, 오류 0개.
  - E15 일치: `node --test test/infra/hooks-normal-regression-2.test.mjs` → 5/5.
  - E16 일치: `for i in 1 2 3 4 5; do node scripts/check-method.mjs --id INFRA-$i; done` → INFRA-1·2 plan-first ➖, 3~5 ✅, user-doc-lines 모두 ✅ [확인됨: c4dddb9].
  - 관찰: `sed -i`로 넣는 글자 안에 `test/` 경로가 있으면 실행 전 검사가 막는다. 의도한 보수적 동작이라 Edit 도구로 우회했다.
- [INFRA-6] 완료: 9c99332..(문서 커밋), npm test 96/96. 승인 상태는 docs/method-feedback.md의 "승인 상태" 표를 본다.

### [INFRA-7] 계획
- 근거: AUDIT-3 보고서 승인(1~4). 승인 상태는 docs/method-feedback.md "승인 상태" 표.
- 미확인 항목(O13): on-prompt 작동(세션 밖 조건: 사용자가 "테스트 수정 허용"을 입력하거나 카운터가 0보다 클 때), ai-research Read 규칙과 method-auditor 이름 호출(세션 밖 조건: 새 세션 시작 시). 이번에 바뀐 것 없음.
- 한 줄 보고: 목표 = 문서 검사의 주소:포트 오인 수정 + O18~O20, 감사 주기 반영 / 범위 = `scripts/check-method.mjs`의 `checkCommits()` 안 `user-doc-lines` 정규식과 `PLAN_RULE_SINCE`(전체 해시로), 새 `test/infra/check-method-doc-addr.test.mjs`, `CLAUDE.md` 개발 방식 절(O18, O19, O20, 감사 주기), `docs/` / 하지 않을 것 = O22~O25(보류), hook 변경. 보안·차단 규칙이 아니라서 O10(우회 사례 먼저)은 해당 없음. 감사 주기 결정에 따라 이 PR은 감사하지 않고 check-method만 돌린다.
- 예상 [추측]:
  - E17: 새 테스트(`` `127.0.0.1:8080` ``, `` `localhost:3000` ``, `` `http://localhost:8080` ``만 있으면 user-doc-lines 위반)는 구현 전에 assertion 실패한다. 지금 정규식이 셋 다 파일:줄로 인정하기 때문이다(AUDIT-3 감사자의 추측이 맞다면).
  - E18: 기존 check-method-doc 테스트(`src/proxy/server.ts:12`는 인정)는 구현 뒤에도 통과한다. INFRA-1~6 문서는 user-doc-lines ✅를 유지한다.
- 실측: E17 일치(`npm run test:red -- test/infra/check-method-doc-addr.test.mjs` → assertion 실패 3개, 감사자의 추측이 맞았음). E18 일치(`npm test` 99/99, `for i in 1..6; node scripts/check-method.mjs --id INFRA-$i` → user-doc-lines 모두 ✅) [확인됨: 9512d6b].
- [INFRA-7] 완료: 8f8a248..(문서 커밋). 감사 주기 결정에 따라 감사는 하지 않고 기계 검사만 했다.

### [PRX-1] 계획
- 근거: 사용자가 "시작" (2026-11-07). 시작 전 설명에서 쓴 실측(O17):
  - 명령: TCP 서버(127.0.0.1:18080)를 띄우고 `curl -x http://127.0.0.1:18080 http://example.com/hello?q=1` 실행 → 받은 첫 줄 `GET http://example.com/hello?q=1 HTTP/1.1`, 헤더 `Host: example.com`, `Proxy-Connection: Keep-Alive` [확인됨]
  - 같은 방식으로 https URL → `CONNECT example.com:443 HTTP/1.1`, 경로 없음 [확인됨]
  - Node http 서버(127.0.0.1:18081)로 같은 요청 → `req.url = "http://example.com/hello?q=1"`, 헤더 이름은 소문자. CONNECT 처리기가 없으면 응답 없이 연결이 끊김(curl 상태 000) [확인됨]
- 보안 사례(O10): `docs/ai/prx1-cases.md` (검토 에이전트가 명세만 보고 제안, 약 80개). 크기 때문에 PRX-1과 PRX-1b로 나눴다(목적 나무에 PRX-1b 추가).
- 미확인 항목(O13): 세 항목 모두 세션 밖 조건 필요(변화 없음).
- 한 줄 보고: 목표 = 127.0.0.1에서 absolute-form HTTP 요청을 받아 목적지로 중계 / 범위 =
  - 새 `src/proxy/server.ts`: `startProxy({ port })` → `{ port, close() }`. 항상 127.0.0.1에 바인딩한다(host 옵션 없음). absolute-form 해석, origin-form으로 변환, Host 재작성, hop-by-hop 제거(Connection 토큰 포함, 단 Host·Content-Length는 지우지 않음), Via `1.1 sumun` 추가, 루프(자기 주소, Via) → 508, CONNECT·https → 501, origin-form·http가 아닌 scheme → 400, 연결 실패 → 502. 오류 본문은 text/plain이고 입력을 반영하지 않는다.
  - 새 `test/prx/PRX-1.test.ts`, 새 `test/prx/_upstream.ts`(테스트용 로컬 목적지 서버 + 프록시 경유 요청 도우미)
  - `docs/ai/purpose-tree.md`(PRX-1 🔨, PRX-1b 추가), `docs/ai/prx1-cases.md`, `docs/for-me/PRX-1.md`, `docs/ai/map.md`(필요하면)
  - 하지 않을 것 = 배정 "1b" 사례, Flow 기록(PRX-2), CLI·실행 진입점(src/index.ts), 타입 검사 도구(tsc) 설치
- 예상 [추측]:
  - E19: stub(127.0.0.1을 지정하지 않고 listen하고, 모든 요청에 500을 돌려줌)에서 PRX-1 테스트는 모두 실패한다. 대부분 assertion 실패이고, CONNECT 테스트는 stub에 처리기가 없어 연결이 끊기므로 **오류**로 실패한다(실측에서 본 동작).
  - E20: 구현 뒤 실제 curl로 `curl -x http://127.0.0.1:<포트> http://127.0.0.1:<로컬서버>/hello?q=1`을 보내면 로컬 서버가 `/hello?q=1`과 `via: 1.1 sumun`을 받는다.
  - E21: Node는 `.ts` 테스트에서 `import ... from './x.ts'`처럼 **확장자를 붙여야** 불러올 수 있다.
- 실측:
  - E19 일치(구현 전): `npm run test:red -- test/prx/PRX-1.test.ts` → 21개 실패, assertion 20개 + 오류 1개(CONNECT). red에서 테스트 결함 3건을 찾아 커밋 전에 고쳤다(732b69b 메시지 참고).
  - E21: 확장자를 붙인 `.ts` import가 동작하는 것은 확인했다. 붙이지 않았을 때 실패하는지는 시험하지 않았다(미확인).
  - 구현 뒤 `npm test` 120/120 (44bd8c9).
  - E20 일치(일반 HTTP): `node --input-type=module -e "...startProxy({port:18088})..."` + `curl -s -i -x http://127.0.0.1:18088 http://127.0.0.1:18090/hello?q=1` → 목적지가 `GET /hello?q=1`, `via=1.1 sumun`, `host=127.0.0.1:18090`을 받음, proxy-connection 없음. curl은 200 + 본문 [확인됨].
  - ⚠ **불일치(예상 밖)**: 같은 실행에서 `curl -x ... https://example.com/`(CONNECT) → 501을 보낸 직후 curl이 연결을 리셋(ECONNRESET)했고, 소켓 오류 처리기가 없어 **프록시 프로세스가 죽었다** [확인됨]. 테스트 C18은 통과했다. 테스트 클라이언트는 연결을 정상적으로 닫았기 때문이다. 실제로는 HTTPS에 한 번만 접속해도 프록시가 꺼진다. → PRX-1 범위(C18 "멈추지 않음") 안에서 재현 테스트를 먼저 쓰고 고친다.
  - 실측 방법 오류 1건: 처음에 `execFileSync`로 curl을 실행해서 같은 프로세스의 프록시가 응답하지 못했다(모두 시간 초과) → 비동기 `execFile`로 바꿈.
  - 고친 뒤 재실측(2f1a5a9): 같은 스크립트로 CONNECT → 501(curl 종료 코드 7), 자기 자신 → 508, 이어서 `/still-alive` → 200, `curl http://127.0.0.1:18088/x`(origin-form) → 400 [확인됨]. npm test 121/121.
- 실측 재현 스크립트(O19, PRX-1 감사 지적): `node scripts/probe/prx1-curl.mjs` → 1) 200, 목적지가 `GET /hello?q=1 via=1.1 sumun host=127.0.0.1:18090 proxy-connection=undefined`를 받음 / 2) 501(curl 종료 코드 7) / 3) 508 / 4) 200 / 5) 400 [확인됨: AUDIT-4].
- [PRX-1] 완료: 026ecac..(문서 커밋). 결정 항목(추천안으로 진행, 보고서에 올림): 루프 508, Connection에 나열된 헤더는 RFC대로 제거(Host, Content-Length 제외), PRX-1b 노드 추가.

### [PRX-1b] 계획
- 사용자 결정(2026-11-07): "계속 진행해" → PRX-1 결정 항목(508, Connection 나열 헤더 RFC대로 제거, 사례 분할)을 승인으로 기록한다.
- 미확인 항목(O13): 세 항목 모두 세션 밖 조건 필요. 변화 없음. 이월된 "고칠 것": 범위에 도우미 모듈도 파일 이름 + 함수로 적기(O11) → 이 계획에서 적용한다.
- 한 줄 보고: 목표 = 요청 쪽 공격·이상 입력을 막는다. 무엇을 Node 파서가 이미 막는지 실측해서 테스트로 고정한다 / 범위 =
  - `src/proxy/server.ts`: `'request'` 처리기 안의 대상 검사 → 함수 `validateTarget(url)`로 분리. 추가 규칙: 호스트 없음, 포트 0은 400 / 함수 `validateHost(req)`: Host가 둘 이상이거나 `,`·공백이 들어 있으면 400 / `startProxy()`의 http 서버 옵션(헤더 개수 제한을 몰래 버리지 않게 하는 처리)
  - 새 `test/prx/_raw.ts`(원시 바이트로 요청을 보내는 도우미: 함수 `rawRequest`), 새 `test/prx/PRX-1b.test.ts`(새 동작), 새 `test/prx/PRX-1b-regression.test.ts`(Node가 이미 막아서 구현 전에도 통과하는 사례)
  - `docs/ai/purpose-tree.md`(PRX-1b 🔨, PRX-1c 추가), `docs/ai/prx1-cases.md`(1b/1c 배정), `docs/for-me/PRX-1b.md`
  - 하지 않을 것 = 배정 "1c", CLI, tsc
- 예상 [추측] — Node 24 llhttp 파서와 http 서버의 기본 동작에 대한 추측이다:
  - E22: **구현 전에도 통과(=Node나 PRX-1이 이미 막음)**: C1(`*`), C5의 `:65536`·`:abc`·`:-1`·`:80:81`(URL이 거부), C6(userinfo 제거), C7(제어문자), C9(경로 원문), C11(zone ID), C12(대문자 scheme), C13(100KB URL → 431), C15(HTTP/1.1 Host 없음 → 400), C17(HTTP/1.0 Host 없음 → 정상), C19, D1(CL+TE), D2(다른 CL 두 개), D3(CL 이상값), D6(헤더 이름 뒤 공백), D7(obs-fold), D9(잘못된 chunk), D10(파이프라인), D14(64KB 헤더 → 431), E4, E6, E14
  - E23: **구현 전에 실패(새 동작)**: C2 `http:///path`(WHATWG URL이 "path"를 호스트로 해석할 것), C5 `:0`(포트 0으로 연결 시도 → 502), C16(Host 두 줄, `Host: a, b` — Node는 막지 않을 것), D15(작은 헤더 3,000개 → Node가 2,000개 넘는 헤더를 몰래 버릴 것)
  - E24: 확신 없음 → 실측으로 정한다: D4(TE `identity`, `chunked, identity`), D5(HTTP/1.0 + TE), D8(LF만 있는 줄바꿈)
- 실측 (명령: `node --test test/prx/PRX-1b.test.ts`, 이때는 46개를 한 파일에 둔 상태로 PRX-1 구현에 대고 실행):
  - 46개 중 36개 통과, 10개 실패.
  - E22: 대부분 일치. **불일치**: C13·D14는 상태 0(Windows에서 RST가 응답을 지움 → 측정 방법 문제), C19 DELETE·PATCH 실패(테스트 클라이언트가 DELETE에 Content-Length를 붙이지 않음 → 테스트 결함).
  - E23: C2 `http:///path`(응답 지연, DNS 조회 시도), C5 포트 0(502), C16 3건 일치. **불일치**: D15는 Node가 이미 431로 거부했다(몰래 버릴 것이라는 예상이 틀림).
  - E24 결과: D4 3건, D8 2건은 Node가 거부. **D5는 Node가 받아서 넘겼다** → 새 동작.
  - 새 동작 6개, 회귀 40개로 나눠 커밋(5ad27d9). 구현 뒤 `npm test` 167/167(fb8c15c). 실측: `node scripts/probe/prx1b-curl.mjs` → 200 / 400 / 400 / 400 / 200 [확인됨].
- 계획과 달라진 점: D5는 Host 검사가 아니라 본문 경계 검사라 함수 `validateFraming()`을 따로 뒀다. D15는 Node가 이미 막아서 서버 옵션 변경이 필요 없어졌다.
- [PRX-1b] 완료: 71eb378..(문서 커밋).

### [PRX-1c] 계획
- 미확인 항목(O13): 세 항목 모두 세션 밖 조건 필요, 변화 없음.
- 사례: prx1-cases.md 배정 "1c". A10(포트 값 검사)은 사용자 설정 검사라 CLI 단계로 옮긴다(테스트는 임의 포트 0을 써야 함).
- 한 줄 보고: 목표 = 목적지 쪽 이상과 견고성. 이미 되는 것과 새로 필요한 것을 실측으로 나눈다 / 범위 =
  - `src/proxy/server.ts`: `startProxy()` 옵션 `upstreamTimeoutMs`(목적지 무응답 → 504), `headersTimeoutMs`(느린 헤더 → 408, Node의 `headersTimeout`·`connectionsCheckingInterval` 설정) / `'request'` 처리기의 목적지 요청에 타임아웃 / 서버·목적지의 `'upgrade'` 처리(전환하지 않음) / 루프 검사를 함수 `isSelf(url)`로 분리(필요하면 루프백 범위로 넓힘)
  - 새 `test/prx/_raw-upstream.ts`(원시 바이트로 응답하는 목적지: 함수 `startRawUpstream`), 새 `test/prx/PRX-1c.test.ts`(새 동작), 새 `test/prx/PRX-1c-regression.test.ts`(이미 되는 것)
  - 새 `scripts/probe/prx1c-stream.mjs`(대용량 스트리밍 메모리 실측, B9), A9(0.0.0.0:P 점유 중 시작)도 실측으로 기록
  - `docs/ai/purpose-tree.md`, `docs/ai/prx1-cases.md`(A10 이동), `docs/for-me/PRX-1c.md`
  - 하지 않을 것 = CLI(A10), Flow 기록(PRX-2)
- 예상 [추측]:
  - E25(이미 됨): A2(LAN IP 192.168.35.181로 접속 → 거부), A7·A8(포트 점유 → startProxy 실패), B2 나머지(127.1, 2130706433, 0x7f000001은 URL이 127.0.0.1로 정규화 → 508 / 0.0.0.0, 127.0.0.2 → 502), B3(`localhost.` → 자기에게 닿지만 Via로 508), B7(목적지가 응답 도중 끊음 → 클라이언트 연결 끊김, 프록시 생존), B10(.invalid → 502), B11(깨진 목적지 응답 → 502), C11([::1] 목적지 → 정상, Host [::1]:P), D11(Expect: 100-continue), D12(HEAD·204·304에 본문 없음), D13(연결 종료로 끝나는 응답), D16(큰 응답 헤더 → 502), E9(chunked 응답의 경계 하나), E10, E11(keep-alive로 다른 목적지), E12(Set-Cookie 여러 줄 보존)
  - E26(새 동작): B8(목적지 무응답 → 지금은 끝없이 기다림), D17(옵션이 없어 짧은 시간으로 시험 불가), E7(목적지가 101을 보내면 → 지금 동작 모름, 502여야 함)
  - E27(모름 → 실측): A9(다른 프로세스가 0.0.0.0:P를 쓰는 중 127.0.0.1:P로 시작), B6(NODE_USE_ENV_PROXY=1 + HTTP_PROXY가 이 프록시를 가리킬 때 agent:false 요청이 환경 프록시를 따르는지)
- 실측:
  - E27: `node scripts/probe/prx1c-a9-b6.mjs` → A9 "성공(같은 포트를 나눠 씀)" → 새 동작, B6 "200 upstream-ok" → 회귀 [확인됨].
  - 전체 사례: `node --test --test-timeout=15000 test/prx/PRX-1c.test.ts`(이때는 34개를 한 파일에 둔 상태) → 28개 통과, 6개 실패. B8·D17은 15초 제한까지 기다림(E26 일치). E25 **불일치**: B2의 0.0.0.0, B3의 localhost. 은 400이었다(자기에게 되돌아온 요청이 origin-form이라 거부됨. 무한 반복은 없음) → Via를 먼저 검사해서 508로. E7(101)은 상태 0 = 멈춤(E26 "모름" → 문제 확인).
  - 새 동작 6개, 회귀 28개로 나눠 커밋. 실수 1건: 처음에 실측 스크립트를 테스트 커밋에 섞음 → 병합 전에 `git reset --soft`로 되돌려 다시 나눔(fcab10c).
  - 구현 뒤 `npm test` 201/201(09dab30). A9 재실측 → "실패 EADDRINUSE" [확인됨]. 기존 prx1-curl.mjs, prx1b-curl.mjs 결과 변화 없음.
  - B9: `node scripts/probe/prx1c-stream.mjs 64|512|2048` → 최대 RSS 96 / 142 / 162MB(시작 61MB), 바이트 일치 → 스트리밍 [확인됨]. 늘어난 부분은 GC가 늦게 치우기 때문으로 본다 [추측].
- 계획과 달라진 점: isSelf()는 루프백 범위로 넓히지 않았다. 대신 Via 검사를 맨 앞으로 옮겨서 해결했다(주소 표기를 다 열거하지 않아도 됨).
- [PRX-1c] 완료: 3ec846e..(문서 커밋).

### [PRX-2] 계획
- 사용자 결정(2026-11-07, "추천대로"): 기록은 **메모리에만**, 본문은 요청·응답 각 **1MB**까지(넘으면 잘림 표시, 중계는 전체), 건수 상한 1,000건은 STO가 맡는다, 민감한 값은 **원본 그대로** 기록하고 가리기는 UI 단계에서 정한다. 대신 기록이 콘솔·오류·디스크로 새지 않는지 테스트한다.
- 미확인 항목(O13): ai-research Read → 이번 세션은 자동 승인 모드라 판정 불가(세션 밖 조건 유지). method-auditor 이름 호출 → 새 세션에서 안 됨 [확인됨]. on-prompt → 세션 밖 조건 유지.
- 보안 사례(O10): `docs/ai/prx2-cases.md`(검토 에이전트가 명세만 보고 49개 + 결정 항목 12개). 크기 때문에 PRX-2와 PRX-2b로 나눴다(목적 나무에 PRX-2b 추가). 결정 항목 D1~D12는 Claude 추천으로 진행하고 보고서에 올린다.
- 한 줄 보고: 목표 = 프록시가 처리한 요청마다 Flow 하나를 구독자에게 넘긴다 / 범위 =
  - 새 `src/flow/flow.ts`: 타입 `Flow`, 상수 `FLOW_BODY_LIMIT`(1,048,576), 함수 `createBodyCapture(limit)`(→ `push(chunk)`, `result()`: 별도 메모리에 앞 limit바이트 복사, 전체 크기, 잘림 여부), 함수 `headerPairs(rawHeaders)`
  - `src/proxy/server.ts`: `startProxy()` 옵션 `onFlow`(함수가 아니면 시작 거부), `'request'` 처리기에서 요청·응답 본문을 `pipe`는 그대로 두고 `'data'`로 엿보며 기록, 완료·실패를 한 번만 판정하는 함수 `finish()`, 구독자를 안전하게 부르는 함수 `emitFlow()`(예외·reject를 삼키고 고정 문구 한 줄)
  - 새 `test/prx/_flow.ts`(함수 `recordingProxy`: 기록을 모으는 프록시, `waitFlows(n, ms)`: 시간 안에 못 받으면 assertion으로 실패), 새 `test/prx/_flow-child.ts`(자식 프로세스로 띄우는 프록시: stdout/stderr 수집용), 새 `test/prx/PRX-2.test.ts`(새 동작), 새 `test/prx/PRX-2-regression.test.ts`(구현 전에도 통과)
  - `docs/ai/purpose-tree.md`(PRX-2 🔨, PRX-2b 추가), `docs/ai/prx2-cases.md`, `docs/ai/map.md`(Flow 형태, #공유), `docs/for-me/PRX-2.md`
  - 하지 않을 것 = 배정 "2b"(메모리 측정, 파서 오류, 1xx 등), 건수 상한(STO), 화면, CONNECT 기록(TLS)
- Flow 형태 [추측: 설계]: `{ id, startedAt(epoch ms), durationMs(단조 시계), request: { method, url(받은 원문), httpVersion, headers: [이름, 값][], body: Buffer, bodySize, bodyTruncated }, response?: { 같은 모양 + status, statusMessage }(목적지가 보낸 것만), error?: { by: 'proxy'|'client'|'upstream', code, status? } }`
- 예상 [추측]:
  - E28: stub(`createBodyCapture`가 빈 결과를 내고 server.ts는 `onFlow`를 무시)에서 새 동작 테스트는 모두 **assertion**으로 실패한다(기록이 오지 않음 → `waitFlows`가 시간 초과를 assertion으로 알림). 오류 0개.
  - E29: 구현 전에도 통과(회귀): F1(오류 응답에 표식 없음), F2의 "정상 요청 때 출력 없음", F6(새 파일 없음), I7의 "구독자 없음 = 정상 동작". 이것들은 기록 기능이 없어도 성립하기 때문이다.
  - E30: `Buffer.concat`으로 작은 본문을 합치면 결과가 8KB 공유 풀의 일부다(`body.buffer.byteLength > body.length`) → 그대로 쓰면 F9 위반.
  - E31: Node `rawHeaders`는 순서·대소문자·중복을 보존한다(H5). 응답 쪽도 `up.rawHeaders`로 같다.
  - E32: 클라이언트가 중간에 끊으면 `res`에 `'close'`가 오고 `'finish'`는 오지 않는다. 이것으로 성공과 중단을 나눌 수 있다.
  - E33: async 구독자의 reject를 잡지 않으면 자식 프로세스가 종료 코드 1로 죽고 stderr에 reason(표식 포함)이 찍힌다. 구현 전에는 구독자가 불리지 않으므로 이 테스트는 "호출됨" assertion으로 실패한다.

- 실측 (명령 원문):
  - E28 일치: stub에서 `npm run test:red -- test/prx/PRX-2.test.ts` → 37개 모두 실패, assertion 37개, 오류 0개.
  - E29 일치: `node --test test/prx/PRX-2-regression.test.ts` → 구현 전 4/4.
  - 구현 뒤: flow.ts만 있는 시점(server.ts를 `git show HEAD:src/proxy/server.ts`로 잠시 되돌려 `node --test test/prx/PRX-2.test.ts`) → 37개 중 5개 통과. server.ts까지 → `npm test` 242/242(a74a6b2).
  - E30 **부분 불일치**: `node scripts/probe/prx2-node.mjs` → 작은 `Buffer.concat` 결과가 공유 풀의 일부인 것은 맞다. 다만 풀 크기는 8KB가 아니라 `buffer.byteLength=65536` [확인됨]. 대응은 같다(allocUnsafeSlow로 복사).
  - E31 일치: H5 테스트 통과(요청·응답 rawHeaders 순서·대소문자·중복 보존).
  - E32 일치: H10 테스트 통과(`res.writableFinished`가 false인 채 'close' → 클라이언트 중단).
  - E33 일치: 같은 스크립트 → 처리되지 않은 reject는 종료 코드 1, stderr에 표식 있음 [확인됨].
  - 실제 curl: `node scripts/probe/prx2-curl.mjs` → curl 3번에 기록 3개, 2MB 응답 기록 1048576/2000000 잘림(curl은 2000000 받음), 닫힌 포트 error {by: upstream, code: unreachable, status: 502} [확인됨].
  - 작업 중 관찰: hook이 셸 명령 안에 테스트 폴더 경로와 리다이렉트 기호가 함께 있을 때(heredoc 커밋 메시지, 출력 버리기)와 `git stash`, `git checkout HEAD --`를 막았다. 의도한 보수적 동작이라 Write 도구로 메시지·스크립트 파일을 쓰고 명령을 나눠서 진행했다.
- 계획과 달라진 점: 실패 코드(`rejected`, `loop`, `unreachable`, `timeout`, `upgrade`, `aborted`)는 계획에 없었고 테스트에서 정했다.
- [PRX-2] 완료: 44878a3..(문서 커밋). 결정 항목 D1~D12는 추천안으로 진행했다. 사용자에게 특히 확인받을 것: D4(거절된 요청도 기록), D5(완료 때만 호출).

### [PRX-2b] 계획
- 사용자: "계속"(2026-11-07). PRX-2의 D4, D5는 답을 받지 않은 채 추천안을 유지한다(추가만 하면 바꿀 수 있는 결정).
- 미확인 항목(O13): 세 항목 모두 변화 없음. ai-research Read 규칙과 on-prompt.mjs는 세션 밖 조건이 필요하고, method-auditor 이름 호출은 이 세션에서 안 된다 [확인됨, PRX-2 계획].
- 사례: prx2-cases.md 배정 "2b" = F3, F5, F7, G1~G9, H6, H13, H16, I3, I6, I7(구독자 안에서 close). 검토 에이전트 사례는 PRX-2에서 이미 받았다(O10).
  - I6(구독자가 프록시를 거쳐 요청)은 테스트하지 않고 문서로 남긴다: 구독자는 우리 코드(STO, UI)이고, 그 요청은 새 요청이라 루프 감지(Via)로 막을 대상이 아니다. STO·UI에서 "구독자 안에서 프록시를 거치는 요청을 만들지 않는다"를 지킨다.
- 한 줄 보고: 목표 = 기록 기능이 메모리·자원과 경계 사례에서 안전한지 실측으로 나누고, 새로 필요한 것만 고친다 / 범위 =
  - `src/proxy/server.ts`: (E35가 맞으면) 목적지 요청 `http.request()`의 응답 헤더 개수 제한 처리
  - 새 `test/prx/PRX-2b.test.ts`(새 동작), 새 `test/prx/PRX-2b-regression.test.ts`(이미 되는 것). 도우미는 PRX-2의 `test/prx/_flow.ts`(recordingSetup, send, childProxy, secret)를 그대로 쓴다
  - 새 `scripts/probe/prx2b-memory.mjs`(G1, G2, G5, G6: 기록을 켠 프록시를 자식 프로세스로 띄우고 최대 RSS를 잰다)
  - `docs/ai/purpose-tree.md`(PRX-2b ✅), `docs/ai/prx2-cases.md`(I6 처리, D7 결정), `docs/for-me/PRX-2b.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 건수 상한(STO), CLI, 화면
- 예상 [추측]:
  - E34(이미 됨 → 회귀): F3(파서 오류 때 출력 없음, Node가 400을 보냄), F5(종료할 때 아무것도 덤프하지 않음), F7(package.json·scripts에 진단 플래그 없음), G3(거짓 Content-Length로 미리 할당하지 않음: 연결 50개에 arrayBuffers가 10MB 넘게 늘지 않음), G4(gzip 본문을 압축된 그대로 기록), G7(느린 본문 → upstreamTimeoutMs 뒤 504로 끝나고 기록 1번), G8(완료된 기록을 프록시가 붙잡지 않음: gc 뒤 WeakRef가 비어 있음), H6(앞뒤 공백은 지워지고 0x80~0xFF는 latin1로 손실 없이 복원), H13(Node 파서가 거절한 요청은 기록 없음), H16(100-continue와 103 뒤 최종 200을 기록), I3(async 구독자가 오래 걸려도 다음 요청이 늦어지지 않음), I7(구독자 안에서 close해도 프로세스가 죽지 않음)
  - E35(새 동작): G9 — 목적지가 응답 헤더를 2,500개 보내면 Node 클라이언트가 2,000개 넘는 헤더를 **몰래 버려서**, 클라이언트도 기록도 2,000개만 받는다. 요청 쪽은 PRX-1b D15에서 Node가 431로 거부한다고 확인했다.
  - E36(측정): 기록을 켜도 G1(512MB 응답) 최대 RSS가 PRX-1c B9(142MB)와 비슷하다. G2(1바이트 청크 100만 개)는 시작보다 50MB 넘게 늘지 않는다. G5(클라이언트가 읽지 않음, 목적지 512MB)도 100MB 넘게 늘지 않는다(pipe 역압 유지). G6(연결 200개가 각각 1MB-1 본문을 보내고 멈춤)은 약 200~400MB 늘어난다 → D7 결정 근거.

- 실측 (명령 원문):
  - 13개를 한 파일(측정용, 커밋하지 않음)에 써서 `node --test`로 PRX-2 구현에 실행 → 11개 통과, 2개 실패. G4 실패는 테스트 결함(G3이 끊은 연결 50개의 기록이 G4로 넘어감) → G3 안에서 `take(50)`으로 받도록 고친 뒤 통과. 진짜 실패는 G9 하나.
  - E34 일치: 회귀 12개. `node --test test/prx/PRX-2b-regression.test.ts` → 12/12.
  - E35 **불일치(개수)**: `node scripts/probe/prx2b-g9.mjs 1999`(2000, 2001, 2500도) → 클라이언트·기록 모두 a 헤더 **1,000개**. 몰래 버린다는 예상은 맞았지만 기준은 2,000이 아니라 1,000이다. 뒤의 Content-Length도 버려졌다 [확인됨].
  - red: `npm run test:red -- test/prx/PRX-2b.test.ts` → assertion 실패 1개, 오류 0개. 구현(`upstream.maxHeadersCount = 0`) 뒤 `npm test` 255/255(a3ade17). 같은 스크립트로 2500·3500 → 전부, 10000·20000·100000 → 502 [확인됨].
  - E36: `node scripts/probe/prx2b-memory.mjs` → G1 63→138MB(일치), G2 67→119MB(+52, 예상 50 이하를 조금 넘음), G5 67→130MB(일치, 역압 유지), G6 멈춘 동안 298MB, 끊을 때 최대 475MB(+408) [확인됨]. ~~예상 상한 근처~~ → **불일치(예상 +200~400MB의 상한 초과)** (AUDIT-5 정정).
- 결정: D7(진행 중 기록 전체 상한) → 두지 않음, STO의 바이트 상한에서 다시 본다. I6 → 규칙으로 남김(prx2-cases.md).
- 계획과 달라진 점: 없음(범위대로 server.ts 한 줄 + 테스트 2개 + 실측 2개). 실측 스크립트가 prx2b-memory.mjs 하나에서 prx2b-g9.mjs까지 두 개가 됐다.
- [PRX-2b] 완료: 67e36be..(문서 커밋). PRX 큰 단위 완료 → 큰 단위 감사.

### [AUDIT-5] PRX 큰 단위 감사 (2026-11-07)
- 감사 기록: docs/method-feedback.md "[PRX] 큰 단위 감사". 감사자에게는 노드 ID(PRX)만 넘겼다. method-auditor를 이름으로 부를 수 없어 범용 에이전트가 정의 파일을 읽고 따랐다.
- 범위 정정(O11, 감사 지적): 계획 커밋의 범위에 다음 파일이 없었다 — PRX-1b(71eb378): `test/prx/_prx1b-setup.ts`, `scripts/probe/prx1b-curl.mjs` / PRX-1c(3ec846e): `test/prx/_prx1c-setup.ts`, `scripts/probe/prx1c-a9-b6.mjs` / PRX-2(44878a3): `scripts/probe/prx2-curl.mjs`, `scripts/probe/prx2-node.mjs`. PRX-1 감사의 "도우미도 범위에 적기"를 1b 계획에서 적용했다고 체크했지만, 그 계획에서 setup 도우미가 빠졌다.
- 바로 고친 것: PRX-1b.md·PRX-1c.md 줄 번호 기준 해시, 위 범위 정정, E36 G6 불일치 표시.
- 사용자 결정 대기: 큰 단위 확인(검토 에이전트 + 중간 확인 보고서), 큰 단위 테스트 (가)/(나), PRX 상태 🔨 되돌리기, O22~O38 승인.

### [PRX-T] 계획
- 사용자 결정(2026-11-07, "추천대로"): AUDIT-5 결정 1-(가) 큰 단위 테스트를 지금 추가, 2 TLS 전에 큰 단위 확인(검토 에이전트 + 중간 확인 보고서), 3 PRX 상태를 확인 대기(🔨)로 되돌림, 4 O22~O38은 보고서에 추천과 함께 모음.
- 미확인 항목(O13): 변화 없음(PRX-2b 계획과 같음).
- 한 줄 보고: 목표 = 사용자 흐름(브라우저가 프록시를 거쳐 요청 → 기록이 남음)을 처음부터 끝까지 한 번에 확인하는 테스트 / 범위 =
  - 새 `test/prx/PRX-T-regression.test.ts`: 실제 `curl.exe -x`로 (1) 쿠키·쿼리·본문이 있는 POST → curl 결과, 목적지가 받은 요청, 기록(Flow)을 함께 확인 (2) 닫힌 포트 → curl 502 + 기록의 error. curl이 없으면 건너뜀. 도우미는 기존 `test/prx/_flow.ts`의 `startByteUpstream`을 쓴다
  - `docs/ai/purpose-tree.md`(PRX 🔨 확인 대기, PRX-T 추가), `docs/for-me/PRX-T.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 코드 변경, HTTPS(TLS 단계에서 이 흐름을 이어 붙인다), 중간 확인 보고서(다음 작업)
- 이 테스트는 이미 만든 기능을 이어 붙여 확인하는 것이라 **구현 전에도 통과하는 게 정상이다** → 회귀 파일로 두고 red 대상이 아니다(O9). 큰 단위를 시작할 때 먼저 썼어야 했다(AUDIT-5 지적, O33).
- 예상 [추측]:
  - E37: 테스트는 처음 실행에서 통과한다(작은 단위가 각각 검증한 것을 이어 붙였을 뿐이라서). 실패하면 작은 단위 사이의 이음새 문제이므로 범위 안 결함으로 기록하고 보고한다.
  - E38: curl이 보낸 헤더 순서는 Host, User-Agent, Accept, Proxy-Connection, Cookie, Content-Length, Content-Type이다(prx2-curl.mjs 실측과 같음). 테스트는 순서가 아니라 존재만 확인한다.

- 실측 (명령 원문):
  - E37 일치: `node --test test/prx/PRX-T-regression.test.ts` → 2/2 통과, 건너뜀 0. `npm test` 257/257(04a3143).
  - E38: 테스트는 헤더의 존재만 확인한다. 순서는 이번에 다시 재지 않았다(PRX-2의 `node scripts/probe/prx2-curl.mjs` 결과가 근거).
- [PRX-T] 완료: a28e879..(문서 커밋). 다음: 검토 에이전트(목표 문서만) → 중간 확인 보고서.

### [REPORT-PRX] PRX 중간 확인 보고서 (2026-11-07)
- 검토 에이전트(새 컨텍스트, 목표 문서 `docs/ai/purpose-tree.md`와 코드만, progress·for-me·method-feedback·사례 문서·커밋 메시지는 읽지 않게 함): 일치 17, 불일치 0, 판단 불가 3. 결정 항목 후보 A~G를 냈다. 검증 스크립트는 저장소 밖 임시 폴더에 있어 재현할 수 없다(O19 한계, 보고서에 표시).
- 실행 증거(bb0be05): `npm test` 257/257, `node scripts/probe/prx1-curl.mjs` 200/501/508/200/400, `node scripts/probe/prx2-curl.mjs` 기록 3건 [확인됨].
- 보고서: `docs/for-me/PRX-report.md` — 결정 항목 15건(추천과 현재 구현이 다른 것: 2, 3, 4, 6, 10), 방식 보정 O22~O38 모두 승인 추천.
- 사용자 답을 기다린다. 승인되면: INFRA-8(방식 반영) → Flow 모양 보완(2, 3, 4, 10) → 실행 진입점(6, A10) → PRX ✅ → TLS.

### [INFRA-8] 계획
- 근거: PRX 중간 확인 보고서 "승인"(2026-11-07). 결정 항목 15건은 추천대로, 방식 보정 O22~O38은 모두 승인. 승인 상태는 docs/method-feedback.md "승인 상태" 표.
- 미확인 항목(O13): 변화 없음.
- 한 줄 보고: 목표 = 승인된 O22~O38을 지침과 기계 검사에 반영 / 범위 =
  - `scripts/check-method.mjs`:
    - `checkCommits()`: 계획 뒤 "실측:" 커밋(scripts/probe/만)을 건너뛰고 테스트 커밋을 찾음(O35), 규칙 `test-commits-test-only`("테스트:" 커밋마다 test/만, O27), 규칙 `predictions-measured`(progress.md의 그 노드 계획 절에서 예상 E번호마다 실측 줄이 있는가, O24), 규칙 `user-doc-lines-valid`("먼저 볼 코드"의 `파일:줄`이 문서 커밋 시점에 실제로 있고 빈 줄이 아닌가, O34), 결과마다 `basis`(기준 시점, O22)
    - 새 함수 `checkBigUnit()`: 큰 단위 ID면 하위 노드 결과를 모으고 규칙 `big-unit-test`(`<ID>-T` 노드), `big-unit-report`(`docs/for-me/<ID>-report.md`), `big-unit-review`(보고서에 검토 에이전트 확인)를 본다(O32)
    - CLI(`loadCommits` 근처): 하위 노드 찾기, progress 절·문서 커밋 시점 파일을 읽어 넘김, 표에 "기준" 열
  - 새 `test/infra/check-method-infra8.test.mjs`(새 동작)
  - `CLAUDE.md` 개발 방식 절(O23, O25, O26, O28~O31, O34~O38) + 새 "큰 단위" 절(O33, O37), `.claude/agents/method-auditor.md`(큰 단위 절차 확인, O32·O33)
  - `docs/method-feedback.md`(승인 상태), `docs/for-me/PRX-report.md`(승인 표시), `docs/for-me/INFRA-8.md`, `docs/ai/progress.md`
  - 하지 않을 것 = hook 변경, O30 보충 테스트(다음 PRX 작은 단위), Flow 모양 변경
- 보안·차단 규칙(hook, 권한, 인증서)이 아니라서 O10은 해당 없다.
- 예상 [추측] (O38: 판정 기준 포함):
  - E39: 새 테스트는 구현 전에 모두 **assertion**으로 실패한다(새 규칙이 없어 결과가 undefined, `checkBigUnit`은 없어서 import 단계 오류가 나지 않게 테스트가 `mod.checkBigUnit`이 함수인지 assertion으로 먼저 본다). 판정: assertion 실패 수 = 테스트 수, 오류 0개면 일치.
  - E40: 구현 뒤 `node scripts/check-method.mjs --id <노드>`를 PRX-1b, 1c, 2, 2b, T에 돌리면 `predictions-measured`와 `user-doc-lines-valid`가 모두 ✅다. 판정: 5개 노드 × 2규칙 = 10개가 모두 ✅면 일치, 하나라도 ❌면 불일치(원인 기록).
  - E41: `--id PRX`는 큰 단위로 인식해서 하위 노드 6개(PRX-1, 1b, 1c, 2, 2b, T)를 모으고 `big-unit-test`, `big-unit-report`, `big-unit-review`가 ✅다. 판정: 하위 노드 수 6, 세 규칙 모두 ✅면 일치.

- 실측 (명령 원문):
  - E39 일치: `npm run test:red -- test/infra/check-method-infra8.test.mjs` → 처음 16개 중 1개가 구현 전에 통과("scripts/probe 밖을 바꾼 실측 커밋은 건너뛰지 않음" — 지금은 아무것도 건너뛰지 않으므로) → 회귀 파일로 옮긴 뒤 15개 모두 실패, assertion 15개, 오류 0개.
  - E40 일치: `for i in PRX-1b PRX-1c PRX-2 PRX-2b PRX-T; do node scripts/check-method.mjs --id $i; done` → predictions-measured·user-doc-lines-valid 10개 모두 ✅.
  - E41 일치: `node scripts/check-method.mjs --id PRX` → 하위 노드 6개, big-unit-test·report·review ✅. 판정 기준 밖의 추가 결과: sub-nodes ❌(PRX-1 test-commits-test-only, 29891e8 테스트 커밋에 progress.md — AUDIT-4가 지적한 과거 위반).
  - INFRA-1~7에 같은 검사 → ❌ 없음. `npm test` 273/273(e53f214).
- 계획과 달라진 점: 없음.
- [INFRA-8] 완료: 1b1cfaf..(문서 커밋). 다음: Flow 모양 보완(보고서 결정 2, 3, 4, 10 + O30 보충 테스트).

### [PRX-3] 계획
- 근거: PRX 중간 확인 보고서 승인(2026-11-07) — 결정 2(시작 + 끝), 3(목적지 칸), 4(본문 도중 타임아웃 5분), 10(bad-response). 그리고 O30 보충(유출 테스트의 긍정 전제).
- 미확인 항목(O13): 변화 없음.
- 큰 단위 절(CLAUDE.md): PRX의 큰 단위 테스트(PRX-T)는 있다. 이 작은 단위가 끝나면 PRX-T를 포함해 전체를 다시 돌린다.
- 설계 [추측]:
  - 시작 알림은 새 옵션 `onFlowStart(start)`로 한다. 기존 `onFlow`는 "끝날 때 1번"을 유지한다. `onFlow`를 두 번 부르게 바꾸면 커밋된 PRX-2 테스트(I5: 요청당 정확히 1번)를 고쳐야 하기 때문이다. 같은 요청의 시작과 끝은 같은 `id`를 갖는다. start = `{ id, startedAt, request: { method, url, httpVersion, headers, target } }`(본문·응답 없음).
  - `request.target = { scheme, host, port, path }`: absolute-form을 해석한 값. host는 WHATWG URL의 hostname(소문자, IPv6는 대괄호), port는 숫자(생략 시 http 80, https 443), path는 rawPath(정규화하지 않은 원문, #조각 제외). 해석할 수 없는 요청(origin-form 등)은 `target` 없음.
  - 타임아웃: `upstreamTimeoutMs`(30초)는 **응답 헤더를 받기 전**까지만. 응답 헤더를 받은 뒤에는 새 옵션 `upstreamBodyTimeoutMs`(기본 300,000 = 5분) 동안 아무것도 오지 않으면 끊고 error `{ by: 'upstream', code: 'timeout' }`(응답 도중이라 status 없음).
  - 목적지 응답을 해석할 수 없어서 난 오류(Node의 `HPE_*` 코드)는 `bad-response`(502). 연결 자체가 안 되면 지금처럼 `unreachable`.
- 한 줄 보고: 목표 = 다음 단계(TLS, STO, UI)가 기댈 Flow 모양을 확정 / 범위 =
  - `src/flow/flow.ts`: 타입 `Flow`에 `request.target`, error code `bad-response`, 새 타입 `FlowStart`, 새 함수 `parseTarget(url)`
  - `src/proxy/server.ts`: `startProxy()` 옵션 `onFlowStart`, `upstreamBodyTimeoutMs`(함수가 아니면 시작 거부는 onFlowStart에도), `'request'` 처리기 시작 시 `emitFlow`로 시작 알림, 기록에 target, `upstream.on('response')`에서 타임아웃 교체, `upstream.on('error')`의 코드 분류
  - 새 `test/prx/PRX-3.test.ts`(새 동작), 새 `test/prx/PRX-3-regression.test.ts`(O30 긍정 전제: 자식 프록시의 출력 수집이 실제로 작동함 — 구현 전에도 통과)
  - `docs/ai/purpose-tree.md`(PRX-3 🔨, PRX-4 추가), `docs/ai/map.md`(Flow 모양), `docs/for-me/PRX-3.md`, `docs/ai/progress.md`
  - 하지 않을 것 = `npm start`(PRX-4), 저장소(STO), CONNECT 기록(TLS-1)
- 예상 [추측] (판정 기준 포함, O38):
  - E42: 새 동작 테스트는 구현 전에 모두 assertion으로 실패한다(onFlowStart 무시 → 시작 알림 0건, target 없음, 본문 도중 300ms 쉬면 끊김, 깨진 응답은 unreachable). 판정: 실패 수 = 테스트 수, 오류 0개.
  - E43: Node 클라이언트가 깨진 목적지 응답(`NOT HTTP`)에 내는 오류 코드는 `HPE_`로 시작한다. 헤더 크기 초과는 `HPE_HEADER_OVERFLOW`. 판정: 두 경우 모두 `HPE_` 접두어면 일치. 실측 명령: `node scripts/probe/prx3-errcode.mjs`.
  - E44: 회귀(O30 긍정 전제)는 구현 전에도 통과한다: 구독자가 throw하면 자식 프록시 출력에 고정 문구 `[sumun] 기록 구독자에서 오류`가 나온다(PRX-2 구현). 판정: 통과면 일치.
  - E45: 구현 뒤 `node scripts/probe/prx2b-g9.mjs 10000` → error code가 `unreachable`에서 `bad-response`로 바뀐다. 판정: 문자열 비교.

- 실측 (명령 원문):
  - E43 일치(구현 전, 실측 커밋 22e556e): `node scripts/probe/prx3-errcode.mjs` → HPE_INVALID_CONSTANT, HPE_HEADER_OVERFLOW, HPE_INVALID_TRANSFER_ENCODING / ECONNRESET, ECONNREFUSED.
  - E42 일치: `npm run test:red -- test/prx/PRX-3.test.ts` → 처음 11개 중 1개("onFlowStart 예외에도 중계 그대로")가 구현 전에 통과 → 회귀 파일로 옮긴 뒤 10개 모두 실패, assertion 10개, 오류 0개.
  - E44 일치: `node --test test/prx/PRX-3-regression.test.ts` → 구현 전 2/2.
  - flow.ts만 있는 시점(server.ts를 `git show HEAD:src/proxy/server.ts`로 잠시 되돌림): `npm test` → 285개 중 275개 통과. server.ts까지 → 285/285(d620b76).
  - E45 일치: `node scripts/probe/prx2b-g9.mjs 10000` → error code bad-response.
  - 실제 curl(O31): `node scripts/probe/prx3-curl.mjs` → 시작 알림 239ms, 끝 기록 1195ms, curl 끝 1208ms. 처음 실행에서 스크립트가 출력 시각을 await 전에 계산하는 결함을 찾아 고쳤다.
- 계획과 달라진 점: id를 요청이 끝날 때가 아니라 받을 때 매기게 바꿨다(시작·끝 id를 같게 하려면 필요). 계획의 범위 문장에는 없었다.
- [PRX-3] 완료: 16f45e4..(문서 커밋). 다음: [PRX-4] 실행 진입점.

### [PRX-4] 계획
- 근거: PRX 보고서 결정 6(승인) — 실행 진입점을 지금 만든다. A10(포트 값 검사)을 여기서 한다(보고서 결정 14).
- 미확인 항목(O13): 변화 없음.
- 보안 사례(O10): 요약 줄이 기록 내용을 터미널로 내보내는 새 출력 경로라서 검토 에이전트에게 먼저 받았다 → `docs/ai/prx4-cases.md`(K 14, L 10, M 10, N 7, 결정 D1~D11 + D12′). 결정은 추천안으로 진행하고 다음 보고서에 올린다.
- 한 줄 보고: 목표 = 사용자가 `npm start`로 띄우고 브라우저를 127.0.0.1:8080에 설정해 쓸 수 있게 / 범위 =
  - 새 `src/cli.ts`: 함수 `parseArgs(argv)`(→ `{ port }` 또는 `{ error }`, D3·D4·D5), `safeText(s, max)`(제어 문자·C1·U+2028·bidi 이스케이프, 길이 제한 — D1, D6), `formatSummary(flow)`(target의 호스트:포트, 메서드, 상태 또는 실패 코드, 소요 시간만. 예외를 던지지 않음 — K, M8)
  - 새 `src/index.ts`: `main()` — 인자 검사 → `startProxy({ port, onFlow })` → 시작 줄 → 요약 줄, 시작 실패는 오류 코드별 고정 문구 + 종료 코드 1(M1), SIGINT에 `close()` + 2초 뒤 강제 종료(D7)
  - `package.json`: `scripts.start` = `node src/index.ts`
  - 새 `test/prx/PRX-4.test.ts`(cli.ts 단위 + index.ts 자식 프로세스), 회귀가 생기면 `test/prx/PRX-4-regression.test.ts`
  - `docs/ai/purpose-tree.md`, `docs/ai/prx4-cases.md`, `docs/for-me/PRX-4.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 대시보드, 기록 보관(STO), Ctrl+C의 자동 테스트(Windows에서 `child.kill('SIGINT')`는 처리기를 거치지 않는다 — 수동 확인 항목으로 남김)
- 예상 [추측] (판정 기준 포함):
  - E46: stub(cli.ts의 함수는 undefined를 돌려줌, index.ts는 빈 파일)에서 새 동작 테스트는 모두 assertion으로 실패한다. 자식 프로세스 테스트는 "시작 줄을 기다리다 프로세스가 끝남"으로 실패한다. 판정: 실패 수 = 테스트 수, 오류 0개.
  - E47: `node src/index.ts`는 Node의 경고(ExperimentalWarning 등) 없이 시작한다(N7). 판정: stderr가 빈 문자열이면 일치.
  - E48: WHATWG URL은 IDN 호스트를 punycode로, `%0d%0a`가 든 호스트는 해석 실패로 돌린다 → 요약 줄에 오는 호스트에는 제어 문자가 남지 않는다. 판정: `node -e`로 `new URL('http://аpple.com/').hostname`이 `xn--`로 시작하고, `new URL('http://a%0d%0ab/')`가 예외면 일치.
  - E49: 실제 curl(O31): `npm start -- --port <P>` 뒤 `curl -x`로 요청하면 요약 줄 1개가 나오고, 줄에 경로·쿼리·쿠키가 없다. 판정: 표식 문자열이 stdout에 0번.

- 실측 (명령 원문):
  - E48 일치(구현 전, 실측 커밋 62dd13b): `node scripts/probe/prx4-url-host.mjs` → IDN xn--, %0d%0a·%1b·U+202E·U+2028은 ERR_INVALID_URL, userinfo는 hostname에 없음.
  - E46 일치: stub에서 `npm run test:red -- test/prx/PRX-4.test.ts` → 45개 모두 실패. 처음에는 assertion 40개 + TypeError 5개(테스트가 stub의 undefined에서 .includes를 읽음) → 커밋 전에 "문자열인가" assertion을 앞에 넣어 assertion 45개, 오류 0개.
  - cli.ts만 있는 시점(index.ts는 stub): `node --test test/prx/PRX-4.test.ts` → 39/45. index.ts까지 → `npm test` 330/330(fde748f).
  - E47 일치: M2 테스트가 `node src/index.ts --port P`의 stderr가 빈 문자열임을 확인(통과).
  - E49 일치: `node scripts/probe/prx4-npm-start.mjs` → 요약 줄 2개, 표식 0번, stderr 빈 문자열. 처음 실행에서 스크립트 자신의 spawn이 DEP0190 경고를 내서 고쳤다(프록시와 무관).
- 계획과 달라진 점: 회귀 파일은 생기지 않았다(구현 전에 통과한 사례 없음).
- 미확인 추가(세션 밖 조건): 실제 터미널의 Ctrl+C 종료(사용자가 직접 npm start 후 Ctrl+C), Windows 예약 포트 EACCES 메시지(환경 의존).
- [PRX-4] 완료: 1833765..(문서 커밋). PRX 보고서 승인 범위의 후속(INFRA-8, PRX-3, PRX-4)이 모두 끝나 PRX를 ✅로 바꾼다(O37: 보고서 승인 뒤). PRX-4의 결정 D1~D12′은 다음 큰 단위(TLS) 보고서에 올린다.

### [INFRA-9] 계획
- 사용자 결정(2026-11-07, "추천대로"): 큰 단위 테스트는 처음에 코드로 쓰고 todo로 둔다, hook(연속 실패 카운터)은 큰 단위 테스트 파일의 todo 실패만 세지 않는다(질문 1-A). 루트 CA는 현재 사용자 저장소, 유효 기간 1년(질문 2 — TLS-2에서 적용).
- 발견: node:test의 실패하는 todo는 종료 코드 0이지만 junit에는 `<failure>`가 남아 parseJunit이 실패로 센다 [확인됨: 임시 폴더에서 `node --test --test-reporter=junit t.test.mjs`, exit=0].
- 보안·차단 규칙 변경이라 O10 적용: `docs/ai/infra9-cases.md`(검토 에이전트 28개). 결정 a~j는 추천안으로 진행, TLS 보고서에 올린다.
- 미확인 항목(O13): 변화 없음.
- 한 줄 보고: 목표 = 큰 단위 테스트가 todo로 실패하는 동안 멈춤 장치가 걸리지 않게, 그러나 우회로는 생기지 않게 / 범위 =
  - `scripts/streak.mjs`: `parseJunit()`(todo 테스트에 `todo: <이유>` 칸 — todo일 때만 넣어 기존 결과 모양 유지), 새 함수 `bigUnitExempt(result, { bigUnits, exists, readFile })`, `updateStreak(prev, results, exempt?)`(예외 실패는 셈을 그대로 둠), 새 함수 `bigUnitsFromTree(text)`, 새 함수 `bigTodoSummary(results, exempt)`
  - `scripts/test.mjs`: 예외 판정 연결, "큰 단위 대기 n개(실패 m)" 출력과 last-run.json의 `bigTodo` 칸, todo 통과 경고
  - `scripts/check-method.mjs`: `checkBigUnit()`에 규칙 `big-unit-todo`(last-run.json: 전체 실행, 실패 0, 그 큰 단위 대기 0)와 CLI 연결
  - 새 `test/infra/streak-bigunit.test.mjs`(새 동작), 필요하면 `test/infra/streak-bigunit-regression.test.mjs`
  - `CLAUDE.md` 큰 단위 절(파일 이름, todo 형식, export 금지, 동적 import, red에 섞지 않기), `docs/ai/infra9-cases.md`, `docs/for-me/INFRA-9.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 사례 12(테스트 코드가 state 폴더에 직접 쓰기), 13(skip으로 셈 초기화), 17(같은 이름), 부모 테스트 실패 누락 — 범위 밖 기록
- 예상 [추측] (판정 기준 포함):
  - E50: 새 테스트는 구현 전에 모두 assertion으로 실패한다. 새 함수(bigUnitExempt 등)는 없으므로 테스트가 `typeof === 'function'`을 먼저 assertion으로 본다. 판정: 실패 수 = 테스트 수, 오류 0.
  - E51: 기존 `test/infra/streak.test.mjs`는 구현 뒤에도 통과한다(parseJunit 결과에 todo 칸을 todo일 때만 넣으므로). 판정: 그 파일 전부 통과.
  - E52: 구현 뒤 `npm test` 전체가 통과하고, 출력의 "큰 단위 대기"는 0개다(아직 `-T` 파일이 없음). 판정: 실패 0, 대기 0.
  - E53: `node scripts/check-method.mjs --id PRX` → big-unit-todo ✅(PRX는 `-T` todo가 없고 마지막 전체 실행 실패 0). 판정: ✅.

- 실측 (명령 원문):
  - E50 일치: `npm run test:red -- test/infra/streak-bigunit.test.mjs` → 처음 36개 중 1개(사례 10)가 구현 전에 통과 → 회귀 파일로 옮긴 뒤 35개 모두 실패, assertion 35개, 오류 0개.
  - E51 일치: streak.mjs만 바꾼 시점에 `node --test test/infra/streak-bigunit.test.mjs test/infra/streak-bigunit-regression.test.mjs test/infra/streak.test.mjs` → 36/39(실패 3개는 check-method 규칙), 기존 streak.test.mjs 전부 통과.
  - E52 일치: `npm test` → 366/366, 큰 단위 대기 출력 없음, last-run.json `full: true, failed: 0, bigTodo: {}`(8ff7a55).
  - E53 일치: `node scripts/check-method.mjs --id PRX` → big-unit-todo ✅.
  - 통합 실측: `node scripts/probe/infra9-bigtodo.mjs` → 대기 3회 셈 0·멈춤 없음 / 일반 실패 3회째 멈춤 / 대기 파일 생성 뒤 셈 1 [확인됨].
- 계획과 달라진 점: 계획에 없던 last-run.json 칸 `exemptFailed`를 추가했다(예외로 뺀 실패 수를 따로 남김). 실측 스크립트 1개 추가.
- [INFRA-9] 완료: 536afb0..(문서 커밋). 다음: TLS-T(큰 단위 테스트).

### [TLS-T] 계획
- 근거: CLAUDE.md 큰 단위 절(O33) — TLS를 시작할 때 큰 단위 테스트를 먼저 쓴다. 형식은 INFRA-9 규칙(`<ID>-T.test.ts`, todo 이유 `대기: src/tls/mitm.ts`, 동적 import, export 없음).
- 미확인 항목(O13): 변화 없음.
- 대기 파일 P = `src/tls/mitm.ts`: 마지막 작은 단위 TLS-4(TLS 종료 후 복호화한 요청을 Flow로 기록)가 만든다.
- 사용자 결정(2026-11-07): 루트 CA는 현재 사용자 저장소에만, 유효 기간 1년(TLS-2). **테스트는 임시 폴더에 매번 새 CA를 만들고 Windows 저장소를 건드리지 않는다.**
- 설계 [추측] — 큰 단위 테스트가 고정하는 모양. 바꿀 땐 TLS 보고서 결정 항목으로 올린다:
  - `src/ca/ca.ts`: `loadOrCreateCA(dir)` → `{ certPem, keyPem }`(없으면 만든다), `issueCert(ca, hosts)` → `{ certPem, keyPem }`(호스트용 인증서)
  - `startProxy({ ca, upstreamCA })`: `ca`가 있으면 CONNECT를 받아 TLS를 종료(복호화)한다. `upstreamCA`(PEM 배열)는 목적지 인증서 검증에 **추가로** 믿을 CA다. 검증은 끄지 않는다.
  - 복호화한 요청의 기록: `request.url`은 터널 안에서 받은 원문(`/hello?q=1`), `request.target = { scheme: 'https', host, port, path }`.
  - 목적지 인증서를 믿을 수 없으면 터널 안 응답 502, 기록 `error: { by: 'upstream', code: 'bad-certificate', status: 502 }`.
  - 클라이언트는 Node TLS 클라이언트(CONNECT 뒤 같은 소켓에서 TLS, 프록시 CA만 믿음). curl은 이 PC에서 Schannel(Windows 저장소)을 써서 테스트 CA를 믿게 하는 방법이 불확실하다 [확인됨: `curl.exe -V` → Schannel] → curl 실측은 TLS-4에서.
- 한 줄 보고: 목표 = HTTPS 사용자 흐름을 처음부터 끝까지 확인하는 큰 단위 테스트를 먼저 둔다 / 범위 =
  - 새 `test/tls/TLS-T.test.ts`: (1) CONNECT → TLS(프록시 CA로 검증, servername localhost) → `GET /hello?q=1` + Cookie → 200, 목적지가 받은 요청, 기록의 target·본문 (2) 믿을 수 없는 목적지 인증서 → 502 + bad-certificate. 도우미 함수는 파일 안에 두고 export하지 않는다
  - `docs/ai/purpose-tree.md`(TLS 🔨, TLS-T 추가), `docs/for-me/TLS-T.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 구현(TLS-1~4), Windows 인증서 저장소, node-forge 설치(TLS-2)
- 예상 [추측] (판정 기준 포함):
  - E54: `npm run test:red -- test/tls/TLS-T.test.ts` → 2개 모두 실패. 유형은 **오류**(동적 import한 `src/ca/ca.ts`가 없음)다. 큰 단위 테스트라 아직 없는 모듈을 부르는 것이 정상이다. 판정: 실패 2, 각각 ERR_MODULE_NOT_FOUND면 일치.
  - E55: 테스트 커밋 뒤 `npm test`는 종료 코드 0, 출력에 "큰 단위 대기(todo) TLS: 2개, 그중 실패 2개", 연속 실패 셈에 TLS-T 키가 없다. 판정: 세 가지 모두면 일치.

- 실측 (명령 원문):
  - E54 일치: `npm run test:red -- test/tls/TLS-T.test.ts` → 2개 모두 실패(todo 2), 오류 2개 ERR_MODULE_NOT_FOUND(src/ca/ca.ts).
  - E55 일치: `npm test` → 종료 코드 0, tests 368 / pass 366 / fail 0 / todo 2, "큰 단위 대기(todo) TLS: 2개, 그중 실패 2개", `.claude/state/test-streak.json`에 TLS-T 키 0개, last-run.json `full: true, failed: 0, exemptFailed: 2`.
  - 문서를 쓸 때 줄 번호 두 개를 짐작으로 적었다가 `grep -n`으로 확인해 고쳤다(O34 지침이 실제로 잡음).
- [TLS-T] 완료: 59f12b6..(문서 커밋). 다음: TLS-1(CONNECT 터널, 복호화 없이 통과) — 보안 사례 먼저(O10).

## 범위 밖 문제
- ✅ (INFRA-3에서 해결) ~~[INFRA-1 결함] guard.mjs 오탐:~~ 셸 명령에 `>`와 `test/` 경로가 함께 있으면 "테스트 수정"으로 차단한다. 커밋 메시지의 `<noreply@anthropic.com>`, heredoc 본문, `-m "..."` 같은 **데이터 안의 `>`**도 리다이렉트로 본다. 발견: INFRA-2 테스트 커밋 시도(2026-11-07). 우회: 메시지를 파일로 쓰고 `git commit -F`. 수정 제안: heredoc 본문과 `-m` 인자를 빼고 판단 + 회귀 테스트 추가 → 사용자 보고 후 별도 작은 단위로.

- ✅ (INFRA-5에서 해결) ~~[INFRA-3 보안 회귀]~~ stripData()가 **실행되는** heredoc/here-string 본문(`bash <<EOF`, `sh -s <<EOF`, `@'...'@ | Invoke-Expression`)까지 지워서, 본문 안의 테스트 파일 쓰기를 허용한다. 발견: INFRA-3 감사(2026-11-07). 확인: `node .git/verify-heredoc.cjs` → 3개 모두 allow [확인됨]. 상태 폴더 heredoc은 deny. 제안: INFRA-5(셸·인터프리터에 넘기는 경우는 본문을 지우지 않는다) → 사용자 보고.

- ⚠ [규칙 B 한계, 의도적으로 남김] 상태 폴더(.claude/state/) 쓰기는 실행 전 패턴 검사만 한다. 경로 표기 변형(`.claude/"state"`, `.claude/./state`), python `open(...,'w')`, PowerShell 별칭 `sc`로 우회할 수 있다(guard-bypass-cases.md 31, 36, 38) [추측: 코드 기준]. 사용자 결정(INFRA-5 설계 4번)으로 남겨 둔 한계다. 최종 방어선은 PR 감사와 check-method다.

- ⚠ [PRX-2b 발견, 범위 밖] 목적지 응답을 해석할 수 없을 때(헤더 크기 초과, 깨진 응답 — PRX-1c B11) 기록의 실패 코드가 `unreachable`(연결 불가)로 남는다. 원인을 정확히 보여 주지 못한다. 확인: `node scripts/probe/prx2b-g9.mjs 10000` → error {by: upstream, code: unreachable, status: 502} [확인됨]. 제안: UI에서 실패 이유를 보여 줄 때 코드(예: `bad-response`)를 나눈다.

- ⚠ [INFRA-9 검토에서 발견, 범위 밖 — 사용자 보고] 테스트 코드가 `.claude/state/`(junit.xml, test-streak.json)에 직접 쓸 수 있다. hook은 도구 명령만 검사하고 `npm test`가 실행하는 코드는 보지 않는다. 멈춤 장치 전체를 무력화할 수 있다(infra9-cases.md 사례 12) [추측: 시험하지 않음]. 제안: 실행 전후 state 해시 비교 또는 state를 실행기만 쓰는 위치로 — 별도 작은 단위.
- [INFRA-9 검토에서 발견, 범위 밖] `{ skip }`·`--test-skip-pattern`은 셈을 초기화한다(사례 13). 같은 이름 테스트가 셈을 섞는다(사례 17). 부모 테스트 실패가 junit에서 빠진다(검토자 실측).

## 시도하다 막힌 것
(없음)
