// [SEC-3] 재현 테스트(O26 ②): 해제 실측에서 사용자가 창을 닫자 실패 원인(터미널 "예" 입력으로 취소인지, certutil 실패인지)을 알 수 없었다.
//   runCaCommand(cmd, { …, log }) — install·uninstall은 단계·지문·certutil 종료 코드·결과를 log에 한 줄씩 남긴다(키·비밀 없음)
//   "예"·"네"·"y"처럼 예의 뜻인 입력은 여전히 취소(결정 C1)하되 "영어 yes"를 입력해야 한다고 안내한다
// 진짜 저장소는 쓰지 않는다(가짜 저장소).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto, { X509Certificate } from 'node:crypto';
import { loadOrCreateCA } from '../../src/ca/ca.ts';
import { runCaCommand } from '../../src/ca/command.ts';

const temps: string[] = [];
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const newCA = async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-sec3log-'));
  temps.push(d);
  const dir = path.join(d, 'ca');
  const ca = await loadOrCreateCA(dir);
  const der = Buffer.from(new X509Certificate(ca.certPem).raw);
  return { dir, der, sha1: crypto.createHash('sha1').update(der).digest('hex').toUpperCase() };
};
// removeCode: 가짜 certutil -delstore의 종료 코드. removes = 실제로 지우는가
function store(o: { user: { sha1: string; der: Buffer }[]; removeCode?: number; removes?: boolean; addCode?: number }) {
  const s = {
    user: [...o.user],
    calls: 0,
    async userRoot() {
      return [...s.user];
    },
    async machineRootThumbprints() {
      return [];
    },
    async add(der: Buffer) {
      s.calls++;
      s.user.push({ sha1: crypto.createHash('sha1').update(der).digest('hex').toUpperCase(), der });
      return { code: o.addCode ?? 0 };
    },
    async remove(h: string) {
      s.calls++;
      if (o.removes !== false) s.user = s.user.filter((c) => c.sha1.toLowerCase() !== h.toLowerCase());
      return { code: o.removeCode ?? 0 };
    },
    async elevated() {
      return false;
    },
  };
  return s;
}
async function go(cmd: 'install' | 'uninstall', dir: string, st: ReturnType<typeof store>, answer: string | null) {
  let out = '';
  const log: string[] = [];
  const code = await runCaCommand(cmd, {
    store: st,
    caDir: dir,
    loadCA: loadOrCreateCA,
    checkDir: async () => null,
    input: { isTTY: true, readLine: async () => answer },
    write: (s: string) => void (out += s),
    log: (l: string) => void log.push(l),
  } as Parameters<typeof runCaCommand>[1]);
  return { code, out, log: log.join('\n') };
}

test('재현: uninstall에서 yes 뒤 certutil이 지우지 못하면(종료 코드 7) 기록에 명령·지문·종료 코드·"해제되지 않음"이 남는다', async () => {
  const { dir, der, sha1 } = await newCA();
  const st = store({ user: [{ sha1, der }], removeCode: 7, removes: false });
  const r = await go('uninstall', dir, st, 'yes');
  assert.equal(st.calls, 1, '전제: certutil을 불렀다');
  assert.notEqual(r.code, 0);
  assert.match(r.log, /uninstall/);
  assert.ok(r.log.includes(sha1), r.log);
  assert.match(r.log, /종료 코드 7/);
  assert.match(r.log, /해제되지 않/);
});

test('재현: uninstall에서 터미널에 "예"를 입력하면 취소되고, 화면에 "영어 yes" 안내, 기록에 "취소"와 입력 모양이 남는다', async () => {
  const { dir, der, sha1 } = await newCA();
  const st = store({ user: [{ sha1, der }] });
  const r = await go('uninstall', dir, st, '예');
  assert.equal(st.calls, 0, 'certutil을 부르지 않는다(결정 C1 그대로)');
  assert.notEqual(r.code, 0);
  assert.match(r.out, /영어 yes/);
  assert.match(r.log, /취소/);
  assert.match(r.log, /예/);
});

test('재현: install에서 "네"·"y"도 취소하고 "영어 yes" 안내. 정상 등록은 기록에 지문·종료 코드 0·"등록됨"', async () => {
  for (const a of ['네', 'y', 'Y']) {
    const { dir } = await newCA();
    const st = store({ user: [] });
    const r = await go('install', dir, st, a);
    assert.equal(st.calls, 0, a);
    assert.match(r.out, /영어 yes/, a);
  }
  const { dir, sha1 } = await newCA();
  const r = await go('install', dir, store({ user: [] }), 'yes');
  assert.equal(r.code, 0, r.out);
  assert.match(r.log, /install/);
  assert.ok(r.log.includes(sha1));
  assert.match(r.log, /종료 코드 0/);
  assert.match(r.log, /등록됨/);
});
