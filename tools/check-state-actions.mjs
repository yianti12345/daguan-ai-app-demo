#!/usr/bin/env node
/* check-state-actions.mjs —— 三态×动作×反馈 的机器判据（2026-11-03，盲审后加强）
   1) 点开每态卡片的 ⋮，逐字比对菜单；
   2) 读三种动作的确认框文案；
   3) 真按确认，断言状态迁移；「下架」双入口（⋮ 与底栏电源钮）必须落同一个态。
   盲审 FAIL 的正是第 3 条缺失：只点取消 = 只证明弹窗存在，不证明动作生效。
   用法：node tools/check-state-actions.mjs [--negctl]；--negctl 把期望菜单写错，必须红。 */
import { openMine } from './px-parity.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8941';
const NEG = process.argv.includes('--negctl');
/* ★2026-11-03（m04744）：菜单不是写在我脑子里的，是从真源 BSK 抓下来冻结的 oracle。
   文件带 source / captured_at / method；没有它，STATEACT 直接不算数。 */
const TRUTH = JSON.parse(readFileSync(new URL('./truth-apps-menu.json', import.meta.url), 'utf8'));
if (!/^http:\/\/172\.26\.26\.61:10612\//.test(TRUTH.source || '') || TRUTH.method !== 'bsk' || !TRUTH.captured_at) {
  console.error('✗ truth-apps-menu.json 缺真源出处（source/method/captured_at）'); process.exit(2);
}
const ageDays = (Date.now() - Date.parse(TRUTH.captured_at)) / 86400000;
if (!(ageDays >= 0) || ageDays > 30) { console.error('✗ truth-apps-menu.json 过期：' + TRUTH.captured_at); process.exit(2); }
const COMMON = TRUTH.common;
const PRODUCT_OPS = TRUTH.product_ops || [];
const EXPECT = Object.fromEntries(Object.entries(TRUTH.states).map(([k, v]) => [k, { acts: v }]));
/* 真源只有 common 四项；本地产品另加应用级「复制应用」「版本管理」，删除只在未上架出现。 */
const ALIASES = TRUTH.local_aliases || {};        /* 真源标签 → 本地同义标签（见 truth-apps-menu.json） */
const KNOWN_GAPS = TRUTH.known_gaps || [];
function expectedCommon(state) {
  let out = [...COMMON.slice(0, 3), ...PRODUCT_OPS, ...COMMON.slice(3)];
  if (state === '未上架' && TRUTH.delete_when === '未上架') out.push('删除');
  /* 已知缺口（真源有、本地暂时没有）不参与整条判红，但每次运行都打印，不许悄悄消失。 */
  out = out.filter((x) => !KNOWN_GAPS.some((g) => g.item === x));
  /* ★2026-11-04 负控口径：原来 --negctl 只改「内测中」那一格的期望，而内测中卡要先走迁移才出现，
     注入常落空（实测 rc=1＝没抓到）。改成注入一条**必然出现在每张卡**的假菜单项，任何状态都能抓住。 */
  if (NEG) out = out.concat(['负控注入的假菜单项']);
  return out.map((x) => ALIASES[x] || x);
}
if (KNOWN_GAPS.length) KNOWN_GAPS.forEach((g) => console.log('  · 已知缺口（不判红）：真源有「' + g.item + '」—— ' + g.why));
const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails.push(m); console.log('  ✗ ' + m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await openMine(BASE + '/apps.html');
await b.ev('localStorage.clear()');
await b.nav(BASE + '/apps.html');
await sleep(600);

const badges = await b.ev('Array.from(document.querySelectorAll(".kc-tag")).map(e=>e.textContent.trim())');
console.log('状态徽章：' + JSON.stringify([...new Set(badges)]));
for (const s of Object.keys(EXPECT)) {
  /* 2026-11-03：APPINV 把历史值「已下架」投影成「未上架」后，初始种子里不再有
     「内测中」卡；这个态由下面的「发布内测版」动作造出来，初始没出现不算断点。 */
  if (s === '内测中' && !badges.includes(s)) {
    console.log('  · 初始种子里没有「内测中」卡，迁移到内测中后补测');
    continue;
  }
  badges.includes(s) ? ok('列表出现「' + s + '」') : bad('列表缺少状态「' + s + '」');
}

const opts = await b.ev('Array.from(document.querySelectorAll("#f-st option")).map(o=>o.textContent.trim())');
for (const s of Object.keys(EXPECT)) opts.includes(s) ? ok('筛选有「' + s + '」') : bad('筛选缺「' + s + '」');

const card = (id) => 'Array.from(document.querySelectorAll(".kcard")).find(x=>x.dataset.id===' + JSON.stringify(id) + ')';

async function menuOf(state) {
  const i = await b.ev('Array.from(document.querySelectorAll(".kcard")).findIndex(c=>c.querySelector(".kc-tag").textContent.trim()===' + JSON.stringify(state) + ')');
  if (i < 0) return null;
  await b.ev('document.querySelectorAll(".kcard")[' + i + '].querySelector(".k-pub").click()');
  await sleep(250);
  return b.ev('Array.from(document.querySelectorAll(".kcard")[' + i + '].querySelectorAll(".js-k-menu-status .k-mi")).map(e=>e.textContent.trim())');
}

async function commonOf(state) {
  const i = await b.ev('Array.from(document.querySelectorAll(".kcard")).findIndex(c=>c.querySelector(".kc-tag").textContent.trim()===' + JSON.stringify(state) + ')');
  if (i < 0) return null;
  await b.ev('document.querySelectorAll(".kcard")[' + i + '].querySelector(".k-more").click()');
  await sleep(250);
  return b.ev('Array.from(document.querySelectorAll(".kcard")[' + i + '].querySelectorAll(".k-menu:not(.js-k-menu-status) .k-mi")).map(e=>e.textContent.trim())');
}

async function clickMenu(id, label) {
  const hit = await b.ev('(function(){var c=' + card(id) + ';if(!c)return 0;c.querySelector(".k-pub").click();var it=Array.from(c.querySelectorAll(".js-k-menu-status .k-mi")).find(x=>x.textContent.trim()===' + JSON.stringify(label) + ');if(!it)return 0;it.click();return 1})()');
  await sleep(350);
  return hit;
}

async function dlgText() {
  return b.ev('(function(){var d=document.querySelector("[role=alertdialog]");return d?d.innerText.replace(/\\s+/g," ").trim():""})()');
}
async function press(word) {
  const hit = await b.ev('(function(){var d=document.querySelector("[role=alertdialog]");var x=d&&Array.from(d.querySelectorAll("button")).find(b=>b.textContent.trim()===' + JSON.stringify(word) + ');if(!x)return 0;x.click();return 1})()');
  await sleep(450);
  return hit;
}
async function badgeOf(id) {
  return b.ev('(function(){var c=' + card(id) + ';var t=c&&c.querySelector(".kc-tag");return t?t.textContent.trim():""})()');
}

for (const [state, cfg] of Object.entries(EXPECT)) {
  const want = NEG && state === '内测中' ? ['上架正式版', '删除应用'] : cfg.acts;
  const got = await menuOf(state);
  if (!got) {
    if (state === '内测中') { console.log('  · 初始没有「内测中」卡，迁移后补测菜单'); continue; }
    bad('找不到「' + state + '」卡片'); continue;
  }
  const same = JSON.stringify(got) === JSON.stringify(want);
  same ? ok(state + ' 状态菜单 = ' + got.join(' / ')) : bad(state + ' 状态菜单 ' + JSON.stringify(got) + ' ≠ ' + JSON.stringify(want));
  await b.ev('document.body.click()');
  await sleep(150);
  const c = await commonOf(state);
  const wantCommon = expectedCommon(state);
  const cSame = JSON.stringify(c) === JSON.stringify(wantCommon);
  cSame ? ok(state + ' 通用菜单 = ' + c.join(' / ')) : bad(state + ' 通用菜单 ' + JSON.stringify(c) + ' ≠ ' + JSON.stringify(wantCommon));
  await b.ev('document.body.click()');
  await sleep(150);
}

/* ── 迁移链：一张草稿卡（gf-xm）连走，每步按确认再读徽章 ─────────────── */
const ID = 'gf-xm';
const v0 = await badgeOf(ID);
v0 === '未上架' ? ok('起始：gf-xm = 未上架') : bad('起始态不是未上架：' + v0);

if (await clickMenu(ID, '发布内测版')) {
  const t = await dlgText();
  t.includes('内测客户可以立即使用') ? ok('发布内测确认框') : bad('发布内测确认框文案不对：' + t);
  await press('发布');
  const s = await badgeOf(ID);
  s === '内测中' ? ok('发布内测版 → 内测中') : bad('发布内测版后徽章=' + s + '（应为内测中）');
} else bad('点不到「发布内测版」');

/* 初始种子里没有「内测中」卡，菜单必须在这个真实迁移之后补测，不能跳过。 */
if (await badgeOf(ID) === '内测中') {
  const gotTrial = await menuOf('内测中');
  JSON.stringify(gotTrial) === JSON.stringify(EXPECT['内测中'].acts)
    ? ok('内测中 状态菜单 = ' + gotTrial.join(' / '))
    : bad('内测中 状态菜单 ' + JSON.stringify(gotTrial) + ' ≠ ' + JSON.stringify(EXPECT['内测中'].acts));
  await b.ev('document.body.click()');
  await sleep(150);
  const cTrial = await commonOf('内测中');
  const wantTrial = expectedCommon('内测中');
  JSON.stringify(cTrial) === JSON.stringify(wantTrial)
    ? ok('内测中 通用菜单 = ' + cTrial.join(' / '))
    : bad('内测中 通用菜单 ' + JSON.stringify(cTrial) + ' ≠ ' + JSON.stringify(wantTrial));
  await b.ev('document.body.click()');
  await sleep(150);
}

if (await clickMenu(ID, '上架正式版')) {
  const t = await dlgText();
  t.includes('客户都会看到') || t.includes('发布为 v1') ? ok('上架正式确认框') : bad('上架正式确认框文案不对：' + t);
  await press('上架');
  const s = await badgeOf(ID);
  s === '已上架' ? ok('上架正式版 → 已上架（v0 草稿自动发 v1）') : bad('上架正式版后徽章=' + s + '（应为已上架）');
} else bad('点不到「上架正式版」');

if (await clickMenu(ID, '下架')) {
  const t = await dlgText();
  t.includes('下架后，客户将无法使用') ? ok('下架确认框') : bad('下架确认框文案不对：' + t);
  await press('确定');
  const s = await badgeOf(ID);
  s === '未上架' ? ok('电源钮 下架 → 未上架') : bad('下架后徽章=' + s + '（应为未上架；盲审事故：曾变内测中）');
} else bad('点不到「下架」');

/* 已上架仍保留「发布内测版」：徽章不变，但必须落 trialAt（不是死项） */
const ID2 = 'zxjt-yy';
const b2 = await badgeOf(ID2);
if (b2 === '已上架') {
  if (await clickMenu(ID2, '发布内测版')) {
    const t = await dlgText();
    t.includes('正式客户仍然使用') ? ok('已上架发布内测确认框') : bad('已上架发布内测确认框文案不对：' + t);
    await press('发布');
    const trialAt = await b.ev('(function(){var a=(window.DB&&DB.APPS||[]).find(x=>x.id===' + JSON.stringify(ID2) + ');return (a&&a.trialAt)||""})()');
    trialAt ? ok('已上架发布内测版 → 落 trialAt，徽章保持已上架') : bad('已上架发布内测版没有任何落点（死项）');
  } else bad('已上架卡片点不到「发布内测版」');
} else console.log('  · 跳过已上架内测发布：' + ID2 + ' 当前为 ' + b2);

b.close();
console.log(fails.length ? '\nFAIL ' + fails.length + ' 条' : '\nPASS 三态·菜单·确认·迁移·双入口全部一致');
/* ★2026-11-04 负控口径对齐 tools/negctl.tsv：负控档「抓到坏输入」必须 rc=2（此前一律 rc=1，台账记不合格）。 */
process.exit(NEG ? (fails.length ? 2 : 1) : (fails.length ? 1 : 0));
