// [PRX-4] 실행 진입점: npm start  /  npm start -- --port 9000  /  node src/index.ts --port 9000
//
// 브라우저(또는 Windows) 프록시를 127.0.0.1:<포트>로 설정하고 쓴다. 바인딩 주소는 startProxy가 127.0.0.1로 고정한다.
// 출력: 시작 줄 1개 + 요청마다 요약 한 줄(src/cli.ts). 기록을 파일로 저장하지 않는다(PRX-2 사용자 결정: 메모리만).
// 주의: `npm start --port 9000`처럼 `--` 없이 쓰면 npm이 --port를 자기 설정으로 가져가서 이 프로그램에 오지 않는다(prx4-cases L9).
import { startProxy } from './proxy/server.ts';
import { loadOrCreateCA, defaultCADir, type CA } from './ca/ca.ts';
import { parseArgs, formatSummary, safeText } from './cli.ts';

const fatal = (message: string): never => {
  process.stderr.write(`sumun: ${message}\n`);
  process.exit(1);
};

// M8: 처리되지 않은 예외를 Node 기본 방식으로 찍으면 오류 객체의 속성까지 펼쳐 보여 준다(기록이 붙어 있으면 유출).
// 고정 문구와 오류 코드만 남기고 끝낸다.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => fatal(`예상하지 못한 오류로 종료합니다(${safeText(String(err?.code ?? err?.name ?? '알 수 없음'), 40)}).`));

const args = parseArgs(process.argv.slice(2));
if ('error' in args) fatal(`${args.error}\n사용법: npm start -- --port 8080 [--decrypt]`);
const { port, decrypt } = args as { port: number; decrypt?: true };

// [TLS-4] --decrypt: 루트 CA를 %LOCALAPPDATA%\sumun\ca에서 불러오거나 처음이면 만든다(Windows 저장소 등록은 하지 않음 — SEC-3).
// 깨졌거나 만료된 CA는 고치지 않고 멈춘다(TLS-2 사용자 결정). 오류에는 경로만 있고 키는 없다
let ca: CA | undefined;
if (decrypt) {
  try {
    ca = await loadOrCreateCA(defaultCADir());
  } catch (err) {
    // 문구는 고정, 코드와 경로만 이스케이프해서 보인다(safeText는 비ASCII를 \u{…}로 바꾸므로 한글 문구에는 쓰지 않는다)
    const e = err as { name?: string; code?: string; path?: string };
    fatal(e?.name === 'CAError' ? `루트 CA를 쓸 수 없습니다(${safeText(String(e.code), 40)}): ${safeText(String(e.path), 300)}` : `루트 CA를 준비하지 못했습니다(${safeText(String(e?.code ?? '알 수 없음'), 40)}).`);
  }
}

let proxy: Awaited<ReturnType<typeof startProxy>>;
try {
  // [TLS-1] tunnel: true — HTTPS(CONNECT)를 복호화 없이 통과시킨다. 요약 줄에는 대상과 바이트 수만 나온다
  proxy = await startProxy({ port, tunnel: true, ca, onFlow: (flow) => void process.stdout.write(`${formatSummary(flow)}\n`) });
} catch (err) {
  // M1, M4: 시작 실패는 코드별 고정 문구. 스택 트레이스를 찍지 않는다
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EADDRINUSE') fatal(`포트 ${port}를 이미 다른 프로그램이 쓰고 있습니다. 다른 포트로 시작하세요: npm start -- --port 9000`);
  if (code === 'EACCES') fatal(`포트 ${port}를 쓸 권한이 없습니다(Windows가 예약한 포트일 수 있습니다).`);
  fatal(`시작하지 못했습니다(${safeText(String(code ?? '알 수 없는 오류'), 40)}).`);
}

// M2: listen이 성공한 뒤에만, 실제 주소로
process.stdout.write(`sumun: 127.0.0.1:${proxy!.port} 에서 프록시를 시작했습니다. 브라우저 프록시를 이 주소로 설정하세요. 끝내려면 Ctrl+C\n`);
if (ca) process.stdout.write(`sumun: HTTPS 복호화를 켰습니다. 루트 CA: ${safeText(defaultCADir(), 300)}\\ca-cert.pem (Windows에 등록하기 전에는 브라우저가 경고합니다)\n`);

// D7: Ctrl+C → 연결을 모두 닫고 종료(코드 0). 2초 안에 안 끝나거나 Ctrl+C를 한 번 더 누르면 바로 끝낸다
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(0);
  stopping = true;
  setTimeout(() => process.exit(0), 2000).unref();
  proxy.close().then(() => process.exit(0));
});
