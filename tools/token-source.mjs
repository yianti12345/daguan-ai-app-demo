#!/usr/bin/env node
/* token-source.mjs —— 令牌源台账 + 漂移判据（DTCG 子集）
 *
 * 为什么有这一条：tokens.css 过去是唯一真源，但只有"值"，没有机器可读的源台账；
 * 一个令牌是新增、改名还是被悄悄改值，只能靠人看 diff。本脚本把 tokens.css 的
 * 四层（primitive / semantic / component / compat）抽取成 tokens.dtcg.json，
 * 之后每次改令牌都必须同步台账，否则快速档判红。
 *
 * 用法：
 *   node tools/token-source.mjs --extract   从 tokens.css 抽取/覆盖源台账
 *   node tools/token-source.mjs --build     从模板 + 台账重新生成 tokens.css
 *   node tools/token-source.mjs --check     比对 tokens.css 与源台账 + 模板渲染（默认）
 *   node tools/token-source.mjs --negctl    负控：临时改一个值，必须判红
 * 退出码：0 一致 ｜ 1 漂移 ｜ 2 负控命中 ｜ 3 读不到
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.TOKEN_ROOT || resolve(HERE, '..'));
const CSS = join(ROOT, 'assets/tokens.css');
const SRC = join(ROOT, 'tools/tokens.dtcg.json');
const TPL = join(ROOT, 'tools/tokens.template.css');
const GROUPS = [
  ['primitive', 'L1 原始值：只为语义层提供原料，组件不许直接引用。'],
  ['semantic', 'L2 语义名：组件只许引用这一层。'],
  ['component', 'L3 组件级：语义层表达不了时才加，每条写明服务对象。'],
  ['compat', 'L0 兼容层：2026-10-28 之前的旧名，迁移完成前不删。'],
];

function parse(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...body.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)];
  if (blocks.length !== 4) throw new Error('tokens.css 的 :root 块数应为 4，实际 ' + blocks.length);
  const out = {};
  blocks.forEach((m, i) => {
    const [name] = GROUPS[i];
    const tokens = {};
    for (const d of m[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const key = '--' + d[1];
      const val = d[2].replace(/\s+/g, ' ').trim();
      if (tokens[key] && tokens[key] !== val) throw new Error(name + ' 内重复定义且取值不同：' + key);
      tokens[key] = val;
    }
    out[name] = tokens;
  });
  return out;
}

function loadSrc() {
  const j = JSON.parse(readFileSync(SRC, 'utf8'));
  const out = {};
  for (const [name] of GROUPS) out[name] = unwrap(j[name]?.$tokens || {});
  return out;
}
function unwrap(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' && '$value' in v ? v.$value : v]));
}

function render(tpl, src) {
  const flat = {};
  for (const [name] of GROUPS) Object.assign(flat, src[name] || {});
  return tpl.replace(/\{\{(--[a-z0-9-]+)\}\}/g, (m, k) => {
    if (!(k in flat)) throw new Error('模板引用了台账里没有的令牌：' + k);
    return flat[k];
  });
}
function renderDiff(tpl, src, css) {
  try {
    return render(tpl, src) === css ? null : '模板渲染与 tokens.css 不一致（模板 + 台账 → CSS 应逐字节相等）';
  } catch (e) { return '模板渲染失败：' + e.message; }
}

function compare(a, b) {
  const diff = [];
  for (const [name] of GROUPS) {
    const A = a[name] || {}, B = b[name] || {};
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (!(k in A)) diff.push(name + ' 台账多出：' + k);
      else if (!(k in B)) diff.push(name + ' 台账缺失：' + k);
      else if (A[k] !== B[k]) diff.push(name + ' 取值不一致：' + k + ' css=' + A[k] + ' 台账=' + B[k]);
    }
  }
  return diff;
}

const args = process.argv.slice(2);
if (args.includes('--extract')) {
  const cssTokens = parse(readFileSync(CSS, 'utf8'));
  const doc = {
    '$schema': 'https://tr.designtokens.org/format/',
    '$description': '达观智能审核平台令牌源台账（DTCG 子集）。由 tools/token-source.mjs --extract 从 assets/tokens.css 抽取；改令牌必须同步本文件。',
  };
  for (const [name, desc] of GROUPS) {
    doc[name] = { '$description': desc, '$tokens': Object.fromEntries(Object.entries(cssTokens[name]).map(([k, v]) => [k, { '$value': v }])) };
  }
  writeFileSync(SRC, JSON.stringify(doc, null, 2) + '\n');
  const total = GROUPS.reduce((n, [g]) => n + Object.keys(cssTokens[g]).length, 0);
  console.log('✓ 已抽取令牌台账 ' + SRC + '（' + total + ' 条，四层）');
  process.exit(0);
}

if (args.includes('--build')) {
  const tpl = readFileSync(TPL, 'utf8');
  const out = render(tpl, loadSrc());
  writeFileSync(CSS, out);
  console.log('✓ 已从模板 + 台账生成 ' + CSS + '（' + out.length + ' 字节）');
  process.exit(0);
}

if (args.includes('--negctl')) {
  const tmp = mkdtempSync(join(tmpdir(), 'token-src-'));
  mkdirSync(join(tmp, 'assets'), { recursive: true });
  mkdirSync(join(tmp, 'tools'), { recursive: true });
  const css = readFileSync(CSS, 'utf8');
  const src = JSON.parse(readFileSync(SRC, 'utf8'));
  const key = Object.keys(src.primitive.$tokens)[0];
  src.primitive.$tokens[key].$value = 'MUTATED';
  writeFileSync(join(tmp, 'assets/tokens.css'), css);
  writeFileSync(join(tmp, 'tools/tokens.template.css'), readFileSync(TPL, 'utf8'));
  writeFileSync(join(tmp, 'tools/tokens.dtcg.json'), JSON.stringify(src, null, 2));
  const r = await runCheck(tmp);
  rmSync(tmp, { recursive: true, force: true });
  if (r.diff.length) { console.log('✓ 负控命中：' + key + ' 改值后判红（' + r.diff.length + ' 条）'); process.exit(2); }
  console.log('✗ 负控没命中：改值后仍判一致'); process.exit(1);
}

async function runCheck(root) {
  const raw = readFileSync(join(root, 'assets/tokens.css'), 'utf8');
  const css = parse(raw);
  const src = loadSrcFrom(join(root, 'tools/tokens.dtcg.json'));
  const diff = compare(css, src);
  const rd = renderDiff(readFileSync(join(root, 'tools/tokens.template.css'), 'utf8'), src, raw);
  if (rd) diff.push(rd);
  return { css, src, diff };
}
function loadSrcFrom(p) {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const out = {};
  for (const [name] of GROUPS) out[name] = unwrap(j[name]?.$tokens || {});
  return out;
}

const rawCss = readFileSync(CSS, 'utf8');
const cssTokens = parse(rawCss);
const srcTokens = loadSrc();
const diff = compare(cssTokens, srcTokens);
const rd = renderDiff(readFileSync(TPL, 'utf8'), srcTokens, rawCss);
if (rd) diff.push(rd);
const total = GROUPS.reduce((n, [g]) => n + Object.keys(cssTokens[g]).length, 0);
if (diff.length) {
  console.log('✗ 令牌台账漂移 ' + diff.length + ' 处（tokens.css ↔ tools/tokens.dtcg.json）');
  diff.slice(0, 30).forEach((d) => console.log('  · ' + d));
  console.log('  修法：node tools/token-source.mjs --extract 重新抽取，并检查这次改值是不是有意的。');
  process.exit(1);
}
console.log('✓ 令牌台账一致：' + total + ' 条（L1 ' + Object.keys(cssTokens.primitive).length + ' / L2 ' + Object.keys(cssTokens.semantic).length + ' / L3 ' + Object.keys(cssTokens.component).length + ' / L0 ' + Object.keys(cssTokens.compat).length + '）');
