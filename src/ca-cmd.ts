// [SEC-3] 실행 진입점: npm run ca -- install | uninstall | status
//
// 루트 CA를 현재 사용자의 '신뢰할 수 있는 루트 인증 기관'에 넣거나 뺀다. 확인은 두 번: 이 터미널에서 직접 친 "yes", 그리고 Windows 확인 창.
// 입력이 대화형 터미널이 아니면(파이프·스크립트·AI 에이전트의 셸) install·uninstall은 거부한다(결정 6). 관리자 터미널도 거부한다(결정 7).
// 동작은 src/ca/command.ts, 저장소 접근은 src/ca/winstore.ts. 사례·결정은 docs/ai/sec3-cases.md.
import fs from 'node:fs';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { loadOrCreateCA, defaultCADir, daclOf, me } from './ca/ca.ts';
import { makeWinStore, type Run } from './ca/winstore.ts';
import { parseCaArgs, runCaCommand, checkCADir, CA_USAGE } from './ca/command.ts';
import { safeText } from './cli.ts';

const write = (s: string) => void process.stdout.write(s);
const args = parseCaArgs(process.argv.slice(2));
if ('error' in args) {
  process.stderr.write(`sumun: ${args.error}\n${CA_USAGE}\n`);
  process.exit(2);
}
if ('help' in args) {
  write(`${CA_USAGE}\n  install   루트 CA를 현재 사용자의 신뢰할 수 있는 루트에 넣는다(없으면 만든다)\n  uninstall 넣은 sumun CA를 지문으로 뺀다\n  status    등록 상태와 안내\n`);
  process.exit(0);
}

// 셸 없이, 절대 경로 도구를 인자 배열로. 종료 코드가 0이 아니어도 결과로 돌려준다(판정은 저장소 재조회로). 시간 초과는 예외(결과 모름)
const run: Run = (exe, argv, opts) =>
  new Promise((resolve, reject) => {
    execFile(exe, argv, { encoding: 'latin1', windowsHide: false, timeout: opts?.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      if (e && (e.killed || typeof e.code !== 'number')) return reject(e);
      resolve({ code: e ? Number(e.code) : 0, stdout: String(stdout) });
    });
  });

// 한 줄씩 읽는다. 입력이 끝나면 null(EOF = 취소)
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin }) : undefined;
const lines: string[] = [];
const waiters: ((l: string | null) => void)[] = [];
let ended = false;
rl?.on('line', (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));
rl?.on('close', () => ((ended = true), waiters.splice(0).forEach((w) => w(null))));
const readLine = () => (lines.length ? Promise.resolve(lines.shift()!) : ended || !rl ? Promise.resolve(null) : new Promise<string | null>((r) => waiters.push(r)));

let caDir: string;
try {
  caDir = defaultCADir();
} catch {
  process.stderr.write('sumun: LOCALAPPDATA 환경 변수가 없거나 절대 경로가 아닙니다.\n');
  process.exit(1);
}
try {
  const code = await runCaCommand(args.cmd, {
    store: makeWinStore(run),
    caDir,
    loadCA: loadOrCreateCA,
    checkDir: (d) => checkCADir(d, { realpath: (p) => fs.realpathSync.native(p), dacl: daclOf, mySid: me }),
    input: { isTTY: !!process.stdin.isTTY, readLine },
    write,
  });
  rl?.close();
  process.exit(code);
} catch (err) {
  // 오류 객체를 펼쳐 찍지 않는다(코드만)
  process.stderr.write(`sumun: 예상하지 못한 오류로 멈췄습니다(${safeText(String((err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? '알 수 없음'), 40)}). 저장소 상태는 npm run ca -- status로 확인하세요.\n`);
  process.exit(1);
}
