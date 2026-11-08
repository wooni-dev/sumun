// [UI-6 검토] 요구 5: Node가 헤더 값·상태 문구의 바이트를 어떤 글자로 주는지, latin1 → UTF-8로 다시 풀면 어떤 글자가 화면에 나타나는지,
// 지금 showHidden(view.js)이 그 글자를 ⟨U+XXXX⟩로 바꾸는지 본다. 서버는 127.0.0.1에만 열고 끝나면 닫는다.
// 실행: node scripts/probe/ui6-review/utf8-headers.mjs
import http from 'node:http';
import net from 'node:net';
import { showHidden } from '../../../src/dashboard/public/view.js';

// 1) 요청 헤더: 원시 바이트로 보낸 값을 Node가 rawHeaders로 어떻게 주는지
const got = [];
const srv = http.createServer((req, res) => { got.push(req.rawHeaders); res.end(); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const send = (bytes) => new Promise((r) => {
  const s = net.connect(srv.address().port, '127.0.0.1', () => s.write(bytes));
  let out = ''; s.on('data', (d) => (out += d.toString('latin1'))); s.on('close', () => r(out.split('\r\n')[0])); s.on('error', () => r('error'));
  setTimeout(() => s.destroy(), 500);
});
const cases = {
  'RLO U+202E (E2 80 AE)': Buffer.from([0xe2, 0x80, 0xae]),
  'Hangul filler U+3164 (E3 85 A4)': Buffer.from('ㅤ', 'utf8'),
  'TAG LATIN A U+E0041 (F3 A0 81 81)': Buffer.from('\u{E0041}', 'utf8'),
  'LINE SEP U+2028': Buffer.from(' ', 'utf8'),
  'overlong "/" (C0 AF)': Buffer.from([0xc0, 0xaf]),
  'lone continuation (80)': Buffer.from([0x80]),
  'latin1 é (E9)': Buffer.from([0xe9]),
  'UTF-8 é (C3 A9)': Buffer.from([0xc3, 0xa9]),
  'U+FEFF BOM (EF BB BF)': Buffer.from([0xef, 0xbb, 0xbf]),
  'surrogate CESU (ED A0 80)': Buffer.from([0xed, 0xa0, 0x80]),
  'variation selector U+FE0F': Buffer.from('️', 'utf8'),
  'deprecated format U+206A': Buffer.from('⁪', 'utf8'),
  'combining grapheme joiner U+034F': Buffer.from('͏', 'utf8'),
  'Mongolian vowel sep U+180E': Buffer.from('᠎', 'utf8'),
  'interlinear anchor U+FFF9': Buffer.from('￹', 'utf8'),
};
for (const [name, v] of Object.entries(cases)) {
  got.length = 0;
  const status = await send(Buffer.concat([Buffer.from('GET / HTTP/1.1\r\nHost: a\r\nX-T: a'), v, Buffer.from('b\r\nConnection: close\r\n\r\n')]));
  const raw = got[0]?.[3];
  if (raw === undefined) { console.log(`${name}: Node 거절(${status})`); continue; }
  const codes = [...raw].map((c) => c.codePointAt(0).toString(16)).join(' ');
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  let fatal; try { fatal = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fatal = '(fatal 디코드 실패)'; }
  const loose = new TextDecoder('utf-8').decode(bytes);
  console.log(`${name}: 저장 글자=[${codes}] 지금 화면=${JSON.stringify(showHidden(raw))} | 다시 풀기(fatal)→showHidden=${JSON.stringify(typeof fatal === 'string' && !fatal.startsWith('(') ? showHidden(fatal) : fatal)} | 느슨히 풀기→${JSON.stringify(showHidden(loose))}`);
}
srv.close();

// 2) 응답 상태 문구: UTF-8 바이트 reason을 Node 클라이언트가 statusMessage로 어떻게 주는지
const raw = net.createServer((s) => s.once('data', () => s.end(Buffer.concat([Buffer.from('HTTP/1.1 200 '), Buffer.from('OK ‮gnp.exe 완료', 'utf8'), Buffer.from('\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')]))));
await new Promise((r) => raw.listen(0, '127.0.0.1', r));
const msg = await new Promise((r) => http.get({ host: '127.0.0.1', port: raw.address().port, path: '/' }, (res) => (res.resume(), r(res.statusMessage))).on('error', (e) => r(`error ${e.code}`)));
const mb = Uint8Array.from(msg, (c) => c.charCodeAt(0));
console.log(`상태 문구: 지금 화면=${JSON.stringify(showHidden(msg))} | 다시 풀기→showHidden=${JSON.stringify(showHidden(new TextDecoder().decode(mb)))} | 풀고 나서 showHidden을 하지 않으면=${JSON.stringify(new TextDecoder().decode(mb))}`);
raw.close();

// 3) 저장 글자에 U+00FF보다 큰 글자가 섞이면(가정): charCodeAt & 0xFF로 바이트를 만들면 다른 글자가 된다
const weird = 'aŁb'; // U+0141
console.log(`U+0141을 Uint8Array로 자르면: ${JSON.stringify(new TextDecoder().decode(Uint8Array.from(weird, (c) => c.charCodeAt(0))))}`);
