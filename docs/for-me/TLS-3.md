# [TLS-3] 사이트별 인증서 즉석 발급        커밋: a5974af..(이 문서 커밋)

## 한 줄 요약
루트 CA로 **사이트마다 그 사이트인 척하는 인증서**를 그 자리에서 만드는 `issueCert(ca, hosts)`를 만들었다. 브라우저가 실제로 보고 믿는 것이 이 인증서다. 아직 프록시에 연결하지 않았다(TLS-4).

## 어디에 쓰이나
```
 브라우저 ── CONNECT example.com:443 ──▶ 프록시
                                          │ issueCert(루트 CA, ['example.com'])   ← 이번 단위
                                          ▼
 브라우저 ◀── "나는 example.com"(루트 CA가 서명) ── 프록시      ← TLS-4에서 연결
 브라우저: 등록한 루트 CA가 서명했으니 믿는다 → 프록시가 내용을 본다
```

## 만든 인증서 (실제 값, openssl로 확인)
| 칸 | 값 | 왜 |
|---|---|---|
| 발급자 | `CN=sumun local CA 2026-11-07` (루트와 바이트까지 같음) | 다르면 브라우저가 발급자를 못 찾는다 |
| 이름(SAN) | `DNS:localhost, IP Address:127.0.0.1` | 브라우저는 CN이 아니라 SAN만 본다(Chrome 58부터). IP는 IP 칸에 |
| CA인가 | 아니오(cA=FALSE) | 이 인증서로 또 다른 인증서를 만들 수 없게 |
| 쓰임새 | 서버 인증만 | — |
| 유효 기간 | 1시간 전 ~ 30일 뒤(루트 만료일을 넘지 않음) | **사용자 결정** |
| 키 | 호출마다 새 RSA 2048 | **사용자 결정**: 하나가 새도 그 사이트에만 영향 |
| 서명 | SHA-256, 루트 키로 | — |

`openssl s_client`(독립된 TLS 클라이언트)로 확인(`node scripts/probe/tls3-openssl.mjs`):
```
-verify_hostname localhost  → Verify return code: 0 (ok)
-verify_ip 127.0.0.1        → Verify return code: 0 (ok)
-verify_hostname other.test → Verify return code: 62 (hostname mismatch)
```

## 받지 않는 이름
인증서에 들어가는 이름은 "이 인증서가 대표하는 사이트"다. 이상한 이름이 들어가면 의도보다 넓은 범위를 대표하거나, 검증기마다 해석이 달라진다.
| 거부 | 예 | 이유 |
|---|---|---|
| 와일드카드 | `*.example.com`, `*` | **사용자 결정**: 브라우저가 정확한 이름(SNI)을 알려 주므로 필요 없다 |
| 비ASCII | `bücher.de` | 브라우저는 `xn--bcher-kva.de`(punycode)로 보낸다. 그건 받는다 |
| 숫자 주소 변형 | `127.1`, `2130706433`, `0x7f.0.0.1` | 파서마다 해석이 다르다(TLS-1과 같은 원칙) |
| 숨은 글자 | NUL(`a.com\0.evil.com`), 공백, 쉼표, `CN=` | 2009년 NUL 바이트 공격, 이름 주입 |
| 포트·IPv4-mapped | `example.com:443`, `::ffff:127.0.0.1` | 형식 혼동 |
| 한 단어 | `myhost`, `com` | `localhost`만 예외 |
| 51개 이상 | — | 자원 보호 |

정규화도 한다: `Example.COM.` → `example.com`, 같은 이름은 하나로, `[::1]`·`0:0:0:0:0:0:0:1` → `::1`.

## 프록시를 멈추지 않게: 서명을 Node에 맡겼다
TLS-2에서 node-forge의 서명이 **동기**라서 그동안 프록시 전체가 멈춘다는 것을 쟀다. 웹 개발로 치면 메인 스레드에서 무거운 계산을 돌리는 것과 같다. 사이트마다 발급하면 새 사이트에 들어갈 때마다 멈춘다.

그래서 forge로는 인증서 "내용"(TBS)만 만들고, 서명은 Node의 `crypto.sign(…, 콜백)`에 맡겼다. 이것은 **스레드 풀**에서 돈다(웹 워커와 비슷). 실측(`scripts/probe/tls3-sign.mjs`):
```
Node 서명:  이벤트 루프 최대 지연 11~16ms
forge 서명: 이벤트 루프 최대 지연 43~57ms
```
테스트는 1회 발급과 20개 동시 발급에서 모두 지연 50ms 이하를 확인한다.

## 테스트
- 새 동작 15개(`test/ca/TLS-3.test.ts`): 구현 전 15개 모두 assertion 실패, 오류 0개.
  - 실제 TLS 핸드셰이크: 루트만 믿는 클라이언트가 맞는 이름·IP로는 성공하고, 다른 이름으로는 실패.
  - 말단 키로 "손자 인증서"를 만들어 보면 거부된다(cA=FALSE가 실제로 동작).
  - 루트 만료가 10일 남았으면 말단 만료를 거기에 맞춰 자르고, 1일 미만·만료·시작 전이면 거부.
  - 발급하는 동안 디스크에 아무것도 쓰지 않는다(fs 쓰기 함수를 감시).
- 전체 `npm test`: 492개 중 490 통과, 실패 0, 큰 단위 대기 TLS 2개.

## 작업 흐름 (커밋 순서)
1. `a5974af` 계획: 사례 55개(47~55는 TLS-4), 사용자 결정 3개, 예상 E85~E92
2. `88fe98b` 실측: Node 서명·IP SAN·AKI·발급자 이름·핸드셰이크
3. `1b2d6aa` 테스트 15개
4. `6cff3df` ca.ts → 490 통과
5. `0c45d3d` 실측: openssl s_client
6. (이 문서 커밋)

## 먼저 볼 코드
- `src/ca/ca.ts:384` — `issueCert()`: 전체 흐름
- `src/ca/ca.ts:331` — `normalizeHosts()`: 받지 않는 이름과 정규화
- `src/ca/ca.ts:362` — `checkIssuer()`: 루트가 쓸 수 있는지(짝·정책·남은 기간)
- `src/ca/ca.ts:403` — `issueCert()` 안: 30일, 루트 만료로 자름
- `src/ca/ca.ts:408` — `issueCert()` 안: 발급자 이름을 루트와 바이트까지 같게
- `src/ca/ca.ts:423` — `issueCert()` 안: Node 스레드 풀에서 서명

## 남은 것 (TLS-4)
- 같은 사이트는 한 번만 발급하고 재사용(캐시, 상한, 만료 임박이면 재발급).
- SNI와 CONNECT 이름이 다를 때, SNI가 없을 때.
- **목적지 인증서가 믿을 수 없으면 가짜 인증서로 숨기지 않는다**(실제 MITM 제품에서 가장 흔했던 결함 — TLS-T의 bad-certificate 502).
- 실제 curl·브라우저 확인.
