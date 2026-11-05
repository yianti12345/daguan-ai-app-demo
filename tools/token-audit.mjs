#!/usr/bin/env node
/* token-audit —— 把「令牌映射」这一类隐性缺陷一次扫出来。
 *
 * 为什么单独一个脚本：gate-tokens 的 J1 只查**页面渲染出来的色值与字号**，
 * 查不到下面这几类，而它们的共同点是**没有任何报错**：
 *   1. `var(--x)` 引用了不存在的 token ⇒ 整条声明失效、样式静默丢失（比写错色值难发现得多）
 *   2. 定义了却没人用的 token ⇒ 假资产，改它没反应，还以为自己改对了
 *   3. 文字色用了"面"的 token（如 color:var(--sub)）⇒ 白底白字，肉眼几乎看不出来
 *   4. 圆角/控件高写裸值、且不在档位表里 ⇒ 规则约束力为零
 *   5. 同一语义两个名字（或同名两个值）
 *
 * 用法：
 *   node tools/token-audit.mjs                  # 正常跑
 *   node tools/token-audit.mjs --negctl         # 负控/正控自检（期望 rc=2）
 *   node tools/token-audit.mjs --tokens <path>  # 只给负控用：换一份令牌源
 * 退出码：0 无问题 ｜ 2 有问题 ｜ 3 未量（令牌源里找不到/解析不到档位 / 例外账读不懂 —— 不当作通过）
 *
 * ★2026-10-29：定义源仍是 `assets/tokens.css` 单源（DESIGN §8 第 7 条）。唯一口子是
 *   `tools/token-crossfile.tsv` 里逐条登记的跨文件令牌（现 1 条：--fk-clear-bottom @ float.css）；
 *   没登记的跨文件令牌照旧判「引用不存在」，不把 float.css 整份并入定义源。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* ★2026-10-29：`--tokens <path>` 只为一件事存在 —— **负控**。
   要证明档位解析器会红，必须把某一档改坏；在真身上改坏再复原，等于在写域外的文件上
   留一次未授权的写（哪怕复原了，中间态也可能被别的进程读到）。
   现在拿一份 /tmp 副本改，真身一个字节不动；默认路径不变，正常跑法一个字都不用改。 */
const argVal = (name) => {
  const i = process.argv.indexOf(name);
  if (i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : '';
};
const TOKENS_REL = 'assets/tokens.css';
const TOKENS_PATH = argVal('--tokens') || join(ROOT, TOKENS_REL);
const TOKENS_SHOWN = TOKENS_PATH === join(ROOT, TOKENS_REL) ? TOKENS_REL : TOKENS_PATH;
const tokRaw = readFileSync(TOKENS_PATH, 'utf8');
/* ★ 解析定义区**必须先用剥注释的版本**。
   教训（第二次踩）：本轮在注释里写了「曾经的 --fs-2xs:11 违反低于 12 不用，已删」，
   正则就把这句注释当成了一条真实定义 —— DEF 里凭空多出 --fs-2xs，
   而真的 --fs-xs 反而被那句注释吞掉，报出「--fs-xs 引用不存在」的假红。
   注释里写 token 与判据读注释是同一类错：**判据必须只看代码，不看解释**。 */
const tokCss = tokRaw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));

/* 只统计 :root 里真正定义的（含别名区），全文件扫 --name: value */
const DEF = new Map();
for (const m of tokCss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  DEF.set(m[1], m[2].trim());
}
if (!DEF.size) { console.log('FATAL: tokens.css 里没解析到任何 token'); process.exit(3); }

const FILES = [];
for (const f of readdirSync(ROOT)) if (f.endsWith('.html')) FILES.push(f);
for (const f of readdirSync(join(ROOT, 'assets'))) if (f.endsWith('.css')) FILES.push('assets/' + f);
/* ⚠ 必须先把注释剥掉再扫：上一版把我自己写的说明「这里原来写的是 color:var(--sub)」
   当成一处真实用法报了红。判据读注释＝假阳性，和"注释里写色值"是同一类错。 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const raw = new Map();
const src = new Map();
for (const f of FILES) {
  const t = readFileSync(join(ROOT, f), 'utf8');
  raw.set(f, t);
  src.set(f, strip(t));
}

/* 局部自定义属性（如 .xz-fab{--xz-pic:url(...)}）不是 token，但它是**定义了**的，
   不能算"引用不存在"。只在同一个文件里生效，所以按文件合并进定义表再判。 */
const localDefs = new Map();
for (const [f, t] of src) {
  const set = new Set();
  for (const m of t.matchAll(/(--[a-z0-9-]+)\s*:/gi)) set.add(m[1]);
  localDefs.set(f, set);
}

/* ── 跨文件例外账（2026-10-29）────────────────────────────────
 * 病：`--fk-clear-bottom:172px` 定义在 assets/float.css，被 assets/sys.css 引用。
 * 旧判据只认 tokens.css 为定义源 ⇒ 报「引用不存在的 token」。
 * 两种修法：① 把值搬进 tokens.css（DESIGN §8.7 的正解，但 assets/ 不在本席写域）；
 *          ② 把 float.css 整份并入定义源 —— 这会把"以后任何令牌都能写在 float.css"合法化，
 *             等于废掉单源，是真的放宽。
 * 取中间：只放行**例外账里逐条登记**的跨文件令牌，且必须核到它确实定义在登记的那个文件里。
 * 没登记的新令牌照旧判红；登记了但定义已消失 ⇒ 例外账过期，也判红。
 * 账：tools/token-crossfile.tsv（token / file / why / owner / due）。 */
const CROSS_LEDGER = join(ROOT, 'tools/token-crossfile.tsv');
const crossReg = new Map();      /* token -> file */
const crossMissing = [];         /* 登记了，但那个文件里没有这条定义 */
const crossExpired = [];         /* 登记了，但到期日已过（例外账不是永久豁免） */
const crossBad = [];             /* 行格式不合格 */
if (existsSync(CROSS_LEDGER)) {
  const lines = readFileSync(CROSS_LEDGER, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (!l.trim() || l.startsWith('#')) return;
    const c = l.split('\t');
    if (c.length < 5) { crossBad.push(`第 ${i + 1} 行只有 ${c.length} 列（要 5 列）`); return; }
    const [tok, file, why, owner, due] = c.map((x) => (x || '').trim());
    if (!/^--[a-z0-9-]+$/.test(tok)) { crossBad.push(`第 ${i + 1} 行 token 名不合法：${tok}`); return; }
    if (!src.has(file)) { crossBad.push(`第 ${i + 1} 行文件不在扫描面：${file}`); return; }
    if (!(localDefs.get(file) || new Set()).has(tok)) { crossMissing.push(`${tok}（${file} 里没有定义）`); return; }
    if ([...why].filter((ch) => !/\s/.test(ch)).length < 20) { crossBad.push(`第 ${i + 1} 行理由不足 20 字`); return; }
    if (!owner) { crossBad.push(`第 ${i + 1} 行缺 owner`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) { crossBad.push(`第 ${i + 1} 行到期日不是 YYYY-MM-DD：${due}`); return; }
    if (due < new Date().toISOString().slice(0, 10)) crossExpired.push(`${tok}（${due} 已过期）`);
    crossReg.set(tok, file);
  });
}
/* 例外账本身读不懂 = 未量，不是通过（否则改坏一行就能让判据静默失效）。 */
if (crossBad.length) {
  console.log('FATAL: tools/token-crossfile.tsv 无法解析 —— ' + crossBad.join(' | '));
  process.exit(3);
}

/* ── 1 · 引用了不存在的 token ───────────────────────────────── */
const missing = new Map();
for (const [f, s] of src) {
  for (const m of s.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const n = m[1];
    if (DEF.has(n)) continue;
    if (crossReg.has(n)) continue;                               /* 已登记的跨文件例外（且定义已核到） */
    if (localDefs.get(f) && localDefs.get(f).has(n)) continue;   /* 同文件内的局部属性 */
    missing.set(n, (missing.get(n) || new Set()).add(f));
  }
}

/* ── 2 · 定义了没人用 ───────────────────────────────────────── */
const used = new Set();
for (const [, s] of src) for (const m of s.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1]);
/* 别名 token 作为值被别的 token 引用也算"用到" */
for (const [, v] of DEF) for (const m of v.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1]);
const dead = [...DEF.keys()].filter((n) => !used.has(n));

/* ── 3 · 文字色用了"面"的 token（近白压白）─────────────────── */
const lum = (hex) => {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
};
/* 取一个 token 值的相对亮度：**hex 和 rgba 都要认**。
   踩过：`--ink:rgba(0,0,0,.85)` 不是 hex，只认 hex 时底色亮度取不到，
   于是 `.toast`（深底白字）永远判不出来、永远红。 */
const lumOf = (s) => {
  const h = String(s || '').match(/#[0-9a-f]{6}/i);
  if (h) return lum(h[0]);
  const m = String(s || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  const a = m[4] == null ? 1 : +m[4];
  const ch = [m[1], m[2], m[3]].map((v) => (+v) * a + 255 * (1 - a)); // 半透明按白底合成（保守）
  return lum('#' + ch.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
};
const whiteish = [];
/* ⚠ 正则必须锚在属性名边界上：`background-color:var(--brand-bg)` 里也含 "color:"，
   不锚边界就会把"底色"当成"文字色"，报出一条根本不存在的问题。
   判据报假问题比不报更坏 —— 它会让人去改一个本来就对的取值。（本轮实测踩到） */
/* ★ 2026-10-25 补：近白文字只有在**深底**上才合法。`.toast` 是 background:var(--ink) + color:var(--bg)，
   白字压深底实测 12:1，不是"白底白字"。原实现只看前景亮度、不看底色，
   于是把这个深色浮层判成错 —— 又一例"判据报假问题"。现在把同一规则块的 background 一起看。 */
const blockOf = (s, idx) => {
  const a = s.lastIndexOf('{', idx), b = s.indexOf('}', idx);
  return a >= 0 && b > a ? s.slice(a, b) : s.slice(Math.max(0, idx - 200), idx + 200);
};
for (const [f, s] of src) {
  for (const m of s.matchAll(/(?:^|[;{\s])(?:^|(?<![-\w]))color\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
    if (f === 'assets/xiaozhi.css') continue;      /* 小智是原样搬入的资产，不改它的样式 */
    if (m[1] === '--on-brand') continue;           /* 它的语义就是"压在品牌底上的白字"，不是白底白字 */
    const hex = (DEF.get(m[1]) || '').match(/#[0-9a-f]{6}/i);
    if (!hex) continue;
    const L = lum(hex[0]);
    if (L === null || L <= 0.85) continue;
    /* 同块若有深色底，则这条近白文字是合法的 */
    const bgm = blockOf(s, m.index).match(/background(?:-color)?\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/i);
    const bl = bgm ? lumOf(DEF.get(bgm[1])) : null;
    if (!(bl !== null && bl < 0.30)) whiteish.push({ f, tok: m[1], hex: hex[0], L: L.toFixed(3) });
  }
}

/* ── 4 · 圆角 / 字号写裸值且不在档位 ──────────────────────────
 * 档位**从 tokens.css 解析**，不在这里手写。这一行的来历：
 *   原来写的是 new Set([0, 2, 3, 4, 6, 12, 999, 50]) —— 有 3、有 4，却**没有 8**，
 *   而 tokens.css 里 --r-ctl 就是 8。同一件事三个定义处（tokens / 本判据 / DESIGN.md），
 *   谁也不等于谁。判据和规范一旦分家，两边都会变成"纸上的字"。
 *
 * 同时删掉了 `if (f === 'assets/xiaozhi.css') continue`。
 *   那条豁免的注释写"原样资产，圆角不纳入本套档位"——可小智是产品主入口之一：
 *   它当时有 19 处裸圆角（23/22/19/15/14/13/9/7px…）、18 处裸字号（10.5/11.5/12.5/13.5px），
 *   全部在体系之外，而本判据报的是「✓ 圆角没有出档裸值」。
 *   **白名单盖住的缺口比没有判据更坏：它会让你以为查过了。**
 *
 * ★2026-10-29（缺陷·判据已死，实测 rc=3）：tokens.css 改成 v2 三层之后，这里停在 v1 ——
 *   只认 `--r-x: 8px` 这种"名字后面直接跟 px"的写法。v2 里
 *     --r-*      = var(--radius-*)      （L0 兼容层）
 *     --radius-* = var(--p-radius-N)    （L2 语义层）
 *     --p-radius-N = 12px               （L1 原始值）
 *   正则一条也匹配不到 ⇒ RAD/FS 都是空集 ⇒ FATAL，这条判断其实**已经停了**。
 *   修法不是"把正则再放宽一层"—— 那只是把"下次再加一层就断"往后推一次。
 *   现在写解析器：顺着 var() 链走到 px 字面量。三层各自解析后取并集（页面可能引用任意一层）；
 *   v1 文件照样能跑（链只有一跳）。链断 / 成环 / 不是 px 都点名报出，不许当空集继续跑。
 */
const resolve = (name, chain = []) => {
  if (chain.includes(name)) return { err: 'var() 成环', chain: chain.concat(name) };
  const raw = DEF.get(name);
  if (raw == null) return { err: '未定义', chain };
  const s = raw.trim();
  const alias = s.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (alias) return resolve(alias[1], chain.concat(name));
  const px = s.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px) return { px: +px[1], chain: chain.concat(name) };
  return { err: '不是 px 字面量（' + s.slice(0, 24) + '）', chain };
};

/* 三层的档位名分别收集。名字写死在正则里的只有**前缀**：
   将来 L2 再改名，这里会因"一个名字都没找到"而 FATAL，不会静默变成 0 档。 */
const RAD_GROUPS = {
  'L1 --p-radius-*': [...DEF.keys()].filter((n) => /^--p-radius-[a-z0-9]+$/i.test(n)),
  'L2 --radius-*': [...DEF.keys()].filter((n) => /^--radius-[a-z0-9]+$/i.test(n)),
  'L0 --r-*': [...DEF.keys()].filter((n) => /^--r-[a-z0-9]+$/i.test(n))
};
const FS_GROUPS = {
  'L1 --p-font-*': [...DEF.keys()].filter((n) => /^--p-font-[a-z0-9]+$/i.test(n)),
  'L2 --font-size-*': [...DEF.keys()].filter((n) => /^--font-size-[a-z0-9]+$/i.test(n)),
  'L0 --fs-*': [...DEF.keys()].filter((n) => /^--fs-[a-z0-9]+$/i.test(n))
};

const broken = [];
const toScale = (groups) => {
  const set = new Set();
  for (const names of Object.values(groups)) {
    for (const n of names) {
      const r = resolve(n);
      if (r.px == null) broken.push(n + '（' + r.err + '；链：' + r.chain.join(' → ') + '）');
      else set.add(r.px);
    }
  }
  return set;
};
const RAD_SET = toScale(RAD_GROUPS);
const FS_SET = toScale(FS_GROUPS);
/* 一个档位名都没找到 ⇒ 文件结构变了、判据看不懂了。这是"未量"，不是"没有越界"。 */
const noNames = (g) => Object.values(g).every((a) => !a.length);
if (noNames(RAD_GROUPS) || noNames(FS_GROUPS)) {
  console.log('FATAL: tokens.css 里找不到档位定义（圆角名 ' + (noNames(RAD_GROUPS) ? '0' : '有')
    + ' / 字号名 ' + (noNames(FS_GROUPS) ? '0' : '有') + ' 个）。找过：--p-radius-* --radius-* --r-* / --p-font-* --font-size-* --fs-*');
  process.exit(3);
}
/* 名字在、但走不到 px（var() 指向不存在的档 / 成环 / 写成非 px）：
   这不是"这一档没有"，是**这一档看不出来**。硬红并点名，不许拿空集接着判。 */
if (broken.length) {
  console.log('FATAL: 档位解析失败 ' + broken.length + ' 个 —— ' + broken.join(' | '));
  process.exit(3);
}
const RAD = new Set([...RAD_SET].map((n) => Math.round(n)));
RAD.add(0); RAD.add(50); RAD.add(999);          /* 0=不收圆角，50=正圆，999=胶囊 */
const FS = new Set(FS_SET);
const fmtScale = (set) => [...set].sort((a, b) => a - b).join(' / ');

const radius = [];
const fsBare = [];
for (const [f, s] of src) {
  for (const m of s.matchAll(/border-radius\s*:\s*([^;]+);/gi)) {
    if (/var\(/.test(m[1])) continue;
    for (const v of m[1].matchAll(/([\d.]+)px/g)) {
      const n = Math.round(parseFloat(v[1]));
      if (!RAD.has(n)) radius.push({ f, v: n });
    }
  }
  for (const m of s.matchAll(/font-size\s*:\s*([^;]+);/gi)) {
    const val = m[1].trim();
    /* 走 token 的通过；inherit / 1em / calc() 这类"相对值"不是就地取值，也通过。 */
    if (/var\(|inherit|initial|unset|revert|calc\(/.test(val)) continue;
    /* ★ 口径收紧（2026-10-23）：原来是"档外的才算裸值"，于是 font-size:14px 合法 ——
       可 14px 是档内值，不是"有出处"的值。规范写的是「页面只许 var()」，
       判据却只查"在不在阶上"，两者差一层，这一层就是那 15 处档内裸值的藏身处。
       现在：**只要写了 px 就是裸值**，不管在不在档上。 */
    for (const v of val.matchAll(/([\d.]+)px/g)) {
      const n = parseFloat(v[1]);
      fsBare.push({ f, v: n, inScale: FS.has(n) });
    }
  }
}

/* ── 5 · 同值多 token（只看非别名的字面值）─────────────────── */
const byVal = new Map();
for (const [n, v] of DEF) {
  if (/var\(/.test(v)) continue;                 /* 别名不算 */
  const k = v.toLowerCase().replace(/\s+/g, '');
  byVal.set(k, (byVal.get(k) || []).concat(n));
}
const sameVal = [...byVal.entries()].filter(([, ns]) => ns.length > 1);

/* ── 输出 ─────────────────────────────────────────────────── */
/* 负控：往一份临时源里塞病历，正反两个方向都必须判对 ——
   反例（未定义 token + 17px 圆角）要被抓到；正例（档内 12px 圆角）不许误报。
   只注入、走同一段判定 —— 不另写"我觉得该红"。 */
if (process.argv.includes('--negctl')) {
  const fake = new Map(src);
  fake.set('__negctl-neg.html', 'a{color:var(--no-such-token);border-radius:17px;}');
  fake.set('__negctl-pos.html', 'b{border-radius:12px;}');
  const miss2 = new Map();
  for (const [f, t] of fake) {
    for (const m of t.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      if (!DEF.has(m[1]) && !crossReg.has(m[1]) && !(localDefs.get(f) || new Set()).has(m[1])) miss2.set(m[1], f);
    }
  }
  const radOf = (t) => {
    const hits = [];
    for (const m of t.matchAll(/border-radius\s*:\s*([^;]+);/gi)) {
      if (/var\(/.test(m[1])) continue;
      for (const v of m[1].matchAll(/([\d.]+)px/g)) if (!RAD.has(Math.round(parseFloat(v[1])))) hits.push(v[1]);
    }
    return hits;
  };
  const radNeg = radOf(fake.get('__negctl-neg.html'));
  const radPos = radOf(fake.get('__negctl-pos.html'));
  const okNeg = miss2.size > 0 && radNeg.length > 0;
  const okPos = radPos.length === 0;
  console.error(okNeg && okPos
    ? '负控成立：注入「未定义 token + 17px 圆角」抓到 ' + miss2.size + ' + ' + radNeg.length + ' 条；正控 12px 圆角未被误报'
    : '负控失败：未定义 token ' + miss2.size + ' 条 / 17px 圆角 ' + radNeg.length + ' 条 / 12px 误报 ' + radPos.length + ' 条 ⇒ 判据失效');
  process.exit(okNeg && okPos ? 2 : 3);
}

let bad = 0;
const P = (ok, msg, detail = '') => {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + msg + (detail ? ' → ' + detail : ''));
};
const layerLine = (g) => Object.entries(g).map(([k, a]) => k + ' ' + a.length).join(' → ');

console.log('\ntoken 审计（' + FILES.length + ' 个文件 / ' + DEF.size + ' 个 token / 档位源 ' + TOKENS_SHOWN + '）\n');
/* 档位集合单独印一行：判据最容易"悄悄失效"的地方就是这里 ——
   它一旦变空，下面两条会双双判绿。所以档位既是读数也是证据。 */
console.log('  · 档位（顺 var() 链解析到 px，三层取并集）');
console.log('      圆角 ' + fmtScale(RAD_SET) + '  ｜ ' + layerLine(RAD_GROUPS));
console.log('      字号 ' + fmtScale(FS_SET) + '  ｜ ' + layerLine(FS_GROUPS));
console.log('      （判定另放行 0 / 50 / 999：0 = 不收圆角，50 = 正圆，999 = 胶囊）\n');
P(missing.size === 0, '1. 没有引用不存在的 token',
  [...missing].map(([n, fs]) => `${n} ← ${[...fs].join(',')}`).join(' | ') || '');
P(crossMissing.length === 0, '1b. 跨文件例外账没有指向已消失的定义',
  crossMissing.join(' | ') || '');
P(crossExpired.length === 0, '1c. 跨文件例外账没有过期条目',
  crossExpired.join(' | ') || '');
console.log('  · 跨文件例外（tools/token-crossfile.tsv）：' + (crossReg.size
  ? [...crossReg].map(([t, f]) => `${t} @ ${f}`).join(' ｜ ')
  : '无'));
P(whiteish.length === 0, '2. 没有"近白文字色"（白底白字）',
  whiteish.map((x) => `${x.f} color:var(${x.tok}) = ${x.hex} L=${x.L}`).join(' | ') || '');
P(radius.length === 0, '3. 圆角没有出档裸值（档位 ' + [...RAD_SET].length + ' 个，见上）',
  radius.map((x) => `${x.f} ${x.v}px`).join(' | ') || '');
P(fsBare.length === 0, '3b. 字号一律走 var(--fs-*)（档位 ' + [...FS_SET].length + ' 个，见上）',
  fsBare.map((x) => `${x.f} ${x.v}px${x.inScale ? '' : '（还是阶外的）'}`).join(' | ') || '');
console.log('  ' + (dead.length ? '·' : '✓') + ' 4. 定义了没人用的 token：' + (dead.length ? dead.join(' / ') : '无'));
console.log('  · 5. 同值多 token：' + (sameVal.length
  ? sameVal.map(([v, ns]) => `${v} = ${ns.join(' + ')}`).join(' ｜ ')
  : '无'));

console.log('');
console.log(`硬性项：${bad ? bad + ' 项不通过' : '全部通过'}（4/5 是信息项，不上闸）`);
process.exit(bad ? 2 : 0);
