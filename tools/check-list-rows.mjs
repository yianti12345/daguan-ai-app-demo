#!/usr/bin/env node
/* check-list-rows —— 组件库「每张卡都得经得起细看」的八条判据（2026-10-25 立）。
 *
 * 为什么有它：组件库从「4 列卡片阵列」换成「一行一个组件」之后，原来 .kcard 一族的判据
 * 在这页**一条都不再量这张表**：卡壳没了，量卡壳的命令找不到 .kcard 就各自跳过 ——
 * 页面可以塌成什么样都没人知道。所以这条盯的是"看不出来"的那一类坏法：
 *   卡高不等 / 列左缘错位 / 整表横向溢出；名称被截断成「…」而 hover 没 title 可查；
 *   引用数写着不存在的应用；⋮ 太淡点不动、菜单项不是那几个真动作、Esc 关不掉；
 *   两页结构又混在一起；组件涨到 30-50 条时首屏只剩 3-4 张。
 *
 * ── 形态沿革：10-25 单列行表 → 10-25 晚 用户「我服了，组件管理我需要的是好看的卡片」⇒ 行表作废，
 *    改回卡片。现行＝`#grid.clist` 四列网格 + 8 张 `.crow.ccard`（信息区 .cc-body + 操作带 .cc-ft），
 *    卡上只有四样：名字 / 启用开关 / 一句介绍 / 配置（＋ ⋮）。
 *
 * ★2026-10-27 重锚（本轮 T11）：上一版整条按"单列行表"写（.cl-head 六列、.cl-ver、.cl-st、
 *   .cl-refs 名字格、.cl-ico 图标家族），这些对象在现行卡片上**全部不存在** ⇒ 正控自己先红 7 条
 *   （R1 R2 R3 R4 R5 R7 R8），负控 6 刀里 3 刀连靶子都造不出来。逐条翻译到卡片形态（阈值不放宽）：
 *
 *   R1 行高全等 + 表头与 8 行同列左缘 + 无横向溢出
 *      → 卡高全等（容差 0）＋ 卡左缘落在同一套列线、跨行同列全等（≤1px）＋ doc/#grid 无横向溢出
 *   R2 硬字段不截断；软字段省略必须有更长 title
 *      → 卡片形态允许单行省略，但**被截断的文字必须有覆盖全文的 title**（全称不许丢）
 *   R3 .cl-refs 每个应用名逐字等 DB.APPS、零引用写「还没有应用使用」
 *      → 卡上引用数是现算的一句话：文案必须逐字等于 DB.APPS 现算的「N 个应用在用」/「还没有应用在用」，title 同
 *   R4 ⋮ 静止 ≥3:1、盒子 32×32、点开 role=menu ≥3 项、Esc 关并回焦
 *      → 同（菜单项允许集补上 vers：⋮ 里「版本管理」是 10-25 明确接回来的第三个真动作）
 *   R5 两页结构可分（组件页 #grid .kcard=0 / .cl-head / 8 行，应用页 .kcard=6）
 *      → 组件页 #grid .kcard=0、.kc-cover=0、.crow.ccard=DB.COMPS.length；应用页 .kcard=DB.APPS.length
 *   R6 32 行压测首屏 top<900 ≥9 行
 *      → 同（32 张卡，首屏仍要 ≥9 张可见；只改内存，量完 reload）
 *   R7 图标必须按家族给形（同家族一种、跨家族不许共用）
 *      → 卡上不再有类型图标；同一件事＝**状态表示必须与状态值一一对应**：.cc-sw 文案 ∈{启用,禁用,草稿}，
 *        且 data-on="1" ⇔ 文案「启用」（aria-checked 同）—— 状态漂移就是原 R7 抓的"家族↔图标错位"
 *   R8 引用列不许出现「…＋数字」的拼接残句
 *      → 引用数文案必须是完整句子：`N 个应用在用` 或 `还没有应用在用`；不许出现「…」/「+数字」/顿号拼接
 *
 * 判据（阈值写死在下面常量里，负控档也不许改 —— 改一个数就是把判据调成恒绿）：
 *   R1 卡高全等（容差 0）+ 卡左缘落在同一套列线（≤1px）+ doc/#grid 无横向溢出
 *   R2 被截断的文字有覆盖全文的 title（.cl-tt / .cl-desc / .cc-meta）
 *   R3 .cc-meta 引用数逐字等于 DB.APPS 现算；title 同；零引用写「还没有应用使用」
 *   R4 每卡 .k-more 静止态对比 ≥3:1（alpha 合成到白底）且盒子 =32×32；真点一下必须开出
 *      [role=menu]、≥3 个 [role=menuitem] 且 data-act 全在允许集、必含三个真动作；
 *      Escape 必须关掉菜单并把焦点还给那个 .k-more
 *   R5 两页结构必须分得开（组件页 #grid .kcard=0/.kc-cover=0/.crow=DB.COMPS；应用页 .kcard=DB.APPS）
 *   R6 30+ 压测：只在页面里把 DB.COMPS 克隆成 32 张再重渲染（不碰 data.js、不写 localStorage），
 *      #total 必须诚实报「共 32 个组件」；要么全渲染、要么有翻页控件兜着；
 *      首屏下沿（top < 900）看得见的卡必须 ≥9；量完 reload 复原
 *   R7 状态表示 ↔ 状态值一一对应（文案 ∈ 三态、data-on=1 ⇔ 启用、aria-checked 同）
 *   R8 引用数文案是完整句子（无拼接残句）
 *
 * 用法：node tools/check-list-rows.mjs            正控
 *      node tools/check-list-rows.mjs --negctl   负控：页面里造 7 个坏状态（不落盘），
 *                                                每刀必须命中**它点名的那条**规则，且还原后基线必须复绿
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：全命中即 2）｜ 3 未量（Chrome 起不来／页面没有 .crow／
 *         有刀没命中／还原后没复绿）｜ 4 负控前提不成立（注入前基线已经是红的）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const TRACE = '/tmp/xz-audit/lr-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* ── 阈值（唯一处；负控档也读这里，不许另写一套） ── */
const TOL_LEFT = 1;        /* R1 列左缘容差 */
const MIN_CONTRAST = 3;    /* R4 静止态非文本对比（WCAG 1.4.11） */
const BOX = 32;            /* R4 命中区 */
const MIN_ITEMS = 3;       /* R4 菜单项数 */
const NEED_ACTS = ['edit', 'vers', 'refs'];                         /* 三个真动作（缺一即红） */
const ALLOW_ACTS = ['edit', 'toggle', 'vers', 'refs', 'dup', 'export'];  /* 允许出现的全部动作（2026-10-30 加复制/导出） */
const VISIBLE_TOP = 900;   /* R6 首屏下沿 */
const MIN_VISIBLE = 9;     /* R6 32 卡时首屏至少要看得见 9 张 */
/* ★2026-10-28：原来这里写死 8 —— 加一个组件判据就红（实测被卡过一次）。
   现在改成与 pages 里的 DB.COMPS.length 比，库里有几个就要求几张。 */
const APPS_CARDS = 6;      /* R5 应用页的卡数（DB.APPS 6 条） */
/* ★2026-10-28 改（规范 §7.6）：草稿这个词 2026-10-27 已在 data.js 退役（DB.compState 把
   「草稿」「未发布」都折成「未发布」），常量没跟着改 ⇒ 一旦出现「未发布」的组件就是**假红**。
   现在按现行为取三态，并把「草稿」留作历史存档的兼容值（老存档里还可能有）。 */
const STATES = ['启用', '禁用', '未发布', '草稿'];

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/listrows-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) { /* 还没起来 */ }
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来（' + CHROME + '）'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
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
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

/* 看门狗：整条判据不许挂死。180s 没跑完就明说超时（rc=3），不装作还在跑。 */
setTimeout(() => { console.log('GATE TIMEOUT: 180s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 180000);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* "rgb(r, g, b)" / "rgba(r, g, b, a)" → 合成到白底后的感知亮度 0..1（与 check-card-menu.mjs 同一套算法）。
   ⋮ 的底色在卡片里是 transparent（背景就是卡片白），所以"合成到白底"就是真实底色，不是近似。 */
const shade = (c) => {
  const m = String(c).match(/[\d.]+/g); if (!m) return NaN;
  const [r, g, b, a] = [Number(m[0]), Number(m[1]), Number(m[2]), m[3] == null ? 1 : Number(m[3])];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return 1 - a * (1 - lum);
};

const goto = async (page) => {
  await send('Page.navigate', { url: BASE + '/' + page });
  await SLEEP(1400);
};

/* ── 页面里的一次性快照（只读；量的是渲染结果，不是 CSS 声明） ──────────────
   为什么一次拿全：规则之间不许各查各的 —— 各查各的就会出现"R1 量的是上一版页面、
   R4 量的是重画后的页面"这类错位，而两边都绿。 */
const SNAP = `(function(){
  var q = function(s, r){ return (r || document).querySelector(s); };
  var qa = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var L = function(e){ return +e.getBoundingClientRect().left.toFixed(2); };
  var Rr = function(e){ return +e.getBoundingClientRect().right.toFixed(2); };
  var B = function(e){ return +e.getBoundingClientRect().bottom.toFixed(2); };
  var T = function(e){ return +e.getBoundingClientRect().top.toFixed(2); };
  var W = function(e){ return +e.getBoundingClientRect().width.toFixed(2); };
  var H = function(e){ return +e.getBoundingClientRect().height.toFixed(2); };
  var cards = qa('#grid .crow');
  var g = q('#grid');
  var cellOf = function(c, s){
    var e = q(s, c);
    if (!e) return null;
    return { sw: e.scrollWidth, cw: e.clientWidth, w: W(e), r: Rr(e),
             text: (e.textContent || '').trim(), title: e.getAttribute('title') || '' };
  };
  var data = cards.map(function (c) {
    var cid = c.getAttribute('data-id');
    var expected = [];
    try { expected = (window.DB.APPS || []).filter(function (a) { return (a.comps || []).indexOf(cid) >= 0; }).map(function (a) { return a.name; }); } catch (e) {}
    var more = q('.k-more', c), swEl = q('.cc-sw', c);
    return {
      id: cid,
      on: c.getAttribute('data-on'),
      h: H(c), l: L(c), r: Rr(c), t: T(c), b: B(c),
      tt: cellOf(c, '.cl-tt'), desc: cellOf(c, '.cl-desc'), meta: cellOf(c, '.cc-meta'),
      sw: swEl ? { text: (swEl.textContent || '').trim(), aria: swEl.getAttribute('aria-checked'), h: H(swEl) } : null,
      expected: expected,
      more: more ? (function () {
        var cs = getComputedStyle(more), bb = more.getBoundingClientRect(), box = more.parentNode;
        return { w: +bb.width.toFixed(2), h: +bb.height.toFixed(2), color: cs.color, opacity: cs.opacity,
                 r: +bb.right.toFixed(2),
                 menuItems: Array.prototype.map.call(box.querySelectorAll('.k-menu [role="menuitem"]'), function (m) {
                   return { act: m.getAttribute('data-act'), text: (m.textContent || '').trim() };
                 }) };
      })() : null
    };
  });
  return JSON.stringify({
    crowN: cards.length,
    rows: data,
    /* ★用 Array.from：slice.call(Set) 拿不到 length，会静默返回空数组（R1 列线 0 条就是这么来的） */
    colLines: Array.from(new Set(cards.map(function (c) { return L(c); }))).sort(function (a, b) { return a - b; }),
    docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth,
    gridSw: g ? g.scrollWidth : null, gridCw: g ? g.clientWidth : null,
    gridKcard: qa('#grid .kcard').length, allKcard: qa('.kcard').length, gridCover: qa('#grid .kc-cover').length,
    appsNames: (function () { try { return (window.DB.APPS || []).map(function (a) { return a.name; }); } catch (e) { return null; } })(),
    appsN: (function () { try { return (window.DB.APPS || []).length; } catch (e) { return null; } })(),
    compsN: (function () { try { return (window.DB.COMPS || []).length; } catch (e) { return null; } })(),
    compsN: (function () { try { return (window.DB.COMPS || []).length; } catch (e) { return null; } })()
  });
})()`;

const APPS_SNAP = `(function(){
  var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
  return JSON.stringify({
    gridKcard: qa('#grid .kcard').length, allKcard: qa('.kcard').length,
    docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth,
    appsN: (function(){ try { return (window.DB.APPS || []).length; } catch (e) { return null; } })()
  });
})()`;

/* R6：只在页面里改内存，不碰 data.js、不写 localStorage；量完由调用方 reload 复原 */
const STRESS = `(function(){
  var q = function(s){ return document.querySelector(s); };
  var n0 = (window.DB.COMPS || []).length;
  if (!n0) return JSON.stringify({ err: 'DB.COMPS 为空' });
  var base = window.DB.COMPS.slice();
  for (var k = 1; k < 4; k++) {
    base.forEach(function (c) {
      var d = {}; for (var key in c) d[key] = c[key];
      d.id = c.id + '__lrdup' + k;
      window.DB.COMPS.push(d);
    });
  }
  var n1 = window.DB.COMPS.length;
  var kw = q('#f-kw');
  if (!kw) return JSON.stringify({ err: '没有 #f-kw（重渲染的入口）' });
  kw.dispatchEvent(new Event('input', { bubbles: true }));
  var cards = Array.prototype.slice.call(document.querySelectorAll('#grid .crow'));
  var tops = cards.map(function (r) { return +r.getBoundingClientRect().top.toFixed(1); });
  var tot = q('#total'), pg = q('#pager');
  return JSON.stringify({ n0: n0, n1: n1, rendered: cards.length,
    visible: tops.filter(function (t) { return t < ${VISIBLE_TOP}; }).length,
    totalText: tot ? String(tot.textContent) : '',
    pagerShown: !!(pg && !pg.hidden),
    firstTops: tops.slice(0, ${MIN_VISIBLE + 3}) });
})()`;

const fmt = (n) => String(Math.round(Number(n) * 100) / 100);
const rowsOut = [];
const mark = (id, pass, detail) => { rowsOut.push({ id, pass, detail }); return pass; };

/* ── 一个快照 → R1..R8 的判定（R4 的"点开"那一半由 calling code 合并进来） ── */
function judge(snap, apps, r4i) {
  const out = [];
  const cards = snap.rows || [];

  /* ── R1 卡高全等 + 卡左缘落在同一套列线 + 无横向溢出 ── */
  {
    const hs = cards.map((c) => c.h);
    const h0 = hs.length ? hs[0] : 0;
    const hMax = hs.length ? Math.max(...hs.map((h) => Math.abs(h - h0))) : NaN;
    const lines = snap.colLines || [];
    /* 每张卡的左缘必须落在某条列线上（≤TOL_LEFT），且同一行里不该出现两条不同列线 */
    let leftMax = 0;
    cards.forEach((c) => {
      const d = Math.min(...lines.map((x) => Math.abs(c.l - x)));
      leftMax = Math.max(leftMax, d);
    });
    const rowColBad = [];
    const byTop = new Map();
    cards.forEach((c) => { if (!byTop.has(c.t)) byTop.set(c.t, []); byTop.get(c.t).push(c.l); });
    [...byTop.entries()].forEach(([t, ls]) => {
      const uniq = [...new Set(ls)];
      if (uniq.length !== ls.length) rowColBad.push(`行 ${t} 有两张卡同一左缘`);
    });
    const noOverflow = snap.docSw <= snap.docCw && snap.gridSw != null && snap.gridSw <= snap.gridCw;
    const pass = cards.length > 0 && hMax === 0 && leftMax <= TOL_LEFT && rowColBad.length === 0 && noOverflow
      && lines.length >= 2 && lines.length <= 5;
    out.push({ id: 'R1', pass, detail:
      `卡高 ${cards.length} 张 = ${[...new Set(hs.map(fmt))].join('/')}px（最大差 ${fmt(hMax)}，容差 0）`
      + `｜列线 ${lines.length} 条（${lines.map(fmt).join('/')}），卡左缘最大偏差 ${fmt(leftMax)}px（容差 ≤${TOL_LEFT}）`
      + (rowColBad.length ? `｜${rowColBad.join('；')}` : '')
      + `｜横向溢出 doc ${snap.docSw}≤${snap.docCw}、#grid ${snap.gridSw}≤${snap.gridCw}` });
  }

  /* ── R2 被截断的文字必须有覆盖全文的 title（全称不许丢） ── */
  {
    const cells = [], bad = [];
    cards.forEach((c) => {
      [['.cl-tt', c.tt], ['.cl-desc', c.desc], ['.cc-meta', c.meta]].forEach(([name, v]) => {
        if (!v) return;
        cells.push({ id: c.id, name, ...v });
      });
    });
    cells.forEach((v) => {
      const cut = v.sw > v.cw;
      if (!cut) return;
      if (!v.title) bad.push(`${v.id}${v.name} 被截断（${v.sw}>${v.cw}）却没有 title`);
      else if (v.title.length < v.text.length) bad.push(`${v.id}${v.name} title(${v.title.length} 字) 比可见文字(${v.text.length} 字) 短`);
    });
    const cutN = cells.filter((v) => v.sw > v.cw).length;
    const pass = cells.length > 0 && bad.length === 0;
    out.push({ id: 'R2', pass, detail:
      `${cells.length} 格文字（tt/desc/meta × ${cards.length} 张）：省略 ${cutN} 格、title 缺失/不更长 ${bad.length} 格`
      + (bad.length ? `（${bad.slice(0, 3).join('；')}）` : '') });
  }

  /* ── R3 引用数文案必须与 DB.APPS 现算逐字相等 ── */
  {
    const dbNames = snap.appsNames || [];
    const badText = [], badTitle = [], missing = [];
    let zeroCards = 0, refCards = 0;
    cards.forEach((c) => {
      const exp = c.expected || [];
      /* 2026-10-30：文案按用户要求改主动语态，判据跟着改，不许把旧句当标准。
         2026-11-04（q5 拍板）：零引用不再印「还没有应用在用」——一屏 8 张卡右下同一句
         否定句像坏卡，而"没人用"本就是新组件的默认状态。判据改成：
         有引用 ⇒ 必须逐字报「N 个应用在用」；零引用 ⇒ 不许有 .cc-meta 的文案。 */
      if (!exp.length) { zeroCards++; if (c.meta && c.meta.text) badText.push(`${c.id} 零引用不该印「${c.meta.text}」`); return; }
      const want = `${exp.length} 个应用在用`;
      if (!c.meta) { missing.push(c.id); return; }
      refCards++;
      if (c.meta.text !== want) badText.push(`${c.id}「${c.meta.text}」≠ DB 现算「${want}」（引用 ${exp.length} 个）`);
      if ((c.meta.title || '') !== want) badTitle.push(`${c.id} title「${c.meta.title}」≠「${want}」`);
    });
    const pass = cards.length > 0 && dbNames.length > 0 && missing.length === 0
      && badText.length === 0 && badTitle.length === 0;
    out.push({ id: 'R3', pass, detail:
      `DB.APPS ${dbNames.length} 个名字；有引用的卡 ${refCards}、零引用卡 ${zeroCards}（必须写「还没有应用使用」）`
      + `｜文案漂移 ${badText.length}、title 漂移 ${badTitle.length}`
      + (missing.length ? `｜缺 .cc-meta：${missing.join(',')}` : '')
      + (badText.length ? `｜${badText.slice(0, 2).join('；')}` : '')
      + (badTitle.length ? `｜${badTitle.slice(0, 2).join('；')}` : '') });
  }

  /* ── R4（结构半：每卡 ⋮ 的存在/盒子/对比/菜单项；点开半由 r4i 给） ── */
  {
    const missing = cards.filter((c) => !c.more).map((c) => c.id);
    const withMore = cards.filter((c) => c.more);
    const boxBad = withMore.filter((c) => Math.abs(c.more.w - BOX) > 0.5 || Math.abs(c.more.h - BOX) > 0.5)
      .map((c) => `${c.id} ${c.more.w}×${c.more.h}`);
    const ctr = withMore.map((c) => ({ id: c.id, c: c.more.color, ratio: 1.05 / (shade(c.more.color) + 0.05) }));
    const ctrBad = ctr.filter((x) => !(x.ratio >= MIN_CONTRAST));
    const minCtr = ctr.length ? Math.min(...ctr.map((x) => x.ratio)) : NaN;
    const actsBad = [];
    withMore.forEach((c) => {
      const acts = c.more.menuItems.map((m) => m.act);
      if (c.more.menuItems.length < MIN_ITEMS) actsBad.push(`${c.id} 只有 ${c.more.menuItems.length} 项`);
      acts.forEach((a) => { if (ALLOW_ACTS.indexOf(a) < 0) actsBad.push(`${c.id} 有未知 data-act=${a}`); });
      NEED_ACTS.forEach((a) => { if (acts.indexOf(a) < 0) actsBad.push(`${c.id} 缺 data-act=${a}`); });
    });
    const structOk = cards.length > 0 && missing.length === 0 && boxBad.length === 0 && ctrBad.length === 0 && actsBad.length === 0;
    const interOk = r4i ? r4i.ok : true;
    const pass = structOk && interOk;
    out.push({ id: 'R4', pass, detail:
      `⋮ 存在 ${withMore.length}/${cards.length}${missing.length ? '（缺 ' + missing.slice(0, 3).join(',') + '）' : ''}`
      + `｜盒子 =${BOX}×${BOX}：违例 ${boxBad.length}${boxBad.length ? '（' + boxBad.slice(0, 2).join('；') + '）' : ''}`
      + `｜静止态对比 ${ctr.length ? ctr[0].c + ' → 合成白底 ' + fmt(minCtr) + ':1（≥' + MIN_CONTRAST + '）' : '无量'}，不足 ${ctrBad.length}`
      + `｜菜单项违例 ${actsBad.length}${actsBad.length ? '（' + actsBad.slice(0, 2).join('；') + '）' : ''}`
      + (r4i ? `｜点开 ${r4i.menuN} 个 menu、${r4i.items} 项 act=${(r4i.acts || []).join(',')}｜Esc 关闭=${r4i.closed} 回焦=${r4i.back}（${r4i.focusAfter}）`
              : '｜点开/Esc 这一半本档不跑（负控档只量结构）') });
  }

  /* ── R5 两页结构可分 ── */
  {
    const a = apps || { gridKcard: NaN, allKcard: NaN, appsN: NaN };
    const wantApps = a.appsN || APPS_CARDS;
    const wantRows = snap.compsN || snap.crowN;
    const pass = snap.gridKcard === 0 && snap.gridCover === 0 && snap.crowN === wantRows && a.gridKcard === wantApps;
    out.push({ id: 'R5', pass, detail:
      `components.html：#grid .kcard=${snap.gridKcard}（要 0）、.kc-cover=${snap.gridCover}（要 0）、.crow.ccard=${snap.crowN}（要 ${snap.compsN || snap.crowN}＝库里组件数）`
      + `｜apps.html：#grid .kcard=${a.gridKcard}（要 ${wantApps}，全页 ${a.allKcard}）` });
  }

  /* ── R7 状态表示 ↔ 状态值一一对应（原「图标按家族给形」在卡片形态的同一件事） ── */
  {
    const missing = cards.filter((c) => !c.sw).map((c) => c.id);
    const badState = [], badAria = [], badOn = [];
    cards.forEach((c) => {
      if (!c.sw) return;
      if (STATES.indexOf(c.sw.text) < 0) badState.push(`${c.id}「${c.sw.text}」不在 ${STATES.join('/')}`);
      const wantOn = c.on === '1';
      if (wantOn !== (c.sw.text === '启用')) badOn.push(`${c.id} data-on=${c.on} 但文案「${c.sw.text}」`);
      if (c.sw.aria !== String(wantOn)) badAria.push(`${c.id} aria-checked=${c.sw.aria} 但 data-on=${c.on}`);
    });
    const pass = cards.length > 0 && missing.length === 0 && badState.length === 0 && badOn.length === 0 && badAria.length === 0;
    out.push({ id: 'R7', pass, detail:
      `${cards.length - missing.length}/${cards.length} 张有 .cc-sw`
      + `｜文案越界 ${badState.length}、状态文案与 data-on 不一致 ${badOn.length}、aria-checked 不一致 ${badAria.length}`
      + (missing.length ? `｜缺开关：${missing.join(',')}` : '')
      + (badOn.length ? `｜${badOn.slice(0, 2).join('；')}` : '') });
  }

  /* ── R8 引用数文案是完整句子（不许出现拼接残句） ── */
  {
    const SHAPE = /^(\d+ 个应用在用)?$/;   /* 2026-11-04 q5：零引用为空，不印否定句 */
    const hits = [];
    cards.forEach((c) => {
      const t = c.meta ? c.meta.text : '';
      if (/…\s*\+\s*\d/.test(t)) hits.push(`${c.id}「${t}」含「…+数字」`);
      else if (t.indexOf('、') >= 0) hits.push(`${c.id}「${t}」含顿号拼接`);
      else if (!SHAPE.test(t)) hits.push(`${c.id}「${t}」不是完整句子`);
    });
    const pass = cards.length > 0 && hits.length === 0;
    out.push({ id: 'R8', pass, detail:
      `引用数文案 ${cards.length} 张：残句/拼接 ${hits.length} 处`
      + (hits.length ? `：${hits.slice(0, 3).join('；')}` : '（形如「被 N 个应用使用」/「还没有应用使用」）') });
  }

  return out;
}

function print(list) {
  for (const r of list) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} —— ${r.detail}`);
}

/* ══════════════════════════ 正控 ══════════════════════════ */
console.log(`组件库卡片判据（components.html 4 列卡片网格 · apps.html 结构对照｜1440×900 · 真渲染量 getBoundingClientRect）`
  + (NEG ? '  [负控：页面内造 7 个坏状态，不落盘]' : ''));

trace('goto components');
await goto('components.html');
let snap = JSON.parse(await ev(SNAP));
if (!snap.crowN) {
  console.log(`未量：components.html 渲染后没有 .crow（#grid 里是 ${snap.gridKcard} 个 .kcard / ${snap.gridCover} 个 .kc-cover）`);
  console.log('      ⇒ 这不是绿，是没量（rc=3）');
  try { ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(3);
}

/* R4 的"点开"一半：真鼠标点第一张卡的 ⋮，真键盘 Escape（负控档只量结构半，避免坏状态影响交互） */
let r4i = null;
if (!NEG) {
  await mouse('mouseMoved', 5, 5);          /* 先把鼠标挪开，保证量到的是静止态 */
  await SLEEP(250);
  const rect = await ev(`(function(){ var b = document.querySelector('#grid .crow .k-more');
    if (!b) return null; var r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (!rect) {
    r4i = { ok: false, menuN: 0, items: 0, acts: [], closed: 'n/a', back: 'n/a', focusAfter: '第一张卡没有 .k-more' };
  } else {
    await mouse('mouseMoved', rect.x, rect.y);
    await SLEEP(120);
    await mouse('mousePressed', rect.x, rect.y);
    await mouse('mouseReleased', rect.x, rect.y);
    await SLEEP(300);
    const opened = await ev(`(function(){
      var btn = document.querySelector('#grid .crow .k-more');
      if (!btn) return { err: 'no-btn' };
      btn.setAttribute('data-lr-target', '1');
      var menus = Array.prototype.slice.call(document.querySelectorAll('[role="menu"]')).filter(function (m) { return !m.hidden; });
      var m = menus[0] || null;
      return { menuN: menus.length,
               items: m ? m.querySelectorAll('[role="menuitem"]').length : 0,
               acts: m ? Array.prototype.map.call(m.querySelectorAll('[role="menuitem"]'), function (x) { return x.getAttribute('data-act'); }) : [],
               exp: btn.getAttribute('aria-expanded') };
    })()`);
    await key('Escape', 'Escape', 27);
    await SLEEP(300);
    const closed = await ev(`(function(){
      var menus = Array.prototype.slice.call(document.querySelectorAll('[role="menu"]')).filter(function (m) { return !m.hidden; });
      var ae = document.activeElement;
      var back = !!(ae && ae.getAttribute && ae.getAttribute('data-lr-target') === '1');
      var btn = document.querySelector('#grid .crow .k-more');
      var exp = btn ? btn.getAttribute('aria-expanded') : null;
      if (btn) btn.removeAttribute('data-lr-target');
      return { menuN: menus.length, back: back, exp: exp,
               focusAfter: ae ? (String(ae.className || '').trim() || ae.tagName) : 'null' };
    })()`);
    const actsOk = opened.acts.length >= MIN_ITEMS && opened.acts.every((a) => ALLOW_ACTS.indexOf(a) >= 0)
      && NEED_ACTS.every((a) => opened.acts.indexOf(a) >= 0);
    r4i = { ok: opened.menuN >= 1 && opened.items >= MIN_ITEMS && actsOk && opened.exp === 'true'
              && closed.menuN === 0 && closed.back === true && closed.exp === 'false',
            menuN: opened.menuN, items: opened.items, acts: opened.acts,
            closed: closed.menuN === 0, back: closed.back, focusAfter: closed.focusAfter };
  }
}

trace('goto apps');
await goto('apps.html');
const appsSnap = JSON.parse(await ev(APPS_SNAP));

/* R6 前先量 R1-R5/R7/R8（R6 会把列表改成 32 张，之后一切数字都不再是"这页"的数） */
const listed = judge(snap, { gridKcard: appsSnap.gridKcard, allKcard: appsSnap.allKcard, appsN: appsSnap.appsN }, r4i);
print(listed);
rowsOut.push(...listed);   /* 计票也要算上 R1..R5，否则汇总行会谎报"规则 1 条" */

/* ══════════════════════════ R6：30+ 压测 ══════════════════════════ */
trace('stress');
await goto('components.html');
const stress = JSON.parse(await ev(STRESS));
if (stress.err) {
  console.log(`FAIL  R6 —— 压测造不出来（${stress.err}）；这不是绿，是没量`, '\n');
  rowsOut.push({ id: 'R6', pass: false, detail: stress.err });
} else {
  /* ★2026-11-04：组件库现在分页（components.html 的 PAGE=24），"首屏渲染出全部 N 张"
     这个老前提跟分页冲突。判据的本意是「32 张不许被悄悄吞掉」，所以改成两条：
     ①总数必须诚实地报出来（#total 逐字「共 32 个组件」）；
     ②真没全渲染就必须有翻页控件兜着（rendered === n1 或 #pager 可见）。 */
  const totalOk = String(stress.totalText).replace(/\s+/g, '') === ('共' + stress.n1 + '个组件');
  const ok6 = totalOk && (stress.rendered === stress.n1 || stress.pagerShown)
    && stress.rendered >= MIN_VISIBLE && stress.rendered <= stress.n1
    && stress.visible >= MIN_VISIBLE;
  console.log(`${ok6 ? 'PASS' : 'FAIL'}  R6 —— DB.COMPS ${stress.n0}→${stress.n1} 张、重渲染后 .crow=${stress.rendered}`
    + `｜总数文案「${stress.totalText}」（要「共${stress.n1}个组件」）｜翻页控件 ${stress.pagerShown ? '在' : '不在'}`
    + `｜首屏下沿(top<${VISIBLE_TOP}) 可见 ${stress.visible} 张（要 ≥${MIN_VISIBLE}）`
    + `｜前 ${stress.firstTops.length} 张 top=${stress.firstTops.join('/')}`
    + `｜量完 reload 复原（只改内存，未写 data.js / localStorage）`);
  rowsOut.push({ id: 'R6', pass: ok6, detail: `32 张时首屏可见 ${stress.visible} 张` });
}
/* 复原：重载页面，内存里的 32 张随页面一起丢掉 */
await goto('components.html');
const back = JSON.parse(await ev(SNAP));
if (back.crowN !== snap.crowN) {
  console.log(`⚠ 复原失败：reload 后 .crow=${back.crowN}（要 ${snap.crowN}）—— 后续读数不可信`);
  rowsOut.push({ id: 'R6-复原', pass: false, detail: `.crow=${back.crowN}` });
}

console.log('');
const bad = rowsOut.filter((r) => !r.pass);
console.log(`规则 ${rowsOut.length} 条｜通过 ${rowsOut.length - bad.length}｜断点 ${bad.length}` + (bad.length ? `（${bad.map((r) => r.id).join(' ')}）` : ''));

/* ══════════════════════════ 负控 ══════════════════════════
   只在页面里造坏状态（CSS/JS 覆写），一个文件都不改；每一刀都必须让**它点名的那条**规则变红，
   任何一刀没被抓住 ⇒ rc=3「未量」，不许假装绿。基线本来红着就先判 rc=4（否则任何刀都会"命中"）。 */
if (NEG) {
  const premise = judge(snap, { gridKcard: appsSnap.gridKcard, allKcard: appsSnap.allKcard, appsN: appsSnap.appsN }, null);
  const premiseBad = premise.filter((r) => !r.pass);
  if (premiseBad.length) {
    console.log(`\n负控前提不成立：注入前基线已红 ${premiseBad.length} 条（${premiseBad.map((r) => r.id).join(' ')}）`);
    console.log('      ⇒ 基线红着跑负控，任何刀都会"命中"，证明不了任何事（rc=4，先修基线）');
    trace('negctl premise red ' + premiseBad.map((r) => r.id).join(' '));
    try { ws.close(); } catch (e) {}
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(4);
  }

  const MUTATIONS = [
    { k: 'a', expect: 'R1', label: '第一张卡卡高改成 80px',
      js: `(function(){ var c = document.querySelectorAll('#grid .crow')[0]; if (!c) return 'no-card'; c.style.height = '80px'; return 'ok'; })()` },
    { k: 'b', expect: 'R2', label: '第一张卡 .cl-tt 塞超长名字并抹掉 title',
      js: `(function(){ var t = document.querySelector('#grid .crow .cc-hd .cl-tt'); if (!t) return 'no-tt';
        t.textContent = '规则配置（医药口径）超长组件名称用于负控测试abcdefghijklmnop'; t.removeAttribute('title'); return 'ok'; })()` },
    { k: 'c', expect: 'R3', label: '一张卡的引用数改成假数「被 99 个应用使用」',
      js: `(function(){ var m = document.querySelector('#grid .crow .cc-meta'); if (!m) return 'no-meta';
        m.textContent = '被 99 个应用使用'; m.setAttribute('title', '被 99 个应用使用'); return 'ok'; })()` },
    { k: 'd', expect: 'R4', label: '把 ⋮ 的对比度压到 rgba(0,0,0,.2)（静止态读不出来）',
      js: `(function(){ var s = document.createElement('style'); s.id = 'negctl-knife';
        s.textContent = '#grid .cl-ops .k-more{color:rgba(0,0,0,.2)!important}'; document.head.appendChild(s); return 'ok'; })()` },
    { k: 'e', expect: 'R5', label: '把一张 .crow 包进 .kcard（两页结构混起来）',
      js: `(function(){ var c = document.querySelector('#grid .crow'); if (!c) return 'no-card';
        var w = document.createElement('div'); w.className = 'kcard';
        c.parentNode.insertBefore(w, c); w.appendChild(c); return 'ok'; })()` },
    { k: 'f', expect: 'R7', label: '第二张卡 data-on 改成 0 但文案仍写「启用」（状态漂移）',
      js: `(function(){ var cs = document.querySelectorAll('#grid .crow'); if (cs.length < 2) return 'no-card';
        var c = cs[1]; if (!c.querySelector('.cc-sw')) return 'no-sw'; c.setAttribute('data-on', '0'); return 'ok'; })()` },
    /* ★2026-10-28 新增（反向刀）：R7 的 STATES 原来只有「启用/禁用/草稿」，
       一旦出现「未发布」的组件就**假红**。这刀注入的就是那个合法状态 —— 它必须**保持绿**；
       若哪天常量又退回三态，这刀会红（= 假红回来了）。 */
    { k: 'h', keep: 'R7', label: '把一张禁用卡的开关文案改成「未发布」（合法三态，必须仍然绿）',
      js: `(function(){ var cs=document.querySelectorAll('#grid .crow'); if(!cs.length) return 'no-card';
        var t=null; cs.forEach(function(c){ if(!t && c.getAttribute('data-on')==='0' && c.querySelector('.cc-sw')) t=c.querySelector('.cc-sw'); });
        if(!t) return 'no-off-card'; t.textContent='未发布'; return 'ok'; })()` },
    { k: 'g', expect: 'R8', label: '引用数塞回「中金 · 采购合… +3」这种拼接残句',
      js: `(function(){ var m = document.querySelector('#grid .crow .cc-meta'); if (!m) return 'no-meta';
        m.textContent = '中金 · 采购合… +3'; m.setAttribute('title', '中金 · 采购合… +3'); return 'ok'; })()` },
  ];
  console.log('\n负控（页面内造坏状态，不落盘）');
  let missed = 0;
  for (const M of MUTATIONS) {
    await goto('components.html');
    const applied = await ev(M.js);
    await SLEEP(250);
    const s = JSON.parse(await ev(SNAP));
    const got = judge(s, { gridKcard: appsSnap.gridKcard, allKcard: appsSnap.allKcard, appsN: appsSnap.appsN }, null);
    const red = got.filter((r) => !r.pass);
    if (applied !== 'ok') {
      console.log(`  未量 (${M.k}) ${M.label} —— 造不出来（${applied}）`);
      missed++;
      continue;
    }
    if (M.keep) {
      /* 反向刀：合法输入不许被判红（假红侧的负控） */
      if (red.some((r) => r.id === M.keep)) {
        console.log(`  ✗ (${M.k}) ${M.label} —— 合法状态被判红了（${M.keep}）⇒ 这条判据在假红`);
        missed++;
        continue;
      }
      console.log(`  ✓ (${M.k}) ${M.label} ⇒ ${M.keep} 仍绿`);
      trace('negctl ' + M.k + ' keep-green ' + M.keep);
      continue;
    }
    if (!red.some((r) => r.id === M.expect)) {
      console.log(`  ✗ (${M.k}) ${M.label} —— 变红的是 ${red.map((r) => r.id).join('/') || '无'}，但没命中点名的 ${M.expect} ⇒ 那条规则没在量`);
      missed++;
      continue;
    }
    console.log(`  ✓ (${M.k}) ${M.label} ⇒ 命中 ${red.map((r) => r.id).join('/')}（点名 ${M.expect}）`);
    trace('negctl ' + M.k + ' hit ' + red.map((r) => r.id).join('/'));
  }

  /* 还原复核：干净加载后基线必须全绿（坏状态不许靠残留样式"命中"） */
  await goto('components.html');
  await SLEEP(300);
  const clean = judge(JSON.parse(await ev(SNAP)), { gridKcard: appsSnap.gridKcard, allKcard: appsSnap.allKcard, appsN: appsSnap.appsN }, null);
  const cleanBad = clean.filter((r) => !r.pass);
  console.log(`  还原复核：干净加载后 ${cleanBad.length ? '仍有 ' + cleanBad.length + ' 条 FAIL（' + cleanBad.map((r) => r.id).join('/') + '）' : '基线全绿'}`);
  console.log('');
  try { ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  if (missed) {
    console.log(`负控 ${MUTATIONS.length - missed}/${MUTATIONS.length} 命中：有 ${missed} 刀没被抓住 ⇒ 判据在这一格没量（rc=3 未量）`);
    process.exit(3);
  }
  if (cleanBad.length) { console.log('负控后基线没复绿 ⇒ 本负控不算数（rc=3 未量）'); process.exit(3); }
  console.log(`负控 ${MUTATIONS.length}/${MUTATIONS.length} 命中且基线复绿 ⇒ 判据是活的（rc=2）`);
  trace('negctl all hit');
  process.exit(2);
}

try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
if (bad.length) { console.log(`FAIL：${bad.length} 条（${bad.map((r) => r.id).join(' ')}）`); trace('FAIL ' + bad.map((r) => r.id).join(' ')); process.exit(2); }
console.log('PASS：R1 卡高等/列线/溢出 ｜ R2 截断有全文 title ｜ R3 引用数溯源 ｜ R4 ⋮ 可读可点可关 ｜ R5 两页结构可分 ｜ R6 32 张首屏 ≥9 ｜ R7 状态表示与值一一对应 ｜ R8 引用数无拼接残句');
trace('PASS');
process.exit(0);
