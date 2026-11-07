# 조사 노트

형식: `[R-n] 내용 / 출처 → 신뢰도 / 조사일, 대상 버전 / 관련 노드`
공식 문서나 실측으로 얻은 것은 [확인됨], 그 밖의 것은 [추측]으로 표시한다.

[R-1] Node 24는 `.ts` 파일의 타입을 제거하고 바로 실행할 수 있다(type stripping). `node --test`도 `.ts` 테스트를 실행할 수 있다.
  출처: Claude의 사전 지식 → ~~[추측]~~ [확인됨: 실측 2026-11-07. `node --test a.test.ts`가 플래그와 경고 없이 실행됨]
  조사일: 2026-11-07 / 대상 버전: Node v24.21.0 [확인됨: `node -v`]
  관련 노드: PRX-1 (첫 실행에서 실측)

[R-2] node-forge 1.4.3: 1.4.1~1.4.3(2026-10-27, 11-04)은 보안 수정판이다(체인 검증의 nameConstraints, TLS 클라이언트 충돌, forge.http ReDoS, ed25519, PKCS#12 MAC, AES-GCM 태그 등). 우리가 쓰는 기능(키 PEM 읽기, 인증서 만들기·서명·PEM, 인증서 파싱)과는 직접 관련이 없다 [추측].
  출처: 공식 저장소 CHANGELOG.md, GitHub 보안 공지(api.github.com/repos/digitalbazaar/forge/security-advisories) → [확인됨: 2026-11-08 조회]
  설치 확인: `npm audit signatures` → verified 1. GitHub `v1.4.3` 태그 tarball의 lib/와 설치본 lib/가 `diff -r`로 같음. install 훅 없음 [확인됨]
  함정 [확인됨: scripts/probe/tls2-forge.mjs]: `cert.sign(key)`는 md가 없으면 SHA-1, 첫 hex가 8~f인 일련번호는 음수로 인코딩, 기본 유효 기간 notAfter = notBefore, 서명은 동기(RSA 2048에 67~148ms)
  조사일: 2026-11-08 / 대상 버전: node-forge 1.4.3, Node v24.21.0
  관련 노드: TLS-2, TLS-3(호스트마다 동기 서명 → 이벤트 루프 지연)
