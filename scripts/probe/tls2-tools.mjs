// [TLS-2 실측] 구현한 loadOrCreateCA가 만든 CA를 독립 도구로 확인한다(사용자 문서의 실제 예시 값)
//   node scripts/probe/tls2-tools.mjs
// 임시 폴더에만 만들고 끝나면 지운다. 실제 %LOCALAPPDATA%\sumun\ca와 Windows 인증서 저장소는 건드리지 않는다.
// 키 파일 권한(icacls)은 TLS-2b(결정 9)의 출발점으로 기록만 한다. 키 내용은 출력하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2-tools-')), 'ca');
const t0 = performance.now();
await loadOrCreateCA(dir);
console.log(`생성 ${(performance.now() - t0).toFixed(0)}ms → ${fs.readdirSync(dir).join(', ')}`);
const cert = path.join(dir, 'ca-cert.pem');
const key = path.join(dir, 'ca-key.pem');

const text = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-text'], { encoding: 'utf8' });
const pick = ['Version', 'Serial Number', 'Signature Algorithm', 'Issuer', 'Not Before', 'Not After', 'Subject:', 'Public-Key', 'Exponent', 'X509v3 Basic Constraints', 'CA:TRUE', 'X509v3 Key Usage', 'Certificate Sign', 'X509v3 Extended Key Usage', 'TLS Web', 'X509v3 Subject Key Identifier'];
const lines = text.split('\n');
console.log('--- openssl x509 -text (일부) ---');
lines.forEach((l, i) => {
  if (pick.some((p) => l.includes(p))) console.log(l.trimEnd() + (l.includes('Serial Number:') && !/[0-9a-f]{2}:/.test(l) ? ` ${lines[i + 1].trim()}` : ''));
});
console.log(`openssl rsa -check: ${execFileSync('openssl', ['rsa', '-in', key, '-check', '-noout'], { encoding: 'utf8' }).trim()}`);

const before = execFileSync('certutil', ['-user', '-store', 'Root'], { encoding: 'latin1' }).split('\n').length;
const dump = execFileSync('certutil', ['-dump', cert], { encoding: 'latin1' });
const after = execFileSync('certutil', ['-user', '-store', 'Root'], { encoding: 'latin1' }).split('\n').length;
console.log(`certutil -dump: Basic Constraints(2.5.29.19) ${dump.includes('2.5.29.19')}, EKU serverAuth(1.3.6.1.5.5.7.3.1) ${dump.includes('1.3.6.1.5.5.7.3.1')} / 저장소 줄 수 ${before} → ${after}`);

console.log('--- icacls ca-key.pem (TLS-2b 출발점) ---');
console.log(execFileSync('icacls', [key], { encoding: 'latin1' }).trim().replace(dir, '<임시>\\ca'));
fs.rmSync(path.dirname(dir), { recursive: true, force: true });
