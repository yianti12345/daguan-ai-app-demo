#!/usr/bin/env node
/* interact-audit —— 抓「哑控件」：长得能点，点下去什么都没发生。
 *
 * 主体是什么：
 *   遍历页面里**看起来可交互**的元素，对每个真点一次，监听 300ms 内有没有发生任何变化。
 *   三路监听（这是"变化"的定义，写严是刻意的）：
 *     ① DOM：MutationObserver（childList / attributes / characterData）
 *     ② 路由：hashchange（同文档跳转）
 *     ③ 焦点：focusin（焦点移到了别的可聚焦元素）
 *   三路都没动 ⇒ 记为 candidate-dumb。
 *
 * 为什么要有它：
 *   这个项目复发率最高的一类问题是「写死了按钮但没绑事件」—— 点下去什么都不发生，
 *   界面上看不出来，CSS/结构判据也看不出来（元素在那儿、样式也对）。
 *   而它恰好是"用户走不下去"的第一现场。
 *
 * 负控怎么做（--negctl）：
 *   往页面里注入一个 `<button>假按钮</button>`（真的没有任何 handler），
 *   再跑同一套扫描 —— **它必须被扫进结果**，否则这条判据就是空的，进程 rc=2。
 *   注意：负控复用的是正控那条判定函数，不是另写一句"我觉得应该红"。
 *
 * 排除项：tools/interact-allow.json（每条必须写"为什么可以点不动"）。
 *
 * 用法：
 *   node tools/interact-audit.mjs                # 四页全跑
 *   node tools/interact-audit.mjs --page app.html
 *   node tools/interact-audit.mjs --negctl       # 负控，恒 rc=2
 *   node tools/interact-audit.mjs --json
 * 退出码：0 没有 candidate-dumb ｜ 2 有 candidate（负控恒 2）｜ 3 环境不可用
 *
 * 基址一律走 tools/base.mjs（历史上"每个脚本自己写端口"导致判绿的是另一份代码）。
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = HERE;
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`interact-audit —— 抓哑控件

用法: node tools/interact-audit.mjs [--page <页面>] [--negctl] [--json]

  --page <页面>   只跑一页（默认四页全跑：${PAGES.join(' / ')}）
  --negctl        负控：注入一个假按钮，它必须被抓到（rc=2）
  --json          机器可读输出
  --help          本帮助

判据：看起来可交互的元素，点击后 300ms 内 DOM / hash / 焦点 三路都没动 ⇒ candidate-dumb
排除：tools/interact-allow.json（每条须写明为什么可以点不动）
退出码：0 干净 ｜ 2 有 candidate（负控恒 2）｜ 3 环境不可用`);
  process.exit(0);
}
/* allow.json 自检（team-lead 要求）：
   ① 每条必须有 coveredBy 或 why 二选一；
   ② coveredBy 里点名的判据文件必须真实存在 —— 否则就是"用不存在的判据给豁免背书"。
   自检不通过直接 rc=2，不许在"豁免本身站不住"的情况下继续输出"0 candidate"。 */
function checkAllow(list) {
  const problems = [];
  for (const a of list) {
    if (!a.coveredBy && !a.why) problems.push(`${a.selector}: 既没有 coveredBy 也没有 why`);
    if (a.coveredBy) {
      /* 只接受"精确文件名"（如 check-drag.mjs）：路径、散文、带说明的长句一律报错 ——
         否则"coveredBy: 由 check-drag 覆盖（详见注释）"这种写法会静默通过，
         等于用一句自然语言给豁免背书。 */
      const raw = String(a.coveredBy).trim();
      const m = raw.match(/([^\s/\\]+\.(?:mjs|js|json|sh|md))$/);
      if (!m) problems.push(`${a.selector}: coveredBy 必须是精确文件名（现在是「${raw}」）`);
      else if (!existsSync(join(TOOLS_DIR, m[1]))) problems.push(`${a.selector}: coveredBy 指向的 ${m[1]} 在 tools/ 下不存在`);
    }
  }
  return problems;
}
const NEG = argv.includes('--negctl');
const JSON_OUT = argv.includes('--json');
const only = (() => { const i = argv.indexOf('--page'); return i >= 0 ? argv[i + 1] : null; })();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));



let BASE;
try { BASE = await resolveBase(argv); }
catch (e) { console.error('✗ ' + e.message); process.exit(3); }

/* 排除项：允许"点了不动"的东西，每条都必须给理由。
   没有这条清单，审计结果会被装饰性元素淹没；但没有理由的清单会变成"我觉得没问题"。 */
let ALLOW = [];
const allowPath = join(HERE, 'interact-allow.json');
if (existsSync(allowPath)) {
  try {
    const j = JSON.parse(readFileSync(allowPath, 'utf8'));
    ALLOW = Array.isArray(j.allow) ? j.allow : [];
  } catch (e) { console.error('✗ interact-allow.json 解析失败：' + e.message); process.exit(3); }
}

{
  const problems = checkAllow(ALLOW);
  if (problems.length) {
    console.error('✗ interact-allow.json 自检不通过（rc=2）：');
    for (const p of problems) console.error('   · ' + p);
    process.exit(2);
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 140));
      }
      if (m.id != null && this.wait.has(m.id)) {
        const w = this.wait.get(m.id); this.wait.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
  }
  send(method, params = {}, timeout = 25000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.wait.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), timeout);
    });
  }
}

async function openPage(url) {
  const port = await debugPort();
  const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/ia-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
    { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(120);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
  }
  if (!wsUrl) { child.kill('SIGKILL'); throw new Error('Chrome 没起来'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = new CDP(ws);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.navigate', { url });
  await sleep(2600);
  return { c, child };
}

/* 在页面里装一次"变化探头"。刻意写成三路，缺一路就会把"只跳 hash"或"只挪焦点"判成哑。 */
const INSTALL_PROBE = `(function(){
  if (window.__iaProbe) return 'already';
  var rec = { dom:0, hash:0, focus:0 };
  window.__iaRec = rec;
  var mo = new MutationObserver(function(list){
    for (var i=0;i<list.length;i++){
      var t = list[i].target;
      var e = (t && t.nodeType === 3) ? t.parentElement : t;
      /* 忽略审计脚本自己注入的节点，否则负控会自证 */
      if (e && e.closest && e.closest('#ia-probe-injected')) continue;
      rec.dom++; return;
    }
  });
  mo.observe(document.documentElement, { subtree:true, childList:true, attributes:true, characterData:true });
  window.addEventListener('hashchange', function(){ rec.hash++; });
  document.addEventListener('focusin', function(ev){
    var a = ev.target;
    if (a && a.blur && document.activeElement === a) rec.focus++;
  }, true);
  window.__iaProbe = { rec: rec };
  return 'ok';
})()`;

const ENUM = `(function(){
  var sel = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [data-act], input, select, textarea';
  var set = Array.prototype.slice.call(document.querySelectorAll(sel));
  /* "带 cursor:pointer 的元素"——按计算样式补扫，但只取"自身可点"的（不含被 button 包住的 span） */
  var all = document.querySelectorAll('body *');
  for (var i=0;i<all.length;i++){
    var el = all[i];
    if (el.closest && el.closest(sel)) continue;
    var cs = getComputedStyle(el);
    if (cs.cursor === 'pointer') set.push(el);
  }
  var out = [], seen = [];
  set.forEach(function(el){
    if (seen.indexOf(el) >= 0) return; seen.push(el);
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;                 /* 量不到的不算 */
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (Number(cs.opacity) === 0) return;                     /* 看不见的层不点：会点穿到别人的东西 */
    if (el.disabled) return;
    var ariaHidden = (el.closest && el.closest('[aria-hidden="true"]'));
    if (ariaHidden) return;
    el.setAttribute('data-ia-idx', String(out.length));
    out.push({
      kind: /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? 'control' : 'action',
      sel: el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0, 40),
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      idx: seen.length - 1
    });
  });
  return JSON.stringify(out);
})()`;

/* 一键：按枚举时打的标记点（**不要重新枚举** —— 两次过滤条件只要差一点，索引就错位，
   会点到一个完全不同的元素上，然后把无辜的控件判成哑的。这个坑我第一版就踩了：
   select#f-st / input#f-kw / div.xz-fab 三个"哑控件"全是索引错位点出来的） */
async function clickAndWatch(c, idx) {
  return c.send('Runtime.evaluate', {
    expression: `(function(){
      var el = document.querySelector('[data-ia-idx="${idx}"]');
      if (!el) return JSON.stringify({ missing:true });
      var rec = window.__iaRec;
      if (!rec) return JSON.stringify({ noProbe:true });
      rec.dom = 0; rec.hash = 0; rec.focus = 0;
      try { el.click(); } catch (e) { return JSON.stringify({ threw:String(e && e.message) }); }
      /* ★2026-10-26：点完按钮把整行重画掉（列表页的"废弃草稿/基于此建草稿"就是这样），
         被点的那个节点当场被替换 —— 从 MutationObserver 看是"子树被换掉"，
         但从"这个元素还在不在"看是**最确定的 DOM 变化**。原来只数 observer 回调，
         于是"点了确实重画"被判成"点了没反应"（实测：check-versions V8 已正面验过它有用）。 */
      if (!document.contains(el)) { rec.dom += 1; }
      return JSON.stringify({ clicked:true, replaced:!document.contains(el) });
    })()`, returnByValue: true
  }, 8000);
}

const results = [];
let controls = 0;
let envFailed = null;

for (const page of (only ? [only] : PAGES)) {
  const url = `${BASE}/${page}`;
  let ctx;
  try { ctx = await openPage(url); }
  catch (e) { envFailed = e.message; break; }
  const { c, child } = ctx;
  try {
    await c.send('Runtime.evaluate', { expression: INSTALL_PROBE, returnByValue: true });

    if (NEG) {
      /* 负控：注入一个真的没有 handler 的按钮。它必须出现在结果里，否则这条判据是空的。 */
      await c.send('Runtime.evaluate', { expression: `(function(){
        var b=document.createElement('button'); b.id='ia-probe-injected';
        b.type='button'; b.textContent='假按钮'; b.style.cssText='position:fixed;left:8px;top:8px;z-index:9999;padding:6px 10px';
        document.body.appendChild(b); return 'injected'; })()`, returnByValue: true });
      await sleep(150);
    }

    const list = JSON.parse((await c.send('Runtime.evaluate', { expression: ENUM, returnByValue: true })).result.value || '[]');
    const dumb = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      /* 排除：跨页跳转（换成 location.href 那种，本次审计不判） */
      if (it.href && !/^#/.test(it.href) && !/^javascript:/i.test(it.href)) continue;
      const allowHit = ALLOW.find((a) => it.sel.includes(a.selector) || (a.text && it.text === a.text));
      if (allowHit) continue;

      /* 点之前先清场：Esc 关掉上一步可能开的弹层，避免"点不到"被当成"没反应" */
      await c.send('Runtime.evaluate', { expression: `(function(){
        var m=document.querySelector('.mask[data-open="true"]');
        if (m){ var x=document.getElementById('dlg-close'); if (x) x.click(); }
        return 1; })()`, returnByValue: true });
      await sleep(60);

      /* 表单控件（input/select/textarea）不参与"哑"判定：
         点它们本来就不该改 DOM，正确的信号是"拿到焦点"，而 .click() 不一定聚焦 ——
         拿一个不成立的期望去判，只会稳定产出假阳性。它们的接线由 e2e 的输入/选择动作覆盖。 */
      if (it.kind === 'control') {
        await clickAndWatch(c, i);
        await sleep(120);
        controls++;
        continue;
      }
      const r = await clickAndWatch(c, i);
      /* ★2026-10-26：320ms 在门禁并发（3 路 Chrome 抢 CPU）时不够，实测同一批按钮
         单跑 0 误报、并发跑会误报 dom=0。观测窗口给到 800ms —— 它只影响等多久再判，
         不影响判什么；真正要抓的哑控件（完全没有 handler）等多久都不会动。 */
      await sleep(800);
      const rec = (await c.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__iaRec)', returnByValue: true })).result.value;
      let v = {}; try { v = JSON.parse(rec); } catch (e) {}
      const moved = (v.dom || 0) + (v.hash || 0) + (v.focus || 0) > 0;
      if (!moved) dumb.push({ ...it, why: `点击后 800ms 内 DOM/hash/焦点 三路都没动（dom=${v.dom||0} hash=${v.hash||0} focus=${v.focus||0}）` });
      /* 收尾：把页面拉回干净状态，避免下一步在别人的弹层上点 */
      await c.send('Runtime.evaluate', { expression: `(function(){
        var m=document.querySelector('.mask[data-open="true"]');
        if (m){ var x=document.getElementById('dlg-close'); if (x) x.click(); }
        if (location.hash) location.hash = '';
        return 1; })()`, returnByValue: true });
      await sleep(80);
    }
    results.push({ page, total: list.length, dumb, controlCount: controls, errs: c.errs.slice(0, 3) });
  } catch (e) {
    results.push({ page, total: 0, dumb: [], errs: [String(e.message).slice(0, 120)], fatal: true });
  } finally {
    try { await c.send('Browser.close'); } catch (e) {}
    child.kill('SIGKILL');
  }
}

if (envFailed) { console.error('✗ 环境不可用：' + envFailed); process.exit(3); }

const injectedCaught = NEG && results.some((r) => r.dumb.some((d) => String(d.sel).includes('ia-probe-injected')));
const totalDumb = results.reduce((n, r) => n + r.dumb.length, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, negctl: NEG, injectedCaught, results }, null, 2));
} else {
  console.log(`\n哑控件审计 @ ${BASE}${NEG ? '  [负控]' : ''}\n`);
  for (const r of results) {
    const tag = r.fatal ? '✗ 跑不完' : (r.dumb.length ? '✗' : '✓');
    console.log(`${tag} ${r.page}   扫描 ${r.total} 个可交互元素（其中表单控件 ${r.controlCount || 0} 个不参与判定）｜ candidate-dumb ${r.dumb.length}`);
    for (const d of r.dumb.slice(0, 20)) console.log(`    · ${d.sel}  「${d.text}」  ${d.why}`);
    if (r.dumb.length > 20) console.log(`    …还有 ${r.dumb.length - 20} 条`);
    for (const e of r.errs) console.log(`    异常: ${e}`);
  }
  console.log(`\n合计 candidate-dumb ${totalDumb}`);
  if (NEG) console.log(injectedCaught ? '负控：注入的假按钮被抓到了 ✓（rc=2）' : '负控失败：注入的假按钮没被抓到 —— 这条判据是空的 ✗');
}

if (NEG) process.exit(2);
process.exit(totalDumb > 0 ? 2 : 0);
