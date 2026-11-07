// [TLS-2b] 회귀: 구현 전에도 통과해야 정상(O9, O15). 사례 번호는 docs/ai/tls2-cases.md.
//   B31 임시 파일을 CA로 쓰지 않는다 — TLS-2 구현(36be5f9)에서도 이미 그렇다 [확인됨: red에서 통과]
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const temps: string[] = [];
function tmp(name: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2b-r-'));
  temps.push(d);
  return path.join(d, name);
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

test('B31: 임시 파일만 있고(내용이 정상 CA라도) ca 파일이 없으면 새로 만든다 — 임시 파일을 CA로 쓰지 않는다', async () => {
  const made = await loadOrCreateCA(tmp('src'));
  const dir = tmp('ca');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'ca-cert.pem.9-x.tmp'), made.certPem);
  fs.writeFileSync(path.join(dir, 'ca-key.pem.9-x.tmp'), made.keyPem);
  const ca = await loadOrCreateCA(dir);
  assert.notEqual(ca.certPem, made.certPem);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 2, '최근 임시 파일은 그대로');
});
