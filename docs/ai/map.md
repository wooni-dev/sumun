# 설계 지도

새 프로젝트라서 분석이 아니라 설계다. 모든 내용은 구현하고 실측하기 전까지 [추측]이다.
멈추는 기준: 기능마다 5개 질문(진입점 / 거치는 모듈 / 입출력 / 공유 부분 / 외부 의존)에 답할 수 있으면 된다.

## 전체 흐름

```
 브라우저/curl ──(프록시 설정: 127.0.0.1:8080)──▶ [proxy] ──▶ 실제 서버
                                                   │  │
                       HTTPS(CONNECT)일 때 ───────┘  └── 기록 객체(Flow)
                       [tls] 인증서 발급·복호화              │
                              ▲                              ▼
                        [ca] 루트 CA                     [store]
                                                             │ 새 기록 이벤트
                                                             ▼
                              브라우저 ◀── WebSocket ── [dashboard] (127.0.0.1:8081)
```

## 모듈

| 모듈 | 역할 한 줄 | 태그 | 주의 사항 |
|---|---|---|---|
| `src/proxy/` | 평문 HTTP 요청을 받아 실제 서버로 전달하고 응답을 돌려준다 | #진입점 #외부:실제서버 | 127.0.0.1에만 바인딩한다. 그렇지 않으면 누구나 쓰는 열린 프록시가 된다 |
| `src/tls/` | [TLS-1] `tunnel.ts`: CONNECT 불투명 터널(`startProxy({ tunnel: true })`, 대상은 글자 검사·이름은 한 번만 해석·자기 자신 508, 기록은 바이트 수만). [TLS-1b] 목적지 연결은 반쪽 닫기 허용(FIN을 그대로 전달), 연결 함수는 `connectUpstream` 옵션으로 바꿔 끼움(테스트용). [TLS-4] `mitm.ts`: `ca`가 있으면 CONNECT 뒤 TLS를 종료(호스트별 인증서 캐시)하고 안쪽 HTTP 서버로 넘긴다. 터널 안 요청은 server.ts의 `handle()`이 평문과 같이 처리하고, 목적지에는 검증한 HTTPS(공개 CA + upstreamCA, rejectUnauthorized 명시)로 간다. `npm start -- --decrypt`에서만 켠다. [TLS-4b] 핸드셰이크 타임아웃(10초), 인증서 캐시 LRU 1000·만료 1일 전 재발급, 터널 안 Upgrade 501, 목적지 TLS 실패는 tls-handshake + tls.upstreamError, 불투명 터널도 검사한 주소들을 차례로. [TLS-4c] 안쪽 서버는 listen하지 않으므로 `inner.emit('listening')`으로 헤더 검사만 켠다(Node 내부 동작에 기댐 — TLS-4c 테스트가 지킴), 연결은 핸드셰이크 뒤에 넘긴다(헤더 시계 시작점), 헤더 제한이면 408·요청 없던 터널은 `client timeout`, 목적지 인증서 검증 실패는 `authorizationError`로 판단해 목록 밖(UNSPECIFIED)까지 bad-certificate | #보안핵심 | ALPN은 `http/1.1`만 제공한다(HTTP/2는 범위 밖). 핸드셰이크 전 `end`는 직접 닫아야 한다(CONNECT 소켓은 반쯤 닫힌 채 남음) |
| `src/ca/` | [TLS-2] `ca.ts`: `loadOrCreateCA(dir)` — 루트 CA 생성·보관(기본 `%LOCALAPPDATA%\sumun\ca`, `defaultCADir()`), 깨지거나 만료되면 `CAError`로 멈춤(자동 재생성 없음), 저장소 안·상대 경로 거부. [TLS-2b] 만들 때는 임시 파일 → 키 권한 본인만(icacls, System32 절대 경로) → 하드 링크로 배타 배치·실패 시 되돌림, 링크·정션 거부. [TLS-3] `issueCert(ca, hosts)` — 말단 인증서(30일·호출마다 새 키·와일드카드 금지), 이름 검사 `normalizeHosts`, 서명은 Node crypto.sign(스레드 풀). 이후 호스트별 인증서를 발급한다. [SEC-3] `winstore.ts`: Windows 저장소 접근(사용자 Root는 HKCU 레지스트리 Blob, 컴퓨터 Root는 합친 보기 지문, 쓰기는 certutil `-user -addstore`·`-delstore` 두 가지, 도구 절대 경로). `command.ts`: `npm run ca -- install·uninstall·status`(TTY의 영어 yes만, 관리자 거부, 인증서 하나·폴더 검사, 결과 재조회, 지문 겹침 거부, 옛·비슷한 CA 표시, 작업 기록 `%LOCALAPPDATA%\sumun\ca-command.log`). 진입점 `src/ca-cmd.ts` | #보안핵심 #공유 #외부:node-forge | ⚠ 개인키는 저장소 밖에 둔다. 암호 연산은 직접 구현하지 않는다. ⚠ Claude는 저장소를 바꾸는 명령(install·uninstall)을 실행하지 않는다 — TTY 검사가 막고, 사용자가 직접 실행한다 |
| `src/flow/` | 요청·응답을 기록 객체 `Flow`로 바꾼다. 프록시는 `startProxy({ onFlow })`로 요청마다 완료 때 1번 넘긴다 (PRX-2) | #공유 ⚠ proxy, tls, store, dashboard가 모두 의존 | 쿠키·토큰이 원본 그대로 들어 있다 → 출력·디스크 금지(prx2-cases.md F). `response`는 목적지가 보낸 것만, 프록시가 만든 응답은 `error.status`. 본문은 각 1MiB까지(`bodySize`는 전체). [PRX-3] 시작 알림 `onFlowStart`(같은 id), `request.target = { scheme, host, port, path }`(호스트 필터는 이것으로), 실패 코드 `bad-response`/`unreachable` 구분 |
| `src/store/` | [STO-1] `store.ts`: `createStore()` — 시작 알림은 진행 중 요약(CONNECT 제외), 기록이 오면 완료. `list()` 요약(본문·헤더 없음, 상태 출처 upstream/proxy, runId), `get(id)` 본문까지 복사한 사본(allocUnsafeSlow), `subscribe(fn)` 알림 `start`·`done`·`evicted`·`cleared`(구독자마다 structuredClone, 알림 중 알림은 큐, throw·reject는 세기만), `clear()` 전 요청의 늦은 완료는 버림. [STO-2] 상한 `STORE_LIMITS`(256MiB·완료 10,000·진행 중 1,000): 비용 = 저장된 본문 + 헤더 쌍당 64+2×글자 + 고정 256, 먼저 들어온 항목부터 빼고(방금 넣은 것은 남김) `evicted` 알림, 뺀 진행 중의 늦은 완료는 버림, `stats().bytes` | #공유 | 출력·디스크 금지(기록에 쿠키 원본). 상한은 STO-2, 필터는 STO-3, 프록시 연결은 STO-4(sto-cases.md) |
| `src/dashboard/` | 웹 서버, WebSocket, 정적 UI | #진입점 | 쿠키와 토큰이 그대로 보이므로 127.0.0.1에만 바인딩한다 |
| `src/index.ts` | 모든 모듈을 조립해서 실행한다. `npm start [-- --port N]` (PRX-4) | #진입점 | 터미널 출력은 `src/cli.ts`의 요약 줄(메서드·target·상태·시간)만. 경로·쿼리·헤더·본문 금지, 제어 문자 이스케이프(prx4-cases.md) |
| `test/` | `node:test` 테스트. 로컬 HTTP/HTTPS 서버를 띄워 실제 서버를 대체한다 | | 테스트에서 인터넷에 접속하지 않는다 |

## 기능별 5개 질문

| 기능 | 1. 진입점 | 2. 거치는 모듈 | 3. 입출력 | 4. 공유 부분 | 5. 외부 의존 |
|---|---|---|---|---|---|
| [PRX] HTTP 프록시 | proxy 서버의 `request` 이벤트 | proxy → flow → store | 입력: 절대 URL 요청(`GET http://host/path`) / 출력: 서버 응답 + Flow 1건 | flow, store | 실제 서버 → 테스트에서 로컬 서버로 대체 |
| [TLS] HTTPS 복호화 | proxy 서버의 `connect` 이벤트 | proxy → tls → ca → flow → store | 입력: `CONNECT host:443` + TLS 바이트 / 출력: 복호화된 응답 + Flow 1건 | ca, flow, store | 실제 HTTPS 서버 → 로컬 HTTPS 서버(테스트용 CA)로 대체 |
| [STO] 저장소 | `store.add(flow)` | store | 입력: Flow / 출력: 목록 조회, 새 기록 이벤트 | flow | 없음 |
| [UI] 대시보드 | dashboard HTTP 서버 | store → dashboard → 브라우저 | 입력: store 이벤트 / 출력: WebSocket 메시지(JSON), 화면 | store, flow | 브라우저(사용자가 직접 확인) |
| [SEC] 안전장치 | 각 서버의 `listen`, ca 저장 경로 | proxy, dashboard, ca | 입력: 설정 / 출력: 바인딩 주소, 키 파일 위치 | 전체 | Windows 인증서 저장소(`certutil`) ⚠ 매번 사용자 확인 |

## 기술 선택
- 언어: TypeScript. Node 24에서 별도 빌드 없이 실행할 예정이다 [추측: R-1에서 실측].
- 테스트: `node:test`(Node 내장).
- 외부 라이브러리: `node-forge`(인증서 생성)만 쓴다. 나머지는 Node 내장 모듈(`http`, `net`, `tls`)로 만든다.
