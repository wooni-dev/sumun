// [TLS-4c] 테스트 도우미: 연결이 언제 닫히는지 재기, 1바이트씩 보내기, ClientHello를 늦춘 CONNECT, 일부러 이상하게 만든 목적지 인증서(C1~C4, C6, C7).
// 시험 인증서는 node-forge와 Node crypto로 메모리에서 만든다(scripts/probe/tls4c-classify.mjs와 같은 방식). Windows 저장소는 건드리지 않는다.
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import forge from 'node-forge';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}

// 소켓을 지켜본다: 받은 바이트(문자열), 닫힌 시각. 읽지 않으면 FIN을 소비하지 않아 'close'가 오지 않으므로 data 처리기를 단다
export type Watch = { data: string; closedAt: number | null; readonly closed: boolean };
export function watch(s: net.Socket | tls.TLSSocket): Watch {
  const w = { data: '', closedAt: null as number | null, get closed() { return w.closedAt !== null; } };
  s.on('data', (d: Buffer) => (w.data += d.toString('latin1')));
  s.once('close', () => (w.closedAt ??= Date.now()));
  return w;
}
export const statuses = (raw: string) => [...raw.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((m) => Number(m[1]));

// text를 ms마다 1바이트씩 보낸다. 소켓이 닫히거나, 다 보내거나, stop()이 참이면(예: 응답을 받음) 멈춘다.
// 응답을 받은 뒤에도 계속 쓰면 서버가 닫은 소켓에 써서 RST가 오고, Windows는 RST가 오면 아직 읽지 않은 받은 데이터(408)를 버릴 수 있다
// [추측: K7이 전체 실행에서 한 번 [408]이 아닌 값으로 실패했고 단독 6번·전체 3번 재실행에서는 재현되지 않음]
export function drip(s: { write: (c: string) => unknown; destroyed: boolean }, text: string, ms: number, stop: () => boolean = () => false) {
  let i = 0;
  const iv = setInterval(() => (s.destroyed || i >= text.length || stop() ? clearInterval(iv) : s.write(text[i++])), ms);
  return () => clearInterval(iv);
}

// CONNECT → 200을 읽고 → delayMs 뒤 같은 소켓에서 TLS 시작. 시각: connectedAt = 200을 받은 때, securedAt = 핸드셰이크가 끝난 때
export type Tunnel = { raw: net.Socket; t: tls.TLSSocket; w: Watch; rawW: Watch; connectedAt: number; securedAt: number | null; tlsError?: string };
export async function tunnel(proxyPort: number, host: string, port: number, o: { ca: string; delayMs?: number; tls?: tls.ConnectionOptions }): Promise<Tunnel> {
  const raw = net.connect(proxyPort, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise<void>((r) => raw.once('connect', () => r()));
  raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  const head = await new Promise<string>((r) => (raw.once('data', (d) => r(d.toString('latin1'))), setTimeout(() => r(''), 3000)));
  if (!/^HTTP\/1\.1 200 /.test(head)) throw new Error(`CONNECT 응답: ${JSON.stringify(head.slice(0, 40))}`);
  const connectedAt = Date.now();
  const rawW = { closedAt: null as number | null, data: '', get closed() { return rawW.closedAt !== null; } };
  raw.once('close', () => (rawW.closedAt ??= Date.now()));
  if (o.delayMs) await sleep(o.delayMs);
  const t = tls.connect({ socket: raw, servername: host, ca: o.ca, ALPNProtocols: ['http/1.1'], ...o.tls });
  const w = watch(t);
  const tlsError = await new Promise<string | undefined>((r) => (t.once('secureConnect', () => r(undefined)), t.once('error', (e: NodeJS.ErrnoException) => r(e.code ?? e.message)), t.once('close', () => r('closed'))));
  t.on('error', () => {});
  return { raw, t, w, rawW, connectedAt, securedAt: tlsError ? null : Date.now(), tlsError };
}

// ---- 시험 인증서 ----
const { pki, asn1 } = forge;
const DAY = 86_400_000;
type Keys = { pem: string; priv: forge.pki.rsa.PrivateKey; pub: forge.pki.rsa.PublicKey };
export const keyPair = (bits = 2048): Keys => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const priv = pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  return { pem, priv, pub: pki.setRsaPublicKey(priv.n, priv.e) };
};
export type Made = { cert: forge.pki.Certificate; keys: Keys; pem: string };
export function makeCert(o: { cn: string; keys?: Keys; issuer?: Made; ca?: boolean; sans?: string[]; exts?: object[]; md?: 'sha256' | 'sha1'; eku?: object }): Made {
  const keys = o.keys ?? keyPair();
  const c = pki.createCertificate();
  c.publicKey = keys.pub;
  c.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = new Date(Date.now() - DAY);
  c.validity.notAfter = new Date(Date.now() + 30 * DAY);
  c.setSubject([{ name: 'commonName', value: o.cn }]);
  c.setIssuer(o.issuer ? o.issuer.cert.subject.attributes : [{ name: 'commonName', value: o.cn }]);
  const base = o.ca
    ? [{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }]
    : [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: (o.sans ?? ['localhost']).map((value) => ({ type: 2, value })) }, o.eku ?? { name: 'extKeyUsage', serverAuth: true }];
  c.setExtensions([...base, ...(o.exts ?? [])]);
  c.sign(o.issuer ? o.issuer.keys.priv : keys.priv, forge.md[o.md ?? 'sha256'].create());
  return { cert: c, keys, pem: pki.certificateToPem(c) };
}
// 이름 제약(permitted DNS:.example.com) — forge가 모르는 확장이라 DER을 직접 만든다
const NAME_CONSTRAINTS = asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
  asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, '.example.com')])]),
])).getBytes();
const CRITICAL_UNKNOWN = { id: '1.2.3.4.5', critical: true, value: asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')).getBytes() };

// 목적지 인증서 묶음: 시험 루트(프록시의 upstreamCA로 믿게 한다)와 사례별 { chain, key, options }
export function badUpstreams() {
  const root = makeCert({ cn: 'sumun test4c root', ca: true });
  const nc = makeCert({ cn: 'sumun test4c nc int', issuer: root, ca: true, exts: [{ id: '2.5.29.30', critical: true, value: NAME_CONSTRAINTS }] });
  const leaf = (o: Partial<Parameters<typeof makeCert>[0]>) => makeCert({ cn: 'localhost', issuer: root, ...o });
  const good = leaf({});
  const ncLeaf = leaf({ issuer: nc });
  const crit = leaf({ exts: [CRITICAL_UNKNOWN] });
  const sha1 = leaf({ md: 'sha1' });
  const rsa1024 = leaf({ keys: keyPair(1024) });
  const eku = leaf({ eku: { name: 'extKeyUsage', clientAuth: true } });
  const noInt = leaf({ issuer: nc, sans: ['a.example.com'] });
  const srv = (chain: Made[], key: Keys, extra: tls.TlsOptions = {}) => ({ cert: chain.map((c) => c.pem).join(''), key: key.pem, ...extra });
  return {
    rootPem: root.pem,
    good: srv([good], good.keys),
    nameConstraint: srv([ncLeaf, nc], ncLeaf.keys),
    criticalExt: srv([crit], crit.keys),
    sha1: srv([sha1], sha1.keys),
    rsa1024: srv([rsa1024], rsa1024.keys, { ciphers: 'DEFAULT@SECLEVEL=0' }),
    ekuClientOnly: srv([eku], eku.keys),
    missingIntermediate: srv([noInt], noInt.keys),
  };
}
// 시험용 HTTPS 목적지. body는 응답 본문(새면 안 되는 표시로도 쓴다)
export async function httpsUp(opts: https.ServerOptions, body = 'upstream-secret-body') {
  const s = https.createServer(opts, (_q, r) => r.writeHead(200, { 'content-length': Buffer.byteLength(body) }).end(body));
  s.on('tlsClientError', () => {});
  s.on('error', () => {});
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { port: (s.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r()))) };
}
