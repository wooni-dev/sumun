// [TLS-2] 새 동작: 루트 CA 생성·보관. 사례 번호는 docs/ai/tls2-cases.md.
//   loadOrCreateCA(dir, { now?, onWarning? }) → { certPem, keyPem }   파일: dir/ca-cert.pem, dir/ca-key.pem
//   defaultCADir(env) → %LOCALAPPDATA%\sumun\ca   오류: CAError { code, path }
// 모든 CA는 임시 폴더에 만든다. 실제 %LOCALAPPDATA%\sumun\ca와 Windows 인증서 저장소는 건드리지 않는다(사례 46).
// 깨진 파일 같은 고정 자료는 이 파일 안에서 forge로 직접 만든다(구현을 거치지 않게). 키 PEM은 커밋하지 않는다(사례 47).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import tls from 'node:tls';
import util from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import forge from 'node-forge';
import { loadOrCreateCA, defaultCADir } from '../../src/ca/ca.ts';

const { pki } = forge;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 86_400_000;
const KEY_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' '); // 이 파일 자체가 키 PEM처럼 보이지 않게 나눠 쓴다

// --- 사례 46 준비: 실제 위치의 상태를 이 파일이 시작할 때 찍어 둔다(마지막 테스트에서 비교) ---
function snapshot(dir: string) {
  if (!fs.existsSync(dir)) return 'absent';
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`)
    .join('|');
}
const REAL = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'sumun', 'ca') : '';
const realBefore = REAL ? snapshot(REAL) : 'no-env';

const temps: string[] = [];
function tmp(name = '') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2-'));
  temps.push(d);
  return name ? path.join(d, name) : d;
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const files = (dir: string) => ({ cert: path.join(dir, 'ca-cert.pem'), key: path.join(dir, 'ca-key.pem') });
const state = (p: string) => (fs.existsSync(p) ? `${fs.readFileSync(p, 'latin1')}@${fs.statSync(p).mtimeMs}` : 'absent');

// 고정 자료: 정책대로(또는 일부러 어긋나게) 만든 CA 파일 한 쌍
type Fixture = { cA?: boolean; pathLen?: number | null; sha1?: boolean; bits?: number; notBefore?: Date; notAfter?: Date; eku?: boolean };
function makeCA(o: Fixture = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: o.bits ?? 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const c = pki.createCertificate();
  c.publicKey = pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  c.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
  c.validity.notBefore = o.notBefore ?? new Date(Date.now() - DAY);
  c.validity.notAfter = o.notAfter ?? new Date(Date.now() + 365 * DAY);
  const attrs = [{ name: 'commonName', value: 'fixture CA' }];
  c.setSubject(attrs);
  c.setIssuer(attrs);
  const bc: Record<string, unknown> = { name: 'basicConstraints', cA: o.cA ?? true, critical: true };
  if (o.pathLen !== null) bc.pathLenConstraint = o.pathLen ?? 0;
  const ext: object[] = [bc, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }];
  if (o.eku !== false) ext.push({ name: 'extKeyUsage', serverAuth: true });
  c.setExtensions(ext);
  c.sign(pki.privateKeyFromPem(keyPem), o.sha1 ? forge.md.sha1.create() : forge.md.sha256.create());
  return { certPem: pki.certificateToPem(c), keyPem };
}
function writeCA(dir: string, ca: { certPem: string; keyPem: string }, which: 'both' | 'cert' | 'key' = 'both') {
  fs.mkdirSync(dir, { recursive: true });
  const f = files(dir);
  if (which !== 'key') fs.writeFileSync(f.cert, ca.certPem);
  if (which !== 'cert') fs.writeFileSync(f.key, ca.keyPem);
  return f;
}
// 거절을 기대: CAError, 정해진 code, 파일은 그대로
async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e?.name, 'CAError', `CAError여야 함: ${e?.name} ${e?.message}`);
    assert.equal(e.code, code);
    assert.equal(typeof e.path, 'string');
    return true;
  });
}
async function created(dir: string) {
  const ca = await loadOrCreateCA(dir);
  assert.equal(typeof ca?.certPem, 'string', '새 CA의 certPem');
  assert.equal(typeof ca?.keyPem, 'string', '새 CA의 keyPem');
  return ca;
}
function ext(certPem: string, name: string): any {
  return (pki.certificateFromPem(certPem).extensions as any[]).find((e) => e.name === name);
}

// ---------------- A. 인증서 필드 ----------------
test('A1·A2·A3·A5·A13: basicConstraints cA·pathLen 0·critical, keyUsage는 keyCertSign·cRLSign만(critical), SKI 있음, nameConstraints 없음', async () => {
  const ca = await created(tmp('ca'));
  const bc = ext(ca.certPem, 'basicConstraints');
  assert.deepEqual([bc?.cA, bc?.pathLenConstraint, bc?.critical], [true, 0, true]);
  const ku = ext(ca.certPem, 'keyUsage');
  assert.equal(ku?.critical, true);
  const on = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'].filter((k) => ku?.[k]);
  assert.deepEqual(on, ['keyCertSign', 'cRLSign']);
  assert.ok(ext(ca.certPem, 'subjectKeyIdentifier'), 'SKI');
  assert.ok(ext(ca.certPem, 'basicConstraints'), '전제: forge가 확장을 읽는다');
  const oids = (pki.certificateFromPem(ca.certPem).extensions as any[]).map((e) => e.id);
  assert.equal(oids.includes('2.5.29.30'), false, 'nameConstraints(2.5.29.30) 없음');
});

test('A4: EKU는 serverAuth 하나뿐(사용자 결정 4) — Node와 forge 둘 다', async () => {
  const ca = await created(tmp('ca'));
  assert.deepEqual(new crypto.X509Certificate(ca.certPem).keyUsage, ['1.3.6.1.5.5.7.3.1']);
  const eku = ext(ca.certPem, 'extKeyUsage');
  assert.deepEqual(Object.keys(eku ?? {}).filter((k) => eku[k] === true && k !== 'critical'), ['serverAuth']);
});

test('A6·A7·A48: 일련번호는 양수·64~160비트·첫 바이트 < 0x80이고, CA마다 일련번호·공개키·SKI가 다르다(8개)', async () => {
  const seen = { serial: new Set<string>(), pub: new Set<string>(), ski: new Set<string>() };
  for (let i = 0; i < 8; i++) {
    const ca = await created(tmp('ca'));
    const x = new crypto.X509Certificate(ca.certPem);
    assert.equal(x.serialNumber.startsWith('-'), false, `음수 일련번호: ${x.serialNumber}`);
    assert.ok(x.serialNumber.length >= 16 && x.serialNumber.length <= 40, `길이 ${x.serialNumber.length}`);
    assert.ok(parseInt(x.serialNumber.slice(0, 2), 16) < 0x80, `첫 바이트 ${x.serialNumber.slice(0, 2)}`);
    seen.serial.add(x.serialNumber);
    seen.pub.add(x.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'));
    seen.ski.add(String(ext(ca.certPem, 'subjectKeyIdentifier')?.subjectKeyIdentifier));
  }
  assert.deepEqual([seen.serial.size, seen.pub.size, seen.ski.size], [8, 8, 8]);
});

test('A8·A9: notBefore는 1일 전, notAfter는 지금부터 365일 뒤(각각 ±1시간)', async () => {
  const t = Date.now();
  const ca = await created(tmp('ca'));
  const x = new crypto.X509Certificate(ca.certPem);
  const nb = Date.parse(x.validFrom);
  const na = Date.parse(x.validTo);
  assert.ok(Math.abs(nb - (t - DAY)) < 3_600_000, `notBefore ${x.validFrom}`);
  assert.ok(Math.abs(na - (t + 365 * DAY)) < 3_600_000, `notAfter ${x.validTo}`);
});

test('A10·A11·A12: SHA-256 서명, RSA 2048·e=65537, 자체 서명(subject = issuer, 자기 공개키로 검증)', async () => {
  const ca = await created(tmp('ca'));
  assert.equal(pki.certificateFromPem(ca.certPem).signatureOid, '1.2.840.113549.1.1.11', 'sha256WithRSAEncryption');
  const x = new crypto.X509Certificate(ca.certPem);
  assert.equal(x.publicKey.asymmetricKeyType, 'rsa');
  assert.equal(x.publicKey.asymmetricKeyDetails?.modulusLength, 2048);
  assert.equal(x.publicKey.asymmetricKeyDetails?.publicExponent, 65537n);
  assert.equal(x.subject, x.issuer);
  assert.equal(x.verify(x.publicKey), true);
});

test('A14: v3이고 CN은 "sumun local CA <생성일 YYYY-MM-DD>"', async () => {
  const ca = await created(tmp('ca'));
  const c = pki.certificateFromPem(ca.certPem);
  assert.equal(c.version, 2, 'v3(값 2)');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(c.subject.getField('CN')?.value, `sumun local CA ${today}`);
});

test('A15·A16: Node X509Certificate로 ca·checkPrivateKey, tls.createSecureContext 성공, certutil -dump가 파일을 읽는다(저장소는 안 바꿈)', async () => {
  const dir = tmp('ca');
  const ca = await created(dir);
  const x = new crypto.X509Certificate(ca.certPem);
  assert.equal(x.ca, true);
  assert.equal(x.checkPrivateKey(crypto.createPrivateKey(ca.keyPem)), true);
  assert.doesNotThrow(() => tls.createSecureContext({ cert: ca.certPem, key: ca.keyPem }));
  const r = spawnSync('certutil', ['-dump', files(dir).cert], { encoding: 'latin1' });
  assert.equal(r.status, 0, 'certutil -dump 종료 코드');
  assert.ok(r.stdout.includes('2.5.29.19'), 'certutil이 Basic Constraints(2.5.29.19)를 읽음');
});

// ---------------- B. 파일 보관·불러오기 ----------------
test('B17: 없는 폴더(여러 단계)를 만들고 ca-cert.pem·ca-key.pem을 저장한다. 돌려준 값 = 파일 내용', async () => {
  const dir = path.join(tmp(), 'a', 'b', 'ca');
  const ca = await created(dir);
  const f = files(dir);
  assert.equal(fs.readFileSync(f.cert, 'utf8'), ca.certPem);
  assert.equal(fs.readFileSync(f.key, 'utf8'), ca.keyPem);
  assert.ok(ca.keyPem.includes(KEY_HEADER), 'PKCS#8 키');
});

test('B18: 정상 파일이 있으면 그대로 돌려주고 파일(내용·mtime)을 바꾸지 않는다', async () => {
  const dir = tmp('ca');
  const fx = makeCA();
  const f = writeCA(dir, fx);
  const before = [state(f.cert), state(f.key)];
  const ca = await loadOrCreateCA(dir);
  assert.deepEqual(ca, { certPem: fx.certPem, keyPem: fx.keyPem });
  assert.deepEqual([state(f.cert), state(f.key)], before);
  assert.deepEqual(await loadOrCreateCA(dir), ca, '두 번째도 같음(새 키를 만들지 않음)');
});

test('B19·B20: 인증서만 / 키만 있으면 CA_INCOMPLETE, 있는 파일은 그대로, 없는 파일은 만들지 않는다', async () => {
  for (const which of ['cert', 'key'] as const) {
    const dir = tmp('ca');
    const f = writeCA(dir, makeCA(), which);
    const before = [state(f.cert), state(f.key)];
    assert.ok(before.filter((s) => s !== 'absent').length === 1, '전제: 한쪽만 있다');
    await rejects(loadOrCreateCA(dir), 'CA_INCOMPLETE');
    assert.deepEqual([state(f.cert), state(f.key)], before, which);
  }
});

test('B21·B26: 인증서와 키의 짝이 다르면(다른 RSA 키, EC 키) CA_MISMATCH, 파일 그대로', async () => {
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  for (const keyPem of [makeCA().keyPem, ec]) {
    const dir = tmp('ca');
    const f = writeCA(dir, { certPem: makeCA().certPem, keyPem });
    const before = [state(f.cert), state(f.key)];
    await rejects(loadOrCreateCA(dir), 'CA_MISMATCH');
    assert.deepEqual([state(f.cert), state(f.key)], before);
  }
});

test('B22·B26: 0바이트, 잘린 PEM, 쓰레기, 암호화된 키 → CA_CORRUPT, 파일 그대로', async () => {
  const good = makeCA();
  const enc = crypto.createPrivateKey(good.keyPem).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }) as string;
  const cases: [string, { certPem: string; keyPem: string }][] = [
    ['0바이트 인증서', { certPem: '', keyPem: good.keyPem }],
    ['0바이트 키', { certPem: good.certPem, keyPem: '' }],
    ['잘린 인증서', { certPem: good.certPem.slice(0, 300), keyPem: good.keyPem }],
    ['잘린 키', { certPem: good.certPem, keyPem: good.keyPem.slice(0, 300) }],
    ['쓰레기', { certPem: 'hello', keyPem: 'world' }],
    ['암호화된 키', { certPem: good.certPem, keyPem: enc }],
  ];
  for (const [name, fx] of cases) {
    const dir = tmp('ca');
    const f = writeCA(dir, fx);
    const before = [state(f.cert), state(f.key)];
    await assert.rejects(loadOrCreateCA(dir), (e: any) => (assert.equal(e?.code, 'CA_CORRUPT', name), true));
    assert.deepEqual([state(f.cert), state(f.key)], before, name);
  }
});

test('B23: 만료 30일 전부터 경고 1번(파일 경로·남은 날수), 30일보다 많이 남으면 경고 없음, 만료 뒤에는 CA_EXPIRED. 파일 그대로', async () => {
  const notAfter = new Date(Date.now() + 100 * DAY);
  const dir = tmp('ca');
  const fx = makeCA({ notAfter });
  const f = writeCA(dir, fx);
  const before = [state(f.cert), state(f.key)];

  const warn10: string[] = [];
  const ca = await loadOrCreateCA(dir, { now: new Date(notAfter.getTime() - 10 * DAY), onWarning: (m) => warn10.push(m) });
  assert.equal(ca?.certPem, fx.certPem, '만료 전이면 쓴다');
  assert.equal(warn10.length, 1, '10일 남음 → 경고 1번');
  assert.match(warn10[0], /10일/);
  assert.ok(warn10[0].includes(f.cert), '경고에 파일 경로');
  assert.equal(warn10[0].includes(KEY_HEADER), false);

  const warn40: string[] = [];
  await loadOrCreateCA(dir, { now: new Date(notAfter.getTime() - 40 * DAY), onWarning: (m) => warn40.push(m) });
  assert.equal(warn40.length, 0, '40일 남음 → 경고 없음');

  await rejects(loadOrCreateCA(dir, { now: new Date(notAfter.getTime() + DAY) }), 'CA_EXPIRED');
  assert.deepEqual([state(f.cert), state(f.key)], before, '만료여도 지우거나 다시 만들지 않는다');
});

test('B24: 지금이 notBefore보다 이르면(시계가 뒤로 감) CA_NOT_YET_VALID', async () => {
  const dir = tmp('ca');
  const notBefore = new Date(Date.now() - DAY);
  writeCA(dir, makeCA({ notBefore }));
  await rejects(loadOrCreateCA(dir, { now: new Date(notBefore.getTime() - 2 * DAY) }), 'CA_NOT_YET_VALID');
});

test('B25: 정책과 다른 인증서는 CA_NOT_CA — cA=false, pathLen 없음(다른 도구의 CA), SHA-1, RSA 1024, EKU 없음. 파일 그대로', async () => {
  const cases: [string, Fixture][] = [
    ['cA=false', { cA: false, pathLen: null }],
    ['pathLen 없음', { pathLen: null }],
    ['SHA-1', { sha1: true }],
    ['RSA 1024', { bits: 1024 }],
    ['EKU 없음', { eku: false }],
  ];
  for (const [name, o] of cases) {
    const dir = tmp('ca');
    const f = writeCA(dir, makeCA(o));
    const before = [state(f.cert), state(f.key)];
    await assert.rejects(loadOrCreateCA(dir), (e: any) => (assert.equal(e?.code, 'CA_NOT_CA', name), true));
    assert.deepEqual([state(f.cert), state(f.key)], before, name);
  }
  writeCA(tmp('ca'), makeCA()); // 전제: 고정 자료 만들기 자체는 정상(위 실패가 고정 자료 탓이 아님)
});

test('B26·B27: PKCS#1 키, BOM·CRLF·앞뒤 공백이 있어도 읽는다. 돌려준 PEM에는 BOM이 없고 TLS에 쓸 수 있다. 파일은 다시 쓰지 않는다', async () => {
  const fx = makeCA();
  const pkcs1 = crypto.createPrivateKey(fx.keyPem).export({ type: 'pkcs1', format: 'pem' }) as string;
  const messy = (s: string) => `\uFEFF  \r\n${s.replace(/\n/g, '\r\n')}  \r\n`;
  for (const [name, keyPem] of [['PKCS#1', pkcs1], ['BOM·CRLF', messy(fx.keyPem)]] as const) {
    const dir = tmp('ca');
    const f = writeCA(dir, { certPem: messy(fx.certPem), keyPem });
    const before = [state(f.cert), state(f.key)];
    const ca = await loadOrCreateCA(dir);
    assert.equal(typeof ca?.certPem, 'string', name);
    assert.equal(ca.certPem.includes('\uFEFF') || ca.keyPem.includes('\uFEFF'), false, `${name}: BOM 없음`);
    assert.equal(new crypto.X509Certificate(ca.certPem).fingerprint256, new crypto.X509Certificate(fx.certPem).fingerprint256);
    assert.doesNotThrow(() => tls.createSecureContext({ cert: ca.certPem, key: ca.keyPem }), name);
    assert.deepEqual([state(f.cert), state(f.key)], before, `${name}: 파일 그대로`);
  }
});

test('B32: 상대 경로("ca", ".", "..\\\\x")는 CA_DIR_RELATIVE이고 현재 폴더에 아무것도 만들지 않는다', async () => {
  for (const d of ['ca', '.', '..\\x', 'sub/ca']) {
    await rejects(loadOrCreateCA(d), 'CA_DIR_RELATIVE');
  }
  assert.equal(fs.existsSync(path.join(process.cwd(), 'ca')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'sub')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'ca-key.pem')), false);
});

test('B33·C41: git 저장소 안(이 저장소, 다른 저장소, .git이 파일인 worktree)은 CA_DIR_IN_REPO이고 폴더를 만들지 않는다', async () => {
  const inThis = path.join(REPO, 'tmp-tls2-should-not-exist', 'ca');
  const other = tmp('other');
  fs.mkdirSync(path.join(other, '.git'), { recursive: true });
  const wt = tmp('wt');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: C:/somewhere/.git/worktrees/x\n');
  for (const d of [inThis, path.join(other, 'deep', 'ca'), path.join(wt, 'ca'), REPO]) {
    await rejects(loadOrCreateCA(d), 'CA_DIR_IN_REPO');
  }
  assert.equal(fs.existsSync(path.join(REPO, 'tmp-tls2-should-not-exist')), false);
  assert.equal(fs.existsSync(path.join(other, 'deep')), false);
  assert.equal(fs.existsSync(path.join(REPO, 'ca-key.pem')), false);
  // C41: LOCALAPPDATA가 저장소 안이면 기본 경로도 같은 규칙으로 막힌다
  await rejects(loadOrCreateCA(defaultCADir({ LOCALAPPDATA: path.join(REPO, 'fake-local') })), 'CA_DIR_IN_REPO');
  assert.equal(fs.existsSync(path.join(REPO, 'fake-local')), false);
});

test('B34: 저장소를 가리키는 정션을 거쳐도 실제 경로로 풀어 CA_DIR_IN_REPO', async () => {
  const link = path.join(tmp(), 'junction-to-repo');
  fs.symlinkSync(REPO, link, 'junction');
  assert.ok(fs.existsSync(path.join(link, 'package.json')), '전제: 정션이 저장소를 가리킨다');
  await rejects(loadOrCreateCA(path.join(link, 'tmp-tls2-junction', 'ca')), 'CA_DIR_IN_REPO');
  assert.equal(fs.existsSync(path.join(REPO, 'tmp-tls2-junction')), false);
});

test('B36·B37: 폴더 자리가 파일이면 CA_DIR_NOT_DIR / 한글·공백 경로는 정상', async () => {
  const file = tmp('not-a-dir');
  fs.writeFileSync(file, 'x');
  await rejects(loadOrCreateCA(file), 'CA_DIR_NOT_DIR');
  assert.equal(fs.readFileSync(file, 'utf8'), 'x');
  const ko = path.join(tmp(), '홍 길동', 'AppData Local', 'ca');
  const ca = await created(ko);
  assert.equal(fs.readFileSync(files(ko).cert, 'utf8'), ca.certPem);
});

// ---------------- C. 환경·유출 ----------------
test('C39·C40: defaultCADir — LOCALAPPDATA가 있으면 그 아래 sumun\\ca, 없음·빈 값·상대 경로면 CA_ENV_MISSING(APPDATA로 대신하지 않음)', () => {
  assert.equal(defaultCADir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }), 'C:\\Users\\u\\AppData\\Local\\sumun\\ca');
  for (const env of [{}, { LOCALAPPDATA: '' }, { LOCALAPPDATA: 'relative\\dir' }, { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }]) {
    assert.throws(() => defaultCADir(env), (e: any) => (assert.equal(e?.code, 'CA_ENV_MISSING', JSON.stringify(env)), true));
  }
  assert.equal(fs.existsSync(path.join(process.cwd(), 'undefined')), false);
});

test('C42: 오류(message·stack·util.inspect)에 파일 내용·키가 들어가지 않고 경로만 있다 — 손상, 짝 불일치', async () => {
  const marker = `MARKER-${crypto.randomBytes(8).toString('hex')}`;
  const good = makeCA();
  const dir1 = tmp('ca');
  const f1 = writeCA(dir1, { certPem: good.certPem, keyPem: `${KEY_HEADER}\n${marker}\n-----END PRIVATE KEY-----\n` });
  assert.ok(fs.readFileSync(f1.key, 'utf8').includes(marker), '전제: 파일 안에 표식이 있다');
  const dir2 = tmp('ca');
  const otherKey = makeCA().keyPem;
  writeCA(dir2, { certPem: good.certPem, keyPem: otherKey });
  for (const [dir, code, keyBody] of [[dir1, 'CA_CORRUPT', marker], [dir2, 'CA_MISMATCH', otherKey.split('\n')[5]]] as const) {
    let err: any;
    await loadOrCreateCA(dir).catch((e) => (err = e));
    assert.equal(err?.code, code);
    const all = `${err.message}\n${err.stack}\n${util.inspect(err, { depth: 5 })}`;
    assert.ok(all.includes(marker) === false && all.includes('PRIVATE KEY') === false && all.includes(keyBody) === false, `${code}: 키·내용 없음`);
    assert.ok(all.includes(dir), `${code}: 경로는 있다(전제: 검사한 문자열에 오류 내용이 들어 있다)`);
  }
});

test('C43: 생성·불러오기·오류 동안 stdout·stderr에 키가 나오지 않는다(별도 프로세스로 캡처)', () => {
  const dir = tmp('ca');
  const bad = tmp('bad');
  writeCA(bad, makeCA(), 'key');
  const url = pathToFileURL(path.join(REPO, 'src', 'ca', 'ca.ts')).href;
  const code = `
    const { loadOrCreateCA } = await import(${JSON.stringify(url)});
    const fs = await import('node:fs');
    await loadOrCreateCA(${JSON.stringify(dir)});
    await loadOrCreateCA(${JSON.stringify(dir)});
    await loadOrCreateCA(${JSON.stringify(bad)}).catch(() => {});
    console.log('READY created=' + fs.existsSync(${JSON.stringify(path.join(dir, 'ca-key.pem'))}));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: REPO });
  assert.ok(r.stdout.includes('READY'), `전제: 출력이 캡처된다 (stderr: ${r.stderr.slice(0, 300)})`);
  assert.ok(r.stdout.includes('created=true'), '자식 프로세스가 CA를 만들었다');
  const key = fs.readFileSync(path.join(dir, 'ca-key.pem'), 'utf8');
  for (const out of [r.stdout, r.stderr]) {
    assert.equal(out.includes('PRIVATE KEY'), false);
    assert.equal(out.includes(key.split('\n')[3]), false);
  }
});

test('C49: 새 CA를 만드는 동안 이벤트 루프가 300ms 넘게 막히지 않고 5초 안에 끝난다', async () => {
  let maxLag = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLag = Math.max(maxLag, now - last - 10);
    last = now;
  }, 10);
  const t0 = performance.now();
  try {
    await created(tmp('ca'));
    await new Promise((r) => setTimeout(r, 30)); // 동기 구간의 지연이 타이머에 잡히게
  } finally {
    clearInterval(timer);
  }
  assert.ok(performance.now() - t0 < 5000);
  assert.ok(maxLag < 300, `최대 지연 ${maxLag.toFixed(0)}ms`);
});

test('C46: 이 파일의 테스트는 실제 %LOCALAPPDATA%\\sumun\\ca를 건드리지 않았다(기본 경로 = 그 위치)', () => {
  assert.ok(REAL, '전제: LOCALAPPDATA가 있다');
  assert.equal(defaultCADir(process.env), REAL);
  assert.equal(snapshot(REAL), realBefore, '실제 위치의 파일·mtime이 그대로');
  // 전제: 같은 비교가 바뀐 것을 잡는다
  const probe = tmp('watch');
  fs.mkdirSync(probe);
  const s0 = snapshot(probe);
  fs.writeFileSync(path.join(probe, 'x'), 'y');
  assert.notEqual(snapshot(probe), s0);
});
