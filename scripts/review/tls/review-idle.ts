// 검토 에이전트용: 복호화 터널의 유휴 연결이 언제 닫히는지 잰다. 실행: node scripts/review/tls/review-idle.ts [대기초=40]
// (1) 핸드셰이크를 마친 뒤 요청을 보내지 않는 연결 (2) 200 뒤 ClientHello를 보내지 않는 연결 (3) 비교: 평문 프록시 포트에 연결만 하고 아무것도 보내지 않는 연결
// 임시 폴더에만 CA를 만든다. Windows 인증서 저장소·실제 %LOCALAPPDATA%\sumun\ca·인터넷을 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { loadOrCreateCA } from '../../../src/ca/ca.ts';
import { startProxy } from '../../../src/proxy/server.ts';

const WAIT = Number(process.argv[2] ?? 40) * 1000;
const ca = await loadOrCreateCA(fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-rv-idle-')));
const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
const p = await startProxy({ port: 0, ca, lookup, headersTimeoutMs: 500, tlsHandshakeTimeoutMs: 500 });
const start = Date.now();
const closedAt: Record<string, number | null> = { afterHandshake: null, noClientHello: null, plainIdle: null };
const mark = (k: string) => () => (closedAt[k] ??= Date.now() - start);

async function connect(withTls: boolean, key: string) {
  const s = net.connect(p.port, '127.0.0.1');
  s.on('error', () => {});
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.write('CONNECT good.test:443 HTTP/1.1\r\nHost: good.test:443\r\n\r\n');
  const head = await new Promise<string>((r) => s.once('data', (d) => r(d.toString('latin1'))));
  console.log(key, 'CONNECT 응답:', head.split('\r\n')[0], `${Date.now() - start}ms`);
  if (!withTls) return (s.resume(), s.once('close', mark(key)));
  const t = tls.connect({ socket: s, servername: 'good.test', ca: ca.certPem, checkServerIdentity: () => undefined });
  t.on('error', () => {});
  t.once('close', mark(key));
  t.resume(); // 읽지 않으면 끝(FIN)을 소비하지 않아 'close'가 오지 않는다
  await new Promise<void>((r) => t.once('secureConnect', () => r()));
  console.log(key, '핸드셰이크 완료', `${Date.now() - start}ms`);
  return t;
}
closedAt.partialHeaders = null; // (4) 핸드셰이크 뒤 헤더를 일부만 보내고 멈춤(slowloris)
const d = (await connect(true, 'partialHeaders')) as tls.TLSSocket;
d.write('GET / HTTP/1.1\r\nHost: good.test\r\nX-A: 1\r\n');
const a = await connect(true, 'afterHandshake');
const b = await connect(false, 'noClientHello');
const c = net.connect(p.port, '127.0.0.1');
c.on('error', () => {});
c.once('close', mark('plainIdle'));
c.resume();

const t0 = Date.now();
while (Object.values(closedAt).some((v) => v === null) && Date.now() - t0 < WAIT) await new Promise((r) => setTimeout(r, 100));
console.log('닫힌 시각(ms, null = 대기 시간 안에 안 닫힘):', JSON.stringify(closedAt));
d.destroy();
a.destroy();
b.destroy();
c.destroy();
await p.close();
process.exit(0);
