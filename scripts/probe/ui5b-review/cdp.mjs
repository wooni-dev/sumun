// 작은 CDP 도우미: Chrome headless를 띄우고 페이지마다 세션을 연다
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
export async function launch(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumun-ui5b-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const p = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', ...extra, 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else listeners.forEach(f => f(d)); };
  const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { send, on: (f) => listeners.push(f), version: ver.Browser, dir, pid: p.pid, close: () => { try { p.kill(); } catch {} } };
}
export async function page(b, url) {
  const t = await b.send('Target.createTarget', { url: url ?? 'about:blank' });
  const a = await b.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const s = a.result.sessionId;
  await b.send('Runtime.enable', {}, s);
  await new Promise(r => setTimeout(r, 900));
  return { s, targetId: t.result.targetId, eval: async (expr) => { const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? JSON.stringify(r); } };
}
