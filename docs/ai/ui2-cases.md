# UI-2 사례: 프록시 쪽 대시보드 차단 (O10: 검토 에이전트가 제안)

출처: 2026-11-08, 별도 컨텍스트의 검토 에이전트가 `src/proxy/`, `src/tls/`, `src/dashboard/server.ts`, `src/index.ts`, `src/cli.ts`, `docs/ai/ui-cases.md`, `scripts/probe/ui-review/`를 읽고 추론하고, `%TEMP%\sumun-ui2-review\`에서 127.0.0.1의 무작위 포트로만 실험했다. 작업자의 해결안은 알려 주지 않았다. 실험 스크립트는 `scripts/probe/ui2-review/`로 옮겼다(O19). r5는 CA를 스크립트 옆에 만들게 되어 있어서, 옮길 때 OS 임시 폴더(`sumun-ui2-review-ca`)로 바꿨다(저장소 안에 개인키를 두지 않는다).
상위 사례: `ui-cases.md` U14~U17, F2, F5, X1, D-5. 배정 "UI-2".

## 재현 (Claude가 저장소 안에서 다시 실행, 2026-11-08) [확인됨]
- `node scripts/probe/ui2-review/r2-plain.mjs` → `127.0.0.1`·`localhost`·`evil.com@127.0.0.1`·`:0<P>`·`HTTP://` 모두 200 `{"secret":"DASH"}`. 대시보드가 받은 Host는 `127.0.0.1:<P>`(프록시가 URL로 다시 씀), Via `1.1 sumun`, Authorization 그대로. 시작 알림 17개, 0.0.0.0 기록의 target.host `0.0.0.0`.
- `node scripts/probe/ui2-review/r3-connect.mjs` → 가짜 lookup의 `rebind.test`·`zero.test` CONNECT 200 뒤 `{"runId":…}`. 숫자 표기·앞자리 0은 400. 터널 안 Host `anything.evil` → 대시보드 403, 토큰 없는 `GET /` → 200 HTML. CONNECT 기록 21개.
- `node scripts/probe/ui2-review/r4-plain-rebind.mjs` → 평문 경로는 주입한 `lookup`을 부르지 않는다(0회), `dns.lookup`이 이름을 2번 푼다(검사 흉내 203.0.113.9 → 연결 127.0.0.1) → 대시보드 도달.
- `node scripts/probe/ui2-review/r7-refusal-record.mjs` → 지금의 508 거절도 시작 알림·기록이 남고 Authorization·Cookie·Proxy-Authorization 원문이 들어 있다. `writeRefusal(403)` → `HTTP/1.1 403 undefined`.
- `node scripts/probe/ui2-names.mjs`(Claude) → `localhost`·`LOCALHOST`·`localhost.` → `::1, 127.0.0.1`. `a.localhost`·`a.localhost.` → ENOTFOUND.

## 우회 사례 (V, 에이전트 번호)
**평문 absolute-form**
- V1 기본 표기 `127.0.0.1:P`, `localhost:P`, `LOCALHOST:P`, `HTTP://…` → 200 [확인됨: r2]. 대시보드 쪽에는 Via 검사만 남는다.
- V2 숫자·인코딩 표기 `127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`, `0x7f.1`, `%31%32%37.0.0.1`, `127.0.0.1.` — WHATWG URL이 `127.0.0.1`로 바꾼다 → 정규화된 hostname을 봐야 한다 [확인됨: r1, r2].
- V3 `0.0.0.0`, `0`, `0x0` — Windows에서 127.0.0.1 리스너에 닿는다. 지금의 SELF_HOSTS로는 못 잡는다 [확인됨: r1, r2, r8].
- V4 IPv4-mapped `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]` — 평문·CONNECT 모두 닿는다 [확인됨: r1~r3].
- V5 포트 표기 `:0P`, `:000P` → P. 대시보드 포트가 80이면 포트 없는 URL도 80 [확인됨: r1, r2].
- V6 userinfo `http://evil.com@127.0.0.1:P/` [확인됨: r2].
- V7 Host 헤더로 판단하면 놓친다 — URL을 봐야 한다 [확인됨: r2].

**이름 해석**
- V8 끝 점 `localhost.` — Windows가 루프백으로 푼다 [확인됨: ui2-names.mjs]. CONNECT의 parseConnectTarget은 그대로 둔다.
- V9 루프백으로 풀리는 이름(nip.io, localtest.me, hosts 파일, 리바인딩) — 이름이 아니라 해석된 주소를 봐야 한다 [확인됨: r3, 가짜 lookup].
- V10 평문 경로의 이중 해석: 평문은 주입 lookup을 쓰지 않고 연결할 때 다시 푼다 → 검사 뒤 재해석으로 비켜 간다 [확인됨: r4].
- V11 여러 주소 `[203.0.113.7, 127.0.0.1]` — 터널은 다음 주소로 넘어간다 → 모든 주소를 봐야 한다 [확인됨: r3].
- V12 localhost는 `::1`, `127.0.0.1` 순서 → `::1`만 보면 놓친다 [확인됨: r1, r3].

**CONNECT와 복호화**
- V13 불투명 터널 `CONNECT 127.0.0.1:P` → 200. 터널 안에는 Via가 없고 Host는 마음대로 → 대시보드의 Host·토큰 검사만 남는다 [확인됨: r3].
- V14 복호화 켬: CONNECT가 통과하고, 터널 안 요청이 대시보드에 TLS로 붙으려다 502. 기록에 Authorization·Cookie 원문(U16) [확인됨: r5].
- V15 복호화는 CONNECT 때 연결하지 않는다 → 그 포트에 나중에 뜬 서버에 터널 안 요청이 닿는다 [확인됨: r5 (b)].

**포트·시작 순서**
- V16 시작 순서: 프록시가 먼저 열리고 대시보드가 뒤에 뜬다. 포트를 나중에 알려 주면 그 사이 CONNECT가 V15처럼 남는다 [추측: index.ts].
- V17 대체 포트: 프록시 + 1이 차서 대시보드가 다른 포트에 열리면, +1을 막아도 소용없다 [추측: index.ts].
- V18 같은 포트: parseArgs·포트 점유 검사가 막지만 `startProxy` API에는 검사가 없다 [코드].

**사슬·다른 실행**
- V19 다른 로컬 프록시(두 번째 sumun, Fiddler)를 거친 사슬: `CONNECT 127.0.0.1:<프록시B>` 안에서 `CONNECT 127.0.0.1:<대시A>` → 토큰을 붙이면 200 [확인됨: r6].
- V20 다른 sumun 실행의 대시보드: 프록시 A는 B의 대시보드 포트를 모른다 [추측].

**기록·응답 문구**
- V21 거절해도 시작 알림·기록이 남고 토큰·쿠키 원문이 들어간다 → 대시보드 차단을 루프 검사 자리에 두면 토큰이 저장소에 쌓인다 [확인됨: r7].
- V22 `writeRefusal`의 REASON에 403이 없다 [확인됨: r7].
- V23 평문 거절 응답은 브라우저가 대시보드 출처로 보여 준다 → 입력을 넣지 않는다, nosniff·no-store가 없다 [확인됨: r7 응답 헤더].

**닿지 않는 것** [확인됨: r1~r3]: `127.0.0.2`, `127.255.255.254`, `[::1]`, `[::]`(ECONNREFUSED — 대시보드는 127.0.0.1에만 열림), CONNECT 숫자 표기(400).

## 오탐 (G — 막으면 안 됨)
- G1 루프백의 다른 포트(개발 앱, F5): `http://localhost:3000/`, `CONNECT localhost:3443`
- G2 원격 사이트의 같은 포트 번호: `http://example.com:8081/` — 해석한 주소가 루프백일 때만 막는다
- G3 `--no-dashboard`이면 대시보드 포트 번호는 일반 포트다
- G4 대체 포트로 열렸을 때 프록시 + 1을 쓰는 다른 프로그램
- G5 대시보드 없이 `startProxy`만 쓰는 API·기존 테스트
- G6 같은 포트 번호의 다른 루프백 주소(`127.0.0.2:P`, `[::1]:P`) — 막을지 정해야 함
- G7 Host 헤더만 대시보드인 요청(`GET http://example.com/` + `Host: 127.0.0.1:P`)
- G8 프록시 자기 포트는 계속 508
- G9 우회 안내가 사용자에게 보여야 한다(F2). CONNECT 거절 본문은 브라우저가 보여 주지 않는다. 기록을 빼면 터미널에도 남지 않는다
- G10 프록시를 거치지 않는 대시보드 직접 접속은 그대로

## UI-2 설계 결정 [추측 — Claude가 추천으로 정함, UI 보고서 결정 항목]
| # | 정한 것 | 사례 |
|---|---|---|
| E-1 판정 | 대시보드 포트 + 이 PC 자신을 뜻하는 주소(127/8, ::1, 0.0.0.0, ::, IPv4-mapped — 기존 `isSelfAddress`)면 막는다. 평문은 **정규화된 URL**(hostname·포트, 포트가 없으면 80)로, Host 헤더는 보지 않는다 | V1~V7, G2, G7 |
| E-2 같은 포트의 다른 루프백 주소 | 막는다(`127.0.0.2:P`, `[::1]:P`). 대시보드는 127.0.0.1에만 열리지만, 판정을 루프 검사와 같은 규칙으로 두는 편이 단순하다. 같은 포트 번호의 다른 루프백 서비스는 드물다 | G6 |
| E-3 이름 | 글자로 알아볼 수 있는 것(IP 표기, `localhost`, `localhost.`)은 **요청을 받자마자, 기록·시작 알림 전에** 막는다(기록 없음 — UI-T). 그 밖의 이름은 **한 번 해석한 주소**로 판정하고 그 주소로 연결한다. 평문도 `startProxy`의 `lookup`으로 해석한다(지금은 Node가 연결할 때 다시 푼다). 이름은 해석한 뒤에야 알 수 있으므로 시작 알림이 이미 나가서 **거절 기록(rejected 403)이 남는다**(이 경우 대시보드 토큰을 가진 요청은 아니다 — 사용자의 브라우저는 127.0.0.1·localhost로 연다) | V8~V12, V21 |
| E-4 CONNECT | 불투명 터널·복호화 모두 200 전에 403(복호화는 인증서 발급 전). 글자 판정은 시작 알림 전, 이름은 `checkConnect`의 해석 뒤 | V13~V15 |
| E-5 시작 순서 | `src/index.ts`가 **대시보드를 먼저 열고** 그 실제 포트를 `startProxy({ dashboardPort })`로 넘긴다(대체 포트여도 실제 포트). 대체 포트가 프록시 포트와 같으면 다시 고른다. 프록시 시작이 실패하면 지금처럼 한 줄 오류로 끝난다 | V16, V17, G4 |
| E-6 API | `dashboardPort`는 1~65535 정수만, 프록시 포트와 같으면 시작하지 않는다(TypeError). 주지 않으면 지금과 같다 | V18, G3, G5 |
| E-7 응답 | 403 Forbidden, 고정 문구(우회 안내: 프록시 예외 목록에 127.0.0.1·localhost), 입력을 넣지 않음, `nosniff`·`no-store`. CONNECT 거절에도 403 이유 문구 | V22, V23, F2 |
| E-8 터미널 안내 | `startProxy({ onDashboardRefused })`를 거절마다 부르고, `src/index.ts`는 실행마다 **한 번만** 안내 줄을 찍는다(기록이 없으니 요약 줄도 없다) | G9 |
| E-9 범위 밖 | V19(다른 로컬 프록시를 거친 사슬)·V20(다른 sumun 실행의 대시보드)은 X1(루프백 서비스 전체)과 같은 갈래로 남긴다. 대시보드의 Host·Origin·토큰 검사가 남는 방어다 | V19, V20 |
