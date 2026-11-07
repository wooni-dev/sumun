# [TLS-1] CONNECT 터널: HTTPS를 복호화 없이 그대로 통과        커밋: 79a641d..(이 문서 커밋)

## 한 줄 요약
이제 `npm start`로 띄운 프록시를 지나 **HTTPS 사이트에 접속할 수 있다.** 다만 내용은 아직 볼 수 없다(암호문 그대로 통과). 기록과 요약 줄에는 "어디로, 몇 바이트"만 남는다. 내용을 보는 것은 TLS-4에서 한다.

## 브라우저가 HTTPS를 프록시로 보낼 때
웹 개발로 치면, 브라우저는 프록시에게 "`example.com:443`으로 가는 **전화선만 이어 줘**"(CONNECT)라고 부탁한다. 프록시가 `200 Connection Established`라고 답하면, 그 뒤로 오가는 바이트는 브라우저와 사이트 사이의 암호화된 대화다. 프록시는 그 바이트를 해석하지 않고 그대로 넘긴다.

```
 브라우저 ── CONNECT example.com:443 ──▶ [프록시]
                                          ├ 대상 해석(엄격하게)  ├ 이름 해석은 한 번만  ├ 자기 자신이면 508
                                          └─TCP──▶ example.com:443
          ◀── 200 Connection Established ──
          ◀═══════ 암호문 그대로 ═══════▶     기록: { method: 'CONNECT', target, tunnel: { bytesUp, bytesDown, address } }
```

## 실제 curl로 본 결과 (`node scripts/probe/tls1-curl.mjs`)
```
curl 1) https://127.0.0.1:18099/hello?q=1 → secure /hello?q=1 [200]
curl 2) 자기 자신으로 터널 → [000]   (CONNECT에 508)
--- 요약 줄 ---
21:23:24 CONNECT 127.0.0.1:18099 tunnel 643/2135B 21ms
21:23:24 CONNECT 127.0.0.1:18098 loop 508 0ms
```
요약 줄에 경로·쿼리(`/hello?q=1`)는 나오지 않는다. 터널 안이 암호문이라 프록시도 아직 모른다.

## 보안 검토에서 막은 것 (사례 40개 중 TLS-1 배정분, `docs/ai/tls1-cases.md`)
| 위험 | 예 | 대응 |
|---|---|---|
| 검사와 연결이 서로 다른 대상을 봄 | `good.com:443@evil.com:443`, `127.1`, `2130706433`, `0x7f000001` | URL 파서를 쓰지 않고 `host:port` 글자를 직접 검사. 숫자 주소는 `1.2.3.4` 형식만 받는다 |
| DNS 리바인딩 | 이름이 처음엔 공인 IP, 다음엔 127.0.0.1 | 이름을 **한 번만** 해석하고 검사한 그 주소로 연결. 연결한 주소를 기록 |
| 자기 자신으로 무한 터널 | `localhost:8080`, `[::ffff:127.0.0.1]:8080`, `0.0.0.0:8080` | 508. 터널 안은 해석하지 않아 Via를 못 붙이므로 주소로 막는다 |
| CONNECT와 함께 온 첫 바이트 유실 | 브라우저가 TLS 첫 인사를 기다리지 않고 바로 보냄 | Node가 `head`로 따로 넘긴다는 것을 실측으로 확인하고, 목적지에 먼저 넘긴다 |
| 잘린 데이터를 완전한 것처럼 끝냄 | 목적지가 도중에 끊음 | 클라이언트 연결도 RST로 끊는다 |
| 스머글링 | CONNECT에 본문 헤더, CONNECT 뒤에 붙인 HTTP 요청 | 본문 헤더는 400. 뒤에 붙은 글자는 터널 데이터로만 다룬다 |

## 정한 것 (추천으로 진행 — TLS 보고서에 올림)
| # | 정한 것 | 이유 |
|---|---|---|
| 0 | 터널은 `startProxy({ tunnel: true })`일 때만. 기본값은 501, `npm start`는 켬 | 커밋된 PRX-1 테스트(CONNECT 501)를 고치지 않고, 그 테스트가 인터넷에 연결하지 않게 |
| 1·2 | 모든 포트, 같은 PC·사설 주소로의 터널을 허용(자기 자신만 막음) | 프록시에 접속하는 것은 이 PC의 프로그램뿐이고, 그 프로그램은 프록시 없이도 직접 연결할 수 있다. 막으면 개발 포트(8443, 3000)를 못 쓴다. RFC는 "알려진 포트로 제한하는 것이 좋다(SHOULD)"고 하므로, 다른 판단이라는 점을 남긴다 |
| 7 | 연결된 뒤에는 오래 쉬어도 끊지 않음 | WebSocket 같은 장시간 연결 |
| 9·10 | 비ASCII 이름, 숫자 주소 변형은 400 | 브라우저는 punycode로 보낸다 [추측] |

## 테스트
- 새 동작 57개(`test/tls/TLS-1.test.ts`): 구현 전 57개 모두 assertion 실패, 오류 0개. 이름 해석은 `lookup` 옵션으로 바꿔 끼워 인터넷에 묻지 않는다.
- 회귀 5개(`test/tls/TLS-1-regression.test.ts`): Node 파서가 먼저 막는 깨진 요청줄, 웹페이지가 보낼 수 있는 요청.
- 전체 `npm test`: 428 통과, 실패 0, **큰 단위 대기 TLS 2개**(아직 복호화가 없으니 정상).

## 작업 흐름 (커밋 순서)
1. `79a641d` 계획: 사례 40개, TLS-1b로 나눔, 예상 E56~E59
2. `6d1ea87` 실측: head(E58)
3. `662cc43` 테스트 57개 + 회귀 5개 — 처음 실행에서 정리 코드가 빠진 테스트 결함(프로세스가 끝나지 않음)을 찾아 커밋 전에 고침
4. `f192e3f` tunnel.ts → 이 시점 41/57
5. `f5b024e` server.ts·flow.ts·cli.ts·index.ts → 428 통과
6. `eff4256` 실측: 실제 curl
7. (이 문서 커밋)

## 먼저 볼 코드
- `src/tls/tunnel.ts:21` — `parseConnectTarget()`: 대상 글자 검사
- `src/tls/tunnel.ts:51` — `isLoopTarget()`: 자기 자신 판정
- `src/tls/tunnel.ts:59` — `openTunnel()`: 터널 하나의 수명
- `src/tls/tunnel.ts:114` — `openTunnel()` 안: 검사한 주소로 연결(리바인딩 방지)
- `src/tls/tunnel.ts:140` — `openTunnel()` 안: head를 목적지에 먼저
- `src/tls/tunnel.ts:131` — `openTunnel()` 안: 200 뒤 목적지가 끊으면 RST
- `src/proxy/server.ts:236` — `'connect'` 처리기: tunnel 옵션
- `src/proxy/server.ts:287` — `close()`: 열린 터널도 닫음

## 남은 것
- [TLS-1b] half-close, 100MB 전송, 연결 타임아웃 504, 동시 300개, 열린 터널이 있을 때 종료
- [TLS-2] 루트 CA — 시작 전에 Windows 저장소 등록을 다시 확인받는다
