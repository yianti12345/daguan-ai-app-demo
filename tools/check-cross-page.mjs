#!/usr/bin/env node
/* check-cross-page —— 「两页是不是一套体系」判据（2026-10-24 评审席第 1/2 条）。
 *
 * 为什么有它：零上下文评审席只看图，判了组件页两条硬伤 ——
 *   ① 跨页不成体系：组件页卡宽 278.5／列距 24／卡高 236，应用页 272.5／32／194。
 *      用户"卡片大小不一样"的印象很可能来自**两页对比**，不是组件页自身。
 *   ② 下半截发空：组件卡描述结束到分隔线之间 50px 纯空白，像漏渲染。
 * 应用页是像素级复刻件，几何不许动 ⇒ 判据拿应用页当基准。
 *
 * ── 形态沿革：10-24 卡栅格 → 10-25 单列行表 → 10-25 晚 用户「我服了，组件管理我需要的是好看的卡片」
 *    改回卡片。现行＝两页**同一套 4 列栅格**（#grid 216→1418 宽 1202，轨道 276.5×4，列距 32），
 *    组件卡 `.crow.ccard` 141 高、应用卡 `.kcard` 302 高（封面 181 + 信息 72 + footer 49）。
 *
 * ★2026-10-27 重锚（本轮 T11）：上一版停在"单列行表"那一代，量的是**行自己的**
 *   grid-template-columns（卡片形态里行不是网格容器 ⇒ 解析出 0 档）、行的 padding、
 *   以及行内首个子元素的左缘（卡片有 1px 边框，于是恒定 217 vs 216 差 1px）。
 *   结果正控自己先红 3 条（⓪ 缺 .cl-head、①b Σ=0、①e 差 1px），负控"还原后仍有 2 处 FAIL"
 *   其实是基线红，不是撤不干净。逐条翻译到卡片形态（容差一个没放宽）：
 *     ①a 两页 #grid 面板左缘/右缘/宽各自相等（≤0.5）      → 同（量 #grid 本身，不量行）
 *     ①b 各自栅格恰好吃满内容盒（≤0.5）                    → 改为读 **#grid** 的轨道（行不是网格容器）
 *     ①c 列距同属 8px 节奏                                 → 同（两页 32px）
 *     ①d 页内两侧留白对称                                  → 同（量 #grid 内距，不量行内距）
 *     ①e 首列左缘由「面板左缘 + 声明内距」算出             → 量**卡**左缘（不是卡内首个子元素：卡片有边框）
 *     ② 行内容块上下留白对称 ≤2px（治"下半截发空"）        → 卡内操作带 .cc-ft 里 .cl-ops 的上下留白对称 ≤2px
 *                                                            ＋ .cc-ft 高跨卡全等（列宽/卡高不同是信息量决定的，
 *                                                            同组控件的垂直居中不由内容决定 —— 这是旧②的本意）
 *
 * 用法：node tools/check-cross-page.mjs            正控
 *      node tools/check-cross-page.mjs --negctl   负控：组件页内造 6 个坏状态（不落盘），
 *                                                 每刀必须命中**它点名的那条**断言，且还原后基线必须复绿
 * 退出码：0 全过 ｜ 2 有 FAIL（负控：6 刀全命中即 2）｜ 3 未量（Chrome 起不来／页面打不开／
 *         有刀没命中／还原后基线没复绿）｜ 4 负控前提不成立（注入前基线已经是红的）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const TRACE = '/tmp/xz-audit/crosspage-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');
const TOL_W = 0.5;    /* 外框/单元宽容差（与原值相同，未放宽） */
const TOL_GAP = 0.5;  /* 内距/栅格容差（与原值相同，未放宽） */
const GAP_RHYTHM = 8; /* 两页共用的间距节奏：列距必须是它的整数倍 */
const MAX_TB_DIFF = 2; /* 操作组在 footer 里的上下留白差上限（替代旧「空带 ≤16px」） */

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/crosspage-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
if (!ws) { console.log('SKIP: Chrome 起不来（像素阶段）'); process.exit(3); }
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

setTimeout(() => { console.log('GATE TIMEOUT: 90s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 90000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const fails = [];
let passN = 0;
const ok = (name, detail) => { passN++; console.log('  ✓ ' + name + (detail ? '：' + detail : '')); };
const bad = (name, detail) => { fails.push(name + ' —— ' + detail); console.log('  ✗ ' + name + '：' + detail); };
const r2 = (v) => +Number(v).toFixed(2);
/* grid-template-columns 解成每档 px：minmax(0,1fr) 取上限（1fr 被挤到 0 时要读成 0px，
 * 不能被 "/px$/" 过滤掉 —— 漏掉一档就等于这一档不进 Σ，①b 会变成假绿）。
 * 这个函数要注入页面里跑，所以写成函数声明 + toString 注入（见 PAGE_LIB）。 */
function parseCols(s) {
  return String(s)
    .replace(/minmax\([^,]+,\s*([^)]+)\)/g, '$1')
    .split(/\s+/)
    .filter(function (t) { return /^-?[\d.]+(px)?$/.test(t); })
    .map(function (t) { return parseFloat(t); });
}
const PAGE_LIB = parseCols.toString();

/* 量应用页：面板外框 + 栅格 + 首卡（基准页，永不修改） */
const APPS_MEASURE = `(function(){
  ${PAGE_LIB}
  var num = function(v){ return parseFloat(String(v)); };
  var g = document.querySelector('#grid');
  if (!g) return JSON.stringify({ err: '没有 #grid' });
  var cs = getComputedStyle(g);
  var gr = g.getBoundingClientRect();
  var cards = Array.prototype.slice.call(g.querySelectorAll('.kcard'));
  if (!cards.length) return JSON.stringify({ err: '应用页没有 .kcard（基准页被改了？）' });
  var c0 = cards[0].getBoundingClientRect();
  return JSON.stringify({
    panel: { l: +gr.left.toFixed(2), r: +gr.right.toFixed(2), w: +gr.width.toFixed(2),
             clientW: g.clientWidth, padL: num(cs.paddingLeft), padR: num(cs.paddingRight) },
    colGap: num(cs.columnGap), cols: parseCols(cs.gridTemplateColumns),
    units: cards.length,
    unit0: { l: +c0.left.toFixed(2), w: +c0.width.toFixed(2), h: +c0.height.toFixed(2) }
  });
})()`;

/* 量组件页：面板外框 + **#grid** 的轨道（卡片形态里 #grid 才是网格容器）+ 卡首列 + footer 里操作组的上下留白 */
const COMP_MEASURE = `(function(){
  ${PAGE_LIB}
  var num = function(v){ return parseFloat(String(v)); };
  var g = document.querySelector('#grid');
  if (!g) return JSON.stringify({ err: '没有 #grid' });
  var gs = getComputedStyle(g);
  var gr = g.getBoundingClientRect();
  var cards = Array.prototype.slice.call(g.querySelectorAll('.crow'));
  if (!cards.length) return JSON.stringify({ err: '组件页没有 .crow（结构又变了？）' });
  var lefts = [], tb = [], ftH = [];
  cards.forEach(function (c) {
    lefts.push(+c.getBoundingClientRect().left.toFixed(2));
    var ft = c.querySelector('.cc-ft'), ops = c.querySelector('.cc-ft .cl-ops');
    if (!ft || !ops) return;
    var fr = ft.getBoundingClientRect(), or = ops.getBoundingClientRect();
    /* ★2026-11-04 判据过期：2026-11-04（用户 m07271）在 .cc-ft 里加了「规格条」.cc-spec（定高 45，
       放版本号/更新时间/引用数）。操作组现在只占运行带 .cc-run，用整个 .cc-ft 量下留白会把 45px 规格条算进去
       （实测上 12 / 下 57），那是新结构而不是控件掉角。改成在**所在那条带子**里量上下留白。 */
    var box = c.querySelector('.cc-ft .cc-run') || ft;
    var br = box.getBoundingClientRect();
    tb.push({ top: +(or.top - br.top).toFixed(2), bot: +(br.bottom - or.bottom).toFixed(2) });
    ftH.push(+fr.height.toFixed(2));
  });
  var c0 = cards[0].getBoundingClientRect();
  return JSON.stringify({
    panel: { l: +gr.left.toFixed(2), r: +gr.right.toFixed(2), w: +gr.width.toFixed(2),
             clientW: g.clientWidth, padL: num(gs.paddingLeft), padR: num(gs.paddingRight) },
    colGap: num(gs.columnGap), cols: parseCols(gs.gridTemplateColumns),
    rows: cards.length, unitW: +c0.width.toFixed(2),
    unitL: Math.min.apply(null, lefts),
    kcard: g.querySelectorAll('.kcard').length,
    cover: g.querySelectorAll('.kc-cover').length,
    ops: tb, ftH: ftH
  });
})()`;

console.log('跨页一套体系（1440×900，真渲染量 getBoundingClientRect）'
  + (NEG ? '  [负控：组件页内造 6 个坏状态，不落盘]' : ''));

/* ── 量应用页（基准，不改它） ─────────────────────── */
await goto('apps.html');
await SLEEP(300);
const apps = JSON.parse(await ev(APPS_MEASURE));
if (apps.err) { console.log('SKIP: 应用页量不到（' + apps.err + '）'); process.exit(3); }

/* ── 量组件页 ───────────────────────────────────── */
await goto('components.html');
await SLEEP(300);

const KNIVES = [
  { id: 'K1', what: '#grid 左移 6px（面板不再与应用页同一条线）', expect: '①a',
    css: '#grid{margin-left:6px!important}' },
  { id: 'K2', what: '四个轨道定死 200px（Σ 吃掉 396px 留白，不再等于内容盒）', expect: '①b',
    css: '#grid{grid-template-columns:200px 200px 200px 200px!important}' },
  { id: 'K3', what: '列距改成 14px（不在 8px 节奏上）', expect: '①c',
    css: '#grid{column-gap:14px!important}' },
  { id: 'K4', what: '面板左右内距打成 26/10（两侧留白不对称）', expect: '①d',
    css: '#grid{padding-left:26px!important;padding-right:10px!important}' },
  { id: 'K5', what: '卡自己加 margin-left:8px（首列左缘由属性硬顶而非常量）', expect: '①e',
    css: '#grid .crow.ccard{margin-left:8px!important}' },
  { id: 'K6', what: '操作组顶对齐（footer 里下半截发空）', expect: '②',
    css: '#grid .cc-ft{align-items:flex-start!important}' },
];

/* 统一的判定：正控与每一刀共用同一套断言，避免"负控另写一套"导致判据失真 */
function judgeCross(m, a, opt = {}) {
  const tag = opt.knife ? `[${opt.knife}] ` : '';

  /* ①a 面板同一条线、同宽（旧「卡宽相等」+「首卡左边缘同一条线」的翻译） */
  const dL = Math.abs(m.panel.l - a.panel.l);
  const dR = Math.abs(m.panel.r - a.panel.r);
  const dW2 = Math.abs(m.panel.w - a.panel.w);
  if (dL <= TOL_W && dR <= TOL_W && dW2 <= TOL_W) {
    ok(tag + '①a 面板同一条线、同宽',
      `应用页 ${a.panel.l}→${a.panel.r}（宽 ${a.panel.w}）｜组件页 ${m.panel.l}→${m.panel.r}（宽 ${m.panel.w}）｜左差 ${r2(dL)} 右差 ${r2(dR)} 宽差 ${r2(dW2)}（容差 ${TOL_W}）`);
  } else {
    bad(tag + '①a 面板同一条线、同宽',
      `应用页 ${a.panel.l}→${a.panel.r}（宽 ${a.panel.w}）｜组件页 ${m.panel.l}→${m.panel.r}（宽 ${m.panel.w}）｜左差 ${r2(dL)} 右差 ${r2(dR)} 宽差 ${r2(dW2)} > ${TOL_W}`);
  }

  /* ①b 两页各自的栅格恰好吃满自己的内容盒（旧「列距相等」的翻译） */
  const sumCols = (cols, gap) => cols.reduce((s, v) => s + v, 0) + gap * Math.max(0, cols.length - 1);
  const aSum = sumCols(a.cols, a.colGap);
  const aBox = a.panel.clientW - a.panel.padL - a.panel.padR;
  const mSum = sumCols(m.cols, m.colGap);
  const mBox = m.panel.clientW - m.panel.padL - m.panel.padR;
  const dA = Math.abs(aSum - aBox);
  const dM = Math.abs(mSum - mBox);
  if (dA <= TOL_GAP && dM <= TOL_GAP) {
    ok(tag + '①b 栅格恰好吃满内容盒（不靠留白凑列宽）',
      `应用页 Σ列${a.cols.length}+Σ列距=${r2(aSum)} vs 内容盒 ${r2(aBox)}（差 ${r2(dA)}）｜组件页 Σ列${m.cols.length}+Σ列距=${r2(mSum)} vs 内容盒 ${r2(mBox)}（差 ${r2(dM)}）`);
  } else {
    bad(tag + '①b 栅格恰好吃满内容盒（不靠留白凑列宽）',
      `应用页 Σ=${r2(aSum)} vs 内容盒 ${r2(aBox)}（差 ${r2(dA)}）｜组件页 Σ=${r2(mSum)} vs 内容盒 ${r2(mBox)}（差 ${r2(dM)}）> ${TOL_GAP}`);
  }

  /* ①c 列距落在同一套 8px 节奏上 */
  const aMod = Math.abs(a.colGap % GAP_RHYTHM);
  const mMod = Math.abs(m.colGap % GAP_RHYTHM);
  if (aMod <= 0.01 && mMod <= 0.01) {
    ok(tag + '①c 两页列距同属 ' + GAP_RHYTHM + 'px 节奏',
      `应用页 ${a.colGap}px｜组件页 ${m.colGap}px（都是 ${GAP_RHYTHM} 的整数倍）`);
  } else {
    bad(tag + '①c 两页列距同属 ' + GAP_RHYTHM + 'px 节奏',
      `应用页 ${a.colGap}px（余 ${r2(aMod)}）｜组件页 ${m.colGap}px（余 ${r2(mMod)}）`);
  }

  /* ①d 页内两侧留白对称（两页内距机制不同，但各自必须对称） */
  const dAd = Math.abs(a.panel.padL - a.panel.padR);
  const dMd = Math.abs(m.panel.padL - m.panel.padR);
  if (dAd <= TOL_GAP && dMd <= TOL_GAP) {
    ok(tag + '①d 页内两侧留白对称',
      `应用页 面板内距 ${a.panel.padL}/${a.panel.padR}（差 ${r2(dAd)}）｜组件页 面板内距 ${m.panel.padL}/${m.panel.padR}（差 ${r2(dMd)}）`);
  } else {
    bad(tag + '①d 页内两侧留白对称',
      `应用页 ${a.panel.padL}/${a.panel.padR}（差 ${r2(dAd)}）｜组件页 ${m.panel.padL}/${m.panel.padR}（差 ${r2(dMd)}）`);
  }

  /* ①e 首列左缘由声明内距算出（可复算式，元素自带 margin 会红；卡片有 1px 边框，所以量卡而不是卡内首个盒子） */
  const aExp = a.panel.l + a.panel.padL;
  const aGet = a.unit0.l;
  const mExp = m.panel.l + m.panel.padL;
  const mGet = m.unitL;
  const dEa = Math.abs(aGet - aExp);
  const dEm = mGet == null ? 1e9 : Math.abs(mGet - mExp);
  if (dEa <= TOL_W && dEm <= TOL_W) {
    ok(tag + '①e 首列左缘由声明内距算出',
      `应用页 首卡左缘 ${aGet} = 面板 ${a.panel.l} + 内距 ${a.panel.padL}（差 ${r2(dEa)}）｜组件页 首卡左缘 ${mGet} = 面板 ${m.panel.l} + 内距 ${m.panel.padL}（差 ${r2(dEm)}）`);
  } else {
    bad(tag + '①e 首列左缘由声明内距算出',
      `应用页 实量 ${aGet} vs 算得 ${r2(aExp)}（差 ${r2(dEa)}）｜组件页 实量 ${mGet} vs 算得 ${r2(mExp)}（差 ${r2(dEm)}）> ${TOL_W} ⇒ 有元素靠自带 margin 顶位`);
  }

  /* ② footer 里操作组上下留白对称（旧「行内容块上下留白」的翻译：卡高不同由信息量决定，
       但同一组控件在 footer 里必须垂直居中，不能掉在角上）＋ .cc-ft 高跨卡全等 */
  if (opt.headers) console.log('\n② 卡内操作带（操作组上下留白对称 ≤' + MAX_TB_DIFF + 'px，替代旧「描述末行底 → .k-meta 顶 ≤16px」）');
  const tbs = m.ops || [];
  const ftHs = m.ftH || [];
  const ftHSpan = ftHs.length ? Math.max(...ftHs) - Math.min(...ftHs) : NaN;
  if (!tbs.length) {
    bad(tag + '② 卡内操作组上下留白对称', '没量到 .cc-ft .cl-ops');
  } else {
    const worst = tbs.reduce((w, t) => (Math.abs(t.top - t.bot) > Math.abs(w.top - w.bot) ? t : w), tbs[0]);
    const dw = Math.abs(worst.top - worst.bot);
    if (dw <= MAX_TB_DIFF && ftHSpan <= TOL_GAP) {
      ok(tag + '② 卡内操作组上下留白对称 ≤' + MAX_TB_DIFF + 'px 且 .cc-ft 等高',
        `${tbs.length} 张卡，最大差 ${r2(dw)}px（最差一张 ${worst.top}/${worst.bot}）｜.cc-ft 高 ${r2(Math.min(...ftHs))}~${r2(Math.max(...ftHs))}（差 ${r2(ftHSpan)}）`);
    } else {
      bad(tag + '② 卡内操作组上下留白对称 ≤' + MAX_TB_DIFF + 'px 且 .cc-ft 等高',
        `${tbs.length} 张卡，最大差 ${r2(dw)}px（最差一张上 ${worst.top} / 下 ${worst.bot}）｜.cc-ft 高差 ${r2(ftHSpan)} ⇒ 操作组掉在角上`);
    }
  }
}

/* ══════════════ 负控 ══════════════ */
if (NEG) {
  /* 先验基线：基线红着跑负控，任何一刀都会"命中"，那不是证明（2026-10-27 加） */
  const base = JSON.parse(await ev(COMP_MEASURE));
  if (base.err) { console.log('SKIP: 组件页量不到（' + base.err + '）'); process.exit(3); }
  fails.length = 0; passN = 0;
  judgeCross(base, apps, {});
  if (fails.length) {
    console.log(`\n负控前提不成立：注入前基线已红 ${fails.length} 条 ⇒ 任何刀都会"命中"，证明不了任何事（rc=4，先修基线）`);
    trace('negctl premise red ' + fails.length);
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(4);
  }

  console.log('\n负控（组件页内造坏状态，逐刀还原，不落盘）');
  const knifeHit = new Map();
  for (const k of KNIVES) {
    await ev(`(function(){ var s=document.getElementById('negctl-knife');
      if(!s){ s=document.createElement('style'); s.id='negctl-knife'; document.head.appendChild(s); }
      return 1; })()`);
    await ev('(function(){ document.getElementById("negctl-knife").textContent = ' + JSON.stringify(k.css) + '; return 1; })()');
    await SLEEP(250);
    fails.length = 0;
    const m = JSON.parse(await ev(COMP_MEASURE));
    judgeCross(m, apps, { knife: k.id });
    knifeHit.set(k.id, { n: fails.length, detail: fails.slice() });
    /* 还原：清掉这一刀的样式表（下一刀会重新写进去；最后一刀之后再单独复核一次） */
    await ev('(function(){ var s=document.getElementById("negctl-knife"); if(s){ s.textContent=""; } return 1; })()');
    await SLEEP(150);
  }

  /* 还原后复核：坏状态必须撤干净 —— 干净加载后基线要复绿 */
  await goto('components.html');
  await SLEEP(500);
  fails.length = 0;
  const clean = JSON.parse(await ev(COMP_MEASURE));
  judgeCross(clean, apps, { knife: 'clean' });
  const cleanFails = fails.length;

  let missed = 0;
  for (const k of KNIVES) {
    const hit = knifeHit.get(k.id) || { n: 0, detail: [] };
    /* 失败串形如「[K1] ①a 面板…」：先剥掉刀号前缀，再比对点名的断言号 */
    const hitExpected = hit.detail.some((d) => d.replace(/^\[[^\]]+\] /, '').startsWith(k.expect + ' '));
    if (hitExpected) console.log(`  ✓ ${k.id} ${k.what} ⇒ 命中 ${hit.n} 条，含点名的 ${k.expect}`);
    else {
      missed++;
      console.log(`  ✗ ${k.id} ${k.what} ⇒ 命中 ${hit.n} 条，但没命中点名的 ${k.expect}（实际：${hit.detail.map((d) => d.replace(/^\[[^\]]+\] /, '').split(' ')[0]).join('/') || '无'}）—— 这条断言没在量`);
    }
  }

  console.log('\n──────────────────────────────');
  console.log(`  还原复核：干净加载后 ${cleanFails ? '仍有 ' + cleanFails + ' 处 FAIL ⇒ 坏状态没撤干净' : '基线全绿'}`);
  try { chrome.kill('SIGKILL'); } catch (e) {}
  if (cleanFails > 0) {
    trace('negctl residual cleanFails=' + cleanFails + ' ' + fails.join(' || '));
    console.log(`负控刀全部还原后页面仍有 ${cleanFails} 处 FAIL ⇒ 坏状态没撤干净，本负控不算数（rc=3 未量）`);
    process.exit(3);
  }
  if (missed === 0) {
    const total = [...knifeHit.values()].reduce((s, v) => s + v.n, 0);
    console.log(`负控 ${KNIVES.length}/${KNIVES.length} 刀全部命中点名的断言，共 ${total} 处 FAIL，且还原后基线复绿 ⇒ 判据是活的（rc=2）`);
    trace('negctl all-knives hit total=' + total);
    process.exit(2);
  }
  console.log(`负控有 ${missed} 刀没命中点名的断言 ⇒ 判据没在量（rc=3 未量）`);
  trace('negctl missed=' + missed + ' ' + JSON.stringify([...knifeHit.entries()]));
  process.exit(3);
}

/* ── 正控 ─────────────────────────────────────── */
const cmp = JSON.parse(await ev(COMP_MEASURE));
if (cmp.err) { console.log('SKIP: 组件页量不到（' + cmp.err + '）'); process.exit(3); }

/* ⓪ 前置：结构必须还是"两页卡片"（组件卡不是应用卡：无封面、有状态开关） */
console.log('\n⓪ 结构前提（组件页＝文字卡 + 状态开关，应用页＝封面图卡）');
if (cmp.kcard === 0 && cmp.rows >= 1 && cmp.cover === 0) {
  ok('组件页 0 个 .kcard、0 个 .kc-cover 但有 .crow（' + cmp.rows + ' 张）',
    '本判据的其余断言都建立在"两页各是卡片"上');
} else {
  bad('组件页 0 个 .kcard / 0 个 .kc-cover 但有 .crow',
    `.kcard ${cmp.kcard} 个（要 0）｜.kc-cover ${cmp.cover} 个（要 0）｜.crow ${cmp.rows} 个`);
}

console.log('\n① 跨页几何（基准＝应用页 #grid ' + apps.panel.w + '，面板内距 ' + apps.panel.padL + '/' + apps.panel.padR
  + '，列距 ' + apps.colGap + '，' + apps.units + ' 卡 ×' + apps.unit0.w + 'px）');
console.log('   组件页：' + cmp.rows + ' 张 ×' + cmp.unitW + 'px，面板内距 ' + cmp.panel.padL + '/' + cmp.panel.padR + '，列距 ' + cmp.colGap);
judgeCross(cmp, apps, { headers: true });

console.log('\n──────────────────────────────');
if (fails.length) {
  console.log(`FAIL：${fails.length} 项`);
  trace('FAIL ' + fails.join(' || '));
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(2);
}
console.log(`PASS：跨页几何 ①a–①e + 卡内操作带 ② 全过（共 ${passN} 条）`);
trace('PASS');
try { chrome.kill('SIGKILL'); } catch (e) {}
process.exit(0);
