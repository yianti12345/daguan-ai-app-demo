#!/usr/bin/env node
/**
 * 组件绑定检查（2026-11-02 立）
 *
 * 为什么有它：component-first.registry.json 原来只把组件绑到「规范小节 + 根选择器 +
 * 页面私货扫描」，没有绑「令牌 / 状态 / 判据 / 负控 / 使用页面」。于是判据散落、
 * 覆盖有洞：应用卡的材质断言只写在组件卡分支里，4% 投影一直绿；同一选择器两处
 * 定义也无人知道。这个文件把「组件用了什么、被谁看着」变成机器可读、缺项判红。
 *
 * 用法：
 *   node tools/check-component-binding.mjs           正常判
 *   node tools/check-component-binding.mjs --negctl  负控（4 刀，全中才 rc=2）
 *   node tools/check-component-binding.mjs --report  只打印，不判
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REG = 'tools/component-first.registry.json';
const errs = [];
const warnings = [];
const say = (s) => console.log(s);
const read = (f) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
};
const count = (s, needle) => s.split(needle).length - 1;

function load() {
  const raw = read(REG);
  if (!raw) throw new Error('读不到 ' + REG);
  return JSON.parse(raw);
}

function validate(reg) {
  const out = [];
  const spec = read('components.spec.md');
  const tokens = read('assets/tokens.css');
  if (!spec) out.push('读不到 components.spec.md');
  if (!tokens) out.push('读不到 assets/tokens.css');
  if (!spec || !tokens) return out;

  const policy = reg.bindingPolicy || {};
  const required = Array.isArray(policy.required) ? policy.required : [];
  if (!required.length) out.push('bindingPolicy.required 为空');

  for (const key of required) {
    const entry = (reg.components && reg.components[key]) || (reg.contracted && reg.contracted[key]);
    if (!entry) { out.push(key + '：没有组件登记（components/contracted）'); continue; }
    const b = entry.binding || {};
    const label = key + '（' + (entry.label || '') + '）';
    const specText = entry.spec || entry.specHeading;
    if (!specText || !spec.includes(specText)) out.push(label + '：规范小节不在 components.spec.md：' + (specText || '(空)'));

    const canon = entry.canonical || {};
    const root = canon.root ? (canon.root.startsWith('.') || canon.root.includes(' ') ? canon.root : '.' + canon.root) : '';
    const css = canon.file ? read(canon.file) : null;
    if (!canon.file || !css) { out.push(label + '：读不到 canonical.file'); }
    else {
      if (!canon.root) out.push(label + '：canonical.root 为空');
      else {
        const n = css.split('\n').filter((line) => line.trim() === root + '{').length;
        if (n === 0) out.push(label + '：canonical.root 在 ' + canon.file + ' 里没有唯一根规则（0 处）');
        else if (n > 1) out.push(label + '：canonical.root 在 ' + canon.file + ' 里有 ' + n + ' 处根规则（必须恰好 1 处）');
      }
    }

    if (!Array.isArray(b.tokens) || !b.tokens.length) out.push(label + '：tokens 为空');
    else for (const t of b.tokens) {
      if (!new RegExp('--' + t.replace(/^--/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:').test(tokens)) out.push(label + '：令牌未在 tokens.css 定义 ' + t);
      if (css && !new RegExp('var\\(\\s*--' + t.replace(/^--/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(css)) out.push(label + '：令牌未在 ' + canon.file + ' 使用 ' + t);
    }

    if (!Array.isArray(b.states) || !b.states.length) out.push(label + '：states 为空');
    else for (const s of b.states) {
      if (css && !css.includes(s)) out.push(label + '：状态选择器不在 ' + canon.file + '：' + s);
    }

    if (!Array.isArray(b.pages) || !b.pages.length) out.push(label + '：pages 为空');
    else for (const p of b.pages) {
      const html = read(p);
      if (!html) out.push(label + '：页面不存在 ' + p);
      else if (b.pageNeedle && !html.includes(b.pageNeedle)) out.push(label + '：页面里找不到组件锚 ' + b.pageNeedle + '（' + p + '）');
    }

    if (!Array.isArray(b.checks) || !b.checks.length) out.push(label + '：checks 为空');
    else for (const c of b.checks) {
      const js = c.file ? read(c.file) : null;
      if (!js) { out.push(label + '：判据文件不存在 ' + (c.file || '(空)')); continue; }
      if (!Array.isArray(c.ids) || !c.ids.length) out.push(label + '：' + c.file + ' 没列判据 id');
      else for (const id of c.ids) {
        if (!js.includes(id)) out.push(label + '：' + c.file + ' 里找不到判据 ' + id);
      }
    }

    if (!b.negctl) out.push(label + '：negctl 为空');
    else {
      const ledger = read('tools/negctl.tsv');
      if (!ledger) out.push(label + '：读不到 tools/negctl.tsv');
      else if (!ledger.split('\n').some((line) => line.startsWith(b.negctl + '\t'))) out.push(label + '：负控台账没有 ' + b.negctl);
    }
  }
  return out;
}

function report(reg, list) {
  const policy = reg.bindingPolicy || {};
  const required = Array.isArray(policy.required) ? policy.required : [];
  const entryOf = (k) => (reg.components && reg.components[k]) || (reg.contracted && reg.contracted[k]);
  const bound = required.filter((k) => entryOf(k) && entryOf(k).binding);
  say('组件绑定｜必绑 ' + required.length + '｜已绑 ' + bound.length + '｜未绑 ' + (required.length - bound.length));
  for (const k of bound) {
    const b = entryOf(k).binding;
    say('  ' + k + '：令牌 ' + (b.tokens || []).length + ' / 状态 ' + (b.states || []).length + ' / 判据 ' + (b.checks || []).length + ' / 页面 ' + (b.pages || []).length);
  }
  if (list.length) {
    say('');
    for (const e of list) say('✗ ' + e);
    say('绑定检查：' + list.length + ' 处不成立');
  } else {
    say('✓ 绑定检查通过：' + bound.length + '/' + required.length);
  }
}

function negctl(reg) {
  const cases = [
    ['去令牌', (r) => { r.components.appcard.binding.tokens = []; }],
    ['去状态', (r) => { r.components.appcard.binding.states = []; }],
    ['去判据', (r) => { r.components.appcard.binding.checks = []; }],
    ['去页面', (r) => { r.components.appcard.binding.pages = []; }]
  ];
  let hit = 0;
  for (const [name, mutate] of cases) {
    const clone = JSON.parse(JSON.stringify(reg));
    mutate(clone);
    const e = validate(clone);
    if (e.length) { hit++; say('  ✓ ' + name + ' ⇒ 判红（' + e[0] + '）'); }
    else say('  ✗ ' + name + ' ⇒ 没判红，判据这一格没量');
  }
  say('');
  say('负控 ' + hit + '/' + cases.length + (hit === cases.length ? ' 命中' : ' 未全中'));
  return hit === cases.length ? 2 : 3;
}

const argv = process.argv.slice(2);
let reg;
try { reg = load(); } catch (e) { console.error('✗ ' + e.message); process.exit(3); }
if (argv.includes('--negctl')) process.exit(negctl(reg));
const list = validate(reg);
if (argv.includes('--report')) { report(reg, []); process.exit(0); }
report(reg, list);
process.exit(list.length ? 2 : 0);
