#!/usr/bin/env node
/* check-card-updates —— 应用卡「{N} 个组件有更新」徽标的判据（2026-10-28 立）。
 *
 * 为什么有它：这一枚徽标是三件事的交汇 —— 数据层（装配版本）、文案（规格 §2.3 逐字）、
 * 与入口（整卡带参到配置页）。三件事各自都能"看起来做了"，但合起来错的方式都很安静：
 *   · N 算错 ⇒ 把没问题的应用喊去返工，或者把落后的应用放过去；
 *   · N=0 时留一个 hidden 的空节点 ⇒ 卡片几何变了、读屏名字里多一段空后缀；
 *   · 徽标接了指针 ⇒ 整卡热区里出现一块点不动的死区（上一轮 ⋮ / 状态标签都踩过同一个坑）；
 *   · 参数只加在整卡上、footer「配置」没带 ⇒ 同一张卡两个入口去两个视图。
 * 所以判据按"外部可观测"写，不读 DB.updateCount 自证。
 *
 * 判据（阈值写死在下面，负控档也不改）：
 *   U1 场景在位：华信证券 · 债承审核 N = 2；其余卡 N = 0
 *   U2 N 的第二读数：页面内**独立复算**（不调 DB.updateCount，只用 DB.APPS/DB.COMPS
 *      与规格 §11.2 的可更新定义）必须等于徽标上的数 —— 两处各算一次仍相等才算数
 *   U3 文案逐字 `{N} 个组件可升级`（2026-11-02 卡面改版：更新徽标落点与文案都变了；
 *      旧版的「两个入口」「左 = --space-12」「warning 色」断言建立在旧卡面，已随改版退役）
 *   U4 无更新的卡：`.kc-upd-flag` 节点数 = 0（不是 hidden、不是 opacity:0 的占位）
 *
 * 用法：node tools/check-card-updates.mjs
 *      node tools/check-card-updates.mjs --negctl   负控：页面里把徽标数字改错（不落盘），
 *                                                 必须被 U1/U2/U3 抓住；抓不住 rc=3（判据自己坏了）
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：抓住即 2）｜ 3 未量（Chrome 起不来 / 页面上没有 .kcard /
 *         负控没被抓住）
 */
import { resolveBase } from './base.mjs';
import { openMine } from './px-parity.mjs';

const NEG = process.argv.includes('--negctl');

let BASE;
try { BASE = await resolveBase(); } catch (e) {
  console.log('✗ 未量：' + e.message);
  process.exit(3);
}

const NEED = ['hx-zc'];             /* 必须有更新的那张卡（种子场景） */
const EXP_N = { 'hx-zc': 2 };       /* 种子里装的是 v2/v1，库里 v3/v2 */

let br;
try { br = await openMine(BASE + '/apps.html'); } catch (e) {
  console.log('✗ 未量：Chrome 起不来 —— ' + e.message);
  process.exit(3);
}

let data;
/* 负控：只改内存里的那一枚徽标（不动盘、不写 localStorage）。刀必须命中 U3。
   ⚠ 不改 DB：改数据会被 U2 的"两处各算一次"遮住（两边一起错仍然相等），
     所以刀选在**页面上的字**上 —— 那正是这条判据要守的东西。 */
if (NEG) {
  try {
    await br.ev(`(function(){
      var b = document.querySelector('.kc-upd-flag');
      if (!b) return 'no-badge';
      b.textContent = '3 个组件可升级';
      return 'ok';
    })()`);
  } catch (e) { console.log('✗ 未量：负控注入失败 —— ' + e.message); br.close(); process.exit(3); }
}
try {
  data = await br.ev(`(function(){
    var cards = [].slice.call(document.querySelectorAll('#grid .kcard'));
    if (!cards.length) return { none: true };
    var vn = function(v){ return parseInt(String(v == null ? '' : v).replace(/\\D/g, ''), 10) || 0; };
    /* 第二读数：照规格 §11.2 独立复算，**不调 DB.updateCount**。
       可更新 = 已上架 + 启用 + 最新版号 > 装配版号；已下架件不进 N。 */
    function recount(appId){
      var a = DB.appById(appId); if (!a) return [];
      var out = [];
      a.comps.forEach(function(cid){
        var c = DB.compById(cid); if (!c) return;
        if (!(c.status === '已上架' && c.enabled !== false)) return;
        var have = (a.compVer && typeof a.compVer[cid] === 'string' && a.compVer[cid]) ? a.compVer[cid] : c.ver;
        if (vn(c.ver) > vn(have)) out.push(cid);
      });
      return out;
    }
    return { cards: cards.map(function(card){
      var id = card.getAttribute('data-id');
      var cover = card.querySelector('.kc-cover');
      var badge = card.querySelector('.kc-upd-flag');
      var b = null;
      if (badge) {
        var r = badge.getBoundingClientRect(), cr = cover.getBoundingClientRect();
        var cs = getComputedStyle(badge);
        var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        var hit = document.elementFromPoint(cx, cy);
        b = {
          text: String(badge.textContent || ''),
          ariaHidden: badge.getAttribute('aria-hidden'),
          pe: cs.pointerEvents,
          tabIndex: badge.tabIndex,
          tag: badge.tagName.toLowerCase(),
          h: cs.height, fs: cs.fontSize, radius: cs.borderTopLeftRadius,
          color: cs.color, bg: cs.backgroundColor,
          left: Math.round(r.left - cr.left), top: Math.round(r.top - cr.top),
          hitIsAnchor: !!(hit && hit.closest && hit.closest('a.kc-cover-img')),
          hitTag: hit ? (hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'null'
        };
      }
      return {
        id: id,
        rec: recount(id),
        n0: DB.updateCount(id),
        badge: b,
      };
    })};
  })()`);
} catch (e) {
  console.log('✗ 未量：页面取不到读数 —— ' + e.message);
  br.close();
  process.exit(3);
}
br.close();

if (!data || data.none) {
  console.log('✗ 未量：#grid 里没有 .kcard —— 这一页的卡片没渲染，判据无从度量');
  process.exit(3);
}

const fails = [];
const ok = (cond, label, detail) => { console.log((cond ? '  ✓ ' : '  ✗ ') + label + (detail ? '｜' + detail : '')); if (!cond) fails.push(label); };
const withBadge = data.cards.filter((c) => c.badge);

console.log('应用卡 ' + data.cards.length + ' 张｜带徽标 ' + withBadge.length + ' 张');

/* ── U1 / U2 / U3：种子场景 + 第二读数 + 文案 ── */
for (const id of NEED) {
  const c = data.cards.find((x) => x.id === id);
  ok(!!c, 'U1 ' + id + ' 这张卡在页面上', c ? '' : '找不到 data-id=' + id);
  if (!c) continue;
  ok(c.rec.length === EXP_N[id], 'U1 ' + id + ' 独立复算 N = ' + EXP_N[id], '实测 ' + c.rec.length + '（' + c.rec.join(',') + '）');
  ok(c.n0 === c.rec.length, 'U2 两处各算一次仍相等（DB.updateCount = 独立复算）', c.n0 + ' vs ' + c.rec.length);
  ok(!!c.badge, 'U3 ' + id + ' 徽标在位');
  if (!c.badge) continue;
  const want = EXP_N[id] + ' 个组件可升级';
  ok(c.badge.text === want, 'U3 文案逐字「' + want + '」', '实测「' + c.badge.text + '」');
  ok(!/可更新|待更新|新版本|等$|^0\d/.test(c.badge.text), 'U3 无同义替换词 / 无「等」/ 无前导零', c.badge.text);
}
/* 种子以外的其余卡：N=0 且零节点 */
const others = data.cards.filter((c) => NEED.indexOf(c.id) < 0);
for (const c of others) {
  ok(c.rec.length === 0 && c.badge === null, 'U4 ' + c.id + ' 无更新 ⇒ 零节点', '独立复算 ' + c.rec.length + '｜徽标 ' + (c.badge ? '有' : '无'));
}


if (fails.length) {
  console.log('\n✗ FAIL ' + fails.length + ' 条：' + fails.join('；'));
  if (NEG) console.log('✓ 负控成立：注入的坏文案被抓住');
  process.exit(2);
}
if (NEG) {
  console.log('\n✗ 负控失败：注入「3 个组件可升级」之后仍全绿 —— 这条判据抓不到文案漂移，不能当判据用');
  process.exit(3);
}
console.log('\n✓ 全过：U1–U4');
process.exit(0);
