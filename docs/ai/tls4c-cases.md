# [TLS-4c] 사례: 복호화 터널 안 헤더 제한, 목적지 인증서 분류

- 출처: 별도 컨텍스트의 검토 에이전트(O10, 2026-11-08). 작업자는 해결안을 알려 주지 않았다. 에이전트에게 준 것은 결함 두 개의 설명, 읽을 파일, 찾을 방향뿐이다.
- 에이전트 실행 환경: Node v24.21.0, OpenSSL 3.5.7. CA는 매번 임시 폴더에 만들었고, Windows 인증서 저장소와 실제 `%LOCALAPPDATA%\sumun\ca`는 쓰지 않았다.
- 에이전트의 실험 스크립트는 실측 커밋에서 `scripts/probe/tls4c-review/`로 옮긴다(O19). `chain-long.ts`는 깊이 106 체인을 만드는 스크립트가 없어 옮기지 않는다(결과만 C8에 적는다).
- 시간 기호: h = `headersTimeoutMs`, 검사 주기 = `min(1000, h/2)`(server.ts 설정과 같음).
- 배정: **4c** = 이 단위의 새 동작 테스트 / **회귀** = 지금도 통과해야 정상(회귀 파일) / **문서** = 테스트 대신 이 문서와 사용자 문서에 동작을 적는다 / **범위 밖** = progress.md 범위 밖 문제로.

## 사용자 결정 (2026-11-08, 모두 추천대로)
| # | 항목 | 결정 |
|---|---|---|
| D-1 | 요청 없이 시간 초과로 닫힌 터널(I1·I3·I8)의 CONNECT 기록 | `{ by: 'client', code: 'timeout' }`(핸드셰이크 시간 초과와 같은 코드). 요청 뒤 유휴로 닫히면(I4·I5) 지금처럼 CONNECT 기록 없음(TLS 보고서 결정 6) |
| D-2 | 터널 안 시간 초과 때 응답 | 평문 프록시처럼 **408을 보내고** 닫는다 |
| D-3 | 느린 본문·응답을 읽지 않는 클라이언트(I11·I14·R4) | 평문과 같게 제한하지 않음을 유지하고 문서에 남긴다 |
| D-4 | 파이프라이닝 반쪽이 진행 중인 첫 요청을 함께 끊고 `client aborted`로 기록됨(I7) | 평문과 같게 두고 문서에 남긴다 |
| D-5 | 목적지 인증서 분류 | Node가 **인증서 검증에서 실패시킨 것은 코드와 상관없이 모두** `bad-certificate`(UNSPECIFIED 포함). `tls.upstreamError`에는 코드만(오류 문구는 넣지 않음). 목적지가 *우리* 인증서를 요구·거부하는 경고(코드에 CERTIFICATE가 들어감)는 지금처럼 `tls-handshake` |

## I. 유휴·느린 연결 (h=1000 실험, 시간 = 연결을 연 뒤 닫힐 때까지)
| ID | 상황 | 기대 | 지금(구현 전) | 배정 |
|---|---|---|---|---|
| I1 | 핸드셰이크 뒤 `GET / HTTP/1.1\r\n`, 헤더를 400ms마다 1바이트 | h + 주기 + 여유 안에 닫힘, 408, CONNECT 기록 `client timeout`(D-1) | 15초 안에 안 닫힘 [확인됨: 에이전트 Ia] | 4c |
| I2 | I1과 같고 1바이트를 h−50ms마다 | I1과 같음(시계는 메시지 시작부터) | [추측: I1과 같음] | 4c |
| I3 | 핸드셰이크 뒤 아무것도 안 보냄 | h 안에 닫힘, 408, CONNECT 기록 `client timeout` | 안 닫힘, close() 때 error 없는 CONNECT 기록 [확인됨: Iz] | 4c |
| I4 | keep-alive: 첫 요청 200 → 300ms 뒤 둘째 요청 헤더 반쪽 | 둘째 시작부터 약 h에 닫힘(**keepAliveTimeout 5초보다 빨리** — h=500으로 구별), 첫 요청 기록 200만(긍정 전제, O30), CONNECT 기록 없음 | 6315ms(keep-alive 5초가 대신 닫음) [확인됨: Ib] | 4c |
| I5 | keep-alive: 첫 요청 200 → 둘째 요청 헤더를 400ms마다 1바이트 | 둘째 시작 뒤 h + 주기 안에 닫힘, 첫 요청 기록 유지 | 안 닫힘(바이트마다 keep-alive 타이머가 다시 시작) [확인됨: Ic] | 4c |
| I6 | 파이프라이닝: 완전한 요청 + 반쪽 요청을 한 번에 write | 첫 요청 200, 그 뒤 약 h에 닫힘 | 6036ms [확인됨: Ie] | 4c |
| I7 | 파이프라이닝: 느린 목적지 요청(2.5초) + 바로 뒤 둘째 반쪽 | 평문과 같게(D-4): 약 h에 408, 첫 요청 기록 `client aborted` | 평문 1020ms 408 [확인됨: pipe-slow] | 문서(D-4) |
| I8 | 핸드셰이크 뒤 원시 소켓에 TLS 레코드 일부(`17 03 03 00 40 01 02 03`)만 | h 안에 닫힘(HTTP 파서에 바이트가 닿지 않아도) | 안 닫힘 [확인됨: If] | 4c |
| I9 | TLS 1.2, 헤더 반쪽 뒤 2초마다 재협상 | 재협상이 시계를 다시 시작시키지 않음, h 안에 닫힘, 기록 한 번 | 재협상 성공, 안 닫힘 [확인됨: Ii] | 4c |
| I10 | `Expect: 100-continue`, `Content-Length: 10`, 본문 안 보냄 | 헤더 제한 대상 아님. 100 → 목적지 제한으로 504 | 100, 504 [확인됨: Ig] | 회귀 |
| I11 | Content-Length 100 본문을 400ms마다 1바이트 | 헤더 제한으로 닫지 않음(D-3) | 터널·평문 모두 안 닫힘 [확인됨: Ih, Pd] | 문서(D-3), K6과 같은 회귀 |
| I12 | ClientHello를 0.9×핸드셰이크 제한에, 헤더 반쪽을 0.9×h 동안 | 단계마다 한 번씩. 총 시간 ≤ 핸드셰이크 제한 + h + 여유 | [추측] | 4c |
| I13 | 요청 뒤 close_notify/FIN만 보내고 느린 응답을 기다림 | 지금 동작 그대로 | [추측] | 문서 |
| I14 | 큰 응답을 읽지 않음(역방향 압력) | 헤더 제한과 무관. `upstreamBodyTimeoutMs`(5분)에 따름 | [추측] | 문서(D-3) |
| I15 | 헤더 마지막 `\r\n`이 제한 시각에 딱 맞춰 도착 | 408이거나 정상 처리. 기록이 두 번 남지 않음 | [추측] | 문서(테스트하기 어려움 — 시각이 흔들림) |
| I16 | 시간 초과 때 응답 | 408(D-2) | 평문 408 [확인됨: Pa], 터널은 안 닫힘 | 4c(I1·I3의 assertion) |

## K. 지켜야 할 정상 동작 (지금은 헤더 제한이 아예 듣지 않아서 통과한다)
| ID | 상황 | 기대 | 지금 | 배정 |
|---|---|---|---|---|
| K1 | 터널 안 느린 목적지 2.5초, h=1000 | 200 | 200 [확인됨: Ka] | 회귀 |
| K2 | keep-alive: 첫 요청 → 3초 쉼(h < 3초 < keepAlive 5초) → 둘째 요청 | 200, 200 | [확인됨: Kb] | 회귀 |
| K3 | 한 터널에서 300ms 간격 요청 10개(전체 > h) | 모두 200 | [추측] | 회귀 |
| K4 | SSE: 4초 동안 500ms마다 응답 조각, 클라이언트는 아무것도 안 보냄 | 끝까지 200 | [확인됨: Kc] | 회귀 |
| K5 | 2MB 업로드를 64KB씩 | 200 | [확인됨: Kd] | 회귀 |
| K6 | 느린 업로드(I11) | 헤더 제한으로 끊지 않음 | [확인됨] | 회귀(관찰 시간은 h의 3배) |
| K7 | 평문: 헤더 1바이트씩 / keep-alive 반쪽 / keep-alive 1바이트씩 | 약 h에 408 | [확인됨: Pa·Pb·Pc] | 회귀 |
| K8 | headersTimeoutMs=0 | 평문처럼 제한 없음(바로 닫히면 안 됨) | 평문 안 닫힘 [확인됨] | 회귀 |
| K9 | headersTimeoutMs=3e9 | 바로 닫히지 않음 | 평문 [확인됨] | 회귀 |
| K10 | headersTimeoutMs=1 | 터널 헤더 시계는 핸드셰이크가 끝난 뒤부터 → 핸드셰이크는 성공 | 평문 63ms 408 [확인됨], 터널 [추측] | 회귀 |
| K11 | close(): 붙잡힌 터널 여러 개 | 모두 닫힘, 타이머 정리, 기록 두 번 없음 | [확인됨: 6개·300개] | 회귀 |
| K12 | ClientHello 안 보냄 | 핸드셰이크 제한에 닫힘, `client timeout` | 기존 TLS-4b D4 | 기존 테스트 |
| K13 | 완전한 요청 3개 파이프라이닝 | 응답 3개 | 기존 E97 | 기존 테스트 |
| K14 | `Expect: 100-continue` 뒤 본문을 정상으로 | 200 | [추측] | 회귀 |

## C. 목적지 인증서 분류
| ID | 상황 | 기대(D-5) | 지금 | 배정 |
|---|---|---|---|---|
| C1 | 중간 CA `nameConstraints=permitted;DNS:.example.com`, leaf는 localhost | 502 `bad-certificate`, `upstreamError: 'UNSPECIFIED'` | `UNSPECIFIED` → unreachable, upstreamError 없음 [확인됨] | 4c(시험 인증서를 만들 수 있으면, 아니면 실측) |
| C2 | leaf에 모르는 critical 확장 | 위와 같음 | 위와 같음 [확인됨] | 4c |
| C3 | SHA-1 서명 leaf | 위와 같음 | 위와 같음 [확인됨] | 4c |
| C4 | RSA 1024/768 leaf(목적지 SECLEVEL=0) | 위와 같음 | 위와 같음 [확인됨] | 4c |
| C5 | C1~C4의 원인 구별 | 코드만(UNSPECIFIED). 문구는 넣지 않음(D-5) | — | 문서 |
| C6 | keyUsage=keyCertSign만 / EKU=clientAuth만 / 중간 CA가 CA:FALSE | bad-certificate, INVALID_PURPOSE / INVALID_CA | 맞게 분류 [확인됨] | 회귀 |
| C7 | 중간 CA를 보내지 않음 | bad-certificate, UNABLE_TO_VERIFY_LEAF_SIGNATURE | 맞게 분류 [확인됨] | 회귀 |
| C8 | 깊이 106 체인 | bad-certificate, UNABLE_TO_GET_ISSUER_CERT_LOCALLY(기본 깊이 100에서는 CERT_CHAIN_TOO_LONG이 안 나옴) | [확인됨: 에이전트 chain-long.ts, 저장소에 없음] | 문서 |
| C9 | 목록 밖 Node 코드(CERT_CHAIN_TOO_LONG, ERROR_IN_CERT_*_FIELD, UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY 등) | bad-certificate | 재현 못 함 [추측] | 문서(C1~C4와 같은 경로로 덮음) |
| C10 | 검증 오류 OUT_OF_MEM | bad-certificate여도 됨(어느 쪽이든 차단) | [추측] | 문서 |
| C11 | ERR_TLS_CERT_ALTNAME_FORMAT | bad-certificate | [추측] | 문서 |
| C12 | (반대) 목적지가 TLS 1.3에서 클라이언트 인증서 요구 | tls-handshake 유지 | ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED → tls-handshake [확인됨] | 회귀 |
| C13 | (반대) 같은 상황 TLS 1.2 | tls-handshake 유지 | EPROTO → tls-handshake [확인됨] | 회귀 |
| C14 | (반대) ClientHello 직후 목적지 RST | unreachable 유지 | ECONNRESET → unreachable [확인됨] | 회귀 |
| C15 | (반대) 핸드셰이크 무응답 / HTTP 깨짐 | 504 timeout / bad-response | [추측] | 기존 테스트(PRX-3, TLS-4b) |
| C16 | 앞으로 생길 새 코드 | 502 차단 유지 | 13사례 모두 502 [확인됨] | 문서 |
| C17 | C1~C4에서 목적지 본문이 클라이언트에 감 | 0바이트 | [추측] | 4c(C2·C3 assertion) |

## R. 자원
| ID | 상황 | 기대 | 지금 | 배정 |
|---|---|---|---|---|
| R1 | 헤더 반쪽으로 멈춘 터널 N개 | h + 주기 + 여유 뒤 0개 | 300개 3초 뒤 300/300, rss +39.4MB [확인됨: many.ts] | 4c(N=50, 테스트 시간 때문에) |
| R2 | 1바이트씩·keep-alive 반쪽 터널 N개 | 같은 시점에 0개 | [추측] | 문서(R1·I1·I5가 덮음) |
| R3 | 부하 중 정상 요청 지연 | 크게 늘지 않음 | 기준 115ms, 300개 부하 중 53ms [확인됨] | 문서 |
| R4 | 느린 업로드·읽지 않는 클라이언트 N개 | 제한 없음 유지(D-3) | — | 문서(D-3) |
| R5 | 정상으로 닫힌 연결 뒤 타이머가 남는지 | 원래 수준 | [추측] | 회귀(K11과 함께) |
| R6 | CONNECT 단계의 이름 해석·인증서 발급에 시간 제한 없음 | — | [추측: 코드 근거] | 범위 밖 |

## 테스트로 만들기 어려운 사례 (에이전트 의견)
- TLS 1.3 KeyUpdate 연속·길이 0 레코드·warning alert로 시계를 다시 시작시키기: Node 클라이언트 API로는 보낼 수 없다. I8·I9가 "TLS 층 활동이 시계를 다시 시작시키지 않는다"를 대신 확인한다.
- 실제 브라우저의 예열 연결(preconnect)이 h(30초)에 닫힌 뒤 브라우저가 문제없이 다시 연결하는지: SEC-3의 브라우저 실측에서 본다(O31).
- 수천 개 연결의 OS 한계, I14의 5분 역방향 압력: 환경 의존·시간 문제.
