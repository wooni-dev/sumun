# 목적 나무

상태: ⬜ 미착수 / 🔨 진행 중 / ✅ 완료 / ⚠ 결정 필요
권한: Claude는 상태 변경과 작은 기능 추가만 할 수 있다(보고서에 표시). 최종 목적과 큰 기능을 추가·삭제·이동하거나 근거를 바꾸려면 사용자 승인이 필요하다.

## 최종 목적
내 PC에서 오가는 HTTP(S) 요청과 응답을 Wireshark처럼 실시간으로 보고, 그 과정을 직접 만들면서 HTTPS와 인증서의 동작 원리를 이해한다.

### 완료 조건 (목표)
- 브라우저의 프록시를 `127.0.0.1:8080`으로 설정하면, HTTPS 사이트의 요청과 응답(메서드, URL, 상태 코드, 헤더, 본문)이 대시보드 목록에 실시간으로 나타난다.
- 목록에서 하나를 고르면 요청과 응답의 상세 내용을 볼 수 있다.
- 호스트, 메서드, 상태 코드로 필터링할 수 있다.
- 루트 CA를 만들고, 등록하고, 해제하는 방법이 명확하다. 개인키는 저장소 밖에 있다.
- 사용자가 `docs/for-me/` 문서만 읽고 HTTPS 복호화 흐름을 설명할 수 있다.

### 하지 않을 것 (현재 기준)
- HTTP/2, HTTP/3, WebSocket 내용 해석
- 패킷 스니핑(Npcap) — 나중에 추가 기능으로 검토
- 요청 수정·재전송(Fiddler의 breakpoint 같은 기능)
- 다른 PC나 휴대폰의 트래픽

## 나무

```
최종 목적: HTTP(S) 실시간 모니터 + 동작 원리 이해
 ├ [PRX] HTTP 프록시 — 왜: 평문 요청을 중계하며 기록하는 뼈대         ✅ (보고서 승인 2026-11-07, 후속 PRX-3·4 완료)
 │   ├ [PRX-T] 큰 단위 테스트: 실제 curl → 프록시 → 목적지 → 기록(Flow)   ✅  → test/prx/PRX-T-regression.test.ts  (2026-11-07 AUDIT-5 결정 (가))
 │   ├ [PRX-1] 요청 중계 (받기 → 실제 서버로 전달 → 응답 돌려주기)       ✅  → src/proxy/server.ts, headers.ts
 │   │         + 열린 프록시·루프·Host·hop-by-hop·오류 응답 (docs/ai/prx1-cases.md 배정 "1")
 │   ├ [PRX-1b] 요청 쪽 방어: 잘못된 URL·Host, 요청 스머글링 파서, 헤더 크기·개수   ✅  → src/proxy/  의존: PRX-1
 │   │         (prx1-cases.md 배정 "1b". 2026-11-07 Claude가 추가 — 작은 기능 추가, 보고서에 표시)
 │   ├ [PRX-1c] 목적지 쪽·견고성: 타임아웃, 대용량 스트리밍, 응답 경계, Upgrade, 포트 설정   ✅  → src/proxy/  의존: PRX-1b
 │   │         (prx1-cases.md 배정 "1c". 2026-11-07 PRX-1b에서 나눔 — 작은 기능 추가, 보고서에 표시)
 │   ├ [PRX-2] 요청/응답을 Flow로 기록 (prx2-cases.md 배정 "2")         ✅  → src/flow/flow.ts, server.ts   의존: PRX-1
 │   ├ [PRX-2b] 기록의 자원 상한·나머지 경계 (prx2-cases.md 배정 "2b")   ✅  → src/proxy/server.ts   의존: PRX-2
 │             (2026-11-07 PRX-2에서 나눔 — 작은 기능 추가, 보고서에 표시)
 │   ├ [PRX-3] Flow 모양 보완: 시작 알림, 목적지 칸(target), 본문 도중 타임아웃, 실패 코드 bad-response   ✅  → src/flow/flow.ts, src/proxy/server.ts  (PRX 보고서 결정 2, 3, 4, 10)
 │   └ [PRX-4] 실행 진입점 `npm start` + 포트 값 검사(A10)   ✅  → src/index.ts, src/cli.ts  (PRX 보고서 결정 6)
 ├ [TLS] HTTPS 복호화 — 왜: 트래픽 대부분이 HTTPS라 내용을 보려면 필요  🔨  의존: PRX-2
 │   ├ [TLS-T] 큰 단위 테스트: CONNECT → 프록시가 TLS 종료 → 복호화한 요청을 기록 → 검증한 HTTPS 목적지로   🔨  → test/tls/TLS-T.test.ts  (대기: src/tls/mitm.ts)
 │   ├ [TLS-1] CONNECT 터널 (복호화 없이 그대로 통과)                    ✅  → src/tls/tunnel.ts  (tls1-cases.md 배정 "1")
 │   ├ [TLS-1b] 터널 견고성: half-close, 대용량, 연결 타임아웃, 동시 300개, 종료   ✅  → src/tls/tunnel.ts  (배정 "1b". 2026-11-07 TLS-1에서 나눔 — 작은 기능 추가)
 │   ├ [TLS-2] 루트 CA 생성·보관 ⚠ 개인키 보호                          ✅  → src/ca/ca.ts  (tls2-cases.md 배정 "2")
 │   ├ [TLS-2b] CA 보관 견고성: 원자적 쓰기, 동시 실행, 심어 둔 링크, 키 파일 ACL   ✅  → src/ca/ca.ts  의존: TLS-2  (배정 "2b". 2026-11-08 TLS-2에서 나눔 — 작은 기능 추가)
 │   ├ [TLS-3] 호스트별 인증서 즉석 발급                                 ✅  → src/ca/ca.ts  의존: TLS-2  (tls3-cases.md 배정 "3")
 │   └ [TLS-4] TLS 종료 후 복호화한 요청을 Flow로 기록                   ⬜  → src/tls/    의존: TLS-1, TLS-3
 ├ [STO] 저장소 — 왜: 지나간 요청을 다시 보고 화면에 전달해야 함         ⬜  → src/store/  의존: PRX-2
 ├ [UI] 대시보드 — 왜: 목록 + 상세 + 필터를 실시간으로 보기              ⬜  → src/dashboard/  의존: STO
 │   (작은 기능은 STO가 끝난 뒤 나눈다)
 └ [SEC] 안전장치 — 왜: MITM 도구는 잘못 쓰면 내 PC의 보안 구멍이 됨     ⬜  모든 기능에 걸침
     ├ [SEC-1] 127.0.0.1 바인딩 (PRX-1, UI에서 함께 검증)
     ├ [SEC-2] CA 키를 저장소 밖에 두고 git에서 제외 (TLS-2에서 함께 검증)
     └ [SEC-3] CA 등록·해제 명령과 안내 ⚠ Windows 인증서 저장소를 바꾸므로 사용자 확인 필요
```

## 개발 순서 (Claude 제안, 사용자 승인 대기)
PRX → TLS → STO → UI. 다른 기능이 기대는 것부터 만든다. SEC는 각 단계 안에서 함께 검증한다.
- 근거: [PRX-2]의 Flow 형태에 TLS, STO, UI가 모두 의존한다. 그래서 가장 먼저 확정한다(map.md의 #공유).
