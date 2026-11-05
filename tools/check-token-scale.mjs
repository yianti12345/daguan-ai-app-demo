#!/usr/bin/env node
/* check-token-scale —— 「数值刻度」判据（2026-10-25 立，锚=官方文档实测件）
 *
 * 为什么有它：前几轮挨骂的「不统一/不专业」几乎都落在**数值没有封闭集合**上，
 * 而既有判据只量了"某个元素的某个数"（卡宽、行高、对比度），从未量"整页所有间距/字号/圆角
 * 是否都落在同一个刻度里"。于是页面看起来能跑，但密度与节奏是散的。
 *
 * 外部锚（全部来自官方文档页，抓取件 `~/ _reports/设计证据-数值刻度-20261025.md`）：
 *   间距   Ant sizeUnit=4（4/8/12/16/20/24/32/48）｜Atlassian space.100=8px｜TDesign 2–72
 *   正文   Ant 14/22｜TDesign 14/22｜Primer 14/21  → 三家一致取 14 / [21,22]
 *   字号档 Ant "within 3 to 5 types"  → 一屏 ≤5 档
 *   圆角   Ant 2/4/6/8｜TDesign 2/3/6/9/12｜Arco 2/4/8｜Atlassian 2/4/6/8/12/16/999
 *          + Atlassian 唯一给出的分层映射：card 8 / input 6 / badge 2
 *   色彩   M3 accent = primary/secondary/tertiary 三族 → ≤3
 *   描边   Atlassian「border or white space would suffice」｜Ant Layer0 无阴影｜M3「shadows only when required」
 *          → 同层容器 border 与 box-shadow 互斥
 *   触控   WCAG 2.2 SC2.5.8 = 24×24 CSS px；对比度正文 4.5:1、大字/图形 3:1
 *
 * 七条判据（阈值只在下面常量里；负控档读同一份，不许另写一套）：
 *   T1 间距只落在封闭刻度上（padding/margin/gap 计算值 ∈ SCALE，容差 0.5px 抗亚像素）
 *   T2 全页字号种数 ≤ 5，且正文字号 = 14px、行高 ∈ [21,22]
 *   T3 圆角只落在封闭集合上
 *   T4 同层容器 border 与 box-shadow 互斥（白名单：浮层/菜单/弹窗/被 :focus 聚焦的元素）
 *   T5 可点元素命中区 ≥ 24×24（WCAG 2.5.8）
 *   T6 文本对比度 ≥ 4.5:1（大字 ≥18.66px 或 ≥14px 粗体按 3:1）
 *   T7 强调色族 ≤ 3（对全页"非中性"前景/背景色做色相聚类，容差 ±20° 算同族）
 *
 * 用法：node tools/check-token-scale.mjs [页面]            正控（默认 components.html）
 *      node tools/check-token-scale.mjs components.html --negctl   负控：页面里注入 5 处坏值，必须 5 刀全红
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 未量（Chrome 起不来／页面没内容／负控有刀没抓到）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const TRACE = '/tmp/xz-audit/token-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');
const STRICT = process.argv.includes('--strict');
const PAGE = process.argv.find((a) => a.endsWith('.html')) || 'components.html';

/* ── 阈值（唯一处） ── */
const SCALE = [0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120];
const RADII = [0, 2, 3, 4, 6, 8, 9, 12, 16, 24, 999, 9999];
const FS_MAX = 5;
const BODY_FS = 14;
const BODY_LH = [21, 22];
const HIT = 24;
const CONTRAST_TEXT = 4.5;
const CONTRAST_LARGE = 3;
const ACCENT_MAX = 3;
const HUE_TOL = 20;
const TOL_PX = 0.5;
/* 浮层/白名单：这些选择器里的元素允许 border+shadow 共存、允许不参与字号档统计 */
const LAYER_ALLOW = ['.k-menu', '.kmenuc', '[role=menu]', '[role=menuitem]', '.modal', '.pop', '.toast', '.tooltip', '.fk', '.float'];
const SIZE_SKIP = ['.sr-only', '[hidden]', 'script', 'style', '.k-menu', '[role=menu]'];
/* 不参与"间距刻度"的元素：图形本身（圆点/图标/分隔线/徽标高）与 :focus 环 */
const SPACE_SKIP = ['.dot', '.sep', '.k-ico svg', '.ico', 'hr'];

const port = await debugPort();

/* ── 例外账：token-allow.tsv（每行必须带出处；放行了多少条要打出来，不许静默） ── */
const ALLOWF = new URL('./token-allow.tsv', import.meta.url);
const allowRows = existsSync(ALLOWF)
  ? readFileSync(ALLOWF, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t')).filter((c) => c.length >= 3)
  : [];
const allowedBy = (kind, key) => (STRICT ? undefined : allowRows.find(([k, m]) => k === kind && m === key));

/* ── 例外账的元素限定（2026-10-25 补）──
 * 只按「属性=值」放行时，同一个越界值出现在**另一类元素**上会被连带放过，那是假绿通道。
 * 现在账行第 5 列可写 CSS 选择器（逗号分隔），要求该组里**每个**元素都命中才放行；
 * 选择器匹配的是快照里的 el 描述（tag + 前两个 class），所以写 `.gt` 或 `a` 就够。 */
const elParts = (d) => {
  const m = String(d).match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/);
  return { tag: (m && m[1] ? m[1] : '').toLowerCase(), cls: (m && m[2] ? m[2].split('.').filter(Boolean) : []) };
};
const selHit = (desc, sel) => {
  const { tag, cls } = elParts(desc);
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean)
    .some((s) => (s.startsWith('.') ? cls.includes(s.slice(1)) : tag === s.toLowerCase()));
};
const allowedSpace = (g) => {
  const row = allowedBy('spacing', `${g.prop}=${g.v}`);
  if (!row) return false;
  const sel = (row[4] || '').trim();
  if (!sel) return true;              // 老账没写选择器：仍放行（兼容），明细里已能看到放行对象
  return g.els.every((d) => selHit(d, sel));
};
/* ★2026-10-27：T2（正文行高）此前**没有例外账通道** —— bodyOdd 直接 filter，一有合理偏离就只能改 CSS。
 *   实测：卡片描述行高 19px 是配 height:38px 的两行紧凑布局（19×2=38），改成 21 会让两行 42px 溢出容器。
 *   照 T1 的形状补一条通道，同样要求每个元素都命中选择器，不放开范围。 */
const allowedLH = (f) => {
  const row = allowedBy('line-height', `${f.fs}/${f.lh}`);
  if (!row) return false;
  const sel = (row[4] || '').trim();
  if (!sel) return true;
  return selHit(f.el, sel);
};
let allowHits = 0;
/* 放行了「谁」必须逐个打出来：只打总数（"放行 6 处"）时，同一个值在别处被连带放行也看不出来，
   这条判据就成了假绿通道。2026-10-25 补。 */
const allowLog = [];
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/tokenscale-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) { }
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
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

setTimeout(() => { console.log('GATE TIMEOUT: 180s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) { } process.exit(3); }, 180000);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* ── 页面内一次性快照：量渲染结果（computed style），不读 CSS 声明 ── */
const SNAP = (skip, allow) => `(function(){
  var SKIP = ${JSON.stringify(skip)}, ALLOW = ${JSON.stringify(allow)};
  var skip = function(e){ for (var i=0;i<SKIP.length;i++) if (e.matches && e.matches(SKIP[i])) return true;
                          for (var i=0;i<SKIP.length;i++) if (e.closest && e.closest(SKIP[i])) return true; return false; };
  var allow = function(e){ for (var i=0;i<ALLOW.length;i++) if (e.closest && e.closest(ALLOW[i])) return true; return false; };
  var vis = function(e){ var r=e.getBoundingClientRect(); var s=getComputedStyle(e);
    return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' && +s.opacity>0.01; };
  var px = function(v){ return v && v!=='normal' && v!=='auto' ? Math.round(parseFloat(v)*100)/100 : null; };
  /* 有效底色：沿祖先链找第一个不透明背景，按 alpha 合成。近似的只是 alpha 叠加，不是"假设白底"。 */
  var rgba = function(c){ var m = String(c).match(/[\\d.]+/g); return m ? { r:+m[0], g:+m[1], b:+m[2], a: m[3]==null?1:+m[3] } : null; };
  var effBg = function(el){
    var stack = [], n = el;
    while (n && n !== document.documentElement) { var b = rgba(getComputedStyle(n).backgroundColor);
      if (b && b.a > 0) { stack.push(b); if (b.a >= 0.999) break; } n = n.parentElement; }
    var out = { r:255, g:255, b:255 };
    for (var i = stack.length - 1; i >= 0; i--) { var s = stack[i];
      out = { r: s.a*s.r + (1-s.a)*out.r, g: s.a*s.g + (1-s.a)*out.g, b: s.a*s.b + (1-s.a)*out.b }; }
    return 'rgb(' + Math.round(out.r) + ',' + Math.round(out.g) + ',' + Math.round(out.b) + ')';
  };
  var out = { spacings: [], fonts: [], radii: [], borders: [], hits: [], texts: [], colors: [] };
  var walk = function(e){
    if (skip(e) || !vis(e)) return;
    var s = getComputedStyle(e), r = e.getBoundingClientRect();
    var cls = (e.className && typeof e.className==='string') ? '.'+e.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    var tag = e.tagName.toLowerCase() + cls;
    /* ★2026-11-04 T1 假红：flex 容器里的 margin-left:auto（右推）会被算成「剩余空间」的像素值，
       实测 div.cl-ops marginLeft=236.33px —— 它不是刻度值，而是「把这块推到右边」的布局手段，
       判成越界等于要求设计师给 flex 剩余空间取整。只对自动分配的 margin 放手：父级是 flex/grid
       且计算值带小数（自动分配必然亚像素），其余照旧逐像素判。 */
    var flexAuto = (function(){ var p = e.parentElement; if (!p) return false;
      var pd = getComputedStyle(p).display; return /flex|grid/.test(pd); })();
    ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','rowGap','columnGap']
      .forEach(function(k){ var v = px(s[k]);
        if (v === null || v === 0) return;
        if (flexAuto && (k === 'marginLeft' || k === 'marginRight') && Math.abs(v - Math.round(v)) > 0.01) return;
        out.spacings.push({ el: tag, prop: k, v: v }); });
    var fs = parseFloat(s.fontSize), lh = s.lineHeight === 'normal' ? null : parseFloat(s.lineHeight);
    var ownText = Array.prototype.filter.call(e.childNodes, function(n){ return n.nodeType === 3 && n.textContent.trim(); })
                    .map(function(n){ return n.textContent.trim(); }).join(' ').slice(0, 28);
    if (fs && (ownText || (e.childElementCount === 0 && (e.textContent||'').trim())))
      out.fonts.push({ el: tag, fs: fs, lh: lh, text: ownText });
    ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']
      .forEach(function(k){
        var raw = s[k] || '0';
        var pct = /%\s*$/.test(raw);            /* ★百分比：按元素自身尺寸算，不是 px 档位 */
        var v = parseFloat(raw) || 0;
        if (v <= 0) return;
        /* ★2026-10-27：旧口径直接 parseFloat，于是 border-radius:50% 被读成 50px，
           6×6 的圆点（.cc-sw-dot）按 50px 判「不在集合 2/4/6/8/12/20」——
           4 个角 × 多次，长期挂 8 条假红。百分比不是档位，是画圆这一构型；
           这里把 pct 标记带下去，判定时 ≥50% 一律放行，px 值仍照旧走档位。 */
        out.radii.push({ el: tag, prop: k, v: v, pct: pct, w: r.width, h: r.height });
      });
    /* T4 描边 vs 阴影：透明描边不算（.btn 的 border:1px solid transparent 是布局占位，不是可见边框） */
    var bc = rgba(s.borderTopColor), bcA = bc ? bc.a : 0;
    var bw = parseFloat(s.borderTopWidth)||0, sh = s.boxShadow && s.boxShadow !== 'none';
    if (bw > 0 && bcA > 0.02 && sh && !allow(e)) out.borders.push({ el: tag, border: s.borderTopWidth + ' ' + s.borderTopColor, shadow: s.boxShadow.slice(0,40) });
    if (e.matches('a,button,[role=button],input,select,summary,[data-act]') && !e.disabled && !allow(e)) {
      /* 命中区口径：控件外包一层 label/.field 时，点那层也能操作 —— 按外层算（否则 22 高的 input 被误判） */
      var box = r, wrap = e.closest('label,.field,.ctl');
      if (wrap) { var wr = wrap.getBoundingClientRect(); if (wr.height > box.height) box = wr; }
      out.hits.push({ el: tag, w: +box.width.toFixed(1), h: +box.height.toFixed(1), text: (e.textContent||'').trim().slice(0,16) });
    }
    if (ownText) out.texts.push({ el: tag, color: s.color, bg: effBg(e), fs: fs, weight: s.fontWeight, text: ownText });
    out.colors.push(s.color);
    var bgc = s.backgroundColor;
    if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') out.colors.push(bgc);
    Array.prototype.forEach.call(e.children, walk);
  };
  walk(document.body);
  return out;
})()`;

const parse = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null;
  return { r: +m[0], g: +m[1], b: +m[2], a: m[3] == null ? 1 : +m[3] }; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
const hue = (c) => { const r = c.r / 255, g = c.g / 255, b = c.b / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0 || d / mx < 0.12) return null; /* 中性（灰/黑/白）不算强调色族 */
  let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = h * 60; return h < 0 ? h + 360 : h; };

const goto = async (page) => {
  await send('Page.navigate', { url: BASE + '/' + page });
  await SLEEP(1800);
};

const fails = [];
const notes = [];
const fail = (rule, msg, evid) => { fails.push({ rule, msg, evid }); };

await goto(PAGE);
if (NEG) {
  /* 负控：注入 5 处坏值（只在内存里，不落盘） */
  await ev(`(function(){
    var g = document.querySelector('#grid') || document.body;
    /* 刀1 间距 7px / 11px 越界 —— 注入 4 份：T1 只报「≥3 次」的值（单次出现是噪声），只投 1 份等于没投 */
    for (var i = 0; i < 4; i++) { var d = document.createElement('div'); d.className='neg-space'; d.style.cssText='padding:7px 11px'; d.textContent='x'; g.appendChild(d); }
    /* 刀2 字号档超限 —— T2 的红线是「档数 ≤5」，所以必须把档数顶过 5 才叫扎到规则：
       投 4 个互不相同的离刻度字号（17.5/18.5/19.5/20.5），档数 3→7。 */
    var bad = ['17.5px', '18.5px', '19.5px', '20.5px'];
    for (var j = 0; j < bad.length; j++) { var f = document.createElement('span'); f.className = 'neg-fs'; f.style.cssText = 'font-size:' + bad[j]; f.textContent = 'sixth'; g.appendChild(f); }
    /* 刀3 圆角 7px */
    var r = document.createElement('div'); r.id='neg-r'; r.style.cssText='border-radius:7px;width:20px;height:20px;background:#eee'; g.appendChild(r);
    /* 刀4 描边+阴影 同层 */
    var b = document.createElement('div'); b.id='neg-b'; b.style.cssText='border:1px solid #d9d9d9;box-shadow:0 2px 8px rgba(0,0,0,.12);padding:8px'; b.textContent='x'; g.appendChild(b);
    /* 刀5 命中区 16×16 */
    var h = document.createElement('button'); h.id='neg-hit'; h.style.cssText='width:16px;height:16px;padding:0;border:0'; h.textContent=''; g.appendChild(h);
    return 1; })()`);
  await SLEEP(300);
}

const snap = await ev(SNAP(SIZE_SKIP.concat(SPACE_SKIP), LAYER_ALLOW));
if (!snap || !snap.fonts?.length) { console.log('SKIP: 页面没内容'); try { chrome.kill('SIGKILL'); } catch (e) { } process.exit(3); }
trace('snap keys=' + Object.keys(snap).join(','));

/* T1 间距封闭刻度：按 (prop,值) 聚合，只报出现 ≥3 次的越界值（偶发 1-2 次的单像素微调不计，
   否则判据被噪声淹没、没人看）；总越界数仍打进 notes，不许藏。 */
const groupSpace = new Map();
for (const s of snap.spacings) {
  if (SCALE.some((c) => Math.abs(c - s.v) <= TOL_PX)) continue;
  const k = `${s.prop}=${s.v}`;
  const g = groupSpace.get(k) || { prop: s.prop, v: s.v, n: 0, els: [] };
  g.n++; if (!g.els.includes(s.el)) g.els.push(s.el);   // 全部去重保留：元素限定要逐个核对，只留 2 个就核不了
  groupSpace.set(k, g);
}
const groups = [...groupSpace.values()].sort((a, b) => b.n - a.n);
const shown = groups.filter((g) => g.n >= 3).filter((g) => {
  if (allowedSpace(g)) { allowHits++; allowLog.push(`T1 ${g.prop}=${g.v}px ×${g.n} @ ${g.els.slice(0, 6).join(' ')}`); return false; }
  return true;
});
shown.slice(0, 10).forEach((g) => fail('T1', `${g.prop}=${g.v}px 不在刻度上，×${g.n}（${g.els.join('、')}）`, `${g.prop}|${g.v}`));
notes.push(`T1 间距样本 ${snap.spacings.length}，越界 ${[...groupSpace.values()].reduce((a, g) => a + g.n, 0)} 处／${groups.length} 种值；≥3 次的 ${groups.filter((g) => g.n >= 3).length} 种`);

/* T2 字号档 + 正文 */
const fsSet = [...new Set(snap.fonts.map((f) => f.fs))].sort((a, b) => a - b);
if (fsSet.length > FS_MAX) fail('T2', `一屏字号 ${fsSet.length} 档（>${FS_MAX}）：${fsSet.join('/')}`, fsSet.join('/'));
const bodyOdd = snap.fonts.filter((f) => f.fs === BODY_FS && f.lh !== null && !BODY_LH.includes(Math.round(f.lh)))
  .filter((f) => {
    if (!allowedLH(f)) return true;
    allowHits++; allowLog.push(`T2 ${f.el} ${f.fs}/${f.lh}`);
    return false;
  });
bodyOdd.slice(0, 8).forEach((f) => fail('T2', `正文 14px 但行高 ${f.lh}px 不在 [${BODY_LH}]：${f.el} ${f.text}`, `${f.el}|${f.lh}`));
notes.push(`T2 字号档 ${fsSet.length} 个：${fsSet.join('/')}；正文 14px 样本 ${snap.fonts.filter((f) => f.fs === BODY_FS).length}`);

/* T3 圆角封闭集合（百分比 ≥50% 视为正圆/胶囊，属构型，不参与 px 档位判定） */
const badR = snap.radii.filter((r) => {
  if (r.pct && r.v >= 50) return false;
  return !RADII.some((c) => Math.abs(c - r.v) <= TOL_PX);
});
badR.slice(0, 10).forEach((r) => fail('T3', `${r.el} ${r.prop}=${r.v}${r.pct ? '%' : 'px'} 不在集合`, `${r.el}|${r.v}`));
notes.push(`T3 圆角样本 ${snap.radii.length} 个（其中百分比 ${snap.radii.filter((r) => r.pct).length} 个按构型放行），越界 ${badR.length}`);

/* T4 描边/阴影互斥 */
snap.borders.slice(0, 10).forEach((b) => fail('T4', `${b.el} 同时有 border ${b.border} 与 shadow`, b.el));
notes.push(`T4 描边+阴影同层 ${snap.borders.length} 处`);

/* T5 命中区（WCAG 2.5.8 有「行内链接」例外：正文里的 a 不量） */
const badHit = snap.hits.filter((h) => {
  if (!(h.w < HIT || h.h < HIT)) return false;
  if (allowedBy('hit', h.el)) { allowHits++; allowLog.push(`T5 ${h.el} ${h.w}×${h.h}`); return false; }
  return !(h.el === 'a' && h.w > 40);
});
badHit.slice(0, 10).forEach((h) => fail('T5', `${h.el} 命中区 ${h.w}×${h.h} < ${HIT}×${HIT}：${h.text}`, h.el));
notes.push(`T5 可点元素 ${snap.hits.length} 个，小于 ${HIT}×${HIT} 的 ${badHit.length} 个`);

/* T6 对比度：前景 vs 沿祖先链算出的有效底色（alpha 合成；不是"假设白底"） */
const badC = [];
for (const t of snap.texts) {
  const fg = parse(t.color); if (!fg) continue;
  const bg = parse(t.bg) || { r: 255, g: 255, b: 255, a: 1 };
  /* 半透明前景先按 alpha 合成到底色上 */
  const fs2 = fg.a < 1 ? { r: fg.a * fg.r + (1 - fg.a) * bg.r, g: fg.a * fg.g + (1 - fg.a) * bg.g, b: fg.a * fg.b + (1 - fg.a) * bg.b, a: 1 } : fg;
  const cr = ratio(fs2, bg);
  const large = t.fs >= 18.66 || (t.fs >= 14 && +t.weight >= 700);
  const need = large ? CONTRAST_LARGE : CONTRAST_TEXT;
  if (cr < need) { if (allowedBy('contrast', t.el)) { allowHits++; allowLog.push(`T6 ${t.el}「${t.text}」${cr}:1`); continue; } badC.push({ ...t, cr, need }); }
}
badC.slice(0, 10).forEach((t) => fail('T6', `${t.el}「${t.text}」对比 ${t.cr}:1 < ${t.need}:1`, `${t.el}|${t.cr}`));
notes.push(`T6 文本样本 ${snap.texts.length}，不达标 ${badC.length}`);

/* T7 强调色族 */
const hues = [...new Set(snap.colors.map(parse).filter(Boolean).map(hue).filter((h) => h !== null))].sort((a, b) => a - b);
const fam = [];
for (const h of hues) { if (!fam.length || h - fam[fam.length - 1].max > HUE_TOL) fam.push({ min: h, max: h }); else fam[fam.length - 1].max = h; }
if (fam.length > ACCENT_MAX) fail('T7', `强调色族 ${fam.length} 族（>${ACCENT_MAX}）：${fam.map((f) => Math.round((f.min + f.max) / 2) + '°').join('/')}`, fam.length);
notes.push(`T7 强调色族 ${fam.length}（色相 ${hues.map((h) => Math.round(h)).join('/')}）`);

/* ── 输出 ── */
console.log(`页面 ${PAGE}｜七条判据`);
notes.forEach((n) => console.log('  · ' + n));
if (allowHits) {
  console.log(`  · 例外账放行 ${allowHits} 处（tools/token-allow.tsv，每行带出处）—— 逐条列出放行对象：`);
  allowLog.slice(0, 30).forEach((l) => console.log('      · ' + l));
  if (allowLog.length > 30) console.log(`      · …其余 ${allowLog.length - 30} 处略（--strict 可整份作废重检）`);
}
if (!fails.length) console.log('通过 7 条｜断点 0');
else { console.log(`断点 ${fails.length}：`); fails.forEach((f) => console.log(`  ✗ ${f.rule} ${f.msg}`)); }
try { chrome.kill('SIGKILL'); } catch (e) { }

if (NEG) {
  /* 负控判定：五把刀必须各自命中对应规则 */
  const hitRules = new Set(fails.map((f) => f.rule));
  const want = ['T1', 'T2', 'T3', 'T4', 'T5'];
  const miss = want.filter((w) => !hitRules.has(w));
  if (miss.length) { console.log(`NEGCTL 漏刀：${miss.join(',')} 没被抓住`); process.exit(3); }
  console.log(`NEGCTL 命中 ${want.length}/${want.length}：${want.map((w) => w + (hitRules.has(w) ? '✓' : '✗')).join(' ')}`);
  process.exit(2);
}
process.exit(fails.length ? 2 : 0);
