// r6: 이 PC의 다른 프록시(두 번째 sumun 실행, 또는 다른 로컬 프록시)를 거쳐 대시보드 A에 닿는가.
// 프록시 A가 "대시보드 A 포트로는 연결하지 않는다"를 지킨다고 가정하고, connectUpstream에서 그 포트를 거부해 흉내 낸다.
//   클라이언트 ─CONNECT 127.0.0.1:<프록시B>─▶ A ─▶ B ─(터널 안) CONNECT 127.0.0.1:<대시A>─▶ 대시보드 A
import net from 'node:net';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? 'D:/secretary/sumun';
const { startProxy } = await import(pathToFileURL(repo + '/src/proxy/server.ts').href);
const { startDashboard } = await import(pathToFileURL(repo + '/src/dashboard/server.ts').href);
const { createStore } = await import(pathToFileURL(repo + '/src/store/store.ts').href);
const dashA = await startDashboard({ store: createStore(), port: 0 });
const blocked = [];
const connectA = (o) => {
  if (o.port === dashA.port) { blocked.push(o); const s = new net.Socket(); process.nextTick(() => s.destroy(Object.assign(new Error('blocked'), { code: 'ECONNREFUSED' }))); return s; }
  return net.connect(o);
};
const A = await startProxy({ port: 0, tunnel: true, connectUpstream: connectA, onFlow: () => {} });
const B = await startProxy({ port: 0, tunnel: true, onFlow: () => {} });

const s = net.connect(A.port, '127.0.0.1');
let buf = ''; let stage = 0;
const out = await new Promise((ok) => {
  s.on('connect', () => s.write(`CONNECT 127.0.0.1:${dashA.port} HTTP/1.1\r\nHost: x\r\n\r\n`));
  s.on('data', (c) => {
    buf += c;
    if (stage === 0 && buf.includes('\r\n\r\n')) { console.log('direct CONNECT to dashA via A (simulated block) ->', buf.split('\r\n')[0]); stage = 1; }
  });
  s.on('close', () => ok());
});
const s2 = net.connect(A.port, '127.0.0.1');
buf = ''; stage = 0;
const res = await new Promise((ok) => {
  s2.on('connect', () => s2.write(`CONNECT 127.0.0.1:${B.port} HTTP/1.1\r\nHost: x\r\n\r\n`));
  s2.on('data', (c) => {
    buf += c;
    if (stage === 0 && buf.includes('\r\n\r\n')) { stage = 1; buf = ''; s2.write(`CONNECT 127.0.0.1:${dashA.port} HTTP/1.1\r\nHost: x\r\n\r\n`); }
    else if (stage === 1 && buf.includes('\r\n\r\n')) { stage = 2; buf = ''; s2.write(`GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:${dashA.port}\r\nAuthorization: Bearer ${dashA.token}\r\nConnection: close\r\n\r\n`); }
  });
  s2.on('close', () => ok(buf));
});
console.log('chain A→B→dashA (inner CONNECT) ->', res.split('\r\n')[0], '|', res.slice(res.indexOf('\r\n\r\n') + 4).trim());
// 같은 사슬에서 B에 평문 absolute-form을 보내면 B가 Via를 붙이므로 대시보드가 403
const s3 = net.connect(A.port, '127.0.0.1');
buf = ''; stage = 0;
const res3 = await new Promise((ok) => {
  s3.on('connect', () => s3.write(`CONNECT 127.0.0.1:${B.port} HTTP/1.1\r\nHost: x\r\n\r\n`));
  s3.on('data', (c) => { buf += c; if (stage === 0 && buf.includes('\r\n\r\n')) { stage = 1; buf = ''; s3.write(`GET http://127.0.0.1:${dashA.port}/api/ping HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${dashA.token}\r\nConnection: close\r\n\r\n`); } });
  s3.on('close', () => ok(buf));
});
console.log('chain A→B plain absolute-form ->', res3.split('\r\n')[0]);
console.log('A blocked attempts:', blocked.length);
await A.close(); await B.close(); await dashA.close();
