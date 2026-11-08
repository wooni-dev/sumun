// E1~E5, E10, E11: Node 동작 실측 (node --expose-gc e1-buffers.mjs)
import { EventEmitter } from 'node:events';
const gc = globalThis.gc;
const ab = () => (gc(), gc(), process.memoryUsage().arrayBuffers);
const MiB = 1048576;
// E1 subarray가 원본을 붙잡는가
let base = ab(); let keep = [];
for (let i = 0; i < 100; i++) { const b = Buffer.allocUnsafeSlow(MiB); keep.push(b.subarray(0, 100)); }
console.log('E1 subarray(0,100) x100 유지 → arrayBuffers 증가 MB', ((ab() - base) / MiB).toFixed(1));
keep = []; base = ab();
for (let i = 0; i < 100; i++) { const b = Buffer.allocUnsafeSlow(MiB); keep.push(Buffer.from(b.subarray(0, 100))); }
console.log('E1b Buffer.from(subarray) x100 유지 → MB', ((ab() - base) / MiB).toFixed(1), 'byteLength', keep[0].buffer.byteLength, '(작은 복사는 공유 풀)');
const two = [Buffer.from('SECRET-A'), Buffer.from('SECRET-B')];
console.log('E2 작은 Buffer.from 둘이 같은 ArrayBuffer?', two[0].buffer === two[1].buffer, '첫 번째 .buffer로 두 번째 내용 보임?', Buffer.from(two[0].buffer).includes('SECRET-B'));
keep = [];
// E3 JSON.stringify(Buffer)
const b1 = Buffer.alloc(MiB, 0xff);
const s = JSON.stringify({ body: b1 });
console.log('E3 JSON.stringify 1MiB Buffer 길이(문자)', s.length, '배수', (s.length / MiB).toFixed(2));
try { const arr = []; for (let i = 0; i < 200; i++) arr.push({ body: b1 }); JSON.stringify(arr); console.log('E3b 200건 OK'); } catch (e) { console.log('E3b 200건 x 1MiB JSON.stringify →', e.name, e.message); }
// E3c util.inspect/String
import util from 'node:util';
const flow = { request: { headers: [['Cookie', 'SUMUN-SECRET-1']], body: Buffer.from('token=SUMUN-SECRET-2') } };
console.log('E3c inspect에 표식 보임?', util.inspect(new Map([[1, flow]]), { depth: 5 }).includes('SUMUN-SECRET-1'), 'String(Map)=', String(new Map([[1, flow]])));
// E4 Set 순회 중 추가
const set = new Set(); let calls = 0;
const mk = () => () => { calls++; if (calls < 1000) set.add(mk()); };
set.add(mk()); for (const f of set) f();
console.log('E4 Set 순회 중 구독 추가 → 한 번 알림에 호출 수', calls);
const arr = [1, 2, 3, 4]; const seen = []; arr.forEach((x) => { seen.push(x); if (x === 1) arr.splice(0, 1); });
console.log('E4b 배열 forEach 중 자기 해제 → 본 것', seen.join(','), '(2를 건너뜀)');
// E5 EventEmitter
const ee = new EventEmitter(); const got = [];
ee.on('flow', () => { throw new Error('boom'); }); ee.on('flow', () => got.push('second'));
try { ee.emit('flow', {}); } catch (e) { console.log('E5 첫 리스너 throw → emit이 던짐:', e.message, '두 번째 호출됨?', got.length > 0); }
try { new EventEmitter().emit('error', { secret: 'SUMUN-SECRET-3' }); } catch (e) { console.log('E5b error 이벤트 리스너 없음 → throw', e.code, '메시지에 표식?', String(e.message).includes('SUMUN-SECRET-3')); }
const ee2 = new EventEmitter(); process.on('warning', (w) => console.log('E5c 경고:', w.name));
for (let i = 0; i < 11; i++) ee2.on('flow', () => {});
// E11 호스트 표기
const { parseTarget } = await import('../../../src/flow/flow.ts');
const { parseConnectTarget } = await import('../../../src/tls/tunnel.ts');
for (const t of ['http://Example.COM./a', 'http://EXAMPLE.com:80/a', 'http://[::FFFF:127.0.0.1]:8000/', 'http://bücher.de/', 'http://2130706433/', 'http://user:pw@a.com/'])
  console.log('E11 parseTarget', t, '→', JSON.stringify(parseTarget(t)));
for (const t of ['Example.COM.:443', '[::FFFF:7f00:1]:443', 'xn--bcher-kva.de:443'])
  console.log('E11 parseConnectTarget', t, '→', JSON.stringify(parseConnectTarget(t)));
