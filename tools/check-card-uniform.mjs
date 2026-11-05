#!/usr/bin/env node
/* check-card-uniform —— 组件库「同类型元素必须同一尺寸」判据。
 *
 * 为什么要有它：2026-10-24 用户原话「组件库那个页面，为什么每个卡片大小都是不一样的？
 * 统一不知道吗？这是最基本的设计理念、设计规范。同样类型的卡片样式组件，为什么要设计成不同的？」
 * 判据盯死：**同一页内同类型元素宽两两相等、高两两相等、按栅格对齐**（不许靠 margin 凑）。
 *
 * ── 形态沿革（三次，判据每次只翻译、不放宽）──────────────────────────
 *   ① 10-24 4 列卡栅格（.kcard 一族）
 *   ② 10-25 单列行式列表（.cl-head + .crow 六列）—— 一次中间形态
 *   ③ 10-25 晚 用户「我服了，组件管理我需要的是好看的卡片」⇒ 行表作废，改回卡片；
 *      现行形态＝`#grid.clist` 四列网格 + 8 张 `.crow.ccard`（cc-body 信息区 + cc-ft 操作带）。
 *
 * ★2026-10-27 重锚（本轮 T11）：本判据此前停在 ②，量的是 `.cl-head` / `.cl-ver` / `.cl-ico` /
 *   六列逐格左缘 —— 这些对象在 ③ 里**一个都不存在**，于是**正控自己就先红 7 条**
 *   （实测 rc=2，FAIL：④ ④b ⑧a ⑨a ⑨b ⑨c ⑪a）。基线红着跑负控，任何一刀都会"命中"，
 *   那不是判据会红，是它一直在红。翻译到 ③（同一个"统一尺寸"的尺子，容差一个没放宽）：
 *
 *     ① .crow 数 == DB.COMPS.length      → 同上（对象类名不变，仍 8 张）
 *     ② 行宽两两相等（容差 0）            → **卡宽**两两相等（容差 0）
 *     ③ 行高两两相等（容差 0）            → **卡高**两两相等（容差 0）
 *     ④ 行左缘全等 + 首尾相接            → 同一行的卡顶边全等、行与行间距 == 栅格 row-gap（≤0.5）、
 *                                          全部卡左缘落在**同一套 4 条列线**上（跨行同列全等，容差 0）
 *     ④b 严格 1 列 + 表头逐格左缘        → **严格 4 列**：轨道数 4、Σ轨道+Σ列距 == #grid 内容盒（≤0.5）、
 *                                          每张卡宽 == 轨道宽（≤0.5，末行 2 张不拉伸）
 *     ⑤ 撤干净（.kcard/is-main/k-used）   → 同上（本页 #grid 里 .kcard 必须 = 0）
 *     ⑥ 1440 无横向溢出                  → 同上（doc 与 #grid 各量一次）
 *     ⑦ 每行 ⋯ 静止可见                  → 同上（每卡 .k-more、opacity ≥0.9、占位 >0）
 *     ⑧ 两页一眼分开（双向）              → 组件卡：无封面 .kc-cover、无 .k-ico、有 .cc-sw 状态开关；
 *                                          应用卡：有 .kc-print-slot 装配指纹条、无 .cc-sw
 *                                          （2026-11-01：应用卡的 .kc-cover 已删，见 C6 的修订记录）
 *     ⑨ 硬字段不截断 / 格子不出行右缘     → 卡内文字格（.cl-tt/.cl-desc/.cc-meta）右缘不出卡右缘；
 *                                          **被截断的必须有覆盖全文的 title**（省略号不许把全称藏掉）
 *     ⑩ 格顶偏移 / 列格高跨行全等         → 每卡「.cl-tt 顶 − 卡顶」「.cc-ft 顶 − 卡顶」「.cc-ft 高」
 *                                          跨 8 卡全等（容差 0）—— 对齐由模板给，不由内容撑
 *     ⑪ 行首图标列对齐表头                → 状态开关 .cc-sw：每卡都有、高 ≥24（WCAG 2.5.8）、
 *                                          与卡右缘的距离跨 8 卡全等（≤1px）—— 取代"图标列对齐表头"
 *                                          （卡上不再有图标列；"同一列的控件必须钉在同一条线"是同一件事）
 *
 * ★2026-10-28 随「三列 · 两区」形态（《组件卡样式规范-20261028》§7.4/§7.5/§7.9）改四格：
 *   ②  容差 0 → ±1：4 列时 (1202−96)/4=276.5 是整数，3 列时 (1202−64)/3=379.333… 除不尽，
 *      浏览器按 1/64px 落到 379.328/379.328/379.344 —— 实测差 0.01px，是**栅格除法的余数，不是渲染差异**。
 *      阈值取规格 §8.2 的原数「卡 379.3×156（±1）」；③ 高仍为 0（156 是整数，无余数，不放宽）。
 *      ★2026-11-04（m07271）：卡底加规格条后实际卡高 188（374.33×188），本判据仍只判"两两相等"，
 *      不写死高度；旧注释里的 156 是旧规格的历史值。
 *   ④/④b 列数 4 → 断点表：<1720 = 3 列、≥1720 = 4 列（sys.css .page-components #grid 的声明）。
 *      并在运行时真量两个宽度，证明"声明值"确实生效（只看 1440 一个宽度，断点写错也照样绿）。
 *   ⑪  判"右缘距卡右缘"→ 判"左缘距卡左缘"：开关已从标题行右端移到运行带**左端**，
 *      右缘只是"定宽 66"的副产品，不是要对齐的那条线。顺带把 §7.9「开关/配置/⋮ 同一条基线」
 *      并进这一条（同一条带子的对齐只有一处定义，不另立一条判据）。
 *
 * 用法：node tools/check-card-uniform.mjs            正控
 *      node tools/check-card-uniform.mjs --negctl   负控：页面内逐刀造坏状态（不落盘，刀表见 KNIVES），
 *                                                 每刀必须命中**它点名的那条**判定
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：刀表全命中即 2）｜ 3 未量（Chrome 起不来／没有 .crow／
 *         有刀没被抓住／还原后基线没复绿）｜ 4 负控前提不成立（注入前基线已经是红的）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACE = '/tmp/xz-audit/uniform-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* ── 阈值（唯一处；负控档也读这里，不许另写一套） ── */
const TOL_SIZE = 0;      /* ③④⑩：高/顶距 全等容差（原来是 0，不许放宽） */
const TOL_SIZE_W = 1;    /* ② 卡宽：出处＝《组件卡样式规范-20261028》§8.2「卡 379.3×156（±1）」；
                            2026-11-04 卡高改 188，宽仍按 §8.2 的 ±1 栅格余量。
                            0 做不到：3 列 1fr 除不尽（379.328/379.328/379.344，实测差 0.01）。 */
const TOL_COL = 0;       /* ④：跨行同列左缘全等 */
const TOL_WIDTH = 0.5;   /* ④④b：卡宽 vs 轨道宽 / 栅格 Σ vs 内容盒 */
const MIN_OPACITY = 0.9; /* ⑦ ⋯ 静止态 */
const MIN_SW = 24;       /* ⑪ 状态开关点击目标下限（WCAG 2.5.8） */
const SW_ALIGN = 1;      /* ⑪ 开关左缘距卡左缘 跨卡全等（也是"同一条基线"的垂直容差） */
const SW_LEFT = 16;      /* ⑪ 开关左缘距卡左缘的目标值 = --sp-16（规范 §4.2 运行带内距 16） */
const SW_W_TOL = 1;      /* ⑪ 开关渲染宽 = --cc-sw-w ±1（规范 §7.5：定宽才保证三态同宽） */
const CARD_INSET = 1;    /* ⑨ 文字格右缘离卡右缘至少留 1（卡边框） */
/* ④b 栅格列数：由断点声明，不由常量写死（规范 §7.4）。
   声明处＝assets/sys.css 的 .page-components #grid（repeat(3,…)）＋ @media (min-width:1720px)（repeat(4,…)）。
   运行时还会真量 1720 那一档，证明这张表和 CSS 真的一致 —— 表写错了会红，不是自说自话。 */
const BASE_COLS = 3;
const BREAKS = [{ min: 1720, cols: 4 }];
const wantCols = (w) => {
  const hit = BREAKS.filter((b) => w >= b.min).sort((a, b) => b.min - a.min)[0];
  return hit ? hit.cols : BASE_COLS;
};

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/carduniform-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
const goto = async (u) => {
  await send('Page.navigate', { url: BASE + '/' + u });
  await SLEEP(900);
};

/* 看门狗：120s 没跑完就明说超时（rc=3），不装作还在跑 */
setTimeout(() => { console.log('GATE TIMEOUT: 120s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 120000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* grid-template-columns 解成每档 px（minmax(0,1fr) 取上限；被挤到 0 的 1fr 也要读成 0，
   否则少一档就等于少进 Σ，④b 会变成假绿） */
function parseCols(s) {
  return String(s).replace(/minmax\([^,]+,\s*([^)]+)\)/g, '$1')
    .split(/\s+/).filter((t) => /^-?[\d.]+(px)?$/.test(t)).map((t) => parseFloat(t));
}
const PAGE_LIB = parseCols.toString();

/* ── 页面里的一次性快照（只读；量渲染结果，不量 CSS 声明） ─────────────── */
const SNAP = `(function(){
  ${PAGE_LIB}
  var qa = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var q  = function (s, r) { return (r || document).querySelector(s); };
  var num = function (v) { return parseFloat(String(v)); };
  var R = function (n) { var r = n.getBoundingClientRect();
    return { t: +r.top.toFixed(2), b: +r.bottom.toFixed(2), l: +r.left.toFixed(2), r: +r.right.toFixed(2),
             w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  var txt = function (n) {
    if (!n) return null;
    var b = R(n);
    return { t: b.t, b: b.b, l: b.l, r: b.r, w: b.w, h: b.h,
             sw: n.scrollWidth, cw: n.clientWidth,
             text: (n.textContent || '').trim(), title: n.getAttribute('title') || '' };
  };
  var g = q('#grid');
  if (!g) return JSON.stringify({ err: '没有 #grid' });
  var gs = getComputedStyle(g), gr = R(g);
  var cards = qa('#grid .crow');
  return JSON.stringify({
    comps: (window.DB && DB.COMPS) ? DB.COMPS.length : -1,
    grid: gr, gridSw: g.scrollWidth, gridCw: g.clientWidth,
    padL: num(gs.paddingLeft), padR: num(gs.paddingRight),
    cols: parseCols(gs.gridTemplateColumns), colGap: num(gs.columnGap), rowGap: num(gs.rowGap),
    cards: cards.map(function (c) {
      var cr = R(c);
      var pb = getComputedStyle(c, '::before');
      var more = q('.k-more', c), ms = more ? getComputedStyle(more) : null;
      return { id: c.getAttribute('data-id'), t: cr.t, b: cr.b, l: cr.l, r: cr.r, w: cr.w, h: cr.h,
               cells: [].slice.call(c.children).map(function (k) {
                 var kr = R(k); return { cls: String(k.className || ''), t: kr.t, b: kr.b, l: kr.l, r: kr.r, w: kr.w, h: kr.h };
               }),
               tt: txt(q('.cc-hd .cl-tt', c)),
               desc: txt(q('.cl-desc', c)),
               meta: txt(q('.cc-meta', c)),
               ft: q('.cc-ft', c) ? R(q('.cc-ft', c)) : null,
               sw: q('.cc-sw', c) ? R(q('.cc-sw', c)) : null,
               /* ⑪ 的"同一条基线"要量开关/配置/⋮ 三个控件的中点，不是只量开关 */
               act: q('.cl-ops .k-more', c) ? R(q('.cl-ops .k-more', c)) : null,   /* ★2026-11-04 .kbtn 不存在，行内动作钮是 .k-more */
               /* ★2026-10-28：原来只取 w/h/r，没有 t/b —— ⑪ 量"三个控件的中点"时拿到 NaN，
                 而 NaN>1 恒为 false ⇒ 那条断言是死的（负控 g 一开始就是这么被漏掉的）。补齐 t/b。 */
               more: more ? { op: +ms.opacity, vis: ms.visibility, t: R(more).t, b: R(more).b, w: R(more).w, h: R(more).h, r: R(more).r } : null,
               hasCover: !!q('.kc-cover', c), hasIco: !!q('.k-ico', c),
               strip: { content: String(pb.content), height: pb.height, bg: String(pb.backgroundImage).slice(0, 80) } };
    }),
    legacy: {
      gridKcard: document.querySelectorAll('#grid .kcard').length,
      allKcard: document.querySelectorAll('.kcard').length,
      isMain: document.querySelectorAll('.is-main').length,
      kUsed: document.querySelectorAll('.k-used').length
    },
    innerW: window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    /* ⑪ 的定宽真值从令牌读，不在判据里写死 66 —— 令牌改了判据跟着走，不搞第二份常量 */
    swW: getComputedStyle(document.documentElement).getPropertyValue('--cc-sw-w').trim()
  });
})()`;

/* 应用页：⑧b 的对照面（只读，永不修改 apps.html） */
const APPS_SNAP = `(function(){
  var qa = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var cards = qa('#grid .kcard');
  return JSON.stringify({ n: cards.length,
    /* 2026-11-01：应用卡不再有 .kc-cover（用户否掉长封面），改量装配指纹条 */
    cover: qa('#grid .kcard .kc-cover-img').length,
    sw: qa('#grid .kcard .cc-sw').length,
    ico: qa('#grid .kcard .k-ico').length });
})()`;

/* ⑤ 静态面：sys.css 里不许再有 is-main / k-used 选择器（死 CSS 会误导下一个人） */
const cssSrc = readFileSync(join(HERE, '..', 'assets', 'sys.css'), 'utf8');
const CSS_LEGACY = /\.is-main|\.k-used/.test(cssSrc);

const fmt = (n) => String(Math.round(Number(n) * 100) / 100);
const span = (a) => (a.length ? Math.round((Math.max(...a) - Math.min(...a)) * 100) / 100 : NaN);

/* ══════════ 判定：一个快照 → ①..⑪（正控与负控走同一段代码） ══════════ */
function judge(s, apps, bp) {
  const out = [];
  const mark = (id, pass, detail) => { out.push({ id, pass, detail }); return pass; };
  const cards = s.cards || [];
  const ids = cards.map((c) => c.id);

  /* ① 数量：卡数 == DB.COMPS.length（少一张就说明有条目被"变体"撑没了） */
  mark('① 卡数 == DB.COMPS.length', s.comps > 0 && cards.length === s.comps,
    `DOM ${cards.length} 张 vs DB.COMPS ${s.comps} 个`);

  /* ② 卡宽 / ③ 卡高（高容差 0：用户要的是"一模一样"；宽取规格给的 ±1，理由见 TOL_SIZE_W） */
  const ws_ = cards.map((c) => c.w), hs = cards.map((c) => c.h);
  const wSpan = span(ws_), hSpan = span(hs);
  mark('② 卡宽两两相等（容差 ' + TOL_SIZE_W + '，规格 §8.2 的 ±1）', cards.length > 0 && wSpan <= TOL_SIZE_W,
    `最宽 ${fmt(Math.max(...ws_))} / 最窄 ${fmt(Math.min(...ws_))}，差 ${fmt(wSpan)}px`);
  mark('③ 卡高两两相等（容差 ' + TOL_SIZE + '）', cards.length > 0 && hSpan <= TOL_SIZE,
    `最高 ${fmt(Math.max(...hs))} / 最矮 ${fmt(Math.min(...hs))}，差 ${fmt(hSpan)}px`);

  /* ④ 同一行卡顶全等 + 行距 == row-gap + 全部卡落在同一套列线上（列数＝当前断点的声明值） */
  {
    const want = wantCols(s.innerW);
    const rows = new Map();  /* top → [card] */
    cards.forEach((c) => { if (!rows.has(c.t)) rows.set(c.t, []); rows.get(c.t).push(c); });
    const tops = [...rows.keys()].sort((a, b) => a - b);
    const topBad = [...rows.entries()].filter(([, cs]) => span(cs.map((c) => c.t)) > TOL_SIZE).map(([t]) => t);
    const seams = [];
    for (let i = 1; i < tops.length; i++) {
      const prev = rows.get(tops[i - 1])[0], cur = rows.get(tops[i])[0];
      const d = Math.round((cur.t - prev.b) * 100) / 100;
      if (Math.abs(d - s.rowGap) > 0.5) seams.push(`第 ${i}→${i + 1} 行间距 ${fmt(d)} ≠ row-gap ${fmt(s.rowGap)}`);
    }
    /* 列线：全部左缘去重后必须正好 = 断点声明值 条，且每行的左缘是这套线的前 N 条（跨行同列全等，容差 0） */
    const lines = [...new Set(cards.map((c) => c.l))].sort((a, b) => a - b);
    const lineBad = [];
    [...rows.entries()].forEach(([t, cs]) => {
      const ls = cs.map((c) => c.l);
      const uniq = [...new Set(ls)].sort((a, b) => a - b);
      if (uniq.length !== ls.length) lineBad.push(`行 ${t} 有两张卡同一左缘`);
      if (uniq.some((x, i) => Math.abs(x - lines[i]) > TOL_COL)) lineBad.push(`行 ${t} 左缘 ${uniq.join('/')} 不在列线 ${lines.join('/')} 上`);
    });
    const pass = cards.length > 0 && topBad.length === 0 && seams.length === 0
      && lines.length === want && lineBad.length === 0;
    mark('④ 同行卡顶全等、行距 = row-gap、左缘落在同一套 ' + want + ' 条列线（容差 ' + TOL_SIZE + '）', pass,
      `${rows.size} 行 × ${lines.length} 条列线（${lines.map(fmt).join('/')}）｜行距 ${fmt(s.rowGap)}px`
      + `｜${fmt(s.innerW)} 宽下应 ${want} 条`
      + (topBad.length ? `｜同行卡顶不等 ${topBad.length} 行` : '')
      + (seams.length ? `｜${seams.slice(0, 2).join('；')}` : '')
      + (lines.length !== want ? `｜列线 ${lines.length} 条 ≠ ${want}` : '')
      + (lineBad.length ? `｜${lineBad.slice(0, 2).join('；')}` : ''));
  }

  /* ④b 严格 N 列（N = 断点声明值）：轨道数 = N、Σ轨道+Σ列距 == 内容盒、每卡宽 == 轨道宽（末行 2 张不拉伸） */
  {
    const want = wantCols(s.innerW);
    const contentW = Math.round((s.grid.w - s.padL - s.padR) * 100) / 100;
    const sum = (s.cols || []).reduce((a, v) => a + v, 0) + s.colGap * Math.max(0, (s.cols || []).length - 1);
    const track0 = (s.cols || [])[0] ?? NaN;
    const widthBad = cards.filter((c) => Math.abs(c.w - track0) > TOL_WIDTH);
    /* 断点自证：同一份 CSS 在两个宽度下必须给出不同的轨道数。只量 1440 时，
       `@media(min-width:1720px)` 整段写错也照样绿 —— 那份"声明值"就是我自己编的。 */
    const bpBad = !bp || bp.low.cols.length !== BASE_COLS || bp.high.cols.length !== BREAKS[0].cols
      ? `断点未证：${bp ? bp.low.w + '→' + bp.low.cols.length + ' 轨 / ' + bp.high.w + '→' + bp.high.cols.length + ' 轨' : '没量'}`
      : null;
    const pass = cards.length > 0 && (s.cols || []).length === want
      && Math.abs(sum - contentW) <= TOL_WIDTH && widthBad.length === 0 && !bpBad;
    mark('④b 严格 ' + want + ' 列（断点声明值）：卡宽 = 轨道宽、Σ轨道+Σ列距 = 内容盒（容差 ' + TOL_WIDTH + '）', pass,
      `轨道 ${(s.cols || []).map(fmt).join('/')}（${(s.cols || []).length} 条）｜Σ=${fmt(sum)} vs 内容盒 ${fmt(contentW)}`
      + `｜卡宽 ${fmt(cards[0] ? cards[0].w : NaN)} vs 轨道 ${fmt(track0)}（超差 ${widthBad.length} 张）`
      + (bpBad ? `｜${bpBad}` : `｜断点自证 ${bp.low.w}→${bp.low.cols.length} 轨 / ${bp.high.w}→${bp.high.cols.length} 轨`));
  }

  /* ⑤ 撤干净：DOM 无 .is-main/.k-used、本页 #grid 无 .kcard、sys.css 无 is-main/k-used 选择器 */
  {
    const L = s.legacy || {};
    const pass = L.gridKcard === 0 && L.isMain === 0 && L.kUsed === 0 && !CSS_LEGACY;
    mark('⑤ 撤干净：本页 #grid 无 .kcard、DOM 无 .is-main/.k-used、sys.css 无该选择器', pass,
      `#grid .kcard ${L.gridKcard} 个（要 0）｜is-main ${L.isMain}｜k-used ${L.kUsed}`
      + `｜sys.css is-main/k-used 选择器 ${CSS_LEGACY ? '有残留' : '0 处'}`);
  }

  /* ⑥ 横向不溢出（1440 下不许出现横向滚动条；面板自己也不许） */
  mark('⑥ 1440 下无横向溢出', s.scrollW <= s.innerW && s.gridSw <= s.gridCw,
    `doc scrollWidth ${s.scrollW} ≤ innerWidth ${s.innerW}｜#grid ${s.gridSw} ≤ ${s.gridCw}`);

  /* ⑦ ⋯ 常显：静止态（鼠标没在任何卡上）就得看得见，且每一张卡都得有 */
  {
    const missing = cards.filter((c) => !c.more).map((c) => c.id);
    const hidden = cards.filter((c) => c.more && (c.more.op < MIN_OPACITY || c.more.vis === 'hidden' || c.more.w <= 0 || c.more.h <= 0))
      .map((c) => `${c.id} opacity ${c.more.op}/vis ${c.more.vis}/${fmt(c.more.w)}×${fmt(c.more.h)}`);
    const pass = cards.length > 0 && missing.length === 0 && hidden.length === 0;
    const m0 = cards.find((c) => c.more);
    mark('⑦ ⋯ 静止态可见（未悬停，每张卡都有）', pass,
      `${cards.length - missing.length}/${cards.length} 张有 .k-more`
      + (missing.length ? `（缺 ${missing.slice(0, 3).join(',')}）` : '')
      + (m0 ? `｜opacity ${m0.more.op}、${fmt(m0.more.w)}×${fmt(m0.more.h)}（要求 ≥${MIN_OPACITY} 且占位）` : '')
      + (hidden.length ? `｜不达标：${hidden.slice(0, 2).join('；')}` : ''));
  }

  /* ⑧ 两页一眼分开（双向断言）：组件卡是"文字 + 状态开关"，应用卡是"封面图"。
     卡顶彩条两侧都已撤（无图例的色码把"状态"讲成了另一件事），所以分野只剩这两条。 */
  {
    const compNoCover = cards.filter((c) => c.hasCover).map((c) => c.id);
    const compNoIco = cards.filter((c) => c.hasIco).map((c) => c.id);
    const compSw = cards.filter((c) => c.sw).length;
    const a = apps || {};
    const compOK = cards.length > 0 && compNoCover.length === 0 && compNoIco.length === 0 && compSw === cards.length;
    const appOK = !!a.n && a.cover === a.n && a.sw === 0;
    mark('⑧a 组件卡：无封面、无 .k-ico、每卡有状态开关 .cc-sw', compOK,
      `封面 ${compNoCover.length} 张（要 0）｜.k-ico ${compNoIco.length} 张（要 0）｜.cc-sw ${compSw}/${cards.length}`);
    mark('⑧b 应用卡：有封面 .kc-cover-img、无 .cc-sw', appOK,
      `apps.html ${a.n || 0} 张 .kcard｜.kc-cover-img ${a.cover}｜.cc-sw ${a.sw}（要 0）`);
  }

  /* ⑨ 卡内文字不出界 + 被截断的必须有覆盖全文的 title
     （原来「硬字段 .cl-tt/.cl-ver/.cl-st 不截断」在卡片形态里的同一件事：全称不许丢。
      卡片允许单行省略，但省略的代价必须是 title 里有全文 —— 否则客户永远看不到组件全名。） */
  {
    let cellN = 0;
    const overflow = [], noTitle = [];
    cards.forEach((c) => {
      [['.cl-tt', c.tt], ['.cl-desc', c.desc], ['.cc-meta', c.meta]].forEach(([name, v]) => {
        if (!v) return;
        cellN++;
        if (v.r > c.r - CARD_INSET) overflow.push(`${c.id}${name} 右缘 ${fmt(v.r)} 越出卡右缘 ${fmt(c.r)}−${CARD_INSET}`);
        if (v.sw > v.cw) {
          if (!v.title) noTitle.push(`${c.id}${name} 被截断（${v.sw}>${v.cw}）却没有 title`);
          else if (v.title.length < v.text.length) noTitle.push(`${c.id}${name} title(${v.title.length} 字) 比可见文字(${v.text.length} 字) 短`);
        }
      });
    });
    mark('⑨a 卡内文字格不出卡右缘', cards.length > 0 && overflow.length === 0,
      overflow.length ? overflow.slice(0, 3).join('｜') : `${cellN} 格全部在卡内（右缘留 ${CARD_INSET}px）`);
    const cutN = cards.reduce((n, c) => n + [c.tt, c.desc, c.meta].filter((v) => v && v.sw > v.cw).length, 0);
    mark('⑨b 被截断的文字有覆盖全文的 title', cards.length > 0 && noTitle.length === 0,
      (noTitle.length ? noTitle.slice(0, 3).join('｜') + '｜' : '')
      + `截断 ${cutN} 格（每格都要求 title 覆盖全文；0 格也算量过——负控 c 会把这格撑出来）`);
  }

  /* ⑩ 卡内结构跨卡全等：.cl-tt 顶距 / .cc-ft 顶距 / .cc-ft 高（容差 0） */
  {
    const ttDy = cards.filter((c) => c.tt).map((c) => Math.round((c.tt.t - c.t) * 100) / 100);
    const ftDy = cards.filter((c) => c.ft).map((c) => Math.round((c.ft.t - c.t) * 100) / 100);
    const ftH = cards.filter((c) => c.ft).map((c) => c.ft.h);
    const bad = [];
    if (cards.length && ttDy.length !== cards.length) bad.push(`只有 ${ttDy.length}/${cards.length} 张卡有 .cl-tt`);
    if (span(ttDy) > TOL_SIZE) bad.push(`.cl-tt 顶距 ${ttDy.join('/')}（差 ${fmt(span(ttDy))}）`);
    if (span(ftDy) > TOL_SIZE) bad.push(`.cc-ft 顶距 ${ftDy.join('/')}（差 ${fmt(span(ftDy))}）`);
    if (span(ftH) > TOL_SIZE) bad.push(`.cc-ft 高 ${ftH.join('/')}（差 ${fmt(span(ftH))}）`);
    mark('⑩ 卡内结构跨卡全等（.cl-tt 顶距 / .cc-ft 顶距 / .cc-ft 高，容差 ' + TOL_SIZE + '）', cards.length > 0 && bad.length === 0,
      bad.length ? bad.slice(0, 3).join('｜')
        : `${cards.length} 张卡：.cl-tt 顶距 ${fmt(ttDy[0])}px、.cc-ft 顶距 ${fmt(ftDy[0])}px、.cc-ft 高 ${fmt(ftH[0])}px，全部差 0`);
  }

  /* ⑪ 运行带对齐（规范 §7.5 + §7.9）：开关钉在带上左端、定宽、三态同宽，
     且开关/配置/⋮ 在同一条垂直中心线上。
     ★2026-10-28 改写：原来判「.cc-sw 右缘距卡右缘跨卡全等」——那是开关还在标题行右端时的锚。
       开关移到运行带左端后，右缘距离只是"定宽 66"的副产品；判右缘等于在判"宽度恰好相等"，
       而真正要对齐的那条线是左缘 16。且一旦出现 3 字状态（未发布），右缘对齐会被误读成"宽度变了"。
     ★为什么不另立一条判据：同一条带子上的对齐只有一处定义（§7.9 的"四件事同基线"就是 ⑪ 的同一件事）。 */
  {
    const withSw = cards.filter((c) => c.sw);
    const swW = parseFloat(String(s.swW)) || NaN;                 /* 令牌 --cc-sw-w */
    const small = withSw.filter((c) => c.sw.h < MIN_SW).map((c) => `${c.id} 高 ${fmt(c.sw.h)}`);
    const leftGaps = withSw.map((c) => Math.round((c.sw.l - c.l) * 100) / 100);
    const leftShift = span(leftGaps);
    const widths = withSw.map((c) => c.sw.w);
    const wBad = swW ? withSw.filter((c) => Math.abs(c.sw.w - swW) > SW_W_TOL).map((c) => `${c.id} 宽 ${fmt(c.sw.w)}`) : [];
    /* 同一条基线：卡内三个控件的垂直中心两两差 ≤1（不判跨卡 —— ⑩ 已钉死 .cc-ft 的顶距与高，
       跨卡再判一次就是从 ⑩ 推导出来的恒真式，那种断言永远不会红）。 */
    const baseBad = [];
    cards.forEach((c) => {
      const y = (r) => (r && Number.isFinite(r.t) && Number.isFinite(r.h) ? Math.round((r.t + r.h / 2) * 100) / 100 : NaN);
      const ys = [['开关', y(c.sw)], ['配置', y(c.act)], ['⋮', y(c.more)]];
      const miss = ys.filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
      /* 三个控件缺一个 = 这条带子少一格，必须红；量不到（NaN）也不许当成"没差"——
         NaN > 1 恒为 false，去年这一格就是这么变成空心绿的。 */
      if (miss.length) { baseBad.push(`${c.id} 量不到：${miss.join('/')}`); return; }
      const d = span(ys.map(([, v]) => v));
      if (d > SW_ALIGN) baseBad.push(`${c.id} ${ys.map(([k, v]) => k + ' ' + fmt(v)).join(' / ')}（差 ${fmt(d)}）`);
    });
    const leftOK = withSw.length === cards.length && leftShift <= SW_ALIGN && Math.abs(leftGaps[0] - SW_LEFT) <= SW_ALIGN;
    const pass = cards.length > 0 && leftOK && small.length === 0 && wBad.length === 0 && baseBad.length === 0;
    mark('⑪ 运行带对齐：开关左缘距卡左缘 ' + SW_LEFT + '±' + SW_ALIGN + '、宽 = --cc-sw-w±' + SW_W_TOL
      + '、高 ≥' + MIN_SW + '、开关/配置/⋮ 垂直中心差 ≤' + SW_ALIGN + 'px', pass,
      `${withSw.length}/${cards.length} 张有 .cc-sw`
      + (withSw.length ? `｜左距 ${fmt(leftGaps[0])}px（跨卡差 ${fmt(leftShift)}）` : '')
      + (withSw.length ? `｜宽 ${fmt(widths[0])}（令牌 ${swW || '?'}，超差 ${wBad.length} 张）` : '')
      + (small.length ? `｜过小：${small.slice(0, 2).join('；')}` : '')
      + (cards[0] && [cards[0].sw, cards[0].act, cards[0].more].every(Boolean)
        ? `｜首卡中心 开关 ${fmt(cards[0].sw.t + cards[0].sw.h / 2)}/配置 ${fmt(cards[0].act.t + cards[0].act.h / 2)}/⋮ ${fmt(cards[0].more.t + cards[0].more.h / 2)}`
        : '')
      + (baseBad.length ? `｜不同基线：${baseBad.slice(0, 2).join('；')}` : ''));
  }

  return out;
}

function print(list) {
  for (const r of list) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}：${r.detail}`);
}

/* ══════════════════════════ 正控 ══════════════════════════ */
console.log('组件库卡片统一尺寸（components.html 断点栅格卡片 · 1440×900，真渲染量 getBoundingClientRect）'
  + (NEG ? '  [负控：页面内逐刀造坏状态，不落盘]' : ''));

await goto('components.html');
await SLEEP(400);
const snapRaw = await ev(SNAP);
const snap = JSON.parse(snapRaw);
if (snap.err) { console.log(`未量：${snap.err}`); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }
if (!snap.cards.length) {
  console.log(`未量：components.html 的 #grid 里没有 .crow（.kcard ${snap.legacy.gridKcard} 个）`);
  console.log('      ⇒ 这不是绿，是没量（rc=3）');
  try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3);
}
trace(JSON.stringify({ cards: snap.cards.length, comps: snap.comps, legacy: snap.legacy }));

/* ④b 的断点自证：同一页在「基准宽（1440）」与「断点宽（1720）」各量一次轨道数。
   量不到就 rc=3 未量 —— 少了这一段，`@media` 里写什么判据都同意。 */
const COLS_PROBE = `(function(){
  ${PAGE_LIB}
  var g = document.getElementById('grid');
  if (!g) return JSON.stringify({ err: '没有 #grid' });
  var gs = getComputedStyle(g), b = g.getBoundingClientRect();
  return JSON.stringify({ w: window.innerWidth, cols: parseCols(gs.gridTemplateColumns),
    gap: parseFloat(gs.columnGap),
    cw: Math.round((b.width - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight)) * 100) / 100 });
})()`;
async function colsAt(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await SLEEP(250);
  return JSON.parse(await ev(COLS_PROBE));
}
let bp = null;
try {
  const low = await colsAt(1440);
  const high = await colsAt(BREAKS[0].min);
  bp = { low, high, ok: true };
} catch (e) {
  console.log('未量：断点探测失败（' + String(e.message).slice(0, 120) + '）');
  try { ws.close(); } catch (e2) {}
  try { chrome.kill('SIGKILL'); } catch (e2) {}
  process.exit(3);
} finally {
  /* 回到基准宽：后面的正控快照与每一刀都在 1440 下量 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await SLEEP(200);
}

/* 应用页只读对照（⑧b）；量完回来 */
await goto('apps.html');
await SLEEP(600);
const apps = JSON.parse(await ev(APPS_SNAP));
await goto('components.html');
await SLEEP(500);

const verdicts = judge(snap, apps, bp);
print(verdicts);
console.log('');
const bad = verdicts.filter((v) => !v.pass);

/* ══════════════════════════ 负控 ══════════════════════════
   每刀单独一次页面加载（不累积），靶子写死；任何一刀没抓住**它点名的那条** ⇒ rc=3「未量」，不许当绿。
   ★2026-10-27：先验基线。基线本来就是红的，刀随便往哪砍都会"命中"——那是假红，不是证明。
     这也是上一版 5 刀里 2 刀造不出来的真因：靶子（.cl-ver/.cl-ico）在现行卡片上已不存在。
   ★2026-10-28：刀表跟着判据走 —— ⑪ 换锚点、④b 换列数来源，各补一刀；刀数不写死在文案里。 */
if (NEG) {
  if (bad.length) {
    console.log(`负控前提不成立：注入前基线已红 ${bad.length} 条（${bad.map((v) => v.id).join(' / ')}）`);
    console.log('      ⇒ 基线红着跑负控，任何刀都会"命中"，证明不了任何事（rc=4，先修基线）');
    trace('negctl premise red ' + bad.map((v) => v.id).join(' '));
    try { ws.close(); } catch (e) {}
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(4);
  }

  const KNIVES = [
    { k: 'a', expect: '③', label: '第一张卡卡高改成 80px',
      js: `(function(){ var c=document.querySelectorAll('#grid .crow')[0]; if(!c) return 'no-card'; c.style.height='80px'; return 'ok'; })()` },
    { k: 'b', expect: '⑦', label: '⋯ 打回 opacity:0',
      js: `(function(){ var s=document.createElement('style'); s.id='negctl-knife'; s.textContent='#grid .cl-ops .k-more{opacity:0!important}'; document.head.appendChild(s); return 'ok'; })()` },
    /* 靶子必须是**卡上仍被 ⑨ 断言的**文字格：原来往 .cl-ver 塞超长版本号，卡上没有 .cl-ver ⇒ 造不出来 */
    { k: 'c', expect: '⑨b', label: '第一张卡 .cl-tt 塞超长名字并抹掉 title（截断后全称无处可查）',
      js: `(function(){ var t=document.querySelector('#grid .crow .cc-hd .cl-tt'); if(!t) return 'no-tt'; t.textContent='规则配置（医药口径）超长组件名称用于负控测试abcdefghijklmnop'; t.removeAttribute('title'); return 'ok'; })()` },
    { k: 'd', expect: '⑪', label: '删掉第一张卡的 .cc-sw 状态开关',
      js: `(function(){ var b=document.querySelector('#grid .crow .cc-sw'); if(!b) return 'no-sw'; b.remove(); return 'ok'; })()` },
    { k: 'e', expect: '②', label: '第一张卡左移 10px（卡宽不再全等）',
      js: `(function(){ var c=document.querySelectorAll('#grid .crow')[0]; if(!c) return 'no-card'; c.style.marginLeft='10px'; return 'ok'; })()` },
    /* ★2026-10-28 新三刀：⑪ 换了锚点、④b 换了列数来源，各补一刀点名验它 */
    { k: 'f', expect: '⑪', label: '去掉 .cc-sw 的 min-width（三态不再同宽 → 宽度 ≠ --cc-sw-w）',
      js: `(function(){ var s=document.createElement('style'); s.id='negctl-knife';
        s.textContent='#grid .cc-sw{min-width:0!important}'; document.head.appendChild(s); return 'ok'; })()` },
    { k: 'g', expect: '⑪', label: '把 .cc-sw 改成 align-self:flex-start（离开运行带的同一条基线）',
      js: `(function(){ var s=document.createElement('style'); s.id='negctl-knife';
        s.textContent='#grid .cc-sw{align-self:flex-start!important}'; document.head.appendChild(s); return 'ok'; })()` },
    { k: 'h', expect: '④', label: '把栅格改成 repeat(4,…)（宽度 1440 却声明 4 列，与断点表不符）',
      js: `(function(){ var s=document.createElement('style'); s.id='negctl-knife';
        s.textContent='#grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}'; document.head.appendChild(s); return 'ok'; })()` },
    { k: 'i', expect: '④b', label: '把轨道定死 3×200px（Σ 吃不满内容盒）',
      js: `(function(){ var s=document.createElement('style'); s.id='negctl-knife';
        s.textContent='#grid{grid-template-columns:repeat(3,200px)!important}'; document.head.appendChild(s); return 'ok'; })()` },
  ];
  console.log('负控（页面内造坏状态，不落盘）');
  let missed = 0;
  for (const K of KNIVES) {
    await goto('components.html');
    await SLEEP(500);
    const applied = await ev(K.js);
    await SLEEP(250);
    const s2 = JSON.parse(await ev(SNAP));
    const got = judge(s2, apps, bp);
    const red = got.filter((v) => !v.pass);
    /* 判定 id 带标题（"③ 卡高两两相等（容差 0）"），比对只看开头的序号标记 */
    const tagOf = (v) => String(v.id).split(' ')[0];
    if (applied !== 'ok') { console.log(`  未量 (${K.k}) ${K.label} —— 造不出来（${applied}）`); missed++; continue; }
    if (!red.length) { console.log(`  ✗ (${K.k}) ${K.label} —— 没有任何规则变红 ⇒ 判据没在量`); missed++; continue; }
    if (!red.some((v) => tagOf(v) === K.expect)) {
      console.log(`  ✗ (${K.k}) ${K.label} —— 变红的是 ${red.map(tagOf).join(' / ')}，但没命中点名的 ${K.expect} ⇒ 那条断言没在量`);
      missed++;
      continue;
    }
    const redTags = red.map(tagOf);
    console.log(`  ✓ (${K.k}) ${K.label} ⇒ 命中 ${redTags.join(' / ')}（点名 ${K.expect}）`);
    trace('negctl ' + K.k + ' hit ' + redTags.join('/'));
  }

  /* 还原复核：最后再干净加载一次，基线必须回到全绿（坏状态不许靠残留样式"命中"） */
  await goto('components.html');
  await SLEEP(500);
  const clean = judge(JSON.parse(await ev(SNAP)), apps, bp);
  const cleanBad = clean.filter((v) => !v.pass);
  console.log(`  还原复核：干净加载后 ${cleanBad.length ? '仍有 ' + cleanBad.length + ' 条 FAIL（' + cleanBad.map((v) => v.id).join('/') + '）' : '基线全绿'}`);

  console.log('');
  try { ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  if (missed) { console.log(`负控 ${KNIVES.length - missed}/${KNIVES.length} 命中：有 ${missed} 刀没被抓住 ⇒ 判据在这一格没量（rc=3 未量）`); process.exit(3); }
  if (cleanBad.length) { console.log(`负控后基线没复绿 ⇒ 本负控不算数（rc=3 未量）`); process.exit(3); }
  console.log(`负控 ${KNIVES.length}/${KNIVES.length} 命中且基线复绿 ⇒ 判据是活的（rc=2）`);
  process.exit(2);
}

try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
if (bad.length) {
  console.log(`FAIL：${bad.length} 条不全等`);
  bad.forEach((f, i) => console.log(`  ${i + 1}. ${f.id} —— ${f.detail}`));
  trace('FAIL ' + bad.map((v) => v.id).join(' '));
  process.exit(2);
}
console.log(`PASS：${snap.cards.length} 张卡同宽同高（${fmt(snap.cards[0].w)}×${fmt(snap.cards[0].h)}）、${wantCols(snap.innerW)} 列（断点 ${bp.low.w}→${bp.low.cols.length}/${bp.high.w}→${bp.high.cols.length}）、行距 ${fmt(snap.rowGap)}px`);
trace('PASS');
process.exit(0);
