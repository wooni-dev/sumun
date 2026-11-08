// 검토 실험: 목적지 인증서 실패 종류별로 Node가 내는 err.code와 프록시 기록 분류를 본다. 임시 CA·openssl로 만든 시험 인증서만 쓴다.
// 실행: node scripts/probe/tls4c-review/cert-classify.ts  (먼저 bash scripts/probe/tls4c-review/mk.sh <임시 폴더>)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { loadOrCreateCA } from '../../../src/ca/ca.ts';
import { startProxy } from '../../../src/proxy/server.ts';

if (!process.argv[2]) throw new Error('사용법: node scripts/probe/tls4c-review/cert-classify.ts <mk.sh로 만든 폴더>');
const D = process.argv[2].replaceAll('\\', '/').replace(/\/?$/, '/'); // mk.sh로 시험 인증서를 만든 폴더
const rd = (f: string) => fs.readFileSync(D + f, 'utf8');
const proxyCA = await loadOrCreateCA(fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-rv3-')));
const root = rd('root.pem');
const flows: any[] = [];
const p = await startProxy({ port: 0, ca: proxyCA, upstreamCA: [root], lookup: async () => [{ address: '127.0.0.1', family: 4 }], onFlow: (f: any) => flows.push(f) } as any);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Case = [string, () => net.Server];
const srv = (cert: string, key: string, extra: tls.TlsOptions = {}) => () => https.createServer({ cert: rd(cert), key: rd(key), ...extra }, (_q, r) => r.end('ok'));
const rootLeaf = (n: string) => srv(`${n}.pem`, `${n}.key`);
const cases: Case[] = [
  ['(기준) 정상 leaf', rootLeaf('good')],
  ['이름 제약 위반(중간 CA permitted .example.com)', srv('nc_chain.pem', 'nc_leaf.key')],
  ['keyUsage=keyCertSign만', rootLeaf('ku_leaf')],
  ['EKU=clientAuth만', rootLeaf('eku_leaf')],
  ['모르는 critical 확장', rootLeaf('crit_leaf')],
  ['SHA-1 서명 leaf', rootLeaf('sha1_leaf')],
  ['RSA 1024 leaf', srv('rsa1024_leaf.pem', 'rsa1024_leaf.key', { ciphers: 'DEFAULT@SECLEVEL=0' })],
  ['RSA 768 leaf', srv('rsa768_leaf.pem', 'rsa768_leaf.key', { ciphers: 'DEFAULT@SECLEVEL=0' })],
  ['중간 CA가 CA:FALSE', srv('nonca_chain.pem', 'nonca_leaf.key')],
  ['중간 CA 빠짐', srv('onlyleaf.pem', 'onlyleaf.key')],
  ['(반대) 클라이언트 인증서 요구 TLS1.3', srv('good.pem', 'good.key', { requestCert: true, rejectUnauthorized: true, ca: [root] })],
  ['(반대) 클라이언트 인증서 요구 TLS1.2', srv('good.pem', 'good.key', { requestCert: true, rejectUnauthorized: true, ca: [root], maxVersion: 'TLSv1.2' })],
  ['(반대) 핸드셰이크 직후 목적지 RST', () => net.createServer((s) => { s.on('error', () => {}); s.once('data', () => s.resetAndDestroy()); })],
];
// 클라이언트 인증서 요구 사례는 정상 leaf가 필요 → 정상 leaf 하나 더
fs.writeFileSync(D + 'good.ext', 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');

for (const [label, make] of cases) {
  const s = make();
  s.on('error', () => {});
  s.on('tlsClientError', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  // 1) 직접: server.ts와 같은 옵션
  const direct = await new Promise<string>((resolve) => {
    const rq = https.request({ host: '127.0.0.1', port, servername: 'localhost', checkServerIdentity: (_h, c) => tls.checkServerIdentity('localhost', c), ca: [...tls.rootCertificates, root], rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], agent: false }, (r) => (r.resume(), resolve(`OK ${r.statusCode}`)));
    rq.on('error', (e: any) => resolve(`${e.code} | ${e.message}`));
    rq.end();
  });
  // 2) 프록시를 거쳐
  const mark = flows.length;
  const raw = net.connect(p.port, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise<void>((r) => raw.once('connect', () => r()));
  raw.write(`CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`);
  await new Promise<void>((r) => raw.once('data', () => r()));
  const t = tls.connect({ socket: raw, servername: 'localhost', ca: proxyCA.certPem });
  t.on('error', () => {});
  await new Promise<void>((r) => t.once('secureConnect', () => r()));
  let got = '';
  t.on('data', (d) => (got += d));
  t.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`);
  const end = Date.now() + 4000;
  while (flows.length === mark && Date.now() < end) await sleep(20);
  const f = flows[mark];
  console.log(`- ${label}\n    직접: ${direct}\n    프록시: ${got.split('\r\n')[0]} / error=${JSON.stringify(f?.error)} upstreamError=${f?.tls?.upstreamError}`);
  t.destroy();
  s.close();
}
await p.close();
process.exit(0);
