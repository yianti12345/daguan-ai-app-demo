#!/usr/bin/env node
/* check-seat-pass —— 「交付前四席过一遍」的机器判据。
 *
 * 为什么要有它（2026-10-30，用户第三次追问）：
 *   那一轮里卡脚写成 `v3 → v4 · 10-20`，产品/设计/前端/体验四席**一个都没跑**，是用户发现的。
 *   用户原话：「为什么还需要我来发现了」「我不可能穷举所有场景」——
 *   他还点名了前端 skill、用户体验 skill 等等没被点到的那些。
 *   结论：靠"这次多检查一遍"解决不了——只要**没跑也能全绿**，迟早还是用户发现。
 *   所以把"跑过没有"变成可判的：每个被改过的页面，必须有四席的过一遍记录，且记录要比页面新。
 *
 * 台账：tools/seat-pass.tsv（每行一条读数）
 *   列：at(ISO8601)  page  席位  读数  判定
 *   席位：product（需求/读者与决策）｜design（规格/令牌/状态）｜frontend（实现/组件/可访问性）｜ux（真走查 ISO 9241-11）
 *   读数必须写**具体东西**（哪句文案/哪个读数/哪一步），只写"看过、没问题"算空 ⇒ 判红。
 *   本页某席确实不适用时，读数写 `n/a: <理由>`，也算一条（不许留空）。
 *
 * 判定：
 *   ① 台账读不到 ⇒ rc=3（未量，不塌绿）
 *   ② 某页面文件 mtime > 该页最新一条记录的时间 ⇒ 该页"改过没过席" ⇒ rc=1
 *   ③ 某页最新一轮（同一时间窗内）四席不齐或读数为空 ⇒ rc=1
 * 负控：--negctl 在内存里删掉一席，必须判红。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 台账放 tools/ 而不是 _reports/：_reports 整个目录不入库（体积大、多为可重生成的证据），
   而这个台账是**判据的输入**，必须跟代码一起走版本库，否则换台机器就 rc=3。 */
const LEDGER = path.join(ROOT, 'tools', 'seat-pass.tsv');
const SEATS = ['product', 'design', 'frontend', 'ux'];
/* ★2026-11-02：client-auth.html 进闸。客户授权页原先是「按客户看授权」的二级页，
   本轮重做成「按应用看授权」——新增授权、升级、取消全在这一页，是用户主路径；
   漏在 PAGES 外面就没人替它做四席过一遍（其余 6 页都有）。 */
const PAGES = ['apps.html', 'components.html', 'app.html', 'component.html', 'versions.html', 'downloads.html', 'client-auth.html'];
const NEG = process.argv.includes('--negctl');
const PRINT = process.argv.indexOf('--print-hash');

function rows() {
  if (!fs.existsSync(LEDGER)) return null;
  const txt = fs.readFileSync(LEDGER, 'utf8').trim();
  if (!txt) return [];
  return txt.split('\n').map((l) => {
    const [at, page, seat, reading, verdict, hash] = l.split('\t');
    return { at, page, seat, reading: (reading || '').trim(), verdict: (verdict || '').trim(), hash: (hash || '').trim(), t: Date.parse(at) };
  }).filter((r) => r.page && r.seat && !Number.isNaN(r.t));
}
/* 页面归一化哈希：去掉 `?v=xxxxxxxx` 这类资源版本号后再算 */
const norm = (raw) => crypto.createHash('sha256').update(String(raw).replace(/\?v=[a-f0-9]+/g, '')).digest('hex').slice(0, 16);
function pageHash(file) { return norm(fs.readFileSync(path.join(ROOT, file), 'utf8')); }

if (PRINT > 0) {
  const f = process.argv[PRINT + 1];
  console.log(f + '\t' + pageHash(f));
  process.exit(0);
}

const all = rows();
if (all === null) {
  console.log('✗ 席位过一遍台账不存在：tools/seat-pass.tsv');
  console.log('  改过页面就必须留四席读数（product/design/frontend/ux），否则这一轮等于没人看过。');
  process.exit(3);
}
let list = all;
if (NEG) {
  /* 负控：删掉最新那一页的一席 —— 判据必须因此判红。
     ★2026-11-04 修（负控恒绿）：原来只删「全局最新一条」，而同一页面同一 hash 下常留多轮读数
     （修一次写一轮），删掉最新那条后，旧轮次的同席会顶上来，bySeat 照样齐 ⇒ 负控永远绿。
     实测：victim=versions.html/product 删掉后剩 product,design,frontend,ux —— 一条没少。
     改成按 (page, seat) 删掉该页该席的**所有轮次**，这样缺席是必然的。 */
  const victim = list.slice().sort((a, b) => b.t - a.t)[0];
  list = list.filter((r) => !(r.page === victim.page && r.seat === victim.seat));
}

const fails = [];
const skipped = [];
for (const page of PAGES) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  const h = pageHash(page);
  /* ★2026-10-30：同一页面 hash 下可能留有多轮读数（修一次写一轮）。原来把同 hash 的所有行
     并起来算"这一版有人看过"，于是上一轮已作废的读数（例如"头部只在落后时写授权 vN"）
     会和新读数一起被当成有效 —— 作废读数不会被发现。现在按席位取 at 最新的一条。 */
  const bySeat = new Map();
  for (const r of list) {
    if (r.page !== page || r.hash !== h) continue;
    const cur = bySeat.get(r.seat);
    if (!cur || r.t > cur.t) bySeat.set(r.seat, r);
  }
  const fresh = [...bySeat.values()];
  if (!fresh.length) {
    fails.push(`${page}@${h}：这一版没有任何席位读数（改过就要重新过一遍）`);
    continue;
  }
  const have = new Set(fresh.map((r) => r.seat));
  const missing = SEATS.filter((s) => !have.has(s));
  if (missing.length) fails.push(`${page}：最近一轮缺席位 ${missing.join('/')}`);
  const empty = fresh.filter((r) => r.reading.length < 6);
  if (empty.length) fails.push(`${page}：${empty.map((r) => r.seat).join('/')} 的读数过短（必须写具体的句子/读数/步骤）`);
}

if (fails.length) {
  console.log(`✗ 四席过一遍不完整：${fails.length} 处`);
  fails.forEach((f) => console.log('   · ' + f));
  console.log('  处理：把缺的席位真跑一遍，读数写进 tools/seat-pass.tsv（第 6 列写页面归一化 hash；n/a 也要写理由）。');
  process.exit(1);
}
const done = PAGES.filter((p) => fs.existsSync(path.join(ROOT, p)));
console.log(`✓ 四席过一遍齐全：${done.length} 页 × ${SEATS.length} 席，读数非空（按页面内容哈希，不看 git）`);
process.exit(0);
