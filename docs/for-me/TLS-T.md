# [TLS-T] TLS 큰 단위 테스트        커밋: 59f12b6..(이 문서 커밋)

## 한 줄 요약
HTTPS를 엿보는 전체 흐름을 테스트로 **먼저** 고정했다. 아직 만든 것이 없어서 이 테스트는 "대기" 상태다. TLS-4가 `src/tls/mitm.ts`를 만들면 실제 검사가 된다.

## 테스트가 확인하는 흐름
```
 클라이언트 ── CONNECT localhost:U ──▶ [프록시]  ← 지금은 501로 거절 (TLS-1에서 바뀜)
    │ 같은 연결 위에서 TLS: 프록시가 즉석에서 만든 localhost 인증서 (TLS-2 CA, TLS-3 발급)
    │ 클라이언트는 "프록시 CA"만 믿는다 → 브라우저에 루트 CA를 등록한 것과 같은 상황
    └─ GET /hello?q=1, Cookie: k=SECRET
           ▼ 프록시가 복호화 → 기록(Flow) (TLS-4)
           ▼ 목적지 인증서를 **검증한 뒤** HTTPS로 중계
       로컬 HTTPS 목적지 ──▶ 200 secure-hello
```
1. **정상 흐름**: 클라이언트가 프록시 인증서를 믿고, 응답 `secure-hello`를 받고, 목적지가 `/hello?q=1`과 쿠키를 받고, 기록에 `target = { scheme: 'https', host: 'localhost', port, path: '/hello?q=1' }`이 남는다.
2. **목적지 인증서를 믿을 수 없을 때**: 중계하지 않고 502, 기록 `bad-certificate`. 복호화 프록시가 목적지 검증을 건너뛰면, 프록시와 목적지 사이에서 누군가 다시 가로채도 알 수 없다. 그래서 큰 단위 테스트에 처음부터 넣었다.

## "대기" 상태가 지금 보이는 모습
```
ℹ tests 368 / pass 366 / fail 0 / todo 2
ℹ 큰 단위 대기(todo) TLS: 2개, 그중 실패 2개 — 대기 중인 파일이 생기면 실제 검사가 된다
```
`npm test`는 통과(종료 코드 0)로 끝나고, 연속 실패 카운터도 세지 않는다(INFRA-9). 작은 단위를 하나씩 끝낼 때마다 이 줄을 보면 된다.

## 테스트가 정해 둔 모양 (설계, TLS 보고서에 올림)
| 무엇 | 모양 |
|---|---|
| CA 모듈 | `src/ca/ca.ts`: `loadOrCreateCA(폴더)`, `issueCert(CA, 호스트들)` |
| 프록시 옵션 | `startProxy({ ca, upstreamCA })` — `ca`가 있으면 HTTPS 복호화, `upstreamCA`는 목적지 검증에 **추가로** 믿을 CA(검증 자체는 끄지 않음) |
| 기록 | 복호화한 요청은 `request.url = '/hello?q=1'`(터널 안 원문), 호스트는 `target`에 |
| 실패 코드 | 목적지 인증서 불신 → `bad-certificate` |

## 안전 규칙
- 테스트는 **임시 폴더에 매번 새 CA**를 만들고 끝나면 지운다. Windows 인증서 저장소와 `%APPDATA%\sumun\ca\`는 건드리지 않는다.
- 이 PC의 curl은 Windows 저장소(Schannel)를 써서, 테스트용 CA를 curl에 믿게 하는 방법이 확실하지 않다 [확인됨: `curl.exe -V`]. 그래서 테스트는 Node의 TLS 클라이언트로 같은 흐름을 재현하고, curl 확인은 TLS-4에서 한다.

## 작업 흐름 (커밋 순서)
1. `59f12b6` 계획: 대기 파일 `src/tls/mitm.ts`, 설계, 예상 E54·E55
2. `0accbe1` 테스트 2개 → red: 2개 모두 실패(오류: `src/ca/ca.ts` 없음 — 예상된 유형). 전체 `npm test`는 종료 코드 0, 대기 2개
3. (이 문서 커밋)

## 먼저 볼 코드
- `test/tls/TLS-T.test.ts:20` — 대기 조건: `src/tls/mitm.ts`가 없으면 todo
- `test/tls/TLS-T.test.ts:25` — `setup()`: 임시 폴더에 CA 두 개(프록시용, 목적지용)
- `test/tls/TLS-T.test.ts:68` — `httpsViaProxy()`: CONNECT 뒤 같은 소켓에서 TLS
- `test/tls/TLS-T.test.ts:96` — 정상 흐름 테스트
