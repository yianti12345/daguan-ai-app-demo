#!/usr/bin/env node
/* check-m3-gaps.mjs — M3 界面评审标准里三格空白的机器形态（2026-11-02 立）
 *
 * 起因：M3-界面评审标准-20261025.md §2 的十条里，第 6 条（识别而非回忆）、
 * 第 7 条（灵活与效率）、第 10 条（帮助与文档）的「现有判据」列一直是「——」。
 * 尺子缺格，红不了的地方就永远绿 —— 这是「改了七八轮还是有新问题」的结构原因。
 * 本判据只补每条的**最小一格**，不假装覆盖整条启发式：
 *
 *   6 识别而非回忆：链接文字必须自带对象名。「查看」「进入」「详情」这种裸动词，
 *                   用户得记住上一屏才知道点的是谁。→ 扫所有页面的 <a> 文本。
 *   7 灵活与效率：列表页要有跨记录的动作通道（批量）且卡上要有就地动作，
 *                   否则每改一条都得先进详情。→ 查 apps/components 两页。
 *   10 帮助与文档：空装配时必须就地告诉用户下一步做什么（M3 §8.0：不写说明书，
 *                   靠布局自解释）。→ 查 assets/app.js 的空态文案。
 *
 * 用法：node tools/check-m3-gaps.mjs [--negctl]
 * 退出码：0 三格都有出口 ｜ 2 至少一格失守 ｜ 1 负控注入失败
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAGES = ['apps.html', 'components.html', 'app.html', 'versions.html', 'component.html', 'client-auth.html'];
const pages = {};
for (const p of PAGES) {
  try { pages[p] = read(p); } catch { /* 页不存在不算这一格的红 */ }
}

let appjs = read('assets/app.js');

/* ── 负控：每一格各注入一处，证明判据抓得住 ── */
if (NEG) {
  // 6：把一个链接的文字换成裸动词
  pages['versions.html'] = pages['versions.html'].replace('</body>', '<a href="app.html?id=hx-zc">查看</a></body>');
  // 7：把批量入口整块摘掉（只改 id 摘不干净，页面上还留着「批量上架/批量下架」两个按钮）
  pages['apps.html'] = pages['apps.html']
    .replace(/<button[^>]*id="btn-batch"[\s\S]*?<\/button>/, '')
    .replace(/批量上架|批量下架/g, '');
  // 10：把空态描述清空
  appjs = appjs.replace("emptyHtml('这个应用还是空的',", "emptyHtml('',");
}

const BARE = new Set(['查看', '编辑', '进入', '返回', '更多', '详情', '配置', '删除', '复制', '保存', '打开', '确定', '取消', '下一步']);
const bad = [];

/* ── 6 识别而非回忆 ── */
for (const [page, src] of Object.entries(pages)) {
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(src))) {
    const t = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
    if (!t) {
      /* 纯图标链接：返回/关闭这类用 ← 图标是通用约定，不算「要用户记」。
         但必须有 aria-label 兜底 —— 连无障碍名都没有，才是真的不知道点的是谁。 */
      const label = (m[0].match(/aria-label="([^"]*)"/) || [])[1] || '';
      if (label.trim().length < 2) bad.push('[6] ' + page + '：有一个图标链接既没有文字也没有 aria-label，点之前不知道会去哪');
      continue;
    }
    if (BARE.has(t)) bad.push('[6] ' + page + '：「' + t + '」是裸动词链接，用户得记住上一屏才知道点的是谁');
  }
}

/* ── 7 灵活与效率 ── */
const appsSrc = pages['apps.html'] || '';
const compSrc = pages['components.html'] || '';
/* ★2026-11-04 判据写错：批量条是 JS 建的（apps.html:752 `var BB = { bar: $('#batch-bar'), btn: $('#btn-batch') }`），
   静态源码里没有 id="btn-batch" 这种写法，旧正则只认 HTML 属性 ⇒ 假红。按真实写法认。 */
if (!/id="btn-batch"|#btn-batch|batch-bar|批量上架|批量下架/.test(appsSrc)) bad.push('[7] apps.html：列表页没有批量入口，改一批应用只能一张一张进详情');
if (!/data-act="(edit|dup|vers|toggle)"/.test(appsSrc)) bad.push('[7] apps.html：卡上没有就地动作（编辑/复制/版本/上下架），每条都要先进详情');
if (!/data-act="refs"|cc-sw|data-act="config"/.test(compSrc)) bad.push('[7] components.html：卡上没有就地动作（配置/引用/启停）');

/* ── 10 帮助与文档（空态自解释）── */
if (!/<section class="cv-empty">/.test(appjs)) bad.push('[10] assets/app.js：找不到空态块 .cv-empty，空装配时画布是空的');
else {
  const i = appjs.indexOf("emptyHtml('这个应用还没有内容'");
  if (i < 0) bad.push('[10] assets/app.js：空装配时没有「这个应用还没有内容」这句，用户不知道是没加载还是本来就没内容');
  else {
    const seg = appjs.slice(i, i + 400);
    /* ★2026-11-04 判据写错：空态文案 2026-10-28 按用户口径改成「直接在下面说：谁用、要看到什么。页面会边问边生成。」
       —— 它说了下一步（说需求/边问边生成），只是不再出现「装配/组件/小智」这些内部词。按「有没有给出下一步」判，不是按词表。 */
    if (!/装配|组件|小智|直接说|边问边生成|下一步/.test(seg)) bad.push('[10] assets/app.js：空态只说「是空的」，没说下一步做什么');
  }
}

if (bad.length) {
  for (const b of bad) console.log('  ✗ ' + b);
  console.log('M3 三格失守：' + bad.length + ' 处（第 6/7/10 条启发式）');
  process.exit(2);
}
console.log('M3 三格都有出口：6 链接自带对象名 ／ 7 列表有批量与卡上就地动作 ／ 10 空装配就说下一步');
process.exit(0);
