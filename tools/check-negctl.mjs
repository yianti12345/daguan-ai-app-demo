#!/usr/bin/env node
/* check-negctl —— **不会红的判据等于没有判据**。负控台账的完整性闸。
 *
 * 2026-10-26 的病：判据写了 43 条，其中假桩、假绿、假红各抓到一个 ——
 *   假桩：验「window 属性被替换了」，而执行层走的是作用域绑定，桩从未生效；
 *   假绿：「事故区间落在视区」在事故块 0 个时靠页脚可见判绿；
 *   假红：「废弃草稿」实测 150ms 就出确认条，探针却三路全 0。
 * 三次都不是「判据写错了分寸」，是**判据从没证明过自己会红**。
 *
 * 这条不跑负控（跑一次要几分钟，不适合每轮做），它管三件事：
 *   ① 每个 check-* 必须在 tools/negctl.tsv 有一条 —— 没有账的判据不知道自己能不能红；
 *   ② 「上次实测」超过 30 天即红 —— 判据和被测对象都会漂，负控会腐烂；
 *   ③ 结果不是 pass 即红。
 *
 * 为什么不自动跑：负控要篡改被测对象或注入假数据，逐条跑一次全量判据要十几分钟。
 *   每轮强制重跑＝门禁变成一个没人愿意等的东西，最后一定被绕过。
 *   定期实测 + 到期强制，是这个成本下能守住的最强形态。
 *
 * 用法：node tools/check-negctl.mjs [--days=30]
 * 退出码：0 台账完整且未过期 ｜ 1 有缺账/过期/未通过 ｜ 3 读不到台账
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, 'negctl.tsv');
const RUNS = path.join(HERE, 'negctl-runs.json');
const argDays = process.argv.find((a) => /^--days=\d+$/.test(a));
const MAX_AGE = argDays ? Number(argDays.split('=')[1]) : 30;

const files = readdirSync(HERE).filter((f) => /^check-.*\.mjs$/.test(f) && f !== 'check-negctl.mjs').sort();

if (!existsSync(LEDGER)) {
  console.log('✗ 没有 tools/negctl.tsv —— 一条都没有账，等于所有判据的"会红"都没被证明过');
  process.exit(3);
}
const lines = readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean);
if (!lines[0].startsWith('判据')) { console.log('✗ negctl.tsv 表头不对'); process.exit(3); }

const ledger = new Map();
for (const l of lines.slice(1)) {
  const c = l.split('\t');
  if (c.length < 5) { console.log('✗ negctl.tsv 行列数不足（要 6 列）：' + l.slice(0, 50)); process.exit(3); }
  ledger.set(c[0].trim(), { how: c[1] || '', at: (c[2] || '').trim(), result: (c[3] || '').trim(), due: (c[4] || '').trim(), note: c[5] || '' });
}

/* ★2026-11-04：原来只扫 `check-*.mjs`，于是 walk.mjs 这类不叫 check- 前缀的判据整条被漏掉 ——
   它台账里写着 fail，NEGCTL 却当它不存在。台账里登记过的脚本，只要真在磁盘上，一律纳入。 */
for (const k of ledger.keys()) {
  if (!files.includes(k) && existsSync(path.join(HERE, k))) files.push(k);
}
files.sort();

const today = new Date().toISOString().slice(0, 10);

/* 结果列历史上有两种写法：字面 `pass`，和描述式 `rc=2；通过 1/9，红 8（…）`。
   后者语义上就是「能红」，不认它会把本来就跑通的判据判成不合格。只认这两种。 */
const isPass = (v) => /^pass\b/i.test(String(v || '')) || /\brc\s*=\s*[12]\b/.test(String(v || ''));

/* ── --measure：真跑每条判据的 --negctl，把 rc 落成证据（判别证据要能附上，不能只在台账里写 pass）──
   「覆盖率不等于测试有效」同理：台账写 pass 不等于它真会红。这一步是唯一能产出证据的地方。
   用法：node tools/check-negctl.mjs --measure [--only=<子串>] [--days=N] */
if (process.argv.includes('--measure')) {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  const targets = files.filter((f) => !only || f.includes(only));
  const out = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, 'utf8')) : {};
  console.log('负控实测：' + targets.length + ' 条' + (only ? '（--only=' + only + '）' : ''));
  for (const f of targets) {
    const t0 = Date.now();
    const r = spawnSync('node', [path.join(HERE, f), '--negctl'], { timeout: 240000, encoding: 'utf8' });
    const rc = r.status === null ? 124 : r.status;
    const full = (r.stdout || '') + (r.stderr || '');
    const head = full.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
    /* red = 这次负控到底有没有「判出红」的痕迹。不能只看 rc：CRITLOCK 的负控就是 rc=4
       （它的 4 表示"改了未记录的判据"），而别的判据 rc=4 表示"前提不成立"。
       所以 rc 只当参考，真正的判据是输出里有没有 ✗ / FAIL / 判红。 */
    out[f] = { at: today, rc, ms: Date.now() - t0, head: head.slice(0, 120), red: /✗|FAIL|判红/.test(full) };
    /* ★2026-11-04：逐条落盘，不要等全跑完才写。全量含浏览器判据，单条可能 30s～240s，
       中途卡住/被杀时若只在末尾写一次，前面几十条的证据全丢 —— 长任务不能靠一次收尾。 */
    writeFileSync(RUNS, JSON.stringify(out, null, 2) + '\n');
    console.log('  ' + (rc === 1 || rc === 2 ? '红' : rc === 3 ? '未量' : '没红') + ' rc=' + rc + '  ' + String(Date.now() - t0).padStart(6) + 'ms  ' + f);
  }
  writeFileSync(RUNS, JSON.stringify(out, null, 2) + '\n');
  console.log('已落盘 ' + path.relative(path.join(HERE, '..'), RUNS) + '（' + Object.keys(out).length + ' 条）');
}

const noLedger = files.filter((f) => !ledger.has(f));
const failed = [];
const stale = [];
const untested = [];
let passed = 0;

for (const f of files) {
  const r = ledger.get(f);
  if (!r) continue;
  /* 顺序很重要：先判「有没有实测过」，再判「结果好不好」。
     反过来的话，"未实测"会被当成"结果不是 pass"直接判红 —— 第一版就是这样，
     43 条里 37 条立刻变红，而那 37 条只是还没补测、并没过期。 */
  if (!r.at) {
    if (r.due && r.due < today) untested.push({ f, due: r.due });
    else untested.push({ f, due: r.due || '未设到期', pending: true });
    continue;
  }
  if (!isPass(r.result)) { failed.push({ f, r: r.result }); continue; }
  const age = (Date.parse(today) - Date.parse(r.at)) / 86400000;
  if (age > MAX_AGE) stale.push({ f, at: r.at, age: Math.round(age) });
  else passed++;
}

console.log('负控台账 @ tools/negctl.tsv');
console.log('判据 ' + files.length + ' 条 ｜ 负控有效 ' + passed + ' ｜ 未实测 ' + untested.filter((x) => !x.pending).length +
  ' ｜ 待补测 ' + untested.filter((x) => x.pending).length + ' ｜ 过期 ' + stale.length + ' ｜ 不合格 ' + failed.length);

if (untested.length) {
  console.log('\n未实测（有到期日的不算红，到期才红）：');
  for (const u of untested.slice(0, 8)) {
    console.log('  · ' + u.f.padEnd(34) + (u.pending ? '到期 ' + u.due : '已过期 ' + u.due));
  }
  if (untested.length > 8) console.log('  …另有 ' + (untested.length - 8) + ' 条');
}

const bad = [];
if (noLedger.length) bad.push(...noLedger.map((f) => ({ f, why: '台账里没有这一条' })));
if (stale.length) bad.push(...stale.map((x) => ({ f: x.f, why: '上次实测 ' + x.at + '（' + x.age + ' 天前），超过 ' + MAX_AGE + ' 天' })));
if (failed.length) bad.push(...failed.map((x) => ({ f: x.f, why: '负控结果不是 pass：' + x.r })));
bad.push(...untested.filter((u) => !u.pending).map((u) => ({ f: u.f, why: '到期 ' + u.due + ' 仍未实测' })));

/* ★2026-11-04 证据链（本轮加）：台账写 pass，必须有实测产物对得上。
   只核「有产物、且产物不早于台账日期」的组合 —— 没产物不算红（否则这机制上线当天全红），
   但一旦有产物而 rc 不在 {1,2}，台账那句 pass 就是假的，当场判红。
   这就是「判别证据必须是可附产物，不是口头声明」在机器上的形状。 */
const runs = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, 'utf8')) : {};
const lie = [];
for (const f of files) {
  const r = ledger.get(f);
  const m = runs[f];
  if (!r || !m || !isPass(r.result)) continue;
  if (m.at < r.at) continue;
  if (m.rc === 1 || m.rc === 2) continue;
  if (m.rc !== 0 && m.red) continue;   // 非 0 且输出里真有红（CRITLOCK 的 rc=4 属这类）
  lie.push({ f, rc: m.rc, at: m.at });
}
if (lie.length) {
  bad.push(...lie.map((x) => ({ f: x.f, why: '台账写 pass，但 ' + x.at + ' 实测 rc=' + x.rc + '（判别证据对不上）' })));
}

if (bad.length) {
  console.log('\n✗ ' + bad.length + ' 条判据的「会红」没有被证明：');
  for (const b of bad.slice(0, 10)) console.log('    ' + b.f.padEnd(34) + b.why);
  console.log('\n修法：跑一次负控（见台账第二列），把日期与结果填回 tools/negctl.tsv。');
  console.log('不会红的判据等于没有判据 —— 它只会在真正出问题时保持沉默。');
  process.exit(1);
}

console.log('\n✓ 台账完整，且没有过期的负控。');
process.exit(0);
