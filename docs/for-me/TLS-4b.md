# [TLS-4b] 복호화 견고성        커밋: 4568edc..(이 문서 커밋)

## 한 줄 요약
HTTPS 복호화와 터널이 "이상한 상대"를 만나도 버티게 했다. TLS를 시작하지 않는 클라이언트, WebSocket 요청, TLS로 말하지 않는 목적지, 수천 개의 사이트, 여러 주소로 풀리는 이름이 그 상대다. 대부분은 TLS-4 구현으로 이미 되던 것이라 회귀 테스트로 고정했고, 다섯 가지를 새로 고쳤다.

## 새로 고친 것
| 상황 | 전에는 | 이제 |
|---|---|---|
| 200 뒤 TLS를 시작하지 않음(느리거나 악의적인 클라이언트) | 연결이 영원히 열려 있음 | 10초(`tlsHandshakeTimeoutMs`) 뒤 닫고 기록 `timeout` |
| 암호 안의 WebSocket 요청 | **Upgrade 헤더를 뗀 일반 GET으로 바뀌어 목적지에 감**(실측) | `501`, 목적지에 보내지 않음 |
| 목적지가 h2만 / 평문 / TLS 1.0만 / 클라이언트 인증서 요구 | 모두 `unreachable`(연결 실패)로 뭉침 | `tls-handshake` 502 "TLS 연결을 맺지 못했습니다" |
| 왜 실패했는지 | 알 수 없음 | `tls.upstreamError`에 코드(예 `CERT_HAS_EXPIRED`, `EPROTO`) |
| 인증서 캐시 | 끝없이 늘어남, 만료돼도 그대로 | 1000개 넘으면 가장 오래 안 쓴 것부터 버림, 만료 1일 전이면 다시 발급 |
| 복호화 없는 터널 + `localhost` | `::1`에만 연결해 127.0.0.1의 서버에 실패 | 검사한 주소들을 차례로 시도 |

마지막 줄은 실제 curl로 확인했다(`node scripts/probe/tls4b-curl.mjs`):
```
curl -x 프록시 https://localhost:65090/hello → secure /hello [200]
요약 줄: 10:22:59 CONNECT localhost:65090 tunnel 657/2200B 25ms
```

## 이미 되던 것 (회귀 테스트로 고정)
- 클라이언트가 ALPN `h2`만, TLS 1.1 이하 → 핸드셰이크 거절, 기록 `tls-handshake`
- 200 뒤 TLS가 아닌 평문 → 닫고 기록
- SNI가 IP여도 인증서는 CONNECT 이름 기준
- 한 번 실패한 터널의 두 번째 요청도 502(예외를 기억하지 않음), `OPTIONS *`는 400, 파이프라이닝은 순서대로
- 터널 안 요청 스머글링(CL·TE 충돌)은 목적지에 가지 않음, 2MB 본문은 전부 전달·기록은 1MB에서 잘림, `Expect: 100-continue`
- 발급 도중에 끊어도 프록시 유지, 동시 핸드셰이크 100개

## 정한 것 중 바꾼 하나
실패 원인을 `error.detail`에 넣기로 했었는데(결정 9), 큰 단위 테스트 TLS-T와 TLS-4 테스트가 `error`를 정확히 비교하고 있어서 **`tls.upstreamError`**에 넣었다. `error`의 모양은 그대로다. TLS 보고서에서 확인받는다.

## 제가 쓴 테스트 결함 1건
D4(핸드셰이크 타임아웃)는 "TLS를 시작하지 않는 클라이언트"를 시험해야 하는데, 쓰던 도우미가 200을 받자마자 TLS를 시작했다. 구현은 맞았다(원시 클라이언트로 316ms 뒤 닫히고 `timeout` 기록 — `scripts/probe/tls4b-timeout.mjs`). 멈추고 보고드렸고, "테스트 수정 허용" 뒤 원시 소켓으로 바꿨다(`9f211dd`). 고친 테스트가 구현 전 코드에서는 여전히 실패하는 것도 확인했다.

## 테스트
- 새 동작 7개(`test/tls/TLS-4b.test.ts`): 구현 전 7개 모두 assertion 실패, 오류 0개.
- 회귀 6개(`test/tls/TLS-4b-regression.test.ts`), 도우미 `test/tls/_mitm.ts`.
- 전체 `npm test`: **523개 모두 통과, 실패 0, 큰 단위 대기 0**.

## 작업 흐름 (커밋 순서)
1. `4568edc` 계획: 예상 E102~E109
2. `05d5607` 실측: 이미 되는 것과 새 동작 가르기(Upgrade가 일반 GET으로 가는 것 발견)
3. `b8913fb` 테스트 7개 + 회귀 6개
4. `d97b8e7` flow.ts → `1c6ab40` tunnel.ts → `9157973` mitm.ts → `24066d2` server.ts → 95/96
5. `61eee94` 실측: 타임아웃 확인 / `42b9144` 기록: 멈춤
6. `9f211dd` 테스트 수정(허용) → 523 통과
7. (이 문서 커밋)

## 먼저 볼 코드
- `src/tls/mitm.ts:23` — `createCertCache()`: LRU 상한과 만료 전 재발급
- `src/tls/mitm.ts:108` — `openMitm()` 안: 핸드셰이크 타임아웃
- `src/tls/tunnel.ts:146` — `openTunnel()` 안 `attempt`: 주소들을 차례로
- `src/proxy/server.ts:231` — `handle()` 안: 터널 안 Upgrade 거부
- `src/proxy/server.ts:307` — `handle()` 안: 인증서가 아닌 TLS 실패를 tls-handshake로
- `src/proxy/server.ts:101` — `safeCode()`: 기록에 넣는 오류 코드의 모양 확인

## 남은 것
- TLS 큰 단위 끝: 전체 테스트 → 방식 감사 → 목표 문서만 보는 검토 → 보고서(`docs/for-me/TLS-report.md`) — 지금까지 추천으로 진행한 결정들을 거기서 한꺼번에 확인받는다.
- [SEC-3] 루트 CA를 Windows에 등록·해제, 실제 브라우저, curl의 폐기 확인 문제.
