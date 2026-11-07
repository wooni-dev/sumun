# [INFRA-3] guard.mjs 오탐 수정: 명령 속 "데이터"의 '>'는 쓰기가 아니다        커밋: 77161c1..(이 문서 커밋)

## 한 줄 요약
커밋 메시지에 들어 있는 메일 주소 `<noreply@anthropic.com>`의 `>`를 hook이 "파일에 쓰기"로 오해해서 정상 커밋을 막았다. 그래서 명령에서 **데이터 부분을 지운 뒤** 판단하도록 고쳤다.

## 큰 흐름 (실제 값)

```
입력 명령 (Bash)
  git add test/a.test.ts && git commit -q -F - <<'EOF'
  [X] 테스트 추가
  - 검증: npm run test:red -- test/a.test.ts → 실패
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>      ← 여기의 '>'가 문제였음
  EOF
        │
        ▼  stripData() — heredoc 본문, -m "...", @'...'@ 를 지움
  git add test/a.test.ts && git commit -q -F - <<EOF
        │
        ▼  WRITE_RE: '>' 없음, 쓰기 명령 없음 → writes = false
  판정: 허용                                       ← 수정 전: 차단 (실제 발생, 2026-11-07)


진짜 쓰기는 명령 줄에 남는다:
  cat <<'EOF' > test/a.test.ts      →  stripData 후  cat <<EOF > test/a.test.ts
  x                                    '>' + test/ 경로 → 차단 (회귀 테스트로 보장, 실제로도 막힘)
  EOF
```

**핵심 아이디어**: 셸 명령은 "무엇을 할지(명령 줄)"와 "넘겨줄 내용(데이터)"으로 나뉜다. 위험한 건 명령 줄의 리다이렉트이고, 데이터 안의 기호는 그냥 글자다. 웹 개발로 치면 SQL 인젝션 검사를 할 때 **쿼리 구조와 바인딩된 값을 구분하는 것**과 비슷하다.

## 작업 흐름 (커밋 순서)
1. `77161c1` 계획: 한 줄 보고 + 예상 E4~E6 (이번부터 적용한 새 규칙 O3)
2. `38dc06a` 테스트: 새 동작 4개(red에서 assertion 단계 실패 확인), 회귀 5개(수정 전에도 통과)
3. `593fdf2` guard.mjs 수정 → 44/44. **이 커밋 자체가 실측이다**: 예전에는 막혔을 heredoc 메시지로 커밋해서 통과했다(E6)
4. (이 문서 커밋) 문서와 진행 기록

## 먼저 볼 코드
- `.claude/hooks/guard.mjs:79`(593fdf2 기준)의 `stripData()` — 세 가지 정규식이 각각 heredoc, PowerShell here-string, `-m` 메시지를 지운다. 첫 번째 정규식에서 `$3`(표식 줄의 나머지)을 남기는 게 중요하다. 이게 없으면 `cat <<EOF > test/x`의 리다이렉트까지 지워져 버린다.

## 파일별 변경
### test/infra/_hook-fixture.mjs — 임시 저장소를 만들고 guard 판정을 돌려주는 공통 도우미
- 기존 `hooks.test.mjs`는 잠겨 있어서 고치지 않고, 새 테스트에서만 쓴다.
### test/infra/hooks-data-gt.test.mjs — 새 동작: 데이터 속 `>`를 허용 (4개)
### test/infra/hooks-data-gt-regression.test.mjs — 회귀: 진짜 쓰기는 계속 차단 (5개)
- 수정 전에도 통과하는 게 정상이라 red 대상이 아니다. 그래서 파일을 나눴다.
### .claude/hooks/guard.mjs — `stripData()` 추가. 상태 폴더 검사도 데이터를 지운 명령으로 판단하게 바꿨다

## 남은 한계 [추측]
- `echo "a > b" > test/x`처럼 일반 따옴표 안의 `>`는 여전히 쓰기로 본다. 그래도 이 경우는 진짜 쓰기가 같이 있어서 차단이 맞다. 반대로 `echo "a > b"`처럼 따옴표 안에만 `>`가 있고 test/ 경로가 같이 있는 명령은 오탐이 날 수 있다. 실제로 발생하면 그때 처리한다.
