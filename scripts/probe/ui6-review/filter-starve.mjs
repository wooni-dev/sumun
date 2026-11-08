// [UI-6 검토] 요구 1: app.js handleMessage의 필터 재조회 방식(알림마다 clearTimeout + setTimeout 300ms)을 그대로 옮겨,
// 알림이 300ms보다 자주 오면 재조회가 한 번도 일어나지 않는지, 그리고 "느린 재조회 + 겹침"에서 늦게 끝난 옛 결과가 새 결과를 덮는지 본다.
// DOM 없이 타이머만 쓴다. 실행: node scripts/probe/ui6-review/filter-starve.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 지금 방식(app.js 253~256행과 같은 모양)
{
  let timer = 0, loads = 0;
  const onEvent = () => { clearTimeout(timer); timer = setTimeout(() => loads++, 300); };
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) { onEvent(); await sleep(200); }
  console.log(`[지금 방식] 200ms마다 알림 3초 동안 → 재조회 ${loads}번 (알림이 멈춘 뒤에야 1번)`);
  await sleep(400);
  console.log(`[지금 방식] 알림이 멈추고 400ms 뒤 → 재조회 ${loads}번`);
}

// 2) 1초마다 무조건 재조회하되 응답 순서를 확인하지 않는 경우(겹침): 첫 조회가 느리고 둘째가 빠르면 마지막에 남는 것은 옛 결과
{
  let shown = null;
  const fetchFiltered = (n, ms) => sleep(ms).then(() => `결과#${n}`);
  const load = (n, ms) => fetchFiltered(n, ms).then((r) => (shown = r));
  load(1, 1500); // 1번: 서버가 느림(쪽 20개)
  await sleep(1000);
  load(2, 100); // 1초 뒤 2번: 빠름
  await sleep(1000);
  console.log(`[겹침] 1번(느림)·2번(빠름) 뒤 화면에 남은 것 = ${shown} (2번이어야 맞음)`);
}
