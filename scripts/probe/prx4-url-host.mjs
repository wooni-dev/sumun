// [PRX-4 실측] E48: 요약 줄의 호스트 칸은 WHATWG URL의 hostname에서 온다. 위장·제어 문자가 그 단계에서 걸러지는지 본다
//   node scripts/probe/prx4-url-host.mjs
const cases = {
  'IDN(키릴 а)': 'http://аpple.com/',
  '퍼센트 인코딩 CR/LF': 'http://a%0d%0ab/',
  '퍼센트 인코딩 ESC': 'http://a%1bb/',
  'bidi 제어 문자(U+202E)': 'http://moc‮knab/',
  'U+2028': 'http://a b/',
  'userinfo': 'http://user:SECRET@example.com/',
  '대문자': 'http://EXAMPLE.com/',
};
for (const [name, url] of Object.entries(cases)) {
  let out;
  try {
    out = `hostname=${JSON.stringify(new URL(url).hostname)}`;
  } catch (e) {
    out = `예외 ${e.code ?? e.name}`;
  }
  console.log(`${name.padEnd(24)} → ${out}`);
}
