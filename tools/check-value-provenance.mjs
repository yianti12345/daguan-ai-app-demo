#!/usr/bin/env node
/* check-value-provenance —— **视觉字面量必须能回答「它从哪来」**（值出处判据）。
 *
 * 为什么有它：CSS 里的视觉值有两种来源 —— `var(--token)`（有出处）和裸值
 * （`gap:8px` / `#fff` / `rgba(...)`）。裸值的问题是「这个值凭什么」。
 * 最贵的一次：为了一张真源自带底色的卡片，手搓 CSS 渐变从 9% 调到 28%，
 * 而卡上根本不该有渐变 —— 调参调了两小时，方向从一开始就是错的。
 * 判据要做的不是「禁止裸值」，而是**让每个字面量都必须在台账里被问过一次**。
 *
 * 必须 ratchet（存量豁免 + 增量管控）：
 * 上线时存量 200+ 条，一次判红 200 条等于没人会看。
 * 所以：`tools/value-baseline.tsv` 记下**今天的存量**（按 文件+值+类别 匹配，不按行号，
 * 行号会漂），新增的裸值才判红。存量只会减、不会增（重跑 --write-baseline 才会扩）。
 *
 * 纯静态：不起浏览器、不开服务、不跑 build。这是它比别的判据便宜的原因，必须保持。
 *
 * 抽哪些字面量（只扫 assets/sys.css 与 5 个 html 的 <style> 段，先剥注释）：
 *   #hex / rgb() / rgba()               → color
 *   font-size:NNpx                       → font-size
 *   padding|margin|gap(-x):NNpx（多值逐个抽） → spacing
 *   border-radius:NNpx                   → radius
 *   linear-gradient/radial-gradient 里的色标与百分比 → gradient
 * `var()` / `calc()` / `url()` / `min|max|clamp|translate` 括号内的数字与色值**不算裸值**：
 * 它们已经挂在 token 上（`calc(var(--r-l) - 3px)` 的 3px 是派生量，不是随手写的值）。
 *
 * 判定顺序：
 *   1) 值是 var(--*)                     → 通过（压根没被抽出来）
 *   2) value-provenance.tsv 有记录且出处 ≠ 待删 → 通过（有出处）
 *      ★2026-10-28（机制审查官）：台账行可以带**第 5 列「文件」**，把这条出处限定到一个文件。
 *        为什么必须能限：台账原来按「值+类别」做键，与文件无关 —— 给 app.html 的 72px 补一行
 *        「顶栏底边 64+8」，会连带把 component.html 的 72px 一并洗成「有出处」，而那一页顶栏
 *        只有 44 高（28 按钮 + 16 顶距），64+8 的推导在它身上根本不成立。那就是「补一行代替改值」。
 *        第 5 列留空＝全局行（旧行为不变）；写错文件名 ⇒ rc=3（不许静默降级成全局）。
 *   3) value-baseline.tsv 有（文件+值+类别）   → 通过，计入「存量」
 *   4) 其余                              → 判红
 * 出处只能是四个值：真源实测 / 规范复用 / 派生 / 待删。
 *   真源实测 → 证据必须写「哪个页面的哪个元素」
 *   规范复用 → 证据必须写「DESIGN.md 哪一节」或「tokens.css 哪个 token」
 *   派生     → 证据必须写「由什么推出」，空 ⇒ 台账坏（rc=3，不许当绿）
 *   待删     → 出现即判红（这个值在等死，却还活着）
 *
 * 用法：
 *   node tools/check-value-provenance.mjs               判据（rc 0/1/3）
 *   node tools/check-value-provenance.mjs --write-baseline  把当前所有裸值记成存量
 *   node tools/check-value-provenance.mjs --negctl      注入一个新裸值，必须判红 rc=2
 * 退出码：0 无新增裸值 ｜ 1 有新增裸值 ｜ 2 负控档：注入的裸值确实被判红｜ 3 读不到文件 / 台账格式坏
 *
 * ★2026-10-27 负控档退出码 1 → 2：`tools/negctl.tsv` 的约定是「结果=pass ⇔ 该判据 --negctl 退出码 = 2」，
 *   原来负控走 1 与「正控有新增裸值」同一个码，台账无法区分「判据会红」和「判据真的发现了新裸值」；
 *   两边都算 pass 等于同一件事有两个读数。判据本身的 0/1 语义不动（门禁读的是正控）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROV = path.join(HERE, 'value-provenance.tsv');
const BASE = path.join(HERE, 'value-baseline.tsv');

const SOURCES = ['assets/sys.css', 'app.html', 'apps.html', 'component.html', 'components.html', 'versions.html'];
const CATS = new Set(['color', 'font-size', 'spacing', 'radius', 'gradient']);
const ORIGINS = new Set(['真源实测', '规范复用', '派生', '待删']);

const WRITE = process.argv.includes('--write-baseline');
const NEG = process.argv.includes('--negctl');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(3); };

/* ── 剥注释：把注释里的每个非换行字符换成空格 ─────────────────────
 * 必须保留换行，否则行号全漂。注释里写「历史做法 rgba(0,0,0,.45)」是**对的**，
 * 不该判红 —— J1 判据把注释里的色值当裸值，报了一堆假红，这条踩过。 */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/* html 只留 <style> 段，其余字符换空格（保留换行，行号与原文件一致）。 */
function styleBody(src, file) {
  if (!/\.html?$/.test(file)) return src;
  const out = src.split('').map((c) => (c === '\n' ? '\n' : ' '));
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const start = m.index + m[0].indexOf('>') + 1;
    for (let i = 0; i < m[1].length; i++) out[start + i] = m[1][i];
  }
  return out.join('');
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/* ── 声明遍历：拿到 选择器 / 属性 / 值 / 值在源码里的绝对起点 ──────
 * 记绝对起点而不是「分号所在行」，因为多行声明（值折行）会把行号报错一行。 */
function declarations(css) {
  const out = [];
  const stack = [];
  let sel = '';
  let buf = '';
  let bufStart = 0;

  const flushDecl = () => {
    const raw = buf;
    const start = bufStart;
    const d = raw.trim();
    if (!d || !stack.length) return;
    const ci = d.indexOf(':');
    if (ci <= 0) return;
    const lead = raw.length - raw.trimStart().length;
    const prop = d.slice(0, ci).trim().toLowerCase();
    const valRaw = d.slice(ci + 1);
    const valLead = valRaw.length - valRaw.trimStart().length;
    out.push({ sel, prop, val: valRaw.trim(), valStart: start + lead + ci + 1 + valLead });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      bufStart = i + 1;
      const isAt = prelude.startsWith('@');
      stack.push({ prelude, isAt });
      if (!isAt) sel = prelude;
    } else if (ch === '}') {
      // 块内最后一条声明可能没有分号：先冲一次
      flushDecl();
      buf = '';
      stack.pop();
      sel = '';
      for (let k = stack.length - 1; k >= 0; k--) if (!stack[k].isAt) { sel = stack[k].prelude; break; }
      bufStart = i + 1;
    } else if (ch === ';') {
      flushDecl();
      buf = '';
      bufStart = i + 1;
    } else {
      buf += ch;
    }
  }
  return out;
}

/* 受保护的括号区间：里面是 token/派生量，不是裸值。 */
const PROTECT = /(var|calc|url|min|max|clamp|translate|translateX|translateY|rotate|scale|blur|env|hsl|hwb|lab|lch|oklab|oklch|color-mix)\(/gi;
function protectedRanges(val) {
  const ranges = [];
  for (const m of val.matchAll(PROTECT)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < val.length; i++) {
      if (val[i] === '(') depth++;
      else if (val[i] === ')') { depth--; if (depth === 0) break; }
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}
const inside = (ranges, i) => ranges.some(([a, b]) => i > a && i <= b);

/* 归一：去掉内部空白，`.9`→`.9`（不动），把 0 省略写法统一（只去空白即可）。 */
const norm = (s) => s.replace(/\s+/g, '').replace(/^0\./, '.').toLowerCase();

/* ── 从一个声明里抽出裸字面量 ─────────────────────────────────── */
function extract(decl, file, ln) {
  const hits = [];
  const v = decl.val;
  const prot = protectedRanges(v);
  const push = (value, cat, index, extra) => {
    if (inside(prot, index)) return;
    hits.push({ file, line: ln(decl.valStart + index), sel: decl.sel, prop: decl.prop,
               declVal: v, value, cat, ...extra });
  };

  // 渐变：色标与百分比都算（这是最贵那类错的现场）
  if (/gradient\s*\(/i.test(v)) {
    for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) push(norm(m[0]), 'gradient', m.index);
    for (const m of v.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)%/g)) push(m[1] + '%', 'gradient', m.index);
    return hits;
  }

  if (decl.prop === 'font-size') {
    for (const m of v.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px(?![\w])/g)) push(m[1] + 'px', 'font-size', m.index);
    return hits;
  }

  if (decl.prop === 'border-radius' || /^border-[a-z-]*radius$/.test(decl.prop)) {
    for (const m of v.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px(?![\w])/g)) {
      if (parseFloat(m[1]) === 0) continue;
      push(m[1] + 'px', 'radius', m.index);
    }
    return hits;
  }

  if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(decl.prop)) {
    for (const m of v.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px(?![\w])/g)) {
      if (parseFloat(m[1]) === 0) continue;
      push(m[1] + 'px', 'spacing', m.index);
    }
    return hits;
  }

  for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) push(norm(m[0]), 'color', m.index);
  return hits;
}

/* ── 读台账 ───────────────────────────────────────────────────── */
/* 读台账。注意 `#` 既是注释符又是 hex 色值的前缀（`#fff` / `#E5E7EB`）——
 * 只按「行首是 #」判注释会把所有 hex 行吃掉，台账里就永远写不进颜色。
 * 所以先按「长得像不像数据行」认（列数对 + 类别合法 + 日期合法），
 * 认不上再退回注释；既不是数据行也不像注释的，判台账格式坏（rc=3），不许当绿。 */
function readTsv(file, cols, label, kind) {
  /* prov 允许 4 列（全局行）或 5 列（第 5 列＝把出处限定到某个文件）。 */
  const looksData = (c) => (kind === 'prov'
    ? (c.length === 4 || c.length === 5) && CATS.has(c[1]) && ORIGINS.has(c[2])
    : c.length === cols && /^\d{4}-\d{2}-\d{2}$/.test(c[3]));
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n');
  const rows = [];
  raw.forEach((line, i) => {
    const l = line.replace(/\r$/, '');
    if (!l.trim()) return;
    const c = l.split('\t').map((x) => x.trim());
    if (!looksData(c)) {
      if (l.trimStart().startsWith('#')) return;
      die(`${label} 第 ${i + 1} 行列数/取值不对（要 ${cols} 列 TAB 分隔）：${l.slice(0, 80)}`);
    }
    rows.push(c);
  });
  return rows;
}

const hitsAll = [];
for (const file of SOURCES) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) die(`读不到 ${file}`);
  let src = stripComments(fs.readFileSync(p, 'utf8'));
  if (NEG && file === 'assets/sys.css') {
    src += '\n.kcard{background:linear-gradient(90deg,#f00,#0f0)}\n';
  }
  src = styleBody(src, file);
  const ln = lineIndex(src);
  for (const d of declarations(src)) hitsAll.push(...extract(d, file, ln));
}

/* ── 台账 ─────────────────────────────────────────────────────── */
if (!fs.existsSync(PROV)) die('读不到台账 tools/value-provenance.tsv');
const prov = new Map();
for (const c of readTsv(PROV, 4, 'value-provenance.tsv', 'prov')) {
  const [value, cat, origin, evidence, file] = c;
  if (!value) continue;
  if (!CATS.has(cat)) die(`value-provenance.tsv 类别「${cat}」不认识（只许 ${[...CATS].join(' / ')}）`);
  if (!ORIGINS.has(origin)) die(`value-provenance.tsv 出处「${origin}」不认识（只许 真源实测/规范复用/派生/待删）`);
  if (origin !== '待删' && !evidence) die(`value-provenance.tsv「${value}」出处是 ${origin} 但证据为空 —— 没有证据的出处等于没有出处`);
  /* 第 5 列是文件限定。写错文件名必须当场判坏：静默落成全局行＝把出处放宽到全站。 */
  if (file && !SOURCES.includes(file)) {
    die(`value-provenance.tsv「${value}」第 5 列文件「${file}」不在受扫清单里（只许 ${SOURCES.join(' / ')} 或留空）`);
  }
  const k = `${norm(value)}\t${cat}`;
  const rec = prov.get(k) || { global: null, byFile: new Map() };
  if (file) rec.byFile.set(file, { origin, evidence, file });
  else rec.global = { origin, evidence, file: '' };
  prov.set(k, rec);
}
/* 取值出处：先按「文件」精确命中，再退回全局行。没有全局行时，别处的同值裸值不会被这条洗白。 */
const provFor = (h) => {
  const rec = prov.get(`${h.value}\t${h.cat}`);
  if (!rec) return null;
  return rec.byFile.get(h.file) || rec.global || null;
};

if (!fs.existsSync(BASE)) {
  if (!WRITE) die('读不到存量清单 tools/value-baseline.tsv —— 先跑 `node tools/check-value-provenance.mjs --write-baseline`');
}
const baseline = new Map();
if (fs.existsSync(BASE)) {
  for (const c of readTsv(BASE, 4, 'value-baseline.tsv', 'base')) {
    const [file, value, cat, date] = c;
    if (!file || !value) continue;
    baseline.set(`${file}\t${norm(value)}\t${cat}`, date);
  }
}

/* ── --write-baseline ─────────────────────────────────────────── */
if (WRITE) {
  const today = new Date().toISOString().slice(0, 10);
  const keys = new Map();
  for (const h of hitsAll) {
    // 已经在台账里有出处的（含「待删」）不记进存量：它们要么永远该绿，要么永远该红。
    // ★按文件判：只被别的文件的台账行覆盖，不算这个文件有出处。
    if (provFor(h)) continue;
    const k = `${h.file}\t${h.value}\t${h.cat}`;
    if (!keys.has(k)) keys.set(k, baseline.get(k) || today);
  }
  const lines = [
    '# 视觉值存量清单（ratchet 基线）—— 由 `node tools/check-value-provenance.mjs --write-baseline` 生成',
    '# 列：文件\t值\t类别\t首次记录日。只在首次或确认后重跑；重跑会保留已有行的首次日期。',
    '# 这份清单是「今天的存量」，不是许可证明：存量要往下减，新增一律判红。',
    '# 已在 value-provenance.tsv 里有出处的值不记在这里（有出处的走出处，不靠存量豁免）。',
  ];
  const sorted = [...keys.entries()].sort((a, b) => {
    const [fa, va, ca] = a[0].split('\t');
    const [fb, vb, cb] = b[0].split('\t');
    return fa.localeCompare(fb) || ca.localeCompare(cb) || va.localeCompare(vb, 'en', { numeric: true });
  });
  for (const [k, date] of sorted) lines.push(`${k}\t${date}`);
  fs.writeFileSync(BASE, lines.join('\n') + '\n', 'utf8');
  const byCat = {};
  for (const h of hitsAll) byCat[h.cat] = (byCat[h.cat] || 0) + 1;
  console.log(`已写入 tools/value-baseline.tsv｜${sorted.length} 行（按 文件+值+类别 去重）`);
  console.log(`当前裸值 ${hitsAll.length} 条：` +
    [...CATS].map((c) => `${c} ${byCat[c] || 0}`).join(' ｜ '));
  process.exit(0);
}

/* ── 判定 ─────────────────────────────────────────────────────── */
let fresh = 0, legacy = 0, sourced = 0, todo = 0;
const reds = [];
const byCat = {};

for (const h of hitsAll) {
  byCat[h.cat] = (byCat[h.cat] || 0) + 1;
  const p = provFor(h);
  if (p && p.origin !== '待删') { sourced++; continue; }
  if (p && p.origin === '待删') {
    todo++;
    fresh++;
    reds.push({ ...h, todo: true,
      why: `台账标记为待删（${p.evidence || '无说明'}）—— 这个值正在等死，却还活着` });
    continue;
  }
  if (baseline.has(`${h.file}\t${h.value}\t${h.cat}`)) { legacy++; continue; }
  fresh++;
  reds.push({ ...h, why: '台账无出处' });
}

/* 同一条声明里的同类裸值合成一行打（多值写法逐个数字抽，计数仍然是逐个），
 * 免得 `linear-gradient(90deg,#f00,#0f0)` 打印成两行一模一样的文字。 */
const grouped = new Map();
for (const r of reds) {
  const k = `${r.file}:${r.line}:${r.prop}:${r.cat}`;
  const g = grouped.get(k);
  if (g) { g.n++; g.values.set(r.value, (g.values.get(r.value) || 0) + 1); }
  else grouped.set(k, { ...r, n: 1, values: new Map([[r.value, 1]]) });
}
const shown = [...grouped.values()].sort((a, b) =>
  SOURCES.indexOf(a.file) - SOURCES.indexOf(b.file) || a.line - b.line);

console.log('视觉值出处判据｜剥注释后扫 ' + SOURCES.length + ' 个文件（sys.css + 5 个 html 的 <style>）\n');

if (shown.length) {
  for (const r of shown) {
    const bare = [...r.values].map(([v, n]) => (n > 1 ? `${v} ×${n}` : v)).join(' / ');
    const advice = r.todo
      ? '要么把这个值删掉，要么在台账里改出处并给出证据'
      : '写进 value-provenance.tsv 并给出处，或改用 token';
    console.log(`  ✗ ${r.file}:${r.line}  ${r.sel || '(无选择器)'}  {${r.prop}:${r.declVal}}  —— ${r.why}` +
      `（裸值 ${bare}）；建议：${advice}`);
  }
} else {
  console.log('  ✓ 没有新增裸值');
}

console.log(`\n新增裸值 ${fresh} 条 ｜ 存量 ${legacy} 条 ｜ 有出处 ${sourced} 条`);
console.log('按类押存量：' + [...CATS].map((c) => `${c} ${byCat[c] || 0}`).join(' ｜ ') +
  `（合计 ${hitsAll.length}）`);
if (todo) console.log(`其中「待删」${todo} 条 —— 台账自己承认在等死，不算存量。`);

if (NEG) {
  const caught = reds.some((r) => /linear-gradient\(90deg,#f00,#0f0\)/.test(r.declVal));
  if (!caught) {
    console.error('\n负控失败：注入了 linear-gradient(90deg,#f00,#0f0) 却没判红 —— 这条判据是空的');
    process.exit(3);
  }
  console.log('\n负控：注入 .kcard{background:linear-gradient(90deg,#f00,#0f0)} 后判红 ✓（负控档 rc=2，与 tools/negctl.tsv 的 pass 口径一致）');
  process.exit(2);
}

process.exit(fresh > 0 ? 1 : 0);
