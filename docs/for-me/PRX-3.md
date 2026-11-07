# [PRX-3] Flow 모양 보완: 시작 알림, 목적지 칸, 본문 도중 타임아웃, 실패 코드        커밋: 16f45e4..(이 문서 커밋)

## 한 줄 요약
PRX 보고서에서 승인한 결정 2, 3, 4, 10을 반영했다. 기록(Flow)은 TLS, 저장소, 대시보드가 모두 기대는 모양이라 **TLS 전에 확정**했다.

## 바뀐 것
| 결정 | 전 | 후 |
|---|---|---|
| 2 시작 알림 | 요청이 **끝나야** 기록이 옴 → 오래 걸리는 다운로드·스트림이 목록에 안 보임 | 새 옵션 `onFlowStart`: 요청을 받자마자 알림 1번. 끝 기록(`onFlow`)과 **같은 id** |
| 3 목적지 칸 | `url` 원문만 | `request.target = { scheme, host, port, path }` |
| 4 본문 도중 타임아웃 | 응답 도중에도 30초 쉬면 끊음 → SSE·롱폴이 끊김 | 응답 헤더 전 30초(`upstreamTimeoutMs`), 헤더 뒤 5분(`upstreamBodyTimeoutMs`) |
| 10 실패 코드 | 깨진 응답도 `unreachable`(연결 불가) | 깨진 응답은 `bad-response`, 연결 실패만 `unreachable` |

## 실제 curl로 본 시작 알림 (`node scripts/probe/prx3-curl.mjs`)
목적지가 300ms 간격으로 세 번 나눠 보내는 스트림이다.
```
 239ms 시작 알림 #1 GET target={"scheme":"http","host":"127.0.0.1","port":18095,"path":"/stream?x=1"}
1195ms 끝 기록   #1 상태 200 본문 21바이트 error=null
1208ms curl 1) 300ms 간격 스트림 응답 끝 → 200
```
시작 알림이 **약 1초 먼저** 온다. 대시보드는 시작 알림으로 "대기 중" 줄을 만들고, 끝 기록이 오면 같은 id의 줄을 채우면 된다. 웹 개발로 치면 `fetch`를 보낼 때 목록에 "pending" 행을 먼저 그리고, 응답이 오면 그 행을 갱신하는 것과 같다.

## 왜 `onFlow`를 두 번 부르지 않고 새 옵션을 만들었나
`onFlow`를 "시작·끝 두 번"으로 바꾸면 PRX-2의 테스트("요청당 정확히 1번")를 고쳐야 한다. 개발 중에는 커밋된 테스트를 고치지 않는 것이 규칙이다. 그리고 "끝 기록만 필요한 쪽"(예: 파일 내보내기)은 지금처럼 쓰면 된다.

## target의 규칙
- `host`: 소문자(`https://Example.COM/x` → `example.com`). IPv6는 `[::1]`처럼 대괄호.
- `port`: 숫자. 생략하면 http 80, https 443.
- `path`: 목적지로 보내는 경로와 **같은 원문**(`/a/../b?x=1`, `..`를 정리하지 않음, `#조각`은 뺌). 그래서 경로 계산 함수 `rawPath`를 `flow.ts`로 옮겨 둘이 같은 규칙을 쓴다.
- 해석할 수 없는 요청(`GET /x` 같은 origin-form)은 `target` 없음. 프록시는 Host 헤더를 믿지 않기 때문이다.

## 실패 코드를 나눈 근거 (`node scripts/probe/prx3-errcode.mjs`, 구현 전 실측)
| 목적지가 한 일 | Node 오류 코드 | 기록 |
|---|---|---|
| `NOT HTTP` 같은 깨진 응답 | HPE_INVALID_CONSTANT | bad-response |
| 응답 헤더가 너무 큼 | HPE_HEADER_OVERFLOW | bad-response |
| Content-Length와 Transfer-Encoding을 함께 보냄 | HPE_INVALID_TRANSFER_ENCODING | bad-response |
| 응답 전에 연결을 끊음 | ECONNRESET | unreachable |
| 포트가 닫혀 있음 | ECONNREFUSED | unreachable |

## 개발 방식에서 새로 적용한 것 (INFRA-8)
- 구현 전 실측을 **"실측:" 커밋**으로 따로 두었다(O35, `22e556e`).
- 출력 유출 테스트에 **긍정 전제**를 추가했다(O30): 구독자가 오류를 내면 고정 문구가 출력에 실제로 잡히는지 확인한다. 수집이 고장 나면 "출력 없음" 테스트가 아무것도 검증하지 못하기 때문이다.
- 예상마다 판정 기준을 적었다(O38). E42~E45 모두 일치.

## 작업 흐름 (커밋 순서)
1. `16f45e4` 계획: 예상 E42~E45, 목적 나무에 PRX-3·PRX-4 추가
2. `22e556e` 실측: Node 오류 코드(E43)
3. `4c37f89` 테스트: 새 동작 10개(red: assertion 실패 10개, 오류 0개) + 회귀 2개
4. `c2f8660` flow.ts → 이 시점 285개 중 275개 통과
5. `d620b76` server.ts → 285/285
6. `fabd2fd` 실측: 실제 curl로 시작 알림
7. (이 문서 커밋)

## 먼저 볼 코드
- `src/flow/flow.ts:21` — `Target` 타입
- `src/flow/flow.ts:37` — `FlowStart` 타입(시작 알림)
- `src/flow/flow.ts:47` — `parseTarget()`: 요청 대상 → target
- `src/proxy/server.ts:131` — `'request'` 처리기: id를 요청 받을 때 매김
- `src/proxy/server.ts:134` — `'request'` 처리기: 시작 알림
- `src/proxy/server.ts:191` — `upstream.on('response')`: 본문 도중 타임아웃으로 교체
- `src/proxy/server.ts:215` — `upstream.on('error')`: bad-response / unreachable 분류

## 남은 것
- [PRX-4] 실행 진입점 `npm start` + 포트 값 검사(결정 6, A10). 그다음 PRX ✅ → TLS.
