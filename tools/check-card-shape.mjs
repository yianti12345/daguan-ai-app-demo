#!/usr/bin/env node
/* check-card-shape —— 卡片形态契约（2026-10-26 立；2026-10-28 换形态后重锚）
 *
 * 起因：用户指着组件库截图说「这卡片太丑了，说明生成的时候就是有大量问题」。
 * 实测拆开是四件事：
 *   · 卡间 32（该 16–24）—— 用"分区级"间距当"同组元素"间距，一行四张被撑成四个孤岛
 *   · 卡片 379×124 只装 76 高的内容 —— 该满的空了
 *   · 操作区 margin-top:auto 推到卡底，中间空一大片，按钮像掉在角落
 *   · 渐变浓度 9/5/3，合成到白底是 rgb(230,236,255)，等于没有
 * 这四条全都能机器判，之前一条判据都没有 —— 所以每轮都在"看着不对 → 手调"里打转。
 *
 * 判据（对组件库与应用列表两页，遍历每一张卡）：
 *   C1 同排等高（同一行卡高差 ≤1）—— 不等高会让一屏看着像没对齐
 *   C2 标题单行且不被裁
 *   C3 描述固定两行（行高 × 2 ±2），不塌成一行也不超过三行
 *   C4 操作带贴卡底、通栏（左右下三边差 ≤1）
 *   C5 状态必须有文字，不能只靠颜色
 *   C6 组件卡＝C6′「卡面身份锚点 + 边界」；应用卡＝封面在位且画着内容
 *   C7 卡间距落在 16–32
 *   C8 同页卡宽两两相等（≤0.5）
 *   C9 两页 C9′「gap 同值 + 60 ≤ 卡宽差 ≤ 103.83」（不是"同宽"——见下）
 *   C10 卡左缘落在同一套栅格
 *
 * ── 2026-10-28 两处退役（《组件卡样式规范-20261028》§7.2 / §7.3）──────────────
 * C6 原判「渐变底存在且看得见（首段合成色差 ≥15）」。它的本意是"卡片别退回纯文字白卡，
 *   得有个视觉锚点"；渐变只是当时的手段。现盘实测渐变在卡顶 52px（卡高 37%）归零、无边界，
 *   一张卡出现两种底色（标题压在 226,233,255 上、描述压在白上）—— 锚点没做成，割裂做成了。
 *   用户原话「这个卡片样式不好看，谁家这么设计」指的就是这块 ⇒ 渐变退役，
 *   改判 **C6′**：① .cc-dot 在位（直径 = --cc-dot ±1、颜色 ∈ 五个 --c-* 之一）；
 *   ② 材质只有一种表达（box-shadow ≠ none 且 border-width = 0）；
 *   ③ 卡内底色单一（**截图像素**：4 条横带 × 3 条竖带的众数色两两差 ≤1）。
 *   ⚠ 第③条为什么用像素众数而不是规格写的"3×4 个采样点"：现场实测那 12 个点里有 2 个正落在
 *     说明文字的笔画上（241,241,241 / 99,99,99），照抄会**天天假红**；众数取的是"这一点上占多数
 *     的那个颜色"，背景恒为多数，文字进不来。阈值本身（两两差 ≤1）一个字没改。
 *
 * C9 原判「两页卡宽与间距同值（宽差 ≤2）」。它假设"两页同一套栅格 ⇒ 同宽"，而用户 2026-10-28
 *   明确要求「不要跟应用管理的一样，需要有差异」—— **"同值"本身就是被判红的那件事**。
 *   改判 **C9′**：两页 gap 同值（容差 0.5，沿用旧 C9）＋ 两页卡宽差 ≥60（规格 §7.3 的数；
 *   1440 实算 379.33−276.5=102.83）。同页两两相等仍由 C8 管，没有放宽。
 *
 * ── 2026-10-28 补 C9′ 的**上界**（原判只有下限 ⇒ "过度差异"整类检不出）───────────
 * 原判只有 `差 ≥60`：它假设"差得越大越可分"，于是差 308（组件页掉成 2 列、卡 585）照样绿 ——
 * 而那时两页已不在同一套栅格里，关系从"同一产品的两层"变成两套页面。
 * 上界不是拍的数，是**两页各自声明的列数能给出的最大合法差**（全部现盘可核）：
 *   · #grid 内容盒宽 w = 1440 − 238 = 1202（侧栏 200 + 左 16 + 右 22，规范 §4.2；
 *     实测时按页面现量 `gridW`，不写死 1202 —— 侧栏或内距一改，界自己跟着走）
 *   · 组件页 3 列（<1720，规范 §4.2）：轨道 = (w − 2×32)/3 = 379.33 ⇒ 组件卡合法宽度的天花板。
 *     为什么是 3 列：运行带最小内容宽 283.2（开关 66 + 8 + 引用 87.2 + 8 + 动作 114，
 *     `assets/sys.css:588`）＋两侧内距 32 ⇒ 卡 ≥315.2；4 列时内容只剩 245 < 283.2，放不下
 *     （规范 §2.4 P2 / §7.4）
 *   · 应用页 4 列：轨道 = (w − 3×32)/4 = 276.5
 *   ⇒ 上界 = 379.33 − 276.5 = 102.83；再加 1px 栅格余数容差 ⇒ **103.83**。
 *     +1 的出处：3 列 1fr 除不尽，浏览器按 1/64px 落 379.328/379.328/379.344；规范 §8.2 给的
 *     卡宽原数也是「379.3（±1）」，check-card-uniform ② 的 TOL_SIZE_W=1 就是同一个容差，不另造一套。
 *   实测边界：现盘差 102.83（余量 1.00）；组件页改 2 列 ⇒ 585−276.5=308.5 ⇒ 红（负控刀 o）。
 * 上界为什么不能取更松（150/300 之类）：那些数没有出处；而它要拦的正是"一页脱开自己的列数"。
 *
 * 负控 --negctl：**逐刀独立**（每刀单独加载一次页面，不累积），每刀必须命中它点名的那条。
 *   任何一刀没抓住 ⇒ rc=3「未量」，不许当绿；注入前基线已红 ⇒ rc=4（假红证明不了任何事）。
 *
 * 用法：node tools/check-card-shape.mjs [baseUrl] [--negctl]
 * 退出码：0 全过 ｜ 2 有断点（负控档：全刀命中即 2）｜ 3 环境起不来／未量 ｜ 4 负控前提不成立
 *
 *   ★ 2026-11-05 两条硬规矩（当天两次返工换来的，别再犯）：
 *     1. 读数只认 getBoundingClientRect / getComputedStyle 的**结果**，不认 class 名的字面。
 *        真源 DOM 写的 gap-8 是 Tailwind 记号 = 32px；我把它当 8px 落盘，应用卡被撑大 17px。
 *     2. 跨页判据不许共用一条期望值。知识库 292×185/gap8 与应用管理 269.5×299.4/gap32 是两套；
 *        任何「两页同值」的断言，先问一句「这是同一个对象吗」。
 */
import { resolveBase, debugPort } from './base.mjs';
import { withCanvas } from './px-parity.mjs';
import fs from 'node:fs';

/* ══ 卡片几何的**唯一基准**：assets/card-metrics.json ══════════════════════
 * 为什么从这里读、不再在判据里写数字：
 *   这张卡的尺寸今天被改过五次（302 → 190 → 196 → 200 → 263 → 302.8），
 *   每一次判据都跟着改一个常量，于是"判据绿了"只证明"我改的那个数等于我刚写的数"。
 *   2026-11-01 用户原话：「没有自觉，必须要有工具要去量，你懂吗」——
 *   基准必须是一个**从线上抓下来、可单独核对**的文件，判据只是它的执行者。
 * 改尺寸的唯一路径：改 json（并在 _evidence 里写明依据）→ 判据自动跟着走 → 想偷偷改数改不动。
 */
const METRICS = JSON.parse(fs.readFileSync(new URL('../assets/card-metrics.json', import.meta.url), 'utf8'));
/* 卡框实色：tokens.css 的 --color-border-card = --p-gray-200。
   这里写死是因为判的是**像素产物**，得有一个期望值可比；令牌改名/改值这条会红，
   逼下一次把期望值和 CSS 一起改 —— 不是"放宽"就能过的。 */
const BORDER_RGB = [229, 231, 235];
const AR = (function () {
  const p = String(METRICS.card.aspectRatio).split('/').map(Number);
  return p[0] / p[1];                       // 0.9 —— 高 = 宽 ÷ 0.9
})();
const COVER_PAD = String(METRICS.cover.padding).split(/\s+/).map(parseFloat);  // [12,12,8]
const CARD_BW = Number(METRICS.card.borderWidth);                              // 1
const CARD_BC = String(METRICS.card.borderColor).toLowerCase();                // #e5e7eb
const GRID_COLS = Number(METRICS.grid.cols);        // 1440 下 4 列
const GRID_COLS_2XL = Number(METRICS.grid.cols2xl); // 1536 起 5 列
const BP_2XL = Number(METRICS.grid.breakpoint2xl);  // 1536
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* ── 阈值（唯一处）────────────────────────────────────────────── */
const TOL_W = 0.5;          /* C8 同页卡宽（沿用旧 UNIFORM / 未放宽） */
const TOL_GAP = 0.5;        /* C9′ 两页 gap 同值（沿用旧 C9） */
const MAX_PAGE_W_DIFF = 8;  /* 2026-11-04 真源：两页同一套 4 列栅格，卡宽差 ≤8（内容区内距差 4px + 1/64 落点） */
/* C9′ 上界（2026-10-28 补）：见文件头「补 C9′ 的上界」一节，算式不在这里写死数字，
   由两页各自的 #grid 内容盒宽 + 声明列数 + 实测 gap 现算，再 +1px 栅格余数容差。
   1440 现盘代入：(1202−2×32)/3 − (1202−3×32)/4 + 1 = 379.33 − 276.5 + 1 = 103.83 */
const COLS_COMP = 4;        /* 2026-11-04 真源：知识库页 1440 实测 4 列 */
const COLS_APPS = 4;        /* 应用页声明列数（规范 §4.2 的 4 列档；容差见 check-card-uniform ④b） */
const GRID_REMAINDER = 1;   /* 栅格余数容差：1/64px 落点 + 规范 §8.2「379.3（±1）」，同 uniform ② */
const BG_TOL = 1;           /* C6′ 卡内底色两两差 ≤1（规范 §7.2 第 3 条） */
const BAND_ROW_DY = [16, 60, 100, 140];   /* C6′ 横带位置（规范 §7.2 给的 y） */
const BAND_MIN_COVER = 0.5; /* 横带"算数"的众数占比下限。实测：y=16/100/140 都是 1.00，
                               y=60 落在说明文字的行上只有 0.49–0.71 —— 低于 0.5 的那条只报不计（不是底色难看） */

let pass = 0, fail = 0;
const RESULTS = [];
function ok(name, cond, note) {
  RESULTS.push({ name, pass: !!cond, note });
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/cshape-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 70; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t?.webSocketDebuggerUrl) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 25000);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: x });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
/* 2026-11-02：判据自己也会被浏览器缓存骗。负控改成 4% 投影后仍 25 绿，
   原因是 Page.navigate 复用了上一轮的 apps.html（旧 stamp）。量材质必须禁缓存，
   否则'改完没生效'和'改完有效'在读数上一样。 */
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

/* 两页的卡片选择器与"操作带"选择器不同，各自声明 —— 判据不猜 */
const TARGETS = [
  { page: 'components.html', card: '.crow.ccard', title: '.cc-hd .cl-tt', desc: '.cl-desc', ops: '.cc-ft', kind: 'identity', name: '组件库' },
  { page: 'apps.html', card: '.kcard', title: '.kc-title', desc: '.kc-desc', ops: '.card-ft', cover: '.kc-cover-img', kind: 'cover', name: '应用列表' },
];

/* ══════════ 量测（只读；注入只在负控档发生） ══════════ */
async function measure(T, injectJs) {
  await send('Page.navigate', { url: BASE + '/' + T.page });
  await SLEEP(1600);
  if (injectJs) {
    const applied = await ev(injectJs);
    await SLEEP(200);
    if (applied !== 'ok') return { __err: '注入失败：' + applied };
  }
  const r = await ev(`(function(){
    var cards = [].slice.call(document.querySelectorAll('${T.card}'));
    if (!cards.length) return { none: true };
    function rect(e){ var b = e.getBoundingClientRect(); return { l:b.left, t:b.top, r:b.right, b:b.bottom, w:b.width, h:b.height }; }
    var rows = {};
    cards.forEach(function(c){ var b = rect(c); var key = Math.round(b.t / 10); (rows[key] = rows[key] || []).push(b.h); });
    var first = cards[0], cb = rect(first);
    var ops = first.querySelector('${T.ops}');
    var opsB = ops ? rect(ops) : null;
    var title = first.querySelector('${T.title}');
    var desc = first.querySelector('${T.desc}');
    var sw = first.querySelector('.cc-sw') || first.querySelector('.card-tag');
    return {
      n: cards.length,
      rows: Object.keys(rows).map(function(k){ return rows[k]; }),
      card: [Math.round(cb.w), Math.round(cb.h)],
      cardW: Math.round(cb.w * 100) / 100,
      titleH: title ? [Math.round(title.getBoundingClientRect().height), title.scrollHeight] : null,
      descH: desc ? Math.round(desc.getBoundingClientRect().height) : null,
      descLH: desc ? Math.round(parseFloat(getComputedStyle(desc).lineHeight) || 0) : null,
      ops: opsB ? { gapBottom: Math.round(cb.b - opsB.b), gapLeft: Math.round(opsB.l - cb.l), gapRight: Math.round(cb.r - opsB.r), h: Math.round(opsB.h) } : null,
      swText: sw ? String(sw.textContent || '').trim() : null,
      gap: getComputedStyle(document.getElementById('grid')).gap,
      /* C9′ 上界的输入：栅格**内容盒**宽（rect 宽减 padding/border，不写死 1202） */
      gridW: (function(){
        var g = document.getElementById('grid'); if (!g) return null;
        var cs = getComputedStyle(g), b = g.getBoundingClientRect();
        var px = function(v){ return parseFloat(v) || 0; };
        return Math.round((b.width - px(cs.paddingLeft) - px(cs.paddingRight)
                                   - px(cs.borderLeftWidth) - px(cs.borderRightWidth)) * 100) / 100;
      })(),
      widths: cards.map(function(c){ return Math.round(rect(c).w * 10) / 10; }),
      /* ★2026-10-30（用户当面否掉「v3 → v4 · 10-20」之后加）：
         卡面上不许出现"只有内部人看得懂"的两类写法 ——
           ① 裸版本区间：v3 → v4 / v3~v4（箭头两边是什么，第一次看的人读不出来）
           ② 裸日期：10-20（哪年？是编辑时间还是发布时间？）
         只取**可见文本**（innerText），不含 title/aria。 */
      bareText: cards.map(function(c){ return (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400); }),
      lefts:  cards.map(function(c){ return Math.round(rect(c).l * 10) / 10; }),
      skins: cards.map(function(c){
        var s = getComputedStyle(c);
        /* C6′③ 的结构读数：卡自己与两个伪元素上都不许再画渐变（渐变退役，边界只由阴影给） */
        /* ★2026-11-03：边界可能画在 ::after 覆盖层（应用卡 footer 不透明，inset 环会被它盖住，
           环只能单独一层画在子元素之上）。C6′② 若只读卡自己的 box-shadow，
           就会把"边界明明在、只是挪了一层"判成红 —— 这正是它今天红的原因。 */
        return { shadow: s.boxShadow, borderW: s.borderTopWidth, borderS: s.borderTopStyle, borderC: s.borderTopColor,
                 bgImg: s.backgroundImage,
                 afterShadow: getComputedStyle(c, '::after').boxShadow,
                 /* display:none 的伪元素不生成盒子，但 getComputedStyle 照样回显声明的阴影
                    （它给的是 computed，不是 used）。只读阴影会把"藏起来的环"当成边界，负控因此抓不住。 */
                 afterDisplay: getComputedStyle(c, '::after').display,
                 beforeBg: getComputedStyle(c, '::before').backgroundImage,
                 afterBg: getComputedStyle(c, '::after').backgroundImage };
      }),
      /* C6′ ③ 的取样框：① 四条**内衬带**（卡内距 16 里，文字与控件结构上进不来）
                          ② 规格 §7.2 给的 4 条横带（y=16/60/100/140，作第二读数） */
      bands: cards.map(function(c){
        var b = rect(c), out = [];
        var pad = Math.min(16, Math.max(4, b.h / 8));
        /* ★2026-11-04：取样原点从"卡顶"改成"卡身顶"（.cc-body 的上沿）。
           卡顶 0–56 是有边界的媒体区（组件形态线框），它本来就该有自己的底色 ——
           这正是 Material/Figma 卡片 anatomy 里的 media 层。原口径量整卡，
           等于把"媒体区有底色"判成"卡内两种底色"，而它要抓的是后者那种
           无边界、渐变到一半就断的割裂。判据的本意（卡身不许分层）一个字没改。 */
        var bodyEl = c.querySelector('.cc-body');
        var top = bodyEl ? bodyEl.getBoundingClientRect().top : b.t;
        var innerH = Math.max(1, b.b - top);
        /* 离边 8px 取带（仍在内距 16 里，但躲开邻卡的投影：投影只伸进边缘几像素） */
        out.push({ key: 'pad-top',    x: b.l + pad,      y: top + 8,       w: Math.max(1, b.w - pad * 2), h: 4 });
        out.push({ key: 'pad-bottom', x: b.l + pad,      y: b.b - 12,      w: Math.max(1, b.w - pad * 2), h: 4 });
        out.push({ key: 'pad-left',   x: b.l + 8,        y: top + pad,     w: 4, h: Math.max(1, innerH - pad * 2) });
        out.push({ key: 'pad-right',  x: b.r - 12,       y: top + pad,     w: 4, h: Math.max(1, innerH - pad * 2) });
        ${JSON.stringify(BAND_ROW_DY)}.forEach(function(dy){
          if (top + dy > b.b - 4) return;
          out.push({ key: 'row' + dy, x: b.l + 8, y: top + dy, w: Math.max(1, b.w - 16), h: 1 });
        });
        return out;
      }),
      /* 应用卡：装配指纹条是不是真画着东西（芯片或空应用引导语）。
         2026-11-01 起量的是 .kc-print-slot（24 高的一条），不再是原来那块封面。 */
      look: (function(){
        if ('${T.kind}' !== 'cover') return null;
        var c = first.querySelector('${T.cover || ''}');
        if (!c) return { has: false };
        var rr = c.getBoundingClientRect();
        /* 2026-11-01：封面换成真图（背景图）之后，"画着东西"的判法也得换 ——
           旧口径数 .kp-b 芯片（0 个）会一律判空。现在只要背景图有 url 就算画着。 */
        var bg = getComputedStyle(c).backgroundImage || '';
        /* 2026-11-02：封面统一走 assets/common_card.png（与官网同一张），
           不再有 .kc-gen 生成封面。只认 background url。 */
        var drawn = bg.indexOf('url(') >= 0;
        /* ★2026-11-03：只判「background 里有 url()」是假绿 —— 图 404/解码失败时
           computed style 照样是 url(...)。把几何交出去，由像素判它到底画没画。 */
        return { has: drawn, rows: 0, empty: !drawn, w: Math.round(rr.width), h: Math.round(rr.height),
                 coverRect: { x: rr.left, y: rr.top, w: rr.width, h: rr.height },
                 cardRect: cb };
      })(),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth
    };
  })()`);
  if (!r || r.__err || r.none) return { __err: (r && (r.__err || '选择器没命中')) || '量不到' };
  if (T.kind === 'identity') {
    const px = await sampleBands(r.bands);
    if (px.__err) return { __err: '像素取样失败：' + px.__err };
    r.pixels = px.bands;
  }
  /* ★2026-11-03：应用卡也要量像素。两个读数：
     ① 封面区（图内缩 3px，躲开圆角）白占比与色数 —— 断图/纯色空板抓得住；
     ② 卡框三边（底栏中点高度）1px 带 —— footer 盖住描边那次故障，结构读数全绿。 */
  if (T.kind === 'cover' && r.look && r.look.coverRect) {
    const cr = r.look.coverRect, cc = r.look.cardRect;
    const boxes = [[
      { key: 'cover', x: cr.x + 3, y: cr.y + 3, w: Math.max(1, cr.w - 6), h: Math.max(1, cr.h - 6) },
      { key: 'edge-l', x: Math.round(cc.l), y: Math.round(cc.t + cc.h - 28), w: 2, h: 1, ref: BORDER_RGB },
      { key: 'edge-r', x: Math.round(cc.r) - 2, y: Math.round(cc.t + cc.h - 28), w: 2, h: 1, ref: BORDER_RGB },
      { key: 'edge-b', x: Math.round(cc.l + cc.w / 2), y: Math.round(cc.b) - 2, w: 1, h: 2, ref: BORDER_RGB },
    ]];
    const px = await sampleBands(boxes);
    if (px.__err) return { __err: '封面像素取样失败：' + px.__err };
    r.pixels = px.bands;
  }
  return r;
}

/* ── 像素：每条带取众数色（背景恒为多数；文字进不了众数） ──────────── */
async function sampleBands(bandsPerCard) {
  const png = `/tmp/cshape-${process.pid}.png`;
  let shot;
  try {
    shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  } catch (e) { return { __err: String(e.message).slice(0, 120) }; }
  writeFileSync(png, Buffer.from(shot.data, 'base64'));
  const all = [];
  bandsPerCard.forEach((bs, i) => bs.forEach((b) => all.push({ card: i, key: b.key, x: b.x, y: b.y, w: b.w, h: b.h, ref: b.ref || null })));
  const src = readFileSync(png).toString('base64');
  let out;
  try {
    out = await withCanvas((eva) => eva(`(function(){
      var rects = ${JSON.stringify(all)};
      return new Promise(function(res){
        var I = new Image();
        I.onload = function(){
          var c = document.createElement('canvas'); c.width = I.width; c.height = I.height;
          var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(I, 0, 0);
          var o = rects.map(function(r){
            var x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
            var w = Math.min(I.width - x, Math.max(1, Math.round(r.w)));
            var h = Math.min(I.height - y, Math.max(1, Math.round(r.h)));
            var d = g.getImageData(x, y, w, h).data;
            var hist = {}, total = 0, i, white = 0, uq = {}, best = 999, near = 0, sr = 0, sg = 0, sb = 0;
            for (i = 0; i < d.length; i += 4) {
              var k = d[i] + ',' + d[i+1] + ',' + d[i+2];
              hist[k] = (hist[k] || 0) + 1; total++;
              if (d[i] >= 248 && d[i+1] >= 248 && d[i+2] >= 248) white++;
              uq[k] = 1;
              sr += d[i]; sg += d[i+1]; sb += d[i+2];
              /* ref 给了就量「离这个颜色的最近距离」：卡框那条 1px 线可能落在
                 两行/两列的哪一格取决于亚像素位置，取整数组里最近的一个，比钉死一格稳。 */
              if (r.ref) {
                var dd = Math.abs(d[i] - r.ref[0]) + Math.abs(d[i+1] - r.ref[1]) + Math.abs(d[i+2] - r.ref[2]);
                if (dd < best) best = dd;
                if (dd <= 24) near++;
              }
            }
            var bk = null, bn = 0;
            for (var k2 in hist) { if (hist[k2] > bn) { bn = hist[k2]; bk = k2; } }
            var p = String(bk).split(',');
            /* mean 给"内衬带"用（纯底区，均值不会被文字带偏，且**平滑渐变**也能被它抓住 ——
               众数对平滑渐变是瞎的：3 条像素各占 1/3，众数占比掉到 0.4，而颜色其实在变）。 */
            return { card: r.card, key: r.key, rgb: [+p[0], +p[1], +p[2]], cover: total ? bn / total : 0,
                     mean: [Math.round(sr / total * 10) / 10, Math.round(sg / total * 10) / 10, Math.round(sb / total * 10) / 10],
                     white: total ? white / total : 1, colors: Object.keys(uq).length,
                     best: r.ref ? best : null, near: total ? near / total : 0 };
          });
          res(JSON.stringify(o));
        };
        I.onerror = function(){ res(JSON.stringify({ err: 'PNG 解码失败' })); };
        I.src = 'data:image/png;base64,${src}';
      });
    })()`));
  } catch (e) {
    try { unlinkSync(png); } catch (e2) {}
    return { __err: String(e.message).slice(0, 160) };
  }
  try { unlinkSync(png); } catch (e) {}
  let arr;
  try { arr = typeof out === 'string' ? JSON.parse(out) : out; } catch (e) { return { __err: '取样返回不是 JSON' }; }
  if (!Array.isArray(arr)) return { __err: (arr && arr.err) || '取样返回不是数组' };
  const byCard = bandsPerCard.map(() => ({}));
  arr.forEach((x) => { byCard[x.card][x.key] = x; });
  return { bands: byCard };
}

/* 2026-11-02（用户 m05570）：卡与页面底'完全融合'。旧判只要求 box-shadow !== none，
   --shadow-flat 的 4% 投影也照样通过 —— 这是一条"有值就算过"的假绿。
   现在要求至少有一层**看得见的边界**：alpha ≥ .08（含 inset 收边环；rgb() 视为 alpha=1）。
   4% / 6% 的贴地投影会被判红；要贴地就再加一道 inset 环或更深的一层。 */
function shadowVisible(sh) {
  if (!sh || sh === 'none') return false;
  var re = /rgba?\(([^)]+)\)/g, m, maxA = 0;
  while ((m = re.exec(sh))) {
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    var a = p.length > 3 ? p[3] : 1;
    if (a > maxA) maxA = a;
  }
  return maxA >= 0.08;
}

/* ══════════ 判定（正控与负控走同一段代码） ══════════ */
function judgeOne(T, d) {
  const rowDiffs = (d.rows || []).map((hs) => Math.max(...hs) - Math.min(...hs));
  const worstRow = rowDiffs.length ? Math.max(...rowDiffs) : 0;
  ok(T.name + ' C1 同排等高', worstRow <= 1,
    '每行高差 ' + rowDiffs.join('/') + '（卡 ' + d.card[0] + '×' + d.card[1] + '，' + d.n + ' 张）');

  const titleMax = 34;
  ok(T.name + ' C2 标题单行不裁', d.titleH && d.titleH[0] <= titleMax && d.titleH[1] <= d.titleH[0] + 2,
    d.titleH ? '高 ' + d.titleH[0] + ' 内容 ' + d.titleH[1] : '无标题');

  /* 断言"恰好两行"，不写死像素：行高 19 的页就是 38，行高 22 的页就是 44 */
  /* ★2026-11-01 改判（放宽的是"呼吸位"，不是"行数"）：
     原判 |descH − 2×行高| ≤ 2。而真源 .app-desc 是 height:38 + line-height:16 ——
     38 不是 32，多出来的 6 是压在文字下方的呼吸位，不是第三行。
     原判会把线上自己判成红，于是只能反过来把 height 改成 32 去迎合判据 —— 那是倒因为果。
     现判：want ≤ 高度 ≤ want + 8。塌成一行（16）仍红，三行（48）仍红，拦的东西没变。 */
  const want = d.descLH ? d.descLH * 2 : 38;
  ok(T.name + ' C3 描述固定两行（含 ≤8 的呼吸位）',
    d.descH != null && d.descH >= want - 2 && d.descH <= want + 8,
    '描述高 ' + d.descH + '（两行 = ' + want + '，允许到 ' + (want + 8) + '）');

  /* 必须取绝对值：负控把 margin-bottom 拉成 -18 时，"−18 ≤ 1" 成立 —— 会把"掉到卡外"判成"贴底" */
  ok(T.name + ' C4 操作带贴底通栏', d.ops && Math.abs(d.ops.gapBottom) <= 1 && Math.abs(d.ops.gapLeft) <= 1 && Math.abs(d.ops.gapRight) <= 1,
    d.ops ? '距底 ' + d.ops.gapBottom + ' 左 ' + d.ops.gapLeft + ' 右 ' + d.ops.gapRight + '（高 ' + d.ops.h + '）' : '无操作带');

  ok(T.name + ' C5 状态带文字', d.swText && /启用|禁用|已上架|草稿|未发布|已下架/.test(d.swText),
    '状态文字「' + d.swText + '」');

  /* 2026-11-02（m05570）：材质不只组件卡要查，应用卡也要查 —— 原来这段写在
     if (T.kind==='identity') 里面，应用卡的 4% 投影从来没被量过，所以负控也不红。 */
  const skinBad = (d.skins || []).map((s, i) => {
    if (!s) return null;
    if (parseFloat(s.borderW) > 0.1) return '#' + i + ' 还画了 ' + s.borderW + ' 描边（要 0，边界用阴影）';
    /* ★2026-11-03：边界有两种合法载体 —— ①卡自身的投影/内嵌环 ②::after 覆盖层上的 1px 收边环。
       应用卡用②（footer 不透明，①的 inset 环会被盖住），组件卡用①。只认一种就会把另一种判红。
       仍然只收「看得见」的环：alpha ≥ .08，且必须是 inset（0 0 0 1px 这种环，不是糊在卡外的投影）。 */
    var ring = String(s.afterShadow || '');
    var ringVisible = /inset/.test(ring) && shadowVisible(ring) && s.afterDisplay !== 'none';
    if (!shadowVisible(s.shadow) && !ringVisible) return '#' + i + ' 边界不可见（0 描边、外层阴影响度<.08、也没有 1px 收边环）';
    return null;
  }).filter(Boolean);

  /* C6′② 材质 */
  ok(T.name + ' C6′② 材质＝无描边、常态有阴影（边界只由阴影表达）',
    skinBad.length === 0 && (d.skins || []).length > 0,
    `${(d.skins || []).length} 张卡`
    + ((d.skins || [])[0] ? `｜首卡描边 ${(d.skins[0] || {}).borderW} ${(d.skins[0] || {}).borderC} / 投影 ${String((d.skins[0] || {}).shadow).slice(0, 12)} / 收边环 ${String((d.skins[0] || {}).afterShadow).slice(0, 12)}` : '')
    + (skinBad.length ? `｜${skinBad.slice(0, 2).join('；')}` : ''));

  if (T.kind === 'identity') {
    /* C6′：锚点（类型点）+ 材质（阴影/无描边）+ 单一底色（像素众数） */
    /* ★2026-11-02 改判（材质回到用户口径，判据跟着设计走，不是放宽）：
       2026-11-01 这里曾把两页统一成 1px 描边（依据是线上站点的 border-gray-200）——
       但用户 2026-10-23 原话是「你觉得我喜欢边框线条吗？现在好看的审美一般都不带边框了」，
       DESIGN.md §1.1 也写「容器边界用底色差 + 阴影，不画线」。照线上复刻描边＝把基准错认成线上。
       现在两页都是「无描边 + 常态阴影」，这里判材质只有一种表达：
         · 描边宽 = 0
         · 常态 box-shadow ≠ none（边界不能两者都没有）
       与 check-noborder 同一口径：它查 CSS 文本（静止态），这里查 computed（真渲染）。 */
    /* C6′① 已于 2026-10-28 退役：类型点 .cc-dot 被删（场景清单判它不承担任何判断，
       「页面类/能力类」这套分类也被用户明确否掉）。判据跟着设计走，不能再要求一个已被删的元素。 */
    /* C6′③ 单一底色：**结构读数 + 像素读数**两条，缺一条就不算量过。
       结构：卡自己与 ::before/::after 上都不许有渐变（渐变退役，边界只由阴影给）。
       像素：四条内衬带（卡内距 16 里、离边 8px，文字与控件结构上进不来）的**均值色**两两差 ≤1；
             再用规格 §7.2 的 4 条横带（y=16/60/100/140）对账，众数占比 <0.5 的那条只报不计。
       为什么内衬带用均值、横带用众数：平滑渐变下众数是瞎的（颜色在连续变，众数占比掉到 0.4），
       均值会跟着变；而横带会压到文字，只能用众数（背景恒为多数）。
       实测边界（别再重查）：合法 gap（16–32）下四条内衬带全是 255/差 0（gap16 与 gap32 各量过一次）；
       gap 被压到 8 时右内衬带会收到邻卡投影（251–253）—— 那已经是 C7 判红的非法布局，这里不另做补偿。 */
    const px = d.pixels || [];
    const structBad = (d.skins || []).map((x, i) => (x && (/gradient/.test(x.bgImg) || /gradient/.test(x.beforeBg) || /gradient/.test(x.afterBg)) ? '#' + i : null)).filter(Boolean);
    const maxDiff = (a2, b2) => Math.max(Math.abs(a2[0] - b2[0]), Math.abs(a2[1] - b2[1]), Math.abs(a2[2] - b2[2]));
    let bgDiff = 0, bgWorst = '', rowLow = [], rowBad = [], rowUsed = 0, padUsed = 0;
    px.forEach((bands, ci) => {
      const list = Object.keys(bands || {}).map((k) => bands[k]).filter((x) => x && Array.isArray(x.mean));
      const pads = list.filter((x) => /^pad-/.test(x.key));
      padUsed += pads.length;
      for (let i = 0; i < pads.length; i++) {
        for (let j = i + 1; j < pads.length; j++) {
          const dd = maxDiff(pads[i].mean, pads[j].mean);
          if (dd > bgDiff) { bgDiff = dd; bgWorst = '#' + ci + ' ' + pads[i].key + ' vs ' + pads[j].key; }
        }
      }
      list.filter((x) => /^row/.test(x.key)).forEach((x) => {
        if ((x.cover || 0) < BAND_MIN_COVER) { rowLow.push('#' + ci + x.key + ' ' + (x.cover || 0).toFixed(2)); return; }
        rowUsed++;
        if (!pads.length) return;
        const dd = maxDiff(x.rgb, pads[0].mean);
        if (dd > BG_TOL) rowBad.push('#' + ci + x.key + ' 与底色差 ' + dd);
        if (dd > bgDiff) { bgDiff = dd; bgWorst = '#' + ci + x.key + ' vs 内衬带'; }
      });
    });
    if (!px.length || padUsed < px.length * 2) {
      console.log(`  ✗ ${T.name} C6′③ 卡内底色单一｜未量：可读的内衬带只有 ${padUsed} 条（要 ≥${px.length * 2}）⇒ rc=3`);
      try { ws.close(); } catch (e) {}
      try { chrome.kill(); } catch (e) {}
      process.exit(3);
    }
    ok(T.name + ' C6′③ 卡内底色单一（结构：无渐变层；像素：内衬带均值两两差 ≤' + BG_TOL + '）',
      structBad.length === 0 && bgDiff <= BG_TOL && rowBad.length === 0 && rowUsed >= px.length * 3,
      `${px.length} 张卡｜内衬带 ${padUsed} 条｜最大差 ${bgDiff}（${bgWorst || '—'}）｜横带计入 ${rowUsed} 条`
      + (structBad.length ? `｜卡/伪元素上还有渐变：${structBad.slice(0, 3).join(',')}` : '')
      + (rowLow.length ? `｜落在文字上、剔除：${rowLow.length} 条（${rowLow.slice(0, 2).join('；')}）` : '')
      + (rowBad.length ? `｜横带与底色不同：${rowBad.slice(0, 2).join('；')}` : ''));
  } else {
    /* 应用卡：封面＝画布缩略指纹（2026-10-27 改）。宽度 = 卡宽 − 24（左右各 12 内距）、
       高 ≥150（真源 161）、且封面上真画着东西 —— 只看"元素在不在"会放过一块纯色空板。 */
    /* ★2026-11-01 改判（用户 O 级原话，逐字）：
       「我应用管理是不是有一个大封面？那么大的封面，我新应用书没有选择让我上传封面呢？
        那这个封面哪来的？……你为什么这是长图的封面啊，哪有这么长的图的封面作为这个封面的呀」
       ⇒ 那块东西**不是封面**，是"装了哪些组件"的装配指纹。它不该占半张卡。
       原判「高 ≥150」是把真源那张共用插画当成产品定义抄了下来 —— 真源有封面图，
       是因为那一版真的做了封面；我们这一版**没有上传封面的入口**，就不许有封面区。
       新判：指纹条在位（宽 = 卡宽−24，高 > 0 且 ≤ 60）。
       ★退出机制：产品真做了「上传应用封面」之后，封面变成用户内容，
         那时可以改回"封面区在位且高 ≥150"，并重新锚定尺寸。
         判据：这一版有没有封面上传入口？没有 → 不许有封面区。 */
    /* ★2026-11-01 再改判（用户第三次否定后照线上标准样式重做）：
       「我们应用管理有标准的样式对不对，我给你的地址里你也能看到标准样式的对不对，有一个封面，
         那你为什么不去用呢？」
       ⇒ 卡上有封面了（common_card.png / 用户上传的 app.cover），和线上一致。
       判「封面在位且画着东西」：宽 = 卡宽−24（左右各 12 内距）、高固定在 128±4。
       （128 是照线上 1440 下卡宽 205 时封面 193×96 的比例换算到我们 273 卡宽的值。） */
    /* 量的元素是封面「图」本身（.kc-cover-img），不是外面那层带内距的容器：
       容器 128 高、内距上下 12+8 ⇒ 图 108；宽度 = 卡宽 − 2×内距12 − 2×边框1 = 卡宽−26。 */
    /* ★2026-11-01 第三次改判：基准从"我方复刻件"换成"线上现场 DOM"。
       前两次改判都把 主交付/架构demo/原型-全量.html 当成了线上 —— 那是**我方复刻的**代码，
       它自己的封面尺寸也改过好几轮。真正的基准是抓取件：
         主交付/架构demo/_素材/现场DOM/金融应用管理.html
       里面卡片是 `aspect-ratio:0.9/1` + 封面 `flex:1` + `padding:12 12 8`，图再 cover 铺满。
       也就是说：**封面高度不是常量，是卡高的剩余**。原来的判据写死「高 108±4」，
       等于把"我们当时算出来的那个数"当成了线上标准，于是把 128 那版判成绿的 —— 判据自己错了。
       现在三条都从 assets/card-metrics.json 推：
         C6a 卡宽高比 = 0.9（高 = 宽 ÷ 0.9）—— 卡一扁，封面必然跟着扁，这是根
         C6b 封面图宽 = 卡宽 − 2×(12 内距 + 1 描边)
         C6c 封面区（图 + 上下内距）占卡高 50%–68%，真源实测 61.8%
       退出机制：产品真做了「上传应用封面」并且允许用户选比例，那时 C6a 由用户内容决定，本判据作废。 */
    const W = d.card[0], H = d.card[1];
    const ratio = H > 0 ? W / H : 0;
    const wantCoverW = W - 2 * COVER_PAD[1];
    const coverShare = (d.look && H) ? (d.look.h + COVER_PAD[0] + COVER_PAD[2]) / H : 0;
    ok(T.name + ' C6a 卡片宽高比＝基准 ' + AR.toFixed(2) + '（高＝宽÷' + AR.toFixed(2) + '）',
      ratio > 0 && Math.abs(ratio - AR) <= 0.02,
      '卡 ' + W + '×' + H + '，宽高比 ' + ratio.toFixed(3) + '（要 ' + AR.toFixed(2) + '±0.02）');
    ok(T.name + ' C6b 封面在位且宽＝卡宽−' + (2 * COVER_PAD[1]),
      !!d.look && d.look.has === true && Math.abs(d.look.w - wantCoverW) <= 3,
      d.look ? ('封面 ' + d.look.w + '×' + d.look.h + '（要宽 ' + wantCoverW + '）') : '没有封面元素');
    ok(T.name + ' C6c 封面区占卡高 50%–68%（线上实测 61.8%）',
      coverShare >= 0.50 && coverShare <= 0.68,
      d.look ? ('占比 ' + (coverShare * 100).toFixed(1) + '%') : '没有封面元素');

    /* ★2026-11-03（用户 08:54 截图「卡片都没有内容了」）：图在不在，不能听 CSS 的。
       computed style 有 url() 只说明"写了地址"，请求失败/解码失败时它一字不改。
       C6d 直接数像素：白占比 <0.6 且去重色 ≥16。实测（1440·卡1 封面）：
         正常插画 白 19.4% / 342 色；纯白空板 白 100% / 1 色；
         兜底层（品牌渐变+两字）白 <5% / >16 色 —— 断图也不是白板。
       退出机制：产品允许用户上传纯色封面时，这条作废，改判"封面与标题不同色"。 */
    const cv = d.pixels && d.pixels[0] && d.pixels[0].cover;
    ok(T.name + ' C6d 封面真画着东西（像素：白<60% 且 色数≥16）',
      !!cv && cv.white < 0.60 && cv.colors >= 16,
      cv ? ('白 ' + (cv.white * 100).toFixed(1) + '% ｜ ' + cv.colors + ' 色 ｜ 众数占比 ' + (cv.cover * 100).toFixed(0) + '%')
         : '没有封面像素读数');

    /* ★2026-11-03（「卡片底部的框呢」）：inset box-shadow 被 .card-ft 不透明底盖掉，
       左/右/下三边在底栏 49px 段整条消失，结构读数全部是绿的。C13 只认像素：
       底栏中点高度取左/右 1px、底边中点 1px，离 --color-border-card 的曼哈顿距离 ≤24。
       改前实测：三边 (255,255,255) 距离 70；改后 (225,227,232) 距离 11。 */
    const eL = d.pixels && d.pixels[0] && d.pixels[0]['edge-l'];
    const eR = d.pixels && d.pixels[0] && d.pixels[0]['edge-r'];
    const eB = d.pixels && d.pixels[0] && d.pixels[0]['edge-b'];
    const edgeOk = [eL, eR, eB].every(function (e) { return e && e.best !== null && e.best <= 24; });
    ok(T.name + ' C13 卡片四边框可见（底栏段左/右/底三边）',
      edgeOk,
      [eL, eR, eB].every(function (e) { return !!e; })
        ? ('距描边色 左 ' + eL.best + ' / 右 ' + eR.best + ' / 底 ' + eB.best + '（≤24）')
        : '没有边缘像素读数');
  }

  const g = parseFloat(String(d.gap).split(' ')[0]);
  /* 2026-11-05：两页是两套栅格 —— 知识库/组件库 gap 8，应用管理 gap-8(Tailwind)=32。
     原来两页共用一条「6–10（真源 8）」，等于拿知识库的数去量应用卡。 */
  const gapExp = /应用/.test(T.name) ? 32 : 8;
  ok(T.name + ' C7 卡间距 ' + (gapExp - 2) + '–' + (gapExp + 2) + '（真源 ' + gapExp + '）',
    Math.abs(g - gapExp) <= 2, 'gap ' + g);

  /* C8 / C10 是 2026-10-26 从 UNIFORM + CROSSPAGE 并进来的；容差一个没放宽 */
  const ws = d.widths || [];
  const wDiff = ws.length ? Math.max(...ws) - Math.min(...ws) : 0;
  ok(T.name + ' C8 同页卡宽两两相等', ws.length > 0 && wDiff <= TOL_W,
    ws.length ? ('宽 ' + ws.join('/') + '，最大差 ' + wDiff.toFixed(2)) : '没取到卡宽');

  /* C11 卡面不许出现「内部人才读得懂」的代码：裸版本区间 ／ 裸日期（无年份、无归属词） */
  const RE_VER_RANGE = /v\d+\s*(?:→|->|~|～)\s*v\d+/i;
  const RE_BARE_DATE = /(?<!\d{4}-)\b\d{2}[-/]\d{2}\b/;
  const badCopy = (d.bareText || []).filter(function (t) { return RE_VER_RANGE.test(t) || RE_BARE_DATE.test(t); });
  ok(T.name + ' C11 卡面无裸版本区间／裸日期',
    (d.bareText || []).length > 0 && badCopy.length === 0,
    badCopy.length ? ('命中 ' + badCopy.length + ' 张：' + badCopy[0].slice(0, 40)) : ('扫 ' + (d.bareText || []).length + ' 张卡，0 命中'));

  const ls = [...new Set((d.lefts || []).map((v) => Math.round(v)))].sort((a, b) => a - b);
  const steps = ls.slice(1).map((v, i) => v - ls[i]);
  const stepDiff = steps.length ? Math.max(...steps) - Math.min(...steps) : 0;
  ok(T.name + ' C10 卡左缘落在同一套栅格', ls.length >= 2 && stepDiff <= 1,
    '左缘 ' + ls.join('/') + (steps.length ? ('，步长 ' + steps.join('/') + '（差 ' + stepDiff + '）') : ''));
}

/* C9′：gap 同值 + 卡宽差落在 [60, 上界]。上限不是常数，由两页各自的栅格现算：
 *   上界 = 组件页 3 列轨道 − 应用页 4 列轨道 + 栅格余数容差（算式与出处见文件头）
 *   列数写死（3/4）是故意的：列数一旦被改成 2 列，轨道变宽而上界不变 ⇒ 差越界即红。 */
function judgeCross(a, b) {
  const gA = parseFloat(String(a.gap).split(' ')[0]);
  const gB = parseFloat(String(b.gap).split(' ')[0]);
  const dw = Math.abs(a.cardW - b.cardW);
  const dg = Math.abs(gA - gB);
  const wC = a.gridW, wA = b.gridW;
  const finite = [gA, gB, wC, wA].every((x) => Number.isFinite(x));
  const ceilComp = (wC - (COLS_COMP - 1) * gA) / COLS_COMP;
  const ceilApps = (wA - (COLS_APPS - 1) * gB) / COLS_APPS;
  const MAX = finite ? Math.round((ceilComp - ceilApps + GRID_REMAINDER) * 100) / 100 : NaN;
  /* 2026-11-05：原断言是「两页 gap 同值 + 卡宽差 ≤8（两页同一套栅格）」——
     那是我按"一个设计系统一套栅格"的假设定的，实测真源根本不是：
     知识库 292×185 / gap 8，应用管理 269.5×299.4 / gap 32，宽度差 22.5。
     照原断言改好的页面会被判红（假红），所以改成两页各自对自己那套真源 + 宽度差区间。 */
  ok('两页 C9′ 各自对真源（组件库 gap8 卡≈292 ｜ 应用列表 gap32 卡≈269.5）',
    finite
      && Math.abs(gA - 8) <= 1 && Math.abs(gB - 32) <= 1
      && a.cardW >= 285 && a.cardW <= 300
      && b.cardW >= 262 && b.cardW <= 276
      && dw >= 15 && dw <= 30,
    `${TARGETS[0].name} ${a.cardW}×/gap${gA} ｜ ${TARGETS[1].name} ${b.cardW}×/gap${gB}`
    + ` ｜ gap 差 ${dg.toFixed(2)}（真源差 24，不再要求同值）`
    + ` ｜宽差 ${dw.toFixed(2)}（真源 22.5，区间 15–30）`);
}

function printResults() {
  /* 2026-11-02（token 预算）：默认只打失败项。
     25 条全打 ≈ 2.7KB，而它进上下文之后每一轮都要重发 —— 通过项对「要不要动手」
     没有增量信息。判据一条没少、exit code 不变，只是不刷屏。
     要看全：node tools/check-card-shape.mjs --verbose
     依据 DSH `dsh-token-slim/noise-filter`：keep 失败行与汇总、drop 逐条通过。 */
  const VERBOSE = process.argv.includes('--verbose');
  for (const r of RESULTS) {
    if (!r.pass || VERBOSE) console.log(`  ${r.pass ? '✓ PASS' : '✗ FAIL'} ${r.name}` + (r.note ? '｜' + r.note : ''));
  }
  if (!VERBOSE) {
    const pass = RESULTS.filter((r) => r.pass).length;
    if (pass) console.log(`  ✓ ${pass} 条通过（不逐条列，--verbose 看全）`);
  }
}
const resetResults = () => { RESULTS.length = 0; };

/* ══ C12 · 宽屏列数（2026-11-01 立）══════════════════════════════════════
   背景：10-31 我为了「6 个应用在 1920 下排成 5+1 不好看」，把线上 `2xl:grid-cols-5`
   整条断点删了，1920 下卡宽 310→392（+26%），用户一眼看出「卡片太大」。
   当时判据全绿 —— 没有任何一条在看列数，**删断点比改代码快，而且没人拦**。
   现在：切到断点视口重新加载，数第一行几张卡，跟 card-metrics.json 的 cols2xl 比。
   做成独立函数是为了**能被负控打红**：正控调 judgeWide()，负控刀 p 调 judgeWide(注入JS)。 */
async function judgeWide(injectJs) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: BP_2XL, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/apps.html' });
  await SLEEP(1800);
  if (injectJs) {
    const applied = await ev(injectJs);
    await SLEEP(250);
    if (applied !== 'ok') return 'inject-fail';
  }
  const wide = await ev(`(function(){
    var g = document.getElementById('grid'); if (!g) return null;
    var cards = [].slice.call(g.children);
    if (!cards.length) return null;
    var top = Math.round(cards[0].getBoundingClientRect().top);
    var firstRow = cards.filter(function(c){ return Math.round(c.getBoundingClientRect().top) === top; });
    return { n: firstRow.length, w: Math.round(cards[0].getBoundingClientRect().width * 10) / 10, vw: innerWidth };
  })()`);
  ok('应用列表 C12 宽屏 ' + BP_2XL + ' 起第一行 ' + GRID_COLS_2XL + ' 列（真源：宽屏不再加列）',
    !!wide && wide.n === GRID_COLS_2XL,
    wide ? (wide.vw + ' 视口：' + wide.n + ' 列 × ' + wide.w + '') : '宽屏量不到');
  /* ★必须切回来：这个函数改了全局视口，后面的负控/还原复核都在 1440 上量。
     漏了这一步，实测会出现「还原复核仍有 1 条 FAIL（C9′）」—— 那是视口没复原的假红，不是真红。 */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  return 'ok';
}

console.log('卡片形态契约｜基址 ' + BASE + (NEG ? '｜负控（逐刀，不落盘）' : '') + '\n');

/* 应用页与组件页各量一次（应用页只读，负控档复用这份读数 —— 刀只砍组件页） */
const appsData = await measure(TARGETS[1]);
if (appsData.__err) { console.log('  ✗ 应用列表量不到：' + appsData.__err); process.exit(3); }

if (!NEG) {
  const compData = await measure(TARGETS[0]);
  if (compData.__err) { console.log('  ✗ 组件库量不到：' + compData.__err); process.exit(3); }
  judgeOne(TARGETS[0], compData);
  judgeOne(TARGETS[1], appsData);
  judgeCross(compData, appsData);
  await judgeWide();
  printResults();
  const bad = RESULTS.filter((r) => !r.pass);
  console.log('\n通过 ' + (RESULTS.length - bad.length) + ' ｜ 断点 ' + bad.length);
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(bad.length ? 2 : 0);
}

/* ══════════════════════════ 负控：逐刀 ══════════════════════════ */
const KNIVES = [
  { k: 'a', expect: 'C1', label: '第一张卡卡高改成 80px',
    js: `(function(){ var c=document.querySelectorAll('#grid .crow')[0]; if(!c) return 'no-card'; c.style.height='80px'; return 'ok'; })()` },
  { k: 'b', expect: 'C2', label: '第一张卡标题高度撑到 60px（标题不再是单行）',
    js: `(function(){ var t=document.querySelector('#grid .crow .cc-hd .cl-tt'); if(!t) return 'no-tt'; t.style.height='60px'; return 'ok'; })()` },
  { k: 'c', expect: 'C3', label: '描述高度改 19（塌成一行）',
    js: `(function(){ var d=document.querySelector('#grid .crow .cl-desc'); if(!d) return 'no-desc'; d.style.height='19px'; return 'ok'; })()` },
  { k: 'd', expect: 'C4', label: '操作带 margin-bottom 拉到 −18（掉到卡外）',
    js: `(function(){ var f=document.querySelector('#grid .crow .cc-ft'); if(!f) return 'no-ft'; f.style.marginBottom='-18px'; return 'ok'; })()` },
  { k: 'e', expect: 'C5', label: '第一张卡的开关文字清空（只剩颜色）',
    js: `(function(){ var s=document.querySelector('#grid .crow .cc-sw'); if(!s) return 'no-sw'; s.textContent=''; return 'ok'; })()` },
  /* C6′ 五刀：规格 §7.2 的负控（加描边 / 去阴影 / 4% 假阴影 / 恢复渐变）
     ★2026-11-01 删掉原 (f)「删掉所有 .cc-dot」：C6′① 已于 2026-10-28 随 .cc-dot 一起退役，
     这一刀造不出来（注入返回 no-dot），每次跑都把整个判据拖成 rc=3「未量」。
     留着一刀打不响的负控，等于让"未量"常态化 —— 那比没有更坏。 */
  /* 2026-11-02：材质规则从「必须有描边」改成「0 描边 + 看得见的阴影」，
     旧 g/h 两刀打的是已经不存在的断言（加投影仍过、去描边本来就是 0），负控因此漏两刀。
     现按新规则重打：加描边 / 去阴影 / 4% 假阴影。 */
  { k: 'g', expect: 'C6′②', label: '给卡加 1px 描边（描边+阴影并存）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid .crow.ccard{border:1px solid #e5e7eb!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'h', expect: 'C6′②', label: '把卡阴影删掉（border:0，边界消失）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid .crow.ccard{box-shadow:none!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'h2', expect: 'C6′②', label: '把卡阴影换回 4% 投影（有值但看不见）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid .crow.ccard{box-shadow:0 1px 2px rgba(25,30,41,.04)!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'i', expect: 'C6′③', label: '恢复 ::before 渐变（卡内出现两种底色，结构读数抓）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid .crow.ccard::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#e2e9ff 0%,#ffffff 40%)!important;pointer-events:none}'; document.head.appendChild(s); return 'ok'; })()` },
  /* 第二刀专打**像素读数**：叠一个子元素渐变（卡与伪元素上都没有渐变 ⇒ 结构读数看不见它），
     只有像素均值能抓 —— 没有这一刀，"内衬带均值"这一半就是没人验过的恒绿。 */
  { k: 'i2', expect: 'C6′③', label: '卡内插一层子元素渐变（结构读数看不见，只靠像素均值抓）',
    js: `(function(){ var cs=document.querySelectorAll('#grid .crow.ccard'); if(!cs.length) return 'no-card';
      cs.forEach(function(c){ var d=document.createElement('div');
        d.style.cssText='position:absolute;inset:0;background:linear-gradient(180deg,#e2e9ff 0%,#ffffff 40%);pointer-events:none';
        c.appendChild(d); }); return 'ok'; })()` },
  { k: 'j', expect: 'C7', label: '卡间距改成 32（真源是 8，不在 6–10）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid{gap:32px!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'k', expect: 'C8', label: '第一张卡宽改成 300（同页卡宽不再相等）',
    js: `(function(){ var c=document.querySelectorAll('#grid .crow')[0]; if(!c) return 'no-card'; c.style.width='300px'; return 'ok'; })()` },
  { k: 'l', expect: 'C9′', label: '组件页改成 5 列（卡宽差越过 8，两页不再同宽）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid{grid-template-columns:repeat(5,minmax(0,1fr))!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'm', expect: 'C9′', label: '组件页 gap 改成 24（两页 gap 不同值）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid{gap:24px!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'n', expect: 'C10', label: '第三张卡左移 10px（左缘不再落在同一套栅格）',
    js: `(function(){ var c=document.querySelectorAll('#grid .crow')[2]; if(!c) return 'no-card'; c.style.marginLeft='-10px'; return 'ok'; })()` },
  /* 刀 o 专打**上界**：组件页掉成 2 列（卡 585），差 308.5 > 上界 103.83 ⇒ "过度差异"。
     没有这一刀，上界那半句就是没人验过的恒绿（下限 60 由刀 l 管，两半各一刀）。 */
  { k: 'o', expect: 'C9′', label: '组件页改成 2 列（卡宽 585，差 308.5 越过上界 ⇒ 过度差异）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}'; document.head.appendChild(s); return 'ok'; })()` },
  /* 刀 p 专打 C12（2026-11-04 基准切换）：在 1536 视口擅自加一列 —— 真源宽屏仍是 4 列。
     没有这一刀，C12 就是一条只有正控、没人验过能不能红的恒绿。 */
  { k: 'p', expect: 'C12', vw: 1536, label: '1536 视口下把栅格加成 5 列（真源宽屏仍 4 列）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='#grid{grid-template-columns:repeat(5,minmax(0,1fr))!important}'; document.head.appendChild(s); return 'ok'; })()` },
  /* ★2026-11-03：应用卡的两刀。只砍组件页证明不了 C6d/C13 —— 它们量的是应用列表。
     刀 q 保留一个"有 url() 但请求不到"的背景，专打"有地址就算画着"的旧口径：
     C6b 仍是绿的（元素与 URL 都在），只有 C6d 的像素能红。
     刀 r 把 1px 描边层藏起来：结构上仍有一张卡，只有 C13 的三边像素能红。 */
  { k: 'q', page: 'apps', expect: 'C6d', label: '封面换成 404 的图并拿掉兜底层（有 url()、无像素）',
    js: `(function(){
      document.querySelectorAll('.kcard .kc-cover-img').forEach(function(e){ e.style.backgroundImage='url(/assets/__missing__.png)'; });
      document.querySelectorAll('.kcard .kc-cover-fb').forEach(function(e){ e.remove(); });
      return 'ok'; })()` },
  /* C6′② 新增「::after 收边环也算边界」的负控：两种载体一起拿掉，边界才真没了。
     只拿卡投影、留着环 ⇒ 不该红（环还在）；只拿环、留着 4% 投影 ⇒ 也不该红；
     两个都拿 ⇒ 必须红。没有这一刀，新加的分支就是裸奔。 */
  { k: 's', page: 'apps', expect: 'C6′②', label: '同时拿掉卡投影与 1px 收边环（边界彻底消失）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='.kcard{box-shadow:none!important}.kcard::after{display:none!important}'; document.head.appendChild(s); return 'ok'; })()` },
  { k: 'r', page: 'apps', expect: 'C13', label: '隐藏卡片描边覆盖层（底栏三边回到无框）',
    js: `(function(){ var s=document.createElement('style'); s.textContent='.kcard::after{display:none!important}'; document.head.appendChild(s); return 'ok'; })()` }
];

/* 前提：注入前基线必须全绿 —— 基线红着跑负控，哪一刀都会"命中" */
{
  resetResults();
  const compData = await measure(TARGETS[0]);
  if (compData.__err) { console.log('  ✗ 组件库量不到：' + compData.__err); process.exit(3); }
  judgeOne(TARGETS[0], compData);
  judgeOne(TARGETS[1], appsData);
  judgeCross(compData, appsData);
  const premiseBad = RESULTS.filter((r) => !r.pass);
  if (premiseBad.length) {
    printResults();
    console.log(`\n负控前提不成立：注入前基线已红 ${premiseBad.length} 条（${premiseBad.map((r) => r.name.split(' ')[1]).join(' / ')}）`);
    console.log('      ⇒ 基线红着跑负控，任何一刀都会"命中"，证明不了任何事（rc=4）');
    try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    process.exit(4);
  }
}

console.log('负控（逐刀单独加载，不落盘）');
let missed = 0;
for (const K of KNIVES) {
  resetResults();
  /* 带 vw 的刀打在**宽屏视口**上（C12 那条），不能走 measure(TARGETS[0]) —— 那个固定在 1440 */
  if (K.vw) {
    const r = await judgeWide(K.js);
    if (r !== 'ok') { console.log(`  未量 (${K.k}) ${K.label} —— 注入失败`); missed++; continue; }
    const red2 = RESULTS.filter((x) => !x.pass);
    const tag2 = (n) => String(n).split(' ')[1] || String(n).split(' ')[0];
    if (!red2.length) { console.log(`  ✗ (${K.k}) ${K.label} —— 没有任何规则变红 ⇒ 判据没在量`); missed++; continue; }
    if (!red2.some((x) => tag2(x.name) === K.expect)) {
      console.log(`  ✗ (${K.k}) ${K.label} —— 变红的是 ${red2.map((x) => tag2(x.name)).join(' / ')}，但没命中点名的 ${K.expect}`);
      missed++; continue;
    }
    console.log(`  ✓ (${K.k}) ${K.label} ⇒ 命中 ${red2.map((x) => tag2(x.name)).join(' / ')}（点名 ${K.expect}）`);
    continue;
  }
  /* ★2026-11-03：应用页的刀只能砍应用页 —— 砍完必须重新量应用页，
     不能拿未注入的 appsData 判（那样 C6d/C13 永远是绿的，负控等于没做）。 */
  if (K.page === 'apps') {
    const ad = await measure(TARGETS[1], K.js);
    if (ad.__err) {
      console.log(`  未量 (${K.k}) ${K.label} —— 造不出来（${ad.__err}）`);
      missed++;
      continue;
    }
    judgeOne(TARGETS[1], ad);
    const redA = RESULTS.filter((x) => !x.pass);
    const tagA = (n) => String(n).split(' ')[1] || String(n).split(' ')[0];
    if (!redA.length) {
      console.log(`  ✗ (${K.k}) ${K.label} —— 没有任何规则变红 ⇒ 判据没在量`);
      missed++;
      continue;
    }
    if (!redA.some((x) => tagA(x.name) === K.expect)) {
      console.log(`  ✗ (${K.k}) ${K.label} —— 变红的是 ${redA.map((x) => tagA(x.name)).join(' / ')}，但没命中点名的 ${K.expect}`);
      missed++;
      continue;
    }
    console.log(`  ✓ (${K.k}) ${K.label} ⇒ 命中 ${redA.map((x) => tagA(x.name)).join(' / ')}（点名 ${K.expect}）`);
    continue;
  }

  const compData = await measure(TARGETS[0], K.js);
  if (compData.__err) {
    console.log(`  未量 (${K.k}) ${K.label} —— 造不出来（${compData.__err}）`);
    missed++;
    continue;
  }
  judgeOne(TARGETS[0], compData);
  judgeCross(compData, appsData);
  const red = RESULTS.filter((r) => !r.pass);
  const tagOf = (n) => String(n).split(' ')[1] || String(n).split(' ')[0];
  if (!red.length) {
    console.log(`  ✗ (${K.k}) ${K.label} —— 没有任何规则变红 ⇒ 判据没在量`);
    missed++;
    continue;
  }
  if (!red.some((r) => tagOf(r.name) === K.expect)) {
    console.log(`  ✗ (${K.k}) ${K.label} —— 变红的是 ${red.map((r) => tagOf(r.name)).join(' / ')}，但没命中点名的 ${K.expect} ⇒ 那条断言没在量`);
    missed++;
    continue;
  }
  console.log(`  ✓ (${K.k}) ${K.label} ⇒ 命中 ${red.map((r) => tagOf(r.name)).join(' / ')}（点名 ${K.expect}）`);
}

/* 还原复核：最后干净加载一次，基线必须回到全绿 */
resetResults();
const clean = await measure(TARGETS[0]);
if (clean.__err) { console.log('  还原复核未量：' + clean.__err); try { chrome.kill(); } catch (e) {} process.exit(3); }
judgeOne(TARGETS[0], clean);
judgeOne(TARGETS[1], appsData);
judgeCross(clean, appsData);
const cleanBad = RESULTS.filter((r) => !r.pass);
console.log(`  还原复核：干净加载后 ${cleanBad.length ? '仍有 ' + cleanBad.length + ' 条 FAIL（' + cleanBad.map((r) => r.name.split(' ')[1]).join('/') + '）' : '基线全绿'}`);

try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
if (missed) { console.log(`\n负控 ${KNIVES.length - missed}/${KNIVES.length} 命中：有 ${missed} 刀没被抓住 ⇒ 判据在这一格没量（rc=3 未量）`); process.exit(3); }
if (cleanBad.length) { console.log('\n负控后基线没复绿 ⇒ 本负控不算数（rc=3 未量）'); process.exit(3); }
console.log(`\n负控 ${KNIVES.length}/${KNIVES.length} 命中且基线复绿 ⇒ 判据是活的（rc=2）`);
process.exit(2);
