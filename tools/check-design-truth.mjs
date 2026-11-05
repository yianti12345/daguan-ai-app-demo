/* check-design-truth.mjs —— 规范与实现不许各说各话（第 40 门）
 *
 * 起因（2026-10-25 实测）：DESIGN.md 的令牌表写着
 *   | 辅助 | rgba(0,0,0,.45) | --ink-3 | 面包屑首项、元信息 | 4.6 |
 * 而同一份交付里的 tokens.css 是 .45、实测压白 3.35:1、压侧栏底 3.30:1。
 * 表和实现两边都"有据"，可表里那个 4.6 从来没对过 —— 差的是**没有一个判据去对账**。
 * 更早的 --card-ds 也一样：表里还印着线上原值 #6C7DA9（4.3:1），
 * tokens.css 早就加深到 #5B6C98（5.19:1），表没跟上。
 *
 * 判什么：
 *   1. DESIGN.md 令牌表里点名的每个 `--token`，必须在 tokens.css 里存在；
 *   2. 表里的取值必须与 tokens.css 字面一致（忽略空格与大小写）；
 *   3. 表里写了对比度数字的行（没有 ⚠ 标记的），该数字必须与**按 tokens.css 现值重算**的结果
 *      差不超过 0.15 —— 白底口径。带 ⚠ 的行（已知欠账）跳过这一条，但仍要对上取值。
 * rc：0 通过；2 有违规；3 未量（两个文件缺一个）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DESIGN = join(ROOT, 'DESIGN.md');
const CSS = join(ROOT, 'assets', 'tokens.css');

if (!existsSync(DESIGN) || !existsSync(CSS)) {
  console.log('SKIP: 缺 DESIGN.md 或 assets/tokens.css —— 未量');
  process.exit(3);
}

const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();

/* ── 实现侧：从 tokens.css 取 `--x:value;` ── */
const css = readFileSync(CSS, 'utf8');
const impl = new Map();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
  const name = m[1].trim();
  if (!impl.has(name)) impl.set(name, m[2].trim());   // 同名只在第一次出现处定义（:root）
}

/* ── 颜色与对比度（白底） ── */
function parseColor(v) {
  const s = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
function contrastOnWhite(v) {
  const c = parseColor(v);
  if (!c) return null;
  const fg = { r: c.r * c.a + 255 * (1 - c.a), g: c.g * c.a + 255 * (1 - c.a), b: c.b * c.a + 255 * (1 - c.a) };
  const x = lum(fg), y = 1;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ── 规范侧：DESIGN.md 的表格行 ── */
/* 负控：把实现侧的一个值偷偷改回旧值（.45），表和实现就该对不上。
   负控必须红——否则"全绿"只是这条判据不工作。（2026-10-25 实测：本判据首次跑就抓到 13 处真漂移，
   但那是"修之前"的事，修完之后必须靠负控证明它还在看。） */
if (process.argv.includes('--negctl')) {
  /* 2026-10-29 修：v1 的 --ink-3 / --warn 已不在 v2 表里，改坏它们抓不到任何一行。
     现在改坏**表里真的在用的 L2 名**：--color-text-tertiary（值 + 白底对比度都被核）
     与 --color-success-surface（值被核）。 */
  impl.set('--color-text-tertiary', 'rgba(0,0,0,.30)');
  impl.set('--color-success-surface', '#000000');
  console.log('  [负控] 把 --color-text-tertiary 改成 .30、--color-success-surface 改成 #000000，应当判红');
}

/* ── 值解析：L1/L2/L3/L0 是三层令牌，L2 存 var(--p-*)，表里印的是解析值 ──
   2026-10-29 修（判据过期，非文档值错）：
   v1 的表是 `| 用途 | 值 | 令牌 |`，v2 是 `| 令牌 | 值 | … |`（DESIGN.md 头部与 §0 已写明）。
   旧代码按固定列位取 cells[2]/cells[3]，在 v2 上把"上一行的值"配给"本行的说明"，
   4 条不符全是取列错配（--color-brand 被配上 --color-text-inverse 的 #FFFFFF）。
   现在按表头取列（令牌＝令牌列，值＝紧随其后一列），并把两侧 var() 链解析成字面值再比。
   判的东西没变：表里点名的令牌必须存在，值必须与 tokens.css 的解析值一致。 */
function resolveValue(v, seen = new Set()) {
  return String(v).replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi, (all, name, fallback) => {
    if (seen.has(name) || !impl.has(name)) return fallback != null ? fallback : all;
    const next = new Set(seen); next.add(name);
    return resolveValue(impl.get(name), next);
  }).trim();
}
function sameValue(a, b) {
  if (norm(a) === norm(b)) return true;
  const ca = parseColor(a), cb = parseColor(b);
  if (ca && cb) {
    return Math.abs(ca.r - cb.r) < 0.5 && Math.abs(ca.g - cb.g) < 0.5
      && Math.abs(ca.b - cb.b) < 0.5 && Math.abs(ca.a - cb.a) < 0.005;
  }
  return false;
}

const lines = readFileSync(DESIGN, 'utf8').split('\n');
let fail = 0, checked = 0, contrastChecked = 0;
const problems = [];
const out = (ok, label, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`); if (!ok) fail++; };

/* 表头驱动的列义：遇到 `| 令牌 | 值 | … |` 就记下本表的列号，遇到非表格行清空。
   比值列只认表头名（白底 / 压白 / 实测），不按列位——§1.2 的最后一列是 src，不是比值。 */
let cols = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim().startsWith('|')) { cols = null; continue; }
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 4) continue;
  const tokIdx = cells.indexOf('令牌');
  const valIdx = tokIdx >= 0 ? cells.indexOf('值', tokIdx + 1) : -1;
  if (tokIdx >= 0 && valIdx > tokIdx) {
    const whiteIdx = cells.findIndex((c) => c === '白底' || c.startsWith('压白'));
    const measureIdx = cells.findIndex((c) => c === '实测');
    cols = { tok: tokIdx, val: valIdx, ratio: whiteIdx >= 0 ? whiteIdx : (measureIdx >= 0 ? measureIdx : -1) };
    continue;
  }
  if (!cols) continue;
  const tokCell = cells[cols.tok] || '';
  const valCell = cells[cols.val] || '';
  const ratioCell = cols.ratio >= 0 ? (cells[cols.ratio] || '') : '';
  const tokens = [...tokCell.matchAll(/`(--[a-z0-9-]+)`/gi)].map((m) => m[1]);
  const vals = [...valCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (!tokens.length || !vals.length) continue;
  const declared = vals[0];
  /* 取值格本身是个 token 引用（组件规格表爱这么写：「色值取 --brand-btn」）——不是字面值，不核 */
  if (declared.startsWith('--')) continue;
  if (declared.includes('→') || declared.includes('var(')) continue;   // 渐变 / 引用不算单一取值
  /* 值格里偶尔用反引号点一个**说明词**（如 --gradient-card-glow 的 `color-mix`），
     它不是本行的值。只认长得像值的首段；否则跳过，别拿说明词当值去比。 */
  const valueLike = /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|linear-gradient|radial-gradient|conic-gradient|cubic-bezier|calc\(|var\(|"|[-\d.]+(?:\s|$))/i.test(declared);
  if (!valueLike) continue;
  /* 只认**单元格里第一个**被反引号包住的 token：`--sider-bg`（不再走 `--surface` 别名）
     这种句子里第二个 token 只是叙述，不是本行声明的那个 */
  const tok = tokens[0];
  const lineNo = i + 1;

  for (const t of [tok]) {
    /* 单元格里第一个反引号内容不是 token 时（比如文档在讲 `--negctl` 这种命令行开关）：
       它不在 tokens.css 里、形态也不是 `--x-y`，跳过；真部 token 缺失仍然会报。 */
    if (!impl.has(t) && !/^--[a-z]+-[a-z0-9-]+$/.test(t)) continue;
    checked++;
    if (!impl.has(t)) { problems.push(`DESIGN.md:${lineNo} ${t} 在 tokens.css 里不存在`); continue; }
    const real = resolveValue(impl.get(t));
    if (!sameValue(real, declared)) {
      problems.push(`DESIGN.md:${lineNo} ${t} 表里写 ${declared}，tokens.css 解析为 ${real}（原始 ${impl.get(t)}）`);
    }
  }

  /* 对比度：只查「白底口径」的行。表头写的是"白底"，
     但有几行自己标了「压 --ok-bg」「压 --warn-bg」——那是另一块底，按白底算必然对不上，
     所以带「压 」的行跳过（不是放水：它的背景色在 tokens 里，真要核得连底一起算）。 */
  if (cols.ratio < 0) continue;
  /* 渐变底 / 跨色行（值里有 → 或写「压渐变」）不按白底算：
     这类行的比值格常夹带字号（「角标 12/600 属小字」），按列位取会把 12 当成对比度。
     这是取法错误，不是放宽——它本来就不在白底口径里。 */
  if (/→|gradient|压渐变/i.test(valCell) || /压渐变/.test(ratioCell)) continue;
  const bgNote = /压\s*`?-{2}/.test(ratioCell) || /压\s*`?-{2}/.test(line);
  if (!/⚠/.test(line) && !bgNote) {
    const m = /(\d+(?:\.\d+)?)\s*(?:（|\(|$|\s)/.exec(ratioCell.replace(/[^\d.（）()\s]/g, ' ').trim());
    const claimed = m ? parseFloat(m[1]) : null;
    if (claimed != null && claimed >= 1 && claimed <= 21) {
      const calc = contrastOnWhite(resolveValue(impl.get(tok) || declared));
      if (calc != null) {
        contrastChecked++;
        if (Math.abs(calc - claimed) > 0.15) {
          problems.push(`DESIGN.md:${lineNo} ${tok} 对比度表里写 ${claimed}，按现值算 ${calc.toFixed(2)}`);
        }
      }
    }
  }
}

out(checked > 0, 'DESIGN.md 令牌表可解析', checked ? `核了 ${checked} 个令牌` : '一个令牌行都没读到（表格式变了？）');
out(!problems.length, '规范值与实现值一致',
  problems.length ? `${problems.length} 处对不上` : `全部一致（其中 ${contrastChecked} 行也核了对比度）`);
for (const p of problems.slice(0, 12)) console.log('     ✗ ' + p);
if (problems.length > 12) console.log(`     … 其余 ${problems.length - 12} 处`);

console.log('');
console.log(`通过 ${fail ? 0 : 1} ｜ 断点 ${fail}`);
process.exit(fail ? 2 : 0);
