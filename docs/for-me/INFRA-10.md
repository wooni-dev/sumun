# [INFRA-10] 승인된 방식 보정 O39~O46 반영        커밋: 6228f88..(이 문서 커밋)

## 한 줄 요약
TLS 보고서에서 승인하신 개발 방식 보정 8건을 넣었다. 3건(O39·O40·O46)은 **기계 검사(check-method)**에, 5건(O41~O45)은 **지침(CLAUDE.md)**에 넣었다. 기능 코드(프록시)는 바꾸지 않았다.

## 기계 검사에서 달라진 것
| 규칙 | 전에는 | 이제 |
|---|---|---|
| test-unchanged: 테스트 파일을 나중에 고쳤나 (O39) | **커밋 이름**이 같은 노드 것만 봤다. `[TLS-4]` 이름의 커밋이 TLS-T 테스트를 고쳐도 TLS-T는 ✅ | **파일 기준**: 어느 노드 이름의 커밋이 고쳤든 잡는다 |
| 사용자가 허용한 테스트 수정 (O40) | 위반과 똑같이 ❌ | **⚠ 허용됨**(위반 아님). 조건: 제목에 `(사용자 허용`, progress.md 한 줄에 그 해시와 "허용" |
| predictions-measured: 예상마다 실측 기록 (O46) | 기록만 있으면 통과 | 판정할 수 있는 예상은 기록에 **일치/불일치**가 있어야 한다. 결과를 모르는 예상은 `[탐색]`으로 따로 센다. **INFRA-10 뒤 작업에만** 적용(옛 작업 결과는 그대로) |
| 큰 단위 sub-nodes | ⚠를 구별하지 못함 | 위반 목록과 ⚠ 허용됨 목록을 따로 적는다 |

TLS 큰 단위를 다시 검사하면 이렇게 보인다(`node scripts/check-method.mjs --id TLS`):
```
sub-nodes ❌ 위반 → TLS-1b message-format, TLS-2 plan-first, TLS-2 test-first, TLS-4c message-format
             / ⚠ 허용됨 → TLS-T test-unchanged, TLS-2b test-unchanged, TLS-3 test-unchanged, TLS-4 test-unchanged, TLS-4b test-unchanged
```
전에는 허용받은 수정 4건이 위반 7건 안에 섞여 있었고, TLS-T의 수정은 아예 보이지 않았다. 남은 위반 4건은 모두 제 서식·순서 실수이고, 원인은 기록돼 있다.

모든 PRX·INFRA·TLS 노드를 이전 버전 검사기와 비교했다. 바뀐 것은 위 5개뿐이고, 새로 생긴 ❌는 없다.

## 지침에 넣은 것
- **[RULE] 커밋**(O41): 사용자 결정으로 CLAUDE.md·.gitignore 같은 규칙을 바꾸는 커밋은 노드 ID가 아니라 `[RULE]`로, 계획 커밋 앞에 둔다.
- **[탐색] 예상**(O46): 결과를 모르고 기록만 하려는 예상에만 붙인다. 감사자는 판정을 피하려고 붙였는지 본다.
- **타이밍 테스트**(O43): 절대 시간 대신 기준선 대비나 결정적인 지표(파싱 횟수 등)로 쓴다.
- **허용된 테스트 수정 절차**(O40·O44): 제목 형식, progress.md 기록, "고친 테스트가 구현 전 코드에서 여전히 실패" 확인.
- **커밋 메시지 절차**(O45): Write 도구로 임시 파일에 쓰고 `git commit -F`로 커밋한다. `- 검증:`은 글자 그대로 쓴다. TLS-4c에서 `- 검증(…):`으로 써서 ❌가 났기 때문이다.
- **큰 단위 "이어 붙이기"**(O42): 이전 큰 단위 테스트의 사용자 행동을 같은 실행 안에서 다시 하고, 새 단계를 붙인다.

## 테스트
- 새 동작 8개(`test/infra/check-method-infra10.test.mjs`): 구현 전 8개 모두 assertion 실패, 오류 0개. 실제 저장소 이력으로 TLS-T·TLS-2b의 결과도 확인한다.
- 회귀 7개(`test/infra/check-method-infra10-regression.test.mjs`): 허용 조건이 하나라도 빠지면 위반, 옛 작업은 판정 요구 없음, 탐색이어도 기록이 없으면 위반.
- 전체 `npm test`: **566개 모두 통과, 실패 0, 큰 단위 대기 0**.

## 작업 흐름 (커밋 순서)
1. `6228f88` 계획: 예상 E117~E120 (이 커밋이 판정 요구의 시작점 `VERDICT_RULE_SINCE`)
2. `af6a14c` 테스트 8개 + 회귀 7개
3. `4c06f6a` check-method.mjs
4. `5bddebe` CLAUDE.md·method-auditor
5. (이 문서 커밋)

## 먼저 볼 코드 (줄 번호는 이 문서 커밋 기준)
- `scripts/check-method.mjs:24` — `allowedFix()`: "사용자가 허용한 수정"의 두 조건
- `scripts/check-method.mjs:69` — `checkCommits()` 안 `touchers`: 파일 기준으로 테스트 파일을 바꾼 커밋 찾기
- `scripts/check-method.mjs:112` — `checkCommits()` 안 `noVerdict`: 판정(일치/불일치) 없는 예상
- `scripts/check-method.mjs:231` — CLI 안 `laterCommits`: 다른 노드 이름의 커밋까지 git에서 읽기
- `CLAUDE.md:37` — 허용된 테스트 수정 절차

## 남은 것
- [SEC-3] 루트 CA를 Windows(현재 사용자)에 등록·해제한다. 명령은 실행 직전에 보여 드리고 확인받는다. 브라우저 실측, curl `--ssl-no-revoke` 문제도 여기서 다룬다.
