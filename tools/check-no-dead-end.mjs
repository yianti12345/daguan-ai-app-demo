#!/usr/bin/env node
/* check-no-dead-end —— 页面上不许出现"没有出口"的入口与状态。
 *
 * 为什么要有它（2026-10-30 同一件事被指出两次）：
 *   应用卡上曾经印着「需客户确认 v3」，⋮ 菜单里是一条 aria-disabled 的
 *   「需客户确认后才能升级」。走查已判 P0（"谁确认、怎么确认、能否代确认，全无"），
 *   但没有任何机器判据拦住它，于是第二天用户在原处又看见一次：
 *   「为什么配置页面会出现等客户确认？？你来告诉我，这个是什么页面」。
 *   问题不是措辞：这 5 页的使用者是平台自己 —— 新建、装配、发布、上下架都由他一人做，
 *   客户不在这个系统里。把"等客户"写成卡上的状态，等于把动作挂在一个不会出现的人身上。
 *
 * 两条断言（都只认机器可核的证据）：
 *   D1 菜单项必须可执行：每个 <button class="k-mi …"> 到它的 </button> 之间必须有 data-act。
 *      一个点下去没有任何动作的菜单项＝死入口。
 *   D2 状态不许挂站外角色：源码（剥注释后）不得出现
 *      「需/等/待/等待/需要 + 客户/甲方/审批/上级/领导/第三方/管理员 + 确认/审批/签字/同意」。
 *      站外角色＝本系统里没有的人；这类句式必然对应一个本页推不动的状态。
 *      （若将来真做了客户侧门户，先改本判据的角色名单，不许在页面上写同义句绕开。）
 *
 * 扫描面：6 个页面 + assets/*.js（文案大量拼在 JS 里，只扫 HTML 会漏）。
 *
 * 用法：
 *   node tools/check-no-dead-end.mjs            正控（0 处即绿）
 *   node tools/check-no-dead-end.mjs --negctl   负控（内置夹具必须被抓；抓住退 2）
 *   node tools/check-no-dead-end.mjs --selftest 夹具自检（正负样本都按预期）
 * 退出码：0 绿 ｜ 1 有红（或负控没抓住）｜ 2 负控成立
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['apps.html', 'app.html', 'components.html', 'component.html', 'versions.html', 'downloads.html'];

/* 剥注释：注释不是界面，也不是可执行代码。保留换行，行号不漂。 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

/* D1：菜单项必须有动作。按"从 <button class="k-mi 到它自己的 </button>"切段，
   因为标签是字符串拼接出来的（class 与 data-act 可能不在同一个字面量里），
   对整条源码跑 /<button[^>]*>/ 会漏掉拼接形态。 */
function deadMenuItems(src) {
  const out = [];
  const openRe = /<button class="k-mi\b/g;
  let m;
  while ((m = openRe.exec(src))) {
    const close = src.indexOf('</button>', m.index);
    if (close < 0) continue;
    const seg = src.slice(m.index, close);
    if (!/data-act=/.test(seg)) {
      const line = src.slice(0, m.index).split('\n').length;
      const label = (seg.match(/>([^<>'"]*)$/) || [, ''])[1].trim();
      out.push({ line, label: label || seg.replace(/\s+/g, ' ').slice(0, 60) });
    }
    openRe.lastIndex = close;
  }
  return out;
}

/* D2：状态挂在站外角色上。 */
const OFF_PAGE = /(需|等|待|等待|需要|正在等)(客户|甲方|审批|上级|领导|第三方|管理员)[^，。；！？\n]{0,6}(确认|审批|签字|同意)/;
function offPageStates(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    if (OFF_PAGE.test(line)) out.push({ line: i + 1, text: line.trim().slice(0, 100) });
  });
  return out;
}

function scan(name, src) {
  const body = stripComments(src);
  const hits = [];
  for (const d of deadMenuItems(body)) hits.push({ file: name, kind: 'D1 菜单项没有动作', line: d.line, text: d.label });
  for (const d of offPageStates(body)) hits.push({ file: name, kind: 'D2 状态挂在站外角色上', line: d.line, text: d.text });
  return hits;
}

const argv = process.argv.slice(2);
const NEG = argv.includes('--negctl');
const SELFTEST = argv.includes('--selftest');

/* ── 夹具：正样本必须 0 命中，负样本必须各命中 1 条及以上 ────────────── */
const FIXTURES = [
  { name: 'ok-菜单项有动作', want: 0, src: `<button class="k-mi" data-act="upgrade" data-id="x">升级至 v3</button>` },
  { name: 'ok-拼接形态', want: 0, src: `'<button class="k-mi' + (up ? ' is-danger' : '') + '" type="button" role="menuitem" data-act="toggle" data-id="' + id + '">' + t + '</button>'` },
  { name: 'ok-正常提到客户', want: 0, src: `<button class="k-mi" data-act="x">下架</button> 客户会立刻打不开这个应用，确认后不可见` },
  { name: 'ok-注释里的旧文案不算', want: 0, src: `/* 原来这里是「需客户确认后才能升级」 */ <button class="k-mi" data-act="upgrade">升级至 v3</button>` },
  { name: 'bad-死菜单项', want: 1, src: `<button class="k-mi" type="button" role="menuitem" aria-disabled="true" title="…">需客户确认后才能升级</button>` },
  { name: 'bad-等客户', want: 1, src: `<span>等客户确认后再发布</span>` },
  /* 注意：这条夹具必须带"人/角色"。本产品的业务文案里「待审核 / 待审批」是**单据的状态**
     （查重队列就写着"待我审"），不是页面动作在等某个站外的人 —— 那是合法业务词，
     不许被判据吃掉。D2 认的是"等谁"，不是"等什么状态"。 */
  { name: 'bad-待上级批准', want: 1, src: `'待上级审批通过后生效'` },
];

function runFixtures() {
  let bad = 0;
  for (const f of FIXTURES) {
    const n = scan(f.name, f.src).length;
    const pass = f.want === 0 ? n === 0 : n >= f.want;
    console.log(`  ${pass ? '✓' : '✗'} ${f.name}：命中 ${n}（期望 ${f.want === 0 ? '0' : '≥' + f.want}）`);
    if (!pass) bad++;
  }
  return bad;
}

if (SELFTEST) {
  const bad = runFixtures();
  console.log(bad ? `✗ 夹具自检不过：${bad} 条` : `✓ 夹具自检通过：${FIXTURES.length}/${FIXTURES.length}`);
  process.exit(bad ? 1 : 0);
}

const files = PAGES.filter((p) => fs.existsSync(path.join(ROOT, p)))
  .concat(fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js')).map((f) => 'assets/' + f));

let hits = [];
for (const f of files) hits = hits.concat(scan(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));

if (NEG) {
  const knife = scan('夹具-死入口', `<button class="k-mi" aria-disabled="true">需客户确认后才能升级</button>`);
  if (knife.length >= 2) {
    console.log(`✓ 负控成立（rc=2）：死菜单项与站外角色状态各被抓到 1 条`);
    for (const k of knife) console.log(`   ${k.kind}｜${k.text}`);
    process.exit(2);
  }
  console.log('✗ 负控失败：注入的死入口没被抓到，这条判据是空的'); process.exit(1);
}

if (hits.length) {
  console.log(`✗ 发现 ${hits.length} 处没有出口的入口/状态（扫 ${files.length} 个文件）`);
  for (const h of hits) console.log(`   ${h.file}:${h.line}｜${h.kind}｜${h.text}`);
  console.log('   处理：D1 → 菜单项要么给 data-act，要么不要进菜单；D2 → 拍板的人必须是本页的使用者，');
  console.log('         风险用确认框说清后果，不许写成"等客户/等审批"。');
  process.exit(1);
}
console.log(`✓ 没有死入口：菜单项全部有动作，页面无"等站外角色确认"的状态（扫 ${files.length} 个文件）`);
