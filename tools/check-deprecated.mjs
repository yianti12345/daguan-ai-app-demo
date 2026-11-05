#!/usr/bin/env node
/* check-deprecated —— **已作废口径还在被使用**（墓碑扫描器）。
 *
 * 为什么有它：被推翻的结论不会自己消失。它们活在 CSS、注释、判据断言里，
 * 下一轮的我、或者别的 agent，会照着执行。今天最贵的一次：
 * 10-25 那条 P0「组件配置页隐藏小智浮球」在代码里活了一整天，
 * 直到用户第三次说「小智是全局的」、机器扫出来才删。
 *
 * 判什么：tools/deprecated.tsv 里每条**有机器特征**的作废项，
 * 在它的作用域文件里**剥掉注释后**还能不能扫到。
 * 命中 ＝ 有人（很可能是下一轮的我）又照旧做了 ⇒ 判红。
 *
 * 为什么不扫注释：
 * 注释里写「这里是历史做法，已废」是**对的**，不该红。
 * 这条踩过：J1 判据把注释里的色值当场裸值，报了一堆假红。
 * 所以先剥注释再扫，而且**保留换行**（把注释内容换成等长空白），行号才不漂。
 *
 * 无机器特征的条目（语义类，比如「全站禁止渐变」）：
 * 不算红，但**必须显式打印"无臂 N 条"** —— 沉默等于假装全覆盖。
 * 这些条目在台账里 pattern 列写 `-`，靠人读，不靠机器。
 *
 * 用法：node tools/check-deprecated.mjs [--negctl]
 * 退出码：0 干净 ｜ 2 扫到作废做法（负控恒 2）｜ 3 台账读不到
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TSV = path.join(HERE, 'deprecated.tsv');
const NEG = process.argv.includes('--negctl');

if (!fs.existsSync(TSV)) { console.error('✗ 读不到台账 tools/deprecated.tsv'); process.exit(3); }

/* 剥注释、保留换行：把注释里的每个非换行字符换成空格。
 * 这样"命中位置的行号"和原文件完全一致，报错能直接跳到那一行。 */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

const rows = fs.readFileSync(TSV, 'utf8').split('\n')
  .map((l) => l.replace(/\r$/, ''))
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const c = l.split('\t');
    return { date: c[0] || '', kind: c[1] || '', what: c[2] || '', why: c[3] || '',
             who: c[4] || '', pattern: c[5] || '-', scope: c[6] || '-' };
  });

if (!rows.length) { console.error('✗ 台账是空的'); process.exit(3); }

console.log(`已作废口径台账｜${rows.length} 条\n`);

let bad = 0, armed = 0, unarmed = 0;
const hits = [];

for (const r of rows) {
  const hasArm = r.pattern && r.pattern !== '-' && r.scope && r.scope !== '-';
  if (!hasArm) { unarmed++; continue; }
  armed++;
  if (!fs.existsSync(path.join(ROOT, r.scope))) {
    console.log(`  · 「${r.what}」的作用域 ${r.scope} 不存在（台账要更新，不是页面错）`);
    continue;
  }
  const raw = fs.readFileSync(path.join(ROOT, r.scope), 'utf8');
  const clean = NEG ? raw + '\n' + r.pattern.replace(/\\/g, '') : stripComments(raw);
  let re;
  try { re = new RegExp(r.pattern, 'g'); } catch (e) {
    console.log(`  · 「${r.what}」的正则写坏了：${e.message}`);
    continue;
  }
  let m;
  while ((m = re.exec(clean))) {
    const line = clean.slice(0, m.index).split('\n').length;
    hits.push({ ...r, line, text: m[0] });
    if (m.index === re.lastIndex) re.lastIndex++;   /* 零宽匹配防死循环 */
  }
}

if (hits.length) {
  for (const h of hits) {
    bad++;
    console.log(`  ✗ ${h.scope}:${h.line} 还在用已作废的做法`);
    console.log(`      ${h.date} 作废：${h.what}`);
    console.log(`      理由：${h.why}（推翻人：${h.who}）`);
    console.log(`      命中：${JSON.stringify(h.text).slice(0, 80)}`);
  }
} else {
  console.log('  ✓ 有机器特征的作废项，一条都没在代码里出现');
}

console.log(`\n有臂 ${armed} 条 ｜ 无臂 ${unarmed} 条（语义类，靠人读，不算绿）｜ 命中 ${bad} 处`);

if (NEG) {
  console.log(bad > 0 ? '负控：注入作废写法后判红 ✓（rc=2）' : '负控失败：注入后没判红 —— 这条判据是空的 ✗');
  process.exit(2);
}
process.exit(bad > 0 ? 2 : 0);
