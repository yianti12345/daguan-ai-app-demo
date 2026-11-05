#!/usr/bin/env node
/* check-focus-obscure —— **焦点不被作者浮层遮挡**（WCAG 2.2 SC 2.4.11 Focus Not Obscured）。
 *
 * 为什么要有它：hit-audit.mjs 抓的是"看不见的幽灵层吃掉**点击**"（那次是小智接管条）。
 * 同一类病还有另一半没人管：浮层**看得见、也允许点击**，就压在某个按钮上 ——
 * 鼠标用户还能绕开，键盘用户 Tab 到那个按钮时，焦点环被浮层盖住，屏幕上什么反馈都没有，
 * 他只会以为"按 Tab 没反应"。这类问题点击测试全绿、截图也全绿，因为它只在
 * "先把焦点放到被盖住的那个元素上"之后才发生。
 *
 * 判据：对每页每个 tabbable 元素，focus() 之后在它的矩形里取 9 点
 * （四角内缩 2px + 四边中点 + 中心），逐点 document.elementFromPoint：
 *   命中元素既不是 el、也不是 el 的祖先/后代 ⇒ 这一点被"外部层"挡住。
 *   9 点全被遮 ⇒ 记一条红（焦点环整圈都看不见，等于没有焦点提示）。
 *   部分遮挡 ⇒ 只打印比例，不记红（能看见一部分就还能定位）。
 *
 * tabbable 口径与 APG 一致：a[href],button,input,select,textarea,[tabindex]，
 * 排除 tabindex="-1"、:disabled、aria-disabled="true"、el.offsetParent === null
 * （offsetParent 为 null 的既包括 display:none，也包括 position:fixed —— .xz-fab 自己
 *  就是 fixed，它不该被当成"需要被看见的焦点目标"）。
 *
 * 用法：node tools/check-focus-obscure.mjs            正控
 *      node tools/check-focus-obscure.mjs --negctl   负控：把 .xz-fab 撑成 100vw×60vh 盖住下半屏，必须红
 * 退出码：0 无红 ｜ 2 有红（负控恒 2）｜ 3 Chrome 起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* ── Chrome / CDP 骨架（与 hit-audit.mjs 同形，不引依赖）────────────── */
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/fobscure-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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

/* 探针：扫描 + 9 点遮挡判定，一次往返把结论算好带出来（避免每个元素一次 CDP） */
const PROBE = `(function(){
  var SEL = 'a[href],button,input,select,textarea,[tabindex]';
  function desc(e) {
    if (!e || !e.tagName) return String(e);
    var s = String(e.tagName).toLowerCase();
    if (e.id) s += '#' + e.id;
    var c = (e.className || '').toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    var t = (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 14);
    if (t) s += ' "' + t + '"';
    return s;
  }
  /* 遮挡者要报**作者那个浮层**，不是它的内层装饰节点：
     elementFromPoint 返回的是最内层元素，.xz-fab 命中的是它里面的 <i>，
     报告里写"被 i 遮住"等于没说 —— 人拿着"i"没法去源码里改。
     所以往上找到最近的定位祖先（fixed/absolute），那个才是"作者摆上去的那一层"。 */
  function overlayRoot(e) {
    var cur = e, last = e;
    while (cur && cur !== document.body) {
      var cs = getComputedStyle(cur);
      if (cs.position === 'fixed' || cs.position === 'absolute') return cur;
      last = cur; cur = cur.parentElement;
    }
    return last;
  }
  var list = Array.prototype.filter.call(document.querySelectorAll(SEL), function (n) {
    if (n.getAttribute('tabindex') === '-1') return false;
    if (n.disabled) return false;
    if (n.getAttribute('aria-disabled') === 'true') return false;
    if (n.offsetParent === null) return false;
    return true;
  });
  var red = [], partial = [], scanned = 0, skipped = 0, offscreenPts = 0;
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    if (!el.isConnected) continue;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { skipped++; continue; }
    /* 9 点：四角内缩 2px + 四边中点 + 中心 */
    var pts = [
      [r.x + 2, r.y + 2], [r.x + r.width / 2, r.y + 2], [r.x + r.width - 2, r.y + 2],
      [r.x + 2, r.y + r.height / 2], [r.x + r.width / 2, r.y + r.height / 2], [r.x + r.width - 2, r.y + r.height / 2],
      [r.x + 2, r.y + r.height - 2], [r.x + r.width / 2, r.y + r.height - 2], [r.x + r.width - 2, r.y + r.height - 2]
    ];
    var covered = 0, seen = 0, who = {};
    for (var j = 0; j < pts.length; j++) {
      var x = pts[j][0], y = pts[j][1];
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) { offscreenPts++; continue; }
      var top = document.elementFromPoint(x, y);
      if (!top) { offscreenPts++; continue; }
      seen++;
      if (top === el || el.contains(top) || top.contains(el)) continue;   /* 自己 / 后代 / 祖先 = 没被外部层挡 */
      covered++;
      who[desc(overlayRoot(top))] = 1;
    }
    if (!seen) { skipped++; continue; }
    scanned++;
    var hit = { sel: desc(el), ob: Object.keys(who).join(' , '), pts: covered + '/' + seen,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    if (covered === pts.length) red.push(hit);          /* 9 点全遮 */
    else if (covered > 0) partial.push(hit);
  }
  return JSON.stringify({ total: list.length, scanned: scanned, skipped: skipped,
    offscreenPts: offscreenPts, red: red, partial: partial });
})()`;

/* 每页自己的哨兵元素：页面真加载了才有，错误页/空响应页没有 */
function markerOf(page) {
  if (/^component\.html/.test(page)) return '#fk-input';   /* 先判 component.html，否则会被 app.html 前缀吃掉 */
  if (/^components\.html/.test(page)) return '#nf-mask';
  if (/^apps\.html/.test(page)) return '#grid';
  if (/^app\.html/.test(page)) return '#mask';
  return 'body';
}

console.log(`焦点遮挡检查（WCAG 2.4.11）｜基址 ${BASE}｜${PAGES.length} 页${NEG ? '｜负控模式' : ''}\n`);

let totalTabbable = 0; let totalRed = 0; let envFail = 0;
const redAll = [];   /* 负控要按"被遮元素 + 遮挡者"两类一起判，所以跨页收集 */

for (const page of PAGES) {
  const nav = await send('Page.navigate', { url: `${BASE}/${page}` });
  await SLEEP(1400);

  /* 打不开必须红成"环境未测"，不能扫 0 个就报绿：Chrome 的 net 错误页 readyState 也是 complete，
     只查 readyState 会把错误页当成正常页扫出"0 个全遮"——那是假绿。三条一起查：
     ① Page.navigate 的 errorText ② readyState ③ 该页自己的哨兵元素在不在。 */
  if (nav && nav.errorText) {
    console.log(`  SKIP ${page}：打不开（${nav.errorText}）`);
    envFail++; continue;
  }
  const st = await ev(`JSON.stringify({ state: document.readyState, kids: document.body ? document.body.children.length : 0,
    mark: !!document.querySelector(${JSON.stringify(markerOf(page))}) })`);
  let s = null; try { s = JSON.parse(st); } catch (e) { s = null; }
  if (!s || s.state !== 'complete' || !s.kids || !s.mark) {
    console.log(`  SKIP ${page}：打不开或不是被测页（readyState=${s && s.state}，哨兵 ${markerOf(page)} ${s && s.mark ? '在' : '不在'}）`);
    envFail++; continue;
  }

  if (NEG) {
    /* 负控：不改任何源文件，用被测页面自己的 .xz-fab 造一个"看得见、可点击、但盖住下半屏"的浮层。
       为什么用 .xz-fab 而不是新插一个 div：负控要证明的是"作者自己的浮层盖住焦点"会被抓到，
       而 .xz-fab 正是作者自己的浮层（position:fixed + z-index:70），把它撑大等价于
       "作者把面板做大了 20 倍" —— 不是另写一个"应该红"的分支。 */
    const injected = await ev(`(function(){
      var f = document.querySelector('.xz-fab');
      if (!f) return 0;
      f.style.cssText = 'position:fixed;left:0;top:auto;bottom:0;width:100vw;height:60vh;z-index:9999';
      return 1;
    })()`);
    if (!injected) { console.log(`  – 未测 ${page}：页面上没有 .xz-fab，负控无法注入`); envFail++; continue; }
    await SLEEP(250);
  }

  const raw = await ev(PROBE);
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { d = null; }
  if (!d) { console.log(`  SKIP ${page}：探针没有返回（页面没加载完）`); envFail++; continue; }

  totalTabbable += d.scanned;
  totalRed += d.red.length;
  for (const h of d.red) redAll.push({ page, ...h });

  console.log(`  ${d.red.length ? '✗' : '✓'} ${page}：扫了 ${d.scanned} 个 tabbable · 全遮 ${d.red.length} 个`
    + `（清单 ${d.total} 个，尺寸为 0 跳过 ${d.skipped} 个，视口外采样点 ${d.offscreenPts} 个）`);
  for (const h of d.red.slice(0, 8)) {
    console.log(`      ${h.sel} —— 9 点全被 ${h.ob} 遮住  @[${h.rect.join(',')}]`);
  }
  if (d.red.length > 8) console.log(`      …… 另有 ${d.red.length - 8} 个`);
  if (d.partial.length) {
    console.log(`      （部分遮挡 ${d.partial.length} 个，不记红）`
      + d.partial.slice(0, 5).map((p) => ` ${p.sel} ${p.pts}`).join('；'));
  }
  console.log('');
}

ws.close(); chrome.kill('SIGKILL');

if (NEG) {
  /* 负控的判据不能只看"红了没有"：注入了 60vh 的遮罩，只要有 tabbable 被遮就必然红；
     要证明的是**报告能说出"谁被遮 / 被谁遮"**，所以两条都必须在同一行里出现。 */
  const victim = redAll.find((h) => /\.k-more|\.cl-ops|\.btn-install/.test(h.sel));   /* ★2026-11-04 .kbtn 不存在，卡上动作钮是 .k-more */
  const culprit = victim && /xz-fab/.test(victim.ob);
  if (victim) {
    console.log(`被遮元素：${victim.page}｜${victim.sel}｜遮挡者：${victim.ob}｜${victim.pts} 点被遮`);
  }
  const ok = totalRed > 0 && !!victim && culprit;
  console.log(ok
    ? `负控成立：把 .xz-fab 撑成 100vw×60vh 后判红，且报出「${victim.sel} 被 xz-fab 遮住」`
    : `负控失败：${totalRed ? '红了，但没同时报出「.k-more/.btn-install 被 xz-fab 遮住」' : '注入了 60vh 遮罩仍判绿 ⇒ 这条判据是假的'}`);
  process.exit(ok ? 2 : 1);
}

console.log(`扫了 ${totalTabbable} 个 tabbable · 全遮 ${totalRed} 个`);
/* 有页面没测到 ⇒ 这是"未量"，不是"绿"：exit 3，让接线方按未测处理，不许被扫 0 个冒充通过。 */
if (envFail) {
  console.log(`另有 ${envFail} 页未测（见上）⇒ 环境未就绪，判据不成立，rc=3`);
  process.exit(3);
}
process.exit(totalRed ? 2 : 0);
