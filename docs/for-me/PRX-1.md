# [PRX-1] HTTP 프록시: 요청 중계        커밋: 026ecac..(이 문서 커밋)

## 한 줄 요약
`127.0.0.1:8080`에서 브라우저나 curl의 HTTP 요청을 받아 **목적지 서버에 대신 보내고 응답을 돌려주는** 프록시를 만들었다. 열린 프록시, 루프, 위험한 요청은 막는다. HTTPS는 아직 지원하지 않는다(501).

## 큰 흐름 (실제 값, 2f1a5a9 실측)

```
curl -x http://127.0.0.1:18088 http://127.0.0.1:18090/hello?q=1
   │  GET http://127.0.0.1:18090/hello?q=1 HTTP/1.1          ← absolute-form (전체 URL)
   │  Host: 127.0.0.1:18090 / Proxy-Connection: Keep-Alive
   ▼
[프록시 127.0.0.1:18088]  server.ts
   │ ① absolute-form인가?        아니면 400   (웹페이지 fetch, DNS 리바인딩 차단)
   │ ② http인가?                 https면 501, 그 밖이면 400
   │ ③ 자기 자신을 가리키나?      맞으면 508   (주소 검사 + Via 검사)
   │ ④ 헤더 정리 (headers.ts)    Proxy-Connection 등 hop-by-hop 제거, Host를 URL 기준으로, Via: 1.1 sumun 추가
   ▼
목적지 127.0.0.1:18090 이 받은 것:  GET /hello?q=1   via=1.1 sumun   host=127.0.0.1:18090   proxy-connection 없음
   │
   ▼  응답도 같은 방식으로 헤더를 정리하고, 본문은 스트리밍으로 그대로 전달
curl이 받은 것:  HTTP/1.1 200 OK / via: 1.1 sumun / "hi from upstream"
```

다른 요청의 실제 결과:
| curl 명령 | 결과 |
|---|---|
| `curl -x … https://example.com/` (CONNECT) | `501 Not Implemented` — HTTPS는 TLS 단계에서 |
| `curl -x … http://127.0.0.1:18088/` (자기 자신) | `508 Loop Detected` |
| `curl http://127.0.0.1:18088/x` (프록시를 웹 서버처럼 직접 호출) | `400 Bad Request` |
| 닫힌 포트로 요청 (테스트) | `502 Bad Gateway`, 고정 문구의 text/plain |

## 보안 포인트 4가지
1. **127.0.0.1에만 연다** — `0.0.0.0`에 열면 같은 와이파이의 누구나 내 PC를 경유하는 **열린 프록시**가 된다. 그래서 바인딩 주소를 바꾸는 옵션을 아예 두지 않았다.
2. **origin-form(`GET /x`)은 거부한다** — 악성 웹페이지는 `fetch('http://127.0.0.1:8080/x')`로 이런 형태의 요청만 보낼 수 있다. 이걸 거부하면 웹페이지가 내 프록시를 중계기로 쓰는 길이 막힌다.
3. **루프를 막는다** — 자기 자신에게 요청을 보내면 끝없이 자신을 호출하다 자원이 바닥난다. 주소(127.0.0.1, localhost, [::1] + 내 포트)로 한 번, `Via: 1.1 sumun` 표시로 한 번 더 검사한다(**심층 방어**).
4. **오류 응답에 입력을 넣지 않는다** — 브라우저는 프록시의 오류 페이지를 *목적지 사이트의 출처*로 보여 준다. URL의 `<script>`를 그대로 되돌려 보내면 그 사이트에 XSS가 생긴다.

## 이번에 배운 것: 테스트 통과 ≠ 실제 동작
테스트 121개가 모두 통과한 뒤 **실제 curl로 HTTPS 요청을 한 번 보냈더니 프록시 프로세스가 죽었다**. curl은 501 응답을 받자마자 연결을 강제로 끊는데(ECONNRESET), 테스트 클라이언트는 정상적으로 닫았기 때문에 테스트로는 드러나지 않았다. 방식 문서의 "실측으로 확정한다(3행)"가 왜 필요한지 보여 주는 사례다. → 재현 테스트(`PRX-1-reset.test.ts`)를 먼저 쓰고 고쳤다.

## 작업 흐름 (커밋 순서)
1. `026ecac` 계획: 실측 바이트, 보안 사례 배정(PRX-1 / PRX-1b), 예상 E19~E21
2. `732b69b` 테스트 21개 — red에서 **테스트 자체의 결함 3건**을 찾아 커밋 전에 고침
3. `4a1bca2` headers.ts: hop-by-hop 정리, Via
4. `44bd8c9` server.ts: 프록시 본체 → 120/120
5. `29891e8` 테스트: CONNECT 직후 리셋 (실측에서 발견한 문제 재현)
6. `2f1a5a9` server.ts: CONNECT 소켓 오류 처리 → 121/121, 실측 재확인
7. (이 문서 커밋)

## 먼저 볼 코드
- `src/proxy/server.ts:15` — `BIND_HOST = '127.0.0.1'`. 이 한 줄이 열린 프록시를 막는다.
- `src/proxy/server.ts:37` — origin-form 거부. 웹페이지가 프록시를 악용하는 길을 막는 곳이다.
- `src/proxy/server.ts:51` — 루프 검사(주소 + Via).
- `src/proxy/server.ts:56` — Host를 요청 URL 기준으로 다시 쓴다. 클라이언트가 보낸 Host를 믿지 않는다.
- `src/proxy/headers.ts:10` — 지우는 hop-by-hop 헤더 목록. `proxy-authorization`이 있는 이유는 다른 프록시용 자격증명이 목적지 서버로 새지 않게 하기 위해서다.
- `src/proxy/server.ts:87` — 실측에서 발견한 문제를 고친 한 줄.

## 파일별 변경
### test/prx/_upstream.ts — 인터넷 대신 쓰는 로컬 목적지 서버, 프록시 경유 요청·CONNECT 도우미
### test/prx/PRX-1.test.ts — 21개 (사례 번호는 docs/ai/prx1-cases.md와 같음)
- `last()`는 **이번 테스트가 시작된 뒤 도착한 요청**만 본다. 그렇지 않으면 이전 테스트의 요청을 읽고 잘못 통과할 수 있다(red에서 발견).
### test/prx/PRX-1-reset.test.ts — CONNECT 직후 RST를 보내도 프록시가 살아 있는지
### src/proxy/headers.ts — `stripHopByHop`(14행 `PROTECTED`: Connection에 나열돼도 Host, Content-Length는 지킴), `addVia`, `hasOwnVia`
### src/proxy/server.ts — `startProxy({ port })`. 25행 `rawPath`: 경로는 URL 객체로 다시 조립하지 않고 원문 그대로 넘긴다(`..`이나 인코딩이 바뀌지 않게)
### docs/ai/prx1-cases.md — 검토 에이전트가 제안한 보안·경계 사례와 배정

## 아직 안 하는 것 → PRX-1b
타임아웃(504), 대용량 스트리밍 검증, 요청 스머글링 파서 검사, 포트 설정·충돌, Upgrade/h2c, IPv6·이상한 URL 표기 등. 목록은 `docs/ai/prx1-cases.md`의 배정 "1b".
