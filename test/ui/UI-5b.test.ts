// [UI-5b] 화면 보강 — 새 동작(구현 전에는 실패해야 정상). 사례: docs/ai/ui5b-cases.md P2·P4~P9·P13~P19·Q1~Q13, 설계 B-1~B-7
//   view.js 순수 함수는 직접 부르고, app.js는 소스 검사(긍정 전제)와 브라우저 실측(E193)으로 본다.
//   주의(P8): Node의 DecompressionStream은 brotli를 지원하지만 Chrome 156은 아니다 — br은 형식 이름 단계(decompressPlan)에서 거른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import * as view from '../../src/dashboard/public/view.js';

const V = view as any;
const u8 = (...parts: (number[] | string | Buffer)[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p as any)))));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

// 머리만 있는 이미지(크기 판정용 — 실제 디코드는 하지 않는다)
const png = (w: number, h: number) => u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0], [0, 0, 0, 0]);
const gif = (w: number, h: number) => u8('GIF89a', le16(w), le16(h), [0, 0, 0]);
const jpeg = (...frames: [number, number][]) =>
  u8([0xff, 0xd8], [0xff, 0xe0], be16(16), 'JFIF\0', new Array(9).fill(0), ...frames.map(([w, h]) => u8([0xff, 0xc0], be16(17), [8], be16(h), be16(w), [3], new Array(9).fill(0)) as any), [0xff, 0xda], be16(12), new Array(10).fill(0));
const webpX = (w: number, h: number) => u8('RIFF', le32(30), 'WEBP', 'VP8X', le32(10), [0, 0, 0, 0], le24(w - 1), le24(h - 1));
const webpL = (w: number, h: number) => {
  const a = w - 1, b = h - 1;
  return u8('RIFF', le32(20), 'WEBP', 'VP8L', le32(5), [0x2f, a & 0xff, ((a >> 8) & 0x3f) | ((b & 0x3) << 6), (b >> 2) & 0xff, (b >> 10) & 0x0f]);
};
const bmp = (w: number, h: number) => u8('BM', le32(0), le32(0), le32(54), le32(40), le32(w), le32(h >>> 0), le16(1), le16(24));

function code(file: string) {
  const p = `src/dashboard/public/${file}`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('sniffImage(B-2, P2): 매직 바이트로만 PNG·JPEG·GIF·WebP·BMP를 알아보고, SVG·HTML·그 밖은 null', () => {
  assert.equal(V.sniffImage(png(1, 1)), 'png');
  assert.equal(V.sniffImage(jpeg([1, 1])), 'jpeg');
  assert.equal(V.sniffImage(gif(1, 1)), 'gif');
  assert.equal(V.sniffImage(u8('GIF87a', [1, 0, 1, 0])), 'gif');
  assert.equal(V.sniffImage(webpX(1, 1)), 'webp');
  assert.equal(V.sniffImage(bmp(1, 1)), 'bmp');
  for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', '  <?xml version="1.0"?><svg/>', '<!doctype html><script>1</script>', 'RIFF\0\0\0\0WAVEfmt ', '', 'GIF8', '\x89PNG']) assert.equal(V.sniffImage(u8(s)), null, JSON.stringify(s));
  assert.equal(V.sniffImage(u8([0, 0, 1, 0, 1, 0])), null, 'ICO는 미리보기 대상이 아님(B-2)');
});

test('imageSize: 디코드 없이 머리에서 가로·세로(PNG·GIF·JPEG·WebP VP8X/VP8L·BMP), 못 읽으면 null', () => {
  assert.deepEqual(V.imageSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(V.imageSize(gif(300, 200)), { width: 300, height: 200 });
  assert.deepEqual(V.imageSize(jpeg([1024, 768])), { width: 1024, height: 768 });
  assert.deepEqual(V.imageSize(webpX(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepEqual(V.imageSize(webpL(123, 456)), { width: 123, height: 456 });
  assert.deepEqual(V.imageSize(bmp(10, -20)), { width: 10, height: 20 }, 'BMP 위에서 아래(음수 높이)');
  assert.equal(V.imageSize(png(640, 480).subarray(0, 20)), null, '잘린 머리');
  assert.equal(V.imageSize(u8([0xff, 0xd8, 0xff, 0xe0, 0, 16])), null, 'SOF 없는 JPEG');
  assert.equal(V.imageSize(u8('<svg/>')), null);
});

test('previewDecision(B-3, P4·Q8): 5천만 픽셀까지만 그린다. 큰 JPEG를 작은 프레임 뒤에 숨겨도 큰 쪽으로 판정, 크기를 모르면 그리지 않는다', () => {
  assert.deepEqual(V.previewDecision(png(8000, 6000)), { ok: true, type: 'png', width: 8000, height: 6000 });
  assert.deepEqual(V.previewDecision(png(20000, 20000)), { ok: false, reason: 'too-large' });
  assert.deepEqual(V.previewDecision(jpeg([10, 10], [20000, 20000])), { ok: false, reason: 'too-large' }, 'SOF 둘 — 큰 쪽');
  assert.deepEqual(V.previewDecision(png(0, 10)), { ok: false, reason: 'unknown-size' });
  assert.deepEqual(V.previewDecision(png(10, 10).subarray(0, 12)), { ok: false, reason: 'unknown-size' });
  assert.deepEqual(V.previewDecision(u8('<svg/>')), { ok: false, reason: 'not-image' });
  assert.deepEqual(V.previewDecision(png(100, 100), 5000), { ok: false, reason: 'too-large' }, '상한 인자');
});

test('contentEncodings·decompressPlan(B-4, P6·P8·P9·Q1·Q5·Q13): 여러 줄·대소문자·identity를 정리하고, 정확히 한 층의 gzip·x-gzip·deflate만 푼다', () => {
  assert.deepEqual(V.contentEncodings([['Content-Type', 'text/plain'], ['Content-Encoding', ' GZIP ']]), ['gzip']);
  assert.deepEqual(V.contentEncodings([['content-encoding', 'gzip, identity'], ['Content-Encoding', 'br']]), ['gzip', 'br']);
  assert.deepEqual(V.contentEncodings([['Content-Encoding', 'identity'], ['Content-Encoding', '']]), []);
  assert.deepEqual(V.contentEncodings([]), []);
  assert.deepEqual(V.decompressPlan([]), { format: null, reason: 'none' });
  assert.deepEqual(V.decompressPlan(['gzip']), { format: 'gzip' });
  assert.deepEqual(V.decompressPlan(['x-gzip']), { format: 'gzip' });
  assert.deepEqual(V.decompressPlan(['deflate']), { format: 'deflate' });
  for (const e of [['br'], ['zstd'], ['compress'], ['aes128gcm'], ['dcb'], ['gzip ']]) assert.deepEqual(V.decompressPlan(e), { format: null, reason: 'unsupported' }, JSON.stringify(e));
  assert.deepEqual(V.decompressPlan(['gzip', 'gzip']), { format: null, reason: 'layered' });
  assert.deepEqual(V.decompressPlan(new Array(500).fill('gzip')), { format: null, reason: 'layered' });
});

test('inflate(B-5, P5): gzip 폭탄은 상한(10MiB 기본)에서 멈춘다 — limitHit, 결과는 정확히 상한 길이', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024));
  assert.ok(bomb.length < 1024 * 1024, `긍정 전제(O30): 폭탄은 1MiB 이하 (${bomb.length})`);
  const r = await V.inflate(new Uint8Array(bomb), 'gzip');
  assert.equal(r.limitHit, true);
  assert.equal(r.error, false);
  assert.equal(r.bytes.length, 10 * 1024 * 1024);
  const small = await V.inflate(new Uint8Array(bomb), 'gzip', 1000);
  assert.equal(small.bytes.length, 1000);
  assert.equal(small.limitHit, true);
});

test('inflate(B-4·B-5, P7·P9·Q2·Q3·Q6): 정상 gzip·deflate, deflate 라벨의 raw deflate는 한 번 더, 잘린 스트림은 앞부분 + error, 0바이트는 빈 결과, 깨진 입력은 throw하지 않는다', async () => {
  const text = 'sumun 압축 테스트 '.repeat(5000);
  const ok = await V.inflate(new Uint8Array(zlib.gzipSync(text)), 'gzip');
  assert.ok(ok?.bytes instanceof Uint8Array, '결과 bytes는 Uint8Array');
  assert.equal(Buffer.from(ok.bytes).toString(), text);
  assert.equal(ok.error, false);
  assert.equal(ok.limitHit, false);
  assert.equal(Buffer.from((await V.inflate(new Uint8Array(zlib.deflateSync(text)), 'deflate')).bytes).toString(), text);
  const raw = await V.inflate(new Uint8Array(zlib.deflateRawSync(text)), 'deflate');
  assert.equal(Buffer.from(raw.bytes).toString(), text, 'raw deflate 다시 시도(Q2)');
  assert.equal(raw.error, false);
  const random = Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 251));
  const gz = zlib.gzipSync(random);
  const cut = await V.inflate(new Uint8Array(gz.subarray(0, Math.floor(gz.length / 2))), 'gzip');
  assert.equal(cut.error, true, '잘림은 error');
  assert.ok(cut.bytes.length > 0 && Buffer.from(cut.bytes).equals(random.subarray(0, cut.bytes.length)), `앞부분은 원본과 같다(${cut.bytes.length})`);
  const empty = await V.inflate(new Uint8Array(0), 'gzip');
  assert.deepEqual([empty.bytes.length, empty.error, empty.limitHit], [0, false, false]);
  const junk = await V.inflate(u8('this is not gzip at all'), 'gzip');
  assert.equal(junk.error, true);
});

test('downloadName(B-6, P13·P15): 기록과 무관한 고정 이름 sumun-<id>-<request|response>.bin, 이상한 값은 sumun-body.bin', () => {
  assert.equal(V.downloadName(12, 'response'), 'sumun-12-response.bin');
  assert.equal(V.downloadName(1, 'request'), 'sumun-1-request.bin');
  for (const [id, part] of [[-1, 'response'], [1.5, 'request'], ['3', 'response'], [3, '../x'], [3, 'response"; filename*=x.html'], [Number.MAX_SAFE_INTEGER + 2, 'request']]) assert.equal(V.downloadName(id, part), 'sumun-body.bin', JSON.stringify([id, part]));
});

test('화면 소스(B-1·B-6·B-7): 미리보기는 createImageBitmap → canvas(버튼을 눌렀을 때), 비트맵을 닫고, 저장은 showSaveFilePicker, 압축은 inflate·decompressPlan으로', () => {
  const app = code('app.js');
  for (const s of ['createImageBitmap', "createElement('canvas')", 'getContext', '.close()', 'showSaveFilePicker', 'previewDecision', 'decompressPlan', 'contentEncodings', 'inflate(', 'downloadName']) assert.ok(app.includes(s), `app.js에 ${s}`);
  const css = code('app.css');
  assert.ok(/\.preview\b/.test(css) && /max-width/.test(css) && /max-height/.test(css), 'app.css: 미리보기 상자 크기 제한(P12)');
});
