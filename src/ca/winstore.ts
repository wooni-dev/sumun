// [SEC-3] Windows 인증서 저장소 접근 층. 사례·결정은 docs/ai/sec3-cases.md.
//
// 읽기는 certutil 출력을 해석하지 않는다: 출력이 CP949이고 Windows 언어마다 문구가 달라서다 [확인됨: 검토 에이전트].
//   사용자 물리 Root = 레지스트리 HKCU\Software\Microsoft\SystemCertificates\Root\Certificates. 키 이름이 SHA-1이고 Blob 값의 속성 32가 인증서 DER이다.
//   꺼낸 DER의 SHA-1이 키 이름과 같은 것만 믿는다(스스로 검증) [확인됨: scripts/probe/sec3-reg.mjs E121 — HKLM 12개 모두 같음].
//   PowerShell Cert:\CurrentUser\Root는 컴퓨터 저장소를 합쳐 보여 주므로 사용자 쪽 판정에 쓰지 않는다(사례 B4).
//   컴퓨터 Root는 지울 수 없음을 알리는 데만 쓰고, 합친 보기의 지문 목록(언어와 무관)으로 읽는다 [확인됨: E122 — 레지스트리 12개 ⊂ 합친 보기 37개].
// 쓰기는 certutil 두 가지뿐이다: -user -addstore Root <임시 DER>, -user -delstore Root <40자리 SHA-1>. -f·-enterprise·-gp는 쓰지 않는다(A9, A11).
// 도구는 절대 경로로만 부른다. PATH·현재 폴더·SystemRoot 환경 변수를 믿지 않는다(결정 5④, D1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SYS = 'C:\\Windows\\System32';
export const TOOLS = {
  certutil: `${SYS}\\certutil.exe`,
  reg: `${SYS}\\reg.exe`,
  whoami: `${SYS}\\whoami.exe`,
  powershell: `${SYS}\\WindowsPowerShell\\v1.0\\powershell.exe`,
};
// 셸 없이 인자 배열로 실행한다(D2). stdout은 latin1 문자열(우리가 읽는 부분은 ASCII뿐이다)
export type Run = (exe: string, args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string }>;
export type StoreCert = { sha1: string; der: Buffer }; // sha1 = 대문자 40자리
const USER_ROOT_KEY = 'HKCU\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates';
// 등록 명령의 인자. 확인 화면에 보이는 명령도 이 함수로 만든다 — 보여 준 것과 실행한 것이 같다(C6)
export const addArgs = (file: string) => ['-user', '-addstore', 'Root', file];
export const removeArgs = (sha1: string) => ['-user', '-delstore', 'Root', sha1];
// Windows 창이 사용자를 기다리므로 넉넉히. 그 안에 끝나지 않으면 결과를 모른다고 알린다(D8)
const ADD_TIMEOUT_MS = 5 * 60_000;

const sha1Of = (der: Buffer) => crypto.createHash('sha1').update(der).digest('hex').toUpperCase();

// Blob = [속성 ID u32][예약 u32][길이 u32][데이터]의 반복. 속성 32(CERT_CERT_PROP_ID)가 인증서 DER
export function blobToDer(hex: string): Buffer | null {
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(hex)) return null;
  const b = Buffer.from(hex, 'hex');
  for (let i = 0; i + 12 <= b.length; ) {
    const id = b.readUInt32LE(i);
    const len = b.readUInt32LE(i + 8);
    if (i + 12 + len > b.length) return null;
    if (id === 32) return Buffer.from(b.subarray(i + 12, i + 12 + len));
    i += 12 + len;
  }
  return null;
}

// `reg query <키> /s /v Blob` 출력 → 인증서 목록. 키 이름과 DER의 SHA-1이 다른 항목은 버린다
export function parseRegCerts(out: string): StoreCert[] {
  const list: StoreCert[] = [];
  let key: string | null = null;
  for (const line of out.split(/\r?\n/)) {
    const k = line.match(/^HKEY_[A-Z_]+\\.*\\Certificates\\([0-9A-Fa-f]{40})$/);
    if (k) {
      key = k[1].toUpperCase();
      continue;
    }
    const b = line.match(/^\s+Blob\s+REG_BINARY\s+([0-9A-Fa-f]*)\s*$/);
    if (b && key) {
      const der = blobToDer(b[1]);
      if (der && sha1Of(der) === key) list.push({ sha1: key, der });
      key = null;
    }
  }
  return list;
}

export type WinStore = {
  userRoot(): Promise<StoreCert[]>;
  machineRootThumbprints(): Promise<string[]>;
  add(der: Buffer): Promise<{ code: number }>;
  remove(sha1: string): Promise<{ code: number }>;
  elevated(): Promise<boolean>;
};

export function makeWinStore(run: Run): WinStore {
  return {
    // 항목이 없으면 reg가 종료 코드 1을 낸다 [확인됨: E123] — 출력에 항목이 없으면 빈 목록
    async userRoot() {
      return parseRegCerts((await run(TOOLS.reg, ['query', USER_ROOT_KEY, '/s', '/v', 'Blob'])).stdout);
    },
    async machineRootThumbprints() {
      const r = await run(TOOLS.powershell, ['-NoProfile', '-NonInteractive', '-Command', 'Get-ChildItem Cert:\\LocalMachine\\Root | ForEach-Object { $_.Thumbprint }']);
      return r.stdout.split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter((s) => /^[0-9A-F]{40}$/.test(s));
    },
    // 검사한 DER만 새 임시 폴더에 써서 등록하고 지운다. 원본 파일 경로를 넘기지 않는다(A1~A3)
    async add(der) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-ca-add-'));
      const file = path.join(dir, 'sumun-root.cer');
      try {
        fs.writeFileSync(file, der, { flag: 'wx' });
        return { code: (await run(TOOLS.certutil, addArgs(file), { timeoutMs: ADD_TIMEOUT_MS })).code };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    // 40자리 hex만(B1, B2). 이름·인덱스·OID·콜론 형식으로는 실행하지 않는다
    async remove(sha1) {
      if (!/^[0-9A-Fa-f]{40}$/.test(sha1)) throw new Error('지문은 40자리 16진수여야 합니다');
      return { code: (await run(TOOLS.certutil, removeArgs(sha1.toLowerCase()), { timeoutMs: ADD_TIMEOUT_MS })).code };
    },
    // 무결성 수준 SID: S-1-16-8192 중간(일반), 12288 높음(승격), 16384 시스템 [확인됨: E124]. 읽지 못하면 승격으로 본다(닫힘)
    async elevated() {
      try {
        const out = (await run(TOOLS.whoami, ['/groups', '/fo', 'csv', '/nh'])).stdout;
        const levels = [...out.matchAll(/"S-1-16-(\d+)"/g)].map((m) => Number(m[1]));
        return !levels.length || levels.some((n) => n >= 12288);
      } catch {
        return true;
      }
    },
  };
}
