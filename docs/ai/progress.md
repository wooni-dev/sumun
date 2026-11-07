# 진행 기록

단서로만 쓴다. 세션을 시작할 때 git 이력과 테스트 결과로 대조한다.

## 현재
- 작업: [PRX-1b] 끝 → 사용자 보고
- 다음 할 일: [PRX-1c]
- 미확인: on-prompt.mjs 실제 작동, ai-research Read 규칙(새 세션), method-auditor 이름 호출(새 세션)

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

## 범위 밖 문제
- ✅ (INFRA-3에서 해결) ~~[INFRA-1 결함] guard.mjs 오탐:~~ 셸 명령에 `>`와 `test/` 경로가 함께 있으면 "테스트 수정"으로 차단한다. 커밋 메시지의 `<noreply@anthropic.com>`, heredoc 본문, `-m "..."` 같은 **데이터 안의 `>`**도 리다이렉트로 본다. 발견: INFRA-2 테스트 커밋 시도(2026-11-07). 우회: 메시지를 파일로 쓰고 `git commit -F`. 수정 제안: heredoc 본문과 `-m` 인자를 빼고 판단 + 회귀 테스트 추가 → 사용자 보고 후 별도 작은 단위로.

- ✅ (INFRA-5에서 해결) ~~[INFRA-3 보안 회귀]~~ stripData()가 **실행되는** heredoc/here-string 본문(`bash <<EOF`, `sh -s <<EOF`, `@'...'@ | Invoke-Expression`)까지 지워서, 본문 안의 테스트 파일 쓰기를 허용한다. 발견: INFRA-3 감사(2026-11-07). 확인: `node .git/verify-heredoc.cjs` → 3개 모두 allow [확인됨]. 상태 폴더 heredoc은 deny. 제안: INFRA-5(셸·인터프리터에 넘기는 경우는 본문을 지우지 않는다) → 사용자 보고.

- ⚠ [규칙 B 한계, 의도적으로 남김] 상태 폴더(.claude/state/) 쓰기는 실행 전 패턴 검사만 한다. 경로 표기 변형(`.claude/"state"`, `.claude/./state`), python `open(...,'w')`, PowerShell 별칭 `sc`로 우회할 수 있다(guard-bypass-cases.md 31, 36, 38) [추측: 코드 기준]. 사용자 결정(INFRA-5 설계 4번)으로 남겨 둔 한계다. 최종 방어선은 PR 감사와 check-method다.

## 시도하다 막힌 것
(없음)
