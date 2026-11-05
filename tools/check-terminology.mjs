/* check-terminology.mjs —— 术语一致性判据（第 28 门；S5 界面语言环节）
 *
 * 为什么有它：同一件装配关系在这套界面出现过四个说法 ——
 *   apps.html 卡面写「已装 N 个」、component.html 详情写「在用」、
 *   FLOW.md 与报告写「引用」、数据层键名 refs。
 * 客户拿两张截图对照，找不到同一个东西。而 WORKFLOW.md:71 的「已知盲区表」
 * 早就把「术语表」写成判据 —— 那条判据从来不存在。
 *
 * 判什么：**用户在屏幕上读得到的字**（document.title + innerText + placeholder/aria-label/title/option），
 * 不许出现术语台账里登记过的同义词、也不许出现工程词黑名单里的词。代码注释、变量名、数据键不管
 * （那不是界面语言）。
 *
 * ★ 2026-10-28 修（E7，独立盲审实测）：台账与人读版原来是**单向包含**——
 *   `doc.includes(t.canon)` 只问「TERMS 的正名在不在台账里」，于是：
 *     · 台账里有 9 行、TERMS 只有 7 条 —— 多出来的 2 行（应用 / 发布）**写过就等于没写**；
 *     · 台账登记了 20 个禁用替代词，真正会红的只有 8 个；
 *     · 台账里两行结论与机器表相反（「应用 禁用 项目/方案」「发布 禁用 上线/投递」），
 *       —— 台账说禁，机器表根本没这两个词，而页面里「项目审核」「AI 应用方案」到处都是。
 *   单向包含只能证明「机器知道的，人读版也写了」，证明不了「人读版写的，机器都在判」。
 *   现在改成**双向一致**，四条断言（任一不过即 rc=2）：
 *     L1 行数：§一 表格行数 == TERMS 条数
 *     L2 逐词：每条正名、每个禁用词、每条允许上下文，两个方向都要相等
 *     L3 裁决：§四 逐词裁决表里判红的词必须在 TERMS.forbid，TERMS.forbid 的每个词必须有判红行；
 *              退役的词必须带证据（≥12 字），且不许同时出现在 TERMS.forbid（＝结论写反）
 *     L4 工程词：ENGINEER 黑名单与 §五 逐词相等
 *
 * rc：0 无违规；2 有违规（含台账与机器表对不上）；3 环境/页面打不开。
 *
 * 负控六支，各自证明一个不同的采集面／核对面（不许合成一支，否则"抓到了"分不清抓住的是哪一面）：
 *   --negctl          正文注入同义词（模块/停用）        → 必须 2
 *   --negctl-eng      插入 div 写工程词（快照）          → 必须 2
 *   --negctl-title    **只改 document.title**、不插节点  → 必须 2（2026-10-28 补，盲审条件 2）
 *   --negctl-words    把 §一 全部禁用词逐词注入每个页面  → 必须 2（每个词都要被抓到，E7 要求 2）
 *   --negctl-ledger   台账多一行                        → 必须 2（行数断言）
 *   --negctl-forbid   台账写一个闸不管的禁用词          → 必须 2（逐词断言）
 *   --negctl-reverse  台账把一条判红写成退役（结论相反） → 必须 2（裁决断言）
 * 与负控分工的正控自证：
 *   --prove-forbid    不起浏览器，逐词证明匹配器认得 §一/§五 的每一个词（rc=0 才算全认）
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBase, debugPort, PAGES as BASE_PAGES } from './base.mjs';

/* 2026-10-27：版本页原来不在扫描面里 —— 而它恰恰是术语最密的一页
   （版本/状态/保存时间/操作）。漏一页 = 这一页怎么写都没人管，所以就地补上。 */
const PAGES = BASE_PAGES.concat(['versions.html?scope=app&id=hx-zc']);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LEDGER_PATH = join(ROOT, '00c-术语台账.md');
const NEG = process.argv.includes('--negctl');
const NEG_ENG = process.argv.includes('--negctl-eng');
/* 只改标题的负控（2026-10-28 补，盲审条件 2）：
   原来的 --negctl-eng 同时插 div 又改 title，抓到的命中上下文来自 div ⇒ 它证明不了 title 被采到。
   这一档**只动 document.title、不插任何节点**，抓不到就是「标题没进扫描面」。 */
const NEG_TITLE = process.argv.includes('--negctl-title');
/* E7 三支台账负控：打的是「台账与机器表对不对得上」，不需要浏览器。 */
const NEG_LEDGER = process.argv.includes('--negctl-ledger');
const NEG_FORBID = process.argv.includes('--negctl-forbid');
const NEG_REVERSE = process.argv.includes('--negctl-reverse');
const PROVE = process.argv.includes('--prove-forbid');
/* 逐词注入：把 §一 全部禁用词塞进每个页面，任何一个没被抓到就是「这个词判不了」。
   为什么单独一支：--negctl 只注两个词，证明的是「采集面通」；这一支证明的是「每个词都通」。 */
const NEG_WORDS = process.argv.includes('--negctl-words');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';

/* ── 术语台账（机器形态）────────────────────────────────────────
 * canon：这个产品里这件事**只能**这么叫
 * forbid：同义替代词 + 允许出现的上下文正则（allow 命中即不算违规）
 * why：写清代价，免得下一个人以为是在挑字眼
 * ⚠ 这一张表与 00c-术语台账.md 的 §一 双向核对：行数、正名、禁用词、允许上下文四项逐项相等。
 *   改这里必须同步改 00c，否则 rc=2。 */
export const TERMS = [
  /* ⚠ 2026-10-24 首版把「项目 / 方案」也列为同义词，实测全是误报：
     业务名里本来就有「项目审核」「债券承销项目材料」「定制方案」「债承方案」——
     那是客户自己的业务对象，不是「应用」的同义词。判据只该管**我们能选词的地方**：
     关系句式、状态词、装配动作。名字里的字归内容契约管，不归术语表管。
     （2026-10-28：这条口径正式落进 00c §四 的退役行，「应用」不再设禁用词。） */
  { canon: '组件', forbid: ['模块', '插件', '区块'], allow: [], why: '「模块」在别处指后端服务；「插件」「区块」是同一个东西的另外两个说法' },
  { canon: '装配', forbid: ['挂载', '引入', '装载'], allow: [], why: '「装配」是客户会说的词；挂载/引入/装载是工程内部词' },
  /* 「引用」不算违规：它在中文里还指"引文出处"（界面里真有「依据引用」这种句子）。
     首版把它列成 refs 的同义词，实测误报。判据只留真正有人会说的替代词。 */
  { canon: 'N 个应用在用', forbid: ['被 N 个应用使用'], allow: [], why: '2026-10-30 用户点名「被 N 个应用引用」被动且读不出主语，改为主动式；旧说法进禁用，防止回潮' },
  { canon: '已禁用', forbid: ['停用', '暂停'], allow: [], why: '启用态三值：已启用 / 已禁用；「停用」和「已下架」在中文里分不清' },
  { canon: '已装 N 个组件', forbid: ['已装配'], allow: [], why: '应用侧关系写作「已装」，与组件侧「被 N 个应用使用」成对' },
  /* 发布态（2026-10-27 立）：应用/组件对外的状态只有这三个词。
     「草稿」随单一工作区模型退役 —— 现在只有"一份自动保存的当前状态 + 若干快照"，
     没有独立草稿版本。留着的只有历史叙述句（"没有草稿版本""草稿已退役"），由 allow 放行。 */
  { canon: '未发布', forbid: ['草稿'],
    allow: [/没有草稿/, /草稿已退役/, /不再有草稿/, /草稿版本/, /保存草稿/],   /* ★2026-11-04：草稿作为「状态」已退役，但提交区按钮「保存草稿」是动作文案，不是状态名 —— 真机 apps.html/component.html 都有这个按钮 */
    why: '单一工作区里没有草稿这一层；再说"草稿"会让人以为存在两套状态' },
  /* 2026-10-28 补（E7）：台账 §二「发布态」一直把「下线」写作禁用词，机器表里却没有 ——
     于是台账写着禁、闸不管。台帐的结论不是错，是从来没接线，本轮补进来。 */
  { canon: '已下架', forbid: ['下线'], allow: [], why: '发布态第三个值；「下线」在客户处指整套系统停服，粒度不对' },
  /* 2026-10-28 补（E7）：同上，「发布」这一行在台账里存在了三轮，TERMS 里一次都没有。 */
  { canon: '发布', forbid: ['上线', '投递'], allow: [], why: '「上线」在客户处指整套系统上线；「投递」是消息队列的词' },
  /* 2026-10-27 用户原话「我还需要他们额外去学习快照吗？直接就是保存不行吗？」——
     「快照」是从工程侧漏到界面上的词，业务人员不会为它先学一个概念。
     界面上这件事只叫「保存 / 版本」；快照留给代码里的注释与数据结构名。
     （本行引文由 tools/check-quote-provenance.mjs 校验逐字有出处，改动前先跑那条臂。）
     2026-10-28：批次 / 发布号 由 00c §一 原行补进来（台账有、机器表没有）。 */
  { canon: '版本', forbid: ['快照', '批次', '发布号'], allow: [],
    why: '业务人员不认识"快照"；他们要的就是"保存一版、能回到那一版"' },
];

/* ── 工程词黑名单（2026-10-27 立，第二击补牙）─────────────────────────
 * 为什么术语表不够：TERMS 只能管"登记过的同义词"（草稿→未发布 这类），
 * 管不了**新发明**的工程词。10-27 我把"快照"直接写上了界面 —— 术语表全绿，用户看不懂。
 * 这一类的共同点是：词来自代码/实现，不是来自业务岗位。所以单列一张黑名单，
 * 出现在任何可见文本或 title/aria-label/placeholder 里即判红。
 * 加词规矩：只加"业务人员不会说"的实现词；加一个要让 arm 先红一次（--negctl-eng）。
 * 与 00c §五 逐词相等（E7 双向一致）。 */
export const ENGINEER = [
  '快照', '指纹', '哈希', '台账', '入档', '幂等', '序列化', '反序列化',
  'localStorage', 'JSON', 'API', 'SDK', '缓存', '实例', '渲染', '挂载',
  '回调', '路由', '事务', '元数据', '断言', '埋点', '句柄', '数据结构',
];

/* ══ 台账 ⇄ 机器表 双向一致（E7）══════════════════════════════════
 * 这一段纯字符串处理，不开浏览器：台账坏了直接 rc=2，不用等 Chrome。 */

/* 取 <!-- NAME:BEGIN … --> 与 <!-- NAME:END --> 之间的内容。缺段返回 null ——
   缺段不是"空表通过"，是要判红的（否则删掉整段就等于关掉这条判据）。 */
function ledgerBlock(doc, name) {
  const re = new RegExp('<!--\\s*' + name + ':BEGIN[\\s\\S]*?-->([\\s\\S]*?)<!--\\s*' + name + ':END\\s*-->');
  const m = doc.match(re);
  return m ? m[1] : null;
}

function tableRows(block) {
  const rows = [];
  for (const raw of block.split('\n')) {
    const l = raw.trim();
    if (!l.startsWith('|')) continue;
    const cells = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;   /* 分隔行 */
    rows.push(cells);
  }
  rows.shift();                                                /* 表头 */
  return rows;
}

const splitList = (s) => {
  const t = String(s || '').trim();
  if (!t || t === '-' || t === '—') return [];
  return t.split('、').map((x) => x.trim()).filter(Boolean);
};

function ledgerProblems(doc) {
  const P = [];
  const push = (code, text) => P.push({ code, text });

  /* L1 + L2：§一 术语表 */
  const tBlock = ledgerBlock(doc, 'TERMS');
  if (tBlock === null) {
    push('BLOCK', '00c-术语台账.md 缺 <!-- TERMS:BEGIN/END --> 机器读段 —— 台账不再可核');
  } else {
    const rows = tableRows(tBlock);
    if (rows.length !== TERMS.length) push('ROWCOUNT', `台账 §一 ${rows.length} 行 ≠ TERMS ${TERMS.length} 条`);
    const byCanon = new Map(TERMS.map((t) => [t.canon, t]));
    const seen = new Set();
    for (const r of rows) {
      if (r.length < 5) { push('SHAPE', `台账 §一 行不足 5 列：${r.join(' | ')}`); continue; }
      const [canon, forbidCell, allowCell] = r;
      const t = byCanon.get(canon);
      if (!t) { push('CANON', `台账有正名「${canon}」，TERMS 里没有 —— 这一行写了等于没写`); continue; }
      seen.add(canon);
      const lf = splitList(forbidCell);
      const miss = lf.filter((w) => !t.forbid.includes(w));
      const extra = t.forbid.filter((w) => !lf.includes(w));
      if (miss.length) push('FORBID', `「${canon}」台账禁用词「${miss.join('、')}」在 TERMS 里不存在 ⇒ 闸不会判它红`);
      if (extra.length) push('FORBID', `「${canon}」TERMS 禁用词「${extra.join('、')}」台账没登记 ⇒ 人读版看不见`);
      const la = splitList(allowCell);
      const ma = t.allow.map((re) => re.source);
      const amiss = la.filter((w) => !ma.includes(w));
      const aextra = ma.filter((w) => !la.includes(w));
      if (amiss.length) push('ALLOW', `「${canon}」台账允许上下文「${amiss.join('、')}」在 TERMS 里不存在`);
      if (aextra.length) push('ALLOW', `「${canon}」TERMS 允许上下文「${aextra.join('、')}」台账没登记`);
    }
    for (const t of TERMS) if (!seen.has(t.canon)) push('CANON', `TERMS 有「${t.canon}」，台账 §一 没有这一行`);
  }

  /* L3：§四 逐词裁决（判红必须在机器表；退役必须带证据且不许在机器表） */
  const vBlock = ledgerBlock(doc, 'VERDICT');
  if (vBlock === null) {
    push('BLOCK', '00c-术语台账.md 缺 <!-- VERDICT:BEGIN/END --> 逐词裁决段');
  } else {
    const machineForbid = new Map();
    for (const t of TERMS) for (const w of t.forbid) machineForbid.set(w, t.canon);
    const rows = tableRows(vBlock).map((r) => ({ word: r[0], owner: (r[1] || '').trim(), verdict: (r[2] || '').trim(), ev: (r[3] || '').trim() }));
    const redWords = new Set();
    for (const v of rows) {
      if (!['判红', '退役'].includes(v.verdict)) {
        push('VERDICT', `「${v.word}」裁决写了「${v.verdict}」，只许「判红」或「退役」`);
        continue;
      }
      if (v.verdict === '判红') {
        redWords.add(v.word);
        if (!machineForbid.has(v.word)) push('VERDICT', `台账判「${v.word}」为红，TERMS 里没有这个词 —— 闸根本不会判它`);
        else if (v.owner && !v.owner.startsWith('（') && machineForbid.get(v.word) !== v.owner) {
          push('VERDICT', `「${v.word}」台账归属「${v.owner}」，TERMS 归到「${machineForbid.get(v.word)}」—— 结论写反`);
        }
      } else {
        if (machineForbid.has(v.word)) push('REVERSE', `「${v.word}」台账写退役，TERMS 却把它当禁用词（${machineForbid.get(v.word)}）—— 结论相反`);
        if ([...v.ev].filter((ch) => !/\s/.test(ch)).length < 12) push('VERDICT', `「${v.word}」退役没写证据（要 ≥12 字：在哪一页实测到合法用法）`);
      }
    }
    for (const w of machineForbid.keys()) if (!redWords.has(w)) push('VERDICT', `TERMS 禁用词「${w}」在 §四 裁决表里没有「判红」行`);
  }

  /* L4：§五 工程词黑名单 */
  const eBlock = ledgerBlock(doc, 'ENGINEER');
  if (eBlock === null) {
    push('BLOCK', '00c-术语台账.md 缺 <!-- ENGINEER:BEGIN/END --> 工程词段');
  } else {
    const words = eBlock.split(/[、，,\n]/).map((s) => s.trim()).filter(Boolean);
    const miss = ENGINEER.filter((w) => !words.includes(w));
    const extra = words.filter((w) => !ENGINEER.includes(w));
    if (miss.length) push('ENGINEER', `ENGINEER 有「${miss.join('、')}」，台账 §五 没登记`);
    if (extra.length) push('ENGINEER', `台账 §五 有「${extra.join('、')}」，ENGINEER 里没有 ⇒ 闸不会判它`);
  }
  return P;
}

let pass = 0;
let fail = 0;
const out = (ok, label, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const LEDGER_OK_CODE = ['BLOCK', 'ROWCOUNT', 'SHAPE', 'CANON', 'FORBID', 'ALLOW', 'VERDICT', 'REVERSE', 'ENGINEER'];

/* 台账一致性的三行读数：行数 / 逐词 / 裁决各占一行，红在哪一段一眼看得见。 */
function reportLedger(doc, title = '00c-术语台账.md ⇄ TERMS/ENGINEER') {
  const P = ledgerProblems(doc);
  if (!P.length) {
    out(true, title, `${TERMS.length} 条 · 双向一致`);
    return 0;
  }
  out(false, title, `${P.length} 处对不上`);
  for (const p of P) console.log(`      · [${p.code}] ${p.text}`);
  return P.length;
}

/* ── 纯函数：一段文本里命中哪些禁用词（页面扫描与逐词自证共用同一份逻辑）。
   共用是刻意的：如果 --prove-forbid 另写一套匹配，它证明的就不是闸本身。 */
function scanText(text) {
  const hits = [];
  for (const t of TERMS) {
    for (const w of t.forbid) {
      let idx = text.indexOf(w);
      while (idx >= 0) {
        const ctx = text.slice(Math.max(0, idx - 12), idx + w.length + 8).replace(/\s+/g, ' ');
        if (!t.allow.some((re) => re.test(ctx))) hits.push({ word: w, canon: t.canon, ctx });
        idx = text.indexOf(w, idx + w.length);
      }
    }
  }
  return hits;
}

function scanEngineer(text) {
  const hits = [];
  for (const w of ENGINEER) {
    let i = text.indexOf(w);
    while (i >= 0) {
      hits.push({ word: w, ctx: text.slice(Math.max(0, i - 12), i + w.length + 8).replace(/\s+/g, ' ') });
      i = text.indexOf(w, i + w.length);
    }
  }
  return hits;
}

/* ══ 台账负控（不需要浏览器）══════════════════════════════════════
 * 三支各打一条断言；注入只在内存里改 doc 文本，不写盘 —— 盘面永远是用户/作者的那一份。 */
function ledgerNegctl(kind) {
  if (!existsSync(LEDGER_PATH)) { console.log('✗ 台账不存在 ⇒ 未量（rc=3）'); return 3; }
  const doc = readFileSync(LEDGER_PATH, 'utf8');
  /* 前提：现在是绿的。已经红了的话，"注入后还是红"说明不了任何问题。 */
  const base = ledgerProblems(doc);
  if (base.length) {
    console.log(`✗ 负控前提不成立：台账现在就是红的（${base.length} 处），先把它修绿`);
    for (const p of base) console.log(`    · [${p.code}] ${p.text}`);
    return 3;
  }

  let mutated = doc;
  let wantCode = '';
  let what = '';
  if (kind === 'ledger') {
    /* 台账多一行：行数断言必须红 */
    wantCode = 'ROWCOUNT';
    what = '台账 §一 多一行';
    mutated = doc.replace(/(<!--\s*TERMS:END\s*-->)/, '| 幽灵条目 | 负控词 | - | - | 负控注入，跑完即还原 |\n$1');
  } else if (kind === 'forbid') {
    /* 台账写一个闸不管的词：逐词断言必须红 */
    wantCode = 'FORBID';
    what = '台账写一个 TERMS 里没有的禁用词';
    mutated = doc.replace('| 组件 | 模块、插件、区块 |', '| 组件 | 模块、插件、区块、负控瞎词 |');
  } else {
    /* 台账把一条判红写成退役：裁决断言必须红 */
    wantCode = 'REVERSE';
    what = '台账把「快照」从判红改成退役（结论与机器表相反）';
    mutated = doc.replace('| 快照 | 版本 | 判红 |', '| 快照 | 版本 | 退役 | 负控注入：故意写反，用来证明退役与机器表冲突时会被判红 |');
  }
  if (mutated === doc) {
    console.log(`✗ 负控注入失败：没找到注入点（台账格式变了）—— 这一支等于没跑 ⇒ 未量（rc=3）`);
    return 3;
  }

  const P = ledgerProblems(mutated);
  const hit = P.some((p) => p.code === wantCode);
  if (hit) {
    console.log(`负控成立（rc=2）：${what} ⇒ ${P.filter((p) => p.code === wantCode).length} 处 [${wantCode}] 判红（内存注入，盘面未改）`);
    for (const p of P.filter((q) => q.code === wantCode).slice(0, 2)) console.log(`    · [${p.code}] ${p.text}`);
    return 2;
  }
  console.log(`✗ 负控失败：${what} 之后没有出现 [${wantCode}] 判红（实际 ${P.length} 处：${P.map((p) => p.code).join('/') || '无'}）—— 这条断言是空的`);
  return 1;
}

/* ══ 逐词自证（不起浏览器）：每一个禁用词都要被匹配器认出来 ══════════ */
function proveForbid() {
  let bad = 0;
  const terms = TERMS.flatMap((t) => t.forbid.map((w) => ({ w, canon: t.canon })));
  for (const { w, canon } of terms) {
    const ok = scanText(`甲\n${w}\n乙`).some((h) => h.word === w);
    console.log(`  ${ok ? '✓' : '✗'} 禁用词「${w}」⇒ 应为「${canon}」`);
    if (!ok) bad++;
  }
  for (const w of ENGINEER) {
    const ok = scanEngineer(`甲\n${w}\n乙`).some((h) => h.word === w);
    console.log(`  ${ok ? '✓' : '✗'} 工程词「${w}」`);
    if (!ok) bad++;
  }
  /* 反向：允许上下文里的句子不许被误判（否则「草稿已退役」这种历史叙述会永远红） */
  for (const t of TERMS) {
    for (const re of t.allow) {
      const s = re.source;
      if (!re.test(s)) { console.log(`  · 跳过允许上下文 /${s}/（正则不是字面量，无法构造样本）`); continue; }
      const ok = scanText(`甲${s}乙`).length === 0;
      console.log(`  ${ok ? '✓' : '✗'} 允许上下文「${s}」不误报`);
      if (!ok) bad++;
    }
  }
  console.log(`\n逐词自证：${terms.length} 个禁用词 + ${ENGINEER.length} 个工程词 + ${TERMS.reduce((n, t) => n + t.allow.length, 0)} 条允许上下文 ｜ 不认得 ${bad} 个`);
  return bad ? 1 : 0;
}

/* 入口分流：台账负控与逐词自证都不需要浏览器，先跑掉。 */
if (NEG_LEDGER) process.exit(ledgerNegctl('ledger'));
if (NEG_FORBID) process.exit(ledgerNegctl('forbid'));
if (NEG_REVERSE) process.exit(ledgerNegctl('reverse'));
if (PROVE) process.exit(proveForbid());

const CDP_TIMEOUT = 20000;
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id != null && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); } }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.wait.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), CDP_TIMEOUT); }); }
}

console.log('── 术语一致性（只查界面上人读得到的字）');
console.log(`机器表 ${TERMS.length} 条 · 工程词 ${ENGINEER.length} 条`);

/* 台账 ⇄ 机器表（先判账，账不对就不必扫页面了） */
if (!existsSync(LEDGER_PATH)) {
  out(false, '00c-术语台账.md 存在', '人读版缺失 ⇒ 机器条款没人看得见');
  console.log(`\n台账缺失：术语一致性无法成立（rc=2）`);
  process.exit(2);
}
const LEDGER_DOC = readFileSync(LEDGER_PATH, 'utf8');
reportLedger(LEDGER_DOC);
if (fail) {
  console.log(`\n台账与机器表对不上：先改 00c 或 TERMS，再谈页面（rc=2）`);
  process.exit(2);
}

let BASE;
try { BASE = await resolveBase(); } catch (e) { console.log('SKIP: ' + e.message); process.exit(3); }

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/term-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) { /* 未起 */ } await sleep(200); }
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); chrome.kill(); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
const c = new CDP(ws);
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160));
  return r.result.value;
};

/* 收集"人读得到的字"：正文 + 可访问名 + 选项文案 + **页面标题**
   ★2026-10-28 补（盲审条件 2）：原来只拼 body.innerText 与 placeholder/aria-label/title 属性，
     `document.title` 不在扫描面 —— 而标题会显示在浏览器标签、任务栏、窗口列表上，是客户读得到的第一行字。
     盲审实测：把整页标题改成「快照」而正文不动，这条闸保持全绿（采集长度 1325→1325 一点没变）。
     现在标题第一个进采集面；只改标题的负控见 --negctl-title。 */
const COLLECT = `JSON.stringify((() => {
  const t = [document.title || '', document.body.innerText || ''];
  for (const el of document.querySelectorAll('[placeholder],[aria-label],[title],option,summary,th')) {
    for (const a of ['placeholder', 'aria-label', 'title']) { const v = el.getAttribute && el.getAttribute(a); if (v) t.push(v); }
    if (el.tagName === 'OPTION' || el.tagName === 'SUMMARY' || el.tagName === 'TH') t.push(el.textContent || '');
  }
  return t.join('\\n');
})())`;

let tHit = 0;
let wordPages = 0;

console.log(`页面 ${PAGES.length} 个 · 基址 ${BASE}`);

for (const page of PAGES) {
  let text = '';
  try {
    await c.send('Page.navigate', { url: `${BASE}/${page}` });
    await sleep(800);
    if (NEG_ENG) await ev(`(() => { const d = document.createElement('div'); d.className='neg-eng'; d.textContent = '快照'; document.body.appendChild(d); document.title='快照'; return true; })()`);
    if (NEG_TITLE) await ev(`(() => { document.title = '快照'; return true; })()`);
    if (NEG_WORDS) {
      /* 每个禁用词一个节点，避免连成一串后上下文互相污染（比如「没有草稿」的允许上下文）。 */
      const words = JSON.stringify(TERMS.flatMap((t) => t.forbid));
      await ev(`(() => { const d = document.createElement('div'); d.className = 'neg-words'; d.style.cssText = 'position:absolute;left:-9999px;top:0'; for (const w of ${words}) { const s = document.createElement('div'); s.textContent = w; d.appendChild(s); } document.body.appendChild(d); return true; })()`);
    }
    if (NEG) await ev(`(() => { const el = document.querySelector('.kcard .card-tx') || document.querySelector('.kcard') || document.querySelector('main'); if (!el) throw new Error('no target'); el.appendChild(document.createTextNode(' 模块')); const d = document.createElement('div'); d.className = 'neg-term'; d.textContent = '停用'; document.body.appendChild(d); return true; })()`);
    text = JSON.parse(await ev(COLLECT));
  } catch (e) { console.log(`  ⚠ ${page} 打不开：${String(e.message).slice(0, 80)}`); fail++; continue; }

  const hits = scanText(text);
  out(hits.length === 0, `${page} 无同义词`, hits.length ? hits.slice(0, 4).map((h) => `${h.word}→应为「${h.canon}」｜…${h.ctx}…`).join(' ；') : `${text.length} 字`);

  /* 工程词：一个都不许出现在界面上 */
  const eng = scanEngineer(text);
  out(eng.length === 0 ? true : NEG_TITLE, `${page} ${NEG_TITLE ? '只改标题的负控被抓到' : '无工程词泄漏'}`,
      eng.length ? eng.slice(0, 4).map((h) => `${h.word}｜…${h.ctx}…`).join(' ；') : '0 处');
  /* 只改标题档的计数与普通档分开：混进同一个 fail，rc=2 就分不清是「负控成立」还是「注入没生效」。 */
  if (NEG_TITLE && eng.length > 0) tHit++;
  if (NEG && page === PAGES[0] && hits.length === 0) { console.log('  ✗ 负控注入后仍未命中 ⇒ 判据不会红'); fail++; }
  if (NEG_ENG && page === PAGES[0] && eng.length === 0) { console.log('  ✗ 工程词负控注入后仍未命中 ⇒ 这条臂不会红'); fail++; }
  if (NEG_WORDS) {
    /* 逐词：每一个禁用词都要在本页被抓到。少一个 = 那个词写进 TERMS 也判不了。 */
    const caught = new Set(hits.map((h) => h.word));
    const all = TERMS.flatMap((t) => t.forbid);
    const lost = all.filter((w) => !caught.has(w));
    if (lost.length) console.log(`  ✗ ${page} 逐词注入有 ${lost.length} 个词没被抓到：${lost.join('、')}`);
    else wordPages++;
  }
}

console.log('');
console.log(`通过 ${pass} ｜ 断点 ${fail} ｜ 禁用词 ${TERMS.reduce((n, t) => n + t.forbid.length, 0)} 个 · 工程词 ${ENGINEER.length} 条`);
chrome.kill();

if (NEG_WORDS) {
  const all = TERMS.flatMap((t) => t.forbid).length;
  /* 只看「每页每个词都抓到」。这里 fail>0 是**预期的**（注入了词，页面当然被判红），
     拿它当失败条件会让负控永远 rc=1 —— 与 --negctl 档同一个坑。 */
  const ok = wordPages === PAGES.length;
  console.log(ok
    ? `负控成立（rc=2）：${PAGES.length}/${PAGES.length} 页、每页 ${all}/${all} 个禁用词逐词注入全部被抓到`
    : `负控失败（rc=1）：只有 ${wordPages}/${PAGES.length} 页全部抓到 —— 有词写进 TERMS 也判不了`);
  process.exit(ok ? 2 : 1);
}
if (NEG_TITLE) {
  const okTitle = tHit === PAGES.length;
  console.log(okTitle
    ? `负控成立（rc=2）：${PAGES.length}/${PAGES.length} 页只改 document.title 即被抓到`
    : `负控失败（rc=1）：只有 ${tHit}/${PAGES.length} 页抓到 —— 「标题」还没进扫描面`);
  process.exit(okTitle ? 2 : 1);
}
if (NEG) { console.log(fail ? '负控成立（rc=2）' : '负控失败：注入后仍全绿'); process.exit(fail ? 2 : 1); }
process.exit(fail ? 2 : 0);
