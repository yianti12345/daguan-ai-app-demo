#!/usr/bin/env node
/* oracle: self —— 本判据的期望值就是「卡面禁用词清单」这条规则本身，
   没有外部基线可对；它的红绿由负控（坏样本必须判红）证明，不是靠和实现对齐。
   2026-11-04 check-baseline-oracle 要求每个判据声明期望值来源。 */
/* ─────────────────────────────────────────────────────────────
   check-card-copy.mjs —— 列表卡"内容溯源"判据。

   为什么要有它（2026-10-24 用户 m04062）：
   卡上曾经长出「应用头 · 页面类」「字段 5 项」「装配 5 个应用」这些东西 ——
   数据里确实有 type / fields / refs，但它们是**实现层**的属性，
   列表页读者不需要；图标砖甚至是纯装饰（FAM_ICON 是我画的 svg）。
   20 道门禁没有一条问过"这个字在产品里存不存在"，于是全绿也照样错。

   本判据的做法：把两个列表页的卡片模板里**写死的中文文案**抽出来，
   逐条对照白名单；白名单之外的任何中文串都必须能指到 data.js 的字段
   或用户原话，否则判红。红 = 卡面出现了没人背书的信息。

   ★2026-10-25 重定向（components.html 由 4 列卡片阵列改成单列行式列表）：
   断言一条没删，只把"卡片模板"从 <article class="kcard"> 换成新骨架：
     · components.html 的"卡"＝一行 <div class="crow">，模板变量 rowHtml，
       区域从 `const rowHtml = shown.map((c) => {` 起到行末的 `</div>`;` 为止。
       这段比旧卡模板覆盖面更大：连 usedBy/names/descText 三个派生变量
       （真名现算、`还没有应用使用`、`还没有填写说明` 两个兜底串）一起纳入判据。
     · 新增的一行表头 .cl-head（本次结构变化才出现的写死文案）单独作为
       一个区域纳入判据，用 extra **只**放行它那 5 个列头词，不写进全局
       白名单（extra 是整串相等放行，不是前缀吃掉，别处写这些词照样判红）。
     · apps.html 区域一字未改（那页仍是 .kcard）。

   用法：
     node tools/check-card-copy.mjs            # 判定（rc=0 绿 / rc=1 红）
     node tools/check-card-copy.mjs --negctl   # 负控：故意塞一句编造的文案，必须被抓
   ───────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* 白名单：卡面允许出现的写死文案。每一条都要说清"它对应哪个数据/哪句用户原话"：
     · 状态值（已上架 / 草稿 / 已下架 / 已禁用）—— data.js 的 status 枚举原样输出
     · 「还未发布」—— version === 0 时的说法（data.js: version 0 = 一版没发过）
     · 「被 N 个应用使用」「还没有应用使用」—— refs 现算（data.js recomputeRefs）
     · 「配置 / 版本管理」—— 卡上动作，用户 m03780 点名要的两个操作
     · 「更多操作：」—— ⋯ 按钮的 aria-label 前缀，用户 m01293 原话「卡片有个三个点点点，意思是更多操作」
       （后面接的是卡片名，来自 data.js 的 label，不是写死文案）
     · 「编辑信息 / 停用 / 启用 / 上架 / 下架」—— 菜单项，全部由 data.js 的 status 枚举派生
       （已上架⇒下架、已下架/草稿⇒上架；enabled=false⇒启用），用户 m01293 点名「上下架、启用停用」
     · 「复制链接」—— 卡面 URL 的直接复制，用户 m01293 的「更多操作」清单；Toast 文案「链接已复制」
     · 「被哪些应用使用」—— 浮层标题，与「被 N 个应用使用」同源（refs 现算，data.js recomputeRefs），
       正文是 DB.APPS.filter(a => a.comps.includes(id)) 现算出来的应用名
     · 「个组件」—— comps 计数
   其它一切中文（页面类 / 能力类 / 字段 / 装配 / 当前版本 / 更多操作 / 复制链接 …）
   都判红：它们要么是实现属性，要么是内部口径，要么根本没有场景。 */
const ALLOW = new Set([
  /* 2026-11-02：多客户授权模型（用户 m01548「每个客户有当时授权的版本」）后卡面新增的
     派生文案。它们全部由 DB.authRows / DB.latestVer 现算，不是写死的产品口径：
       · 「N 家客户还停在旧版本（最新 vX）」/「N 家待升级」= behind 计数（authRows 里已授权且 version<latestVer）
       · 「N 个组件可升级」= 装配组件当前版本 < 库内版本（UIK.badgeLabel(upd)）
       · 「编辑应用」= ⋮ 菜单项，用户 2026-11-01 原话点名「新增应用和编辑应用的时候…」
       · 「最近更新」= 卡底时间的 title 前缀，用户 2026-11-01「我在这里应该直接看到最近更新的时间」 */
  '家客户还停在旧版本（最新', '），点卡片进去升级', '家待升级',
  '，点卡片进去一键升级', '个组件可升级', '可升级',
  '编辑应用', '最近更新',
  /* ★2026-11-04（用户 m07271：「版本号与版本更新时间一起下放到卡底规格条」）
     卡底规格条新增三处派生文案，全部有数据来源、不是编的：
       · 「当前版本」= .cc-ver 的 title，值取 c.ver（components.html:613）
       · 「版本更新时间」= .cc-upd 的 title，值取 c.updated（components.html:614）
       · 「个应用待升级」= refUp.behind 现算（同一引用数的 title，components.html:549） */
  '当前版本', '版本更新时间', '个应用待升级',
  /* ★2026-11-04 同一处卡底引用数的 aria-label（components.html:549）：
     「共 N 个应用在用，M 个待升级，点开引用管理」—— N/M 都是 DB.APPS.filter 现算。 */
  '共', '个应用在用，', '个待升级，点开引用管理',
  /* ★2026-11-04 底栏电源钮的无障碍标签（apps.html:725）：`状态操作：<应用名>，当前<三态>`。
     名字来自 a.name、状态来自 pubState(a)，都是数据面现算。 */
  '状态操作：', '，当前',
  /* ★2026-11-04（2026-11-03 三态动作，apps.html:305）：三态与两条迁移动作的按钮文案，
     集合本身来自 tools/truth-apps-menu.json 的 states（真机抓取），不是随手写的词。 */
  '未上架', '内测中', '已上架', '发布内测版', '上架正式版', '下架',
  /* ★2026-11-04 卡上 ⋮ 菜单项文案：真源 tools/truth-apps-menu.json（2026-11-03 bsk 从真系统抓），
     本地同义写法见该文件 local_aliases。 */
  '客户配置', '编辑信息', '复制应用', '版本管理', '导出应用', '删除应用',
  /* 2026-11-02：卡底 disabled 电源位与「待升级」title 改准确说法后的片段。
     · 「未发布，不能上下架」/「发布后才能上架」= 草稿卡电源 disabled 的无障碍名与 title；
       来源是状态规则（草稿不能上下架），不是新写的产品文案；
     · 「），在」/「里进「客户授权」升级」= 「N 家客户还停在旧版本（最新 vX），在 ⋮ 里进「客户授权」升级」
       被 ${} 与标点切开的片段；整句由 behindCnt 现算，出处是用户 m01548 的多客户授权模型。 */
  '未发布，不能上下架', '发布后才能上架', '），在', '里进「客户授权」升级',
  '·',
  '已上架', '草稿', '已下架', '已禁用',
  /* ★2026-10-27：发布态在 10-27 由「草稿」改名为「未发布」（data.js syncOwner 派生的
     status 枚举值：未发布 / 已上架 / 已下架）。卡面标签直接印 a.status，
     所以这里放行的是**数据枚举**，不是新写的文案。'草稿' 留着给老存档读回时的兜底。 */
  '未发布',
  '还未发布', '还没有发布',
  '被 ', ' 个应用使用', '还没有应用使用',
  /* 2026-10-30：引用数文案改主动语态（用户点名「被 N 个应用引用」这句有问题，
     改为「N 个应用在用 / 还没有应用在用」）。数值仍由 DB.APPS 现算，与 data.js
     recomputeRefs 同源；旧两条留着给老存档与其它页兜底。 */
  ' 个应用在用', '还没有应用在用',
  ' 个组件',
  '配置', '版本管理', '更多操作', '更多操作：',
  /* ★2026-11-01：「客户授权」＝那个页面的标题本身（client-auth.html 的 h1 就是这四个字），
     菜单项指的是"去那一页"，不是卡面新写的文案。出处＝页面标题，可点开核对。 */
  '客户授权',
  /* 2026-11-01：操作缺口补齐时加的三项，出处分别是 data.js 的动作名与页面动作 */
  '删除', '复制应用', '导出应用',
  /* ⋯ 菜单项与浮层标题（provenance 见上：status 枚举派生 / refs 现算 / 用户 m01293 原话） */
  '编辑信息', '停用', '启用', '上架', '下架', '复制链接',
  '被哪些应用使用',
  /* ★2026-10-29：用户当场反馈「被哪些应用使用」7 字是被动长句，与同菜单「编辑信息/版本管理」
     不同构，且与卡底那行重复 ⇒ 改为 4 字主动式「查看引用」。出处＝用户原话，不是自拟文案。 */
  '查看引用',
  '还没有填写说明',
  /* 2026-10-25 行式列表新增：c.type 的枚举值（data.js COMPS[].type ∈ {能力类,页面类}，
     实测 8 条里 能力类×2 / 页面类×6）。它**只用来选图标**（c.type === '能力类' ? 能力 : 页面），
     不上卡、不印字 —— 所以放行的是"比较用的枚举"，不是卡面文案。 */
  '能力类',
  /* ★2026-10-26：「打开」来自 `aria-label="打开 ${a.name}"` —— 那是**无障碍标签，不是卡面文案**。
     判据是按区域抓中文串的，抓不到"这句是属性还是文本"的区别。
     放行它不等于放行任意编造文案：它的来源是 a.name（真字段），拼法是固定前缀。 */
  '打开', '打开 ',
  /* ★2026-10-30 用户点名「复制组件和复制应用」「导出」是基本逻辑：
     四个动作名由两种载体派生 —— 应用→复制应用/导出应用，组件→复制组件/导出组件，
     后半截都是对象名，没有自拟词。 */
  '复制应用', '导出应用', '复制组件', '导出组件',
]);

const PAGES = [
  { file: 'apps.html', marker: "return '<article class=\"kcard\"", end: '</article>\';' },
  /* components.html：单列行式列表的"卡"＝一行。marker 取派生变量块开头，
     这样 usedBy/names/descText 与行模板是同一个被查区域。 */
  { file: 'components.html', marker: 'const rowHtml = shown.map((c) => {', end: '</div>`;' },
  /* ★2026-10-29（盲审：「查看引用」在取样区外，这条绿不证明新文案有溯源）：
     菜单文案不是字面量，是 `REFS_MENU_LABEL` 变量拼进去的，光扫模板抓不到。
     把这条定义行单独纳入取样，新文案才真的落在射程里。 */
  { file: 'components.html', marker: "const REFS_MENU_LABEL = '", end: "';" },
  /* ★2026-10-28 删（盲审条件 4）：这里原来还有一条 optional 的 `.cl-head` 表头区域。
     它对应的行式列表表头早已从页面删掉（10-25 之后组件库换成了卡片），于是每次跑都打一行
     「无该区域（optional，已跳过）」，读起来像「components.html 已被覆盖」，实际那一条永远不取样。
     死区域留着只会让覆盖看起来比实际宽 —— 删掉，覆盖由下面这条 rowHtml 区域单独证明。 */
];

function cardRegion(src, page) {
  const i = src.indexOf(page.marker);
  if (i < 0) return null;
  const j = src.indexOf(page.end, i);
  if (j < 0) return null;
  return src.slice(i, j + page.end.length);
}

/* 从模板里抽出"字符串字面量中的中文片段"：模板里既有单引号拼接也有反引号模板，
   统一按引号切段，再看段里有没有中文。${...} 表达式整段跳过（那是真数据）。 */
function chineseChunks(region) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(region))) {
    let body = m[2];
    body = body.replace(/\$\{[^}]*\}/g, '\u0000');   /* 表达式占位，不参与判定 */
    for (const part of body.split('\u0000')) {
      for (const seg of part.match(/[^A-Za-z0-9<>{}\/=\s'"():;,.#%+\-—⇒「」…]*[\u4e00-\u9fa5][^A-Za-z0-9<>{}\/=\s'"():;,.#%+\-]*/g) || []) {
        const t = seg.trim();
        if (t) out.push(t);
      }
    }
  }
  return out;
}

/* 白名单是"整串"比对；模板里常出现 "被 5 个应用使用" 这种被 ${} 切断的片段，
   所以按"最长可匹配前缀"的方式逐段吃掉，剩下不能归到任何白名单条目才判红。 */
const norm = (s) => String(s).replace(/\s+/g, '');

function residual(text, extra) {
  let s = norm(text);
  /* extra 只做整串相等放行（区域专属的列头词），不进前缀吃掉那套 */
  if (extra && extra.some((e) => norm(e) === s)) return '';
  const keys = [...ALLOW].map(norm).filter(Boolean).sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const k of keys) {
      if (s.startsWith(k)) { s = s.slice(k.length); changed = true; break; }
    }
  }
  return s;
}

const argv = process.argv.slice(2);
const NEG = argv.includes('--negctl');
/* ★2026-10-28 补（盲审条件 4 的分母断言）：这一支打的是「一页切出 0 段也必须判红」。
   做法是把 components.html 的取样结果清空（只在内存里），正控那条路仍然照跑。
   为什么必须单独一支：--negctl 的刀是**追加**到 chunks 上的，区域为空时刀还在，抓得到 ——
   它证明不了"分母为空会被发现"。这一支才是分母断言的负控。 */
const NEG_BLANK = argv.includes('--negctl-blank');

let bad = [];
let total = 0;
/* 每页真的扫到了几段 —— 这张表就是「覆盖」的证据。
   ★2026-10-28 加（盲审条件 4）：原来只有一句 `new Set(PAGES.map(p=>p.file)).size` 印「2 页」，
   它是**名单长度**，不是**扫到的页数**：components.html 的 marker 一旦漂走或切出空串，
   判据照样印「2 页 / 19 段」，而实际上只查了一页。分母缺失印 0 是本仓记过的假绿形态。 */
const scanned = new Map();
const REQUIRED_PAGES = ['apps.html', 'components.html'];
/* 负控刀：每页各塞一句"数据里根本没有"的卡面文案。
   components.html 那一刀同时是"新区域非空"的自证 —— 若 marker 换错位置切出空串，
   正控会因为 0 段中文而假绿；负控必须仍能抓住注入才说明这一段真被扫到。 */
const KNIVES = { 'apps.html': '字段 5 项', 'components.html': '装配 5 个应用' };
const knivesHit = [];
for (const page of PAGES) {
  let src;
  /* ★2026-10-26 修假红：必须先剥注释再扫。
     这条判据判的是"卡面上有没有编造的文案"，而它是按区域从源码里抓中文串 ——
     于是 JS 注释「把客户能看的地址给他」、HTML 注释「组件卡与应用卡是两种气质」
     全被当成卡面文案判红。**注释不是界面**。
     同类已踩过一次（J1 把注释里的色值当裸值），所以这里保留换行、只把注释内容抹成空格，
     报错行号才不会漂。 */
  try {
    src = readFileSync(join(ROOT, page.file), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  }
  catch { console.log(`✗ 读不到 ${page.file}`); process.exit(2); }
  const region = cardRegion(src, page);
  if (!region) {
    if (page.optional) { console.log(`  · ${page.file} 无该区域（optional，已跳过）`); continue; }
    console.log(`✗ ${page.file} 里找不到卡片模板（marker 变了就同步改本判据）`); process.exit(2);
  }
  let chunks = chineseChunks(region);
  if (NEG_BLANK && page.file === 'components.html') chunks = [];   /* 分母归零的负控 */
  if (NEG && KNIVES[page.file]) { chunks = chunks.concat([KNIVES[page.file]]); knivesHit.push(page.file); }
  const acc = scanned.get(page.file) || { regions: 0, chunks: 0 };
  acc.regions++; acc.chunks += chunks.length;
  scanned.set(page.file, acc);
  for (const c of chunks) {
    total++;
    const rest = residual(c, page.extra);
    if (rest) bad.push({ file: page.file, text: c, unaccounted: rest });
  }
}

/* 覆盖分母（盲审条件 4）：名单上的页必须真的切出区域、且区域非空。
   一条都不用加白名单 —— 这一节判的是"判据自己有没有量到"，不是"卡面文案对不对"。
   ⚠ 负控档跳过：注入句不改变"扫到几段"，这一节在负控里结果相同。 */
if (!NEG) {
  for (const f of REQUIRED_PAGES) {
    const s = scanned.get(f);
    if (!s) bad.push({ file: f, text: '（整页没被扫）', unaccounted: 'marker 没命中 —— 这一页的卡面文案本轮一段都没查' });
    else if (s.chunks === 0) bad.push({ file: f, text: '（整页 0 段中文）', unaccounted: '区域切出来了但一段中文都没有 —— marker 切错位置或模板换了写法，分母为 0 时"未登记 0"是假绿' });
  }
}

if (bad.length) {
  console.log(`✗ 卡面出现 ${bad.length} 处无法溯源的中文文案（共查 ${total} 段）`);
  for (const b of bad) console.log(`   ${b.file}: 「${b.text}」 —— 归不到白名单的片段「${b.unaccounted}」`);
  console.log('   处理：要么删掉，要么在 ALLOW 里补一条并写清它对应 data.js 的哪个字段 / 哪句用户原话。');
  /* 本仓所有判据的 rc 语义（tools/run-gates.sh 第 6 行）：0=绿 / 1=判据自身红 /
     2=负控被打红（--negctl 时"抓住注入"的约定退出码）/ 3=未量。
     ⇒ 负控抓住必须退 2，不能退 1，否则 run-gates --negctl 读不出"这条能被逼红"。 */
  process.exit(NEG || NEG_BLANK ? 2 : 1);
}
const cover = [...scanned.entries()].map(([f, s]) => `${f} ${s.chunks} 段`).join(' ｜ ');
console.log(`✓ 卡面文案全部可溯源：扫到 ${scanned.size} 页 / ${total} 段中文，未登记 0`);
console.log(`  覆盖：${cover}`);
if (NEG) console.log(`  （负控已注入 ${knivesHit.map((f) => f + '「' + KNIVES[f] + '」').join(' / ')} 并被拦截）`);
