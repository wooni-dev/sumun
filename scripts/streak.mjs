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
    if (!m[2]) {
      const end = xml.indexOf('</testcase>', tag.lastIndex);
      failed ||= xml.slice(tag.lastIndex, end).includes('<failure');
    }
    const file = attrs.file ? path.relative(projectDir, attrs.file).replaceAll('\\', '/') : '?';
    results.push({ key: `${file}::${attrs.name}`, failed });
  }
  return results;
}

// 실패하면 +1, 통과하면 기록 삭제, 이번에 실행되지 않은 테스트는 그대로 둔다.
export function updateStreak(prev, results) {
  const next = { ...prev };
  for (const { key, failed } of results) {
    if (failed) next[key] = (next[key] ?? 0) + 1;
    else delete next[key];
  }
  return next;
}

export const stopped = (counts) => Object.entries(counts).filter(([, n]) => n >= STOP_AFTER);
