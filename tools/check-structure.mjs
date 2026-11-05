#!/usr/bin/env node
/* check-structure —— **区在不在**。结构树判据。
 *
 * 为什么有它（2026-10-26，零上下文盲审的 P0）：
 *   原话是「纯文字白卡之所以全绿，是因为它没有违反任何一条已列的轴 ——
 *   它只是少了整整一个区，而没有任何判据在问『区在不在』」。
 *   在这之前所有判据量的都是尺寸、颜色、间距、对齐：卡片少一个描述区、少一个操作带、
 *   少一个状态徽标，上面这些全都不用变，于是全绿。
 *
 * 判据形状：每区三条 —— found（在不在）/ visible（看不看得见）/ content（有没有东西）。
 *   只判 found 不够：`display:none` 的元素 querySelector 找得到，用户看不到。
 *   只判 visible 也不够：可见的空壳（0 宽、空文本）同样是缺区。
 *
 * 和 ui-contract 的分工：
 *   ui-contract 管「判据和 AI 依赖的锚点在不在」——点级。
 *   这条管「界面的结构区块在不在」——区级。区没了，锚点可能还在（空壳），所以两条不能互相替代。
 *
 * 用法：node tools/check-structure.mjs [baseUrl]
 * 退出码：0 全部成立 ｜ 1 有区缺失/不可见/空 ｜ 3 环境不可用
 */
import { resolveBase } from './base.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TREE = path.join(HERE, 'structure-tree.json');
const PROBE = path.join(HERE, 'probe.mjs');

const ARGV = process.argv.slice(2);
const NEGCTL = ARGV.includes('--negctl');
const argBase = ARGV.find((a) => /^https?:\/\//.test(a));

let BASE;
try { BASE = argBase ? argBase.replace(/\/$/, '') : await resolveBase(); }
catch (e) { console.log('✗ 环境不可用：' + (e && e.message ? e.message : e)); process.exit(3); }

let tree;
try { tree = JSON.parse(readFileSync(TREE, 'utf8')); }
catch (e) { console.log('✗ 读不到 tools/structure-tree.json：' + (e && e.message)); process.exit(3); }

const pages = tree.pages || {};
if (!Object.keys(pages).length) { console.log('✗ 结构树里一个页面都没声明'); process.exit(1); }

const exprFor = (regions) => `(function(){
  var R = ${JSON.stringify(regions)};
  var out = [];
  for (var sel in R) {
    var spec = R[sel] || {};
    var nodes = [];
    try { nodes = [].slice.call(document.querySelectorAll(sel)); } catch (e) { nodes = []; }
    var vis = nodes.filter(function(n){
      var r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var s = getComputedStyle(n);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    });
    var first = vis[0] || nodes[0] || null;
    /* input / textarea 的「内容」不是 textContent：它们的 textContent 恒为空，
       按 textContent 判会把一个明明填了话的输入框当成空区（实测第一版就误报了两个）。 */
    var text = '';
    if (first) {
      var tag = first.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        text = String(first.value || first.placeholder || first.getAttribute('placeholder') || '').trim();
      } else {
        text = String(first.textContent || '').replace(/\\s+/g, ' ').trim();
      }
    }
    var hasKid = first ? [].slice.call(first.children).some(function(c){
      var r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) : false;
    out.push({
      sel: sel, n: nodes.length, visible: vis.length,
      textLen: text.length, hasVisibleKid: hasKid, count: spec.count || null,
      /* ★2026-11-02：声明为 "DB.APPS" 的条数当场向数据层要 —— 写死 6 的结果是
         用户建/删一个应用判据就红，而红的原因跟"区在不在"完全无关。 */
      dbApps: (window.DB && window.DB.APPS) ? window.DB.APPS.length : -1,
      /* ★2026-11-04：种子改成「从零演示」后，装配入口/已装计数在空画布时本来就该隐藏。
         带过去，让台账能用 when:'hasContent' 声明「有内容才要求可见」。 */
      blocks: document.querySelectorAll('#canvas section.cv-blk').length
    });
  }
  return JSON.stringify(out);
})()`;

const TMP = path.join('/tmp', 'structure-expr-' + process.pid + '.js');
let bad = 0, checked = 0, envFail = 0, skipped = 0;

console.log('结构树 @ ' + BASE + (NEGCTL ? '（负控：注入一个不存在的区）' : ''));

for (const page of Object.keys(pages)) {
  const regions = { ...(pages[page].regions || {}) };
  if (NEGCTL) regions['#__no_such_region__'] = { why: '负控注入，不该存在' };
  const sels = Object.keys(regions);
  if (!sels.length) continue;

  writeFileSync(TMP, exprFor(regions));
  let rows;
  try {
    const stdout = execFileSync(process.execPath, [PROBE, BASE + '/' + page, TMP], {
      encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    rows = JSON.parse(String(stdout).trim().split('\n').filter(Boolean).pop());
    if (typeof rows === 'string') rows = JSON.parse(rows);
    if (!Array.isArray(rows)) throw new Error('探针返回不是数组');
  } catch (e) {
    console.log('\n✗ ' + page + '：量不到（环境失败，不是结构问题）');
    console.log('  ' + String(e && e.message ? e.message : e).slice(0, 160));
    envFail++;
    continue;
  }

  console.log('\n' + page);
  for (const r of rows) {
    const spec = regions[r.sel] || {};
    /* 台账声明「有内容才要求」的区，空画布时跳过并说明，不算缺区、也不算通过。 */
    if (spec.when === 'hasContent' && !(r.blocks > 0)) {
      console.log('  － ' + r.sel + ' · 空画布，本区按台账 when:hasContent 不要求（装了组件才出现）');
      skipped = (typeof skipped === 'number' ? skipped : 0) + 1;
      continue;
    }
    checked++;
    const problems = [];
    if (r.n === 0) problems.push('区不存在');
    else if (r.visible === 0) problems.push('区在 DOM 里但没有可见尺寸（hidden / display:none / 0 高）');
    else if (!r.textLen && !r.hasVisibleKid) problems.push('区可见但内容是空的（无文本、无可见子元素）');
    let want = spec.count;
    if (want === 'DB.APPS') want = r.dbApps;
    let countBad = false;
    if (want != null) {
      if (String(spec.countRule || '').indexOf('至少') >= 0) countBad = r.n < want;
      else countBad = r.n !== want;
    }
    if (countBad) problems.push('数量 ' + r.n + ' ≠ 声明 ' + want + (spec.countRule ? '（' + spec.countRule + '）' : ''));

    if (problems.length) {
      bad++;
      console.log('  ✗ ' + r.sel + ' · ' + problems.join('；'));
      if (spec.why) console.log('      少了会怎样：' + spec.why);
    } else {
      console.log('  ✓ ' + r.sel + (spec.count != null ? ' ×' + r.n : '') + ' · ' + r.textLen + ' 字');
    }
  }
}

try { execFileSync('/bin/rm', ['-f', TMP]); } catch (e) {}

console.log('\n通过 ' + (checked - bad) + ' ｜ 缺区 ' + bad + ' ｜ 环境失败 ' + envFail + ' 页');
if (envFail && !bad) { console.log('没量到的不算通过（rc=3）'); process.exit(3); }
if (bad) {
  console.log('缺区不是样式问题：卡片少一个区时，尺寸/颜色/间距/对齐全部照旧通过。');
  process.exit(1);
}
console.log('结构树成立：区在、可见、有内容、数量对。');
process.exit(0);
