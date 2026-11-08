// E8b: 복호화 CONNECT의 시작 알림에 끝 기록이 오는가 (CA는 %TEMP% 아래 새 폴더, Windows 저장소 안 건드림)
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const { startProxy } = await import('../../../src/proxy/server.ts');
const { loadOrCreateCA } = await import('../../../src/ca/ca.ts');
const { upstream, connectMitm, badLeaf, until } = await import('../../../test/tls/_mitm.ts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-sto-review-ca-'));
const ca = await loadOrCreateCA(path.join(dir, 'ca'));
const leaf = badLeaf(ca, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000 * 30));
const up = await upstream(leaf);
const starts = [], flows = [];
const p = await startProxy({ port: 0, ca, upstreamCA: [ca.certPem], onFlowStart: (s) => starts.push(`${s.id}:${s.request.method}`), onFlow: (f) => flows.push(`${f.id}:${f.request.method}:${f.response?.status ?? f.error?.code}`) });
const m = await connectMitm(p.port, 'localhost', up.port, { ca: ca.certPem });
console.log('CONNECT status', m.status, 'tls', !!m.t, m.tlsError ?? '');
if (m.t) { m.t.write(`GET /x HTTP/1.1\r\nHost: localhost:${up.port}\r\nConnection: close\r\n\r\n`); m.t.resume(); await new Promise((r) => m.t.once('close', r)); }
await until(() => flows.length >= 1); await new Promise((r) => setTimeout(r, 200));
const ended = new Set(flows.map((f) => f.split(':')[0]));
console.log('E8b 시작', starts.join(' '), '/ 끝', flows.join(' '), '/ 끝이 없는 시작', starts.filter((s) => !ended.has(s.split(':')[0])).join(' '));
await p.close(); await up.close(); fs.rmSync(dir, { recursive: true, force: true });
