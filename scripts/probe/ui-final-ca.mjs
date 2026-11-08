// [UI 결정 10] 실제 루트 CA 최종 확인: 사용자가 CA를 등록하고 `npm start -- --decrypt`를 띄운 상태에서
//   headless Chrome(임시 프로필, 인증서 무시 플래그 없음)이 sumun 프록시를 거쳐 실제 HTTPS 사이트를 열고,
//   같은 Chrome의 대시보드 탭에서 목록·실시간 추가·상세·필터를 본다.
// 실행: node scripts/probe/ui-final-ca.mjs <대시보드 주소(#t= 포함)> <사이트 URL> [프록시 주소=127.0.0.1:8080]
// 출력: 단계별 JSON 한 줄씩. 토큰은 출력하지 않는다.
import { launch, page } from './ui5b-review/cdp.mjs';

const [DASH, SITE, PROXY = '127.0.0.1:8080'] = process.argv.slice(2);
if (!DASH || !SITE) throw new Error('사용법: node scripts/probe/ui-final-ca.mjs <대시보드 주소> <사이트 URL> [프록시]');
const host = new URL(SITE).hostname;
const log = (k, v) => console.log(JSON.stringify({ [k]: v }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowsOf = `[...document.querySelectorAll('section.list tbody tr')]`;

const A = await launch([`--proxy-server=${PROXY}`]);
log('browser', A.version);
const docs = new Map(); // requestId -> 응답 요약(주 문서만)
const errors = [];
A.on((m) => {
  if (m.method === 'Network.responseReceived' && m.params.type === 'Document') {
    const r = m.params.response;
    const sd = r.securityDetails;
    docs.set(m.params.requestId, { url: r.url.replace(/#.*/, ''), status: r.status, protocol: r.protocol, issuer: sd?.issuer, subject: sd?.subjectName, certTransparency: sd?.certificateTransparencyCompliance });
  }
  if (m.method === 'Network.loadingFailed' && m.params.type === 'Document') errors.push(m.params.errorText);
  if (m.method === 'Security.visibleSecurityStateChanged') {
    const v = m.params.visibleSecurityState;
    errors.push(`security:${v.securityState}${v.certificateSecurityState?.certificateHasWeakSignature ? ' weak' : ''}`);
  }
});
try {
  // 1. 대시보드: 주소창에 붙여 넣은 것처럼 navigate(Sec-Fetch-Site: none)
  const d = await page(A);
  await A.send('Page.navigate', { url: DASH }, d.s);
  await sleep(2500);
  const dashText = await d.eval(`document.body.innerText.slice(0,200)`);
  const before = Number(await d.eval(`${rowsOf}.length`));
  log('1-dashboard', { opened: !/403/.test(dashText), head: dashText.split('\n').slice(0, 3), rows: before, addressAfter: await d.eval('location.pathname + location.hash') });

  // 2. 사이트 탭: 인증서 경고 없이 열리는지
  const t = await page(A);
  await A.send('Network.enable', {}, t.s);
  await A.send('Security.enable', {}, t.s);
  await A.send('Page.enable', {}, t.s);
  await A.send('Page.navigate', { url: SITE }, t.s);
  await sleep(8000);
  log('2-site', { title: await t.eval('document.title'), href: await t.eval('location.href'), interstitial: await t.eval(`!!document.querySelector('#main-frame-error, .interstitial-wrapper')`), documents: [...docs.values()], events: [...new Set(errors)] });

  // 3. 대시보드 탭은 새로고침 없이 그대로 — 실시간으로 늘었는지
  await sleep(1500);
  const rows = JSON.parse(await d.eval(`JSON.stringify(${rowsOf}.map(r=>[...r.children].map(c=>c.textContent)))`));
  const mine = rows.filter((r) => r[2]?.includes(host));
  log('3-realtime', { before, after: rows.length, siteRows: mine.length, sample: mine.slice(0, 5), live: await d.eval(`document.body.innerText.includes('실시간')`) });

  // 4. 상세: 사이트 주 문서 줄을 누른다
  const detail = await d.eval(`(async()=>{const tr=${rowsOf}.find(r=>r.children[1]?.textContent==='GET'&&r.children[2]?.textContent.startsWith(${JSON.stringify(`https://${host}/`)}));if(!tr)return 'no-row';tr.click();await new Promise(r=>setTimeout(r,1500));return document.querySelector('.detail').innerText})()`);
  log('4-detail', detail === 'no-row' ? detail : { lines: detail.split('\n').slice(0, 25), length: detail.length });

  // 5. 필터: 호스트 칸에 ⓐ www를 뺀 도메인(하위 도메인 포함) ⓑ 이름 일부(부분 일치는 하지 않는 설계 — filter.ts hostMatches)
  const domain = host.replace(/^www\./, '');
  for (const q of [domain, domain.split('.')[0]]) {
    await d.eval(`(()=>{document.querySelector('input.host').value=${JSON.stringify(q)};document.querySelector('form.filters').requestSubmit();})()`);
    await sleep(1500);
    const urls = JSON.parse(await d.eval(`JSON.stringify(${rowsOf}.map(r=>r.children[2]?.textContent))`));
    const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname; } catch { return u; } }))];
    log('5-filter', { query: q, rows: urls.length, hosts, allMatch: hosts.every((h) => h === q || h.endsWith(`.${q}`)), count: await d.eval(`document.querySelector('.count')?.textContent`) });
  }
  await d.eval(`(()=>{document.querySelector('input.host').value='';document.querySelector('form.filters').requestSubmit();})()`);
} finally {
  A.close();
}
