// [UI-1] 진단: 127.0.0.1에서 listen(0)을 여러 번 하면 포트가 연속 번호로 나오는지(Windows). 인자: 횟수(기본 6)
// 연속이면 "프록시 포트 + 1"을 대시보드 기본 포트로 쓸 때, 테스트가 고른 P의 P+1을 다른 테스트의 서버가 쓰고 있을 가능성이 크다
import net from 'node:net';

const n = Number(process.argv[2] ?? 6);
const servers = [];
const ports = [];
for (let i = 0; i < n; i++) {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  ports.push(s.address().port);
}
console.log(ports.join(' '));
console.log(ports.every((p, i) => i === 0 || p === ports[i - 1] + 1) ? '연속' : '연속 아님');
for (const s of servers) s.close();
