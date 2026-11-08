# UI-6 사례: 화면 고침 (O10: 검토 에이전트가 제안)

출처: 2026-11-08, 별도 컨텍스트의 검토 에이전트가 `src/dashboard/`, `src/proxy/`, `src/tls/`, `src/index.ts`, `test/ui/`를 읽고 Chrome 156 headless(CDP)와 Node 24.21.0으로 실험했다. 작업자는 요구 1~7(UI 보고서 결정 1·3·4·5·6·8·9)만 알려 주고 해결안은 알려 주지 않았다. 실험 스크립트는 `scripts/probe/ui6-review/`(실측 커밋, 실행: `node scripts/probe/ui6-review/<파일>`).

요구: 1 필터 갱신(최대 1초) · 2 터널 "실패 aborted" 표시 · 3 토큰을 주소창에 남기지 않음(메모리에만 — 사용자 결정) · 4 favicon 404 · 5 헤더·상태 문구 UTF-8 다시 풀기 · 6 403 문구 · 7 loopback 안내.

## 사례 (요약)
| # | 요구 | 내용 | 심각도 | 확인 |
|---|---|---|---|---|
| K1 | 1 | 알림이 계속 오면 갱신 0번(200ms마다 3초 → 0번, 멈춘 뒤 400ms → 1번) | 높음 | [확인됨] filter-starve.mjs |
| K2 | 1 | 겹친 조회에서 늦게 끝난 옛 결과가 새 결과를 덮음 | 높음 | [확인됨] filter-starve.mjs |
| K3 | 1 | 조회 도중 필터를 바꾸면 옛 조건 결과가 새 조건 이름으로 보임 | 중간 | [추측: 코드] |
| K4 | 1 | 앞쪽에서만 갱신하면 마지막 알림이 빠짐 | 중간 | [추측] |
| K5 | 1 | 조회 한 번 실패로 갱신이 영영 멈춤("조회 중"을 예외에서 안 풂) | 중간 | [추측] |
| K6 | 1 | 1초마다 최대 20쪽×500건 조회가 겹치면 같은 프로세스의 프록시가 느려짐 — 동시 실행 1개 이하 | 중간 | [추측] |
| K7 | 1 | 숨은 탭은 Chrome이 타이머를 늦춤 — "보이는 탭 기준"으로 판정 | 낮음 | [추측] |
| K8 | 5 | 다시 풀면 지금 숨은 문자 목록이 못 잡는 글자가 나옴: U+3164, 태그 문자 U+E0041, U+2028, U+FE0F, U+206A, U+034F, U+180E, U+FFF9 (U+202E·U+FEFF는 잡힘) | 높음 | [확인됨] utf8-headers.mjs |
| K9 | 5 | 상태 문구를 다시 푼 뒤 showHidden을 안 하면 U+202E가 그대로 | 높음 | [확인됨] utf8-headers.mjs |
| K10 | 5 | 원본 16진을 TextEncoder로 만들면 이중 인코딩(`â` → `c3 a2`) | 중간 | [확인됨] |
| K11 | 5 | 잘못된 UTF-8을 느슨하게 풀면 서로 다른 원본이 모두 `�` | 중간 | [확인됨] |
| K12 | 5 | 진짜 latin1 `Ã©`도 `é`로 바뀜 — 다시 푼 칸은 표시하고 원본을 보여야 | 중간 | [추측] |
| K13 | 5 | U+00FF보다 큰 글자가 섞인 값을 `& 0xFF`로 바이트로 만들면 다른 글자 | 낮음 | [확인됨] |
| K14 | 3 | 주소창을 지워도 Chrome이 토큰 주소를 프로필(History, Sessions, Tabs, ukm_db, Top Sites)에 이미 씀 — 페이지 코드로 못 막음 | 높음(한계) | [확인됨] token-trace.mjs, favicon-db.mjs |
| K15 | 3 | history.state·window.name에 숨기면 남음 | 중간 | [확인됨] token-trace.mjs |
| K16 | 3 | pushState류는 "뒤로"에 `#t=`가 돌아옴. `location.hash=''`는 끝에 `#`이 남음 | 중간 | [확인됨] |
| K17 | 3 | 같은 탭에 새 `#t=` 주소를 붙이면 다시 로드되지 않아 새 토큰이 주소창에 남고 읽히지 않음 | 중간 | [확인됨] fragment-nav.mjs |
| K18 | 3 | 실패 경로(401, ping 실패, 서비스 워커 경로)에서 주소가 그대로 | 중간 | [추측] |
| K19 | 3 | 403 화면은 app.js가 안 돌아 주소의 토큰을 지울 수 없음 | 중간(한계) | [확인됨] entry-403.mjs |
| K20 | 3 | 새로고침 뒤 문구가 "토큰이 없습니다…그대로 여세요"로 새 동작과 안 맞음 | 낮음 | [추측] |
| K21 | 4 | `data:` 아이콘은 CSP 위반 오류 | 중간 | [확인됨] token-trace.mjs |
| K22 | 4 | headless Chrome은 link 없으면 `/favicon.ico`를 요청하지 않음 — "콘솔 오류 없음"만으로는 못 봄(O30) | 중간 | [확인됨] |
| K23 | 4 | 새 경로가 Host·Via·메서드 검사·보안 헤더를 건너뜀 | 낮음 | [추측] |
| K24 | 4 | Favicons DB가 페이지 URL(토큰 포함)을 키로 씀 | 낮음 | [추측] |
| K25 | 7 | `<-loopback>`만 안내하면 대시보드도 프록시로 가서 403 | 높음 | [확인됨] chrome-bypass.mjs B |
| K26 | 7 | 대시보드 예외를 `<-loopback>`보다 앞에 두면 효과 없음 | 중간 | [확인됨] chrome-bypass.mjs D |
| K27 | 7 | 지금 문구("127.0.0.1과 localhost를 넣으세요", 포트 없음)를 따르면 127.0.0.1 개발 서버가 기록되지 않음 | 중간 | [확인됨] chrome-bypass.mjs E |
| K28 | 7 | 기본 대시보드 포트가 차면 다른 포트 — 안내의 포트가 실제와 같아야 | 중간 | [추측: index.ts] |
| K29 | 7 | Windows 시스템 프록시·Firefox는 실측 안 함 — 안내 범위를 "Chrome·Edge `--proxy-server`"로 | 낮음 | [추측] |
| K30 | 7 | 거절 문구에 요청 내용을 넣지 않음(포트는 설정값만) | 낮음 | [추측] |
| K31 | 2 | "aborted + 바이트 있음 = 정상"이면 목적지가 끊은 T5(`by: upstream`)도 정상으로 보임 | 높음 | [확인됨] tunnel-abort.mjs |
| K32 | 2 | 목적지 무응답 T3(↓0)·아무것도 안 보냄 T4를 up·합계만 보면 정상으로 보임 | 높음 | [확인됨] tunnel-abort.mjs |
| K33 | 2 | TLS alert 몇 바이트 뒤 RST도 T1 모양 — "정상"이 아니라 "브라우저가 연결을 닫음 + 바이트 수" | 중간 | [추측] |
| K34 | 2 | 터널이 아닌 기록·복호화 CONNECT는 표시 그대로, 원래 값은 상세에 남김, 목록과 상세 같은 뜻 | 중간 | [추측] |
| K35 | 6 | 403 원인(same-site 링크, cross-site, Host, Via, Origin)이 여럿인데 문구 하나 — 모두에 "터미널 주소를 주소창에 직접"이 먼저 | 중간 | [확인됨] entry-403.mjs |
| K36 | 6 | 원인별 문구로 나누면 입력이 섞일 수 있음 — 본문 바이트 고정, text/plain, nosniff | 중간 | [추측] |
| K37 | 6 | 문구가 "이 주소를 복사해…"처럼 토큰 주소를 퍼뜨리게 안내하면 안 됨 | 낮음 | [추측] |

tunnel-abort.mjs 실측값 [확인됨: 에이전트]: T1 데이터 뒤 클라이언트 RST `{by: client, code: aborted}` ↑5 ↓5 · T2 FIN → 오류 없음 · T3 목적지 무응답 뒤 RST `client/aborted` ↑14 ↓0 · T4 아무것도 없이 RST `client/aborted` ↑0 ↓0 · T5 목적지가 일부 보낸 뒤 RST `upstream/aborted` ↑1 ↓7.
chrome-bypass.mjs [확인됨: 에이전트]: A `--proxy-server`만 → 대시보드·개발 서버 모두 직접 · B `<-loopback>` → 모두 프록시 · C `<-loopback>;127.0.0.1:D;localhost:D` → 대시보드 직접, 개발 서버 프록시 · D 순서 반대 → 모두 프록시 · E `<-loopback>;127.0.0.1` → 127.0.0.1은 둘 다 직접, localhost는 둘 다 프록시.

## 범위 밖 (기록만)
- X1 본문·URL에도 K8 글자가 표시 없이 나옴(본문은 이미 UTF-8로 풂) — showHidden을 넓히면 함께 바뀐다(G-5).
- X2 사용자가 직접 연 페이지의 302로 대시보드에 가면 Sec-Fetch-Site `none`이라 통과 — 토큰이 없어 피해 낮음 [추측].
- X3 터미널 요약 줄(`src/cli.ts` formatSummary)도 터널 실패 표시로 같은 오해 [추측].
- X4 API가 403을 받으면 app.js는 401만 처리해 "연결 중"에 멈춤 [추측].
- X5 `<-loopback>`을 쓰면 다른 로컬 도구의 비밀(Jupyter `?token=` 등)도 기록됨 — 안내에 적는다(G-7).

## 설계 결정 [추측 — 작업자, 2026-11-08]
- G-1 필터 갱신(K1~K7): view.js `createRefresher(task, { waitMs: 300, maxWaitMs: 1000, timers })` — 알림이 오면 300ms 뒤, 계속 와도 첫 알림부터 1초 안에는 반드시 실행(끝쪽 실행 포함, K4). 실행은 한 번에 하나(K2·K6), 실행 중 온 요청은 끝난 뒤 한 번 더. task가 throw해도 다음 요청을 받는다(K5). app.js의 필터 적용(applyFilter)도 이 refresher로 바로 실행(`now()`)하고, loadFiltered는 끝난 뒤 조건이 바뀌었으면 결과를 버린다(K3). 판정은 보이는 탭 기준(K7).
- G-2 터널 표시(K31~K34): view.js `tunnelOutcome(record)` — 터널 기록이고 오류가 `{by: client, code: aborted}`이며 ↑>0 **그리고** ↓>0일 때만 `closed`("끝남 — 브라우저가 연결을 닫음"), 그 밖의 터널 오류는 `failed`, 오류 없으면 `ok`, 터널이 아니면 null(표시 그대로). 상세는 `closed`일 때 "실패" 대신 "끝남" 줄 + 원래 값 `aborted (client)`를 함께, 목록은 `failed`면 "터널 실패"(빨강). 기록·터미널 줄은 바꾸지 않는다(X3은 범위 밖).
- G-3 토큰(K14~K20, 사용자 결정 "메모리에만"): app.js가 다른 일보다 먼저 토큰을 읽고 `history.replaceState(null, '', pathname + search)`로 주소에서 `#…`를 지운다(새 기록 항목 없음, state null — K15·K16, 모든 실패 경로보다 앞 — K18). 같은 탭에서 새 `#t=`로 이동하면(hashchange) 페이지를 다시 읽어 새 토큰으로 연다(K17). 토큰이 없을 때 문구는 "새로고침하면 토큰이 사라진다 + 터미널 주소를 주소창에 붙여 넣으라"(K20). history.state·window.name·저장소를 쓰지 않는다. **K14(프로필에 남는 것)와 K19(403 화면)는 페이지가 막을 수 없는 한계** → UI 마무리 보고의 결정 항목(O28).
- G-4 아이콘(K21~K24): `public/favicon.svg`(스크립트 없는 작은 SVG)를 PUBLIC 목록에 두고 index.html에 `<link rel="icon" href="/favicon.svg">`. `/favicon.ico`는 204(본문 없음). 둘 다 기존 guard(Host·Origin·Sec-Fetch-Site·Via)·메서드 검사·보안 헤더를 그대로 탄다(K23). data: 아이콘은 쓰지 않는다(K21). K24는 K14와 같은 한계.
- G-5 헤더 다시 풀기(K8~K13): view.js `utf8View(s)` — 모든 글자가 U+00FF 이하(K13)이고 U+0080 이상이 하나라도 있을 때만, 그 글자들을 바이트로 보고 `TextDecoder('utf-8', { fatal: true })`로 푼다. 실패하면 null(K11 — 지금 표시 그대로). 화면은 푼 글자에 showHidden을 적용하고(K9) "(UTF-8로 풀어 보임 · 원래 바이트 61 e2 80 ae …)"를 붙인다(K10·K12 — 바이트는 글자 코드 그대로, TextEncoder 아님). 헤더 값과 응답 상태 문구에. showHidden 목록을 넓힌다: U+034F, U+115F·U+1160, U+180E, U+2028·U+2029, U+206A~U+206F, U+3164, U+FFA0, U+FFF9~U+FFFB, U+E0000~U+E007F(K8). **U+FE0E·U+FE0F(이모지 표시 선택자)는 넣지 않는다** — 본문·제목의 이모지마다 표시가 붙기 때문이다(K8의 U+FE0F는 재배정 → UI 마무리 보고 결정 항목, O28).
- G-6 403 문구(K35~K37): 대시보드 고정 403 문구를 "터미널에 나온 대시보드 주소를 주소창에 직접 붙여 넣어 여세요"로 시작하고, 받지 않는 경우(다른 페이지의 링크, 다른 주소 이름, 프록시를 거친 요청)는 그 뒤에. 원인별로 나누지 않는다(K36). "이 주소를 복사"라고 쓰지 않는다(K37). "프록시를 거치지 않고"는 넣지 않는다(UI-2 테스트의 구별 표지).
- G-7 loopback 안내(K25~K30, X5): 프록시 거절 문구 `DASHBOARD_REFUSAL`과 터미널 안내를 같은 규칙으로 — "Chrome·Edge는 --proxy-server만 주면 127.0.0.1·localhost를 원래 프록시로 보내지 않는다. 로컬 개발 서버까지 기록하려고 `<-loopback>`을 줬다면 대시보드 주소를 **그 뒤에** 덧붙인다: `<-loopback>;127.0.0.1:<포트>;localhost:<포트>`". 거절 문구는 고정이라 `<대시보드 포트>` 글자 그대로(K30), 터미널 안내는 실제 `dash.port`(K28). Windows 시스템 프록시·Firefox는 실측하지 않았다고 적는다(K29). X5(다른 로컬 도구의 비밀도 기록됨)를 사용자 문서에 적는다.
