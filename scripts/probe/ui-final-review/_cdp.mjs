// [UI 큰 단위 끝 — 독립 검토] 작은 CDP 도우미: headless Chrome을 임시 프로필로 띄우고, 탭마다 세션을 연다.
// 콘솔 오류·예외·CSP 위반을 탭마다 모은다. Windows 인증서 저장소는 건드리지 않는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freePort, sleep } from './_env.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launch(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-uifinal-chrome-'));
  const port = await freePort();
  const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', ...extra, 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 75 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!ver) throw new Error('Chrome이 뜨지 않음');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id));
    else for (const f of listeners) f(d);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  return {
    send,
    on: (f) => listeners.push(f),
    version: ver.Browser,
    close: async () => {
      try {
        await send('Browser.close');
      } catch {}
      try {
        p.kill();
      } catch {}
      await sleep(500);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

export async function page(b, url) {
  const t = await b.send('Target.createTarget', { url: 'about:blank' });
  const a = await b.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const s = a.result.sessionId;
  const problems = [];
  b.on((d) => {
    if (d.sessionId !== s) return;
    if (d.method === 'Runtime.exceptionThrown') problems.push({ kind: 'exception', text: d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text });
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) problems.push({ kind: `console.${d.params.type}`, text: d.params.args?.map((x) => x.value ?? x.description).join(' ') });
    if (d.method === 'Log.entryAdded' && (d.params.entry.level === 'error' || d.params.entry.level === 'warning')) problems.push({ kind: `log.${d.params.entry.source}`, text: d.params.entry.text, url: d.params.entry.url });
    if (d.method === 'Page.javascriptDialogOpening') {
      problems.push({ kind: 'dialog', text: d.params.message });
      b.send('Page.handleJavaScriptDialog', { accept: true }, s);
    }
  });
  await b.send('Runtime.enable', {}, s);
  await b.send('Log.enable', {}, s);
  await b.send('Page.enable', {}, s);
  const ev = async (expr) => {
    const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s);
    if (r.result?.exceptionDetails) return { evalError: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const go = async (u) => {
    await b.send('Page.navigate', { url: u }, s);
    await sleep(1200);
  };
  if (url) await go(url);
  const waitFor = async (expr, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await ev(expr);
      if (v && !v.evalError) return v;
      if (Date.now() > end) return v;
      await sleep(150);
    }
  };
  return { s, eval: ev, go, waitFor, problems, close: () => b.send('Target.closeTarget', { targetId: t.result.targetId }) };
}
