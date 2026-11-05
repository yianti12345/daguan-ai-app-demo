#!/usr/bin/env node
/* probe —— 通用量测器：把任意一段 JS 丢进真浏览器里跑，把结果打回 stdout。
 *
 * 为什么有它：之前每量一次都要现写一个 200 行的 CDP 脚本，
 * 写脚本的时间比量本身长，而且每次各写一份 CDP 连接代码就会各踩一遍坑。
 * 这个只做一件事：连上无头 Chrome → 打开一个 URL → 执行表达式 → 打 JSON。
 *
 * 用法：
 *   node tools/probe.mjs <url> <exprFile> [--wait=1800] [--w=1440] [--h=900]
 *   node tools/probe.mjs <url> <exprFile> --eval   # 追加执行一次点击/输入等交互后再量
 *
 * 表达式文件约定：文件内容必须是**一个表达式**（IIFE 最外层带 return），
 * 返回值必须可 JSON 序列化。页面抛错会被当成失败（退出码 3），不静默吞掉。
 *
 * 退出码：0 有结果 ｜ 3 环境失败（Chrome 起不来 / 页面抛错）
 */
import { debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const file = args.find((a) => !a.startsWith('--') && !/^https?:\/\//.test(a));
if (!url || !file) {
  console.log('usage: node tools/probe.mjs <url> <exprFile> [--wait=1800] [--w=1440] [--h=900]');
  process.exit(2);
}
const opt = (k, d) => {
  const hit = args.find((a) => a.startsWith('--' + k + '='));
  return hit ? Number(hit.split('=')[1]) : d;
};
const WAIT = opt('wait', 1800);
const W = opt('w', 1440);
const H = opt('h', 900);
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/probe-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* Chrome 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
let seq = 0;
const wait = new Map();
const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(String(m.params.exceptionDetails.text).slice(0, 160));
  }
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  wait.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error("timeout " + method)), 120000);
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) {
    console.log('FATAL: 页面抛错 → ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
    process.exit(3);
  }
  return r.result.value;
};

await send('Page.navigate', { url });
await sleep(WAIT);

const raw = readFileSync(file, 'utf8');
/* 文件可以分成两段：主表达式 + `/*__after__*\/` 之后的"跳转后量一次"。
   先切再执行 —— 直接拼在一起会因为少分号被 ASI 连成一个调用。 */
const SPLIT = '/*__after__*/';
const [mainExpr, afterExpr] = raw.split(SPLIT).map((x) => x.trim());
let out;
try {
  out = await ev(mainExpr);
} catch (e) {
  if (!/navigated|closed|Context/i.test(String(e.message))) throw e;
  await sleep(1200);
  out = { __navigated: true, url: await ev('location.href') };
}
if (afterExpr) {
  try { out = { ...(out || {}), after: await ev(afterExpr) }; }
  catch (e2) { out.afterErr = String(e2.message).slice(0, 120); }
}
console.log(JSON.stringify(out, null, 2));

/* 顺手截一张，省得再起一次浏览器。--shot=/tmp/x.png */
const shotArg = args.find((a) => a.startsWith('--shot='));
if (shotArg) {
  const p = shotArg.split('=')[1];
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const fs = await import('node:fs');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('shot → ' + p);
}
if (errs.length) console.log('⚠ 页面异常 ' + errs.length + ' 条：' + errs.join(' | '));
chrome.kill();
process.exit(0);
