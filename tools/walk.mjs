#!/usr/bin/env node
/* walk —— 穷举走查校验器。它不需要我先想到问题在哪。
 *
 * 为什么要有它（用户原话）：
 *   「很多时候一轮哪怕十轮，只要我没意识到的问题、没有机制约束，你还是发现不到。」
 *   这句话是对的。前面 12 条判据全是我"想到什么写什么"——没想到的地方就是盲区，
 *   跑十遍也是十遍同样的盲区。人的注意力不可靠，判据的覆盖面也不可靠，
 *   唯一可靠的是**把界面上所有能点的东西枚举出来，逐个点一遍，看它到底有没有反应**。
 *
 * 它做四件事，全部不依赖我的预判：
 *   1. 枚举每页所有可交互元素（button / a[href] / [role=button] / [role=switch] / 输入框）
 *   2. 逐个点一下，看三件事：JS 异常、URL 变化、DOM 变化
 *   3. 三件都没发生 ⇒ 记为「点了没反应」（死控件），这最值得怀疑
 *   4. 顺带对账：页面用到的 class 在 CSS 里有没有定义、CSS 里的 class 有没有人用
 *
 * 用法：node tools/walk.mjs [base] [--page=component.html] [--verbose]
 * 退出码：0 无死控件无异常 ｜ 2 有问题 ｜ 3 环境不可用
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBase, debugPort } from './base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERBOSE = process.argv.includes('--verbose');
const ONLY = (process.argv.find((a) => a.startsWith('--page=')) || '').split('=')[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';

let BASE;
try { BASE = await resolveBase(); } catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

const PAGES = ONLY ? [ONLY] : ['components.html', 'apps.html', 'component.html', 'app.html?id=hx-zc'];

/* ══ 静态对账：class 双向 ═══════════════════════════════════ */
/* ⚠ 必须把四个页面里的内联 <style> 一起算进 CSS 源。
   上一版只读 assets/*.css，于是 component.html / app.html 内联定义的
   .panel / .mask / .genbar 等 142 个 class 全被报成"未定义 class"——纯假阳性。
   校验器报假问题比不报更坏：会把我引到不存在的问题上。 */
const inlineCss = ['component.html', 'app.html', 'components.html', 'apps.html']
  .map((f) => (readFileSync(join(ROOT, f), 'utf8').match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n'))
  .join('\n');
const cssAll = (['assets/tokens.css', 'assets/sys.css', 'assets/float.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n') + '\n' + inlineCss)
  .replace(/\/\*[\s\S]*?\*\//g, '');
const cssClasses = new Set();
for (const m of cssAll.matchAll(/\.([a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);
const pageSrc = ['component.html', 'app.html', 'components.html', 'apps.html']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const jsSrc = ['assets/app.js', 'assets/component.js', 'assets/shell.js', 'assets/float.js', 'assets/xiaozhi.js']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

/* ⚠ 「未定义 class」只能用**运行时**判：
   静态扫 HTML/JS 里的 class 字符串，会把 `card${c.id}`、`===`、`?` 这种模板碎片也算进来
   （第一版报了 43 个"未定义 class"，其中绝大多数是碎片，还有 xiaozhi 动态生成的）。
   ⇒ 真正可信的判据是：DOM 上此刻挂着的 classList，逐个问"有没有任何一条 CSS 规则匹配它"。
   这条只有浏览器能答，所以放到下面运行时算。 */
const undefinedCls = [];
/* Esc 关不掉的浮层：以前被「每次盲按 Esc」掩盖，现在单独记 */
const escFail = [];

/* ══ 浏览器 ═══════════════════════════════════════════════ */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        this.errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
      }
      if (m.id != null && this.wait.has(m.id)) {
        const w = this.wait.get(m.id); this.wait.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.wait.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), 20000);
    });
  }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/walk-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1',
  'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
const c = new CDP(ws);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160));
  return r.result.value;
};

/* 枚举：给每个可交互元素一个稳定描述 + 一个索引（避免重复点同一个） */
const LIST = `(() => {
  const vis = (e) => { const c = getComputedStyle(e);
    return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0 && !e.disabled; };
  const sel = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
  const out = [];
  [...document.querySelectorAll(sel)].forEach((e, i) => {
    if (!vis(e)) return;
    const t = (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').trim();
    out.push({ i, tag: e.tagName.toLowerCase(), id: e.id || '',
      cls: String(e.className || '').split(' ').filter(Boolean).slice(0, 2).join('.'),
      txt: t.slice(0, 22), href: e.getAttribute('href') || '' });
  });
  return out;
})()`;

/* ⚠ 上一版用 `document.body.innerHTML.length` 判"有没有反应"，
   漏掉了所有**属性/样式变化**（收起对话框只改 data-collapsed、保存只切提示条显隐），
   于是把 4 个正常按钮报成死控件。改用 MutationObserver 计数，attributes 也算。 */
const WATCH = `(() => {
  window.__mut = 0; window.__obs && window.__obs.disconnect();
  window.__obs = new MutationObserver((ms) => { window.__mut += ms.length; });
  window.__obs.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
  return 1;
})()`;
const MUTS = `(() => (window.__mut | 0))()`;
const URLNOW = `(() => location.pathname + location.search + location.hash)()`;

const CLICK = (desc) => `(() => {
  const sel = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
  const vis = (e) => { const c = getComputedStyle(e);
    return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0 && !e.disabled; };
  const all = [...document.querySelectorAll(sel)].filter(vis);
  /* 按"身份"找，不按索引：点开小智面板之后列表会变长，索引必然错位（上一版就是这样跳过一堆） */
  const D = ${JSON.stringify(desc)};
  const e = all.find((x) => x.tagName.toLowerCase() === D.tag && (x.id || '') === D.id &&
      ((x.innerText || x.value || x.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim().slice(0,22) === D.txt));
  if (!e) return 'GONE';
  if (e.hasAttribute('aria-disabled') || e.getAttribute('data-ready') === 'false') return 'PRECONDITION';
  if (e.tagName === 'A' && e.getAttribute('href') && !/^javascript:/.test(e.getAttribute('href'))) {
    /* 真链接不点：会把页面导航走，导致后面的元素全对不上 */
    return 'IS_LINK:' + e.getAttribute('href');
  }
  e.click();
  return 'CLICKED';
})()`;

/* 白名单：写了原因的"点了没反应但正确"的条目。没有原因的不许进（否则就成了掩盖问题）。 */
let ALLOW = {};
try { ALLOW = JSON.parse(readFileSync(join(HERE, 'walk-allow.json'), 'utf8')); } catch (e) { ALLOW = {}; }
const allowKey = (page, it) => `${page}|${it.tag}|${it.id || it.cls}|${it.txt}`;

let dead = 0, thrown = 0;
const findings = [];

for (const page of PAGES) {
  c.errs.length = 0;
  await c.send('Page.navigate', { url: BASE + '/' + page });
  await sleep(800);
  /* 运行时对账：DOM 上真实存在的 class，有没有对应的 CSS 规则 */
  const bare = await ev(`(() => {
    const hit = (cls) => {
      for (const ss of document.styleSheets) {
        let rules; try { rules = ss.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (const r of rules) {
          if (r.selectorText && r.selectorText.indexOf('.' + cls) >= 0) return true;
        }
      }
      return false;
    };
    const seen = new Set();
    for (const e of document.querySelectorAll('*')) for (const c of e.classList) seen.add(c);
    /* ★ js- 前缀是**行为钩子**（JS 靠它找元素来绑事件），按设计就不该有样式。
       把它们报成"样式会静默丢失"是判据错：钩子没有样式才是对的。
       同理 is- 前缀是状态修饰符，样式由宿主组件的 [data-*] 或后代选择器给。 */
    return [...seen].filter((c) => !hit(c))
      .filter((c) => !/^js-/.test(c) && !/^is-/.test(c))
      .slice(0, 20);
  })()`);
  for (const b of bare) undefinedCls.push(page + ':' + b);
  const list = await ev(LIST);
  console.log(`\n── ${page}（${list.length} 个可点元素）`);

  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    const tag = `${it.tag}${it.id ? '#' + it.id : ''}${it.cls ? '.' + it.cls : ''}「${it.txt}」`;
    let before, after, res, url0, url1;
    try {
      await ev(WATCH);
      url0 = await ev(URLNOW);
      c.errs.length = 0;
      res = await ev(CLICK(it));
      await sleep(420);            /* 提示条类反馈有淡入，给足 */
      after = await ev(MUTS);
      url1 = await ev(URLNOW);
      before = 0;
    } catch (e) {
      /* 点了之后上下文没了 = 页面被导航走，这不是死控件，跳过并把页面拉回来 */
      console.log(`     · ${tag} → 导航走（${String(e.message).slice(0, 40)}）`);
      await c.send('Page.navigate', { url: BASE + '/' + page });
      await sleep(700);
      continue;
    }
    if (res === 'GONE') { console.log(`     · ${tag} → 元素已不在（前一步把它移走了）`); continue; }
    if (res === 'PRECONDITION') { if (VERBOSE) console.log(`     · ${tag} → 前置条件未满足（如空输入时发送键），不算死控件`); continue; }
    if (String(res).indexOf('IS_LINK') === 0) {
      if (VERBOSE) console.log(`     · ${tag} → 链接 ${String(res).slice(8)}（不点，静态层已验存在性）`);
      continue;
    }
    const changed = after > 0 || url0 !== url1;
    const err = c.errs.length ? c.errs[0] : '';
    if (err) { thrown++; findings.push({ page, tag, kind: '点击抛异常', detail: err }); }
    if (!changed && !err) {
      const k = allowKey(page, it);
      /* ★2026-11-04：有些"控件"跟页面无关（拖动把手就是），按页写白名单永远差几条 ——
         补一条 `*` 通配：键的第一段写成 * 就对该类元素在所有页面生效，理由同样要写。 */
      const kAny = '*|' + it.tag + '|' + (it.id || it.cls) + '|' + it.txt;
      if (ALLOW[k] || ALLOW[kAny]) {
        if (VERBOSE) console.log(`     · ${tag} → 白名单：${ALLOW[k] || ALLOW[kAny]}`);
      } else { dead++; findings.push({ page, tag, kind: '点了没反应（DOM/URL 都没变）', detail: '' }); }
    }
    if (VERBOSE || !changed || err) {
      console.log(`     ${!changed && !err ? '✗' : err ? '✗' : '✓'} ${tag} → ${
        err ? '异常: ' + err.slice(0, 70) : changed ? '有反应' : '没反应'}`);
    }
    /* 弹出层会挡住后面的元素：每次点完先按 Esc 收一次。
       ★2026-10-22 改：原来**无条件**按 Esc 就走，等于替被测对象擦屁股 ——
       一个"按 Esc 关不掉"的浮层，会被这一下掩盖掉，永远是绿的。
       现在：按之前记一次开合状态，按之后还在开着的，**当缺陷报出来**。 */
    try {
      const before = await ev(`(function(){
        var p=document.querySelector('.xz-panel');
        return JSON.stringify({ xz: !!p && p.getAttribute('data-open')==='true',
          mask: !!document.querySelector('.mask[data-open="true"]') });
      })()`);
      const st = JSON.parse(before || '{}');
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await SLEEP(250);
      if (st.xz) {
        const still = await ev(`(function(){var p=document.querySelector('.xz-panel');
          return !!p && p.getAttribute('data-open')==='true';})()`);
        if (still === true) {
          escFail.push(page + ' 小智面板按 Esc 关不掉（它是浮层，Esc 是唯一的键盘出口）');
        }
      }
    } catch (e) {}
  }
}

/* ══ 静态对账 ═════════════════════════════════════════════ */
if (escFail.length) {
  console.log('\n── 浮层键盘出口缺失：' + escFail.length + ' 条');
  escFail.forEach(function (x) { console.log('  · ' + x); });
}
if (undefinedCls.length) {
  console.log(`\n── 页面/脚本里用到、但 CSS 里没定义的 class（样式会静默丢失）：${undefinedCls.length} 个`);
  console.log('   ' + undefinedCls.slice(0, 24).join(' / '));
}

console.log('\n════════════════');
console.log(`死控件 ${dead} 个 ｜ 点击抛异常 ${thrown} 个 ｜ 未定义 class ${undefinedCls.length} 个`);
if (findings.length) {
  console.log('\n要点：');
  for (const f of findings.slice(0, 24)) console.log(`  · [${f.page}] ${f.tag} — ${f.kind}${f.detail ? '（' + f.detail.slice(0, 60) + '）' : ''}`);
}
chrome.kill();
process.exit((dead || thrown) ? 2 : 0);
