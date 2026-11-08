# 진행 기록

단서로만 쓴다. 세션을 시작할 때 git 이력과 테스트 결과로 대조한다.

## 현재
- 작업(2026-11-08 새 세션): **[INFRA-13]** 완료(규칙 D — 브랜치·제목 ID 일치, `docs/ai/infra13-cases.md`). **[UI-T]** 진행 중(브랜치 feat/UI-T, 사례 `docs/ai/ui-cases.md`, 결정 D-1~D-16 모두 추천대로). 그다음 UI-1 → UI-5. 아래는 지난 세션 종료 기록.
- 지난 세션 종료(2026-11-08). 사용자: "다음 세션에서 할게". main = 이 기록 커밋. `npm test` 684/684, 실패 0, 대기 0(2eba73a 기준 — 그 뒤는 문서만).
  - 이번 세션에 끝낸 것: [STO-5](바이트 상한은 완료부터, 모르는 필터 조건 오류) → **STO ✅** → [INFRA-11](O47 커밋 메시지 hook: guard.mjs 규칙 C + commit-check.mjs, 표시 파일 `.claude/commit-rule.json`) → [INFRA-12](O48~O54 지침, check-method merge-record·merge-records).
  - 목적 나무: PRX ✅, TLS ✅, STO ✅, **UI ⬜(남은 큰 기능)**, SEC은 SEC-3 ✅(SEC-1·2는 각 단계에서 함께 검증).
  - 지금 루트 CA는 **등록 안 됨**(사용자가 해제, 2026-11-08 13:08). 다시 쓰려면 사용자가 `npm.cmd run ca -- install`(PowerShell은 `npm`이 실행 정책에 막힘 → `npm.cmd`).
  - **다음 세션 첫 일(순서):**
    0. INFRA-12 E162 뒤 절반을 INFRA-13 계획 커밋의 진행 기록에 적는다: 5b2791f 뒤 `node scripts/check-method.mjs --id INFRA-12` → merge-record ✅ "`[INFRA-12] 병합 뒤 기록` 커밋 있음", 11개 ✅·tree-updated ➖ [확인됨: 이 세션에서 실행] → 일치.
    1. **[INFRA-13]** O54 기계 검사: `feat/<ID>` 브랜치에서 커밋 제목의 `[ID]`가 브랜치 ID와 같은지 guard.mjs가 본다(INFRA-11에서 `feat/INFRA-11`에 `[PRX-2b]` 메시지로 커밋된 사고). hook(차단 규칙)이므로 **검토 에이전트의 우회·오탐 사례를 먼저**(O10). 생각할 것: main의 `[AUDIT-n]`·`[SESSION]`·`[RULE]`·`[ID] 병합 뒤 기록`, feat 밖 브랜치, 병합 커밋.
    2. **UI 큰 단위**: 시작할 때 UI-T 큰 단위 테스트(STO-T 행동을 다시 하고 대시보드 단계를 붙임 — O42), 그 전에 **대시보드 보호**(Host·Origin 검사, CSRF, CORS, 접속 토큰, DNS 리바인딩, 프록시를 거쳐 대시보드로 오는 요청)를 별도 검토 에이전트의 우회 사례로 먼저 받는다(O10). 구독자는 큐에 넣고 바로 반환(STO 결정 1), "복호화 꺼짐" 안내(결정 4), 목록 API 모양·필터 확장·진행 중 상세는 UI에서 정한다(결정 3·6·8). HTTPS 브라우저 실측은 UI 큰 단위 끝에서(결정 15, 사용자가 CA 등록) — O52대로 -T 경로마다 실제 클라이언트.
  - 주의(이번 세션에서 생긴 규칙):
    - 커밋은 `git commit -q -F "<절대 경로>"` 모양만(규칙 C hook이 막음). 메시지 파일 이름에 노드 ID, **Write 결과를 본 뒤에** 커밋(같은 응답에 함께 보내지 않음, O54). 작업 임시 폴더는 세션끼리 공유된다.
    - 병합 직후 check-method 결과는 **`[ID] 병합 뒤 기록: …`** 커밋으로(O50). 큰 단위 기록은 지금까지처럼 `[AUDIT-n]`.
    - 같은 새 테스트를 "다음 커밋 필요" 상태로 돌리는 것은 두 번까지(O53). 멈춤은 사용자의 **채팅 메시지**로만 풀린다(선택 창 답으로는 안 풀림).
    - CLAUDE.md를 고친 뒤에는 `git diff`로 바뀐 기존 줄을 확인한다(INFRA-11·12에서 줄바꿈 삭제·문장 중간 끼움 두 번).
    - 저장소를 바꾸는 명령(`npm run ca -- install·uninstall`)은 Claude가 실행하지 않는다 — TTY 검사가 막고, 사용자가 직접 실행한다(SEC-3 결정 6). Claude는 `status`(읽기)만.
- 범위 밖으로 남은 것(보고서 '자세히 볼 부분'): 테스트 코드가 .claude/state/에 쓸 수 있는 빈틈(INFRA-9 사례 12), PRX-2 F6이 %LOCALAPPDATA%\sumun을 보지 않음, OS 연결 대기열 232개, curl --ssl-no-revoke.
- 다음 할 일(순서):
  1. ~~[TLS-1b] 터널 견고성~~ 완료(2064e4d..)
  2. ~~[TLS-2]~~ 완료(395dd35..). 남은 것은 [TLS-2b](쓰기 견고성·ACL, 배정 "2b") — 원래 메모: 시작 전에 사용자에게 다시 설명·확인: node-forge 설치(package.json 의존성 추가), 개인키는 `%LOCALAPPDATA%\sumun\ca\`(저장소 밖, 커밋 금지 — 2026-11-08 `%APPDATA%`에서 바꿈), 사용자 결정(2026-11-07): 등록 범위 = 현재 사용자(CurrentUser\Root), 유효 기간 1년. **Windows 저장소 등록 명령은 실행 직전에 보여 주고 매번 확인**. 보안 사례(O10) 먼저. TLS-T가 고정한 모양: `src/ca/ca.ts`의 `loadOrCreateCA(dir)`, `issueCert(ca, hosts)` → `{ certPem, keyPem }`.
  3. [TLS-3] 호스트별 인증서 즉석 발급 → [TLS-4] TLS 종료 후 복호화한 요청 기록(`startProxy({ ca, upstreamCA })`, 목적지 인증서 검증 끄지 않음, 불신 시 `bad-certificate` 502, 대기 파일 `src/tls/mitm.ts`를 만든다). TLS-4에서 실제 curl 실측(이 PC의 curl은 Schannel).
  4. TLS 큰 단위 끝: CLAUDE.md "큰 단위" 절차(전체 테스트 → 감사 → 목표 문서만 보는 검토 에이전트 → `docs/for-me/TLS-report.md` → `check-method --id TLS`의 big-unit-todo 포함).
- TLS 보고서에 올릴 결정 항목(추천으로 진행한 것, 아직 사용자 승인 전): PRX-4 D1~D12′(요약 줄 범위·이스케이프·포트 형식), INFRA-9 a~j(대기 예외), TLS-T 설계(ca 모듈 모양, bad-certificate), TLS-1 결정 0~12(tunnel 옵션, 모든 포트·사설 주소 허용, 이름 한 번 해석 등), 목적 나무에 추가한 노드(PRX-3, PRX-4, TLS-T, TLS-1b).
- 사용자에게 제안해 둔 것(범위 밖, 결정 대기): 테스트 코드가 `.claude/state/`에 직접 써서 멈춤 장치를 무력화할 수 있는 빈틈(INFRA-9 사례 12) — 별도 작은 단위로.
- 새 세션 시작 순서(개발 방식 7~9행): ① docs/ai/purpose-tree.md → ② 이 파일(단서로만) → ③ `git log --oneline -15`로 대조 → ④ `npm test` → ⑤ 아래 미확인 항목부터 처리(O6)
- 미확인:
  - ai-research Read 규칙 — 세션 밖 조건 필요(자동 승인 모드가 아닌 새 세션에서 읽을 때 권한 창이 뜨는지)
  - ~~method-auditor 이름 호출~~ — 2026-11-08 해결 [확인됨]: 세션 도중 Agent 종류 목록에 `method-auditor`가 나타남(2026-11-07에는 없었음). 원인은 모른다 [추측: 세션이 프로젝트 에이전트를 나중에 다시 읽음]. 다음 큰 단위 감사부터 이름으로 부른다.
  - ~~on-prompt.mjs~~ — 2026-11-08 해결 [확인됨]: 사용자가 "테스트 수정 허용"을 입력하자 hook이 "사용자가 커밋된 테스트 수정을 30분간 허용했습니다"를 냈고, 그 뒤 테스트 파일 수정이 허용됐다(a3cf4eb). 30분 뒤에는 다시 막혔다(TLS-3 구현 중 리다이렉트+테스트 경로 명령이 막힘).
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

### [TLS-1] 계획
- 미확인 항목(O13): 변화 없음.
- 보안 사례(O10): `docs/ai/tls1-cases.md`(검토 에이전트 40개 + 결정 12개). 크기 때문에 TLS-1과 TLS-1b(견고성)로 나눴다(목적 나무에 TLS-1b 추가). 결정은 추천으로 진행, TLS 보고서에 올린다.
- 작업자 추가 결정 0: 터널은 `startProxy({ tunnel: true })`일 때만 켠다. 커밋된 `test/prx/PRX-1.test.ts`의 C18("CONNECT는 501")을 고치지 않기 위해서이고, 그 테스트가 인터넷(example.com)에 연결하게 되는 것도 막는다. `npm start`(src/index.ts)는 켠다.
- 한 줄 보고: 목표 = CONNECT를 복호화 없이 안전하게 통과시키고 터널마다 기록 / 범위 =
  - 새 `src/tls/tunnel.ts`: 함수 `parseConnectTarget(target)`(→ `{ host, port }` 또는 거절 — P1~P9), `isLoopTarget(addresses, port, selfPort)`(Q1, Q5), `openTunnel(...)`(목적지 연결 → 200 → head 전달 → 양방향 pipe, 바이트 세기, 실패 분류, 기록 1번)
  - `src/proxy/server.ts`: `startProxy()` 옵션 `tunnel`, `lookup`(테스트용 이름 해석 주입), `'connect'` 처리기(옵션이 없으면 지금처럼 501), Host 중복·본문 헤더 검사(R2, P10)
  - `src/flow/flow.ts`: 타입 `Flow`에 `tunnel?: { bytesUp, bytesDown, address }`
  - `src/cli.ts`: `formatSummary()`가 터널 기록을 `CONNECT host:port tunnel ↑N ↓M`처럼 보이게(ASCII로)
  - `src/index.ts`: `startProxy({ tunnel: true })`
  - 새 `test/tls/TLS-1.test.ts`(새 동작), 새 `test/tls/TLS-1-regression.test.ts`(구현 전에도 통과하는 것), 도우미는 파일 안에
  - `docs/ai/purpose-tree.md`, `docs/ai/tls1-cases.md`, `docs/ai/map.md`, `docs/for-me/TLS-1.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 배정 "1b", 복호화(TLS-4), CA(TLS-2)
- 예상 [추측] (판정 기준 포함):
  - E56: stub(tunnel.ts의 함수가 undefined를 돌려줌, server.ts는 그대로 → CONNECT 501)에서 새 동작 테스트는 모두 assertion으로 실패한다. 판정: 실패 수 = 테스트 수, 오류 0.
  - E57: 거절 사례 중 일부(P6의 NUL·공백, P9의 16KB 초과)는 Node 파서가 먼저 막아 구현 전에도 400/431이다 → 회귀 파일로 간다. 판정: red에서 구현 전 통과가 나오면 회귀로 옮기고 개수를 기록.
  - E58: Node의 `'connect'` 이벤트는 CONNECT와 같은 write로 온 데이터를 `head`로 넘긴다(R1). 판정: head 길이 > 0이면 일치. 실측 명령은 실측 커밋에.
  - E59: 실제 curl(O31): `curl -x http://127.0.0.1:P -k https://127.0.0.1:<로컬 HTTPS>/` 가 터널을 통해 200을 받는다(-k: 로컬 시험 서버 인증서를 curl이 모르므로). 판정: 200.

- 실측 (명령 원문):
  - E58 일치(실측 커밋 6d1ea87): `node scripts/probe/tls1-head.mjs` → head="EARLY-BYTES"(11), 그 뒤 소켓에서 받은 것 "".
  - E56 일치: stub에서 `npm run test:red -- test/tls/TLS-1.test.ts` → 57개 모두 실패, assertion 57, 오류 0. 처음 실행은 5분이 지나도 끝나지 않았다 → `node --test --test-timeout=15000`으로 원인을 찾음: R5c 테스트 앞부분에 finally가 없어 실패 시 목적지 서버가 남음(테스트 결함, 커밋 전 수정, 기대값 변경 없음).
  - E57 일치: `node --test test/tls/TLS-1-regression.test.ts` → 구현 전 5/5(Node 파서가 깨진 요청줄을 400·431로 막음).
  - tunnel.ts만 있는 시점(다른 네 파일을 `git show HEAD:<파일>`로 잠시 되돌림): TLS-1 테스트 41/57. 연결 뒤 `npm test` → 428 통과, 실패 0, 대기 TLS 2(f5b024e).
  - E59 일치: `node scripts/probe/tls1-curl.mjs` → curl "secure /hello?q=1 [200]", 자기 자신 [000](508), 요약 줄에 경로·쿼리 0번.
  - hook 기록(O25): 명령 안에 테스트 경로와 리다이렉트가 함께 있어 막힘 → 의도한 보수적 동작. 실행 명령을 스크립트 파일로 옮겨 진행.
- 계획과 달라진 점: 결정 0(tunnel 옵션)은 계획에 적은 대로. close()에서 열린 터널 소켓을 닫는 것(사례 R13 일부)을 함께 넣었다 — 테스트 프로세스가 끝나게 하려면 필요했다. R13의 "정해진 시간 안에 종료" 테스트는 TLS-1b에서.
- [TLS-1] 완료: 79a641d..(문서 커밋). 다음: TLS-1b(견고성) 또는 TLS-2(루트 CA — 사용자 확인 필요).

### [TLS-1b] 계획
- 새 세션(2026-11-07) 대조: `git log --oneline -15`가 기록과 같음, `npm test` → tests 430 / pass 428 / fail 0 / todo 2, "큰 단위 대기(todo) TLS: 2개, 그중 실패 2개" [확인됨].
- 미확인 항목(O13): method-auditor 이름 호출 — 세션 안에서 확인, 이번에도 Agent 종류 목록에 없음 [확인됨]. 나머지(Read 규칙, on-prompt.mjs, Ctrl+C, EACCES)는 세션 밖 조건 필요, 변화 없음.
- 보안 사례(O10): TLS-1 계획 때 받은 `docs/ai/tls1-cases.md`의 배정 "1b"(R6, R7, R8, R12, R13). 새로 받지 않는다(사례는 이미 있고 정책 결정이 없다).
- 한 줄 보고: 목표 = CONNECT 터널을 반쪽 닫기·대용량·연결 타임아웃·동시 300개·종료에서 견고하게 / 범위 =
  - `src/tls/tunnel.ts`: `openTunnel()` — 목적지 연결을 반쪽 닫기 허용(`allowHalfOpen`)으로(R6), 연결 함수를 인자로 받음(R8)
  - `src/proxy/server.ts`: `startProxy()` 옵션 `connectUpstream`(테스트용 TCP 연결 함수 주입, 기본 `net.connect`) → `openTunnel`에 전달
  - 새 `test/tls/TLS-1b.test.ts`(새 동작), 새 `test/tls/TLS-1b-regression.test.ts`(구현 전에도 통과하는 것), 도우미는 파일 안에
  - 새 `scripts/probe/tls1b-halfclose.mjs`(구현 전 반쪽 닫기·역압 실측), 새 `scripts/probe/tls1b-curl.mjs`(실제 curl로 큰 다운로드·메모리, O31)
  - `docs/ai/purpose-tree.md`, `docs/ai/tls1-cases.md`, `docs/ai/map.md`, `docs/for-me/TLS-1b.md`, `docs/ai/progress.md`
  - 하지 않을 것 = TLS-2(루트 CA), 결정 0~12 변경, 동시 터널 상한(결정 8), 복호화
- 예상 [추측] (판정 기준 포함):
  - E60 R6a(클라이언트가 먼저 쓰기를 닫음): 클라이언트가 보내고 `end()` → 목적지가 FIN을 받은 뒤 답을 보내고 닫음 → 클라이언트가 답을 다 받는다. **구현 전에도 통과**(http 서버 소켓은 반쪽 닫기를 허용하고 pipe가 FIN을 넘긴다). 판정: 답 바이트가 전부 오고 기록 error 없음이면 일치.
  - E61 R6b(목적지가 먼저 쓰기를 닫음): 목적지가 인사를 보내고 `end()` → 그 뒤 클라이언트가 보낸 데이터를 목적지가 받는다. **구현 전에는 실패**(`net.connect` 기본값은 반쪽 닫기를 허용하지 않아 FIN을 받으면 프록시가 목적지 쪽 쓰기도 닫는다). 판정: 목적지가 받은 바이트 0 또는 기록 error가 있으면 일치.
  - E62 R7 양방향 50MB 동시: 양쪽 sha256이 같다. 구현 전 통과. 판정: 해시 같음.
  - E63 R7 느린 클라이언트: 클라이언트가 읽기를 멈춘 2초 동안 "목적지가 써 넣은 양 − 클라이언트가 받은 양" ≤ 16MB(OS 버퍼 포함). 구현 전 통과(pipe 역압). 판정: 16MB 이하면 일치. 실측 값을 보고 테스트 상한을 정한다.
  - E64 R12 동시 300개: 터널마다 다른 바이트를 보내고 자기 것만 돌려받음, 기록 300개의 바이트 수가 각각 맞음. 구현 전 통과. 판정: 300개 모두 맞고 10초 안.
  - E65 R13: 열린 터널 20개가 있는 채로 `close()` → 1000ms 안에 끝나고 클라이언트 20개가 모두 닫힘. 구현 전 통과(TLS-1에서 close()가 터널 소켓을 닫게 함). 판정: 1초 안.
  - E66 R8: `connectUpstream`으로 연결이 끝나지 않는 소켓을 주면 `upstreamTimeoutMs`(300ms) 뒤 504, 기록 `{ by: 'upstream', code: 'timeout', status: 504 }`, 주입한 소켓이 destroy됨. stub(옵션 무시 → 실제 연결)에서는 assertion 실패. 판정: red에서 assertion 실패, 오류 0.
  - E67 실제 curl(O31): npm start 구성의 터널로 로컬 HTTPS에서 100MB를 받으면 받은 바이트 = 100MB, 프록시 프로세스 최대 RSS − 시작 RSS ≤ 64MB. 판정: 두 가지 모두면 일치.
  - E68 실제 curl R8: 응답하지 않는 주소(10.255.255.1:443)로 터널 → 연결 타임아웃 뒤 504. 환경 의존(네트워크가 바로 거절하면 502). 판정: 504면 일치, 502면 환경 기록하고 테스트(주입)로 대신한다.

- 실측 (명령 원문, 결과 전문은 각 커밋 메시지):
  - E60 일치, E61 일치, E63 일치(8bcf71e): `node scripts/probe/tls1b-halfclose.mjs` → R6a 답 "got:hello" / R6b 목적지가 받은 것 "" / 멈춘 동안 쌓인 양 1.3MB(→ 테스트 상한 8MB).
  - 예상 밖(범위 안 결함, 테스트 전에 발견): R6b에서 기록이 끝내 나오지 않음. `node scripts/probe/tls1b-leak.mjs` → 목적지 쪽이 스스로 닫히며 pipe가 풀려 클라이언트 쪽 소켓이 남는다. 테스트 R6b에 "기록 1개"를 넣고 구현에서 함께 고침(테스트 전 발견이라 O26의 기록·재현·수정 3커밋 대신 실측 → 테스트 → 구현 순서로).
  - 예상 밖(환경): R12 초안이 터널 232부터 실패. `node scripts/probe/tls1b-concurrency.mjs 300 direct` → 프록시 없이도 232개만 연결, `node scripts/probe/tls1b-backlog.mjs` → backlog를 1024로 올려도 232(51464e9). 테스트는 50개씩 열고 300개를 모두 연 채로 검사(기대값 그대로, O36 기록은 d41a3a7).
  - E64 일치(R12 300개, 563ms), E65 일치(R13 close() 62ms), E62 일치(50MB 양방향 sha256 같음): `node --test --test-timeout=30000 test/tls/TLS-1b-regression.test.ts` → 구현 전 5/5.
  - E66 일치: `npm run test:red -- test/tls/TLS-1b.test.ts` → 3개 모두 assertion 실패, 오류 0.
  - tunnel.ts만 있는 시점(server.ts를 `git show HEAD:src/proxy/server.ts`로 잠시 되돌림): TLS-1·TLS-1b 60개 중 45 통과. 연결 뒤 `npm test` → 438 / 436 통과 / 실패 0 / 대기 TLS 2(9a2b46e).
  - E67 일치, E68 일치(565eee3): `node scripts/probe/tls1b-curl.mjs` → 다운로드·업로드 104857600바이트, 메모리 69 → 126MB(+57 ≤ 64), 10.255.255.1 → 2.0초 뒤 CONNECT 504·기록 timeout. `... 300` → 최대 151MB(본문 3배에 +22MB, 비례하지 않음).
- hook 기록(O25):
  - 커밋 전 테스트 파일을 셸 in-place 치환으로 고치려다 막힘 → 의도한 보수적 동작. Edit 도구로 고침.
  - 테스트 커밋 명령(`cat > 메시지파일 <<EOF` + `git add test/...`)이 막힘 → 의도한 보수적 동작(한 명령 안에 리다이렉트와 테스트 경로 — TLS-1 때와 같은 규칙). 테스트 커밋 메시지에는 "본문 글자 때문"이라고 [추측]을 적었는데, 원인은 이것이 더 그럴듯하다 [추측]. 메시지를 Write 도구로 쓰고 커밋 명령을 따로 실행.
  - 중간 상태 측정 명령(`git show ... > server.ts` + 테스트 실행)도 같은 이유로 막힘 → 의도한 보수적 동작. 명령을 나눔.
- 계획과 달라진 점: 실측 커밋이 둘(8bcf71e, 51464e9)이 됐다. R12 테스트 절차를 환경 한계에 맞췄다. R6c(목적지가 FIN 뒤 완전히 끊으면 클라이언트도 닫기)를 검토했지만 뺐다 — 프록시는 쓰기 전에는 상대가 FIN만 보냈는지 완전히 끊었는지 알 수 없고, 반쪽 닫힌 상태를 그대로 비추는 것이 결정 6이다.
- [TLS-1b] 완료: 2064e4d..7ce8f06 + 이 기록 커밋. 다음: TLS-2(루트 CA — 시작 전 사용자 확인).
- `node scripts/check-method.mjs --id TLS-1b` → 11개 규칙 중 10 ✅, **message-format ❌**(8bcf71e, 51464e9, 8518b93, 565eee3) [확인됨]. 원인: "검증" 뒤에 괄호로 조건을 붙여 `- 검증(구현 전, …):`으로 썼고, 검사는 줄 머리 `- 검증:`을 요구한다(scripts/check-method.mjs의 badMsg). 왜·검증 내용은 들어 있다. 고치려면 브랜치 이력을 다시 써야 해서 문서·메시지에 적은 해시가 모두 틀어진다 → 고치지 않고 남긴다. 다음부터 `- 검증: (조건) …`으로 쓴다. 큰 단위(TLS) 감사에 넘길 항목.

### [TLS-2] 계획
- 시작 전 사용자 확인(2026-11-08): "TLS-2 시작" 승인. node-forge **1.4.3 고정**(추천안 선택). 키 위치 **`%LOCALAPPDATA%\sumun\ca\`**(395dd35에서 CLAUDE.md 변경), 깨진·만료 CA는 **멈추고 알림**, 루트 EKU **serverAuth만** — 모두 추천안 선택.
- node-forge 확인 [확인됨]: `npm view node-forge time` → 1.4.1~1.4.3이 2주 안(10-27, 11-04)에 나온 보안 수정판. 공식 CHANGELOG와 GitHub 보안 공지가 내용과 맞음. 고친 기능(체인 검증, TLS 클라이언트, PKCS#12, AES-GCM, ed25519)은 우리가 쓰지 않는다 [추측]. `npm install --save-exact node-forge@1.4.3` → `npm audit signatures` "1 package has a verified registry signature". GitHub `v1.4.3` 태그 tarball과 `diff -r forge-1.4.3/lib node_modules/node-forge/lib` → 같음. install 훅 없음(prepublish만). package.json 변경은 첫 구현 커밋에 넣는다.
- 미확인 항목(O13): 변화 없음(method-auditor는 이번 세션에서도 Agent 목록에 없음).
- 보안 사례(O10): `docs/ai/tls2-cases.md`(검토 에이전트 51개 + 결정 15개). 크기 때문에 TLS-2와 TLS-2b(쓰기 견고성·ACL)로 나눔. 재배정은 그 문서의 "재배정"(O28).
- 한 줄 보고: 목표 = 루트 CA를 안전한 필드로 만들고, 저장소 밖에 보관하고, 깨진 상태에서는 멈춘다 / 범위 =
  - 새 `src/ca/ca.ts`: `loadOrCreateCA(dir, { now?, onWarning? })`(→ `{ certPem, keyPem }`), `defaultCADir(env)`, 오류 클래스 `CAError`(code: `CA_INCOMPLETE`·`CA_MISMATCH`·`CA_CORRUPT`·`CA_NOT_CA`·`CA_EXPIRED`·`CA_NOT_YET_VALID`·`CA_DIR_RELATIVE`·`CA_DIR_IN_REPO`·`CA_DIR_NOT_DIR`·`CA_ENV_MISSING`). 파일 이름 `ca-cert.pem`, `ca-key.pem`. 키는 Node `crypto.generateKeyPair`, 인증서는 forge
  - `package.json`(의존성 node-forge 1.4.3), `package-lock.json`
  - 새 `test/ca/TLS-2.test.ts`(새 동작), 도우미는 파일 안. 회귀가 생기면 `test/ca/TLS-2-regression.test.ts`
  - 새 `scripts/probe/tls2-forge.mjs`(forge 함정 실측), `docs/ai/tls2-cases.md`, `docs/ai/purpose-tree.md`(TLS-2 🔨, TLS-2b 추가), `docs/ai/map.md`, `docs/for-me/TLS-2.md`, `docs/ai/progress.md`
  - 하지 않을 것 = Windows 인증서 저장소(등록·해제), 배정 "2b", 호스트별 발급(`issueCert`, TLS-3), `npm start`에서 CA 쓰기(TLS-4), pre-commit hook
- 예상 [추측] (판정 기준 포함):
  - E69: forge `cert.sign(key)`에 md를 안 넘기면 SHA-1로 서명한다. 판정: Node `X509Certificate`로 읽은 서명 OID 또는 `openssl x509 -text`의 Signature Algorithm이 sha1WithRSAEncryption이면 일치.
  - E70: forge에 첫 hex 글자가 8~f인 일련번호를 주면 DER INTEGER가 음수가 된다. 판정: DER 일련번호 첫 바이트 ≥ 0x80이고 앞에 00이 없으면 일치.
  - E71: forge `pki.privateKeyFromPem`이 Node가 만든 PKCS#8(`BEGIN PRIVATE KEY`)을 읽고, 그 키로 서명한 인증서를 Node `X509Certificate.verify(publicKey)`가 true로 본다. 판정: 둘 다 true.
  - E72: forge로 basicConstraints(cA, pathLen 0, critical), keyUsage(critical), EKU serverAuth, SKI를 넣으면 `openssl x509 -text`에 "CA:TRUE, pathlen:0", "Certificate Sign, CRL Sign", "TLS Web Server Authentication", "Subject Key Identifier"가 모두 나온다. 판정: 넷 다.
  - E73: `certutil -dump <파일>`이 종료 코드 0으로 읽고, 저장소는 바뀌지 않는다(`certutil -user -store Root` 줄 수 전후 같음). 판정: 둘 다.
  - E74: RSA 2048 생성(Node 비동기) + forge 서명 전체 < 3초, 그동안 이벤트 루프 최대 지연 < 200ms. 판정: 둘 다.
  - E75: stub(빈 함수 export)에서 새 동작 테스트는 모두 assertion 실패, 오류 0. 판정: 실패 수 = 테스트 수, 오류 0.
  - E76: 구현 뒤 `npm test`는 실패 0이고 "큰 단위 대기 TLS 2"가 그대로다(TLS-T는 `src/tls/mitm.ts`를 기다림). 판정: 둘 다.
- 실측 (명령 원문, 결과 전문은 각 커밋 메시지):
  - E69·E70·E71·E72·E73·E74 일치(51c63ce): `node scripts/probe/tls2-forge.mjs` → md 없음 sha1WithRSAEncryption / 일련번호 "ff00…" Node -0100…·openssl (Negative) / PKCS#8 읽음·verify true / 확장 넷 다 / certutil -dump 0·저장소 3→3줄 / 지연 65~150ms. 첫 실행은 지연 측정 결함(타이머를 서명 직후 멈춤 → 6·13ms), 고쳐서 다시 잼.
  - E75 일치: stub에서 `npm run test:red -- test/ca/TLS-2.test.ts` → 25개 모두 assertion 실패, 오류 0.
  - 회귀: `node --test test/ca/TLS-2-regression.test.ts` → 2/2(구현 전). 커밋 전 테스트 결함 2개(git grep 패턴이 옵션으로 읽힘, 전제가 미추적 파일을 찾음)를 고침(2ee599b, O36).
  - E76 일치(36be5f9): `npm test` → 465 / 463 통과 / 실패 0 / 대기 TLS 2.
  - 독립 도구(48fea11): `node scripts/probe/tls2-tools.mjs` → openssl이 정책 칸을 모두 읽음, `openssl rsa -check` "RSA key ok", certutil이 Basic Constraints·serverAuth OID를 읽음, 저장소 3→3줄, 키 ACL = SYSTEM·Administrators·본인.
- 계획과 달라진 점: 구현이 한 번에 통과(25/25). 실측 스크립트 tls2-tools.mjs를 추가. CN 날짜는 UTC 기준(한국 시각과 하루 다를 수 있음 — 문서에 적음).
- 범위 밖 기록: 커밋된 테스트 주석 두 곳(TLS-T.test.ts 8행, PRX-2-regression.test.ts F6)은 옛 경로 `%APPDATA%`를 가리킨다. PRX-2 F6은 `%APPDATA%\sumun`만 살피므로 이제 `%LOCALAPPDATA%\sumun`은 그 검사 밖이다 [추측: 기록 유출 검사의 빈틈] — 다음에 그 검사를 고칠 때 함께.
- TLS-3에 넘길 것: forge 서명은 동기(67~148ms). 호스트마다 서명하면 새 사이트마다 프록시가 그만큼 멈춘다 [추측].
- [TLS-2] 완료: 395dd35..7b9ddac + 이 기록 커밋. 다음: TLS-2b(쓰기 견고성·ACL) 또는 TLS-3.
- `node scripts/check-method.mjs --id TLS-2` → 11개 중 9 ✅, **plan-first ❌·test-first ❌** [확인됨]. 원인: 규칙 변경 커밋(395dd35, CLAUDE.md·.gitignore)을 `[TLS-2]` 이름으로 계획 커밋(1810188)보다 먼저 올려서, 검사기가 그것을 첫 커밋으로 판정했다(작업자 실수). 실제 순서(계획 → 실측 → 테스트 → 구현)는 지켜졌다. 고치려면 이력을 다시 써야 해서 해시 참조가 깨진다 → 남긴다. 다음부터 사용자 결정에 따른 규칙 변경은 **계획 커밋에 함께** 넣는다(계획 커밋은 docs/만 바꾼다는 O3와 부딪히면 별도 ID로). TLS 큰 단위 감사에 넘길 항목(TLS-1b message-format과 함께).

### [TLS-2b] 계획
- 사용자 승인(2026-11-08): "TLS-2b 진행". 새 정책 결정 없음 — tls2-cases.md 결정 9(키 파일은 본인만), 12(배타 생성 후 진 쪽이 다시 읽기)를 따른다.
- 미확인 항목(O13): 변화 없음.
- 보안 사례(O10): TLS-2 계획 때 받은 `docs/ai/tls2-cases.md`의 배정 "2b"(28 쓰기 도중 실패, 29 부분 쓰기, 30 동시 호출, 31 남은 임시 파일, 35 심어 둔 링크, 38 키 파일 ACL). 새로 받지 않는다.
- 한 줄 보고: 목표 = CA를 만들 때 반쪽 파일·경쟁·링크·느슨한 권한이 생기지 않게 / 범위 =
  - `src/ca/ca.ts`: `create()` — 임시 파일(`ca-key.pem.<pid>-<난수>.tmp`)을 빈 채로 배타 생성 → icacls로 권한을 본인만으로 → 내용 쓰기 → 하드 링크로 배타 배치(이미 있으면 진 것) → 임시 파일 삭제. 실패하면 만든 것을 되돌린다. 60초 넘은 우리 임시 파일은 지운다. `loadOrCreateCA()` — CA 파일이 일반 파일이 아니면(링크·정션) 거부, 한쪽만 있으면 잠깐(500ms) 기다렸다가 판정(다른 프로세스가 만드는 중일 수 있음), 진 쪽은 다시 읽기. 옵션 `io`(테스트용 쓰기·링크 함수 주입). 오류 code 추가 `CA_WRITE`, `CA_ACL`, `CA_NOT_FILE`
  - 새 `test/ca/TLS-2b.test.ts`(새 동작), 회귀가 생기면 `test/ca/TLS-2b-regression.test.ts`, 새 `scripts/probe/tls2b-fs.mjs`(Windows 파일 동작 실측)
  - `docs/ai/tls2-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/TLS-2b.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 이미 있는 키 파일의 권한 검사·수정(범위 밖 기록), Windows 인증서 저장소, TLS-3, 프로세스가 두 링크 사이에서 강제 종료되는 경우(남는 위험으로 기록)
- 예상 [추측] (판정 기준 포함):
  - E77: Windows에서 `fs.renameSync(a, b)`는 b가 있어도 덮어쓴다(배타적이지 않다). 판정: 덮어쓰면 일치 → 배치에 rename을 쓰지 않는다.
  - E78: `fs.linkSync(a, b)`는 b가 있으면 EEXIST로 실패하고, 하드 링크는 원본과 ACL을 공유한다. 판정: EEXIST이고 icacls 결과가 같으면 일치.
  - E79: `icacls 파일 /inheritance:r /grant:r *<내 SID>:(F)` 뒤 icacls에는 내 계정 한 줄만 남는다. 판정: 권한 줄이 1개면 일치.
  - E80: 파일 자리에 만든 디렉터리 정션은 `fs.lstatSync().isSymbolicLink()`가 true다(관리자 권한 없이 만들 수 있음). 판정: true면 일치.
  - E81: `BUILTIN\Users`에 읽기를 상속(OI)(CI)으로 준 폴더에 만든 파일은 icacls에 Users가 보인다(사례 38 테스트의 긍정 전제). 판정: 보이면 일치.
  - E82: 지금 구현(36be5f9)에서 새 동작 테스트는 모두 assertion 실패, 오류 0. 판정: 실패 수 = 테스트 수, 오류 0.
  - E83: 구현 뒤 `npm test` 실패 0, TLS-2 테스트 25개 그대로 통과, 큰 단위 대기 TLS 2. 판정: 셋 다.
  - E84: 동시 5개(같은 프로세스) + 2개(다른 프로세스)가 모두 같은 CA를 받고 디스크와 같으며 임시 파일이 남지 않는다. 판정: 모두.
- **멈춤(2026-11-08): 테스트 결함 보고, 사용자 결정 대기.** 구현(21cb821) 뒤 TLS-2b 37개 중 36 통과. 실패 1개 = `test/ca/TLS-2b.test.ts` B38 "Users가 읽을 수 있게 상속하는 폴더…"의 `key.names.includes('Users')`. `names`는 icacls 출력 전체라 **파일 경로 `C:\Users\…`**의 "Users"에 걸린다. 같은 테스트의 SDDL 검사(ACE = 본인 SID 하나, D:P)는 통과, 구현이 만든 키의 icacls 출력은 `wooni\wooni:(F)` 한 줄 [확인됨]. 제안: 경로를 뺀 권한 줄만 검사하도록 그 assertion을 고친다(기대값 "Users·Everyone 등이 없음"은 그대로). 사용자가 "테스트 수정 허용"을 입력해야 고칠 수 있다.
- 재개(2026-11-08): 사용자가 "테스트 수정 허용" 입력 → B38의 그 assertion만 고침(a3cf4eb, 원래 값·이유는 커밋 메시지). 고친 테스트가 구현 전 ca.ts(36be5f9)에서 여전히 실패함을 확인.
- 실측 (명령 원문, 결과 전문은 각 커밋 메시지):
  - E77·E78·E80·E81 일치, **E79 불일치**(a7773bc): `node scripts/probe/tls2b-fs.mjs` → /grant:r 뒤에도 SYSTEM·Administrators 남음. /restore는 종료 코드 1300(관리자 특권). E79b(/save로 SDDL 읽고 /remove:g) → 본인 하나, D:P, 77ms. 첫 실행에서 Git Bash whoami가 Windows whoami.exe를 가림 → System32 절대 경로.
  - **E82 불일치(가벼움)**: `npm run test:red -- test/ca/TLS-2b.test.ts` → 11개 모두 실패지만 assertion 10, 오류 1(B30 동시 5번에서 지금 코드가 던진 EEXIST). 통과한 B31 사례 1개는 회귀 파일로(d13bf4c).
  - E83 일치: `npm test` → 477 / 475 통과 / 실패 0 / 대기 TLS 2(a3cf4eb). E84 일치: B30 두 테스트 통과.
  - 독립 도구: `node scripts/probe/tls2-tools.mjs` → 키 icacls `wooni\wooni:(F)` 한 줄(TLS-2 때는 SYSTEM·Administrators·본인), 생성 537ms(권한 설정으로 182 → 537).
- hook 기록(O25): junit 기록을 읽는 셸 명령이 상태 폴더 규칙에 막힘 → 의도한 보수적 동작. 커밋된 테스트 결함은 규칙대로 멈추고 보고(사용자 허용 뒤 수정).
- 범위 밖 기록: 이미 있는 키 파일의 권한은 불러올 때 검사하지 않는다(다른 방법으로 만들었거나 나중에 권한이 바뀐 키). 필요하면 경고를 추가하는 작은 단위로.
- [TLS-2b] 완료: 6eb9f70..5353296 + 이 기록 커밋. 다음: TLS-3(호스트별 인증서 발급).
- `node scripts/check-method.mjs --id TLS-2b` → 11개 중 10 ✅, test-unchanged ❌(a3cf4eb) [확인됨] — 사용자 허용(“테스트 수정 허용”)으로 고친 테스트가 그대로 잡힌 것. 검사가 의도대로 동작했다. 이유와 원래 값은 a3cf4eb 메시지. TLS 큰 단위 감사에 넘김.

### [TLS-3] 계획
- 사용자 승인(2026-11-08): "TLS-3 진행". 결정 3개 — 말단 유효 기간 **30일**, 말단 키 **호출마다 새 키**, 와일드카드 **금지**(모두 추천안 선택).
- 미확인 항목(O13): 변화 없음.
- 보안 사례(O10): `docs/ai/tls3-cases.md`(검토 에이전트 55개 + 결정 13개). 47~55는 프록시 문맥이 필요해 TLS-4로 배정(O28 — TLS 보고서에 올림).
- 한 줄 보고: 목표 = 루트 CA로 사이트별 말단 인증서를 정책대로, 프록시를 멈추지 않고 발급 / 범위 =
  - `src/ca/ca.ts`: 새 함수 `issueCert(ca, hosts)`(→ `{ certPem, keyPem }`), 도우미 `normalizeHosts(hosts)`(거부·정규화). 오류 code 추가 `CA_BAD_HOST`, `CA_BAD_ISSUER`(루트 CA가 쓸 수 없음). 서명은 forge로 TBS를 만들고 Node `crypto.sign` 콜백으로
  - 새 `test/ca/TLS-3.test.ts`(새 동작), 회귀가 생기면 `test/ca/TLS-3-regression.test.ts`, 새 `scripts/probe/tls3-sign.mjs`
  - `docs/ai/tls3-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/TLS-3.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 캐시·single-flight(TLS-4), 프록시에 연결(TLS-4), Windows 인증서 저장소
- 예상 [추측] (판정 기준 포함):
  - E85: forge `pki.getTBSCertificate(cert)`의 DER을 Node `crypto.sign('sha256', tbs, 루트키, 콜백)`으로 서명하고 forge 인증서에 `signature`·`signatureOid`를 넣어 PEM으로 만들면, Node `X509Certificate.verify(루트 공개키)`가 true이고 openssl이 sha256WithRSAEncryption으로 읽는다. 판정: 둘 다.
  - E86: 그 방식으로 1회 발급(키 생성 포함) 동안 이벤트 루프 최대 지연 < 50ms. 같은 측정에서 forge 동기 서명은 ≥ 50ms. 판정: 둘 다.
  - E87: forge altNames `{ type: 7, ip: '127.0.0.1' }`과 `{ type: 7, ip: '::1' }`이 iPAddress 4·16바이트로 들어가고, Node `X509Certificate.checkIP`가 맞는다. 판정: 둘 다 true.
  - E88: forge AKI `{ name: 'authorityKeyIdentifier', keyIdentifier: <루트 SKI 바이트> }`가 루트 SKI와 같은 값으로 들어간다. 판정: openssl의 Authority Key Identifier = 루트 Subject Key Identifier.
  - E89: 말단 issuer를 루트 인증서의 subject 속성으로 정하면 DER 이름이 바이트까지 같다(둘 다 forge가 만든 이름). 판정: 같음.
  - E90: Node `tls.connect({ ca: 루트, servername: 'localhost' })`가 `['localhost']` 인증서에 성공, `servername: 'other'`면 ERR_TLS_CERT_ALTNAME_INVALID. 판정: 둘 다.
  - E91: stub(`issueCert`가 undefined를 돌려줌)에서 새 동작 테스트는 모두 assertion 실패, 오류 0. 판정: 실패 수 = 테스트 수, 오류 0.
  - E92: 구현 뒤 `npm test` 실패 0, 큰 단위 대기 TLS 2(TLS-T는 `src/tls/mitm.ts`를 기다림). 판정: 둘 다.
- 실측 (명령 원문, 결과 전문은 각 커밋 메시지):
  - E85·E87·E88·E89·E90 일치, **E86 부분 불일치**(88fe98b): `node scripts/probe/tls3-sign.mjs` 2회 → Node 서명 지연 11·16ms(< 50 일치), forge 동기 43·57ms(예상 "항상 ≥ 50"과 달리 한 번은 밑). 결정 4대로 Node 서명.
  - E91 일치: stub에서 `npm run test:red -- test/ca/TLS-3.test.ts` → 15개 모두 assertion 실패, 오류 0.
  - E92 일치(6cff3df): `npm test` → 492 / 490 통과 / 실패 0 / 대기 TLS 2.
  - 독립 클라이언트(0c45d3d): `node scripts/probe/tls3-openssl.mjs` → localhost·127.0.0.1 "Verify return code: 0 (ok)", other.test "62 (hostname mismatch)".
- hook 기록(O25): 구현 첫 시도(heredoc 리다이렉트 + 같은 명령에서 테스트 실행)와 구현 커밋(printf 메시지 안의 테스트 경로 + 리다이렉트)이 막힘 → 의도한 보수적 동작. 실행 전에 막혀 바뀐 것 없음. Edit·Write 도구로 나눠서 진행.
- 계획과 달라진 점: 회귀 파일 없음(구현 전에 통과하는 assertion이 없었다). 실측 스크립트 tls3-openssl.mjs 추가. subject가 비는 경우(64자 넘는 첫 이름) SAN을 critical로(RFC 5280 4.2.1.6) — 사례 표에 없던 것을 구현 중 넣음.
- [TLS-3] 완료: a5974af..(문서 커밋). 다음: TLS-4(TLS 종료 후 복호화한 요청 기록 — 큰 단위 테스트 TLS-T가 기다리는 `src/tls/mitm.ts`).

### [TLS-3] 병합 뒤 발견한 결함(O26): 동시 발급 때 이벤트 루프 지연이 기준(50ms)을 넘음
- 발견: 병합(c3a1459) 뒤 main에서 전체 테스트 → 492 / 489 통과 / **실패 1**(TLS-3 E45 "20개 동시 182ms"). 브랜치에서 그 파일만 돌렸을 때는 통과했다. **main이 지금 이 테스트로 흔들린다.**
- 원인 실측(eee261b): 20개 동시 지연이 한가할 때 23~73ms, CPU가 바쁠 때 65~267ms. 1회 동기 구간 2.4~3ms 중 **루트 CA를 매번 다시 검사·파싱하는 몫이 약 1.4~1.9ms**. 키 생성 완료가 몰리면 20개분이 한 차례에 돈다.
- 범위 안으로 판단: 결정 13(지연 50ms)은 TLS-3의 판정 기준이고, TLS-4에서 페이지 하나가 새 사이트 여러 개를 동시에 여는 것이 흔하다 [추측].
- 고칠 것: 같은 루트(certPem·keyPem)의 검사 결과(파싱한 인증서, 키 객체)를 기억해 두고 다시 쓴다(상한 4개). 유효 기간 검사는 매번 한다(시간이 흐르므로).
- 재현 테스트: 지연 시간은 부하에 따라 흔들려서 결정적인 재현이 어렵다 → **"같은 루트로 20번 발급할 때 루트 인증서를 다시 파싱하지 않는다"**를 파싱 횟수로 센다(crypto.X509Certificate·forge certificateFromPem 감시). 지금 구현에서는 실패해야 한다.
- 예상 [추측] (판정 기준 포함):
  - E93: 고친 뒤 `node scripts/probe/tls3-sync.mjs`와 같은 계산에서 루트 몫이 빠져 1회 동기 ≤ 1.5ms. 판정: tls3-lag.mjs의 "한가함" 20개 동시 3회가 모두 ≤ 50ms.
  - E94: 고친 뒤 전체 테스트를 3번 돌려 E45 실패 0. 판정: 3번 모두 실패 0. 하나라도 실패하면 E45의 50ms 기준이 병렬 실행 부하에서 흔들리는 테스트 문제로 보고 사용자에게 보고한다.
- 결과 [확인됨]: 재현 테스트 435b4cd(지금 구현에서 루트 재파싱 {"node":20,"forge":40}, assertion 실패 1) → 수정 31b7971(같은 루트의 검사 결과를 기억, 상한 4, 유효 기간은 매번).
  - E93 일치: `node scripts/probe/tls3-lag.mjs` 2회 → 20개 동시 한가함 13~27ms(전 23~73), 바쁨 16~45ms(전 65~267, 기준선 33·37ms).
  - E94 일치: `npm test` 3회 → 3번 모두 494 / 492 통과 / 실패 0.
- hook 기록(O25): 실측 커밋 메시지를 printf로 쓰다 막힘(메시지 안의 "npm test" 글자와 리다이렉트) → 의도한 보수적 동작. 커밋 메시지는 Write 도구로 쓰는 것으로 정함.

### [TLS-4] 계획
- 사용자 승인(2026-11-08): "TLS-4 진행". 결정 4개 — SNI ≠ CONNECT면 **CONNECT 기준**, 터널 안 Host가 다르면 **421**, 목적지 불신은 **터널 안 502**, `npm start` 복호화는 **`--decrypt`일 때만**(모두 추천안).
- 미확인 항목(O13): 변화 없음(남은 것: ai-research Read 규칙, Ctrl+C, EACCES — 세션 밖 조건).
- 보안 사례(O10): `docs/ai/tls4-cases.md`(검토 에이전트 약 70개 + 결정 11개, 작업자 결정 1개 추가). 크기 때문에 TLS-4와 TLS-4b(견고성)로 나눴다(목적 나무에 TLS-4b 추가). H1·H4(실제 브라우저)는 등록이 필요해 SEC-3으로(O28).
- 큰 단위 테스트: 이 단위가 대기 파일 `src/tls/mitm.ts`를 만든다 → TLS-T 2개가 실제 검사가 된다.
- 한 줄 보고: 목표 = CONNECT 뒤 TLS를 종료해 복호화한 요청을 기록하고, 검증한 HTTPS 목적지로 중계 / 범위 =
  - 새 `src/tls/mitm.ts`: `openMitm(...)`(CONNECT 검사 → 200 → TLS 서버 핸드셰이크 → 안쪽 HTTP 서버로), `createCertCache(ca)`(호스트별 발급, single-flight, 실패는 캐시 안 함)
  - `src/tls/tunnel.ts`: CONNECT 대상 검사(해석·이름 한 번·루프)를 `openTunnel`과 `openMitm`이 같이 쓰도록 함수로 나눔
  - `src/proxy/server.ts`: `startProxy()` 옵션 `ca`, `upstreamCA`. 요청 처리기를 함수로 나눠 평문과 터널 안 요청이 같이 씀. 터널 안: Host 421, 목적지 `https.request`(검사한 주소, servername, 신뢰 목록 = 공개 CA + upstreamCA, 검증 명시), `bad-certificate` 502
  - `src/flow/flow.ts`: 오류 code `bad-certificate`·`tls-handshake`, 칸 `tls?: { sni }`
  - `src/cli.ts`: `parseArgs()`에 `--decrypt`, `formatSummary()`가 https 요청 줄을 보이게
  - `src/index.ts`: `--decrypt`면 `loadOrCreateCA(defaultCADir())` → `startProxy({ ca })`
  - 새 `test/tls/TLS-4.test.ts`(새 동작), 새 `test/tls/TLS-4-regression.test.ts`, 새 `scripts/probe/tls4-*.mjs`
  - `docs/ai/tls4-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/TLS-4.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 배정 "4b", Windows 인증서 저장소 등록(SEC-3), 실제 브라우저 확인(SEC-3), HTTP/2·WebSocket 해석
- 예상 [추측] (판정 기준 포함):
  - E95: `https.request`에 `rejectUnauthorized: true`를 명시하면 `NODE_TLS_REJECT_UNAUTHORIZED=0`이어도 자체 서명 목적지가 실패한다. 판정: 오류 code가 인증서 오류(DEPTH_ZERO_SELF_SIGNED_CERT 등)면 일치.
  - E96: CONNECT 소켓에 head를 되돌려 넣고(`unshift`) `new tls.TLSSocket(socket, { isServer: true })`로 감싸면, CONNECT와 같은 write로 온 ClientHello로도 핸드셰이크가 된다. 판정: 성공.
  - E97: 안쪽 `http.Server`에 `emit('connection', tlsSocket)`으로 넘기면 keep-alive 요청 3개를 차례로 처리한다. 판정: 응답 3개.
  - E98: 목적지 인증서 오류 코드 — 만료 CERT_HAS_EXPIRED, 자체 서명 DEPTH_ZERO_SELF_SIGNED_CERT, 이름 불일치 ERR_TLS_CERT_ALTNAME_INVALID, 모르는 CA UNABLE_TO_VERIFY_LEAF_SIGNATURE. 판정: 실측한 코드 목록을 구현의 bad-certificate 판정에 쓴다(다르면 기록).
  - E99: 이 PC의 curl(Schannel)이 `--cacert <루트>`로 Windows 저장소 없이 MITM 프록시를 거친 HTTPS에 200을 받는다. 판정: 200. 폐기 확인 오류(CRYPT_E_NO_REVOCATION_CHECK 등)면 `--ssl-no-revoke`로 다시 하고 기록.
  - E100: stub(mitm.ts가 빈 함수, server.ts는 ca를 무시 → CONNECT 501)에서 새 동작 테스트는 모두 assertion 실패, 오류 0. 판정: 실패 수 = 테스트 수, 오류 0.
  - E101: 구현 뒤 `npm test` 실패 0이고 **큰 단위 대기 TLS 0**(TLS-T 2개가 실제로 통과). 판정: 둘 다.
- **멈춤(2026-11-08): 테스트 결함 보고, 사용자 결정 대기.** 구현(830f606..d0b0168) 뒤 `node --test --test-timeout=30000 test/tls/TLS-4.test.ts test/tls/TLS-T.test.ts test/prx/PRX-4.test.ts` → 63개 중 58 통과, 실패 5. 실패 5개는 모두 테스트 쪽 결함으로 판단 [확인됨: scripts/probe/tls4-test-defects.mjs, c8134fd]:
  1. **TLS-T 1번**(큰 단위 테스트), **TLS-4 E11·B2**: 목적지 시험 서버가 `writeHead()` 뒤 `end()`로 응답해 응답이 chunked인데, 테스트는 본문이 원문 끝에 그대로 있다고 본다(`/\r\n\r\nsecure-hello$/`, `endsWith('secure-hello')`). 프록시는 HTTP 규칙대로 chunked를 그대로 전달하고, 풀면 본문은 "secure-hello"다. 제안: chunked를 풀어 본문을 비교한다(기대값 "본문 = secure-hello" 그대로).
  2. **TLS-4 A11**: `tls.connect({ socket })`에 `host`를 안 주면 Node는 'localhost'로 이름을 검사해 IP 인증서와 맞지 않는다(ERR_TLS_CERT_ALTNAME_INVALID). `host: '127.0.0.1'`을 주면 성공. 제안: 테스트 도우미가 IP일 때 host를 넘긴다.
  3. **TLS-4 G1**: 테스트의 가짜 lookup에 'localhost.'(끝점) 항목이 없어 그 변형만 502. 넣으면 20개 모두 같은 인증서. 제안: NAMES에 'localhost.'를 추가한다.
  - 고치려면 사용자가 "테스트 수정 허용"을 입력해야 한다. TLS-T는 큰 단위 테스트라 고치는 내용을 보고서 결정 항목에도 올린다.
- 이 PR 안에서 고친 구현 결함 2개: 이름이 여러 주소로 풀릴 때 첫 주소만 시도(TLS-T가 unreachable — 이 PC에서 localhost → ::1, 127.0.0.1) → 검사한 주소들을 차례로 시도(ac93999·336cb13). 클라이언트가 인증서를 거부해도 서버 쪽 오류 이벤트가 없어 기록이 비던 것 → 핸드셰이크 완료 여부로 판정(808f96f).
- hook 기록(O25): 구현 스크립트(heredoc)와 같은 명령에서 테스트를 돌리려다 막힘 2회 → 의도한 보수적 동작. 수정 스크립트를 파일로 쓰고 명령을 나눔.
- 재개(2026-11-08): 사용자가 "테스트 수정 허용" 입력 → 결함 4건을 고침(9d8a528, 원래 값·이유는 커밋 메시지). TLS-T(큰 단위 테스트)도 고쳤다 → TLS 보고서 결정 항목.
- 전체 테스트에서 TLS-3 E45가 "20개 동시 52ms"로 실패(병렬 실행 부하) → 사용자 결정(2026-11-08) "기준선을 빼고 판정" → b1334f4.
- 실측 (명령 원문, 결과 전문은 각 커밋 메시지):
  - E95·E96·E97·E98 일치(f049895): `node scripts/probe/tls4-node.mjs` → head 1604바이트로 핸드셰이크, keep-alive 3개, 검증 명시 없이는 NODE_TLS_REJECT_UNAUTHORIZED=0이 만료·자체 서명·가짜 목적지의 본문을 통과시킴, 오류 코드 CERT_HAS_EXPIRED·DEPTH_ZERO_SELF_SIGNED_CERT·ERR_TLS_CERT_ALTNAME_INVALID·UNABLE_TO_VERIFY_LEAF_SIGNATURE.
  - E100 일치(752437d): stub에서 16개 모두 assertion 실패, 오류 0(처음엔 TypeError가 섞여 상태 확인 assertion을 먼저 두도록 고침 — 커밋 전).
  - E101 일치(b1334f4 뒤): `npm test` → 510 / 510 통과 / 실패 0 / **큰 단위 대기 0**.
  - E99 일치(대체 경로, 8f32bb5): `node scripts/probe/tls4-curl.mjs` → curl --cacert만으로는 "(60) schannel: the revocation status is unknown", --ssl-no-revoke면 example.com 200. 믿을 수 없는 로컬 목적지는 502.
- 계획과 달라진 점: cli.ts의 formatSummary는 바꾸지 않음(https 기록도 지금 모양으로 충분). 구현 결함 2개를 이 PR 안에서 고침(주소 목록, 핸드셰이크 판정). 테스트 결함으로 멈췄다 재개. 실측 스크립트 3개 추가(tls4-test-defects, tls4-curl, tls4-curl-revoke).
- TLS-4b에 넘길 것: 불투명 터널의 첫 주소만 연결(범위 밖 기록), 핸드셰이크 뒤 클라이언트가 끊은 CONNECT 기록에 오류 코드가 없음(curl 실측 1번), 배정 "4b" 전부, B4(SNI가 IP). SEC-3에 넘길 것: 폐기 확인(CRL·OCSP 없음 — curl은 --ssl-no-revoke 필요), 실제 브라우저(H1·H4).
- [TLS-4] 완료: 232991f..6299aee + 이 기록 커밋. 다음: TLS-4b.
- `node scripts/check-method.mjs --id TLS-4` → 11개 중 10 ✅, test-unchanged ❌(9d8a528 — 사용자 허용으로 고친 테스트가 잡힘, 의도대로). `--id TLS-3`도 test-unchanged ❌(b1334f4 — 사용자 결정으로 E45 판정 방식을 바꿈) [확인됨]. 둘 다 TLS 큰 단위 감사·보고서에 올린다.

### [TLS-4b] 계획
- 사용자 승인(2026-11-08): "TLS-4b 진행". 새 사용자 결정 없음 — tls4-cases.md 결정 3·5·6·8은 추천대로. 결정 9(실패 원인 세부)는 `error.detail` 대신 `tls.upstreamError`로 바꾼다(작업자 판단: TLS-T·TLS-4 테스트가 error를 정확히 비교하므로 error 모양을 바꾸지 않는다 → TLS 보고서 결정 항목).
- 미확인 항목(O13): 변화 없음.
- 보안 사례(O10): `docs/ai/tls4-cases.md` 배정 "4b"(A4·A6·A7·A13·A14·A15, B4·B7, C5·C6, D1·D2·D4·D5·D8·D9, E5·E7·E8·E9·E10·E14, F1·F2, G3·G5)와 TLS-4에서 넘긴 것(불투명 터널이 첫 주소에만 연결 — 범위 밖 기록 853d33e). 새로 받지 않는다.
- 한 줄 보고: 목표 = 복호화와 터널이 이상한 입력·느린 클라이언트·여러 주소에서도 견고하게 / 범위 =
  - `src/tls/mitm.ts`: `openMitm()` 핸드셰이크 타임아웃(옵션, 기본 10초), `createCertCache()` 상한(LRU 1000)·만료 1일 전 재발급(테스트용 now 주입)
  - `src/proxy/server.ts`: `startProxy()` 옵션 `tlsHandshakeTimeoutMs`. `handle()`: 목적지 TLS 실패(인증서가 아닌 것)를 `tls-handshake`로 구별, 실패 원인 코드를 `tls.upstreamError`에, 터널 안 Upgrade 요청 거부. 안쪽 서버의 `upgrade` 처리
  - `src/tls/tunnel.ts`: `openTunnel()`이 검사한 주소들을 차례로 시도(연결 거부·도달 불가면 다음 주소), 기록에 실제로 연결한 주소
  - `src/flow/flow.ts`: `tls.upstreamError?`
  - 새 `test/tls/TLS-4b.test.ts`(새 동작), 새 `test/tls/TLS-4b-regression.test.ts`(구현 전에도 통과해야 정상), 새 `scripts/probe/tls4b-*.mjs`
  - `docs/ai/tls4-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/TLS-4b.md`, `docs/ai/progress.md`
  - 하지 않을 것 = Windows 저장소 등록·브라우저(SEC-3), HTTP/2·WebSocket 해석, 동시 핸드셰이크 상한(D9는 프로세스 유지만), 폐기 확인(A5, 문서), TLS 세션 재개(C6, Node agent:false라 섞이지 않는다는 것을 문서에)
- 예상 [추측] (판정 기준 포함):
  - E102 D8: 프록시(ALPN http/1.1만)에 클라이언트가 ALPN `h2`만 제안하면 Node 서버가 핸드셰이크를 거절한다(no_application_protocol). 판정: 클라이언트 쪽 오류가 나면 일치(구현 전에도 통과 → 회귀).
  - E103 D2: 클라이언트가 maxVersion TLSv1.1이면 Node 기본(최소 1.2)으로 핸드셰이크 실패. 판정: 실패면 일치(회귀).
  - E104 D1: 200 뒤 평문 `GET /` 바이트를 보내면 TLS 오류로 닫히고 CONNECT 기록 tls-handshake. 판정: 둘 다면 일치(TLS-4 구현으로 이미 됨 → 회귀).
  - E105 E10: 안쪽 HTTP 서버에 `upgrade` 처리기가 없으면 Node 24는 Upgrade 요청을 [추측: 'request'로 넘기지 않고 소켓을 닫는다]. 판정: 실측 결과를 그대로 기록하고, 구현은 거부(502가 아닌 고정 문구 4xx/5xx)로 맞춘다.
  - E106 C5·A13·A7: 목적지가 h2만 / 평문 TCP / TLS 1.0만이면 https.request 오류 코드가 인증서 오류가 아니다(ERR_SSL_… 또는 ECONNRESET 등). 판정: CERT_ERRORS에 없는 코드면 일치 → tls-handshake로 분류.
  - E107 B4: Node 클라이언트에 servername '127.0.0.1'을 주면 [추측: 경고와 함께 SNI를 보내지 않거나 그대로 보낸다]. 판정: 실측 결과를 기록. 어느 쪽이든 인증서는 CONNECT 기준.
  - E108: 새 동작 테스트는 지금 구현(b78c112)에서 모두 assertion 실패, 오류 0. 판정: 실패 수 = 테스트 수, 오류 0.
  - E109: 구현 뒤 `npm test` 실패 0, 큰 단위 대기 0. 판정: 둘 다.
- 실측(05d5607): E102·E103·E104 일치(회귀), **E105 불일치**(Upgrade가 일반 GET으로 바뀌어 전달), E106 일치(EPROTO·ERR_SSL_*), E107 기록(IP SNI여도 CONNECT 기준 인증서).
- E108 일치(b8913fb): 7개 모두 assertion 실패, 오류 0. 회귀 6/6.
- **멈춤(2026-11-08): 테스트 결함 보고, 사용자 결정 대기.** 구현 뒤 TLS 계열 96개 중 95 통과. 실패 1 = `test/tls/TLS-4b.test.ts` D4. 테스트는 "200 뒤 ClientHello를 보내지 않는 클라이언트"를 시험해야 하는데, 도우미 `connectMitm`(test/tls/_mitm.ts)은 200 뒤 곧바로 TLS를 시작해 ClientHello를 보낸다. 게다가 프록시 CA를 넘기지 않아 클라이언트가 인증서를 거부 → 기록이 timeout이 아니라 tls-handshake. 구현은 맞다 [확인됨: scripts/probe/tls4b-timeout.mjs → "CONNECT 응답 HTTP/1.1 200 / ClientHello 없이 기다림 → 316ms 뒤 닫힘 / 기록 [['CONNECT',{'by':'client','code':'timeout'}]]"]. 제안: D4 앞부분을 원시 소켓으로(CONNECT만 보내고 200을 읽은 뒤 아무것도 보내지 않음) 고친다(기대값 timeout 그대로). 사용자가 "테스트 수정 허용"을 입력해야 고칠 수 있다.
- 재개(2026-11-08): "테스트 수정 허용" → D4 앞부분을 원시 소켓으로(9f211dd). 고친 D4가 구현 전 src에서는 실패함을 확인.
- E109 일치: `npm test` → 523 / 523 통과 / 실패 0 / 대기 0. 실제 curl(4b 실측 스크립트): `node scripts/probe/tls4b-curl.mjs` → localhost로 127.0.0.1 서버에 200.
- 계획과 달라진 점: 범위에 도우미 `test/tls/_mitm.ts`(b8913fb)를 적지 않았다(O11 — TLS 감사에서 지적). 결정 9를 tls.upstreamError로(계획대로). 테스트로 만들지 않은 4b 사례 A4·A6·B7·C6·F1·F2(이유는 b8913fb) → TLS 보고서 결정 항목(O28). 핸드셰이크 뒤 클라이언트가 요청 없이 끊는 CONNECT 기록(curl 폐기 확인 실패)은 오류 없이 남는 그대로 — 브라우저 사전 연결과 구별할 수 없어 바꾸지 않음 [추측] → 보고서에.
- [TLS-4b] 완료: 4568edc..(문서 커밋).

### [TLS-4c] 계획
- 사용자 승인(2026-11-08): TLS 보고서 결정 1~18 모두 추천대로, O39~O46 모두 승인 → 보고서 머리, `docs/method-feedback.md` 승인 표(이 커밋). 결정 1·2 = 이 단위.
- 미확인 항목(O13): 변화 없음. 남은 셋(ai-research Read 규칙, Ctrl+C 종료, 예약 포트 EACCES)은 모두 세션 밖 조건이 필요하다.
- 보안 사례(O10): 별도 컨텍스트 검토 에이전트 → `docs/ai/tls4c-cases.md`(I1~I16, K1~K14, C1~C17, R1~R6). 해결안은 알려 주지 않았다. 사용자 결정 D-1~D-5 모두 추천대로(같은 문서).
- 한 줄 보고: 목표 = 복호화 터널 안에서도 평문과 같은 헤더 제한(유휴·느린 헤더 연결을 h 안에 408로 닫음), 목적지 인증서 검증 실패를 코드 목록과 상관없이 `bad-certificate`로 / 범위 =
  - `src/tls/mitm.ts`: `openMitm()` — 안쪽 서버에 연결을 넘기는 시점, 요청 없이 시간 초과로 닫힌 터널의 CONNECT 기록 `client timeout`
  - `src/proxy/server.ts`: `startProxy()`의 안쪽 서버(inner) 헤더 제한이 실제로 돌게, inner `clientError`에서 시간 초과면 408. `handle()`의 목적지 오류 분류(인증서 검증 실패 판정을 `CERT_ERRORS` 목록 밖까지)
  - 새 `test/tls/TLS-4c.test.ts`(새 동작), 새 `test/tls/TLS-4c-regression.test.ts`(구현 전에도 통과해야 정상), 필요하면 새 도우미 `test/tls/_tls4c.ts`(시험 인증서는 이미 의존성인 node-forge로 만든다 — package.json 변경 없음)
  - 새 `scripts/probe/tls4c-*.mjs`(원인·분류 실측, 실제 클라이언트), 새 `scripts/probe/tls4c-review/`(검토 에이전트 실험 스크립트 6개를 경로만 바꿔 옮김)
  - `docs/ai/tls4c-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/TLS-4c.md`, `docs/for-me/TLS-report.md`, `docs/method-feedback.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 본문·역방향 압력 제한(D-3), 파이프라이닝 동작 변경(D-4), 인증서 오류 문구 기록(D-5), CONNECT 단계 이름 해석·발급 시간 제한(R6, 범위 밖), 기존 테스트 파일 수정, Windows 저장소·브라우저(SEC-3)
- 예상 [추측] (판정 기준 포함):
  - E110 원인: 안쪽 http 서버는 listen하지 않아서 Node의 연결 검사(headersTimeout을 재는 주기 타이머)가 시작되지 않는다. 판정: 실측에서 ① 지금 그대로면 h=500일 때 "핸드셰이크 뒤 무요청"과 "헤더 반쪽"이 3초 안에 닫히지 않고 ② 안쪽 서버에 `'listening'`을 직접 emit해 검사를 켜면 둘 다 연결 뒤 1500ms 안에 닫히면 일치. ②가 안 닫히면 원인 가설이 틀린 것이다.
  - E111: ②의 상태에서 클라이언트는 408을 받지 못하고 그냥 끊긴다(지금 inner `clientError` 처리기가 소켓을 바로 닫으므로). 판정: 닫힐 때까지 받은 응답 바이트가 0이면 일치.
  - E112: ②의 상태에서 h=1이면 Node 검사가 TLS 핸드셰이크 도중 연결을 끊는다(안쪽 서버에 핸드셰이크 전에 연결을 넘기므로 — K10). 판정: 클라이언트 핸드셰이크가 실패하면 일치.
  - E113 분류: Node는 인증서 검증으로 실패시킬 때 목적지 TLS 소켓의 `authorizationError`에 오류 코드를 남긴다. 판정: 인증서 사례(만료·자체 서명·이름 불일치·모르는 CA, C2 critical 확장, C3 SHA-1, C4 RSA 1024)에서 모두 `authorizationError === err.code`이고, 반대 사례(C12 TLS 1.3 클라이언트 인증서 요구, C14 RST)에서는 비어 있으면 일치.
  - E114: 새 동작 테스트는 지금 구현(main 00248ae)에서 모두 assertion 실패, 오류 0. 회귀 테스트는 모두 통과. 판정: 실패 수 = 새 동작 테스트 수, 오류 0, 회귀 실패 0.
  - E115: 구현 뒤 `npm test` 실패 0, 큰 단위 대기 0. 판정: 둘 다.
  - E116 실제 클라이언트(O31): `openssl s_client -proxy 127.0.0.1:<포트>`로 복호화 터널에 핸드셰이크만 하고 기다리면, h=2000인 프록시가 연결 뒤 3500ms 안에 닫고 클라이언트 출력에 `408`이 보인다. 기존 curl 실측(`scripts/probe/tls4-curl.mjs`)은 그대로 200·502. 판정: 둘 다면 일치.
- 실측(b0f9429, `node scripts/probe/tls4c-cause.mjs`, `node scripts/probe/tls4c-classify.mjs`): **E110 일치**(검사 안 켬 → null, 'listening' emit → 528·526ms), **E111 일치**(bytes 0), **E112 불일치**(h=1이어도 바로 하는 핸드셰이크는 성공 — 이 PC의 핸드셰이크가 첫 검사 50ms보다 빠름). 추가 관찰: ClientHello를 300ms 늦추면 h=1에서 핸드셰이크 전에 61ms에 끊기고, h=1000에서 연결 시작부터 1014ms에 닫힘 → 시계는 넘겨받은 때부터 센다 → 구현에서 핸드셰이크 뒤에 넘기기로. **E113 일치**(13사례).
- E114 일치(15d958f): 새 동작 13개 모두 assertion 실패, 오류 0. 회귀 15/15. 첫 회귀 실행에서 K7이 한 번 흔들림 → drip이 응답을 받으면 멈추게(기대값 그대로, 커밋 메시지).
- 구현 중 결함(범위 안, 내가 만든 것): 핸드셰이크 뒤에 넘기자 TLS-4 D3(클라이언트가 우리 인증서 거부, TLS 1.3)이 "CONNECT 기록 없음"으로 실패. 첫 가설("핸드셰이크 전에 아무도 읽지 않아 끝을 처리 못 함")로 이른 data 처리기를 달았지만 여전히 실패 → 버림. 디버그 [확인됨: 작업 폴더 밖 임시 스크립트로 실행, 결과만 기록]: `new TLSSocket(http 'connect' 소켓, { isServer })`에 처리기 none·data·resume·raw resume·http 서버 넘김을 달아 보면 모두 'end'는 오지만 'close'는 http 서버에 넘긴 경우만(12ms) — CONNECT 소켓은 반쯤 닫힌 채 남는다. 같은 비교를 net 서버 소켓으로 하면 모두 close. → 핸드셰이크 전 'end'면 닫는다(e307891). 기존 테스트가 이미 잡은 결함이라 O26의 기록·재현 테스트 순서는 쓰지 않았다(재현 테스트 = TLS-4 D3).
  - 디버그 스크립트를 저장소에 두지 않은 것은 O19와 어긋난다 [추측: 경미 — 결론은 기존 테스트 D3와 이 기록으로 재현 가능]. 감사에 올린다.
- E115 일치: `npm test` → 551 / 551 / 실패 0 / 대기 0.
- E116 일치(2fa5e0c): `node scripts/probe/tls4c-openssl.mjs` → 핸드셰이크 383ms, 종료 2967ms, 408 받음 true, 기록 client timeout. 첫 실행(stdin 열어 둠)은 openssl이 끝나지 않음 → stdin 닫고 -ign_eof. `node scripts/probe/tls4-curl.mjs` → --ssl-no-revoke로 example.com 200, 로컬 불신 502(그대로).
- TLS 보고서 검토 스크립트 재실행: `node scripts/review/tls/review-idle.ts 6` → `{"afterHandshake":764,"noClientHello":677,"plainIdle":761,"partialHeaders":764}`(전: afterHandshake·partialHeaders null), `node scripts/review/tls/review-mitm.ts` → "합계 16개, 실패 0개"(전: 1개).
- 계획과 달라진 점: 범위의 "필요하면 새 도우미 `_tls4c.ts`"는 만들었다. 범위에 없던 `scripts/review/`는 바꾸지 않았다(재실행만). 사례 배정 변경 없음. TLS·TLS-T를 ✅로(보고서 승인, 이 문서 커밋).
- [TLS-4c] 완료: 5fd1dab..cb8da6a, 병합 188a042 + 이 기록 커밋. 다음: INFRA-10.
- `node scripts/check-method.mjs --id TLS-4c`(188a042) → 11개 중 10 ✅, **message-format ❌**(b0f9429, 15d958f, 9dc3d7d): "검증" 줄을 `- 검증(이 커밋 시점, …):`으로 써서 검사기가 `- 검증:`을 찾지 못함. 내용은 있다. TLS-1b와 같은 실수다. TLS 보고서 결정 17(이력 재작성 없음)에 따라 남긴다. INFRA-10에서 다룰지 정한다(형식을 고정할지, 검사기가 괄호를 허용할지) [추측: 커밋 메시지 서식을 파일로 쓰는 O45 절차에 "검증:" 서식도 함께 넣으면 막힌다].

### [INFRA-10] 계획
- 근거: TLS 중간 확인 보고서 승인(2026-11-08) — 방식 보정 O39~O46 8건 모두 승인. 승인 상태는 `docs/method-feedback.md` "승인 상태" 표. 사용자 지시(2026-11-08): "INFRA-10 진행해".
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 보안·차단 규칙(hook, 권한, 인증서)을 바꾸지 않으므로 O10은 해당 없다(기계 검사는 형식 판정이다, O7).
- 한 줄 보고: 목표 = 승인된 O39~O46을 기계 검사와 지침에 반영 / 범위 =
  - `scripts/check-method.mjs`:
    - `checkCommits()` 규칙 `test-unchanged`: 같은 ID 커밋만이 아니라 테스트 커밋 뒤 **모든 커밋**(다른 ID 포함)이 그 노드의 테스트 파일을 바꿨는지 본다(새 인자 `laterCommits`, O39). 바꾼 커밋이 모두 "허용된 수정"이면 결과 `'warn'`(⚠ 허용됨, 위반 아님). 허용된 수정 = 제목에 `(사용자 허용`이 있고 progress.md에 그 해시와 "허용"이 한 줄에 있음(새 인자 `progressText`, O40)
    - `checkCommits()` 규칙 `predictions-measured`: 예상 줄에 `[탐색]`이 있으면 탐색으로 따로 센다. 탐색이 아닌 예상은 실측 기록 줄에 `일치` 또는 `불일치`가 있어야 한다 — 이 판정 요구는 INFRA-10 계획 커밋 뒤 작업에만(새 인자 `verdictRuleApplies`, 상수 `VERDICT_RULE_SINCE`, O46)
    - `checkBigUnit()` 규칙 `sub-nodes`: ⚠ 허용됨은 위반으로 세지 않고 근거에 따로 적는다
    - CLI: 다른 ID 커밋 읽기(`git log <테스트 커밋>..HEAD -- <테스트 파일>`), 표의 결과 `⚠ 허용됨`
  - 새 `test/infra/check-method-infra10.test.mjs`(새 동작), 새 `test/infra/check-method-infra10-regression.test.mjs`(구현 전에도 통과해야 정상)
  - `CLAUDE.md` 개발 방식 절: PR 앞의 `[RULE]` 커밋(O41), 타이밍 assertion(O43), 허용된 테스트 수정 절차와 검증(O40·O44), 커밋 메시지 절차(O45), 탐색 예상(O46). "큰 단위" 절: 이어 붙이기의 확인 가능한 문장(O42)
  - `.claude/agents/method-auditor.md`: ⚠ 허용됨의 판정(허용 기록과 O44 확인을 본다)
  - `docs/method-feedback.md`(승인 표의 반영 위치), `docs/for-me/INFRA-10.md`, `docs/ai/progress.md`
  - 하지 않을 것 = hook 변경, 과거 커밋 재작성(TLS 보고서 결정 17), decisions.md(사용자가 직접), message-format 규칙 변경(TLS-4c ❌는 내 서식 실수 — 기존 형식 `- 검증:`을 O45 절차 문장에 함께 적어 막는다)
- 예상 [추측] (판정 기준 포함):
  - E117: 새 동작 테스트는 지금 구현(main 6b2e93e)에서 모두 assertion 실패, 오류 0(새 모듈이 아니라 stub 없음 — 기존 함수에 새 인자를 넘기면 무시된다). 회귀 테스트는 모두 통과. 판정: 실패 수 = 새 동작 테스트 수, 오류 0, 회귀 실패 0.
  - E118: 구현 뒤 `node scripts/check-method.mjs --id TLS`의 sub-nodes 근거에서 ❌는 정확히 4건(TLS-1b message-format, TLS-2 plan-first, TLS-2 test-first, TLS-4c message-format)이고, ⚠ 허용됨은 정확히 5건(TLS-2b·TLS-3·TLS-4·TLS-4b·TLS-T test-unchanged — TLS-T는 9d8a528이 [TLS-4] 이름으로 고쳐 지금은 ✅로 잘못 나온다). 판정: 두 목록이 이와 같으면 일치.
  - E119 [탐색]: 파일 기준으로 바꾸면 PRX·INFRA 노드 중 test-unchanged 결과가 바뀌는 노드가 있는지(다른 ID 커밋이 그 노드의 테스트 파일을 바꾼 일이 있는지). 결과를 기록하고, 새 ❌가 나오면 원인 커밋을 적는다.
  - E120: 구현 뒤 `npm test` 실패 0, 대기 0. 판정: 둘 다.
- 실측 (명령 원문):
  - E117 일치(af6a14c): `npm run test:red -- test/infra/check-method-infra10.test.mjs` → 8개 모두 assertion 실패, 오류 0. `npm test -- test/infra/check-method-infra10-regression.test.mjs` → 7 / 7.
  - E118 일치(4c06f6a): `node scripts/check-method.mjs --id TLS` → 위반 4건(TLS-1b message-format, TLS-2 plan-first, TLS-2 test-first, TLS-4c message-format), ⚠ 허용됨 5건(TLS-T, TLS-2b, TLS-3, TLS-4, TLS-4b test-unchanged).
  - E119 [탐색] 기록: main의 check-method.mjs를 임시 폴더(`.oldcm/check-method.mjs` — 직접 실행 판정이 파일 이름 끝을 보므로 이름 그대로)에 꺼내, git 이력의 모든 PRX·INFRA·TLS 노드에 같은 `--id`로 돌려 규칙 표를 비교 → 바뀐 것은 TLS-2b·TLS-3·TLS-4·TLS-4b test-unchanged ❌→⚠, TLS-T ✅→⚠ 뿐. PRX·INFRA는 변화 없음, 새 ❌ 없음. 첫 비교는 꺼낸 파일 이름을 `.check-method-old.mjs`로 해서 출력이 비었다(직접 실행 판정 실패) → 이름을 바꿔 다시.
  - E120 일치(5bddebe): `npm test` → 566 / 566 / 실패 0 / 대기 0.
- 계획과 달라진 점: 없음. 비교에 쓴 임시 폴더는 지웠다 [추측: 결과는 위 명령으로 재현 가능하므로 O19 위반은 아님 — 비교 스크립트가 아니라 같은 CLI를 두 버전으로 실행한 것].
- [INFRA-10] 완료: 6228f88..f32a277, 병합 4e45d02 + 이 기록 커밋. `node scripts/check-method.mjs --id INFRA-10`(4e45d02) → 10개 ✅, tree-updated ➖(INFRA). predictions-measured "예상 E117, E118, E120 모두 실측 기록 있음 / 탐색 E119 기록 있음" — 새 판정 요구가 처음 적용된 작업. 다음: SEC-3.

### [SEC-3] 계획
- 근거: 사용자 지시(2026-11-08) "SEC-3 진행해". TLS 보고서 결정 18(TLS-4c → TLS ✅ → INFRA-10 → SEC-3). 2026-11-07 결정: 등록 범위 = 현재 사용자(CurrentUser\Root).
- 미확인 항목(O13): 변화 없음.
- 시작 전 상태(읽기만, 2026-11-08) [확인됨]: `%LOCALAPPDATA%\sumun\ca` 없음, `Cert:\CurrentUser\Root`·`Cert:\LocalMachine\Root`에 이름에 sumun이 든 인증서 없음, `C:\Windows\system32\certutil.exe` 있음.
- 보안 사례(O10): 별도 컨텍스트 검토 에이전트 → `docs/ai/sec3-cases.md`(A1~A11, B1~B8, C1~C7, D1~D8, E1~E4, F1~F6, G1~G8). 저장소를 바꾸는 명령은 금지하고 읽기만 했다. 사용자 결정 1~8 모두 추천대로(같은 문서).
- 이전 단위에서 넘겨받은 사례: tls2-cases 4(EKU를 Windows가 지키는지 → G6), 50(재생성 뒤 옛 등록 CA → B5·F1), tls4-cases H1·H4(실제 브라우저 → G1), tls4c-cases의 preconnect 재연결(→ 브라우저 실측에서 관찰), curl `--ssl-no-revoke`(→ G3).
- 설계 [추측]: 저장소 읽기는 certutil 출력(CP949·언어 의존)을 해석하지 않고 레지스트리 `HKCU\Software\Microsoft\SystemCertificates\Root\Certificates`(사용자 물리 저장소)와 `HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates`(컴퓨터)를 `reg.exe query`로 읽는다. 키 이름 = SHA-1, `Blob` 값 안의 속성 32 = 인증서 DER → 꺼낸 DER의 SHA-1이 키 이름과 같은지로 스스로 검증한다. 등록 `certutil -user -addstore Root <임시 DER>`, 삭제 `certutil -user -delstore Root <40자리 SHA-1>`, 관리자 여부는 `whoami /groups`의 무결성 SID(S-1-16-12288 이상 = 승격). 폴더 권한은 `ca.ts`의 `daclOf()`(icacls `/save` SDDL)를 다시 쓴다.
- 한 줄 보고: 목표 = 사용자가 직접 실행하는 루트 CA 등록·해제·상태 명령(사람 확인 두 번, 다른 인증서는 절대 건드리지 않음)과 실제 브라우저 확인 / 범위 =
  - 새 `src/ca/winstore.ts`: `parseRegCerts()`(reg 출력 → 인증서 목록), `blobToDer()`(속성 32), `makeWinStore(run)`(사용자·컴퓨터 Root 읽기, `add(der)`, `remove(sha1)`, `elevated()`), 도구 절대 경로 상수
  - 새 `src/ca/command.ts`: `parseCaArgs()`, `runCaCommand(cmd, deps)`(install·uninstall·status, 확인 입력, 표시 이스케이프, 옛 CA 판정, 폴더 검사, 결과 재조회). 실행기·입력·출력·CA 폴더·저장소를 주입받는다(테스트는 가짜)
  - 새 `src/ca-cmd.ts`(실행 진입점, 진짜 의존성 연결), `src/ca/ca.ts`: `daclOf()`를 export(내용 변경 없음)
  - `package.json`: `scripts.ca = "node src/ca-cmd.ts"`
  - 새 `test/ca/SEC-3.test.ts`(새 동작), 새 `test/ca/SEC-3-regression.test.ts`(있으면), 새 `scripts/probe/sec3-*.mjs`(레지스트리·whoami 읽기 실측, 실제 등록 뒤 브라우저·curl 실측)
  - `docs/ai/sec3-cases.md`, `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/SEC-3.md`, `docs/ai/progress.md`
  - 하지 않을 것 = **Claude가 저장소를 바꾸는 명령을 실행하는 것**(등록·해제는 사용자가 자기 터미널에서 직접), LocalMachine 저장소 쓰기, Firefox 설정 변경, 폐기 목록(CRL) 제공, `loadOrCreateCA`의 검사 규칙 변경(A1·A2·A7은 등록 단계에서 막는다 — 재배정 아님: 사례 배정이 처음부터 등록 단계), 프록시 코드 변경
- 예상 [추측] (판정 기준 포함):
  - E121: 컴퓨터 Root 레지스트리(`reg query HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates /s /v Blob`)의 모든 항목에서 Blob의 속성 32를 꺼내면 DER 인증서이고, 그 SHA-1이 키 이름과 같다. 판정: 항목 수 ≥ 1이고 모두 같으면 일치.
  - E122: 그 레지스트리 항목의 SHA-1은 모두 `Cert:\LocalMachine\Root`(합친 보기) 안에 있다. 판정: 하나도 빠지지 않으면 일치.
  - E123: 사용자 Root 레지스트리(HKCU)는 지금 항목 0개다(에이전트의 certutil -user 0개와 같음). 판정: 0개면 일치.
  - E124: 이 터미널(승격 아님)의 `whoami /groups`에는 `S-1-16-8192`가 있고 `S-1-16-12288`은 없다. 판정: 둘 다 그러면 일치.
  - E125: 새 동작 테스트는 stub(빈 함수만 export)에서 모두 assertion 실패, 오류 0(O2). 판정: 실패 수 = 테스트 수, 오류 0.
  - E126: 구현 뒤 `npm test` 실패 0, 대기 0. 판정: 둘 다.
  - E127 실측(사용자가 실행): `npm run ca -- install`의 확인 화면에 보인 SHA-1이 Windows 확인 창의 지문과 같고, 등록 뒤 `npm run ca -- status`가 "사용자 Root에 등록됨, 컴퓨터 Root 없음"이다. 판정: 지문 같음(사용자 확인) + status 두 줄이 그러면 일치.
  - E128 실측: 임시 프로필 Chrome(`--proxy-server=127.0.0.1:<포트>`, 시스템 설정은 바꾸지 않음)이 `npm start -- --decrypt`를 거쳐 `https://example.com/`을 인증서 오류 없이 열고, 프록시 요약 줄에 `GET example.com:443 200`이 나온다. 판정: 페이지 본문에 "Example Domain"이 있고 요약 줄이 있으면 일치.
  - E129 실측: 등록 뒤 Windows curl(`curl -x` 프록시, `--cacert` 없이)은 `--ssl-no-revoke` 없이는 실패(종료 코드 ≠ 0)하고, 붙이면 HTTP 200. 판정: 둘 다면 일치.
  - E130 실측(사용자가 실행): `npm run ca -- uninstall` 뒤 status가 "등록 안 됨"이고, 새로 연 임시 프로필 Chrome이 같은 주소에서 인증서 오류(`ERR_CERT_AUTHORITY_INVALID`)를 낸다. 판정: 둘 다면 일치.
  - E131 [탐색] G6: 등록한 상태에서 우리 CA로 서명한 코드 서명용 말단 인증서를 `certutil -verify`(읽기 검증)에 넣으면 EKU 때문에 거부되는지 기록한다.
- 실측 (명령 원문):
  - E121·E122·E123·E124 일치(0b335f1): `node scripts/probe/sec3-reg.mjs`.
  - E125 일치(6fd100f): stub으로 22개 모두 assertion 실패, 오류 0(A1·A2는 긍정 전제를 더한 뒤 — 커밋 메시지).
  - E126 일치(aa67ed0 뒤 작업 트리): `npm test` → 588 / 588 / 실패 0 / 대기 0.
  - E127 일치: 사용자가 PowerShell에서 실행. `npm run ca -- install`은 PowerShell 실행 정책 때문에 `npm.ps1`이 막혔다("이 시스템에서 스크립트를 실행할 수 없으므로") → `npm.cmd run ca -- install`. 첫 실행은 "※ 새로 만든 CA입니다(처음 실행)"까지 보이고 사용자가 멈췄고, 두 번째 실행에서 yes → "sumun: 등록됨 — 지문 090295D7C1EC2FBEC70E5BC849791A4DDE0E4459". 사용자: Windows 창의 지문이 같았다. `node src/ca-cmd.ts status` → "사용자 Root: 등록됨 ⚠ …", "컴퓨터 Root: 없음". 교차 확인 `certutil -user -store Root 090295d7…` → 1개(출력 CP949), 키 파일 `icacls` → `wooni\wooni:(F)`만.
  - E128 일치·E129 일치: `node scripts/probe/sec3-browser.mjs registered` → "Chrome: 종료 코드 0, 본문에 "Example Domain" true, 인증서 오류 표시 없음", 요약 줄 `GET example.com:443 200`, "curl(--cacert 없이): 종료 코드 35, HTTP 000 / --ssl-no-revoke: 종료 코드 0, HTTP 200". 관찰: Chrome 배경 요청 `CONNECT accounts.google.com:443 tls-handshake` — Chrome이 우리 인증서를 거부(구글 계정 도메인의 별도 보호로 보임 [추측], G5).
  - E131 [탐색] 기록: `node scripts/probe/sec3-browser.mjs g6` 세 번. ① `-verify`만 → 둘 다 CERT_E_CHAINING(사용자 Root를 안 봄) ② `-user -verify` → 둘 다 체인 성공·폐기 확인만 실패(용도 미지정) ③ `-user -verify <파일> <용도 OID>` → serverAuth 성공, **codeSigning `CERT_E_WRONG_USAGE`(루트 단계 CERT_TRUST_IS_NOT_VALID_FOR_USAGE)** — Windows가 루트의 EKU 제한(TLS-2 결정 4)을 지킨다.
- **실측 중 범위 안 결함(O26 ① 기록, 2026-11-08):** E130(해제) 실측에서 사용자가 `npm.cmd run ca -- uninstall`을 실행하고 "예는 눌렀는데 해제됨은 못 봤다", 창은 닫았다. 확인 [확인됨]: 사용자 Root 레지스트리에 `090295D7…`가 그대로 있고, 실행 중인 ca-cmd·certutil 프로세스는 없다(명령은 끝났다). 진짜 CA + 가짜 쓰기로 흐름 재현 → 터미널에 `예`를 입력하면 "취소했습니다"만 찍고 certutil을 부르지 않는다(Windows 창도 안 뜸). `yes`면 `-user -delstore Root 090295d7…`를 부르고, 남아 있으면 "해제되지 않았습니다(certutil 종료 코드 N)". 어느 쪽이었는지는 **화면 출력 말고는 기록이 없어 알 수 없다** — 이것이 결함이다(창을 닫으면 원인이 사라진다). CAPI2 이벤트 로그는 권한 없음, Application 로그에 관련 기록 없음.
  - 고칠 것: ① install·uninstall의 단계·지문·certutil 종료 코드를 `%LOCALAPPDATA%\sumun\ca-command.log`에 덧붙인다(키·비밀 없음, 저장소 밖) ② 입력이 `예`·`네`·`y`처럼 "예"의 뜻이면 여전히 취소하되(결정 C1 그대로) "영어 yes를 입력해야 합니다"라고 안내한다. 고친 뒤 사용자에게 해제를 다시 부탁한다.
  - 재현 디버그 스크립트는 작업 폴더 밖 임시 파일이었다 — 같은 재현을 ② 재현 테스트로 저장소에 둔다(O19).
  - ② 재현 테스트 ae9ce3f(red 3/3), ③ 수정 87bea3b·a3d42f5. `npm test` → 591 / 591.
  - E130 일치: 사용자가 다시 `npm.cmd run ca -- uninstall` → "sumun: 해제됨 — 지문 090295D7…". 기록 `%LOCALAPPDATA%\sumun\ca-command.log`: `확인 입력 "yes" → 진행` / `certutil -delstore 종료 코드 0` / `결과: 해제됨`. `node src/ca-cmd.ts status` → "사용자 Root: 등록 안 됨", `reg query HKCU\…\Root\Certificates`에 090295D7 0개. `node scripts/probe/sec3-browser.mjs unregistered` → "Chrome: … "Example Domain" false, 인증서 오류 표시 ERR_CERT_AUTHORITY_INVALID", curl 둘 다 종료 코드 60, "E130(브라우저 부분): 일치". 첫 해제 실패의 원인(터미널 "예" 입력인지 certutil 실패인지)은 끝내 모른다.
- ✅ (2026-11-08 고침 — 아래 [SEC-3 테스트 수정]) ~~**테스트 결함(내가 쓴 테스트, 보고 대기):**~~ `test/ca/SEC-3.test.ts`의 `forgeCert`는 CN을 UTF-8로 인코딩하지 않아 forge가 0xFF 위 글자를 아래 바이트로 자른다('ѕ' → 'U', U+202E → '.') [확인됨: 구현 중 디버그]. 그래서 "F1·B6·E1" 테스트는 키릴·방향 문자 사례를 실제로는 시험하지 않는다. 대신 `scripts/probe/sec3-lookalike.mjs`(d944462)로 진짜 글자를 확인했다. 고치려면 "테스트 수정 허용"이 필요하다 → 사용자 보고.
- 남은 작은 빈틈: 거부(관리자·파이프)는 작업 기록에 시작 줄만 남고 이유가 없다.
- 계획과 달라진 점: 범위에 없던 새 파일 `test/ca/SEC-3-log.test.ts`(O26 재현), `src/ca/ca.ts`는 `daclOf`와 함께 `me`도 export, 진입점에 작업 기록 파일(`%LOCALAPPDATA%\sumun\ca-command.log`), 실측 스크립트 3개(`sec3-reg`, `sec3-lookalike`, `sec3-browser`). E127은 PowerShell 실행 정책 때문에 `npm.cmd`로.
- 범위 밖 관찰: 2026-11-08 오전 9:09에 시작된 `npm run test:red -- test/tls/TLS-4.test.ts` node 프로세스 4개(PID 5888·7664·8096·9296)가 아직 실행 중 — 이전 작업의 남은 프로세스로 보인다 [추측]. 종료하지 않고 사용자에게 보고.
- [SEC-3] 완료: 8e2e616..cf85a75, 병합 7f5c498 + 이 기록 커밋. 다음: STO.
- `node scripts/check-method.mjs --id SEC-3`(7f5c498) → 11개 중 10 ✅, **message-format ❌**(8fecd7e, a3d42f5): 또 `- 검증(저장소 쓰기 없음):`으로 썼다. INFRA-10에서 CLAUDE.md에 "콜론 앞에 괄호를 넣지 않는다"를 넣은 바로 다음 단위다 — 지침만으로는 막히지 않았다. 이력 재작성 없이 남긴다(TLS 보고서 결정 17). 방식 보정 후보 O47: 커밋 전에 메시지 파일을 검사하는 장치(예: commit-msg hook 또는 커밋 전 `check-method` 형식 검사 스크립트)를 둔다 — 승인 전이라 기록만(O23).


### [SEC-3 테스트 수정] 계획
- 근거: 사용자 결정(2026-11-08, 확인 1번 "테스트 수정 허용"). 결함 기록은 위 [SEC-3]의 "테스트 결함" 줄.
- 미확인 항목(O13): 변화 없음.
- hook 기록(O25): 선택 창에서 "테스트 수정 허용"을 골랐지만 Edit가 막혔다 — 의도한 보수적 동작(hook은 사용자가 직접 입력한 메시지만 본다). 사용자에게 그 말을 직접 입력해 달라고 요청.
- 한 줄 보고: 목표 = SEC-3 "F1·B6·E1" 테스트가 진짜 키릴 ѕ·U+202E·ESC 이름을 시험하게 / 범위 = `test/ca/SEC-3.test.ts`의 `forgeCert()`(CN을 `forge.util.encodeUtf8` + UTF8String으로), 같은 파일 "F1·B6·E1" 테스트에 긍정 전제 assertion(만든 인증서의 subject에 ѕ·U+202E·ESC가 실제로 들어 있음, O30), `docs/ai/progress.md` / 하지 않을 것 = `src/` 변경, 기대값 변경(경고·이스케이프 기대는 그대로), 다른 테스트 변경
- 예상 [추측] (판정 기준 포함):
  - E132: 고친 테스트 파일은 지금 구현(main 6add191)에서 전부 통과. 판정: `npm test -- test/ca/SEC-3.test.ts` 실패 0이면 일치.
  - E133: 새 긍정 전제 assertion은 옛 forgeCert라면 실패한다(= 옛 테스트가 사례를 시험하지 못했다는 증거). 판정: 옛 방식으로 만든 인증서의 subject에 ѕ가 없으면 일치.
  - E134: 고친 "F1·B6·E1" 테스트는 구현 전 코드(빈 함수만 export한 stub)에서 assertion으로 실패, 오류 0(O44). 판정: 그 테스트가 assertion 실패면 일치.
  - E135: 수정 뒤 `npm test` 실패 0, 대기 0. 판정: 둘 다.
- **수정 중 발견(O26 ① 기록, 2026-11-08):**
  - ⓐ 처음 고친 판(`forge.util.encodeUtf8` + UTF8 태그)은 새 긍정 전제 assertion에서 실패했다 — forge가 UTF8 태그일 때 **스스로** UTF-8로 바꾸므로 두 번 인코딩된다('ѕ' → 'Ñ'). 고침: 태그만 주고 encodeUtf8은 빼기. 같은 방식으로 쓴 `scripts/probe/sec3-lookalike.mjs`(d944462)도 두 번 인코딩이었다 — 그 출력의 "Node subject = CN=Ñumun…"을 그때 놓쳤다. 그래서 위 [SEC-3]의 "진짜 글자를 확인했다"는 **틀린 기록**이었다(경고 결과는 깨진 글자도 비ASCII라 우연히 같았다 [추측]).
  - ⓑ B3("지울 지문이 다른 인증서 일련번호와 겹치면 지우지 않음")가 **실행마다 결과가 다르다**: 수정 전 파일로 `node --test --test-name-pattern="^B3" test/ca/SEC-3.test.ts` 10번 → 통과 4, 실패 6 [확인됨]. 원인: 일련번호로 쓰는 SHA-1의 첫 hex가 8~f면 forge가 음수 INTEGER로 써서 Node가 `-65D4…`로 읽는다(`9a2b3c → -65D4C4`, `009a2b3c → 9A2B3C` [확인됨: 임시 스크립트]). 그러면 "겹치는 일련번호" 인증서가 만들어지지 않고 구현은 그대로 지운다(종료 코드 0). 지난 591/591은 운이었다. 구현 쪽 판단(Node의 serialNumber는 앞 00을 뺀다)은 맞다. 같은 `forgeCert` 안의 결함이고 기대값은 바꾸지 않으므로 같은 허용 범위에서 고친다(앞에 00, 긍정 전제 assertion) — 사용자에게 보고.
- c8b1b43 [SEC-3] 테스트 수정 — 사용자 허용("테스트 수정 허용" 입력, 2026-11-08). 원래 값·이유·구현 전 코드 확인은 커밋 메시지.
- 실측 (명령 원문):
  - E132 일치(c8b1b43): `npm test -- test/ca/SEC-3.test.ts` → 22 / 22 / 실패 0. B3만 `node --test --test-name-pattern="^B3" test/ca/SEC-3.test.ts` 10번 → 통과 10.
  - E133 일치(bd4b605): `node scripts/probe/sec3-testfix-old.mjs` → 옛 방식 subject "CN=Uumun local CA 2026-11-08", CN "x\u001b[2K.evil", 일련번호 다름 → 긍정 전제 셋 다 false.
  - E134 일치(bd4b605): `node scripts/probe/sec3-testfix-stub.mjs` → 전체 22, 실패 22, ERR_ASSERTION 22, 다른 실패 0. B3·F1·B6·E1은 긍정 전제 뒤 원래 기대값에서 실패.
  - E135 일치(bd4b605 뒤): `npm test` → 591 / 591 / 실패 0 / 대기 0.
  - 다시 돌린 `node scripts/probe/sec3-lookalike.mjs`(bd4b605, 이중 인코딩 고친 뒤) → subject가 진짜 글자("CN=ѕumun…", "CN=abc‮evil"), 경고·이스케이프 결과는 처음과 같음.
- hook 기록(O25): Edit 도구로 쓴 일부 줄의 한글이 `\uAE0D…` 같은 이스케이프 문자열로 저장됐다(실행 결과는 같음) → node 스크립트로 다시 썼다. hook 문제가 아니라 도구 쪽 [추측]. 셸 명령 안의 `\\`가 `\` 하나로 바뀌는 것도 봤다(heredoc 안 Python·node 코드) — 그래서 고칠 스크립트는 Write 도구로 쓰고 백슬래시는 String.fromCharCode(92)로 만들었다. 원인은 확인하지 않았다.
- 계획과 달라진 점: 범위에 없던 B3 일련번호 수정(같은 `forgeCert`, 기대값 변경 없음)과 `scripts/probe/sec3-lookalike.mjs`(이중 인코딩)·새 `sec3-testfix-stub.mjs`·`sec3-testfix-old.mjs`, `docs/for-me/SEC-3.md` 결함 항목 갱신.

- [SEC-3 테스트 수정] 완료: 8206c68..37e8b56, 병합 dcd720f + 이 기록 커밋. `node scripts/check-method.mjs --id SEC-3`(dcd720f) → test-unchanged **⚠ 허용됨**(c8b1b43, O40 의도대로), message-format ❌는 그대로 8fecd7e·a3d42f5(이번 커밋들은 위반 없음), 나머지 ✅. predictions-measured 근거에 E132~E135가 안 나온다 — 노드의 첫 계획 섹션만 보는 것으로 보인다 [추측: 코드 안 봄]. 결과에는 영향 없고, STO 보고서의 O47과 함께 올린다.

### [STO-T] 계획
- 근거: 사용자 지시(2026-11-08) "STO 진행해". CLAUDE.md 큰 단위 절(O33) — 시작할 때 큰 단위 테스트를 먼저. 형식은 INFRA-9(`test/sto/STO-T.test.ts`, todo 이유 `대기: src/store/attach.ts`, 동적 import, export 없음).
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 보안 사례(O10): 별도 컨텍스트 검토 에이전트 → `docs/ai/sto-cases.md`(A1~A10, B1~B9, C1~C11, D1~D11, E1~E6, F1~F3, 범위 밖 X1~X5). 사용자 결정 S-1~S-4(질문, 모두 추천), S-5~S-10(추천대로 진행 — STO 보고서 결정 항목). 에이전트 실험 스크립트는 `scripts/probe/sto-review/`로 옮긴다(O19, 실측 커밋).
- 대기 파일 P = `src/store/attach.ts`: 마지막 작은 단위 STO-4가 만든다.
- **다시 할 행동(O42)** — 같은 실행 안에서:
  - PRX-T 1: 실제 curl로 평문 `POST http://127.0.0.1:<목적지>/submit?x=1`(Cookie, 본문)을 프록시로 → 200
  - PRX-T 2: 실제 curl로 닫힌 포트 → 502
  - TLS-T 1: CONNECT localhost → TLS(프록시 CA만 믿음) → `GET /hello?q=1` + Cookie → 200 `secure-hello`
  - 그 뒤 새 단계: 저장소의 알림·목록·필터·상세, 그리고 별도 테스트에서 상한으로 오래된 기록이 빠지는지
- 설계 [추측] — 큰 단위 테스트가 고정하는 모양. 바꿀 땐 STO 보고서 결정 항목으로 올린다:
  - `src/store/store.ts`: `createStore({ maxBytes?, maxFlows?, maxPending? })` → `{ runId, list(filter?), get(id), subscribe(fn) → 해제 함수, clear() }`. 기본값 256MiB·10,000·1,000(S-1, S-2)
  - `src/store/attach.ts`: `attachStore(store)` → `{ onFlowStart, onFlow }`(startProxy 옵션에 그대로 펼침). 같은 저장소에 두 번 부르면 오류(S-7)
  - 알림: `{ type: 'start' | 'done', summary }`, `{ type: 'evicted', ids }`, `{ type: 'cleared' }`
  - 요약: `{ id, runId, state: 'pending' | 'done', startedAt, method, url, target?, status?, statusFrom?: 'upstream' | 'proxy', error?, durationMs? , requestSize, responseSize }` — 본문·헤더 없음(S-4)
  - `list(filter)`: `{ host?, method?, status? }`, id 오름차순. `get(id)`: 본문까지 복사한 Flow 사본(고쳐도 저장된 기록은 그대로)
- 한 줄 보고: 목표 = 저장소 사용자 흐름을 처음부터 끝까지 확인하는 큰 단위 테스트를 먼저 둔다 / 범위 =
  - 새 `test/sto/STO-T.test.ts`: (1) 위 세 행동 → 알림(시작이 완료보다 먼저, 요약에 본문 없음), 목록(완료 3건 id 순), 필터(method post → curl POST, host localhost → HTTPS 요청, status 502 → 닫힌 포트, 출처 proxy), 상세(본문·쿠키, 고쳐도 다시 조회하면 그대로) (2) 작은 상한(`maxBytes` 1MiB)에서 400KB 본문 POST 세 번 → 가장 오래된 것이 `evicted` 알림과 함께 빠지고 목록에 둘. 도우미는 파일 안에 두고 export하지 않는다
  - 새 `scripts/probe/sto-review/e1-buffers.mjs`·`e2-proxy.mjs`·`e3-mitm.mjs`·`e4-memory.mjs`·`e5-reject.mjs`(에이전트 실험, 저장소 절대 경로를 상대 경로로만 바꿈)
  - 새 `docs/ai/sto-cases.md`, `docs/ai/purpose-tree.md`(STO 🔨, STO-T·STO-1~4 추가), `docs/for-me/STO-T.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 구현(STO-1~4), 프록시·TLS 코드 변경(X1~X5는 범위 밖), 대시보드
- 예상 [추측] (판정 기준 포함):
  - E136: `npm run test:red -- test/sto/STO-T.test.ts` → 2개 모두 실패, 유형은 오류(동적 import한 `src/store/store.ts`가 없음, ERR_MODULE_NOT_FOUND). 판정: 실패 2, 각각 ERR_MODULE_NOT_FOUND면 일치.
  - E137: 테스트 커밋 뒤 `npm test`는 종료 코드 0, 출력에 "큰 단위 대기(todo) STO: 2개, 그중 실패 2개". 판정: 둘 다면 일치.
  - E138: 옮긴 실험 스크립트가 저장소 안에서도 에이전트 결과와 같은 줄을 낸다(E8b "끝이 없는 시작 1:CONNECT", E14 "s2 s3 f1 f2 f3", e5-reject 종료 코드 1). 판정: 셋 다 같으면 일치.
- 실측 (명령 원문):
  - E136 일치(b9b2f79): `npm run test:red -- test/sto/STO-T.test.ts` → tests 2 / todo 2, 오류 2개 ERR_MODULE_NOT_FOUND(`src/store/store.ts`), "[red] 2개 모두 실패".
  - E137 일치(b9b2f79): `npm test` → 종료 코드 0, tests 593 / pass 591 / fail 0 / todo 2, "큰 단위 대기(todo) STO: 2개, 그중 실패 2개".
  - E138 일치(cd27f80): `scripts/probe/sto-review`에서 `node e2-proxy.mjs` → "E14 … s2 s3 f1 f2 f3", `node e3-mitm.mjs` → "E8b … 끝이 없는 시작 1:CONNECT", `node e5-reject.mjs` → 종료 코드 1. 처음에는 계획 커밋 전에 한 번 돌려 봤고(결과 같음), 판정은 계획 커밋 뒤 다시 돌린 것으로 했다.
- 계획과 달라진 점: 없음.
- [STO-T] 완료: 4ff4d7a..3e8deb2, 병합 9f356b1 + 이 기록 커밋. `node scripts/check-method.mjs --id STO-T`(9f356b1) → 11개 모두 ✅(message-format 포함). 다음: STO-1.

### [STO-1] 계획
- 근거: STO-T 계획의 작은 단위 순서. 사례 배정 `docs/ai/sto-cases.md` "STO-1"(A4, A7, A8, A9, B1, B4, B5, B6, B8, C2~C10, D11, E1, E2, E3, E5), 결정 S-2·S-3·S-4·S-5·S-9·S-10.
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 보안 사례(O10): STO-T 계획 때 받은 sto-cases.md를 쓴다(새 검토 없음 — 같은 단위의 사례).
- 설계 [추측]: `createStore(opts?)` → `{ runId, addStart(start), addFlow(flow), list(), get(id), subscribe(fn) → 해제 함수, clear(), stats() }`.
  - 진행 중: `addStart`는 CONNECT가 아니면 진행 중 요약을 만든다(S-2). `addFlow`가 오면 완료로 바꾼다. 시작 없이 온 완료도 저장(B1). 완료 뒤 늦게 온 시작은 무시(B6). `clear()` 전에 시작한 요청의 완료는 버린다(S-5).
  - 요약(S-3·S-4): `{ id, runId, state, startedAt, method, url, target?, status?, statusFrom?, error?, durationMs?, requestSize?, responseSize?, tunnel? }` — 본문·헤더 없음. 매번 새 객체.
  - 상세: `get(id)` → 본문을 각자 자기 메모리(`allocUnsafeSlow`)로 복사하고 헤더·target·error를 복사한 Flow 사본(C9·C10).
  - 알림: 동기로 부르되, 알림 중에 생긴 알림(구독자가 clear·add 호출)은 지금 알림이 모든 구독자에게 간 뒤에 보낸다(C8). 구독자 목록은 알림 시작 때의 것(C6·C7). throw·reject는 삼키고 `stats().subscriberErrors`만 센다, 출력 없음(S-10, C2~C5).
  - 출력 안전: `util.inspect`·`String`·`JSON.stringify(store)`에 기록 내용이 나오지 않는다(E1·E3). 잘못된 입력의 오류 문구는 고정(E2).
  - 상한(STO-2), 필터(STO-3), 프록시 연결(STO-4)은 이 단위에서 하지 않는다.
- 한 줄 보고: 목표 = 기록을 메모리에 보관하고 요약 알림·목록·상세 사본을 주는 저장소 핵심 / 범위 =
  - 새 `src/store/store.ts`: `createStore()`, `toSummary()`, `copyFlow()`, 알림 큐
  - 새 `test/sto/STO-1.test.ts`(새 동작), 회귀가 있으면 새 `test/sto/STO-1-regression.test.ts`
  - `docs/ai/sto-cases.md`(배정 결과), `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/STO-1.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 상한·필터·프록시 연결·index.ts, 프록시·TLS 코드 변경
- 예상 [추측] (판정 기준 포함):
  - E139: 새 동작 테스트는 stub(빈 함수만 export한 `src/store/store.ts`)에서 모두 assertion 실패, 오류 0(O2). 판정: 실패 수 = 테스트 수, 오류 0.
  - E140: 구현 뒤 `npm test` 실패 0, 출력에 "큰 단위 대기(todo) STO: 2개"(attach.ts가 아직 없음). 판정: 둘 다면 일치.
  - E141 [탐색]: 1MiB 본문 기록 1,000건에서 `JSON.stringify(store.list())`의 길이 — 요약만 나가는지 크기로 기록한다(`scripts/probe/sto1-summary-size.mjs`).
- 실측 (명령 원문):
  - E139 일치(6c7a771): stub으로 `npm run test:red -- test/sto/STO-1.test.ts` → 18개 모두 assertion 실패, 오류 0. 첫 실행은 오류 5개와 tests 16으로 보여(빈 목록 [0] 읽기, C5가 출력을 가로채는 동안 await해서 실행기 결과 줄까지 가로챔) 커밋 전에 테스트를 고쳤다(커밋 메시지). 기대값 변경 없음.
  - E140 일치(67d5778): `npm test` → tests 611 / pass 609 / fail 0 / todo 2, "큰 단위 대기(todo) STO: 2개, 그중 실패 2개".
  - E141 [탐색] 기록(67d5778): `node scripts/probe/sto1-summary-size.mjs` → 목록 JSON 318,680자, 건당 319자, 2.6ms, 본문 글자 포함 false.
- 실제 클라이언트 실측(O31): 이 단위는 프록시에 연결하지 않아 실제 클라이언트가 닿지 않는다 → STO-4에서 curl·브라우저로.
- hook 기록(O25): ① 커밋 메시지를 printf로 셸에서 만들다 `>`와 테스트 경로가 겹쳐 막힘 ② `npm run test:red -- test/… > 파일`, `| tee 파일`도 막힘 — 모두 의도한 보수적 동작(O45). Write 도구로 메시지, 출력은 파이프로 grep만.
- 계획과 달라진 점: 새 `scripts/probe/sto1-summary-size.mjs`(계획에 이름만 있던 E141 스크립트). 회귀 파일 없음(회귀 assertion만 있는 테스트 없음). 범위에 적은 `docs/ai/sto-cases.md`(배정 결과)는 바꾸지 않았다 — 배정 표가 이미 STO-T 계획 커밋(4ff4d7a)에 있었다(STO 감사 지적, [AUDIT-7]에서 더함).
- 범위 밖 관찰: 없음.
- [STO-1] 완료: 355e00c..cfbdb99, 병합 6ca795d + 이 기록 커밋. `node scripts/check-method.mjs --id STO-1`(6ca795d) → 11개 모두 ✅. 다음: STO-2.

### [STO-2] 계획
- 근거: 사례 배정 `docs/ai/sto-cases.md` "STO-2"(A1, A2, A3, A5, A6), 결정 S-1(256MiB·10,000건, 오래된 것부터)·S-2(진행 중 1,000개, 바이트 상한에 포함)·S-5(상한으로 뺀 진행 중의 늦은 완료는 버림).
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 설계 [추측]:
  - `createStore({ maxBytes = 256MiB, maxFlows = 10_000, maxPending = 1_000 })`. 옵션은 양의 정수만(아니면 TypeError).
  - 비용: 완료 = 저장된 본문 `body.length`(요청 + 응답, `bodySize` 아님 — A2) + 헤더 쌍마다 `64 + 2 × (이름 길이 + 값 길이)`(A3, 에이전트 실측 3,000쌍 건당 약 222KB ≈ 쌍당 74바이트) + 항목 고정 비용. 진행 중 = url·target 문자열 + 고정 비용.
  - "가장 오래된" = **저장소에 먼저 들어온 항목**(시작 알림이나 완료가 처음 온 순서). 진행 중이 완료로 바뀌어도 자리는 그대로. 프록시 id는 늘기만 해서 대개 id 순과 같다.
  - 넣은 뒤 ① 진행 중 > maxPending이면 가장 오래된 진행 중부터 ② 완료 > maxFlows이면 가장 오래된 완료부터 ③ 전체 바이트 > maxBytes이면 상태와 상관없이 가장 오래된 것부터 뺀다. **방금 넣은 항목은 빼지 않는다**(한 건이 상한보다 커도 마지막 하나는 남음 — 기본값에서는 한 건이 최대 약 2MiB라 일어나지 않음).
  - 뺀 id들은 그 넣기의 알림(`start`·`done`) 뒤에 `{ type: 'evicted', ids }` 하나로 알린다.
  - 상한으로 뺀 진행 중 id는 기억해서 늦은 완료를 버린다(기억은 최근 10,000개까지).
  - 뺀 항목은 Map에서 지우는 것 말고 다른 참조를 두지 않는다 → 메모리가 실제로 풀린다(A6).
  - `stats()`에 `bytes`를 더한다.
- 한 줄 보고: 목표 = 저장소가 메모리를 끝없이 쓰지 않게 바이트·건수·진행 중 상한 / 범위 =
  - `src/store/store.ts`: `createStore()` 옵션 검사, `costOf()`(비용), `evict()`(오래된 것부터 빼기), `stats().bytes`
  - 새 `test/sto/STO-2.test.ts`(새 동작), 회귀가 있으면 새 `test/sto/STO-2-regression.test.ts`
  - 새 `scripts/probe/sto2-memory.mjs`(E144 실측)
  - `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/STO-2.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 필터·프록시 연결·index.ts, 프록시 코드 변경, 본문 1MiB 제한 변경(PRX-2 결정)
- 예상 [추측] (판정 기준 포함):
  - E142: 새 동작 테스트는 지금 구현(STO-1, 상한 없음 — 새 모듈이 아니라 stub 없음)에서 모두 assertion 실패, 오류 0. 판정: 실패 수 = 새 동작 테스트 수, 오류 0.
  - E143: 구현 뒤 `npm test` 실패 0, "큰 단위 대기(todo) STO: 2개". 판정: 둘 다.
  - E144: 기본 상한 저장소에 서로 다른 본문(요청·응답 각 1MiB) 기록 400건(약 800MiB)을 넣고 gc 뒤 `process.memoryUsage().arrayBuffers` 증가가 **300MB 이하**, 남은 건수가 **120~128건**(256MiB ÷ 약 2MiB). 판정: 둘 다면 일치(`node --expose-gc scripts/probe/sto2-memory.mjs`).
- 실측 (명령 원문):
  - E142 일치(9bda9a1): `npm run test:red -- test/sto/STO-2.test.ts`(STO-1 구현) → 11개 모두 assertion 실패, 오류 0.
  - E143 일치(a5533f4): `npm test` → tests 622 / pass 620 / fail 0 / todo 2, "큰 단위 대기(todo) STO: 2개, 그중 실패 2개".
  - E144 일치(a5533f4): `node --expose-gc scripts/probe/sto2-memory.mjs` → 끝: 남은 127건, stats.bytes 254MiB, arrayBuffers 증가 254MiB. 관찰: 중간 300건 시점은 +313MiB(판정 기준은 끝 상태) — 뺀 본문의 외부 메모리를 gc 직후 바로 돌려주지 않는 것으로 보인다 [추측]. 저장소가 참조를 남기지 않는 것은 A6 테스트가 본다.
- 실제 클라이언트 실측(O31): 이 단위도 프록시에 연결하지 않는다 → STO-4에서.
- hook 기록(O25): `sed -i`(src 파일)와 `npm test -- test/…`를 한 명령에 이어 쓰다 막힘 — 의도한 보수적 동작. 명령을 나눴다.
- 계획과 달라진 점: `STORE_LIMITS`·`StoreOptions`를 export(설계 지도·다음 단위에서 기본값을 보려고). 회귀 파일 없음.
- 범위 밖 관찰: 없음.
- [STO-2] 완료: 3ea89d5..e390e7c, 병합 cf6c0d7. `node scripts/check-method.mjs --id STO-2`(cf6c0d7) → 11개 모두 ✅. 다음: STO-3.


### [STO-3] 계획
- 근거: 사례 배정 `docs/ai/sto-cases.md` "STO-3"(D1~D10), 결정 S-3(상태 = 브라우저가 받은 코드)·S-6(호스트 표기는 저장소가 맞춤)·S-8(메서드 대소문자 무시, CONNECT 보관).
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 설계 [추측]:
  - 새 `src/store/filter.ts`: `parseFilter(f)` → 검사·정규화한 조건, `matchesFilter(summary, f)` → 참/거짓(대시보드가 새 알림 하나만 볼 때 쓴다 — D10). `store.list(f)`도 같은 함수를 쓴다.
  - 조건(모두 AND, 빈 문자열·undefined는 조건 없음): `host`(문자열), `method`(문자열), `status`(정수 100~999), `after`(id보다 큰 것만, 0 이상 정수), `limit`(앞에서부터 최대 n개, 1 이상 정수). 잘못된 타입은 고정 문구 TypeError.
  - 호스트 맞추기(S-6): 입력과 기록의 `request.target.host`를 **같은 함수로** 정규화한다 — 소문자, 끝 점 제거, URL 규칙(IPv6 대괄호·표기, 국제화 도메인 → punycode, 숫자 IPv4 `2130706433` → `127.0.0.1`). 입력에 `:포트`가 있으면 포트도 비교(기본 포트 80·443도 그대로 비교 — URL 객체는 기본 포트를 지우므로 포트는 직접 읽는다). 이름이면 같은 호스트와 하위 도메인(`example.com` → `api.example.com`, `badexample.com`은 아님), IP면 정확히 같을 때만. target 없는 기록은 호스트 조건에 걸리지 않는다(D1). 해석할 수 없는 입력은 아무것도 걸리지 않는다(예외 없음 — 입력 중인 글자).
  - 상태: 요약의 `status`(목적지 응답 또는 프록시가 보낸 코드). 상태 없는 기록은 걸리지 않는다(D7).
  - 페이지(D9): 오프셋이 아니라 `after`(마지막으로 본 id) — 중간에 오래된 것이 빠져도 건너뜀·중복이 없다.
- 한 줄 보고: 목표 = 목록을 호스트·메서드·상태 코드로 거르고 id 기준으로 나눠 받기 / 범위 =
  - 새 `src/store/filter.ts`: `parseFilter()`, `matchesFilter()`, `normHost()`
  - `src/store/store.ts`: `list(filter)`가 `parseFilter`·`matchesFilter`·`after`·`limit`를 쓰게
  - 새 `test/sto/STO-3.test.ts`(새 동작), 회귀가 있으면 새 `test/sto/STO-3-regression.test.ts`
  - 새 `scripts/probe/sto3-filter-cost.mjs`(E147)
  - `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/STO-3.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 프록시가 기록을 만들 때 호스트 표기 바꾸기(X3, 범위 밖), 상태 범위(5xx) 같은 고급 조건, 프록시 연결
- 예상 [추측] (판정 기준 포함):
  - E145: 새 동작 테스트는 stub(빈 함수만 export한 `src/store/filter.ts` — `parseFilter`는 받은 것을 그대로, `matchesFilter`는 항상 true)과 지금 store(필터 무시)에서 모두 assertion 실패, 오류 0(O2). 판정: 실패 수 = 테스트 수, 오류 0.
  - E146: 구현 뒤 `npm test` 실패 0, "큰 단위 대기(todo) STO: 2개". 판정: 둘 다.
  - E147 [탐색]: 기록 10,000건에서 `list({ host })`·`list({ method, status })` 한 번에 걸리는 시간과, 알림 하나에 `matchesFilter` 한 번 걸리는 시간을 기록한다.
- 실측 (명령 원문):
  - E145 일치(160360f): stub으로 `npm run test:red -- test/sto/STO-3.test.ts` → 14개 모두 assertion 실패, 오류 0.
  - E146 일치(9b7c366): `npm test` → tests 636 / pass 634 / fail 0 / todo 2, "큰 단위 대기(todo) STO: 2개, 그중 실패 2개".
  - E147 [탐색] 기록(9b7c366): `node scripts/probe/sto3-filter-cost.mjs` → 10,000건에서 list() 2.33ms, host 11.23ms, method·status 2.21ms, limit 50 0.36ms, matchesFilter 0.00ms.
- 구현 중 결정: 상태 조건에 **0을 허용**(100~999와 함께). 이유 — 테스트 D7이 `status: 0` 조건을 예외 없이 쓰고, 기록에 0이 실제로 나올 수 있다(sto-cases D7). 테스트는 바꾸지 않았다. STO 보고서 결정 항목에 올린다.
- 실제 클라이언트 실측(O31): STO-4에서.
- 내 실수 기록: filter.ts 커밋(019f78e)의 "검증"에 "작업 트리에서 두 파일 함께 43 / 43"을 덧붙였다 — 중간 커밋에는 그 시점에 실행한 것만 적는다(O1). 이력 재작성 없이 남긴다.
- 계획과 달라진 점: filter.ts에 `matchesParsed`(list가 조건을 한 번만 검사하려고)와 `Filter`·`ParsedFilter` 타입을 export. 회귀 파일 없음.
- 범위 밖 관찰: 없음.
- [STO-3] 완료: d0ec57c..42c8892, 병합 f1ccf68. `node scripts/check-method.mjs --id STO-3`(f1ccf68) → 11개 모두 ✅. 다음: STO-4.

### [STO-4] 계획
- 근거: 사례 배정 `docs/ai/sto-cases.md` "STO-4"(B2, B3, B7, F1, F2, F3), 결정 S-7(저장소 하나에 프록시 하나). STO-T의 대기 파일 `src/store/attach.ts`를 이 단위가 만든다.
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 설계 [추측]:
  - 새 `src/store/attach.ts`: `attachStore(store)` → `{ onFlowStart, onFlow }`(startProxy 옵션에 그대로 펼친다 — 둘을 함께 주므로 하나만 걸리는 일이 없다, B2). 같은 저장소에 두 번 부르면 고정 문구 오류(S-7·B3·F2).
  - 프록시 close 뒤에 도착하는 기록(진행 중이던 요청의 `aborted`, B7·F1)은 **보통 기록처럼 저장**한다. 실제로 있었던 요청이기 때문이다. 저장소는 close를 알 필요가 없다.
  - `src/index.ts`: 저장소를 만들고 `attachStore`로 프록시에 연결한다. 요약 줄 출력은 그대로(기록이 오면 요약 줄을 먼저 찍고 저장). 종료(Ctrl+C) 때 저장소를 출력·저장하지 않는다(F3). 저장소는 아직 바깥에서 볼 수 없다(UI 단계에서 대시보드가 쓴다).
  - X5(unhandledRejection 처리 없음)는 저장소가 구독자 reject를 받아 주므로(STO-1 C3) 이 단위에서는 바꾸지 않는다 — 범위 밖 그대로.
- 한 줄 보고: 목표 = 저장소를 프록시와 실행 진입점에 연결해 STO 큰 단위 흐름을 완성 / 범위 =
  - 새 `src/store/attach.ts`: `attachStore()`
  - `src/index.ts`: `createStore()` + `attachStore()`로 `startProxy` 옵션 구성(요약 줄은 그대로)
  - 새 `test/sto/STO-4.test.ts`(새 동작: 두 콜백, 두 번 연결 거부, 실제 프록시로 시작 → 완료, close 뒤 도착 기록), 새 `test/sto/STO-4-regression.test.ts`(진입점: 시작 줄 + 요약 줄만, 쿠키·본문 표식 없음 — 구현 전에도 통과해야 정상, O9)
  - 새 `scripts/probe/sto4-cli.mjs`(E150 실제 curl 실측)
  - `docs/ai/purpose-tree.md`, `docs/ai/map.md`, `docs/for-me/STO-4.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 대시보드·저장소를 바깥에 보이기, 프록시·TLS 코드 변경, index.ts의 unhandledRejection(X5)
- 예상 [추측] (판정 기준 포함):
  - E148: 새 동작 테스트는 stub(빈 함수만 export한 `src/store/attach.ts` — 아무것도 하지 않는 두 콜백, 두 번 불러도 오류 없음)에서 모두 assertion 실패, 오류 0(O2). 회귀 테스트는 구현 전에도 모두 통과. 판정: 새 동작 실패 수 = 테스트 수·오류 0, 회귀 실패 0.
  - E149: 구현 뒤 `npm test` 실패 0, **대기 0**(STO-T가 실제로 돌아 2개 통과). 판정: 실패 0이고 "큰 단위 대기(todo) STO" 줄이 없거나 0개면 일치.
  - E150 실측(O31): `npm start -- --port <빈 포트>`를 띄우고 실제 curl로 평문 요청 2개(목적지 200, 닫힌 포트 502)를 보내면, 출력은 시작 줄 1개 + 요약 줄 2개이고 쿠키·본문 표식이 없다. 판정: 줄 수와 표식 없음이 둘 다면 일치(`node scripts/probe/sto4-cli.mjs`).
- 실측 (명령 원문):
  - E148 일치(f501b21): stub으로 `npm run test:red -- test/sto/STO-4.test.ts` → 4개 모두 assertion 실패, 오류 0. `npm test -- test/sto/STO-4-regression.test.ts` → 1 / 1. 첫 실행은 끝나지 않았다(B7이 stub에서 실패하면 finally가 프록시를 닫지 않음) → 실행을 멈추고 내가 띄운 node 프로세스 4개(PID 8216·8392·1536·14908)를 종료한 뒤 테스트를 고쳤다(커밋 메시지).
  - E149 일치(9534583): `npm test` → tests 641 / pass 641 / fail 0 / todo 0, 종료 코드 0, "큰 단위 대기" 줄 없음 — STO-T 2개가 실제로 통과.
  - E150 일치(9534583): `node scripts/probe/sto4-cli.mjs` → curl 200·502, 출력 3줄(시작 줄 + 요약 2줄), 표식 stdout·stderr 모두 false, stderr 0자.
- 계획과 달라진 점: 없음. 회귀 파일 `test/sto/STO-4-regression.test.ts`는 계획대로.
- 범위 밖 관찰: 없음.
- [STO-4] 완료: e77db13..da8a94e, 병합 86342b9. `node scripts/check-method.mjs --id STO-4`(86342b9) → 11개 모두 ✅. (이 줄은 STO 감사의 "고칠 것"으로 [AUDIT-7]에서 더함)
### [STO] 큰 단위 마무리
- 1. `npm test` 전체(86342b9): tests 641 / pass 641 / fail 0 / todo 0 [확인됨].
- 2. 감사(method-auditor, 입력은 노드 ID "STO"만): 하위 노드 5개 모두 ✅, big-unit-report·review ❌는 감사가 보고서보다 먼저라 정상. 경미 4건(진행 기록 정리, STO-1 범위 문구, 019f78e 검증 문구, 병합 뒤 기록 자리) → `docs/method-feedback.md` [STO] 절. 기록 정리 3건은 [AUDIT-7]에서 고침.
- 3. 검토 에이전트(새 컨텍스트, 입력 = purpose-tree.md·src·test·package.json만, 금지 = progress·for-me·method-feedback·사례 문서·map·커밋 메시지): 일치 16, 불일치·위험 12(중간 R1~R4, 낮음 R5~R12), 목표 위반 없음. 스크립트 `scripts/probe/sto-final-review/`(이 기록 커밋에 함께). R1·R2·R3은 내가 다시 실행해 같은 결과 [확인됨: r4 74→423ms·동시 5개 2024ms, r3 7번·10번].
- 4. 중간 확인 보고서 `docs/for-me/STO-report.md`: 결정 항목 15개(A 위험 1~4, B 낮은 위험 5~8, C 추천 진행 승인 9~13, D 다음 순서 14~15). **사용자 답 대기.**
- 5. `node scripts/check-method.mjs --id STO`(080f5a3, 보고서 커밋 뒤) → sub-nodes ✅, big-unit-test ✅, big-unit-report ✅, big-unit-review ✅, big-unit-todo ✅.
- 6. 사용자 답(2026-11-08): **승인** — "모두 추천대로 다음 세션에서 진행할게". 보고서 머리, method-feedback.md 승인 상태(O47~O52), 목적 나무(STO-5 추가, STO는 STO-5 뒤 ✅)에 적음.

### [STO-5] 계획
- 근거: STO 보고서 결정 2(R2)·7(R7), 승인 2026-11-08. 재현: `node scripts/probe/sto-final-review/r3-order.mjs` 7번(R2).
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 사용자 결정(2026-11-08, 이 세션): 결정 2 ①을 글자 그대로("바이트로는 완료만") 구현하면 STO-2 테스트 "S-2: 진행 중도 바이트 상한에 들어간다"(`test/sto/STO-2.test.ts:79`)와 충돌한다. 질문 → 답 **"완료 먼저, 그다음 진행 중"**: 바이트 상한은 먼저 들어온 완료부터 빼고, 방금 넣은 것 말고 완료가 하나도 없는데도 넘칠 때만 진행 중을 뺀다. 테스트는 고치지 않는다. 근거 [확인됨: 코드] 본문은 쪽마다 1MiB(`src/flow/flow.ts:6`), 요청 헤더 전체 16KB(`src/proxy/server.ts:273`) → 완료 하나 약 2MiB 이하, 진행 중 1,000개 약 33MB 이하라 실제 256MiB 상한에서는 ①과 같게 동작한다 [추측: 계산]. 보고서 머리에도 적음.
- 설계 [추측]:
  - `src/store/store.ts` `enforce`: 바이트 단계를 `oldest(keep, 'done')` 먼저, 없으면 `oldest(keep, 'pending')`으로. 진행 중·건수 단계는 그대로.
  - `src/store/filter.ts` `parseFilter`: 자기 속성 이름(Object.keys)이 host·method·status·after·limit 밖이면 고정 문구 TypeError(`필터 조건 이름을 알 수 없습니다.` — 이름·값을 문구에 넣지 않는다, E2와 같은 규칙). 값이 undefined여도 오류(오타이므로). `matchesFilter`도 parseFilter를 거치므로 같이 바뀐다.
- 한 줄 보고: 목표 = 바이트 상한은 완료부터 빼고(R2), 모르는 필터 조건 이름은 오류로(R7) / 범위 =
  - `src/store/store.ts`: `enforce`(바이트 단계 순서)
  - `src/store/filter.ts`: `parseFilter`(조건 이름 검사)
  - 새 `test/sto/STO-5.test.ts`(새 동작: 완료가 진행 중보다 먼저 빠짐과 이벤트 순서, 남은 진행 중의 늦은 완료 저장, 모르는 조건 이름 TypeError — list·matchesFilter, 문구에 이름·값 없음), 새 `test/sto/STO-5-regression.test.ts`(아는 조건 다섯 개는 그대로 받음, 남길 완료가 없으면 바이트 상한이 진행 중을 뺌 — 구현 전에도 통과해야 정상, O9)
  - `docs/ai/purpose-tree.md`(STO-5 ✅, STO ✅ — 결정 14), `docs/ai/map.md`, `docs/for-me/STO-5.md`, `docs/for-me/STO-2.md`(실제 메모리 약 330MB — 결정 5), `docs/for-me/STO-report.md`(머리에 결정 2 방식), `docs/ai/progress.md`
  - 하지 않을 것 = R1(느린 구독자)·R3(진행 중 상세)·필터 기능 추가(상태 범위·부분 일치), 프록시·TLS 코드, STO-2 테스트 수정
- 예상 [추측] (판정 기준 포함):
  - E151: 구현 전(main 코드) `npm run test:red -- test/sto/STO-5.test.ts` → 새 동작 4개 모두 assertion 실패, 오류 0(모듈이 이미 있어 stub 없음). `npm test -- test/sto/STO-5-regression.test.ts` → 2 / 2 통과. 판정: 새 동작 실패 4·오류 0이고 회귀 실패 0이면 일치.
  - E152: 구현 뒤 `npm test`(전체) → 실패 0, 대기 0(테스트 수 647은 참고값). 판정: 실패 0이고 "큰 단위 대기" 줄이 없거나 0이면 일치.
  - E153 실측(O31): `node scripts/probe/sto4-cli.mjs`(실제 curl이 `npm start`를 거침) → curl 200·502, 출력 3줄, 표식 stdout·stderr false. 판정: 셋 다 STO-4 때(E150)와 같으면 일치.
  - E154: `node scripts/probe/sto-final-review/r3-order.mjs` 7번(상한 10,000바이트에 50,000바이트 완료 하나) → 남길 완료가 없으므로 이벤트는 그대로 `["start:1","done:2","evicted:1"]`. 판정: 이 배열과 같으면 일치.
- 실측 (명령 원문):
  - E151 일치(493ff2a 커밋 전, 코드 eaa95c5): `npm run test:red -- test/sto/STO-5.test.ts` → tests 4 / fail 4, 모두 AssertionError(R2 둘은 deepEqual, R7 둘은 Missing expected exception), 오류 0. `npm test -- test/sto/STO-5-regression.test.ts` → 2 / 2.
  - E152 일치(994bc01): `npm test` → tests 647 / pass 647 / fail 0 / todo 0, "큰 단위 대기" 줄 없음.
  - E153 일치(994bc01): `node scripts/probe/sto4-cli.mjs` → curl 200·502, 출력 3줄(시작 줄 + 요약 2줄), 표식 stdout·stderr false, stderr 0자.
  - E154 일치(994bc01): `node scripts/probe/sto-final-review/r3-order.mjs` 7번 → 이벤트 `["start:1","done:2","evicted:1"]`, 목록 `["2:done"]`.
- 계획과 달라진 점: 없음. 테스트 기대값은 처음 쓴 그대로. 사용자 문서 `docs/for-me/STO-2.md`도 고침(계획 범위에 적은 대로 — 빼는 순서 ③과 실제 메모리 약 330MB).
- 범위 밖 관찰: 없음.
- [STO-5] 완료: eaa95c5..9b28a8a, 병합 4b2d4ec. `node scripts/check-method.mjs --id STO-5`(4b2d4ec) → 11개 모두 ✅. `node scripts/check-method.mjs --id STO`(4b2d4ec) → sub-nodes ✅(하위 6개), big-unit-test·report·review·todo ✅. 이 줄은 [AUDIT-10]으로 커밋(O50 반영 전이라 지금까지의 큰 단위 기록 방식).

### [INFRA-11] 계획
- 근거: STO 보고서 결정 13(O47~O52 승인), 결정 14(STO ✅ 뒤 INFRA). 사용자 지시(2026-11-08) "이어서 해".
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 사용자 결정(2026-11-08, 이 세션 — `docs/ai/infra11-cases.md` D1~D6): O47 장치 = Claude hook(실행 전 guard.mjs + 실행 뒤 새 hook), O49 = "실행함, n개 실패(다음 커밋 필요)" 허용(INFRA-12에서 반영), 단위 나눔(O47만 INFRA-11, O48~O52는 INFRA-12), 기존 hook 테스트 6개와의 충돌은 **켜는 표시 파일** `.claude/commit-rule.json`으로(테스트 수정 없음).
- O10: hook(차단 규칙)을 바꾸므로 검토 에이전트(새 컨텍스트, 해결안 알려 주지 않음)에게 우회 사례를 먼저 받았다 → 우회 78개·오탐 24개·결정 질문 11개. 배정과 기본 답은 `docs/ai/infra11-cases.md`.
- 설계 [추측]:
  - 새 `scripts/commit-msg.mjs`: `messageProblems(textOrBuffer)` → 문제 문구 배열(빈 배열 = 통과). 실행 전·실행 뒤 hook이 같은 함수를 쓴다. check-method의 message-format 규칙은 바꾸지 않는다(옛 커밋 판정이 바뀌지 않게).
  - `.claude/hooks/guard.mjs`: Bash·PowerShell 명령이면 ① 표시 파일이 있을 때 `.claude/state/commit-check.json`에 지금 HEAD·시각을 기록(실행 뒤 검사의 기준) ② 명령을 `;` `&&` `||` `|` `&` 줄바꿈으로 나눈 조각마다 `git … commit`이면 모양 검사(D2) → `-F` 파일을 읽어 `messageProblems`. 원문 `cmd`로 본다(stripData는 메시지를 지우므로 — 에이전트 지적).
  - 새 `.claude/hooks/commit-check.mjs`(PostToolUse, Bash|PowerShell): 기록 뒤 새로 생긴 병합 아닌 커밋(`git rev-list --no-merges <기록 HEAD>..HEAD`, 커밋 시각 ≥ 기록 시각)의 `%B`를 검사, 틀리면 `decision: block`과 이유(해시, 문제, "멈추고 사용자에게 보고").
  - `.claude/settings.json`: PostToolUse에 commit-check.mjs 추가. 새 `.claude/commit-rule.json`(표시 파일). `CLAUDE.md` 커밋 메시지 절에 "hook이 `git commit -F <절대 경로>` 모양과 형식을 검사한다" 한 줄. settings·CLAUDE.md는 구현의 일부라 [RULE] 커밋이 아니라 구현 커밋에 둔다(INFRA-10과 같음 — hook 파일보다 먼저 등록하면 없는 파일을 부른다).
- 한 줄 보고: 목표 = 커밋 메시지 형식을 커밋 순간에 기계로 검사(O47) / 범위 =
  - 새 `scripts/commit-msg.mjs`: `messageProblems()`
  - `.claude/hooks/guard.mjs`: 규칙 C(커밋 모양·메시지 파일 검사, 실행 전 HEAD 기록)
  - 새 `.claude/hooks/commit-check.mjs`: 실행 뒤 새 커밋 검사
  - `.claude/settings.json`(PostToolUse 항목), 새 `.claude/commit-rule.json`, `CLAUDE.md`(커밋 메시지 절 한 줄)
  - 새 `test/infra/_commit-fixture.mjs`(도우미), 새 `test/infra/commit-msg.test.mjs`(새 동작), 새 `test/infra/commit-msg-regression.test.mjs`(구현 전에도 통과해야 정상 — 맞는 메시지·허용 명령, O9)
  - `docs/ai/infra11-cases.md`, `docs/method-feedback.md`(승인 표의 반영 위치), `docs/for-me/INFRA-11.md`, `docs/ai/map.md`, `docs/ai/progress.md`
  - 하지 않을 것 = O48~O52(INFRA-12), check-method 규칙 변경, 과거 커밋 재작성, `.git/` 쓰기 검사(L3), git 설정 변경
- 예상 [추측] (판정 기준 포함):
  - E155: stub(`scripts/commit-msg.mjs`는 빈 배열, `commit-check.mjs`는 아무것도 출력하지 않음, guard는 그대로, 표시 파일 없음)에서 `npm run test:red -- test/infra/commit-msg.test.mjs` → 새 동작 테스트가 모두 assertion 실패, 오류 0. `npm test -- test/infra/commit-msg-regression.test.mjs` → 모두 통과. 판정: 실패 수 = 새 동작 테스트 수·오류 0, 회귀 실패 0.
  - E156: 구현 뒤 `npm test`(전체) → 실패 0, 대기 0. 기존 hook 테스트(hooks-data-gt, hooks-normal-regression 포함)도 그대로 통과. 판정: 둘 다.
  - E157 실측(O31, 실제 클라이언트 = 이 세션의 실제 도구 호출, 구현 커밋 뒤 작업 트리의 hook): Bash `git commit --allow-empty --dry-run -m "x"` → hook이 막는다(막지 못해도 dry-run이라 커밋이 생기지 않음). PowerShell `git commit --dry-run -F $env:TEMP\x.txt` → 막는다. 판정: 둘 다 막히면 일치.
  - E158 실측: 이 PR의 구현 커밋 뒤 커밋들(`git commit -q -F "<절대 경로>"`)은 막히지 않고, 실행 뒤 검사도 아무것도 알리지 않는다. 판정: 문서 커밋이 막힘 없이 되고 hook 알림이 없으면 일치.
- 멈춤(2026-11-08, guard.mjs 구현 중):
  - hook 멈춤 [확인됨: hook 출력]: `test/infra/commit-msg.test.mjs`의 실행 뒤 5개 + 이 저장소 설정 1개가 3회 연속 실패 → 멈춤. 세 번 = red 확인, commit-msg.mjs 뒤, guard.mjs 뒤. 이 6개는 아직 만들지 않은 commit-check.mjs·settings.json·표시 파일의 몫이라 실패가 예상대로였다. **의도한 보수적 동작**(멈춤 장치는 "예상된 실패"를 구별하지 않는다). 방식 관찰 후보: 파일 하나씩 커밋하면서 같은 새 테스트 파일을 커밋마다 돌리면 멈춤에 걸린다 → 중간 커밋 검증은 그 커밋이 다루는 테스트만(`--test-name-pattern`) 돌리거나, 멈춤 셈이 "다음 커밋 필요" 실패를 어떻게 다룰지 정해야 한다.
  - 내 실수 [확인됨: `git show --stat HEAD`]: 멈춤 때문에 메시지 파일 Write가 막혔는데, 같은 응답에 보낸 `git add .claude/hooks/guard.mjs && git commit -q -F ".../tmp/msg10.txt"`가 실행됐다. 작업 임시 폴더에 지난 세션(2026-11-07 18:29)의 `msg10.txt`(PRX-2b 실측 커밋 메시지)가 남아 있어서, **guard.mjs 변경이 `[PRX-2b] 실측 스크립트: …` 메시지로 커밋됨 → 5e7b491**(feat/INFRA-11, 병합 전). 원인: Write 결과를 기다리지 않고 커밋을 함께 보냄 + 임시 파일 이름을 세션마다 다시 씀. 규칙 C도 못 잡는다(그 메시지는 형식이 맞음).
  - 사용자 답(선택 창): "되돌리고 다시 커밋". 그러나 멈춤은 풀리지 않았다 — 메시지 파일 Write가 다시 막힘 [확인됨: hook 출력]. 선택 창의 답은 UserPromptSubmit을 일으키지 않는 것으로 보인다 [추측]. 이번에는 Write 결과를 본 뒤라 커밋을 보내지 않았다. 사용자가 채팅으로 답해야 풀린다.
  - 제안(사용자 확인됨, 멈춤이 풀리면 실행): 5e7b491을 `git reset --soft HEAD~1`로 되돌리고(변경은 스테이지에 남음) 올바른 `[INFRA-11] guard.mjs: …` 메시지로 다시 커밋. 앞으로 임시 메시지 파일 이름에 노드 ID를 넣고(예: `infra11-guard.txt`), Write 결과를 본 뒤에 커밋한다.
  - 재개(사용자 채팅 "다 끝난건가" → hook "연속 실패 카운터를 초기화"): `git reset --soft HEAD~1` → `git commit -q -F ".../infra11-guard.txt"` → 5b1e4a5 [확인됨: git log]. 5e7b491은 어느 브랜치에도 없다.
- 실측 (명령 원문):
  - E155 일치(33ecc6b 커밋 전, stub): `npm run test:red -- test/infra/commit-msg.test.mjs` → tests 24 / fail 24, 모두 AssertionError, 오류 0(처음엔 기록 파일 테스트 1개가 ENOENT 오류 → 읽기 전 assert.ok(existsSync)를 넣음, 기대값은 그대로 — 테스트 커밋에 적음, O48). `npm test -- test/infra/commit-msg-regression.test.mjs` → 3 / 3.
  - E156 일치(b045e7e): `npm test` → tests 674 / pass 674 / fail 0 / todo 0. 기존 hook 테스트(hooks-data-gt, hooks-normal-regression 포함) 그대로 통과.
  - E157 일치(b045e7e, 작업 트리 hook): Bash `git commit --allow-empty --dry-run -m "x"` → PreToolUse가 규칙 C 문구로 막음. PowerShell `git commit --dry-run -F $env:TEMP\x.txt` → 막음.
  - E158 일치: b045e7e 뒤 커밋들(3034e5a, d41b381, 4a120b7, 이 문서 커밋)은 `git commit -q -F "<절대 경로>"`로 막힘 없이 됐고 실행 뒤 알림 없음. `.claude/state/commit-check.json`에 커밋 직전 HEAD가 남음(b045e7e 커밋 직후 `{"head":"f7c06fa…"}`).
  - 계획 밖 실측: `node scripts/probe/infra11-post.mjs` → "만든 커밋: 28b8a26 (probe/infra11-post)", 바로 PostToolUse 알림 "규칙 C(INFRA-11): 방금 형식이 틀린 커밋이 생겼습니다 → 28b8a26: …"(세션 도중 바꾼 settings.json이 실제로 적용됨). `node scripts/probe/infra11-post.mjs cleanup` → "돌아감: feat/INFRA-11, 지움: probe/infra11-post". 알림이 "멈추고 보고"를 요구했지만, 사용자에게 미리 설명한 의도한 실측이라 계획대로 정리했다.
- 계획과 달라진 점:
  - `docs/ai/map.md`는 고치지 않았다 — 앱 모듈 지도라 hook 항목이 없다(INFRA-10도 고치지 않음).
  - 실측 스크립트 `scripts/probe/infra11-post.mjs`를 더했다(3034e5a).
  - b045e7e에서 승인 전 관찰(메시지 파일 이름 규칙, O54)을 CLAUDE.md에 넣었다가 O23 위반이라 뺐다(d41b381). 그때 줄바꿈 하나를 잘못 지워 4a120b7에서 되살렸다(d41b381 메시지의 "한 줄 삭제"는 실제 diff와 달랐다).
  - 새 방식 관찰 O53(예상된 실패가 멈춤에 걸림, 선택 창 답으로는 안 풀림)·O54(공유 임시 폴더의 옛 메시지 파일) → `docs/method-feedback.md`, INFRA-12 계획 때 여쭙는다.
- 범위 밖 관찰: 없음.
- [INFRA-11] 완료: 757f27b..33d843a, 병합 b5eba10. `node scripts/check-method.mjs --id INFRA-11`(b5eba10) → 10개 ✅, tree-updated ➖(INFRA). `node scripts/check-method.mjs --id PRX-2b | grep -c 5e7b491` → 0(지운 커밋이 섞이지 않음). 이 줄은 [AUDIT-11]로 커밋(O50 반영 전).

### [INFRA-12] 계획
- 근거: STO 보고서 결정 13(O48~O52 승인), INFRA-11 사용자 결정 D5(O48~O52는 INFRA-12). 사용자 지시(2026-11-08) "이어서 해".
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 사용자 결정(2026-11-08, 이 세션): **O53** = 지침으로(같은 새 테스트 파일을 "다음 커밋 필요" 상태로 돌리는 것은 두 번까지, 그 뒤 남은 구현은 한 커밋에 묶음, 멈추면 채팅 답이 필요). **O54** = 지침(메시지 파일 이름에 노드 ID, Write 결과 확인 뒤 커밋) + 기계 검사는 **INFRA-13**(feat/<ID> 브랜치에서 커밋 제목 ID가 브랜치와 같은지 — hook이라 검토 사례 먼저, O10). 승인 상태는 method-feedback.md에 적는다.
- O10: 차단 규칙(hook·권한·인증서)을 바꾸지 않는다 — check-method는 판정 도구이고 지침은 문장이다(INFRA-10과 같음).
- 설계 [추측]:
  - O50 `scripts/check-method.mjs`: 새 규칙 `merge-record`(작은 단위). 입력 `mergeRecord = { applies, merged, recorded }`. 규칙 도입 전 → ➖ "규칙 도입 전", 병합 전 → ➖ "병합 전", 기록 있음 → ✅, 병합했는데 기록 없음 → ➖ "기록 대기"(검사는 보통 병합 직후·기록 전에 돌리므로 ❌로 하지 않는다) + 표시 `pending: true`. 새 큰 단위 규칙 `merge-records`: 하위 노드 중 `pending`이 있으면 ❌. 기록 = 제목이 `[ID] 병합 뒤 기록`으로 시작하는 커밋, 병합 = 제목이 `[ID] 병합`으로 시작하는 병합 커밋. 상수 `MERGE_RECORD_SINCE` = 이 계획 커밋(그 전 작업은 ➖).
  - CLAUDE.md: O48(O36 보강 — 커밋 전 stub red 결과에 맞추려고, 또는 실행이 끝나지 않아 테스트 구조를 고쳤으면 고친 내용과 기대값 변경 여부를 테스트 커밋에), O49(중간 커밋 검증에 "실행함, 예상대로 n개 실패(다음 커밋 필요)" 허용), O50(병합 뒤 기록 커밋 `[ID] 병합 뒤 기록: …` — check-method 결과), O51(판정 기준 예시에 측정 시점), O52(큰 단위 마무리 보고서 실행 증거에 -T 흐름의 경로마다 실제 클라이언트 실측), O53, O54(지침 부분).
  - `.claude/agents/method-auditor.md`: merge-record ➖ "기록 대기"·merge-records 판정, O52 실행 증거 확인.
- 한 줄 보고: 목표 = 승인된 O48~O52와 새로 결정한 O53·O54(지침 부분)를 지침과 기계 검사에 반영 / 범위 =
  - `scripts/check-method.mjs`: `checkCommits()` 규칙 `merge-record`(새 인자 `mergeRecord`), `checkBigUnit()` 규칙 `merge-records`, 상수 `MERGE_RECORD_SINCE`, CLI의 병합·기록 커밋 읽기
  - 새 `test/infra/check-method-infra12.test.mjs`(새 동작), 새 `test/infra/check-method-infra12-regression.test.mjs`(구현 전에도 통과해야 정상 — 기존 규칙 결과가 그대로)
  - `CLAUDE.md`(개발 방식 절·큰 단위 절), `.claude/agents/method-auditor.md`
  - `docs/method-feedback.md`(승인 표: O48~O52 반영 위치, O53·O54 승인 상태), `docs/for-me/INFRA-12.md`, `docs/ai/progress.md`
  - 하지 않을 것 = O54 기계 검사(INFRA-13), 멈춤 장치 변경(O53 결정), 과거 커밋 재작성, message-format 규칙 변경
- 예상 [추측] (판정 기준 포함):
  - E159: 구현 전(이 계획 커밋의 코드) `npm run test:red -- test/infra/check-method-infra12.test.mjs` → 새 동작 테스트가 모두 assertion 실패, 오류 0(stub 없음 — 기존 모듈, 새 규칙이 결과에 없으면 assert.ok로 잡는다). `npm test -- test/infra/check-method-infra12-regression.test.mjs` → 모두 통과. 판정: 실패 수 = 새 동작 테스트 수·오류 0, 회귀 실패 0.
  - E160: 구현 뒤 `npm test`(전체) → 실패 0, 대기 0. 판정: 둘 다.
  - E161: 구현 뒤 `node scripts/check-method.mjs --id STO-5` → merge-record ➖ "규칙 도입 전", 나머지 11개 ✅. `--id STO` → merge-records ✅. 판정: 셋 다 이와 같으면 일치.
  - E162: INFRA-12 병합 직후 `--id INFRA-12` → merge-record ➖ "기록 대기", `[INFRA-12] 병합 뒤 기록` 커밋 뒤 → ✅. 판정: 둘 다 이와 같으면 일치.
- 실측 (명령 원문):
  - E159 일치(ba911c9 커밋 전, 코드 c7c0522): `npm run test:red -- test/infra/check-method-infra12.test.mjs` → tests 7 / fail 7, 모두 AssertionError, 오류 0. `npm test -- test/infra/check-method-infra12-regression.test.mjs` → 3 / 3.
  - E160 일치(2eba73a): `npm test` → tests 684 / pass 684 / fail 0 / todo 0.
  - E161 일치(2eba73a): `node scripts/check-method.mjs --id STO-5` → 기존 11개 ✅, merge-record ➖ "규칙 도입 전 작업이라 건너뜀(도입 커밋 c7c0522)". `--id STO` → merge-records ✅ "병합 뒤 기록이 빠진 하위 노드 없음".
  - E162 앞 절반 일치(1838f29, 병합 직후): `node scripts/check-method.mjs --id INFRA-12` → merge-record ➖ "기록 대기 — 이 결과를 `[INFRA-12] 병합 뒤 기록: …` 커밋으로 진행 기록에 남긴다(O50)". 뒤 절반(기록 커밋 뒤 ✅)은 이 커밋 자체를 만든 뒤에야 잴 수 있어 여기 적을 수 없다(O4와 같은 자기 참조) — 결과는 다음 계획 커밋(INFRA-13)의 진행 기록에 적는다.
- [INFRA-12] 완료: c7c0522..(문서 커밋), 병합 1838f29. `node scripts/check-method.mjs --id INFRA-12`(1838f29) → 10개 ✅, tree-updated ➖, predictions-measured ❌(E162를 아직 적지 않음 — 이 기록 커밋에서 적음), merge-record ➖ 기록 대기. 이 줄이 첫 `[ID] 병합 뒤 기록` 커밋이다(O50).
- 계획과 달라진 점: 없음. 구현 첫 실행에서 문구 차이로 2개 실패 → 구현 문구를 고침(b89a49d 메시지). CLAUDE.md 편집에서 O50 항목을 원래 줄 중간에 끼운 것을 커밋 전에 diff로 찾아 고침(2eba73a 메시지).
- 범위 밖 관찰: 없음.

### [INFRA-13] 계획
- 근거: INFRA-12 사용자 결정(O54 = 지침 + 기계 검사, 기계 검사는 INFRA-13). 사용자 지시(2026-11-08) "이어서 해", 사례를 받은 뒤 "끝나면 추천대로 진행해".
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 이월(INFRA-12 E162 뒤 절반): 5b2791f 뒤 `node scripts/check-method.mjs --id INFRA-12` → merge-record ✅ "`[INFRA-12] 병합 뒤 기록` 커밋 있음", 11개 ✅·tree-updated ➖ [확인됨: 이 세션에서 다시 실행] → **일치**.
- 세션 시작 점검: `npm test` → tests 684 / pass 684 / fail 0 / todo 0 [확인됨].
- O10: hook(차단 규칙)을 바꾼다 → 별도 컨텍스트 검토 에이전트의 우회 31·오탐 13·결정 질문 11을 먼저 받았다(해결안은 알려 주지 않음) → `docs/ai/infra13-cases.md`. 결정은 추천대로, Q11만 다름(같은 파일의 `"branch": true` 키로 켬 — INFRA-11 테스트가 main에서 `[X-1]`로 커밋하기 때문, 이유는 사례 문서).
- 설계 [추측]:
  - `scripts/commit-msg.mjs`: 새 순수 함수 `branchProblems({ branch, title, unlocked })` → 문제 문구 배열(branch = 브랜치 이름, detached면 null), `mergeProblems({ branch, target, title })`. 규칙은 사례 문서 Q1~Q5.
  - `.claude/hooks/guard.mjs`: 규칙 D(표시 파일에 `"branch": true`일 때). `commitProblem()`에서 메시지 파일 첫 줄을 `branchProblems`로, `git merge`는 `mergeProblems`로. 같은 명령 안 위치·브랜치·환경 바꾸기(Q6), `-C`·hook 입력 `cwd`(Q7). `recordHead()`가 브랜치와 HEAD reflog 개수도 기록.
  - `.claude/hooks/commit-check.mjs`: 새 reflog 항목으로 명령 중 생긴 커밋을 찾고 Q8대로 알림.
  - `.claude/commit-rule.json`에 `"branch": true`, CLAUDE.md 커밋 메시지 절에 규칙 D 한 줄(접미사 브랜치 대신 새 노드 ID).
- 한 줄 보고: 목표 = O54 기계 검사(커밋 제목 ID가 브랜치에 맞는지 실행 전·뒤에 본다) / 범위 =
  - `scripts/commit-msg.mjs`: 새 `branchProblems()`, `mergeProblems()`
  - `.claude/hooks/guard.mjs`: `commitProblem()`에 규칙 D, `recordHead()`에 브랜치·reflog 개수
  - `.claude/hooks/commit-check.mjs`: `main()`에 reflog 기반 규칙 D 검사
  - `.claude/commit-rule.json`(`"branch": true`), `CLAUDE.md`(커밋 메시지 절)
  - 새 `test/infra/_branch-fixture.mjs`(도우미 — 브랜치·cwd·허용 상태를 다루는 hook 실행), 새 `test/infra/commit-branch.test.mjs`(새 동작), 새 `test/infra/commit-branch-regression.test.mjs`(구현 전에도 통과해야 정상 — 키 없으면 꺼짐, 맞는 커밋·probe 브랜치 허용, O9)
  - `docs/ai/infra13-cases.md`, `docs/method-feedback.md`(O54 반영 위치), `docs/for-me/INFRA-13.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 실행 뒤 병합 커밋 검사(L10), `.git/` 쓰기 검사(L3), 메시지 내용이 옛것인지 판정(L6), 규칙 C 형식 변경, 과거 커밋 재작성, check-method 변경
- 예상 [추측] (판정 기준 포함):
  - E163: stub(`branchProblems`·`mergeProblems`는 빈 배열, guard·commit-check는 그대로, 표시 파일 키 없음)에서 `npm run test:red -- test/infra/commit-branch.test.mjs` → 새 동작 테스트가 모두 assertion 실패, 오류 0. `npm test -- test/infra/commit-branch-regression.test.mjs` → 모두 통과. 판정: 실패 수 = 새 동작 테스트 수·오류 0, 회귀 실패 0.
  - E164: 구현 뒤 `npm test`(전체) → 실패 0, 대기 0. 기존 commit-msg·hooks 테스트 그대로 통과. 판정: 둘 다.
  - E165 실측(O31, 실제 클라이언트 = 이 세션의 실제 도구 호출, 설정 커밋 뒤 작업 트리의 hook, 브랜치 feat/INFRA-13): Bash `git commit -q --allow-empty -F "<제목 [PRX-2b]인 형식 맞는 파일>"` → 규칙 D 문구로 막힘. Bash `git checkout feat/INFRA-13 && git commit -q --allow-empty -F "<제목 [INFRA-13]인 파일>"` → 막힘. PowerShell 같은 [PRX-2b] 파일 커밋 → 막힘. 판정: 셋 다 막히고(새 커밋 0개, `git log -1`이 그대로) 이유에 규칙 D가 나오면 일치.
  - E166 실측: 설정 커밋 뒤 이 PR의 커밋들(`git commit -q -F "<절대 경로>"`, 제목 `[INFRA-13]`)은 막히지 않고 실행 뒤 알림도 없다. 판정: 문서 커밋까지 막힘·알림 없이 되면 일치.
- 실측 (명령 원문):
  - E163 일치(c663961 커밋 전, stub): `npm run test:red -- test/infra/commit-branch.test.mjs` → tests 16 / fail 16, AssertionError 16개, 오류 0. `npm test -- test/infra/commit-branch-regression.test.mjs` → 3 / 3.
  - E165 일치(5b78a70 뒤 작업 트리 hook, 브랜치 feat/INFRA-13): Bash `git commit -q --allow-empty -F "C:/Users/wooni/.claude/jobs/56352ded/tmp/infra13-e165-prx2b.txt"`(제목 `[PRX-2b] …`, 형식은 맞음) → "지금 브랜치 feat/INFRA-13의 커밋 제목은 [INFRA-13](또는 [RULE])로 시작해야 합니다(규칙 D, INFRA-13)…"로 막힘. Bash `git checkout feat/INFRA-13 && git commit -q --allow-empty -F ".../infra13-e165-own.txt"` → "커밋·병합과 같은 명령 안에서 브랜치·작업 위치·환경 변수를 바꿀 수 없습니다(규칙 D…)"로 막힘. PowerShell 같은 [PRX-2b] 파일 → 막힘. `git log --oneline -1` → f451a95 그대로(새 커밋 0개).
  - E166 일치: 5b78a70(규칙 D를 켠 커밋 자체)·f451a95·f4fc4dc·1f3efaf·이 문서 커밋이 `git commit -q -F "<절대 경로>"`로 막힘·알림 없이 됐다.
  - E164 일치(1f3efaf): `npm test` → tests 703 / pass 703 / fail 0 / todo 0.
- 멈춤(2026-11-08, 구현 뒤 첫 실행):
  - 실행: `npm test -- test/infra/commit-branch.test.mjs test/infra/commit-branch-regression.test.mjs test/infra/commit-msg.test.mjs test/infra/commit-msg-regression.test.mjs` → tests 46 / pass 45 / fail 1. 실패 = "실행 뒤: 명령 안에서 다른 브랜치로 가서 커밋하고 돌아와도(HEAD가 그대로여도) 알린다(사례 1, 24)" — AssertionError "알림이 있어야 함", actual null.
  - 원인 [확인됨: `node scripts/probe/infra13-reflog.mjs`, KEEP=1로 남긴 저장소의 `git show --stat`]: **테스트 구조 문제**. 도우미 `test/infra/_commit-fixture.mjs`의 `fx.commit`이 `git add -A`로 추적되지 않던 `.claude/commit-rule.json`·`.claude/state/commit-check.json`을 feat/PRX-2b 쪽 커밋에 넣는다 → 원래 브랜치로 돌아오는 checkout이 두 파일을 작업 트리에서 지운다 → 표시 파일이 없으니 commit-check.mjs는 꺼진 것으로 보고 아무것도 하지 않는다(이것은 맞는 동작). 실제 저장소에서는 `.claude/`가 추적되어 있어 생기지 않는다. reflog와 기록은 기대대로였다(rec.reflog 2 → 5줄, checkout·commit·checkout).
  - 이 테스트는 연속 실패 2회(INFRA-13 구현 커밋 8954220 시점 1회 + 이번 1회). 다시 돌리면 멈춤 장치가 켜진다(O53). 테스트 파일은 커밋되어 있어 고치려면 사용자의 "테스트 수정 허용"이 필요하다.
  - 제안(사용자 결정 대기): `test/infra/_branch-fixture.mjs`의 `makeBranchRepo`가 `.claude/state/`를 `.git/info/exclude`에 넣고 `.claude/commit-rule.json`을 시작 커밋에 넣는다(모든 브랜치에 표시 파일이 있게). 기대값은 바꾸지 않는다. 고친 뒤 고친 테스트가 구현 전 코드(c663961의 hook)에서 여전히 실패하는지 확인한다(O44).
  - 재개: 사용자 채팅 "테스트 수정 허용"(2026-11-08) → hook "30분간 허용", 카운터 초기화.
- [INFRA-13] 완료: 3443841..b4c401e, 병합 8211448. `node scripts/check-method.mjs --id INFRA-13`(8211448) → 9개 ✅, test-unchanged ⚠ 허용됨(1f3efaf, O40 의도대로), tree-updated ➖(INFRA), merge-record ➖ 기록 대기(이 기록 커밋에서 ✅가 된다). 병합 뒤 main에서도 규칙 D가 켜졌다 — 이 기록 커밋(`[INFRA-13] 병합 뒤 기록: …`)이 main 허용 목록으로 통과하는 첫 실사례.
- 1f3efaf [INFRA-13] 테스트 수정 — 사용자 허용("테스트 수정 허용" 입력, 2026-11-08). 도우미 `_branch-fixture.mjs`의 저장소 준비만, 기대값 그대로. 구현 전 코드(c663961 worktree + stub)에서 16 / 16 실패 확인은 커밋 메시지.
  - 내 실수: 계획 단계에서 `npm test -- … --test-name-pattern`이 실행기(scripts/test.mjs)에서 적용되는 줄 알았다 — 적용되지 않아 8954220 시점에 파일 전체가 돌았다. 또 red를 두 번 돌리면 셈이 2가 되는 줄 알았는데 `test:red`는 셈에 들어가지 않았다 [확인됨: test-streak.json 값 1].

### [UI-T] 계획
- 근거: 사용자 지시(2026-11-08) "응, 시작해", 결정 질문에 "모두 추천대로". CLAUDE.md 큰 단위 절(O33) — 시작할 때 큰 단위 테스트를 먼저. 형식은 INFRA-9(`test/ui/UI-T.test.ts`, 동적 import, export 없음).
- 미확인 항목(O13): 변화 없음(남은 셋 모두 세션 밖 조건).
- 보안 사례(O10): 별도 컨텍스트 검토 에이전트 → `docs/ai/ui-cases.md`(U1~U52, F1~F12, 실험 E1~E9, 범위 밖 X1). 사용자 결정 D-1~D-16 모두 추천대로. 에이전트 실험 스크립트는 `scripts/probe/ui-review/`로 옮긴다(O19, 실측 커밋).
- 작은 단위(목적 나무에 추가, Claude가 나눔): UI-1 서버 골격·요청 보호 → UI-2 프록시 쪽 차단 → UI-3 조회 API → UI-4 실시간 통로 → UI-5 화면.
- 대기 파일 P = `src/dashboard/public/app.js`: 마지막 작은 단위 UI-5가 만든다.
- **다시 할 행동(O42)** — 같은 실행 안에서:
  - PRX-T 1: 실제 curl로 평문 `POST http://127.0.0.1:<목적지>/submit?x=1`(Cookie `k=PLAIN-COOKIE`, 본문 `hello-sumun`) → 200
  - PRX-T 2: 실제 curl로 닫힌 포트 → 502
  - TLS-T 1: CONNECT localhost → TLS(프록시 CA만 믿음) → `GET /hello?q=1` + Cookie → 200 `secure-hello`
  - STO-T 1: 위 세 기록이 저장소에 쌓인다(완료 3건)
  - 그 뒤 새 단계: 대시보드 페이지·API·실시간 알림·지우기, 그리고 보호(다른 출처·리바인딩 Host·Via·프록시를 거친 요청)
- 설계 [추측] — 큰 단위 테스트가 고정하는 모양. 바꿀 땐 UI 보고서 결정 항목으로 올린다:
  - `src/dashboard/server.ts`: `startDashboard({ store, port })` → `{ port, token, url, close() }`. 127.0.0.1에만 연다. `url` = `http://127.0.0.1:<port>/#t=<token>`(D-3)
  - 페이지: `GET /` → 200 HTML(토큰 불필요), `GET /app.js` → 200 JavaScript. 응답 헤더: CSP에 `default-src 'self'`와 `frame-ancestors 'none'`, `Cache-Control`에 `no-store`, `X-Content-Type-Options: nosniff`, `Access-Control-Allow-Origin` 없음(D-7, D-11, D-16)
  - API는 `Authorization: Bearer <token>`(D-2, D-3). 없거나 틀리면 401
  - `GET /api/flows?method=&host=&status=` → `{ runId, items: 요약[] }`. `GET /api/flows/<id>` → 상세 JSON(헤더 포함). `GET /api/flows/<id>/body/request`·`/body/response` → `application/octet-stream` 원본 바이트. `GET /api/events` → `text/event-stream`, 줄 `data: <저장소 알림 JSON>`(D-4). `POST /api/clear`(`Content-Type: application/json`) → 204, `GET /api/clear` → 405(D-8)
  - 보호: Host가 `127.0.0.1:<port>`·`localhost:<port>`가 아니면, Origin이 대시보드 자신이 아니면, `Sec-Fetch-Site: cross-site`·`same-site`면, `Via`에 sumun이 있으면 토큰이 맞아도 403(D-5~D-7)
  - `src/proxy/server.ts`: `startProxy({ …, dashboardPort })` — 프록시를 거쳐 대시보드 포트로 가는 평문 요청과 CONNECT는 200이 아니고(거부와 안내), 기록도 생기지 않는다(D-5)
- 한 줄 보고: 목표 = 대시보드 사용자 흐름과 보호를 처음부터 끝까지 확인하는 큰 단위 테스트를 먼저 둔다 / 범위 =
  - 새 `test/ui/UI-T.test.ts`: (1) 위 행동 → 페이지·보안 헤더, 토큰 없으면 401, 목록(완료 3건, 요약에 쿠키 없음)·필터(method POST, status 502)·상세(쿠키)·본문(octet-stream), 실시간 알림(SSE로 새 요청의 done, 본문 없음), 지우기(POST 204 → 목록 비움, GET 405) (2) 보호: 리바인딩 Host·다른 Origin·`Sec-Fetch-Site: cross-site`·`Via: 1.1 sumun`은 토큰이 있어도 403, 프록시를 거친 대시보드 요청(평문·CONNECT)은 200이 아니고 기록이 늘지 않음. 도우미는 파일 안에 두고 export하지 않는다
  - 새 `scripts/probe/ui-review/e1.mjs`·`e2.mjs`(에이전트 실험, 저장소 경로를 인자 없이도 찾게만 바꿈)
  - 새 `docs/ai/ui-cases.md`, `docs/ai/purpose-tree.md`(UI 🔨, UI-T·UI-1~5 추가), `docs/for-me/UI-T.md`, `docs/ai/progress.md`
  - 하지 않을 것 = 구현(UI-1~5), 프록시 코드 변경, X1(루프백 서비스 전체 보호)
- 예상 [추측] (판정 기준 포함):
  - E167: `npm run test:red -- test/ui/UI-T.test.ts` → 2개 모두 실패, 유형은 오류(동적 import한 `src/dashboard/server.ts`가 없음, ERR_MODULE_NOT_FOUND). 판정: 실패 2, 각각 ERR_MODULE_NOT_FOUND면 일치.
  - E168: 테스트 커밋 뒤 `npm test`는 종료 코드 0, 출력에 "큰 단위 대기(todo) UI: 2개, 그중 실패 2개". 판정: 둘 다면 일치.
  - E169: 옮긴 실험 스크립트가 저장소 안에서도 에이전트 결과와 같은 줄을 낸다(E1 200 비밀, E4 508, E6 기록 4건, E8 터널 200, E9 Host anything.evil·Via null). 판정: 다섯 다 같으면 일치.

## 범위 밖 문제
- ⚠ [UI 검토에서 발견, 범위 밖 — ui-cases.md X1] 프록시의 루프 검사는 자기 포트만 본다. 같은 PC의 루프백 서비스(개발 서버 등) 모두가 프록시를 거친 DNS 리바인딩에 노출된다 [확인됨: `node scripts/probe/ui-review/e1.mjs` E1~E3]. 개발 앱 기록(F5)이 주된 사용 사례라 막지 않는다 → UI 보고서 결정 항목.
- ✅ (INFRA-3에서 해결) ~~[INFRA-1 결함] guard.mjs 오탐:~~ 셸 명령에 `>`와 `test/` 경로가 함께 있으면 "테스트 수정"으로 차단한다. 커밋 메시지의 `<noreply@anthropic.com>`, heredoc 본문, `-m "..."` 같은 **데이터 안의 `>`**도 리다이렉트로 본다. 발견: INFRA-2 테스트 커밋 시도(2026-11-07). 우회: 메시지를 파일로 쓰고 `git commit -F`. 수정 제안: heredoc 본문과 `-m` 인자를 빼고 판단 + 회귀 테스트 추가 → 사용자 보고 후 별도 작은 단위로.

- ✅ (INFRA-5에서 해결) ~~[INFRA-3 보안 회귀]~~ stripData()가 **실행되는** heredoc/here-string 본문(`bash <<EOF`, `sh -s <<EOF`, `@'...'@ | Invoke-Expression`)까지 지워서, 본문 안의 테스트 파일 쓰기를 허용한다. 발견: INFRA-3 감사(2026-11-07). 확인: `node .git/verify-heredoc.cjs` → 3개 모두 allow [확인됨]. 상태 폴더 heredoc은 deny. 제안: INFRA-5(셸·인터프리터에 넘기는 경우는 본문을 지우지 않는다) → 사용자 보고.

- ⚠ [규칙 B 한계, 의도적으로 남김] 상태 폴더(.claude/state/) 쓰기는 실행 전 패턴 검사만 한다. 경로 표기 변형(`.claude/"state"`, `.claude/./state`), python `open(...,'w')`, PowerShell 별칭 `sc`로 우회할 수 있다(guard-bypass-cases.md 31, 36, 38) [추측: 코드 기준]. 사용자 결정(INFRA-5 설계 4번)으로 남겨 둔 한계다. 최종 방어선은 PR 감사와 check-method다.

- ⚠ [PRX-2b 발견, 범위 밖] 목적지 응답을 해석할 수 없을 때(헤더 크기 초과, 깨진 응답 — PRX-1c B11) 기록의 실패 코드가 `unreachable`(연결 불가)로 남는다. 원인을 정확히 보여 주지 못한다. 확인: `node scripts/probe/prx2b-g9.mjs 10000` → error {by: upstream, code: unreachable, status: 502} [확인됨]. 제안: UI에서 실패 이유를 보여 줄 때 코드(예: `bad-response`)를 나눈다.

- ⚠ [INFRA-9 검토에서 발견, 범위 밖 — 사용자 보고] 테스트 코드가 `.claude/state/`(junit.xml, test-streak.json)에 직접 쓸 수 있다. hook은 도구 명령만 검사하고 `npm test`가 실행하는 코드는 보지 않는다. 멈춤 장치 전체를 무력화할 수 있다(infra9-cases.md 사례 12) [추측: 시험하지 않음]. 제안: 실행 전후 state 해시 비교 또는 state를 실행기만 쓰는 위치로 — 별도 작은 단위.
- [INFRA-9 검토에서 발견, 범위 밖] `{ skip }`·`--test-skip-pattern`은 셈을 초기화한다(사례 13). 같은 이름 테스트가 셈을 섞는다(사례 17). 부모 테스트 실패가 junit에서 빠진다(검토자 실측).

- ⚠ [TLS-1b 발견, 범위 밖 — 환경] 이 PC는 한순간에 몰린 TCP 연결을 약 232개만 받고 나머지는 ECONNREFUSED. 프록시의 대기 포트도 같다. backlog를 올려도 늘지 않는다 [확인됨: scripts/probe/tls1b-backlog.mjs] [추측: Windows 대기열 상한]. 브라우저는 한순간에 수백 개를 열지 않으므로 지금은 다루지 않는다.

- ⚠ [TLS-4 발견, 범위 밖 — TLS-1 결함] 불투명 터널(openTunnel)은 검사한 주소 중 **첫 주소에만** 연결한다. 이 PC에서 `localhost`는 `::1`, `127.0.0.1` 순서로 풀리므로, 127.0.0.1에만 열린 서버로 `CONNECT localhost:P`를 하면 502가 난다 [추측: TLS-1 테스트는 lookup을 주입해 드러나지 않았다. 복호화 쪽은 TLS-4에서 주소들을 차례로 시도하게 고침]. 제안: TLS-4b에서 터널도 같은 방식으로.

- ⚠ [TLS-4c 검토 발견, 범위 밖 — R6] CONNECT 단계의 이름 해석(`checkConnect`)과 인증서 발급(`certs.get`)에는 시간 제한이 없다. 해석이 멈추면 200을 보내기 전의 소켓이 무기한 남는다 [추측: 코드 근거, 실행 안 함]. 제안: 다음 TLS 관련 작은 단위나 SEC 단계에서 시간 제한을 검토.

- ⚠ [STO 검토에서 발견, 범위 밖 — sto-cases.md X1~X5] 복호화 CONNECT는 시작 알림만 있고 같은 id의 끝 기록이 없다(X1, 터널 안 기록에 CONNECT를 가리키는 칸도 없음). onFlowStart는 onFlow 없이도 나간다(X2). CONNECT 기록의 target.host는 끝 점·IPv6 표기가 평문과 다르다(X3). 시작 구독자 throw 때 시작 알림이 사라진다(X4, 설계대로). index.ts에 unhandledRejection 처리가 없어 reject 하나로 종료된다(X5) [확인됨: scripts/probe/sto-review/]. 저장소는 X1~X4를 전제로 만든다(S-2, S-6). X5는 STO-4에서 index.ts를 바꿀 때 다시 본다.

## 시도하다 막힌 것
(없음)
