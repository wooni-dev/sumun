// [INFRA-1] 연속 실패 카운터
// 테스트를 실행할 때마다 "같은 테스트가 몇 번 연속 실패했는지" 센다.
// Claude가 직접 세면 막혀 있을 때 "한 번만 더"가 되기 쉬워서(개발 방식 27행), 프로그램이 센다.
import path from 'node:path';

export const STOP_AFTER = 3;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#10;': '\n' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#10);/g, (m) => ENTITIES[m]);

// node:test의 junit 출력 → [{ key: '상대경로::테스트이름', failed }]
// 속성 값 안에 '>'가 있어도 깨지지 않도록, 속성을 따옴표 단위로 읽는다.
export function parseJunit(xml, projectDir) {
  const results = [];
  const tag = /<testcase((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = tag.exec(xml))) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    let failed = 'failure' in attrs;
    let todo;
    if (!m[2]) {
      const end = xml.indexOf('</testcase>', tag.lastIndex);
      const body = xml.slice(tag.lastIndex, end);
      failed ||= body.includes('<failure');
      // [INFRA-9] todo는 <skipped type="todo" …> 태그로만 인정한다. 오류 메시지 본문의 글자는 '<'가 &lt;로 바뀌어 있어 여기 걸리지 않는다(사례 10)
      const skip = body.match(/<skipped((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/);
      const sa = skip ? Object.fromEntries([...skip[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])) : {};
      if (sa.type === 'todo') todo = sa.message ?? '';
    }
    const file = attrs.file ? path.relative(projectDir, attrs.file).replaceAll('\\', '/') : '?';
    results.push(todo === undefined ? { key: `${file}::${attrs.name}`, failed } : { key: `${file}::${attrs.name}`, failed, todo });
  }
  return results;
}

// 실패하면 +1, 통과하면 기록 삭제, 이번에 실행되지 않은 테스트는 그대로 둔다.
// [INFRA-9] exempt(결과)가 참인 실패(대기 중인 큰 단위 테스트)는 셈을 그대로 둔다. 지우면 대기 파일을 껐다 켜는 것만으로
// 셈이 초기화되는 우회로가 된다(사례 15).
export function updateStreak(prev, results, exempt = () => false) {
  const next = { ...prev };
  for (const r of results) {
    const { key, failed } = r;
    if (failed && exempt(r)) continue;
    if (failed) next[key] = (next[key] ?? 0) + 1;
    else delete next[key];
  }
  return next;
}

export const stopped = (counts) => Object.entries(counts).filter(([, n]) => n >= STOP_AFTER);

// ---------------------------------------------------------------------------
// [INFRA-9] 큰 단위 테스트의 대기(todo). 사례·결정은 docs/ai/infra9-cases.md.
// 큰 단위 테스트는 마지막 작은 단위가 끝날 때까지 실패하는 게 정상이다. 그 실패만 멈춤 장치에서 뺀다.
// 판정은 테스트 코드를 믿지 않는다(테스트는 실패한 뒤에도 스스로 todo로 바꿀 수 있다 — 검토자 실측). 이 실행기가 직접 본다.

// test/<폴더>/<큰단위ID>-T.test.ts|mjs — 대소문자 구분, 끝에 고정 (사례 6~9)
const BIG_FILE = /^test\/[a-z0-9-]+\/([A-Z]+)-T\.test\.(?:ts|mjs)$/;
// todo 이유: "대기: src/<경로>" — 저장소 루트 기준, src/ 아래, ..·역슬래시·공백 없음 (사례 4, 5, 8)
const WAIT = /^대기: (src\/(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)+)$/;

// 목적 나무에서 큰 단위(맨 위 가지 "├ [ID]" / "└ [ID]")만 고른다 (사례 2)
export function bigUnitsFromTree(text) {
  return new Set([...text.matchAll(/^ [├└] \[([A-Z]+)\]/gm)].map((m) => m[1]));
}

// 이 결과가 "대기 중인 큰 단위 테스트"인가. ctx = { bigUnits: Set, exists(경로), readFile(경로) }
export function bigUnitExempt(r, { bigUnits, exists, readFile }) {
  if (typeof r.todo !== 'string') return false;
  const file = r.key.split('::')[0];
  const id = file.match(BIG_FILE)?.[1];
  if (!id || !bigUnits.has(id)) return false;
  const wait = r.todo.match(WAIT)?.[1];
  if (!wait || wait.split('/').includes('..')) return false;
  if (exists(wait)) return false; // 대기하던 파일이 생겼으면 todo가 풀렸어야 한다 (사례 14)
  // 다른 파일이 -T 파일의 함수로 테스트를 등록하면 junit의 file이 -T로 기록된다. export가 있으면 예외를 주지 않는다 (사례 3)
  let text = '';
  try {
    text = readFile(file);
  } catch {
    return false;
  }
  return !/^\s*export\b/m.test(text);
}

// 큰 단위별 대기 수: { TLS: { todo: n, failed: m } } (사례 22). 규칙에 맞는 -T 파일의 todo만 센다
export function bigTodoSummary(results, { bigUnits }) {
  const out = {};
  for (const r of results) {
    if (typeof r.todo !== 'string') continue;
    const id = r.key.split('::')[0].match(BIG_FILE)?.[1];
    if (!id || !bigUnits.has(id)) continue;
    out[id] ??= { todo: 0, failed: 0 };
    out[id].todo++;
    if (r.failed) out[id].failed++;
  }
  return out;
}
