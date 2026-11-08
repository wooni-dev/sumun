// [UI-7] 호스트 필터 0건 안내 — 새 동작(구현 전에는 실패해야 정상). UI 보고서 결정 23
//   view.js emptyFilterHint({ host, count }): 적용된 호스트 조건이 있고 0건이면 고정 문구, 아니면 ''. 문구에 입력값을 넣지 않는다.
//   app.js는 소스 검사(긍정 전제)와 브라우저 실측(E205)으로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as view from '../../src/dashboard/public/view.js';

const V = view as any;
const hint = (host: unknown, count: number) => String(V.emptyFilterHint({ host, count }) ?? '');

function code(file: string) {
  const p = `src/dashboard/public/${file}`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('UI-7: 호스트 조건이 이름 일부(example)이고 0건이면 "도메인 전체"와 예시 example.com을 알린다', () => {
  const h = hint('example', 0);
  assert.match(h, /도메인 전체/);
  assert.match(h, /example\.com/);
});

test('UI-7: 결과가 있으면 안내하지 않는다(0건이면 안내한다 — 긍정 전제)', () => {
  assert.notEqual(hint('example.com', 0), '', '긍정 전제: 0건이면 안내가 있어야 함');
  assert.equal(hint('example.com', 1), '');
  assert.equal(hint('example', 311), '');
});

test('UI-7: 호스트 조건이 비어 있으면(메서드·상태만 건 0건) 안내하지 않는다(호스트가 있으면 안내 — 긍정 전제)', () => {
  assert.notEqual(hint('a', 0), '', '긍정 전제: 호스트가 있고 0건이면 안내가 있어야 함');
  assert.equal(hint('', 0), '');
  assert.equal(hint('   ', 0), '');
  assert.equal(hint(undefined, 0), '');
  assert.equal(hint(null, 0), '');
});

test('UI-7: 문구는 고정이다 — 입력값을 되비추지 않는다', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const h = hint(evil, 0);
  assert.notEqual(h, '', '긍정 전제: 0건이면 안내가 있어야 함');
  assert.doesNotMatch(h, /<img|onerror/);
  assert.equal(h, hint('example', 0));
});

test('UI-7: app.js render()가 emptyFilterHint로 0건 안내를 그린다(가져오기와 호출)', () => {
  const app = code('app.js');
  assert.ok(app.length > 0, '긍정 전제: app.js를 읽어야 함');
  assert.match(app, /import\s*\{[^}]*\bemptyFilterHint\b[^}]*\}\s*from\s*['"]\.\/view\.js['"]/);
  const render = app.slice(app.indexOf('function render()'), app.indexOf('function render()') + 2000);
  assert.match(render, /emptyFilterHint\(/);
});
