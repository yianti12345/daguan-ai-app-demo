#!/usr/bin/env node
/* doc-parity —— **规范文档 vs 代码** 的对账。
 *
 * 为什么要有它（2026-10-22，被设计专家一眼看出来的）：
 *   DESIGN.md 写着"本文件是这套界面的唯一规范源"，而所有判据都以它为输入
 *   （gate-states 从 §4.7 读控件清单、R5 从 §4 读圆角档位）——
 *   **可它自己是唯一一个没有任何工具验过的资产。**
 *   实测当场就漂了 4 处：主按钮色、gap 16/32 自相矛盾、已删除的 --sp-24 还列着、
 *   字号硬规矩与判据的 FS 集合不同源。这四处没有一条判据会红。
 *
 * 做法：不写"文档解析器"（那是无底洞，且解析失败会静默变绿），
 *   而是把**每一处数值声明写成一条显式断言**：文档里必须出现什么、代码里必须等于什么。
 *   加一条声明 = 加一行。判不了就写不了 —— 这比假装能解析全部 markdown 诚实。
 *
 * 用法：node tools/doc-parity.mjs [--negctl]
 * 退出码：0 一致 ｜ 2 有漂移 ｜ 3 环境问题
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DESIGN = read('DESIGN.md');
const TOKENS = read('assets/tokens.css');
const SYS = read('assets/sys.css');

const NEG = process.argv.includes('--negctl');

/* ── 值解析（2026-10-29 修：判据过期，不是文档错）──────────────────
   v2 起 tokens.css 分三层：L1 `--p-*` 存字面值，L2 `--radius-*` 等只写
   `var(--p-*)`，L0 旧名再写 `var(--语义名)`。旧声明的 code 全是
   `--r-ctl:8px` / `--h-ctl:32px` / `--sh-flat:0 1px 2px` / `--ctl-line:#D9D9D9`
   这类 v1 字面写法；v2 里这些旧名还在，但值已变成 var()，所以 5 条 code 全落空。
   现在把两侧 var() 链解析成字面值再比；判的东西没变：
   文档声明的那个令牌与值，代码里必须真的存在且相等。 */
const CSS_DEFS = new Map();
for (const m of TOKENS.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
  if (!CSS_DEFS.has(m[1])) CSS_DEFS.set(m[1], m[2].trim());
}
function resolveCss(v, seen = new Set()) {
  return String(v).replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi, (all, name, fallback) => {
    if (seen.has(name) || !CSS_DEFS.has(name)) return fallback != null ? fallback : all;
    const next = new Set(seen); next.add(name);
    return resolveCss(CSS_DEFS.get(name), next);
  }).trim();
}
const resolved = (name) => (CSS_DEFS.has(name) ? resolveCss(CSS_DEFS.get(name)) : null);
const eq = (a, b) => String(a).replace(/\s+/g, '').toLowerCase() === String(b).replace(/\s+/g, '').toLowerCase();

/* ── 一条声明 = 一条断言 ───────────────────────────────────────────
   doc:  文档里必须出现的片段（用来锁住"文档确实这么写"）
   code: 代码里必须成立的判定（函数，读解析后的值）
   why:  漂了会怎样（写给人看，不是给机器） */
const CLAIMS = [
  {
    name: '主按钮底色',
    doc: '`--brand-btn`/`--brand-link` → `--color-brand`',
    code: () => {
      const a = resolved('--brand-btn'), b = resolved('--brand-link'), c = resolved('--color-brand');
      return a != null && a === b && a === c;
    },
    why: '文档说三个 token 同值同源；代码里一旦有人只改一个，按钮色就和链接色分家',
  },
  {
    name: '卡片栅格 gap',
    doc: '`--space-32` / `--space-page`',
    code: () => eq(resolved('--space-32') || '', '32px') && /\.grid\{[^}]*gap:var\(--space-32\)/.test(SYS),
    why: '§4.3 曾写 gap 16、§5 写 32，同一份文档自相矛盾',
  },
  {
    name: '间距台阶含 24 且 token 已定义',
    doc: '台阶只有六档（4/8/12/16/24/32）',
    code: () => eq(resolved('--space-24') || '', '24px'),
    why: '2026-10-23 更正：--sp-24 曾因「全站零引用」被删，而真源表单行距实测就是 24 —— 它不是没人用，是缺一档。档位与 token 必须同时在场，否则写页面的人会用裸值 24。',
  },
  {
    name: '圆角档位',
    /* ★ 2026-10-29：档位改两层（L2 --radius-* → L1 --p-radius-*），
       旧声明里的 `圆角档位 2/3/4/6/8/12/999` 与 `--r-ctl:8px` 都已不在盘上。
       现在核文档写的合法档在 tokens.css 里逐档有定义（含 6px，它本来就合法）。 */
    doc: '合法档：`0 / 2 / 4 / 6 / 8 / 12 / 20 / 999`',
    code: () => [['--radius-xs', '2px'], ['--radius-tag', '4px'], ['--radius-sm', '6px'],
      ['--radius-control', '8px'], ['--radius-panel', '12px'], ['--radius-overlay', '20px'],
      ['--radius-pill', '999px']].every(([n, v]) => eq(resolved(n) || '', v)),
    why: '圆角是唯一 R5 做过双向对账的项；v2 把 6px 收进 --radius-sm，判据必须认两层',
  },
  {
    name: '控件高度统一走 --size-control-h',
    doc: '图标钮用 `--size-control-h`（32）',
    code: () => eq(resolved('--size-control-h') || '', '32px'),
    why: '按钮/输入框/图标钮三处各写 32px = 三个来源，改一档要改三处、漏一处就错位',
  },
  {
    name: '投影只有三个来源',
    doc: '同一层只有一种投影',
    code: () => /^0 1px 2px /.test(resolved('--shadow-flat') || ''),
    why: '页面里各自写 box-shadow 是"看起来糊"的直接原因；C3 会把 box-shadow 里的 px 报成字面值',
  },
  {
    name: '卡描边不是控件描边',
    doc: '控件描边（与卡描边不是同一个值）',
    code: () => eq(resolved('--color-border-control') || '', '#D9D9D9')
      && eq(resolved('--color-border-card') || '', '#E5E7EB')
      && resolved('--color-border-control') !== resolved('--color-border-card'),
    why: '真源卡片描边 229,231,235、控件 217,217,217，合成一个 token 就会差一档',
  },
  {
    name: '侧栏文字色用 nav token',
    doc: '侧栏当前项（真源第四个蓝',
    code: () => eq(resolved('--color-brand-nav-active') || '', '#517AFF'),
    why: '菜单当前项是线上第四个蓝，合并进 --brand-link 就不再是复刻',
  },
];

const fails = [];
for (const c of CLAIMS) {
  const docOk = DESIGN.includes(c.doc);
  const codeOk = c.code();
  if (!docOk) fails.push(`[文档缺声明] ${c.name}：DESIGN.md 里找不到「${c.doc}」`);
  if (!codeOk) fails.push(`[代码不符] ${c.name}：${c.invert ? '不该出现但出现了' : '代码里没有 / 值不对'} → ${c.why}`);
}

/* ── 文档自称的字号档位 vs 代码实际解析出来的字号档位（不同源就会各偏一半）──
   2026-10-29：v1 的「字号档位：11/12/…」句子已不在 v2；旧解析静默返回 undefined，
   于是"字号同源"这一整块从来没被验过。现在从 §3 的 --font-size-* 行取档，
   与 tokens.css 解析值比；判据侧必须从 --font-size-* 取档（不再是 --fs-*）。 */
const GATE = read('tools/gate-tokens.mjs');
const docFs = new Set([...DESIGN.matchAll(/\|\s*`--font-size-[a-z-]+`\s*\|\s*`([\d.]+)px`/g)].map((m) => +m[1]));
const cssFs = new Set();
for (const name of CSS_DEFS.keys()) {
  if (!/^--(?:p-font|font-size|fs)-[a-z0-9]+$/.test(name)) continue;
  const m = /^([\d.]+)px$/i.exec(resolved(name) || '');
  if (m) cssFs.add(+m[1]);
}
if (!docFs.size) fails.push('[字号不同源] DESIGN.md §3 的 --font-size-* 行一条都没读到');
if (!/--font-size-/.test(GATE)) fails.push('[字号同源] 判据没从 --font-size-* 取档（仍在找旧写法）');
for (const x of docFs) if (!cssFs.has(x)) fails.push(`[字号不同源] 文档允许 ${x}px，tokens.css 解析不出来`);
for (const x of cssFs) if (!docFs.has(x)) fails.push(`[字号不同源] tokens.css 有 ${x}px，文档没写`);

if (NEG) {
  /* 负控：①文档里没有 + 代码里也没有的声明必须判红；
     ②把 --color-brand 毒成 #000000 后，"主按钮底色"必须判红（证明值解析真的在比）。 */
  const bad = { name: '负控样本', doc: '这句声明在 DESIGN 里不存在', code: () => false, why: '负控' };
  const docOk = DESIGN.includes(bad.doc);
  const caughtBad = !docOk || !bad.code();
  const savedBrand = CSS_DEFS.get('--brand-link');
  CSS_DEFS.set('--brand-link', '#000000');
  const caughtPoison = CLAIMS.some((c) => c.name === '主按钮底色' && !c.code());
  CSS_DEFS.set('--brand-link', savedBrand);
  const caught = caughtBad && caughtPoison;
  console.log(caught
    ? '负控成立：不存在的声明被抓到；把 --brand-link 单独改成 #000000 后"主按钮底色"判红'
    : `负控失败：注入后仍判绿 ⇒ 这条判据是假的（bad=${caughtBad} poison=${caughtPoison}）`);
  process.exit(caught ? 2 : 0);
}

if (!fails.length) {
  console.log(`doc-parity：${CLAIMS.length} 条声明 + 字号同源，全部一致`);
  process.exit(0);
}
console.error(`🚫 规范文档与代码漂移 ${fails.length} 条`);
fails.forEach((f) => console.error('  · ' + f));
process.exit(2);
