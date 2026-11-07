// [TLS-2] 루트 CA 생성·보관. 사례·결정은 docs/ai/tls2-cases.md.
//
//   loadOrCreateCA(dir) ─┬─ 경로 검사: 절대 경로인가 → git 저장소 밖인가(정션은 실제 경로로 풀어서) → 폴더인가
//                        ├─ 두 파일이 다 없으면: 새 CA를 만들어 저장 (키: Node crypto, 인증서 서명: node-forge)
//                        └─ 있으면: 읽기 → 손상 → 짝 → 정책 → 유효 기간 순으로 검사. 하나라도 어긋나면 멈춘다(결정 1)
//
// 깨진 CA를 자동으로 다시 만들지 않는다: 이미 Windows에 등록한 옛 CA가 "믿는 발급자"로 남고, 무엇이 잘못됐는지도 사라진다.
// 오류에는 경로만 넣고 파일 내용·키·하위 오류(cause)는 넣지 않는다(사례 42).
//
// [TLS-2b] 저장 순서(사례 28~31, 35, 38):
//   빈 임시 파일을 배타 생성 → 키 권한을 본인만으로 → 내용 쓰기 → 하드 링크로 배타 배치(키 먼저, 인증서 나중) → 임시 파일 삭제
//   rename은 대상이 있어도 덮어쓰므로 쓰지 않는다. link는 대상이 있으면 EEXIST다 [확인됨: scripts/probe/tls2b-fs.mjs E77·E78].
//   중간에 실패하면 배치한 것을 되돌린다. 키 배치에서 EEXIST면 다른 호출이 먼저 만든 것이므로 그것을 다시 읽는다(결정 12).
//   남는 위험: 두 링크 사이에서 프로세스가 강제 종료되면 키만 남는다 → 다음 실행은 CA_INCOMPLETE(결정 1대로 멈춤).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { execFile } from 'node:child_process';
import forge from 'node-forge';

export type CA = { certPem: string; keyPem: string };
export type CAErrorCode =
  | 'CA_INCOMPLETE'
  | 'CA_MISMATCH'
  | 'CA_CORRUPT'
  | 'CA_NOT_CA'
  | 'CA_EXPIRED'
  | 'CA_NOT_YET_VALID'
  | 'CA_DIR_RELATIVE'
  | 'CA_DIR_IN_REPO'
  | 'CA_DIR_NOT_DIR'
  | 'CA_ENV_MISSING'
  | 'CA_WRITE' // [TLS-2b] 임시 파일 쓰기·배치 실패(되돌린 뒤)
  | 'CA_ACL' // [TLS-2b] 키 파일 권한을 본인만으로 정하지 못함(키를 쓰기 전에 멈춤)
  | 'CA_NOT_FILE' // [TLS-2b] CA 파일 자리가 일반 파일이 아님(링크·정션·폴더)
  | 'CA_BAD_HOST' // [TLS-3] 발급할 이름이 올바르지 않음
  | 'CA_BAD_ISSUER'; // [TLS-3] 발급에 쓸 루트 CA가 올바르지 않음(짝·정책·유효 기간)

export class CAError extends Error {
  readonly code: CAErrorCode;
  readonly path: string;
  constructor(code: CAErrorCode, message: string, p: string) {
    super(`${message} (${p})`);
    this.name = 'CAError';
    this.code = code;
    this.path = p;
  }
}

const DAY = 86_400_000;
const VALID_DAYS = 365; // 사용자 결정(2026-11-07): 유효 기간 1년
const WARN_DAYS = 30; // 결정 2: 만료 30일 전부터 경고
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const SHA256_RSA = '1.2.840.113549.1.1.11';
const CERT_FILE = 'ca-cert.pem';
const KEY_FILE = 'ca-key.pem';

// 결정 8(사용자 2026-11-08): %LOCALAPPDATA%\sumun\ca. Roaming(%APPDATA%)으로 대신하지 않는다 — 다른 PC로 복사될 수 있다.
// 값이 없거나 상대 경로면 오류: `${undefined}\sumun\ca`나 상대 경로는 현재 폴더(저장소일 수 있음)에 키를 만든다(사례 39, 40)
export function defaultCADir(env: Record<string, string | undefined> = process.env): string {
  const base = env.LOCALAPPDATA;
  if (!base || !path.isAbsolute(base)) throw new CAError('CA_ENV_MISSING', 'LOCALAPPDATA 환경 변수가 없거나 절대 경로가 아닙니다', 'LOCALAPPDATA');
  return path.join(base, 'sumun', 'ca');
}

// 위로 올라가며 .git(폴더 또는 worktree의 파일)을 찾는다
function insideRepo(start: string): boolean {
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// 결정 6·7, 사례 32~34·36: 키가 저장소 안이나 엉뚱한 곳에 생기지 않게 쓰기 전에 막는다
function checkDir(dir: string) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new CAError('CA_DIR_RELATIVE', 'CA 폴더는 절대 경로여야 합니다', String(dir));
  const abs = path.resolve(dir);
  let existing = abs;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  // 정션·심볼릭 링크를 실제 경로로 풀어서 본다(사례 34). 적힌 경로와 실제 경로 둘 다 검사한다
  const real = fs.realpathSync.native(existing);
  if (insideRepo(abs) || insideRepo(real)) throw new CAError('CA_DIR_IN_REPO', 'CA 폴더가 git 저장소 안에 있습니다. 개인키는 저장소 밖에 두어야 합니다', abs);
  if (existing === abs && !fs.statSync(abs).isDirectory()) throw new CAError('CA_DIR_NOT_DIR', 'CA 폴더 자리에 파일이 있습니다', abs);
  return abs;
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // 메모장이 붙이는 BOM(사례 27)

// 결정 1~5·10·11: 우리가 만드는 CA와 같은 정책인지. 다른 도구의 CA나 말단 인증서를 루트로 쓰지 않는다(사례 25)
function followsPolicy(x: crypto.X509Certificate, certPem: string): boolean {
  if (!x.ca || x.subject !== x.issuer || !x.verify(x.publicKey)) return false;
  if (x.publicKey.asymmetricKeyType !== 'rsa' || (x.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
  if (JSON.stringify(x.keyUsage ?? []) !== JSON.stringify([SERVER_AUTH])) return false; // Node의 keyUsage는 EKU 목록이다
  let c: forge.pki.Certificate;
  try {
    c = forge.pki.certificateFromPem(certPem);
  } catch {
    return false;
  }
  const ext = (name: string) => (c.extensions as any[]).find((e) => e.name === name);
  const bc = ext('basicConstraints');
  const ku = ext('keyUsage');
  return c.signatureOid === SHA256_RSA && bc?.cA === true && bc.critical === true && bc.pathLenConstraint === 0 && ku?.critical === true && ku.keyCertSign === true;
}

function load(f: { cert: string; key: string }, now: Date, onWarning: (msg: string) => void): CA {
  const certPem = stripBom(fs.readFileSync(f.cert, 'utf8'));
  const keyPem = stripBom(fs.readFileSync(f.key, 'utf8'));
  let x: crypto.X509Certificate;
  let key: crypto.KeyObject;
  try {
    x = new crypto.X509Certificate(certPem);
  } catch {
    throw new CAError('CA_CORRUPT', 'CA 인증서 파일을 읽을 수 없습니다(손상)', f.cert);
  }
  try {
    key = crypto.createPrivateKey(keyPem); // 암호화된 키는 암호가 없어 여기서 실패한다(결정 10: 평문 + 권한)
  } catch {
    throw new CAError('CA_CORRUPT', 'CA 개인키 파일을 읽을 수 없습니다(손상 또는 암호화됨)', f.key);
  }
  let pair = false;
  try {
    pair = x.checkPrivateKey(key);
  } catch {}
  if (!pair) throw new CAError('CA_MISMATCH', 'CA 인증서와 개인키의 짝이 맞지 않습니다', f.key);
  if (!followsPolicy(x, certPem)) throw new CAError('CA_NOT_CA', '이 프로그램이 쓰는 루트 CA 형식이 아닙니다', f.cert);
  const from = Date.parse(x.validFrom);
  const to = Date.parse(x.validTo);
  if (now.getTime() < from) throw new CAError('CA_NOT_YET_VALID', 'CA 인증서의 유효 기간이 아직 시작되지 않았습니다(PC 시계를 확인하세요)', f.cert);
  if (now.getTime() > to) throw new CAError('CA_EXPIRED', 'CA 인증서가 만료됐습니다. 새로 만들려면 폴더를 지우고 다시 등록해야 합니다', f.cert);
  const left = Math.round((to - now.getTime()) / DAY);
  if (left <= WARN_DAYS) onWarning(`루트 CA가 ${left}일 뒤 만료됩니다: ${f.cert}`);
  return { certPem, keyPem };
}

async function makeCA(dir: string): Promise<CA> {
  // 결정 15: 키는 Node가 만든다(비동기·OS 난수, 이벤트 루프를 막지 않음). 서명만 forge
  const { privateKey, publicKey } = await new Promise<{ privateKey: string; publicKey: string }>((resolve, reject) =>
    crypto.generateKeyPair(
      'rsa',
      { modulusLength: 2048, publicExponent: 0x10001, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } },
      (err, pub, priv) => (err ? reject(new CAError('CA_CORRUPT', 'CA 키를 만들지 못했습니다', dir)) : resolve({ privateKey: priv, publicKey: pub })),
    ),
  );
  const { pki } = forge;
  const c = pki.createCertificate();
  c.publicKey = pki.publicKeyFromPem(publicKey);
  // 사례 6: 128비트 난수. 첫 바이트를 0x01~0x7f로 — forge는 최상위 비트가 1이면 음수로 인코딩한다 [확인됨: scripts/probe/tls2-forge.mjs E70],
  // 0x00이면 DER 최소 인코딩이 깨진다
  const serial = crypto.randomBytes(16);
  serial[0] = serial[0] & 0x7f || 0x01;
  c.serialNumber = serial.toString('hex');
  // 사례 8·9: forge 기본값은 notAfter = notBefore다 [확인됨: E70 실측 출력]. notBefore는 시계 오차를 위해 1일 전(결정 13)
  const now = Date.now();
  c.validity.notBefore = new Date(now - DAY);
  c.validity.notAfter = new Date(now + VALID_DAYS * DAY);
  const name = [{ name: 'commonName', value: `sumun local CA ${new Date(now).toISOString().slice(0, 10)}` }]; // 결정 14: 생성일로 구분
  c.setSubject(name);
  c.setIssuer(name);
  c.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true }, // 결정 5: 중간 CA를 만들 수 없게
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true }, // 결정 4(사용자): 키가 새도 코드 서명·메일은 믿지 않게
    { name: 'subjectKeyIdentifier' },
  ]);
  c.sign(pki.privateKeyFromPem(privateKey), forge.md.sha256.create()); // 사례 10: md를 안 넘기면 SHA-1이다 [확인됨: E69]
  return { certPem: pki.certificateToPem(c), keyPem: privateKey };
}

// ---------- [TLS-2b] 키 파일 권한: 본인 하나만(결정 9) ----------
// Windows 도구는 절대 경로로 부른다. PATH에서 찾으면 Git Bash의 whoami가 Windows whoami.exe를 가린다 [확인됨: tls2b-fs.mjs 첫 실행]
const SYS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const run = (exe: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(path.join(SYS, exe), args, { encoding: 'latin1', windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out))),
  );
let mySid: Promise<string> | undefined;
const me = () =>
  (mySid ??= run('whoami.exe', ['/user', '/fo', 'csv', '/nh']).then((o) => {
    const sid = o.trim().split(',').pop()?.replace(/"/g, '') ?? '';
    if (!/^S-1-\d+(-\d+)+$/.test(sid)) throw new Error('SID를 읽지 못함');
    return sid;
  }));
// SDDL 별칭(icacls /save가 잘 알려진 계정을 두 글자로 쓴다). 모르는 별칭은 그대로 두어 /remove:g가 실패하게 한다(실패하면 닫힘)
const ALIAS: Record<string, string> = { SY: 'S-1-5-18', BA: 'S-1-5-32-544', BU: 'S-1-5-32-545', AU: 'S-1-5-11', WD: 'S-1-1-0', CO: 'S-1-3-0', OW: 'S-1-3-4' };
async function daclOf(file: string) {
  const out = path.join(os.tmpdir(), `sumun-acl-${process.pid}-${crypto.randomBytes(6).toString('hex')}.txt`);
  try {
    await run('icacls.exe', [file, '/save', out]);
    const sddl = fs.readFileSync(out).toString('utf16le').split(/\r?\n/)[1] ?? '';
    const dacl = sddl.slice(Math.max(0, sddl.indexOf('D:')));
    const aces = [...dacl.matchAll(/\(([^;]*);[^;]*;[^;]*;[^;]*;[^;]*;([^)]*)\)/g)].map((m) => ({ type: m[1], sid: ALIAS[m[2]] ?? m[2] }));
    return { protected: dacl.startsWith('D:P'), aces };
  } finally {
    fs.rmSync(out, { force: true });
  }
}
// /inheritance:r /grant:r만으로는 직접 붙은 다른 계정(SYSTEM·Administrators)이 남는다 → 읽어서 하나씩 지우고, 마지막에 다시 확인한다
// [확인됨: tls2b-fs.mjs E79 불일치 → E79b]. SDDL을 통째로 덮어쓰는 /restore는 관리자 특권이 필요하다(종료 코드 1300)
export async function restrictToMe(file: string) {
  const sid = await me();
  await run('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`]);
  const others = [...new Set((await daclOf(file)).aces.map((a) => a.sid).filter((s) => s !== sid))];
  if (others.length) await run('icacls.exe', [file, '/remove:g', ...others.map((s) => `*${s}`)]);
  const final = await daclOf(file);
  if (!final.protected || final.aces.length !== 1 || final.aces[0].sid !== sid || final.aces[0].type !== 'A') throw new Error('권한 확인 실패');
}

// ---------- [TLS-2b] 배치 ----------
export type CAIO = {
  writeFile: (p: string, data: string) => void;
  link: (from: string, to: string) => void;
  restrict: (keyPath: string) => Promise<void>;
};
const defaultIO: CAIO = { writeFile: (p, d) => fs.writeFileSync(p, d), link: (a, b) => fs.linkSync(a, b), restrict: restrictToMe };
const TMP = /^ca-(key|cert)\.pem\..+\.tmp$/;
const STALE_MS = 60_000;

// 사례 31: 60초 넘은 우리 임시 파일만 지운다(최근 것은 다른 프로세스가 쓰는 중일 수 있다). 일반 파일만, 링크는 건드리지 않는다
function cleanStale(dir: string) {
  for (const n of fs.readdirSync(dir)) {
    if (!TMP.test(n)) continue;
    const p = path.join(dir, n);
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (st?.isFile() && Date.now() - st.mtimeMs > STALE_MS) fs.rmSync(p, { force: true });
  }
}

const LOST = Symbol('lost'); // 키 배치에서 졌다(다른 호출이 먼저 만들었다)
async function place(f: { cert: string; key: string }, dir: string, ca: CA, io: CAIO): Promise<CA | typeof LOST> {
  fs.mkdirSync(dir, { recursive: true });
  cleanStale(dir);
  const tag = `${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tmp = { key: `${f.key}.${tag}`, cert: `${f.cert}.${tag}` };
  const placed: string[] = [];
  const fail = (code: 'CA_WRITE' | 'CA_ACL', message: string, p: string) => new CAError(code, message, p);
  try {
    try {
      fs.writeFileSync(tmp.key, '', { flag: 'wx' }); // 빈 채로 만들고
    } catch {
      throw fail('CA_WRITE', 'CA 임시 파일을 만들지 못했습니다', tmp.key);
    }
    try {
      await io.restrict(tmp.key); // 권한을 정한 뒤에야 키를 쓴다(사례 38)
    } catch {
      throw fail('CA_ACL', 'CA 개인키 파일의 권한을 본인만으로 정하지 못했습니다', tmp.key);
    }
    try {
      io.writeFile(tmp.key, ca.keyPem); // 같은 파일을 다시 열어 쓰면 ACL은 그대로다 [확인됨: E79b]
      io.writeFile(tmp.cert, ca.certPem);
    } catch {
      throw fail('CA_WRITE', 'CA 파일을 쓰지 못했습니다', dir);
    }
    try {
      io.link(tmp.key, f.key); // 하드 링크는 ACL을 공유한다 [확인됨: E78]
      placed.push(f.key);
    } catch (e: any) {
      if (e?.code === 'EEXIST') return LOST;
      throw fail('CA_WRITE', 'CA 개인키를 제자리에 두지 못했습니다', f.key);
    }
    try {
      io.link(tmp.cert, f.cert);
      placed.push(f.cert);
    } catch {
      throw fail('CA_WRITE', 'CA 인증서를 제자리에 두지 못했습니다', f.cert);
    }
    return ca;
  } catch (e) {
    for (const p of placed) fs.rmSync(p, { force: true }); // 사례 28: 반쪽 CA를 남기지 않는다
    throw e;
  } finally {
    fs.rmSync(tmp.key, { force: true });
    fs.rmSync(tmp.cert, { force: true });
  }
}

// CA 파일 자리의 상태. 링크·정션은 따라가지 않는다(사례 35)
function kind(p: string): 'none' | 'file' | 'other' {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return 'none';
  return st.isFile() && !st.isSymbolicLink() ? 'file' : 'other';
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loadOrCreateCA(
  dir: string,
  opts: { now?: Date; onWarning?: (msg: string) => void; io?: Partial<CAIO> } = {},
): Promise<CA> {
  const abs = checkDir(dir);
  const f = { cert: path.join(abs, CERT_FILE), key: path.join(abs, KEY_FILE) };
  const io = { ...defaultIO, ...opts.io };
  const finish = () => load(f, opts.now ?? new Date(), opts.onWarning ?? ((m) => console.warn(m)));
  // 한쪽만 있을 때는 다른 호출이 만드는 중일 수 있어 잠깐 기다린다(키 배치와 인증서 배치 사이). 그래도 한쪽이면 결정 1대로 멈춘다
  const settle = async (ms: number) => {
    for (const end = Date.now() + ms; ; await sleep(20)) {
      const k = [kind(f.cert), kind(f.key)];
      const other = k.indexOf('other');
      if (other >= 0) throw new CAError('CA_NOT_FILE', 'CA 파일 자리에 일반 파일이 아닌 것(링크·정션·폴더)이 있습니다', other === 0 ? f.cert : f.key);
      if (k[0] === k[1] || Date.now() >= end) return k;
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const [cert, key] = await settle(attempt === 0 ? 500 : 2000);
    if (cert === 'file' && key === 'file') return finish();
    // 결정 1(사용자): 한쪽만 있으면 멈춘다. 없는 쪽을 새로 만들면 짝이 맞지 않는 CA가 된다
    if (cert !== key) throw new CAError('CA_INCOMPLETE', 'CA 인증서와 개인키 중 한쪽만 있습니다', cert === 'file' ? f.key : f.cert);
    const made = await place(f, abs, await makeCA(abs), io);
    if (made !== LOST) return made;
    // 졌다: 이긴 쪽이 인증서까지 놓기를 기다렸다가 그것을 읽는다. 이긴 쪽이 되돌렸으면(둘 다 없음) 한 번 더 만든다
  }
  throw new CAError('CA_INCOMPLETE', 'CA를 만드는 다른 호출이 끝나지 않았습니다', abs);
}

// ---------- [TLS-3] 사이트별 인증서 즉석 발급. 사례·결정은 docs/ai/tls3-cases.md ----------
//
//   issueCert(ca, hosts) ─ 이름 검사·정규화 → 루트 검사(짝·정책·남은 기간) → 새 키(비동기) → forge로 말단 TBS → Node crypto.sign(스레드 풀)
//
// 서명을 forge로 하지 않는 이유: forge 서명은 동기라 그동안 프록시 전체가 멈춘다(43~148ms). Node crypto.sign의 콜백형은
// 스레드 풀에서 돌아 지연이 11~16ms로 줄었다 [확인됨: scripts/probe/tls3-sign.mjs E85·E86]. 캐시는 TLS-4(결정 5).
const HOUR = 3_600_000;
const LEAF_DAYS = 30; // 사용자 결정 1(2026-11-08)
const MAX_HOSTS = 50; // 결정 12
const LEAF_LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/; // 결정 9: 밑줄은 허용(실제 사이트 이름에 있다). 와일드카드(*)·비ASCII는 글자에서 걸린다(결정 2·6)

type Name = { dns: string } | { ip: string };
const badHost = (why: string) => new CAError('CA_BAD_HOST', `인증서에 넣을 이름이 올바르지 않습니다(${why})`, 'hosts');

// 이름을 검사하고 정규화한다. 입력은 바꾸지 않는다(사례 34). 오류에는 입력을 넣지 않는다(로그 주입 방지)
export function normalizeHosts(hosts: unknown): Name[] {
  if (!Array.isArray(hosts) || hosts.length === 0) throw badHost('비어 있음');
  if (hosts.length > MAX_HOSTS) throw badHost(`${MAX_HOSTS}개 초과`);
  const out = new Map<string, Name>();
  for (const h of hosts) {
    if (typeof h !== 'string' || h === '') throw badHost('문자열이 아님');
    const bare = /^\[[^\]]*\]$/.test(h) ? h.slice(1, -1) : h;
    if (bare.includes(':')) {
      // IPv6만 콜론을 가진다. 포트(example.com:443, [::1]:443)는 여기서 걸린다(사례 26)
      if (!net.isIPv6(bare)) throw badHost('IPv6 주소');
      const ip = new URL(`http://[${bare}]/`).hostname.slice(1, -1); // 표기를 하나로(0:0:…:1 → ::1)
      if (ip.startsWith('::ffff:')) throw badHost('IPv4-mapped 주소'); // 결정 8
      out.set(`ip:${ip}`, { ip });
      continue;
    }
    const name = (bare.endsWith('.') ? bare.slice(0, -1) : bare).toLowerCase(); // 사례 18: 끝점 하나와 대소문자
    const labels = name.split('.');
    if (name.length > 253 || !labels.every((l) => LEAF_LABEL.test(l))) throw badHost('이름 형식');
    // 숫자로만 된 이름: 점 4개 10진수(앞자리 0 없음)만 IPv4로 받는다. 127.1·2130706433·0x7f.0.0.1·0177.0.0.1은 거부(사례 22, TLS-1 결정 10과 같은 원칙)
    if (labels.every((l) => /^(?:0x[0-9a-f]*|[0-9]+)$/.test(l))) {
      if (labels.length !== 4 || !labels.every((l) => /^(?:0|[1-9][0-9]{0,2})$/.test(l) && Number(l) <= 255)) throw badHost('숫자 주소 표기');
      out.set(`ip:${name}`, { ip: name });
      continue;
    }
    if (labels.length === 1 && name !== 'localhost') throw badHost('한 단어 이름은 localhost만'); // 결정 9
    out.set(`dns:${name}`, { dns: name });
  }
  return [...out.values()];
}

// 결정 11: 루트가 쓸 수 있는지 — 짝, 우리 CA 정책(TLS-2와 같은 검사), 남은 기간 1일 이상
function checkIssuer(ca: CA, now: number) {
  const bad = (why: string) => new CAError('CA_BAD_ISSUER', `발급에 쓸 루트 CA가 올바르지 않습니다(${why})`, 'ca');
  let x: crypto.X509Certificate;
  let key: crypto.KeyObject;
  try {
    x = new crypto.X509Certificate(ca.certPem);
    key = crypto.createPrivateKey(ca.keyPem);
  } catch {
    throw bad('읽을 수 없음');
  }
  let pair = false;
  try {
    pair = x.checkPrivateKey(key);
  } catch {}
  if (!pair) throw bad('인증서와 키의 짝이 맞지 않음');
  if (!followsPolicy(x, ca.certPem)) throw bad('루트 CA 형식이 아님');
  const root = forge.pki.certificateFromPem(ca.certPem);
  if (now < root.validity.notBefore.getTime()) throw bad('유효 기간 시작 전');
  if (root.validity.notAfter.getTime() - now < DAY) throw bad('만료됐거나 남은 기간이 1일 미만');
  return { root, key };
}

export async function issueCert(ca: CA, hosts: string[]): Promise<CA> {
  const names = normalizeHosts(hosts);
  const now = Date.now();
  const { root, key: rootKey } = checkIssuer(ca, now);
  // 결정 3(사용자): 호출마다 새 키. 루트 키를 쓰지 않는다 — 말단 키가 새면 루트가 샌 것과 같아진다
  const { privateKey, publicKey } = await new Promise<{ privateKey: string; publicKey: string }>((resolve, reject) =>
    crypto.generateKeyPair(
      'rsa',
      { modulusLength: 2048, publicExponent: 0x10001, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } },
      (err, pub, priv) => (err ? reject(new CAError('CA_WRITE', '인증서 키를 만들지 못했습니다', 'issueCert')) : resolve({ privateKey: priv, publicKey: pub })),
    ),
  );
  const { pki, asn1 } = forge;
  const c = pki.createCertificate();
  c.publicKey = pki.publicKeyFromPem(publicKey);
  const serial = crypto.randomBytes(16); // 사례 9·10: 128비트 난수, 양수(TLS-2와 같은 처리)
  serial[0] = serial[0] & 0x7f || 0x01;
  c.serialNumber = serial.toString('hex');
  c.validity.notBefore = new Date(now - HOUR); // 시계 오차
  c.validity.notAfter = new Date(Math.min(now + LEAF_DAYS * DAY, root.validity.notAfter.getTime())); // 사례 37: 루트 만료를 넘지 않게
  const first = names[0];
  const cn = 'dns' in first ? first.dns : first.ip;
  // 결정 7: CN은 첫 이름(64자 이하일 때만, X.520 상한). 매칭은 SAN으로만 한다
  c.setSubject(cn.length <= 64 ? [{ name: 'commonName', value: cn }] : []);
  c.setIssuer(root.subject.attributes); // 사례 7: 루트 subject와 바이트까지 같다 [확인됨: E89]
  const ski = root.getExtension('subjectKeyIdentifier') as { subjectKeyIdentifier?: string } | null;
  c.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    // 사례 4·5: SAN 필수, IP는 iPAddress. subject가 비면 SAN은 critical이어야 한다(RFC 5280 4.2.1.6)
    { name: 'subjectAltName', critical: cn.length > 64, altNames: names.map((n) => ('dns' in n ? { type: 2, value: n.dns } : { type: 7, ip: n.ip })) },
    { name: 'subjectKeyIdentifier' },
    ...(ski?.subjectKeyIdentifier ? [{ name: 'authorityKeyIdentifier', keyIdentifier: forge.util.hexToBytes(ski.subjectKeyIdentifier) }] : []),
  ]);
  // forge가 서명할 때 채우는 두 칸(TBS 안의 서명 알고리즘, 바깥 서명 알고리즘)을 먼저 정하고 TBS만 forge로 만든다
  c.siginfo.algorithmOid = c.signatureOid = pki.oids.sha256WithRSAEncryption;
  const tbs = Buffer.from(asn1.toDer(pki.getTBSCertificate(c)).getBytes(), 'binary');
  const sig = await new Promise<Buffer>((resolve, reject) =>
    crypto.sign('sha256', tbs, rootKey, (err, s) => (err ? reject(new CAError('CA_BAD_ISSUER', '루트 CA로 서명하지 못했습니다', 'ca')) : resolve(s))),
  );
  c.signature = sig.toString('binary');
  return { certPem: pki.certificateToPem(c), keyPem: privateKey };
}
