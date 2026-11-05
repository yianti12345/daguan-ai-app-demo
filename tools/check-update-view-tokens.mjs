#!/usr/bin/env node
/* check-update-view-tokens —— 「已装配行 · 有更新」这一段的令牌闭合与裸值（2026-10-28 立）。
 *
 * 为什么要有它：这一段是这一单唯一新增的样式面（3.9 KB / 29 条规则）。它有三个安静的坏法：
 *   · 裸值：直接写 #fff / 13px —— 过两天改令牌，这一段不跟，屏幕上就多一种白；
 *   · 断引用：var(--xxx) 写了一个 tokens.css 里不存在的名字 —— 浏览器不报错，
 *     整条声明作废，控件掉回默认样式（最典型的"看着像没写样式"）；
 *   · 一次性样式：渲染函数里内联 style="…"，或者拼了一个没有对应规则的 class ——
 *     下一个人复制这段，就会多出第二份真源。
 * 判据按"文件里能读到的事实"判，不靠观感；不做浏览器渲染（那是 check-visual-lint 与
 * check-entry-params 的活），这里只守令牌与契约这一层。
 *
 * 判据（阈值写死，负控档也不改）：
 *   T1 段落在位：app.html 里两个锚点都能定位（定位不到 ⇒ rc=3，不许当绿）
 *   T2 裸 hex = 0（全段；注释里的色值也一并清掉再数）
 *   T3 裸 px = 0（同上）
 *   T4 令牌闭合：段内引用的每个 var(--x) 都在 tokens.css 里有定义（缺失 0）
 *   T5 渲染函数内联样式 = 0：actOf / rowHtml / verPairHtml / updTagHtml 里 style=" 出现 0 次
 *   T6 样式落地：这四个函数拼出来的 class，每个都有对应规则（缺失 0）；
 *      且没有"裸类名单条规则"在两份样式表里各写一遍（跨表冲突 0）
 *   T7 按压位移走令牌：段内 translateY( 的实参只能是 var(--size-press-offset)
 *
 * 用法：node tools/check-update-view-tokens.mjs
 *      node tools/check-update-view-tokens.mjs --negctl  负控：往段内塞一条 13px（只在内存里），
 *                                                      T3 必须抓到；抓不住 rc=3
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：抓住即 2）｜ 3 未量（读不到文件 / 段定位不到 / 负控没抓住）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NEG = process.argv.includes('--negctl');

const HTML = path.join(ROOT, 'app.html');
const JS = path.join(ROOT, 'assets/app.js');
const TOKENS = path.join(ROOT, 'assets/tokens.css');
const SYS = path.join(ROOT, 'assets/sys.css');

const MARK_A = '已装配行的「有更新」视图';
const MARK_B = '抽屉一开，提示条居中会右半边压在抽屉底下';
const FNS = ['actOf', 'rowHtml', 'verPairHtml', 'updTagHtml'];

function read(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

const html = read(HTML), js = read(JS), tok = read(TOKENS), sys = read(SYS);
if (html == null || js == null || tok == null || sys == null) {
  console.log('✗ 未量：读不到 app.html / assets/app.js / assets/tokens.css / assets/sys.css');
  process.exit(3);
}

/* ── 段落定位 ──────────────────────────────────────────────
   ★2026-10-29 修（判据过期）：2026-10-29 页面内联样式搬家，这一段已从 app.html
     的 <style> 迁进 assets/sys.css；判据还只看 app.html ⇒ 定位不到，rc=3。
     现在先在 sys.css 找，找不到再回退 app.html（老布局仍可量）；锚点与判定不变。
     同一锚在 sys.css 出现两次（状态规则段 + 外观规则段），两段都取：
     从每个 MARK_A 到本段结束（下一个 `/* ──` 或 MARK_B），拼起来量。 */
function sectionOf(s) {
  const parts = [];
  let pos = 0;
  while ((pos = s.indexOf(MARK_A, pos)) >= 0) {
    const b = s.indexOf(MARK_B, pos);
    if (b < 0) break;
    const nextSec = s.indexOf('\n/* ──', pos);
    const end = (nextSec > pos && nextSec < b) ? nextSec : b;
    parts.push(s.slice(pos, end));
    pos = b + MARK_B.length;
  }
  return parts.length ? parts.join('\n') : null;
}

const SECTION = sectionOf(sys) || sectionOf(html);
if (!SECTION) {
  console.log('✗ 未量：sys.css / app.html 里定位不到「有更新」样式段（锚点被改名或段落被挪走）');
  process.exit(3);
}

const stripCssComment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const PX = /(?<![\w.-])\d+(?:\.\d+)?px\b/g;
const VAR = /var\(\s*(--[a-z][\w-]*)/g;

function definedTokens(css) {
  const bare = stripCssComment(css);
  const set = new Set();
  for (const m of bare.matchAll(/(--[\w-]+)\s*:/g)) set.add(m[1]);
  return set;
}

/* 函数体：按花括号配对取（不靠缩进，避免"改一行缩进就量不到"） */
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('{', i);
  if (j < 0) return null;
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}

let pass = 0, fail = 0;
function ok(cond, name, reading) {
  if (cond) { pass++; console.log('  ✓ ' + name + (reading ? ' · ' + reading : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (reading ? ' · ' + reading : '')); }
}

/* ── T2/T3/T4：段内裸值 ─────────────────────────────────── */
function scanSection(sec, tokenSet) {
  const clean = stripCssComment(sec);
  const hex = clean.match(HEX) || [];
  const px = clean.match(PX) || [];
  const refs = new Set();
  for (const m of clean.matchAll(VAR)) refs.add(m[1]);
  const missing = [...refs].filter((n) => !tokenSet.has(n));
  return { hex, px, refs: [...refs], missing };
}

let target = SECTION;
if (NEG) {
  /* 负控：在段首的规则里塞一条裸 px（只在内存字符串里，不落盘） */
  target = SECTION.replace('{', '{padding:13px;', 1);
  if (target === SECTION) {
    console.log('✗ 未量：负控注入失败（段内找不到可插入的规则体）');
    process.exit(3);
  }
}

const tokenSet = definedTokens(tok);
const sc = scanSection(target, tokenSet);

ok(sc.hex.length === 0, 'T2 裸 hex = 0', sc.hex.length ? sc.hex.join(' ') : '0 处');
ok(sc.px.length === 0, 'T3 裸 px = 0', sc.px.length ? sc.px.join(' ') : '0 处');
ok(sc.missing.length === 0, 'T4 段内 var() 全部在 tokens.css 有定义',
  '引用 ' + sc.refs.length + ' 个 · 缺失 ' + sc.missing.length + (sc.missing.length ? ' → ' + sc.missing.join(' ') : ''));

/* ── T5/T6：渲染函数 ────────────────────────────────────── */
const bodies = {};
for (const n of FNS) {
  bodies[n] = fnBody(js, n);
  if (bodies[n] == null) {
    console.log('✗ 未量：app.js 里找不到函数 ' + n + '（被改名 ⇒ 这一段没有判据覆盖）');
    process.exit(3);
  }
}

const inline = FNS.map((n) => ({ n, c: (bodies[n].match(/style="/g) || []).length }))
  .filter((x) => x.c > 0);
ok(inline.length === 0, 'T5 渲染函数内联 style=" = 0',
  inline.length ? inline.map((x) => x.n + ':' + x.c).join(' ') : '四函数 0 处');

/* 拼出来的 class：逐个查有没有落地规则（两份样式表都算），
   以及"裸类名单条规则"是否在两份表里各写一遍（跨表冲突）。 */
const classes = new Set();
for (const n of FNS) {
  for (const m of bodies[n].matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (!c || c.indexOf("'") >= 0 || c.indexOf('+') >= 0) continue;
      classes.add(c);
    }
  }
}
const bareRule = (src, c) => {
  const re = new RegExp('(^|[},])\\s*\\.' + c.replace(/-/g, '\\-') + '\\s*[{,:]', 'm');
  return re.test(stripCssComment(src));
};
const anyRule = (src, c) => new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(stripCssComment(src));
const missingCls = [];
const clash = [];
for (const c of classes) {
  if (!anyRule(html, c) && !anyRule(sys, c)) missingCls.push(c);
  if (bareRule(html, c) && bareRule(sys, c)) clash.push(c);
}
ok(missingCls.length === 0, 'T6 渲染函数用到的 class 都有落地规则',
  '共 ' + classes.size + ' 个 · 缺规则 ' + missingCls.length + (missingCls.length ? ' → ' + missingCls.join(' ') : ''));
ok(clash.length === 0, 'T6′ 没有裸类名单条规则在两份样式表里各写一遍',
  clash.length ? '冲突 ' + clash.join(' ') : '0 个');

/* ── T7：按压位移走令牌 ───────────────────────────────────
   translateY(var(--x)) 里有一层内层括号：只写 [^)]* 会在 var( 的那个 ) 处截断，
   量到 `var(--size-press-offset` 再把正确写法判红 —— 判据自己先错了一次（2026-10-28 实测）。 */
const shifts = [...stripCssComment(target).matchAll(/translateY\((var\([^)]*\)|[^)]*)\)/g)]
  .map((m) => m[1].trim());
const badShifts = shifts.filter((v) => v !== 'var(--size-press-offset)');
ok(badShifts.length === 0, 'T7 按压位移只用 var(--size-press-offset)',
  shifts.length + ' 处 · 越界 ' + badShifts.length + (badShifts.length ? ' → ' + badShifts.join(' ') : ''));

console.log('');
console.log('通过 ' + pass + ' ｜ 断点 ' + fail);
if (NEG) {
  if (fail > 0) { console.log('负控成立：塞进 13px 后 T3 判红 ⇒ 裸 px 真的会被抓到'); process.exit(2); }
  console.log('✗ 未量：负控没被抓住 —— 段内塞了裸 px 也不红，判据坏了');
  process.exit(3);
}
if (fail) { console.log('FAIL：' + fail + ' 条'); process.exit(2); }
console.log('PASS：裸 hex/裸 px 0 · 令牌闭合 · 无内联样式 · class 全落地 · 位移走令牌');
process.exit(0);
