// [PRX-4] 실행 진입점의 순수 함수: 인자 검사와 요약 줄. 사례·결정은 docs/ai/prx4-cases.md.
//
// 요약 줄은 기록(Flow) 내용이 터미널로 나가는 유일한 길이다. 기록에는 쿠키·토큰이 원본 그대로 있으므로
// 메서드, 목적지(호스트:포트), 상태 또는 실패 코드, 소요 시간만 쓴다. 경로·쿼리·헤더·본문은 쓰지 않는다(쿼리에 토큰이 흔하다).
import type { Flow } from './flow/flow.ts';

export const DEFAULT_PORT = 8080;
const HOST_MAX = 255; // D6
const LINE_MAX = 512; // D6

// D1: 출력 가능한 ASCII(0x20~0x7E)만 그대로 두고 나머지는 \xNN / \u{N}로 보인다.
// ESC·OSC(화면 지우기, 클립보드 쓰기), CR·LF(가짜 줄), C1(0x9B = CSI), U+2028, bidi 제어 문자(Trojan Source)가 모두 여기에 걸린다.
// 터미널 위장을 막으면서도 "무언가 이상한 글자가 있었다"는 사실은 보이게 한다.
export function safeText(s: string, max = HOST_MAX): string {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x20 && cp <= 0x7e ? ch : cp <= 0xff ? `\\x${cp.toString(16).padStart(2, '0')}` : `\\u{${cp.toString(16)}}`;
    if (out.length > max) break;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

// D3, D4, D5: `--port N` 또는 `--port=N` 하나만. 1~65535의 정수를 십진수 글자 그대로(앞자리 0, 부호, 공백, 지수, 16진수 없이).
// 중복·모르는 인자는 거부한다. 환경 변수는 읽지 않는다 — 바인딩 주소(127.0.0.1)는 어떤 입력으로도 바뀌지 않는다.
// [TLS-4] `--decrypt`: HTTPS를 복호화한다(사용자 결정 2026-11-08 — 루트 CA를 등록하기 전에는 브라우저가 경고하므로 기본은 끔).
// 줄 때만 결과에 decrypt: true를 붙인다(없을 때의 모양은 PRX-4 그대로)
// [UI-1] `--no-dashboard`(대시보드를 켜지 않음), `--dashboard-port N`(기본은 src/index.ts가 정한다 — 프록시 포트 + 1).
// 줄 때만 결과에 dashboard: false / dashboardPort: N을 붙인다(없을 때의 모양은 그대로). 둘을 함께 주거나 프록시 포트와 같으면 오류
const PORT_RE = /^[1-9][0-9]{0,4}$/;
export function parseArgs(argv: string[]): { port: number; decrypt?: true; dashboard?: false; dashboardPort?: number } | { error: string } {
  // 오류 메시지 속 입력값: 이스케이프하고 40자까지만(L10). 잘림 표시도 ASCII로 쓴다
  const show = (v: string) => `"${safeText(v.slice(0, 40), 1000)}${v.length > 40 ? '...' : ''}"`;
  let port: number | undefined;
  let decrypt = false;
  let noDashboard = false;
  let dashboardPort: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let v: string;
    if (a === '--decrypt') {
      if (decrypt) return { error: '--decrypt는 한 번만 줄 수 있습니다.' };
      decrypt = true;
      continue;
    }
    if (a === '--no-dashboard') {
      if (noDashboard) return { error: '--no-dashboard는 한 번만 줄 수 있습니다.' };
      noDashboard = true;
      continue;
    }
    if (a === '--dashboard-port' || a.startsWith('--dashboard-port=')) {
      if (a === '--dashboard-port') {
        if (i + 1 >= argv.length) return { error: '--dashboard-port 뒤에 포트 번호가 필요합니다.' };
        v = argv[++i];
      } else v = a.slice('--dashboard-port='.length);
      if (dashboardPort !== undefined) return { error: '--dashboard-port는 한 번만 줄 수 있습니다.' };
      if (!PORT_RE.test(v) || Number(v) > 65535) return { error: `대시보드 포트는 1~65535의 정수여야 합니다: ${show(v)}` };
      dashboardPort = Number(v);
      continue;
    }
    if (a === '--port') {
      if (i + 1 >= argv.length) return { error: '--port 뒤에 포트 번호가 필요합니다.' };
      v = argv[++i];
    } else if (a.startsWith('--port=')) v = a.slice('--port='.length);
    else return { error: `알 수 없는 인자입니다: ${show(a)}` };
    if (port !== undefined) return { error: '--port는 한 번만 줄 수 있습니다.' };
    if (!PORT_RE.test(v) || Number(v) > 65535) return { error: `포트는 1~65535의 정수여야 합니다: ${show(v)}` };
    port = Number(v);
  }
  const out: { port: number; decrypt?: true; dashboard?: false; dashboardPort?: number } = { port: port ?? DEFAULT_PORT };
  if (decrypt) out.decrypt = true;
  if (noDashboard && dashboardPort !== undefined) return { error: '--no-dashboard와 --dashboard-port는 함께 줄 수 없습니다.' };
  if (noDashboard) out.dashboard = false;
  if (dashboardPort !== undefined) {
    if (dashboardPort === out.port) return { error: '대시보드 포트는 프록시 포트와 달라야 합니다.' };
    out.dashboardPort = dashboardPort;
  }
  return out;
}

// 요약 한 줄: "시각 메서드 호스트:포트 상태(또는 실패 코드 상태) 소요ms". 모양이 깨진 기록에도 예외를 던지지 않는다(M8).
export function formatSummary(flow: Flow): string {
  try {
    const time = new Date(flow.startedAt).toTimeString().slice(0, 8);
    const method = safeText(flow.request.method, 16);
    const t = flow.request.target;
    const host = t ? safeText(`${t.host}:${t.port}`, HOST_MAX) : '-'; // K13: Host 헤더가 아니라 실제로 연결한 대상
    const e = flow.error;
    // K12: 실패 칸에는 정해진 코드와 숫자 상태만. 오류 객체의 다른 속성은 읽지 않는다
    const fail = e ? `${safeText(e.code, 32)}${typeof e.status === 'number' ? ` ${e.status}` : ''}` : '';
    const result = flow.tunnel
      ? `tunnel ${Number(flow.tunnel.bytesUp)}/${Number(flow.tunnel.bytesDown)}B${fail ? ` ${fail}` : ''}` // [TLS-1] 터널: 오간 바이트 수만(내용·주소 없음)
      : flow.response
        ? `${Number(flow.response.status)}${fail ? ` ${fail}` : ''}`
        : fail || '-';
    const line = `${time} ${method} ${host} ${result} ${Math.round(Number(flow.durationMs))}ms`;
    return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
  } catch {
    return '[sumun] 요약을 만들 수 없는 기록입니다.';
  }
}
