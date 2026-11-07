# [PRX-1b] 요청 쪽 방어: Node 파서가 막는 것과 우리가 막아야 하는 것        커밋: 71eb378..(이 문서 커밋)

## 한 줄 요약
검토 에이전트가 제안한 "잘못되거나 악의적인 요청" 46가지를 **실제로 보내 봤다.** 40개는 Node의 HTTP 파서와 PRX-1이 이미 막고 있었고, 6개는 막지 못해서 직접 막았다. 이미 막히는 40개도 테스트로 고정해서, Node 버전이 바뀌어 방어가 약해지면 바로 알 수 있게 했다.

## 무엇이 어디서 막히나 (실측, 2026-11-07, Node v24.21.0)

```
클라이언트의 바이트
   │
   ▼ ① Node HTTP 파서(llhttp) — 우리가 짜지 않은 방어선
   │    CL+TE 함께, 다른 CL 두 개, 이상한 CL·TE 값, obs-fold, LF만 있는 줄바꿈, NUL,
   │    잘못된 chunk, 헤더 이름 뒤 공백, 큰 헤더(431), 헤더 3,000개(431), HTTP/1.1인데 Host 없음  → 400대 거부
   │
   ▼ ② PRX-1 (이미 있던 검사)
   │    origin-form, *, http가 아닌 scheme, URL 문법 오류(포트 65536·abc 등), zone ID  → 400
   │
   ▼ ③ PRX-1b (이번에 추가) — 파서는 통과시키지만 위험한 것
   │    validateHost()     Host 두 줄, Host: a, b, Host: a b          → 400   (RFC 9112 3.2 MUST)
   │    validateFraming()  HTTP/1.0 + Transfer-Encoding                → 400   (RFC 9112 6.1)
   │    validateTarget()   http:///path (호스트 없음), 포트 0           → 400
   ▼
목적지로 중계
```

| 실제 curl (`node scripts/probe/prx1b-curl.mjs`) | 결과 |
|---|---|
| 정상 요청 | 200 |
| `-H "Host: a, b"` | 400 |
| 포트 0 | 400 |
| `-0`(HTTP/1.0) + `Transfer-Encoding: chunked` | 400 |
| 그 뒤 정상 요청 | 200 |

## 배울 점 1: "요청 스머글링"이란
프록시와 목적지 서버가 **"요청이 어디서 끝나는지"를 다르게 해석**하면, 공격자가 요청 하나 안에 두 번째 요청을 몰래 숨길 수 있다. 예를 들어 `Content-Length: 5`와 `Transfer-Encoding: chunked`가 함께 있으면, 한쪽은 길이 5로 읽고 다른 쪽은 chunked로 읽는다. 웹 개발로 치면 "프론트와 백엔드가 같은 JSON을 다르게 파싱하는" 상황이다. 그래서 **해석이 갈릴 여지가 있는 요청은 아예 받지 않는다**는 원칙으로 막는다.

## 배울 점 2: 추측 대신 실측
작업 전에 "무엇을 Node가 막을지" 예상(E22~E24)을 적고 실제로 돌려 봤다. 틀린 예상도 있었다.
- D15(헤더 3,000개): Node가 2,000개 넘는 헤더를 **몰래 버릴 것**이라고 예상했는데, 실제로는 431로 거부했다.
- C19 DELETE: Node가 이미 처리한다고 예상했는데 실패했다. 원인은 프록시가 아니라 **테스트 클라이언트**였다. Node 클라이언트는 DELETE 본문에 길이를 붙이지 않는다.
- C13, D14(아주 큰 요청): 거부는 되는데, Windows에서는 클라이언트가 아직 쓰는 중에 연결이 끊기면 응답 바이트가 지워져 상태 0으로 보였다.

## 작업 흐름 (커밋 순서)
1. `71eb378` 계획: 1b/1c 분할, 예상 E22~E24 (Node가 무엇을 막을지)
2. `5ad27d9` 테스트: 새 동작 6개(red: assertion 실패 6개), 회귀 40개(구현 전에도 통과)
3. `fb8c15c` server.ts: 검사 함수 3개로 분리 + 새 규칙 → 167/167
4. `b584cdf` 실측 스크립트: 실제 curl
5. (이 문서 커밋)

## 먼저 볼 코드
> 줄 번호는 문서 커밋 42cfee0 기준이다. 뒤의 PR(PRX-2, PRX-2b)이 server.ts를 고쳐서 지금 파일과는 다를 수 있다. 함수 이름으로 찾는다. (AUDIT-5)
- `src/proxy/server.ts:75` — 요청 처리기의 첫 줄들. **Host → 본문 경계 → URL** 순서로 검사하고, 하나라도 걸리면 바로 거부한다.
- `src/proxy/server.ts:39` — 호스트 없는 URL 검사. `new URL('http:///path')`를 믿지 않고 원문을 직접 본다. URL 표준이 이걸 "호스트가 path인 URL"로 해석하기 때문이다(실측).
- `src/proxy/server.ts:56` — `validateHost()`. `rawHeaders`(원래 헤더 목록)에서 host가 몇 번 나왔는지 센다. `req.headers`는 Node가 중복을 합쳐 버려서 셀 수 없다.
- `src/proxy/server.ts:65` — `validateFraming()`.

## 파일별 변경
### test/prx/_raw.ts — 원시 바이트를 그대로 보내는 도우미. HTTP 클라이언트 라이브러리는 잘못된 요청을 보내기 전에 막아 버려서 공격 사례를 시험할 수 없다
### test/prx/_prx1b-setup.ts — 프록시 + 목적지 서버 준비, 이번 테스트에 도착한 요청만 보기
### test/prx/PRX-1b.test.ts — 새 동작 6개
### test/prx/PRX-1b-regression.test.ts — Node와 PRX-1이 이미 막는 40개. **우리 코드가 아니라 Node의 방어를 지키는 테스트**다
### src/proxy/server.ts — 34행 `validateTarget`, 56행 `validateHost`, 65행 `validateFraming`
### scripts/probe/prx1b-curl.mjs — 실제 curl 실측
### docs/ai/purpose-tree.md, docs/ai/prx1-cases.md — PRX-1c 추가, 1b/1c 배정
