// [TLS-2b] 새 동작: CA 보관 견고성. 사례 번호는 docs/ai/tls2-cases.md(배정 "2b").
//   만들기: 임시 파일(빈 채로 배타 생성) → 키 권한을 본인만 → 내용 → 하드 링크로 배타 배치 → 임시 파일 삭제. 실패하면 되돌린다
//   loadOrCreateCA(dir, { io }) — io: { writeFile(path, data), link(from, to), restrict(keyPath) } 테스트용 주입
//   오류 code 추가: CA_WRITE(쓰기·배치 실패), CA_ACL(권한 설정 실패), CA_NOT_FILE(CA 파일 자리가 링크·정션·폴더)
// 모두 임시 폴더에서. 키 PEM은 커밋하지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadOrCreateCA } from '../../src/ca/ca.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const ICACLS = path.join(SYS, 'icacls.exe');
const ME = execFileSync(path.join(SYS, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'latin1' }).trim().split(',').pop()!.replace(/"/g, '');
const KEY_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');

const temps: string[] = [];
function tmp(name = '') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-tls2b-'));
  temps.push(d);
  return name ? path.join(d, name) : d;
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const files = (dir: string) => ({ cert: path.join(dir, 'ca-cert.pem'), key: path.join(dir, 'ca-key.pem') });
const list = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const tmpsIn = (dir: string) => list(dir).filter((f) => f.endsWith('.tmp'));
const realWrite = (p: string, d: string) => fs.writeFileSync(p, d);
const realLink = (a: string, b: string) => fs.linkSync(a, b);

// 키 파일의 권한을 SDDL(SID로 적힘 — 언어와 무관)로 읽는다 [방법: scripts/probe/tls2b-fs.mjs E79b]
const ALIAS: Record<string, string> = { SY: 'S-1-5-18', BA: 'S-1-5-32-544', BU: 'S-1-5-32-545', AU: 'S-1-5-11', WD: 'S-1-1-0' };
function aclOf(f: string) {
  const out = path.join(tmp(), 'save.txt');
  execFileSync(ICACLS, [f, '/save', out], { stdio: 'ignore' });
  const sddl = fs.readFileSync(out).toString('utf16le').split(/\r?\n/)[1] ?? '';
  const dacl = sddl.slice(sddl.indexOf('D:'));
  const aces = [...dacl.matchAll(/\(([^;]*);[^;]*;([^;]*);[^;]*;[^;]*;([^)]*)\)/g)].map((m) => ({ type: m[1], rights: m[2], sid: ALIAS[m[3]] ?? m[3] }));
  return { protected: /^D:P/.test(dacl), aces, names: execFileSync(ICACLS, [f], { encoding: 'latin1' }) };
}
async function rejectsCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => (assert.equal(e?.name, 'CAError', `${e?.name}: ${e?.message}`), assert.equal(e.code, code), true));
}

// ---------------- 28·29: 쓰기 도중 실패 ----------------
test('B28·B29: 인증서 임시 파일을 반쯤 쓰다 실패 → CA_WRITE, ca 파일도 임시 파일도 남지 않고, 다음 실행은 정상', async () => {
  const dir = tmp('ca');
  const writeFile = (p: string, d: string) => {
    if (path.basename(p).startsWith('ca-cert.pem') && p.endsWith('.tmp')) {
      fs.writeFileSync(p, d.slice(0, d.length >> 1)); // 반만 쓰고
      throw Object.assign(new Error('디스크 가득 참(주입)'), { code: 'ENOSPC' });
    }
    realWrite(p, d);
  };
  await rejectsCode(loadOrCreateCA(dir, { io: { writeFile } } as any), 'CA_WRITE');
  assert.deepEqual(list(dir), [], `남은 파일: ${list(dir)}`);
  const ca = await loadOrCreateCA(dir);
  assert.equal(fs.readFileSync(files(dir).key, 'utf8'), ca.keyPem, '다음 실행은 새로 만든다');
  assert.deepEqual(list(dir), ['ca-cert.pem', 'ca-key.pem']);
});

test('B28: 키는 자리를 잡았는데 인증서 배치(link)가 실패 → 키를 되돌려 CA_WRITE, 아무것도 남지 않는다', async () => {
  const dir = tmp('ca');
  let keyPlaced = false;
  const link = (a: string, b: string) => {
    if (path.basename(b) === 'ca-cert.pem') throw Object.assign(new Error('배치 실패(주입)'), { code: 'EIO' });
    realLink(a, b);
    keyPlaced ||= path.basename(b) === 'ca-key.pem';
  };
  await rejectsCode(loadOrCreateCA(dir, { io: { link } } as any), 'CA_WRITE');
  assert.equal(keyPlaced, true, '전제: 키는 실제로 자리를 잡았었다');
  assert.deepEqual(list(dir), [], `남은 파일: ${list(dir)}`);
});

test('B28: 키 임시 파일 쓰기가 실패 → CA_WRITE, 아무것도 남지 않는다. 오류에 키가 없다', async () => {
  const dir = tmp('ca');
  let keyText = '';
  const writeFile = (p: string, d: string) => {
    if (path.basename(p).startsWith('ca-key.pem')) {
      keyText = d;
      throw Object.assign(new Error('쓰기 실패(주입)'), { code: 'EIO' });
    }
    realWrite(p, d);
  };
  let err: any;
  await loadOrCreateCA(dir, { io: { writeFile } } as any).catch((e) => (err = e));
  assert.equal(err?.code, 'CA_WRITE');
  assert.ok(keyText.includes(KEY_HEADER), '전제: 주입한 함수가 키를 받았다');
  const all = `${err.message}\n${err.stack}`;
  assert.equal(all.includes('PRIVATE KEY') || all.includes(keyText.split('\n')[3]), false);
  assert.deepEqual(list(dir), []);
});

test('B38: 키 권한 설정(restrict)이 실패하면 CA_ACL — 키를 쓰지 않고 아무것도 남기지 않는다(실패하면 닫힘)', async () => {
  const dir = tmp('ca');
  let called = 0;
  const restrict = async () => {
    called++;
    throw new Error('icacls 실패(주입)');
  };
  const wrote: string[] = [];
  const writeFile = (p: string, d: string) => (wrote.push(path.basename(p)), realWrite(p, d));
  await rejectsCode(loadOrCreateCA(dir, { io: { restrict, writeFile } } as any), 'CA_ACL');
  assert.equal(called, 1, '전제: 권한 설정을 불렀다');
  assert.equal(wrote.some((f) => f.startsWith('ca-key.pem')), false, '권한을 정하기 전에는 키 내용을 쓰지 않는다');
  assert.deepEqual(list(dir), []);
});

// ---------------- 30: 동시 호출 ----------------
test('B30: 같은 프로세스에서 빈 폴더에 5번 동시에 → 모두 같은 CA, 디스크와 같고, 임시 파일이 남지 않는다', async () => {
  const dir = tmp('ca');
  const all = await Promise.all(Array.from({ length: 5 }, () => loadOrCreateCA(dir)));
  const f = files(dir);
  const disk = { certPem: fs.readFileSync(f.cert, 'utf8'), keyPem: fs.readFileSync(f.key, 'utf8') };
  all.forEach((ca, i) => assert.deepEqual(ca, disk, `호출 ${i}`));
  assert.deepEqual(list(dir), ['ca-cert.pem', 'ca-key.pem']);
});

test('B30: 두 프로세스가 동시에(같은 순간에 출발) → 둘 다 같은 CA이고 디스크와 같다', async () => {
  const dir = tmp('ca');
  const go = path.join(tmp(), 'go');
  const url = pathToFileURL(path.join(REPO, 'src', 'ca', 'ca.ts')).href;
  const code = `
    const fs = await import('node:fs');
    const crypto = await import('node:crypto');
    const { loadOrCreateCA } = await import(${JSON.stringify(url)});
    while (!fs.existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 2));
    const ca = await loadOrCreateCA(${JSON.stringify(dir)});
    console.log('HASH ' + crypto.createHash('sha256').update(ca.certPem + ca.keyPem).digest('hex'));
  `;
  const run = () =>
    new Promise<string>((resolve) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (out += d));
      c.on('close', () => resolve(out));
    });
  const kids = [run(), run()];
  await new Promise((r) => setTimeout(r, 700)); // 둘 다 import를 마치고 기다리게
  fs.writeFileSync(go, '');
  const outs = await Promise.all(kids);
  const hashes = outs.map((o) => o.match(/HASH ([0-9a-f]{64})/)?.[1]);
  assert.ok(hashes.every(Boolean), `두 프로세스 모두 성공해야 함: ${outs.map((o) => o.slice(0, 300)).join(' | ')}`);
  const f = files(dir);
  const disk = crypto.createHash('sha256').update(fs.readFileSync(f.cert, 'utf8') + fs.readFileSync(f.key, 'utf8')).digest('hex');
  assert.deepEqual(hashes, [disk, disk]);
  assert.deepEqual(list(dir), ['ca-cert.pem', 'ca-key.pem']);
});

// ---------------- 31: 남은 임시 파일 ----------------
test('B31: 60초 넘은 우리 임시 파일은 지우고, 최근 것과 남의 파일은 그대로, 임시 파일을 CA로 쓰지 않는다', async () => {
  const dir = tmp('ca');
  fs.mkdirSync(dir);
  const old = path.join(dir, 'ca-key.pem.123-dead.tmp');
  const oldCert = path.join(dir, 'ca-cert.pem.123-dead.tmp');
  const fresh = path.join(dir, 'ca-key.pem.456-live.tmp');
  const notes = path.join(dir, 'notes.txt');
  for (const p of [old, oldCert, fresh, notes]) fs.writeFileSync(p, 'leftover');
  const past = new Date(Date.now() - 120_000);
  fs.utimesSync(old, past, past);
  fs.utimesSync(oldCert, past, past);
  const ca = await loadOrCreateCA(dir);
  assert.equal(typeof ca?.certPem, 'string');
  assert.equal(fs.existsSync(old) || fs.existsSync(oldCert), false, '오래된 우리 임시 파일은 지운다');
  assert.equal(fs.existsSync(fresh), true, '최근 임시 파일은 다른 프로세스가 쓰는 중일 수 있다');
  assert.equal(fs.readFileSync(notes, 'utf8'), 'leftover', '남의 파일은 건드리지 않는다');
  assert.deepEqual(list(dir), ['ca-cert.pem', 'ca-key.pem', 'ca-key.pem.456-live.tmp', 'notes.txt']);
});

// ---------------- 35: 심어 둔 링크 ----------------
test('B35: CA 파일 자리에 심어 둔 정션(살아 있음·끊어짐, 키·인증서 자리) → CA_NOT_FILE, 정션 너머에 아무것도 쓰지 않는다', async () => {
  for (const which of ['key', 'cert'] as const) {
    for (const dangling of [false, true]) {
      const dir = tmp('ca');
      fs.mkdirSync(dir);
      const target = tmp('elsewhere');
      fs.mkdirSync(target);
      const at = files(dir)[which];
      fs.symlinkSync(target, at, 'junction');
      if (dangling) fs.rmSync(target, { recursive: true });
      assert.equal(fs.lstatSync(at).isSymbolicLink(), true, '전제: 정션이 있다');
      await rejectsCode(loadOrCreateCA(dir), 'CA_NOT_FILE');
      if (!dangling) assert.deepEqual(list(target), [], '정션 너머가 비어 있다');
      assert.equal(fs.existsSync(files(dir)[which === 'key' ? 'cert' : 'key']), false, `${which}/${dangling}: 다른 쪽 파일을 만들지 않는다`);
      assert.equal(tmpsIn(dir).length, 0);
    }
  }
});

test('B35: 키는 정상 파일인데 인증서 자리가 폴더 → CA_NOT_FILE(손상·불완전과 구분)', async () => {
  const dir = tmp('ca');
  const ca = await loadOrCreateCA(dir);
  fs.rmSync(files(dir).cert);
  fs.mkdirSync(files(dir).cert);
  await rejectsCode(loadOrCreateCA(dir), 'CA_NOT_FILE');
  assert.equal(fs.readFileSync(files(dir).key, 'utf8'), ca.keyPem, '키는 그대로');
});

// ---------------- 38: 키 파일 ACL ----------------
test('B38: Users가 읽을 수 있게 상속하는 폴더에 만들어도 키 파일 권한은 본인 하나뿐(상속 차단). 인증서는 제한하지 않는다', async () => {
  const shared = tmp('shared');
  fs.mkdirSync(shared);
  execFileSync(ICACLS, [shared, '/grant', '*S-1-5-32-545:(OI)(CI)R'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(shared, 'plain.txt'), 'x');
  const plain = aclOf(path.join(shared, 'plain.txt'));
  assert.ok(plain.aces.some((a) => a.sid === 'S-1-5-32-545'), '전제: 이 폴더의 평범한 파일은 Users가 읽을 수 있다');

  const dir = path.join(shared, 'ca');
  await loadOrCreateCA(dir);
  const key = aclOf(files(dir).key);
  assert.equal(key.protected, true, '상속 차단(D:P)');
  assert.deepEqual(key.aces.map((a) => a.sid), [ME], `ACE: ${JSON.stringify(key.aces)}`);
  assert.equal(key.aces[0].type, 'A');
  for (const n of ['Users', 'Everyone', 'Authenticated Users', 'SYSTEM', 'Administrators']) assert.equal(key.names.includes(n), false, n);
  assert.ok(aclOf(files(dir).cert).aces.some((a) => a.sid === 'S-1-5-32-545'), '인증서는 공개 정보라 상속 그대로');
});

test('B38: PATH가 비어 있어도(엉뚱한 whoami·icacls가 먼저 잡히지 않게 절대 경로) 키 권한은 본인 하나뿐', async () => {
  const dir = tmp('ca');
  const url = pathToFileURL(path.join(REPO, 'src', 'ca', 'ca.ts')).href;
  const code = `const { loadOrCreateCA } = await import(${JSON.stringify(url)}); await loadOrCreateCA(${JSON.stringify(dir)}); console.log('DONE');`;
  const out = await new Promise<string>((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO, env: { ...process.env, PATH: '', Path: '' } });
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.stderr.on('data', (d) => (o += d));
    c.on('close', () => resolve(o));
  });
  assert.ok(out.includes('DONE'), `자식 프로세스: ${out.slice(0, 300)}`);
  assert.deepEqual(aclOf(files(dir).key).aces.map((a) => a.sid), [ME]);
});
