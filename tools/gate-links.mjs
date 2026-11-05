#!/usr/bin/env node
/* gate-links —— 页面跳转与可操作性门禁。
 *
 * 为什么要有它：改文件名（app.html ↔ apps.html）时没有任何东西会提醒我，
 * 结果用户点「应用管理」直接 404。这类错误不该靠人眼发现，也不该靠事后道歉。
 *
 * 判据（L1–L7）：
 *   L1 本地资源存在性：所有 href/src 指向本地文件，必须真实存在
 *   L2 页面可达性：每个 .html 至少被另一个 .html 链接（孤立页 = 用户进不去）
 *   L3 侧栏定位：每页必须有一个 aria-current="true"，且它指向本页自己（静态 + 运行时）
 *   L4 禁止空跳：不允许 href="javascript:void(0)" 这类假链接
 *   ~~L5 toast 读屏~~（2026-10-29 停用：用户已裁决「我的项目不做无障碍/读屏」，
 *       见 _docs/裁决台账.tsv R-122；原 L5 断言与负控一并删除，L5 编号不复用）
 *   L6 弹窗行键盘可达：assets/app.js 的 .row 模板必须设 tabindex 并处理 Space/Enter
 *   L7 侧栏可操作性（运行时，真开浏览器）：**判"导航有没有被截断"，不判"渲染出至少 N 项"**。
 *      条目数必须等于 data-active 所在模块的真实页数（定义在 shell.js 的 NAV 里），
 *      每个真链接都必须在该页侧栏出现、且真跳得到；零链接或目标缺失才红。
 *      另判死停（按下去什么都没发生）与"点非链接项改了 URL"。
 *      ★2026-10-28 改口径：原判据是 `anchors < 20`，那是侧栏 23 项时代的**数量代理**。
 *        用户定调 demo 只做 AI 应用方案模块（1 组 2 项）后，这个数字反过来把正常页面判红。
 *        数量不是目的，完整性才是；新口径对 23 项与 2 项同样成立，不含任何魔数。
 *
 * 用法：node tools/gate-links.mjs            正控（要求全绿）
 *      node tools/gate-links.mjs --negctl   负控（逐条注入缺陷，每类必须判红，rc=2）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveBase, debugPort } from './base.mjs';
/* 页面清单只有一个来源：tools/pages.mjs。
   本文件此前自己遍历 fs 里的裸文件名，而裸 app.html 会被 assets/app.js 用
   `location.replace('apps.html?pick=1')` 弹走 —— 于是"量 app.html"实际量的是 apps.html，
   红报在 app.html 头上（修起来会改错文件）。规范深链一律从这里取。 */
import { PAGES, LIST_PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEGCTL = process.argv.includes('--negctl');
/* 基址统一由 tools/base.mjs 解析（argv > GATE_BASE > 探端口 > 抛错），本文件不写端口。 */
const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ 静态层 ══════════════════════════════════════════════════ */

function scan(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  const pages = new Map();
  for (const f of files) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    /* 扫之前先把 <script> 的内容剥掉：脚本里拼字符串也会出现 href="…" 这种字面量
       （`'<a href="' + esc(href) + '">'`），不剥就会把拼接片段当成链接去查文件，
       报一个根本不存在的 404。这是"假阳性也是判据错误"，和注释里写色值一个道理。
       脚本生成的链接查不到文件，但它能不能点由运行时层（L7）负责，静态层不越权。 */
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
    const links = [];
    for (const m of markup.matchAll(/(href|src)="([^"]*)"/g)) {
      const raw = m[2];
      if (/^(#|data:|https?:|mailto:|tel:|javascript:)/i.test(raw)) continue;
      const clean = raw.split('?')[0].split('#')[0];
      if (clean) links.push(clean);
    }
    /* 被脚本跳转引用的页面也算"用户进得去"：
       配置页只能由动作进入（点「新增组件」、点卡片「配置」），没有 <a href> 是设计使然，
       不是孤立页。只认写死字面量的跳转，不认拼出来的 URL —— 拼出来的查不了。
       这条放宽的是"入口形式"，没有放宽"有没有入口"。
       ★2026-10-28 修：这一段原来扫的是**整页 html**，于是 `href="x.html"` 这种属性也命中，
         同一个坏链接在 L1 里被报两遍（负控实测：「L1 app.html → does-not-exist.html」出现两次）。
         现在只扫脚本正文：属性链接已经由上面那段算过了，重复计一次不是更严，是读数失真。 */
    const scripts = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n');
    for (const m of scripts.matchAll(/(?:location\.href|location\.assign\s*\(|href=)\s*=?\s*['"`]([\w.-]+\.html)/g)) {
      links.push(m[1]);
    }
    pages.set(f, { links, html });
  }
  return { files, pages };
}

function judgeStatic(dir) {
  const { files, pages } = scan(dir);
  const reds = [];
  const linkedBy = new Map(files.map((f) => [f, 0]));

  /* 侧栏（assets/shell.js）是全站真正的导航入口：它产出的 href 也算"可达来源"。
     不认这一条的话，app.html 只有靠自指面包屑才能"被链接"——那是假的可达。 */
  const shellPath = path.join(dir, 'assets/shell.js');
  const navHrefs = [];
  if (fs.existsSync(shellPath)) {
    for (const m of fs.readFileSync(shellPath, 'utf8').matchAll(/'([\w.-]+\.html)'/g)) navHrefs.push(m[1]);
  }

  for (const [page, info] of pages) {
    /* L1 */
    for (const l of info.links) {
      if (!fs.existsSync(path.join(dir, l))) reds.push(`L1 ${page} → ${l} 不存在（点下去就是 404）`);
    }
    /* L4 */
    if (/href="javascript:/i.test(info.html)) reds.push(`L4 ${page} 含 javascript: 假链接`);
    /* L3（静态层）：配置页按用户要求不再有平台导航（.sider 可以不存在）。
       有 .sider 的页面必须带 data-active；没有的跳过。 */
    if (/class="sider/.test(info.html) && !/class="sider"[^>]*data-active="[^"]+"/.test(info.html)) {
      reds.push(`L3 ${page} 有 .sider 但缺少 data-active，shell 不知道该高亮哪一项`);
    }
    /* L5 已于 2026-10-29 停用：用户明确裁决「我的项目不做无障碍/读屏」，
       播报区 role/aria-live 是已定口径外的要求，不是缺陷。见 _docs/裁决台账.tsv R-122。
       L5 编号保留不复用，避免旧报告指向另一条判据。 */
  }
  /* L2：自指不算"被链接"（面包屑指向自己是自指，用户从别处仍然进不来） */
  for (const [page, info] of pages) {
    for (const l of info.links) if (l !== page && linkedBy.has(l)) linkedBy.set(l, linkedBy.get(l) + 1);
  }
  for (const l of navHrefs) if (linkedBy.has(l)) linkedBy.set(l, linkedBy.get(l) + 1);
  for (const [f, n] of linkedBy) {
    if (n === 0) reds.push(`L2 ${f} 没有被任何页面或侧栏链接（孤立页，用户只能靠直接改地址进来）`);
  }
  /* L6 role=checkbox 的行必须键盘可达：没有 tabindex 就永远进不去，也没有 Space/Enter */
  const jsPath = path.join(dir, 'assets/app.js');
  if (!fs.existsSync(jsPath)) {
    reds.push('L6 assets/app.js 缺失，无法确认弹窗行是否键盘可达');
  } else {
    const js = fs.readFileSync(jsPath, 'utf8');
    /* ★2026-10-29：原判据是 `/setAttribute('tabindex')/` 在整个 app.js 里任一处命中即绿。
       实测 app.js 另有一处 `row.setAttribute('tabindex','-1')`（焦点管理），
       所以 L6a 负控把**行模板**那处删掉后，判据仍被另一处喂绿 —— 负控 rc=1 暴露了它。
       现在只认行渲染循环里的 `r.setAttribute('tabindex'`；判的东西没变（行必须能 Tab 进去）。 */
    if (!/r\.setAttribute\(\s*'tabindex'/.test(js)) {
      reds.push('L6 assets/app.js 的 .row 没设 tabindex（role=checkbox 的行键盘进不去）');
    }
    if (!/addEventListener\(\s*'keydown'/.test(js) || !/e\.key/.test(js)) {
      reds.push('L6 assets/app.js 的 .row 没有 Space/Enter 键盘处理（看得见、勾不上）');
    }
  }
  return { reds, count: files.length, pages };
}

function report(label, { reds, count }) {
  console.log(`${label}：${count} 个页面`);
  for (const r of reds) console.log('  ✗ ' + r);
  if (!reds.length) console.log('  全部通过（L1 资源 / L2 可达 / L3 侧栏定位 / L4 无假链接 / L6 行可键盘）');
  return reds.length;
}

/* ══ 运行时层（真开浏览器） ══════════════════════════════════ */

/* 侧栏探针：停靠点 = 能被 Tab 停住的元素；死停 = 停住了但按下去什么都不发生的元素。
   ★2026-10-22 改口径：原来的判据是「停靠点数必须等于真链接数」——
     那是在"侧栏只有链接"的前提下找的代理指标。侧栏现在有一级折叠按钮（线上就是这样），
     它们每次都会改变 aria-expanded，是**真控件**，不该算死停。
     代理指标过期了就要换成直接量：逐个按一次，看它到底有没有变化。 */
const SIDER_PROBE = `(function(){
  var s = document.querySelector('.sider');
  if (!s) return JSON.stringify({ sider: false });
  var cand = [].slice.call(s.querySelectorAll('a[href],area[href],button,input,select,textarea,[tabindex]'));
  var stops = cand.filter(function (el) {
    if (el.disabled) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  });
  var real = [].slice.call(s.querySelectorAll('a[href]')).filter(function (a) {
    var h = (a.getAttribute('href') || '').trim();
    if (!h || h.charAt(0) === '#') return false;
    return a.getAttribute('aria-disabled') !== 'true';
  });
  /* 可见性必须在点击折叠按钮**之前**量：下面的死停检查会把一级组折起来，
     折起来之后二级项的 getClientRects 全是 0 —— 那不是"截断"，是探针刚点的。 */
  var vis = real.filter(function (a) { return a.getClientRects().length > 0; })
    .map(function (a) { return (a.getAttribute('href') || '').trim(); });
  var links = real.map(function (a) { return (a.getAttribute('href') || '').trim(); });
  var active = s.getAttribute('data-active');
  var href0 = location.href;
  /* 死停：按钮按下去 aria-expanded / aria-pressed 没变，且 DOM 文本没变 */
  var dead = 0;
  [].slice.call(s.querySelectorAll('button')).forEach(function (b) {
    var before = b.getAttribute('aria-expanded') + '|' + b.getAttribute('aria-pressed') + '|' + s.textContent.length;
    b.click();
    var after = b.getAttribute('aria-expanded') + '|' + b.getAttribute('aria-pressed') + '|' + s.textContent.length;
    if (before === after) dead++;
  });
  [].slice.call(s.querySelectorAll('a')).forEach(function (a) { if (real.indexOf(a) < 0) a.click(); });
  var cur = s.querySelector('a[aria-current]:not([aria-current="false"])');
  /* 模块真实页数：从**定义侧**取（window.Shell.NAV —— shell.js 暴露的同一份导航定义），
     不从渲染结果反推。拿渲染结果当期望值，删掉一项就永远发现不了（自我参照）。 */
  var nav = (window.Shell && window.Shell.NAV) || null;
  var moduleItems = null, moduleName = null, navAll = [];
  if (nav) {
    for (var g = 0; g < nav.length; g++) {
      var items = nav[g][1], hit = false;
      for (var k = 0; k < items.length; k++) {
        navAll.push(items[k][1]);
        if (items[k][2] === active) hit = true;
      }
      if (hit) {
        moduleName = nav[g][0];
        moduleItems = items.map(function (it) { return it[1]; });
      }
    }
  }
  return JSON.stringify({
    sider: true,
    active: active,
    stops: stops.length,
    real: links.length,
    links: links,
    visible: vis,
    dead: dead,
    moved: location.href !== href0,
    curHref: cur ? cur.getAttribute('href') : null,
    moduleName: moduleName,
    moduleItems: moduleItems,
    navAll: navAll
  });
})()`;

async function withChrome(fn) {
  const port = await debugPort();
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/gl-${Date.now()}`,
    '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let url;
    for (let i = 0; i < 60; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const t = l.find((x) => x.type === 'page');
        if (t && t.webSocketDebuggerUrl) { url = t.webSocketDebuggerUrl; break; }
      } catch (e) { /* chrome 还没开监听 */ }
      await sleep(200);
    }
    if (!url) throw new Error('无头 Chrome 没起来（' + CHROME + '）');
    ws = new WebSocket(url);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    let id = 0; const wait = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null && wait.has(m.id)) {
        const w = wait.get(m.id); wait.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
    const send = (method, params = {}) => {
      const i = ++id;
      return new Promise((res, rej) => {
        wait.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
        setTimeout(() => rej(new Error('timeout ' + method)), 15000);
      });
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    return await fn(send);
  } finally {
    try { ws && ws.close(); } catch (e) { /* ignore */ }
    ch.kill('SIGKILL');
  }
}

async function probe(send, url) {
  await send('Page.navigate', { url });
  await sleep(1200);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: SIDER_PROBE });
  try { return JSON.parse(r.result.value); }
  catch (e) { return { sider: true, err: '探针返回不是 JSON：' + String(r.result.value).slice(0, 120) }; }
}

/* 链接归一：判"在不在"用路径比，`./apps.html`、`apps.html#x` 与 `apps.html` 是同一处。 */
const normHref = (h) => String(h || '').trim().replace(/^\.\//, '').split('#')[0];

/* L7 判的是"导航有没有被截断"，不是"至少渲染出 N 项"。
   ★2026-10-28 改口径（这一条此前红在 4 个页面上，4 条红全部来自同一个数字）：
     原判据 `anchors < 20` 是侧栏 23 项时代留下的**数量代理**。用户 10-28 定调
     demo 只做 AI 应用方案模块，侧栏 1 组 2 项 ⇒ 这个阈值反过来把正常页面判红。
     新口径不含任何魔数，对 2 项和 23 项同样成立：
       · 条目数 = data-active 所在模块的真实页数（定义在 shell.js 的 NAV 里）
       · 期望集合 = 模块页 ∪ 导航全项 ∪ 站点列表页（pages.mjs，独立来源，防 NAV 自己少一项）
       · 每个期望项都得在侧栏出现；零链接、缺项、多出假项、目标不可达才红 */
function judgeProbe(page, v, ctx = {}) {
  const reds = [];
  const file = page.split('?')[0];
  /* 配置页（app / component / versions 深链）按用户要求不再有平台导航 ⇒ 没有 .sider 是正常形态，
     不是故障。列表页（pages.mjs 的 LIST_PAGES）缺了侧栏才是故障 —— 用清单判，不用文件名正则猜。 */
  /* 2026-11-02：下载页是二级页（从应用卡 ⋮ › 去下载页进入），不是模块。
     用户 2026-11-01 定过「左侧只有两个模块」=> 它不配占一级导航，也不该假装自己在某个模块里。
     这类页单独列表：侧栏照常渲染（不拆外壳），但跳过「当前项必须可跳转 / 属于哪个模块」两条。
     列表是显式的，加页必须写进来，不会自动放过任何页面。 */
  const OFF_NAV = ['downloads.html'];
  const offNav = OFF_NAV.includes(file);
  const mustHaveNav = (ctx.listPages || []).includes(file);
  if (!v.sider) {
    if (mustHaveNav) return [`L7 ${page} 是模块列表页，但读不到 .sider（平台导航整个不见了）`];
    return [];
  }
  if (v.err) return [`L7 ${page} 侧栏探针失败：${v.err}`];
  if (v.dead > 0) {
    reds.push(`L7 ${page} 侧栏有 ${v.dead} 个死停：按得下去但什么都没发生（停靠点 ${v.stops} / 真链接 ${v.real}）`);
  }
  if (v.moved) reds.push(`L7 ${page} 点了非链接项后 URL 变了（读屏/地址栏被污染）`);
  if (!offNav && (!v.curHref || v.curHref === '#')) reds.push(`L3R ${page} 高亮项不是可跳转的页面`);

  /* 零链接：导航等于不存在 */
  if (!v.real) { reds.push(`L7 ${page} 侧栏一个真链接都没有（导航没渲染出来）`); return reds; }

  /* 高亮的模块名必须在导航定义里找得到；找不到就无法回答"该渲染几项"，
     那时候再判"没截断"就是拿一个编出来的期望值自证。 */
  if (offNav) return reds;
  if (!v.moduleItems || !v.moduleItems.length) {
    reds.push(`L7 ${page} 高亮的「${v.active || '（空）'}」在导航定义（shell.js NAV）里找不到 —— 无法判定该模块应有几项`);
    return reds;
  }

  const expected = new Set([...v.moduleItems, ...(v.navAll || []), ...(ctx.listPages || [])].map(normHref));
  const rendered = v.links.map(normHref);
  for (const e of expected) {
    if (!rendered.includes(e)) {
      reds.push(`L7 ${page} 侧栏缺「${e}」，导航被截断（「${v.moduleName}」模块实有 ${v.moduleItems.length} 项，实渲染 ${v.real} 项）`);
    }
  }
  if (rendered.length !== expected.size) {
    reds.push(`L7 ${page} 侧栏渲染 ${rendered.length} 项，应为 ${expected.size} 项（「${v.moduleName}」模块真实页数 ${v.moduleItems.length}）`);
  }
  /* 本模块的入口必须一进来就看得见：一级组默认展开，不能靠用户先点一下才出现 */
  const vis = new Set((v.visible || []).map(normHref));
  const hidden = v.moduleItems.map(normHref).filter((e) => !vis.has(e));
  if (hidden.length) {
    reds.push(`L7 ${page} 侧栏里「${v.moduleName}」的 ${hidden.length} 个入口初始不可见（${hidden.join('、')}）—— 组没默认展开`);
  }
  return reds;
}

/* 单页审计：导航 →（可选）在页面上注入缺陷 → 探针 → 判。
   负控复用的就是这个函数，所以负控证明的正是正控跑的那条路。 */
async function auditNav(send, page, mutate) {
  await send('Page.navigate', { url: BASE + '/' + page });
  await sleep(1200);
  if (mutate) { await send('Runtime.evaluate', { expression: mutate }); await sleep(150); }
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: SIDER_PROBE });
  let v;
  try { v = JSON.parse(r.result.value); }
  catch (e) { v = { sider: true, err: '探针返回不是 JSON：' + String(r.result.value).slice(0, 120) }; }
  return { reds: judgeProbe(page, v, { listPages: LIST_PAGES }), links: v.sider && v.links ? v.links : [] };
}

/* 可达性：侧栏里的每个真链接都真跳一次。
   静态层 L1 只查页面 markup 里的 href；侧栏链接是 shell.js 运行时生成的，它看不见 ——
   于是"侧栏指向一个不存在的页"能一路绿到用户点下去才 404。 */
async function reachReds(send, targets) {
  const reds = [];
  for (const [href, pages] of targets) {
    const expr = `(async () => {
      try {
        const r = await fetch(${JSON.stringify(href)}, { cache: 'no-store' });
        return JSON.stringify({ status: r.status, ok: r.ok });
      } catch (e) { return JSON.stringify({ status: 0, ok: false, why: String(e) }); }
    })()`;
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
    let s;
    try { s = JSON.parse(r.result.value); } catch (e) { s = { status: 0, ok: false }; }
    const where = `出现在 ${[...pages].join(' / ')}`;
    if (!s.ok) {
      /* 静态服务对不存在的文件是**直接关连接**（curl rc=52），fetch 于是在 catch 里；
         所以 status 0 也是"不存在"，别把 0 当成"没量"读。 */
      reds.push(`L7 侧栏链接 ${href} 不可达（${s.status ? 'HTTP ' + s.status : '请求失败：' + (s.why || '连接被拒')}）—— ${where}`);
      continue;
    }
    /* 200 还不够：裸 app.html 会被 assets/app.js 用 location.replace 弹到 apps.html，
       fetch 看不出来。真跳一次，看落点是不是同一页。 */
    await send('Page.navigate', { url: BASE + '/' + href });
    await sleep(700);
    const lr = await send('Runtime.evaluate', { returnByValue: true, expression: 'location.pathname + location.search' });
    const landed = String(lr.result.value || '').replace(/^\//, '');
    if (normHref(landed) !== normHref(href)) {
      reds.push(`L7 侧栏链接 ${href} 实际落到 ${landed || '（空）'}—— 点下去不是那一页（${where}）`);
    }
  }
  return reds;
}

/* ══ 负控 ════════════════════════════════════════════════════
   每类判据都要能红。做法：复制一份真实页面 → 注入那一类缺陷 → 判据必须报红。
   复制整目录（含 assets），否则 L1 会因为"样式表不在"到处报红，
   每条用例都"变红"，负控就成了摆设——踩过一次。 */
function mutate(apply) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.html') || f === 'assets') {
      fs.cpSync(path.join(ROOT, f), path.join(tmp, f), { recursive: true });
    }
  }
  apply(tmp);
  const reds = judgeStatic(tmp).reds;
  fs.rmSync(tmp, { recursive: true, force: true });
  return reds;
}

if (NEGCTL) {
  const cases = [];

  /* 基线：不动任何东西必须全绿，否则后面的"红"毫无意义 */
  cases.push({ label: '基线（不注入）', want: [], expect: 0, got: mutate(() => {}) });

  /* L1 + L2：死链 + 孤立页 */
  cases.push({
    label: 'L1/L2 死链 + 孤立页',
    want: ['L1 ', 'L2 '],
    expect: 2,
    got: mutate((tmp) => {
      const victim = fs.readdirSync(tmp).find((f) => f.endsWith('.html'));
      let h = fs.readFileSync(path.join(tmp, victim), 'utf8');
      h = h.replace(/href="(?!assets|http|#|data:)([^"]*\.html)"/, 'href="does-not-exist.html"');
      fs.writeFileSync(path.join(tmp, victim), h);
      /* 孤立页样本要"外形合法"，否则它同时踩中 L3，噪声会盖住结论。
         L5 已于 2026-10-29 停用，样本不再需要 role=status/aria-live。 */
      fs.writeFileSync(path.join(tmp, 'orphan.html'),
        '<!doctype html><meta charset="utf-8"><nav class="sider" data-active="x"></nav>' +
        '<a href="#" aria-current="true">孤儿页</a>');
    })
  });

  /* L6a：行没有 tabindex */
  cases.push({
    label: 'L6 行缺 tabindex',
    want: ['L6 '],
    expect: 1,
    got: mutate((tmp) => {
      const p = path.join(tmp, 'assets/app.js');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/r\.setAttribute\(\s*'tabindex'[^;]*;?/, ''));
    })
  });

  /* L6b：行没有键盘处理 */
  cases.push({
    label: 'L6 行缺 keydown',
    want: ['L6 '],
    expect: 1,
    got: mutate((tmp) => {
      const p = path.join(tmp, 'assets/app.js');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/'keydown'/g, "'keyup'"));
    })
  });

  /* L7 的四类必红形态（★2026-10-28 改：旧口径靠 `anchors < 20` 判红，那只是个数字；
     新口径靠"缺项 / 不可达 / 死停 / 改地址"，所以负控必须逐条证明这些判法真的会红，
     而不是靠一个数量阈值兜底 —— 数量阈值正是这一次假红（把 2 项判成"被截断"）的来源）。
     a) 上一轮真实缺陷的侧栏：3 个 <a href="#"> + 2 个真链接 + 1 个死停按钮 ⇒ 死停须红
     b) 真页面上塞一个"无 href 但点了改地址"的假入口 ⇒ 改地址须红
        （★实测：data: 页里 location.hash 不改变 location.href，这类负控只能在真页面上做）
     c) 真页面上删掉一条真链接 ⇒ 缺项须红（导航被截断）
     d) 真页面上把一条真链接指向不存在的页 ⇒ 可达性须红 */
  const legacy =
    '<div class="grp"><span>AI 应用方案</span>' +
    '<a href="components.html">组件库</a><a href="app.html">应用管理</a></div>' +
    '<div class="grp"><span>通用工具</span>' +
    '<a href="#" data-noop>抽取工具管理</a><a href="#" data-noop>专家管理</a><a href="#" data-noop>MCP 管理</a></div>' +
    '<button type="button">死停按钮</button>';
  const legacyUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><nav class="sider">' + legacy + '</nav>'
  );
  const l7 = await withChrome(async (send) => {
    const legacyProbe = await probe(send, legacyUrl);
    /* 注：data: 样本没有 window.Shell，模块期望只能为空 —— 传 listPages: [] 是**有意的**，
       这一格只验"死停"，别让"模块找不到"的红替它顶包。 */
    const legacyReds = judgeProbe('负控样本', legacyProbe, { listPages: [] });

    const moved = await auditNav(send, 'apps.html',
      `(function(){var a=document.createElement('a');a.setAttribute('onclick',"location.hash='boom'");` +
      `a.textContent='全部工具';document.querySelector('.sider').appendChild(a);})()`);
    const cut = await auditNav(send, 'apps.html',
      `document.querySelector('.sider a[href="components.html"]').remove()`);
    const ghost = await auditNav(send, 'apps.html',
      `document.querySelector('.sider a[href="components.html"]').setAttribute('href','ghost-page.html')`);
    const ghostReach = await reachReds(send, new Map([['ghost-page.html', new Set(['apps.html'])]]));
    return { legacyReds, movedReds: moved.reds, cutReds: cut.reds, ghostReds: [...ghost.reds, ...ghostReach] };
  });

  let bad = 0;
  for (const c of cases) {
    const hits = c.want.length ? c.got.filter((r) => c.want.some((w) => r.startsWith(w))) : c.got;
    const noise = c.got.length - hits.length;
    const ok = c.expect === 0 ? c.got.length === 0 : (hits.length >= c.expect && noise === 0);
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.label} → 命中 ${hits.length} 条${noise ? `，另有 ${noise} 条无关噪声` : ''}`);
    (c.expect === 0 ? c.got : hits).slice(0, 3).forEach((r) => console.log('      ' + r));
  }
  const l7cases = [
    ['死停（上一轮真实缺陷样本）', l7.legacyReds.some((r) => /死停/.test(r)), l7.legacyReds],
    ['无 href 的假入口点了改地址', l7.movedReds.some((r) => /URL 变了/.test(r)), l7.movedReds],
    ['删掉一条真链接 ⇒ 导航被截断', l7.cutReds.some((r) => /截断/.test(r)), l7.cutReds],
    ['真链接指向不存在的页 ⇒ 不可达', l7.ghostReds.some((r) => /不可达/.test(r)), l7.ghostReds],
  ];
  for (const [name, ok, reds] of l7cases) {
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} L7 ${name} → ${reds.length} 条`);
    reds.slice(0, 3).forEach((r) => console.log('      ' + r));
  }

  if (bad) {
    console.log(`\n负控失败：${bad} 类判据抓不住应抓的错 ⇒ 判据是假的`);
    process.exit(1);
  }
  console.log('\n负控成立：L1/L2/L3/L4/L6/L7 逐条都能判红（基线全绿），rc=2');
  process.exit(2);
}

/* ══ 正控 ════════════════════════════════════════════════════ */
const staticResult = judgeStatic(ROOT);
let n = report('正控（静态层）', staticResult);

/* ★2026-10-28 修"记错页"：原来遍历 fs 里的裸文件名（app.html / component.html / versions.html）。
   裸 app.html 由 assets/app.js 走 `location.replace('apps.html?pick=1')`（tools/pages.mjs 已注明），
   于是"量 app.html"实际量的是 apps.html 的骨架 —— 红报在 app.html 头上，谁照着修谁改错文件。
   页面清单只有一个来源：pages.mjs 的规范深链（app.html?id=hx-zc 这类）。 */
const runtimeReds = await withChrome(async (send) => {
  const reds = [];
  const navTargets = new Map();
  for (const page of PAGES) {
    const r = await auditNav(send, page);
    reds.push(...r.reds);
    for (const href of r.links || []) {
      if (!navTargets.has(href)) navTargets.set(href, new Set());
      navTargets.get(href).add(page);
    }
  }
  reds.push(...await reachReds(send, navTargets));
  return reds;
});
runtimeReds.forEach((r) => console.log('  ✗ ' + r));
if (!runtimeReds.length) {
  console.log('  运行时层通过（真浏览器：侧栏条目数 = 模块真实页数、每条真链接都在且可达、无死停、点非链接不改地址）');
}
process.exit(n + runtimeReds.length ? 2 : 0);
