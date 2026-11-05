#!/usr/bin/env node
/* check-geometry —— **几何层的不变量**（治"数字对、渲染错"）。
 *
 * 为什么有它：今天一个 `transform: translateY(-2px)` 的 hover 效果，
 * 让所有 `position: fixed` 的菜单从"相对视口"变成"相对卡片"，实测右缘差 217px、纵向差 134px。
 * 我花了 8 轮才找到根因 —— 而 CSS 里没有一行写错，写错的是一条**隐式规则**：
 *   transform / filter / perspective / will-change 会给后代创建 containing block，
 *   于是 fixed 后代不再相对视口定位。
 *
 * 这条判据不测"对不对齐"（那有 CARDMENU ⑧c），测的是**根因本身**：
 *   页面上每个 position:fixed 的元素，它的祖先链里**不许有** transform/filter/perspective。
 * 一旦有，它的定位基准就已经不是它以为的那个东西了 —— 现在没偏，只是凑巧。
 *
 * 为什么不用"滚动前后比 rect"（那也是可行做法）：
 *   本项目的菜单是"滚动即收起"（正确交互），滚动后 rect 归零，比不了。
 *   所以查结构比查表现稳。
 *
 * 用法：node tools/check-geometry.mjs [baseUrl] [--negctl]
 * 退出码：0 没有失锚 ｜ 2 有 fixed 元素被祖先捕获（负控恒 2）｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

let pass = 0, fail = 0;
const ok = (t, d) => { pass++; console.log(`  ✓ ${t}${d ? '｜' + d : ''}`); };
const bad = (t, d) => { fail++; console.log(`  ✗ ${t}${d ? '｜' + d : ''}`); };

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/geo-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 70; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
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
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 180) };
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
if (NEG) {
  /* 负控：给 body 加 transform —— 于是页面里所有 fixed 元素全都"失锚"。
     证明的是"祖先捕获这件事能被发现"，不是"某一行 CSS 写错了"。 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', function(){
      document.body.style.transform = 'translateY(0px)';
    });`
  });
}

console.log(`几何不变量判据｜基址 ${BASE}${NEG ? '｜负控（给 body 加 transform）' : ''}\n`);

const PROBE = `(function(){
  /* 会创建 containing block 的属性。transform/filter/perspective/will-change 四个都算。 */
  function capturedBy(el) {
    var n = el.parentElement;
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      if (cs.transform !== 'none' || cs.filter !== 'none' ||
          cs.perspective !== 'none' || /transform|filter/.test(cs.willChange || '')) {
        return { tag: n.tagName.toLowerCase(), cls: String(n.getAttribute('class') || '').split(' ')[0],
                 why: cs.transform !== 'none' ? 'transform:' + cs.transform.slice(0, 24)
                    : cs.filter !== 'none' ? 'filter:' + cs.filter.slice(0, 20)
                    : cs.perspective !== 'none' ? 'perspective' : 'will-change' };
      }
      n = n.parentElement;
    }
    return null;
  }
  var fixed = [].slice.call(document.querySelectorAll('*')).filter(function(el){
    return getComputedStyle(el).position === 'fixed';
  });
  var hits = [];
  fixed.forEach(function(el){
    var c = capturedBy(el);
    if (c) hits.push({ el: el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') || '').split(' ')[0], by: c });
  });
  return { total: fixed.length, hits: hits,
           names: fixed.slice(0, 8).map(function(e){ return e.tagName.toLowerCase() + '.' + String(e.getAttribute('class')||'').split(' ')[0]; }) };
})()`;

for (const p of PAGES) {
  await send('Page.navigate', { url: BASE + '/' + p });
  await SLEEP(1600);
  const r = await ev(PROBE);
  if (!r || r.__err) { bad(p + ' 量不到', r && r.__err); continue; }
  if (r.total === 0) { ok(p + ' 页面上没有 fixed 元素（无需检查）', ''); continue; }
  if (r.hits.length === 0) {
    ok(p + ' fixed 元素没有被祖先创建 containing block', `${r.total} 个 fixed：${r.names.join(' ')}`);
  } else {
    bad(p + ' 有 fixed 元素被祖先捕获（定位基准已经不是视口）',
      r.hits.map((h) => `${h.el} 被 ${h.by.tag}.${h.by.cls}（${h.by.why}）捕获`).join(' ｜ '));
  }
}

console.log(`\n通过 ${pass} ｜ 断点 ${fail}`);
if (NEG) {
  console.log(fail > 0 ? '负控：给 body 加 transform 后判红 ✓（rc=2）' : '负控失败：加了 transform 仍全绿 —— 判据是空的 ✗');
  process.exit(2);
}
ws.close(); chrome.kill();
process.exit(fail > 0 ? 2 : 0);
