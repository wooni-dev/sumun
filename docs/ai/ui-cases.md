# UI 사례: 대시보드 보호 (O10: 검토 에이전트가 제안)

출처: 2026-11-08, 별도 컨텍스트의 검토 에이전트가 `src/`(proxy, tls, store, flow, index), `docs/ai/purpose-tree.md`, `prx1-cases.md`, `sto-cases.md`를 읽고 추론하고, `%TEMP%\sumun-ui-review\`에서 127.0.0.1 포트로 실험했다. 실험 스크립트는 `scripts/probe/ui-review/`로 옮겼다(O19). 작업자의 해결안은 알려 주지 않았다.
배경: 기록에는 방문한 모든 사이트의 쿠키·Authorization·본문이 원본으로 있다(STO S-4). 127.0.0.1 바인딩만으로는 부족하다(STO 보고서 결정 14).

## 실험 (에이전트, `node scripts/probe/ui-review/e1.mjs`, `e2.mjs`) [확인됨: 에이전트]
- E1~E3: 프록시를 거쳐 `127.0.0.1:<대시>`·`localhost:<대시>`·`0x7f000001:<대시>`로 보내면 200, 비밀이 돌아온다(`Origin: http://evil.example`이어도).
- E4: 프록시 자기 포트는 508(루프 검사는 자기 포트만).
- E5: 대시보드가 받은 요청은 remoteAddress 127.0.0.1, `Via: 1.1 sumun`, Origin 그대로, Host는 다시 써짐.
- E6·E7: 대시보드 응답이 저장소에 기록으로 쌓인다(본문까지).
- E8·E9: 복호화 없음(`tunnel: true`)에서 `CONNECT 127.0.0.1:<대시>` → 200, 터널 안 평문 요청이 Host `anything.evil`·Via 없이 대시보드에 닿는다.

## 사례 (에이전트 번호, 요약)
**A. 다른 웹사이트 → 대시보드 API**: U1 DNS 리바인딩, U2 프록시를 거친 리바인딩(이름 해석을 프록시가 해서 브라우저 DNS 고정이 소용없음), U3 WebSocket 교차 출처(CSWSH), U4 `Access-Control-Allow-Origin: *`, U5 Origin 되돌리기, U6 no-cors POST·form CSRF, U7 부작용 있는 GET, U8 `<script src>`·JSONP로 읽기, U9 XS-Leak(시간·크기·오류), U10 클릭재킹, U11 같은 사이트(다른 포트의 개발 서버 — 쿠키는 포트를 가리지 않음), U12 브라우저의 Private Network Access에만 기댐, U13 출처 확인 없는 postMessage.
**B. 프록시를 거친 요청·루프**: U14 대시보드 요청이 프록시를 거쳐 다시 기록됨(증폭 루프, 민감 정보 두 겹), U15 불투명 터널로 Via·Host 검사 우회(브라우저는 ws://도 CONNECT로 보냄), U16 복호화 켠 CONNECT가 대시보드에 TLS로 붙으려다 실패 기록, U17 프록시와 같은 포트면 막아 둔 origin-form이 다시 열림, U18 외부 자원(CDN·favicon)이 기록·Referer 유출·공급망.
**C. 기록 내용이 화면에서 실행·속임**: U19 innerHTML XSS, U20 본문을 원래 Content-Type·srcdoc으로 렌더, U21 SVG·HTML blob URL, U22 `javascript:` 링크, U23 라이브러리의 innerHTML·eval, U24 헤더 이름 `__proto__`로 프로토타입 오염, U25 제어 문자·셸 복사, U26 RTL·zero-width·동형 문자·punycode, U27 매우 큰 값·많은 알림, U28 압축 폭탄·잘린 압축, U29 깊은 JSON·ReDoS를 서버에서, U30 필터 값 반사·오류 문구 반사, U31 접근 로그의 ESC 시퀀스.
**D. 실시간 통로·자원**: U32 구독자 수 상한 없음·검사 전 연결, U33 느린 구독자 버퍼, U34 재연결(마지막 id, evicted·cleared·runId), U35 큰 응답(limit, Buffer JSON), U36 출처당 6연결, U37 대시보드 서버의 slowloris·큰 본문·헤더 폭탄, U38 알림마다 무거운 일.
**E. 같은 PC·포트·토큰**: U39 다른 Windows 사용자, U40 같은 사용자의 악성 프로그램(대부분 범위 밖), U41 포트 선점·가짜 대시보드, U42 localhost가 ::1부터 풀림, U43 토큰이 URL 쿼리에, U44 토큰을 터미널에, U45 명령줄·환경 변수 토큰, U46 짧은 토큰·`===` 비교, U47 쿠키 세션이 다른 포트 서버로 감, U48 고정 토큰 파일.
**F. 켜짐·꺼짐·디스크·오류**: U49 같은 포트를 쓴 앱의 서비스 워커·저장소, U50 브라우저 디스크 캐시·localStorage에 상세, U51 오류 응답의 스택·기록 내용, U52 꺼진 상태의 다른 경로.
**오탐(막으면 안 됨)**: F1 `localhost`·`127.0.0.1` 둘 다, F2 프록시를 거친 대시보드 요청은 이유를 안내, F3 같은 출처 GET에는 Origin이 없을 수 있음·주소창 `Sec-Fetch-Site: none`, F4 토큰이 맞는 curl, F5 사용자 개발 앱(루프백) 기록, F6 기록 원본은 바꾸지 않음(출력할 때만 이스케이프), F7 탭 여러 개·새로고침, F8 몇 시간 열어 둠, F9 1MiB 본문 전체, F10 재시작 뒤 재연결은 "새 실행", F11 복호화 없이 실행, F12 이미지·JSON 미리보기.

## 사용자 결정 (2026-11-08, "모두 추천대로")
| # | 정한 것 |
|---|---|
| D-1 포트 | 프록시와 다른 고정 포트(기본 8081, 옵션으로 바꿈) |
| D-2 토큰 | 실행마다 새 토큰(128비트 이상, timingSafeEqual) |
| D-3 전달 | 터미널에 `http://127.0.0.1:<포트>/#t=<토큰>`. 페이지 JS가 `#` 뒤를 읽어 요청 헤더 `Authorization: Bearer <토큰>`으로 보낸다. 쿠키를 쓰지 않는다. 페이지(HTML·JS·CSS) 자체는 토큰 없이 받는다(데이터 없음) |
| D-4 실시간 | SSE를 fetch 스트림으로 읽음(같은 검사). WebSocket 없음 |
| D-5 프록시를 거친 요청 | 두 겹: 프록시가 대시보드 포트(루프백 주소, CONNECT 포함)로 가는 요청을 거부하고 우회 안내 + 대시보드가 `Via: … sumun`을 거부 |
| D-6 Host | `127.0.0.1:<포트>`, `localhost:<포트>`만 |
| D-7 교차 출처 | CORS 헤더를 붙이지 않음. Origin이 대시보드 자신이 아니거나 `Sec-Fetch-Site`가 `same-origin`·`none`이 아니면 처리 전에 거부(다른 포트도) |
| D-8 상태 변경 | 읽기 + 모두 지우기(POST, JSON). 복호화·CA는 명령줄에만 |
| D-9 본문 표시 | 텍스트(이스케이프)·16진 + 래스터 이미지 미리보기. SVG는 텍스트, HTML 렌더링 없음 |
| D-10 압축 | 브라우저에서 상한(10MiB)을 두고 풂. 서버에서 풀지 않음 |
| D-11 디스크 | 기록은 `Cache-Control: no-store`, 브라우저 저장소·서비스 워커에 넣지 않음. 화면 설정만 localStorage |
| D-12 기본 | `npm start`에서 항상 켬, `--no-dashboard`로 끔 |
| D-13 상한 [추측 수치] | 실시간 연결 16, 구독자 버퍼 1MiB(넘으면 끊고 다시 맞춤), 목록 한 번 500건, 요청 본문 16KB. 실측으로 조정 |
| D-14 URL 표시 | 원문 + 숨은 문자 `⟨U+202E⟩` 표시 + 호스트는 punycode와 유니코드 함께 |
| D-15 내보내기 | "curl로 복사" 없음 |
| D-16 화면 | 순수 DOM(textContent), CDN 없음, CSP `default-src 'self'` |

## 작은 단위와 배정 (O28: 두 단위에 걸치면 더 이른 단위)
| 단위 | 내용 | 사례 |
|---|---|---|
| UI-1 서버 골격과 요청 보호 `src/dashboard/server.ts` | 127.0.0.1 바인딩·포트 점유 검사, Host·Origin·Sec-Fetch-Site·Via, 토큰, CORS 없음, 보안 응답 헤더(CSP·frame-ancestors·nosniff·no-store·Referrer-Policy), 고정 오류 문구, 헤더 타임아웃·본문 상한, `npm start` 연결(D-12) | U1, U2, U4~U12, U14(서버 쪽), U37, U39, U41~U48, U50(헤더), U51, U52 |
| UI-2 프록시 쪽 대시보드 차단 `src/proxy/server.ts`, `src/tls/` | 대시보드 포트로 가는 평문·CONNECT 거부와 안내, 기록 없음 | U15, U16, U17 |
| UI-3 조회 API `src/dashboard/api.ts` | 목록(필터·페이지 상한·STO 결정 6)·상세·본문(따로, octet-stream)·지우기(POST) | U7, U8, U20(서버), U30(서버), U35 |
| UI-4 실시간 통로 `src/dashboard/events.ts` | SSE, 연결 상한, 검사 뒤 수락, 큐에 넣고 바로 반환(STO 결정 1), 느린 구독자, 재연결 | U3, U32~U34, U36, U38 |
| UI-5 화면 `src/dashboard/public/` | textContent, 링크 제한, 미리보기·압축 해제 상한, 큰 값·가상 스크롤, 유니코드 표시, Map, postMessage 없음, 브라우저 저장소 규칙, "복호화 꺼짐" 안내(STO 결정 4) | U13, U18, U19, U21~U29, U30(화면), U49, U50(화면) |
| 문서·안내 | 프록시 우회 목록, 토큰 취급, 범위 밖 | U12, U31, U40, U44 |

## 범위 밖
- X1 프록시의 루프 검사는 자기 포트만 본다. 같은 PC의 모든 루프백 서비스(개발 서버)가 프록시를 거친 리바인딩에 노출된다. 개발 앱 기록(F5)이 주된 사용 사례라 막지 않는다 → UI 보고서 결정 항목 [확인됨: E1~E3, E8].
