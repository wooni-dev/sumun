// [TLS-3] 재현 테스트(O26): 같은 루트로 여러 번 발급할 때 루트 CA를 매번 다시 검사·파싱해서 동시 발급의 지연이 커지는 결함.
//   기록: docs/ai/progress.md "[TLS-3] 병합 뒤 발견한 결함", 실측 eee261b(1회 동기 2.4~3ms 중 루트 몫 1.4~1.9ms)
//   지연 시간은 부하에 따라 흔들리므로 파싱 횟수로 센다: crypto.X509Certificate와 forge.pki.certificateFromPem을 감시한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { loadOrCreateCA, issueCert } from '../../src/ca/ca.ts';

type Pair = { certPem: string; keyPem: string };
const temps: string[] = [];
const mk = async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls3c-'));
  temps.push(d);
  return loadOrCreateCA(path.join(d, 'ca'));
};
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
let root: Pair;
let other: Pair;
before(async () => {
  root = await mk();
  other = await mk();
});

// 루트 인증서 PEM을 인자로 받은 파싱만 센다
function watch(pem: string) {
  const OrigX = crypto.X509Certificate;
  const origF = forge.pki.certificateFromPem;
  const n = { node: 0, forge: 0 };
  (crypto as any).X509Certificate = new Proxy(OrigX, {
    construct(t, a) {
      if (a[0] === pem) n.node++;
      return new (t as any)(...a);
    },
  });
  (forge.pki as any).certificateFromPem = (p: string, ...rest: unknown[]) => (p === pem && n.forge++, (origF as any)(p, ...rest));
  return { n, stop: () => (((crypto as any).X509Certificate = OrigX), ((forge.pki as any).certificateFromPem = origF)) };
}

test('같은 루트로 20번(동시) 발급할 때, 첫 발급 뒤로는 루트 인증서를 다시 파싱하지 않는다', async () => {
  await issueCert(root, ['warm.example.com']); // 첫 발급은 루트를 검사한다
  const w = watch(root.certPem);
  try {
    new crypto.X509Certificate(root.certPem);
    forge.pki.certificateFromPem(root.certPem);
    assert.deepEqual(w.n, { node: 1, forge: 1 }, '전제: 감시가 루트 파싱을 센다');
    w.n.node = w.n.forge = 0;
    const all = await Promise.all(Array.from({ length: 20 }, (_, i) => issueCert(root, [`r${i}.example.com`])));
    assert.equal(all.filter((l) => typeof l?.certPem === 'string').length, 20, '전제: 20개 모두 발급됐다');
    assert.deepEqual(w.n, { node: 0, forge: 0 }, `루트 재파싱 횟수: ${JSON.stringify(w.n)}`);
  } finally {
    w.stop();
  }
});
