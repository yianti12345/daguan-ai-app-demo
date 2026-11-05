#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────
   check-content-contract.mjs —— 列表卡「信息契约」判据（2026-10-24 立）

   为什么要有它（用户 m04536 的那句「是不是在写代码、写样式的时候就缺少准备」）：
   前面的 check-card-copy 只能拦住"卡面写死的中文"这类**文案**，
   而真正出问题的不是文案，是**信息选择**：卡片模板里 `a.type` / `c.fields`
   这种字段访问，不会在卡面上留下一句可检索的中文，白名单拦不到它。
   于是这条判据把契约落到 `tools/content-contract.json`：
     · 每个列表卡的模板里能访问哪些字段（allowed）
     · 哪些字段是数据里有、但这一页读者不需要的（forbidden）
     · 哪几个字段非不可（required）
   并**双向**校验契约本身：契约里写的字段名必须在 data.js 里真实存在。

   用法：
     node tools/check-content-contract.mjs             # rc=0 绿 / rc=1 红
     node tools/check-content-contract.mjs --negctl    # 负控：临时塞一个 forbidden 字段访问，必须红
   ───────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');

const contract = JSON.parse(readFileSync(join(ROOT, 'tools/content-contract.json'), 'utf8'));
const dataSrc = readFileSync(join(ROOT, 'assets/data.js'), 'utf8');

/* data.js 里真实存在的键（对象字面量的 key）—— 契约不许编字段 */
const dataKeys = new Set([...dataSrc.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)].map((m) => m[1]));

/* cardTemplate 返回的 tpl 是整页脚本，但"卡片骨架存不存在、有没有闭合"要按页定位：
   apps.html 仍是 <article class="kcard">…</article>；
   components.html 改成了单列行列表，一行的模板从 <div class="crow" 到 </div>`;（rowHtml）。 */
const TEMPLATE = {
  'apps.html': { open: 'class="kcard', end: '</article>' },
  /* ★2026-10-25：卡片重做后类名变成 "crow ccard"，open 只匹配 class="crow" 就永远找不到区域，
     于是"标记过期"被报成"页面丢了内容"。标记只认类名前缀 —— 它锚定的是这一块在哪儿，
     不是这一块长什么样。 */
  'components.html': { open: 'class="crow', end: '</div>`;' },
};

function cardTemplate(page) {
  const s = readFileSync(join(ROOT, page), 'utf8');
  /* 2026-10-25 重定向：components.html 由 4 列卡片阵列换成单列行式列表，
     它的"卡"不再是 <article class="kcard"> 而是行模板 one 行 <div class="crow">…</div>`。
     断言一条没删：open 定位卡片骨架、end 校验闭合、扫描面仍是整页脚本（注释行剔除），
     所以"渲染前先把字段读进变量"（const off = c.enabled === false）照样被算进去。
     这里只把"卡片在源码里长什么样"参数化，不放宽任何字段白名单。 */
  const loc = TEMPLATE[page];
  if (!loc) return { tpl: '', err: `${page} 没有登记卡片模板定位规则（TEMPLATE 表）` };
  const i = s.indexOf(loc.open);
  if (i < 0) return { tpl: '', err: `${page} 里找不到 ${loc.open}` };
  const end = s.indexOf(loc.end, i);
  if (end < 0) return { tpl: '', err: `${page} 里 ${loc.open} 没有闭合（找不到 ${loc.end}）` };
  /* 只看 <article> 会漏掉「渲染前先把字段读进变量」的写法
     （`var (up = a.status===...)` / `st = c.status`）—— 那才是真的在读数据。
     所以扫描面 = 整页脚本，注释行剔除。 */
  return { tpl: s.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '').replace(/^\s*\/\/.*$/gm, ''), err: null };
}

const fails = [];
const rows = [];

for (const [name, spec] of Object.entries(contract.entity)) {
  const { required, allowed, forbidden } = spec.card;

  for (const f of [...required, ...allowed, ...forbidden]) {
    if (!dataKeys.has(f)) fails.push(`[契约自身] ${name}.card 里声明了 data.js 不存在的字段：${f}`);
  }
  for (const f of required) {
    if (!allowed.includes(f)) fails.push(`[契约自身] ${name}.card 的 required 字段 ${f} 不在 allowed 里`);
  }
  for (const f of forbidden) {
    if (allowed.includes(f)) fails.push(`[契约自身] ${name}.card 的 ${f} 同时出现在 allowed 与 forbidden`);
  }

  const { tpl, err } = cardTemplate(spec.page);
  if (err) { fails.push(`[模板] ${err}`); continue; }

  /* 模板里对实体的字段访问：apps 用 a.、comps 用 c. */
  const varOf = name === 'apps' ? 'a' : 'c';
  const used = new Set([...tpl.matchAll(new RegExp(`\\b${varOf}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g'))].map((m) => m[1]));
  const extra = NEG ? new Set([...used, 'fields']) : used;   /* 负控：塞一个 forbidden 字段 */

  for (const f of extra) {
    if (forbidden.includes(f)) fails.push(`[${spec.page}] 页面脚本访问了契约里禁用的字段：${varOf}.${f}`);
    else if (!allowed.includes(f)) fails.push(`[${spec.page}] 页面脚本访问了契约未登记的字段：${varOf}.${f}`);
  }
  for (const f of required) {
    /* 必含字段允许两种实现：直接读字段（c.refs），或由契约登记的 derived 函数现算（DB.appVer） */
    const viaDerived = Object.entries(spec.card.derived || {})
      .some(([k, fn]) => k === f && tpl.includes(fn + '('));
    if (!used.has(f) && !viaDerived) {
      fails.push(`[${spec.page}] 契约要求必含的字段既没被读、也没经 derived 现算：${f}`);
    }
  }
  rows.push(`${spec.page}：模板访问 ${used.size} 个字段（${[...used].sort().join('/')}）｜必含 ${required.length} ｜禁用 ${forbidden.length}`);
}

console.log('卡面信息契约（tools/content-contract.json）');
for (const r of rows) console.log('  · ' + r);

if (fails.length) {
  console.log(`\n${NEG ? '【负控】' : ''}✗ 判红 ${fails.length} 条`);
  for (const f of fails) console.log('   · ' + f);
  console.log(NEG ? '\n负控生效：注入契约外字段后判红（说明这条判据不是恒绿）' : '');
  /* rc 语义（tools/run-gates.sh:6 + tools/check-judgments.mjs:177）：0=绿 / 1=判据自身红 /
     2=--negctl 抓住注入。check-judgments 逐条跑 --negctl 要求 rc===2，退 1 会被判"负控失效"。 */
  process.exit(NEG ? 2 : 1);
}
console.log(`\n✓ ${NEG ? '（负控）' : ''}卡片模板与契约一致：${Object.keys(contract.entity).length} 页，未登记字段 0，禁用字段 0`);
process.exit(0);
