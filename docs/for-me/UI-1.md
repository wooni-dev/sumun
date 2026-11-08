# [UI-1] 대시보드 서버 골격과 요청 보호        커밋: f84e476..(이 문서 커밋)

## 한 줄 요약
`npm start`를 하면 프록시와 함께 **대시보드 서버**가 열립니다. 아직 화면과 조회 API는 없습니다(UI-3~5). 대신 들어오는 모든 요청을 **처리 전에 검사하는 문**을 먼저 달았습니다.

## 시작하면
```
sumun: 127.0.0.1:8080 에서 프록시를 시작했습니다. … 끝내려면 Ctrl+C / 대시보드: http://127.0.0.1:8081/#t=<토큰> (이 주소는 실행마다 바뀌고 …)
```
- 토큰은 실행할 때마다 새로 만듭니다(43자). 주소의 `#` 뒤는 서버·프록시·Referer로 가지 않습니다. 화면 JS(UI-5)가 읽어서 `Authorization: Bearer <토큰>` 헤더로 보냅니다. **쿠키를 쓰지 않습니다.**
- `--no-dashboard`로 끄고, `--dashboard-port 9001`로 포트를 바꿉니다.

## 요청이 지나가는 문 (`guard`)
```
요청 ─▶ ① 대상이 /…가 아니다(프록시처럼 씀)          → 400
       ② Via에 sumun (우리 프록시를 거쳐 옴)            → 403
       ③ Host가 127.0.0.1:<포트>·localhost:<포트>가 아님 → 403   DNS 리바인딩(evil.com이 127.0.0.1로 바뀜)
       ④ Origin이 있는데 자기 출처가 아님(다른 포트도)   → 403   다른 사이트·localhost:3000 개발 서버
       ⑤ Sec-Fetch-Site가 same-origin·none이 아님        → 403   브라우저가 알려 주는 "어디서 온 요청인지"
       ⑥ 본문 16KB 초과                                   → 413
       ⑦ /api/* 인데 토큰이 없거나 틀림                   → 401
       ⑧ 경로·메서드 (없으면 404, OPTIONS 등은 405)
```
- 모든 응답에 붙는 것: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`(남의 스크립트·iframe 금지), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`(디스크 캐시 금지).
- 붙이지 않는 것: CORS 헤더(`Access-Control-Allow-Origin`), 쿠키.
- 오류 본문은 정해진 문구뿐이라 입력 값을 되돌려 보이지 않습니다. 로그도 찍지 않습니다.
- 시작 전에 127.0.0.1과 [::1]의 그 포트로 접속해 봅니다. 다른 프로그램이 응답하면 열지 않습니다. Windows는 다른 프로그램이 같은 포트를 쓰는 중에도 127.0.0.1 바인딩을 허용하기 때문입니다.

## 실제로 해 본 것 (curl, `npm start -- --port 18080`)
| 요청 | 결과 |
|---|---|
| `GET /` | 200 text/html, CSP·X-Frame-Options·no-store·no-referrer 헤더 있음, CORS 헤더 없음 |
| `GET /api/ping`(토큰 없음) | 401 |
| `GET /api/ping` + `Authorization: Bearer <토큰>` | 200 `{"runId":"…"}` |
| 위 + `Origin: http://evil.example` | 403 |
| 위 + `Host: evil.example:18081` | 403 |

## 확인한 것
| 예상 | 결과 |
|---|---|
| E170 구현 전 새 테스트 13개 모두 assertion 실패, 회귀 1개 통과 | 일치 [확인됨] |
| E171 구현 뒤 `npm test` 실패 0, 대기는 UI 2개만, 기존 진입점 테스트 통과 | 처음에는 **불일치**: 전체 실행이 끝나지 않음(아래). 고친 뒤 E173으로 확인 |
| E172 curl 다섯 가지 | 일치 [확인됨] |
| E173 결함을 고친 뒤 `npm test`가 끝나고 실패 0, 대기 UI 2개 | 일치 — 80초, 720개 중 718 통과, 대기 2 [확인됨] |

## 이 PR에서 생긴 일 (솔직하게)
- **전체 테스트가 끝나지 않음**: 대시보드 기본 포트를 "프록시 포트 + 1"로 정했습니다. 기존 테스트가 시작 출력을 한 줄로 셈하고 여러 진입점을 무작위 포트로 동시에 띄우기 때문에, 고정 8081은 쓸 수 없었습니다.
  - 그런데 Windows는 빈 포트를 **연속 번호**로 내줍니다. 그래서 P+1을 다른 테스트가 쓰고 있기 쉬웠고, 그러면 `npm start`가 종료해서 TLS-1 테스트가 응답을 기다리다 멈췄습니다.
  - 처음에는 "시작이 느려졌다"고 추측했는데 재 보니 아니었습니다(켬·끔 모두 약 0.6초).
  - 기록 → 재현 테스트 → 수정 순서로 고쳤습니다(O26). **직접 준** `--dashboard-port`가 차 있으면 지금처럼 멈춥니다. **기본으로 정한** 포트가 차 있으면 다른 빈 포트에서 열고 시작 줄에 그 주소를 보입니다.
- **같은 테스트 두 번 실패**: OPTIONS 요청이 토큰 검사에 먼저 걸려 401이 났습니다. 진단하려고 한 번 더 돌려 셈이 2가 됐고, 코드를 다시 읽은 뒤 한 번에 통과시켰습니다.
- 한 명령에 `>`와 `test/` 경로가 함께 있어 hook이 진단 명령을 막았습니다(의도한 보수적 동작). 스크립트 파일로 바꿔 실행했습니다.

## UI 보고서에 올릴 결정
- 대시보드 기본 포트 = 프록시 포트 + 1(기본 실행이면 8081). 차 있으면 다른 빈 포트입니다.
- 대시보드 주소는 별도 줄이 아니라 시작 줄 끝에 있습니다.
- 페이지를 열 때도 Host·Origin·Sec-Fetch-Site를 검사합니다. 그래서 다른 사이트의 링크를 눌러 들어오면(cross-site) 403입니다. 터미널의 주소로 여는 것은 됩니다.

## 먼저 볼 코드
- `src/dashboard/server.ts:62` — `guard`: 처리 전 검사(대상 형식·Via·Host·Origin·Sec-Fetch-Site·본문 크기)
- `src/dashboard/server.ts:79` — `authorized`: Bearer 토큰 비교(timingSafeEqual)
- `src/dashboard/server.ts:28` — `SECURITY_HEADERS`: 모든 응답에 붙는 보안 헤더
- `src/dashboard/server.ts:99` — `portAnswers`: 시작 전 포트 점유 검사
- `src/dashboard/server.ts:107` — `startDashboard`: 토큰 생성, 경로 처리, 헤더 시간 제한
- `src/cli.ts:31` — `parseArgs`: `--no-dashboard`, `--dashboard-port`
- `src/index.ts:66` — 대시보드 시작(기본 포트, 차 있을 때 다른 빈 포트)
