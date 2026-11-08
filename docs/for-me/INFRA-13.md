# [INFRA-13] 커밋 제목 ID가 브랜치에 맞는지 검사(O54, 규칙 D)        커밋: 3443841..(이 문서 커밋)

## 한 줄 요약
`feat/INFRA-13` 브랜치에서 제목이 `[PRX-2b]`인 메시지로 커밋하려 하면 hook이 막습니다. INFRA-11 때 공유 임시 폴더의 옛 메시지 파일로 커밋된 사고(5e7b491)는 형식이 맞아 규칙 C를 통과했습니다. 이제는 "이 브랜치의 커밋인가"까지 봅니다.

## 무엇을 보나
```
 Claude: git commit -q -F "C:/…/infra13-plan.txt"
   │
   ▼ ① 실행 전 (guard.mjs) — 규칙 C(형식)를 통과한 뒤 규칙 D
   │   - 지금 브랜치(git symbolic-ref HEAD)와 메시지 파일 첫 줄의 [ID]
   │       feat/<ID>  → [<ID>] 또는 [RULE] (테스트 수정 허용 중이면 다른 노드의 "[ID] 테스트 수정(사용자 허용…"도)
   │       main       → [AUDIT-n] [SESSION] [INIT] [REPORT-…] "[ID] 병합: …" "[ID] 병합 뒤 기록: …"만
   │       detached·Feat/·feat/a/b·비슷한 글자 → 막음      probe/… 등 → 보지 않음
   │   - main의 git merge feat/<ID> → 메시지 제목이 "[<ID>] 병합: …" (메시지 없으면 막음)
   │   - 같은 명령에 checkout·switch·branch·cd·Set-Location·export·$env: 가 섞이면 막음
   │   - -C 경로와 작업 위치(cwd)가 이 저장소가 아니면 막음
   │   - 브랜치와 HEAD reflog 항목 수를 .claude/state/commit-check.json에 기록
   ▼ git이 커밋을 만든다
   ▼ ② 실행 뒤 (commit-check.mjs)
       새 reflog 항목 중 커밋(commit·cherry-pick·revert·am·rebase)이 있으면
         그 사이 checkout이 있었거나 브랜치가 바뀌었음 → 알림
         아니면 각 커밋 제목을 ①과 같은 함수(branchProblems)로 검사 → 틀리면 알림
```
- reflog는 git이 HEAD가 움직일 때마다 남기는 일지입니다. "다른 브랜치로 가서 커밋하고 돌아오기"는 HEAD가 결국 그대로라서 전처럼 HEAD만 비교하면 놓칩니다. 일지에는 checkout·commit·checkout이 남습니다.
- 켜는 표시: `.claude/commit-rule.json`의 `"branch": true`. 기존 INFRA-11 테스트가 `main`에서 `[X-1]`로 커밋하므로, 같은 파일이 있기만 하면 켜지게 하면 그 테스트가 깨집니다(사례 문서 Q11).

## 결정 (사용자: "끝나면 추천대로 진행해")
검토 에이전트가 우회 31개·오탐 13개·결정 질문 11개를 냈습니다(`docs/ai/infra13-cases.md`). 모두 추천대로 정했고 Q11만 위 이유로 다르게 정했습니다. 앞으로 바뀌는 작업 습관은 셋입니다.
- 접미사 브랜치(`feat/TLS-3-lag`) 대신 새 노드 ID(`feat/TLS-3b`)를 씁니다.
- 병합은 `git merge --no-ff -F "<절대 경로>" feat/<ID>`, 제목은 `[ID] 병합: …`입니다.
- 커밋 명령에 `cd`·`checkout`을 섞지 않습니다.

## 확인한 것
| 예상 | 결과 |
|---|---|
| E163 구현 전 새 테스트 16개 모두 assertion 실패, 회귀 3개 통과 | 일치 [확인됨] |
| E164 구현 뒤 `npm test` 실패 0, 대기 0 | 일치 — 703 / 703 [확인됨] |
| E165 실제 도구 호출: `[PRX-2b]` 파일로 커밋(Bash·PowerShell), `git checkout … && git commit …` | 일치 — 셋 다 규칙 D로 막힘, 새 커밋 0개 [확인됨] |
| E166 규칙 D를 켠 뒤 이 PR의 커밋들은 막히지 않고 알림 없음 | 일치 — 5b78a70부터 이 문서 커밋까지 [확인됨] |

## 이 PR에서 생긴 일 (솔직하게)
- **테스트 구조 문제로 멈춤**: 테스트 1개가 실패했는데 구현이 아니라 테스트 도우미 문제였습니다. 도우미가 `git add -A`로 커밋해서 임시 저장소의 표시 파일이 다른 브랜치 커밋에 들어갔고, 돌아오는 checkout이 그 파일을 지웠습니다. 표시 파일이 없으니 hook은 꺼진 것으로 보았습니다. 진단 스크립트(`scripts/probe/infra13-reflog.mjs`)로 원인을 확인하고 멈췄습니다. "테스트 수정 허용"을 받은 뒤 도우미만 고쳤고 기대값은 그대로입니다. 고친 테스트가 구현 전 코드에서도 여전히 실패하는 것을 확인했습니다(1f3efaf).
- **제 착각 두 가지**: `--test-name-pattern`이 테스트 실행기에서 적용되는 줄 알았는데 적용되지 않아 파일 전체가 한 번 더 돌았습니다. 반대로 `test:red`는 연속 실패 셈에 들어가지 않는데 들어가는 줄 알았습니다.
- 같은 명령 안에 `>>`와 `test/` 경로가 있어 stub 추가가 한 번 막혔습니다(규칙 A의 의도한 보수적 동작). Edit 도구로 넣었습니다.

## 한계 (`docs/ai/infra13-cases.md` L1~L11 중 중요한 것)
- **같은 ID의 옛 메시지 파일**(예: 지난 세션의 `infra13-plan.txt`)은 통과합니다. 내용이 옛것인지는 기계가 알 수 없습니다. 지침(파일 이름에 노드 ID, Write 결과를 본 뒤 커밋)이 막습니다.
- 앞 호출에서 브랜치를 바꾸고 다음 호출에서 커밋하는 것은 정상 작업과 구별되지 않습니다.
- 실행 뒤에는 병합 커밋을 보지 않습니다. 병합 메시지는 실행 전 `git merge`에서만 봅니다.
- `probe/…` 같은 feat가 아닌 브랜치는 보지 않습니다.

## 먼저 볼 코드
- `scripts/commit-msg.mjs:53` — `branchProblems`: 브랜치별 제목 판정(두 hook이 같이 씀)
- `scripts/commit-msg.mjs:72` — `mergeProblems`: main에서 feat/<ID>를 병합할 때 제목
- `.claude/hooks/guard.mjs:114` — 규칙 D 진입: 규칙 C를 통과한 뒤 표시 키 확인
- `.claude/hooks/guard.mjs:190` — `branchRuleProblem`: 같은 명령 안 바꾸기, cwd·-C, 커밋 파일 제목, 병합 메시지
- `.claude/hooks/guard.mjs:156` — `gitOf`: 조각에서 git 하위 명령·-C·위치 바꾸기 찾기
- `.claude/hooks/guard.mjs:122` — `recordHead`: 실행 뒤 검사 기준(브랜치, reflog 항목 수)
- `.claude/hooks/commit-check.mjs:84` — `ruleD`: 새 reflog 항목으로 명령 중 생긴 커밋 찾기
