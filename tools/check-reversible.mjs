#!/usr/bin/env node
/* check-reversible —— **反向路径判据**：每个"改得动"的状态，必须能改回去。
 *
 * 为什么有它：我的交互判据从前只走**正方向** —— 停用、禁用、切版本，每次都验"能不能做到"，
 * 从来不验"做错了能不能退回来"。而用户实际卡住的地方全在反方向：
 *   「停用没有回头路」「装配不能卸下」「禁用的组件不能再启用」「版本不能切换」。
 * 这些不是我没想到的功能，是我**没走过那条路**。
 *
 * 判什么（三条，全程真点击，不看代码里有没有写 handler）：
 *   R1 应用：停用 → 卡片菜单里必须出现「启用」→ 点回去 → 状态回到已上架
 *   R2 组件：开关点一下变禁用 → 再点一下变启用（开关本身可逆，不是单向阀）
 *   R3 版本：启用旧版 → 原来那版变成「未启用」且出现「启用此版本」（能切回来）
 *
 * 为什么不用真实鼠标：这里验的是**状态机能不能闭环**，不是命中区（命中区有 hit-audit / walk 在管）。
 * 用 click() 反而稳定 —— 真实鼠标在 headless 里三帧连发有时不落地（踩过）。
 *
 * 数据污染：每条都用独立的 --user-data-dir，localStorage 跟着隔离，跑完不留下痕迹。
 *
 * 用法：node tools/check-reversible.mjs [baseUrl] [--negctl]
 * 退出码：0 三条都能回头 ｜ 2 有断点（负控恒 2）｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '｜' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + (note ? '｜' + note : '')); }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/rev-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
  }
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
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200) };
  return r.result?.value;
};
const go = async (url, ms = 1400) => { await send('Page.navigate', { url: BASE + url }); await SLEEP(ms); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

/* 负控：把"启用"这条路拆掉 —— 停用后菜单不再提供 toggle 项。
   证明的是"回头路没了会被抓到"，不是"框弹出来了"。 */
if (NEG) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    var patch = function(){
      var down = false;
      try { var a = DB.appById('hx-zc'); down = !!a && a.status === '已下架'; } catch (e) {}
      if (down) {
        document.querySelectorAll('.kcard .k-pub[data-act="toggle"]').forEach(function(p){ p.disabled = true; });
        document.querySelectorAll('.k-menu [data-act="toggle"]').forEach(function(b){ b.remove(); });
      }
    };
    /* 每次重渲染后都要重新拆：只改一次 DOM 会被列表重绘冲掉 */
    setInterval(patch, 50);
  })();` });
}

console.log(`反向路径判据｜基址 ${BASE}${NEG ? '｜负控（拆掉回头路）' : ''}\n`);

/* ══════════ R1 应用：停用 → 能不能启用回去 ══════════ */
await go('/apps.html', 1700);
const a0 = await ev(`(function(){
  var c = document.querySelector('.kcard[data-id="hx-zc"]');
  return c ? { id: c.getAttribute('data-id'), st: (DB.appById(c.getAttribute('data-id'))||{}).status } : null;
})()`);

if (!a0 || !a0.id) {
  ok('R1 应用停用后能启用回来', false, '页面上没找到应用卡');
} else {
  /* ① 停用（走完整路径：菜单项 → 确认框 → 确认） */
  /* ★2026-11-04：底栏电源钮现在是「状态菜单」（未上架/内测中/已上架），
     不再是 [data-act="toggle"] 一键开关；下架是菜单里的 [data-act="off"]。
     旧断言按 toggle 找，点了个不存在的项，于是产品没动、判据红 —— 红的是断言。 */
  await ev(`(function(){ var c=document.querySelector('.kcard[data-id="hx-zc"]');
    c.querySelector('.k-pub').click(); var t=c.querySelector('.js-k-menu-status [data-act="off"]'); if(t) t.click(); return 1; })()`);
  await SLEEP(300);
  const needConfirm = await ev(`!!document.querySelector('.nf-confirm')`);
  if (needConfirm) await ev(`(function(){var b=document.querySelector('.nf-confirm [data-cf="ok"]'); if(b)b.click(); return 1})()`);
  await SLEEP(400);
  const stOff = await ev(`(DB.appById(${JSON.stringify(a0.id)})||{}).status`);

  /* ② 回头路：菜单里还有没有 toggle，文案是不是「启用」 */
  const back = await ev(`(function(){
    var c = document.querySelector('.kcard[data-id="hx-zc"]');
    if (!c) return { noCard: true };
    c.querySelector('.k-pub').click();
    var t = c.querySelector('.js-k-menu-status [data-act="live"]');
    return { has: !!t, text: t ? (t.textContent||'').trim() : '', act: t ? t.getAttribute('data-act') : '', via: 'status-menu' };
  })()`);
  await SLEEP(200);

  /* ③ 点回去 */
  await ev(`(function(){ var c=document.querySelector('.kcard[data-id="hx-zc"]');
    var t=c&&c.querySelector('.js-k-menu-status [data-act="live"]'); if(t)t.click(); return 1; })()`);
  await SLEEP(250);
  await ev(`(function(){var b=document.querySelector('.nf-confirm [data-cf="ok"]'); if(b)b.click(); return 1})()`);
  await SLEEP(400);
  const stBack = await ev(`(DB.appById(${JSON.stringify(a0.id)})||{}).status`);

  ok('R1a 下架真的生效（真源三态：落未上架）', stOff === '未上架', `${a0.st} → ${stOff}（${needConfirm ? '有确认框' : '无确认框'}）`);
  /* ★2026-10-27 修（断言用过期的词）：这条原来断言反向动作叫「启用」。
     而应用侧的状态词是「已上架/已下架」，动作必须与状态同轴 ——「下架」的反向是「上架」，
     不是「启用」（「启用/禁用」是组件侧那一套，两个对象两个事实，术语台账里分开登记的）。
     本轮把 apps.html 的动作词统一成上架/下架之后，这里就判红了 —— 红的是断言，不是产品。
     判据要问的是「有没有一个反向动作」，所以按状态词根取（上架|启用），不写死一个词。 */
  ok('R1b 下架后有反向动作（上架正式版）', back.has === true && /上架|启用/.test(back.text || ''), back.has ? `文案「${back.text}」·载体 ${back.via}` : '状态菜单没有上架项 —— 下架是单向阀');
  ok('R1c 点反向动作真的回到已上架', stBack === '已上架', `→ ${stBack}`);
}

/* ══════════ R2 组件：开关点了能不能点回来 ══════════ */
await go('/components.html', 1700);
const c0 = await ev(`(function(){
  var b = document.querySelector('.crow .cc-sw');
  if (!b) return null;
  return { checked: b.getAttribute('aria-checked'), text: (b.textContent||'').trim() };
})()`);
if (!c0) {
  ok('R2 组件开关可逆', false, '页面上没有 .cc-sw');
} else {
  await ev(`(function(){var b=document.querySelector('.crow .cc-sw'); b.click(); return 1})()`);
  await SLEEP(400);
  const c1 = await ev(`(function(){var b=document.querySelector('.crow .cc-sw'); return {checked:b.getAttribute('aria-checked'), text:(b.textContent||'').trim()}})()`);
  await ev(`(function(){var b=document.querySelector('.crow .cc-sw'); b.click(); return 1})()`);
  await SLEEP(400);
  const c2 = await ev(`(function(){var b=document.querySelector('.crow .cc-sw'); return {checked:b.getAttribute('aria-checked'), text:(b.textContent||'').trim()}})()`);
  const flipped = c1 && c1.checked !== c0.checked;
  const restored = c2 && c2.checked === c0.checked;
  ok('R2 组件开关点两次回到原状', flipped && restored,
    `${c0.checked}(${c0.text}) → ${c1 && c1.checked}(${c1 && c1.text}) → ${c2 && c2.checked}(${c2 && c2.text})`);
}

/* ══════════ R3 版本：切过去还能切回来 ══════════ */
await go('/versions.html?scope=app&id=hx-zc', 1600);
/* 造两个正式版，才谈得上"切换"。
   ★2026-10-27：单一工作区模型里没有"草稿"这个中间态（versMakeDraft 已删），
   所以直接连着 versPublish 两次 —— 版本号由台账自己 +1，判据不替它算号。 */
await ev(`(function(){
  var a = DB.appById('hx-zc');
  for (var i = 0; i < 2; i++) {
    DB.versPublish('app','hx-zc', {
      comps:(a.comps||[]).slice(), name:a.name, desc:a.desc, client:a.client,
      content: DB.resolveContent('hx-zc')
    }, null);
  }
  return DB.versOf('app','hx-zc').length;
})()`);
await go('/versions.html?scope=app&id=hx-zc', 1600);

const v0 = await ev(`(function(){
  var rows = [].map.call(document.querySelectorAll('.vl-row'), function(r){
    return { v: r.getAttribute('data-ver'), kind: r.getAttribute('data-kind'),
             act: !!r.querySelector('[data-a="act"]') };
  });
  var on = DB.versOf('app','hx-zc').filter(function(r){ return r.active; });
  return { rows: rows, active: on.length ? on[0].v : null };
})()`);

/* 找一个"未启用"的正式版，点启用 */
const target = (v0.rows || []).filter((r) => r.kind === 'stable' && r.act).map((r) => r.v)[0];
if (!target) {
  ok('R3 版本能切过去再切回来', false, '没有可启用的版本行（多版本时每行都该有 act 按钮）');
} else {
  await ev(`(function(){ var r=document.querySelector('.vl-row[data-ver="${target}"]');
    var b=r&&r.querySelector('[data-a="act"]'); if(b)b.click(); return 1; })()`);
  await SLEEP(300);
  await ev(`(function(){ var b=document.querySelector('[data-cf="ok"]'); if(b)b.click(); return 1; })()`);
  await SLEEP(500);
  const after = await ev(`(function(){
    var on = DB.versOf('app','hx-zc').filter(function(r){ return r.active; });
    var rows = [].map.call(document.querySelectorAll('.vl-row'), function(r){
      return { v: r.getAttribute('data-ver'), act: !!r.querySelector('[data-a="act"]') };
    });
    return { active: on.length ? on[0].v : null, n: on.length, rows: rows };
  })()`);
  /* 前向恢复：点历史版本会生成新版本，不是把指针拨回去。
     原来那版仍在历史里、仍有「恢复」，所以永远回得去。 */
  const prev = v0.active;
  const maxBefore = Math.max.apply(null, (v0.rows || []).map((r) => Number(r.v)));
  const canGoBack = (after.rows || []).some((r) => String(r.v) === String(prev) && r.act);
  /* ★必须 String() 比：target 来自 DOM 属性（字符串 '5'），after.active 来自 DB（数字 5）。
     不转类型的话 `'5' === 5` 恒假，判据会把已经通的路径判红。
     这是"判据拿自己的类型当标准"的又一个小号版本（今天第七次同类）。 */
  ok('R3 恢复历史版本会生成新版本，原版本仍可再恢复',
    after.active === maxBefore + 1 && after.n === 1 && canGoBack,
    `原 active v${prev} → 现 v${after.active}（应为 v${maxBefore + 1}，active 共 ${after.n} 条）；v${prev} 行有「恢复」=${canGoBack}`);
}

if (errs.length) console.log('\n  页面异常：' + errs.slice(0, 2).join(' ;; '));
console.log(`\n通过 ${pass} ｜ 断点 ${fail}`);

if (NEG) {
  console.log(fail > 0 ? '负控：拆掉回头路后判红 ✓（rc=2）' : '负控失败：拆了回头路仍然全绿 —— 这条判据是空的 ✗');
  process.exit(2);
}
process.exit(fail > 0 ? 2 : 0);
