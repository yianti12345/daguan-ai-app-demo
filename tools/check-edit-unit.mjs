#!/usr/bin/env node
/* check-edit-unit —— 「改版单位」判据：一次只改一处的编辑，必须只改那一处。
 *
 * 读的是被测物的哪个量（全部来自 8941 上的真实页面 /app.html?id=hx-zc）：
 *   ① 块级内容：`#canvas section.cv-blk[data-comp]` 每块的规范化 innerText；
 *   ② 表级结构：每块内 table 的 thead 表头文本数组 + tbody 每行单元格文本数组
 *      （即「表头列数」与「行 hash」的展开形态，能定位到第几行第几格变了）；
 *   ③ 数据面：`window.DB.COMPS` 里每个组件的 spec / fields —— 这是「发布新版本」会冻进
 *      版本快照的那份数据，页面看不出来的隐藏改动也要在这里现形；
 *   ④ 渲染面（只读不判）：编辑前后 `section.cv-blk` 的 DOM 节点引用是否还是同一批。
 *
 * 射程（能判什么）：
 *   - 目标块内「加一列」是否精确：表头只追加一列、行数不变、原有单元格逐字不变、
 *     新单元格全为「待补充」；
 *   - 其余块的内容是否逐字不变（块级 innerText + 表头 + 每行单元格）；
 *   - 其余组件的 spec/fields 是否逐字不变（防止「页面看不出来、但版本快照被改了」）；
 *   - 撤回一步后，目标块与其余块是否逐字回到改前。
 *
 * 射程外（判不了，以及为什么）：
 *   - 渲染边界：`renderCanvas()` 用 `cv.innerHTML = html` 整画布重写，所以任何一次编辑都会
 *     替换所有块节点；「只有目标块的 DOM 节点被替换」在本产品里恒假，不能当判据。
 *     本判据把节点存活当读数打印，不参与红绿。
 *   - 像素级：整页重画 + 同内容 ⇒ 像素一致；像素差只能说明「看起来变了」，不能说明
 *     「哪一块被改了」，而且对文本级越界比块级 innerText 更粗。
 *   - 意图归属：判据只知道「哪块变了」，不知道「用户想让哪块变」。本判据用固定指令 +
 *     固定目标（规则结论表），目标由夹具与指令共同钉死；换成自由对话时，「改错块」要靠
 *     模型的结构化输出才能判，当前没有这个信号。
 *   - 跨应用（2026-10-28 E22 起判）：编辑只许落在**本应用的内容层**（app.content），
 *     组件库里的 spec 一个字节都不许动。本判据同时读三处：
 *       · hx-zc 的生效内容 3→4 列（页面与数据面一致）；
 *       · 同样装了 rule-panel 的 zj-cg / gtja-zc 生效内容仍是 3 列；
 *       · DB.COMPS.rule-panel.spec 改前改后逐字相同。
 *     修前这条判不了，因为 spec 只有组件级一份（一次编辑三家一起变）；现在数据层
 *     已经有应用私有内容层，判据就跟着改成判这条边界 —— 断言是加严，不是放宽。
 *   - 已发布版本：应用正式版的 snap 只存 `{comps, name, desc}`，不含组件 spec。组件内容
 *     一改，所有引用同一组件的正式版都跟着变 —— 这是「正式版不可变」失守的根因，但它是
 *     版本数据模型的问题，不是本页编辑单位能判的；同样只打印读数、不判红。
 *   - 无 spec 的块：内容写死在渲染函数里，改它只能走 Gen.componentSpec 整块重生成，
 *     没有可定义的单位。当前生产数据 8 个组件全部无 spec，所以真实页面上的「加列」路径
 *     不可达；本判据给 rule-panel 注入运行时 spec 夹具（只写本次临时浏览器 profile 的
 *     localStorage，不改产品文件），验证的是**观测机制与执行机制**，不代表生产数据已经
 *     具备该能力。数据改造缺口见 _reports/落地-改版单位判据-20261027.md。
 *
 * 用法：node tools/check-edit-unit.mjs [baseUrl] [--negctl]
 * 退出码：0 正控通过 ｜ 2 判红（--negctl 预期也是 2）｜ 3 环境不可用（服务 / Chrome / 夹具起不来）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const NEG = process.argv.includes('--negctl');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const reds = [];
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '｜' + note : '')); return true; }
  fail++; const line = name + (note ? '｜' + note : ''); reds.push(line);
  console.log('  ✗ ' + line); return false;
}
const J = (x) => JSON.stringify(x);

/* ── CDP：沿用项目既有通道（tools/base.mjs 的 debugPort + chrome-nosandbox）── */
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/edit-unit-${Date.now()}`,
  '--remote-allow-origins=*', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* Chrome 还没起 */ }
  await SLEEP(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let seq = 0; const wait = new Map(); const pageErrs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  }
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; wait.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 30000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) {
    console.log('FATAL: 页面抛错 → ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
    chrome.kill('SIGKILL'); process.exit(3);
  }
  return r.result?.value;
};
const until = async (expr, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await SLEEP(120);
  }
  return false;
};
const go = async (url, ms = 1500) => { await send('Page.navigate', { url: BASE + url }); await SLEEP(ms); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

/* ── 快照：页面（块文本 + 表头 + 每行单元格）与数据面（comp spec/fields）── */
const snap = async () => ev(`(function(){
  var norm = function(s){ return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); };
  var blocks = [].slice.call(document.querySelectorAll('#canvas section.cv-blk'));
  return {
    blocks: blocks.map(function(b){
      var t = b.querySelector('table');
      return {
        comp: b.getAttribute('data-comp'),
        text: norm(b.innerText),
        table: t ? {
          cols: [].map.call(t.querySelectorAll('thead th'), function(th){ return norm(th.innerText); }),
          rows: [].map.call(t.querySelectorAll('tbody tr'), function(tr){
            return [].map.call(tr.children, function(td){ return norm(td.innerText); });
          })
        } : null
      };
    })
  };
})()`);

const dbSnap = async () => ev(`(function(){
  return {
    comps: DB.COMPS.map(function(c){
      return {
        id: c.id,
        spec: c.spec ? JSON.parse(JSON.stringify(c.spec)) : null,
        fields: (c.fields || []).slice()
      };
    })
  };
})()`);

const byComp = (s, id) => (s.blocks || []).find((b) => b.comp === id) || null;
const others = (s, id) => (s.blocks || []).filter((b) => b.comp !== id);
const compsExcept = (d, id) => (d.comps || []).filter((c) => c.id !== id);

/* 某应用「这一块现在长什么样」——读的是应用内容层（E22 后编辑只落在这里）。
   另外读它的列数，用来钉住"别家应用没被串味"。 */
/* ★2026-11-04 判据写错（假红）：这里原来只读 spec.blocks[0].cols，spec 不存在就当 0 列；
   而页面渲染的真实口径是「有 spec 用 spec.cols，没有就用 fields」（assets/app.js:1184-1185 tableOf）。
   于是一个从没被单独改过的组件，在页面上明明是 3 列、判据却读到 0 列 —— 基线错，后面全错。
   现在按同一口径回落，读数与页面一致。 */
const effOf = async (appId, compId) => ev(`(function(){
  var c = DB.contentOf(${JSON.stringify(appId)}, ${JSON.stringify(compId)});
  if (!c) return null;
  var spec = c.spec ? JSON.parse(JSON.stringify(c.spec)) : null;
  var cols = (spec && spec.blocks && spec.blocks[0] && spec.blocks[0].cols) || (Array.isArray(c.fields) ? c.fields : []);
  return { spec: spec, cols: cols };
})()`);
const colsOf = (e) => (e && e.cols ? e.cols : null);

/* ① 打开应用 → 清空 localStorage → 重载，确保跑在种子上（临时 profile，不污染别的会话） */
await go('/app.html?id=hx-zc', 1200);
await ev(`localStorage.clear(); 'ok'`);
await go('/app.html?id=hx-zc', 1800);
/* ★2026-11-04 夹具（判据过期，不是产品坏了）：种子已按用户要求改成「演示的装配清单全部留空（从零演示）」，
   于是 hx-zc 一进来就是空画布，本判据却在等 >=2 块 ⇒ FATAL。这里现场装两块共用件，
   走的就是用户在组件库点「装上」的同一入口（DB.install），不伪造任何 content。 */
const _f = await ev("(function(){ ['rule-panel','task-list'].forEach(function(id){ DB.install('hx-zc', id); }); return DB.appById('hx-zc').comps.length; })()");
await go('/app.html?id=hx-zc', 1500);
console.log('  夹具：hx-zc 装回 ' + _f + ' 块（种子从零演示，块由判据自己造）');
if (!(await until(`document.readyState === 'complete' && !!window.DB && !!window.Gen && document.querySelectorAll('#canvas section.cv-blk').length >= 2`, 8000))) {
  console.log('FATAL: app.html 没有起成（DB / Gen / 画布块不全）'); chrome.kill('SIGKILL'); process.exit(3);
}

/* ② 先量生产数据面：有多少组件真的带 spec。这不是判据，是「这条路径今天能不能在真实数据上走」的读数 */
const prod = await ev(`(function(){
  var withSpec = DB.COMPS.filter(function(c){ return !!c.spec; });
  return { total: DB.COMPS.length, n: withSpec.length, ids: withSpec.map(function(c){ return c.id; }) };
})()`);

console.log(`改版单位判据｜基址 ${BASE}｜${NEG ? '负控（注入越界改动）' : '正控'}`);
console.log(`生产数据面：${prod.n}/${prod.total} 个组件带 spec${prod.n ? '（' + prod.ids.join(',') + '）' : ' —— 真实数据下「加列」本地路径不可达'}；本判据给 rule-panel 注入运行时 spec 夹具（只写本次临时浏览器 profile 的 localStorage）`);

/* 两条射程外读数：跨应用共享 / 版本快照。它们不影响红绿，但必须每次跑都露出边界。 */
const shared = await ev(`(function(){
  var apps = DB.APPS.filter(function(a){ return (a.comps || []).indexOf('rule-panel') >= 0; }).map(function(a){ return a.id; });
  var list = DB.versOf('app', 'hx-zc') || [];
  var st = list.filter(function(r){ return r.kind === 'stable'; }).sort(function(x, y){ return y.v - x.v; })[0] || null;
  var c = DB.compById('rule-panel');
  return {
    apps: apps,
    specOn: c && c.spec ? 'comp' : 'none',
    stableV: st ? st.v : null,
    snapKeys: st && st.snap ? Object.keys(st.snap) : null,
    snapHasSpec: !!(st && st.snap && (st.snap.spec || st.snap.specs))
  };
})()`);
console.log(`  量（判）：跨应用 —— rule-panel 被 ${shared.apps.length} 个应用装配（${shared.apps.join(', ')}）；判「本应用 4 列 / 另两家仍 3 列 / 组件库 spec 逐字不动」。`);
console.log(`  读（不判）：版本快照 —— app v${shared.stableV} 的 snap 键 = ${shared.snapKeys ? shared.snapKeys.join(',') : '无'}；${shared.snapHasSpec ? '含 spec' : '不含 spec，组件内容改动会穿透已发布版本'}。`);
console.log('');

/* ③ 夹具：把 rule-panel 的内容变成 spec（与它原有 3 列 × 3 行一致），再重载让 specBlock 真的渲染 */
const FIXTURE = {
  title: '规则结论',
  blocks: [{
    type: 'table',
    cols: ['规则名', '结论', '依据引用'],
    rows: [
      ['主体资格', '已通过', '第 2 页 3.1'],
      ['关联交易', '待复核', '第 5 页 4.2'],
      ['重大违法', '已驳回', '第 7 页 5.1']
    ]
  }]
};
const applied = await ev(`(function(){
  var c = DB.compById('rule-panel');
  if (!c) return { ok: false, why: 'DB 里没有 rule-panel' };
  c.spec = ${JSON.stringify(FIXTURE)};
  c.fields = ['规则名', '结论', '依据引用'];
  DB.save();
  return { ok: true };
})()`);
if (!applied || !applied.ok) {
  console.log('FATAL: 夹具写不进页面数据：' + J(applied)); chrome.kill('SIGKILL'); process.exit(3);
}
await go('/app.html?id=hx-zc', 1800);
const fixtureOk = await ev(`(function(){
  var b = document.querySelector('#canvas section.cv-blk[data-comp="rule-panel"]');
  var t = b && b.querySelector('table');
  return {
    block: !!b,
    table: !!t,
    cols: t ? [].map.call(t.querySelectorAll('thead th'), function(x){ return x.textContent.trim(); }) : [],
    rows: t ? t.querySelectorAll('tbody tr').length : 0
  };
})()`);
if (!fixtureOk || !fixtureOk.table || J(fixtureOk.cols) !== J(['规则名', '结论', '依据引用']) || fixtureOk.rows !== 3) {
  console.log('FATAL: spec 夹具没有渲染成预期的 3 列 × 3 行：' + J(fixtureOk)); chrome.kill('SIGKILL'); process.exit(3);
}

const before = await snap();
const dbBefore = await dbSnap();
const targetBefore = byComp(before, 'rule-panel');
if (!targetBefore || !targetBefore.table) {
  console.log('FATAL: 基线里找不到 rule-panel 的表格'); chrome.kill('SIGKILL'); process.exit(3);
}
/* 三处基线：本应用生效内容 / 另两家生效内容 / 组件库本体（E22 的三条边界） */
const effBefore = await effOf('hx-zc', 'rule-panel');
const crossBefore = {};
for (const aid of shared.apps.filter((x) => x !== 'hx-zc')) crossBefore[aid] = await effOf(aid, 'rule-panel');
const sharedBefore = (dbBefore.comps || []).find((c) => c.id === 'rule-panel');
console.log(`目标：rule-panel 表 ${targetBefore.table.cols.length} 列 × ${targetBefore.table.rows.length} 行 → 加一列「触发规则」`);
console.log(`基线：本应用生效 ${colsOf(effBefore).length} 列｜` +
  shared.apps.filter((x) => x !== 'hx-zc').map((x) => x + ' ' + (colsOf(crossBefore[x]) || []).length + ' 列').join('｜') +
  `｜组件库 spec ${sharedBefore && sharedBefore.spec ? sharedBefore.spec.blocks[0].cols.length + ' 列' : '无'}`);

/* 存节点引用：只读不判，用来看「整画布重写」这件事 */
await ev(`window.__unitNodes = [].slice.call(document.querySelectorAll('#canvas section.cv-blk')); 'ok'`);

/* ④ 负控：在产品自己的持久化入口 DB.save 上注入「同一编辑顺手改别处」——
      ① 跨块溢写：把 task-list.fields 多加一列（页面与版本快照都会变）；
      ② 块内越界：把目标块既有第一行第一格改写（旧模型整块重生成的症状）。
   这不是改判据，是模拟判据要抓的那种产品行为。 */
if (NEG) {
  const injected = await ev(`(function(){
    var orig = DB.save;
    window.__unitNegArmed = true;
    DB.save = function(){
      var r = orig.apply(DB, arguments);
      if (window.__unitNegArmed) {
        /* E22 之后编辑落在本应用内容层：越界注入也要落在同一层才叫"模拟产品行为"，
           否则注入到组件库那条（产品已经不再写）永远不会触发，负控就成了空跑。 */
        var a = DB.appById('hx-zc');
        var own = a && a.content && a.content['rule-panel'];
        var tbl = own && own.spec && own.spec.blocks && own.spec.blocks[0];
        if (tbl && tbl.cols && tbl.cols.length === 4) {
          window.__unitNegArmed = false;
          var tl = DB.compById('task-list');
          if (tl && tl.fields) tl.fields.push('触发规则');
          if (tbl.rows && tbl.rows[0]) tbl.rows[0][0] = '主体资格（重新生成）';
          orig.apply(DB, arguments);
        }
      }
      return r;
    };
    return true;
  })()`);
  if (!injected) { console.log('FATAL: 负控注入失败'); chrome.kill('SIGKILL'); process.exit(3); }
  console.log('负控注入：DB.save 时给 task-list 加一列 + 改写目标块第一行第一格');
}

/* ⑤ 走真实入口：输入框赋值 → 派发 input（发送钮才会 ready）→ 点发送。
   后面还有三轮（按钮撤回 / 8 秒自动消失 / Tab+Enter），所以入口封成一个函数。 */
const sayTo = async (text) => ev(`(function(){
  var ta = document.querySelector('#fk-input'), bt = document.querySelector('#fk-send');
  if (!ta || !bt) return 'NO_INPUT';
  ta.value = ${JSON.stringify(text)};
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (bt.getAttribute('data-ready') !== 'true') return 'NOT_READY';
  bt.click();
  return 'sent';
})()`);
const sent = await sayTo('在规则结论表里加一列触发规则');
if (sent !== 'sent') {
  console.log(`FATAL: 对话入口不可用（${sent}）`); chrome.kill('SIGKILL'); process.exit(3);
}

/* 真实键盘：rawKeyDown + keyUp（Tab 的焦点移动由渲染进程执行，不能用页面派发 KeyboardEvent 代替）。
   照抄 tools/check-dialog-focus.mjs 的做法，避免两套键盘语义。 */
async function key(type, keyName, vk) {
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', { type, ...base });
  if (type === 'rawKeyDown') await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
/* Enter 必须带 text:'\r' 才会产生按钮的默认激活动作；
   rawKeyDown 只到 keydown，原生 button 的 click 不会发生（实测 B8 就是这么红的）。 */
async function pressEnter() {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    text: '\r', unmodifiedText: '\r' };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/* 提示条读数：可见吗、说的是什么、有没有那颗「撤回」、它还能不能 Tab 到 */
const barOf = async () => ev(`(function(){
  var h = document.querySelector('#hint');
  var b = h && h.querySelector('#hint-act');
  var r = b ? b.getBoundingClientRect() : null;
  var hit = null;
  if (r && r.width && r.height) {
    var el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    hit = !!(el && (el === b || b.contains(el)));
  }
  return {
    on: !!(h && h.getAttribute('data-on') === 'true'),
    text: h ? (h.textContent || '').trim() : '',
    act: !!(b && h.getAttribute('data-act') === 'true'),
    label: b ? (b.textContent || '').trim() : '',
    tab: b ? b.tabIndex : null,
    n: document.querySelectorAll('.hint-act').length,   /* 同一时刻只许一条 */
    /* 鼠标真按得动：按钮中心点必须命中自己，且整颗在视口内（不被悬浮条/画布盖住） */
    hit: hit,
    inView: !!(r && r.width && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth)
  };
})()`);

const landed = await until(`(function(){
  /* 落地判据读**本应用生效内容**：E22 之后编辑只许写这里，组件库那条不许变 4 列 */
  var c = DB.contentOf('hx-zc', 'rule-panel');
  var t = c && c.spec && c.spec.blocks && c.spec.blocks[0];
  return !!(t && t.cols && t.cols.length === 4);
})()`, 6000);
const after = landed ? await snap() : before;
const dbAfter = landed ? await dbSnap() : dbBefore;
const effAfter = landed ? await effOf('hx-zc', 'rule-panel') : effBefore;
const targetAfter = byComp(after, 'rule-panel');

/* ⑥ 断言：目标块精确 + 其余块/其余组件不动 */
if (!landed) {
  const hint = await ev(`(function(){ var h = document.querySelector('#hint'); return h ? (h.innerText || '').trim() : ''; })()`);
  ok('E0 编辑真的落地', false, '点发送后 6 秒内 rule-panel 仍不是 4 列；最近提示「' + String(hint).slice(0, 80) + '」');
} else {
  const tb = targetBefore.table, ta = targetAfter.table;
  const expCols = tb.cols.concat(['触发规则']);
  ok('E1 目标块表头只追加「触发规则」', ta && J(ta.cols) === J(expCols),
    ta ? `${tb.cols.length}→${ta.cols.length} 列：${ta.cols.join(' / ')}` : '目标块没有表格');

  let rowBad = null;
  if (!ta || ta.rows.length !== tb.rows.length) {
    rowBad = `行数 ${tb.rows.length}→${ta ? ta.rows.length : '无表'}`;
  } else {
    for (let i = 0; i < tb.rows.length && !rowBad; i++) {
      const oldR = tb.rows[i], newR = ta.rows[i];
      if (newR.length !== oldR.length + 1) { rowBad = `第 ${i + 1} 行列数 ${oldR.length}→${newR.length}`; break; }
      for (let k = 0; k < oldR.length; k++) {
        if (newR[k] !== oldR[k]) { rowBad = `第 ${i + 1} 行第 ${k + 1} 格「${oldR[k]}」→「${newR[k]}」`; break; }
      }
      if (rowBad) break;
      if (newR[newR.length - 1] !== '待补充') { rowBad = `第 ${i + 1} 行新列填了「${newR[newR.length - 1]}」`; break; }
    }
  }
  ok('E2 目标块行数不变、原有单元格逐字不变、新列全为「待补充」', !rowBad,
    rowBad || `${tb.rows.length} 行 × 原 ${tb.cols.length} 格逐字一致，新列 ${tb.rows.length} 格均为「待补充」`);

  const otherBefore = others(before, 'rule-panel');
  const otherAfter = others(after, 'rule-panel');
  const changed = [];
  if (otherBefore.length !== otherAfter.length) changed.push(`块数 ${otherBefore.length}→${otherAfter.length}`);
  else otherBefore.forEach((b, i) => { if (J(b) !== J(otherAfter[i])) changed.push(b.comp); });
  ok('E3 其余块逐字不变（块文本 + 表头 + 每行单元格）', changed.length === 0,
    changed.length ? `变了：${changed.join(', ')}` : `${otherBefore.map((b) => b.comp).join(', ')} 全部一致`);

  const compsChanged = [];
  const cb = compsExcept(dbBefore, 'rule-panel'), ca = compsExcept(dbAfter, 'rule-panel');
  if (cb.length !== ca.length) compsChanged.push(`组件数 ${cb.length}→${ca.length}`);
  else cb.forEach((c, i) => { if (J(c) !== J(ca[i])) compsChanged.push(c.id); });
  ok('E4 其余组件 spec/fields 数据面不变（版本快照会带走的那份）', compsChanged.length === 0,
    compsChanged.length ? `变了：${compsChanged.join(', ')}` : `${cb.length} 个组件逐字一致`);

  /* E5 读本应用生效内容（应用内容层），不再读组件库 —— 后者现在按 E22 必须是原样 */
  let dataBad = null;
  if (!effAfter || !effAfter.spec) dataBad = '本应用这一块没有生效内容';
  else {
    const t0 = effBefore.spec.blocks[0], t1 = effAfter.spec.blocks[0];
    if (J(t1.cols) !== J(t0.cols.concat(['触发规则']))) dataBad = `内容层 cols ${J(t0.cols)}→${J(t1.cols)}`;
    else if (t1.rows.length !== t0.rows.length) dataBad = `内容层行数 ${t0.rows.length}→${t1.rows.length}`;
    else {
      for (let i = 0; i < t0.rows.length && !dataBad; i++) {
        for (let k = 0; k < t0.rows[i].length; k++) {
          if (t1.rows[i][k] !== t0.rows[i][k]) { dataBad = `内容层第 ${i + 1} 行第 ${k + 1} 格被改`; break; }
        }
      }
    }
  }
  ok('E5 本应用内容层只追加一列（数据面与页面一致）', !dataBad, dataBad || 'cols +1、rows 原值逐字保留');

  /* ── E22：跨应用串味（2026-10-28 起判）── */
  const rpAfter = (dbAfter.comps || []).find((c) => c.id === 'rule-panel');
  ok('X1 共用件 DB.COMPS.rule-panel.spec 一个字节没变', J(rpAfter) === J(sharedBefore),
    J(rpAfter) === J(sharedBefore)
      ? `组件库仍 ${rpAfter.spec.blocks[0].cols.length} 列｜与改前逐字一致`
      : '组件库 spec 被本次编辑改了');
  const xBad = [];
  const xNow = {};
  for (const aid of Object.keys(crossBefore)) {
    xNow[aid] = await effOf(aid, 'rule-panel');
    if (J(xNow[aid]) !== J(crossBefore[aid])) xBad.push(aid);
  }
  ok('X2 另两家装同一组件的应用仍是 3 列（无幽灵列）', xBad.length === 0,
    xBad.length ? '被串味：' + xBad.join(' / ')
      : Object.keys(xNow).map((aid) => aid + ' ' + colsOf(xNow[aid]).length + ' 列').join('｜'));

  /* ★2026-11-02 改判：00e §4 明确「不要撤回」。原 E23 那套（B1 撤回按钮 / U1-U5 撤回回位 /
     B2-B8 点按·Tab·8 秒收起）验的是一个被用户砍掉的功能，功能删了判据还在要求它 —— 永远红。
     现在只锁两件事：①结构编辑的提示条还在、只报事实；②屏幕上不许重新长出「撤回」入口。 */
  const bar1 = await barOf();
  ok('B1 结构编辑后提示条只报事实、没有「撤回」', bar1.on && !bar1.act
      && /加了一列/.test(bar1.text) && /触发规则/.test(bar1.text),
    '可见=' + bar1.on + '｜文案「' + bar1.text + '」｜按钮「' + bar1.label + '」｜data-act=' + bar1.act);
  ok('B1b 页面上不再有撤回入口（00e §4 的决定）',
    await ev('(function(){ if (document.querySelector("#hint-act")) return false; var t = (document.querySelector("#hint") || {}).textContent || ""; return t.indexOf("撤回") < 0; })()'),
    '检查 #hint-act 与提示条文案里的「撤回」');
  const t0 = Date.now();
  const gone = await until('(function(){ var h = document.querySelector("#hint"); return !!(h && h.getAttribute("data-on") === "false"); })()', 12000);
  ok('B2 提示条 8 秒后自动消失（全程不碰它）', !!gone && (Date.now() - t0) <= 9300,
    '起止间隔 ' + (Date.now() - t0) + ' ms（阈值 ≤9300；提示条设定 8000）');
}

/* ⑨ 渲染面读数（不判）：整画布重写 ⇒ 节点存活应为 0 */
const nodeInfo = await ev(`(function(){
  var now = [].slice.call(document.querySelectorAll('#canvas section.cv-blk'));
  var old = window.__unitNodes || [];
  var same = 0;
  for (var i = 0; i < now.length; i++) if (now[i] === old[i]) same++;
  return { same: same, total: now.length };
})()`);
console.log(`  读（不判）：DOM 节点存活 ${nodeInfo.same}/${nodeInfo.total} —— renderCanvas() 用 innerHTML 整画布重写，每次编辑所有块节点都会被替换；本判据只判内容边界，不判渲染边界。`);

if (pageErrs.length) console.log('\n  页面异常：' + pageErrs.slice(0, 2).join(' ;; '));
console.log(`\n通过 ${pass} ｜ 断点 ${fail}`);

if (NEG) {
  if (fail > 0) {
    console.log('负控：注入越界改动后判红 ✓（该红的红了，rc=2）');
    console.log('      红的理由：' + reds.join('；'));
    chrome.kill('SIGKILL');
    process.exit(2);
  }
  console.log('负控失败：注入越界改动后仍然全绿 —— 这条判据是空的 ✗');
  chrome.kill('SIGKILL');
  process.exit(1);
}
chrome.kill('SIGKILL');
process.exit(fail > 0 ? 2 : 0);
