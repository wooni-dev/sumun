// E16 지운 기록의 메모리가 풀리는가 / E17 헤더 많은 기록의 힙 / E18 지운 본문 바이트가 새 할당에 보이는가 (node --expose-gc)
const { createBodyCapture, headerPairs } = await import('../../../src/flow/flow.ts');
const gc = globalThis.gc; const MiB = 1048576;
const mem = () => (gc(), gc(), process.memoryUsage());
const mk = (i) => { const c = createBodyCapture(); c.push(Buffer.alloc(MiB, 0x41)); const r = c.result(); return { id: i, request: { headers: [['a', 'b']], body: r.body } }; };
let m0 = mem(); const store = new Map(); for (let i = 0; i < 300; i++) store.set(i, mk(i));
let m1 = mem(); const index = [...store.values()]; // 다른 색인이 붙잡는 경우
for (const k of [...store.keys()]) store.delete(k);
let m2 = mem(); index.length = 0; let m3 = mem();
console.log('E16 300건 x 1MiB 넣음 → arrayBuffers +MB', ((m1.arrayBuffers - m0.arrayBuffers) / MiB).toFixed(0), '/ Map에서 지움(색인은 남음) → +MB', ((m2.arrayBuffers - m0.arrayBuffers) / MiB).toFixed(0), '/ 색인도 비움 → +MB', ((m3.arrayBuffers - m0.arrayBuffers) / MiB).toFixed(0), ' rss MB', (m3.rss / MiB).toFixed(0));
// E17 헤더: 16KB 안에 넣을 수 있는 최대 개수쯤(약 3,000쌍 "a: b")의 힙
const raw = []; for (let i = 0; i < 3000; i++) raw.push('x' + i, 'v');
let h0 = mem().heapUsed; const keep = []; for (let i = 0; i < 200; i++) keep.push(headerPairs(raw.map((s) => s + '')));
let h1 = mem().heapUsed; console.log('E17 헤더 3,000쌍 기록 200건 힙 +MB', ((h1 - h0) / MiB).toFixed(1), '→ 건당 KB', ((h1 - h0) / 200 / 1024).toFixed(0));
// E18: 지운 본문의 바이트가 이후 allocUnsafeSlow에 남아 보이는가
{ let b = createBodyCapture(); b.push(Buffer.from('SUMUN-SECRET-' + 'Z'.repeat(5000))); let r = b.result(); r = null; b = null; gc(); gc();
  let hits = 0; for (let i = 0; i < 2000; i++) { const x = Buffer.allocUnsafeSlow(5013); if (x.includes('SUMUN-SECRET-')) hits++; }
  console.log('E18 지운 본문 표식이 새 allocUnsafeSlow(같은 크기) 2000번 중 보인 횟수', hits); }
