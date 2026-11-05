#!/usr/bin/env node
/* check-versions —— 版本快照判据（2026-10-27 单一工作区模型）
 *
 * 用户重定：只有一个画布、一份自动保存的当前状态；没有"草稿版本"。
 *   点一次「保存快照」= 把 comps + content（每块 spec/fields/config）+ 应用信息整包冻成不可变版本；
 *   回溯只有一件事：选中某一版 → 恢复此版 → 代码和数据一起回到那个时间点。
 *
 * 判据：
 *   T1 快照列表在独立页面上（不在任何弹窗里）
 *   T2 固定表头 + 四列（版本/状态/保存时间/操作），列头与数据行逐列左缘对齐 ≤1px
 *      （2026-10-27 撤掉「类型」列：整列恒为「快照」，零信息；且「快照」这个词业务人员不认识）
 *   T3 有按版本号搜索，且搜索真的收窄列表
 *   V1 唯一 active：所有 owner 下 active 的快照 ≤1 条
 *   V2 没有草稿行：页面上 0 个 data-kind="draft"，正文 0 处「草稿」
 *   V3 恢复先问一句；确认后恰好一条 active 且是点的那一版
 *   V4 快照不可变：恢复后改当前内容，历史快照不变
 *   V8 保存快照真的带 content + contentHash（不是只存版本号）
 *   V9 恢复此版真的把内容还原（改标题 → 发两版 → 恢复旧版 → 标题回到旧值）
 *   A1 应用侧用同一张表
 *   A2/A3 状态行说清当前线上；页面无「草稿」
 *   A4 应用侧从页面恢复一版：active 与内容一起回来
 *
 * 负控：--negctl 拆 activate（唯一性失效）｜--negctl2 拆 normalize（唯一约束失效）
 * 用法：node tools/check-versions.mjs [--negctl|--negctl2]
 * 退出码：0 全过 ｜ 2 有断点 ｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
/* ★2026-11-04 根治第 ④ 条：期望值不再写在判据里。
   产品语义（列名/状态词/动作）唯一来源是 _docs/基线-版本管理.md → tools/baseline.mjs。 */
import { BASELINE } from './baseline.mjs';
const B = BASELINE['versions.html'];
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');
const NEG2 = process.argv.includes('--negctl2');

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (note ? '｜实测：' + note : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (note ? '｜实测：' + note : '')); }
}

const NEG_SRC = `(function(){
  if (window.__vsNeg) return; window.__vsNeg = 1;
  var patch = function () {
    if (!window.DB || !DB.versActivate || DB.versActivate.__neg) return false;
    DB.versActivate = function (scope, id, v) {
      var list = DB.versOf(scope, id), want = parseInt(v, 10), hit = null;
      list.forEach(function (r) { if (r.kind === 'stable' && r.v === want) { r.active = true; hit = r; } });
      DB.versSet(scope, id, list);
      return hit;
    };
    DB.versActivate.__neg = 1; return true;
  };
  if (!patch()) { var t = setInterval(function () { if (patch()) clearInterval(t); }, 20); setTimeout(function () { clearInterval(t); }, 4000); }
})();`;

const NEG2_SRC = `(function(){
  if (window.__vsNeg2) return; window.__vsNeg2 = 1;
  var patch = function () {
    if (!window.DB || !DB.versSet || DB.versSet.__neg2) return false;
    DB.versSet = function (scope, id, list) {
      try { localStorage.setItem('ifas90:vers:' + scope + ':' + id, JSON.stringify(list)); } catch (e) {}
      return list;
    };
    DB.versSet.__neg2 = 1;
    DB.versActivate = function (scope, id, v) {
      var list = DB.versOf(scope, id), want = parseInt(v, 10), hit = null;
      list.forEach(function (r) { if (r.kind === 'stable' && r.v === want) { r.active = true; hit = r; } });
      DB.versSet(scope, id, list);
      return hit;
    };
    return true;
  };
  if (!patch()) { var t = setInterval(function () { if (patch()) clearInterval(t); }, 20); setTimeout(function () { clearInterval(t); }, 4000); }
})();`;

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/vers-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来（' + CHROME + '）'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 140));
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 20000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return r.result?.value;
};
const go = async (url, ms = 1300) => { await send('Page.navigate', { url }); await SLEEP(ms); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
if (NEG) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEG_SRC });
if (NEG2) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEG2_SRC });

console.log(`版本快照判据｜基址 ${BASE}${NEG ? '｜负控（拆 activate）' : ''}${NEG2 ? '｜负控（拆唯一约束）' : ''}\n`);

/* ══ T. 容器 ══ */
console.log('=== T · 容器选择 ===');
await go(BASE + '/versions.html?scope=comp&id=task-list', 1500);
const shape = await ev(`(function () {
  var r = document.querySelector('.vl-row');
  return {
    page: /\\/versions\\.html/.test(location.pathname),
    rows: document.querySelectorAll('.vl-row').length,
    inDialog: !!document.querySelector('.nf-mask .vl-row'),
    head: !!document.querySelector('.vl-head'),
    headCols: Array.prototype.map.call(document.querySelectorAll('.vl-head span'), function (s) { return s.textContent.trim(); }),
    headLefts: Array.prototype.map.call(document.querySelectorAll('.vl-head span'), function (s) { return Math.round(s.getBoundingClientRect().left); }),
    /* 2026-11-04：行里不再有跨行摘要（.vl-sum 已删），一个子元素就是一列；
       仍保留 filter 只是为了老缓存里万一还有 .vl-sum 时不假红。 */
    rowLefts: r ? Array.prototype.filter.call(r.children, function (c) {
      return !c.classList.contains('vl-sum');
    }).map(function (c) { return Math.round(c.getBoundingClientRect().left); }) : [],
    hasSearch: !!document.getElementById('kw'),
    drafts: document.querySelectorAll('.vl-row[data-kind="draft"]').length
  };
})()`);
ok('T1 快照列表在独立页面上（不在任何弹窗里）',
  shape && shape.page === true && shape.rows > 0 && shape.inDialog === false,
  '页面=' + (shape && shape.page) + '，行=' + (shape && shape.rows) + '，弹窗内=' + (shape && shape.inDialog));
/* ★2026-11-04（m00358 拍板 q2b）：行下的跨行摘要删掉，一行只装一行的东西。
   「变更」列试过又退回（q6 拍板）：演示里种子版本内容为空，整列都是「—」。
   断言仍盯住列名与顺序 —— 那才是"表长什么样"的不变量。 */
ok('T2 固定表头 + 四列且列名与顺序固定（baseline: 基线-版本管理.md §二）',
  shape && shape.head === true && shape.headCols.length === B.headCols.length &&
  shape.headCols.join('/') === B.headCols.map(function (c) { return c.label; }).join('/'),
  (shape && shape.headCols.join(' / ')) || '没有表头');
/* 列宽也是基线契约的一部分：以前 CSS 与 spec 各写一份、互相覆盖，oracle 检查在这里收口。 */
const domCols = await ev(`document.querySelector('.vl-table').style.getPropertyValue('--gt-cols')`);
ok('T2c 列宽来自基线契约（baseline: 基线-版本管理.md §二）',
  String(domCols || '').trim() === B.cols,
  '实测=' + String(domCols || '').trim() + '，基线=' + B.cols);
const opsText = await ev(`[].slice.call(document.querySelectorAll('.vl-o')).map(function(e){return e.innerText}).join('|')`);
ok('T2d 行内动作只用基线里的词（baseline: §三）',
  !B.forbidden.some((w) => String(opsText || '').includes(w)) &&
  String(opsText || '').includes(B.actions.history[1]),
  String(opsText || '').slice(0, 60));
ok('T2b 列头与数据行逐列左缘对齐（差 ≤1px）',
  shape && shape.headLefts.length === shape.rowLefts.length &&
  shape.headLefts.every((v, i) => Math.abs(v - shape.rowLefts[i]) <= 1),
  (shape && shape.headLefts.join(',')) + ' ／ ' + (shape && shape.rowLefts.join(',')));
ok('T3 有按版本号搜索', shape && shape.hasSearch === true, '搜索框=' + (shape && shape.hasSearch));

const allRows = shape ? shape.rows : 0;
await ev(`(function(){var i=document.getElementById('kw');i.value='v3';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await SLEEP(220);
const searched = await ev(`document.querySelectorAll('.vl-row').length`);
ok('T3b 搜索真的收窄列表', searched > 0 && searched <= allRows, '全部 ' + allRows + ' → 搜 v3 ' + searched);
await ev(`(function(){var i=document.getElementById('kw');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await SLEEP(200);

/* ══ V. 数据模型 ══ */
console.log('\n=== V · 快照模型（组件：审核任务列表）===');
await ev(`localStorage.clear(); 1`);
await go(BASE + '/versions.html?scope=comp&id=task-list', 1500);

const rows = await ev(`(function(){
  return Array.prototype.map.call(document.querySelectorAll('.vl-row'), function (r) {
    return { kind: r.getAttribute('data-kind'), ver: r.getAttribute('data-ver'),
             active: !!r.querySelector('.vl-on') };
  });
})()`);
ok('V5 列表有行，且每行都是快照（没有草稿行）',
  Array.isArray(rows) && rows.length > 0 && (rows || []).every((r) => r.kind === 'stable'),
  (rows || []).map((r) => (r.kind === 'stable' ? 'v' + r.ver : 'draft') + (r.active ? '●' : '○')).join(' '));

const pageText = await ev(`document.body.innerText`);
ok('V2 页面没有「草稿」这个词', !/草稿/.test(String(pageText || '')),
  /草稿/.test(String(pageText || '')) ? '仍然出现' : '0 处');
ok('V7 页面没有「归档」这个词', !/归档/.test(String(pageText || '')),
  /归档/.test(String(pageText || '')) ? '仍然出现' : '0 处');

const dup = async () => ev(`(function(){
  var bad = [];
  var scan = function (scope, id, name) {
    var on = DB.versOf(scope, id).filter(function (r) { return r.kind === 'stable' && r.active; });
    if (on.length > 1) bad.push(name + ' ' + on.length + ' 条 active');
  };
  (DB.COMPS || []).forEach(function (c) { scan('comp', c.id, 'comp:' + c.id); });
  (DB.APPS || []).forEach(function (a) { scan('app', a.id, 'app:' + a.id); });
  return bad;
})()`);
let bad = await dup();
ok('V1 唯一 active：所有 owner 下 active 的快照 ≤1 条',
  Array.isArray(bad) && bad.length === 0, (bad || []).join('；') || '全部合规');

const ARM = `(function(){
  window.__writes = [];
  var orig = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) {
    try { if (String(k).indexOf('ifas90:vers:') === 0) {
      window.__writes.push((JSON.parse(v) || []).filter(function (r) { return r.kind === 'stable' && r.active; }).length);
    } } catch (e) {}
    return orig(k, v);
  };
  return 1;
})()`;
await ev(ARM);

/* 造第二份快照：直接保存一份带 spec 的组件快照 */
await ev(`DB.versPublish('comp','task-list',{desc:'判据用',spec:{title:'审核任务',blocks:[]},fields:['任务编号']},null); 1`);
await go(BASE + '/versions.html?scope=comp&id=task-list', 1400);
await ev(ARM);

const stables = await ev(`(function(){
  return Array.prototype.map.call(document.querySelectorAll('.vl-row[data-ver]'), function (r) {
    return { v: Number(r.getAttribute('data-ver')), active: !!r.querySelector('.vl-on') };
  });
})()`);
const target = (stables || []).filter((r) => !r.active)[0];
ok('V3 准备：有「历史」快照可恢复', !!target,
  (stables || []).map((r) => 'v' + r.v + (r.active ? '●' : '○')).join(' '));

if (target) {
  await ev(`document.querySelector('.vl-row[data-ver="' + ${JSON.stringify(String(target.v))} + '"] [data-a="act"]').click()`);
  await SLEEP(260);
  const cfShown = await ev(`!!document.querySelector('.nf-confirm')`);
  const cfBody = await ev(`(document.querySelector('#cf-body')||{}).textContent||''`);
  const activeNow = await ev(`(DB.versActive('comp','task-list').v)`);
  ok('V3a 点「恢复」先弹窗问一句（不直接生效）',
    /* 2026-11-04：正文从公文腔改成说人话（点名源版本/新版本号/客户看到哪一版）。
       断言改盯不变量：弹窗出现、正文点名目标版本、且还没真的切换。 */
    /* 2026-11-04（用户定口径 A）：正文改成"按 vN 的内容生成当前版本 vM；客户授权版本不受影响"。
       断言只认不变量：弹窗出现、点名源版本、点名新版本号、且此刻还没切换。措辞不进判据。 */
    cfShown === true && new RegExp('v' + target.v + '[^。]{0,20}v\\d+').test(cfBody) && activeNow !== target.v,
    '弹窗=' + cfShown + '，此时 active=v' + activeNow + '，文案=' + String(cfBody).slice(0, 40));

  await ev(`document.querySelector('[data-cf="ok"]').click()`);
  await SLEEP(320);
  const afterAct = await ev(`(function(){
    var on = DB.versOf('comp','task-list').filter(function (r) { return r.kind === 'stable' && r.active; });
    return { n: on.length, v: on.length ? on[0].v : null, from: on.length ? on[0].snap.restoredFrom : null };
  })()`);
  const maxBefore = Math.max.apply(null, stables.map(function (r) { return r.v; }));
  ok('V3b 确认后：恰好一条 active，且是新生成的版本（前向恢复）',
    afterAct && afterAct.n === 1 && afterAct.v === maxBefore + 1 && afterAct.from === target.v,
    'active ' + (afterAct && afterAct.n) + ' 条，v' + (afterAct && afterAct.v) + '（应为 v' + (maxBefore + 1) + '，来源 v' + target.v + '）');

  const writes = await ev(`window.__writes || []`);
  const worst = Array.isArray(writes) ? Math.max(...writes, 0) : -1;
  ok('V3c 没有任何一次落盘出现 2 条以上 active（原子切换）',
    worst <= 1, '落盘 ' + (writes ? writes.length : 0) + ' 次，单次最多 ' + worst + ' 条');

  bad = await dup();
  ok('V1b 切换后仍然唯一', Array.isArray(bad) && bad.length === 0, (bad || []).join('；') || '合规');
}

/* V4 不可变 */
const snapBefore = await ev(`(function(){
  var a = DB.versOf('comp','task-list').filter(function(r){return r.kind==='stable' && r.active;})[0];
  return a ? JSON.stringify(a.snap) : null;
})()`);
await ev(`(function(){ var c = DB.compById('task-list'); c.desc = '改了内容但没保存快照'; DB.save(); return 1; })()`);
await SLEEP(220);
const snapAfter = await ev(`(function(){
  var a = DB.versOf('comp','task-list').filter(function(r){return r.kind==='stable' && r.active;})[0];
  return a ? JSON.stringify(a.snap) : null;
})()`);
ok('V4 改当前内容不改已保存快照（快照不可变）',
  snapBefore === snapAfter, '前后一致=' + (snapBefore === snapAfter) + '，长度 ' + String(snapBefore || '').length);

/* ══ V8 / V9：整包快照与恢复 ══ */
console.log('\n=== V8/V9 · 应用快照带内容，恢复把内容一起带回 ===');
await go(BASE + '/app.html?id=hx-zc', 1400);
const snapInfo = await ev(`(function(){
  /* 这一段的版本号写死 100/101：先把旧台账清空，否则上一次跑留下的 v100 会让
     forceV 撞号、versPublish 返回 null，断言读到的就是上一轮的旧记录（假红/假绿都来过）。 */
  DB.versSet('app','hx-zc',[]);
  /* 这一段要断言 rule-panel 的内容：先确保它真装在这个应用里，
     否则 resolveContent 里没这一块，快照的 content 自然取不到它（上一轮就是 null）。 */
  var a0 = DB.appById('hx-zc');
  if (a0.comps.indexOf('rule-panel') < 0) { a0.comps.push('rule-panel'); DB.save(); }
  DB.setAppContent('hx-zc','rule-panel',{spec:{title:'旧标题',blocks:[]},fields:['规则名','结论']},false);
  var a = DB.appById('hx-zc');
  var c = DB.resolveContent('hx-zc');
  var n1 = DB.versPublish('app','hx-zc',{comps:a.comps.slice(),name:a.name,desc:a.desc,client:a.client,
    content:c,contentHash:DB.hash(c),summary:'判据：旧标题'},null,100);
  DB.setAppContent('hx-zc','rule-panel',{spec:{title:'新标题',blocks:[]},fields:['规则名','结论','依据']},false);
  c = DB.resolveContent('hx-zc');
  DB.versPublish('app','hx-zc',{comps:a.comps.slice(),name:a.name,desc:a.desc,client:a.client,
    content:c,contentHash:DB.hash(c),summary:'判据：新标题'},null,101);
  var rec = DB.versOf('app','hx-zc').filter(function(r){return r.v===100;})[0];
  return { n1: n1, vs: DB.versOf('app','hx-zc').map(function(r){return r.v;}),
           keys: rec && rec.snap ? Object.keys(rec.snap) : null,
           hasContent: !!(rec && rec.snap && rec.snap.content), hash: rec && rec.snap && rec.snap.contentHash,
           fields: rec && rec.snap && rec.snap.content && rec.snap.content['rule-panel'] ? rec.snap.content['rule-panel'].fields.length : null };
})()`);
ok('V8 保存快照带完整内容 + contentHash',
  snapInfo && snapInfo.hasContent === true && /^[0-9a-f]{8}$/.test(String(snapInfo.hash)) && snapInfo.fields === 2,
  'n1=' + (snapInfo && snapInfo.n1) + '，vs=' + (snapInfo && snapInfo.vs) + '，keys=' + (snapInfo && snapInfo.keys) + '，content=' + (snapInfo && snapInfo.hasContent) + '，hash=' + (snapInfo && snapInfo.hash) + '，旧版字段=' + (snapInfo && snapInfo.fields));

await go(BASE + '/versions.html?scope=app&id=hx-zc', 1400);
await ev(`document.querySelector('.vl-row[data-ver="100"] [data-a="act"]').click()`);
await SLEEP(260);
await ev(`document.querySelector('[data-cf="ok"]').click()`);
await SLEEP(360);
const restored = await ev(`(function(){
  var act = DB.versActive('app','hx-zc');
  var c = DB.contentOf('hx-zc','rule-panel');
  /* 2026-11-04：原来顺带取 #now-t（页头那行状态）—— 该行已按用户要求删除，
     取它会抛错让整段返回 null，V9 连带假红。这行数据本来也没被断言用到。 */
  return { v: act ? act.v : null, title: c && c.spec ? c.spec.title : null,
           fields: c ? c.fields.length : null };
})()`);
/* ★2026-11-04（m06113 需求二）：恢复=前向生成新版本，不再把指针拨回 v100。
   点 v100 → 基于它生成 v102（当前最大 101 + 1）并上线；标题/字段回到 v100，
   v101 仍在历史里。 */
ok('V9 恢复：内容回到旧版，并生成新版本上线（前向恢复）',
  restored && restored.v === 102 && restored.title === '旧标题' && restored.fields === 2,
  'active=v' + (restored && restored.v) + '（应为 102），标题=' + (restored && restored.title) + '，字段=' + (restored && restored.fields));

/* ══ A. 应用侧 ══ */
console.log('\n=== A · 应用侧 ===');
await go(BASE + '/versions.html?scope=app&id=hx-zc', 1400);
const appRows = await ev(`document.querySelectorAll('.vl-row').length`);
ok('A1 应用侧用同一张表', appRows > 0, appRows + ' 行');
/* ★2026-11-02 改判（一应用多客户）：已经不存在"这个应用当前授权版本"这一个数 ——
   华信 v3、中信 v2 可以同时存在。状态行现在必须说两件事：
   ①画布上编辑的是哪一版；②各客户停在哪一版（分布）。
   旧断言还按单值口径找「授权版本 v101」，模型变了它只会永远红。 */
/* ★2026-11-04 退役 A2「状态行说清当前版本与客户分布」：
   用户原话「当前版本 v1 这个显示有什么意义？列表里不是已经显示了当前版本了吗」——
   那行状态被要求删掉，判据失去了被测对象。它防的事（页头复述表内已有信息）现在
   反过来成立了：页头不再复述，改由表格的状态列回答。不是放宽，是这条要求被撤销。
   客户的版本分布改到客户授权页用「全部版本」下拉筛。 */
const appText = await ev(`document.body.innerText`);
ok('A3 应用版本页没有「草稿」', !/草稿/.test(String(appText || '')),
  /草稿/.test(String(appText || '')) ? '仍然出现' : '0 处');
const appActive = await ev(`(function(){
  var on = DB.versOf('app','hx-zc').filter(function(r){return r.kind==='stable' && r.active;});
  var a = DB.appById('hx-zc');
  return { n: on.length, v: on.length?on[0].v:null, status: a.status };
})()`);
ok('A4 恢复后唯一 active（新版本上线）',
  appActive && appActive.n === 1 && appActive.v === 102 && appActive.status === '已上架',
  'active=' + (appActive && appActive.n) + '，v' + (appActive && appActive.v) + '，status=' + (appActive && appActive.status));

ok('运行期没有未捕获异常', errs.length === 0, errs.length ? errs.slice(0, 3).join(' ；') : 'none');

console.log('\n通过 ' + pass + ' ｜ 断点 ' + fail);
ws.close(); chrome.kill();
process.exit(fail ? 2 : 0);
