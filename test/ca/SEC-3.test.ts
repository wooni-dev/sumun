// [SEC-3] 새 동작: 루트 CA 등록·해제·상태 명령. 사례·결정은 docs/ai/sec3-cases.md, 실측 scripts/probe/sec3-reg.mjs.
// 진짜 Windows 인증서 저장소는 절대 건드리지 않는다: 저장소(WinStore)와 명령 실행기(Run)는 모두 가짜다. CA는 임시 폴더에만 만든다.
//   parseCaArgs(argv) → { cmd } | { help } | { error }
//   runCaCommand(cmd, { store, caDir, loadCA, checkDir, input: { isTTY, readLine }, write }) → 종료 코드(0 = 성공)
//   makeWinStore(run): userRoot()(HKCU 레지스트리), machineRootThumbprints(), add(der), remove(sha1), elevated()
//   parseRegCerts(reg 출력), blobToDer(hex), checkCADir(dir, { realpath, dacl, mySid })
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto, { X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { loadOrCreateCA } from '../../src/ca/ca.ts';
import { parseCaArgs, runCaCommand, checkCADir } from '../../src/ca/command.ts';
import { makeWinStore, parseRegCerts, blobToDer, TOOLS, type StoreCert, type Run } from '../../src/ca/winstore.ts';

const temps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-sec3-'));
  temps.push(d);
  return d;
};
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const sha1 = (der: Buffer) => crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
const entry = (der: Buffer): StoreCert => ({ sha1: sha1(der), der });
const derOf = (pem: string) => Buffer.from(new X509Certificate(pem).raw);

// 가짜 저장소: 사용자 Root(물리)와 컴퓨터 Root 지문 목록. add·remove 호출을 기록한다
function fakeStore(o: { user?: StoreCert[]; machine?: string[]; elevated?: boolean; addCode?: number; addPuts?: boolean; addThrows?: boolean } = {}) {
  const s = {
    user: [...(o.user ?? [])],
    machine: [...(o.machine ?? [])],
    adds: [] as Buffer[],
    removes: [] as string[],
    async userRoot() {
      return [...s.user];
    },
    async machineRootThumbprints() {
      return [...s.machine];
    },
    async add(der: Buffer) {
      s.adds.push(Buffer.from(der));
      if (o.addThrows) throw Object.assign(new Error('시간 초과'), { code: 'ETIMEDOUT' });
      if (o.addPuts !== false) s.user.push(entry(Buffer.from(der)));
      return { code: o.addCode ?? 0 };
    },
    async remove(h: string) {
      s.removes.push(h);
      s.user = s.user.filter((c) => c.sha1.toLowerCase() !== h.toLowerCase());
      return { code: 0 };
    },
    async elevated() {
      return o.elevated ?? false;
    },
  };
  return s;
}
const tty = (answers: (string | null)[], isTTY = true) => {
  const i = { isTTY, reads: 0, async readLine() {
    i.reads++;
    return answers.length ? answers.shift()! : null;
  } };
  return i;
};
async function run(cmd: 'install' | 'uninstall' | 'status', o: { caDir: string; store: ReturnType<typeof fakeStore>; input?: ReturnType<typeof tty>; checkDir?: (d: string) => Promise<string | null> }) {
  let out = '';
  const code = await runCaCommand(cmd, {
    store: o.store,
    caDir: o.caDir,
    loadCA: loadOrCreateCA,
    checkDir: o.checkDir ?? (async () => null),
    input: o.input ?? tty([]),
    write: (s: string) => void (out += s),
  });
  return { code, out };
}
const newCA = async () => {
  const dir = path.join(tmp(), 'ca');
  const ca = await loadOrCreateCA(dir);
  return { dir, ca, der: derOf(ca.certPem) };
};

// 일부러 만든 인증서(forge). opts로 CN·일련번호·CA 여부·EKU를 바꾼다
function forgeCert(o: { cn: string; serialHex?: string; ca?: boolean; pathLen?: number; eku?: boolean }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  // 첫 hex가 8~f면 forge가 음수 INTEGER로 써서 Node가 "-65D4…"로 읽는다 → 앞에 00을 붙여 양수로(Node는 00을 빼고 보여 준다)
  c.serialNumber = o.serialHex === undefined ? '01' + crypto.randomBytes(8).toString('hex') : /^[89a-f]/i.test(o.serialHex) ? '00' + o.serialHex : o.serialHex;
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  // UTF8String으로 넣는다(태그 없이 넘기면 0xFF 위 글자가 잘린다: 'ѕ' → 'U'). forge가 UTF8 태그일 때 스스로 UTF-8로 바꾸므로 encodeUtf8을 또 하면 두 번 인코딩된다
  const name = [{ name: 'commonName', value: o.cn, valueTagClass: forge.asn1.Type.UTF8 }];
  c.setSubject(name);
  c.setIssuer(name);
  const ext: object[] = [{ name: 'basicConstraints', cA: o.ca ?? true, ...(o.pathLen === undefined ? {} : { pathLenConstraint: o.pathLen }), critical: true }];
  if (o.eku) ext.push({ name: 'extKeyUsage', serverAuth: true });
  c.setExtensions(ext);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string), forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary');
}

// ---------------- 인자 (C3, C4) ----------------
test('C3·C4: 명령은 정확히 install·uninstall·status 하나. 인자가 없으면 도움말, 대소문자·추가 인자·숨은 플래그는 거부', () => {
  for (const c of ['install', 'uninstall', 'status'] as const) assert.deepEqual(parseCaArgs([c]), { cmd: c });
  assert.deepEqual(parseCaArgs([]), { help: true });
  for (const bad of [['Install'], ['--install'], ['install', 'uninstall'], ['install', '--yes'], ['-y'], ['--force', 'install'], ['install', 'install'], ['status', 'x']]) {
    assert.ok('error' in (parseCaArgs(bad) as object), `거부: ${JSON.stringify(bad)}`);
  }
});

// ---------------- install ----------------
test('결정 1·5: install — 이름·SHA-1·SHA-256·만료(UTC)·실행할 certutil 명령을 보이고, yes 입력 뒤 검사한 DER 하나만 등록하고 저장소를 다시 읽어 "등록됨"', async () => {
  const { dir, ca, der } = await newCA();
  const store = fakeStore();
  const input = tty(['  yes\r']);
  const r = await run('install', { caDir: dir, store, input });
  assert.equal(r.code, 0, r.out);
  assert.equal(store.adds.length, 1);
  assert.ok(store.adds[0].equals(der), '검사한 인증서의 DER 그대로');
  assert.ok(r.out.includes(sha1(der)), 'SHA-1(대문자)');
  assert.ok(r.out.includes(crypto.createHash('sha256').update(der).digest('hex').toUpperCase()), 'SHA-256');
  assert.match(r.out, /UTC/);
  assert.ok(r.out.includes(new X509Certificate(ca.certPem).subject.match(/CN=(.*)/)![1]), '이름');
  assert.ok(r.out.includes('-user -addstore Root'), '실행할 명령');
  assert.ok(r.out.includes(TOOLS.certutil) && TOOLS.certutil.length > 0, 'certutil 절대 경로');
  assert.match(r.out, /등록됨/);
  assert.equal(input.reads, 1);
});

test('C2: install — 대화형 터미널이 아니면(파이프 입력) 거부하고, CA를 만들지도 묻지도 않는다', async () => {
  const dir = path.join(tmp(), 'ca');
  const store = fakeStore();
  const input = tty(['yes'], false);
  const r = await run('install', { caDir: dir, store, input });
  assert.notEqual(r.code, 0);
  assert.equal(store.adds.length, 0);
  assert.equal(input.reads, 0, '입력을 읽지 않는다');
  assert.equal(fs.existsSync(dir), false, 'CA를 만들지 않는다');
  assert.match(r.out, /터미널/);
});

test('C1: install — 앞뒤 공백·CR을 버린 정확한 yes가 아니면 취소(YES, y, 예, 전각, yes yes, 빈 줄, EOF)', async () => {
  const { dir } = await newCA();
  for (const a of ['YES', 'y', '예', 'ｙｅｓ', 'yes yes', '', null]) {
    const store = fakeStore();
    const r = await run('install', { caDir: dir, store, input: tty([a]) });
    assert.notEqual(r.code, 0, `입력 ${JSON.stringify(a)}`);
    assert.equal(store.adds.length, 0, `입력 ${JSON.stringify(a)}: 등록하지 않는다`);
    assert.match(r.out, /취소/, `입력 ${JSON.stringify(a)}`);
  }
});

test('A10(결정 7): install·uninstall — 관리자(승격) 터미널이면 거부하고 묻지 않는다. status는 허용', async () => {
  const { dir } = await newCA();
  for (const cmd of ['install', 'uninstall'] as const) {
    const store = fakeStore({ elevated: true });
    const input = tty(['yes', 'yes']);
    const r = await run(cmd, { caDir: dir, store, input });
    assert.notEqual(r.code, 0, cmd);
    assert.equal(store.adds.length + store.removes.length, 0, cmd);
    assert.equal(input.reads, 0, `${cmd}: 묻지 않는다`);
    assert.match(r.out, /관리자/, cmd);
  }
  assert.equal((await run('status', { caDir: dir, store: fakeStore({ elevated: true }) })).code, 0);
});

test('A1·A2: install — ca-cert.pem에 인증서가 2개이거나 앞뒤에 다른 글자(ESC 포함)가 있으면 등록을 거부한다', async () => {
  for (const tamper of ['twoCerts', 'junk'] as const) {
    const { dir, ca } = await newCA();
    const other = await loadOrCreateCA(path.join(tmp(), 'other'));
    const file = path.join(dir, 'ca-cert.pem');
    fs.writeFileSync(file, tamper === 'twoCerts' ? ca.certPem + other.certPem : `\x1b[2Knote\n${ca.certPem}`);
    const store = fakeStore();
    const r = await run('install', { caDir: dir, store, input: tty(['yes']) });
    assert.notEqual(r.code, 0, tamper);
    assert.equal(store.adds.length, 0, `${tamper}: 등록하지 않는다`);
    // 긍정 전제(O30): 아무것도 안 하는 구현도 "등록하지 않음"은 통과하므로, 거부 이유를 보였는지 함께 본다
    assert.match(r.out, /ca-cert\.pem/, `${tamper}: 어느 파일이 문제인지`);
    assert.match(r.out, /인증서 하나/, `${tamper}: 거부 이유`);
  }
});

test('A7(결정 5⑦): install — CA 폴더 검사(링크·다른 사용자 쓰기)가 실패하면 등록을 거부하고 이유를 보인다', async () => {
  const { dir } = await newCA();
  const store = fakeStore();
  const r = await run('install', { caDir: dir, store, input: tty(['yes']), checkDir: async () => '다른 사용자가 쓸 수 있는 폴더' });
  assert.notEqual(r.code, 0);
  assert.equal(store.adds.length, 0);
  assert.match(r.out, /다른 사용자가 쓸 수 있는 폴더/);
});

test('D5: install — 이미 사용자 Root에 같은 지문이 있으면 "이미 등록됨"이고 certutil을 부르지 않는다', async () => {
  const { dir, der } = await newCA();
  const store = fakeStore({ user: [entry(der)] });
  const input = tty(['yes']);
  const r = await run('install', { caDir: dir, store, input });
  assert.equal(r.code, 0);
  assert.equal(store.adds.length, 0);
  assert.equal(input.reads, 0);
  assert.match(r.out, /이미 등록/);
});

test('D3·D4: install — 종료 코드가 0이어도 저장소에 없으면 실패, Windows 창에서 "아니요"(종료 코드 ≠ 0)면 "등록되지 않았습니다"', async () => {
  const { dir } = await newCA();
  const a = await run('install', { caDir: dir, store: fakeStore({ addPuts: false, addCode: 0 }), input: tty(['yes']) });
  assert.notEqual(a.code, 0, '재조회로 판정');
  assert.doesNotMatch(a.out, /등록됨/);
  const b = await run('install', { caDir: dir, store: fakeStore({ addPuts: false, addCode: 2147943623 }), input: tty(['yes']) });
  assert.notEqual(b.code, 0);
  assert.match(b.out, /등록되지 않았습니다/);
});

test('D8: install — 등록 명령이 시간 초과 등으로 끝나지 않으면 "결과를 모릅니다"와 status 안내', async () => {
  const { dir } = await newCA();
  const r = await run('install', { caDir: dir, store: fakeStore({ addThrows: true }), input: tty(['yes']) });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /결과를 모릅니다/);
  assert.match(r.out, /status/);
});

test('A6·결정 8: install — CA가 없으면 새로 만들고 확인 화면에 "새로 만든"을 따로 보인다. status·uninstall은 CA를 만들지 않는다', async () => {
  const dir = path.join(tmp(), 'ca');
  for (const cmd of ['status', 'uninstall'] as const) {
    await run(cmd, { caDir: dir, store: fakeStore(), input: tty(['yes']) });
    assert.equal(fs.existsSync(dir), false, `${cmd}가 CA를 만들지 않는다`);
  }
  const store = fakeStore();
  const r = await run('install', { caDir: dir, store, input: tty(['yes']) });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(dir, 'ca-cert.pem')), 'install은 만든다');
  assert.match(r.out, /새로 만든/);
});

// ---------------- uninstall ----------------
test('B1·B2: uninstall — 현재 CA를 40자리 소문자 SHA-1로만 지우고, 지운 뒤 저장소를 다시 읽어 확인한다', async () => {
  const { dir, der } = await newCA();
  const store = fakeStore({ user: [entry(der)] });
  const r = await run('uninstall', { caDir: dir, store, input: tty(['yes']) });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(store.removes, [sha1(der).toLowerCase()]);
  assert.match(store.removes[0], /^[0-9a-f]{40}$/);
  assert.match(r.out, /해제/);
  assert.match(r.out, /브라우저/, '브라우저를 다시 시작하라는 안내(F5)');
});

test('B5·F1·F2: uninstall — 옛 sumun CA(이름 형식 + 인증서 모양)는 하나씩 묻고 지운다. 이름만 같은 다른 인증서는 후보가 아니다', async () => {
  const { dir, der } = await newCA();
  const old = derOf((await loadOrCreateCA(path.join(tmp(), 'old'))).certPem);
  const fakeName = forgeCert({ cn: 'sumun local CA 2026-01-01', ca: true }); // pathLen·EKU 없음 → 모양이 다르다
  const store = fakeStore({ user: [entry(der), entry(old), entry(fakeName)] });
  const input = tty(['yes', 'yes']);
  const r = await run('uninstall', { caDir: dir, store, input });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(new Set(store.removes), new Set([sha1(der).toLowerCase(), sha1(old).toLowerCase()]));
  assert.ok(!store.removes.includes(sha1(fakeName).toLowerCase()), '이름만 같은 인증서는 지우지 않는다');
  assert.equal(input.reads, 2, '현재 CA와 옛 CA를 따로 묻는다');
  assert.ok(r.out.includes(sha1(old)), '옛 CA의 지문을 보인다');
});

test('B3: uninstall — 지울 지문이 사용자 Root의 다른 인증서 일련번호와 같으면(certutil이 그것도 고를 수 있음) 지우지 않는다', async () => {
  const { dir, der } = await newCA();
  const clash = forgeCert({ cn: 'other', serialHex: sha1(der).toLowerCase() });
  // 긍정 전제(O30): 만든 인증서의 일련번호가 정말 현재 CA 지문과 같아야 "겹침"을 시험한다
  assert.equal(new X509Certificate(clash).serialNumber.toLowerCase(), sha1(der).toLowerCase(), '일련번호 = 현재 CA 지문');
  const store = fakeStore({ user: [entry(der), entry(clash)] });
  const r = await run('uninstall', { caDir: dir, store, input: tty(['yes']) });
  assert.notEqual(r.code, 0);
  assert.equal(store.removes.length, 0);
  assert.match(r.out, /겹/);
});

test('B4·B7: uninstall·status — 컴퓨터 Root에 있는 sumun CA는 따로 보이고 "이 명령으로 지울 수 없음", 지우지 않는다', async () => {
  const { dir, der } = await newCA();
  const store = fakeStore({ user: [], machine: [sha1(der)] });
  const u = await run('uninstall', { caDir: dir, store, input: tty(['yes']) });
  assert.equal(store.removes.length, 0);
  assert.match(u.out, /컴퓨터/);
  assert.match(u.out, /지울 수 없/);
  const s = await run('status', { caDir: dir, store });
  assert.match(s.out, /컴퓨터/);
});

// ---------------- status ----------------
test('F1·B6·E1: status — 현재 CA 등록 여부, 옛 sumun CA, 이름이 비슷한 인증서를 보이고, 인증서 이름의 제어 문자·글자 방향 문자는 이스케이프한다', async () => {
  const { dir, der } = await newCA();
  const old = derOf((await loadOrCreateCA(path.join(tmp(), 'old'))).certPem);
  const look = forgeCert({ cn: 'ѕumun local CA 2026-11-08' }); // 키릴 ѕ
  const evil = forgeCert({ cn: 'x\x1b[2K\u202Eevil' });
  // 긍정 전제(O30): 만든 인증서의 이름에 그 글자들이 실제로 들어 있어야 이 테스트가 사례를 시험한다
  assert.ok(new X509Certificate(look).subject.includes('\u0455umun'), '키릴 ѕ(U+0455)가 인증서 이름에 들어 있음');
  const evilSubject = String(new X509Certificate(evil).toLegacyObject().subject.CN); // subject 문자열은 ESC를 \1B로 바꿔 보여 주므로 원래 값을 본다
  assert.ok(evilSubject.includes('\u202E') && evilSubject.includes('\x1b'), 'U+202E·ESC가 인증서 이름에 들어 있음');
  const store = fakeStore({ user: [entry(old), entry(look), entry(evil)] });
  const r = await run('status', { caDir: dir, store });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /등록 안 됨/, '현재 CA는 등록되지 않음');
  assert.ok(r.out.includes(sha1(der)), '현재 CA 지문');
  assert.ok(r.out.includes(sha1(old)), '옛 sumun CA');
  assert.match(r.out, /비슷한/, '이름이 비슷한 인증서 경고');
  assert.ok(r.out.includes(sha1(look)));
  assert.ok(!r.out.includes('\x1b') && !r.out.includes('\u202E'), '제어 문자·방향 문자를 그대로 내보내지 않는다');
});

test('G3·G7·G8: status — curl의 --ssl-no-revoke, Firefox·다른 Windows 프로그램도 믿는다는 안내', async () => {
  const { dir } = await newCA();
  const r = await run('status', { caDir: dir, store: fakeStore() });
  assert.match(r.out, /--ssl-no-revoke/);
  assert.match(r.out, /Firefox/);
  assert.match(r.out, /Windows/);
});

// ---------------- winstore ----------------
const BLOB = (der: Buffer) => {
  const head = Buffer.alloc(12);
  head.writeUInt32LE(32, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(der.length, 8);
  const other = Buffer.from('0300000001000000040000000a0b0c0d', 'hex'); // 다른 속성 하나를 앞에
  return Buffer.concat([other, head, der]).toString('hex').toUpperCase();
};
const REG = (items: [string, Buffer][]) =>
  items.map(([k, der]) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates\\${k}\r\n    Blob    REG_BINARY    ${BLOB(der)}\r\n`).join('') + '\r\n검색 완료: 1개 일치\r\n';

test('E121 방식: blobToDer는 속성 32를 꺼내고, parseRegCerts는 꺼낸 DER의 SHA-1이 키 이름과 같은 항목만 돌려준다', async () => {
  const { der } = await newCA();
  const other = forgeCert({ cn: 'x' });
  assert.ok(blobToDer(BLOB(der))?.equals(der));
  const list = parseRegCerts(REG([[sha1(der), der], ['0'.repeat(40), other]]));
  assert.deepEqual(list.map((c) => c.sha1), [sha1(der)], '키 이름과 다른 항목은 버린다');
  assert.deepEqual(parseRegCerts(''), []);
});

test('A9·A11·D1·D2·A3: makeWinStore — 절대 경로 도구, add는 새 임시 파일에 DER을 써서 정확히 ["-user","-addstore","Root",파일]로 실행하고 지운다', async () => {
  const { der } = await newCA();
  const calls: { exe: string; args: string[]; file?: Buffer }[] = [];
  const fake: Run = async (exe, args) => {
    const call = { exe, args, file: args[3] && fs.existsSync(args[3]) ? fs.readFileSync(args[3]) : undefined };
    calls.push(call);
    return { code: 0, stdout: '' };
  };
  const s = makeWinStore(fake);
  await s.add(der);
  const add = calls.find((c) => c.args.includes('-addstore'));
  assert.ok(add, 'certutil -addstore 호출');
  assert.equal(add.exe, 'C:\\Windows\\System32\\certutil.exe');
  assert.deepEqual(add.args.slice(0, 3), ['-user', '-addstore', 'Root']);
  assert.equal(add.args.length, 4, '-f 같은 다른 인자 없음');
  assert.ok(add.file?.equals(der), '실행 순간 임시 파일 내용 = 검사한 DER');
  assert.equal(fs.existsSync(add.args[3]), false, '등록 뒤 임시 파일을 지운다');
  for (const t of Object.values(TOOLS)) assert.match(t, /^C:\\Windows\\System32\\/i, `절대 경로: ${t}`);
});

test('B1·B2: makeWinStore.remove — 40자리 hex가 아니면(콜론, 이름, 빈 문자열, 숫자 0) certutil을 부르지 않는다. 맞으면 소문자 지문 하나로 -delstore', async () => {
  const calls: string[][] = [];
  const s = makeWinStore(async (_e, a) => (calls.push(a), { code: 0, stdout: '' }));
  for (const bad of ['A8:10:4D', 'sumun local CA 2026-11-08', '', '0', '1.3.6.1.5.5.7.3.1', 'a'.repeat(39)]) {
    await assert.rejects(s.remove(bad), `거부: ${bad}`);
  }
  assert.equal(calls.length, 0);
  await s.remove('AB'.repeat(20));
  assert.deepEqual(calls, [['-user', '-delstore', 'Root', 'ab'.repeat(20)]]);
});

test('E124 방식: makeWinStore.elevated — whoami /groups에 S-1-16-12288(높음) 이상이면 승격, S-1-16-8192(중간)면 아님. userRoot는 HKCU 키를 reg.exe로 읽는다', async () => {
  const mk = (sid: string) => makeWinStore(async (exe) => ({ code: 0, stdout: exe.endsWith('whoami.exe') ? `"Mandatory Label\\X","레이블","${sid}",""\r\n` : '' }));
  assert.equal(await mk('S-1-16-8192').elevated(), false);
  assert.equal(await mk('S-1-16-12288').elevated(), true);
  assert.equal(await mk('S-1-16-16384').elevated(), true);
  const calls: { exe: string; args: string[] }[] = [];
  await makeWinStore(async (exe, args) => (calls.push({ exe, args }), { code: 1, stdout: '' })).userRoot();
  const reg = calls.find((c) => c.exe.toLowerCase().endsWith('reg.exe'));
  assert.ok(reg, 'reg.exe 호출');
  assert.ok(reg.args.some((a) => /^HKCU\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates$/i.test(a)), JSON.stringify(reg.args));
});

test('A7: checkCADir — 실제 경로가 다르면(정션) 거부, 본인·SYSTEM·Administrators 밖의 허용 항목(Users)이 있으면 거부, 그 셋뿐이면 통과', async () => {
  const me = 'S-1-5-21-1-2-3-1001';
  const io = (real: string, aces: { type: string; sid: string }[]) => ({ realpath: () => real, dacl: async () => ({ protected: false, aces }), mySid: async () => me });
  const dir = 'C:\\Users\\u\\AppData\\Local\\sumun\\ca';
  const okAces = [{ type: 'A', sid: me }, { type: 'A', sid: 'S-1-5-18' }, { type: 'A', sid: 'S-1-5-32-544' }];
  assert.equal(await checkCADir(dir, io(dir, okAces)), null);
  assert.equal(typeof (await checkCADir(dir, io('C:\\Users\\Public\\x', okAces))), 'string', '정션');
  assert.equal(typeof (await checkCADir(dir, io(dir, [...okAces, { type: 'A', sid: 'S-1-5-32-545' }]))), 'string', 'Users 쓰기');
});
