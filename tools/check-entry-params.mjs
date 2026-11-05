#!/usr/bin/env node
/* check-entry-params —— 应用卡带参进来的那一步，以及它四个边界（2026-10-28 立）。
 *
 * 为什么要有它：卡上的徽标与 href 有 check-card-updates 守着，但**落地点**没人守。
 * 入口这一步能错成五种安静的样子：
 *   · 参不认：链接带 panel/updates 进来，抽屉不弹 —— 用户点一下像没反应；
 *   · 参不消化：抽屉关掉、刷新又弹开 —— 人已经决定的事被系统再问一遍；
 *   · 消化过头：连 id 一起摘掉 —— 刷新落到别人的应用上（比不做更坏）；
 *   · N=0 仍开筛选：把一个空筛选铺在用户脸上，先让人以为坏了；
 *   · 已下架已装配件挤进「只看有更新」：下架件没有可装配的最新版，画箭头就是假承诺。
 * 这五件事在页面上都不是"报错"，是"看起来正常"。所以判据按外部可观测写，
 * 不读 DB.updateCount 自证（E3 要求页面上那个数与 DB 各算一次仍相等）。
 *
 * 判据（阈值写死，负控档也不改）：
 *   E1 参数消费：进来后 location.search 只剩 `?id=hx-zc`（panel/updates 摘净，id 保留）
 *   E2 面板自开且落在「已装配」：mask[data-open=true] ＋ #tab-on aria-selected=true
 *   E3 筛选行逐字「只看有更新 · 2 个」，且这个 2 = DB.updateCount('hx-zc')（两处各算一次）
 *   E4 两行版本对比 v2→v3 / v1→v2，data-upd="new"，顺序 = DB.updatesOf 的顺序
 *   E5 点首行「更新」：出现 取消 + 确认更新 ＋ 影响句逐字，焦点落「取消」（可退）
 *   E6 点「确认更新」：筛选行 2→1，该行 data-upd="done"/「已更新到 v3」/动作区空，焦点不掉 body
 *   E7 点提示条「撤回」：筛选行回 2，该行回 data-upd="new" 且版本对比复原
 *   E8 无更新（zj-cg N=0）：参数作废 —— 面板开、筛选行 hidden、焦点落页签，行数 = 已装数
 *   E9 未装任何组件（gf-xm）：面板开、空态「还没装配任何组件」、焦点落抽屉关闭钮
 *   E10 已下架但已装配（临时注入 ruleset-cfg，装的是 v4、库里 v5）：筛选行不出现、
 *       updateCount 仍 0、该行「已下架」胶囊在、版本行单值无箭头、无「更新」按钮
 *   E11 筛选为空：两条都更新完 → 撤回窗内筛选行 0 个但刚更新的那行留着（§4.4）；
 *       窗口结束（8s）→ 行移出、转空态「没有需要更新的组件」，筛选行仍在
 *   E12 更新中（422ms 窗口）：确认后 450ms 内 data-upd="pending" ＋「更新中…」＋ .genbar，
 *       焦点停在行上（行此刻 tabindex=-1，不能掉回 body）
 *   E13 失败（内存桩 DB.save=false，不落盘）：data-upd="error" ＋「更新失败，请重试」带
 *       role="alert" ＋ 动作换「重试」且可聚焦 ＋ 筛选仍是 2 个（失败不等于已更新）
 *       ＋ 装配版本仍是 v2（不写"好像更新了"）
 *
 * 用法：node tools/check-entry-params.mjs
 *      node tools/check-entry-params.mjs --negctl   负控：把 E1 的地址判据反过来（不落盘），
 *                                                 必须抓到；抓不住 rc=3（判据自己坏了）
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：抓住即 2）｜ 3 未量（Chrome 起不来 / 页面没加载 DB / 负控没被抓住）
 */
import { resolveBase } from './base.mjs';
import { openMine } from './px-parity.mjs';

const NEG = process.argv.includes('--negctl');
const APP = 'hx-zc';                       /* 种子里装 v2/v1、库里 v2/v3 的那张 */
const WINDOW_MS = 8000;                    /* 撤回窗口（规格 §4.5） */

let BASE;
try { BASE = await resolveBase(); } catch (e) {
  console.log('✗ 未量：' + e.message);
  process.exit(3);
}

let br;
try { br = await openMine(BASE + '/app.html?id=' + APP + '&panel=installed&updates=1'); }
catch (e) { console.log('✗ 未量：Chrome 起不来 —— ' + e.message); process.exit(3); }

let pass = 0, fail = 0;
function ok(cond, name, reading) {
  if (cond) { pass++; console.log('  ✓ ' + name + (reading ? ' · ' + reading : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (reading ? ' · ' + reading : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 一个快照函数：页面上的字与属性，全部外部可观测 */
const SNAP = `(function(){
  var rows = [].slice.call(document.querySelectorAll('#dlg-list .row'));
  var mask = document.querySelector('#mask');
  var f = document.querySelector('#p-filter');
  var on = document.querySelector('#tab-on');
  return {
    search: location.search,
    dlgOpen: !!mask && mask.getAttribute('data-open') === 'true',
    tabOn: !!on && on.getAttribute('aria-selected') === 'true',
    filterHidden: f ? f.hidden : null,
    filterText: (f ? f.textContent : '').replace(/\\s+/g, ' ').trim(),
    rows: rows.map(function (r) {
      var b = r.querySelector('.btn-update');
      return {
        name: (r.querySelector('b') || {}).textContent,
        meta: (r.querySelector('.row-meta') || {}).textContent,
        state: r.getAttribute('data-upd'),
        act: (r.querySelector('.act') || {}).textContent.replace(/\\s+/g, ' ').trim(),
        updBtn: !!b,
        aria: r.getAttribute('aria-label')
      };
    }),
    empty: (document.querySelector('#dlg-list .p-empty') || {}).textContent
      ? document.querySelector('#dlg-list .p-empty').textContent.replace(/\\s+/g, ' ').trim() : null,
    focus: document.activeElement && (document.activeElement.id
      || document.activeElement.getAttribute('aria-label')
      || document.activeElement.className || document.activeElement.tagName),
    dbN: (typeof DB !== 'undefined' && DB.updateCount) ? DB.updateCount(location.search.match(/id=([^&]+)/)
      ? decodeURIComponent(location.search.match(/id=([^&]+)/)[1]) : '') : null
  };
})()`;

const ready = await br.ev('!!(window.DB && DB.APPS && document.querySelector("#mask"))').catch(() => false);
if (!ready) { console.log('✗ 未量：页面没加载 DB 或 #mask（服务在不在？）'); br.close(); process.exit(3); }

try {
  /* ── E1..E4 落地态 ──────────────────────────────────────── */
  let s = await br.ev(SNAP);
  const wantSearch = '?id=' + APP;
  const e1 = NEG ? s.search !== wantSearch : s.search === wantSearch;   /* 负控把这刀反过来 */
  ok(e1, 'E1 参数消费后只剩 id（panel/updates 摘净）', 'location.search=' + JSON.stringify(s.search));
  ok(s.dlgOpen && s.tabOn, 'E2 抽屉自开 + 页签在「已装配」', 'dlgOpen=' + s.dlgOpen + ' tabOn=' + s.tabOn);
  ok(!s.filterHidden && s.filterText.indexOf('只看有更新 · 2 个') === 0,
    'E3 筛选行逐字「只看有更新 · 2 个」', JSON.stringify(s.filterText));
  ok(s.dbN === 2, 'E3′ 页面上的数与 DB 各算一次仍相等', 'DB.updateCount=' + s.dbN);

  const order = await br.ev(`DB.updatesOf('${APP}').map(function(u){return u.id+':'+u.from+'>'+u.to}).join(',')`);
  const rowSig = s.rows.map((r) => (r.state || 'plain') + '|' + r.meta).join(' , ');
  ok(s.rows.length === 2 && s.rows[0].meta === 'v2→v3' && s.rows[1].meta === 'v1→v2'
    && s.rows[0].state === 'new' && s.rows[1].state === 'new',
    'E4 两行 v2→v3 / v1→v2 且都是 data-upd=new', rowSig);
  ok(order === 'task-list:v2>v3,task-detail:v1>v2', 'E4′ 顺序与 DB.updatesOf 一致', order);

  /* ── E5 点「更新」 ──────────────────────────────────────── */
  await br.ev(`(function(){var b=document.querySelector('#dlg-list .row .btn-update[data-do=update]'); if(!b) return 0; b.click(); return 1})()`);
  await sleep(350);
  s = await br.ev(SNAP);
  const impact = '画布按 v3 重画，发布后客户才看到。';
  ok(s.rows[0].state === 'confirm' && s.rows[0].meta === impact
    && /取消/.test(s.rows[0].act) && /确认更新/.test(s.rows[0].act),
    'E5 行内出现 取消 / 确认更新 + 影响句逐字', JSON.stringify(s.rows[0].meta) + ' ｜ ' + s.rows[0].act);
  ok(/取消更新/.test(String(s.focus)), 'E5′ 焦点默认落「取消」（可退）', 'focus=' + s.focus);

  /* ── E6 点「确认更新」（先量 450ms 那一格）────────────────── */
  await br.ev(`(function(){var b=document.querySelector('#dlg-list .btn-update[data-do=confirm]'); if(!b) return 0; b.click(); return 1})()`);
  await sleep(140);
  const pend = await br.ev(`(function(){
    var r=document.querySelector('#dlg-list .row');
    return JSON.stringify({state:r&&r.getAttribute('data-upd'),
      act:r?r.querySelector('.act').textContent.replace(/\\s+/g,' ').trim():'',
      bar:!!(r&&r.querySelector('.genbar')),
      focus:document.activeElement&&(document.activeElement.className||document.activeElement.tagName)});
  })()`).then(JSON.parse);
  ok(pend.state === 'pending' && pend.act === '更新中…' && pend.bar === true && pend.focus === 'row',
    'E12 更新中：data-upd=pending ＋「更新中…」＋ 进度条，焦点停在行上',
    JSON.stringify(pend));
  await sleep(760);
  s = await br.ev(SNAP);
  ok(!s.filterHidden && s.filterText.indexOf('只看有更新 · 1 个') === 0,
    'E6 筛选行 2→1', JSON.stringify(s.filterText));
  ok(s.rows[0].state === 'done' && s.rows[0].meta === '已更新到 v3' && s.rows[0].act === '',
    'E6′ 该行 已更新到 v3 / 动作区留空', s.rows[0].state + ' ｜ ' + s.rows[0].meta + ' ｜ 动作=' + JSON.stringify(s.rows[0].act));
  ok(s.focus !== 'BODY', 'E6″ 焦点不掉回 body', 'focus=' + s.focus);

  /* ── E7 点「撤回」 ─────────────────────────────────────── */
  const clicked = await br.ev(`(function(){var b=document.querySelector('#hint-act'); if(!b) return 0; b.click(); return 1})()`);
  await sleep(500);
  s = await br.ev(SNAP);
  ok(clicked === 1, 'E7 提示条上有「撤回」', 'clicked=' + clicked);
  ok(s.filterText.indexOf('只看有更新 · 2 个') === 0
    && s.rows[0].state === 'new' && s.rows[0].meta === 'v2→v3',
    'E7′ 撤回：计数回 2、该行回 v2→v3', s.filterText + ' ｜ ' + s.rows[0].state + ' ' + s.rows[0].meta);

  /* ── E8 无更新 ─────────────────────────────────────────── */
  await br.nav(BASE + '/app.html?id=zj-cg&panel=installed&updates=1');
  s = await br.ev(SNAP);
  ok(s.dlgOpen && s.tabOn && s.filterHidden === true && s.rows.length === 3,
    'E8 无更新（N=0）：参数作废，开普通已装配列表', 'rows=' + s.rows.length + ' filterHidden=' + s.filterHidden);
  ok(s.focus === 'tab-on', 'E8′ 焦点落页签「已装配」', 'focus=' + s.focus);

  /* ── E9 未装任何组件 ───────────────────────────────────── */
  await br.nav(BASE + '/app.html?id=gf-xm&panel=installed&updates=1');
  s = await br.ev(SNAP);
  ok(s.dlgOpen && s.filterHidden === true && s.rows.length === 0
    && s.empty === '还没装配任何组件',
    'E9 未装：参数作废，留原空态', 'rows=' + s.rows.length + ' empty=' + JSON.stringify(s.empty));
  ok(s.focus === 'dlg-close', 'E9′ 焦点落抽屉关闭钮', 'focus=' + s.focus);

  /* ── E10 已下架但已装配 ─────────────────────────────────
     种子数据里没有应用装着下架件，所以临时注入（只落本次临时 profile），用完还原。
     装的是 v4、库里是 v5：如果代码把"版本更高"当可更新，这一刀就会露出来。 */
  const inj = await br.ev(`(function(){
    var a = DB.appById('ht-zc'); if (!a) return 'no-app';
    if (a.comps.indexOf('ruleset-cfg') < 0) a.comps.push('ruleset-cfg');
    a.compVer = a.compVer || {}; a.compVer['ruleset-cfg'] = 'v4';
    DB.save(); return DB.updateCount('ht-zc');
  })()`);
  await br.nav(BASE + '/app.html?id=ht-zc&panel=installed&updates=1');
  s = await br.ev(SNAP);
  const off = s.rows.filter((r) => /规则配置/.test(r.name))[0] || {};
  ok(inj === 0, 'E10 已下架件不进 N（库里 v5、装的是 v4）', 'updateCount=' + inj);
  ok(s.filterHidden === true, 'E10′ 不出现筛选行', 'filterHidden=' + s.filterHidden);
  ok(/已下架/.test(off.act || '') && off.updBtn === false && !/→/.test(off.meta || ''),
    'E10″ 该行 已下架胶囊 + 单值版本 + 无更新按钮', JSON.stringify(off.act) + ' ｜ ' + JSON.stringify(off.meta));
  /* 还原：临时 profile 里也还回去，判据重跑结果才与首次一致 */
  await br.ev(`(function(){
    var a = DB.appById('ht-zc'); if (!a) return 0;
    a.comps = a.comps.filter(function(x){ return x !== 'ruleset-cfg'; });
    if (a.compVer) delete a.compVer['ruleset-cfg'];
    DB.save(); return a.comps.length;
  })()`);

  /* ── E11 筛选为空（撤回窗内 vs 窗口结束后）─────────────── */
  await br.nav(BASE + '/app.html?id=' + APP + '&panel=installed&updates=1');
  for (let i = 0; i < 2; i++) {
    await br.ev(`(function(){var b=document.querySelector('#dlg-list .row .btn-update[data-do=update]'); if(b) b.click(); return !!b})()`);
    await sleep(350);
    await br.ev(`(function(){var b=document.querySelector('#dlg-list .btn-update[data-do=confirm]'); if(b) b.click(); return !!b})()`);
    await sleep(800);
  }
  s = await br.ev(SNAP);
  ok(s.filterText.indexOf('只看有更新 · 0 个') === 0 && s.rows.length === 1 && s.empty === null,
    'E11 撤回窗内：筛选行 0 个，刚更新那行留着（§4.4）',
    s.filterText + ' ｜ rows=' + s.rows.length + ' empty=' + JSON.stringify(s.empty));
  await sleep(WINDOW_MS + 1200);
  s = await br.ev(SNAP);
  ok(s.rows.length === 0 && s.empty === '没有需要更新的组件' && !s.filterHidden,
    'E11′ 窗口结束：行移出、转筛选空态，筛选行仍在（§5.3）',
    'rows=' + s.rows.length + ' empty=' + JSON.stringify(s.empty) + ' filterHidden=' + s.filterHidden);

  /* ── E13 失败态（内存桩 DB.save=false，不写盘、不落 localStorage）────
     E11 已经把这张应用的两条都更新掉了，所以先清掉本 profile 的存档回到种子
     （openMine 用的是 /tmp 下一次性 user-data-dir，清的是本次临时档，不碰真浏览器）。 */
  await br.ev('localStorage.clear(); sessionStorage.clear(); 1');
  await br.nav(BASE + '/app.html?id=' + APP + '&panel=installed&updates=1');
  await br.ev(`(function(){var b=document.querySelector('#dlg-list .row .btn-update[data-do=update]'); if(!b) return 0; b.click(); return 1})()`);
  await sleep(350);
  await br.ev(`(function(){ window.__save = DB.save; DB.save = function(){ return false; };
    var b=document.querySelector('#dlg-list .btn-update[data-do=confirm]'); if(!b) return 0; b.click(); return 1 })()`);
  await sleep(800);
  const err = await br.ev(`(function(){
    var r=document.querySelector('#dlg-list .row');
    var meta=r.querySelector('.row-meta');
    var retry=r.querySelector('[data-do=retry]');
    return JSON.stringify({
      state:r.getAttribute('data-upd'),
      meta:meta.textContent.trim(),
      alert: !!meta.querySelector('[role="alert"]'),
      retry: !!retry,
      focus: document.activeElement && (document.activeElement.getAttribute('aria-label')||document.activeElement.className),
      filter: document.querySelector('#p-filter').textContent.replace(/\\s+/g,' ').trim(),
      ver: DB.installedVer('${APP}','task-list')
    });
  })()`).then(JSON.parse);
  ok(err.state === 'error' && err.meta === '更新失败，请重试' && err.alert === true,
    'E13 失败：data-upd=error ＋「更新失败，请重试」带 role=alert', JSON.stringify(err.meta) + ' alert=' + err.alert);
  ok(err.retry === true && /重试/.test(String(err.focus)),
    'E13′ 动作换「重试」且焦点落在它上面', 'focus=' + err.focus);
  ok(err.filter.indexOf('只看有更新 · 2 个') === 0 && err.ver === 'v2',
    'E13″ 失败不计入已更新：筛选仍 2 个、装配版本仍 v2', err.filter + ' ｜ installedVer=' + err.ver);
  await br.ev('try{ DB.save = window.__save; }catch(e){} 1');
} catch (e) {
  console.log('✗ 未量：判据执行中断 —— ' + e.message);
  br.close();
  process.exit(3);
}

br.close();
console.log('');
console.log('通过 ' + pass + ' ｜ 断点 ' + fail);
if (NEG) {
  if (fail > 0) { console.log('负控成立：E1 被反转后判红 ' + fail + ' 条 ⇒ 这条判据真的会红'); process.exit(2); }
  console.log('✗ 未量：负控没被抓住 —— E1 的断言写反了也不会红，判据本身坏了');
  process.exit(3);
}
if (fail) { console.log('FAIL：' + fail + ' 条'); process.exit(2); }
console.log('PASS：入口四效果 + 四边界 + 更新整条状态机（确认/更新中/已更新/撤回/失败）全部对上');
process.exit(0);
