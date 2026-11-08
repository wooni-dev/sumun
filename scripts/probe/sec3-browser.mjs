// [SEC-3 실측, O31] 실제 클라이언트: npm start --decrypt를 거쳐 임시 프로필 Chrome(헤드리스)과 Windows curl로 https://example.com/ (E128~E131)
//   node scripts/probe/sec3-browser.mjs registered     — 사용자가 npm run ca -- install로 등록한 뒤: Chrome이 오류 없이 열어야 한다
//   node scripts/probe/sec3-browser.mjs unregistered   — 해제한 뒤: Chrome이 인증서 오류를 내야 한다
//   node scripts/probe/sec3-browser.mjs g6             — [탐색] 등록 상태에서 우리 CA로 서명한 코드 서명 인증서를 certutil -verify(읽기 검증)에 넣어 본다
// 이 스크립트는 저장소를 바꾸지 않는다(등록·해제는 사용자가 직접). 시스템 프록시 설정도 바꾸지 않는다(Chrome에 --proxy-server, 임시 프로필).
// 인터넷이 필요하다(example.com). 실제 루트 CA(%LOCALAPPDATA%\sumun\ca)를 쓴다 — npm start -- --decrypt와 같다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';

const mode = process.argv[2];
if (!['registered', 'unregistered', 'g6'].includes(mode)) throw new Error('사용법: node scripts/probe/sec3-browser.mjs registered | unregistered | g6');
const root = path.resolve(import.meta.dirname, '../..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CURL = 'C:\\Windows\\System32\\curl.exe';
const CERTUTIL = 'C:\\Windows\\System32\\certutil.exe';
const sh = (exe, args, timeout = 60_000) =>
  new Promise((r) => execFile(exe, args, { encoding: 'buffer', timeout, windowsHide: true }, (e, out, err) => r({ code: e ? (typeof e.code === 'number' ? e.code : String(e.code)) : 0, out: Buffer.from(out ?? ''), err: Buffer.from(err ?? '') })));
const cp949 = (b) => new TextDecoder('euc-kr').decode(b);

if (mode === 'g6') {
  // 우리 루트 CA로 서명한 말단 인증서(EKU codeSigning)를 만들고, Windows 체인 검증(certutil -verify, 읽기)이 받아들이는지 본다
  const forge = (await import('node-forge')).default;
  const { loadOrCreateCA, defaultCADir } = await import('../../src/ca/ca.ts');
  const dir = defaultCADir();
  if (!fs.existsSync(path.join(dir, 'ca-cert.pem'))) throw new Error('CA가 없습니다');
  const ca = await loadOrCreateCA(dir);
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const mk = (eku) => {
    const c = forge.pki.createCertificate();
    c.publicKey = keys.publicKey;
    c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
    c.validity.notBefore = new Date(Date.now() - 3600_000);
    c.validity.notAfter = new Date(Date.now() + 86_400_000);
    c.setSubject([{ name: 'commonName', value: `sumun g6 ${Object.keys(eku)[0]}` }]);
    c.setIssuer(caCert.subject.attributes);
    c.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'extKeyUsage', ...eku }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'g6.test' }] }]);
    c.sign(forge.pki.privateKeyFromPem(ca.keyPem), forge.md.sha256.create());
    return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary');
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-g6-'));
  for (const eku of [{ serverAuth: true }, { codeSigning: true }]) {
    const f = path.join(tmp, `${Object.keys(eku)[0]}.cer`);
    fs.writeFileSync(f, mk(eku));
    // 첫 실행은 -user 없이 해서 두 인증서 모두 CERT_E_CHAINING(사용자 Root를 보지 않음)으로 같았다 → 사용자 저장소 기준으로
    // 둘째 실행은 용도를 주지 않아 둘 다 체인만 확인됐다 → 응용 프로그램 정책(용도 OID)을 함께 준다: serverAuth 1.3.6.1.5.5.7.3.1, codeSigning 1.3.6.1.5.5.7.3.3
    const oid = eku.serverAuth ? '1.3.6.1.5.5.7.3.1' : '1.3.6.1.5.5.7.3.3';
    const r = await sh(CERTUTIL, ['-user', '-verify', f, oid], 120_000);
    const text = cp949(r.out);
    const tail = text.split(/\r?\n/).filter((l) => /오류|error|0x8|CERT_E|잘못|유효|verif|확인|완료/i.test(l)).slice(-6).join(' | ');
    console.log(`G6 ${Object.keys(eku)[0]}: certutil -verify 종료 코드 ${r.code} / 관련 줄: ${tail}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

const port = await new Promise((r) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => r(p));
  });
});
console.log(`명령: node src/index.ts --port ${port} --decrypt`);
const proxy = spawn(process.execPath, ['src/index.ts', '--port', String(port), '--decrypt'], { cwd: root });
let summary = '';
proxy.stdout.on('data', (d) => (summary += d));
proxy.stderr.on('data', (d) => (summary += d));
await new Promise((r) => {
  const iv = setInterval(() => summary.includes('프록시를 시작했습니다') && (clearInterval(iv), r()), 50);
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-chrome-'));
const chromeArgs = ['--headless=new', `--user-data-dir=${profile}`, `--proxy-server=http://127.0.0.1:${port}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--dump-dom', 'https://example.com/'];
console.log(`명령: chrome.exe ${chromeArgs.join(' ').replace(profile, '<임시 프로필>')}`);
const ch = await sh(CHROME, chromeArgs, 60_000);
const dom = ch.out.toString('utf8');
const ok = dom.includes('Example Domain');
const certErr = (dom.match(/ERR_CERT_[A-Z_]+/) ?? ch.err.toString('utf8').match(/ERR_CERT_[A-Z_]+|net_error -?\d+/) ?? [''])[0];
console.log(`Chrome: 종료 코드 ${ch.code}, 본문에 "Example Domain" ${ok}, 인증서 오류 표시 ${certErr || '없음'}, DOM ${dom.length}자`);

const curl = async (extra) => {
  const r = await sh(CURL, ['-s', '-o', 'NUL', '-w', '%{http_code}', '-x', `http://127.0.0.1:${port}`, ...extra, 'https://example.com/'], 60_000);
  return `종료 코드 ${r.code}, HTTP ${r.out.toString() || '-'}`;
};
const c1 = await curl([]);
const c2 = await curl(['--ssl-no-revoke']);
console.log(`curl(--cacert 없이): ${c1} / --ssl-no-revoke: ${c2}`);
await new Promise((r) => setTimeout(r, 500));
proxy.kill();
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log('--- 프록시 요약 줄 ---');
console.log(summary.split('\n').filter((l) => / (GET|CONNECT) /.test(l)).join('\n'));
if (mode === 'registered') console.log(`E128: ${ok && /GET example\.com:443 200/.test(summary) ? '일치' : '불일치'} / E129: ${c1.includes('종료 코드 0,') ? '불일치(옵션 없이도 성공)' : c2.includes('HTTP 200') ? '일치' : '불일치'}`);
else console.log(`E130(브라우저 부분): ${!ok && certErr ? '일치' : ok ? '불일치(아직 믿음)' : '판정 불가(오류 문자열 없음)'}`);
