// [UI-7] 회귀 — 구현 전에도 통과해야 정상(O9): 0건 안내를 더해도 개수 문구·큰 목록 안내는 그대로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/dashboard/public/app.js', 'utf8');

test('UI-7 회귀: 개수 문구 "필터 결과 n건"·"n건"은 그대로', () => {
  assert.ok(app.includes('`필터 결과 ${all.length}건`'));
  assert.ok(app.includes('`${all.length}건`'));
});

test('UI-7 회귀: 큰 목록 안내 "최근 n건만 보입니다"는 그대로', () => {
  assert.ok(app.includes('최근 ${rows.length}건만 보입니다'));
});
