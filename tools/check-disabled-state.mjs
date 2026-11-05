#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────
   check-disabled-state.mjs —— 「已禁用」这条状态到底有没有被判过（第 34 门）

   为什么要有它（2026-10-24 独立评审席 pm-ue-critic-7 复评，14 条里的 P1）：
     components.html:189 会算 `const off = c.enabled === false`，:211 会渲染
     `<span class="card-tag is-off">已禁用</span>`，data.js:219 的 DB.canInstall
     也把 `enabled !== false` 当条件 —— 三处代码都在，但**8 条种子数据没有一条
     enabled:false**，所以这三处从没被任何判据跑过。反过来说：只要有禁用组件，
     它会以「已上架」的外观出现，且判据全绿。
     禁止为了让 chip 出现往种子数据里塞假数据（那等于把判据编成事实）。
     做法是在**真页面里**把一条组件的 enabled 临时置 false 再重渲染，然后断言。

   判什么（三条，缺一条就不算覆盖）：
     ① components.html：该卡的启用开关变成 aria-checked=false、文字「禁用」（2026-10-25 换主体）
     ② 同一页：DB.canInstall(该组件) === false（谓词真的吃 enabled）
     ③ app.html?id=hx-zc：装配面板里**看不到**它的名字，且「可装配 N」的 N
        等于 `DB.COMPS.filter(DB.canInstall).length`（同名组件不在候选里）

   用法：
     node tools/check-disabled-state.mjs            正控：rc=0
     node tools/check-disabled-state.mjs --negctl   负控：渲染后删掉 chip 节点再断言 ⇒ 必须 rc=2
   退出码：0 绿｜2 红｜3 未量（Chrome 起不来 / 服务找不到，不当绿）
   ───────────────────────────────────────────────────────────── */
import { spawn } from 'node:child_process';
import { resolveBase, debugPort } from './base.mjs';

const NEG = process.argv.includes('--negctl');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (ok, label, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!ok) fail++;
};
let fail = 0;

let BASE;
try { BASE = await resolveBase(); } catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/dis-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); chrome.kill('SIGKILL'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let seq = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.text).slice(0, 160));
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; wait.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 120000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面抛错：' + JSON.stringify(r.exceptionDetails.text));
  return r.result.value;
};
const go = async (url, ms = 2200) => {
  await send('Page.navigate', { url });
  await sleep(ms);
  for (let i = 0; i < 40; i++) {           /* 等到数据和首屏都就绪 */
    const ready = await ev('!!(window.DB && DB.COMPS && DB.COMPS.length && document.querySelector(".kcard, .canvas"))').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  await sleep(400);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  console.log('禁 用 态 判 据 @ ' + BASE + (NEG ? '（负控：渲染后删掉 chip 节点再断言）' : ''));

  /* 0) 先证明"这件事在此之前确实没被验过"：种子里 0 条禁用 */
  await go(`${BASE}/components.html`);
  /* ★2026-10-25 换形：组件页 2026-10-24 从 `4 列 .kcard 阵列` 改成 `#grid > .cl-head + 8 × .crow`
     行列表（B 方案）。本判据的主体一直写着 `.kcard[data-id]` ⇒ 换形后这页 .kcard = 0，
     ① ② 两条永远红，看起来像"禁用态没实现"，其实是被测对象不存在了（判据自己过期）。
     产品侧的 chip 一直在：components.html:389 `<span class="card-tag is-off">已禁用</span>`。
     主体跟着翻译到行上，断言一条不删、容差不放宽。 */
  const seed = await ev(`(() => ({
    comps: DB.COMPS.length,
    offNow: DB.COMPS.filter(c => c.enabled === false).length,
    cards: document.querySelectorAll('.crow').length,
    /* ★2026-10-25 换主体：卡片重做后状态不再是 .card-tag.is-off 那个 chip，
       而是卡头的启用/禁用开关（.cc-sw + aria-checked）。判据跟着翻译，容差不放宽：
       原来断言"有 chip 且文字是已禁用"，现在断言"同一张卡的开关 aria-checked=false 且写禁用"。 */
    offSw: [...document.querySelectorAll('.crow .cc-sw[aria-checked="false"]')].length
  }))()`);
  out(seed.offNow === 0,
    '改前基线：种子里 enabled=false 的组件 0 条',
    `组件 ${seed.comps} 条 · 卡 ${seed.cards} 张 · 已显示「禁用」的开关 ${seed.offSw} 个（含 2 条 status=已下架的，属页面既有状态，与本次无关）`);

  /* 1) 在真页面里把一条可装配组件置 false 并落盘 */
  const pick = await ev(`(() => {
    const c = DB.COMPS.filter(DB.canInstall)[0];
    if (!c) return null;
    c.enabled = false; DB.save();
    return { id: c.id, name: c.label || c.name };
  })()`);
  if (!pick) { console.log('FATAL: 没有可装配组件可用作被测对象'); chrome.kill('SIGKILL'); process.exit(3); }
  console.log(`  · 被测组件：${pick.name}（${pick.id}）enabled=false 已写入存档`);

  /* 2) 重渲染（同一浏览器 = 同一 localStorage，走的还是页面自己的 DB.load()） */
  await go(`${BASE}/components.html`);
  const after = await ev(`(() => {
    const id = ${JSON.stringify(pick.id)};
    const el = document.querySelector('.crow[data-id="' + id + '"]');
    let sw = el && el.querySelector('.cc-sw');
    ${NEG ? `if (sw) sw.setAttribute('aria-checked', 'true');` : ''}
    const chip = sw;
    return { hasCard: !!el, hasChip: !!chip,
             chipText: sw ? String(sw.textContent).trim() : null,
             checked: sw ? sw.getAttribute('aria-checked') : null,
             canInstall: DB.canInstall(DB.compById(id)),
             offCount: DB.COMPS.filter(c => c.enabled === false).length };
  })()`);
  out(after.hasCard, '① 被测卡仍在屏上（没有因为禁用而消失）', `off=${after.offCount}`);
  out(after.hasChip && after.checked === 'false' && after.chipText === '禁用',
    '② 该卡的开关变成「禁用」（aria-checked=false）',
    after.hasChip ? `aria-checked=${after.checked}，文字=「${after.chipText}」` : '没找到 .cc-sw');
  out(after.canInstall === false, '③ DB.canInstall 对它返回 false', `canInstall=${after.canInstall}`);

  /* 3) 装配面板的候选里它必须消失（真 DOM，不是只看谓词） */
  await go(`${BASE}/app.html?id=hx-zc`, 2400);
  const panel = await ev(`(() => {
    const id = ${JSON.stringify(pick.id)};
    const btn = document.querySelector('#act-assemble');
    if (!btn) return { err: '找不到「装配组件」按钮' };
    btn.click();
    const n = document.querySelector('#n-avail');
    const mask = document.querySelector('#mask');
    const txt = mask ? mask.innerText : '';
    /* 「可装配」= 能装 且 还没装（app.js listOf('avail') 的定义，两处口径必须一样） */
    const a = DB.appById('hx-zc') || { comps: [] };
    const expect = DB.COMPS.filter(c => DB.canInstall(c) && a.comps.indexOf(c.id) < 0).length;
    return { opened: !!(mask && !mask.hidden), nAvail: n ? Number(n.textContent.trim()) : null,
             expect: expect,
             nameOnScreen: txt.indexOf(${JSON.stringify(pick.name)}) >= 0,
             canInstall: DB.canInstall(DB.compById(id)) };
  })()`);
  if (panel.err) throw new Error(panel.err);
  out(panel.opened, '④ app.html 装配面板能打开');
  out(panel.nAvail === panel.expect, '⑤ 「可装配」计数 = 谓词现算', `面板 ${panel.nAvail} ／ 现算 ${panel.expect}`);
  out(panel.nameOnScreen === false, '⑥ 禁用的组件不在候选列表里', `「${pick.name}」在面板文本中：${panel.nameOnScreen}`);

  if (errs.length) out(false, '页面无未捕获异常', errs.slice(0, 2).join(' | '));
} catch (e) {
  console.log('FATAL: ' + e.message);
  chrome.kill('SIGKILL');
  process.exit(3);
}

chrome.kill('SIGKILL');
console.log('');
if (fail === 0) { console.log(`通过 6 ｜ 断点 0${NEG ? '  ← 负控没抓住，判据失效' : ''}`); process.exit(NEG ? 2 : 0); }
console.log(`通过 ${6 - fail} ｜ 断点 ${fail}`);
process.exit(2);
