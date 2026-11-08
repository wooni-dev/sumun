// [SEC-3] 루트 CA 등록·해제·상태 명령: npm run ca -- install | uninstall | status. 사례·결정은 docs/ai/sec3-cases.md.
//
//   사람 확인 두 번: 대화형 터미널에서 사람이 친 "yes"(결정 6 — 파이프·스크립트·AI의 셸은 TTY가 아니라 거부) → Windows 자체 확인 창
//   다른 인증서는 건드리지 않는다: 등록은 검사한 DER 하나, 삭제는 40자리 SHA-1 하나(겹치면 거부), 결과는 저장소를 다시 읽어 판정
//   status·uninstall은 CA를 만들지 않는다(A6). install은 CA가 없으면 만들고 "새로 만든"을 따로 보인다(결정 8)
// 저장소·입력·출력·CA 읽기는 주입받는다 — 테스트는 진짜 저장소를 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto, { X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { safeText } from '../cli.ts';
import type { CA } from './ca.ts';
import { TOOLS, addArgs, type StoreCert, type WinStore } from './winstore.ts';

export type CaCmd = 'install' | 'uninstall' | 'status';
export const CA_USAGE = '사용법: npm run ca -- install | uninstall | status';

// C3·C4: 정확히 소문자 명령 하나. 숨은 확인 생략 플래그(--yes 등)는 없다. 인자가 없으면 도움말
export function parseCaArgs(argv: string[]): { cmd: CaCmd } | { help: true } | { error: string } {
  if (argv.length === 0) return { help: true };
  if (argv.length === 1 && (argv[0] === 'install' || argv[0] === 'uninstall' || argv[0] === 'status')) return { cmd: argv[0] };
  return { error: `알 수 없는 인자입니다: ${safeText(argv.join(' ').slice(0, 60), 80)}` };
}

export type CaDeps = {
  store: WinStore;
  caDir: string;
  loadCA: (dir: string) => Promise<CA>;
  checkDir: (dir: string) => Promise<string | null>;
  input: { isTTY: boolean; readLine: () => Promise<string | null> };
  write: (s: string) => void;
  // [SEC-3] 작업 기록(한 줄씩). 단계·지문·certutil 종료 코드·결과만 — 키·비밀 없음. 창을 닫아도 실패 원인이 남게(해제 실측 결함, a9c341e)
  log?: (line: string) => void;
};
const note = (deps: CaDeps, msg: string) => deps.log?.(`${new Date().toISOString()} ${msg}`);

const CERT_FILE = 'ca-cert.pem';
const SUMUN_CN = /^sumun local CA \d{4}-\d{2}-\d{2}$/;
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const PEM_ONE = /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/;

const hash = (alg: 'sha1' | 'sha256', der: Buffer) => crypto.createHash(alg).update(der).digest('hex').toUpperCase();
const cnOf = (x: X509Certificate) => x.subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? '';
const utc = (s: string) => `${new Date(s).toISOString().slice(0, 16).replace('T', ' ')} UTC`; // E3: 시간대를 붙인다
const parse = (der: Buffer) => {
  try {
    return new X509Certificate(der);
  } catch {
    return undefined;
  }
};
// 인증서 한 장의 표시. 인증서에서 온 글자는 모두 safeText(ASCII 인쇄 가능 문자 밖은 이스케이프 — E1)
function describe(der: Buffer, indent = '  ') {
  const x = parse(der);
  return [
    `${indent}이름:    ${x ? safeText(cnOf(x) || x.subject, 200) : '(해석할 수 없는 인증서)'}`,
    `${indent}SHA-1:   ${hash('sha1', der)}   ← Windows 창의 지문(sha1)과 비교`,
    `${indent}SHA-256: ${hash('sha256', der)}`,
    `${indent}만료:    ${x ? utc(x.validTo) : '-'}`,
  ].join('\n');
}

// B5: 옛 sumun CA = 이름 형식 + 자체 서명 + CA + pathLen 0 + EKU serverAuth만. 이름만 같으면 후보가 아니다
function sumunShape(der: Buffer): boolean {
  const x = parse(der);
  if (!x || !SUMUN_CN.test(cnOf(x)) || x.subject !== x.issuer || !x.ca || !x.verify(x.publicKey)) return false;
  if (JSON.stringify(x.keyUsage ?? []) !== JSON.stringify([SERVER_AUTH])) return false;
  try {
    const bc = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der.toString('binary'))).getExtension('basicConstraints') as { cA?: boolean; pathLenConstraint?: number } | null;
    return !!bc?.cA && bc.pathLenConstraint === 0;
  } catch {
    return false; // 우리 CA는 RSA다. forge가 못 읽는 키(EC 등)는 우리 것이 아니다
  }
}
// B6: 이름이 비슷한 인증서 — 우리 모양이 아닌데 ① 이름에 sumun이 있거나 ② ASCII 밖 글자가 있거나(키릴 ѕ, U+202E, 제로폭 등)
// ③ 날짜를 뺀 이름이 "sumun local ca"와 글자 2개 이내로 다르다(Uumun, 5umun 같은 ASCII 바꿔치기)
// [확인됨: 구현 중 — 테스트의 forge 인증서는 'ѕ'를 'U'로 잘라 "Uumun local CA …"가 된다. ③이 없으면 놓친다]
const distance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
function lookalike(der: Buffer): boolean {
  const x = parse(der);
  if (!x || sumunShape(der)) return false;
  const cn = cnOf(x).normalize('NFKC');
  const base = cn.toLowerCase().replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '');
  return /sumun/i.test(cn) || /[^\x20-\x7e]/.test(cn) || distance(base, 'sumun local ca') <= 2;
}
// B3: certutil은 지문 자리에 일련번호·이름·키 해시도 맞춘다. 사용자 Root의 다른 인증서가 그 값과 겹치면 지우지 않는다
function collides(token: string, others: StoreCert[]): boolean {
  const t = token.toLowerCase();
  return others.some((c) => {
    const x = parse(c.der);
    if (!x) return false;
    const vals = [x.serialNumber, cnOf(x), crypto.createHash('sha1').update(x.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')];
    try {
      const ski = forge.pki.certificateFromAsn1(forge.asn1.fromDer(c.der.toString('binary'))).getExtension('subjectKeyIdentifier') as { subjectKeyIdentifier?: string } | null;
      if (ski?.subjectKeyIdentifier) vals.push(ski.subjectKeyIdentifier);
    } catch {}
    return vals.some((v) => v.toLowerCase().replace(/[^0-9a-z]/g, '') === t);
  });
}

// "예"의 뜻인 입력 — 여전히 취소하지만(결정 C1) 영어 yes를 쳐야 한다고 알려 준다. 해제 실측에서 이 혼동이 의심됐다(a9c341e)
const MEANS_YES = /^(?:예|네|응|ㅇ|y|ye|yes[.!]?|ok|okay)$/i;
async function ask(deps: CaDeps, question: string, step: string): Promise<boolean> {
  deps.write(`${question} 계속하려면 영어로 yes를 입력하세요(그 밖의 입력은 취소): `);
  const line = await deps.input.readLine();
  deps.write('\n');
  const ok = line !== null && line.trim() === 'yes'; // C1: 앞뒤 공백·CR만 버린다. YES·y·예·전각은 취소
  note(deps, `${step} 확인 입력 ${line === null ? '(입력 끝)' : JSON.stringify(line.slice(0, 20))} → ${ok ? '진행' : '취소'}`);
  if (!ok && line !== null && MEANS_YES.test(line.trim())) deps.write(`sumun: '${line.trim().slice(0, 10)}'가 아니라 영어 yes를 입력해야 진행합니다. 이번에는 취소했습니다 — 다시 실행하세요.\n`);
  return ok;
}
async function guard(deps: CaDeps): Promise<boolean> {
  if (await deps.store.elevated()) {
    deps.write('sumun: 관리자 권한(승격된) 터미널에서는 실행하지 않습니다. 일반 터미널에서 다시 실행하세요(현재 사용자 저장소에는 관리자 권한이 필요 없습니다).\n');
    return false;
  }
  if (!deps.input.isTTY) {
    deps.write('sumun: 대화형 터미널에서 직접 실행해야 합니다(입력을 파이프·스크립트로 넣을 수 없습니다). PowerShell 창에서 직접 실행하세요.\n');
    return false;
  }
  return true;
}
const exists = (dir: string) => fs.existsSync(path.join(dir, CERT_FILE));
const NOTES = [
  '안내:',
  '  - 등록하면 Chrome·Edge뿐 아니라 이 사용자의 Windows TLS 프로그램(PowerShell, .NET 등)도 이 CA를 믿습니다. Firefox도 설정에 따라 Windows 루트를 믿을 수 있습니다.',
  '  - curl(Windows·Git Bash 모두 Schannel)은 sumun 인증서의 폐기 확인을 할 수 없어 --ssl-no-revoke가 필요합니다.',
  '  - 개인키가 새면 이 사용자에게 아무 사이트나 진짜처럼 보일 수 있습니다. 안 쓸 때는 npm run ca -- uninstall로 해제하세요.',
].join('\n');

async function install(deps: CaDeps): Promise<number> {
  if (!(await guard(deps))) return 1;
  const created = !exists(deps.caDir);
  let ca: CA;
  try {
    ca = await deps.loadCA(deps.caDir);
  } catch (e) {
    deps.write(`sumun: 루트 CA를 쓸 수 없습니다(${safeText(String((e as { code?: string })?.code ?? '알 수 없음'), 40)}).\n`);
    return 1;
  }
  // A1·A2: 파일에 인증서 블록 하나와 줄바꿈 말고 아무것도 없어야 한다. 등록할 바이트는 그 하나의 DER
  const file = path.join(deps.caDir, CERT_FILE);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  if (!PEM_ONE.test(text) || !PEM_ONE.test(ca.certPem)) {
    deps.write(`sumun: ${CERT_FILE}에 인증서 하나만 있어야 합니다(다른 글자나 두 번째 인증서가 있어 등록하지 않습니다): ${safeText(file, 300)}\n`);
    return 1;
  }
  const der = Buffer.from(new X509Certificate(ca.certPem).raw);
  if (!Buffer.from(new X509Certificate(text).raw).equals(der)) {
    deps.write(`sumun: ${CERT_FILE}가 읽는 도중 바뀌었습니다. 등록하지 않습니다.\n`);
    return 1;
  }
  const bad = await deps.checkDir(deps.caDir);
  if (bad) {
    deps.write(`sumun: CA 폴더를 믿을 수 없어 등록하지 않습니다: ${bad}\n`);
    return 1;
  }
  const sha1 = hash('sha1', der);
  note(deps, `install 시작 지문 ${sha1}${created ? ' (새로 만든 CA)' : ''}`);
  const before = await deps.store.userRoot();
  if (before.some((c) => c.sha1 === sha1)) {
    note(deps, `install 이미 등록됨 ${sha1}`);
    deps.write(`sumun: 이미 등록됨 — 현재 사용자의 신뢰할 수 있는 루트에 있습니다.\n${describe(der)}\n`);
    return 0;
  }
  deps.write(
    [
      "sumun: 루트 CA를 현재 사용자의 '신뢰할 수 있는 루트 인증 기관'에 넣습니다.",
      ...(created ? ['  ※ 새로 만든 CA입니다(처음 실행).'] : []),
      describe(der),
      `  키 위치: ${safeText(deps.caDir, 300)}`,
      `  실행할 명령: ${[TOOLS.certutil, ...addArgs('<임시 파일>')].join(' ')}`,
      NOTES,
      '',
    ].join('\n'),
  );
  if (!(await ask(deps, '등록할까요?', 'install'))) {
    deps.write('sumun: 취소했습니다. 아무것도 바꾸지 않았습니다.\n');
    return 1;
  }
  deps.write("sumun: Windows 확인 창이 뜹니다. 창의 지문(sha1)이 위 SHA-1과 같은지 확인한 뒤 '예'를 누르세요.\n");
  let r: { code: number };
  try {
    r = await deps.store.add(der);
  } catch (e) {
    note(deps, `install certutil -addstore 끝나지 않음(${String((e as { code?: string })?.code ?? '알 수 없음').slice(0, 40)}) — 결과 모름`);
    deps.write('sumun: 등록 명령이 끝나지 않아 결과를 모릅니다. npm run ca -- status로 확인하세요.\n');
    return 1;
  }
  note(deps, `install certutil -addstore 종료 코드 ${r.code}`);
  const after = await deps.store.userRoot();
  const extra = after.filter((c) => c.sha1 !== sha1 && !before.some((b) => b.sha1 === c.sha1));
  if (extra.length) deps.write(`sumun: ⚠ 예상하지 못한 인증서가 함께 생겼습니다(npm run ca -- status로 확인하세요): ${extra.map((c) => c.sha1).join(', ')}\n`);
  if (extra.length) note(deps, `install 예상하지 못한 새 인증서 ${extra.map((c) => c.sha1).join(', ')}`);
  if (after.some((c) => c.sha1 === sha1)) {
    note(deps, `install 결과: 등록됨 ${sha1}`);
    deps.write(`sumun: 등록됨 — 지문 ${sha1}. 브라우저를 다시 시작한 뒤 npm start -- --decrypt로 쓰세요.\n`);
    return 0;
  }
  note(deps, `install 결과: 등록되지 않음(저장소 재조회) ${sha1}`);
  deps.write(`sumun: 등록되지 않았습니다(취소했거나 실패했습니다, certutil 종료 코드 ${r.code}). 저장소를 다시 읽어 확인했습니다.\n`);
  return 1;
}

async function uninstall(deps: CaDeps): Promise<number> {
  if (!(await guard(deps))) return 1;
  let current: Buffer | undefined;
  if (exists(deps.caDir)) {
    try {
      current = Buffer.from(new X509Certificate((await deps.loadCA(deps.caDir)).certPem).raw);
    } catch {
      deps.write('sumun: 현재 CA를 읽지 못했습니다. 옛 sumun CA만 찾습니다.\n');
    }
  }
  const curSha1 = current && hash('sha1', current);
  const user = await deps.store.userRoot();
  const machine = await deps.store.machineRootThumbprints();
  const targets = [
    ...user.filter((c) => c.sha1 === curSha1).map((c) => ({ ...c, kind: '현재 CA' })),
    ...user.filter((c) => c.sha1 !== curSha1 && sumunShape(c.der)).map((c) => ({ ...c, kind: '옛 sumun CA' })),
  ];
  if (curSha1 && machine.includes(curSha1)) {
    deps.write('sumun: 현재 CA가 컴퓨터 저장소(LocalMachine)에도 있습니다 — 이 명령으로 지울 수 없습니다(관리자 권한으로 직접 지워야 합니다).\n');
  }
  note(deps, `uninstall 시작 현재 CA ${curSha1 ?? '없음'}, 대상 ${targets.map((t) => `${t.kind} ${t.sha1}`).join(', ') || '없음'}${curSha1 && machine.includes(curSha1) ? ', 컴퓨터 Root에도 있음' : ''}`);
  if (!targets.length) {
    deps.write('sumun: 현재 사용자의 신뢰할 수 있는 루트에 지울 sumun 인증서가 없습니다.\n');
    return 0;
  }
  let failed = false;
  let removed = 0;
  for (const t of targets) {
    deps.write(`\nsumun: ${t.kind}\n${describe(t.der)}\n`);
    if (collides(t.sha1, user.filter((c) => c.sha1 !== t.sha1))) {
      note(deps, `uninstall ${t.sha1} 지문 겹침 — 지우지 않음`);
      deps.write('sumun: 이 지문이 다른 인증서의 일련번호·이름·키 값과 겹쳐 certutil이 엉뚱한 인증서를 지울 수 있습니다. 지우지 않습니다.\n');
      failed = true;
      continue;
    }
    if (!(await ask(deps, '이 인증서를 지울까요?', `uninstall ${t.sha1}`))) {
      deps.write('sumun: 취소했습니다.\n');
      failed = true;
      continue;
    }
    deps.write("sumun: Windows 확인 창이 뜨면 '예'를 누르세요.\n");
    let code = -1;
    try {
      code = (await deps.store.remove(t.sha1.toLowerCase())).code; // B1: 40자리 소문자(certutil에 넘기는 모양 그대로)
    } catch (e) {
      note(deps, `uninstall ${t.sha1} certutil -delstore 끝나지 않음(${String((e as { code?: string })?.code ?? '알 수 없음').slice(0, 40)}) — 결과 모름`);
      deps.write('sumun: 해제 명령이 끝나지 않아 결과를 모릅니다. npm run ca -- status로 확인하세요.\n');
      failed = true;
      continue;
    }
    note(deps, `uninstall ${t.sha1} certutil -delstore 종료 코드 ${code}`);
    if ((await deps.store.userRoot()).some((c) => c.sha1 === t.sha1)) {
      note(deps, `uninstall 결과: 해제되지 않음(저장소 재조회) ${t.sha1}`);
      deps.write(`sumun: 해제되지 않았습니다(certutil 종료 코드 ${code}).\n`);
      failed = true;
    } else {
      note(deps, `uninstall 결과: 해제됨 ${t.sha1}`);
      deps.write(`sumun: 해제됨 — 지문 ${t.sha1}\n`);
      removed++;
    }
  }
  if (removed) deps.write('sumun: 브라우저(Chrome·Edge)를 완전히 닫았다가 다시 열어야 반영됩니다(열린 연결은 계속 믿을 수 있습니다).\n');
  return failed ? 1 : 0;
}

async function status(deps: CaDeps): Promise<number> {
  const lines: string[] = [];
  let current: Buffer | undefined;
  if (exists(deps.caDir)) {
    try {
      current = Buffer.from(new X509Certificate((await deps.loadCA(deps.caDir)).certPem).raw);
    } catch (e) {
      lines.push(`현재 CA: 읽을 수 없습니다(${safeText(String((e as { code?: string })?.code ?? '알 수 없음'), 40)})`);
    }
  } else lines.push('현재 CA: 아직 없습니다(npm run ca -- install 또는 npm start -- --decrypt가 만듭니다).');
  const user = await deps.store.userRoot();
  const machine = await deps.store.machineRootThumbprints();
  const curSha1 = current && hash('sha1', current);
  if (current) {
    lines.push(`현재 CA (${safeText(deps.caDir, 300)})`, describe(current));
    const reg = user.some((c) => c.sha1 === curSha1);
    lines.push(`  사용자 Root: ${reg ? '등록됨 ⚠ 등록 중에는 개인키가 새면 이 사용자의 HTTPS가 위조될 수 있습니다' : '등록 안 됨'}`);
    lines.push(`  컴퓨터 Root: ${machine.includes(curSha1!) ? '있음(이 명령으로 지울 수 없음)' : '없음'}`);
  }
  const old = user.filter((c) => c.sha1 !== curSha1 && sumunShape(c.der));
  for (const c of old) lines.push('옛 sumun CA(사용자 Root에 남아 있음 — uninstall이 지울지 묻습니다)', describe(c.der));
  const look = user.filter((c) => c.sha1 !== curSha1 && lookalike(c.der));
  for (const c of look) lines.push('⚠ 이름이 비슷한 인증서(sumun이 만든 것이 아닐 수 있습니다. 이 명령은 지우지 않습니다)', describe(c.der));
  lines.push(NOTES, '');
  deps.write(lines.join('\n'));
  return 0;
}

export async function runCaCommand(cmd: CaCmd, deps: CaDeps): Promise<number> {
  return cmd === 'install' ? install(deps) : cmd === 'uninstall' ? uninstall(deps) : status(deps);
}

// A7(결정 5⑦): CA 폴더가 링크(정션·심볼릭 링크)이거나, 본인·SYSTEM·Administrators(그리고 상속 전용 CREATOR OWNER) 밖의 계정에 허용 권한이 있으면 거부
const TRUSTED = ['S-1-5-18', 'S-1-5-32-544', 'S-1-3-0'];
export async function checkCADir(
  dir: string,
  io: { realpath: (p: string) => string; dacl: (p: string) => Promise<{ protected: boolean; aces: { type: string; sid: string }[] }>; mySid: () => Promise<string> },
): Promise<string | null> {
  const real = io.realpath(dir);
  if (path.resolve(real).toLowerCase() !== path.resolve(dir).toLowerCase()) return `링크(정션·심볼릭 링크)로 다른 곳을 가리킵니다: ${safeText(real, 300)}`;
  const me = await io.mySid();
  const others = (await io.dacl(dir)).aces.filter((a) => a.type === 'A' && a.sid !== me && !TRUSTED.includes(a.sid)).map((a) => a.sid);
  return others.length ? `다른 계정도 권한이 있는 폴더입니다(${safeText([...new Set(others)].join(', '), 200)})` : null;
}
