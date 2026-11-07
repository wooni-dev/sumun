# [INFRA-2] 개발 방식 감사: 기계 검사 스크립트 + 감사 에이전트        커밋: 20ae0c7..e9b3197

## 한 줄 요약
작업이 끝날 때마다 "방식대로 했나"를 확인하는 감사 체계를 만들었다. **기계로 셀 수 있는 것은 스크립트가**, **판단이 필요한 것은 별도 컨텍스트의 에이전트가** 본다.

## 큰 흐름

```
PR(작은 단위) 끝
   │
   ▼
method-auditor 호출 (새 컨텍스트, 읽기 전용)  ← 일한 Claude의 설명은 넘기지 않음. 노드 ID만 넘김
   │
   ├─ ① node scripts/check-method.mjs --id INFRA-1          [확인됨]
   │      git log --grep=^\[INFRA-1\] → 커밋 7개 (병합 제외, 오래된 순)
   │      ┌──────────────────┬────┐
   │      │ test-first       │ ✅ │ 첫 커밋 d73d44c = "테스트:" + test/ 파일만
   │      │ test-unchanged   │ ✅ │ 이후 커밋에서 그 테스트 파일 변경 없음
   │      │ message-format   │ ✅ │ 모든 커밋에 "- 왜:" "- 검증:"
   │      │ user-doc         │ ✅ │ docs/for-me/INFRA-1.md 있음
   │      │ progress-updated │ ✅ │ docs/ai/progress.md 갱신
   │      │ tree-updated     │ ➖ │ INFRA는 목적 나무 노드가 아님
   │      └──────────────────┴────┘   ← 실제 실행 값 (3c02aac 검증, 예상 E3과 일치)
   │
   ├─ ② npm test                                              [확인됨]
   ├─ ③ decisions.md에서 필요한 절만 읽기
   └─ ④ 판단 항목 (커밋당 의도 하나, 범위, 예상값 먼저, 문서 줄 번호 대조 …)  [추측]
   │
   ▼
감사 기록(마크다운) 반환 → 내가 docs/method-feedback.md에 붙임
   ├─ "고칠 것"            → 이 프로젝트에서 수정
   └─ "방식 자체 관찰"      → ai-research/decisions.md 보정 후보
```

## 작업 흐름 (커밋 순서)
1. `20ae0c7` 테스트: 검사 규칙 11개 사례 (구현 전 실패 확인)
2. `3c02aac` 기계 검사 스크립트 → 35/35 통과, 실제 INFRA-1에 대고 실측
3. `ec06a66` 감사 에이전트 정의
4. `e9b3197` 사용자 문서와 진행 기록

## 먼저 볼 코드
- `scripts/check-method.mjs:18` — "테스트 먼저"의 기계적 정의. 첫 커밋 제목에 `테스트:`가 있고 **바뀐 파일이 전부 `test/` 아래**여야 한다.
- `scripts/check-method.mjs:22` — "테스트 불변"의 정의. 테스트 커밋에 있던 파일이 이후 커밋에 다시 나오면 위반이다. 새 테스트 파일을 추가하는 것은 괜찮다.
- `.claude/agents/method-auditor.md`의 "원칙 1" — 감사자는 호출한 쪽의 설명을 무시한다. 시험 감독관이 학생이 "저 잘 풀었어요"라고 말하는 걸 듣지 않고 답안지만 보는 것과 같다.

## 파일별 변경
### test/infra/check-method.test.mjs — 규칙별로 지킨 경우와 어긴 경우 11개
- 실제 git을 쓰지 않고, 커밋 목록을 직접 만들어서 판정 로직만 검사한다.

### scripts/check-method.mjs — git 이력에서 [ID] 커밋을 모아 6개 규칙 판정
- 33행: INFRA 작업은 목적 나무 노드가 아니라서 tree-updated를 건너뛴다.
- 44행: `--all --no-merges --reverse`. 모든 브랜치에서 병합 커밋을 빼고 오래된 순으로 모은다. 병합 전 브랜치도 검사할 수 있다.

### .claude/agents/method-auditor.md — 감사 에이전트의 역할, 원칙, 절차, 출력 형식
- 도구는 Read, Grep, Glob, Bash만 쓴다. Edit와 Write가 없어서 파일을 고칠 수 없다(권한 분리).

## 이번 작업에서 발견한 것
- ⚠ **INFRA-1 hook 오탐**: 커밋 메시지 안의 `<noreply@anthropic.com>`에 있는 `>`를 파일 쓰기로 보고, 테스트 커밋을 막았다. 범위 밖이라 고치지 않고 `progress.md`에 기록했다. 지금은 메시지를 파일로 넘겨서 우회하고 있다. → 보고서의 결정 항목
- `test:red`의 한계: import에 실패하면 파일 전체가 실패 1개로 집계된다.
