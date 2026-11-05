#!/usr/bin/env node
/* check-align —— 栅格左缘对齐（一行里所有块必须落在同一条竖线上）
 *
 * 为什么有它：2026-10-25 盲评（零上下文席）看图指出「工具栏按钮左缘比下方表格卡左缘
 * 多出约 8px，放大看就是没落在同一条栅格线上」。这类偏差 1–10px 级，肉眼要"挑"才看得见，
 * 但一屏里出现两条竖线，整页就显脏。它是纯几何量，必须由判据管，不能靠眼睛。
 *
 * 判定：页面主容器（.main）的每个直接子块，左缘之间的最大差 <= 1px、右缘同理。
 *   允许例外：显式 full-bleed（负外边距铺满）的块要在 tools/align-allow.tsv 落款。
 * 退出码：0 过 ｜ 2 有偏差 ｜ 3 未量（服务没起 / 量不到）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOW = join(HERE, 'align-allow.tsv');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = [['apps.html', '应用列表'], ['components.html', '组件库']];
const NEG = process.argv.includes('--negctl');

let fail = 0, pass = 0;
const ok = (t, d) => { pass++; console.log(`  ✓ ${t}${d ? ' · ' + d : ''}`); };
const bad = (t, d) => { fail++; console.log(`  ✗ ${t}${d ? ' · ' + d : ''}`); };

/* 允许清单：selector 片段 → 理由（空理由无效） */
function allowed(sel) {
  if (!existsSync(ALLOW)) return '';
  for (const line of readFileSync(ALLOW, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [pat, reason] = line.split('\t');
    if (pat && reason && reason.trim() && sel.includes(pat.trim())) return reason.trim();
  }
  return '';
}

const MEASURE = `(function(){
  var c = document.querySelector('.main');
  if (!c) return {err: 'no .main'};
  /* 量"看得见的边"，不是"盒子的边"：容器自己有内距时，盒子在 216、里面的第一个
     按钮却在 224 —— 这正是 2026-10-25 盲评两轮都指出的 8px，而本判据当时量盒子，
     于是判了 0 偏差（假绿）。现在把直接子元素的极值也算进来。 */
  function edges(el){
    var r = el.getBoundingClientRect(), L = r.left, R = r.right;
    for (var j = 0; j < el.children.length; j++) {
      var ch = el.children[j], cr = ch.getBoundingClientRect();
      if (cr.height < 4 || cr.width < 4) continue;
      var cs = getComputedStyle(ch);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cr.left < L) L = cr.left;
      if (cr.right > R) R = cr.right;
    }
    return {L: L, R: R};
  }
  var out = [];
  for (var i = 0; i < c.children.length; i++) {
    var el = c.children[i];
    var r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 8) continue;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    var e = edges(el);
    out.push({
      cls: (el.className || el.tagName).toString().split(' ')[0],
      id: el.id || '',
      left: Math.round(e.L * 10) / 10,
      right: Math.round(e.R * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10
    });
  }
  return {rows: out, mainLeft: Math.round(c.getBoundingClientRect().left * 10) / 10,
          padL: getComputedStyle(c).paddingLeft};
})()`;

let BASE = '';
try { BASE = await resolveBase(); } catch (e) { console.log('  ! 未量：' + e.message.slice(0, 60)); process.exit(3); }
if (!BASE) { console.log('  ! 未量：服务没起来'); process.exit(3); }
const PORT = await debugPort();   /* 唯一来源分配端口；debugPort 是 async，忘了 await 会让 Chrome 拿到 "[object Promise]" */

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/al-' + Date.now(), '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await SLEEP(120);
  try {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch (e) {}
}
if (!target) { console.log('  ! 未量：Chrome 起不来'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 20000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
};

setTimeout(() => { console.log('GATE TIMEOUT: 对齐判据 90s 没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 90000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

let unmeasured = 0;
for (const [url, label] of PAGES) {
  try {
    await send('Page.navigate', { url: BASE + '/' + url });
    await SLEEP(800);
    if (NEG) {
      await ev(`(function(){var b=document.querySelector('.main > *:nth-child(2)');
        if(b) b.style.marginLeft='9px'; return 1;})()`);
      await SLEEP(100);
    }
    const res = await ev(MEASURE);
    if (!res || res.err) { bad(label, '量不到主容器'); unmeasured++; continue; }
    const rows = res.rows.filter((r) => !allowed(r.cls));
    if (rows.length < 2) { ok(label, '只有一个块，无需对齐'); continue; }
    const L = rows.map((r) => r.left), R = rows.map((r) => r.right);
    const dL = Math.round((Math.max(...L) - Math.min(...L)) * 10) / 10;
    const dR = Math.round((Math.max(...R) - Math.min(...R)) * 10) / 10;
    const detail = rows.map((r) => `${r.cls}${r.id ? '#' + r.id : ''} L=${r.left}`).join(' · ');
    if (dL <= 1 && dR <= 1) ok(label, `${rows.length} 个块同一条竖线（L=${L[0]}，容差 1px）`);
    else {
      bad(label, `左缘最大差 ${dL}px、右缘最大差 ${dR}px`);
      console.log('     ' + detail);
    }
  } catch (e) { bad(label, '未量：' + e.message.slice(0, 50)); unmeasured++; }
}
try { chrome.kill('SIGKILL'); } catch (e) {}

console.log(`\n通过 ${pass} ｜ 偏差 ${fail}${unmeasured ? ` ｜ 未量 ${unmeasured}` : ''}${NEG ? '（负控：应判红）' : ''}`);
if (unmeasured && !fail) process.exit(3);
process.exit(fail ? 2 : 0);
