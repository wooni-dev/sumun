// [TLS-1 실측] E58: CONNECT 헤더와 같은 write로 보낸 데이터를 Node가 'connect' 이벤트의 head로 넘기는지,
// 그리고 head를 읽지 않으면 그 바이트가 소켓에서 다시 오지 않는지(= 버리면 잃는지)
//   node scripts/probe/tls1-head.mjs
import http from 'node:http';
import net from 'node:net';

const server = http.createServer();
server.on('connect', (req, socket, head) => {
  let later = '';
  socket.on('data', (c) => (later += c));
  setTimeout(() => {
    console.log(`req.url=${JSON.stringify(req.url)} head=${JSON.stringify(head.toString())} (길이 ${head.length}), 그 뒤 소켓에서 받은 것=${JSON.stringify(later)}`);
    socket.destroy();
    server.close();
  }, 200);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const s = net.connect(server.address().port, '127.0.0.1', () => s.write('CONNECT a.test:443 HTTP/1.1\r\nHost: a.test:443\r\n\r\nEARLY-BYTES'));
s.on('error', () => {});
