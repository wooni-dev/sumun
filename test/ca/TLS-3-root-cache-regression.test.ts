// [TLS-3] 회귀(O9): 루트 검사 결과를 기억하더라도 지켜야 하는 것 — 구현 전(6cff3df)에도 통과한다.
//   짝: 재현 테스트 test/ca/TLS-3-root-cache.test.ts
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

test('기억해 둔 루트와 인증서는 같아도 키가 다르면 기억을 쓰지 않고 거부한다(CA_BAD_ISSUER), 다른 루트도 각각 맞게 발급한다', async () => {
  await issueCert(root, ['a.example.com']);
  await assert.rejects(issueCert({ certPem: root.certPem, keyPem: other.keyPem }, ['a.example.com']), (e: any) => (assert.equal(e?.code, 'CA_BAD_ISSUER'), true));
  const w = watch(other.certPem);
  try {
    const l = await issueCert(other, ['b.example.com']);
    const x = new crypto.X509Certificate(l.certPem);
    assert.equal(x.verify(new crypto.X509Certificate(other.certPem).publicKey), true, '다른 루트로 서명');
    assert.ok(w.n.node + w.n.forge > 0, '처음 보는 루트는 검사한다');
  } finally {
    w.stop();
  }
});
