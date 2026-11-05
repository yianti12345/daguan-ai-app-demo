#!/usr/bin/env node
/* check-criteria-lock —— **改判据必须留一条修订记录，并说清原来那条错在哪**（2026-10-26 立）
 *
 * 起因：一天之内同一个 agent 改了十几次判据 —— 写死的阈值改掉、方向写反的断言改对、
 * 过期的选择器换掉、整条判据退役。每一次都"合法"，但一次记录都没有。
 * 而 agent 能看见的唯一信号是"这个红变绿"，改判据比改代码快得多。
 * 所以必须给"改判据"标价：
 *
 *   tools/criteria.lock   ← 机器重签（sha256 前 16 位），不许手改
 *   tools/amendments.tsv  ← 人写的修订台账，理由必须说明"原来那条错在哪"
 *
 * 判什么（默认无参数）：
 *   ① lock 里每条重算 hash，一致 → 过
 *   ② 不一致 → 在台账里找该判据最新一条：
 *        没有                  → 未记录改动
 *        新hash 与现状不等      → 记录与现状不符（改完又改了，没补记录）
 *        理由不过硬规则         → 红
 *   ③ tools/ 里出现 lock 没有的判据文件 → 新判据未登记
 *   ④ lock 里有、磁盘上没有 → 判据被删但无记录
 *
 * 理由四条硬规则（机器判，不靠自觉）：
 *   ① 去空白后 ≥ 20 字
 *   ② 必须含一个"说明旧口径错在哪"的词：
 *      写死/过期/改名/方向/类型/不存在/假设/误报/假红/假绿/退役/合并/漏
 *   ③ 禁写：调整/优化/完善/适配/放宽/修正一下/临时
 *      —— 这些词不陈述任何事实，正是"改到能过"时最容易写下的词
 *   ④ 空理由按不合格（0 字 < 20）
 *
 * --accept 只在台账里已有对应记录时重签，顺序上堵死"先重签、再补理由"。
 * 唯一例外：lock 还不存在（首次建锁），此时无旧状态可比，直接写。
 *
 * 覆盖范围（判据脚本 + 判据的输入台账，都算判据的一部分）：
 *   check-*.mjs  gate-*.mjs  px-*.mjs  walk.mjs  hit-audit.mjs  interact-audit.mjs
 *   blind-inputs.mjs  audit-states.mjs  ref-*.mjs
 *   deprecated.tsv  failures.tsv  value-provenance.tsv  promise-map.json
 *
 * ★2026-10-28 修（盲审条件 4）两处账：
 *   ① 输出把「锁内条数」和「台账行数」并排印，读的人必然以为缺一条 —— 两者本来不是一回事
 *      （台账只追加，同一个判据改三次就是三行）。现在印「盘面/锁内/台账行（覆盖 N 条判据）」。
 *      并且新增断言：台账每条记录必须指向盘内被锁的判据（已退役的写 "-" 除外），
 *      否则记了也不生效 —— 实测抓出一条 promise-map.json。
 *   ② 原来 EXPECTED_LEDGERS 点名 families.tsv「未建」。它**不存在也不该存在**：
 *      本仓的族账是 tools/failures.tsv（表头第 1 行「失败族台账」，check-selfcheck 引的就是它）。
 *      再建一本 families.tsv 等于两本族账并存＝规范分片无总账。改为：族账只认 failures.tsv，
 *      并加一条守卫 —— tools/families.tsv 一旦出现即判红。
 *
 * 用法：
 *   node tools/check-criteria-lock.mjs                      校验
 *   node tools/check-criteria-lock.mjs --accept --by zheng  重签
 *   node tools/check-criteria-lock.mjs --negctl             负控：改一条判据不留记录，必须 4
 *   node tools/check-criteria-lock.mjs --negctl-ledger      负控：台账记一条指向不存在判据的记录，必须 4
 *   node tools/check-criteria-lock.mjs --negctl-families    负控：建出第二本族账，必须 4
 * 退出码：0 全部有记录 ｜ 4 有未记录的判据改动（三支负控成功恒 4）｜ 3 读不到锁/台账或用法错
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(HERE, 'criteria.lock');
const AMD = path.join(HERE, 'amendments.tsv');

/* 判据覆盖范围。台账（.tsv）也算判据的一部分：
 * 改 deprecated.tsv 一条就相当于改了一条判据的输入，同样要留记录。 */
const COVER = [
  /^check-.*\.mjs$/, /^gate-.*\.mjs$/, /^px-.*\.mjs$/, /^ref-.*\.mjs$/,
  /^walk\.mjs$/, /^hit-audit\.mjs$/, /^interact-audit\.mjs$/,
  /^blind-inputs\.mjs$/, /^audit-states\.mjs$/,
  /* 2026-10-29 补：这三类此前在盘、在闸外、也不在锁内 —— 改它们等于没留记录。
     e33-struct-undo 是 E33 六条断言的唯一实现；token-audit 是 T1 的唯一实现；
     token-crossfile.tsv 是 token-audit 的例外账输入（改一行就能让一条裸值合法）。 */
  /^e33-.*\.mjs$/, /^token-audit\.mjs$/, /^token-crossfile\.tsv$/,
  /* 2026-10-26 补：这几条原来漏在锁外，其中 e2e-flow 是「全流程能不能走通」的唯一判据，
     改绿它比改页面便宜得多 —— 去掉它等于把最该被盯的那条豁免了。 */
  /^e2e-flow\.mjs$/, /^judgments\.mjs$/, /^visible-audit\.mjs$/,
  /^reach-walk\.mjs$/, /^doc-parity\.mjs$/, /^configurator-parity\.mjs$/,
  /* ui-contract.json 是锚点契约的输入：改它等于改判据的判据，不留记录就等于锚点可以悄悄漂。 */
  /^ui-contract\.json$/, /^structure-tree\.json$/, /^negctl\.tsv$/,
  /* 2026-11-05 补：口径台账是文案判据的输入 —— 加一行就等于加一条断言，必须留记录。 */
  /^copy-ledger\.tsv$/,
  /* 2026-10-29 补：component-first.registry.json 是内联棘轮与 C4 族判定的输入。
     不锁它 ⇒ 把 perPageBaseline 改大即可让「页面加 33 KB 内联」回到绿，而且不留记录（假绿）。 */
  /^component-first\.registry\.json$/,
  /* promise-map.json 同理（2026-10-28 补）：PR 判据的 claim 表，改它一句就能让「卡面承诺兑现」
     量到一句不存在的话 —— 而台账里早就有它的一行修订记录，锁里却没有它，账实本身就是裂的。 */
  /^promise-map\.json$/,
  /* 门禁脚本自己必须入锁：改它一行就能让任何判据不跑，是所有覆盖的绕过口。 */
  /^run-gates\.sh$/, /^not-gated\.tsv$/, /^review-waivers\.tsv$/, /^interact-allow\.json$/, /^lint-allow\.tsv$/,
  /^deprecated\.tsv$/, /^failures\.tsv$/, /^value-provenance\.tsv$/,
];

/* 点名存在、但这一版仓库里还没建的台账 —— 沉默等于假装全覆盖，所以要显式报一句。
   ★2026-10-28：families.tsv 从这里删掉。它从来不存在，也不该存在：本仓的族账是
     tools/failures.tsv（表头「失败族台账」，check-selfcheck 引用的就是它）。
     把它留着，只会让每一轮读数都印一句「覆盖面是缺的」，而缺的那件事根本不是文件。 */
const EXPECTED_LEDGERS = ['value-provenance.tsv'];

/* 族账唯一真源。两本并存＝同一件事两个真源（规范分片），所以出现第二本要判红。 */
const FAMILY_LEDGER = 'failures.tsv';
const FAMILY_ALIASES = ['families.tsv'];

const REASON_MIN = 20;
const MUST_HIT = ['写死', '过期', '改名', '方向', '类型', '不存在', '假设',
                  '误报', '假红', '假绿', '退役', '合并', '漏'];
const MUST_NOT = ['调整', '优化', '完善', '适配', '放宽', '修正一下', '临时'];
/* 判据被删时，台账里的「新hash」用这些标记之一 */
const DELETED_MARK = new Set(['-', '—', '删除', 'deleted', 'DELETED']);

/* ---------- 覆盖与 hash ---------- */

function criteriaFiles() {
  return fs.readdirSync(HERE)
    .filter((f) => !fs.statSync(path.join(HERE, f)).isDirectory())
    .filter((f) => COVER.some((re) => re.test(f)))
    .sort()
    .map((f) => `tools/${f}`);
}

function hashOf(rel) {
  const buf = fs.readFileSync(path.join(HERE, path.basename(rel)));
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function currentHashes() {
  const m = {};
  for (const rel of criteriaFiles()) m[rel] = hashOf(rel);
  return m;
}

const ab = (h) => (h ? String(h).slice(0, 8) + '…' : '（空）');

/* 台账里的旧hash 允许只写前 8 位（手抄方便），所以按前缀比 */
function hashPrefixEq(a, b) {
  const x = String(a || '').trim(), y = String(b || '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  return n >= 8 && x.slice(0, n) === y.slice(0, n);
}

/* ---------- 台账 ---------- */

function readAmendments(strict = true) {
  if (!fs.existsSync(AMD)) {
    if (!strict) return [];
    throw new Error('读不到台账 tools/amendments.tsv');
  }
  const rows = [];
  const lines = fs.readFileSync(AMD, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (!l.trim() || l.startsWith('#')) return;
    if (i === 0 || /^日期\t/.test(l)) return;            /* 表头 */
    const c = l.split('\t');
    if (c.length < 5) {
      throw new Error(`tools/amendments.tsv 第 ${i + 1} 行列数不足（要 6 列 TAB 分隔，实际 ${c.length} 列）`);
    }
    rows.push({
      line: i + 1,
      date: c[0] || '', criterion: (c[1] || '').trim(), reason: c[2] || '',
      oldHash: (c[3] || '').trim(), newHash: (c[4] || '').trim(), rc: (c[5] || '').trim(),
    });
  });
  return rows;
}

/* 最新一条 = 文件里最后一条（台账只追加，不插入） */
function latestRow(rows, rel) {
  const base = path.basename(rel);
  let hit = null;
  for (const r of rows) if (r.criterion === base || r.criterion === rel) hit = r;
  return hit;
}

/* 理由四条硬规则。返回不合格项，空数组 = 合格。 */
function reasonProblems(reason) {
  const s = String(reason || '');
  const bad = [];
  const len = [...s].filter((ch) => !/\s/.test(ch)).length;
  if (len < REASON_MIN) bad.push(`理由只有 ${len} 字，要求 ≥ ${REASON_MIN} 字`);
  if (!MUST_HIT.some((w) => s.includes(w))) {
    bad.push(`没说明原来错在哪（需含 ${MUST_HIT.join('/')} 之一）`);
  }
  const banned = MUST_NOT.filter((w) => s.includes(w));
  if (banned.length) bad.push(`含禁写短语「${banned.join('、')}」（不陈述事实）`);
  return bad;
}

/* ---------- 校验 ---------- */

function validate() {
  const out = [];
  let red = 0;
  const say = (s) => out.push(s);
  const fail = (s) => { red++; out.push(`  ✗ ${s}`); };

  if (!fs.existsSync(LOCK)) {
    return { rc: 3, out: ['✗ 读不到判据锁 tools/criteria.lock', '  先跑：node tools/check-criteria-lock.mjs --accept --by <你的名字>'] };
  }
  let lock;
  try { lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')); }
  catch (e) { return { rc: 3, out: [`✗ tools/criteria.lock 不是合法 JSON：${e.message}`] }; }
  if (!lock || typeof lock.criteria !== 'object' || lock.criteria === null) {
    return { rc: 3, out: ['✗ tools/criteria.lock 缺 criteria 字段'] };
  }

  let rows;
  try { rows = readAmendments(); }
  catch (e) { return { rc: 3, out: [`✗ ${e.message}`] }; }

  const cur = currentHashes();
  const locked = lock.criteria;
  const missingLedgers = EXPECTED_LEDGERS.filter((f) => !fs.existsSync(path.join(HERE, f)));

  /* 盘面 / 锁内 / 台账行分开印：台账只追加，同一判据改三次就是三行，行数天然大于判据数。
     原来把「锁内 79 条｜台账 80 条」并排印，读的人只会得出"少一条"这个结论 —— 盲审报告就是这么读的，
     然后把它当覆盖缺口报了上来。数字没错，印法在制造误解。 */
  const ledgerCriteria = new Set(rows.map((r) => path.basename(r.criterion)));
  say(`判据锁｜锁于 ${lock.writtenAt || '?'} by ${lock.writtenBy || '?'}`);
  say(`  盘面判据 ${Object.keys(cur).length} 条｜锁内 ${Object.keys(locked).length} 条｜台账 ${rows.length} 行（覆盖 ${ledgerCriteria.size} 条判据，其余为同一判据的历史记录）`);
  if (missingLedgers.length) say(`· 台账未建：${missingLedgers.join('、')}（不在锁内，不算红，但覆盖面是缺的）`);

  /* 族账唯一：第二本一旦出现就是同一件事两个真源，判红而不是提示 */
  for (const alias of FAMILY_ALIASES) {
    if (fs.existsSync(path.join(HERE, alias))) {
      fail(`族账分片：tools/${alias} 与 tools/${FAMILY_LEDGER} 并存 —— 同一件事两个真源，谁新谁旧没人分得清`);
    }
  }
  say('');

  let same = 0, recorded = 0;

  for (const rel of Object.keys(cur).sort()) {
    if (!(rel in locked)) { fail(`新判据未登记：${rel}`); continue; }
    if (locked[rel] === cur[rel]) { same++; continue; }

    const row = latestRow(rows, rel);
    if (!row) {
      fail(`未记录改动：${rel}（旧 ${ab(locked[rel])} 现 ${ab(cur[rel])}）`);
      continue;
    }
    if (!hashPrefixEq(row.newHash, cur[rel])) {
      fail(`记录与现状不符（记录 ${ab(row.newHash)} 现 ${ab(cur[rel])}），说明改完又改了没补记录：${rel}`);
      continue;
    }
    const prob = reasonProblems(row.reason);
    if (prob.length) {
      fail(`理由不合格：${rel}`);
      for (const p of prob) out.push(`        · ${p}`);
      out.push(`        理由原文：${row.reason || '（空）'}`);
      continue;
    }
    recorded++;
    say(`  ✓ 已记录：${path.basename(rel)}（理由：${row.reason}）`);
  }

  for (const rel of Object.keys(locked).sort()) {
    if (rel in cur) continue;
    const row = latestRow(rows, rel);
    if (!row) { fail(`判据被删但无记录：${rel}`); continue; }
    if (!DELETED_MARK.has(row.newHash)) {
      fail(`判据被删但记录不完整：${rel}（新hash 应写 "-"，实际 "${row.newHash}"）`);
      continue;
    }
    const prob = reasonProblems(row.reason);
    if (prob.length) {
      fail(`理由不合格（退役）：${rel}`);
      for (const p of prob) out.push(`        · ${p}`);
      continue;
    }
    recorded++;
    say(`  ✓ 已记录（退役）：${path.basename(rel)}（理由：${row.reason}）`);
  }

  say('');
  /* 台账里每条记录必须指向「有人校验」的判据。
     指向覆盖范围之外、或指向一个盘上不存在的判据 —— 那份理由永远不会被任何一次校验用到，
     而台账看起来是"有记录"。实测抓到一条 promise-map.json（台账有、锁里没有，改它等于没留记录）。 */
  const curBase = new Set(Object.keys(cur).map((k) => path.basename(k)));
  const strayRows = rows.filter((r) => {
    const b = path.basename(r.criterion);
    if (DELETED_MARK.has(r.newHash)) return false;              /* 已退役：判据不在盘是正常的 */
    if (COVER.some((re) => re.test(b))) return !curBase.has(b); /* 覆盖范围内，但盘上没有这个文件 */
    return true;                                                /* 压根不在覆盖范围：记了也没人看 */
  });
  for (const r of strayRows) {
    fail(`台账记录指向没人校验的判据：${path.basename(r.criterion)}（第 ${r.line} 行）—— 这份理由不会被任何一次校验用到`);
  }

  if (red) {
    say(`一致 ${same} 条 ｜ 有记录 ${recorded} 条 ｜ 未记录 ${red} 条`);
    say(`判据锁：${red} 处未记录的判据改动（rc=4）`);
    say('  修法：在 tools/amendments.tsv 补一行（日期→判据→理由→旧hash→新hash→重跑后rc），再 --accept 重签');
    return { rc: 4, out };
  }
  say(`一致 ${same} 条 ｜ 有记录 ${recorded} 条 ｜ 未记录 0 条`);
  say('判据锁：齐全 ✓（rc=0）');
  return { rc: 0, out };
}

/* ---------- 重签 ---------- */

function stamp(by) {
  const d = new Date();
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
         `${sign}${p(off / 60)}:${p(off % 60)}`;
}

function writeLock(map, by) {
  const body = { writtenAt: stamp(by), writtenBy: by, criteria: {} };
  for (const k of Object.keys(map).sort()) body.criteria[k] = map[k];
  fs.writeFileSync(LOCK, JSON.stringify(body, null, 2) + '\n');
}

function accept(by) {
  const cur = currentHashes();

  /* 首次建锁：没有旧状态可比，不算"改动"，直接写 */
  if (!fs.existsSync(LOCK)) {
    writeLock(cur, by);
    console.log(`首次建锁，共 ${Object.keys(cur).length} 条（${stamp(by)} by ${by}）`);
    return 0;
  }

  let lock;
  try { lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')); }
  catch (e) { console.error(`✗ tools/criteria.lock 不是合法 JSON，先修它：${e.message}`); return 3; }
  if (!lock || typeof lock.criteria !== 'object' || lock.criteria === null) {
    console.error('✗ tools/criteria.lock 缺 criteria 字段'); return 3;
  }

  let rows;
  try { rows = readAmendments(); }
  catch (e) { console.error(`✗ ${e.message}`); return 3; }

  const locked = lock.criteria;
  const changes = [];
  for (const rel of Object.keys(cur).sort()) {
    if (!(rel in locked)) changes.push({ rel, kind: 'new', old: null, now: cur[rel] });
    else if (locked[rel] !== cur[rel]) changes.push({ rel, kind: 'mod', old: locked[rel], now: cur[rel] });
  }
  for (const rel of Object.keys(locked).sort()) {
    if (!(rel in cur)) changes.push({ rel, kind: 'del', old: locked[rel], now: '-' });
  }

  if (!changes.length) {
    writeLock(cur, by);
    console.log(`✓ 无改动（${Object.keys(cur).length} 条全部一致），只刷新了锁的时间戳（${stamp(by)} by ${by}）`);
    return 0;
  }

  const blocked = [];
  const ok = [];
  for (const c of changes) {
    const row = latestRow(rows, c.rel);
    const base = path.basename(c.rel);
    if (!row) {
      blocked.push(`  ✗ 台账里没有 ${base} 的记录 —— 不许先重签再补理由`);
      continue;
    }
    const expect = c.kind === 'del' ? row.newHash : c.now;
    const match = c.kind === 'del' ? DELETED_MARK.has(row.newHash) : hashPrefixEq(row.newHash, c.now);
    if (!match) {
      blocked.push(`  ✗ ${base} 记录的「新hash」是 ${ab(row.newHash)}，现状是 ${ab(expect)} —— 记录与现状不符`);
      continue;
    }
    const prob = reasonProblems(row.reason);
    if (prob.length) {
      blocked.push(`  ✗ ${base} 理由不合格：${prob.join('；')}`);
      blocked.push(`        理由原文：${row.reason || '（空）'}`);
      continue;
    }
    if (c.kind !== 'del' && row.oldHash && !hashPrefixEq(row.oldHash, c.old)) {
      console.log(`  · ${base} 记录的旧hash ${ab(row.oldHash)} 与锁里旧值 ${ab(c.old)} 不同（不影响判定，供人工核对）`);
    }
    ok.push({ ...c, reason: row.reason });
  }

  if (blocked.length) {
    console.error('✗ 拒绝重签：下列改动没有合格的修订记录');
    for (const b of blocked) console.error(b);
    console.error(`  共 ${changes.length} 条改动，${ok.length} 条可签，${changes.length - ok.length} 条被拒`);
    return 4;
  }

  writeLock(cur, by);
  for (const c of ok) {
    const tag = c.kind === 'del' ? '退役' : c.kind === 'new' ? '新增' : '修订';
    console.log(`✓ 已重签（${tag}）：${path.basename(c.rel)}（${ab(c.old)} → ${ab(c.now)}）理由：${c.reason}`);
  }
  console.log(`✓ 重签完成，共 ${Object.keys(cur).length} 条，${stamp(by)} by ${by}`);
  return 0;
}

/* ---------- 负控 ---------- */

/* 注释遮罩：注释里的数字改了不算改判据，挑注入点时跳过 */
function commentMask(src) {
  const mask = new Uint8Array(src.length);
  const mark = (a, b) => { for (let i = a; i < b; i++) if (src[i] !== '\n') mask[i] = 1; };
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) mark(m.index, m.index + m[0].length);
  for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) mark(m.index, m.index + m[0].length);
  for (const m of src.matchAll(/\/\/[^\n]*/g)) mark(m.index, m.index + m[0].length);
  return mask;
}

/* 找一个真实代码里的数字，±1（保持位数，避免把 999 改成 1000） */
function pickNumber(src) {
  const mask = commentMask(src);
  for (const m of src.matchAll(/(?<![0-9])(\d{2,4})(?![0-9])/g)) {
    if (mask[m.index]) continue;
    const n = Number(m[1]);
    const to = String(n + 1).length === m[1].length ? n + 1 : n - 1;
    return { at: m.index, from: m[1], to: String(to) };
  }
  return null;
}

let RESTORE = null;
function restore() {
  if (!RESTORE) return;
  try { fs.writeFileSync(RESTORE.abs, RESTORE.buf); } catch { /* 进程退出时尽力而为 */ }
  RESTORE = null;
}
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { restore(); process.exit(130); });
}

function negctl() {
  if (!fs.existsSync(LOCK)) {
    console.error('✗ 负控前提不成立：还没有 tools/criteria.lock');
    console.error('  先跑：node tools/check-criteria-lock.mjs --accept --by <你的名字>');
    return 3;
  }

  /* 前提：现在是绿的。已经红了的话，"注入后还是红"说明不了任何问题 */
  const base = validate();
  if (base.rc !== 0) {
    for (const l of base.out) console.error(l);
    console.error(`✗ 负控前提不成立：注入前已经是红的（rc=${base.rc}），先把它修绿再跑负控`);
    return base.rc === 3 ? 3 : 4;
  }

  /* 优先拿 check-card-shape.mjs 开刀，找不到可用数字就顺延到别的判据 */
  const order = criteriaFiles().filter((f) => f.endsWith('.mjs'));
  order.sort((a, b) => (a.includes('check-card-shape') ? -1 : b.includes('check-card-shape') ? 1 : 0));

  let target = null;
  for (const rel of order) {
    const abs = path.join(HERE, path.basename(rel));
    const buf = fs.readFileSync(abs);
    const pick = pickNumber(buf.toString('utf8'));
    if (pick) { target = { rel, abs, buf, pick }; break; }
  }
  if (!target) { console.error('✗ 负控失败：没在任何判据里找到可注入的数字'); return 3; }

  const src = target.buf.toString('utf8');
  const mutated = src.slice(0, target.pick.at) + target.pick.to + src.slice(target.pick.at + target.pick.from.length);

  /* 不写台账，直接改 → 必须判红 */
  RESTORE = { abs: target.abs, buf: target.buf };
  let rc2;
  try {
    fs.writeFileSync(target.abs, mutated, 'utf8');
    const v = validate();
    rc2 = v.rc;
    if (rc2 === 4) {
      const hitLine = v.out.find((l) => l.includes('未记录改动'));
      if (hitLine) console.log(hitLine.trim());
    }
  } finally {
    restore();
  }

  if (rc2 === 4) {
    console.log(`负控：改了未记录的判据后判红 ✓（rc=4）`);
    console.log(`      注入：${path.basename(target.rel)} 里 ${target.pick.from} → ${target.pick.to}（已还原）`);
    return 4;
  }
  console.error(`负控失败：注入了未记录的改动却没判红（rc=${rc2}）—— 这条判据是空的 ✗`);
  return rc2 === 3 ? 3 : 4;
}

/* ---------- 负控（针对两条新断言，各自一支） ---------- */

/* 前提：现在是绿的。已经红了的话，"注入后还是红"说明不了任何问题 */
function negctlBase() {
  if (!fs.existsSync(LOCK)) {
    console.error('✗ 负控前提不成立：还没有 tools/criteria.lock');
    return 3;
  }
  const base = validate();
  if (base.rc !== 0) {
    for (const l of base.out) console.error(l);
    console.error(`✗ 负控前提不成立：注入前已经是红的（rc=${base.rc}），先把它修绿再跑负控`);
    return base.rc === 3 ? 3 : 4;
  }
  return 0;
}

/* 台账记录指向没人校验的判据 ⇒ 必须红。
   注入：往 amendments.tsv 追加一行，判据名写成一个根本不在覆盖范围里的文件。 */
function negctlLedger() {
  const pb = negctlBase();
  if (pb) return pb;
  const buf = fs.readFileSync(AMD);
  const fake = ['2026-10-28', 'tools/no-such-gate.mjs',
    '负控注入：这条记录的判据名不存在，用来证明"记了也没人校验"能被判红（跑完即还原）',
    '-', 'deadbeefdeadbeef', '0'].join('\t') + '\n';
  let rc2 = 0;
  try {
    fs.appendFileSync(AMD, fake);
    rc2 = validate().rc;
  } finally {
    fs.writeFileSync(AMD, buf);
  }
  if (rc2 === 4) {
    console.log('负控：台账里记了一条指向不存在判据的记录后判红 ✓（rc=4，已还原）');
    return 4;
  }
  console.error(`负控失败：注入了指向不存在判据的记录却没判红（rc=${rc2}）—— 这条断言是空的 ✗`);
  return rc2 === 3 ? 3 : 4;
}

/* 第二本族账出现 ⇒ 必须红。注入：建一个空的 tools/families.tsv，判完即删。 */
function negctlFamilies() {
  const pb = negctlBase();
  if (pb) return pb;
  const abs = path.join(HERE, FAMILY_ALIASES[0]);
  if (fs.existsSync(abs)) {
    console.error(`✗ 负控前提不成立：${FAMILY_ALIASES[0]} 已经存在（盘面本来就有问题），先处理它`);
    return 3;
  }
  let rc2 = 0;
  try {
    fs.writeFileSync(abs, '# 负控注入：第二本族账\n');
    rc2 = validate().rc;
  } finally {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  if (rc2 === 4) {
    console.log(`负控：建出第二本族账 ${FAMILY_ALIASES[0]} 后判红 ✓（rc=4，已删除）`);
    return 4;
  }
  console.error(`负控失败：建了第二本族账却没判红（rc=${rc2}）—— 这条断言是空的 ✗`);
  return rc2 === 3 ? 3 : 4;
}

/* ---------- 入口 ---------- */

const argv = process.argv.slice(2);
const wantAccept = argv.includes('--accept');
const wantNeg = argv.includes('--negctl');

if (wantAccept) {
  const i = argv.indexOf('--by');
  const by = i >= 0 ? (argv[i + 1] || '') : '';
  if (!by || by.startsWith('-')) {
    console.error('✗ --accept 必须带署名：--accept --by <你的名字>');
    process.exit(3);
  }
  process.exit(accept(by));
}

if (wantNeg) process.exit(negctl());
if (argv.includes('--negctl-ledger')) process.exit(negctlLedger());
if (argv.includes('--negctl-families')) process.exit(negctlFamilies());

const r = validate();
for (const l of r.out) console.log(l);
process.exit(r.rc);
