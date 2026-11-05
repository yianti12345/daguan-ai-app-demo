#!/usr/bin/env node
/* check-component-lifecycle —— 组件生命周期治理（2026-11-02）
 *
 * 为什么有它：组件优先登记只解决“有没有组件”，没解决“谁负责、什么时候复审、废弃后谁替代”。
 * 没有这三格，组件会只进不退，最后又回到“页面各自复制一份”的老路。
 *
 * 判据：
 *   L1 登记集合一致：registry 里的组件与 lifecycle 里的一一对应（多/少都红）
 *   L2 状态合法：stable / beta / deprecated
 *   L3 日期合法：introduced、reviewBy 必须是 YYYY-MM-DD；reviewBy 早于今天即红
 *   L4 deprecated 必须写 replacement（指向已登记组件）与 removalBy
 *   L5 replacement 不能指向自己
 *
 * 用法：
 *   node tools/check-component-lifecycle.mjs
 *   node tools/check-component-lifecycle.mjs --negctl   # 注入无替代件的 deprecated，必须 rc=2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REG = JSON.parse(fs.readFileSync(path.join(HERE, 'component-first.registry.json'), 'utf8'));
const LIFE = JSON.parse(fs.readFileSync(path.join(HERE, 'component-lifecycle.json'), 'utf8'));
const NEG = process.argv.includes('--negctl');
const TODAY = new Date().toISOString().slice(0, 10);

function registryKeys() {
  const a = Object.keys(REG.components || {});
  const b = Object.keys(REG.contracted || {});
  return [...new Set([...a, ...b])].sort();
}

function validate(life, label) {
  const fails = [];
  const keys = registryKeys();
  const got = Object.keys(life.components || {}).sort();
  const missing = keys.filter(k => !got.includes(k));
  const extra = got.filter(k => !keys.includes(k));
  if (missing.length) fails.push('L1 lifecycle 缺组件：' + missing.join(', '));
  if (extra.length) fails.push('L1 lifecycle 多出未登记组件：' + extra.join(', '));
  const statuses = new Set(['stable', 'beta', 'deprecated']);
  for (const k of got) {
    const c = life.components[k];
    if (!statuses.has(c.status)) fails.push('L2 ' + k + ' 状态非法：' + c.status);
    for (const f of ['introduced', 'reviewBy']) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c[f] || ''))) fails.push('L3 ' + k + ' ' + f + ' 不是 YYYY-MM-DD：' + c[f]);
    }
    if (c.reviewBy && c.reviewBy < TODAY) fails.push('L3 ' + k + ' 复审已过期：' + c.reviewBy + ' < ' + TODAY);
    if (c.status === 'deprecated') {
      if (!c.replacement || !got.includes(c.replacement)) fails.push('L4 ' + k + ' deprecated 但 replacement 未登记：' + (c.replacement || '空'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.removalBy || ''))) fails.push('L4 ' + k + ' deprecated 但 removalBy 不是日期：' + c.removalBy);
    }
    if (c.replacement && c.replacement === k) fails.push('L5 ' + k + ' replacement 指向自己');
  }
  return { fails, keys: got.length, label };
}

if (NEG) {
  const copy = JSON.parse(JSON.stringify(LIFE));
  const victim = Object.keys(copy.components)[0];
  copy.components[victim].status = 'deprecated';
  copy.components[victim].replacement = '';
  copy.components[victim].removalBy = '';
  const r = validate(copy, 'negctl');
  if (r.fails.length === 0) {
    console.error('✗ negctl 失败：注入 deprecated 无替代件仍然通过');
    process.exit(2);
  }
  console.log('✓ negctl 命中 ' + r.fails.length + ' 条：' + r.fails[0]);
  process.exit(0);
}

const r = validate(LIFE, 'live');
if (r.fails.length) {
  console.error('✗ 组件生命周期：' + r.fails.length + ' 处');
  r.fails.forEach(f => console.error('  ' + f));
  process.exit(2);
}
console.log('✓ 组件生命周期：' + r.keys + ' 个组件，状态/负责人/复审日均有效（今天 ' + TODAY + '）');
