#!/usr/bin/env node
/* check-card-footer —— 应用卡底栏的**状态×几何契约**（2026-11-02 立）
 *
 * 为什么有它：用户连续三轮说「卡片底部还是不一样」，我每轮只修当时看得见的一处
 * （时间截断 / 卡边界 / hover），没有一条判据在量「同一页所有状态卡的 footer 是否同一套几何」。
 * 于是 24px ghost + 32px 真钮、4px 与 12px 内距、整卡 opacity 三套东西可以同时存在，
 * 而 --fast 全绿。判据必须量 computed，不读 CSS 声明。
 *
 * 官网真机（agents.datagrand.com/#/Expert/ManageAgent，1440）读数：
 *   footer 高 49、padding 12/12/13、无投影；动作组 68 = 10+24+10+24；
 *   按钮 24×24、radius 2、margin-left 10、无 gap；图标 20×20。
 * 三态（已上架 / 未发布 / 已下架）共用同一套 footer；未发布只把电源钮置 disabled。
 *
 * 用法：node tools/check-card-footer.mjs [baseUrl]
 *      node tools/check-card-footer.mjs --negctl  负控：把按钮注入回 32px，必须红
 * 退出码：0 全过 ｜ 2 有断点 / 负控成立 ｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const NEG = process.argv.includes('--negctl');
let BASE;
try { BASE = await resolveBase(); } catch (e) { console.log('SKIP: ' + e.message); process.exit(3); }
const M = JSON.parse(fs.readFileSync(new URL('./state-matrix.json', import.meta.url), 'utf8'));
const PAGE = (M.apps && M.apps.page) || 'apps.html';
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=' + port, '--user-data-dir=/tmp/cf-' + Date.now(), '--remote-allow-origins=*',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 70; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await sleep(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const EXPR = [
  '(function(){',
  'function box(e){',
  '  if(!e) return null;',
  '  var r=e.getBoundingClientRect(), s=getComputedStyle(e), svg=e.querySelector("svg"), sr=svg?svg.getBoundingClientRect():null;',
  '  return {w:r.width,h:r.height,ml:s.marginLeft,radius:s.borderRadius,disabled:!!e.disabled,label:e.getAttribute("aria-label")||"",svg:svg?{w:sr.width,h:sr.height}:null};',
  '}',
  'return [].slice.call(document.querySelectorAll(".kcard")).map(function(c,i){',
  '  var tag=c.querySelector(".kc-tag"), ft=c.querySelector(".card-ft"), ops=c.querySelector(".kc-ops"), pub=c.querySelector(".k-pub"), more=c.querySelector(".k-more");',
  '  var cs=ft?getComputedStyle(ft):null, co=ops?getComputedStyle(ops):null, rr=ft?ft.getBoundingClientRect():null, ro=ops?ops.getBoundingClientRect():null;',
  '  return {i:i,state:tag?tag.textContent.trim():"",opacity:getComputedStyle(c).opacity,',
  '    ft:cs?{h:rr.height,pt:cs.paddingTop,pr:cs.paddingRight,pb:cs.paddingBottom,pl:cs.paddingLeft,shadow:cs.boxShadow,border:cs.borderTopWidth}:null,',
  '    ops:co?{w:ro.width,h:ro.height,gap:co.gap}:null,',
  '    pub:box(pub),more:box(more)};',
  '});',
  '})()'
].join('\n');
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
console.log('卡底栏状态契约｜官网基准 24×24 / footer 49 / padding 12·12·13｜基址 ' + BASE);
async function measure() {
  await send('Page.navigate', { url: BASE + '/' + PAGE });
  await sleep(1800);
  return await ev(EXPR);
}
function near(a, b, tol) { return Math.abs(parseFloat(a) - b) <= (tol == null ? 0.6 : tol); }
function judge(cards) {
  const out = { pass: [], fail: [] };
  const ok = (t, d) => out.pass.push(t + (d ? '｜' + d : ''));
  const bad = (t, d) => out.fail.push(t + (d ? '｜' + d : ''));
  if (!Array.isArray(cards) || !cards.length) { bad('量到卡片', '0 张'); return out; }
  ok('量到卡片', cards.length + ' 张');
  let drafts = 0;
  for (const c of cards) {
    const who = '#' + c.i + (c.state ? ' ' + c.state : '');
    /* ★2026-11-04 判据过期：三态动作后草稿态在卡上写作「未上架」（apps.html:305），不再叫「未发布」。
       两个名字都认，免得改一次文案判据就瞎一次。 */
    if (c.state === '未发布' || c.state === '未上架') drafts++;
    if (!c.ft || !c.ops) { bad(who + ' footer/ops 存在', JSON.stringify({ ft: !!c.ft, ops: !!c.ops })); continue; }
    (near(c.ft.h, 49) && near(c.ft.pt, 12) && near(c.ft.pr, 12) && near(c.ft.pb, 13) && near(c.ft.pl, 12))
      ? ok(who + ' footer 49 / padding 12·12·13', c.ft.h.toFixed(1) + ' / ' + [c.ft.pt, c.ft.pr, c.ft.pb, c.ft.pl].join(' '))
      : bad(who + ' footer 49 / padding 12·12·13', c.ft.h.toFixed(1) + ' / ' + [c.ft.pt, c.ft.pr, c.ft.pb, c.ft.pl].join(' '));
    (c.ft.shadow === 'none' && near(c.ft.border, 0)) ? ok(who + ' footer 无投影/无描边', c.ft.shadow + ' / ' + c.ft.border)
      : bad(who + ' footer 无投影/无描边', c.ft.shadow + ' / ' + c.ft.border);
    (near(c.ops.w, 68) && near(c.ops.h, 24) && near(c.ops.gap, 0)) ? ok(who + ' 动作组 68×24 / gap 0', c.ops.w.toFixed(1) + '×' + c.ops.h.toFixed(1) + ' / ' + c.ops.gap)
      : bad(who + ' 动作组 68×24 / gap 0', c.ops.w.toFixed(1) + '×' + c.ops.h.toFixed(1) + ' / ' + c.ops.gap);
    if (!c.pub || !c.more) { bad(who + ' 两颗按钮都在', JSON.stringify({ pub: !!c.pub, more: !!c.more })); continue; }
    for (const [name, b] of [['电源', c.pub], ['⋮', c.more]]) {
      (near(b.w, 24) && near(b.h, 24) && near(b.ml, 10) && b.radius === '2px' && b.svg && near(b.svg.w, 20) && near(b.svg.h, 20))
        ? ok(who + ' ' + name + ' 24×24 / ml10 / r2 / icon20', b.w + '×' + b.h + ' / ' + b.ml + ' / ' + b.radius + ' / ' + (b.svg ? b.svg.w + '×' + b.svg.h : '无'))
        : bad(who + ' ' + name + ' 24×24 / ml10 / r2 / icon20', JSON.stringify(b));
    }
    if (c.state === '未上架') {
      /* ★2026-11-04 契约换了一版：2026-11-03 三态动作定「未上架→发布内测版→内测中→上架正式版→已上架」
         （apps.html:305）。所以「未上架」的电源**必须可用**（它就是发布内测版的入口），
         旧契约「未上架电源 disabled」是上一代草稿模型的写法，已随旧模型下线。 */
      (!c.pub.disabled) ? ok(who + ' 未上架电源可用（三态入口）', c.pub.label)
        : bad(who + ' 未上架电源可用（三态入口）', 'disabled=' + c.pub.disabled + ' label=' + c.pub.label);
      (!c.more.disabled) ? ok(who + ' 未上架 ⋮ 仍可用', 'enabled') : bad(who + ' 未上架 ⋮ 仍可用', 'disabled');
    } else if (c.state === '未发布') {
      (c.pub.disabled && /^未发布/.test(c.pub.label)) ? ok(who + ' 草稿电源 disabled 且文案=未发布（老存档模型）', c.pub.label)
        : bad(who + ' 草稿电源 disabled 且文案=未发布（老存档模型）', 'disabled=' + c.pub.disabled + ' label=' + c.pub.label);
      (!c.more.disabled) ? ok(who + ' 草稿 ⋮ 仍可用', 'enabled') : bad(who + ' 草稿 ⋮ 仍可用', 'disabled');
    } else {
      (!c.pub.disabled) ? ok(who + ' 非草稿电源可用', 'enabled') : bad(who + ' 非草稿电源可用', 'disabled');
    }
    if (c.state === '已下架') {
      near(c.opacity, 1, 0.01) ? ok(who + ' 已下架不整卡降透明', c.opacity) : bad(who + ' 已下架不整卡降透明', c.opacity);
    }
  }
  drafts ? ok('草稿状态量到', drafts + ' 张') : bad('草稿状态量到', '0 张，disabled 契约没被验证');
  return out;
}
function print(out) { for (const x of out.pass) console.log('  ✓ ' + x); for (const x of out.fail) console.log('  ✗ ' + x); }
const base = await measure();
const out = judge(base);
print(out);
console.log('\n通过 ' + out.pass.length + '｜断点 ' + out.fail.length);
if (NEG) {
  await ev('(function(){var s=document.createElement("style");s.id="cf-neg";s.textContent=".kcard .kc-ops .k-pub{width:32px!important;height:32px!important}.kcard .kc-ops .k-more{width:32px!important;height:32px!important}";document.head.appendChild(s);return 1})()');
  await sleep(300);
  const bad = judge(await ev(EXPR));
  if (bad.fail.length) { console.log('\n负控成立：注入 32×32 后 ' + bad.fail.length + ' 项变红（rc=2）'); }
  else { console.log('\n负控未成立：注入 32×32 后仍全绿，判据无效（rc=2）'); }
  try { ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(2);
}
try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
process.exit(out.fail.length ? 2 : 0);