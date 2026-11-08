// [TLS-4b] 복호화 테스트 도우미: 시험용 HTTPS 목적지, 일부러 잘못 만든 인증서, CONNECT 뒤 TLS 연결, 터널 안 요청·응답.
// TLS-4.test.ts의 도우미와 같은 방식이다(그 파일은 커밋돼 있어 바꾸지 않고, 여기서 새로 쓴다). Windows 저장소는 건드리지 않는다.
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import forge from 'node-forge';

export type Pair = { certPem: string; keyPem: string };
export const DAY = 86_400_000;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}

export type Up = { port: number; got: { url: string; upgrade?: string; bodySize: number }[]; conns: number; close: () => Promise<void> };
export async function upstream(pair: Pair, body = 'secure-hello'): Promise<Up> {
  const u = { got: [], conns: 0 } as unknown as Up;
  const s = https.createServer({ cert: pair.certPem, key: pair.keyPem }, (req, res) => {
    let size = 0;
    req.on('data', (c: Buffer) => (size += c.length));
    req.on('end', () => {
      u.got.push({ url: req.url ?? '', upgrade: req.headers.upgrade, bodySize: size });
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) }).end(body);
    });
  });
  s.on('connection', () => u.conns++);
  s.on('tlsClientError', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  u.port = (s.address() as net.AddressInfo).port;
  u.close = () => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())));
  return u;
}

export function badLeaf(signer: Pair | null, notBefore: Date, notAfter: Date): Pair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = notBefore;
  c.validity.notAfter = notAfter;
  c.setSubject([{ name: 'commonName', value: 'localhost' }]);
  c.setIssuer(signer ? forge.pki.certificateFromPem(signer.certPem).subject.attributes : c.subject.attributes);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(forge.pki.privateKeyFromPem(signer ? signer.keyPem : keyPem), forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(c), keyPem };
}

// CONNECT → 200을 읽고 → 같은 소켓에서 TLS. 200이 아니면 TLS를 시작하지 않는다
export type Mitm = { status: number; head: string; raw: net.Socket; t?: tls.TLSSocket; tlsError?: string };
export async function connectMitm(proxyPort: number, host: string, port: number, tlsOpts: tls.ConnectionOptions = {}): Promise<Mitm> {
  const raw = net.connect(proxyPort, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise<void>((r) => raw.once('connect', () => r()));
  raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  let buf = Buffer.alloc(0);
  await new Promise<void>((resolve) => {
    const on = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.includes('\r\n\r\n')) (raw.off('data', on), resolve());
    };
    raw.on('data', on);
    raw.once('close', () => resolve());
    setTimeout(resolve, 3000);
  });
  const head = buf.toString('latin1');
  const status = Number(head.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0);
  if (status !== 200) return { status, head, raw };
  const t = tls.connect({ socket: raw, host, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ['http/1.1'], ...tlsOpts });
  const tlsError = await new Promise<string | undefined>((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e: any) => r(e.code ?? e.message))));
  return { status, head, raw, t, tlsError };
}

const isChunked = (head: string) => /\r\ntransfer-encoding: *chunked\r\n/i.test(`${head}\r\n`);
export function bodyOf(raw: string) {
  const i = raw.indexOf('\r\n\r\n');
  let rest = raw.slice(i + 4);
  if (!isChunked(raw.slice(0, i))) return rest;
  let out = '';
  for (;;) {
    const j = rest.indexOf('\r\n');
    const n = parseInt(rest.slice(0, j), 16);
    if (!n) return out;
    out += rest.slice(j + 2, j + 2 + n);
    rest = rest.slice(j + 2 + n + 2);
  }
}
// 터널 안에서 원문을 보내고 응답 n개를 받는다(Content-Length 또는 chunked의 마지막 조각으로 끝을 안다). 연결이 닫혀도 끝
export async function exchange(t: tls.TLSSocket, raw: string | Buffer, n = 1, ms = 5000) {
  let out = '';
  let closed = false;
  const on = (d: Buffer) => (out += d.toString('utf8'));
  t.on('data', on);
  t.once('close', () => (closed = true));
  t.write(raw);
  const done = () => {
    const parts = out.split(/(?=HTTP\/1\.1 \d{3} )/).filter((p) => p.startsWith('HTTP/1.1'));
    return closed || (parts.length >= n && parts.slice(0, n).every((p) => {
      const i = p.indexOf('\r\n\r\n');
      if (i < 0) return false;
      if (isChunked(p.slice(0, i))) return p.includes('\r\n0\r\n\r\n', i);
      const len = Number(p.match(/content-length: (\d+)/i)?.[1] ?? NaN);
      return Number.isNaN(len) ? true : Buffer.byteLength(p.slice(i + 4)) >= len;
    }));
  };
  await until(done, ms);
  t.off('data', on);
  return out;
}
export const GET = (p: string, host: string, extra = '') => `GET ${p} HTTP/1.1\r\nHost: ${host}\r\n${extra}\r\n`;
