// [PRX-1c] 테스트 도우미: 원시 바이트로 응답하는 목적지 서버 (깨진 응답, 101, 무응답, 도중 끊김 등)
import net from 'node:net';

export async function startRawUpstream(onConnection: (socket: net.Socket, request: string) => void) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    let buf = '';
    let handled = false;
    s.on('data', (c) => {
      buf += c.toString('latin1');
      if (!handled && buf.includes('\r\n\r\n')) {
        handled = true;
        onConnection(s, buf);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
