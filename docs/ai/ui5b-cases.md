# UI-5b 사례: 이미지 미리보기·압축 풀기·내려받기 (O10: 검토 에이전트가 제안)

출처: 2026-11-08, 별도 컨텍스트의 검토 에이전트가 `src/dashboard/`, `docs/ai/ui-cases.md`, 목적 나무 [UI-5b] 줄을 읽고 추론하고, Chrome 156.0.8078.80 headless(CDP)와 Node 24.21.0으로 실험했다. 작업자의 해결안은 알려 주지 않았다. 실험 스크립트는 `scripts/probe/ui5b-review/`로 옮겼다(O19, 실행: `node scripts/probe/ui5b-review/<파일>`; 공용 도우미 `cdp.mjs`는 임시 프로필로 headless Chrome을 띄움).
배경 사실 [확인됨: 에이전트]: 프록시는 `Accept-Encoding`을 지우지 않는다 → 기록에는 브라우저가 받은 압축 바이트 그대로(최대 1MiB, 넘으면 bodyTruncated).

## 공격·우회 사례 (요약)
| # | 내용 | 심각도 | 확인 |
|---|---|---|---|
| P1 | 대시보드가 `text/html`·`image/svg+xml` blob URL을 만들면, 사용자가 그 주소를 새 탭에 직접 열 때 대시보드 출처에서 스크립트가 돈다(만든 페이지 CSP가 따라오지 않음) | 높음 | [확인됨] c2.mjs |
| P1a | 대시보드 페이지가 직접 연 blob 창에는 CSP가 따라와 스크립트가 안 돈다 | 비교 | [확인됨] c4.mjs |
| P1b | 우클릭 "이미지를 새 탭에서 열기"가 P1인지 P1a인지 모름 | 높음일 수 있음 | [추측] |
| P2 | blob type을 기록 헤더에서 가져오면 공격자가 P1의 type을 고른다. PNG 바이트는 type과 무관하게 그려짐, SVG 바이트는 image/png로는 안 그려짐 | 높음 | [확인됨] c1.mjs |
| P3 | `<img>` 안 SVG는 스크립트가 안 돌지만, 최상위로 열면 하위 자원 요청이 나감 | 중간 | [확인됨] c1.mjs |
| P4 | 픽셀 폭탄: 20000×20000 PNG 389KB → 디코드 뒤 Chrome 메모리 +1.8~2.1GB. 30000×30000은 EncodingError | 중간 | [확인됨] c5.mjs |
| P5 | gzip 폭탄: 1GiB 0바이트 → 1,043,656B. 조각마다 읽고 10MiB에서 멈추면 96ms, `Response.arrayBuffer()`는 1GiB를 다 올림 | 높음 | [확인됨] c6.mjs |
| P6 | 중첩 압축 `gzip, gzip`: 1,826B → 1GiB. 층마다 상한이면 곱해짐. 층 수 많은 헤더 | 높음 | 크기 [확인됨], 층 수 [추측] |
| P7 | 잘린 스트림·끝 뒤 찌꺼기·여러 멤버: 오류 전에 앞부분은 나옴. "풀린 결과"와 원본이 달라짐 | 낮음~중간 | [확인됨] c6.mjs |
| P8 | Chrome 156 DecompressionStream = gzip·deflate·deflate-raw만(br·zstd·x-gzip 없음). **Node 24는 brotli를 지원해 Node 테스트와 다름**. 별칭·대소문자 처리 자체가 표면 | 중간 | [확인됨] c1.mjs, n1-decompress.mjs |
| P9 | `deflate` 라벨에 raw deflate → "incorrect header check", deflate-raw는 성공 | 낮음 | [확인됨] c6.mjs |
| P10 | 지금 CSP에서는 blob:·data: 이미지가 막힘. `img-src 'self' blob:`이면 blob:만 열림. **`createImageBitmap(blob)` → canvas는 지금 CSP에서도 동작**(img-src 적용 밖) | 정보 | [확인됨] c1.mjs |
| P11 | 래스터 디코더 취약점(예: CVE-2023-4863)이 대시보드 렌더러에서 터지면 기록 전체 | 영향 높음/가능성 낮음 | [추측] |
| P12 | 가짜 대시보드 UI를 그린 이미지(크기 제한 없으면 화면을 덮음), 프레임 많은 애니메이션 | 낮음~중간 | [추측] |
| P13 | `a.download` 이름: Chrome이 경로·RLO·예약 이름·.lnk를 고치지만 `.pdf.exe`·`.html`은 그대로. **blob type이 확장자를 붙임**(text/html → body.htm) → file://에서 스크립트 | 중간 | [확인됨] c3.mjs |
| P14 | 내려받기 기록(History DB `downloads.tab_url`)에 `#t=<토큰>`이 원문으로 디스크에 남음 | 낮음~중간 | [확인됨] c4.mjs(옛 실행) |
| P15 | 기록에서 온 이름을 서버 Content-Disposition에: CRLF·한글은 Node가 던짐(500), 따옴표로 `filename*` 덮어쓰기 주입 | 중간 | [확인됨] c6.mjs |
| P16 | 서버 URL로 내려받기는 Authorization을 못 실어 401 — 되게 하려면 토큰을 쿼리에(U43 재개방) | 정보 | [추측] |
| P17 | revoke 안 한 blob URL은 문서가 살아 있는 동안 열 수 있고 메모리가 쌓임 | 중간 | [추측] |
| P18 | 풀린 결과를 그대로 저장(1GiB 디스크), 풀린 결과로 이미지 판정을 다시 하면 압축 뒤에 숨은 SVG·HTML이 P2로 | 중간 | [추측] |
| P19 | 1MiB에서 잘린 압축 본문은 늘 "truncated" 오류 | 낮음 | [확인됨] |

## 오탐 (막으면 안 됨)
Q1 Chrome 기록 대부분은 br·zstd(브라우저가 못 풂) — 오류처럼 보이면 안 됨. Q2 `deflate`에 raw deflate. Q3 1MiB에서 잘린 정상 gzip — 앞부분은 보여야. Q4 9MiB까지 풀리는 정상 본문·고압축 텍스트. Q5 `GZIP`·`x-gzip`·헤더 두 줄. Q6 압축 헤더 + 0바이트, 평문에 gzip 붙인 서버. Q7 Content-Type이 틀린 정상 이미지. Q8 큰 정상 이미지(4000×3000, 8000×6000), 애니메이션, AVIF, ICO. Q9 SVG는 텍스트로(내려받기는 됨). Q10 요청 본문·잘린 본문·0바이트 내려받기. Q11 한글 파일 이름. Q12 반복·탭 여러 개·오래 열기. Q13 `identity`·빈 값은 압축 아님.

## CSP 사실 (에이전트, 권고 아님)
`default-src`가 script·img·worker·frame·object·media·connect를 대신한다. `img-src`만 적으면 이미지만 바뀐다. `default-src`에 blob:을 넣으면 스크립트·워커·프레임 blob도 열린다 [추측: 명세]. `img-src blob:`은 data:를 열지 않는다 [확인됨]. canvas·createImageBitmap은 img-src 밖 [확인됨]. 최상위 blob은 type대로 — 빈 type은 text/plain, octet-stream은 내려받기 [확인됨].

## 설계 결정 (작업자, [추측] — UI 보고서 결정 항목)
| # | 정한 것 | 막는 사례 |
|---|---|---|
| B-1 | **CSP를 바꾸지 않는다.** 미리보기는 `createImageBitmap(Blob)` → `<canvas>`로 그린다. blob:·data: URL을 만들지 않는다(`URL.createObjectURL` 없음) | P1·P1b·P2·P3·P10·P17 |
| B-2 | 이미지 판정은 **매직 바이트만**(PNG·JPEG·GIF·WebP·BMP·ICO). 기록의 Content-Type을 쓰지 않는다. SVG·HTML·AVIF는 미리보기 없음(텍스트·16진). Blob type은 판정한 형식으로 | P2, P18, Q7 |
| B-3 | 디코드 **전에** 머리에서 가로·세로를 읽고, 5천만 픽셀(약 200MB RGBA)이 넘거나 크기를 못 읽으면 그리지 않는다. 그린 비트맵은 바로 `close()`. 캔버스는 화면 상자 안(최대 폭·높이 CSS)에, "기록된 이미지" 테두리·이름표와 함께 | P4, P12, Q8 |
| B-4 | 압축 풀기는 `Content-Encoding` 전체(여러 줄은 쉼표로 이음)를 소문자로 나눠 identity·빈 값을 뺀 뒤 **정확히 한 층**일 때만: `gzip`·`x-gzip` → gzip, `deflate` → deflate(실패하면 deflate-raw로 한 번 더). 두 층 이상·br·zstd·그 밖은 풀지 않고 "이 브라우저에서 풀 수 없음 — 16진"(오류가 아닌 안내) | P6, P8, P9, Q1, Q2, Q5, Q13 |
| B-5 | 조각마다 읽고 합계 10MiB에서 멈춘다(`limitHit`). 오류(잘림·찌꺼기)면 그때까지 나온 앞부분과 "끝까지 풀지 못함" 안내. 0바이트는 빈 결과(오류 아님) | P5, P7, P19, Q3, Q4, Q6 |
| B-6 | 내려받기는 **원본 기록 바이트만**, 이름은 기록과 무관한 고정 `sumun-<id>-<request|response>.bin`, 저장은 `showSaveFilePicker`(File System Access — 링크·blob URL·서버 URL 없음, 다운로드 기록에 주소가 남지 않음). 없는 브라우저면 "이 브라우저는 저장 창을 지원하지 않습니다" | P13~P16, P18, Q10, Q11 |
| B-7 | 디코더 취약점(P11)은 막을 수 없다 — 미리보기는 사용자가 버튼을 눌렀을 때만(자동 아님) | P11 일부 |
