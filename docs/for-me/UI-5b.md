# [UI-5b] 화면 보강: 이미지 미리보기·압축 풀기·원본 저장        커밋: dd1d375..(이 문서 커밋)

## 한 줄 요약
상세 화면에서 **기록된 이미지를 미리 보고**, **gzip으로 압축된 본문을 풀어 읽고**, **원본 바이트를 파일로 저장**할 수 있습니다. 보안 헤더(CSP)는 하나도 바꾸지 않았습니다.

## 왜 조심해야 했나
기록된 본문은 아무 웹사이트나 만들 수 있는 데이터입니다. 대시보드는 모든 기록(쿠키 포함)을 들고 있어서, 대시보드 주소에서 공격자 코드가 한 번만 돌아도 다 털립니다. 그래서 별도 검토 에이전트에게 공격 사례를 먼저 받았습니다(`docs/ai/ui5b-cases.md`, P1~P19).

에이전트가 실제 Chrome으로 확인한 위험 몇 가지:
- **이미지인 척하는 HTML·SVG**: 흔히 쓰는 방법(blob URL을 만들어 `<img>`에 넣기)은, 사용자가 그 주소를 새 탭에 열면 **대시보드 주소에서 스크립트가 돕니다**(P1).
- **픽셀 폭탄**: 389KB짜리 PNG가 20000×20000이라 펼치면 Chrome 메모리가 2GB 늘어납니다(P4).
- **압축 폭탄**: 1MB짜리 gzip이 풀면 1GiB입니다(P5). 한 번에 풀면 탭이 멈춥니다.
- **저장 파일 이름**: 기록에서 온 형식에 따라 Chrome이 `.htm`을 붙여, 저장한 파일을 열면 스크립트가 돕니다(P13). 다운로드 기록에 토큰이 든 주소가 남습니다(P14).

## 그래서 이렇게 만들었습니다
| 기능 | 방법 | 막는 것 |
|---|---|---|
| 이미지 미리보기 | 파일 앞 바이트(매직 바이트)로 PNG·JPEG·GIF·WebP·BMP만 알아봄. 기록의 Content-Type은 믿지 않음 | 이미지인 척하는 SVG·HTML(P2) |
| | **그리기 전에** 머리에서 가로·세로를 읽어 5천만 픽셀이 넘으면 그리지 않음 | 픽셀 폭탄(P4) |
| | blob 주소·`<img>` 없이 `createImageBitmap` → `<canvas>`. 버튼을 눌렀을 때만, 점선 상자 안에만 | P1, 가짜 화면 이미지(P12) |
| 압축 풀기 | gzip·deflate **한 겹만**, 조금씩 풀다가 10MiB에서 멈춤 | 압축 폭탄(P5·P6) |
| | br·zstd는 Chrome이 풀 수 없어 "풀 수 없음" 안내(오류처럼 보이지 않게) | 오탐(Q1) |
| | 잘린 압축은 앞부분 + "끝까지 풀지 못함" | P7, Q3 |
| 원본 저장 | 이름은 늘 `sumun-<번호>-response.bin`. 저장 창(`showSaveFilePicker`)으로 바로 씀 — 링크·blob 주소 없음 | 확장자 속임(P13), 다운로드 기록의 토큰(P14) |

**CSP를 그대로 둘 수 있었던 이유**: 에이전트 실험에서 `createImageBitmap` → canvas 경로는 지금 CSP(`default-src 'self'`)에서도 동작했습니다. 이미지 주소(`img-src`)를 열 필요가 없었습니다.

## 실제로 해 본 것 (headless Chrome 156, `node scripts/probe/ui5b-browser.mjs`)
목적지가 6가지 응답을 주고, 프록시로 받아 기록한 뒤 대시보드를 Chrome으로 열어 눌러 봤습니다.

| 기록 | 화면 |
|---|---|
| ① PNG인데 `Content-Type: text/plain` | 미리보기 버튼 → canvas 40×30, 이름표 "기록된 이미지 미리보기 — PNG 40×30" ✅ |
| ② gzip 텍스트 | "압축(gzip)을 풀었습니다: 10000바이트", 한글 글이 보임 ✅ |
| ③ gzip 폭탄(0.25MB → 256MiB) | 10,485,760바이트에서 멈춤 ✅. Chrome 메모리 806→1107MB(+301MB) — 기준(+300MB 이하)을 1MB 넘음 ❌ |
| ④ 20000×20000 PNG | "너무 커서 미리보기를 하지 않습니다", 메모리 늘지 않음 ✅ |
| ⑤ 스크립트 든 SVG(`image/svg+xml`) | 미리보기 버튼 없음, 글자로 보임, 스크립트 안 돎 ✅ |
| ⑥ br 압축 | "이 브라우저에서 풀 수 없어 원본 바이트로" ✅ |
| ⑦ 페이지 전체 | `<img>` 0, blob 주소 0, 저장 창 기능 있음 ✅. 콘솔 오류 1건(404) ❌ — 브라우저가 자동으로 찾는 `/favicon.ico`로 보입니다 [추측] |

### 덤으로 확인한 것 (UI-5에서 남은 질문)
**브라우저가 직접 연 탭은 대시보드가 열립니다.** Chrome이 스스로 연 탭(자동화 도구의 "새 대상 열기")은 `Sec-Fetch-Site: none`을 보냈고 대시보드가 바로 200으로 열렸습니다 [확인됨]. 확장으로 연 탭(UI-5 실측)만 `cross-site`였습니다. 터미널 주소를 직접 누르는 경우도 `none`일 가능성이 높아졌습니다. 다만 사람의 실제 클릭은 아직 확인하지 않았습니다.

## 확인한 것
| 예상 | 결과 |
|---|---|
| E191 구현 전 새 테스트 모두 assertion 실패, 회귀 통과 | 일치 — 8개 AssertionError, 오류 0(커밋 전 테스트 구조 2곳 고침, 기대값 그대로), 회귀 2 통과 [확인됨] |
| E192 `npm test` 실패 0, 대기 0 | 일치 — 783개 모두 통과, 83초 [확인됨] |
| E193 브라우저 일곱 가지 | **불일치** — ③ 메모리 +301MB(기준 +300MB), ⑦ 콘솔 404 1건. 나머지는 확인 [확인됨] |
| E194 [탐색] 브라우저가 연 탭의 Sec-Fetch-Site | `none`, 대시보드 200 [확인됨] |

## UI 보고서에 올릴 결정 (추천으로 진행)
| 정한 것 | 다른 선택지 |
|---|---|
| CSP 그대로, canvas로 미리보기 | `img-src blob:`을 열고 `<img>`(P1·P1b 위험) |
| 미리보기 5천만 픽셀, 압축 풀기 10MiB(D-10), 한 겹만 | 값 조정, 여러 겹도 합계 상한으로 풀기 |
| ICO·AVIF·SVG는 미리보기 없음 | ICO 안의 PNG까지 읽기 |
| 저장은 Chrome·Edge의 저장 창만(Firefox 없음) | 다운로드 링크(P13·P14 위험) |
| 디코더 취약점(P11)은 남는 위험 — 미리보기를 버튼으로만 | 미리보기 자체를 끄는 설정 |
| `/favicon.ico` 404가 콘솔에 남음 | 정적 목록에 빈 아이콘 추가(server.ts) |
| 압축 폭탄을 풀 때 메모리 약 +300MB | 상한을 낮춤(예: 4MiB) |

## 먼저 볼 코드
- `src/dashboard/public/view.js:258` — `sniffImage`: 매직 바이트로만 이미지 판정
- `src/dashboard/public/view.js:309` — `previewDecision`: 그리기 전 크기 판정(5천만 픽셀)
- `src/dashboard/public/view.js:328` — `decompressPlan`: 한 겹 gzip·deflate만
- `src/dashboard/public/view.js:371` — `inflate`: 조금씩 풀다가 10MiB에서 멈춤
- `src/dashboard/public/view.js:382` — `downloadName`: 고정 저장 이름
- `src/dashboard/public/app.js:328` — `drawPreview`: createImageBitmap → canvas
- `src/dashboard/public/app.js:348` — `saveOriginal`: 저장 창으로 원본 저장
- `src/dashboard/public/app.js:363` — `bodySection`: 본문 화면(원본/푼 결과, 미리보기, 저장 버튼)
