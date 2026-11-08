# [TLS] 중간 확인 보고서 (큰 단위: HTTPS 복호화)        2026-11-08, main = bd8dc3e

> **사용자 답: (대기)** — 아래 "결정이 필요한 항목"과 "개발 방식 보정 후보"를 확인해 주세요. 승인 내용은 이 줄과 `docs/method-feedback.md`에 적고, TLS를 ✅로 바꿉니다.

## 결과 요약
- 작은 단위 8개(TLS-T, 1, 1b, 2, 2b, 3, 4, 4b) 완료. 전체 테스트 **523개 통과 / 0개 실패 / 큰 단위 대기 0** [확인됨: 실행 증거 1]
  - 큰 단위 테스트 TLS-T는 처음엔 대기(todo)였고, TLS-4가 `src/tls/mitm.ts`를 만든 뒤 **실제로 통과**했다.
- **검토 에이전트 확인**(새 컨텍스트, 목표 문서 `purpose-tree.md`와 코드만 봄 — 진행 기록·사용자 문서·사례 문서·커밋 메시지는 읽지 않음): **노드 8개 중 일치 7, 부분 1(TLS-4b), 불일치 0**. 완료 조건 중 TLS 몫과 보안 규칙 4가지는 모두 충족.
  - 부분 1개 = **결함 1**: 복호화 터널 안에서는 "헤더를 늦게 보내는 연결을 끊는" 제한이 듣지 않는다. 핸드셰이크 뒤 아무것도 안 보내거나 헤더를 반만 보낸 연결이 닫히지 않는다 [확인됨: 검토 에이전트 실행, Claude 재현]. → 결정 항목 1
  - 검증 스크립트는 저장소 안 `scripts/review/tls/`에 있다(O19).
- **개발 방식 감사**(method-auditor, 입력은 노드 ID "TLS"만): 작은 단위 규칙은 대부분 지켰다. 기계 검사 ❌ 7건은 모두 원인이 기록돼 있다(형식 1, 커밋 순서 1, **허용받은 테스트 수정 4**, 큰 단위 보고서는 감사 시점에 없었음). 방식 보정 후보 8건(O39~O46).

## 흐름 (실제 값 — `scripts/probe/tls4-curl.mjs`, `scripts/review/tls/review-mitm.ts`)
```
 curl / 브라우저   (npm start -- --decrypt, 브라우저 프록시 = 127.0.0.1:<포트>)
   │ CONNECT example.com:443
   ▼
 [TLS-1] 대상 검사: host:port 형식만, 이름은 한 번만 해석, 자기 자신이면 508
   │ ◀── 200 Connection Established
   │ ══ TLS ══  [TLS-3] 프록시가 "나는 example.com" 인증서(30일, 새 키, 루트 CA가 서명)  [TLS-2] 루트 CA: %LOCALAPPDATA%\sumun\ca
   │            [TLS-4b] 10초 안에 핸드셰이크가 끝나지 않으면 닫음
   │ GET / (암호 안)                      ← SNI가 달라도 인증서·목적지는 CONNECT 이름 기준 / Host가 다르면 421
   ▼
 [TLS-4] 기록 + 목적지로 새 TLS: 공개 CA로 검증(끄지 않음 — 환경 변수로도)
   ├─ 믿을 수 있음 → 200          요약 줄: 09:37:18 GET example.com:443 200 160ms
   └─ 믿을 수 없음 → 502          기록: { error: { by: 'upstream', code: 'bad-certificate', status: 502 },
                                          tls: { sni: 'mismatch.test', upstreamError: 'ERR_TLS_CERT_ALTNAME_INVALID' } }
 기록(Flow) 예: { request: { method: 'POST', url: '/a?q=1', target: { scheme: 'https', host: 'good.test', port: 62691, path: '/a?q=1' },
                  headers: [... ['Cookie', 원본] ...], body: hello }, response: { status: 201, ... }, tls: { sni: 'good.test' } }
```

## 결정이 필요한 항목
"현재 구현"이 추천과 같으면 승인만 하면 된다. 1·2번은 승인하면 **TLS를 ✅로 바꾸기 전에** 작은 단위 하나(TLS-4c)로 만든다.

| # | 항목 | 선택지 | 추천 | 이유 | 현재 구현 |
|---|---|---|---|---|---|
| 1 | ⚠ **검토 결함 1**: 복호화 터널 안에서 유휴·느린 헤더 연결이 안 닫힘 | A. 지금 고침(TLS-4c) / B. 나중에 | **A** | 설정값(`headersTimeoutMs`)이 소리 없이 무시되고 연결이 쌓이면 소켓·메모리가 샌다. 원인은 안쪽 HTTP 서버가 listen하지 않아 Node의 연결 검사 타이머가 돌지 않는 것으로 보인다 [추측]. 접속자는 이 PC 프로그램뿐이라 영향은 제한적 | 안 닫힘(6초·40초 실측) |
| 2 | 검토 결함 2: 목록에 없는 인증서 오류 코드(예 CERT_CHAIN_TOO_LONG)가 `unreachable`로 기록됨 | A. 1번과 함께 고침 / B. 그대로 | A | 검증은 그대로 실패하므로 우회는 아니고 분류만 틀린다. 함께 고치면 비용이 작다 | 목록 16개만 |
| 3 | 검토 결함 3: 서로 다른 이름으로 CONNECT를 반복하면 매번 키를 만든다(CPU) | A. 발급 속도 제한 / B. 그대로(기록만) | B | 접속자는 이 PC 프로그램뿐이다. 실제로 느려지면 그때 | 제한 없음 |
| 4 | **큰 단위 테스트 TLS-T를 고친 것**(9d8a528, 허용받음): 본문이 원문 끝에 그대로 있다는 가정 → chunked를 풀어 비교 | 승인 / 되돌리기 | 승인 | 목적지가 길이 없이 보내면 프록시는 HTTP 규칙대로 chunked로 전달한다. 기대값("본문 = secure-hello")은 그대로 | 고침 |
| 5 | 결정 9 조정: 실패 원인 세부를 `error.detail` 대신 **`tls.upstreamError`**에 | 승인 / `error.detail`로 | 승인 | `error`를 정확히 비교하는 TLS-T·TLS-4 테스트를 깨지 않고, 기록 모양을 덜 흔든다 | `tls.upstreamError` |
| 6 | CONNECT 기록 규칙(TLS-4 결정 7): 터널 안 요청이 있으면 요청마다 기록하고 CONNECT 기록은 거절·핸드셰이크 실패·빈 터널일 때만 | 승인 / 둘 다 기록 | 승인 | 같은 일을 두 번 세지 않는다. 검토 에이전트 추천(둘 다)과 달라 올린다 | 요청마다 |
| 7 | 핸드셰이크 뒤 클라이언트가 요청 없이 끊은 CONNECT(curl의 폐기 확인 실패 등)는 오류 없이 기록 | A. 그대로 / B. `client aborted`로 | A | 브라우저의 사전 연결(preconnect)도 같은 모양이라 구별할 수 없다 [추측] | 오류 없음 |
| 8 | PRX-4 결정 D1~D12′(요약 줄의 이스케이프·길이, 포트 형식, 모르는 인자 거부, 환경 변수 안 읽음, 종료 2초) | 승인 / 항목별 수정 | 승인 | `docs/ai/prx4-cases.md` 결정 표. 요약 줄에 경로·쿼리·쿠키를 쓰지 않는다 | 추천대로 |
| 9 | INFRA-9 결정 a~j(큰 단위 테스트의 대기 예외: `{ todo: !existsSync(P) }`만, 실행기가 직접 확인, export 있으면 예외 없음) | 승인 / 수정 | 승인 | 이번에 실제로 TLS-T가 대기 → 통과로 넘어가는 것을 확인했다 | 추천대로 |
| 10 | TLS-T 설계(`loadOrCreateCA(dir)`·`issueCert(ca, hosts)`·`startProxy({ ca, upstreamCA })`, 불신 목적지 `bad-certificate`) | 승인 | 승인 | 그 모양대로 구현됐다 | 추천대로 |
| 11 | TLS-1 결정 0~12: 터널은 옵션일 때만(`npm start`는 켬), **모든 포트·같은 PC·사설 주소 허용(자기 자신만 막음)**, 연결 뒤 유휴 제한 없음, 동시 터널 상한 없음, 이름 한 번 해석 | 승인 / 포트 제한 등 수정 | 승인 | 개발 포트(3000, 8443)를 쓴다. 접속자는 이 PC 프로그램뿐이다. RFC의 SHOULD(알려진 포트로 제한)와 다르다는 점을 남긴다 | 추천대로 |
| 12 | TLS-2·2b의 추천 결정: RSA 2048, pathLen 0, 저장소 안·상대 경로 거부, 키 평문+본인만 ACL(DPAPI는 나중에), notBefore 1일 전, CN에 생성일, 키는 Node 생성, 동시 실행은 배타 배치 | 승인 | 승인 | 사용자가 정한 4가지(1.4.3, %LOCALAPPDATA%, 깨지면 멈춤, EKU serverAuth)와 함께 동작 확인 | 추천대로 |
| 13 | TLS-3의 추천 결정: 서명은 Node 스레드 풀, 캐시는 TLS-4, 비ASCII·IPv4-mapped·공백 거부, 한 단어 이름은 localhost만, 밑줄 허용, hosts 50개, 지연 기준 50ms(기준선 뺀 몫) | 승인 | 승인 | 사용자가 정한 3가지(30일, 새 키, 와일드카드 금지)와 함께 | 추천대로 |
| 14 | TLS-4·4b의 추천 결정: ca가 있는데 TLS가 아니면 닫고 기록, ALPN h2만이면 거절, 터널 안 Upgrade 501, 캐시 LRU 1000·핸드셰이크 10초, 폐기 확인 안 함, 목적지 신뢰 = 공개 CA + upstreamCA(Windows 저장소 안 씀) | 승인 | 승인 | 사용자가 정한 4가지(CONNECT 기준, 421, 터널 안 502, `--decrypt`)와 함께 | 추천대로 |
| 15 | Claude가 추가한 노드: TLS-T(큰 단위 테스트), TLS-1b, TLS-2b, TLS-4b(사례가 많아 나눔) | 승인 / 되돌리기 | 승인 | 작은 기능 추가 권한 안에서 했다 | 추가됨 |
| 16 | 사례 재배정(O28): tls1 T1~T5 → TLS-4, tls2 45의 pre-commit 차단 → 별도 hook 단위, tls3 47~55 → TLS-4, tls4 B4 → 4b, H1·H4(브라우저) → SEC-3, A9는 테스트 대신 실측(curl example.com 200), 4b의 A4·A6·B7·C6·F1·F2는 테스트 대신 문서·기존 경로 | 승인 / 되돌리기 | 승인 | 시험하려면 인터넷·브라우저·별도 CA가 필요하거나, 다른 사례가 같은 경로를 이미 덮는다 | 재배정됨 |
| 17 | 기계 검사 ❌ 7건을 이력 재작성 없이 남김 | A. 남김 / B. 이력 재작성 | A | 재작성하면 문서·메시지의 커밋 번호가 모두 틀어진다. 원인은 모두 기록돼 있다 | 남김 |
| 18 | 다음 순서 | A. TLS-4c → TLS ✅ → **SEC-3**(루트 CA 등록·해제) → STO → UI / B. TLS-4c → STO → UI → SEC-3 | **A** | 등록해야 브라우저로 실제로 써 볼 수 있다(목표 첫 줄). 등록 명령은 매번 보여 드리고 확인받는다. curl의 `--ssl-no-revoke` 문제도 여기서 | — |

## 개발 방식 보정 후보 (O39~O46, 8건 — 상세 `docs/method-feedback.md`)
모두 **승인을 추천**한다. 승인하면 TLS-4c 뒤 작은 단위 하나(INFRA-10)로 CLAUDE.md와 check-method에 반영한다.

| # | 한 줄 | 추천 | 이번 큰 단위에서 본 근거 |
|---|---|---|---|
| O39 | test-unchanged를 커밋 이름이 아니라 **테스트 파일 기준**으로 | 승인 | TLS-T를 고친 커밋이 [TLS-4] 이름이라 TLS-T가 ✅, E45 수정은 [TLS-3] 이름이라 TLS-3이 ❌ |
| O40 | 사용자가 허용한 테스트 수정은 "⚠ 허용됨"으로 따로 표시 | 승인 | ❌ 4건이 모두 허용된 수정이었다 |
| O41 | 사용자 결정에 따른 규칙 변경은 다른 ID(예 [RULE])로 PR 앞에 | 승인 | 키 위치 변경 커밋 때문에 TLS-2 plan-first ❌ |
| O42 | "이전 큰 단위 흐름에 이어 붙이기"를 확인 가능한 문장으로 | 승인 | TLS-T가 PRX-T의 curl 평문 흐름을 포함하는지 판정이 갈림 |
| O43 | 타이밍 assertion은 기준선 대비나 결정적 대리 지표로 | 승인 | E45가 병렬 실행에서 두 번 흔들림 |
| O44 | 허용 테스트 수정 뒤 "구현 전 코드에서 여전히 실패" 확인을 필수로 | 승인 | 9f211dd·a3cf4eb에서 효과적이었다 |
| O45 | 커밋 메시지는 Write + `git commit -F`로 쓰는 절차를 고정 | 승인 | hook의 "리다이렉트 + 테스트 경로" 차단이 반복(의도한 보수적 동작) |
| O46 | 결과를 모르는 탐색형 예상은 "탐색"으로 표시 | 승인 | E105·E107의 판정이 "실측 결과를 기록"이었다 |

## 자세히 볼 부분
- `src/proxy/server.ts:244` 부근 — 목적지 검증을 명시적으로 켬(`rejectUnauthorized: true`). 명시하지 않으면 환경 변수 하나로 가짜 사이트의 본문이 넘어왔다(`scripts/probe/tls4-node.mjs`).
- `src/tls/mitm.ts` — `openMitm()`: CONNECT 하나의 수명. 결함 1의 자리(핸드셰이크 뒤 제한).
- `src/ca/ca.ts` — `restrictToMe()`: 키 파일 권한을 본인 하나로. `icacls /grant:r`만으로는 SYSTEM·Administrators가 남았다.
- 범위 밖으로 남은 것: ① 테스트 코드가 `.claude/state/`에 직접 쓸 수 있는 빈틈(INFRA-9 사례 12, 제안 대기) ② PRX-2 F6 기록 유출 검사가 `%LOCALAPPDATA%\sumun`을 보지 않음(키 위치를 바꾼 뒤 생긴 빈틈, SEC-2 관련) ③ 이 PC는 한순간에 몰린 연결을 약 232개만 받음(OS) ④ Windows curl은 우리 인증서에 `--ssl-no-revoke`가 필요(SEC-3).

## 실행 증거
1. 전체 테스트: `npm test` → `tests 523 / pass 523 / fail 0 / todo 0` [확인됨: bd8dc3e 병합 뒤, 검토 에이전트도 같은 결과]
2. 검토 스크립트: `node scripts/review/tls/review-mitm.ts` → `합계 16개, 실패 1개`(실패 = "핸드셰이크 뒤 무요청 연결이 10초 안에 닫힘(5개) 닫힘 0/5"). OK에는 "SNI 달라도 인증서는 CONNECT 이름", "Host 바꾸기 → 421", "NODE_TLS_REJECT_UNAUTHORIZED=0이어도 검증", "LOCALAPPDATA 없으면 거부" 등.
3. 결함 1 재현: `node scripts/review/tls/review-idle.ts 6` → `{"afterHandshake":null,"noClientHello":619,"plainIdle":762,"partialHeaders":null}`(null = 6초 안에 안 닫힘)
4. 실제 curl: `node scripts/probe/tls4-curl.mjs` → `--ssl-no-revoke`로 example.com `HTTP 200`, 믿을 수 없는 로컬 목적지 `502 … 인증서를 믿을 수 없습니다.` / `node scripts/probe/tls4b-curl.mjs` → localhost 터널 `[200]`
5. 기계 검사: `node scripts/check-method.mjs --id TLS`(49e4264 뒤) →
   | 규칙 | 결과 | 근거 |
   |---|---|---|
   | sub-nodes | ❌ | TLS-1b message-format, TLS-2 plan-first·test-first, TLS-2b·TLS-3·TLS-4·TLS-4b test-unchanged(결정 항목 17, O39·O40·O41) |
   | big-unit-test | ✅ | TLS-T 있음 |
   | big-unit-report | ✅ | 이 보고서 |
   | big-unit-review | ✅ | 검토 에이전트 확인 결과 있음 |
   | big-unit-todo | ✅ | 마지막 npm test: 전체 실행, 실패 0, TLS 대기 0 |
   - 처음에는 이 보고서를 `[TLS]` 이름으로 커밋해 검사기가 TLS를 작은 단위로도 판정했다(계획 커밋 없음 등). PRX 때처럼 `[AUDIT-6]` 이름으로 다시 커밋했다(아직 아무 데도 참조되지 않은 두 커밋, 내용 같음).
