#!/usr/bin/env node
/* check-quote-provenance —— 「用户原话」必须真在会话里说过。
 *
 * 为什么要有它（2026-10-27 事故）：
 *   我在汇报里写出了一条"业务闭环：复制客户链接 → 客户打开 → 回滚"，
 *   用户当场否掉：「没有所谓的复制客户链接 → 客户打开 → 回滚？？这什么逻辑？」
 *   那条闭环不是他说的，是我从自己的实现反推出来的，却写成了产品事实。
 *   同类还有「用户口径」「用户要求」「他说」——这四类标记一出现，
 *   后面引的那句话就必须能在真实会话转写里逐字找到；找不到 = 编的。
 *
 * 判什么：
 *   扫根目录 *.md、assets/*.js、tools/*.mjs 里的引文标记，取出引号内容；
 *   取引文里最长的一段"无标点无空白"连续字（≥8 字）当针，
 *   在 ~/.qoder/projects 与 ~/.workbuddy/projects 的转写里逐字检索。
 *   找不到 ⇒ 判红。修法二选一：①改成真正的原话引用；②标成「助手假设」并写依据。
 *
 * 不做：不判话说得好不好，只判"有没有人说过"；不扫 _bak/_reports（历史件）。
 *
 * 用法：
 *   node tools/check-quote-provenance.mjs            正控（rc=0 才算全部有出处）
 *   node tools/check-quote-provenance.mjs --selftest 自检：造假引文必须判红（绿=通过，rc=0）
 *   node tools/check-quote-provenance.mjs --negctl   门禁负控：造假引文必须判红（红=成立，rc=2）
 *   node tools/check-quote-provenance.mjs --list     列出抽到的引文与判定
 *
 * 退出码：0 全部有出处 ｜ 2 有编造引文（--negctl 档：负控成立）｜ 3 转写读不到（未量，不许当绿）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const SELFTEST = process.argv.includes('--selftest');
const NEGCTL = process.argv.includes('--negctl');
const NEGCTL_SELF = process.argv.includes('--negctl-self');
const LIST = process.argv.includes('--list');

const CLAIM = /(用户原话|用户口径|用户要求|用户明确|他说|她说的?)[：:，,]?\s*[「“"]([^」”"]{6,200})[」”"]/g;
const SKIP_DIR = new Set(['_bak', '_reports', 'node_modules', '.git', '_staging', 'blind-inputs', 'shots']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function targets(extra) {
  const hit = walk(ROOT).filter((f) => {
    const rel = path.relative(ROOT, f);
    if (/\.md$/i.test(f) && !rel.includes(path.sep)) return true;
    if (/assets[\\/][^\\/]+\.js$/i.test(f)) return true;
    if (/tools[\\/][^\\/]+\.mjs$/i.test(f)) return true;
    return false;
  });
  /* ★2026-10-28 修（盲审条件 6）：不许扫自己。
     本文件的 --selftest 分支里写着一行模板 `用户原话：「…」`，CLAIM 会把它当成一条真引文：
     于是正常跑会印「抽到 23 条」，其中 1 条是**判据自己的样例**，而不是任何文档里的声明。
     它取不出 12 字针（内容是 `' + marker + '`），判不出红也判不出绿，却让条数虚高一条 ——
     读者会把「23 条全有出处」当成覆盖，实际可核的是 22 条。
     自指记录在任何一份"证明有人说过"的账里都是噪声，直接从扫描面剔掉。
     这一刀值不值得留，由 --negctl-self 证明（剔掉前后各有一条自指记录）。 */
  const all = extra ? hit.concat([extra]) : hit;
  return all.filter((f) => path.resolve(f) !== path.resolve(SELF));
}

function quotesIn(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const out = [];
  let m;
  CLAIM.lastIndex = 0;
  while ((m = CLAIM.exec(txt)) !== null) {
    out.push({ file: path.relative(ROOT, file), mark: m[1], quote: m[2], line: txt.slice(0, m.index).split('\n').length });
  }
  return out;
}

function transcriptRoots() {
  const roots = [];
  /* ★2026-10-30：原来只认 ~/.qoder（国际版）与 ~/.workbuddy。
     本机活的是 **~/.qoder-cn**（CN 版，见 reference-qoder-toolchain-limits 的「先认活根」），
     于是这一场会话里用户说的每句原话在本判据眼里都"找不到" —— 判据在扫一棵死树。
     死根留着（老会话证据还在里面），活根必须在前。 */
  const qcn = path.join(os.homedir(), '.qoder-cn', 'projects');
  const q = path.join(os.homedir(), '.qoder', 'projects');
  const w = path.join(os.homedir(), '.workbuddy', 'projects');
  if (fs.existsSync(qcn)) roots.push(qcn);
  if (fs.existsSync(q)) roots.push(q);
  if (fs.existsSync(w)) roots.push(w);
  return roots;
}

/* 针＝引文里最长的一段无标点无空白连续字（≥8 字取前 12）。
   为什么不整句比：转写是 JSON，空白/转义会变；12 个字逐字命中已足以证明"这句真被说过"。 */
function needleOf(quote) {
  const runs = String(quote)
    .split(/[\s\u3000，。、；：！？,.;:!?…—－\-「」“”"'（）()【】]/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const best = runs[0] || '';
  return best.length >= 8 ? best.slice(0, 12) : '';
}

/* 逐个针问一次"在不在"。
   为什么不用一次 rg -o 多模式：-o 的 --max-count 是**按文件**截断的，
   同一份转写里第 2 个针永远不会被打印出来 —— 那样会把有出处判成没出处（假红）。
   逐针 -q 只回退出码，稳、也不会因为某句在库里出现上万次而爆输出。 */
function foundNeedles(needles) {
  if (!needles.length) return new Set();
  const roots = transcriptRoots();
  const found = new Set();
  for (const n of needles) {
    const r = spawnSync('rg', ['-F', '-q', '--no-messages', '-e', n, ...roots], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (r.error) return null;
    if (r.status === 0) found.add(n);
  }
  return found;
}

function check(extra) {
  const qs = [];
  for (const f of targets(extra)) {
    try { qs.push(...quotesIn(f)); } catch (e) { /* 非文本件 */ }
  }
  for (const q of qs) q.needle = needleOf(q.quote);
  const needles = [...new Set(qs.map((q) => q.needle).filter(Boolean))];
  const hit = foundNeedles(needles);
  if (hit === null) return { rc: 3, qs, bad: [] };
  const bad = qs.filter((q) => q.needle && !hit.has(q.needle));
  return { rc: bad.length ? 2 : 0, qs, bad };
}

if (SELFTEST) {
  if (!transcriptRoots().length) { console.log('FATAL: 转写根找不到 ⇒ 未量（rc=3）'); process.exit(3); }
  /* 标记必须是运行时随机串：写死的字符串会出现在本仓源码里，而源码又被转写记录，
     那样"编造的引文"反而变成"有出处"，自检永远红不了（本轮踩过）。 */
  const marker = '自检' + randomUUID().replace(/-/g, '');
  const tmp = path.join(os.tmpdir(), 'qp-selftest-' + Date.now() + '.md');
  fs.writeFileSync(tmp, '用户原话：「' + marker + '」\n');
  const r = check(tmp);
  fs.unlinkSync(tmp);
  if (r.rc === 3) { console.log('FATAL: rg 不可用或转写读不到 ⇒ 未量（rc=3）'); process.exit(3); }
  const caught = r.bad.some((q) => q.quote.indexOf(marker) >= 0);
  console.log(caught ? '✓ 自检通过：编造的引文被判红' : '✗ 自检失败：编造的引文没被抓住 ⇒ 这条臂不会红');
  process.exit(caught ? 0 : 2);
}

/* 负控（门禁口径）：run-gates.sh --negctl 里每条判据都必须"被打红"。
   与 --selftest 的分工：selftest 是自证（抓到了 = 通过 = rc 0）；negctl 是门禁档
   （抓到了 = 负控成立 = rc 2）。两支都要在盘上，混成一支会把"负控成立"印成"正控通过"。 */
if (NEGCTL) {
  if (!transcriptRoots().length) { console.log('FATAL: 转写根找不到 ⇒ 未量（rc=3）'); process.exit(3); }
  const marker = '负控' + randomUUID().replace(/-/g, '');
  const tmpNeg = path.join(os.tmpdir(), 'qp-negctl-' + Date.now() + '.md');
  /* 拼装而不是写字面量：字面量 `用户原话：「…」` 会被本脚本自己的 CLAIM 抓成一条"引文"，
     于是台账里多出一条指向本文件的自指记录（selftest 那行已经是这样，属于已知缺陷）。 */
  fs.writeFileSync(tmpNeg, '用户原话' + '：「' + marker + '」\n');
  const rn = check(tmpNeg);
  fs.unlinkSync(tmpNeg);
  if (rn.rc === 3) { console.log('FATAL: rg 不可用或转写读不到 ⇒ 未量（rc=3）'); process.exit(3); }
  const caughtNeg = rn.bad.some((q) => q.quote.indexOf(marker) >= 0);
  if (caughtNeg) { console.log('负控：注入一条没人说过的引文，判红 ✓（rc=2）'); process.exit(2); }
  console.log('✗ 负控失败：伪造引文没被判红 ⇒ 这条臂不会红');
  process.exit(1);
}

/* 负控（针对"不扫自己"这一刀）：证明剔掉的那一行确实是会变成引文的模板 ——
   即：如果把它放回扫描面，条数里就会多一条自指记录。三档都要真跑：
   ① 自文件必须已不在扫描面（否则这一刀没接上）② 自文件里确实存在 1 条会被 CLAIM 命中的模板
   ③ 正常跑的结果里不许有来自自文件的条目。
   退出码：2 负控成立 ｜ 1 一刀没接上 ｜ 3 前提不成立（模板没了 ⇒ 这一支已无意义，属未量） */
if (NEGCTL_SELF) {
  if (targets(null).some((f) => path.resolve(f) === path.resolve(SELF))) {
    console.log('✗ 负控失败：判据自己还在扫描面里 —— 这一刀没接上');
    process.exit(1);
  }
  let phantom = [];
  try { phantom = quotesIn(SELF); } catch (e) { /* 下面按空处理 */ }
  if (!phantom.length) {
    console.log('✗ 前提不成立：自文件里已经取不到任何声明式引文（模板被改了）⇒ 这一支没东西可证（rc=3，未量）');
    process.exit(3);
  }
  const namesInRun = check(null).qs.filter((q) => q.file === path.relative(ROOT, SELF));
  if (namesInRun.length) {
    console.log(`✗ 负控失败：正常跑的 ${namesInRun.length} 条引文来自自文件 —— 排除没生效`);
    process.exit(1);
  }
  console.log(`负控成立（rc=2）：自文件里确有 ${phantom.length} 条会被 CLAIM 抓到的模板（「${phantom[0].quote.slice(0, 24)}」），已按自文件排除，正常跑不再计入`);
  process.exit(2);
}

if (!transcriptRoots().length) {
  console.log('FATAL: 找不到会话转写（~/.qoder/projects 或 ~/.workbuddy/projects）⇒ 未量，不许当绿');
  process.exit(3);
}

const r = check(null);
if (r.rc === 3) { console.log('FATAL: rg 不可用 ⇒ 未量，不许当绿'); process.exit(3); }
if (LIST) {
  for (const q of r.qs) console.log((r.bad.includes(q) ? '✗ ' : '✓ ') + q.file + ':' + q.line + '｜' + q.mark + '「' + q.quote.slice(0, 36) + '」');
}
console.log(`引文出处｜抽到 ${r.qs.length} 条声明式引文（可核 ${r.qs.filter((q) => q.needle).length} 条；${r.qs.length - r.qs.filter((q) => q.needle).length} 条取不出 12 字针，不判）｜无出处 ${r.bad.length} 条`);
/* ★2026-10-28（盲审条件 6 的后半句）：读者会把「N 条全有出处」当成「整句核过」。
   口径必须写在读数旁边，不许只写在文件头注释里。 */
console.log('  口径：12 字针逐字命中 = 这句真被人说过；不等于整句核过（整句靠抽检，见 _reports 里的盲审件）');
if (r.bad.length) {
  for (const q of r.bad) console.log(`  ✗ ${q.file}:${q.line}｜${q.mark}「${q.quote.slice(0, 46)}」在会话转写里找不到`);
  console.log('  处理：①改成真正的原话引用；②或把断言标成「助手假设」并写依据。不许留着当用户口径。');
  process.exit(2);
}
console.log('  ✓ 全部引文都能在真实会话转写里逐字找到');
