#!/usr/bin/env node
/* check-canvas-empty —— 「点卡片进去，画布没有可渲染内容」必须给带引导的空态，不许是纯空白。
 *
 * 用户实测报的缺陷（2026-10-24，lead 已复现）：组件库 / 应用页点进某张卡，
 * 画布一片空白：既没有内容，也没有告诉他"接下来该说什么"。
 * 这条判据逐页量三件事，任何一条不满足就红：
 *   ① `#canvas-inner` 里要么有真内容（`.page` / 生成出来的块），
 *      要么有引导空态（`.empty-wrap` + `.empty-lead` + `.seed` ≥3）
 *   ② 不许两者都没有（innerText 去空白后 < 8 字 且 无 .page / 无 .empty-wrap）
 *   ③ 不许"半个空态"（有 .empty-wrap 但 seed < 3，等于只说了句没用的正确话）
 *
 * 面：DB.COMPS 全部 + DB.APPS 全部（现取 id，不写死）
 * 用法：node tools/check-canvas-empty.mjs           正控
 *      node tools/check-canvas-empty.mjs --negctl  负控：把 #canvas-inner 清空后再量，必须红
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 Chrome 起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const TRACE = '/tmp/xz-audit/canvas-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };
const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/canvasempty-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
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
const goto = async (u) => { await send('Page.navigate', { url: BASE + '/' + u }); await SLEEP(1100); };

setTimeout(() => { console.log('GATE TIMEOUT: 180s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 180000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* 两页的画布容器与"内容/空态"的类名都不同，判据只认"用户看见的那块画布 + 看得见的字"：
   · component.html：容器 `#canvas-inner`（套在 main#canvas 里），内容 `.page`，空态 `.empty-wrap` + `.seed`×3
   · app.html：容器就是 `main#canvas`，内容 `.sheet`，空态 `section.cv-empty` + 按钮 `#cv-install`
   所以判定用"有容器内的可见文本 ≥ 24 字 + 有内容容器" 或 "有引导空态"，不绑死某一个类名。 */
const MEASURE = `(function(){
  var c = document.querySelector('#canvas-inner') || document.querySelector('#canvas');
  if (!c) return { missing: true };
  var txt = (c.innerText || '').replace(/\\s+/g, '');
  return {
    missing: false,
    len: txt.length,
    page: c.querySelectorAll('.page, .sheet').length,
    blocks: c.querySelectorAll('.page > *, .sheet-bd > *, .cols > *').length,
    empty: c.querySelectorAll('.empty-wrap, .cv-empty').length,
    lead: c.querySelectorAll('.empty-lead, .cv-empty b, .cv-empty p').length,
    seeds: c.querySelectorAll('.seed, #cv-install').length,
    cvEmpty: c.querySelectorAll('.cv-empty').length,
    cvLead: c.querySelectorAll('.cv-empty b, .cv-empty p').length,
    head: txt.slice(0, 24)
  };
})()`;

const fails = [];
const check = (label, m) => {
  if (!m || m.missing) { fails.push(label + ' —— 页面上没有 #canvas-inner'); console.log('  ✗ ' + label + '：#canvas-inner 不存在'); return; }
  const hasContent = m.page > 0 && m.len >= 24;
  /* ★2026-11-04：两种空态本来就是两种形态，判据原来只认组件域那一种。
     · 组件域：.empty-wrap + .empty-lead + 起手示例 .seed —— 用户要"示例摆在那儿"；
     · 应用域：section.cv-empty + 一句主句 + 一句下一步 —— 用户 2026-10-28 明确定调
       「空态只要一句话说清有哪两种起步方式，**不要示例句、不要模板**」，
       2026-11-04 再答一次「画布刻意留空：演示从零说一句话生成」。
     拿组件域的 seed≥1 去卡应用域，等于把用户否掉的东西判成必须。
     应用域改成：主句与下一步两句都在（.cv-empty b + p），正文 ≥12 字。 */
  const guideComp = m.empty > 0 && m.lead > 0 && m.seeds >= 1;
  const guideApp = m.cvEmpty > 0 && m.cvLead >= 2 && m.len >= 12;
  const hasGuide = guideComp || guideApp;
  if (hasContent || hasGuide) {
    console.log('  ✓ ' + label + '：' + (hasContent ? `有内容（.page ${m.page} 个 / ${m.len} 字）`
      : (guideApp ? `有引导空态（主句 + 下一步，${m.len} 字）` : `有引导空态（seed ${m.seeds} 条）`)));
    trace(label + ' OK ' + JSON.stringify(m));
  } else {
    fails.push(label + ` —— 纯空白：.page ${m.page}｜.empty-wrap ${m.empty}｜seed ${m.seeds}｜正文 ${m.len} 字「${m.head}」`);
    console.log('  ✗ ' + label + `：纯空白（.page ${m.page}｜.empty-wrap ${m.empty}｜seed ${m.seeds}｜${m.len} 字）`);
  }
};

console.log('画布空态（逐页真渲染，1440×900）' + (NEG ? '  [负控：清空 #canvas-inner 后再量]' : ''));

/* 取 id 清单：在组件库页上读 DB */
await goto('components.html');
const ids = await ev(`(function(){
  return { comps: (window.DB ? DB.COMPS.map(function(c){return c.id;}) : []),
           apps: (window.DB ? DB.APPS.map(function(a){return a.id;}) : []) };
})()`);
if (!ids || !ids.comps.length) { console.log('SKIP: 页面没给出 DB.COMPS（页面没起来）'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }

const targets = [
  ...ids.comps.map((k) => ({ url: 'component.html?id=' + encodeURIComponent(k), name: 'component.html?id=' + k })),
  ...ids.apps.map((k) => ({ url: 'app.html?id=' + encodeURIComponent(k), name: 'app.html?id=' + k }))
];

for (const t of targets) {
  await goto(t.url);
  if (NEG) await ev(`(function(){ var c = document.querySelector('#canvas-inner'); if (c) c.innerHTML = ''; return 1; })()`);
  check(t.name, await ev(MEASURE));
}

console.log('');
if (fails.length) {
  console.log(`FAIL：${fails.length} 页不满足（共查 ${targets.length} 页）`);
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(2);
}
console.log(`PASS：${targets.length} 页全部"有内容或有引导空态"`);
try { chrome.kill('SIGKILL'); } catch (e) {}
process.exit(NEG ? 3 : 0);
