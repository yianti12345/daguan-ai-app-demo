#!/usr/bin/env node
/**
 * gate-states.mjs —— J5 状态矩阵
 *
 * 为什么：这一轮「取消不还原」「弹窗被胶囊穿透」这类问题，本质都不是写错，
 * 是**某个态从来没有被定义过**。状态矩阵写进文档没用，必须机器能查"代码里到底有没有这个态"。
 * 判据来源：DESIGN.md §12.3「控件状态总表」（v3.2 · 2026-10-29 设计规范官新建）。
 *   ★节号沿革：v1 的状态矩阵在 §4.7；v3 重写时整节丢失，判据只能记 rc=3「未量」；
 *   2026-10-29 补回为顶层 §12（原 §12 变更记录顺延为 §13），本判据随之改读 §12.3。
 *   备份 `_bak/tokens-20261028/DESIGN-v1.md:307` 不是契约，不能拿来判。
 *   §12.3 若再次缺失或改名：见下方 docControls 为空的分支——CSS 侧仍判，
 *   文档侧记 rc=3「未量」，补件人＝设计规范官，到期 2026-11-05。
 *
 * 用法：node tools/gate-states.mjs
 *      node tools/gate-states.mjs --negctl            （★ 预期 rc=2：把两条真实态规则改坏，必须能抓；
 *                                                      负控自己失效 rc=1 —— 不许与"红"同码）
 *      node tools/gate-states.mjs --negctl-boundary   （★ 预期 rc=0：合成文档里 §12.4 注入假条目，§12.3 解析必须不变）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 状态矩阵要查的是"这些控件到底有没有定义过这个态"。
   base.css 已删（死样式），现在控件规则分布在 sys.css + 两个页面的内联样式里，
   所以必须把三处合起来看 —— 只看一份会假红，只看页面内联会漏掉共用件。 */
const css = ['assets/tokens.css', 'assets/sys.css', 'assets/float.css', 'component.html', 'app.html']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

/* 控件清单**从 DESIGN.md §12.3 的表格里读**，不在这里另写一份。
   上一版把清单写死在本文件里，文档已经把「胶囊 A/B」删了，判据还在查 `.fab:hover` ——
   查的是一个不存在的控件，于是十条态全红，而我以为"状态矩阵没问题"。
   规范一改、判据必须跟着改，这件事只能靠"判据读规范"来保证。 */
const design = fs.readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');

/* 只取目标节（现为 §12.3）：从 `### 12.3` 起，到**下一个同级或更高级标题**为止。
   ★2026-10-28（机制审查官）修：原来用 `split('\n---')[0]`，切到第一条分隔线为止。
   当时节号还是 §4.7，10-27 在其后新增 §4.8（组件类型色）与 §4.9（改动清单），两节里也有表格，
   而分隔线被推到 §4.9 结尾 ⇒ 那两张表被当成 §4.7 继续读，J5 报出「类型 / 页面类 / 能力类 /
   数据类 / 配置类 / 未分类 / 情形 / 正常 / 写盘失败 / 客户只读视图」10 条根本不属于该节
   的条目（假红）。节的边界是标题，不是分隔线。 */
function sectionOf(doc, no) {
  const re = new RegExp('^###\\s+' + no.replace(/\./g, '\\.') + '(?=\\s|$)', 'm');
  const m = re.exec(doc);
  if (!m) return '';
  const rest = doc.slice(m.index + m[0].length);
  const end = rest.search(/^#{1,3}[ \t]/m);   /* 下一个同级（###）或更高级（## / #）标题 */
  return end < 0 ? rest : rest.slice(0, end);
}

function parseControls(doc) {
  const sec = sectionOf(doc, '12.3');
  return [...sec.matchAll(/^\|\s*([^|\n]+?)\s*\|/gm)]
    .map((m) => m[1].trim())
    .filter((n) => n && !/^-+$/.test(n) && n !== '组件');
}

const docControls = parseControls(design);

/* 控件名 → 必须存在的态规则。左边必须与文档表格第一列同字。 */
const REQUIRED = [
  { name: '主按钮',        re: /\.btn\.primary:hover/ },
  { name: '描边次按钮',    re: /\.btn-install:hover/ },
  { name: '悬浮条',        re: /\.fk-grip/ },
  { name: '输入框 / 筛选', re: /\.field:focus-within/ },
  { name: '卡片',          re: /\.kcard:hover/ },
  { name: '列表行',        re: /\.row:hover/ },
  { name: '装配面板行',    re: /\.panel \.row:hover|\.row:hover/ },
  /* 2026-10-24（用户 m04062 之后）：卡上不再有图标钮与 ⋮ 菜单，改成卡底栏的两个
     文字动作钮（配置 / 版本管理）。控件换了，状态矩阵的表头与这条规则一起换 ——
     不许让判据继续验一个已经不存在的控件。 */
  { name: '卡上动作钮（配置 / 版本管理）', re: /\.k-more:hover/ },   /* ★2026-11-04 .kbtn 已不存在；真机 hover 规则是 .cl-ops .k-more:hover（sys.css:867） */
  { name: '侧栏一级项（折叠）', re: /\.sider \.gt:hover/ },
];
/* 跨控件的两条硬性状态 */
const EXTRA = [
  { name: '全局·焦点环',   re: /:focus-visible/ },
  { name: '禁用态',        re: /:disabled|\[disabled\]|is-disabled/ },
];
const ALL = REQUIRED.concat(EXTRA);

const docSet = new Set(docControls);
const codeSet = new Set(REQUIRED.map((r) => r.name));
/* 双向对齐：文档里有、判据里没有 ⇒ 这个控件没人验；判据里有、文档里没有 ⇒ 判据在查幽灵控件 */
const notChecked = [...docSet].filter((n) => !codeSet.has(n));
const ghosts = [...codeSet].filter((n) => !docSet.has(n));

const isNeg = process.argv.includes('--negctl');
const isBoundaryNeg = process.argv.includes('--negctl-boundary');
let source = css;
if (isNeg) {
  /* 负控：把判据真正的量对象改坏，判据必须报红。
     ★2026-10-28（机制审查官）修：原来注入的是 `.card:hover`（全库 0 处，改了等于没改）
     + 只改第一处 `.row:hover`（还剩 2 处，正则照旧命中）⇒ missing 恒空，负控从来没红过；
     而失败分支也 exit 2，与"负控成立"同码，读的人分不出真假。
     现在改 `.kcard:hover`（6 处，卡片判据的对象）与全部 `.row:hover`（3 处）：
     只把伪类名改掉、类名不动，check-selfcheck 的白名单不受影响。 */
  source = css.replace(/\.kcard:hover/g, '.kcard:hovex').replace(/\.row:hover/g, '.row:hovex');
}

if (isBoundaryNeg) {
  /* 边界负控（2026-10-28 加；2026-10-29 改成不依赖活文档）：
     原来往活文档的下一节注入假条目，节号一改就报「无处可插」rc=1，变成永久未量。
     现在用合成文档验解析器，节号跟现行契约走：
     `### 12.3` 的表格只许读到 `### 12.4` 之前，下一节（组件类型色）的表格不许漏进来。
     它证的是"节的边界是标题，不是分隔线"，与活文档有没有这一节无关。 */
  const fakeDoc = [
    '### 12.3 状态矩阵', '', '| 组件 | 默认 | 悬停 |', '|---|---|---|', '| 主按钮 | ✓ | ✓ |', '',
    '### 12.4 组件类型色', '', '| 类型 | 主色 | 浅底 |', '|---|---|---|', '| 幽灵控件（边界负控） | — | — |',
  ].join('\n');
  const controls = parseControls(fakeDoc);
  const leaked = controls.filter((n) => n.includes('幽灵控件'));
  const same = controls.length === 1 && controls[0] === '主按钮';
  if (leaked.length || !same) {
    console.error(`🚫 边界失效：§12.4 的假条目被读进了 §12.3 的控件清单（解析结果：${controls.join('、') || '空'}）`);
    process.exit(2);
  }
  console.log('边界负控通过：合成文档 §12.4 注入假条目后，§12.3 仍只解析 1 条（主按钮）');
  process.exit(0);
}

const missing = ALL.filter((r) => !r.re.test(source));

if (isNeg) {
  if (!missing.length) { console.error('负控失败：改坏 .kcard:hover / .row:hover 后仍判绿 ⇒ 判据是假的'); process.exit(1); }
  console.log('负控通过：改坏 .kcard:hover / .row:hover 后抓到 → ' + missing.map((m) => m.name).join('、'));
  process.exit(2); /* ★ 预期退出码 = 2（负控成立）；负控自己失效时上面的 1，不与红同码 */
}

/* ★2026-10-29（回归守卫）：状态矩阵已补回 DESIGN.md §12.3，本分支只在它再次缺失/改名时触发。
   旧代码在这个状态下会把 9 条 REQUIRED 全报成「幽灵控件」并 rc=2 —— 读的人会去
   文档里补 9 行，而那个节根本不在；红指错了地方，比红更坏。
   现在把两种半边分开：
     · 文档侧：契约缺失 ⇒ 无法判定（rc=3 未量），点名补件人与到期，不许当绿；
     · CSS 侧：9 条核心态规则仍逐条判，缺一条仍 rc=2（这半边是真的产品缺陷）。
   没有把任何断言删掉：文档回来（docControls 非空）时，下面的双向对齐原样运行。 */
if (!docControls.length) {
  console.error('🚫 J5 文档契约缺失：DESIGN.md 里没有 §12.3（§12 控件状态矩阵不在或节号被改）');
  console.error('  · 历史矩阵在备份 _bak/tokens-20261028/DESIGN-v1.md:307；备份不是契约，不能拿来判。');
  console.error('  · 补件人：设计规范官（恢复 §12.3 表，或改节号并同改本判据）；到期 2026-11-05。');
  if (missing.length) {
    console.error('  · 同时 CSS 态规则缺 ' + missing.length + ' 条：' + missing.map((m) => m.name).join('、') + '（这半边仍判红）');
    process.exit(2);
  }
  console.error('  · CSS 侧 ' + ALL.length + ' 条态规则都在；文档侧无法判定 ⇒ 本条记 rc=3「未量」，不许当绿。');
  process.exit(3);
}

if (notChecked.length || ghosts.length) {
  console.error('🚫 J5 控件清单与 DESIGN.md §12.3 不一致');
  if (notChecked.length) console.error('  · 文档里有、判据没验：' + notChecked.join('、'));
  if (ghosts.length) console.error('  · 判据在验、文档里没有（幽灵控件）：' + ghosts.join('、'));
  process.exit(2);
}

if (!missing.length) { console.log('J5 状态矩阵：文档 ' + docSet.size + ' 类控件 × 态规则 ' + ALL.length + ' 条，全部有定义'); process.exit(0); }
console.error('🚫 J5 状态缺失 ' + missing.length + ' 条（文档写了、代码里没有）');
missing.forEach((m) => console.error('  · ' + m.name));
process.exit(2);
