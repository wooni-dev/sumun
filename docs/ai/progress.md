# 진행 기록

단서로만 쓴다. 세션을 시작할 때 git 이력과 테스트 결과로 대조한다.

## 현재
- 작업: [INFRA-3] guard.mjs 오탐 수정
- 다음 할 일: [INFRA-4] 방식 보정(O1~O8) 반영 → INFRA-3, 4 감사 → [PRX-1]

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

## 범위 밖 문제
- ✅ (INFRA-3에서 해결) ~~[INFRA-1 결함] guard.mjs 오탐:~~ 셸 명령에 `>`와 `test/` 경로가 함께 있으면 "테스트 수정"으로 차단한다. 커밋 메시지의 `<noreply@anthropic.com>`, heredoc 본문, `-m "..."` 같은 **데이터 안의 `>`**도 리다이렉트로 본다. 발견: INFRA-2 테스트 커밋 시도(2026-11-07). 우회: 메시지를 파일로 쓰고 `git commit -F`. 수정 제안: heredoc 본문과 `-m` 인자를 빼고 판단 + 회귀 테스트 추가 → 사용자 보고 후 별도 작은 단위로.

## 시도하다 막힌 것
(없음)
