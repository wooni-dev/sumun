# [INFRA-4] 방식 보정 반영: 계획 커밋, 검증 표기, stub red        커밋: 7cc1607..(이 문서 커밋)

## 한 줄 요약
첫 감사에서 나온 개선점(O1~O9)을 **작업 지침(CLAUDE.md)**, **기계 검사(check-method)**, **감사자 절차**에 반영했다.

## 바뀐 PR 흐름

```
이전                              이후
────────────────────              ──────────────────────────────────────
                                  ① [ID] 계획:   한 줄 보고 + 예상값      ← O3: 예상을 먼저 썼다는 걸 git으로 증명
① [ID] 테스트:                    ② [ID] 테스트:  red 확인 (새 모듈이면 stub으로)   ← O2
                                                  회귀 테스트는 파일 분리          ← O9
② 구현 커밋들                     ③ 구현 커밋들   "검증" = 그 커밋에서 실제로 실행한 것   ← O1
③ 문서                            ④ 문서          "(이 문서 커밋)" 표기 허용        ← O4
```

check-method의 판정 (실제 값):
```
--id INFRA-3 (새 흐름으로 한 첫 작업)        --id INFRA-1 (이전 흐름)
| plan-first | ✅ | 계획 커밋 77161c1        | plan-first | ❌ | 계획 커밋 없음 (규칙 도입 전)
| test-first | ✅ | 38dc06a                 | test-first | ✅ | d73d44c
```

## 작업 흐름 (커밋 순서)
1. `7cc1607` 계획: 한 줄 보고 + 예상 E7~E9
2. `d0442cc` 테스트: 계획 커밋 인식 4개 (red에서 assertion 단계 실패)
3. `4928efc` check-method에 plan-first 규칙 → 48/48, E8·E9 실측 일치
4. `e22938f` CLAUDE.md에 PR 커밋 순서와 관례
5. `88b7765` method-auditor에 확인 절차 추가
6. (이 문서 커밋) 문서, 감사 기록 상태

## 먼저 볼 코드
- `CLAUDE.md`의 "PR 커밋 순서" — 앞으로 모든 PR이 따를 순서다. 사용자가 PR을 읽을 때도 이 순서대로 보면 된다. **계획(무엇을 예상했나) → 테스트(무엇이 맞는 동작인가) → 구현(어떻게 했나) → 문서(정리)**.
- `scripts/check-method.mjs`의 `isPlan` — 계획 커밋의 정의. 제목에 "계획:"이 있고 **docs/만 바꾼 커밋**이다. 코드를 바꾸면서 "계획"이라고 이름만 붙이는 것은 인정하지 않는다.

## 파일별 변경
### test/infra/check-method-plan.test.mjs — 계획 커밋 인식 4개
### scripts/check-method.mjs — `plan-first` 규칙 추가, 계획 커밋 다음부터 테스트 커밋 판정
### CLAUDE.md — PR 커밋 순서(계획/테스트/구현/문서), O1·O2·O4~O9 관례
### .claude/agents/method-auditor.md — 중간 커밋 "검증"이 사실인지(`git ls-tree`), 새 관례를 지켰는지 확인하는 절차
### docs/method-feedback.md — O1~O9 반영 상태 표시

## ai-research에 반영할 때 참고
`docs/method-feedback.md`의 O1~O9 표가 `decisions.md`를 보정할 후보 목록이다. 각 행에 관련 결정 행 번호가 적혀 있다.
