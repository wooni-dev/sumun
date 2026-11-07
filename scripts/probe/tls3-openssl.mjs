// [TLS-3 실측] issueCert로 만든 인증서를 독립된 TLS 클라이언트(openssl s_client)가 루트 CA만 믿고 검증하는가 (O31 취지)
//   node scripts/probe/tls3-openssl.mjs
// 임시 폴더에 루트 CA를 만들고, 말단 인증서로 Node TLS 서버를 띄운 뒤 openssl이 접속한다. Windows 인증서 저장소는 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3-ossl-'));
const root = await loadOrCreateCA(path.join(base, 'ca'));
const leaf = await issueCert(root, ['localhost', '127.0.0.1']);
const srv = tls.createServer({ cert: leaf.certPem, key: leaf.keyPem }, (s) => s.end('hello from leaf\n'));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const rootFile = path.join(base, 'ca', 'ca-cert.pem');

const sclient = (extra) =>
  new Promise((resolve) => {
    const p = execFile('openssl', ['s_client', '-connect', `127.0.0.1:${port}`, '-CAfile', rootFile, '-verify_return_error', ...extra], { encoding: 'utf8', timeout: 10000 }, (e, out, err) => resolve({ code: e?.code ?? 0, out: out + err }));
    p.stdin.end('');
  });
const show = (label, r) => {
  const pick = (re) => r.out.match(re)?.[0]?.trim() ?? '(없음)';
  console.log(`${label}: 종료 코드 ${r.code} / ${pick(/Verify return code: .*/)} / ${pick(/verify error:[^\n]*/)}`);
};
show('1) -servername localhost -verify_hostname localhost', await sclient(['-servername', 'localhost', '-verify_hostname', 'localhost']));
show('2) -verify_ip 127.0.0.1', await sclient(['-verify_ip', '127.0.0.1']));
show('3) -verify_hostname other.test (실패해야 함)', await sclient(['-servername', 'other.test', '-verify_hostname', 'other.test']));
const chain = await sclient(['-servername', 'localhost', '-showcerts']);
console.log(`4) 서버 인증서: ${chain.out.match(/s:[^\r\n]*\r?\n\s*i:[^\r\n]*/)?.[0]?.replace(/\s+/g, ' ')}`);
// 종료 코드 1은 s_client가 입력 끝(빈 stdin)에서 끝나며 내는 값이다 — 판정은 "Verify return code"로 한다
srv.close();
fs.rmSync(base, { recursive: true, force: true });
