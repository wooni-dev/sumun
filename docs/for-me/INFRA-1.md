# [INFRA-1] 1차 hook: 테스트 수정 차단, 연속 실패 시 멈춤        커밋: d73d44c..4ae378b

## 한 줄 요약
Claude가 "지침을 잊어서" 규칙을 어기지 못하도록, 도구를 쓰기 **직전**에 프로그램이 검사해서 막는 장치를 만들었다.

## 큰 흐름

```
Claude가 도구 사용을 시도  (예: Edit test/infra/hooks.test.mjs)
   │  {"tool_name":"Edit","tool_input":{"file_path":"D:/secretary/sumun/test/infra/hooks.test.mjs"}}
   ▼
Claude Code가 PreToolUse hook 실행 → node .claude/hooks/guard.mjs   (입력 JSON은 stdin으로)
   │  검사 1: hook 상태 폴더에 쓰는가?                      → 항상 차단
   │  검사 2: 같은 테스트가 3회 연속 실패한 상태인가?          → progress.md 외에는 차단
   │  검사 3: HEAD에 커밋된 test/ 파일을 고치는가?             → 해제 상태가 아니면 차단
   ▼
출력 {"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"커밋된 테스트 파일은..."}}
   │  (아무것도 출력하지 않으면 허용)
   ▼
Claude Code가 도구 실행을 취소하고, 이유를 Claude에게 전달함   ← 실제로 확인한 값(4ae378b의 검증)


사용자가 메시지 전송 ("테스트 수정 허용")
   ▼
UserPromptSubmit hook → node .claude/hooks/on-prompt.mjs
   │  .claude/state/tests-unlocked.json = {"until": 지금+30분}
   │  .claude/state/test-streak.json   = {"counts": {}}   (연속 실패 초기화)
   ▼
Claude에게 "[hook] 사용자가 ... 30분간 허용했습니다"가 전달됨
```

**왜 잠금 해제는 사용자 입력 hook에만 있나?** Claude는 도구로 파일을 쓸 수 있으니, 해제 파일을 Claude가 직접 만들 수 있으면 잠금이 의미가 없다. 그래서 (1) 상태 폴더 쓰기는 guard가 항상 막고, (2) 해제 파일은 사용자 메시지로만 실행되는 hook이 만든다. 보안에서 말하는 **"권한 분리"**와 같은 원리다. 일하는 쪽과 허가하는 쪽을 나눈다.

## 작업 흐름 (커밋 순서)
1. `d73d44c` 테스트: hook이 어떻게 판정해야 하는지 24개 사례로 고정 (구현 전 22개 실패를 확인)
2. `401539b` 연속 실패 카운터와 junit 해석
3. `d1df48a` 테스트 실행기 `npm test` / `npm run test:red`
4. `eb7eb8d` PreToolUse hook (guard.mjs)
5. `788a3c4` UserPromptSubmit hook (on-prompt.mjs)
6. `4ae378b` 설정 연결 + ai-research 읽기 전용 권한 → 실제로 막히는 것까지 확인

## 먼저 볼 코드
- `.claude/hooks/guard.mjs:44-51` — "커밋된 테스트"의 정의. `git cat-file -e HEAD:경로`로 마지막 커밋에 있는 파일인지 본다. 아직 커밋하지 않은 새 테스트는 자유롭게 쓸 수 있고, **테스트 커밋을 한 순간부터 잠긴다.**
- `.claude/hooks/guard.mjs:63-65` — 파일 수정 도구에 대한 세 가지 검사. 순서가 곧 우선순위다.
- `.claude/settings.json:16` — `onFailure: "block"`. hook이 고장 나면 "통과"가 아니라 "차단"된다. 안전장치는 **고장 났을 때 닫히는 쪽(fail-closed)**이 원칙이다.

## 파일별 변경
### test/infra/hooks.test.mjs — hook을 실제 프로세스로 실행해 판정을 확인하는 테스트 21개
- 임시 git 저장소를 만들어 `CLAUDE_PROJECT_DIR`로 넘긴다. 실제 저장소를 건드리지 않고 시험하기 위해서다.
- "허용" 사례도 hook 프로세스가 정상 종료(exit 0)했는지 같이 검사한다. hook이 없거나 고장 났을 때 우연히 통과하는 것을 막는다.

### test/infra/streak.test.mjs — 카운터와 junit 해석 테스트 3개
- junit 예시는 실측한 node v24.21.0의 실제 출력 형식을 썼다.

### scripts/streak.mjs — junit 결과를 `파일::테스트이름`별 실패 여부로 바꾸고, 연속 실패 횟수를 센다
- 6행: 멈추는 기준 3회 (개발 방식 27행의 "2~3회")
- 31행: 실패하면 +1, 통과하면 삭제, 이번에 실행 안 된 테스트는 유지

### scripts/test.mjs — `npm test` 실행기
- 46행 `--red` 모드: 구현 전에 **전부 실패해야** 성공한다. 구현 전부터 통과하는 테스트는 아무것도 검증하지 않을 수 있기 때문이다.
- 실행할 때마다 `.claude/state/last-run.json`에 실행 기록을 남긴다(2차 hook인 "실행 증거 확인"에서 쓸 예정).

### .claude/hooks/guard.mjs — 위 흐름의 검사 1~3
- 69행: `2>&1`, `>/dev/null`은 파일 쓰기가 아니라서 빼고 판단한다. 이게 없으면 `node --test ... 2>&1`까지 막힌다.

### .claude/hooks/on-prompt.mjs — 사용자 메시지로만 바뀌는 상태
- 20행: "테스트 수정 허용" → 30분 해제. "테스트 잠금" → 즉시 잠금.

### .claude/settings.json — hook 연결 + `Read(//d/secretary/ai-research/**)` 허용
- ai-research를 작업 폴더로 추가하지 않고 **읽기만** 허용했다(최소 권한).

## 알려진 한계 [추측]
- 셸 명령은 문자열 패턴으로 판단한다. `node -e`로 경로를 조합해서 쓰는 식으로 우회하면 못 잡을 수 있다. hook은 실수를 막는 장치이지, 작정한 우회까지 막는 장치는 아니다. 그래서 테스트 커밋 이후 테스트 파일이 바뀌었는지는 감사 단계에서 git diff로 한 번 더 확인한다.
- ai-research 읽기 규칙이 실제로 이 규칙 덕분에 통과하는지는 새 세션에서 다시 확인해야 한다.
