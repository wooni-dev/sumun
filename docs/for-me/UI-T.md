# [UI-T] UI 큰 단위 테스트: 대시보드 흐름과 보호        커밋: 0740342..(이 문서 커밋)

## 한 줄 요약
대시보드를 만들기 전에 "다 만들었을 때 이렇게 동작해야 한다"를 테스트 2개로 먼저 고정했습니다. 아직 대시보드 코드가 없어서 두 테스트는 **대기(todo)** 상태입니다. 마지막 작은 단위(UI-5)가 `src/dashboard/public/app.js`를 만들면 실제 검사로 바뀝니다.

## 흐름 (테스트 1)
```
 curl 평문 POST(쿠키) · 닫힌 포트 · CONNECT+TLS GET   ← 이전 큰 단위(PRX-T·TLS-T·STO-T)의 행동을 다시
        │
        ▼
 [프록시 8080] ──▶ [저장소] ──▶ [대시보드 127.0.0.1:8081]
                                  │
     브라우저 주소: http://127.0.0.1:8081/#t=<실행마다 새 토큰>
                                  │
   GET /            → 페이지(토큰 없이). CSP 'self'·frame-ancestors 'none'·no-store·nosniff, CORS 헤더 없음
   GET /api/flows   → 토큰 없으면 401 / Authorization: Bearer <토큰> → { runId, items: 요약 } (쿠키·본문 없음)
        ?method=POST · ?status=502 · ?host=localhost
   GET /api/flows/<id>                → 상세(헤더·쿠키 포함)
   GET /api/flows/<id>/body/request   → 원본 바이트(application/octet-stream)
   GET /api/events  → SSE. 새 요청이 끝나면 "done" 알림(본문 없음)
   POST /api/clear  → 204, 목록이 빈다 (GET은 405)
```

## 보호 (테스트 2)
| 시도 | 기대 | 왜(사례) |
|---|---|---|
| Host가 `evil.example:8081`, `127.0.0.1.nip.io:8081` | 403 | DNS 리바인딩(U1·U2) |
| Origin이 `http://evil.example`, 다른 포트 `http://127.0.0.1:8082`, `null` | 403 | 다른 사이트·다른 포트의 개발 서버(U4~U6, U11) |
| `Sec-Fetch-Site: cross-site`·`same-site` | 403 | 교차 사이트 요청(D-7) |
| `Via: 1.1 sumun` | 403 | 프록시를 거쳐 온 요청(D-5) |
| 위 Origin으로 SSE·지우기 | 403, 지워지지 않음 | WebSocket·CSRF와 같은 종류(U3, U6) |
| 프록시를 거쳐 `127.0.0.1:8081`·`localhost:8081`, `CONNECT 127.0.0.1:8081` | 200이 아니고 기록이 늘지 않음 | 지금은 그대로 중계되고 기록까지 됨(실험 E1~E9) |
| 정상: Host `localhost:8081`, 같은 Origin, `Sec-Fetch-Site: same-origin`·`none`, 헤더 없는 curl | 200 | 막으면 안 되는 사용(F1, F3, F4) |
위 표의 8081은 예시입니다. 테스트는 빈 포트를 그때그때 받아서 씁니다.

## 정한 것 (사용자: "모두 추천대로", `docs/ai/ui-cases.md` D-1~D-16)
- 대시보드는 프록시와 **다른 포트**(기본 8081)에 열고, 토큰은 **실행마다 새로** 만듭니다.
- 토큰은 주소의 `#` 뒤에 있습니다. `#` 뒤는 서버·프록시·Referer로 가지 않습니다. 페이지 JS가 읽어서 요청 헤더로 보냅니다. **쿠키를 쓰지 않아** CSRF가 원리상 생기지 않습니다.
- 실시간 통로는 SSE이고, WebSocket은 쓰지 않습니다.
- 할 수 있는 것은 읽기와 모두 지우기뿐입니다. HTML 본문은 화면에 렌더링하지 않습니다. CDN은 쓰지 않습니다.

## 큰 단위 테스트가 고정한 모양
`startDashboard({ store, port })` → `{ port, token, url, close() }`, `startProxy({ …, dashboardPort })`, 위 경로들과 상태 코드. 작은 단위에서 이 모양을 바꿔야 하면 UI 보고서의 결정 항목으로 올립니다.

## 확인한 것
| 예상 | 결과 |
|---|---|
| E167 `npm run test:red -- test/ui/UI-T.test.ts` → 2개 모두 ERR_MODULE_NOT_FOUND | 일치 [확인됨] |
| E168 `npm test` 종료 코드 0, "큰 단위 대기(todo) UI: 2개, 그중 실패 2개" | 일치 — 705개 중 703 통과, 대기 2 [확인됨] |
| E169 옮긴 실험 스크립트가 에이전트와 같은 결과 | 일치 — 프록시가 대시보드 포트로 그대로 중계하고(200, 비밀 반환) 기록까지 함, 터널은 Via 없이 닿음 [확인됨] |

## 범위 밖
- 프록시는 같은 PC의 모든 루프백 서비스(예: `localhost:3000` 개발 서버)로 중계합니다. 그래서 리바인딩 공격이 개발 서버에도 닿을 수 있습니다(X1). 개발 앱을 기록하는 것이 주된 사용 사례라 막지 않습니다. UI 보고서의 결정 항목으로 올립니다.

## 먼저 볼 코드
- `test/ui/UI-T.test.ts:155` — `UI 흐름` 테스트: 이전 행동 → 페이지·API·SSE·지우기
- `test/ui/UI-T.test.ts:274` — `UI 보호` 테스트: 403 사례와 프록시를 거친 요청
- `scripts/probe/ui-review/e1.mjs:1` — 실험: 프록시를 거쳐 대시보드로 가는 요청이 중계·기록됨
