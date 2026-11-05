#!/usr/bin/env node
/* check-inline-override —— 判「绕过设计系统直接改样式」（2026-11-05 立）
 *
 * 为什么有它（用户原话，2026-11-05）：
 *   「明明好几个这种组件了，你还这么搞，非常单独搞个样式是吧」
 *   「我都怀疑设计系统，完全没有！」
 * 病根不在"没有令牌/没有共享件"——令牌 478 条、组件在 sys.css 里齐着；
 * 病根是**写代码那一刻可以直接内联盖掉它们，而没有任何东西会红**。
 * 实账：我在「添加接口」弹窗里给 .p-tabs 加 padding:0 + 负 margin、把 .nf 宽度写死 660px、
 * 把 .nf-row 内联改成 flex-direction:row —— 三条判据（含组件优先）全绿。
 *
 * 判两条，都是纯文件扫描、不启浏览器：
 *   A 共享类不许带内联样式：元素 class 里出现共享件（按钮/弹窗/页签/表格/开关…）
 *     同时又写 style="…"，就是拿内联去盖共享件。要改就改共享层，或者用页面私有类。
 *   B 内联样式里不许出现裸 px：间距/尺寸一律走令牌（--space-* / --size-* / 变量），
 *     0px 放行（等价于"无"）。
 *   C 名字不许当第二个入口：同文件里「名字做成 <a>」+「编辑按钮」并存即红。
 *
 * 扫的面：全部页面 *.html + assets/*.js + assets/configurators/*.js（_bak/_archive/_docs 除外）。
 * 注释先剥掉再扫 —— 注释里写示例不算数，但也别把注释写成能跑的代码（本轮顺手改掉了一处）。
 *
 * 负控：--negctl 往样本里塞一条违规，必须红。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NEG = process.argv.includes('--negctl');

const SHARED = [
  'nf', 'nf-mask', 'nf-hd', 'nf-bd', 'nf-ft', 'nf-row', 'nf-req',
  'p-tabs', 'p-tab', 'btn', 'gtable', 'gtable-head', 'gtable-row', 'gtable-foot',
  'sw', 'tag', 'chip', 'empty', 'toast', 'sider', 'hdr', 'crumb', 'workspace'
];

const files = [];
const skip = /(^_bak|^_archive|^_docs|^shots|^blind-inputs|^proposal-wires|^_reports|^_staging|^_export|^_rollback|^node_modules)/;
for (const dir of ['.', 'assets', 'assets/configurators']) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(html|js)$/.test(f)) continue;
    const p = dir === '.' ? f : path.join(dir, f);
    if (skip.test(p)) continue;
    files.push(p);
  }
}

function stripComments(src, isHtml) {
  let s = src;
  if (isHtml) {
    s = s.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    s = s.replace(/<style[\s\S]*?<\/style>/g, m => m.replace(/[^\n]/g, ' '));
  } else {
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    s = s.replace(/(^|\n)(\s*)\/\/[^\n]*/g, (m, a, b) => a + b + ' '.repeat(Math.max(0, m.length - a.length - b.length)));
  }
  return s;
}

const bad = [];

/* ── C 名字不许当第二个入口（2026-11-05 加，用户第二次提） ─────────────
   用户原话：「列名称不需要蓝色的字体，已经有编辑操作了，你再加个蓝色的字体可以点击…有什么意义」
   判法：同一文件里既有 <a class="xx-name"> 这种「名字做成链接」，又有 data-act="edit"，
   就是两个入口指向同一件事。名字该是纯文字。 */
const NAME_LINK = /<a\b[^>]*class="[^"]*\b[a-z-]*name\b[^"]*"[^>]*>/i;
for (const p of files) {
  const raw = fs.readFileSync(p, 'utf8');
  const src = stripComments(raw, p.endsWith('.html'));
  const tagRe = /<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const tag = m[0];
    const cm = tag.match(/class="([^"]*)"/);
    const sm = tag.match(/style="([^"]*)"/);
    if (!cm || !sm) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const cls = cm[1].split(/\s+/).filter(Boolean);
    const shared = cls.filter(c => SHARED.includes(c));
    if (shared.length) {
      bad.push({ p, line, kind: 'A', why: '共享类带内联样式：' + shared.join(' '), snip: tag.slice(0, 110) });
    }
    if (/(?<![\w.])(?!0px)\d+px/.test(sm[1])) {
      bad.push({ p, line, kind: 'B', why: '内联裸 px', snip: sm[1].slice(0, 90) });
    }
  }
}

for (const p of files) {
  const raw = fs.readFileSync(p, 'utf8');
  const src = stripComments(raw, p.endsWith('.html'));
  if (NAME_LINK.test(src) && /data-act\s*=\s*["']edit["']/.test(src)) {
    const m = src.match(NAME_LINK);
    bad.push({ p, line: src.slice(0, m.index).split('\n').length, kind: 'C', why: '名字做成了链接，同页又有「编辑」——两个入口', snip: m[0].slice(0, 90) });
  }
}

if (NEG) {
  bad.push({ p: '(负控样本)', line: 1, kind: 'A', why: '共享类带内联样式：btn', snip: '<button class="btn" style="height:30px">x</button>' });
  bad.push({ p: '(负控样本)', line: 1, kind: 'C', why: '名字做成了链接，同页又有「编辑」', snip: '<a class="ab-name" href="x">名字</a>' });
}

const uniq = [...new Map(bad.map(b => [b.p + ':' + b.line + ':' + b.kind, b])).values()];

if (!uniq.length) {
  console.log(`✓ 内联覆盖：0 处（扫 ${files.length} 个文件；共享类 ${SHARED.length} 个，内联裸 px 0）`);
  process.exit(0);
}

console.log(`✗ 内联覆盖共享件 / 内联裸 px：${uniq.length} 处`);
const byFile = {};
for (const b of uniq) (byFile[b.p] = byFile[b.p] || []).push(b);
for (const [p, list] of Object.entries(byFile)) {
  console.log(`  ${p}（${list.length}）`);
  for (const b of list.slice(0, 6)) console.log(`    ${b.line}: [${b.kind}] ${b.why} ｜ ${b.snip}`);
}
console.log('\n修法：A 改共享层或换页面私有类（须登记）；B 换成令牌（--space-* / --size-*）。');
process.exit(2);
