// [PRX-1] 테스트 도우미: 인터넷 대신 쓰는 로컬 목적지 서버 + 프록시 경유 요청
import http from 'node:http';
import net from 'node:net';

export type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Respond = (req: http.IncomingMessage, res: http.ServerResponse) => void;

// 127.0.0.1의 임의 포트에 뜨는 목적지 서버. 받은 요청을 seen에 기록한다.
export async function startUpstream(respond?: Respond) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (respond) return respond(req, res);
      res.writeHead(201, { 'content-type': 'text/plain', 'x-up': 'yes' });
      res.end('from-upstream');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    seen,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

export type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

// 프록시에 absolute-form(또는 시험용 origin-form) 요청을 보낸다. curl -x 와 같은 형태다.
export function viaProxy(
  proxyPort: number,
  opts: { target: string; method?: string; headers?: Record<string, string | string[]>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: opts.method ?? 'GET', path: opts.target, agent: false });
    for (const [k, v] of Object.entries(opts.headers ?? {})) req.setHeader(k, v);
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

// CONNECT 요청을 보내고 응답 상태 코드를 돌려준다.
export function connectViaProxy(proxyPort: number, target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: target, agent: false });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('CONNECT 응답 없음(3초)')));
    req.end();
  });
}

// 지금은 아무도 쓰지 않는 포트 번호 (연결 거부 시험용)
export async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
