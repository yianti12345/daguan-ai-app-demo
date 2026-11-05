#!/usr/bin/env node
/* check-dead-css —— 死 CSS 判据（2026-11-02）
 *
 * 为什么有它：sys.css 多代叠加，类名删了 DOM、规则还留在文件里；靠人眼看不出，
 * 下一次改样式又会在旧规则上叠一层。这里只判一件事：**CSS 选择器里引用的类名，
 * 是否在页面 HTML 或 assets/*.js 里出现过**。没出现 = 活跃死规则，红。
 *
 * 不算死：只出现在注释里的类名（注释先被抹掉再解析）；动态拼接前缀由
 * tools/dead-css-allow.txt 逐行登记（精确名或前缀，前缀以 * 结尾）。
 *
 * 用法：
 *   node tools/check-dead-css.mjs
 *   node tools/check-dead-css.mjs --verbose
 *   node tools/check-dead-css.mjs --negctl    # 注入 .ghost-dead-xyz，必须 rc=2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CSS = path.join(ROOT, 'assets/sys.css');
const ALLOW_FILE = path.join(HERE, 'dead-css-allow.txt');
const NEG = process.argv.includes('--negctl');
const VERBOSE = process.argv.includes('--verbose');

function readAllow() {
  if (!fs.existsSync(ALLOW_FILE)) return [];
  return fs.readFileSync(ALLOW_FILE, 'utf8').split(/\r?\n/)
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}
function allowed(name, allow) {
  return allow.some(a => a.endsWith('*') ? name.startsWith(a.slice(0, -1)) : name === a);
}

/* 注释替换成等长空白（保留换行），这样行号不漂 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/* 解析每个规则的前导选择器；@media 里面的规则也解析，@ 规则本身跳过 */
function selectors(css) {
  const out = [];
  let i = 0, depth = 0, last = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const prelude = css.slice(last, i).trim();
      if (prelude && !prelude.startsWith('@')) {
        out.push({ sel: prelude.replace(/\s+/g, ' '), line: css.slice(0, last).split('\n').length });
      }
      depth++; last = i + 1;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1); last = i + 1;
    } else if (c === ';' && depth === 0) {
      last = i + 1;
    }
    i++;
  }
  return out;
}

function classTokens(text) {
  return new Set([...text.matchAll(/[A-Za-z_][\w-]*/g)].map(m => m[0]));
}

function scan(cssText) {
  let src = '';
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.html')) src += '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8');
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
    if (f.endsWith('.js')) src += '\n' + fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
  }
  const used = classTokens(src);
  const allow = readAllow();
  const seen = new Set(), dead = [];
  for (const r of selectors(stripComments(cssText))) {
    for (const m of r.sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      const name = m[1];
      if (used.has(name) || allowed(name, allow)) continue;
      const key = name + '@' + r.line;
      if (seen.has(key)) continue;
      seen.add(key);
      dead.push({ name, line: r.line, sel: r.sel.slice(0, 150) });
    }
  }
  const uniq = [...new Set(dead.map(d => d.name))].sort();
  return { dead, uniq, usedCount: used.size };
}

const raw = fs.readFileSync(CSS, 'utf8');
const base = scan(raw);
let result = base;

if (NEG) {
  result = scan(raw + '\n.ghost-dead-xyz{display:none}\n');
}

if (NEG) {
  if (result.uniq.includes('ghost-dead-xyz')) {
    console.log('✓ 负控命中：注入 .ghost-dead-xyz 后判为死规则（rc=2 由调用方断言）');
    process.exit(2);
  }
  console.log('✗ 负控失效：注入的死规则没有被识别');
  process.exit(1);
}

if (result.uniq.length) {
  console.log('✗ 死 CSS 活跃选择器 ' + result.dead.length + ' 处（' + result.uniq.length + ' 个类名）');
  for (const d of result.dead.slice(0, VERBOSE ? 200 : 20)) {
    console.log('  sys.css:' + d.line + '  .' + d.name + '  ← ' + d.sel);
  }
  if (!VERBOSE && result.dead.length > 20) console.log('  …其余 ' + (result.dead.length - 20) + ' 处用 --verbose 看');
  process.exit(2);
}

console.log('✓ 死 CSS：活跃选择器 0（扫描 ' +
  fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).length + ' 页 / ' +
  fs.readdirSync(path.join(ROOT, 'assets')).filter(f => f.endsWith('.js')).length + ' 脚本，' +
  classTokens(stripComments(raw).replace(/[^A-Za-z0-9_-]+/g, ' ')).size + ' 个 CSS 词元）');
process.exit(0);
