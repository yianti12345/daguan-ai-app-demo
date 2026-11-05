/* check-predicate.mjs —— 「同一件事只有一个谓词」判据（第 29 门）
 *
 * 起因（链路 S2 环节实测）：把一个组件设成「已禁用」之后，它仍然躺在应用配置页的
 * 装配候选里 —— 因为「能不能被装」这件事有两套谓词：
 *   · assets/app.js   装配面板：只看 status === '已上架'
 *   · 配置器/组件页   看 启用态 + 发布态
 * 而 assets/data.js:144 的注释自己写着「启用/禁用讲的是"是否出现在装配候选里"」——
 * 文档与代码各说各话，没有任何一条判据比对它们。
 *
 * 判什么（静态、可复核）：
 *   1. DB.canInstall 只能有一处定义，且定义里必须同时出现「已上架」与 enabled；
 *   2. assets/app.js 的 listOf() 里，可装配分支必须调 DB.canInstall，不许写 inline 谓词；
 *   3. 全仓不许出现第二份 canInstall 定义（复制一份就是下一场分叉）。
 * rc：0 通过；2 有违规；1 负控注入失败；--negctl 必须 2。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const A = join(ROOT, 'assets');
const NEG = process.argv.includes('--negctl');

let fail = 0;
const out = (ok, label, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`); if (!ok) fail++; };

const read = (p) => readFileSync(p, 'utf8');

/* ── 1. DB.canInstall 是唯一定义处，且两个维度都在里面 ── */
const data = read(join(A, 'data.js'));
const defIdx = data.indexOf('DB.canInstall = function');
out(defIdx > 0, 'data.js 定义 DB.canInstall', defIdx > 0 ? `@${data.slice(0, defIdx).split('\n').length} 行` : '没定义 ⇒ 各页只能各自写谓词');
if (defIdx > 0) {
  const body = data.slice(defIdx, data.indexOf('\n  };', defIdx) + 4);
  out(/已上架/.test(body), 'canInstall 判发布态', '');
  out(/enabled/.test(body), 'canInstall 判启用态', /enabled/.test(body) ? '' : '未含 enabled ⇒ 「已禁用」仍会进装配候选');
}

/* ── 2. app.js 的可装配分支必须调它 ── */
const app = read(join(A, 'app.js'));
const li = app.indexOf('function listOf(');
out(li > 0, 'app.js 有 listOf()', li > 0 ? '' : '没找到装配过滤函数');
if (li > 0) {
  const block = app.slice(li, app.indexOf('\n  }', li) + 4);
  out(/DB\.canInstall\(/.test(block), 'listOf() 调 DB.canInstall', block.includes('DB.canInstall(') ? '' : '仍在写 inline 谓词');
  out(!/c\.status === '已上架'/.test(block), 'listOf() 无 inline 发布态判断', /c\.status === '已上架'/.test(block) ? '同一件事的第二份实现' : '');
}

/* ── 3. 全仓不许第二份定义 ── */
const defs = [];
for (const f of readdirSync(A).filter((x) => x.endsWith('.js'))) {
  const t = read(join(A, f));
  const n = (t.match(/(canInstall)\s*=\s*function/g) || []).length;
  if (n) defs.push(`${f}×${n}`);
}
out(defs.length === 1, 'canInstall 全仓只有一处定义', defs.join(' / '));

console.log('');
if (NEG) {
  /* 负控：把调用点换回 inline 谓词，判据必须红。改完立刻还原（process.exit 前显式还原）。 */
  const target = 'return kind === \'avail\' && DB.canInstall(c);';
  const bad = 'return kind === \'avail\' && c.status === \'已上架\';';
  if (!app.includes(target)) { console.log('  ✗ 负控无法注入：找不到调用点'); process.exit(1); }
  writeFileSync(join(A, 'app.js'), app.replace(target, bad));
  const restored = () => writeFileSync(join(A, 'app.js'), app);
  const { execFileSync } = await import('node:child_process');
  let code = 0;
  try { execFileSync(process.execPath, [join(HERE, 'check-predicate.mjs')], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { code = e.status; }
  restored();
  console.log(code === 2 ? '负控成立（注入 inline 谓词后 rc=2）' : `负控失败：注入后 rc=${code}（应 2）`);
  process.exit(code === 2 ? 2 : 1);
}

console.log(`通过 ${fail ? 0 : 1} ｜ 断点 ${fail}`);
process.exit(fail ? 2 : 0);
