#!/usr/bin/env node
/* hit-audit —— **抓"看不见、但会吃点击"的浮层。**
 *
 * 为什么要有它（2026-10-22，诺亚从"指示层收尾"里挖出来的真 bug）：
 *   小智的接管条 `.xz-opfoot` 用 opacity:0 藏起来，但 CSS 里是 `pointer-events:auto` + `z-index:75`，
 *   而且它常驻 DOM（只切 class）。于是跑完一次任务之后：
 *       接管条矩形 [601,749,239,46]（看不见）
 *       底部输入台中心 (692,761) 正好在矩形里
 *       document.elementFromPoint(692,761) → .xz-optext，不是 TEXTAREA
 *   用户的感受是"用完一次小智，底部输入框点不动了"，看着像页面坏了。
 *   e2e 抓不到（它点完就截图/读数，不在同一坐标再点一次）；
 *   walk.mjs 也抓不到（它判的是"点了有没有反应"，不是"点得到不到"）。
 *
 * 判据：**任何不可见元素，都不许盖住任何一个可交互元素的可点击点。**
 *   "不可见"的口径要照实际实现来 —— 这三个指示层只有 opacity 一种隐藏机制
 *   （display 永远 block/flex、rect 永远非零），所以只能看 opacity + class，
 *   用 display / visibility / rect 全部会假绿。
 *
 * 用法：node tools/hit-audit.mjs [--negctl]
 * 退出码：0 没有拦截 ｜ 2 有拦截 ｜ 3 环境问题
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/hit-${Date.now()}`,
  '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) { /* 还没起来 */ }
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
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

/* 在页面里跑的探针：找出"不可见但可能吃点击"的元素，再看它们是否压住可交互元素 */
const PROBE = `(function(){
  var N = 0.02;
  var vis = function (e) {
    var s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    return parseFloat(s.opacity || '1') >= N;
  };
  var INTER = 'a[href],button,input,select,textarea,[role=button],[role=tab],[contenteditable=""],[contenteditable=true]';
  var out = { ghosts: [], hits: [] };

  /* ① 所有"不可见但还占位"的浮层 */
  var ghosts = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (vis(e)) continue;
    var r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    var s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    /* 全都要记下来（包括已经正确 pe:none 的）——否则报告会写"0 个不可见浮层"，
       读起来像"根本没测"，而实际是"看到了、都不拦"。这两种状态必须能区分。 */
    var safe = s.pointerEvents === 'none';
    out.ghosts.push({ cls: (e.className || '').toString().slice(0, 40), pe: s.pointerEvents,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    if (!safe) ghosts.push({ el: e, rect: r, cls: (e.className || '').toString().slice(0, 40) });
  }

  /* ② 每个可交互元素的可点击点，被谁挡住了 */
  var inter = document.querySelectorAll(INTER);
  for (var j = 0; j < inter.length; j++) {
    var t = inter[j];
    if (!vis(t)) continue;
    var tr = t.getBoundingClientRect();
    if (tr.width < 4 || tr.height < 4) continue;
    var cx = Math.round(tr.x + tr.width / 2), cy = Math.round(tr.y + tr.height / 2);
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    var top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (top === t || t.contains(top)) continue;            /* 点得到，正常 */
    /* 命中的是幽灵层 ⇒ 拦截 */
    for (var k = 0; k < ghosts.length; k++) {
      if (ghosts[k].el === top || ghosts[k].el.contains(top)) {
        out.hits.push({ target: (t.tagName + '.' + (t.className || '').toString().slice(0, 24)).slice(0, 48),
          ghost: ghosts[k].cls, at: [cx, cy], got: (top.tagName + '.' + (top.className || '').toString().slice(0, 24)).slice(0, 48) });
        break;
      }
    }
  }
  return JSON.stringify(out);
})()`;

let bad = 0;
for (const page of PAGES) {
  await send('Page.navigate', { url: BASE + '/' + page });
  await SLEEP(1200);

  /* ⚠ 关键一步：**先把产生幽灵层的状态跑出来**。
     接管条 `.xz-opfoot` 是第一次执行动作时才创建的 —— 页面加载完直接探，看到的是
     "0 个不可见浮层、全部点得到"，那正是我们一直在骂的"什么都没测就绿了"。
     所以这里照真实用户的路径走一遍：开小智 → 发一句 → 等它做完。 */
  const hasAi = await ev(`!!document.querySelector('.xz-fab')`);
  if (hasAi) {
    await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`);
    await SLEEP(500);
    await ev(`(function(){var t=document.querySelector('input[data-act="xzInput"]');
      if(!t) return 0; t.value='点一下装配组件'; t.dispatchEvent(new Event('input',{bubbles:true}));
      var b=document.querySelector('.xz-send'); if(b) b.click(); return 1;})()`);
    for (let k = 0; k < 40; k++) {
      await SLEEP(300);
      const done = await ev(`!!document.querySelector('.xz-done')`);
      if (done) break;
    }
    await SLEEP(1200);   /* 等接管条那 5.2s 的退场开始，这才是幽灵层真正"消失但还在"的时刻 */
  }
  if (NEG) {
    /* 负控：造一个"看不见但吃点击"的浮层，压住页面某个按钮 */
    await ev(`(function(){
      var b=document.querySelector('button,a[href]'); if(!b) return 0;
      var r=b.getBoundingClientRect();
      var g=document.createElement('div');
      g.className='negctl-ghost';
      g.style.cssText='position:fixed;opacity:0;background:red;z-index:99999;pointer-events:auto;'+
        'left:'+r.x+'px;top:'+r.y+'px;width:'+Math.max(8,r.width)+'px;height:'+Math.max(8,r.height)+'px;';
      document.body.appendChild(g); return 1;
    })()`);
    await SLEEP(200);
  }
  const raw = await ev(PROBE);
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { d = null; }
  if (!d) { console.log(`SKIP: ${page} 探针没有返回（页面没加载）`); bad++; continue; }
  if (d.hits.length) {
    console.log(`  ✗ ${page}：${d.hits.length} 处点击被不可见浮层吃掉`);
    d.hits.slice(0, 6).forEach((h) => console.log(`      ${h.target} @(${h.at}) 被 ${h.ghost} 挡住，命中的是 ${h.got}`));
    bad++;
  } else {
    const all = d.ghosts || [];
    const auto = all.filter((g) => g.pe !== 'none');
    console.log(`  ✓ ${page}：可交互元素都点得到（不可见浮层 ${all.length} 个；`
      + `其中 ${auto.length} 个 pe:auto，实测未拦截；${all.length - auto.length} 个已正确 pe:none）`);
  }
}

ws.close(); chrome.kill('SIGKILL');

if (NEG) {
  console.log(bad ? '负控成立：注入的不可见浮层被抓住了' : '负控失败：注入后仍判绿 ⇒ 这条判据是假的');
  process.exit(bad ? 2 : 0);
}
console.log(bad ? `\n命中 ${bad} 个页面` : '\n没有"看不见但吃点击"的浮层');
process.exit(bad ? 2 : 0);
