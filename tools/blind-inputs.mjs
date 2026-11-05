#!/usr/bin/env node
/* blind-inputs —— **盲审的输入由机器出，不由我挑**。
 *
 * 为什么有它：这一轮我手选了 13 张截图给四个盲审专家，看着很全，
 * 实际上我先替他们筛掉了"我觉得没问题的地方"。代价已经付过：
 * 版本页那张我手点在了**已启用**那一行（那行本来就没有「启用此版本」按钮），
 * 专家照着这张图推出"唯一启用没闭环"——**我用一张错的图，让他们得出了错的结论**。
 *
 * 所以：截图清单只能来自 tools/pages.mjs 和 tools/states.mjs，不许我临时挑。
 * 一个状态一张图，一张不许少，每张带 md5 和视口，谁拿到的都是同一批。
 *
 * 产出：blind-inputs/<YYYYMMDD-HHMM>/
 *   ├ NN-<页面>-<状态>.png      每张一个状态
 *   └ manifest.md               清单（图号 / 页面 URL / 状态 / 尺寸 / md5 / 截图时刻）
 * 盲审只吃这个目录，不给它额外的图。
 *
 * 用法：node tools/blind-inputs.mjs [baseUrl] [--interactive-only]
 * 退出码：0 全部截到 ｜ 2 有状态截不到（缺图就是缺口，不许算绿）｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
/* 「确实截不到」的那几类：来源在 states.mjs，本文件只负责把它印进清单。
   不许在这里另写一份原因 —— 同一件事写两遍，早晚两处不一样。 */
import { UNSCREENSHOTABLE } from './states.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY_INTERACTIVE = process.argv.includes('--interactive-only');

/* 交互态：静态页截图看不到的那些。每一条都写清"点开什么"，不写"看起来是什么"。 */
const INTERACTIVE = [
  { page: 'apps.html', name: '菜单展开', do: `document.querySelector('.kcard .k-more').click()` },
  { page: 'components.html', name: '菜单展开', do: `document.querySelector('.crow .k-more').click()` },
  { page: 'components.html', name: '编辑信息弹层', do: `document.querySelector('.crow .k-more').click(); setTimeout(function(){var b=document.querySelector('.crow [data-act="edit"]'); if(b)b.click();},80)` },
  { page: 'apps.html', name: '停用确认框', do: `document.querySelector('.kcard .k-more').click(); setTimeout(function(){var b=document.querySelector('.kcard [data-act="toggle"]'); if(b)b.click();},80)` },
  /* ★这个态有前置条件：干净的 localStorage 里 hx-zc 只有一个正式版且已启用，
     而「启用此版本」只出现在**未启用**的行上 —— 不先造第二个版本，这个态永远截不到。
     前置条件写在 prep 里，不许靠"跑之前先手动点两下"。 */
  { page: 'versions.html?scope=app&id=hx-zc', name: '行内确认',
    prep: `(function(){
      var a = DB.appById('hx-zc');
      for (var v = 3; v <= 4; v++) {
        DB.versMakeDraft('app','hx-zc', v);
        DB.versPublish('app','hx-zc', { comps:(a.comps||[]).slice(), name:a.name }, null);
      }
      return DB.versOf('app','hx-zc').length;
    })()`,
    do: `(function(){var r=document.querySelector('.vl-row[data-kind="stable"] [data-a="act"]'); if(r)r.click(); return !!r})()` },
  { page: 'app.html?id=hx-zc', name: '装配面板', do: `(function(){var b=[].find.call(document.querySelectorAll('button,a'),function(x){return /装配组件/.test(x.textContent||'')}); if(b)b.click(); return !!b})()` },

  /* ── 2026-10-26 补：盲审点名"12 张里一张空态都没有、也没有已装配页签" ──────
     这四个态的共同点：**只有用户真操作才会出现**，静态页截图永远截不到。
     每条 do 都返回 false 时才算"截不到"（下方统一判 r === false），
     所以返回字符串而不是数字 —— 返回 0 会被当成 false，把一个"空得很正常"的态误报成缺口。 */

  /* ① 装配面板的「已装配」页签：盲审原文"图03 块上没有可见拆卸入口，所以『已装配』页签长什么样没截到"。
        这个态正是「卸载」按钮唯一存在的地方 —— 不截它，P1 第 4 条的前提就无法证伪。 */
  { page: 'app.html?id=hx-zc', name: '装配面板-已装配页签',
    do: `(function(){
      var b = document.querySelector('#act-assemble'); if (!b) return false;
      b.click();
      var t = document.querySelector('#tab-on'); if (!t) return false;
      t.click();
      var rows = document.querySelectorAll('#dlg-list .row').length;
      var un = document.querySelectorAll('#dlg-list .btn-uninstall').length;
      /* 选中态没落上去就说明点的是假按钮，不许当成"截到了" */
      if (t.getAttribute('aria-selected') !== 'true') return false;
      return 'rows=' + rows + ',uninstall=' + un;
    })()` },

  /* ② 同一个页签 + 行聚焦。为什么必须单独一张：
        13 号图上 3 行都只写「已装配」，**一个「卸载」都看不见** —— 因为
        app.html:346 写着 `.btn-uninstall{display:none}`，350 行才
        `.row:hover .btn-uninstall,.row:focus-within .btn-uninstall{display:inline-block}`。
        也就是说「拆卸入口存在」这件事，**静止截图永远拍不到**，
        而盲审正是拿着图 03 推出"块上没有可见拆卸入口"。
        这里用 Tab 进入行（row 带 tabindex=0，键盘真能到），走 :focus-within ——
        不写 hover 假类、不改 style，是真焦点。
        两张图放一起才说得清：入口**有**，但**只在悬浮/聚焦时出现**，这是可发现性问题，
        不是"产品卸不掉"，也不是"入口不存在"。 */
  { page: 'app.html?id=hx-zc', name: '装配面板-已装配页签-行聚焦',
    do: `(function(){
      var b = document.querySelector('#act-assemble'); if (!b) return false;
      b.click();
      var t = document.querySelector('#tab-on'); if (!t) return false;
      t.click();
      var r = document.querySelector('#dlg-list .row'); if (!r) return false;
      r.focus();
      if (document.activeElement !== r) return false;
      var btn = r.querySelector('.btn-uninstall'); if (!btn) return false;
      var disp = getComputedStyle(btn).display;
      /* display 还是 none 就说明聚焦没生效，那张图跟 13 号一样，不许当"截到了" */
      return disp !== 'none' ? 'uninstall=' + disp : false;
    })()` },

  /* ③ 装配抽屉里的搜索无结果：搜不到时给的是「没有匹配的组件 + 清除搜索」，
        而 xiaozhi.js ⑩ 明确说过"搜不到不等于失败，它可能已装" —— 这一屏必须能看见。 */
  { page: 'app.html?id=hx-zc', name: '装配面板-搜索无结果',
    do: `(function(){
      var b = document.querySelector('#act-assemble'); if (!b) return false;
      b.click();
      var s = document.querySelector('#dlg-search'); if (!s) return false;
      s.value = 'zzzz-no-such-comp';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      var e = document.querySelector('#dlg-list .p-empty');
      return e ? 'empty=' + e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 20) : false;
    })()` },

  /* ③ 应用列表搜索无结果：客户现场最先撞的一屏。 */
  { page: 'apps.html', name: '搜索无结果',
    do: `(function(){
      var i = document.querySelector('#f-kw'); if (!i) return false;
      i.value = 'zzzz-no-such-app';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      var e = document.querySelector('#grid .empty');
      return e ? 'empty' : false;
    })()` },

  /* ④ 应用列表按「已下架」筛。种子 6 个应用里 0 个已下架（4 已上架 + 2 草稿），
        所以首屏筛它必然是空的 —— 这正是盲审 P2 说的"死选项"的样子，把它交给盲审自己判。
        注意：它**不是**恒空选项（停用一个应用后就能筛出来），所以这里截的是
        "空结果"，不是"这个选项没用"。返回条数而不是布尔：见文件顶部说明。 */
  { page: 'apps.html', name: '筛选已下架的结果',
    do: `(function(){
      var s = document.querySelector('#f-st'); if (!s) return false;
      s.value = '已下架';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      var n = document.querySelectorAll('#grid .kcard').length;
      return 'n=' + n + (document.querySelector('#grid .empty') ? ',empty' : ',list');
    })()` },

  /* ⑤ 组件库状态筛到「草稿」：种子 8 个组件只有 已上架/已下架 两种状态，
        DB.compState 里 '草稿' 只能由"新建组件"产生，所以首屏恒空。 */
  { page: 'components.html', name: '筛选草稿的结果',
    do: `(function(){
      var s = document.querySelector('#f-st'); if (!s) return false;
      s.value = 'draft';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      var n = document.querySelectorAll('#grid .crow').length;
      return 'n=' + n + (document.querySelector('#grid .empty') ? ',empty' : ',list');
    })()` },

  /* ⑥ 「组件配置页的空画布（新建态）」不在这里补：`component.html` 无参数
        本身就是新建态（<title>新建组件</title>，comp-app 显示「新建组件」），
        它已经在 PAGES 里，被静态那一轮截成了 `04-component-默认态.png`。
        这里再补一张会和 04 字节完全一样，只是把张数凑上去 —— 那是补数不是补面。 */
];

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
const OUT = path.join(ROOT, 'blind-inputs', stamp);

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/bi-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,1000', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 140));
  }
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 25000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 140) };
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
let n = 0, miss = 0;

async function shot(pagePath, state) {
  n++;
  const file = String(n).padStart(2, '0') + '-' +
    pagePath.replace(/[?&=]/g, '_').replace(/\.html/, '') + '-' + state + '.png';
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(path.join(OUT, file), buf);
  const dim = await ev(`innerWidth + '×' + innerHeight + '  dpr=' + devicePixelRatio`);
  rows.push({
    n: String(n).padStart(2, '0'), file, page: pagePath, state,
    dim: String(dim), bytes: buf.length,
    md5: crypto.createHash('md5').update(buf).digest('hex').slice(0, 12),
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  console.log(`  ✓ ${file}  ${buf.length}B  ${dim}`);
}

/* ① 静态：所有页面，一个不落 */
if (!ONLY_INTERACTIVE) {
  for (const p of PAGES) {
    await send('Page.navigate', { url: BASE + '/' + p });
    await SLEEP(1500);
    await shot(p, '默认态');
  }
}

/* ② 交互态：点开之后的样子 */
for (const it of INTERACTIVE) {
  await send('Page.navigate', { url: BASE + '/' + it.page });
  await SLEEP(1600);
  /* 前置条件：造数据 → 必须 reload，否则页面还是旧 DOM */
  if (it.prep) {
    await ev(it.prep);
    await send('Page.navigate', { url: BASE + '/' + it.page });
    await SLEEP(1500);
  }
  const r = await ev(it.do);
  await SLEEP(450);
  if (r === false) { miss++; console.log(`  ✗ 截不到：${it.page} / ${it.name}（触发它的元素不存在）`); continue; }
  await shot(it.page, it.name);
}

/* ③ 清单：盲审只认这个文件 */
const md = [];
md.push('# 盲审输入清单（机器生成，不许手改）');
md.push('');
md.push(`生成时刻：${new Date().toISOString().slice(0, 19).replace('T', ' ')}　｜　视口：1440×1000　｜　基址：${BASE}`);
md.push(`共 ${rows.length} 张　｜　截不到 ${miss} 个状态`);
md.push('');
md.push('> 这份清单由 `tools/blind-inputs.mjs` 按 `pages.mjs` + 交互态清单自动生成。');
md.push('> **盲审只吃这个目录里的图**，不接受额外截图 —— 否则覆盖面就由给图的人决定了，');
md.push('> 而"我没想到的状态"永远不在我给的那几张里。');
md.push('');
md.push('| 图号 | 页面 | 状态 | 视口 | 字节 | md5 | 截图时刻 |');
md.push('|---|---|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.n} | ${r.page} | ${r.state} | ${r.dim} | ${r.bytes} | ${r.md5} | ${r.at} |`);
if (miss) {
  md.push('');
  md.push(`⚠ 有 ${miss} 个状态没截到 —— 那是缺口，不是"没问题"。`);
}
/* ★2026-10-26：把「确实截不到」的那几类也写进清单。
   不写的话，盲审只能看见"这批图里没有加载中和失败态"，却不知道是
   **我们漏了** 还是 **这东西根本不存在**。两种情况的结论完全相反，
   而清单是盲审唯一的上下文 —— 所以判断依据必须跟着图一起交出去。
   这份清单里的条目一律按**未覆盖**读，不许被当成"已考虑"。 */
if (UNSCREENSHOTABLE.length) {
  md.push('');
  md.push('## 显式不可截（缺口，不是已覆盖）');
  md.push('');
  md.push('下列状态在本原型里**没有可触发的路径**，因此没有图。理由如下，请按"未覆盖"计。');
  md.push('');
  md.push('| 状态 | 为什么截不到 |');
  md.push('|---|---|');
  for (const u of UNSCREENSHOTABLE) md.push(`| ${u.state} | ${u.why} |`);
}
fs.writeFileSync(path.join(OUT, 'manifest.md'), md.join('\n'));

/* ★2026-10-26：写一份**可机读的凭据**。为什么必须有：
 *   评审判据原来只查「评审时间晚于改动」，于是评审记录完全可以手写一条就过 ——
 *   没有任何东西证明那批判审真的看过眼下这一版界面。
 *   这份 stamp 把「图是哪一刻、基于哪些源文件的哪个 md5」钉死；
 *   check-review 拿它跟界面文件的 mtime 比，改完不出图就过不去。
 *   htmlMd5 是对五页 HTML 的内容摘要 —— 光比 mtime 可以被 touch 骗过。 */
{
  const crypto = await import('node:crypto');
  const pathMod = await import('node:path');
  const fsMod = await import('node:fs');
  const SRC = [];
  {
    const fsMod0 = await import('node:fs');
    /* 不许写成"只扫 5 个 html"：改 CSS 一样会改界面，而评审判据的 WATCH 里有
       sys.css / tokens.css / xiaozhi.css / app.js 等。范围写窄了，改样式就不算"界面变了"。
       这里一次全扫（十几份文件，毫秒级），check-review 只取它关心的那几份。 */
    for (const f of fsMod0.readdirSync(ROOT)) if (/\.html$/.test(f)) SRC.push(f);
    try {
      for (const f of fsMod0.readdirSync(pathMod.join(ROOT, 'assets'))) {
        if (/\.(css|js)$/.test(f)) SRC.push('assets/' + f);
      }
    } catch (e) {}
  }
  const src = {};
  for (const f of SRC) {
    const p = pathMod.join(ROOT, f);
    try {
      const buf = fsMod.readFileSync(p);
      src[f] = { md5: crypto.createHash('md5').update(buf).digest('hex').slice(0, 16),
                 bytes: buf.length, mtimeMs: fsMod.statSync(p).mtimeMs };
    } catch (e) { src[f] = { err: String(e && e.message).slice(0, 60) }; }
  }
  const pngs = rows.map((r) => ({ file: r.file, md5: r.md5 || null, bytes: r.bytes || null }));
  fs.writeFileSync(path.join(OUT, 'stamp.json'), JSON.stringify({
    at: new Date().toISOString(),
    viewport: { w: 1440, h: 1000, dpr: 1 },
    pngCount: rows.length,
    missStates: miss,
    source: src,
    pngs
  }, null, 2));
}

console.log(`\n产出 ${rows.length} 张 → ${OUT}`);
if (errs.length) console.log('页面异常：' + errs.slice(0, 2).join(' ;; '));
console.log(`截不到 ${miss} 个状态`);

ws.close(); chrome.kill();
process.exit(miss > 0 ? 2 : 0);
