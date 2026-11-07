# 진행 기록

단서로만 쓴다. 세션을 시작할 때 git 이력과 테스트 결과로 대조한다.

## 현재
- 작업: INFRA-1, INFRA-2 감사 → 사용자 보고
- 다음 할 일: 보고서의 결정 항목 처리(hook 오탐 수정 여부) → [PRX-1]

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
- [INFRA-2] 완료: 20ae0c7..(문서 커밋), npm test 35/35.

## 범위 밖 문제
- ⚠ [INFRA-1 결함] guard.mjs 오탐: 셸 명령에 `>`와 `test/` 경로가 함께 있으면 "테스트 수정"으로 차단한다. 커밋 메시지의 `<noreply@anthropic.com>`, heredoc 본문, `-m "..."` 같은 **데이터 안의 `>`**도 리다이렉트로 본다. 발견: INFRA-2 테스트 커밋 시도(2026-11-07). 우회: 메시지를 파일로 쓰고 `git commit -F`. 수정 제안: heredoc 본문과 `-m` 인자를 빼고 판단 + 회귀 테스트 추가 → 사용자 보고 후 별도 작은 단위로.

## 시도하다 막힌 것
(없음)
