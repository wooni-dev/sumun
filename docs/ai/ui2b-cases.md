# UI-2b 사례: 포트 점유 검사의 self-connect 결함 (O10: 검토 에이전트가 제안)

발견: 2026-11-08, UI-3 구현 중 UI-1 테스트 "npm start: 대시보드가 프록시 포트 + 1에 기본으로 켜지고 …"가 혼자 돌려도 두 번 연속 실패(대시보드가 P+2에 열림). 원인은 UI-2(대시보드를 프록시보다 먼저 연다 — E-5)가 드러낸 결함이다 [확인됨: `node scripts/probe/ui3-selfconnect.mjs` → self-connect 10/10].
- 결함: Windows는 나가는 소켓의 로컬 포트도 연속 번호로 준다. listen(0)으로 P를 받고 닫은 직후 `127.0.0.1:P+1`에 접속하면 나가는 소켓이 로컬 포트 P+1을 받아 **자기 자신에게 연결**된다. 점유 검사(`portAnswers`)는 연결되면 "다른 프로그램이 씀"으로 보므로, 아무도 없는 P+1이 점유로 보인다.
- UI-2 전에는 프록시의 검사가 먼저 돌며 P+1을 로컬 포트로 써 버려서 드러나지 않았다 [추측]. UI-2 때 전체 `npm test`(E175)가 통과한 것은 병렬 실행으로 임시 포트 번호가 어긋난 덕으로 보인다 [추측].
- 사용자 결정(2026-11-08, "A로 해"): UI-3을 멈추고 새 작은 단위 UI-2b로 먼저 고친다(기록 → 재현 테스트 → 수정).

출처: 별도 컨텍스트의 검토 에이전트가 `src/proxy/server.ts`·`src/dashboard/server.ts`·`src/index.ts`·`ui-cases.md`·`prx1-cases.md`를 읽고 `%TEMP%\sumun-ui2b-review\`에서 127.0.0.1·::1 포트로만 실험했다. 해결안은 알려 주지 않았다. 스크립트는 `scripts/probe/ui2b-review/`로 옮겼다(O19, 저장소 경로를 절대 경로로 씀 — 그대로 둠).

## 바탕 사실 [확인됨: 에이전트]
- F-a self-connect면 `localAddress === remoteAddress`, `localPort === remotePort`. 127.0.0.1·::1 모두 10/10, 직후 같은 포트 listen은 20/20 성공(TIME_WAIT 없음) — e1. Claude가 저장소에서 다시 실행: `node scripts/probe/ui2b-review/e1-selfconnect-detail.mjs` → `[::1] self-connect 10/10, 직후 listen 결과 {"ok":10}`, 빈 포트 ECONNREFUSED 0~1ms.
- F-b 임시 포트 번호는 IPv4·IPv6가 한 번호 체계를 쓴다. 실제 리스너가 있는 번호는 어느 계열로 접속해도 self-connect가 생기지 않았다(15/15) — e8. 그래서 "로컬 = 상대" 비교는 공격자가 흉내 낼 수 없다(W6과 대비).
- F-c 빈 포트는 0~1ms에 ECONNREFUSED — e1.

## Z: 아무도 없는데 점유로 보는 사례 (UI-2b가 고칠 것)
- Z1 IPv4 self-connect(보고된 결함) — e1 10/10
- Z2 ::1에서도 생긴다. 대시보드는 127.0.0.1 검사가 로컬 포트 T−1로 거절당한 뒤 [::1] 검사가 T를 받아 self-connect — 127.0.0.1만 고치면 남는다 — e1, e2(d)
- Z3 실제 시작 순서(대시보드 P+1 → 프록시 P)에서 프록시 검사도 self-connect → 프록시가 "포트를 이미 쓰고 있습니다"로 멈춤(5/5) — e9 S1. 실제 사용에서는 --port가 동적 범위(49152~65535)이고 임시 포트 커서 근처일 때만 [추측]
- Z4 판정 정보를 destroy 뒤·error·close 때 읽으면 localAddress·localPort가 undefined → 수정이 조용히 효과 없음 — e10(Claude 재실행: destroy 직후 `{"ra":"127.0.0.1","rp":…}`만 남음), e2(c)
- Z5 IPv4-mapped(`::ffff:127.0.0.1`)로 접속하면 양쪽 주소가 그 표기로 나온다 → '127.0.0.1' 글자와 비교하면 놓친다 — e7 M1·M2, e8 F2
- Z6 시간 초과를 "점유"로 바꾸면 W5·W2 상황에서 잘못된 점유가 생긴다 [추측] — 바꾸지 않는다
- Z7 다른 연결의 로컬 포트로만 쓰이는 번호는 ECONNREFUSED, 시작됨(문제 없음) — e4
- Z8 보안 프로그램이 루프백 접속을 다 받아 주면 모든 포트가 점유로 보인다 [추측]

## W: 다른 프로그램이 듣고 있는데 놓치는 사례 (UI-2b 범위 밖 — 기록하고 UI 보고서 결정 항목)
- W1 [::1]:Q의 가짜가 backlog를 채워 검사 순간 ECONNREFUSED → 대시보드 시작 → `localhost:Q`·`[::1]:Q`는 가짜가 답함 — e3, e5. 127.0.0.1에서는 우리 listen이 EADDRINUSE로 막는다
- W2 [::1]:Q의 SO_CONDITIONAL_ACCEPT 리스너 → 검사가 ETIMEDOUT → 시작 → 3.5초 뒤 `localhost:Q`는 가짜 — e9 C1·C2
- W3 프록시 검사는 ::1을 보지 않는다 → [::1]:P에 남이 있어도 시작. 사용자가 프록시 주소를 `localhost:P`로 넣으면 남에게 갈 수 있다 — e4, e5 [브라우저 동작은 추측]
- W4 시작한 뒤 남이 [::1]:Q를 listen하면 성공 → `localhost:Q`는 가짜(검사로는 못 막음, TOCTOU 포함). 기본 포트가 차서 port 0으로 넘어가면 검사가 없다 — e4
- W5 우리 이벤트 루프가 500ms 넘게 막히면 실제 리스너가 있어도 false — e7 T1(그런 경로는 못 찾음)
- W6 nonce 되돌림으로 self를 판정하면 에코 서버가 흉내 낸다 — e2(b)
- W7 SO_REUSEADDR로 빼앗기: 막힘(AccessDenied·EADDRINUSE) — e6(해당 없음)
- W8 0.0.0.0·[::] 리스너 + W1·W2 기법 [추측], W9 127.0.0.2 [추측, 놓침 아님], W10 WFP 보안 프로그램 [추측]

## UI-2b 설계 [추측 — Claude 추천, UI 보고서 결정 항목]
| # | 정한 것 | 사례 |
|---|---|---|
| B-1 | 점유 검사는 연결 콜백 **안에서(destroy 전에)** 소켓의 `localAddress === remoteAddress && localPort === remotePort`면 "응답 없음"으로 본다. 글자('127.0.0.1')와 비교하지 않는다 | Z1, Z4, Z5, W6 |
| B-2 | 프록시(`src/proxy/server.ts`)와 대시보드(`src/dashboard/server.ts`, 127.0.0.1·::1 두 검사) 모두 고친다 | Z2, Z3 |
| B-3 | 시간 초과·거절은 지금처럼 "응답 없음". 바꾸지 않는다 | Z6, W2·W5와 맞바꿈 |
| B-4 | W1~W4([::1] 구조 — 대시보드·프록시를 ::1에도 열거나, localhost 대신 127.0.0.1만 안내하는 등)는 보안 규칙("127.0.0.1에만 바인딩")과 걸리는 결정이라 이 단위에서 바꾸지 않는다 → UI 보고서 결정 항목 | W1~W4, W8 |
