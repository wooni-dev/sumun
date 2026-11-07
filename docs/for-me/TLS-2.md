# [TLS-2] 루트 CA 생성·보관        커밋: 395dd35..(이 문서 커밋)

## 한 줄 요약
프록시가 HTTPS를 복호화할 때 쓸 **루트 CA**(이 PC가 믿게 될 "인증서 발급자")를 만들고 보관하는 함수 `loadOrCreateCA(dir)`를 만들었다. 아직 어디서도 부르지 않는다. Windows 인증서 저장소도 건드리지 않았다. 실제로 쓰는 것은 TLS-4이고, 등록은 SEC-3에서 매번 확인받고 한다.

## 루트 CA가 왜 필요한가
HTTPS 사이트는 "나는 정말 example.com이다"라는 인증서를 보여 주고, 브라우저는 그 인증서에 **믿는 발급자의 서명**이 있는지 확인한다. 프록시가 중간에서 내용을 보려면 브라우저에게 example.com인 척하는 인증서를 내밀어야 한다. 이때 브라우저가 믿는 발급자의 서명이 필요하다. 그 발급자가 우리가 만드는 루트 CA다.

```
 [루트 CA: sumun local CA 2026-11-07]   ← 이번 단위. 개인키는 %LOCALAPPDATA%\sumun\ca\ca-key.pem
        │ 서명
        ▼
 [example.com용 가짜 인증서]             ← TLS-3 (사이트마다 즉석 발급)
        │ 브라우저에게 보여 줌
        ▼
 브라우저: "믿는 발급자가 서명했네" → 연결 → 프록시가 내용을 본다   ← TLS-4
            (믿게 하려면 루트 CA를 Windows 저장소에 등록 — SEC-3, 매번 사용자 확인)
```

**그래서 개인키가 위험하다.** 이 키를 가진 사람은 어느 사이트의 가짜 인증서든 만들 수 있고, 등록한 PC는 그것을 믿는다. 이번 단위의 대부분은 "키를 엉뚱한 곳에 두지 않기"와 "피해 범위를 좁게 만들기"다.

## 만든 CA의 모양 (실제 값, `node scripts/probe/tls2-tools.mjs`)
```
Version: 3 (0x2)
Serial Number: 3a:e1:e8:f3:fc:d4:7e:31:b1:92:9b:c7:b8:59:1c:18     ← 128비트 난수, 항상 양수
Signature Algorithm: sha256WithRSAEncryption
Issuer: CN=sumun local CA 2026-11-07                                ← 생성일(UTC)로 구분
Not Before: Nov  6 16:45:38 2026 GMT                                ← 만든 시각보다 1일 전(시계 오차 대비)
Not After : Nov  7 16:45:38 2027 GMT                                ← 1년
Public-Key: (2048 bit) / Exponent: 65537
X509v3 Basic Constraints: critical  CA:TRUE, pathlen:0              ← 발급자다. 단 중간 발급자는 못 만든다
X509v3 Key Usage: critical  Certificate Sign, CRL Sign              ← 인증서 서명 말고는 못 쓴다
X509v3 Extended Key Usage: TLS Web Server Authentication            ← HTTPS 서버용만(사용자 결정)
```
| 칸 | 왜 이렇게 | 피해 범위 |
|---|---|---|
| pathlen:0 | 이 CA로 "또 다른 발급자"를 만들 수 없게 | 키가 새도 발급자를 더 늘릴 수 없다 |
| EKU = 서버 인증만 | 이 도구는 HTTPS만 본다 | 키가 새도 프로그램 서명·메일 서명은 믿지 않게 [추측: Windows가 지키는지는 SEC-3에서 실측] |
| SHA-256 | SHA-1은 위조가 가능해 브라우저가 거부한다 | — |

### node-forge의 함정 세 가지 (실측으로 확인, `scripts/probe/tls2-forge.mjs`)
라이브러리를 "기본값으로" 쓰면 생기는 문제다. 웹 개발로 치면 `fetch`가 기본으로 쿠키를 안 보내는 것처럼, 모르면 지나친다.
1. `cert.sign(key)`처럼 해시를 안 넘기면 **SHA-1**로 서명한다.
2. 일련번호의 첫 글자가 8~f면 **음수**로 기록된다(Node와 openssl 둘 다 음수로 읽음). 표준 위반이다.
3. 유효 기간을 안 정하면 시작 = 끝(0초짜리 인증서)이다.

## 깨졌을 때: 고치지 않고 멈춘다 (사용자 결정)
| 상황 | 결과(`CAError` code) |
|---|---|
| 인증서·키 둘 다 없음 | 새로 만든다 |
| 한쪽만 있음 | `CA_INCOMPLETE` |
| 인증서와 키의 짝이 다름 | `CA_MISMATCH` |
| 손상(0바이트, 잘림, 암호화된 키) | `CA_CORRUPT` |
| 우리 정책과 다른 인증서(말단 인증서, 다른 도구의 CA, SHA-1, 1024비트) | `CA_NOT_CA` |
| 만료 30일 전 | 경고 1번(경로, 남은 날수) 후 사용 |
| 만료 / 시작 전(PC 시계가 뒤로 감) | `CA_EXPIRED` / `CA_NOT_YET_VALID` |

어느 경우에도 **파일을 지우거나 덮어쓰지 않는다.** 자동으로 새로 만들면 예전 CA가 Windows에 등록된 채 잊히고(계속 "믿는 발급자"로 남음), 무엇이 잘못됐는지도 사라진다. 메모장으로 열었다 저장해 생긴 BOM·CRLF는 읽는다.

## 키를 엉뚱한 곳에 두지 않기
| 막은 것 | 예 | 결과 |
|---|---|---|
| 상대 경로 | `"ca"`, `"."` | `CA_DIR_RELATIVE` — 현재 폴더가 저장소이면 키가 저장소 안에 생기므로 |
| git 저장소 안 | 이 저장소, 다른 저장소, worktree | `CA_DIR_IN_REPO`, 폴더도 만들지 않음 |
| 정션으로 우회 | `C:\temp\link` → 저장소 | 실제 경로로 풀어서 `CA_DIR_IN_REPO` |
| 환경 변수 없음 | `LOCALAPPDATA`가 없음·빈 값 | `CA_ENV_MISSING`. `%APPDATA%`로 대신하지 않는다 |
| 오류 메시지로 유출 | 손상된 키 파일 | 오류에는 경로만, 내용·키는 없다 |

기본 위치는 `%LOCALAPPDATA%\sumun\ca\`다(이번에 `%APPDATA%`에서 바꿈 — CLAUDE.md 보안 규칙도 수정, 395dd35). Roaming 폴더는 다른 PC로 복사될 수 있기 때문이다.

## node-forge를 들인 과정
이 프로젝트의 **첫 외부 라이브러리**다. 최신판 1.4.3이 나온 지 3일이라 바로 쓰기 전에 확인했다.
- 2주 안에 나온 1.4.1~1.4.3은 모두 보안 수정판이고, 공식 저장소의 변경 기록·보안 공지와 내용이 맞다.
- `npm audit signatures`로 레지스트리 서명을 검증했다.
- 설치된 코드(`lib/`)가 GitHub의 v1.4.3 태그와 한 글자도 다르지 않다.
- 설치할 때 실행되는 스크립트가 없다.
- `package.json`에는 `"1.4.3"`으로 정확히 고정했다(자동으로 올라가지 않음).

## 테스트
- 새 동작 25개(`test/ca/TLS-2.test.ts`): 구현 전 25개 모두 assertion 실패, 오류 0개. 인증서 칸은 Node와 forge **두 파서**로 확인하고, Windows의 certutil이 파일을 읽는지도 본다.
- 회귀 2개(`test/ca/TLS-2-regression.test.ts`): `*.pem`이 git에서 무시되는지, 추적 중인 파일에 개인키가 없는지.
- 모든 테스트는 임시 폴더에 CA를 만든다. 마지막 테스트가 실제 `%LOCALAPPDATA%\sumun\ca`가 그대로인지 확인한다.
- 전체 `npm test`: 465개 중 463 통과, 실패 0, 큰 단위 대기 TLS 2개(복호화 전이라 정상).

## 작업 흐름 (커밋 순서)
1. `395dd35` 규칙: 키 위치를 `%LOCALAPPDATA%`로(사용자 결정)
2. `1810188` 계획: 사례 51개(TLS-2/2b로 나눔), 결정, 예상 E69~E76, node-forge 출처 확인
3. `51c63ce` 실측: forge 함정
4. `2ee599b` 테스트 25개 + 회귀 2개
5. `36be5f9` ca.ts + node-forge 의존성 → 463 통과
6. `48fea11` 실측: openssl·certutil·icacls로 확인
7. (이 문서 커밋)

## 먼저 볼 코드
- `src/ca/ca.ts:163` — `loadOrCreateCA()`: 전체 흐름(경로 검사 → 만들기 또는 불러오기)
- `src/ca/ca.ts:63` — `checkDir()`: 상대 경로·저장소 안·정션 거부
- `src/ca/ca.ts:94` — `load()`: 손상 → 짝 → 정책 → 유효 기간 순서
- `src/ca/ca.ts:78` — `followsPolicy()`: 우리 CA 정책인지
- `src/ca/ca.ts:124` — `create()`: 새 CA의 칸들
- `src/ca/ca.ts:139` — `create()` 안: 일련번호가 음수가 되지 않게
- `src/ca/ca.ts:48` — `defaultCADir()`: 기본 위치

## 남은 것
- [TLS-2b] 동시에 두 번 실행, 쓰는 도중 실패(반쪽 파일), 키 파일 자리에 심어 둔 링크, 키 파일 권한(ACL). 지금 `%LOCALAPPDATA%` 아래 키는 SYSTEM·Administrators·본인만 읽을 수 있다(상속).
- [TLS-3] 사이트별 인증서 발급. forge 서명이 동기라 새 사이트마다 약 0.1초씩 프록시가 멈출 수 있다 [추측] — 거기서 다룬다.
- [SEC-3] Windows 저장소 등록·해제 — 명령을 보여 드리고 매번 확인받는다.
