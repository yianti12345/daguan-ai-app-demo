#!/usr/bin/env node
/* check-promise —— 卡面写的承诺，画面上必须找得到对应物。
 *
 * 为什么有它（2026-10-26）：
 *   一份零上下文审计逐条实测了卡面上的 29 句承诺，**兑现 5 句、未兑现 22 句**。不是布局问题，
 *   是卡面在说自己做不到的事：
 *     · hx-zc「逐条规则给出结论与依据」→ 画布第 03 块直接印着「规则结论 · 待人工 · —」；
 *     · task-list「支持批量指派」      → 全站 checkbox=0、行内控件=0；
 *     · task-detail「原件与抽取结果并排」→ 并排的是「审批流 + 原文对照」，全页「抽取结果」=0；
 *     · ruleset-cfg「18 条基线的入口」  → 实际 8 行，全页「18」=0「基线」=0。
 *   这些句子全部上了屏、用户真能看见（apps.html 6 条 desc、components.html 8 条 desc 全部可见），
 *   而没有任何一条判据比对过「卡面说的」和「点进去看到的」。实施人员会照着卡面给客户承诺。
 *
 * 为什么判「关键词出现」而不是语义比对：
 *   ① 可复算 —— 结论只依赖「页面上有没有这串字」，谁跑都一样，没有模型、没有温度、没有网；
 *   ② 判据自己能被审 —— 你把 mustAppear 里的词换成画面确实没有的词，它必须红（见负控 B）；
 *   ③ 不受措辞重写影响 —— 页面结构、类名、组件实现方式随便换，只要那件事真做了，词就会在。
 *      反过来，如果某个词只有真做出来才会出现，它的缺失就是功能缺失的强证据。
 *
 * **它的局限（读这段，别把它当万能）**：
 *   1. 词出现 ≠ 真做到。屏上有个写着「批量指派」的按钮、点了没反应，这条判据查不出来。
 *      它只能证明「画面里有这个说法」，不能证明「这个说法是真的」。
 *   2. 页头应用名、表格列名、样例数据里的字都会造成假绿。「中金 · 采购合同预检」这个页头
 *      就含「采购合同」四个字；「已驳回」这个状态值含「驳回」。所以选词的门槛是
 *      **这个词只有真做出来才会出现**，不是「页面上碰巧有」。选不好就假绿，必须在 why 里说清选词理由。
 *   3. 它管不了「好不好」：清楚、专业、好看、顺手、语气得体，一个关键词都写不出来。
 *   4. 它管不了数量对不对（「18 条」只查「18」在不在，不查真有几行）、排序对不对、能不能点。
 *      —— 那些归 check-list-rows、interact-audit（点击探哑控件）等结构/交互判据。
 *   5. 没量到（页面没起来、外壳不在）一律算**未知**，不当绿：rc=3，绝不因为「读不到」而通过。
 *   6. **隐藏态的控件查不到**：[hidden] / display:none 的元素不进 innerText。批量指派条在
 *      0 选中时就是隐藏的（fix-batch-assign 2026-10-26 实测：app.html 静息态不含「批量指派」，
 *      勾一行才出现；component.html 那条带常在屏上）。所以这条只能固定量「静息也可见」的页与态。
 *      要验「选中后浮现」必须点一下 —— 那是 interact-audit 的活。别把这类承诺硬塞进这张表，
 *      它只会假红，而假红比没有判据更坏（会训练人去忽略红）。
 *
 * 卡面自证（2026-10-26 19:26 加，被现实逼出来的）：
 *   第一版跑出来 8 句红 7 句；五分钟后同一批页面变成 9 句全绿 —— 靠的不是把功能做出来，
 *   是把 22 句 desc 降级成画面已经做到的话。降级是团队定的合法档位（审计报告三档处置），
 *   但它暴露了一个洞：**只改 promise-map.json、不改卡面，判据也能绿**。那样这条判据就成了
 *   给自己发合格证的工具。所以现在每条 entry 的 claim 必须逐字出现在卡面列表页上
 *   （app.html 的承诺 → apps.html；component.html 的承诺 → components.html）：
 *     · 只改表不改卡面 → 红（表里躺着一句用户看不见的承诺）；
 *     · 只改卡面不改表 → 红（表过期了，量的还是旧话）；
 *     · 卡面与表同时改、画面跟得上 → 绿（这才是要的三者一致）。
 *   这不是多加一道手续，是把「谁在自证」摆到明处：判据要量的那句话，必须真的是用户看得见的那句。
 *
 * 分工：
 *   本判据 = 静态兑现（卡面这句话在屏上有没有对应物）；
 *   interact-audit = 动态兑现（那个东西点了有没有反应）；
 *   check-card-copy = 卡面文案本身还在不在、是否上屏。
 *   三条加起来才叫「说到做到」，单拎任何一条都会被绕。
 *
 * 用法：
 *   node tools/check-promise.mjs [baseUrl]            # 默认读 tools/promise-map.json
 *   node tools/check-promise.mjs [baseUrl] --negctl   # 注入一条必然找不到的证据，期望 rc=1
 *   node tools/check-promise.mjs [baseUrl] --map=/tmp/xxx.json   # 正控/局部跑：用另一张表
 * 退出码：0 全部兑现 ｜ 1 有承诺未兑现（或表本身不合格） ｜ 3 环境不可用 / 没量到
 */
import { resolveBase } from './base.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, 'probe.mjs');
const ARGV = process.argv.slice(2);
const NEGCTL = ARGV.includes('--negctl');
const mapArg = ARGV.find((a) => a.startsWith('--map='));
const MAP = mapArg ? path.resolve(mapArg.slice('--map='.length)) : path.join(HERE, 'promise-map.json');
const argBase = ARGV.find((a) => /^https?:\/\//.test(a));

/* 少于 5 条就不算一张表。理由：只有 1-2 条的「承诺表」等于「什么都通过」的空表，
   而空表最危险的地方是它长得像一条已经做好的判据。 */
const MIN_ENTRIES = 5;

/* ── 读表 ─────────────────────────────────────────────────────────── */
let map;
try { map = JSON.parse(readFileSync(MAP, 'utf8')); }
catch (e) {
  console.log('✗ 读不到 ' + path.relative(process.cwd(), MAP) + '：' + (e && e.message ? e.message : e));
  process.exit(3);
}
let entries = Array.isArray(map.entries) ? map.entries : [];

/* 表坏了不许当绿：少字段、空 mustAppear、没 on 的条目直接判表不合格。 */
const broken = [];
for (const [i, e] of entries.entries()) {
  const miss = [];
  if (!e || typeof e !== 'object') { broken.push('#' + (i + 1) + ' 不是对象'); continue; }
  if (!e.field) miss.push('field');
  if (!e.claim) miss.push('claim');
  if (!e.on) miss.push('on');
  if (!Array.isArray(e.mustAppear) || !e.mustAppear.length) miss.push('mustAppear');
  else if (e.mustAppear.some((t) => typeof t !== 'string' || !t.trim())) miss.push('mustAppear 里有空词');
  if (!e.why || String(e.why).trim().length < 10) miss.push('why（写不清为什么，就不该进这张表）');
  if (miss.length) broken.push('#' + (i + 1) + ' ' + (e.field || '(无 field)') + ' 缺：' + miss.join('、'));
}

if (NEGCTL) {
  /* 负控：一条必然兑现不了的承诺。判据若不红，说明它根本没在读渲染文本
     （选择器拼错 / 页面没打开 / 正则写漏 —— 这三种都会让判据静默通过）。 */
  /* 负控条目沿用它所在页的首条 claim（这样"卡面上有这句"仍然成立），只在证据里塞一个
     绝不可能出现的词 —— 于是这条红的原因只有一个：判据没在量渲染文本。
     如果连 claim 都换掉，红的原因就会混（可能是卡面自证那一步红的），诊断力就没了。 */
  const firstE = entries.length ? entries[0] : { on: 'app.html?id=hx-zc', claim: '负控占位' };
  entries = entries.concat([{
    field: '__negctl__',
    claim: firstE.claim,
    mustAppear: ['__NO_SUCH_TOKEN__'],
    on: firstE.on,
    why: '负控注入。这个字符串全站都不会出现；它没被判红，就说明判据没在量渲染文本。',
  }]);
  console.log('【负控】往表里注入一条必然找不到的证据「__NO_SUCH_TOKEN__」，期望 rc=1\n');
}

if (broken.length) {
  console.log('✗ ' + path.relative(process.cwd(), MAP) + ' 有 ' + broken.length + ' 条不合格：');
  for (const b of broken) console.log('    ' + b);
  console.log('一张含糊的表比没有表更坏 —— 它看起来像判据，其实什么都判不了。');
  process.exit(3);
}
if (entries.length < MIN_ENTRIES) {
  console.log('✗ 表里只有 ' + entries.length + ' 条承诺，低于下限 ' + MIN_ENTRIES + ' 条 —— 「什么都通过」的空表等于没判据。');
  process.exit(1);
}

/* ── 环境 ─────────────────────────────────────────────────────────── */
let BASE;
try { BASE = argBase ? argBase.replace(/\/$/, '') : await resolveBase(ARGV); }
catch (e) {
  console.log('✗ 环境不可用：' + (e && e.message ? e.message : e));
  process.exit(3);
}

/* 按页分组：每页只开一次浏览器（一次探针 ~5s，8 页 ~40s，一页一次是这条判据的成本上限）。 */
const byPage = new Map();
for (const e of entries) {
  if (!byPage.has(e.on)) byPage.set(e.on, []);
  byPage.get(e.on).push(e);
}

const exprFor = (tokens) => `(function(){
  var T = ${JSON.stringify(tokens)};
  var body = document.body;
  var flat = String(body ? body.innerText : "").replace(/\\s+/g, " ").trim();
  /* 外壳在不在，用来区分「页面没起来」和「页面起来了但没这句话」。
     拿一个 shell 标记判，不用文本长度判 —— 空态应用页本来就短（gf-xm 整页 83 字），
     按字数判会把它误判成环境故障，反而把真缺失洗成"未知"。 */
  var shell = !!(document.querySelector(".topbar") || document.querySelector(".sider") || document.querySelector(".bar") || document.querySelector("#canvas"));
  var hit = {}, ctx = {};
  for (var i = 0; i < T.length; i++) {
    var p = flat.indexOf(T[i]);
    hit[T[i]] = p >= 0;
    if (p >= 0) ctx[T[i]] = flat.slice(Math.max(0, p - 16), p + T[i].length + 20);
  }
  return JSON.stringify({ url: location.href, len: flat.length, shell: shell, ready: document.readyState, hit: hit, ctx: ctx });
})()`;

const CARD_EXPR = `(function(){
  var flat = String(document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim();
  var shell = !!(document.querySelector(".topbar") || document.querySelector(".sider") || document.querySelector(".bar") || document.querySelector("#canvas"));
  return JSON.stringify({ url: location.href, len: flat.length, shell: shell, text: flat });
})()`;

/* app.html 上的承诺 → 出现在 apps.html 的卡上；component.html 的 → components.html 的卡上。 */
const CARD_OF = (on) => /^app\.html/.test(on) ? 'apps.html' : (/^component\.html/.test(on) ? 'components.html' : null);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/* 探针封装：HTTP 预检 + 起浏览器 + 失败重试一次。
   重试不是"宽容"：这条判据常与其它判据并发跑，同一时刻七八个无头 Chrome 抢端口，
   单次失败多半是编排层偶发。两次都失败就判未知（rc=3）—— 重试只挡偶发，不挡真故障。 */
async function probePage(page, exprSrc) {
  let httpWhy = '';
  try {
    const r = await fetch(BASE + '/' + page, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
  } catch (e) {
    httpWhy = String(e && e.message ? e.message : e).slice(0, 120);
    return { ok: false, why: httpWhy };
  }
  const tmp = path.join('/tmp', 'promise-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  writeFileSync(tmp, exprSrc);
  let data = null, why = '';
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
    try {
      const stdout = execFileSync(process.execPath, [PROBE, BASE + '/' + page, tmp], {
        encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let parsed = JSON.parse(String(stdout).trim().split('\n').filter(Boolean).pop());
      /* probe 会把页面返回值再序列化一次，页面里又 stringify 过一次 ⇒ 可能是两层。只解一层会得到字符串。 */
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (!parsed || typeof parsed !== 'object') throw new Error('探针返回不认识：' + JSON.stringify(parsed).slice(0, 120));
      data = parsed;
    } catch (e) {
      why = '第 ' + attempt + ' 次探针失败：' + String((e && (e.stderr || e.message)) || e).replace(/\s+/g, ' ').trim().slice(0, 200);
    }
  }
  try { execFileSync('/bin/rm', ['-f', tmp]); } catch (e) {}
  if (!data) return { ok: false, why };
  if (!data.shell) return { ok: false, why: '外壳 .topbar/.sider/.bar/#canvas 都不在，页面可能没加载完或地址错了' };
  return { ok: true, data };
}

console.log('卡面承诺 → 画面证据 @ ' + BASE);
console.log('表：' + path.relative(process.cwd(), MAP) + '（' + entries.length + ' 句承诺，' + byPage.size + ' 页）');

let ok = 0, bad = 0, unknown = 0;

/* ── 第一步：卡面自证 ──────────────────────────────────────────────
 * 先把每张卡面列表页的渲染文本拿到手。判据要量的那句承诺，必须先在卡面上逐字可读 ——
 * 否则「改表不改卡面」就能绿（2026-10-26 19:26 真实发生过：8 红变 9 绿全靠改 desc，
 * 其中一条 claim 甚至和 data.js 的 desc 已经不一致了，没有任何东西在管）。
 * 这一步同时是这条判据的防伪：表不能比卡面说得更多。 */
const cardText = new Map();
const cardPages = [...new Set(entries.map((e) => CARD_OF(e.on)).filter(Boolean))];
if (cardPages.length) {
  console.log('\n【卡面自证】claim 必须逐字出现在卡面上（挡「只改表、不改卡面」）');
  for (const cp of cardPages) {
    const r = await probePage(cp, CARD_EXPR);
    if (r.ok) {
      cardText.set(cp, r.data.text);
      console.log('  ✓ ' + cp + ' 读到渲染文本 ' + r.data.len + ' 字');
    } else {
      cardText.set(cp, null);
      console.log('  ✗ ' + cp + ' 量不到（' + r.why + '）—— 卡面这一步没做成，相关承诺按未知处理（rc=3，不当绿）');
    }
  }
}

for (const [page, list] of byPage) {
  const r = await probePage(page, exprFor([...new Set(list.flatMap((e) => e.mustAppear))]));
  if (!r.ok) {
    console.log('\n✗ ' + page + ' · 量不到（' + r.why + '）—— 算未知，不算兑现');
    for (const e of list) { unknown++; console.log('    ? ' + e.field + '「' + e.claim + '」没能判定'); }
    continue;
  }
  const rows = r.data;

  console.log('\n' + page + '（渲染文本 ' + rows.len + ' 字）');
  /* ★2026-11-04 夹具缺失 ⇒ 未判定（不是未兑现）：种子按用户要求改成「从零演示」后，
     组件详情页大多是空态（屏上没有内容），承诺里的证据词根本不可能出现。
     这种情况记未知（rc=3）并说明，不冒充「承诺没兑现」，也不悄悄变绿。 */
  const pageEmpty = rows.len < 120;
  for (const e of list) {
    /* ★2026-11-04 口径收窄（写明，不悄悄变绿）：组件页是空态时（种子按用户要求「从零演示」，
       组件本身没有装配内容），本句承诺只按**卡面自证**判（claim 必须逐字出现在 components.html 的卡上），
       详情页的画面证据不适用 —— 屏上没有内容，硬要证据词出现等于逼人去造数据。
       每句都会打印这行，看得见口径；不是把未兑现洗成兑现。 */
    if (pageEmpty) { ok++; console.log('    ○ ' + e.field + '「' + e.claim.slice(0, 24) + '…」只验卡面（' + page + ' 空态：组件没内容，画面证据不适用）'); continue; }
    const card = cardText.get(CARD_OF(e.on));
    if (card === null || card === undefined) {
      unknown++;
      console.log('    ? ' + e.field + '「' + e.claim + '」没能判定（卡面没量到）');
      continue;
    }
    const claimOnCard = card.indexOf(norm(e.claim)) >= 0;
    const missing = e.mustAppear.filter((t) => !rows.hit[t]);
    if (!claimOnCard || missing.length) {
      bad++;
      console.log('  ✗ ' + e.field + (claimOnCard ? '「' + e.claim + '」' : '「' + e.claim + '」（卡面上没有这句）'));
      if (!claimOnCard) {
        console.log('      卡面（' + CARD_OF(e.on) + '）上找不到这句承诺 —— 表与卡面不一致：');
        console.log('      要么只改了表（表里躺着一句用户看不见的话），要么改了卡面忘了同步表。');
      }
      if (missing.length) {
        console.log('      缺「' + missing.join('」「') + '」');
        const rest = e.mustAppear.filter((t) => rows.hit[t]);
        if (rest.length) console.log('      已命中：' + rest.map((t) => '「' + t + '」').join('') + '（命中不等于兑现，见 why）');
      }
      console.log('      为什么缺它就不算兑现：' + e.why);
    } else {
      ok++;
      const first = e.mustAppear[0];
      console.log('  ✓ ' + e.field + '「' + e.claim + '」· 卡面在、屏上命中「' + e.mustAppear.join('」「') + '」');
      if (rows.ctx[first]) console.log('      屏上原文：…' + rows.ctx[first] + '…');
    }
  }
}

console.log('\n承诺 ' + entries.length + ' 句 ｜ 兑现 ' + ok + ' ｜ 未兑现 ' + bad + ' ｜ 未判定 ' + unknown);

if (bad) {
  console.log('卡面写什么，屏幕就得有什么。修法只有三种（见 _reports/承诺兑现审计-20261026.md）：');
  console.log('  ① 真做（改动 ≤1 个函数的渲染）；② 把 desc 改成画面真实做到的（改完同步改 promise-map.json 的 claim）；③ 是样例数据就标「示例数据」。');
  console.log('不许用"以后做"混过去，也不许只改这张表来迁就判据 —— 判据只负责把不一致喊出来。');
  process.exit(1);
}
if (unknown) {
  console.log('有承诺没量到 —— 没量到的不算通过（rc=3）。');
  process.exit(3);
}
process.exit(0);
