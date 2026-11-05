#!/usr/bin/env node
/* check-confirm —— 「不可逆 / 对客户可见的动作，必须先问一句」的判据（2026-10-25）。
 *
 * 为什么要有它：用户点名两条 —— 「停用一键生效无确认」「发布无确认」。
 * 上一轮修完 (C-02/C-03) 之后，这件事**没有任何命令在看**：
 * 下一个人把 Confirm.ask 换回直接执行，页面照样能点、门禁照样绿。
 *
 * 判据（每条都有独立的观察点，不许合并成一条"看起来对"）：
 *   A1 点「停用」后先出确认层，且 DB 状态**还没变**（问了才做）
 *   A2 确认层是 alertdialog、有 aria-labelledby；A2b 标题=「操作确认」、正文写清对象与后果；A2c 按钮=取消/确定，确定是蓝色主按钮
 *   A3 破坏性动作的默认焦点在「取消」上（手快敲回车不该把应用停掉）
 *   A4 打开后背景有 inert（键盘与读屏都离不开这一层）
 *   A5 连按 Tab 不逃逸（焦点环绕在确认层内）
 *   A6 点「取消」→ 状态不变、不开倒车、inert 清干净
 *   A7 再点「停用」并确认 → 状态真的变成已下架（不是只弹了个框）
 *   B1 草稿应用的 ⋮ 里**没有**「启用」（草稿上线只有发布一条路）
 *   B1b 草稿卡的菜单**有**「版本管理」且**没有**「复制链接」（2026-10-28 修：原来这行只断言 vers，
 *       行文却写成"仍有版本管理与复制链接"——复制链接已按用户口径删除，绿名在替不存在的断言背书）
 *   C1 app.html 发布也要先问一句，且问句里写清是哪一版
 *   C2 确认后版本号真的 +1
 *   D1 component.html 发布同样要问，且版本没动就还没生效
 *   D2 确认后组件版本 +1（发布不是只弹个框）
 *
 * 负控 --negctl：把 Confirm.ask 换成"直接执行"，A1 必须红。
 *   —— 只证明"框弹出来了"是不够的：真问题是**没问就做了**，负控要打在这一步上。
 * 负控 --negctl-copy：往草稿卡菜单注入「复制链接」，B1b 必须红（2026-10-28 加）。
 *
 * 用法：node tools/check-confirm.mjs           正控
 *      node tools/check-confirm.mjs --negctl  负控（必须 rc=2）
 *      node tools/check-confirm.mjs --negctl-copy  只打 B1b 的负控（必须 rc=2）
 * 退出码：0 全过 ｜ 2 有 FAIL（负控档：负控成立）｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');
/* 只打 B1b 的负控（2026-10-28 加，盲审条件 3）：给草稿卡菜单注入「复制链接」，B1b 必须红。
   与 --negctl 分开：--negctl 打的是"没问就做了"（A1），两支证明的是不同断言。 */
const NEG_COPY = process.argv.includes('--negctl-copy');

let pass = 0, fail = 0;
/* B1b 单独记一个读数：--negctl-copy 档要能分清「负控成立」与「断言根本没红」。 */
let b1bCaught = false;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (note ? '｜实测：' + note : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (note ? '｜实测：' + note : '')); }
}

/* 负控注入：Confirm.ask 不再问，直接跑 onOk —— 模拟"有人把二次确认删了"。 */
const NEG_SRC = `(function(){
  if (window.__cfNeg) return; window.__cfNeg = 1;
  Object.defineProperty(window, 'Confirm', {
    configurable: true,
    set: function (v) {
      window.__ConfirmReal = v;
      Object.defineProperty(window, 'Confirm', {
        configurable: true,
        value: { ask: function (o) { if (o && o.onOk) o.onOk(); }, inertBg: function () {} }
      });
    },
    get: function () { return window.__ConfirmReal; }
  });
})();`;

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/confirm-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};
const goto = async (url) => {
  await send('Page.navigate', { url });
  await SLEEP(650);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
if (NEG) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEG_SRC });

/* 真实鼠标：先 scrollIntoView，再在**能真命中这个元素**的点上按下/抬起。
 *
 * 为什么不能直接 getBoundingClientRect 取中心就点：实测这一页里
 * 「菜单项自己的中心」和「elementFromPoint 在该点看到的元素」会差开几十像素，
 * 于是一次"点停用"落在旁边的"复制链接"上 —— 判据看起来在测确认框，
 * 其实连正确的按钮都没点到。所以这里做三件事：
 *   ① 在元素矩形里试几个候选点（中心 / 上下 1/4 / 左右 1/4 / 上下一成）；
 *   ② 每个点先问 elementFromPoint 命中谁，命中这个元素（或它的子节点）才点；
 *   ③ 一个点都命中不到 ⇒ 说明它真的被别的元素盖住了，报错而不是硬点。
 */
async function clickReal(sel) {
  const res = await ev(`(function(){
    var b = document.querySelector(${JSON.stringify(sel)});
    if (!b) return { ok:false, why:'找不到 ' + ${JSON.stringify(sel)} };
    b.scrollIntoView({ block:'center', inline:'nearest' });
    var r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { ok:false, why:'元素没有尺寸（display:none？）' };
    var c = [[0.5,0.5],[0.5,0.25],[0.5,0.75],[0.25,0.5],[0.75,0.5],[0.5,0.1],[0.5,0.9]];
    for (var i = 0; i < c.length; i++) {
      var x = r.left + r.width * c[i][0], y = r.top + r.height * c[i][1];
      if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
      var at = document.elementFromPoint(x, y);
      if (at && (at === b || b.contains(at))) return { ok:true, x:x, y:y };
    }
    var mid = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    var chain = [], n = mid;
    while (n && chain.length < 6) { chain.push(n.tagName + (n.getAttribute && n.getAttribute('class') ? '.' + String(n.getAttribute('class')).split(' ')[0] : '')); n = n.parentNode; }
    return { ok:false, why:'没有可命中的点。rect=' + JSON.stringify([Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]) +
      '，中心最上层=' + chain.join(' < ') + '，元素自身=' + b.tagName + '.' + (b.getAttribute('class')||'') + '，menuHidden=' + (b.closest('.k-menu') ? b.closest('.k-menu').hidden : 'n/a') };
  })()`);
  /* ★不抛错，只返回 false：负控下"确认层根本不存在"是**预期**的，
     抛错会让脚本以 rc=1 崩掉，而负控要求的是把失败项打印出来并 rc=2。 */
  if (!res || !res.ok) { console.log('    · 点不到 ' + sel + '：' + (res && res.why)); return false; }
  /* 三段之间留几毫秒：三帧连着发时，headless 里那次 click 有时不落地
     （实测同一坐标"连发"打开不了菜单、中间隔 30ms 就正常）——
     这是采样的时序问题，不是页面的问题，所以修在采样的地方。 */
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: res.x, y: res.y, button: 'none', clickCount: 0 });
  await SLEEP(40);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: res.x, y: res.y, button: 'left', clickCount: 1 });
  await SLEEP(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: res.x, y: res.y, button: 'left', clickCount: 1 });
  await SLEEP(180);
  return true;
}
async function key(type, keyName, vk) {
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', { type, ...base });
  if (type === 'rawKeyDown') await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/* JS 激活：用于**菜单项**这类元素。为什么要单独一个入口 ——
 * 它们的目标是"让 menuAct 跑起来"，而不是"验证它们没被遮住"；
 * 遮挡这件事由 A4/A5（inert + Tab 环绕）和 E1（确认层按钮能否真命中）单独盯。
 * 坐标点击在这里不稳（同一坐标连发三帧有时不落地、滚动后位置又会变），
 * 那不是页面的问题，不该让它把判据弄成时而红时而绿。 */
async function clickEl(sel) {
  const okv = await ev(`(function(){
    var b = document.querySelector(${JSON.stringify(sel)});
    if (!b) return false;
    b.focus();
    b.click();
    return true;
  })()`);
  if (!okv) { console.log('    · 找不到 ' + sel); return false; }
  await SLEEP(150);
  return true;
}

const statusOf = (aid) => ev(`(DB.appById(${JSON.stringify(aid)}).status)`);
const confirmState = () => ev(`(function(){
  var m = document.querySelector('.nf-mask[role], .nf-mask');
  var all = Array.prototype.slice.call(document.querySelectorAll('.nf-mask'));
  var open = all.filter(function(x){ return !x.hidden && x.querySelector('.nf-confirm'); })[0];
  /* ★inert 数一定要在"没开"的分支里也返回：A6 要验的就是"关掉之后残留 0 个"，
     早退把它写成 undefined，判据就会拿 undefined 当失败 —— 那是判据的 bug，不是页面的。 */
  if (!open) return { open:false, inertCount: document.querySelectorAll('[inert]').length };
  var dlg = open.querySelector('[role]');
  var a = document.activeElement;
  return {
    open: true,
    role: dlg ? dlg.getAttribute('role') : null,
    labelledby: dlg ? dlg.getAttribute('aria-labelledby') : null,
    title: (open.querySelector('#cf-title')||{}).textContent || '',
    body: (open.querySelector('#cf-body')||{}).textContent || '',
    okText: (open.querySelector('[data-cf="ok"]')||{}).textContent || '',
    okClass: (open.querySelector('[data-cf="ok"]')||{}).className || '',
    focusCf: a ? (a.getAttribute('data-cf') || '') : '',
    focusText: a ? ((a.textContent || '') + '').trim() : '',
    focusIn: open.contains(a),
    /* 确认层的两个按钮必须**真能点中**（没有被别的层盖住）。 */
    okHit: (function(){
      var b = open.querySelector('[data-cf="ok"]'); if (!b) return false;
      var r = b.getBoundingClientRect(); var at = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return !!(at && (at === b || b.contains(at)));
    })(),
    noHit: (function(){
      var b = open.querySelector('[data-cf="no"]'); if (!b) return false;
      var r = b.getBoundingClientRect(); var at = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return !!(at && (at === b || b.contains(at)));
    })(),
    inertCount: document.querySelectorAll('[inert]').length
  };
})()`);

/* ══════════ A. apps.html · 停用二次确认 ══════════ */
console.log('\n=== apps.html · 停用「华信证券 · 债承审核」 ===');
await goto(BASE + '/apps.html');
await ev(`localStorage.clear(); 1`); await goto(BASE + '/apps.html');

const before = await statusOf('hx-zc');
ok('A0 前置：hx-zc 已是上架状态', before === '已上架', before);

/* ★2026-11-04 判据过期：2026-11-03 三态动作后，「停用/下架」不再是 ⋮ 里的菜单项，
   而是卡底栏的电源钮 `.k-pub`（apps.html:725 的 aria-label「状态操作：<名字>，当前<三态>」）。
   原来点 .k-more 再点 [data-act=toggle] 的路径现在点不到任何东西 ⇒ 确认层=false 的假红。 */
await clickReal('.kcard[data-id="hx-zc"] .k-pub');      /* 电源钮开的是「状态菜单」，不是直接弹确认框 */
await SLEEP(220);
await clickReal('.kcard[data-id="hx-zc"] .js-k-menu-status [data-act="off"]');   /* 已上架 → 下架 */
const s1 = await confirmState();
const mid = await statusOf('hx-zc');

ok('A1 点「停用」先出确认层，且状态还没变', s1.open === true && mid === '已上架',
   '确认层=' + s1.open + '，DB.status=' + mid);
ok('A2 确认层是 alertdialog 且有 aria-labelledby', s1.role === 'alertdialog' && !!s1.labelledby,
   'role=' + s1.role + '，labelledby=' + s1.labelledby);
/* 2026-11-02 裁决：用户给出平台标准件（取消授权）——标题统一「操作确认」，
   对象与后果写进正文。原断言要求标题里带应用名，与平台口径冲突，改判。 */
ok('A2b 标题按平台口径「操作确认」，正文写清对象与后果',
   s1.title === '操作确认' && /(该应用|华信证券|这 \d+ 个应用)/.test(s1.body || '') && /是否确认/.test(s1.body || ''),
   '标题=' + s1.title + '，正文=' + (s1.body || '').slice(0, 50));
ok('A2c 按钮是「取消 / 确定」，确定用蓝色主按钮',
   s1.okText === '确定' && /(^|\s)primary(\s|$)/.test(s1.okClass || ''),
   '确定钮=' + s1.okText + ' class=' + s1.okClass);
ok('A3 破坏性动作默认焦点在「取消」', s1.focusCf === 'no' && s1.focusIn, '焦点=' + s1.focusText + '（data-cf=' + s1.focusCf + '）');
ok('A4 打开后背景被 inert 掉', s1.inertCount > 0, '[inert] 元素 ' + s1.inertCount + ' 个');
ok('A4b 确认层的两个按钮都真能点中（没被别的层盖住）', s1.okHit === true && s1.noHit === true,
   '确认钮可点=' + s1.okHit + '，取消钮可点=' + s1.noHit);

for (let i = 0; i < 4; i++) { await key('rawKeyDown', 'Tab', 9); }
const s2 = await confirmState();
ok('A5 连按 4 次 Tab 后焦点仍在确认层内', s2.focusIn === true, '焦点=' + s2.focusText + '，在层内=' + s2.focusIn);

const clickNo = await clickReal('.nf-confirm [data-cf="no"]');
await SLEEP(150);
const s3 = await confirmState();
const afterCancel = await statusOf('hx-zc');
ok('A6 点「取消」状态不变、层关掉、inert 清干净',
   clickNo && !s3.open && afterCancel === '已上架' && s3.inertCount === 0,
   '层开=' + s3.open + '，DB.status=' + afterCancel + '，[inert]=' + s3.inertCount);

/* 再来一次，这次真确认 */
await clickReal('.kcard[data-id="hx-zc"] .k-pub');
await SLEEP(220);
await clickReal('.kcard[data-id="hx-zc"] .js-k-menu-status [data-act="off"]');
const s4 = await confirmState();
if (!s4.open) { console.log('  ✗ FAIL A7 第二次没弹出确认层，后续无法验证'); fail++; }
else {
  const clickOk = await clickReal('.nf-confirm [data-cf="ok"]');
  await SLEEP(250);
  const afterOk = await statusOf('hx-zc');
  const s5 = await confirmState();
  /* ★2026-11-04：三态口径下架一律落「未上架」（apps.html:309-315 的两个入口都写 a.status='未上架'）。 */
ok('A7 确认后状态真的变成未上架', clickOk && afterOk === '未上架' && !s5.open,
     'DB.status=' + afterOk + '，层开=' + s5.open);
}

/* ══════════ B. 草稿卡不出「启用」 ══════════ */
console.log('\n=== apps.html · 草稿应用的 ⋮ ===');
await goto(BASE + '/apps.html');
await clickReal('.kcard[data-id="gf-xm"] .k-more');
/* 负控（2026-10-28 加，盲审条件 3）：往草稿卡菜单里塞一个「复制链接」项。
   原来 B1b 的行文写着「仍有版本管理与复制链接」，断言却只查 vers —— 这一档就是为了
   证明「复制链接真的不在了」这句话是能被机器打红的，而不是靠行文自我担保。 */
if (NEG_COPY) await ev(`(function(){
  var m = document.querySelector('.kcard[data-id="gf-xm"] .k-menu');
  if (!m) throw new Error('没有菜单可注入');
  var b = document.createElement('button');
  b.className = 'k-menu-i'; b.setAttribute('data-act', 'copy'); b.textContent = '复制链接';
  m.appendChild(b); return true;
})()`);
const draftMenu = await ev(`(function(){
  var c = document.querySelector('.kcard[data-id="gf-xm"]');
  var items = Array.prototype.slice.call(c.querySelectorAll('.k-menu [data-act]'));
  return { acts: items.map(function(b){ return b.getAttribute('data-act'); }),
           text: items.map(function(b){ return (b.textContent||'').trim(); }).join('|') };
})()`);
ok('B1 草稿应用的 ⋮ 里没有 toggle（上线只有发布一条路）',
   draftMenu.acts.indexOf('toggle') < 0, '菜单项=' + draftMenu.acts.join(','));
/* ★2026-10-28 修（盲审条件 3）：原来这行叫「草稿卡仍有版本管理与复制链接」，实际只断言 vers；
   而「复制链接」已按用户口径从产品里删掉（没有"把客户链接发出去"这一步），
   于是行文一直在替一条不存在的断言背书 —— 绿名高估，比红更坏。
   现在两种都断言：①版本管理那一项在；②复制链接这一类动作/字样不在（data-act 或可见文案）。 */
const copyActs = draftMenu.acts.filter(function(a){ return /copy|share|link|url/i.test(a); });
const copyText = /复制(客户)?链接|复制分享/.test(String(draftMenu.text || ''));
/* ★2026-11-04 判据过期：菜单项的 data-act 是 `ver`（apps.html 的 ⋮ 项），台账里写的是 `vers`。
   两个都认，免得改一次动作名判据就瞎。 */
const b1bOk = draftMenu.acts.some(function(a){ return a === 'vers' || a === 'ver'; }) && copyActs.length === 0 && !copyText;
b1bCaught = !b1bOk;
ok('B1b 草稿卡菜单有「版本管理」、且没有「复制链接」',
   b1bOk,
   '菜单项=' + draftMenu.acts.join(',') + '，文案=' + draftMenu.text + '，复制类动作 ' + copyActs.length + ' 个，含「复制链接」字样=' + (copyText ? '是' : '否'));

/* ══════════ C. app.html · 发布二次确认 ══════════ */
console.log('\n=== app.html · 发布 v4 ===');
await goto(BASE + '/app.html?id=hx-zc');
const v0 = await ev(`DB.appVer('hx-zc')`);
/* 2026-10-27：版本号的口径是"台账最大号 + 1"，不是"当前线上 + 1"。
   已下架的 owner 没有 active（appVer=0），但台账里可能有 v1..v3 —— 拿 appVer 当基准会把
   正确行为判成"没 +1"（本轮实测 v0→v4 被判红）。所以基准改取 versOf 的最大号。 */
const vTop = await ev(`(function(){var l=DB.versOf('app','hx-zc').filter(function(r){return r.kind==='stable';});return l.length?l[0].v:0;})()`);
await clickReal('#act-publish');
const c1 = await confirmState();
const v1 = await ev(`DB.appVer('hx-zc')`);
ok('C1 点「发布」先出确认层，且问句里写清是哪一版',
   c1.open === true && /v\d+/.test(c1.title) && v1 === v0,
   '标题=' + c1.title + '，版本 v' + v0 + '→v' + v1);
/* ★2026-11-02 改判（00e 拆开"存一版"与"让客户看到"）：存成新版本**不会**顺手把客户换到这一版，
   所以这里反过来断言：必须说明客户仍停在原版本（或这一版还没给客户），且不许出现"客户会立刻看到"。
   旧断言要求的正是那句被拆掉的错误承诺 —— 它会逼着实现把模型改回错的。 */
/* ★2026-11-04 判据过期：2026-11-03 用户 m05120 把口径改成「保存并发布＝留成新版本**并设为客户可见**」，
   2026-11-02 那版「不会顺手换掉客户」的断言随之作废。现在只要求：问句必须**写明对客户的影响**（哪种模型都行），
   不许含混。 */
ok('C1b 问句写明这一版对客户的影响',
  /客户/.test(String(c1.body || '')) && /(设为客户可见|客户会立刻看到|仍是|不会给客户看到)/.test(String(c1.body || '')),
  String(c1.body || '(没有确认层)').slice(0, 60));
if (c1.open) {
  const cOk2 = await clickReal('.nf-confirm [data-cf="ok"]');
  await SLEEP(300);
  /* ★2026-11-02 改判：存一版不改"当前启用版本"（versSave 的 active 固定 false）。
     所以看台账最大号有没有 +1，而不是看 appVer —— 后者在已下架的应用上恒为 0。 */
  const v2 = await ev(`(function(){var l=DB.versOf('app','hx-zc').filter(function(r){return r.kind==='stable';});return l.length?Math.max.apply(null,l.map(function(r){return r.v;})):0;})()`);
  ok('C2 确认后台账最大版本号真的 +1', cOk2 && v2 === vTop + 1, '台账最大 v' + vTop + ' → v' + v2 + '（当前启用仍 v' + v0 + '）');
} else { console.log('  ✗ FAIL C2 没有确认层，无法验证版本'); fail++; }

/* ══════════ D. component.html · 组件发布二次确认 ══════════ */
console.log('\n=== component.html · 发布组件 ===');
/* ★2026-11-04 夹具：生产数据 8 个组件全都没有 spec（editunit 也量到 0/8），没有 spec 时
   组件页是空态，「保存并发布版本」只提示「还没有可以保存的内容」⇒ D1 永远测不到确认层。
   这里现场给 task-list 注入一份最小 spec，只写本次临时 profile 的 localStorage。 */
await goto(BASE + '/components.html');
await ev(`(function(){ var c = DB.compById('task-list');
  if (!c.spec) { c.spec = { title: c.name, blocks: [{ type: 'table', cols: ['任务','复核人','复核意见'], rows: [['—','—','—']] }] }; DB.save(); }
  return !!c.spec; })()`);
await goto(BASE + '/component.html?id=task-list');
const cv0 = await ev(`(function(){var c=DB.compById('task-list');return c?c.ver:'?'})()`);
const users = await ev(`(function(){
  return DB.APPS.filter(function(a){ return (a.comps||[]).indexOf('task-list')>=0; }).length;
})()`);
const dOk = await clickReal('#act-publish');
const d1 = await confirmState();
const cv1 = await ev(`(function(){var c=DB.compById('task-list');return c?c.ver:'?'})()`);
ok('D1 点「发布」先出确认层，且版本还没动',
   dOk && d1.open === true && cv1 === cv0, '确认层=' + d1.open + '，ver=' + cv0 + '→' + cv1);
ok('D1b 问句里写明会影响几个应用（有引用时才写）',
   users === 0 ? !/个应用会跟着换/.test(String(d1.body||'')) : /个应用会跟着换/.test(String(d1.body||'')),
   '装它的应用 ' + users + ' 个，正文=' + String(d1.body||'').slice(0, 44));
if (d1.open) {
  const dClick = await clickReal('.nf-confirm [data-cf="ok"]');
  await SLEEP(300);
  const cv2 = await ev(`(function(){var c=DB.compById('task-list');return c?c.ver:'?'})()`);
  ok('D2 确认后组件版本真的 +1', dClick && cv2 !== cv0, 'v ' + cv0 + ' → ' + cv2);
} else { console.log('  ✗ FAIL D2 没有确认层，无法验证版本'); fail++; }

console.log('\n通过 ' + pass + ' ｜ 断点 ' + fail);
ws.close(); chrome.kill();
if (NEG_COPY) {
  console.log(b1bCaught
    ? '负控成立（rc=2）：往草稿卡菜单注入「复制链接」后 B1b 判红'
    : '负控失败（rc=1）：注入了「复制链接」而 B1b 仍绿 —— 这条断言是空的');
  process.exit(b1bCaught ? 2 : 1);
}
process.exit(fail ? 2 : 0);
