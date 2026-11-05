#!/usr/bin/env node
/* check-tokens.mjs —— 令牌裸值扫描器（v1.1：只报不拦 + 预算档）
 *
 * 扫两面：
 *   ① assets/sys.css
 *   ② 5 个页面的 <style> 块（app / apps / component / components / versions）
 *
 * 报四类（本轮只报、不拦）：
 *   color-hex      字面 #rgb / #rrggbb / #rrggbbaa
 *   color-rgb      字面 rgb( / rgba( / hsl(
 *   px-spacing     间距类属性上的非令牌 px（margin/padding/gap/inset/定位）
 *   px-font        字号/行高/字距上的非令牌 px
 *   px-radius      圆角上的非令牌 px
 * 另报三类 info（不在本轮判据内，给后续接门禁用）：
 *   px-size / px-shadow / px-border / naked-token-def（页面里自己定义令牌且值带字面量）
 *
 * 用法：
 *   node tools/check-tokens.mjs                 # 人类可读汇总 + 清单（默认每类最多 60 行）
 *   node tools/check-tokens.mjs --all           # 打印全部明细
 *   node tools/check-tokens.mjs --json          # 结构化输出（给门禁接）
 *   node tools/check-tokens.mjs --strict        # 有任何违规 → rc=1（存量 184 条，会把闸变常红）
 *   node tools/check-tokens.mjs --max=184       # 预算档：违规数 > 184 才 rc=1（门禁用这个）
 *   node tools/check-tokens.mjs --negctl        # 预算档自检：临时目录注入一条裸值，必须 184→185 判红（rc=2）
 *   node tools/check-tokens.mjs --self          # 额外核 tokens.css：L2/L3/L0 不许有字面量
 *
 * ★2026-10-29（gatecover）：本脚本此前既不在 run-gates.sh、也不在 not-gated.tsv。
 *   为什么不直接 --strict 接闸：存量 184 条裸值，常红会被无视（永久红＝没有出口）。
 *   接的是 --max=184 的 ratchet：只在新增长时红；债降下来后由机制席同步下调预算，
 *   不许上调。已知边界：它按**条数**判，一次"修一条 + 新增一条"计数不变，抓不到；
 *   逐条签名基线（file:line:prop）会因行号漂移产生假红，留到令牌迁移轮再做。
 *
 * 退出码：0 = 扫描完成（默认，无论多少违规）；1 = --strict 有违规 或 --max 超预算；
 *         3 = 扫描面读不到 / --max 参数不合法。
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, appendFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => args.includes('--' + n);
const argOf = (n, d) => {
  const hit = args.find((a) => a.startsWith('--' + n + '='));
  if (hit) return hit.split('=').slice(1).join('=');
  const i = args.indexOf('--' + n);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const ROOT = resolve(argOf('root', resolve(HERE, '..')));
const SHOW_ALL = opt('all');
const JSON_OUT = opt('json');
const STRICT = opt('strict');
const SELF = opt('self');
/* --max：预算档（门禁用）。只有"超过预算"才红，存量债不制造永久红。
   ★只许下调：债降下来后由机制席改小；把数字往上调＝放宽，必须在 amendments.tsv 留记录。 */
const maxRaw = argOf('max', '');
if (maxRaw !== '' && !/^\d+$/.test(maxRaw)) {
  console.error('用法错：--max 要一个非负整数（实际：' + maxRaw + '）');
  process.exit(3);
}
const MAX = maxRaw === '' ? null : Number(maxRaw);

const PAGES = ['app.html', 'apps.html', 'component.html', 'components.html', 'versions.html'];
const SYS = 'assets/sys.css';
const TOK = 'assets/tokens.css';

/* ── 属性分类 ───────────────────────────────────────────────── */
const SPACING = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^gap$|^(row|column|grid)-gap$|^(top|right|bottom|left)$|^inset(-(inline|block)(-(start|end))?)?$/;
const FONT = /^font-size$|^line-height$|^letter-spacing$|^font$/;
const RADIUS = /^border(-(top|bottom)-(left|right))?-radius$/;
const SHADOW = /^box-shadow$|^text-shadow$/;
const BORDER = /^border(-(top|right|bottom|left))?(-width|-(top|right|bottom|left)-width)?$|^outline(-width)?$|^outline-offset$/;
const SIZE = /^(width|height|min-width|min-height|max-width|max-height|flex-basis)$/;

/* ── 注释抹成空格（保留换行与偏移，行号才对得上）──────────────── */
function maskComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/* ── HTML：只留 <style> 块，其余抹空格（偏移不变）──────────────── */
function maskToStyles(html) {
  let out = html.replace(/[^\n]/g, ' ');
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].indexOf('>') + 1;
    const body = m[1];
    const bodyMasked = maskComments(body);
    out = out.slice(0, start) + bodyMasked + out.slice(start + body.length);
  }
  return out;
}

/* ── 行号表 ──────────────────────────────────────────────────── */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

const DECL = /(?:^|[;{}])\s*(--[A-Za-z][A-Za-z0-9-]*|[A-Za-z][A-Za-z0-9-]*)\s*:\s*([^;{}]*)/g;
const PX = /(-?\d*\.?\d+)px\b/g;

function scan(text, file) {
  const lineOf = lineIndex(text);
  const rows = [];
  let m;
  DECL.lastIndex = 0;
  while ((m = DECL.exec(text))) {
    const prop = m[1];
    const value = m[2].trim();
    if (!value) continue;
    const at = lineOf(m.index);
    const push = (cat, v) => rows.push({ file, line: at, prop, value, cat, hit: v });

    const hasHex = /#[0-9a-fA-F]{3,8}\b/.test(value);
    const hasFn = /\b(rgb|rgba|hsl|hsla)\(/i.test(value);
    const pxs = [...value.matchAll(PX)].map((x) => x[0]).filter((x) => !/^-?0(px)?$/.test(x));

    if (prop.startsWith('--')) {
      if (hasHex || hasFn || pxs.length) push('naked-token-def', (pxs[0] || (hasHex ? 'hex' : 'rgb')));
      continue;
    }
    if (hasHex) push('color-hex', 'hex');
    if (hasFn) push('color-rgb', 'rgb');
    for (const v of pxs) {
      if (SPACING.test(prop)) push('px-spacing', v);
      else if (FONT.test(prop)) push('px-font', v);
      else if (RADIUS.test(prop)) push('px-radius', v);
      else if (SHADOW.test(prop)) push('px-shadow', v);
      else if (BORDER.test(prop)) push('px-border', v);
      else if (SIZE.test(prop)) push('px-size', v);
      else push('px-other', v);
    }
  }
  return rows;
}

/* ── 扫面 ───────────────────────────────────────────────────── */
const files = [SYS, ...PAGES].filter((f) => existsSync(resolve(ROOT, f)));
const missing = [SYS, ...PAGES].filter((f) => !existsSync(resolve(ROOT, f)));
if (!files.length) {
  console.error('check-tokens: 扫描面一个都读不到（root=' + ROOT + '）');
  process.exit(3);
}
let rows = [];
const scanned = [];
for (const f of files) {
  const raw = readFileSync(resolve(ROOT, f), 'utf8');
  const masked = f.endsWith('.css') ? maskComments(raw) : maskToStyles(raw);
  scanned.push({ file: f, lines: raw.split('\n').length, bytes: Buffer.byteLength(raw) });
  rows = rows.concat(scan(masked, f));
}

/* ── --self：tokens.css 三层纯度 ─────────────────────────────── */
let self = null;
if (SELF) {
  const p = resolve(ROOT, TOK);
  if (!existsSync(p)) {
    self = { ok: false, why: 'tokens.css 读不到' };
  } else {
    const rawTok = readFileSync(p, 'utf8');
    const cut = (from, to) => {
      const a = rawTok.indexOf(from);           /* 先按原串找标记（标记在注释里，抹注释后就没法找了） */
      if (a < 0) return '';
      const b = to ? rawTok.indexOf(to, a + from.length) : rawTok.length;
      return maskComments(rawTok.slice(a, b < 0 ? rawTok.length : b));
    };
    const L1 = cut('L1 · primitive', 'L2 · semantic');
    const L2 = cut('L2 · semantic', 'L3 · component');
    const L3 = cut('L3 · component', 'L0 · 兼容层');
    const L0 = cut('L0 · 兼容层', null);
    const t = maskComments(rawTok);
    const raw = (s) => (/#[0-9a-fA-F]{3,8}\b/.test(s.replace(/--p-[a-z0-9-]+:[^;]+;/g, '')) || /\b(rgb|rgba|hsl|hsla)\(/i.test(s.replace(/--p-[a-z0-9-]+:[^;]+;/g, '')))
      ? (s.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/gi) || []).length : 0;
    self = {
      ok: true,
      L1_literals: (L1.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/gi) || []).length,
      L2_literals: raw(L2), L3_literals: raw(L3), L0_literals: raw(L0),
      vars: new Set(t.match(/--[a-z0-9-]+\s*:/gi) || []).size
    };
    self.pure = self.L2_literals === 0 && self.L3_literals === 0 && self.L0_literals === 0;
  }
}

/* ── 汇总 ───────────────────────────────────────────────────── */
const CATS = ['color-hex', 'color-rgb', 'px-spacing', 'px-font', 'px-radius', 'naked-token-def', 'px-shadow', 'px-border', 'px-size', 'px-other'];
const JUDGED = new Set(['color-hex', 'color-rgb', 'px-spacing', 'px-font', 'px-radius']);
const count = (c, pred) => rows.filter((r) => r.cat === c && (!pred || pred(r))).length;
const byFile = {};
for (const r of rows) {
  byFile[r.file] = byFile[r.file] || { total: 0, judged: 0 };
  byFile[r.file].total++;
  if (JUDGED.has(r.cat)) byFile[r.file].judged++;
}
const spacingHits = rows.filter((r) => r.cat === 'px-spacing');
const spacings = {};
for (const r of spacingHits) spacings[r.hit] = (spacings[r.hit] || 0) + 1;
const TOKEN_STEPS = [4, 8, 12, 16, 24, 32];
const onGrid = spacingHits.filter((r) => TOKEN_STEPS.includes(parseFloat(r.hit))).length;
const judgedTotal = rows.filter((r) => JUDGED.has(r.cat)).length;
const overBudget = MAX !== null && judgedTotal > MAX;
const FAIL = (STRICT && judgedTotal > 0) || overBudget;
const SELF_FILE = fileURLToPath(import.meta.url);

/* ── 负控（2026-10-29 接闸时补）：证明"新增一条裸值 → 超预算 → 判红"是真的 ──
 * 做法：把扫描面复制到 /tmp，往里加一条裸色值，再用两个预算跑自己：
 *   预算 = 现值     ⇒ 必须 rc=1（185 > 184）
 *   预算 = 现值 + 1 ⇒ 必须 rc=0（185 不大于 185）
 * 真身一个字节不动；只证明计数与预算的比较，不证明每一类扫描器（那由 --strict 的 184 条读数负责）。 */
if (process.argv.includes('--negctl')) {
  const tmp = mkdtempSync(join(tmpdir(), 'ct-neg-'));
  let rOver, rOk;
  try {
    mkdirSync(join(tmp, 'assets'), { recursive: true });
    for (const f of [...PAGES, SYS, TOK]) cpSync(join(ROOT, f), join(tmp, f));
    appendFileSync(join(tmp, SYS), '\n.ct-negctl{color:#123456;}\n');
    const run = (budget) => spawnSync(process.execPath, [SELF_FILE, '--root=' + tmp, '--max=' + budget], { encoding: 'utf8' });
    rOver = run(judgedTotal);
    rOk = run(judgedTotal + 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const ok = rOver.status === 1 && rOk.status === 0;
  console.log(ok
    ? `负控成立：注入一条裸色值后 ${judgedTotal}→${judgedTotal + 1}；预算 ${judgedTotal} 判红 / 预算 ${judgedTotal + 1} 判绿`
    : `负控失败：预算 ${judgedTotal} rc=${rOver.status}（应 1）｜预算 ${judgedTotal + 1} rc=${rOk.status}（应 0）⇒ 预算档失效`);
  process.exit(ok ? 2 : 3);
}

const summary = {
  root: ROOT,
  scanned,
  missing,
  counts: Object.fromEntries(CATS.map((c) => [c, count(c)])),
  judgedTotal,
  spacing: {
    total: spacingHits.length,
    equalsExistingToken: onGrid,
    equalsExistingTokenPct: spacingHits.length ? +(onGrid * 100 / spacingHits.length).toFixed(1) : 0,
    values: Object.fromEntries(Object.entries(spacings).sort((a, b) => b[1] - a[1])),
  },
  byFile,
  self,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
  process.exit(FAIL ? 1 : 0);
}

/* ── 人类可读 ───────────────────────────────────────────────── */
const L = (s = '') => console.log(s);
L('check-tokens v1.1 · 只报不拦（默认 rc=0；--strict / --max 预算档才把违规变 rc=1）');
L('根：' + ROOT);
L('扫描面：' + scanned.map((s) => `${s.file}(${s.lines} 行)`).join(' + '));
if (missing.length) L('⚠ 缺文件（未量）：' + missing.join(' · '));
L('');
L('—— 汇总 ——');
L(`字面色值  hex ${summary.counts['color-hex']} ｜ rgb/hsl ${summary.counts['color-rgb']}`);
L(`非令牌 px  间距 ${summary.counts['px-spacing']} ｜ 字号/行高 ${summary.counts['px-font']} ｜ 圆角 ${summary.counts['px-radius']}`);
L(`判据内合计（上面五项）${judgedTotal}`);
L(`info 项   页面自定义令牌带字面量 ${summary.counts['naked-token-def']} ｜ 阴影 ${summary.counts['px-shadow']} ｜ 边框 ${summary.counts['px-border']} ｜ 尺寸 ${summary.counts['px-size']} ｜ 其他 ${summary.counts['px-other']}`);
L('');
L('—— 间距 px：有多少本来就等于台阶值 ——');
L(`间距 px 共 ${summary.spacing.total} 处；其中正好等于 --sp-4/8/12/16/24/32 的 ${summary.spacing.equalsExistingToken} 处（${summary.spacing.equalsExistingTokenPct}%）`);
const top = Object.entries(summary.spacing.values).slice(0, 8);
if (top.length) L('取值分布（前 8）：' + top.map(([v, n]) => `${v}×${n}`).join('  '));
L('');
L('—— 按文件 ——');
for (const [f, v] of Object.entries(byFile)) L(`${f.padEnd(18)} 判据内 ${String(v.judged).padStart(3)} ｜ 全量 ${String(v.total).padStart(3)}`);
if (self) {
  L('');
  L('—— tokens.css 三层纯度（--self）——');
  if (!self.ok) L('未量：' + self.why);
  else L(`变量 ${self.vars} 个｜L1 字面量 ${self.L1_literals}｜L2 ${self.L2_literals}｜L3 ${self.L3_literals}｜L0 ${self.L0_literals} ⇒ ${self.pure ? 'L2/L3/L0 零字面量（只有 L1 许写值）' : '有字面量漏在 L2/L3/L0'}`);
}

const LIMIT = SHOW_ALL ? Infinity : 60;
L('');
L('—— 清单（判据内五项；' + (SHOW_ALL ? '全量' : `每类最多 ${LIMIT} 行，--all 看全部`) + '）——');
for (const c of ['color-hex', 'color-rgb', 'px-spacing', 'px-font', 'px-radius']) {
  const list = rows.filter((r) => r.cat === c);
  if (!list.length) continue;
  L(`[${c}] ${list.length} 处`);
  for (const r of list.slice(0, LIMIT)) {
    L(`  ${r.file}:${r.line}  ${r.prop}: ${r.value.length > 88 ? r.value.slice(0, 88) + '…' : r.value}`);
  }
  if (list.length > LIMIT) L(`  … 另有 ${list.length - LIMIT} 处未打印（--all）`);
}
for (const c of ['naked-token-def', 'px-shadow', 'px-border', 'px-size']) {
  const list = rows.filter((r) => r.cat === c);
  if (!list.length) continue;
  L(`[info ${c}] ${list.length} 处（不计入判据内合计）`);
  for (const r of list.slice(0, SHOW_ALL ? Infinity : 5)) {
    L(`  ${r.file}:${r.line}  ${r.prop}: ${r.value.length > 88 ? r.value.slice(0, 88) + '…' : r.value}`);
  }
}

L('');
L(`结论：判据内违规 ${judgedTotal} 处${MAX !== null ? `；预算 ${MAX} 处` : ''}；rc=${FAIL ? 1 : 0}${overBudget ? '（超预算）' : ''}`);
process.exit(FAIL ? 1 : 0);
