# [INFRA-6] 승인된 방식 보정 O10~O17 반영 + INFRA-5 감사 후속        커밋: 9c99332..(이 문서 커밋)

## 한 줄 요약
두 번째 감사(AUDIT-2)에서 승인된 보정 8개를 **작업 지침, 기계 검사, 감사자 절차**에 반영했다. INFRA-5 감사가 지적한 기록 불일치도 정리했다.

## 무엇이 바뀌었나

| O번호 | 내용 | 반영 위치 |
|---|---|---|
| O10 | 보안·차단 규칙을 바꿀 때는 **검토 에이전트에게 우회 사례를 먼저** 받는다 | CLAUDE.md |
| O11 | 범위는 개수가 아니라 **파일 이름 + 규칙·함수**로 적는다 | CLAUDE.md |
| O12 | 사용자 문서의 "먼저 볼 코드"에 `파일:줄`이 있는지 **기계로 검사** | check-method `user-doc-lines` |
| O13 | 미확인 항목은 "세션 안 / 세션 밖 조건 필요"로 나눈다 | CLAUDE.md |
| O14 | 규칙이 생기기 전 작업은 위반(❌)이 아니라 **건너뜀(➖)** | check-method `plan-first` |
| O15 | 새 동작과 회귀는 **assertion 단위**로 나눈다 | CLAUDE.md |
| O16 | 감사자는 **그 작업 시점의 규칙**으로 판정한다 | method-auditor |
| O17 | 실측 기록에는 **실행한 명령 원문**을 적는다 | CLAUDE.md |

check-method의 판정 (실제 값, c4dddb9):
```
INFRA-1: plan-first=➖ 건너뜀  user-doc-lines=✅      ← 이전에는 plan-first ❌로 보였다
INFRA-2: plan-first=➖ 건너뜀  user-doc-lines=✅
INFRA-3: plan-first=✅        user-doc-lines=✅      ← INFRA-5에서 줄 번호를 보충해서 ✅ (HEAD 기준 판정)
INFRA-4: plan-first=✅        user-doc-lines=✅
INFRA-5: plan-first=✅        user-doc-lines=✅
```

## 작업 흐름 (커밋 순서)
1. `9c99332` 계획: 범위(O11 형식으로 처음 작성), 미확인 분류(O13), 예상 E14~E16
2. `562f9c0` 테스트: check-method 새 규칙 5개(red, 실패 유형도 적음) + 정상 명령 회귀 5개
3. `c4dddb9` check-method: `user-doc-lines`, 규칙 도입 전 `plan-first` ➖ → 96/96, E16 실측
4. `f8b0d10` CLAUDE.md: O10, O11, O13, O15, O17 + 승인 상태는 method-feedback.md 한 곳에
5. `fc1b84b` method-auditor: O16
6. (이 문서 커밋) 감사 기록 정리, 문서

## 먼저 볼 코드
- `scripts/check-method.mjs:15` — `PLAN_RULE_SINCE = '77161c1'`. 계획 커밋 규칙이 처음 적용된 커밋이다. 작업 첫 커밋의 조상이 이 커밋이면 규칙을 적용하고, 아니면 건너뛴다.
- `scripts/check-method.mjs:42` — `user-doc-lines`. "## 먼저 볼 코드" 절 안에서만 `` `파일:줄` ``을 찾는다. 다른 절에 있는 줄 번호는 인정하지 않는다.
- `CLAUDE.md:21` — O10. 이번에 생긴 규칙 중 가장 중요하다. **고친 사람이 직접 회귀 사례를 고르면 사각지대가 생긴다**는 걸 INFRA-3 → INFRA-5에서 실제로 겪었다.

## 파일별 변경
### test/infra/check-method-doc.test.mjs — O12, O14 규칙 (새 동작 5개)
### test/infra/hooks-normal-regression-2.test.mjs — INFRA-5 감사가 찾은, 회귀 테스트에서 빠진 정상 명령 5개
### scripts/check-method.mjs — `checkCommits()`에 `docText`, `planRuleApplies` 입력 추가. 둘 다 넘기지 않으면 예전과 같이 동작한다(기존 테스트 호환)
### CLAUDE.md — 개발 방식 절에 O10, O11, O13, O15, O17과 승인 상태 관례
### .claude/agents/method-auditor.md — 원칙 5번(O16)
### docs/method-feedback.md — INFRA-5 감사 기록, "승인 상태" 표(이곳에만 기록), 처리한 "고칠 것" 체크, 새 관찰 O18~O21(승인 전)
