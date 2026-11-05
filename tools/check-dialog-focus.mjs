#!/usr/bin/env node
/* check-dialog-focus —— 模态弹层的**焦点契约**判据（WAI-ARIA APG Dialog Pattern）。
 *
 * 为什么要有它：全站三个模态层（#ap-mask 新建应用 / #nf-mask 新增组件 / #mask 装配面板）
 * 各自的焦点代码是三轮里分头补的：有的只在 mask 上挂 Tab 圈禁，有的用 document 级 Escape。
 * 于是「键盘用户打开弹窗后焦点在哪、Tab 会不会跑回背后的列表、Esc 之后光标落在哪」这三件事
 * 每一层都不一样，而且**没有任何一条命令在看它们**。读屏和纯键盘用户撞上的第一个问题
 * 通常不是"不好看"，是"打开之后按 Tab 跑到看不见的表格里了"。
 *
 * 判据（APG Dialog Pattern 四条，逐层照抄，不许按层放宽）：
 *   ① 打开后焦点落在 dialog 内（不是 body、不是背后的列表）
 *   ② dialog 内 n 个 tabbable，连发 n+1 次 Tab 之后焦点仍在 dialog 内（焦点环绕）
 *   ③ 一次 Shift+Tab 之后焦点仍在 dialog 内
 *   ④ Esc 关闭后焦点回到"打开前那个元素"（不是 body）
 *   ⑤ 完整性：dialog 有 aria-labelledby 或 aria-label；关闭后页面无 [inert] 残留
 *
 * 为什么用真实键盘事件（CDP Input.dispatchKeyEvent）而不是在页面里派发 KeyboardEvent：
 *   页面里 `new KeyboardEvent('keydown',{key:'Tab'})` 只能喂给 JS 监听器，
 *   **不产生浏览器默认的焦点移动**。那样"Tab 之后焦点还在 dialog 内"永远为真 ——
 *   判据会绿，而真人按 Tab 早就跑到背景里了。必须让浏览器自己走默认动作。
 *
 * 用法：node tools/check-dialog-focus.mjs            正控
 *      node tools/check-dialog-focus.mjs --negctl   负控：注入"删掉打开时那次 .focus()"，必须红
 * 退出码：0 全部通过 ｜ 2 有 FAIL（打印失败项）｜ 3 Chrome 起不来 / 页面打不开
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');
const OPEN_WAIT = 450;   /* 三个弹层的初始 focus 都在 setTimeout(30) 里，450 够它跑完 */

/* 被测的三个模态层。
   ⚠ 触发钮以**代码里的实际入口**为准：装配面板 #mask 的 openDlg(t, trigger) 由
     #act-assemble / #cv-install 调用（assets/app.js:524、:361、:376），不是 .btn-install
     —— .btn-install 是面板**内部**"装配"按钮。 */
const TARGETS = [
  { page: 'apps.html', trigger: '#btn-new', mask: '#ap-mask', name: 'apps.html · 新建应用弹层 #ap-mask' },
  { page: 'components.html', trigger: '#btn-new', mask: '#nf-mask', name: 'components.html · 新增组件弹层 #nf-mask' },
  { page: 'app.html?id=hx-zc', trigger: '#act-assemble', mask: '#mask', name: 'app.html · 装配组件面板 #mask' },
];

/* 负控注入：把"藏起来的 focus 调用"改成"focus 到 dialog 里就丢掉"。
   为什么这么造：负控要证明的是**判据会抓到「打开后焦点不在 dialog 内」**这件事本身，
   所以注入点必须是真实打开路径上的那一次 .focus()（openNew/nfOpen/openDlg 里都有一句），
   而不是另写一个"应该红"的分支。用 addScriptToEvaluateOnNewDocument 在导航前装，
   因为三个页面的打开逻辑都在它们自己的 <script> 里，页面加载后才好 override。 */
const NEG_SRC = `(function(){
  if (window.__dfNeg) return; window.__dfNeg = 1;
  var orig = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    try {
      if (this.closest && this.closest('[role="dialog"],[aria-modal="true"]')) return;
    } catch (e) {}
    return orig.apply(this, arguments);
  };
})();`;

/* ── Chrome / CDP 骨架（与 hit-audit.mjs 同形，不引依赖）────────────── */
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/dlgfocus-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) { /* 还没起来 */ }
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来（' + CHROME + '）'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
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
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
if (NEG) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEG_SRC });

/* 装到页面里的三个小工具：稳定标识 / tabbable 清单 / 焦点是否在 dialog 内。
   ⚠ 稳定标识不能只给 tagName —— 同一个 BUTTON 标签在页面里有 30 个，
     报告里写"焦点在 BUTTON"等于没写。id + 前两个 class + 文案片段才认得出是谁。 */
const HELPERS = `(function(){
  window.__dfDesc = function (e) {
    if (!e) return 'null';
    if (e === document.body) return 'BODY（焦点掉到 body）';
    if (e === document.documentElement) return 'HTML';
    var s = String(e.tagName || '').toLowerCase();
    if (e.id) s += '#' + e.id;
    var c = (e.className || '').toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    var t = (e.getAttribute && (e.getAttribute('aria-label') || e.textContent) || '').trim().replace(/\\s+/g, ' ').slice(0, 14);
    if (t) s += ' "' + t + '"';
    return s;
  };
  window.__dfTabbables = function (root) {
    var SEL = 'a[href],button,input,select,textarea,[tabindex]';
    return Array.prototype.filter.call(root.querySelectorAll(SEL), function (n) {
      if (n.getAttribute('tabindex') === '-1') return false;
      if (n.disabled) return false;
      if (n.getAttribute('aria-disabled') === 'true') return false;
      if (n.offsetParent === null) return false;
      return true;
    });
  };
  return 1;
})()`;

/* 真实键盘：rawKeyDown + keyUp。Tab 的默认动作（移动焦点）由渲染进程执行，
   所以这里必须走 Input 域，不能在页面里派发 KeyboardEvent。 */
async function key(type, keyName, vk, modifiers = 0) {
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', { type, ...base });
  if (type === 'rawKeyDown') await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/* 真实鼠标点击：先让按钮拿到 focus（真人按下鼠标时浏览器就是这么做的），再在中心点按下/抬起。 */
async function clickReal(sel) {
  const raw = await ev(`(function(){
    var b = document.querySelector(${JSON.stringify(sel)});
    if (!b) return 'null';
    b.scrollIntoView({ block: 'center', inline: 'center' });
    var r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height });
  })()`);
  if (!raw || raw === 'null') return { ok: false, why: '找不到触发钮 ' + sel };
  const r = JSON.parse(raw);
  if (r.x < 1 || r.y < 1 || r.x > 1439 || r.y > 899) {
    await ev(`(function(){var b=document.querySelector(${JSON.stringify(sel)});b.focus();b.click();return 1;})()`);
    return { ok: true, why: '触发钮不在视口内（' + Math.round(r.x) + ',' + Math.round(r.y) + '），改用 focus+click' };
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return { ok: true, why: '' };
}

let pass = 0; let fail = 0; let envFail = 0;
let firstFailLine = '';
function say(ok, posLabel, negLabel, detail) {
  const line = ok ? `  ✓ PASS ${posLabel}｜实测：${detail}` : `  ✗ FAIL ${negLabel}｜实测：${detail}`;
  console.log(line);
  if (ok) pass++; else { fail++; if (!firstFailLine) firstFailLine = line; }
}

console.log(`模态弹层焦点契约（APG Dialog Pattern）｜基址 ${BASE}${NEG ? '｜负控模式' : ''}\n`);

for (const t of TARGETS) {
  console.log(`=== ${t.name} ===`);
  const nav = await send('Page.navigate', { url: `${BASE}/${t.page}` });
  await SLEEP(1400);

  /* Chrome 的 net 错误页 readyState 也是 complete：只查 readyState 会把错误页当正常页，
     触发钮自然也没有 ⇒ 会被记成"未测"而不是"环境坏了"。所以先看 navigate 的 errorText。 */
  if (nav && nav.errorText) {
    console.log(`  SKIP 页面打不开：${BASE}/${t.page}（${nav.errorText}）`);
    envFail++; continue;
  }
  const ready = await ev(`(function(){
    return JSON.stringify({ state: document.readyState, kids: document.body ? document.body.children.length : 0,
      title: document.title || '', trigger: !!document.querySelector(${JSON.stringify(t.trigger)}) });
  })()`);
  let st = null;
  try { st = JSON.parse(ready); } catch (e) { st = null; }
  if (!st || st.state !== 'complete' || !st.kids) {
    console.log(`  SKIP 页面打不开：${BASE}/${t.page}（readyState=${st && st.state}，body 子节点=${st && st.kids}）`);
    envFail++; continue;
  }
  if (!st.trigger) {
    /* 触发钮没了 ≠ 环境问题：这是"这条判据没被测到"，必须打印，不许静默跳过当成通过。 */
    console.log(`  – 未测：页面上没有触发钮 ${t.trigger}（页面结构变了，判据没有跑）`);
    envFail++; continue;
  }

  await ev(HELPERS);

  /* 打开前：记下"打开前那个元素"。先给它真焦点 —— 鼠标点按钮时浏览器也是先 focus 再 click，
     否则 ④ 会拿 body 当基准，"焦点回到 body"也会被判成通过。 */
  const preDesc = await ev(`(function(){
    var b = document.querySelector(${JSON.stringify(t.trigger)});
    b.focus();
    window.__dfPre = { el: document.activeElement };
    return window.__dfDesc(document.activeElement);
  })()`);

  const clicked = await clickReal(t.trigger);
  if (clicked.why) console.log(`  · ${clicked.why}`);
  await SLEEP(OPEN_WAIT);

  /* ① + ⑤（aria 标注）+ tabbable 个数，一次取回 */
  const opened = await ev(`(function(){
    var mask = document.querySelector(${JSON.stringify(t.mask)});
    if (!mask) return JSON.stringify({ found: false });
    var SEL = '[role="dialog"][aria-modal="true"]';
    var dlg = mask.matches(SEL) ? mask : mask.querySelector(SEL);
    if (!dlg) return JSON.stringify({ found: true, dlg: null });
    window.__dfDlg = dlg;
    var f = window.__dfTabbables(dlg);
    return JSON.stringify({
      found: true, dlg: true,
      open: !!(dlg.offsetParent || getComputedStyle(dlg).position === 'fixed' || dlg.getBoundingClientRect().height > 0),
      active: window.__dfDesc(document.activeElement),
      inDialog: dlg.contains(document.activeElement) && document.activeElement !== dlg,
      n: f.length,
      list: f.map(function (x) { return window.__dfDesc(x); }),
      labelledby: dlg.getAttribute('aria-labelledby') || '',
      label: dlg.getAttribute('aria-label') || ''
    });
  })()`);
  let o = null;
  try { o = JSON.parse(opened); } catch (e) { o = null; }
  if (!o || !o.found || !o.dlg) {
    say(false, '', '指定的模态层不存在（判据少验一层）', `${t.mask} 里没有 [role="dialog"][aria-modal="true"]`);
    console.log('');
    continue;
  }

  say(o.inDialog, '打开后焦点在 dialog 内', '打开后焦点不在 dialog 内',
    `activeElement=${o.active}；dialog 内 tabbable ${o.n} 个${o.n ? '：' + o.list.join(' / ') : ''}`);

  /* ② 连发 n+1 次 Tab：n 个元素走一圈 + 第 n+1 次必须被环绕回第 1 个（不是跑到背景） */
  const storm = [];
  for (let i = 1; i <= o.n + 1; i++) {
    await key('rawKeyDown', 'Tab', 9);
    await SLEEP(90);
    const s = await ev(`(function(){
      var d = window.__dfDlg;
      return JSON.stringify({ inDialog: d.contains(document.activeElement) && document.activeElement !== d,
        active: window.__dfDesc(document.activeElement) });
    })()`);
    let r = null; try { r = JSON.parse(s); } catch (e) { r = null; }
    storm.push(r);
    say(!!(r && r.inDialog), `Tab ${i}/${o.n + 1} 后焦点仍在 dialog 内`,
      `Tab ${i}/${o.n + 1} 后焦点跑到 dialog 外`, r ? `activeElement=${r.active}` : '探针没有返回');
  }
  /* Tab 有没有真的动过：全程 activeElement 一模一样 ⇒ 浏览器的默认动作没被执行，
     那上面的 PASS 全是假的（这是这条判据自己的负控）。 */
  if (o.n > 1 && storm.length > 1) {
    const distinct = new Set(storm.map((s) => (s && s.active) || '?')).size;
    say(distinct > 1, 'Tab 确实产生了焦点移动（默认动作生效）',
      'Tab 没有产生任何焦点移动（CDP 默认动作未生效，上面 Tab 的 PASS 不可信）',
      `${storm.length} 次 Tab 后见到 ${distinct} 个不同的 activeElement`);
  }

  /* ③ 一次 Shift+Tab（modifiers:8 = Shift） */
  await key('rawKeyDown', 'Tab', 9, 8);
  await SLEEP(120);
  const back = await ev(`(function(){
    var d = window.__dfDlg;
    return JSON.stringify({ inDialog: d.contains(document.activeElement) && document.activeElement !== d,
      active: window.__dfDesc(document.activeElement) });
  })()`);
  let b2 = null; try { b2 = JSON.parse(back); } catch (e) { b2 = null; }
  say(!!(b2 && b2.inDialog), 'Shift+Tab 后焦点仍在 dialog 内', 'Shift+Tab 后焦点跑到 dialog 外',
    b2 ? `activeElement=${b2.active}` : '探针没有返回');

  /* ④ + 闭合 + ⑤（inert 残留） */
  await key('rawKeyDown', 'Escape', 27);
  await SLEEP(350);
  const closed = await ev(`(function(){
    var mask = document.querySelector(${JSON.stringify(t.mask)});
    /* 三层的关闭机制不一样（两层切 hidden，装配面板切 data-open + CSS），
       所以只认可观测事实：遮罩还占不占屏幕。 */
    var cs = mask ? getComputedStyle(mask) : null;
    var vis = !!(mask && cs && cs.display !== 'none' && cs.visibility !== 'hidden'
      && mask.getBoundingClientRect().height > 0);
    return JSON.stringify({
      stillShown: vis,
      sameEl: document.activeElement === window.__dfPre.el,
      active: window.__dfDesc(document.activeElement),
      pre: window.__dfDesc(window.__dfPre.el),
      inert: document.querySelectorAll('[inert]').length
    });
  })()`);
  let c = null; try { c = JSON.parse(closed); } catch (e) { c = null; }

  say(!!(c && !c.stillShown), 'Esc 后弹层已关闭', 'Esc 后弹层没有关闭（焦点契约无从验证）',
    c ? (c.stillShown ? '遮罩仍然可见' : '遮罩已隐藏') : '探针没有返回');

  say(!!(c && c.sameEl), 'Esc 后焦点回到打开前的元素', 'Esc 后焦点没有回到打开前的元素',
    c ? `期望回到 ${c.pre}；实测 ${c.active}` : '探针没有返回');

  say(!!(o.labelledby || o.label), 'dialog 有 aria-labelledby 或 aria-label',
    'dialog 缺少 aria-labelledby / aria-label（读屏念不出"这是什么弹窗"）',
    o.labelledby ? `aria-labelledby="${o.labelledby}"` : (o.label ? `aria-label="${o.label}"` : '两个属性都没有'));

  say(!!(c && c.inert === 0), '关闭后页面无 [inert] 残留（背景可再交互）',
    '关闭后仍有 [inert] 残留（背景从此点不动、读屏也读不到）',
    c ? `document.querySelectorAll('[inert]').length = ${c.inert}` : '探针没有返回');

  console.log('');
}

ws.close(); chrome.kill('SIGKILL');

if (NEG) {
  const ok = fail > 0 && /打开后焦点不在 dialog 内/.test(firstFailLine);
  console.log(ok
    ? '负控成立：删掉打开时的 .focus() 之后，第一条失败项正是「打开后焦点不在 dialog 内」'
    : `负控失败：注入后第一条失败项不是「打开后焦点不在 dialog 内」⇒ 这条判据的 ① 是假的\n  首条失败：${firstFailLine || '（无失败项）'}`);
  process.exit(ok ? 2 : 1);
}

console.log(`通过 ${pass} ｜ 断点 ${fail}`);
/* 一项都没测到 ⇒ 这是"未量"，不是"通过"：exit 3，别让"一个弹层都没打开"冒充全绿。 */
if (envFail && !pass && !fail) {
  console.log(`未测 ${envFail} 项（页面/触发钮缺失）⇒ 环境未就绪，判据不成立，rc=3`);
  process.exit(3);
}
if (envFail) console.log(`另有 ${envFail} 项未测（见上）`);
process.exit(fail ? 2 : 0);
