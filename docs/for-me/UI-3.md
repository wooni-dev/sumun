# [UI-3] 조회 API        커밋: fa7a8ee..(이 문서 커밋)

## 한 줄 요약
대시보드에서 **기록을 꺼내 볼 수 있는 API**가 생겼습니다. 목록, 상세, 본문, 지우기입니다. 화면(UI-5)은 아직 없어서, 지금은 curl로만 볼 수 있습니다. 모든 API는 UI-1의 문(Host·Origin·토큰 검사)을 먼저 통과해야 합니다.

## API
| 요청 | 응답 |
|---|---|
| `GET /api/flows` | `{ runId, items: [요약…], next }` — 오래된 것부터, 한 번에 최대 500건 |
| `GET /api/flows?method=POST&status=502&host=example.com` | 조건에 맞는 것만(AND). host는 하위 도메인까지 |
| `GET /api/flows?after=<next>` | 다음 쪽. `next`가 `null`이면 끝 |
| `GET /api/flows/<id>` | 상세: 요청·응답의 머리(헤더 원본 그대로 — 쿠키 포함), 본문은 크기만 |
| `GET /api/flows/<id>/body/request` · `/body/response` | 본문 원본 바이트 |
| `POST /api/clear` + `Content-Type: application/json` | 204, 기록을 모두 지움 |

- 목록 요약에는 쿠키·헤더·본문이 **없습니다**. 쿠키가 들어 있는 것은 상세뿐입니다.
- 모든 요청에 `Authorization: Bearer <토큰>`이 필요합니다. 토큰은 터미널에 나온 주소의 `#t=` 뒤입니다.

## 왜 이렇게 만들었나 (보안)
- **본문은 따로, 내려받기로만 줍니다**(U20): `application/octet-stream` + `Content-Disposition: attachment`.
  - 기록된 응답이 HTML이나 SVG일 때 원래 형식으로 보내면, 브라우저가 그 내용을 **대시보드 출처에서 실행**할 수 있습니다. 그러면 기록 전체가 털립니다.
  - 그래서 "그냥 바이트 덩어리, 열지 말고 저장"이라고 알려 줍니다.
- **지우기는 POST + JSON만** 받습니다(U6·U7).
  - 다른 사이트가 폼이나 `<img>`로 몰래 보낼 수 있는 요청(GET, 폼 형식 POST)으로는 지울 수 없게 했습니다.
  - 다른 출처에서 JSON을 보내려면 브라우저가 먼저 사전 확인(OPTIONS)을 하는데, 대시보드는 그것에 405로 답합니다.
- **조건이 잘못되면 400 고정 문구**를 냅니다(U30).
  - 모르는 이름, 같은 이름 두 번, 숫자가 아닌 status 같은 경우입니다.
  - 받은 값을 응답에 다시 넣지 않습니다. 넣으면 공격자가 대시보드 화면에 글자를 끼워 넣을 수 있습니다.
  - 오타(`mehtod=POST`)가 조용히 "전체"로 바뀌지 않게 하는 효과도 있습니다.
- **한 번에 500건까지**(U35): 1만 건을 한 번에 달라고 해도 500건만 줍니다. 본문은 목록·상세에 넣지 않습니다.
- **GET은 아무것도 바꾸지 않습니다**(U7). 바꾸는 것은 `/api/clear`의 POST 하나뿐입니다.

## 실제로 해 본 것 (curl, `npm.cmd start -- --port 18080`, 목적지는 127.0.0.1:18090의 작은 서버)
| 명령 | 결과 |
|---|---|
| `curl.exe -x http://127.0.0.1:18080 -H "Cookie: k=CURL-COOKIE" --data-binary curl-body http://127.0.0.1:18090/x` | `upstream-saw:curl-body` |
| `curl.exe -i -H "Authorization: Bearer <토큰>" http://127.0.0.1:18081/api/flows` | 200, `application/json`, `no-store`, 1건(POST /x, 200), 쿠키 없음 |
| `…/api/flows/1` | 상세에 `CURL-COOKIE` 있음 |
| `…/api/flows/1/body/request` | 200 `application/octet-stream`, `attachment; filename="body.bin"`, 본문 `curl-body` |
| `curl.exe -X POST -H "Content-Type: application/json" -d "{}" …/api/clear` | 204, 다시 목록 → `items: []` |

## 확인한 것
| 예상 | 결과 |
|---|---|
| E178 구현 전 새 테스트 모두 assertion 실패, 회귀 통과 | 일치 — 8개 AssertionError, 오류 0(테스트 구조 하나를 커밋 전에 고침, 아래), 회귀 1 통과 [확인됨] |
| E179 구현 뒤 `npm test` 실패 0, 대기 UI 2개 | 일치 — 744개 중 742 통과, 80초. 대기 2개 중 실패는 이제 1개(UI-T 보호 테스트가 실제로 통과) [확인됨] |
| E180 curl 다섯 가지 | 일치 [확인됨] |

## 이 PR에서 생긴 일 (솔직하게)
- **처음 red에서 오류 하나**: 404 문구를 JSON으로 읽다가 해석 오류가 났습니다. 상태 200을 먼저 확인하도록 테스트 구조를 고쳤습니다. 기대값은 그대로입니다(O48).
- **중간에 UI-2의 결함 발견 → UI-2b로 먼저 고침**: 구현 중에 UI-1 테스트가 실패했습니다. 원인은 포트 점유 검사의 self-connect였습니다(`docs/for-me/UI-2b.md`). 결정하신 대로(A) UI-3을 멈추고 UI-2b를 먼저 끝냈습니다.
- **브랜치를 옮기다 hook 알림**: UI-3 커밋 4개를 새 `main` 위로 옮겼는데(rebase), hook(규칙 D)이 "브랜치가 바뀐 뒤 커밋이 생김"으로 알렸습니다. 결정하신 대로(A) 그대로 두었습니다. 커밋 해시가 바뀌었습니다: 계획 `26fe94b`→`fa7a8ee`, 테스트 `51e5799`→`861fe21`, api.ts `4b055fa`→`f8c9730`, server.ts `4a74056`→`f805543`.

## UI 보고서에 올릴 결정 (추천으로 진행, STO 보고서 결정 6 포함)
| 정한 것 | 다른 선택지 |
|---|---|
| 목록은 오래된 것부터 + `after`로 다음 쪽. 최신 순·`before`·전체 개수는 없음 | 최신 순 기본(화면은 보통 최신이 위) |
| 요약 칸은 지금 그대로. content-type·잘림 여부는 상세에서 봄 | 요약에 content-type 추가 |
| `limit`이 500보다 크면 거절하지 않고 500으로 줄임 | 400으로 거절 |
| 지우기는 Content-Type이 정확히 `application/json`일 때만(매개변수 `; charset=…`는 허용) | 본문 JSON까지 검사 |
| rebase를 hook이 "브랜치 변경"으로 알림 — 의도한 보수적 동작으로 둠 | rebase를 규칙 D 예외로 |

## 먼저 볼 코드
- `src/dashboard/api.ts:65` — `handleApi`: 경로·메서드별 처리(목록·상세·본문·지우기)
- `src/dashboard/api.ts:29` — `parseQuery`: 목록 조건 검사(이름 제한, 숫자, limit 500)
- `src/dashboard/api.ts:46` — `detailOf`: 본문을 뺀 상세
- `src/dashboard/server.ts:92` — `sendApi`: 결과를 응답으로(본문은 octet-stream + attachment)
- `src/dashboard/server.ts:173` — `/api/*` 분기에서 `handleApi` 호출
