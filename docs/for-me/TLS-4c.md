# [TLS-4c] 복호화 터널 안 헤더 제한, 목적지 인증서 분류        커밋: 5fd1dab..(이 문서 커밋)

## 한 줄 요약
TLS 보고서의 검토 결함 두 개를 고쳤다. ① HTTPS 복호화 터널 안에서 "헤더를 제한 시간 안에 다 보내지 않는 연결"이 영원히 열려 있던 것을, 평문 프록시처럼 **408을 보내고 닫게** 했다. ② 목적지 서버 인증서가 이상할 때 `unreachable`(연결 실패)로 잘못 적히던 것을 **`bad-certificate`**로 바로잡았다.

## 왜 안 닫혔나 (원인)
Node의 http 서버는 "헤더가 늦은 연결 찾기"를 **listen을 시작할 때** 켠다. 복호화 쪽의 안쪽 http 서버는 포트를 열지 않고(listen 없이) 연결만 넘겨받기 때문에 이 검사가 한 번도 돌지 않았다.
```
node scripts/probe/tls4c-cause.mjs
E110-1 {"h":500,"listening":false, ... "closedMs":null}   ← 지금 구조: 안 닫힘
E110-2 {"h":500,"listening":true,  ... "closedMs":528}    ← 검사를 켜면 h에 닫힘
```
그래서 포트는 더 열지 않고 검사만 켰다(`inner.emit('listening')`). 이건 Node 내부 동작에 기대는 방법이라, Node를 올릴 때 TLS-4c 테스트가 깨지는지로 알아챈다.

실측 중에 하나 더 알게 됐다. 이 검사의 시계는 **연결을 넘겨받은 때부터** 센다. 핸드셰이크 전에 넘기면 TLS 핸드셰이크 시간이 헤더 제한을 깎아 먹는다(ClientHello를 300ms 늦추고 h=1이면 핸드셰이크 전에 끊김). 그래서 **핸드셰이크가 끝난 뒤에** 넘긴다. 일반 https 서버와 같은 시점이다.

## 새로 고친 것 (검토 에이전트가 찾은 우회 사례 기준)
| 상황 (h = 헤더 제한, 기본 30초) | 전에는 | 이제 |
|---|---|---|
| 핸드셰이크 뒤 아무것도 안 보냄 | 안 닫힘, 끝날 때 "정상 종료"처럼 기록 | h 뒤 **408**, 기록 `client timeout`(결정 D-1·D-2) |
| 헤더를 1바이트씩(h보다 짧은 간격) | 안 닫힘 | 메시지 시작부터 h 뒤 408 |
| 첫 요청은 정상, 둘째 요청 헤더를 1바이트씩 | **안 닫힘**(바이트마다 keep-alive 타이머가 다시 시작) | 둘째 시작부터 h 뒤 408. 기록은 첫 요청 200 하나 |
| 첫 요청 뒤 둘째 헤더 반쪽 / 파이프라인 반쪽 | keep-alive 5초가 우연히 닫음 | h 뒤 408 |
| TLS 레코드 일부만 보내고 멈춤, TLS 1.2 재협상 반복 | 안 닫힘 | h 뒤 닫힘, 기록 한 번 |
| 헤더 반쪽으로 멈춘 터널 50개 | 모두 열린 채 | 모두 닫힘 |
| 목적지 인증서: 이름 제약 위반, 모르는 critical 확장, SHA-1 서명, RSA 1024 키 | `unreachable`, 원인 없음 | `bad-certificate`, `tls.upstreamError: 'UNSPECIFIED'`(결정 D-5) |

인증서 쪽은 이렇게 구별한다. Node가 **인증서 검증으로 실패시킨 경우**에만 목적지 TLS 소켓의 `authorizationError`에 코드가 남는다. 목적지가 *우리에게* 인증서를 요구하거나 연결을 끊은 경우에는 비어 있다(13사례로 확인, `scripts/probe/tls4c-classify.mjs`). 그래서 코드 목록을 늘리지 않고 이 표시를 본다. 차단(502)은 전에도 됐고, 바뀐 것은 기록의 이름표다.

## 그대로 둔 것 (결정)
- 본문을 아주 느리게 보내는 업로드, 응답을 읽지 않는 클라이언트: 제한하지 않음(평문과 같음, D-3). 큰 업로드를 끊지 않기 위해서다.
- 파이프라이닝에서 둘째 요청이 반쪽이면 진행 중인 첫 요청도 함께 끊기고 `client aborted`로 기록됨: 평문과 같게 둠(D-4). 브라우저는 이 방식을 쓰지 않는다.
- 인증서 오류 문구(OpenSSL 메시지)는 기록하지 않음: 코드만(D-5).

## 실제 클라이언트로 확인 (O31)
```
node scripts/probe/tls4c-openssl.mjs
명령: openssl s_client -proxy 127.0.0.1:63384 -connect example.test:443 ... -ign_eof
핸드셰이크·검증 성공 383ms / openssl 종료 2967ms / 408 받음 true
기록: [["CONNECT","example.test:443",{"by":"client","code":"timeout"}]]
```
기존 curl 실측(`node scripts/probe/tls4-curl.mjs`)도 그대로다. example.com은 200(`--ssl-no-revoke` 필요, SEC-3에서 다룸), 믿을 수 없는 목적지는 502다.

TLS 보고서의 검토 스크립트도 다시 돌렸다. `review-idle.ts 6`에서 전에 `null`(안 닫힘)이던 두 연결이 764ms에 닫히고, `review-mitm.ts`는 16개 중 실패 0개다(전에는 1개).

## 구현 중에 제가 만든 결함 1건
"핸드셰이크가 끝난 뒤에 넘기기"로 바꾸자 기존 테스트 TLS-4 D3(클라이언트가 우리 인증서를 거부)가 실패했다. 서버 쪽에는 클라이언트가 닫았다는 신호(`end`)만 오고 연결이 저절로 닫히지 않았다. 전에는 안쪽 http 서버가 이 일을 대신 하고 있었다. 핸드셰이크 전에 `end`가 오면 닫도록 했다. 처음 세운 가설("아무도 읽지 않아서")은 틀려서 버렸다.

## 테스트
- 새 동작 13개(`test/tls/TLS-4c.test.ts`): 구현 전 13개 모두 assertion 실패, 오류 0개.
- 회귀 15개(`test/tls/TLS-4c-regression.test.ts`): 느린 목적지, keep-alive, SSE, 2MB 업로드, 느린 본문, `Expect: 100-continue`, 평문 동작, h=0·3e9·1, close(), 이미 맞던 인증서 분류. 도우미 `test/tls/_tls4c.ts`(시험 인증서는 node-forge로 메모리에서 만든다).
- 전체 `npm test`: **551개 모두 통과, 실패 0, 큰 단위 대기 0**.

## 작업 흐름 (커밋 순서)
1. `5fd1dab` 계획: TLS 보고서 승인 기록, 사례 47개(검토 에이전트), 사용자 결정 D-1~D-5, 예상 E110~E116
2. `b0f9429` 실측: 원인(E110 일치), 시계 시작점(E112 불일치 → 핸드셰이크 뒤에 넘기기로), 인증서 구별(E113 일치) + 에이전트 실험 스크립트
3. `15d958f` 테스트 13개 + 회귀 15개
4. `e307891` mitm.ts → `9dc3d7d` server.ts → 551 통과
5. `2fa5e0c` 실측: openssl s_client
6. (이 문서 커밋)

## 먼저 볼 코드 (줄 번호는 이 문서 커밋 기준)
- `src/proxy/server.ts:335` — `startProxy()` 안 `inner.emit('listening')`: 안쪽 서버의 헤더 검사를 켜는 한 줄과 그 이유
- `src/proxy/server.ts:345` — `startProxy()` 안 inner `clientError` 처리기: 시간 초과면 408, 그 밖은 바로 닫음
- `src/proxy/server.ts:306` — `handle()` 안 `verifyFailed`: `authorizationError`로 인증서 검증 실패를 구별
- `src/tls/mitm.ts:113` — `openMitm()` 안 `t.once('secure', …)`: 핸드셰이크 뒤에 안쪽 서버로 넘김
- `src/tls/mitm.ts:121` — `openMitm()` 안 `t.once('end', …)`: 핸드셰이크 전 끝이면 닫음(D3)

## 남은 것
- TLS를 ✅로 (이 문서 커밋에서 목적 나무에 반영)
- [INFRA-10] 승인된 방식 보정 O39~O46을 CLAUDE.md·check-method에
- [SEC-3] 루트 CA를 Windows에 등록·해제(명령을 실행 직전에 보여 드리고 확인), 브라우저 실측, curl `--ssl-no-revoke`
- 범위 밖: CONNECT 단계의 이름 해석·인증서 발급에 시간 제한이 없음(R6)
