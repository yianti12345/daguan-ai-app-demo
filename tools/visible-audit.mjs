#!/usr/bin/env node
/* visible-audit —— 「每个关键控件是不是真的看得见」的清单判据。
 *
 * 为什么有它（真事故，不是假设）：
 *   配置器那个 switch 被 `.bd-field label{display:block}` 压成了零尺寸，界面上整个不见了，
 *   而当时**所有门禁全绿**。三个原因各差一段：
 *     · gate-states 只验「CSS 里有那条规则」——规则在、元素没盒子，它看不出；
 *     · interact-audit 只验「点下去有反应」——元素 0 尺寸时可能压根点不到；
 *     · px-parity 比的是「今天 vs 基线」——基线拍的时候它就已经不见了，永远没有差异。
 *   也就是说：「元素在不在」已经有两代判据（DOM 存在、可交互有反应），
 *   但「每个关键控件是否可见」**没有清单**。这个工具补的就是那张清单。
 *
 * 主体：tools/must-see.json（清单是本工具的一半 —— 清单漏一条，判据就漏一条）
 *   每条 = {page, sel, why}。page 可以是带查询串的（configuration 变体靠 URL 参数就位）。
 *
 * 判定：下面四条**同时**成立才算「可见」
 *   1. getBoundingClientRect() 的 width > 0 且 height > 0
 *   2. computed display !== 'none'，且 visibility 不是 hidden / collapse
 *   3. opacity > 0（按祖先链连乘 —— 祖先 opacity:0 也算看不见）
 *   4. 没有被裁切祖先切掉：对每个 overflow(hidden|clip) 的祖先，
 *      元素 rect 必须完整落在它的 rect 内（这条最容易漏，也是「看着在、实际看不见」的主要来源）
 *
 * 口径（与 check-judgments 同一把尺）：
 *   **清单里的选择器命中 0 条 ⇒ 判红。** 主体不存在 = 没量，不是通过。
 *
 * 用法：
 *   node tools/visible-audit.mjs [base] [--json] [--negctl] [--help]
 *   基址解析走 tools/base.mjs（命令行 http 地址 > GATE_BASE > 探候选端口），不自己写端口。
 *
 * 退出码：0 通过 ｜ 2 有断点（--negctl 恒为 2）｜ 3 环境不可用（基址/Chrome 起不来、清单读不到）
 *
 * 负控（--negctl，四条判定各配一个真注入，每一路都必须真的红并指名是哪一条）：
 *   ① 零盒子：把 `.sider` 的 width/height 打 0!important；
 *   ② 整页消失：注入 `*{display:none!important}`（全部条目都该红）；
 *   ③ 被祖先裁掉：把 `#grid .kcard` 的父元素压成 height:0 + overflow:hidden ——
 *      元素自己的盒子还在（①②都判它绿），只有第④条判得出来；
 *   ④ 祖先透明：把同一个父元素设成 opacity:0 —— 同上，只有第③条判得出来。
 *   ③④ 单独证，是因为「看着在、实际看不见」正是这两种形态，而它们恰恰是 ①② 的盲区。
 *   全部注入都只在浏览器会话里做（临时 user-data-dir），不碰页面文件，跑完即弃。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBase, debugPort } from './base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LIST = join(HERE, 'must-see.json');
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes('--json');
const NEGCTL = ARGS.includes('--negctl');
const HELP = ARGS.includes('--help') || ARGS.includes('-h');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (HELP) {
  console.log(`
visible-audit —— 关键控件可见性清单判据

主体：tools/must-see.json  [{page, sel, why}]，命中 0 条即红（主体不存在=没量，不是通过）
判定：四条同时成立才算可见
  ① rect.width>0 && rect.height>0
  ② display!=='none' 且 visibility 不是 hidden/collapse
  ③ opacity>0（祖先链连乘）
  ④ 不被 overflow:hidden|clip 的祖先裁掉（元素 rect 必须落在祖先 rect 内）

用法：node tools/visible-audit.mjs [base] [--json] [--negctl] [--help]
  基址：命令行 http 地址 > GATE_BASE > tools/base.mjs 探候选端口
  --json     只输出 JSON（可直接喂给别的判据）
  --negctl   负控：① 把第 1 条清单项压成零盒子 ② 注入 *{display:none!important}
             两路都必须红，且①必须指到那一条；恒返回 2

退出码：0 通过 ｜ 2 有断点（含 --negctl）｜ 3 环境不可用
`);
  process.exit(0);
}

/* ── 清单 ─────────────────────────────────────────────────────── */
let ITEMS;
try {
  ITEMS = JSON.parse(readFileSync(LIST, 'utf8'));
  if (!Array.isArray(ITEMS) || !ITEMS.length) throw new Error('不是非空数组');
  const bad = ITEMS.filter((x) => !x || typeof x.page !== 'string' || typeof x.sel !== 'string');
  if (bad.length) throw new Error('有 ' + bad.length + ' 条缺 page/sel');
} catch (e) {
  console.log('FATAL: 清单 tools/must-see.json 读不了 → ' + e.message);
  process.exit(3);
}

let BASE;
try { BASE = await resolveBase(ARGS); }
catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

/* ── 浏览器（起法与 check-judgments 同一套，不另写一份 CDP）────────── */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null && this.wait.has(m.id)) {
        const w = this.wait.get(m.id); this.wait.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.wait.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), 20000);
    });
  }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/vsa-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1',
  'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
const c = new CDP(ws);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  return r.result.value;
};

/* 页面量测：一次把本页所有清单项量完（每个页面只导航一次）。
   注意 `readyState` 要等于 complete 再量 —— 列表是 JS 渲染的，
   早 200ms 量就是「卡还没生出来」的假红。 */
async function goto(page) {
  await c.send('Page.navigate', { url: BASE + '/' + page });
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    try { if (await ev('document.readyState') === 'complete') break; } catch (e) { /* 导航中 */ }
  }
  await sleep(250);   /* 再给首屏渲染一拍（列表/浮层都是 DOMContentLoaded 之后同步画的） */
}

const MEASURE_JS = (sels) => `JSON.stringify((function () {
  var SEL = ${JSON.stringify(sels)};
  var R = function (v) { return Math.round(v * 10) / 10; };
  var label = function (el) {
    if (!el || !el.tagName) return '(无)';
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 48);
  };
  var EPS = 0.5;
  var out = [];
  SEL.forEach(function (sel) {
    var els = null;
    try { els = document.querySelectorAll(sel); } catch (e) { els = null; }
    if (els === null) { out.push({ sel: sel, bad: '选择器写错了' }); return; }
    if (!els.length) { out.push({ sel: sel, n: 0 }); return; }
    var el = els[0];
    var b = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    var selfOp = parseFloat(st.opacity);
    if (isNaN(selfOp)) selfOp = 1;
    var opChain = selfOp, opWho = selfOp <= 0 ? label(el) : '';
    var clip = null;
    var node = el.parentElement;
    while (node && node !== document.documentElement) {
      var ns = getComputedStyle(node);
      var o = parseFloat(ns.opacity);
      if (!isNaN(o)) {
        if (o <= 0 && !opWho) opWho = label(node);
        opChain *= o;
      }
      var ox = ns.overflowX, oy = ns.overflowY;
      if ((ox === 'hidden' || ox === 'clip' || oy === 'hidden' || oy === 'clip') && !clip) {
        var a = node.getBoundingClientRect();
        var inside = b.left >= a.left - EPS && b.top >= a.top - EPS &&
                     b.right <= a.right + EPS && b.bottom <= a.bottom + EPS;
        if (!inside) clip = { who: label(node), ov: ox + '/' + oy, a: { x: R(a.x), y: R(a.y), w: R(a.width), h: R(a.height) } };
      }
      node = node.parentElement;
    }
    out.push({
      sel: sel, n: els.length,
      rect: { x: R(b.x), y: R(b.y), w: R(b.width), h: R(b.height) },
      display: st.display, visibility: st.visibility,
      opacity: Math.round(opChain * 1000) / 1000, opacityWho: opWho,
      clip: clip,
      inView: !(b.right < 0 || b.bottom < 0 || b.left > innerWidth || b.top > innerHeight),
      tag: label(el)
    });
  });
  return out;
})())`;

/* 四条判定，逐条给出理由（红的时候要能指名道姓） */
function judge(m, why) {
  const fail = [];
  if (m.bad) fail.push(m.bad);
  else if (m.n === 0) fail.push('命中 0 条（主体不存在 = 没量）');
  else {
    if (!(m.rect.w > 0) || !(m.rect.h > 0)) fail.push(`尺寸为零 ${m.rect.w}×${m.rect.h}`);
    if (m.display === 'none') fail.push('display:none');
    if (m.visibility === 'hidden' || m.visibility === 'collapse') fail.push('visibility:' + m.visibility);
    if (!(m.opacity > 0)) fail.push('opacity=' + m.opacity + (m.opacityWho ? '（' + m.opacityWho + '）' : ''));
    if (m.clip) fail.push('被祖先裁掉：' + m.clip.who + ' [' + m.clip.ov + '] ' +
      m.clip.a.w + '×' + m.clip.a.h + ' @' + m.clip.a.x + ',' + m.clip.a.y);
  }
  return { ok: fail.length === 0, fail, why };
}

/* 按页面分组，保持清单顺序（同一页只导航一次） */
const pages = [];
const byPage = new Map();
for (const it of ITEMS) {
  if (!byPage.has(it.page)) { byPage.set(it.page, []); pages.push(it.page); }
  byPage.get(it.page).push(it);
}

async function run({ mode, onPage, target }) {
  const results = [];
  for (const page of pages) {
    const list = byPage.get(page);
    await goto(page);
    const inject = !onPage || onPage === page;
    if (inject && mode === 'blank') {
      await ev(`(function(){var s=document.createElement('style');s.id='__va_blank';` +
        `s.textContent='*{display:none!important}';document.head.appendChild(s);return 1;})()`);
    } else if (inject && mode === 'zero') {
      /* 只压指定的那一条 —— 负控要能指名道姓，全压就分不出是哪条在起作用 */
      await ev(`(function(){
        var els=document.querySelectorAll(${JSON.stringify(target)});
        for (var i=0;i<els.length;i++){
          els[i].style.setProperty('width','0','important');
          els[i].style.setProperty('height','0','important');
          els[i].style.setProperty('overflow','hidden','important');
        }
        return els.length;
      })()`);
    } else if (inject && (mode === 'clip' || mode === 'opacity')) {
      /* 压的是**父元素**：元素自己的盒子还在，只是被祖先切掉/变透明。
         这两种只有第③④条判得出来 —— ①②都看不见，正是它最容易永久漏掉的原因。 */
      await ev(`(function(){
        var e=document.querySelector(${JSON.stringify(target)});
        if(!e||!e.parentElement) return 0;
        var p=e.parentElement;
        ${mode === 'clip'
          ? "p.style.setProperty('height','0','important');p.style.setProperty('overflow','hidden','important');"
          : "p.style.setProperty('opacity','0','important');"}
        return 1;
      })()`);
    }
    const got = JSON.parse(await ev(MEASURE_JS(list.map((x) => x.sel))));
    list.forEach((it, i) => {
      const m = got[i] || { bad: '没量到' };
      const j = judge(m, it.why);
      results.push({ page, sel: it.sel, why: it.why, ...j, m });
    });
  }
  return results;
}

/* ── 正控 ─────────────────────────────────────────────────────── */
const t0 = Date.now();
const res = await run({ mode: 'normal' });
const bad = res.filter((r) => !r.ok);
const offscreen = res.filter((r) => r.ok && r.m && r.m.inView === false);

if (JSON_OUT) {
  console.log(JSON.stringify({
    base: BASE, list: 'tools/must-see.json',
    total: res.length, pages: pages.length,
    pass: res.length - bad.length, fail: bad.length,
    items: res.map((r) => ({
      page: r.page, sel: r.sel, ok: r.ok, fail: r.fail,
      rect: r.m && r.m.rect || null, clip: r.m && r.m.clip || null, why: r.why
    }))
  }, null, 2));
} else {
  console.log('');
  console.log('可见性清单：' + ITEMS.length + ' 条 · ' + pages.length + ' 个页面状态');
  for (const page of pages) {
    const rows = res.filter((r) => r.page === page);
    const nBad = rows.filter((r) => !r.ok).length;
    console.log('\n  ' + page + (nBad ? '   ✗ ' + nBad + '/' + rows.length : '   ✓ ' + rows.length));
    for (const r of rows) {
      const box = r.m && r.m.rect ? r.m.rect.w + '×' + r.m.rect.h + ' @' + r.m.rect.x + ',' + r.m.rect.y : '-';
      if (r.ok) console.log('    ✓ ' + r.sel.padEnd(42) + ' ' + box);
      else console.log('    ✗ ' + r.sel.padEnd(42) + ' ' + box + '\n        ↳ ' + r.fail.join(' ｜ ') + '\n        ↳ 为什么必须看得见：' + r.why);
    }
  }
  if (offscreen.length) {
    console.log('\n  提示（不算红）：' + offscreen.length + ' 条有盒子但在视口外 —— 卷一下才看得见');
    for (const r of offscreen) console.log('    · ' + r.page + ' → ' + r.sel);
  }
  console.log('');
  console.log(`通过 ${res.length - bad.length} ｜ 断点 ${bad.length} ｜ 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/* ── 负控 ─────────────────────────────────────────────────────── */
let negFail = 0;
if (NEGCTL) {
  /* 负控和 --json 一起用时，人读的行会污染 JSON ⇒ 这里只往 stderr 写 */
  const say = JSON_OUT ? (s) => process.stderr.write(s + '\n') : (s) => console.log(s);
  /* 四条判定各配一个真注入。只做「零盒子」不够：
     第③④条（祖先裁掉 / 祖先透明）是「看着在、实际看不见」的主要来源，
     而它们恰恰是 ①② 那两种注入照不到的盲区 —— 所以必须各自单独证一次。 */
  const CASES = [
    { id: '①零盒子', mode: 'zero', onPage: 'apps.html', target: '.sider', want: '尺寸为零' },
    { id: '②整页消失', mode: 'blank', onPage: null, target: null, want: 'display:none' },
    { id: '③被祖先裁掉', mode: 'clip', onPage: 'apps.html', target: '#grid .kcard', want: '被祖先裁掉' },
    { id: '④祖先透明', mode: 'opacity', onPage: 'apps.html', target: '#grid .kcard', want: 'opacity=0' },
  ];
  for (const k of CASES) {
    const r = await run({ mode: k.mode, onPage: k.onPage, target: k.target });
    if (k.mode === 'blank') {
      const red = r.filter((x) => !x.ok);
      const ok = red.length === r.length;
      say(`${k.id}：注入 *{display:none!important} → ${r.length} 条都该红`);
      say((ok ? '  ✓ 抓住了：' : '  ✗ 没抓住：') + red.length + '/' + r.length + ' 条红' +
        (red.length ? '（例：' + red[0].page + ' → ' + red[0].sel + ' → ' + red[0].fail.join(' ｜ ') + '）' : ''));
      if (!ok) negFail++;
      continue;
    }
    const hit = r.find((x) => x.page === k.onPage && x.sel === k.target);
    const ok = !!hit && !hit.ok && hit.fail.some((f) => f.startsWith(k.want));
    const desc = k.mode === 'zero' ? '把 ' + k.target + ' 压成零盒子'
      : k.mode === 'clip' ? '把 ' + k.target + ' 的父元素压成 height:0 + overflow:hidden'
      : '把 ' + k.target + ' 的父元素设成 opacity:0';
    say(`${k.id}：${desc}`);
    say((ok ? '  ✓ 抓住了：' : '  ✗ 没抓住：') + (hit ? hit.sel + ' → ' + (hit.fail.join(' ｜ ') || '竟然还是绿的') : '没量到'));
    if (!ok) negFail++;
  }
  say('');
  say(negFail ? '✗ 负控没成立：这个判据现在证明不了自己会红' : '负控成立：四条判定各自都被注入抓到，且都指名到了那一条');
}

chrome.kill();
/* 负控恒为 2；正控按断点。负控没成立也要非 0 —— 不能靠"跑完了"当通过。 */
process.exit(NEGCTL ? 2 : (bad.length ? 2 : 0));
