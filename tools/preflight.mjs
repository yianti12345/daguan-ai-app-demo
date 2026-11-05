#!/usr/bin/env node
/* preflight.mjs —— 动某一页之前，先把这页的约束全打出来（2026-11-05 立）
 *
 * 为什么有它：这一段的返工有一个共同起点——**不查就改**。
 *   · 说「没有宽弹窗变体、只能统一 480」，`.nf-wide` 一直在 sys.css 里；
 *   · 「MD → 能力说明书」只改了列表列名，右栏标题照旧两轮；
 *   · 给 .p-tabs 加内联 padding，而这是共享件。
 * 判据能事后拦（check-inline-override / gate-copy 的口径台账），但拦不住"第一笔就写错"。
 * 所以把「这页有哪些约束」做成一条命令，开工第一件事就是跑它。
 *
 * 用法：node tools/preflight.mjs ability.html
 * 输出：这一页的规格三问、口径台账里跟它有关的行、私有类与到期、判据覆盖面、最近改动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const page = process.argv[2];

if (!page || !fs.existsSync(path.join(ROOT, page))) {
  console.error('用法：node tools/preflight.mjs <页面文件名，如 ability.html>');
  process.exit(2);
}

const line = (s) => console.log(s);
line('── ' + page + ' 开工前置 ─────────────────────────────');

/* 1 规格三问：对象 / 依据 / 事实（assets/spec.js 是唯一物理来源） */
const specSrc = fs.readFileSync(path.join(ROOT, 'assets/spec.js'), 'utf8');
const block = specSrc.split("'" + page + "':")[1];
if (block) {
  const seg = block.slice(0, block.indexOf('\n    },'));
  for (const k of ['object', 'source', 'truth', 'states']) {
    const m = seg.match(new RegExp(k + ":\\s*'([^']*)'"));
    if (m) line('  ' + k.padEnd(7) + m[1].slice(0, 90));
  }
} else {
  line('  （spec.js 里没有这一页 —— 先补规格，别先写界面）');
}

/* 2 口径台账：这一页与全站各有哪些"必须这么叫 / 不许出现" */
const ledgerPath = path.join(ROOT, 'tools', 'copy-ledger.tsv');
if (fs.existsSync(ledgerPath)) {
  const rows = fs.readFileSync(ledgerPath, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split('\t'));
  const mine = rows.filter((r) => r[0] === page || r[0] === '*');
  line('  口径台账 ' + mine.length + ' 条（' + page + ' + 全站）：');
  for (const r of mine) {
    const what = [r[1] ? '禁「' + r[1] + '」' : '', r[2] ? '须「' + r[2] + '」' : ''].filter(Boolean).join('，');
    line('    · ' + what + '　—　' + String(r[4] || '').slice(0, 46));
  }
}

/* 3 页面私有类：能用共享件就别新造；新造必须登记并写处置路径 */
const regPath = path.join(ROOT, 'tools', 'component-first.registry.json');
if (fs.existsSync(regPath)) {
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const pp = (reg.pagePrivate || {})[page];
  if (pp) {
    const list = pp.classes || [];
    line('  页面私有类 ' + list.length + ' 个（到期 ' + (pp.due || '未定') + '）：' + list.slice(0, 12).join(' '));
    line('  要加新类先想一遍：有没有共享件能表达？加了就得进这张表并写清什么时候并回共享层。');
  }
}

/* 4 判据覆盖面：哪些判据会盯这一页 */
const toolFiles = fs.readdirSync(HERE).filter((f) => /^(check|gate)-.*\.mjs$/.test(f));
const watchers = toolFiles.filter((f) => {
  const t = fs.readFileSync(path.join(HERE, f), 'utf8');
  return t.includes(page) || t.includes('*.html') || /readdirSync\(root\)\.filter\(\(f\) => f\.endsWith\('\.html'\)\)/.test(t);
});
line('  会盯这页的判据 ' + watchers.length + ' 条：' + watchers.slice(0, 8).join('、') + (watchers.length > 8 ? ' …' : ''));

/* 5 最近三条改动记录：这页最近因为什么被改过 */
const amd = path.join(ROOT, 'tools', 'amendments.tsv');
if (fs.existsSync(amd)) {
  const rows = fs.readFileSync(amd, 'utf8').split('\n').filter((l) => l.includes(page)).slice(-3);
  if (rows.length) {
    line('  最近改动：');
    for (const r of rows) {
      const c = r.split('\t');
      line('    · ' + c[0] + ' ' + (c[2] || '').slice(0, 80));
    }
  }
}

/* 6 规则台账：用户说过的规则，机器拦的 + 自己必须回答的 */
const rulesPath = path.join(ROOT, 'tools', 'rules.tsv');
if (fs.existsSync(rulesPath)) {
  const rows = fs.readFileSync(rulesPath, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split('\t'));
  const judged = rows.filter((r) => r[2] && r[2] !== '-');
  const asks = rows.filter((r) => r[3]);
  const judges = [...new Set(judged.map((r) => r[2]))];
  line('  规则台账 ' + rows.length + ' 条：' + judged.length + ' 条有机器判据（' + judges.length + ' 个判据）、'
    + asks.length + ' 条要自己回答、' + (rows.length - judged.length - asks.length) + ' 条纯流程。');
  line('  动手前逐条回答（答不上就先去查/去问，别先写）：');
  for (const r of asks) line('    ' + r[0] + ' ' + r[3]);
}

line('─────────────────────────────────────────────');
line('开工顺序：规格 → 共享件（有没有现成的）→ 令牌 → 才写页面；写完跑 tools/run-gates.sh --fast。');
