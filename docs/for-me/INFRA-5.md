# [INFRA-5] 테스트 보호를 "실행 전 패턴 검사 + 실행 후 결과 확인"으로        커밋: 5254eb5..(이 문서 커밋)

## 한 줄 요약
명령 문자열만 보고 위험을 예측하는 방식(블랙리스트)은 우회 사례가 끝없이 나왔다. 그래서 **명령을 실행한 뒤 git으로 "실제로 바뀐 것"을 확인**하는 최종 방어선을 추가했다. 실행 전 검사는 뻔한 실수를 빨리 막는 1차 방어선으로 남긴다.

## 큰 흐름 (실제 값)

```
Claude: sed -i '1s/^/TAMPERED /' te?t/infra/hooks.test.mjs
   │
   ▼ ① 실행 전 검사 (guard.mjs, PreToolUse)
   │    sed -i = 쓰기 ✔ / 경로 "te?t/" ≠ "test/" → 못 알아봄 → 허용        ← 문자열 검사의 한계
   ▼
셸 실행: te?t → test 로 glob 확장 → 파일 첫 줄이 "TAMPERED // [INFRA-1] ..."로 바뀜
   │
   ▼ ② 실행 후 검사 (verify-tests.mjs, PostToolUse)
   │    git diff HEAD --name-only -- test/  →  test/infra/hooks.test.mjs     ← 결과는 git이 정확히 안다
   │    잠금 상태 → git -c core.autocrlf=false checkout HEAD -- test/infra/hooks.test.mjs
   ▼
Claude에게: "[실행 후 검사] 커밋된 테스트 파일이 바뀌어서 HEAD 내용으로 되돌렸습니다: test/infra/hooks.test.mjs …"
git diff HEAD -- test/  →  (비어 있음)                                     ← 실측 E13 (b7c7d2d)
```

## 왜 이렇게 바꿨나 (보안 개념)
| 방식 | 질문 | 약점 |
|---|---|---|
| 블랙리스트 (실행 전) | "이 명령이 위험해 보이나?" | 셸 문법은 너무 다양하다. glob, `cd`, python, base64 … 우회 사례 40개 |
| 결과 확인 (실행 후) | "실제로 무엇이 바뀌었나?" | 명령을 어떻게 썼든 결과는 git이 알려 준다. 다만 사후에 되돌리는 방식이다 |

웹으로 치면, XSS를 입력 문자열 필터로만 막지 않고 **출력할 때 이스케이프**까지 해 두는 것과 같다. 한 겹이 뚫려도 다음 겹이 막는다(**심층 방어**).

**그래도 남는 한계**: 같은 권한을 가진 주체(Claude)를 완벽히 막을 수는 없다. 그래서 마지막 방어선은 PR마다 하는 git 이력 검사(check-method)와 감사 에이전트, 그리고 사용자의 보고서 확인이다. 상태 폴더(규칙 B)는 테스트 실행기도 정상적으로 쓰기 때문에 결과 확인이 어렵다. 그래서 실행 전 검사만 유지하고 한계로 기록했다.

## 작업 흐름 (커밋 순서)
1. `5254eb5` 계획: 설계 + 예상 E10~E13 + 우회 사례 목록 (`docs/ai/guard-bypass-cases.md`, 검토 에이전트가 제안)
2. `475e15f` 테스트: 우회 21개(실행 전), 결과 확인 2개(실행 후), 회귀 15개 — stub을 둔 상태에서 red 확인(O2)
3. `9f580ea` 실행 후 검사 hook (verify-tests.mjs)
4. `89db474` guard.mjs: 실행될 수 있는 데이터는 지우지 않음
5. `b7c7d2d` settings.json 연결 → 실제 저장소에서 복구까지 실측
6. (이 문서 커밋) 문서, 진행 기록

## 먼저 볼 코드
- `.claude/hooks/verify-tests.mjs:32` — 최종 방어선 전체가 이 한 줄이다. `git diff HEAD --name-only -- test/`
- `.claude/hooks/verify-tests.mjs:40` — 복구. `core.autocrlf=false`를 붙이지 않으면 Windows에서 LF가 CRLF로 바뀌어 "원본 그대로"가 되지 않는다(실측에서 발견).
- `.claude/hooks/guard.mjs:25` — `CONSUMER_RE`. heredoc 본문을 실행하는 명령 목록. 여기에 해당하면 본문을 데이터로 보지 않는다.
- `.claude/hooks/guard.mjs:93` — `stripData()`. "확실히 데이터일 때만 지운다". 지우지 않으면 검사 대상으로 남을 뿐이니, 모르면 지우지 않는 쪽이 안전하다.

## 파일별 변경
### test/infra/hooks-bypass.test.mjs — 우회 사례 21개가 실행 전에 막히는지 (번호는 guard-bypass-cases.md와 같음)
### test/infra/hooks-normal-regression.test.mjs — 정상 명령 10개는 계속 허용 + 상태 폴더 heredoc은 계속 차단
### test/infra/verify-tests.test.mjs, verify-tests-regression.test.mjs, _verify-fixture.mjs — 실행 후 검사: 변조·삭제는 복구, 변경 없음·새 파일·잠금 해제·test 밖은 그대로
### .claude/hooks/verify-tests.mjs — 새 파일 (위 흐름 ②)
### .claude/hooks/guard.mjs
- 20행: `TEST_PATH_RE` 앞 글자에 `>` `,` `{` 추가 (우회 26, 29)
- 25~27행: `CONSUMER_RE`, `EXPANDS_RE` 추가
- 73~77행: `>&숫자` 뒤에 경로가 이어지면 출력 정리로 보지 않음 (우회 24)
- 93행~: `stripData(s, tool)` — heredoc은 Bash에서만, here-string은 PowerShell에서만 처리. 실행기가 소비하거나 확장(`$(`, 백틱)이 있으면 지우지 않음. `-m`은 git commit/tag/merge에서만 지움
### .claude/settings.json — PostToolUse(Bash|PowerShell) → verify-tests.mjs

## 실행 전 검사로 여전히 못 막는 것 (실행 후 검사가 잡음)
우회 사례 1, 2, 3, 5, 20, 21과 (다)·(라)의 규칙 A 위반. 규칙 B(상태 폴더) 위반 중 31, 36, 38번은 아직 못 막는다 [추측: 코드 기준].
