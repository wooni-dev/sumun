// [TLS-3] 새 동작: 사이트별 인증서 즉석 발급. 사례 번호는 docs/ai/tls3-cases.md.
//   issueCert(ca, hosts) → { certPem, keyPem }   거부: CAError code CA_BAD_HOST(hosts) / CA_BAD_ISSUER(루트 CA를 쓸 수 없음)
//   사용자 결정(2026-11-08): 유효 30일(루트 만료로 자름), 호출마다 새 키, 와일드카드 금지
// 루트 CA는 임시 폴더에 만든다(loadOrCreateCA, TLS-2). 만료 시험용 루트는 이 파일에서 forge로 직접 만든다. Windows 저장소는 건드리지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const { pki, asn1 } = forge;
const DAY = 86_400_000;
const HOUR = 3_600_000;
type Pair = { certPem: string; keyPem: string };

const temps: string[] = [];
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
let root: Pair;
before(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3-'));
  temps.push(d);
  root = await loadOrCreateCA(path.join(d, 'ca'));
});

// 정책대로 만든 루트(유효 기간만 바꿈) — 만료 사례용
function makeRoot(notBefore: Date, notAfter: Date): Pair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const c = pki.createCertificate();
  c.publicKey = pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  c.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
  c.validity.notBefore = notBefore;
  c.validity.notAfter = notAfter;
  const name = [{ name: 'commonName', value: 'fixture root' }];
  c.setSubject(name);
  c.setIssuer(name);
  c.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  c.sign(pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  return { certPem: pki.certificateToPem(c), keyPem };
}

async function issue(hosts: string[], ca: Pair = root) {
  const l = await issueCert(ca, hosts);
  assert.equal(typeof l?.certPem, 'string', `발급 결과 certPem (${hosts})`);
  assert.equal(typeof l?.keyPem, 'string', '발급 결과 keyPem');
  return l;
}
async function rejectsCode(p: Promise<unknown>, code: string, label = '') {
  await assert.rejects(p, (e: any) => (assert.equal(e?.name, 'CAError', `${label} ${e?.name}: ${e?.message}`), assert.equal(e.code, code, label), true));
}
const ext = (pem: string, name: string): any => (pki.certificateFromPem(pem).extensions as any[]).find((e) => e.name === name);
const nameDer = (n: any) => Buffer.from(asn1.toDer(pki.distinguishedNameToAsn1(n)).getBytes(), 'binary').toString('hex');
const sanOf = (pem: string) => new crypto.X509Certificate(pem).subjectAltName ?? '';
// AKI 확장의 keyIdentifier([0])를 DER에서 직접 꺼낸다(forge가 AKI를 풀어 주지 않아서)
function akiHex(pem: string) {
  const e = ext(pem, 'authorityKeyIdentifier');
  if (!e) return undefined;
  const seq = asn1.fromDer(e.value);
  const kid = (seq.value as any[]).find((v) => v.tagClass === asn1.Class.CONTEXT_SPECIFIC && v.type === 0);
  return kid ? forge.util.bytesToHex(kid.value) : undefined;
}
function lagMeter() {
  let max = 0;
  let last = performance.now();
  const t = setInterval(() => {
    const n = performance.now();
    max = Math.max(max, n - last - 5);
    last = n;
  }, 5);
  return async () => (await new Promise((r) => setTimeout(r, 20)), clearInterval(t), max);
}
async function handshake(l: Pair, servername: string, chain = l.certPem) {
  const srv = tls.createServer({ cert: chain, key: l.keyPem }, (s) => s.end('ok'));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  try {
    return await new Promise<string>((resolve) => {
      const s = tls.connect({ port: (srv.address() as any).port, host: '127.0.0.1', ca: root.certPem, servername }, () => (resolve(s.authorized ? 'ok' : `unauthorized ${s.authorizationError}`), s.destroy()));
      s.on('error', (e: any) => resolve(e.code ?? e.message));
    });
  } finally {
    srv.close();
  }
}

// ---------------- A. 말단 필드 ----------------
test('A1·A2·A3: cA=FALSE(critical), keyUsage = digitalSignature·keyEncipherment(critical), EKU = serverAuth만', async () => {
  const l = await issue(['example.com']);
  const bc = ext(l.certPem, 'basicConstraints');
  assert.deepEqual([bc?.cA, bc?.critical], [false, true]);
  const ku = ext(l.certPem, 'keyUsage');
  const on = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign'].filter((k) => ku?.[k]);
  assert.deepEqual([on, ku?.critical], [['digitalSignature', 'keyEncipherment'], true]);
  assert.deepEqual(new crypto.X509Certificate(l.certPem).keyUsage, ['1.3.6.1.5.5.7.3.1']);
  assert.equal(new crypto.X509Certificate(l.certPem).ca, false);
  assert.equal(pki.certificateFromPem(l.certPem).version, 2, 'v3');
});

test('A4·A5: SAN이 반드시 있고, 이름은 DNS·IP는 iPAddress(IPv4·IPv6) — dNSName에 IP 글자를 넣지 않는다', async () => {
  const l = await issue(['localhost', '127.0.0.1', '::1']);
  assert.equal(sanOf(l.certPem), 'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1');
  const x = new crypto.X509Certificate(l.certPem);
  assert.equal(x.checkIP('127.0.0.1'), '127.0.0.1');
  assert.equal(x.checkIP('::1'), '::1');
  assert.equal(x.checkHost('localhost'), 'localhost');
  assert.equal(sanOf(l.certPem).includes('DNS:127'), false);
});

test('A6·A7·A13: AKI = 루트 SKI, 말단 SKI 있음, issuer DN = 루트 subject DN(바이트), subject ≠ 루트 subject', async () => {
  const l = await issue(['example.com']);
  const rootSki = ext(root.certPem, 'subjectKeyIdentifier')?.subjectKeyIdentifier;
  assert.ok(rootSki, '전제: 루트에 SKI가 있다');
  assert.equal(akiHex(l.certPem), rootSki);
  assert.ok(ext(l.certPem, 'subjectKeyIdentifier'), '말단 SKI');
  const c = pki.certificateFromPem(l.certPem);
  const r = pki.certificateFromPem(root.certPem);
  assert.equal(nameDer(c.issuer), nameDer(r.subject));
  assert.notEqual(nameDer(c.subject), nameDer(r.subject));
  assert.equal(new crypto.X509Certificate(l.certPem).checkIssued(new crypto.X509Certificate(root.certPem)), true);
});

test('A8·A12·D42: SHA-256 서명(루트로 검증), 말단 키 RSA 2048·e=65537·TLS에 쓸 수 있음, 루트와 다른 키, 결과에 루트 키 없음', async () => {
  const l = await issue(['example.com']);
  assert.equal(pki.certificateFromPem(l.certPem).signatureOid, '1.2.840.113549.1.1.11');
  const x = new crypto.X509Certificate(l.certPem);
  const rx = new crypto.X509Certificate(root.certPem);
  assert.equal(x.verify(rx.publicKey), true);
  assert.equal(x.publicKey.asymmetricKeyDetails?.modulusLength, 2048);
  assert.equal(x.publicKey.asymmetricKeyDetails?.publicExponent, 65537n);
  assert.equal(x.checkPrivateKey(crypto.createPrivateKey(l.keyPem)), true);
  assert.doesNotThrow(() => tls.createSecureContext({ cert: l.certPem, key: l.keyPem }));
  assert.notEqual(x.publicKey.export({ type: 'spki', format: 'pem' }), rx.publicKey.export({ type: 'spki', format: 'pem' }));
  const rootBody = root.keyPem.split('\n')[3];
  assert.ok(root.keyPem.includes(rootBody), '전제: 검사할 루트 키 본문 줄');
  assert.equal(JSON.stringify(l).includes(rootBody), false);
});

test('A9·A10·E46·D43: 서로 다른 호스트 40개를 동시에 — 모두 성공, 일련번호 모두 다르고 양수·64~160비트·첫 바이트 < 0x80, 키도 모두 다름', async () => {
  const all = await Promise.all(Array.from({ length: 40 }, (_, i) => issue([`h${i}.example.com`])));
  const serials = all.map((l) => new crypto.X509Certificate(l.certPem).serialNumber);
  for (const s of serials) {
    assert.equal(s.startsWith('-'), false, s);
    assert.ok(s.length >= 16 && s.length <= 40, s);
    assert.ok(parseInt(s.slice(0, 2), 16) < 0x80, s);
  }
  assert.equal(new Set(serials).size, 40);
  assert.equal(new Set(all.map((l) => l.keyPem)).size, 40, '호출마다 새 키(사용자 결정 3)');
  const again = await issue(['h0.example.com']);
  assert.notEqual(again.keyPem, all[0].keyPem, '같은 호스트를 다시 발급해도 새 키');
});

test('A11·A14: notBefore = 1시간 전, notAfter = 30일 뒤(각 ±5분), CN = 첫 호스트', async () => {
  const t = Date.now();
  const l = await issue(['example.com', 'www.example.com']);
  const x = new crypto.X509Certificate(l.certPem);
  assert.ok(Math.abs(Date.parse(x.validFrom) - (t - HOUR)) < 300_000, x.validFrom);
  assert.ok(Math.abs(Date.parse(x.validTo) - (t + 30 * DAY)) < 300_000, x.validTo);
  assert.equal(pki.certificateFromPem(l.certPem).subject.getField('CN')?.value, 'example.com');
});

// ---------------- B. hosts ----------------
test('B14·B15·B16·B17·B19·B21·B22·B23·B24·B25·B26·B27·B28·B31·B32: 잘못된 hosts는 CA_BAD_HOST', async () => {
  const bad: unknown[] = [
    [], 'example.com', undefined, [123], [null], [''],
    ['*.example.com'], ['*'], ['*.com'], ['f*o.example.com'], ['a.*.com'], ['*.*.com'],
    ['bücher.de'], ['例え.jp'],
    ['::FFFF:127.0.0.1'], ['[::ffff:7f00:1]'],
    ['127.1'], ['2130706433'], ['0x7f.0.0.1'], ['0177.0.0.1'], ['256.0.0.1'], ['127.0.0.01'],
    ['example.com\0.evil.com'], [' example.com'], ['example.com '], ['a b.com'], ['a\nb.com'], ['a\tb.com'],
    ['a.com, DNS:evil.com'], ['a/b.com'], ['CN=x'], ['a=b.com'], ['a+b.com'], ['a;b.com'],
    ['example.com:443'], ['[::1]:443'],
    [`${'a'.repeat(64)}.com`], [`${'a.'.repeat(126)}ab.com`], ['a..b.com'], ['.a.com'], ['-a.com'], ['a-.com'], ['a.com..'],
    Array.from({ length: 51 }, (_, i) => `h${i}.example.com`),
    ['myhost'], ['com'],
  ];
  for (const h of bad) await rejectsCode(issueCert(root, h as string[]), 'CA_BAD_HOST', JSON.stringify(h)?.slice(0, 60));
});

test('B18·B20·B21·B29·B30·B32·B27: 받는 이름과 정규화 — 소문자·끝점 제거·중복 1개, punycode, 밑줄, localhost, IPv6 표기, 63자 레이블·253자, 50개', async () => {
  assert.equal(sanOf((await issue(['Example.COM.', 'example.com', 'EXAMPLE.com'])).certPem), 'DNS:example.com');
  assert.equal(sanOf((await issue(['xn--bcher-kva.de'])).certPem), 'DNS:xn--bcher-kva.de');
  assert.equal(sanOf((await issue(['_dmarc.example.com'])).certPem), 'DNS:_dmarc.example.com');
  assert.equal(sanOf((await issue(['LocalHost'])).certPem), 'DNS:localhost');
  assert.equal(sanOf((await issue(['[::1]', '0:0:0:0:0:0:0:1'])).certPem), 'IP Address:0:0:0:0:0:0:0:1');
  const label63 = 'a'.repeat(63);
  const name253 = `${label63}.${label63}.${label63}.${'b'.repeat(61)}`;
  assert.equal(name253.length, 253, '전제: 253자');
  const long = await issue([name253]);
  assert.equal(sanOf(long.certPem), `DNS:${name253}`);
  assert.equal(pki.certificateFromPem(long.certPem).subject.getField('CN'), null, '64자 넘는 이름은 CN에 넣지 않는다(결정 7)');
  const fifty = Array.from({ length: 50 }, (_, i) => `h${i}.example.com`);
  assert.equal(sanOf((await issue(fifty)).certPem).split(', ').length, 50);
});

test('B34: hosts 배열과 ca 객체를 바꾸지 않는다(얼려 둔 입력으로도 동작)', async () => {
  const hosts = Object.freeze(['Example.COM.', 'www.example.com']) as unknown as string[];
  const ca = Object.freeze({ ...root });
  await issue(hosts, ca);
  assert.deepEqual([...hosts], ['Example.COM.', 'www.example.com']);
  assert.deepEqual(ca, root);
});

// ---------------- C. CA 입력·체인 ----------------
test('C35: 실제 TLS 핸드셰이크 — 루트만 믿는 클라이언트가 DNS·IP 이름으로 성공하고, 다른 이름이면 실패', async () => {
  const l = await issue(['localhost', '127.0.0.1']);
  assert.equal(await handshake(l, 'localhost'), 'ok');
  assert.equal(await handshake(l, 'other.test'), 'ERR_TLS_CERT_ALTNAME_INVALID');
  const ip = await issue(['127.0.0.1']);
  const viaIp = await new Promise<string>(async (resolve) => {
    const srv = tls.createServer({ cert: ip.certPem, key: ip.keyPem }, (s) => s.end());
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const s = tls.connect({ port: (srv.address() as any).port, host: '127.0.0.1', ca: root.certPem }, () => (resolve(s.authorized ? 'ok' : 'no'), s.destroy(), srv.close()));
    s.on('error', (e: any) => (resolve(e.code), srv.close()));
  });
  assert.equal(viaIp, 'ok', 'IP로 접속(servername 없음)해도 iPAddress SAN으로 맞는다');
});

test('C36: 말단 키로 서명한 손자 인증서는 루트만 믿는 클라이언트가 거부한다(cA=FALSE·pathLen 0)', async () => {
  const l = await issue(['example.com']);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const g = pki.createCertificate();
  g.publicKey = pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  g.serialNumber = '01';
  g.validity.notBefore = new Date(Date.now() - HOUR);
  g.validity.notAfter = new Date(Date.now() + DAY);
  g.setSubject([{ name: 'commonName', value: 'localhost' }]);
  g.setIssuer(pki.certificateFromPem(l.certPem).subject.attributes);
  g.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]);
  g.sign(pki.privateKeyFromPem(l.keyPem), forge.md.sha256.create());
  const gPair = { certPem: pki.certificateToPem(g), keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
  const r = await handshake(gPair, 'localhost', gPair.certPem + l.certPem);
  assert.notEqual(r, 'ok', `손자 인증서는 믿으면 안 됨: ${r}`);
  assert.equal(await handshake(await issue(['localhost']), 'localhost'), 'ok', '전제: 같은 방식으로 정상 말단은 통과');
});

test('C37·C38: 루트 만료가 10일 남으면 말단 만료를 루트에 맞춰 자르고, 1일 미만·만료·시작 전이면 CA_BAD_ISSUER', async () => {
  const near = makeRoot(new Date(Date.now() - DAY), new Date(Date.now() + 10 * DAY));
  const l = await issue(['example.com'], near);
  assert.equal(new crypto.X509Certificate(l.certPem).validTo, new crypto.X509Certificate(near.certPem).validTo);
  for (const [label, r] of [
    ['12시간 남음', makeRoot(new Date(Date.now() - DAY), new Date(Date.now() + 12 * HOUR))],
    ['만료', makeRoot(new Date(Date.now() - 10 * DAY), new Date(Date.now() - DAY))],
    ['시작 전', makeRoot(new Date(Date.now() + DAY), new Date(Date.now() + 100 * DAY))],
  ] as const) {
    await rejectsCode(issueCert(r, ['example.com']), 'CA_BAD_ISSUER', label);
  }
});

test('C39·C40·C41: 짝이 안 맞는 키, CA가 아닌 인증서(말단을 루트로), 깨진 PEM, 암호화된 키 → CA_BAD_ISSUER, 오류에 PEM·키가 없다', async () => {
  const other = makeRoot(new Date(Date.now() - DAY), new Date(Date.now() + 100 * DAY));
  const leaf = await issue(['example.com']);
  const enc = crypto.createPrivateKey(root.keyPem).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }) as string;
  const cases: [string, Pair][] = [
    ['짝 불일치', { certPem: root.certPem, keyPem: other.keyPem }],
    ['말단을 루트로', leaf],
    ['깨진 인증서', { certPem: root.certPem.slice(0, 200), keyPem: root.keyPem }],
    ['깨진 키', { certPem: root.certPem, keyPem: root.keyPem.slice(0, 200) }],
    ['암호화된 키', { certPem: root.certPem, keyPem: enc }],
  ];
  for (const [label, ca] of cases) {
    let err: any;
    await issueCert(ca, ['example.com']).then(
      () => undefined,
      (e) => (err = e),
    );
    assert.equal(err?.code, 'CA_BAD_ISSUER', label);
    const all = `${err.message}\n${err.stack}`;
    const keyLine = ca.keyPem.split('\n')[2] ?? '';
    assert.ok(keyLine.length > 10 || label.startsWith('깨진 키'), `전제: 검사할 키 줄(${label})`);
    assert.equal(all.includes('PRIVATE KEY') || all.includes('BEGIN CERTIFICATE') || (keyLine.length > 10 && all.includes(keyLine)), false, label);
  }
});

// ---------------- D·E. 디스크·지연 ----------------
test('D44: 발급하는 동안 디스크에 아무것도 쓰지 않는다(fs 쓰기 함수 감시)', async () => {
  const names = ['writeFileSync', 'writeFile', 'openSync', 'createWriteStream', 'appendFileSync'] as const;
  const orig = Object.fromEntries(names.map((n) => [n, (fs as any)[n]]));
  const origP = fs.promises.writeFile;
  let writes = 0;
  for (const n of names) (fs as any)[n] = (...a: unknown[]) => (writes++, orig[n](...a));
  (fs.promises as any).writeFile = (...a: unknown[]) => (writes++, (origP as any)(...a));
  try {
    const probe = path.join(temps[0], 'spy-check.txt');
    fs.writeFileSync(probe, 'x');
    assert.equal(writes, 1, '전제: 감시가 쓰기를 잡는다');
    writes = 0;
    await issue(['example.com']);
    assert.equal(writes, 0);
  } finally {
    for (const n of names) (fs as any)[n] = orig[n];
    (fs.promises as any).writeFile = origP;
  }
});

// [TLS-4에서 고침, 사용자 결정 2026-11-08 "기준선을 빼고 판정"] 원래는 지연 절댓값 ≤ 50ms였다. 전체 테스트를 병렬로 돌리면
// 아무 일 없이도 타이머가 30~40ms 늦어(scripts/probe/tls3-lag.mjs 기준선) 우리 코드와 무관하게 52ms로 실패했다(9d8a528 뒤 전체 실행).
// 같은 테스트 안에서 일 없이 잰 지연(기준선)을 빼고 우리 코드가 더한 몫만 본다. 기준 50ms는 그대로(결정 13)
test('E45: 1회 발급 동안 이벤트 루프 지연(기준선을 뺀 몫) 50ms 이하(결정 13), 20개 동시도 50ms 이하', async () => {
  await issue(['warm.example.com']); // 첫 호출의 JIT·모듈 준비를 빼고 잰다
  let stop = lagMeter();
  await new Promise((r) => setTimeout(r, 300)); // 기준선: 아무 일도 하지 않을 때의 지연
  const base = await stop();
  assert.ok(Number.isFinite(base) && base >= 0, `전제: 기준선을 쟀다(${base})`);
  stop = lagMeter();
  await issue(['one.example.com']);
  const one = await stop();
  stop = lagMeter();
  await Promise.all(Array.from({ length: 20 }, (_, i) => issue([`c${i}.example.com`])));
  const many = await stop();
  assert.ok(one - base <= 50, `1회 ${one.toFixed(0)}ms(기준선 ${base.toFixed(0)}ms)`);
  assert.ok(many - base <= 50, `20개 동시 ${many.toFixed(0)}ms(기준선 ${base.toFixed(0)}ms)`);
});
