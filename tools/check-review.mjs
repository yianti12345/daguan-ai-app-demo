/* check-review.mjs —— 独立评审留痕判据（第 30 门；S7 独立评审环节）
 *
 * 起因：这一轮所有视觉与信息取舍都是我一个人做的 —— 白名单我写、负例我造、20 道门我挑，
 * 于是「门禁全绿」与「卡面长出『页面类 / 字段 5 项 / 装配 5 个应用』」同时成立。
 * 缺的不是判据，是**没有第二个人在交付前看过**，也没有任何东西要求有人看。
 *
 * 2026-10-25 加严（用户令「全面优化工作全流程」）。原来只验**最新一条**的字段，
 * 于是前面几条写得再潦草也没人管；而且没有任何东西要求评审"分得清这是哪一种活"——
 * 给一个 40 行的存量小改打分，和给一个从零做的新界面打分，是两套尺子，
 * 混在一起就出现"每次都说 9 分"。现在分档，并且要求三秒测试的**实物证据**。
 *
 * 判什么（每一条记录都要过 1-4，不只是最后一条）：
 *   1. reviewer / context / verdict / findings 齐全；
 *   2. tier 必须是 new（新界面，要打分）｜polish（存量润色，不打分）｜patch（改法明确，自检即可）；
 *   3. tier=new ⇒ score 1–10 必填，且 keep 必须非空（"哪些别动"是评审的一半产出，
 *      oil-ui reviewer-manual 的「保留：」行；没有它，下一轮必然把好东西改掉）；
 *   4. tier=new ⇒ three_second.thumb480 与 three_second.masked 两个文件必须真实存在
 *      （480px 缩略图、遮字版各看三秒；说"看过了"不算，路径要能打开）；
 *   5. 被否的发现必须写 rejected_why；
 *   6. 最新一条的 at 必须晚于界面上任何文件的最后修改时间（代码比评审新 ⇒ 评审作废）。
 * rc：0 通过；2 有违规；--negctl 必须 2。
 */
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LOG = join(HERE, 'review-log.jsonl');
const NEG = process.argv.includes('--negctl');
const TIERS = new Set(['new', 'polish', 'patch']);

/* 评审必须晚于这些文件的最后改动 */
const WATCH = ['apps.html', 'components.html', 'app.html', 'component.html',
  'assets/app.js', 'assets/component.js', 'assets/sys.css', 'assets/tokens.css',
  // xiaozhi.css 也画东西（AI 浮球、对话条），它改了同样是"界面变了"。
  // 2026-10-25 补：浮球缩到 40px、降饱和，就发生在这个文件里，原先不在 WATCH 上。
  'assets/xiaozhi.css',
  'assets/data.js', 'assets/xiaozhi.js'];

let fail = 0;
const out = (ok, label, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`); if (!ok) fail++; };
const abs = (p) => (isAbsolute(p) ? p : join(ROOT, p));

if (NEG) {
  if (!existsSync(LOG)) { console.log('  ✗ 负控无法注入：没有 review-log.jsonl'); process.exit(1); }
  const orig = readFileSync(LOG, 'utf8');
  const lines = orig.trim().split('\n').filter(Boolean);
  const rec = JSON.parse(lines[lines.length - 1]);
  rec.at = '2020-01-01T00:00:00+08:00';           /* 把最新评审时间改到很久以前 */
  rec.findings = [];                                /* 并抹掉发现 */
  delete rec.rejected_why;
  delete rec.tier;                                  /* 分档缺失 */
  delete rec.score;
  delete rec.keep;
  writeFileSync(LOG, lines.slice(0, -1).concat(JSON.stringify(rec)).join('\n') + '\n');
  const { execFileSync } = await import('node:child_process');
  let code = 0;
  try { execFileSync(process.execPath, [join(HERE, 'check-review.mjs')], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { code = e.status; }
  writeFileSync(LOG, orig);
  console.log(code === 2 ? '负控成立（评审过期+抹掉发现+去掉分档 ⇒ rc=2）' : `负控失败：注入后 rc=${code}（应 2）`);
  process.exit(code === 2 ? 2 : 1);
}

out(existsSync(LOG), 'tools/review-log.jsonl 存在', existsSync(LOG) ? '' : '没有任何外部评审留痕');
if (!existsSync(LOG)) { console.log(''); console.log('通过 0 ｜ 断点 1'); process.exit(2); }

const rows = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l, i) => {
  try { return JSON.parse(l); } catch (e) { console.log(`  ✗ 第 ${i + 1} 行不是合法 JSON`); fail++; return null; }
}).filter(Boolean);

out(rows.length > 0, '至少一条评审记录', `共 ${rows.length} 条`);

/* ── 逐条字段（每一条都要过，不只是最后一条） ── */
const fieldBad = [];
rows.forEach((r, i) => {
  const tag = `第 ${i + 1} 条`;
  if (!r.reviewer) fieldBad.push(`${tag} 缺 reviewer`);
  if (!r.context) fieldBad.push(`${tag} 缺 context（是否零上下文必须写清）`);
  if (!r.verdict) fieldBad.push(`${tag} 缺 verdict`);
  if (!Array.isArray(r.findings) || !r.findings.length) fieldBad.push(`${tag} 缺 findings`);
  if (r.reviewer && /^(lead|我|作者)$/i.test(r.reviewer)) fieldBad.push(`${tag} 评审者是作者本人`);
  for (const rj of r.rejected || []) if (!rj || !rj.why) fieldBad.push(`${tag} 被否的发现没写理由`);
});
out(!fieldBad.length, '每条都写清 reviewer / context / verdict / findings',
  fieldBad.length ? fieldBad.slice(0, 4).join('；') : `共 ${rows.length} 条`);

/* ── 分档 ── */
const noTier = rows.filter((r) => !TIERS.has(r.tier));
out(!noTier.length, '每条都分了档（new 打分 / polish 不打分 / patch 自检）',
  noTier.length ? `缺档或有野值 ${noTier.length} 条` : rows.map((r) => r.tier).join(' / '));

/* ── 新界面必须打分 + 必须写"保留行" ── */
/* 2026-10-25：分档规则是这一天加的，之前三条记录（2026-10-24）不可能有分数与保留行。
   判据不回溯改写历史，但也不许"标一句 legacy 就过关"：
   legacy 只认 at 早于分档规则生效日（2026-10-25T00:00+08:00）且写了 legacy_note 的行。 */
const RULE_DATE = Date.parse('2026-10-25T00:00:00+08:00');
const isLegacy = (r) => r.legacy === true && !!r.legacy_note && Date.parse(r.at || '') < RULE_DATE;
const legacyBad = rows.filter((r) => r.legacy === true && !isLegacy(r));
out(!legacyBad.length, 'legacy 行确实早于分档规则且有说明',
  legacyBad.length ? `${legacyBad.length} 行标了 legacy 却不满足条件（at 晚于规则日或缺 legacy_note）` : '无 legacy 行或全部合规');
const news = rows.filter((r) => r.tier === 'new' && !isLegacy(r));
const scoreBad = news.filter((r) => !(Number.isFinite(r.score) && r.score >= 1 && r.score <= 10));
out(!scoreBad.length, 'tier=new 的都给了 1–10 分',
  news.length ? `最新分 ${news[news.length - 1].score ?? '缺'}` : '本批无新界面');
const keepBad = news.filter((r) => !Array.isArray(r.keep) || !r.keep.length);
out(!keepBad.length, 'tier=new 的都写了保留行（哪些别动）',
  keepBad.length ? `${keepBad.length} 条没写保留行 —— 下一轮必然把好东西改掉` : news.map((r) => (r.keep || []).length + ' 条').join(' / '));

/* ── 三秒测试必须有实物：480 缩略图 + 遮字版 ── */
const tsBad = [];
for (const r of news) {
  const t = r.three_second || {};
  for (const k of ['thumb480', 'masked']) {
    if (!t[k]) tsBad.push(`${r.at || '?'} 缺 ${k}`);
    else if (!existsSync(abs(t[k]))) tsBad.push(`${r.at || '?'} 的 ${k} 文件不存在（${t[k]}）`);
  }
}
out(!tsBad.length, '新界面评审带三秒测试实物（480 缩略图 + 遮字版）',
  tsBad.length ? tsBad.slice(0, 3).join('；') : news.length ? '两个文件都在盘上' : '本批无新界面');

/* ── 最新一条必须晚于最后一次界面改动 ── */
let newest = 0;
for (const f of WATCH) {
  const p = join(ROOT, f);
  if (existsSync(p)) newest = Math.max(newest, statSync(p).mtimeMs);
}
const last = rows[rows.length - 1] || {};
const lastAt = Date.parse(last.at || '');
out(!!lastAt, '最新一条有 at 时间', last.at || '缺 at');

/* ── 红必须有出口：评审可以不做，但必须显式豁免并说清为什么 ──────────────────
   2026-10-26 实测：这条判据红了一整天（评审 10-25 16:18 ／ 改动 10-26 17:07），
   而它根本没接进 run-gates.sh —— 红了没人跑、跑了也没出口，等于不存在。
   所以补两件：①接进门禁；②允许豁免，但豁免必须是一次一议、写清理由、晚于改动。
   永久红 ＝ 判据会被无视；无记录的绿 ＝ 假装评审过。两者都不要。 */
const WAIVERS = join(HERE, 'review-waivers.tsv');
const ARGV = process.argv.slice(2);
const argOf = (k) => { const i = ARGV.indexOf(k); return i >= 0 ? ARGV[i + 1] : ''; };

if (ARGV.includes('--waive')) {
  const why = String(argOf('--why') || '').trim();
  const by = String(argOf('--by') || '').trim();
  if (why.length < 30) {
    console.log('✗ 豁免理由至少 30 字，必须说清"为什么这一轮不需要外部评审"（不是"没时间"）');
    process.exit(3);
  }
  if (!by) { console.log('✗ 豁免要署名：--by <你的名字>'); process.exit(3); }
  const head = 'at\tuntil\twhy\tby';
  let body = '';
  try { body = readFileSync(WAIVERS, 'utf8').trim(); } catch (e) { body = ''; }
  const lines = body ? body.split('\n').filter(Boolean) : [];
  if (lines[0] !== head) lines.unshift(head);
  lines.push([new Date().toISOString(), new Date(newest).toISOString(), why, by].join('\t'));
  writeFileSync(WAIVERS, lines.join('\n') + '\n');
  console.log('✓ 已记豁免：' + why.slice(0, 40) + '…（只在改动时间不再前进时有效，改动后需重新评或重新豁免）');
  process.exit(0);
}

/* ── 评审必须基于**眼前的这一版** ─────────────────────────────────────
   2026-10-26：上面那条只查「评审 at 晚于改动 mtime」，于是评审记录完全可以手写一条就过，
   没有任何东西证明那批判审真的看过眼下这一版界面。blind-inputs 现在会写 stamp.json
   （出图时刻 + 23 个源文件的 md5），这里拿它跟现状核对：
     · stamp 的 at 必须晚于界面最后改动 —— 改完不出图就过不去
     · stamp 里每个受监控文件的 md5 必须与现状一致 —— 光比 mtime 可以被 touch 骗过
   迁移期例外：机制上线前的记录可以写 basis_note 说明为何无凭据（要求写明，不许静默跳过）。 */
const basisBad = [];
for (const r of news) {
  const b = r.basis;
  if (!b) {
    if (!r.basis_note) basisBad.push(String(r.at) + ' 缺 basis（审的是哪一批图）');
    continue;
  }
  const dir = isAbsolute(b) ? b : join(ROOT, b);
  const sp = join(dir, 'stamp.json');
  if (!existsSync(sp)) {
    if (!r.basis_note) basisBad.push(String(r.at) + ' 的 basis 目录没有 stamp.json（' + b + '）');
    continue;
  }
  let st = null;
  try { st = JSON.parse(readFileSync(sp, 'utf8')); }
  catch (e) { basisBad.push(String(r.at) + ' 的 stamp.json 读不了：' + e.message); continue; }
  const stAt = Date.parse(st.at || '');
  if (!(stAt > newest)) {
    basisBad.push(String(r.at) + ' 引用的图（' + (st.at || '?') + '）早于界面最后改动');
  }
  for (const f of WATCH) {
    const fp = join(ROOT, f);
    if (!existsSync(fp)) continue;
    const cur = createHash('md5').update(readFileSync(fp)).digest('hex').slice(0, 16);
    const was = st.source && st.source[f] && st.source[f].md5;
    if (was && was !== cur) {
      basisBad.push(String(r.at) + ' 引用的图对应的是 ' + f + ' 的旧版本（图 ' + was + ' ／ 现 ' + cur + '）');
    }
  }
}
out(!basisBad.length, 'tier=new 的评审基于改动之后的图（stamp 时刻与源文件 md5 都对得上）',
  basisBad.length ? basisBad.slice(0, 3).join('；') : (news.length ? news.length + ' 条都有凭据' : '本批无新界面'));

let waived = null;
if (lastAt <= newest && existsSync(WAIVERS)) {
  const lines = readFileSync(WAIVERS, 'utf8').trim().split('\n').slice(1).filter(Boolean);
  for (const l of lines) {
    const [at, , why, by] = l.split('\t');
    const wAt = Date.parse(at || '');
    if (wAt && wAt >= newest && String(why || '').length >= 30) waived = { at, why, by };
  }
}
/* ── 「界面变没变」按内容判，不按 mtime ────────────────────────────────
   2026-10-26 负控当场证明 mtime 是错的口径：cp 把文件恢复原样，内容一个字节没变，
   mtime 却更新了 —— 判据于是报"评审早于改动"，而界面其实与评审时完全一致。
   反过来 touch 也能让没改过的文件看起来"刚改过"。两种都是误判。
   正确口径是内容指纹：最新一条记录里带 digest（受监控文件的 md5 map）就用它比；
   老记录没有 digest 的，退回 mtime 兜底（迁移期，且会被 basis_note 约束）。 */
const digestOf = () => {
  const m = {};
  for (const f of WATCH) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    m[f] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 16);
  }
  return m;
};
let baseRec = null;
for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].digest) { baseRec = rows[i]; break; } }
if (baseRec) {
  const cur = digestOf();
  const diff = Object.keys(baseRec.digest).filter((f) => cur[f] && baseRec.digest[f] !== cur[f]);
  out(!diff.length, '评审之后界面内容没变（按 md5 判，不按 mtime）',
    diff.length ? '以下文件内容已变，需要重新出图并评审：' + diff.join(' / ')
      : '与评审时逐文件一致（' + Object.keys(baseRec.digest).length + ' 个文件）');
} else {
  out(lastAt > newest, '评审晚于界面最后改动（无 digest 的记录退回 mtime 兜底）',
    lastAt ? `评审 ${last.at} ／ 最晚改动 ${new Date(newest).toLocaleString('zh-CN', { hour12: false })}` : '无法比较');
}

if (waived) {
  console.log('  · 本轮评审已豁免（' + waived.at + ' by ' + waived.by + '）：' + waived.why);
} else {
  
}

console.log('');
console.log(`通过 ${fail ? 0 : 1} ｜ 断点 ${fail}`);
process.exit(fail ? 2 : 0);
