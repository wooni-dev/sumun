// [SEC-3 테스트 수정 실측] 고친 test/ca/SEC-3.test.ts가 구현 전 코드(빈 함수만 export한 stub)에서 여전히 실패하는가(O44)
//   node scripts/probe/sec3-testfix-stub.mjs
// 저장소를 복사한 임시 폴더에서 src/ca/command.ts·winstore.ts만 stub(6fd100f 커밋 메시지의 stub 동작)으로 바꿔 실행한다.
// 저장소 파일과 Windows 인증서 저장소는 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-sec3-stub-'));
try {
  fs.cpSync(path.join(root, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'test/ca'), { recursive: true });
  fs.copyFileSync(path.join(root, 'test/ca/SEC-3.test.ts'), path.join(tmp, 'test/ca/SEC-3.test.ts'));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(tmp, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(tmp, 'src/ca/command.ts'), `
export type CaCmd = 'install' | 'uninstall' | 'status';
export const CA_USAGE = '';
export function parseCaArgs(_a: string[]): any { return { error: '' }; }
export type CaDeps = any;
export async function runCaCommand(_c: CaCmd, _d: CaDeps): Promise<number> { return -1; }
export async function checkCADir(..._a: unknown[]): Promise<string | null> { return null; }
`);
  fs.writeFileSync(path.join(tmp, 'src/ca/winstore.ts'), `
export const TOOLS = {} as any;
export type Run = (exe: string, args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string }>;
export type StoreCert = { sha1: string; der: Buffer };
export const addArgs = (_f: string) => [] as string[];
export const removeArgs = (_s: string) => [] as string[];
export function blobToDer(_h: string): Buffer | null { return null; }
export function parseRegCerts(_o: string): StoreCert[] { return []; }
export type WinStore = any;
export function makeWinStore(_r: Run): WinStore { return { userRoot: async () => [], machineRootThumbprints: async () => [], add: async () => ({ code: -1 }), remove: async () => ({ code: -1 }), elevated: async () => false }; }
`);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/ca/SEC-3.test.ts'], { cwd: tmp, encoding: 'utf8' });
  const lines = r.stdout.split(/\r?\n/);
  const results = lines.filter((l) => /^(not )?ok \d+ - /.test(l));
  const assertion = (r.stdout.match(/code: 'ERR_ASSERTION'/g) ?? []).length;
  const other = (r.stdout.match(/failureType: '(?!testCodeFailure)/g) ?? []).length;
  for (const l of results) console.log(l.slice(0, 90));
  console.log(`전체 ${results.length}, 실패 ${results.filter((l) => l.startsWith('not ok')).length}, ERR_ASSERTION ${assertion}, testCodeFailure가 아닌 실패 ${other}`);
  for (const n of ['B3:', 'F1·B6·E1:']) {
    const i = lines.findIndex((l) => l.includes(n) && /^not ok|^ok/.test(l));
    const j = lines.slice(i, i + 20).findIndex((l) => /error: /.test(l));
    const msg = lines[i + j + 1];
    console.log(`${n} ${lines[i]?.startsWith('not ok') ? '실패' : '통과'} — ${msg?.trim()}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
