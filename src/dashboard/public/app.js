// [UI-5] 대시보드 화면(DOM 연결). 사례·결정: docs/ai/ui-cases.md(배정 "UI-5", D-3, D-4, D-9, D-11, D-14~D-16), STO 보고서 결정 4.
//
// 규칙:
//   - 기록에서 온 글자는 모두 textContent로만 넣는다. HTML로 해석하는 API를 쓰지 않는다(U19). 데이터로 링크·이미지 주소를 만들지 않는다(U22)
//   - 토큰은 주소의 # 뒤에서 읽어 Authorization 헤더로만 보낸다(D-3). 쿠키·브라우저 저장소를 쓰지 않는다(D-11, U50). fetch는 no-store
//   - 실시간은 fetch 스트림으로 읽는 SSE(D-4). 연결마다 hello가 오면 목록을 API로 다시 받는다(UI-4 결정 — 끊긴 동안의 일을 맞춘다)
//   - 필터가 켜져 있으면 알림마다(묶어서) 필터 목록을 서버에서 다시 받는다. 필터 규칙을 브라우저에 다시 짜지 않는다(저장소 규칙 하나만)
//   - 오류 문구는 고정이다. 입력이나 기록 내용을 문구에 넣지 않는다(U30)
//   - 본문은 텍스트·16진. [UI-5b] 래스터 이미지는 버튼으로 canvas 미리보기, 한 층 gzip·deflate는 10MiB까지 풀기, 원본 저장(docs/ai/ui5b-cases.md B-1~B-7)
//   [UI-6] 토큰은 읽자마자 주소에서 지우고 이 페이지의 메모리에만 둔다(사용자 결정 — 새로고침하면 다시 터미널 주소로). docs/ai/ui6-cases.md G-1~G-7
import { tokenFromHash, showHidden, hostLabel, displayUrl, clip, hexDump, bodyText, buildQuery, createSSEParser, createModel, previewDecision, contentEncodings, decompressPlan, inflate, downloadName, createRefresher, tunnelOutcome, utf8View } from './view.js';

const LIMITS = { domRows: 1000, url: 300, value: 4000, title: 8000, text: 256 * 1024, hex: 64 * 1024, pages: 20, idleMs: 45_000, pixels: 50_000_000, inflate: 10 * 1024 * 1024 };
const token = tokenFromHash(location.hash);
// G-3: 다른 일보다 먼저(실패 경로에서도 주소에 남지 않게 — K18). 새 기록 항목을 만들지 않고 state도 싣지 않는다(K15·K16)
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// K17: 같은 탭에서 새 #t= 주소로 오면 다시 읽어 새 토큰으로 연다(주소의 #은 그대로라 다시 읽은 페이지가 토큰을 읽고 지운다)
window.addEventListener('hashchange', () => {
  if (tokenFromHash(location.hash)) location.reload();
});
const model = createModel();
const ui = {};
const state = { query: '', filtered: [], selected: null, pending: null, renderQueued: false, everConnected: false };
// G-1(K1~K7): 필터가 켜져 있으면 알림이 계속 와도 1초 안에는 다시 받는다. 한 번에 하나만
const filterRefresh = createRefresher(() => loadFiltered(), { waitMs: 300, maxWaitMs: 1000 });

// --- DOM 도우미: 요소를 만들고 글자는 textContent로만 ---
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
const line = (s, max = LIMITS.value) => clip(showHidden(s), max);

function fatal(message) {
  const app = document.getElementById('app');
  app.replaceChildren(el('p', 'fatal', message));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, cache: 'no-store', credentials: 'omit', headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    fatal('접속 토큰이 맞지 않습니다. 대시보드를 다시 시작했다면 터미널에 새로 나온 주소(#t=…)로 여세요.');
    throw new Error('401');
  }
  return res;
}

// --- 화면 뼈대 ---
function build() {
  const app = document.getElementById('app');
  const top = el('header', 'top');
  top.append(el('h1', '', 'sumun'));
  ui.conn = el('span', 'conn', '연결 중');
  ui.run = el('span', 'run', '');
  top.append(ui.conn, ui.run, el('span', 'spacer'));
  ui.clear = el('button', 'danger', '기록 모두 지우기');
  ui.clear.type = 'button';
  top.append(ui.clear);

  ui.notice = el('div', 'notice');
  ui.notice.hidden = true;
  ui.warn = el('div', 'notice');
  ui.warn.hidden = true;

  const form = el('form', 'filters');
  const field = (label, cls, placeholder) => {
    const l = el('label', '', label);
    const i = el('input', cls);
    i.placeholder = placeholder;
    i.autocomplete = 'off';
    i.spellcheck = false;
    l.append(i);
    form.append(l);
    return i;
  };
  ui.host = field('호스트', 'host', 'example.com');
  ui.method = field('메서드', 'method', 'GET');
  ui.status = field('상태', 'status', '200');
  const apply = el('button', '', '필터 적용');
  apply.type = 'submit';
  const reset = el('button', '', '필터 끄기');
  reset.type = 'button';
  ui.ferr = el('span', 'err', '');
  ui.count = el('span', 'count', '');
  form.append(apply, reset, ui.ferr, el('span', 'spacer'), ui.count);

  const split = el('div', 'split');
  const list = el('section', 'list');
  const table = el('table');
  const head = el('tr');
  for (const h of ['#', '메서드', 'URL', '상태', '시간', '크기']) head.append(el('th', '', h));
  table.append(el('thead'), (ui.tbody = el('tbody')));
  table.tHead.append(head);
  ui.more = el('div', 'more');
  list.append(table, ui.more);
  ui.detail = el('section', 'detail');
  ui.detail.append(el('p', 'note', '목록에서 요청을 고르면 자세한 내용이 여기에 나옵니다.'));
  split.append(list, ui.detail);

  app.replaceChildren(top, ui.notice, ui.warn, form, split);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilter();
  });
  reset.addEventListener('click', () => {
    ui.host.value = ui.method.value = ui.status.value = '';
    applyFilter();
  });
  ui.tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr && tr.dataset.id) select(Number(tr.dataset.id));
  });
  // 지우기: 브라우저 확인 창 대신 두 번 누르기
  let armed = 0;
  ui.clear.addEventListener('click', async () => {
    if (!armed) {
      ui.clear.textContent = '한 번 더 누르면 모두 지웁니다';
      armed = setTimeout(() => ((armed = 0), (ui.clear.textContent = '기록 모두 지우기')), 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    ui.clear.textContent = '기록 모두 지우기';
    try {
      const r = await api('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.status === 204) {
        model.apply({ type: 'cleared' });
        state.filtered = [];
        showEmptyDetail();
        render();
      }
    } catch {}
  });
}

function setConn(text, cls) {
  ui.conn.textContent = text;
  ui.conn.className = `conn ${cls}`;
}

// --- 목록 ---
function statusCell(s) {
  if (s.state === 'pending') return ['진행 중', 's-pending'];
  if (s.tunnel) return tunnelOutcome(s)?.kind === 'failed' ? ['터널 실패', 's-bad'] : ['터널', '']; // [UI-6] G-2: 상세와 같은 판정(K34)
  if (s.status !== undefined) return [String(s.status), s.status >= 400 || s.statusFrom === 'proxy' ? 's-bad' : 's-ok'];
  if (s.error) return [String(s.error.code), 's-bad'];
  return ['-', ''];
}
function sizeText(s) {
  if (s.tunnel) return `↑${s.tunnel.bytesUp} ↓${s.tunnel.bytesDown}`;
  if (s.responseSize !== undefined) return `${s.responseSize}B`;
  return '';
}
function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  setTimeout(() => {
    state.renderQueued = false;
    render();
  }, 50);
}
function render() {
  const all = state.query ? state.filtered : model.rows();
  const rows = all.slice(0, LIMITS.domRows);
  const frag = document.createDocumentFragment();
  for (const s of rows) {
    const tr = el('tr');
    tr.dataset.id = String(s.id);
    if (s.id === state.selected) tr.className = 'selected';
    const [st, cls] = statusCell(s);
    tr.append(
      el('td', '', String(s.id)),
      el('td', '', line(s.method, 20)),
      el('td', 'url', line(displayUrl(s), LIMITS.url)),
      el('td', cls, st),
      el('td', '', s.durationMs === undefined ? '' : `${Math.round(s.durationMs)}ms`),
      el('td', '', sizeText(s)),
    );
    frag.append(tr);
  }
  ui.tbody.replaceChildren(frag);
  ui.count.textContent = state.query ? `필터 결과 ${all.length}건` : `${all.length}건`;
  ui.more.textContent = all.length > rows.length ? `최근 ${rows.length}건만 보입니다(나머지 ${all.length - rows.length}건은 필터로 좁혀 보세요).` : '';
}

// 목록 전체(또는 필터 결과)를 쪽마다 받는다(한 번에 500건 — UI-3)
async function fetchAll(query) {
  const items = [];
  let after = null;
  for (let page = 0; page < LIMITS.pages; page++) {
    const q = [query, after === null ? '' : `after=${after}`].filter(Boolean).join('&');
    const r = await api(`/api/flows${q ? `?${q}` : ''}`);
    if (r.status === 400) return null;
    if (!r.ok) throw new Error('list');
    const v = await r.json();
    items.push(...v.items);
    if (v.next === null) break;
    after = v.next;
  }
  return items;
}

// hello 뒤: 목록을 다시 받아 모델을 바꾼다. 받는 동안 온 알림은 모아 두었다가 뒤에 적용한다
async function reload() {
  state.pending = [];
  try {
    const items = await fetchAll('');
    model.apply({ type: 'cleared' });
    model.load(items ?? []);
  } catch {}
  const queued = state.pending;
  state.pending = null;
  for (const e of queued) model.apply(e);
  if (state.query) filterRefresh.now();
  render();
}

// refresher만 부른다(한 번에 하나). 받는 동안 필터를 바꿨으면 옛 조건의 결과는 버린다(K3)
async function loadFiltered() {
  const q = state.query;
  if (!q) return;
  let items;
  try {
    items = await fetchAll(q);
  } catch {
    return;
  }
  if (q !== state.query) return;
  if (items === null) {
    ui.ferr.textContent = '조회 조건이 올바르지 않습니다.';
    state.filtered = [];
  } else state.filtered = items.reverse();
  render();
}
function applyFilter() {
  const q = buildQuery({ host: ui.host.value, method: ui.method.value, status: ui.status.value });
  ui.ferr.textContent = '';
  if (q === null) {
    ui.ferr.textContent = '메서드는 영문자만, 상태는 숫자(최대 3자리)만 쓸 수 있습니다.';
    return;
  }
  state.query = q;
  if (q) filterRefresh.now();
  else filterRefresh.cancel(), render();
}

// --- 실시간(SSE) ---
function handleMessage({ data }) {
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'hello') {
    const firstRun = model.runId === undefined;
    if (model.setRun(data.runId) && !firstRun) {
      state.selected = null;
      showEmptyDetail();
      showNotice('대시보드가 다시 시작되어 새 실행의 기록을 보여 줍니다.');
    }
    ui.run.textContent = `실행 ${line(data.runId, 40)}`;
    reload();
    return;
  }
  if (state.pending) state.pending.push(data);
  else model.apply(data);
  if (data.type === 'cleared' && state.selected !== null) (state.selected = null), showEmptyDetail();
  if (data.type === 'evicted' && (data.ids ?? []).includes(state.selected)) (state.selected = null), showEmptyDetail();
  if (data.type === 'done' && data.summary?.id === state.selected) select(state.selected);
  if (state.query) filterRefresh.request();
  scheduleRender();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stream() {
  let delay = 1000;
  for (;;) {
    const ctrl = new AbortController();
    let idle = 0;
    // 하트비트(15초)가 끊기면 연결이 죽은 것으로 보고 다시 연결한다(F8)
    const watch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), LIMITS.idleMs);
    };
    try {
      watch();
      const res = await api('/api/events', { signal: ctrl.signal });
      if (res.status === 503) setConn('실시간 연결이 너무 많습니다 — 쓰지 않는 탭을 닫으세요', 'down');
      if (res.ok && res.body) {
        setConn('실시간', 'live');
        state.everConnected = true;
        delay = 1000;
        const parser = createSSEParser(handleMessage);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          watch();
          parser.push(value);
        }
      }
    } catch (e) {
      if (e?.message === '401') return;
    } finally {
      clearTimeout(idle);
    }
    if (ui.conn.textContent === '실시간') setConn('끊김 — 다시 연결하는 중', 'down');
    else if (!ui.conn.textContent.startsWith('실시간 연결이')) setConn('연결할 수 없음 — 다시 시도하는 중', 'down');
    await sleep(delay);
    delay = Math.min(delay * 2, 10_000);
  }
}

// --- 상세 ---
function showEmptyDetail() {
  ui.detail.replaceChildren(el('p', 'note', '목록에서 요청을 고르면 자세한 내용이 여기에 나옵니다.'));
}
function showNotice(text) {
  ui.notice.textContent = text;
  ui.notice.hidden = false;
}
// [UI-6] G-5: 헤더 값의 UTF-8 바이트(latin1 글자로 저장됨)를 풀 수 있으면 풀어 보이고, 표시와 원래 바이트를 함께(K9·K10·K12)
function utf8Text(v, max = LIMITS.value) {
  const u = utf8View(v);
  return u ? `${line(u.text, max)}  (UTF-8로 풀어 보임 · 원래 바이트 ${clip(u.hex, 600)})` : line(v, max);
}
function kvTable(rows, { utf8 = false } = {}) {
  const t = el('table', 'kv');
  const b = el('tbody');
  for (const [k, v] of rows) {
    const tr = el('tr');
    tr.append(el('td', '', line(k, 200)), el('td', '', utf8 ? utf8Text(v) : line(v)));
    b.append(tr);
  }
  t.append(b);
  return t;
}

function button(text) {
  const b = el('button', '', text);
  b.type = 'button';
  return b;
}

// [UI-5b] 이미지 미리보기(B-1·B-3·B-7): 버튼을 눌렀을 때만, 디코드 전에 크기를 판정하고, createImageBitmap → canvas로 그린다.
// blob:·data: URL과 <img>를 만들지 않는다(최상위로 열린 blob 문서는 대시보드 출처에서 스크립트가 돈다 — P1). 비트맵은 그린 뒤 바로 닫는다(P4·P17)
async function drawPreview(holder, bytes, d) {
  holder.replaceChildren(el('p', 'note', '그리는 중…'));
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${d.type}` }));
  } catch {
    return void holder.replaceChildren(el('p', 'note', '이미지를 그릴 수 없습니다(형식이 깨졌거나 브라우저가 지원하지 않음).'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const box = el('div', 'preview');
  box.append(el('p', 'note', `기록된 이미지 미리보기 — ${d.type.toUpperCase()} ${d.width}×${d.height}`), canvas);
  holder.replaceChildren(box);
}

// [UI-5b] 원본 저장(B-6): 기록 바이트 그대로, 기록과 무관한 고정 이름(.bin)으로, 저장 창(File System Access)에.
// 링크·blob URL·서버 URL을 쓰지 않는다 — 다운로드 기록에 주소(#t=토큰)가 남지 않고(P14), 형식에 따라 .htm이 붙지 않는다(P13)
async function saveOriginal(note, id, part, bytes) {
  if (typeof window.showSaveFilePicker !== 'function') return void (note.textContent = '이 브라우저는 저장 창을 지원하지 않습니다(Chrome·Edge에서 쓸 수 있습니다).');
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: downloadName(id, part) });
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
    note.textContent = '저장했습니다.';
  } catch (e) {
    if (e?.name !== 'AbortError') note.textContent = '저장하지 못했습니다.';
  }
}

// 본문: 받은 바이트를 텍스트·16진으로. [UI-5b] 한 층의 gzip·deflate는 10MiB까지 풀어 보이고(B-4·B-5), 원본과 푼 결과를 고를 수 있다.
// br·zstd·여러 겹은 풀지 않고 안내만(오류가 아님 — Q1)
function bodySection(id, part, msg) {
  const box = el('div');
  const size = el('p', 'note', `본문 ${msg.bodySize}바이트${msg.bodyTruncated ? ' (기록은 앞 1MiB까지)' : ''}`);
  box.append(size);
  if (!msg.bodySize) return box;
  const plan = decompressPlan(contentEncodings(msg.headers));
  const enc = contentEncodings(msg.headers).join(', ');
  const tabs = el('div', 'tabs');
  const tText = button('텍스트');
  const tHex = button('16진');
  const tRaw = button('원본');
  const tInflated = button('푼 결과');
  const bPreview = button('이미지 미리보기');
  const bSave = button('원본 저장');
  tRaw.hidden = tInflated.hidden = bPreview.hidden = true;
  tabs.append(tText, tHex, tRaw, tInflated, bPreview, bSave);
  const out = el('pre', 'body', '불러오는 중…');
  const info = el('p', 'note', '');
  const encInfo = el('p', 'note', '');
  const preview = el('div');
  const saveNote = el('p', 'note', '');
  box.append(tabs, encInfo, out, info, preview, saveNote);
  let original = null;
  let inflated = null;
  let source = 'raw';
  let mode = 'text';
  const current = () => (source === 'inflated' && inflated ? inflated : original);
  const show = () => {
    const bytes = current();
    if (!bytes) return;
    tText.className = mode === 'text' ? 'on' : '';
    tHex.className = mode === 'hex' ? 'on' : '';
    tRaw.className = source === 'raw' ? 'on' : '';
    tInflated.className = source === 'inflated' ? 'on' : '';
    if (mode === 'text') {
      const t = bodyText(bytes, LIMITS.text);
      out.className = 'body';
      out.textContent = t.text;
      info.textContent = t.truncated ? `앞 ${LIMITS.text / 1024}KiB만 보입니다.` : '';
    } else {
      const h = hexDump(bytes, LIMITS.hex);
      out.className = 'body hex';
      out.textContent = h.text;
      info.textContent = h.truncated ? `앞 ${LIMITS.hex / 1024}KiB만 보입니다.` : '';
    }
    // 미리보기 판정은 지금 보는 바이트(원본 또는 푼 결과)의 매직 바이트로만(B-2)
    const d = previewDecision(bytes, LIMITS.pixels);
    preview.replaceChildren();
    bPreview.hidden = !d.ok;
    if (!d.ok && d.reason === 'too-large') preview.append(el('p', 'note', '이미지가 너무 커서(5천만 픽셀 넘음) 미리보기를 하지 않습니다.'));
    if (!d.ok && d.reason === 'unknown-size') preview.append(el('p', 'note', '이미지 크기를 읽을 수 없어 미리보기를 하지 않습니다.'));
    bPreview.onclick = d.ok ? () => drawPreview(preview, bytes, d) : null;
  };
  const pick = (m, s) => () => {
    if (m) mode = m;
    if (s) source = s;
    show();
  };
  tText.addEventListener('click', pick('text'));
  tHex.addEventListener('click', pick('hex'));
  tRaw.addEventListener('click', pick(null, 'raw'));
  tInflated.addEventListener('click', pick(null, 'inflated'));
  bSave.addEventListener('click', () => original && saveOriginal(saveNote, id, part, original));
  api(`/api/flows/${id}/body/${part}`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then(async (buf) => {
      if (!buf) return void (out.textContent = '본문을 불러오지 못했습니다.');
      original = new Uint8Array(buf);
      mode = bodyText(original.subarray(0, 8192)).binary ? 'hex' : 'text';
      if (plan.format) {
        const r = await inflate(original, plan.format, LIMITS.inflate);
        inflated = r.bytes;
        source = 'inflated';
        tRaw.hidden = tInflated.hidden = false;
        mode = bodyText(inflated.subarray(0, 8192)).binary ? 'hex' : 'text';
        encInfo.textContent = `압축(${line(enc, 40)})을 풀었습니다: ${inflated.length}바이트${r.limitHit ? ' — 10MiB까지만 풀었습니다' : ''}${r.error ? ' — 끝까지 풀지 못했습니다(잘렸거나 뒤에 다른 바이트가 있음). 앞부분만 보입니다' : ''}`;
      } else if (plan.reason === 'unsupported') {
        mode = 'hex';
        encInfo.textContent = `압축(${line(enc, 40)})은 이 브라우저에서 풀 수 없어 원본 바이트로 보입니다.`;
      } else if (plan.reason === 'layered') {
        mode = 'hex';
        encInfo.textContent = `여러 겹 압축(${line(enc, 40)})은 풀지 않습니다. 원본 바이트로 보입니다.`;
      }
      show();
    })
    .catch(() => {});
  return box;
}

async function select(id) {
  state.selected = id;
  for (const tr of ui.tbody.children) tr.className = tr.dataset.id === String(id) ? 'selected' : '';
  let r;
  try {
    r = await api(`/api/flows/${id}`);
  } catch {
    return;
  }
  if (state.selected !== id) return;
  if (!r.ok) {
    ui.detail.replaceChildren(el('p', 'note', '진행 중이거나 지워진 기록입니다. 끝나면 다시 고르세요.'));
    return;
  }
  const f = await r.json();
  if (state.selected !== id) return;
  const q = f.request;
  const parts = [el('h2', '', `${line(q.method, 20)} ${line(displayUrl(q), LIMITS.title)}`)];
  const info = [];
  if (q.target) info.push(['목적지', `${hostLabel(q.target.host)} 포트 ${q.target.port}`]);
  info.push(['시작', new Date(f.startedAt).toLocaleString()], ['걸린 시간', `${Math.round(f.durationMs)}ms`], ['원래 요청 대상', q.url]);
  if (f.tls) info.push(['TLS SNI', f.tls.sni ?? '(없음)']);
  if (f.tunnel) info.push(['터널', `↑${f.tunnel.bytesUp} ↓${f.tunnel.bytesDown} 바이트, ${f.tunnel.address} — 암호화된 채로 지나가서 내용은 없습니다`]);
  // [UI-6] G-2: 데이터가 오간 뒤 브라우저가 닫은 터널은 "실패"가 아니라 "끝남"(원래 값도 함께). 목적지가 끊음·응답 없음은 실패 그대로(K31·K32)
  const to = tunnelOutcome(f);
  if (to?.kind === 'closed') info.push(['끝남', to.text]);
  else if (f.error) info.push(['실패', to?.kind === 'failed' ? to.text : `${f.error.code} (${f.error.by})${f.error.status ? ` → ${f.error.status}` : ''}`]);
  parts.push(kvTable(info));
  parts.push(el('h3', '', '요청 헤더'), kvTable(q.headers, { utf8: true }), el('h3', '', '요청 본문'), bodySection(id, 'request', q));
  if (f.response) {
    const s = f.response;
    parts.push(el('h3', '', `응답 ${s.status} ${utf8Text(s.statusMessage, 200)}`), kvTable(s.headers, { utf8: true }), el('h3', '', '응답 본문'), bodySection(id, 'response', s));
  } else parts.push(el('h3', '', '응답'), el('p', 'note', '목적지 응답이 없습니다.'));
  ui.detail.replaceChildren(...parts);
}

// --- 시작 ---
async function start() {
  if (!token) return fatal('접속 토큰이 없습니다. 토큰은 보안을 위해 주소에서 지우고 이 탭의 메모리에만 두기 때문에, 새로고침하면 다시 필요합니다. 터미널에 나온 대시보드 주소(127.0.0.1:…/#t=…)를 주소창에 붙여 넣어 여세요.');
  build();
  // U49: 이 주소(같은 포트)를 전에 쓴 다른 앱의 서비스 워커가 남아 있으면 요청을 가로챌 수 있다 — 알리고 등록을 푼다
  if (navigator.serviceWorker?.getRegistrations) {
    navigator.serviceWorker
      .getRegistrations()
      .then((rs) => {
        if (!rs.length) return;
        ui.warn.textContent = '이 주소에 다른 프로그램이 등록한 서비스 워커가 있어 해제했습니다. 페이지를 새로고침하세요.';
        ui.warn.hidden = false;
        for (const r of rs) r.unregister();
      })
      .catch(() => {});
  }
  try {
    const ping = await (await api('/api/ping')).json();
    if (ping.decrypt === false)
      showNotice('HTTPS 복호화가 꺼져 있습니다. HTTPS 요청은 연결이 끝난 뒤 목적지와 바이트 수만 보입니다. 내용을 보려면 루트 CA를 등록하고 npm start -- --decrypt로 시작하세요.');
  } catch {
    return;
  }
  stream();
}
start();
