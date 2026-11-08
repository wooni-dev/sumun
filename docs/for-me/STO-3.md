# [STO-3] 필터와 페이지        커밋: d0ec57c..(이 문서 커밋)

## 한 줄 요약
목록을 **호스트·메서드·상태 코드**로 거를 수 있게 했다. 같은 사이트라도 기록마다 호스트 표기가 조금씩 달라서(끝 점, IPv6, 국제화 도메인, 숫자 IP), 입력과 기록을 **같은 규칙으로 맞춘 뒤** 비교한다. 목록은 "마지막으로 본 id 다음부터"로 나눠 받는다.

## 쓰는 법
```js
store.list({ host: 'example.com' })                  // example.com, api.example.com … (badexample.com은 아님)
store.list({ host: 'localhost:3000' })                // 포트까지
store.list({ method: 'post', status: 502 })           // 대소문자 무시, 브라우저가 받은 코드
store.list({ after: 120, limit: 50 })                 // id 120 다음부터 50개
matchesFilter(summary, { host: 'example.com' })       // 새 알림 하나가 지금 필터에 맞는지(대시보드용)
```
조건은 모두 AND다. 빈 문자열이나 `undefined`는 "조건 없음"이다(입력 칸을 비운 상태).

## 호스트를 맞추는 규칙 (결정 S-6)
| 입력 / 기록의 표기 | 맞춘 뒤 | 왜 다른가 |
|---|---|---|
| `Example.COM.` / `example.com.` / `example.com` | `example.com` | 끝 점은 DNS에서 같은 이름. 평문 기록과 CONNECT 기록은 점을 남기고, 복호화한 터널 안 기록은 뗀다 [확인됨: sto-cases D2] |
| `::ffff:127.0.0.1` / `[::FFFF:7f00:1]` | `[::ffff:7f00:1]` | 같은 IPv6 주소의 다른 표기 |
| `bücher.de` | `xn--bcher-kva.de` | 기록에는 punycode(ASCII로 바꾼 국제화 도메인)로 남는다 |
| `2130706433` | `127.0.0.1` | 숫자 하나로 쓴 IPv4 |
- 이름은 같은 호스트와 **하위 도메인**에 걸린다. IP는 정확히 같을 때만 걸린다. 그래서 `0.0.1`로는 `127.0.0.1`이 걸리지 않는다.
- `host:port`로 입력하면 포트도 비교한다. `localhost:80`처럼 기본 포트를 써도 그대로 비교한다. URL 객체는 기본 포트를 지워 버리므로, 포트는 직접 읽는다.
- 기준은 `url`이 아니라 `request.target`이다. target이 없는 기록(형식이 틀린 요청)은 호스트 조건에 걸리지 않는다.
- 해석할 수 없는 입력(`x y`, `[[::`)은 아무것도 걸리지 않는다. 예외를 던지지 않는다. 사용자가 아직 입력하는 중일 수 있기 때문이다.

## 상태 코드 (결정 S-3)
요약의 `status`로 거른다. 목적지가 응답했으면 그 코드, 목적지에 닿지 못해 프록시가 만든 응답이면 그 코드다(`statusFrom`으로 구별). 응답을 못 받은 기록(클라이언트가 끊음 등)은 상태 조건에 걸리지 않는다. 허용하는 값은 100~999와 0이다. 0은 응답 상태를 읽지 못한 기록에 실제로 나올 수 있는 값이다(sto-cases D7).

## 페이지: 왜 "몇 번째부터"가 아니라 "id 다음부터"인가
```
 처음 받은 페이지: [1, 2]         ← limit 2
 그 사이 상한으로 1, 2가 빠짐
 오프셋 방식 "3번째부터 2개"  → [5, 6]   ✗ 3, 4를 건너뜀
 id 방식   "2 다음부터 2개"   → [3, 4]   ✓
```

## 비용 (E147, 기록 10,000건)
`list()` 2.33ms, `list({ host })` 11.23ms(기록마다 호스트를 정규화), `list({ method, status })` 2.21ms, `limit: 50`이면 0.36ms. 새 알림 하나에 `matchesFilter`를 한 번 부르는 것은 0.01ms가 안 걸린다 [확인됨: `node scripts/probe/sto3-filter-cost.mjs`]. 대시보드는 알림이 올 때마다 전체를 다시 거르지 말고 `matchesFilter`로 판단하면 된다.

## 먼저 볼 코드
- `src/store/filter.ts:18` — `normHost`: 호스트 정규화(소문자, 끝 점, URL 규칙)
- `src/store/filter.ts:37` — `parseHost`: `host`, `host:port`, `[v6]:port`, 대괄호 없는 IPv6
- `src/store/filter.ts:63` — `parseFilter`: 조건 검사(잘못된 타입은 TypeError)
- `src/store/filter.ts:93` — `hostMatches`: 같은 호스트·하위 도메인, IP는 정확히
- `src/store/filter.ts:112` — `matchesFilter`: 요약 하나 판단(`matchesParsed`, `:103`)
- `src/store/store.ts:302` — `list`: after·조건·limit
