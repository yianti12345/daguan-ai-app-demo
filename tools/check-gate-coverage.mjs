#!/usr/bin/env node
/* check-gate-coverage —— **判据存在 ≠ 判据执行**：没进闸的判据必须有登记，否则红。
 *
 * 2026-10-26 实测（本仓）：tools/ 下 60 个判据文件，run-gates.sh 只调用 47 个，
 * **13 个从来没跑过**，其中包括：
 *   · e2e-flow.mjs              全流程唯一判据（「用户能不能做完一件事」只此一条）
 *   · configurator-parity.mjs   照真源复刻的对齐判定
 *   · ref-vs-mine.mjs           真源 vs 我方对比
 *   · visible-audit.mjs         元素看不看得见
 *   · reach-walk.mjs            遍历路由采页面清单（覆盖率的分母）
 *   · check-align.mjs / check-card-uniform.mjs / check-cross-page.mjs /
 *     check-global.mjs / check-list-rows.mjs / check-token-scale.mjs
 *
 * 为什么这是最上游的病：所有判据的绿灯都只是**跑过的那部分**的结论。
 * 「全流程 19 个断点」之所以到用户问出来才知道 —— 因为 e2e-flow 从来没在闸里跑过。
 * 判据写错只是错一条；判据不执行是**整整一条覆盖被静默抹掉**，而账面上看不出来。
 *
 * 机制：没进闸可以，但必须在 tools/not-gated.tsv 登记「为什么不进闸、由谁覆盖、到期日」。
 *   空着 = 假装覆盖。到期没销账 = 红。这跟 check-review 的 --waive 是同一套逻辑：
 *   红必须有出口，但出口必须留字据。
 *
 * ★2026-10-28（机制审查官）补第二类行：**在闸内但每轮 rc=3 未量**（ref-parity 的真源
 *   登录态失效）。这类判据"在闸内"，原来的校验只看 `bare`（没进闸）⇒ 记了也没人读，
 *   到期日等于散文。现在台账里**每一行**都要过「原因 ≥20 字 / 有覆盖方 / 未到期」三关。
 *
 * 用法：node tools/check-gate-coverage.mjs
 *      node tools/check-gate-coverage.mjs --negctl      负控：注入没进闸也没登记的判据，必须 1
 *      node tools/check-gate-coverage.mjs --negctl-due  负控：注入一条已过期的台账行，必须 1
 * 退出码：0 全部有出口 ｜ 1 有未登记或已到期的 ｜ 3 读不到 run-gates.sh 或登记表格式错
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES = path.join(HERE, 'run-gates.sh');
const LEDGER = path.join(HERE, 'not-gated.tsv');

/* 什么算"判据文件"：能被当判据跑的脚本。工具类（probe/shot/make-compare 等）不算。 */
const IS_CRITERION = /^(check-|gate-|px-|ref-|walk|hit-audit|interact-audit|audit-states|e2e-flow|judgments|visible-audit|reach-walk|doc-parity|configurator-parity).*\.mjs$/;

/* 纯工具，不产出红绿，不参与覆盖率 */
const TOOLS_ONLY = new Set(['blind-inputs.mjs', 'reach-walk.mjs']);

let sh;
try { sh = readFileSync(GATES, 'utf8'); }
catch (e) { console.log('✗ 读不到 tools/run-gates.sh'); process.exit(3); }

const all = readdirSync(HERE).filter((f) => IS_CRITERION.test(f)).sort();
const gated = all.filter((f) => sh.includes(f));
const NEGCTL = process.argv.includes('--negctl');
let bare = all.filter((f) => !gated.includes(f));
/* 负控：注入一个不存在的判据名，必然落到"没进闸也没登记"。 */
if (NEGCTL) bare = bare.concat(['check-__negctl__.mjs']);

/* 登记表：判据 | 为什么不进闸 | 谁覆盖 | 到期日(YYYY-MM-DD，空=永久) */
let ledger = new Map();
if (existsSync(LEDGER)) {
  const lines = readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines[0].startsWith('判据')) {
    console.log('✗ tools/not-gated.tsv 第一行必须是表头：判据\t为什么不进闸\t谁覆盖\t到期日');
    process.exit(3);
  }
  for (const l of lines.slice(1)) {
    const c = l.split('\t');
    if (c.length < 3) { console.log('✗ not-gated.tsv 行列数不足（要 4 列 TAB）：' + l.slice(0, 60)); process.exit(3); }
    ledger.set(c[0].trim(), { why: c[1] || '', by: c[2] || '', due: (c[3] || '').trim() });
  }
}

const today = new Date().toISOString().slice(0, 10);
const bad = [];
const expired = [];

/* 负控（--negctl-due）：塞一条已过期的「在闸内未量」台账行，到期检查必须判红。 */
const DUE_NEG = process.argv.includes('--negctl-due');
if (DUE_NEG) ledger.set('check-__negctl_due__.mjs', {
  why: '负控：故意写一个已经过期的到期日，到期检查必须判红', by: '负控', due: '2026-01-01',
});

/* 校验对象 = 未进闸的判据 ∪ 台账里出现的判据（后者含「在闸内但未量」的记账）。 */
const toCheck = new Set([...bare, ...ledger.keys()]);
for (const f of toCheck) {
  if (TOOLS_ONLY.has(f)) continue;                    /* 纯工具：不是判据，谈不上覆盖 */
  const rec = ledger.get(f);
  if (!rec) { bad.push({ f, why: '没进闸，也没登记' }); continue; }
  if (rec.why.trim().length < 20) { bad.push({ f, why: '登记了但没写清原因（为什么没跑 / 为什么未量，<20 字）' }); continue; }
  if (!rec.by.trim()) { bad.push({ f, why: '登记了但没写谁覆盖它' }); continue; }
  if (rec.due && rec.due < today) expired.push({ f, due: rec.due });
}

console.log('判据覆盖闸 @ tools/');
console.log('判据文件 ' + all.length + ' ｜ 已进闸 ' + gated.length + ' ｜ 未进闸 ' + bare.length);

if (bare.length) {
  console.log('\n未进闸清单：');
  for (const f of bare) {
    if (TOOLS_ONLY.has(f)) { console.log('  · ' + f + '（纯工具，不产红绿，不计）'); continue; }
    const rec = ledger.get(f);
    const isBad = bad.some((b) => b.f === f);
    console.log('  ' + (isBad ? '✗' : '✓') + ' ' + f +
      (rec && !isBad ? ' · 已登记，由「' + rec.by + '」覆盖' + (rec.due ? '，到期 ' + rec.due : '，永久') : ''));
  }
}

if (bad.length) {
  console.log('\n✗ ' + bad.length + ' 个判据既没进闸也没给出正当出口：');
  for (const b of bad) console.log('    ' + b.f + ' · ' + b.why);
  console.log('\n修法二选一：①把它接进 run-gates.sh（该跑就跑）；' +
    '②在 tools/not-gated.tsv 登记一行，写清「为什么不进闸 + 谁覆盖它 + 到期日」。');
  console.log('判据不执行，等于整条覆盖被静默抹掉，而账面上看不出来 —— 这是最上游的病。');
  process.exit(1);
}
if (expired.length) {
  console.log('\n✗ ' + expired.length + ' 条登记已到期待销账（到期仍不跑也不续期）：');
  for (const e of expired) console.log('    ' + e.f + ' · 到期 ' + e.due);
  process.exit(1);
}

console.log('\n✓ 每个判据都有出口：' + gated.length + ' 个在闸内跑，' +
  (bare.length ? bare.length + ' 个登记了退出理由与覆盖方' : '0 个裸奔') + '。');
process.exit(0);
