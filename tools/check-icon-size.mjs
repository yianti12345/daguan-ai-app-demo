#!/usr/bin/env node
/* check-icon-size —— 内联 SVG 的尺寸契约（2026-10-26 立）
 *
 * 为什么有它：用户贴了一张截图 —— ⋮ 菜单里两枚图标被渲染成 300×150 的巨幅图形，
 * 把整张卡片盖住、菜单项文字被挤到边上。根因很朴素：图标串只写了 `viewBox`，
 * 没写 `width/height`，也没有 CSS 尺寸，于是浏览器按"替换元素默认尺寸"渲染。
 * 而我当时所有判据（能不能点、aria、命中区、键盘）全都绿 ——
 * **"能点"和"长得对"是两件事，后者当时没有任何命令在看。**
 *
 * 判据（每个页面跑一遍，遍历所有内联 <svg>）：
 *   I1 渲染尺寸落在 8–32px（装饰性小图标）；超过 32 一律判红并报出选择器路径
 *   I2 每个 svg 必须有显式来源：要么 width/height 属性，要么 CSS 计算值不是 auto
 *      （只靠 viewBox 的，在某些容器里会按 300×150 渲染 —— 这一条把它挡在门口）
 *   I3 同一页内，同类图标（按 path 的 d 前 24 字符归并）尺寸必须一致，不许一处 14 一处 20
 *
 * 负控 --negctl：临时把 `.k-mi svg` 的尺寸规则摘掉再量，I1 必须红；
 *   跑完自动还原（不改仓库里的文件内容，只改浏览器里的样式表）。
 *
 * 用法：node tools/check-icon-size.mjs [baseUrl] [--negctl]
 * 退出码：0 全过 ｜ 2 有断点 ｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';  /* 页面清单唯一来源，不许在这里另写一份 */
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (note ? '｜' + note : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (note ? '｜' + note : '')); }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/icons-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const SWEEP = `(function(){
  function pathOf(el) {
    var out = [], n = el;
    while (n && n.nodeType === 1 && out.length < 4) {
      var s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      var c = (n.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      out.unshift(s);
      n = n.parentElement;
    }
    return out.join(' > ');
  }
  var list = [];
  Array.prototype.forEach.call(document.querySelectorAll('svg'), function (sv) {
    var b = sv.getBoundingClientRect();
    var cs = getComputedStyle(sv);
    var d = '';
    var p = sv.querySelector('path');
    if (p) d = (p.getAttribute('d') || '').slice(0, 24);
    list.push({
      w: Math.round(b.width), h: Math.round(b.height),
      attrW: sv.getAttribute('width'), attrH: sv.getAttribute('height'),
      cssW: cs.width, cssH: cs.height,
      d: d, path: pathOf(sv),
      visible: b.width > 0 && b.height > 0
    });
  });
  return list;
})()`;

console.log(`内联 SVG 尺寸契约｜基址 ${BASE}${NEG ? '｜负控（摘掉 .k-mi svg 尺寸）' : ''}\n`);

for (const page of PAGES) {
  const url = BASE + '/' + page;
  await send('Page.navigate', { url });
  await SLEEP(1300);
  if (NEG) {
    /* 负控：在浏览器里把菜单图标尺寸摘掉，模拟"这条规则不存在"的世界 */
    await ev(`(function(){
      var st = document.createElement('style');
      /* 必须把 flex-basis 一起摘掉：只写 width:auto 时 flex:0 0 14px 的 basis 仍然把它钉在 14px，负控会假绿（刚踩） */
      st.textContent = '.k-mi svg{width:auto !important;height:auto !important;flex:none !important}';
      document.head.appendChild(st);
      return 1;
    })()`);
    await SLEEP(150);
  }
  /* 菜单默认是关的 —— 先展开，才能量到菜单里的图标 */
  await ev(`(function(){ var b = document.querySelector('.k-more'); if (b) b.click(); return 1; })()`);
  await SLEEP(300);

  const svgs = await ev(SWEEP);
  if (!Array.isArray(svgs)) { console.log(`  SKIP ${page}：量取失败（${svgs && svgs.__err}）`); continue; }

  const vis = svgs.filter((s) => s.visible);
  const big = vis.filter((s) => s.w > 32 || s.h > 32);
  const tiny = vis.filter((s) => s.w < 8 || s.h < 8);
  ok(`${page} · I1 图标尺寸 8–32px（共 ${vis.length} 个）`,
    big.length === 0 && tiny.length === 0,
    big.length || tiny.length
      ? '超限 ' + big.length + ' 大 / ' + tiny.length + ' 小：' +
        big.concat(tiny).slice(0, 4).map((s) => s.w + '×' + s.h + ' @ ' + s.path).join('；')
      : '最大 ' + Math.max(...vis.map((s) => Math.max(s.w, s.h))) + 'px');

  /* I2：尺寸的来源必须显式 —— 属性或 CSS 二者有其一，且不能是 auto */
  const noSize = vis.filter((s) => {
    const hasAttr = s.attrW && s.attrH;
    const cssAuto = (s.cssW === 'auto' || s.cssH === 'auto');
    return !hasAttr && cssAuto;
  });
  ok(`${page} · I2 每个图标都有显式尺寸来源（属性或 CSS）`,
    noSize.length === 0,
    noSize.length ? '无来源 ' + noSize.length + ' 个：' + noSize.slice(0, 3).map((s) => s.path).join('；')
                  : '全部有来源');

  /* I3：同一个 path 形状只许一种尺寸 */
  const byPath = {};
  vis.filter((s) => s.d).forEach((s) => {
    const k = s.d;
    (byPath[k] = byPath[k] || []).push(s.w + '×' + s.h);
  });
  const drift = Object.keys(byPath).filter((k) => new Set(byPath[k]).size > 1);
  ok(`${page} · I3 同一图标在不同位置尺寸一致`,
    drift.length === 0,
    drift.length ? '漂移 ' + drift.length + ' 种：' + drift.slice(0, 2).map((k) => byPath[k].join(' / ')).join('；')
                 : '一致');
  console.log('');
}

console.log(`通过 ${pass} ｜ 断点 ${fail}`);
ws.close(); chrome.kill();
process.exit(fail ? 2 : 0);
