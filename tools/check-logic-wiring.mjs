#!/usr/bin/env node
/* check-logic-wiring —— 规范写了，就必须有判据，或者有判定人 + 到期日（2026-11-04 立）
 *
 * 族：spec-not-wired（规范句无判据）。这是本仓第 2 次踩：
 *   ① 2026-11-04 10:38：check-app-invariants.mjs 2026-11-03 就写了、还补过 amendment，
 *      但**从没接进闸** —— gatecover 判红才抓到。判据写了不执行＝整条覆盖被静默抹掉。
 *   ② 本轮：「界面通用逻辑」12 条里，L5 复制成熟形态 / L10 真源优先 / L12 交付四问
 *      在盘面上只是散文，没有任何机器形状；下一次做界面照样会犯，因为"读过一遍"不是闸。
 *
 * 病根（不是记性差）：规范与判据之间没有机器契约。
 *   写规范的人写完就走，跑判据的人不知道规范里多了几条 —— 唯一的信号是"规范表里有没有 L13"，
 *   而这句话没人能机器核。于是规范越来越多、判据一动不动，看起来还全都"有落实"。
 *
 * 判什么（只读盘，不跑任何页面）：
 *   W1 规范里每一个 L# 在「判据接线台账」里恰好一行；台账里不许有规范里不存在的 L#
 *   W2 每一行必须写「射程」：判得到什么、判不到什么（空、—、无 都算没写）
 *   W3 「机器判据」列：写 KEY 或 KEY/断言，KEY 必须已登记在 tools/judgments.mjs；
 *      不允许写不存在的判据键（写个不存在的键＝假装覆盖）
 *   W4 判据列写 — ⇒ 必须写「兜底判定人」且带「到期 YYYY-MM-DD」、未过期
 *   W5 射程里承认「判不到」的那部分 ⇒ 同样必须有兜底判定人 + 未到期（承认漏，就必须有人接）
 *   W6 棘轮：无判据条数只许减 —— 超过 tools/logic-wiring-baseline.json 记的基线即红
 *
 * 射程声明（写清楚它判不到什么，免得被当成万能）：
 *   它判的是接线存在且未过期，判不到「判据本身测得对不对」（那是 PRED/NEGCTL 的事），
 *   也判不到「兜底判定人有没有真的判」（那是四席读数与用户走查的事）。
 *
 * 用法：
 *   node tools/check-logic-wiring.mjs                    正控
 *   node tools/check-logic-wiring.mjs --doc <path>       判指定规范件（负控用它跑副本）
 *   node tools/check-logic-wiring.mjs --selftest         解析器/规则自检（合成样例，不读盘）
 *   node tools/check-logic-wiring.mjs --negctl           负控：坏样本必须全红，正控必须绿
 *   node tools/check-logic-wiring.mjs --accept-baseline  重签无判据基线（只在真的减少了的时候用）
 * 退出码：0 绿 ｜ 2 红（含负控不成立）｜ 3 读不到件 / 解析出 0 条（分母缺失不许印绿）
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOC_DIR = join(ROOT, '_docs');
const JUDGMENTS = join(HERE, 'judgments.mjs');
const BASELINE = join(HERE, 'logic-wiring-baseline.json');
const LEDGER_HEAD = '判据接线台账';
const ARGS = process.argv.slice(2);
const HAS = (f) => ARGS.includes(f);
const OPT = (f) => { const i = ARGS.indexOf(f); return i >= 0 ? ARGS[i + 1] : null; };

const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const readOrDie = (p) => {
  if (!existsSync(p)) { console.error('缺件：' + p); process.exit(3); }
  return readFileSync(p, 'utf8');
};

/* ── 解析 ───────────────────────────────────────────────────── */
const headOf = (line) => /^##\s+/.test(line);
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

/* 规范件 → { defs:Set<L#>, rows:[{id,gate,scope,fallback,line}], hasLedger } */
export function parseDoc(text) {
  const defs = new Set();
  const rows = [];
  let ledgerAt = -1;
  const lines = text.split('\n');
  /* 只认二级标题，且取最后一个（循环不 break → 后写覆盖前写）。
     2026-11-04 实测踩过：前言里「加完必须往下面的『判据接线台账』加一行」先提到了这五个字，
     旧写法 includes() 就把台账起点挪到了那句话上，往下第一行就是 `## 五、…` 标题 → break → 台账 0 行，
     12 条逻辑全报「没接线」。**正文引用小节名，不该改变小节的位置。** */
  lines.forEach((ln, i) => { if (new RegExp('^##\\s+.*' + LEDGER_HEAD).test(ln)) ledgerAt = i; });
  const ledgerRows = ledgerAt >= 0 ? lines.slice(ledgerAt + 1) : [];
  for (let i = 0; i < ledgerRows.length; i++) {
    const ln = ledgerRows[i];
    if (headOf(ln)) break;                       // 台账到下一个二级标题为止
    const m = /^\|\s*(L\d+)\s*\|/.exec(ln);
    if (!m) continue;
    const c = cells(ln);
    rows.push({ id: m[1], gate: (c[1] || '').trim(), scope: (c[2] || '').trim(), fallback: (c[3] || '').trim(), line: ledgerAt + 1 + i + 1 });
  }
  const before = ledgerAt >= 0 ? lines.slice(0, ledgerAt) : lines;
  for (const ln of before) {
    const m = /^\|\s*(L\d+)\s*\|/.exec(ln);
    if (m) defs.add(m[1]);
  }
  return { defs, rows, hasLedger: ledgerAt >= 0 };
}

const idsOf = (text) => new Set([...text.matchAll(/id:\s*'([A-Z0-9_-]+)'/g)].map((m) => m[1]));

const parseGate = (cell) => {
  const raw = (cell || '').trim();
  if (!raw || raw === '—' || raw === '-' || raw === '无') return { none: true, list: [] };
  return { none: false, list: raw.split('+').map((s) => s.trim()).filter(Boolean) };
};

/* 兜底判定人：必须有名字 + 「到期 YYYY-MM-DD」 */
const parseFallback = (cell) => {
  const raw = (cell || '').trim();
  if (!raw || raw === '—' || raw === '-') return { ok: false, why: '没写兜底判定人', due: null };
  const m = /到期\s*(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!m) return { ok: false, why: '兜底判定人没写「到期 YYYY-MM-DD」', due: null };
  if (m[1] < TODAY) return { ok: false, why: '兜底已过期（' + m[1] + '）', due: m[1] };
  if (raw.replace(/到期[^|]*/, '').replace(/[｜|\s]/g, '').length < 3) return { ok: false, why: '兜底没写是谁判（只剩到期日）', due: m[1] };
  return { ok: true, due: m[1] };
};

/* 核心校验：返回 problems[]（空 = 绿）。baseline 可为 null（不判棘轮）。 */
export function validate(docText, ids, baseline) {
  const p = [];
  const { defs, rows, hasLedger } = parseDoc(docText);
  if (!defs.size) { p.push('解析出 0 条 L#：规范件的逻辑表不见了（分母缺失不能算绿）'); return p; }
  if (!hasLedger) { p.push('找不到「' + LEDGER_HEAD + '」小节：规范没有接线台账'); return p; }
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) p.push(r.id + ' 台账重复（第 ' + r.line + ' 行）');
    seen.add(r.id);
    if (!defs.has(r.id)) p.push(r.id + ' 台账里有、规范里没有（凭空多一行）');
    if (!r.scope || r.scope === '—' || r.scope === '-' || r.scope === '无') p.push(r.id + ' 没写射程（判得到什么/判不到什么）');
    const g = parseGate(r.gate);
    if (g.none) {
      const fb = parseFallback(r.fallback);
      if (!fb.ok) p.push(r.id + ' 无机器判据：' + fb.why);
    } else {
      for (const t of g.list) {
        const key = t.split('/')[0].trim();
        if (!ids.has(key)) p.push(r.id + ' 引用了未登记的判据键「' + key + '」（写个不存在的键 = 假装覆盖）');
      }
    }
    /* 射程里承认了判不到 ⇒ 那部分必须有兜底判定人接 */
    if (/判不到/.test(r.scope) && !parseGate(r.gate).none) {
      const fb = parseFallback(r.fallback);
      if (!fb.ok) p.push(r.id + ' 射程承认「判不到」，但' + fb.why + '（承认漏就必须有人接）');
    }
  }
  for (const d of defs) if (!seen.has(d)) p.push(d + ' 在规范里、台账里没有（新增规范句没接线）');
  const noGate = rows.filter((r) => parseGate(r.gate).none).length;
  if (baseline && typeof baseline.noGate === 'number' && noGate > baseline.noGate) {
    p.push('无判据条数 ' + noGate + ' > 基线 ' + baseline.noGate + '（棘轮只许减：要么补判据，要么退役一条）');
  }
  return p;
}

/* ── 自检：合成样例，不读盘 ─────────────────────────────────── */
function selftest() {
  const ids = new Set(['PANELIA', 'GATECOV']);
  const goodDoc = [
    '## 一、逻辑',
    '| # | 逻辑 | 反例 | 怎么保证 |',
    '|---|---|---|---|',
    '| L1 | 一件事只有一个家 | x | y |',
    '| L2 | 真源优先 | x | y |',
    '## 二、判据接线台账',
    '| 逻辑 | 机器判据 | 射程 | 兜底判定人 |',
    '|---|---|---|---|',
    '| L1 | PANELIA/IA1 | 判得到：顶栏无升级；判不到：其它页 | 设计席｜到期 2099-01-01 |',
    '| L2 | — | 判不到：取证有没有做 | 产品席｜到期 2099-01-01 |',
  ].join('\n');
  const cases = [
    ['好样本必须绿', goodDoc, 0],
    ['前言提到「判据接线台账」不能挪走起点 → 仍绿', '> 新增 L# 时必须往下面的「判据接线台账」加一行。\n' + goodDoc, 0],
    ['删掉一条台账行 → 红', goodDoc.replace(/^\| L2 \| — .*$/m, ''), 1],
    ['引用不存在的判据键 → 红', goodDoc.replace('PANELIA/IA1', 'NOPEGATE/IA1'), 1],
    ['无判据但没有兜底 → 红', goodDoc.replace('产品席｜到期 2099-01-01', '—'), 1],
    ['兜底已过期 → 红', goodDoc.replace('2099-01-01', '2000-01-01'), 1],
    ['没写射程 → 红', goodDoc.replace('判不到：取证有没有做', '—'), 1],
  ];
  let n = 0;
  for (const [name, text, wantProblems] of cases) {
    const ps = validate(text, ids, null);
    const ok = wantProblems ? ps.length > 0 : ps.length === 0;
    if (!ok) n++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + '（problems=' + ps.length + (ps[0] ? '：' + ps[0] : '') + '）');
  }
  console.log(n ? '自检失败 ' + n + ' 条' : '自检通过：' + cases.length + '/' + cases.length);
  return n;
}

/* ── 负控：坏样本必须红，正控必须绿 ───────────────────────── */
function negctl() {
  const ids = idsOf(readOrDie(JUDGMENTS));
  const docs = docsOnDisk();
  if (!docs.length) { console.error('没有规范件，负控前提不成立'); return 1; }
  const base = docs[0].text;
  const mut = [
    ['删掉一条台账行', (t) => t.replace(/^\|[^\n]*到期[^\n]*\|$/m, '')],
    ['引用不存在的判据键', (t) => t.replace(/(\| *(?:PANELIA|GATECOV|GATEWIRE|PRED|SEATPASS)[^|]*\|)/, '| NOSUCHGATE/X |')],
    ['把一条兜底改成过期', (t) => t.replace(/到期\s*20\d\d-\d\d-\d\d/, '到期 2000-01-01')],
    ['把一条射程改成 —', (t) => t.replace(/(\| *L\d+ *\|[^|]*\|) *判得到[^|]*\|/, '$1 — |')],
  ];
  let bad = 0;
  for (const [name, fn] of mut) {
    const t = fn(base);
    if (t === base) { console.log('  ✗ 负控样本没构造成功：' + name); bad++; continue; }
    const ps = validate(t, ids, null);
    if (ps.length) console.log('  ✓ ' + name + ' → 判红（' + ps[0] + '）');
    else { console.log('  ✗ ' + name + ' → 没判红（判据恒绿）'); bad++; }
  }
  const gp = validate(base, ids, readBaseline());
  if (gp.length) { console.log('  ✗ 正控样本不绿：' + gp.slice(0, 3).join('；')); bad++; }
  else console.log('  ✓ 正控样本判绿');
  console.log(bad ? '负控失败 ' + bad + ' 条：不能证明会红/会绿，不算判据' : '负控通过：坏样本全红、正控全绿');
  return bad;
}

/* ── 盘面 ───────────────────────────────────────────────────── */
function docsOnDisk() {
  const out = [];
  for (const f of readdirSync(DOC_DIR)) {
    if (!/^界面通用逻辑-.*\.md$/.test(f)) continue;
    out.push({ name: f, text: readFileSync(join(DOC_DIR, f), 'utf8') });
  }
  return out;
}
function readBaseline() {
  if (!existsSync(BASELINE)) return null;
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return null; }
}

/* ⚠ 退出码反直觉，别"修"回 0（2026-11-04）：仓里约定 `--negctl` 的返回值就是判据自己的红绿 ——
   坏样本喂进来，判据该判红 ⇒ rc=2。n=0（坏样本全被判红）反而返回 2；n>0 返回 0 表示"喂了也不红"。
   check-judgments 按 rc∈{1,2} 判"这条判据能红"，这里返回 0 会被判成假绿。 */
if (HAS('--selftest')) { const n = selftest(); process.exit(n ? 2 : 0); }
if (HAS('--negctl')) { const n = negctl(); process.exit(n ? 0 : 2); }

const ids = idsOf(readOrDie(JUDGMENTS));
let docs = docsOnDisk();
const one = OPT('--doc');
if (one) docs = [{ name: basename(one), text: readOrDie(one) }];
if (!docs.length) { console.error('_docs/ 下没有 界面通用逻辑-*.md'); process.exit(3); }

const baseline = readBaseline();
if (HAS('--accept-baseline')) {
  const rows = docs.flatMap((d) => parseDoc(d.text).rows);
  const noGate = rows.filter((r) => parseGate(r.gate).none).length;
  writeFileSync(BASELINE, JSON.stringify({ noGate, doc: docs.map((d) => d.name), at: new Date().toISOString() }, null, 2) + '\n');
  console.log('已重签无判据基线：noGate=' + noGate);
  process.exit(0);
}

console.log('── 规范↔判据接线：每条通用逻辑必须有机器的形状 ──');
let fails = 0;
for (const d of docs) {
  const { defs, rows } = parseDoc(d.text);
  console.log('· ' + d.name + '：逻辑 ' + defs.size + ' 条，台账 ' + rows.length + ' 行');
  const ps = validate(d.text, ids, baseline);
  for (const q of ps) { fails++; console.log('  ✗ ' + q); }
  const noGate = rows.filter((r) => parseGate(r.gate).none).length;
  console.log('  · 有机器判据 ' + (rows.length - noGate) + ' 条｜无判据（靠判定人+到期日）' + noGate + ' 条' +
    (baseline ? '｜基线 ' + baseline.noGate : '｜基线未签（--accept-baseline）'));
}
console.log(fails ? '断点 ' + fails + ' 条' : '全过：' + docs.length + ' 份规范件全部接线');
process.exit(fails ? 2 : 0);
