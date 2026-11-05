#!/usr/bin/env node
/* check-blue-clickable —— 「品牌蓝只能给真能点的东西」运行时判据（2026-11-05 立）
 *
 * 用户原话：
 *   「已就绪还是蓝色的字体，用户以为可以点击呢」
 *   「准是优先，然后是快。你在生成是处理掉不就好了吗？每次加 3~5 分钟，每次调整的地方扫一下不行吗？」
 *
 * 所以两条硬要求：
 *   1) **准**：不看 CSS 源码猜，开真浏览器量 computed color + 是否可点（源码里 var() 层层引用，
 *      静态判必然误伤 hover/状态色）。
 *   2) **快**：默认只扫"这一轮改过的页面"（近 30 分钟内动过的 html），不再每次全站 14 页。
 *      要全站时显式 --all。
 *
 * 判法：可见元素，文字颜色等于品牌蓝（用页面里 <a> 的 computed 色做基准，不写死色值），
 *      但没有落在可点容器里（a[href]/button/[role=button]/[role=switch]/[data-act]/[data-do]/
 *      label[for]/summary/select），且 cursor 不是 pointer ⇒ 红。
 *      纯装饰（宽或高 < 4px）与禁用态不算。
 *
 * 用法：
 *   node tools/check-blue-clickable.mjs               只扫最近改过的页面
 *   node tools/check-blue-clickable.mjs --all         全站
 *   node tools/check-blue-clickable.mjs --pages=ability.html,skills.html
 *   node tools/check-blue-clickable.mjs --negctl      注入一个假样本，必须红
 * 退出码：0 通过 ｜ 2 有违规 ｜ 3 浏览器/服务不可用
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBase } from './base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const NEG = process.argv.includes('--negctl');
const ALL = process.argv.includes('--all');
const PAGES_ARG = (process.argv.find((a) => a.startsWith('--pages=')) || '').split('=')[1];

function pickPages() {
  if (PAGES_ARG) return PAGES_ARG.split(',').filter(Boolean);
  const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  if (ALL) return all;
  /* 默认：近 30 分钟改过的页面；一页都没有就扫这三页（这一段的战场） */
  const now = Date.now();
  const fresh = all.filter((f) => now - fs.statSync(path.join(ROOT, f)).mtimeMs < 30 * 60 * 1000);
  return fresh.length ? fresh : ['ability.html', 'abilities.html', 'interfaces.html'];
}

const PROBE = `(() => {
  function colorOf(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = 'x';
    e.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.appendChild(e);
    const c = getComputedStyle(e).color;
    e.remove();
    return c;
  }
  const BRAND = colorOf('a');           /* 全站 a{color:var(--color-brand)} */
  const ok = (el) => !!el.closest('a[href],button,[role=button],[role=switch],[data-act],[data-do],label[for],summary,select');
  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.color !== BRAND) return;
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    if (ok(el)) return;
    if (cs.cursor === 'pointer') return;
    if (el.closest('button[disabled],[aria-disabled="true"]')) return;
    out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), text: (el.textContent || '').trim().slice(0, 28) });
  });
  return JSON.stringify(out);
})()`;

const BASE = await resolveBase().catch((e) => { console.error('FATAL: ' + e.message); process.exit(3); });
const pages = pickPages();
const port = 9300 + Math.floor(Math.random() * 400);
let chrome;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port, '--user-data-dir=/tmp/blc-' + Date.now(), '--remote-allow-origins=*',
    '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
  { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch (e) { /* 还没起 */ }
    await sleep(120);
  }
  throw new Error('Chrome 没起来');
}

const wsUrl = await connect().catch((e) => { console.error('FATAL: ' + e.message); try { chrome.kill(); } catch (x) {} process.exit(3); });
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const waiting = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
function send(method, params) {
  return new Promise((res) => {
    const myId = ++id;
    waiting.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
}

await send('Page.enable');
await send('Runtime.enable');

const bad = [];
for (const p of pages) {
  await send('Page.navigate', { url: BASE + '/' + p });
  await sleep(520);
  if (NEG) {
    await send('Runtime.evaluate', { expression:
      "const d=document.createElement('span');d.id='neg-blue';d.textContent='已就绪';d.style.color='var(--color-brand)';document.body.appendChild(d)" });
    await sleep(60);
  }
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const val = r.result && r.result.result && r.result.result.value;
  let list = [];
  try { list = JSON.parse(val || '[]'); } catch (e) { list = []; }
  for (const it of list) bad.push({ page: p, ...it });
  console.log('  ' + (list.length ? '✗' : '✓') + ' ' + p + (list.length ? '（' + list.length + ' 处）' : ''));
}

ws.close();
try { chrome.kill(); } catch (e) {}

if (!bad.length) {
  console.log('✓ 品牌蓝只出现在能点的东西上（扫 ' + pages.length + ' 页：' + pages.join('、') + '）');
  process.exit(NEG ? 2 : 0); /* 负控必须红 */
}
console.log('✗ 蓝色但不可点：' + bad.length + ' 处');
for (const b of bad) console.log('  ' + b.page + '  <' + b.tag.toLowerCase() + ' class="' + b.cls + '">「' + b.text + '」');
console.log('\n修法：不需要点的就不许上品牌色（正文色/次要色）；要能点就改成 a/button/[data-act]。');
process.exit(2);
