#!/usr/bin/env node
/* check-anchor-coverage —— **被多处依赖的锚点，必须有人看着**。
 *
 * 2026-10-26 的全仓实测：
 *   726 处 CSS 选择器，只有 187 个不重复；其中 38 个出现在 ≥3 个判据文件里，
 *   而 tools/ui-contract.json 只看着 12 个 —— **26 个高频锚点无人看守**。
 *   `.kcard` 出现在 14 个文件里（最高），`#act-assemble` 6 个 —— 这两个今天都漂移过。
 *
 * 为什么这条和 check-ui-contract 不是一回事：
 *   check-ui-contract 验「契约里声明的锚点还在不在」——只覆盖已经想到的那些。
 *   这条验「被多处依赖的锚点有没有被声明」——盖的是**没想到的那些**。
 *   前者是审计，后者是普查。缺了普查，新写一个判据引用一个没人管的 class 是无声发生的。
 *
 * 阈值取 3：出现在 1-2 个文件里的选择器，改坏了只影响一两条判据，人会发现；
 * 出现在 ≥3 个文件里的，改坏了是一片静默失效，而账面全绿。
 *
 * 用法：node tools/check-anchor-coverage.mjs [--min=3]
 * 退出码：0 高频锚点全被看守 ｜ 1 有裸奔的高频锚点 ｜ 3 读不到契约或 tools/
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.join(HERE, 'ui-contract.json');

const argMin = process.argv.find((a) => /^--min=\d+$/.test(a));
/* 负控：门槛降到 1。此时**每一个**没被契约看守的选择器都算裸奔，必然判红。
   它验的不是"有没有裸奔"，而是「这条判据到底会不会红」—— 不会红的判据等于没有。 */
const NEGCTL = process.argv.includes('--negctl');
const MIN = NEGCTL ? 1 : (argMin ? Number(argMin.split('=')[1]) : 3);

/* 文件扩展名不是锚点。这条排除是必要的：`.html` 在这批判据里出现 5 次，
 * 全是 'xxx.html' 字符串被正则咬住，收进契约只会稀释契约的可信度。 */
const NOT_ANCHOR = /^\.(html|htm|json|mjs|cjs|tsv|md|png|svg|css|js)$/;

/* 契约：pages.*.must（按页）+ shared（跨页）。
 * shared 是这个文件今天补的：`.sider` `.toast` `.xz-panel` 这类跨页锚点
 * 不属于任何单独一页，硬塞进某个页面会让 check-ui-contract 在该页上误判缺失。 */
let contract;
try { contract = JSON.parse(readFileSync(CONTRACT, 'utf8')); }
catch (e) { console.log('✗ 读不到 tools/ui-contract.json：' + (e && e.message)); process.exit(3); }

const declared = new Set();
for (const p of Object.values(contract.pages || {})) {
  for (const k of Object.keys(p.must || {})) declared.add(k);
}
for (const k of Object.keys(contract.shared || {})) declared.add(k);

/* 统计每个选择器被几个**判据文件**用到（同一文件写 5 遍算 1 个，因为漂移的伤害
   是「多个判据一起失效」，不是「一个判据写错多次」）。 */
const files = readdirSync(HERE).filter((f) => /\.mjs$/.test(f) && !f.startsWith('check-anchor-coverage'));
const where = new Map();     /* selector -> Set(file) */
for (const f of files) {
  let s;
  try { s = readFileSync(path.join(HERE, f), 'utf8'); } catch (e) { continue; }
  const m = s.match(/["'`](#[A-Za-z][\w-]*|\.[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)*)["'` ]/g) || [];
  const uniq = new Set(m.map((x) => x.replace(/["'` ]/g, '')).filter((x) => x.length > 1 && x.length < 40));
  for (const sel of uniq) {
    if (NOT_ANCHOR.test(sel)) continue;
    if (!where.has(sel)) where.set(sel, new Set());
    where.get(sel).add(f);
  }
}

const high = [...where.entries()]
  .map(([sel, set]) => ({ sel, n: set.size, files: [...set] }))
  .filter((x) => x.n >= MIN)
  .sort((a, b) => b.n - a.n);

const bare = high.filter((x) => !declared.has(x.sel));

console.log('锚点普查 @ tools/ ｜ 门槛：出现在 ≥' + MIN + ' 个判据文件');
console.log('扫了 ' + files.length + ' 个判据文件，得到 ' + where.size + ' 个不重复选择器');
console.log('高频锚点 ' + high.length + ' 个 ｜ 契约看守 ' + (high.length - bare.length) + ' 个 ｜ 裸奔 ' + bare.length + ' 个');

if (bare.length) {
  console.log('\n✗ 这些锚点被多处依赖，但契约里没有声明 —— 它们改名时不会有任何判据拦你：');
  for (const b of bare) {
    console.log('    ' + b.sel.padEnd(22) + b.n + ' 个文件  ← ' + b.files.slice(0, 3).join(' / ') +
      (b.files.length > 3 ? ' 等' : ''));
  }
  console.log('\n修法：在 tools/ui-contract.json 的 shared 段补一条，写清「这个锚点坏了会怎样」。');
  console.log('判据引用的锚点被契约看着，改名才会红 —— 否则改名在账面是无声的（今天已发生三次）。');
  process.exit(1);
}

console.log('\n✓ 所有高频锚点都在契约里：改名一定有人知道。');
process.exit(0);
