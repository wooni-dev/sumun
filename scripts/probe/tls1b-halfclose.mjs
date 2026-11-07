// [TLS-1b 실측] 구현 전 터널의 반쪽 닫기(R6)와 느린 클라이언트 역압(R7) — E60, E61, E63
//   node scripts/probe/tls1b-halfclose.mjs
// 프록시를 같은 프로세스에서 tunnel: true로 띄우고, 원시 TCP 클라이언트·목적지로 확인한다(인터넷에 연결하지 않음).
import net from 'node:net';
import { startProxy } from '../../src/proxy/server.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flows = [];
const proxy = await startProxy({ port: 0, tunnel: true, onFlow: (f) => flows.push(f) });

async function upstream(onConn) {
  const server = net.createServer({ allowHalfOpen: true }, onConn);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
function tunnelClient(port) {
  const s = net.connect({ port: proxy.port, host: '127.0.0.1', allowHalfOpen: true });
  const st = { buf: Buffer.alloc(0), ended: false, closed: false, err: null };
  s.on('data', (d) => (st.buf = Buffer.concat([st.buf, d])));
  s.on('end', () => (st.ended = true));
  s.on('error', (e) => (st.err = e.code));
  s.on('close', () => (st.closed = true));
  s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\n`);
  const body = () => st.buf.toString('latin1').split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return { s, st, body };
}

// E60 R6a: 클라이언트가 먼저 쓰기를 닫는다 → 목적지는 FIN을 받은 뒤 답한다
{
  const up = await upstream((s) => {
    let got = '';
    s.on('data', (d) => (got += d));
    s.on('end', () => s.end(`got:${got}`));
    s.on('error', () => {});
  });
  const c = tunnelClient(up.port);
  await sleep(200);
  c.s.end('hello');
  await sleep(500);
  console.log(`E60 R6a 클라이언트 먼저 FIN: 받은 답=${JSON.stringify(c.body())} end=${c.st.ended} err=${c.st.err} 기록 error=${JSON.stringify(flows.at(-1)?.error)}`);
  c.s.destroy();
  await up.close();
}

// E61 R6b: 목적지가 먼저 쓰기를 닫는다 → 그 뒤 클라이언트가 보낸 것이 목적지에 닿는가
{
  let got = '';
  let upErr = null;
  const up = await upstream((s) => {
    s.on('data', (d) => (got += d));
    s.on('error', (e) => (upErr = e.code));
    s.on('end', () => s.end());
    s.end('greeting');
  });
  const n = flows.length;
  const c = tunnelClient(up.port);
  await sleep(300);
  c.s.write('after-upstream-fin');
  await sleep(300);
  c.s.end();
  await sleep(500);
  console.log(`E61 R6b 목적지 먼저 FIN: 클라이언트가 받은 것=${JSON.stringify(c.body())} 클라이언트 end=${c.st.ended} err=${c.st.err} / 목적지가 받은 것=${JSON.stringify(got)} 목적지 err=${upErr} / 기록 ${flows.length - n}개 error=${JSON.stringify(flows.at(-1)?.error)}`);
  await sleep(2000);
  console.log(`E61 R6b 2초 더 기다린 뒤: 기록 ${flows.length - n}개, 클라이언트 closed=${c.st.closed}`);
  c.s.destroy();
  await up.close();
}

// E63 R7: 클라이언트가 읽기를 멈춘 동안 목적지가 얼마나 써 넣을 수 있는가
{
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let written = 0;
  let stop = false;
  const up = await upstream((s) => {
    s.on('error', () => {});
    const pump = () => {
      while (!stop && written < 200 * 1024 * 1024) {
        written += chunk.length;
        if (!s.write(chunk)) return s.once('drain', pump);
      }
    };
    setTimeout(pump, 100);
  });
  const c = tunnelClient(up.port);
  await sleep(300);
  c.s.pause();
  const recv0 = c.st.buf.length;
  for (const t of [500, 1000, 2000]) {
    await sleep(t === 500 ? 500 : t / 2);
    console.log(`E63 R7 느린 클라이언트 ${t}ms: 목적지가 쓴 양 ${(written / 1048576).toFixed(1)}MB, 클라이언트가 받은 양 ${(c.st.buf.length / 1048576).toFixed(1)}MB, 차이 ${((written - c.st.buf.length) / 1048576).toFixed(1)}MB (멈출 때 받은 양 ${(recv0 / 1048576).toFixed(1)}MB)`);
  }
  stop = true;
  c.s.destroy();
  await up.close();
}

await proxy.close();
