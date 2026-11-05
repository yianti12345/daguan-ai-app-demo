/* 判据 oracle 检查（2026-11-04 · 根治第 ④ 条）
   要防的事：判据把期望值写在自己身体里 —— 那样"实现和期望同源"，全绿只能证明自洽。
   三道检查：
     ① 基线表 → baseline.mjs：机器可读的期望值必须能从 _docs/基线-*.md 的"二、列"里读出来
     ② 判据 → baseline.mjs：结构类判据必须 import baseline，不许再写一份列名
     ③ 实现 → 基线：两页的 spec 声明（assets/*.js）里的列/动作词与基线一致
   rc=1 表示 oracle 断了，不是"格式问题"，不能跳过。
*/
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE, docCols } from './baseline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const ok = [];
const R = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ── ① 基线表 → 期望值 ─────────────────────────────────────── */
for (const [page, spec] of Object.entries(BASELINE)) {
  const md = R(spec.source);
  const cols = docCols(md);
  const colsObj = page === 'versions.html' ? spec.headCols : spec.variants.global.headCols;
  const want = colsObj.map((c) => c.docLabel || c.label);
  if (cols.length !== want.length || cols.some((c, i) => c !== want[i])) {
    fail.push(`${page}：基线表「二、列」= ${cols.join('/')} ≠ baseline.mjs = ${want.join('/')}`);
  } else {
    ok.push(`${page}：基线表 ${cols.length} 列与期望值逐项一致`);
  }
  /* 状态机：每张基线表必须有"四、状态机"这一节，且至少 4 个状态 */
  const sm = (md.split(/##\s*四、状态机/)[1] || '').split(/##\s*五、/)[0] || '';
  const stateRows = sm.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*状态\s*\|/.test(l)).length - 1;
  if (stateRows < 4) fail.push(`${spec.source}：状态机表只有 ${stateRows} 行，截图给不了的状态没写全`);
  else ok.push(`${page}：状态机 ${stateRows} 个状态已显式写出`);
}

/* ── ② 判据不许自带期望值 ──────────────────────────────────── */
const STRUCT_CHECKS = ['tools/check-versions.mjs', 'tools/check-card-uniform.mjs',
                       'tools/check-card-shape.mjs', 'tools/check-card-copy.mjs'];
for (const f of STRUCT_CHECKS) {
  const s = R(f);
  /* 有些判据的期望值就是规则本身（例如"卡面禁用词清单"），没有外部基线可对。
     这类必须显式写 oracle: self，不能靠侥幸不命中关键词。 */
  if (/oracle:\s*self/.test(s)) { ok.push(`${f}：自声明 oracle:self（期望值即规则本身）`); continue; }
  if (!/baseline\.mjs|BASELINE/.test(s)) {
    /* 只在它真的写了产品语义字面量时才报：纯几何判据可以没有 oracle 引用 */
    if (/版本\/状态|客户授权|复制为新版本|取消授权/.test(s)) {
      fail.push(`${f}：写了产品语义期望值却不引用 baseline.mjs`);
    } else ok.push(`${f}：纯几何判据，无需 oracle`);
  } else ok.push(`${f}：期望值引自 baseline.mjs`);
}
/* 反向：不许把整串列名硬编码在判据里（哪怕同时也 import 了） */
const literal = /['"`]版本\/状态\/保存时间\/操作['"`]/;
for (const f of STRUCT_CHECKS) {
  if (literal.test(R(f))) fail.push(`${f}：仍硬编码整串列名，期望值没有真正走 oracle`);
}

/* ── ③ 实现里的 spec 与基线一致 ─────────────────────────────── */
const S = R('assets/spec.js');
const V = R('assets/versions.js');
const A = R('assets/client-auth.js');
for (const c of BASELINE['versions.html'].headCols) {
  if (!S.includes(`label: '${c.label}'`)) fail.push(`spec.js 缺 versions 的列「${c.label}」`);
}
for (const c of BASELINE['client-auth.html'].variants.global.headCols) {
  if (c.key === 'pick') continue;
  if (!S.includes(`label: '${c.label}'`)) fail.push(`spec.js 缺 client-auth 的列「${c.label}」`);
}
/* 页面必须真的消费 spec.js，不许把列又抄回自己身体里 */
if (!V.includes("SPEC['versions.html']")) fail.push('versions.js 没有引用 spec.js（列可能又抄了一份）');
if (!A.includes("SPEC['client-auth.html']")) fail.push('client-auth.js 没有引用 spec.js');
/* A 的拦截：三问字段必须在规格里，且 list.js 必须强制检查它们 */
for (const k of ['object', 'states', 'source']) {
  if (!S.includes(k + ':')) fail.push(`spec.js 缺三问字段「${k}」`);
  if (!R('assets/list.js').includes("'" + k + "'")) fail.push(`list.js 没有强制检查「${k}」`);
}
for (const w of ['复制为新版本']) {
  if (!V.includes(w)) fail.push(`versions.js 缺基线动作「${w}」`);
}
for (const w of ['升级版本', '取消授权']) {
  if (!A.includes(w)) fail.push(`client-auth.js 缺基线动作「${w}」`);
}
/* 反向约束：基线反例里的词不该重新出现在实现中 */
for (const w of ['未授权', '恢复授权', '删除记录']) {
  if (A.includes(`'>${w}<`) || A.includes(`">${w}<`)) fail.push(`client-auth.js 出现基线反例词「${w}」`);
}

/* ── 输出 ─────────────────────────────────────────────────── */
console.log('判据 oracle 检查｜期望值来源 = _docs/基线-*.md → tools/baseline.mjs → 判据\n');
ok.forEach((s) => console.log('  ✓ ' + s));
if (fail.length) {
  console.log('\n断点 ' + fail.length + ' 条：');
  fail.forEach((s) => console.log('  ✗ ' + s));
  process.exit(1);
}
console.log('\n全部通过：判据的期望值来自独立基线，不是实现自己');
