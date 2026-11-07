// [PRX-1b] 테스트 도우미: HTTP 클라이언트를 거치지 않고 원시 바이트를 그대로 보낸다.
// Node의 http 클라이언트는 잘못된 요청(CL+TE, obs-fold 등)을 보내기 전에 막아 버리므로, 공격 사례는 소켓으로 직접 보낸다.
import net from 'node:net';

export type RawReply = { status: number; raw: string; responses: number };

export function rawRequest(port: number, data: string, waitMs = 700): Promise<RawReply> {
  return new Promise((resolve) => {
    let raw = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(data));
    const done = () => {
      s.destroy();
      const m = raw.match(/^HTTP\/1\.[01] (\d{3})/);
      resolve({ status: m ? Number(m[1]) : 0, raw, responses: (raw.match(/^HTTP\/1\.[01] \d{3}/gm) ?? []).length });
    };
    const timer = setTimeout(done, waitMs);
    s.on('data', (c) => (raw += c.toString('latin1')));
    s.on('close', () => (clearTimeout(timer), done()));
    s.on('error', () => {});
  });
}
