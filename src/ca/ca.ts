// [TLS-2] 루트 CA 생성·보관. 사례·결정은 docs/ai/tls2-cases.md.
//
//   loadOrCreateCA(dir) ─┬─ 경로 검사: 절대 경로인가 → git 저장소 밖인가(정션은 실제 경로로 풀어서) → 폴더인가
//                        ├─ 두 파일이 다 없으면: 새 CA를 만들어 저장 (키: Node crypto, 인증서 서명: node-forge)
//                        └─ 있으면: 읽기 → 손상 → 짝 → 정책 → 유효 기간 순으로 검사. 하나라도 어긋나면 멈춘다(결정 1)
//
// 깨진 CA를 자동으로 다시 만들지 않는다: 이미 Windows에 등록한 옛 CA가 "믿는 발급자"로 남고, 무엇이 잘못됐는지도 사라진다.
// 오류에는 경로만 넣고 파일 내용·키·하위 오류(cause)는 넣지 않는다(사례 42).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
  | 'CA_ENV_MISSING';

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

async function create(f: { cert: string; key: string }, dir: string): Promise<CA> {
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
  const ca = { certPem: pki.certificateToPem(c), keyPem: privateKey };
  fs.mkdirSync(dir, { recursive: true });
  // 'wx': 이미 있으면 덮어쓰지 않는다. 원자적 쓰기·동시 실행·권한(ACL)은 TLS-2b
  fs.writeFileSync(f.key, ca.keyPem, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(f.cert, ca.certPem, { flag: 'wx' });
  return ca;
}

export async function loadOrCreateCA(dir: string, opts: { now?: Date; onWarning?: (msg: string) => void } = {}): Promise<CA> {
  const abs = checkDir(dir);
  const f = { cert: path.join(abs, CERT_FILE), key: path.join(abs, KEY_FILE) };
  const has = [fs.existsSync(f.cert), fs.existsSync(f.key)];
  if (!has[0] && !has[1]) return create(f, abs);
  // 결정 1(사용자): 한쪽만 있으면 멈춘다. 없는 쪽을 새로 만들면 짝이 맞지 않는 CA가 된다
  if (!has[0] || !has[1]) throw new CAError('CA_INCOMPLETE', 'CA 인증서와 개인키 중 한쪽만 있습니다', has[0] ? f.key : f.cert);
  return load(f, opts.now ?? new Date(), opts.onWarning ?? ((m) => console.warn(m)));
}
