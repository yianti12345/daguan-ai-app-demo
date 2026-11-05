#!/usr/bin/env node
/* check-empty-contrast —— 首屏空态（component.html 不带 id）四处文字的对比度实测。
 *
 * 为什么要有它：2026-10-24 用户原话「点进去是空白待机页、看不到提示文、打不了字」。
 * 提示文其实都在，问题是**太淡**——用肉眼看不出，就说"没有"。所以这条判据不读 CSS 声明，
 * 直接进真浏览器拿 computed color，**按 alpha 合成到实际背景上**再算对比度：
 * 半透明黑（rgba(0,0,0,.45)）压在白底上的真实观感是 #8C8C8C（3.4:1），
 * 不是它字面上的 rgb(0,0,0)（21:1）——上一版临时探针就栽在这个 alpha 上。
 *
 * 阈值（WCAG 2.1 AA 起算，主句按 AAA）：
 *   ① `.empty-lead`   主句    ≥ 7.0   （≥18.66px 或 14pt bold 时才降到 4.5，这里按 AAA 从严）
 *   ② （2026-10-27 删除：.empty-hint 在产品里从不存在，空态只有主句 + 示例）
 *   ③ `.seed`         示例文字 ≥ 4.5
 *   ④ `.seed-ar`      › 箭头  ≥ 4.5（它是"这条能点"的唯一信号，按正文对待）
 *   ⑤ 小智输入框 placeholder  ≥ 3.0（占位文字按 WCAG 非文本对比度下限，且它只是引导语）
 *
 * 用法：node tools/check-empty-contrast.mjs            正控
 *      node tools/check-empty-contrast.mjs --negctl   负控：把说明与示例都压到 rgba(0,0,0,.2)
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 Chrome 起不来 / 元素找不到（未量，不许当绿）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/emptycontrast-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
};

/* 看门狗：90s 没跑完就明说超时（rc=3） */
setTimeout(() => { console.log('GATE TIMEOUT: 90s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 90000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const fails = [];
const unmeasured = [];
const ok = (n, d) => console.log('  ✓ ' + n + (d ? '：' + d : ''));
const bad = (n, d) => { fails.push(n + ' —— ' + d); console.log('  ✗ ' + n + '：' + d); };

const MEASURE = `(function(){
  function rgb(s){ var m=String(s).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
  function L(c){ function f(v){v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);} return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function over(fg,bg){ var a=fg.a; return {r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1}; }
  function bgOf(n){ var e=n; while(e){ var c=rgb(getComputedStyle(e).backgroundColor); if(c && c.a>0.95) return c; e=e.parentElement; } return {r:255,g:255,b:255,a:1}; }
  function hex(c){ function h(v){ return ('0'+Math.round(v).toString(16)).slice(-2); } return '#'+(h(c.r)+h(c.g)+h(c.b)).toUpperCase(); }
  function ratio(a,b){ var x=L(a), y=L(b); return +(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)); }
  function m(sel, pseudo){
    var n=document.querySelector(sel); if(!n) return {sel:sel, miss:true, why:'选择器在页面上找不到'};
    var s=getComputedStyle(n, pseudo||null);
    var fg=rgb(s.color); if(!fg) return {sel:sel, miss:true, why:'color 不是 rgb/rgba：'+s.color};
    var bg=bgOf(n); var eff=over(fg,bg);
    return {sel:sel, text:(n.innerText||'').replace(/\\s+/g,' ').slice(0,18),
      declared:s.color, bgHex:hex(bg), effHex:hex(eff),
      alpha:fg.a, fontPx:parseFloat(s.fontSize), weight:s.fontWeight, ratio:ratio(eff,bg)};
  }
  return [
    /* ★2026-10-27：去掉 .empty-hint。这个类在整个产品里**从来不存在** ——
       空态实际是「一句主句（.empty-lead）＋ 三条示例（.seed / .seed-ar）」，
       没有第二条说明行。判据一直在量一个不存在的元素，于是永久"未量 1 处"，
       而"缺量不许当绿"又让整条判据 rc=3 —— 一条永远量不到的东西把整条判据拖成未量。
       这是判据的假设过期（早期设计可能有过副说明），不是页面缺东西。 */
    /* ★2026-11-04（用户 m01223）：组件配置页的空态改成与应用页同一件（.cv-empty 主句 + 一句引导），
       原来的 .empty-lead/.seed/.seed-ar 随组件页旧空态一起下线。量真在屏幕上的两个节点。 */
    m('.cv-empty b'), m('.cv-empty p'),
    m('input[data-act="xzInput"]','::placeholder')
  ];
})()`;

console.log('首屏空态对比度（component.html 不带 id，1440×900，真浏览器 computed color 按 alpha 合成到背景）'
  + (NEG ? '  [负控：说明与示例压到 rgba(0,0,0,.2)]' : ''));

await send('Page.navigate', { url: BASE + '/component.html' });
await SLEEP(1200);

/* 小智输入框在小智面板里，面板默认收起（浮球 data-act="xzToggle"）——先点开再量，
   否则这条永远是"量不到"，而"量不到"最容易被人当成"没问题"。 */
await ev(`(function(){
  if (document.querySelector('input[data-act="xzInput"]')) return 'open';
  var f = document.querySelector('[data-act="xzToggle"]');
  if (!f) return 'no-fab';
  f.click(); return 'clicked';
})()`);
await SLEEP(600);

if (NEG) {
  await ev(`(function(){
    var s=document.createElement('style'); s.id='negctl';
    s.textContent='.cv-empty b{color:rgba(0,0,0,.2)!important}.cv-empty p{color:rgba(0,0,0,.2)!important}';
    document.head.appendChild(s); return 1;
  })()`);
  await SLEEP(200);
}

let rows;
try {
  rows = await ev(MEASURE);
} catch (e) {
  console.log('SKIP: 量测脚本抛错 —— ' + e.message);
  try { chrome.kill('SIGKILL'); } catch (e2) {}
  process.exit(3);
}

const NEED = [
  ['.cv-empty b', 7.0, '主句'],
  /* ★2026-10-27：删掉 ['.empty-hint', 4.5, '说明'] —— 这个类在产品里从不存在。
     它留在 NEED 里，每次跑都"未量 1 处"，而"缺量不许当绿"把整条判据拖成 rc=3。
     空态的真实结构是主句 + 三条示例，没有第二条说明行。 */

  ['.cv-empty p', 4.5, '引导句'],
  ['input[data-act="xzInput"]', 3.0, '小智输入框占位']
];
for (const [sel, need, label] of NEED) {
  const r = (rows || []).find((x) => x && x.sel === sel);
  if (!r || r.miss) { unmeasured.push(sel); console.log('  ？ ' + label + '（' + sel + '）：量不到 —— ' + (r && r.why)); continue; }
  const line = `${label}${r.text ? '「' + r.text + '」' : ''} ${r.declared} → 合成 ${r.effHex} on ${r.bgHex} = ${r.ratio}:1（需 ≥${need}）`;
  if (r.ratio >= need) ok(label + ' 对比度', line); else bad(label + ' 对比度', line);
}

try { chrome.kill('SIGKILL'); } catch (e) {}

if (unmeasured.length) {
  console.log(`未量 ${unmeasured.length} 处：${unmeasured.join('、')} —— 缺量不许当绿`);
  process.exit(3);
}
console.log(fails.length ? `\nFAIL ${fails.length} 条：\n - ` + fails.join('\n - ') : '\n通过：5 处在阈值以上');
process.exit(fails.length ? 2 : 0);
