# [PRX-2] 요청·응답 기록(Flow)        커밋: 44878a3..(이 문서 커밋)

## 한 줄 요약
프록시가 요청을 **중계하면서 기록도 남긴다.** 요청 하나가 끝날 때마다 "Flow"라는 기록 하나를 `onFlow` 콜백으로 넘긴다. 나중에 저장소(STO)와 대시보드가 이 콜백을 받는다. 기록은 메모리에만 있고, 본문은 1MiB까지만 담는다.

## 웹 개발에 비유하면
Express 미들웨어에서 `req`와 `res`를 엿봐서 로그 객체 하나를 만드는 것과 비슷하다. 다른 점은 세 가지다.
1. 본문을 **흘려보내면서**(`pipe`) 복사본을 앞 1MiB만 따로 모은다. 브라우저는 언제나 전체를 받는다.
2. 이 로그에는 쿠키와 토큰이 **원본 그대로** 들어 있다(사용자 결정). 그래서 이 로그가 콘솔, 오류 메시지, 디스크로 **새지 않는 것**을 테스트로 묶었다.
3. 로그를 받는 쪽(구독자)이 오류를 내도 프록시는 멀쩡해야 한다.

## Flow의 모양
```
{ id: 3, startedAt: 1762500000000, durationMs: 9.9,
  request:  { method: 'POST', url: 'http://127.0.0.1:18093/post?q=1', httpVersion: '1.1',
              headers: [['Host', '...'], ['Cookie', 'fake=1'], ...],   ← 보낸 순서·대소문자·중복 그대로
              body: <Buffer 68 65 6c 6c 6f>, bodySize: 5, bodyTruncated: false },
  response: { status: 200, statusMessage: 'OK', httpVersion: '1.1', headers: [...], body, bodySize, bodyTruncated },
  error:    { by: 'upstream', code: 'unreachable', status: 502 } }    ← 실패했을 때만
```
- `response`에는 **목적지 서버가 보낸 응답만** 담는다. 프록시가 직접 만든 400·502·504 같은 응답은 `error.status`에 적는다. "서버가 504를 줬나, 프록시가 504를 냈나"를 구분하기 위해서다.
- `error.by`는 실패한 쪽이다: `proxy`(프록시가 거절), `client`(브라우저가 도중에 끊음), `upstream`(목적지가 연결 실패·무응답·도중에 끊음·101 요청).
- `bodySize`는 실제로 오간 전체 크기다. 2MB 응답이면 `body`는 1,048,576바이트, `bodySize`는 2,000,000, `bodyTruncated`는 true다.

## 정한 것 (사용자 결정 + Claude 추천 D1~D12, `docs/ai/prx2-cases.md`)
| 항목 | 정한 것 |
|---|---|
| 저장 위치 | 메모리만 (사용자) |
| 본문 한도 | 요청·응답 각 1MiB = 1,048,576바이트 (사용자 + D1) |
| 가리기 | 원본 그대로, 가리기는 UI 단계에서 (사용자) |
| chunked / gzip | chunked는 풀어서, gzip은 **압축된 그대로** (D2: 기록 단계에서 압축을 풀면 "압축 폭탄"에 메모리가 터진다) |
| 거절된 요청 | 기록한다. 단 Node 파서가 막은 요청(깨진 바이트)과 CONNECT는 기록하지 않는다 (D4) |
| 언제 넘기나 | 끝났을 때 한 번 (D5) |
| 구독자 오류 | 삼키고 고정 문구 한 줄만 출력, 오류 내용은 출력하지 않음 (D6, D12) |

**확인을 받고 싶은 것**: D4(거절된 요청도 기록), D5(끝났을 때만, 시작 이벤트 없음). 둘 다 대시보드에서 실시간으로 볼 때 영향이 있다. 다만 나중에 **추가만 하면 되는** 변경이라 추천안으로 진행했다.

## 왜 이렇게 만들었나 (실측으로 확인한 함정)
| 함정 | 실측 | 대응 |
|---|---|---|
| 작은 Buffer는 **공유 풀**의 일부다 | `Buffer.concat`으로 만든 5바이트 Buffer의 `buffer.byteLength`가 **65,536** [확인됨: `node scripts/probe/prx2-node.mjs`]. 이 Buffer를 대시보드로 보낼 때 `.buffer`를 통째로 쓰면, 같은 풀에 있던 **다른 요청의 쿠키**까지 나갈 수 있다 | 기록 본문은 `allocUnsafeSlow`로 만든 독립 메모리에 복사한다 |
| async 구독자가 reject하면 | 아무도 잡지 않으면 **프로세스가 죽고, 오류 내용(=기록)이 stderr에 찍힌다** [확인됨: 같은 스크립트] | `emitFlow()`가 reject를 잡고 고정 문구만 남긴다 |

## 테스트
- 새 동작 37개(`test/prx/PRX-2.test.ts`): 구현 전 37개 모두 **assertion 실패, 오류 0개**. 구현 뒤 37/37
- 회귀 4개(`test/prx/PRX-2-regression.test.ts`): 오류 응답에 요청 값이 나오지 않음(F1), 프록시가 아무것도 출력하지 않음(F2), 1.5MB를 중계해도 디스크에 기록 내용이 남지 않음(F6), `onFlow` 없이도 동작(I7). 기록 기능이 없던 때에도 통과했고, 앞으로도 지켜야 한다
- 유출 시험 방법: 매번 새로 만든 표식 `SUMUN-SECRET-<난수>`를 쿠키·Authorization·쿼리·본문에 넣고, 자식 프로세스로 띄운 프록시의 출력·응답·바뀐 파일에서 찾는다
- 전체 `npm test` 242/242

## 실제 curl로 본 기록 (`node scripts/probe/prx2-curl.mjs`)
```
1) POST 본문 5바이트 → 기록 #1: 요청 헤더 [Host, User-Agent, Accept, Proxy-Connection, Cookie, ...] 본문 5/5, 응답 200 본문 3/3
2) 응답 2,000,000바이트 → curl은 2000000바이트 받음, 기록은 1048576/2000000 잘림
3) 닫힌 포트 → curl 502, 응답 없음, 실패 {"by":"upstream","code":"unreachable","status":502}
```
`Proxy-Connection`은 목적지로는 넘기지 않지만, 기록에는 브라우저가 보낸 원문이 그대로 남는다(H9).

## 작업 흐름 (커밋 순서)
1. `44878a3` 계획: 예상 E28~E33, 사례 49개를 PRX-2와 2b로 나눔
2. `05bb150` 테스트: 새 동작 37개 + 회귀 4개
3. `e897835` flow.ts → 이 시점 37개 중 5개 통과
4. `a74a6b2` server.ts → 242/242
5. `a3dcdb6` 실측 스크립트
6. (이 문서 커밋)

## 먼저 볼 코드
- `src/flow/flow.ts:19` — `Flow` 타입. TLS, 저장소, 대시보드가 모두 이 모양에 기댄다.
- `src/flow/flow.ts:34` — `createBodyCapture()`. 청크를 배열에 쌓지 않고 한 덩어리에 복사하며 두 배씩 늘린다(`:44`).
- `src/proxy/server.ts:133` — `res.once('close')`. 다 보냈을 때도, 중간에 끊겼을 때도 한 번 온다 → 요청당 기록 1번.
- `src/proxy/server.ts:148` — `refuse()`. 프록시가 거절할 때 기록의 `error`에 적고 응답을 보낸다.
- `src/proxy/server.ts:75` — `emitFlow()`. 구독자를 중계가 끝난 뒤 부르고, 예외와 reject를 삼킨다.
- `src/proxy/server.ts:105` — `onFlow`가 함수가 아니면 시작하지 않는다.

## 파일별 변경
### src/flow/flow.ts (새 파일) — `Flow`, `FLOW_BODY_LIMIT`, `createBodyCapture`, `headerPairs`
### src/proxy/server.ts — `startProxy({ onFlow })`, `emitFlow`, 요청 처리기의 `fail`·`refuse`·기록
### test/prx/_flow.ts, _flow-child.ts — 기록을 모으는 프록시, 자식 프로세스 프록시(출력 수집)
### test/prx/PRX-2.test.ts, PRX-2-regression.test.ts
### scripts/probe/prx2-curl.mjs, prx2-node.mjs — 실측

## 남은 것
- [PRX-2b] 메모리 측정(2GB 본문, 1바이트 청크 100만 개, 클라이언트가 읽지 않을 때 역압), Node 파서 오류의 원본 바이트, 1xx 응답, 느린 구독자 등 (`prx2-cases.md` 배정 "2b")
- 나중 단계에서 다시 볼 것: 대시보드 XSS·DNS 리바인딩·WebSocket Origin, 저장소의 전체 바이트 상한(1,000건 × 2MB ≈ 2GB)
