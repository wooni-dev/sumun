# [PRX-T] PRX 큰 단위 테스트        커밋: a28e879..(이 문서 커밋)

## 한 줄 요약
작은 단위(PRX-1~2b) 테스트는 부품을 하나씩 확인했다. 이 테스트는 **부품을 이어 붙인 전체 흐름**을 실제 curl로 한 번에 확인한다. 원래는 PRX를 시작할 때 먼저 썼어야 했다(AUDIT-5 지적).

## 흐름과 실제 값 (테스트에서 확인한 값)
```
curl -x http://127.0.0.1:<프록시> -H "Cookie: session=abc" --data-binary hello-sumun http://127.0.0.1:<목적지>/echo?q=1
  │  POST http://127.0.0.1:<목적지>/echo?q=1   (absolute-form, Proxy-Connection 헤더 포함)
  ▼
[프록시] PRX-1: origin-form으로 바꾸고 Proxy-Connection 제거, Via 추가
  │  POST /echo?q=1   cookie: session=abc   via: 1.1 sumun   본문 hello-sumun
  ▼
[목적지] 받은 본문을 그대로 돌려줌 → 200 hello-sumun
  │
  ├──▶ curl: 200, 본문 hello-sumun
  └──▶ 기록(Flow) 1건 — PRX-2
         request:  POST, url = 받은 원문, 헤더에 Host·User-Agent·Proxy-Connection·Cookie·Content-Length, 본문 hello-sumun
         response: 200, 본문 hello-sumun
         error:    없음
```
닿지 않는 목적지로 보내면 curl은 502를 받고, 기록은 `response` 없이 `error: { by: 'upstream', code: 'unreachable', status: 502 }`로 남는다.

## 왜 회귀 파일인가
이미 만든 기능을 이어 붙여 확인하는 테스트라서 **처음부터 통과하는 게 정상**이다(예상 E37 → 일치). 실패했다면 부품 사이의 이음새에 문제가 있다는 뜻이었다. 앞으로 TLS(HTTPS), 저장소, 대시보드를 만들 때 이 흐름이 깨지지 않는지 계속 확인한다.

## 작업 흐름 (커밋 순서)
1. `a28e879` 계획: 예상 E37, E38. PRX 상태를 "확인 대기"로 되돌림
2. `04a3143` 테스트 2개 → 2/2, 전체 257/257
3. (이 문서 커밋)

## 먼저 볼 코드
- `test/prx/PRX-T-regression.test.ts:45` — 정상 흐름. curl, 목적지, 기록 세 곳을 차례로 확인한다.
- `test/prx/PRX-T-regression.test.ts:81` — 닿지 않는 목적지.
