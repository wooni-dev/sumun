// 검토 실험: 평문 프록시에서 headersTimeoutMs 극단값(0, 3e9)일 때 반쪽 헤더 연결이 언제 닫히는지(3초 관찰)
import net from 'node:net';
import { startProxy } from '../../../src/proxy/server.ts';
for (const v of [0, 3e9, 1]) {
  let p;
  try { p = await startProxy({ port: 0, headersTimeoutMs: v } as any); } catch (e: any) { console.log(v, '시작 실패', e.code, e.message); continue; }
  const s = net.connect(p.port, '127.0.0.1'); s.on('error', () => {}); let got = ''; s.on('data', (d) => (got += d));
  const t0 = Date.now(); let closed: number | null = null; s.once('close', () => (closed = Date.now() - t0));
  await new Promise<void>((r) => s.once('connect', () => r())); s.write('GET http://127.0.0.1:1/ HTTP/1.1\r\nHo');
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`headersTimeoutMs=${v}: 닫힘 ${closed}ms, 응답 ${JSON.stringify(got.split('\r\n')[0])}`);
  s.destroy(); await p.close();
}
process.exit(0);
