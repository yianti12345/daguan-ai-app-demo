#!/usr/bin/env node
/* check-noborder —— 「层次靠底色差/阴影，不靠描边」这条理念的判据。
 *
 * 为什么要有：这是 DESIGN.md §1.1 第 1 条，但它原来只写在文档里，没人执行。
 * 结果我每做一次视觉就顺手补一条 `border:1px solid`。用户 2026-10-23 直接问
 * 「你觉得我喜欢边框线条吗？现在好看的审美一般都不带边框了」。
 * **规范写成散文，就只会被执行到我记得的那一次。** 所以落成命令。
 *
 * 判据形态：按**容器名单**断言，不做全量扫描。
 *   全量扫会把表格行分隔、输入框、行内小控件一起判红 —— 那些线是功能性的，
 *   去掉之后表就读不成行了。真正要管的是「容器」：卡片、块、面板、浮层、胶囊。
 *   它们是"浮在页面上的东西"，边界应该由底色差和阴影表达，不该画线。
 *   名单是显式的：新增一个容器类就加进来，加进来之后它就不许有描边。
 *
 * 用法：node tools/check-noborder.mjs            正控
 *      node tools/check-noborder.mjs --negctl   负控：给 .seed 与 .crow.ccard 各注入描边，两支都必须红
 * 退出码：0 通过 ｜ 2 有违规（负控恒 2）｜ 3 环境不可用
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const NEG = process.argv.includes('--negctl');

const FILES = [
  'assets/sys.css', 'assets/float.css', 'assets/generated.css', 'assets/configurator.css',
  'component.html', 'app.html', 'apps.html', 'components.html',
];

const CONTAINERS = [
  '.kcard', '.blk', '.sheet', '.bd-group', '.bd-rules', '.bd-trail', '.bd-doc',
  /* ★2026-10-27：.fk-hist 从名单移出。它不是独立浮层，是 .fk-dock 这张卡的**上半区** ——
     CSS 自己的注释写着「历史面板与输入条是一个整体（上下拼起来的一张卡），不是两块浮卡」。
     它的 border-bottom 是这张卡内部的接缝线（10-25 特意把线从输入条挪到面板底部，
     让接缝只有一条），不是容器外边界。把它当容器判，等于要求一张卡的两个区之间不许有分界。 */
  '.cmenu', '.fk-bar', '.panel', '.seed', '.bd-hdprev', '.page',
  /* ★2026-10-28 补（规范 §7.8）：组件卡 .crow.ccard 原来不在名单里，所以它能一直带着 1px 描边 ——
     用户口径是「容器边界由底色差 + 阴影表达」，组件卡与应用卡必须同一套材质（只是骨架不同）。 */
  '.crow.ccard',
];

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function styleText(file) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!file.endsWith('.html')) return stripComments(s);
  const m = s.match(/<style>([\s\S]*?)<\/style>/);
  return m ? stripComments(m[1]) : '';
}

/* 极简规则切分：[{sel, decl, line}]
   ⚠ 单行规则（`.a{color:red}` 一行写完）必须当场闭合：第一版创建 buf 后直接 continue，
     单行规则的 buf 永远不关，把后面所有规则都吞掉 —— 负控因此抓不到注入的描边，
     而正控却显示"0 违规"（因为大部分规则根本没被扫到）。这类 bug 只会让判据变哑。 */
function rules(text) {
  const out = [];
  const lines = text.split('\n');
  let buf = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (buf === null) {
      if (!t || t.startsWith('/*') || t.startsWith('@')) continue;
      const bi = t.indexOf('{');
      if (bi < 0) continue;
      const sel = t.slice(0, bi).trim();
      const decl = t.slice(bi + 1);
      if (decl.includes('}')) {
        out.push({ sel, decl: decl.split('}')[0], line: i + 1 });
      } else {
        buf = { sel, decl, line: i + 1 };
      }
      continue;
    }
    buf.decl += ' ' + t;
    if (t.includes('}')) { buf.decl = buf.decl.split('}')[0]; out.push(buf); buf = null; }
  }
  return out;
}

function scan() {
  const bad = [];
  for (const f of FILES) {
    let txt;
    try { txt = styleText(f); } catch (e) { continue; }
    for (const r of rules(txt)) {
      /* 表格单元格行分隔是功能性的，和表格行同类 → 不算容器描边 */
      const isCell = /(^|[\s,>])t[hd]([\s.:,{]|$)|\.trail-row\b|\.rule-row\b|\.bd-card\b|\.fk-msg\b/.test(r.sel);
      if (isCell) continue;
      /* ★2026-10-27 修（口径过宽，属误报）：原来把「容器后代」也算容器 ——
         `.kcard .card-ft`（卡片里的 footer）因为以 `.kcard ` 开头就被当成容器边界，
         可它明明是**卡片内部的一格**，那条 border-top 是区与区之间的分隔线，
         跟「浮在页面上的容器靠阴影分层」说的不是一回事。
         现在只判**容器自己**：`.kcard` / `.kcard:hover` / `.kcard.is-draft` / `.kcard[data-x]`，
         后代选择器（`.kcard .xxx`）一律不判 —— 容器内部要不要分隔线，是那一块自己的事。 */
      /* ★2026-10-28 修（这条原来是**假绿**的第二个口子）：原来只认"容器写在选择器最左"，
         于是 `.page-components .crow.ccard{border:…}` 永远命中不了 —— 名单加了也白加。
         现在取选择器右端的复合选择器（CSS 里的 subject，真正被样式命中的那个元素）：
         `.page-components .crow.ccard` → `.crow.ccard`（判）；`.kcard .card-ft` → `.card-ft`（不判，仍是卡片内部一格）。
         实测：换成右端判定后，现有 12 个容器类的命中数与原来一致（0 处新增），没有顺手把别处判红。 */
      const subjectOf = (x) => x.trim().split(/\s+/).pop();
      const hit = r.sel.split(',').map((x) => x.trim()).some((x) => {
        const sub = subjectOf(x);
        return CONTAINERS.some((c) => sub === c || sub.startsWith(c + ':') || sub.startsWith(c + '.') || sub.startsWith(c + '['));
      });
      if (!hit) continue;
      const m = r.decl.match(/border[^:;]*:\s*[^;}]*solid[^;}]*/);
      if (!m) continue;
      bad.push({ file: f, line: r.line, sel: r.sel.slice(0, 40), decl: m[0].trim().slice(0, 56) });
    }
  }
  return bad;
}

if (NEG) {
  /* 两支负控，各自注入、各自还原、各自判 —— 一支证明老容器（.seed）仍被抓，
     一支证明**新加的 .crow.ccard 真的进闸**（名单加了但匹配器不认识它，就是假绿）。
     ⚠ 还原必须在 process.exit **之前**显式执行 —— process.exit() 会跳过 finally，
       上一版就是这么把注入的描边留在 component.html 里的（后来判据自己报了红）。 */
  const KNIVES = [
    { k: 'seed', file: 'component.html', expect: '.seed',
      from: '.seed{\n  display:flex;', to: '.seed{\n  border:1px solid var(--line-2);\n  display:flex;' },
    { k: 'ccard', file: 'assets/sys.css', expect: '.crow.ccard',
      from: '.page-components .crow.ccard{\n  position:relative;',
      to: '.page-components .crow.ccard{\n  border:1px solid var(--line-2);\n  position:relative;' },
  ];
  let missed = 0;
  for (const K of KNIVES) {
    const target = path.join(ROOT, K.file);
    const orig = fs.readFileSync(target, 'utf8');
    if (!orig.includes(K.from)) {
      console.log(`  ✗ 负控(${K.k}) 无法注入：${K.file} 里找不到注入点`);
      missed++;
      continue;
    }
    fs.writeFileSync(target, orig.replace(K.from, K.to));
    let caught = false;
    try { caught = scan().some((b) => b.sel.includes(K.expect)); } finally { fs.writeFileSync(target, orig); }
    console.log(`  ${caught ? '✓' : '✗'} 负控(${K.k})：给 ${K.expect} 加 1px 描边后${caught ? '判红' : '没抓到（← 判据没在量）'}`);
    if (!caught) missed++;
  }
  if (missed) { console.log(`\n负控 ${KNIVES.length - missed}/${KNIVES.length} 命中 ⇒ 未量`); process.exit(1); }
  console.log('\n负控成立：容器描边会被这条判据抓到（含新加的 .crow.ccard）');
  process.exit(2);
}

const bad = scan();
if (bad.length) {
  console.log(`容器描边检查（名单 ${CONTAINERS.length} 个容器类）\n`);
  for (const b of bad) console.log(`  ✗ ${b.file}:${b.line}  ${b.sel}\n      ${b.decl}`);
  console.log(`\n${bad.length} 处容器用描边表达边界。按 DESIGN.md §1.1：容器边界用「底色差 + 阴影」，不画线。`);
  process.exit(2);
}
console.log(`容器描边检查：0 处违规（${CONTAINERS.length} 个容器类的边界全部由底色差与阴影表达）`);
