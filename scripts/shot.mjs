#!/usr/bin/env node
/**
 * 用 Chrome DevTools Protocol 打开页面、可选执行一段脚本、然后截图。
 * 用法： node scripts/shot.mjs <url> <out.png> [scriptFile] [waitMs]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve(import.meta.dirname, '..');
const udd = path.join(root, '.chrome', 'profile');
const port = 9333;

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = path.resolve(root, process.argv[3] ?? '.chrome/shot.png');
const scriptFile = process.argv[4];
const waitMs = Number(process.argv[5] ?? 2600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(u) {
  const res = await fetch(u);
  return res.json();
}

async function main() {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${udd}`,
      '--window-size=1600,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch {
      await sleep(150);
    }
  }
  if (!version) throw new Error('Chrome 没起来');

  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面 target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send('Page.navigate', { url });
  await sleep(waitMs);

  if (scriptFile) {
    const code = fs.readFileSync(path.resolve(root, scriptFile), 'utf8');
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${code} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      console.error('脚本出错:', JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
    } else if (res.result?.value !== undefined) {
      console.log('脚本返回:', JSON.stringify(res.result.value));
    }
    await sleep(900);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);

  ws.close();
  child.kill('SIGKILL');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});