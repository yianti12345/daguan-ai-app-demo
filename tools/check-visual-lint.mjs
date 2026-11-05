#!/usr/bin/env node
/* check-visual-lint —— 视觉默认做法与可读性（外部 lint + 自查对比度，双证）
 *
 * 为什么有它：2026-10-25 用户令「全面优化工作全流程」。此前门禁里有 60 多个判据，
 * 但没有一条在管「页面像不像模板 / 字够不够清楚」——这两件事一直被当作"审美"，
 * 靠人看一眼。可它们是**可机械判的 CSS 特征**，人看一眼必然漏。
 *
 * 两部分，互为双证：
 *   A 外部 lint（oil-ui 的 shoot.mjs，14 条规则，规则表见 shoot.mjs:720）
 *     —— 便宜、覆盖广，但它是别人写的，背景取值与元素定位不一定对我们的页面成立。
 *   B 自查对比度（本文件自带，CDP 拿 computed color 按 alpha 合成到真实背景）
 *     —— 只查一件事：正文 ≥4.5:1、大字 ≥3:1。它只信浏览器算出来的值。
 *   两方都红 = 真缺陷；一方红一方绿 = 打印「待核」并判红（不许当绿，也不许当误报放过）。
 *
 * 判定：
 *   可读性四项（contrastLow / smallText / tightLeading / stuck）命中数必须为 0。
 *   其余默认做法（eyebrow / numbered / sideStripe / gradientText / nestedCards / emojiIcon /
 *   englishLabel / grayOnColor / longMeasure / headingSpacing）命中可以存在，但必须逐条
 *   在 tools/lint-allow.tsv 有落款（选择器 + 理由 + 到期日）。到期日空缺或已过 = 红。
 *   sourceSplit（单文件过大）只打印，不计红：它是工程问题，不是视觉问题。
 *
 * 用法：
 *   node tools/check-visual-lint.mjs                 两部分都跑（门禁用这个）
 *   node tools/check-visual-lint.mjs --contrast      只跑 B（快，改色时用）
 *   node tools/check-visual-lint.mjs --defaults      只跑 A（慢，约 40s：要起 oil 的浏览器）
 *   node tools/check-visual-lint.mjs --report        只打印不判红（出账用，rc 恒 0）
 *   node tools/check-visual-lint.mjs --negctl        负控：每页注入白字白底探针，必须被逐页抓到且 rc=2
 *
 * 页面清单：一律从 tools/pages.mjs 取（唯一来源）。新增一页只改 pages.mjs，
 *   本判据自动跟上 —— 没有显示名会回落成 URL 并在启动时点名，而不是安静跳过。
 *
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 未量（服务没起 / oil-ui 没装 / Chrome 起不来 / 量不到 /
 *        负控探针没被命中——"抓不到必然违规"等于这条判据自己坏了）
 */
import { resolveBase, debugPort } from './base.mjs';
/* ★2026-10-26：清单从 tools/pages.mjs 取，不再在本文件里另写一份。
 *   病：这里原本硬编码四页（apps/components/app?/component），**没有 versions.html**。
 *   于是版本管理页的对比度、裸色值、边框、侧边条**一条门禁都没盯着**。
 *   而 check-gate-coverage 看不见这种漏 —— 它管"判据有没有跑"，不管"跑了但少看一页"。
 *   规矩（pages.mjs 文件头自己写的）：不允许任何判据自己写页面数组。照办。 */
import { PAGES as PAGE_URLS } from './pages.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ALLOW = join(HERE, 'lint-allow.tsv');
const OIL = process.env.OIL_UI_SKILL || '/Users/zhengshiji/.dsh/skills/oil-ui';
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const ARGV = process.argv.slice(2);
const ONLY_B = ARGV.includes('--contrast');
const ONLY_A = ARGV.includes('--defaults');
const REPORT = ARGV.includes('--report');
const NEG = ARGV.includes('--negctl');
const DO_A = !ONLY_B;
const DO_B = !ONLY_A;

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
/* 显示名只影响打印，不影响覆盖。**没有显示名的页面照样被检**（回落成 URL 本身），
   并在启动时点名提醒 —— 这样"新增一页"只会导致"名字难看"，不会导致"少看一页"。 */
const LABELS = {
  'apps.html': '应用列表',
  'components.html': '组件库',
  'app.html?id=hx-zc': '配置页（应用）',
  'component.html': '配置页（组件）',
  'versions.html?scope=app&id=hx-zc': '版本管理（应用 hx-zc）',
  'versions.html?scope=comp&id=task-list': '版本管理（组件 task-list）',
};
const PAGES = PAGE_URLS.map((u) => [u, LABELS[u] || u]);
const UNLABELED = PAGE_URLS.filter((u) => !LABELS[u]);

/* ── 例外账 ───────────────────────────────────────────────────────
 * 一条一行的理由。没有理由的放行就是假绿，所以 reason 空 = 该行无效。
 * 列：rule  scope  selector  reason  expires  by
 *   scope: a = 只在 A 生效 ｜ b = 只在 B 生效 ｜ both = 两边都认
 *   selector: 对 A 是元素选择器片段（匹配 report 里的 snippet），对 B 是精确选择器
 */
function loadAllow() {
  if (!existsSync(ALLOW)) return [];
  const rows = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const line of readFileSync(ALLOW, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (/^rule\tscope/.test(line)) continue;
    const [rule, scope, selector, reason, expires, by] = line.split('\t');
    if (!rule) continue;
    let bad = '';
    if (!reason || !reason.trim()) bad = 'reason 为空';
    else if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) bad = 'expires 不是日期';
    else if (expires < today) bad = '已过期 ' + expires;
    rows.push({ rule, scope: scope || 'both', selector: selector || '', reason, expires, by, bad });
  }
  return rows;
}
const ALLOWED = loadAllow();
const badAllow = ALLOWED.filter((a) => a.bad);
function allowed(rule, where, sel) {
  const s = String(sel || '');
  return ALLOWED.find((a) => {
    if (a.bad || a.rule !== rule) return false;
    if (a.scope !== 'both' && a.scope !== where) return false;
    if (!a.selector) return true;
    /* 选择器按空格切成若干片段，**每一段都要在定位串里出现**（AND 语义）。
       单个片段太宽（比如 `a`），多写几段就能收窄到"侧栏当前项"这种程度。 */
    return a.selector.trim().split(/\s+/).every((t) => s.includes(t));
  });
}

const fails = [];
const unmeasured = [];
/* B（自查）跑出来的事实，供 A 的交叉核对用。B.started＝B 真的量过，不是"应该没问题"。 */
const B = { started: false, waived: [] };
const ok = (n, d) => console.log('  ✓ ' + n + (d ? '：' + d : ''));
const bad = (n, d) => { fails.push(n + ' —— ' + d); console.log('  ✗ ' + n + '：' + d); };

/* ══ B 部分：全站文字对比度（自查） ══════════════════════════════ */
const MEASURE = `(function(){
  function rgb(s){ var m=String(s).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
  function L(c){ function f(v){v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);} return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function over(fg,bg){ var a=fg.a; return {r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1}; }
  function ratio(a,b){ var x=L(a), y=L(b); return +(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)); }
  function hex(c){ function h(v){ return ('0'+Math.round(v).toString(16)).slice(-2); } return '#'+(h(c.r)+h(c.g)+h(c.b)).toUpperCase(); }
  /* 背景：向上找第一层不透明底色。半透明底逐层合成；遇到渐变/图片就标 blocked（量不准，交人看） */
  function bgOf(e){
    var stack=[], cur=e, blocked=false;
    while(cur){
      var cs=getComputedStyle(cur);
      if(cs.backgroundImage && cs.backgroundImage!=='none' && /gradient|url\\(/.test(cs.backgroundImage)) { blocked=true; break; }
      var c=rgb(cs.backgroundColor);
      if(c && c.a>0.004) stack.push(c);
      if(c && c.a>0.95) break;
      cur=cur.parentElement;
    }
    var acc={r:255,g:255,b:255,a:1};
    for(var i=stack.length-1;i>=0;i--) acc=over(stack[i],acc);
    return {c:acc, blocked:blocked};
  }
  /* 定位串：自己 + 最多三层祖先，写成「祖先 > 祖先 > 自己」。
     只写 tag+class 不行：侧栏当前项是个没有 class 的 <a>，全站所有 <a> 都会撞在一起，
     例外账就只能写"所有链接都放行"——那等于没判。带上祖先才收得住。 */
  function tagCls(e){
    if(!e || !e.tagName) return '';
    var s=e.tagName.toLowerCase();
    if(e.id) s+='#'+e.id;
    if(e.className && typeof e.className==='string'){
      var cls=e.className.trim().split(/\\s+/).filter(Boolean).slice(0,2);
      if(cls.length) s+='.'+cls.join('.');
    }
    if(e.getAttribute && e.getAttribute('aria-current')) s+='[aria-current]';
    return s;
  }
  function sel(e){
    var parts=[], cur=e, n=0;
    while(cur && cur!==document.body && n<4){ parts.unshift(tagCls(cur)); cur=cur.parentElement; n++; }
    return parts.join(' > ') || tagCls(e);
  }
  var out=[], seen={};
  var all=document.body.querySelectorAll('*');
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(/^(SCRIPT|STYLE|NOSCRIPT|SVG|CANVAS|IMG|VIDEO|IFRAME|INPUT|TEXTAREA|SELECT|OPTION|BR)$/.test(el.tagName)) continue;
    var t='';
    for(var j=0;j<el.childNodes.length;j++){ var nd=el.childNodes[j]; if(nd.nodeType===3) t+=nd.nodeValue; }
    t=t.replace(/\\s+/g,' ').trim();
    if(!t) continue;
    var cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none') continue;
    if(parseFloat(cs.opacity)<0.15) continue;
    if(el.closest('[hidden]')) continue;
    var r=el.getBoundingClientRect();
    if(r.width<1||r.height<1) continue;
    var fg=rgb(cs.color); if(!fg||fg.a<0.05) continue;
    var b=bgOf(el); if(b.blocked) continue;
    var eff=over(fg,b.c);
    var px=parseFloat(cs.fontSize)||16, w=parseInt(cs.fontWeight)||400;
    var large = px>=24 || (px>=18.66 && w>=700);
    var need = large?3:4.5;
    var rr = ratio(eff,b.c);
    if(rr+1e-9>=need) continue;
    /* WCAG 1.4.3 豁免 inactive 控件：只有**本来会判红**才记一笔，不是把 disabled 全放过。
       2026-10-27：版本页「基于此建草稿」是 disabled（#B3B6BF on #EEF2FF = 1.82:1），
       把禁用态调成可读＝让它看起来可用，所以判据让步；条数会打印，不静默。 */
    if(el.disabled===true || (el.getAttribute&&el.getAttribute('aria-disabled')==='true')
       || (el.closest&&el.closest('[aria-disabled="true"]'))){ out.push({sel:'__disabled_waived__'}); continue; }
    var s=sel(el);
    var key=s+'|'+t+'|'+rr;
    if(seen[key]) continue; seen[key]=1;
    out.push({sel:s, text:t.slice(0,24), declared:cs.color, effHex:hex(eff), bgHex:hex(b.c),
      ratio:rr, need:need, fontPx:px, weight:w});
    if(out.length>=150) break;
  }
  out.sort(function(a,b){ return a.ratio-b.ratio; });
  return out;
})()`;

async function runContrast() {
  const BASE = await resolveBase();
  const port = await debugPort();
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/vislint-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  if (!ws) { console.log('SKIP: Chrome 起不来（' + CHROME + '）'); unmeasured.push('chrome'); return; }
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

  setTimeout(() => { console.log('GATE TIMEOUT: B 部分 120s 没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 120000);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const all = [];
  /* 负控账：**逐页**记探针有没有被抓到。这比"整站注入一遍灰字、看 rc 非 0"强在两点：
     ① 灰字注入会让全站几百处一起变红，探针被淹在后面，命不命中看不出来；
     ② 逐页命中同时证明"这一页真的被量了" —— 覆盖缺口正是这么漏掉的。 */
  const probe = [];
  let disabledWaived = 0;
  for (const [url, label] of PAGES) {
    try {
      await send('Page.navigate', { url: BASE + '/' + url });
      await SLEEP(900);
      if (NEG) {
        /* 白字压白底 = 1.00:1，必然违规，且没有任何"可能是设计意图"的解释空间。
           插在 body 最前：MEASURE 收集到 150 条就 break，插在末尾会被挤掉。 */
        await ev(`(function(){
          var d=document.createElement('div'); d.id='negctl-probe'; d.textContent='负控探针';
          d.setAttribute('style','display:block;width:160px;height:24px;background:#FFFFFF;'+
            'color:#FFFFFF;font-size:14px;line-height:24px');
          document.body.insertBefore(d, document.body.firstChild); return 1;})()`);
        await SLEEP(150);
      }
      const rowsRaw = await ev(MEASURE);
      if (!Array.isArray(rowsRaw)) { unmeasured.push(label); continue; }
      disabledWaived += rowsRaw.filter((r) => r.sel === '__disabled_waived__').length;
      const rows = rowsRaw.filter((r) => r.sel !== '__disabled_waived__');
      if (NEG) {
        const hit = rows.filter((r) => String(r.sel).includes('negctl-probe'));
        probe.push({ label, url, n: hit.length, sel: hit[0]?.sel || '', ratio: hit[0]?.ratio ?? null });
        /* 探针**留在违规账里**：它就是一处注入的必违缺陷，判据要是看不见它才是出事了。
           于是"抓到了" ⇒ 违规账非空 ⇒ rc=2（负控期望的"必须变红"），
           "没抓到" ⇒ 下面置 negctlBroken ⇒ rc=3（判据自己瞎了，不是页面有问题）。 */
      }
      for (const r of rows) all.push({ page: url, label, ...r });
      console.log(`  · ${label} 量到 ${rows.length} 处低于阈值`);
    } catch (e) {
      unmeasured.push(label + '（' + e.message.slice(0, 40) + '）');
    }
  }
  try { chrome.kill('SIGKILL'); } catch (e) {}

  let negctlBroken = false;
  if (NEG) {
    const missed = probe.filter((p) => !p.n);
    if (missed.length || probe.length !== PAGES.length) {
      negctlBroken = true;
      bad('负控未命中', `${probe.length - missed.length}/${PAGES.length} 页抓到注入的白字白底 div#negctl-probe`
        + (probe.length !== PAGES.length ? `（另有 ${PAGES.length - probe.length} 页压根没量到）` : '')
        + ' —— 抓不到必然违规＝这条判据对那几页是瞎的');
      for (const m of missed.slice(0, 6)) console.log(`     ✗ ${m.label}（${m.url}） 未命中`);
    } else {
      ok('负控', `${probe.length}/${PAGES.length} 页均命中 div#negctl-probe「${probe[0].sel}」= ${probe[0].ratio}:1（需 ≥4.5）—— 逐页都真的量了`);
    }
  }

  const real = [], waived = [];
  for (const r of all) (allowed('contrast', 'b', r.sel) ? waived : real).push(r);
  /* B 真的量过，才把它的事实交给 A 做交叉核对（放在 real/waived 之后：之前是 TDZ，直接抛错） */
  B.started = true;
  B.waived = waived;

  const line = (r) => `${r.label}｜${r.sel}「${r.text}」${r.declared} → ${r.effHex} on ${r.bgHex} = ${r.ratio}:1（需 ≥${r.need}）`;
  if (disabledWaived) {
    console.log(`  － inactive 控件豁免 ${disabledWaived} 处（disabled/aria-disabled，WCAG 1.4.3 明确豁免，不是少算）`);
  }
  if (waived.length) {
    console.log(`  － 例外账放行 ${waived.length} 处（tools/lint-allow.tsv，逐条有理由与到期）`);
    for (const r of waived.slice(0, 8)) console.log('     · ' + line(r));
  }
  if (real.length) {
    bad('全站文字对比度', `${real.length} 处低于 WCAG AA（前 12 条按比值升序）`);
    for (const r of real.slice(0, 12)) console.log('     ✗ ' + line(r));
    if (real.length > 12) console.log(`     … 其余 ${real.length - 12} 处见 _reports/lint/ 落盘`);
  } else if (!unmeasured.length) {
    ok('全站文字对比度', `${PAGES.length} 个页面全部文字 ≥ AA（正文 4.5 / 大字 3.0）`);
  }
  writeFileSync(join(HERE, '..', '.vislint-last.json'),
    JSON.stringify({ at: new Date().toISOString(), part: 'B', pages: PAGE_URLS, probe, violations: real, waived, unmeasured }, null, 1));
  return negctlBroken;
}

/* ══ A 部分：外部 lint（oil-ui shoot.mjs） ══════════════════════ */
const READABILITY = new Set(['contrastLow', 'smallText', 'tightLeading', 'stuck']);
const PRINT_ONLY = new Set(['sourceSplit']);

function shootOnce(page, out) {
  return new Promise((resolve) => {
    /* 带查询串的页面不能直接当文件路径传（shoot 会去找名为 `app.html?id=hx-zc` 的文件，rc=1）。
       拆成「文件 + --query」，这是它自己的约定（shoot.mjs:27）。 */
    const [file, qs] = page.split('?');
    const args = [join(OIL, 'scripts/shoot.mjs'), file, '--size', 'desktop',
      '--root', ROOT, '--out', out];
    if (qs) args.push('--query', qs);
    /* ★2026-11-01：本机 headless Chrome 报 `sandbox initialization failed:
       Operation not permitted`，子进程反复崩 ⇒ DevTools 连上就断 ⇒ 7 页一页都量不到。
       走项目内的包装脚本补 --no-sandbox（不动全局 oil-ui 技能，那是别的项目也在用的）。
       包装脚本不在就退回原样，不因为缺包装而整体失败。 */
    const wrapper = join(ROOT, 'tools', 'chrome-nosandbox.sh');
    const env = existsSync(wrapper) ? { ...process.env, CHROME_PATH: wrapper } : process.env;
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let log = '';
    p.stdout.on('data', (d) => { log += d; });
    p.stderr.on('data', (d) => { log += d; });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 90000);
    p.on('close', (rc) => { clearTimeout(t); resolve({ rc, log }); });
  });
}

async function runDefaults() {
  if (!existsSync(join(OIL, 'scripts/shoot.mjs'))) {
    console.log('SKIP: oil-ui 没装（' + OIL + '），A 部分未量');
    unmeasured.push('oil-ui');
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outRoot = join(ROOT, '_reports', 'lint', stamp);
  mkdirSync(outRoot, { recursive: true });

  const hits = [];      // {rule, page, snippet, detail}
  let aMeasured = 0;    // A 真的拿到了几页的 report.json —— 0 页时下面的"0 条"一条都不成立
  for (const [page, label] of PAGES) {
    const out = join(outRoot, page.replace(/[^a-z.]/g, '_'));
    const { rc, log } = await shootOnce(page, out);
    const rj = join(out, 'report.json');
    if (!existsSync(rj)) {
      unmeasured.push(label + '（shoot rc=' + rc + '）');
      /* 把 shoot 自己的死因抄一行出来：否则"rc=1"会被当成"页面坏了"，
         而实际多半是「浏览器连接意外断开」（并发抢 Chrome）——两件事的修法完全不同。 */
      const why = (log.split('\n').filter((l) => /shoot：/.test(l))[0] || log.trim().split('\n').pop() || '').trim();
      console.log(`  ？ ${label}：没出 report.json（rc=${rc}）${why ? ' —— ' + why.slice(0, 120) : ''}`);
      continue;
    }
    aMeasured++;
    let rep;
    try { rep = JSON.parse(readFileSync(rj, 'utf8')); } catch (e) { unmeasured.push(label + '（report 解析失败）'); continue; }
    const arr = Array.isArray(rep) ? rep : [rep];
    let n = 0;
    for (const item of arr) {
      for (const h of item.lint || []) {
        if (!h || !h.rule) continue;
        /* 真实结构是 {rule,label,count,examples[]}（shoot.mjs 只给前几条例子）。
           一条规则算一个 key，例子逐条摊开，例外账才能按选择器逐条落款。 */
        const exs = (h.examples && h.examples.length) ? h.examples : [''];
        for (const ex of exs) {
          n++;
          hits.push({ rule: h.rule, page: label, snippet: ex, detail: h.label || '', total: h.count || exs.length });
        }
        if (!h.examples || !h.examples.length) n++;
      }
    }
    console.log(`  · ${label}：lint 命中 ${n} 条（取证 ${out}）`);
  }

  const byRule = new Map();
  for (const h of hits) {
    const k = h.rule;
    if (!byRule.has(k)) byRule.set(k, []);
    byRule.get(k).push(h);
  }

  for (const [rule, list] of [...byRule.entries()].sort()) {
    if (PRINT_ONLY.has(rule)) {
      console.log(`  － ${rule}（只打印，不计红）：${list.length} 条 —— ${list[0].detail}`);
      continue;
    }
    /* contrastLow 的裁决权归 B（自查，量全站每一处文字）；A 这里只做**交叉核对**：
       它报的每一条，B 那边必须也能解释（要么是 B 认定的真缺陷＝B 已经判红，要么在例外账里）。
       对不上＝两边有一个漏了，红——不许用"工具说没事"盖过去。 */
    if (rule === 'contrastLow' && B.started) {
      const unexplained = list.filter((h) => {
        const m = /（([\d.]+):1）/.exec(h.snippet);
        const t = /「([^」]*)」/.exec(h.snippet);
        const ratio = m ? +m[1] : null;
        const txt = t ? t[1] : '';
        /* 比值要一样、文本也要对得上（只对比值不够：同一页可以有好几处 3.56） */
        return !B.waived.some((w) => w.ratio === ratio
          && (!txt || w.text.startsWith(txt.slice(0, 3)) || txt.startsWith(w.text.slice(0, 3))));
      });
      if (unexplained.length) {
        bad('contrastLow 交叉核对', `${unexplained.length} 条外部报了、自查没解释`);
        for (const h of unexplained.slice(0, 6)) console.log(`     ✗ ${h.page}｜${h.snippet}`);
      } else {
        ok('contrastLow 交叉核对', `${list.length} 条全部与自查读数一致（都在例外账内）`);
      }
      continue;
    }
    const pass = [], red = [];
    for (const h of list) (allowed(rule, 'a', h.snippet) ? pass : red).push(h);
    if (pass.length) console.log(`  － ${rule} 例外账放行 ${pass.length} 条`);
    if (!red.length) { if (READABILITY.has(rule)) ok(rule, '0 条'); continue; }
    bad(rule, `${red.length} 条（${READABILITY.has(rule) ? '可读性，必须清零' : '默认做法，须写理由或改掉'}）`);
    for (const h of red.slice(0, 6)) console.log(`     ✗ ${h.page}｜${h.snippet}${h.detail ? ' —— ' + h.detail : ''}`);
    if (red.length > 6) console.log(`     … 其余 ${red.length - 6} 条见 ${outRoot}`);
  }
  /* ★ 只有真量到过页面，才允许打印"0 条"。
     病（本轮实测到这个假绿）：6 页全部 shoot 失败时，byRule 是空表，
     下面这行会给四条可读性规则各打一个「✓ 0 条」——一页没看却说"这条清零了"。
     最终 rc 仍是 3（unmeasured 非空），但**打印层先说了谎**，而人只看打印。 */
  if (!aMeasured) {
    console.log(`  ？ A 部分一页都没量到（${PAGES.length} 页全失败）—— 可读性四项的"0 条"不成立，不许当绿`);
  } else {
    for (const r of READABILITY) if (!byRule.has(r)) ok(r, '0 条');
  }
  writeFileSync(join(ROOT, '_reports', 'lint', `last-${stamp}.json`), JSON.stringify({ at: stamp, hits }, null, 1));
  console.log(`  取证目录：${outRoot}`);
}

/* ══ 主流程 ══════════════════════════════════════════════════════ */
console.log('视觉 lint 与可读性（' + [DO_A ? 'A 外部 14 规则' : '', DO_B ? 'B 全站对比度' : ''].filter(Boolean).join(' + ')
  + `）｜被检页面 ${PAGES.length} 页`
  + (NEG ? '  [负控：逐页注入白字白底探针]' : ''));
if (UNLABELED.length) console.log('  ！ ' + UNLABELED.length + ' 页没有显示名（照检不误，只是打印难看）：' + UNLABELED.join('、'));

if (badAllow.length) {
  for (const a of badAllow) bad('例外账无效行', `${a.rule}｜${a.selector} —— ${a.bad}`);
}

let negctlBroken = false;
if (DO_B) { try { negctlBroken = await runContrast() === true; } catch (e) { console.log('SKIP: B 部分抛错 —— ' + e.message); unmeasured.push('B'); } }
if (DO_A) { try { await runDefaults(); } catch (e) { console.log('SKIP: A 部分抛错 —— ' + e.message); unmeasured.push('A'); } }

if (REPORT) { console.log(`\n[--report] 只出账不判红：${fails.length} 条待处理`); process.exit(0); }
/* 负控探针没被抓到 = 这条判据对那一页是瞎的。它不属于"页面有缺陷"(2)，
   而属于"判据自己不可信"(3) —— 混成 2 的话，页面恰好另有存量违规就会假绿。 */
if (negctlBroken) { console.log('\n负控未命中 —— 判据自身不可信，不许当作"页面有问题"就算完'); process.exit(3); }
if (unmeasured.length) {
  console.log(`\n未量 ${unmeasured.length} 项：${unmeasured.join('、')} —— 缺量不许当绿`);
  process.exit(3);
}
console.log(fails.length ? `\nFAIL ${fails.length} 条：\n - ` + fails.join('\n - ') : '\n通过：可读性四项清零，其余命中均有落款');
process.exit(fails.length ? 2 : 0);
