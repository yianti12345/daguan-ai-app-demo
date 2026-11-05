#!/usr/bin/env node
/* e33-struct-undo —— E22 / E23 / E33 的真机验证（只验不改）。
 *
 * 为什么需要它：E22（copy-on-write 深拷贝）与 E23（撤回要有屏幕按钮）的代码
 * 落了三次都没验完 —— 前两包被 150 轮掐断，第三包停在"用旧代码复现改前"。
 * 读代码时发现更硬的一条：加列走的是 `spec.blocks[].cols`，而现盘 8 个组件的
 * `spec` 全是 null、列在 `fields` 里 ⇒ 加列分支恒不走，撤回按钮永远不会出现。
 * 所以"验不出来"不是验得不认真，是被验的功能根本没被触发。
 *
 * 验六条（E33 验收列）：
 *   V1 加列后本应用表头多一列
 *   V2 共用件（组件库 fields）一个字没动
 *   V3 别家应用读同一组件，列没变
 *   V4 提示条长出唯一一颗「撤回」，且键盘 Tab 真能停到它上面
 *   V5 点「撤回」→ 本应用回位、共用件仍没动、别家仍没变
 *   V6 8 秒后提示条收起，按钮 tabIndex=-1 且条子 inert（不许留在 Tab 序里）
 *
 * ★射程（盲审 BLIND-E33-20261028-01 第 12 条要求写清）：本探针**只验 fields 那条路**。
 *   现盘 8 个组件的 spec 全是 null，spec 分支（copy-on-write 副本）一次也触发不到，
 *   六条断言里没有一条读 spec ⇒ 「spec 路走副本」是**未量**，不是通过。
 * ★为什么 V2/V3/V5/V5b 都带 `added` 前置：盲审第 3 条实测 —— 旧件（功能全无）下这四条
 *   照样绿，因为"加列根本没发生"时表头、共用件、别家、撤回后自然全都等于基线。
 *   没有前置的"没变"断言，会把一次空操作读成"没串味、撤回成功"。
 *
 * 负控有两档：
 *   · 换整份旧件（把 _bak 的 app.js 换进来）—— 证伪的是"这一整套功能"，太粗；
 *   · `--negctl-inject`：只把「撤回」那颗按钮从 DOM 删掉，其余一切正常。
 *     它证伪的是 V4/V4b 这两条断言本身（盲审 BLOCK-PRODUCT-20261028-01 第 2 条：
 *     负控证伪的是断言集合，缺浏览器级单点注入）。
 *
 * 用法：node tools/e33-struct-undo.mjs [baseUrl] [--negctl-inject]   正控（只验不改）
 *      node tools/e33-struct-undo.mjs --negctl     负控（10 格断言逐条改坏，每格必须红；不起浏览器）
 * 退出码：0 六条全过 ｜ 2 有断言红（负控档＝10 格全被抓）｜ 1 负控有格改坏后仍绿
 *        ｜ 3 环境失败（起不来／页面抛错）或负控前提不成立
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const INJECT = process.argv.includes('--negctl-inject');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = 'task-list';
const NEW_COL = '触发规则';
const SENTENCE = '在审核任务列表里加一列「' + NEW_COL + '」';
const NEGCTL = process.argv.includes('--negctl');

/* 断言集合抽成纯函数：正控喂真实读数，负控（--negctl）喂"改坏一格"的读数。
   抽出来的唯一目的是**可被证伪** —— 写在流程中间就只能靠读代码相信它会红。 */
function verdict(out) {
  const ck = [];
  const has = (arr, v) => Array.isArray(arr) && arr.indexOf(v) >= 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  /* 画布上有两张表（任务列表 + 规则结论），heads 是两张表拼起来的；
     基线只断言"本应用还没覆盖 + 组件库是 5 列 + 目标列还不存在"。 */
  ck.push(['V0 基线干净（无覆盖、5 列、无新列）', out.base.ownCols === null && out.base.libCols.length === 5 && !has(out.base.heads, NEW_COL)
    && Array.isArray(out.base.ownHeads) && out.base.ownHeads.length >= 2 && !has(out.base.ownHeads, NEW_COL)]);
  /* added = 加列这一步真的发生了。下面四条"没变"断言都挂在它上面：
     没发生时的"没变"什么也证明不了（盲审 BLIND-E33-20261028-01 第 3 条）。
     ★2026-10-29 改（判据过期）：旧断言写死 `ownCols.length===6 && ownCols[5]===新列`。
     实测本应用内容层加列前 3 列、加后 4 列（组件库 fields 仍是 5 列，两者不是同一个数），
     旧断言把"产品对了"判成红。现在按**本次实测的基线**判相对关系：
     目标块表头 = 基线表头 + 末位恰好一列新列；内容层末位也是新列。
     不是放宽：任何换序、插到中间、多列、少列仍红（负控 V1/V1b 各证一次）。 */
  const baseH = out.base.ownHeads;
  const afterH = out.afterAdd.ownHeads;
  const added = Array.isArray(baseH) && Array.isArray(afterH)
    && afterH.length === baseH.length + 1
    && afterH[afterH.length - 1] === NEW_COL
    && same(afterH.slice(0, -1), baseH)
    && !!out.afterAdd.ownCols
    && out.afterAdd.ownCols[out.afterAdd.ownCols.length - 1] === NEW_COL;
  ck.push(['V1 加列后本应用表头多一列', added]);
  ck.push(['V2 共用件 fields 没动（前提：加列已发生）', added && JSON.stringify(out.afterAdd.libCols) === JSON.stringify(out.base.libCols)]);
  ck.push(['V3 别家应用列没变（前提：加列已发生）', added && out.afterAdd.others.every((o) => JSON.stringify(o.cols) === JSON.stringify(out.base.others.find((x) => x.id === o.id).cols))]);
  ck.push(['V4 撤回条出现且只有一颗', out.afterAdd.actCount === 1 && out.afterAdd.actLabel === '撤回']);
  ck.push(['V4b Tab 真能停到撤回', out.tab.hit === true]);
  ck.push(['V5 撤回后表头回位（前提：加列已发生）', added && !has(out.afterUndo.heads, NEW_COL) && out.afterUndo.ownCols === null
    && same(out.afterUndo.ownHeads, out.base.ownHeads)]);
  ck.push(['V5b 撤回后共用件与别家仍未变（前提同上）', added && JSON.stringify(out.afterUndo.libCols) === JSON.stringify(out.base.libCols) && out.afterUndo.others.every((o) => JSON.stringify(o.cols) === JSON.stringify(out.base.others.find((x) => x.id === o.id).cols))]);
  ck.push(['V6 8 秒后收起且移出 Tab 序', out.after8s.hintOn === 'false' && out.after8s.actTab === -1 && out.after8s.actInInert === true]);
  return ck;
}

/* ── 负控：喂一份"标准好读数"，再逐格改坏，每一格都必须红 ──────────────
   为什么必须有：本工具登记进 judgments.mjs 之后，check-judgments 会用 `--negctl` 跑它。
   没有这个分支时，`--negctl` 会被当成普通参数吞掉、照跑真机，
   于是"负控通过"其实是"正控通过" —— 同 check-judgments 2026-10-27 踩过的那个坑。
   射程：这里证的是**断言不是恒真**；仪器有没有真取到数，由正控的 9 条真实读数负责
   （V0 的基线仍是先验值：无覆盖 + 组件库 5 列；V1 的列数关系按本次实测的 ownHeads 推，不再写死 5→6）。
   退出码：10 刀全被抓 = 2（与其它判据的"负控成立"一致）；有刀没抓住 = 1；
   基线（不注入）本身就是红 = 3（前提不成立，不许当通过）。 */
if (NEGCTL) {
  const OTHER = [{ id: 'zj-cg', cols: ['a', 'b', 'c', 'd', 'e'] }, { id: 'gtja-zc', cols: ['a', 'b', 'c', 'd', 'e'] }];
  const GOOD = {
    base: { heads: ['任务编号', '业务类型', '金额', '状态', '处理人', '字段', '状态', '依据', '规则名', '结论', '依据引用'],
            ownHeads: ['任务编号', '金额', '状态'],
            ownCols: null, libCols: ['任务编号', '业务类型', '金额', '状态', '处理人'], others: OTHER },
    afterAdd: { heads: ['任务编号', '金额', '状态', '触发规则', '字段', '状态', '依据', '规则名', '结论', '依据引用'],
                ownHeads: ['任务编号', '金额', '状态', NEW_COL],
                ownCols: ['任务编号', '金额', '状态', NEW_COL],
                libCols: ['任务编号', '业务类型', '金额', '状态', '处理人'], others: OTHER,
                actCount: 1, actLabel: '撤回' },
    tab: { steps: 25, hit: true },
    afterUndo: { heads: ['任务编号', '业务类型', '金额', '状态', '处理人', '字段', '状态', '依据', '规则名', '结论', '依据引用'],
                 ownHeads: ['任务编号', '金额', '状态'],
                 ownCols: null, libCols: ['任务编号', '业务类型', '金额', '状态', '处理人'], others: OTHER },
    after8s: { hintOn: 'false', actTab: -1, actInInert: true },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cases = [
    ['V0', (o) => { o.base.libCols.push('越权列'); }],
    ['V1', (o) => { o.afterAdd.ownHeads = o.afterAdd.ownHeads.filter((h) => h !== NEW_COL); o.afterAdd.ownCols = o.afterAdd.ownCols.filter((h) => h !== NEW_COL); }],
    /* 第二刀：新列加到**开头**也必须红 —— 证明"末位"是真断言，不是只看"表头里有这个名字"。 */
    ['V1', (o) => { o.afterAdd.ownHeads = [NEW_COL].concat(o.afterAdd.ownHeads.filter((h) => h !== NEW_COL)); }],
    ['V2', (o) => { o.afterAdd.libCols.push('越权列'); }],
    ['V3', (o) => { o.afterAdd.others[0].cols.push('越权列'); }],
    ['V4', (o) => { o.afterAdd.actCount = 2; }],
    ['V4b', (o) => { o.tab.hit = false; }],
    ['V5', (o) => { o.afterUndo.heads.push(NEW_COL); }],
    ['V5b', (o) => { o.afterUndo.libCols.push('越权列'); }],
    ['V6', (o) => { o.after8s.actTab = 0; }],
  ];
  const baseRed = verdict(GOOD).filter(([, ok]) => !ok);
  console.log('负控（断言集合的证伪，不起浏览器）');
  if (baseRed.length) {
    console.log(`  ✗ 前提不成立：标准读数本身就有 ${baseRed.length} 条红 ⇒ 后面的"红"证明不了任何事`);
    process.exit(3);
  }
  let missed = 0;
  for (const [tag, breakIt] of cases) {
    const o = clone(GOOD);
    breakIt(o);
    const reds = verdict(o).filter(([, ok]) => !ok).map(([name]) => name);
    const hit = reds.some((name) => name.startsWith(tag + ' '));
    if (!hit) missed++;
    console.log(`  ${hit ? '✓' : '✗'} 改坏 ${tag} ⇒ ${hit ? '该条判红' : '没被抓住'}（红 ${reds.length} 条：${reds.join(' / ') || '无'}）`);
  }
  console.log('');
  if (missed) {
    console.log(`负控失败：${missed}/${cases.length} 格改坏后仍绿 ⇒ 这几条断言是恒真的，不算判据`);
    process.exit(1);
  }
  console.log(`负控成立：${cases.length}/${cases.length} 格逐条改坏都能判红（基线全绿），rc=2`);
  process.exit(2);
}

let base;
try { base = await resolveBase(); } catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/e33-${Date.now()}`, '--remote-allow-origins=*',
  '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let seq = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; wait.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 120000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error('页面抛错：' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 240));
  return r.result.value;
};

const STATE = `(function(){
  var th = Array.prototype.map.call(document.querySelectorAll('#canvas table.tb thead th'), function(x){return x.textContent.trim()}).filter(Boolean);
  var blk = document.querySelector('.cv-blk[data-comp="${target}"]');
  var ownHeads = blk ? Array.prototype.map.call(blk.querySelectorAll('table.tb thead th'), function(x){return x.textContent.trim()}).filter(Boolean) : null;
  var own = (DB.appById('hx-zc').content||{})['${target}'] || null;
  var others = DB.APPS.filter(function(a){return a.id!=='hx-zc'}).map(function(a){
    var c = DB.contentOf(a.id,'${target}');
    return {id:a.id, cols:(c&&c.fields||[]).slice()};
  });
  var h = document.querySelector('#hint'), b = document.querySelector('#hint-act');
  return {
    heads: th,
    ownHeads: ownHeads,
    ownCols: own && own.fields ? own.fields : null,
    libCols: DB.compById('${target}').fields.slice(),
    others: others,
    hintOn: h && h.getAttribute('data-on'),
    hintText: h ? h.textContent.trim() : null,
    hasAct: !!b,
    actCount: document.querySelectorAll('#hint-act').length,
    actLabel: b ? b.textContent.trim() : null,
    actTab: b ? b.tabIndex : null,
    actInInert: b ? !!b.closest('[inert]') : null
  };
})()`;

const addCol = `(function(){
  var ta = document.querySelector('#fk-input'), b = document.querySelector('#fk-send');
  if (!ta || !b) return {err:'no composer'};
  ta.focus();
  ta.value = ${JSON.stringify(SENTENCE)};
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  var ready = b.getAttribute('data-ready');
  b.click();
  return {ready: ready};
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/app.html?id=hx-zc` });
  await sleep(2000);

  const out = {};
  out.base = await ev(STATE);
  out.composer = await ev(`!!document.querySelector('#fk-input')`);

  /* ── 加一列 ── */
  out.add = await ev(addCol);
  await sleep(400);
  /* 单点注入负控：只删掉那颗按钮，其余不动。
     ★必须在读快照**之前**注入 —— 第一版放在快照之后，V4 照样绿，
     反而证明了这条断言当时是"证伪不了的"（E46 的价值就在这）。 */
  if (INJECT) {
    out.injected = await ev(`(function(){var b=document.querySelector('#hint-act');if(!b)return 'no-btn';b.remove();return 'removed';})()`);
  }
  out.afterAdd = await ev(STATE);

  /* ── V4b：键盘 Tab 真能停到撤回按钮 ── */
  await ev(`(function(){document.body.setAttribute('tabindex','-1');document.body.focus();})()`);
  let steps = 0, hit = false;
  for (let i = 0; i < 150; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    steps++;
    const id = await ev(`(document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || ''`);
    if (id === 'hint-act') { hit = true; break; }
  }
  out.tab = { steps, hit };

  /* ── V5：点撤回 ── */
  out.clickUndo = await ev(`(function(){var b=document.querySelector('#hint-act');if(!b)return 'no-btn';b.click();return 'clicked'})()`);
  await sleep(400);
  out.afterUndo = await ev(STATE);

  /* ── V6：再加一列，等 8 秒看它收不收 ── */
  await ev(addCol);
  await sleep(600);
  out.before8s = await ev(STATE);
  await sleep(8400);
  out.after8s = await ev(STATE);
  await ev(`(function(){var b=document.querySelector('#hint-act');if(b)b.click();})()`);

  /* ── 判定 ── */
  /* 断言在文件顶部 verdict()：正控与负控跑的是**同一份**断言集合，
     否则负控证明的就不是正控那条路。 */
  const ck = verdict(out);

  console.log('被验服务：' + base + ' ｜ 目标组件：' + target + ' ｜ 新列：' + NEW_COL);
  console.log('基线表头：' + JSON.stringify(out.base.heads));
  console.log('加列后  ：' + JSON.stringify(out.afterAdd.heads) + ' ｜ 内容层 ' + JSON.stringify(out.afterAdd.ownCols));
  console.log('共用件  ：' + JSON.stringify(out.base.libCols) + ' → ' + JSON.stringify(out.afterAdd.libCols));
  console.log('别家 3 家：' + out.afterAdd.others.map((o) => o.id + '=' + o.cols.length + '列').join(' ｜ '));
  console.log('撤回条  ：' + out.afterAdd.hintText + ' ｜ Tab ' + out.tab.steps + ' 步 ' + (out.tab.hit ? '命中' : '未命中'));
  console.log('撤回后  ：表头 ' + JSON.stringify(out.afterUndo.heads) + ' ｜ 内容层 ' + JSON.stringify(out.afterUndo.ownCols));
  console.log('8 秒后  ：data-on=' + out.after8s.hintOn + ' ｜ tabIndex=' + out.after8s.actTab + ' ｜ inert=' + out.after8s.actInInert);
  console.log('');
  let red = 0;
  for (const [name, ok] of ck) { console.log((ok ? '  ✓ ' : '  ✗ ') + name); if (!ok) red++; }
  console.log('\n通过 ' + (ck.length - red) + ' ｜ 断点 ' + red);
  process.exit(red ? 2 : 0);
} catch (e) {
  console.log('FATAL: ' + String(e.message).slice(0, 300));
  process.exit(3);
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
}
