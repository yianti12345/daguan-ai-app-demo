/* 期望值唯一来源（2026-11-04）
   ────────────────────────────────────────────────────────────────
   根因分析 _reports/根因分析-20261104.md 的第 ④ 条：判据没有独立 oracle。
   以前 check-versions 里直接写 `shape.headCols.join('/') === '版本/状态/保存时间/操作'`，
   期望值是我自己编的 —— 实现和期望同源，全绿只能证明"代码按我以为的跑"。

   现在：产品语义的期望值只在这里声明，且每个字段都标了它来自哪张基线表。
   判据只能 import 这里的值，不许自己写第二份。
   改产品语义的顺序：先改 _docs/基线-*.md → 再改本文件 → 判据自动跟着变。
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/* ★ 根治 C：期望值只有一个物理来源 —— assets/spec.js（浏览器与 Node 共用）。
   本文件只是 Node 侧的取数口，不再手写第二份，也就不会再出现"改了页面忘改判据"。 */
export const BASELINE = require('../assets/spec.js');

/* 基线表里"二、列"章节的列名，按表格第 2 列解析。用于 check-baseline-oracle
   机器证明：本文件的期望值确实来自基线表，不是又一次自证。 */
export function docCols(md) {
  const sec = md.split(/##\s*二、列/)[1] || '';
  const body = sec.split(/##\s*三、/)[0] || sec;
  const out = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/);
    if (m && !/^列$|^#|^---/.test(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}
