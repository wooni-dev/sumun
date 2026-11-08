# [TLS-4] HTTPS 복호화: CONNECT 뒤 TLS를 풀어 요청을 기록        커밋: 232991f..(이 문서 커밋)

## 한 줄 요약
이제 `npm start -- --decrypt`로 띄우면 프록시가 **HTTPS 요청의 내용(메서드, 경로, 헤더, 본문)을 보고 기록**한다. 목적지 사이트의 인증서는 끝까지 검증하고, 믿을 수 없으면 연결하지 않는다. 큰 단위 테스트 TLS-T가 처음으로 실제로 통과했다(대기 0).

## 흐름 (실제 값, `node scripts/probe/tls4-curl.mjs`)
```
 curl ── CONNECT example.com:443 ──▶ [프록시 127.0.0.1]
                                       ├ 검사: 형식·이름은 한 번만 해석·자기 자신이면 508 (TLS-1과 같은 규칙)
                                       ├ example.com 인증서 준비(TLS-3 issueCert, 호스트별로 한 번만 발급)
      ◀── 200 Connection Established ──┤
      ══ TLS(프록시가 "나는 example.com", 루트 CA가 서명) ══▶ 안쪽 HTTP 서버가 요청을 읽음
      ── GET / (암호 안) ─────────────────▶ 기록 + 목적지로 새 TLS 연결
                                                 └─ 목적지 인증서를 공개 CA로 검증(끄지 않음) ──▶ example.com
      ◀── 200 ─────────────────────────────
요약 줄:  09:37:18 GET example.com:443 200 160ms
```
기록에는 `request.url = '/'`(암호 안에서 받은 원문), `target = { scheme: 'https', host: 'example.com', port: 443, path: '/' }`, `tls = { sni }`가 남는다. 요약 줄에는 지금처럼 경로·쿠키·본문을 쓰지 않는다.

## 가장 중요한 것: 목적지 검증을 끄지 않는다
MITM 도구에서 가장 흔했던 사고는 "**목적지 인증서가 가짜여도 브라우저에게는 믿을 만한 가짜 인증서를 내밀어 가리는 것**"이다(2017년 연구, Superfish 사건). 그러면 사용자는 진짜 공격을 알아챌 수 없다.

| 목적지 상황 | 결과 |
|---|---|
| 만료 / 자체 서명 / 이름 불일치 / 모르는 CA | 터널 안에서 `502 … 목적지 서버의 인증서를 믿을 수 없습니다.`, 기록 `bad-certificate`, 목적지 본문 0바이트 |
| **프록시 자신의 루트 CA가 서명한 목적지** | 역시 502. 나중에 루트 CA를 Windows에 등록해도 목적지 신뢰에는 넣지 않는다 |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` 환경 변수 | **그래도 502** |

마지막 줄은 실측(`scripts/probe/tls4-node.mjs`)에서 나온 것이다. 검증 옵션을 명시하지 않으면 이 환경 변수 하나로 만료·가짜 인증서 사이트의 본문(`secret-body`)이 그대로 넘어왔다. 그래서 `rejectUnauthorized: true`를 명시했고, 테스트로 고정했다.

## 정하신 것
| 상황 | 동작 |
|---|---|
| SNI(TLS에서 말한 이름) ≠ CONNECT 이름 | 인증서·목적지 모두 **CONNECT 기준**, 기록에 SNI를 남김. SNI로 연결 대상을 바꿀 수 없다 |
| 암호 안 요청의 Host가 CONNECT와 다름 | **421**. 다른 곳으로 연결하지 않는다 |
| 목적지를 믿을 수 없음 | **암호 안에서 502** 문구 |
| `npm start` | **`--decrypt`일 때만** 복호화. 없으면 지금처럼 내용 없이 통과 |

## 이 PR에서 찾아 고친 것
1. **localhost가 IPv6로 먼저 풀린다**: 이 PC에서 `localhost` → `::1`, `127.0.0.1` 순서다. 첫 주소만 시도하면 127.0.0.1에만 있는 서버에 닿지 못했다. 검사한 주소들을 차례로 시도하게 했다. (불투명 터널 쪽에도 같은 문제가 있어 TLS-4b로 넘김)
2. **클라이언트가 인증서를 거부해도 기록이 비었다**: 서버 쪽에는 오류 없이 닫히기만 한다. "핸드셰이크가 끝나지 않고 닫힘"으로 판정한다.
3. **제가 쓴 테스트 결함 4건**: 응답이 chunked(조각 전송)인데 본문이 끝에 그대로 있다고 가정(큰 단위 테스트 TLS-T 포함), IP 접속에 host를 안 넘김, 가짜 이름 해석에 `localhost.` 누락. 멈추고 보고드렸고, "테스트 수정 허용" 뒤 기대값은 그대로 두고 고쳤다(`9d8a528`).
4. **TLS-3 지연 테스트가 전체 실행에서 52ms로 실패**: 병렬 실행 부하 때문이다. 정하신 대로 일 없이 잰 기준선을 빼고 판정한다(`b1334f4`).

## 실제 curl로 확인 — 그리고 남은 문제 하나
루트 CA는 임시 폴더에 만들고 `curl --cacert`로만 믿게 했다(Windows 저장소는 건드리지 않음).
```
curl --cacert …               → (60) schannel: the revocation status is unknown
curl --cacert … --ssl-no-revoke → HTTP 200
```
Windows의 curl은 인증서가 폐기됐는지 확인하려 하는데, 우리 인증서에는 확인할 주소(CRL·OCSP)가 없다. 그래서 `--ssl-no-revoke`가 필요하다. 브라우저도 같은지는 루트 CA를 등록한 뒤(SEC-3) 확인한다.

## 테스트
- 새 동작 16개(`test/tls/TLS-4.test.ts`): 구현 전 16개 모두 assertion 실패, 오류 0개.
- 큰 단위 테스트 TLS-T 2개: **처음으로 대기가 아니라 실제로 통과**.
- 전체 `npm test`: **510개 모두 통과, 실패 0, 큰 단위 대기 0**.

## 작업 흐름 (커밋 순서)
1. `232991f` 계획: 사례 약 70개(TLS-4/4b로 나눔), 사용자 결정 4개, 예상 E95~E101
2. `f049895` 실측: head·안쪽 서버·검증 명시·오류 코드
3. `752437d` 테스트 16개
4. `830f606` tunnel.ts → `cb3c65f` flow.ts → `af2eb9c` mitm.ts → `ac93999`·`808f96f` 주소 목록·핸드셰이크 판정 → `336cb13` server.ts → `0040d69` cli.ts → `d0b0168` index.ts
5. `c8134fd` 실측: 테스트 결함 확인 / `853d33e` 기록: 멈춤
6. `9d8a528` 테스트 수정(허용) / `b1334f4` TLS-3 E45 수정(결정) → 510 통과
7. `8f32bb5` 실측: 실제 curl
8. (이 문서 커밋)

## 먼저 볼 코드
- `src/tls/mitm.ts:44` — `openMitm()`: CONNECT 하나의 수명(검사 → 인증서 → 200 → TLS → 안쪽 서버)
- `src/tls/mitm.ts:81` — `openMitm()` 안: CONNECT와 함께 온 ClientHello를 되돌려 넣음
- `src/tls/mitm.ts:20` — `createCertCache()`: 호스트별 인증서, 같은 호스트는 한 번만 발급
- `src/tls/tunnel.ts:72` — `checkConnect()`: 불투명 터널과 같이 쓰는 CONNECT 검사
- `src/proxy/server.ts:176` — `handle()`: 평문 요청과 암호 안 요청이 같이 쓰는 처리기
- `src/proxy/server.ts:77` — `checkRoute()`: 암호 안 Host·대상이 CONNECT와 같은지(다르면 421)
- `src/proxy/server.ts:239` — `handle()` 안: 목적지 검증을 명시적으로 켬
- `src/proxy/server.ts:174` — `trust`: 목적지 신뢰 목록(공개 CA + upstreamCA, Windows 저장소 안 씀)
- `src/proxy/server.ts:294` — `handle()` 안: 인증서 오류면 bad-certificate 502
- `src/index.ts:26` — `--decrypt`일 때 루트 CA 불러오기·만들기

## 남은 것
- [TLS-4b] 핸드셰이크 타임아웃, TLS가 아닌 바이트, ALPN h2만, 파이프라이닝, Upgrade(WebSocket) 거부, 캐시 상한·만료, 실패 원인 세부, 불투명 터널의 주소 목록, 핸드셰이크 뒤 클라이언트가 끊은 경우의 기록 코드.
- [SEC-3] 루트 CA를 Windows에 등록·해제(명령을 보여 드리고 확인), 브라우저 실측, 폐기 확인 문제.
- TLS 큰 단위 끝: TLS-4b 뒤 전체 테스트 → 감사 → 목표 문서만 보는 검토 → 보고서(`docs/for-me/TLS-report.md`).
