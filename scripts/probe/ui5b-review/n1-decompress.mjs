// Node의 DecompressionStream: 지원 형식, 잘린 스트림, 뒤 찌꺼기, 여러 멤버, raw deflate, 폭탄 비율
import zlib from 'node:zlib';
const fmts = ['gzip','deflate','deflate-raw','brotli','br','zstd','x-gzip','compress'];
for (const f of fmts) { try { new DecompressionStream(f); console.log('format', f, 'OK'); } catch (e) { console.log('format', f, 'NO', e.name); } }
async function run(fmt, buf, limit = Infinity) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream(fmt));
  const r = s.getReader(); let n = 0, chunks = 0, maxChunk = 0;
  try { for (;;) { const { value, done } = await r.read(); if (done) break; n += value.length; chunks++; maxChunk = Math.max(maxChunk, value.length); if (n > limit) { await r.cancel(); return { n, chunks, maxChunk, stopped: true }; } } return { n, chunks, maxChunk, ok: true }; }
  catch (e) { return { n, chunks, maxChunk, err: e.name + ': ' + e.message.slice(0, 80) }; }
}
const text = Buffer.from('hello world '.repeat(1000));
const gz = zlib.gzipSync(text);
console.log('truncated gzip', await run('gzip', gz.subarray(0, gz.length - 10)));
console.log('gzip + trailing garbage', await run('gzip', Buffer.concat([gz, Buffer.from('<script>')])));
console.log('two gzip members', await run('gzip', Buffer.concat([gz, gz])));
console.log('raw deflate as deflate', await run('deflate', zlib.deflateRawSync(text)));
console.log('zlib deflate as deflate', await run('deflate', zlib.deflateSync(text)));
// 폭탄: 기록 상한 1MiB 안의 압축 본문이 얼마로 풀리는가
const z = Buffer.alloc(64 * 1024 * 1024);
const g = zlib.gzipSync(z, { level: 9 }); console.log('gzip 64MiB zeros ->', g.length, 'bytes, ratio', Math.round(z.length / g.length));
const b = zlib.brotliCompressSync(z); console.log('brotli 64MiB zeros ->', b.length, 'bytes, ratio', Math.round(z.length / b.length));
console.log('gzip bomb with 10MiB limit', await run('gzip', g, 10 * 1024 * 1024));
// 중첩: gzip(gzip(64MiB))
const gg = zlib.gzipSync(g, { level: 9 }); console.log('gzip(gzip(64MiB)) ->', gg.length, 'bytes');
// 한 번의 read가 얼마나 큰 조각을 주는가(상한 검사 사이 메모리)
console.log('chunking of 64MiB gzip', await run('gzip', g));
