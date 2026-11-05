/* check-chain.mjs —— 交付链八环节的交接物判据（第 31 门；S0 链条本身）
 *
 * 起因（用户 m04973）：「这一个链条里总共有多少个环节，每一个环节都应该对一个专家……
 * 逐个环节都需要优化」。真实情况是：需求、语言、评审、语义这四个环节**没有任何实体件**，
 * 全靠我一个人写码时即兴决定 —— 于是卡面出现「页面类 / 字段 5 项 / 装配 5 个应用」。
 *
 * 判什么（tools/chain.json 是契约）：
 *   1. 每个环节声明的交付件必须存在（文件或目录）；
 *   2. 每个环节声明的判据脚本必须存在，且已登记在 tools/judgments.mjs（没登记的判据，
 *      跑不跑没人知道 —— 和没有一样）；
 *   3. 每件交付件不能是空文件（< 200 B 视为占位）。
 * rc：0 通过；2 有缺口；3 chain.json 读不到；--negctl 藏掉一件必须 rc=2。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');

let fail = 0;
const out = (ok, label, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`); if (!ok) fail++; };

if (!existsSync(join(HERE, 'chain.json'))) { console.log('FATAL: tools/chain.json 不存在'); process.exit(3); }
const chain = JSON.parse(readFileSync(join(HERE, 'chain.json'), 'utf8'));
const judged = readFileSync(join(HERE, 'judgments.mjs'), 'utf8');

console.log(`── 交付链八环节交接物（${chain.stages.length} 个环节）`);
for (const s of chain.stages) {
  const missing = [];
  for (const a of s.artifacts) {
    const p = join(ROOT, a);
    const hidden = NEG && a === s.artifacts[0] && s.id === 'S5';   /* 负控：把 S5 的术语台账当不存在 */
    if (hidden || !existsSync(p)) { missing.push(a + '（缺）'); continue; }
    const st = statSync(p);
    if (st.isFile() && st.size < 200) missing.push(`${a}（${st.size} B，疑似占位）`);
  }
  for (const g of s.gates) {
    if (!existsSync(join(HERE, g))) { missing.push(g + '（脚本不存在）'); continue; }
    if (!judged.includes(g)) missing.push(g + '（未登记在 judgments.mjs）');
  }
  out(missing.length === 0, `${s.id} ${s.name} · ${s.owner}`, missing.length ? missing.join(' ；') : `${s.artifacts.length} 件 / ${s.gates.length} 判据`);
}

console.log('');
if (NEG) {
  console.log(fail ? '负控成立（藏掉一件交付件 ⇒ rc=2）' : '负控失败：藏掉交付件仍全绿');
  process.exit(fail ? 2 : 1);
}
console.log(`通过 ${chain.stages.length - fail} ｜ 断点 ${fail}`);
process.exit(fail ? 2 : 0);
