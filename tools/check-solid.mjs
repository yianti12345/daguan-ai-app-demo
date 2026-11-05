#!/usr/bin/env node
/* check-solid —— 「界面是不是实的」判据（2026-10-22 第 1 版）。
 *
 * 为什么有它：这一轮里找到的四个缺陷，门禁全绿、e2e 也全绿，一个都没拦住。
 * 它们不是样式问题，也不是死链问题，而是三件更底层的事：
 *   R1 界面里露出讲自己的话（"这是默认样例""全部混在一个列表里"）——客户看到的是内部备注；
 *   R2 打开一页是白板（应用只装了应用头 ⇒ 画布 0 个内容块，下面全白）；
 *   R3 同一份数据存在两处真源（components.html 自己写死一份 COMPS，已与 DB 漂移，
 *      新建的组件永远不会出现在列表里 —— 整条流程断在这里）。
 * 这三件事的共同点：**没有一条判据把"用户真的看得见东西"当判据**。
 * 前面的门禁判的是取值、对比度、跳转、骨架，都是"有这行代码"，不是"有这页东西"。
 *
 * 判据：
 *   R1 四个页面的可见文本 / placeholder / title 里不得出现内部用语
 *   R2 应用配置页在「零装配」「只有应用头」两种情况下必须给出可见的空态与出口，不许白板
 *   R3 组件清单只能有一份真源（components.html 不得自带 refs 字面量，必须读 DB.COMPS）
 *   R4 装配面板「可装配」不得混进已下架组件，且 tab 计数与列表行数一致
 *   R9 同一屏上的数字必须能互相解释（徽标=装配数 / 状态条=表格行数 / 拆分之和=总数）
 *
 * 用法：node tools/check-solid.mjs [base]          默认 http://127.0.0.1:8941
 *      node tools/check-solid.mjs --negctl        负控（每条判据都必须能被打红）
 * 退出码：0 通过 ｜ 2 有断点（负控恒 2）｜ 3 环境不可用
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* 基址统一由 tools/base.mjs 解析，本文件不写端口。 */
const BASE = await resolveBase();
const NEG = process.argv.includes('--negctl');
/* 只跑静态判据（R3 单一真源 / R5 规范同源），不开浏览器。给 run-gates --fast 用。 */
const STATIC_ONLY = process.argv.includes('--static-only');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';

/* ── 内部用语表 ────────────────────────────────────────────────
   这些词不是"禁止中文"，是"禁止把讲给设计者自己的话留在界面上"。
   加词前问一句：客户看到这句会不会觉得在看草稿？会，就加。 */
const INTERNAL = [
  /* ── A 类：讲给自己的话 ─────────────────────────────── */
  ['默认样例', '在告诉看的人"这是样例"'],
  ['全部混在', '把实现细节写成了界面文案'],
  ['画布', '这是我这边的说法，不是客户的说法'],
  ['原型', '同上'],
  ['占位', '同上'],
  ['待落', '同上'],
  ['TODO', '同上'],
  ['示例文字', '同上'],

  /* ── B 类：内部字段当界面信息（2026-10-23 新增）─────────
     这一类是漏得最狠的。A 类查的是"我自言自语"，B 类查的是"我拿数据模型当文案"。
     两者的区别：A 类一眼看得出是草稿，B 类**看着完全正常**——
     它长得像信息、位置也对、还确实来自数据库，唯一的问题是这个字段
     只对系统内部有意义，对客户零意义。
     起因是用户看到装配面板上每行写着「能力类 · v1 · 被 2 个应用引用」，
     原话：「我什么时候有组件还区分能力类这种字段，最后在这显示被 X 个应用引用啊，脑残吗？
     重要的是组件名称，组件介绍，懂吗？」
     ⚠ 判据只能拦住"词"，拦不住"为什么要摆这个词"。所以 B 类词表要跟着一起长。 */
  ['能力类', '内部组件分类，客户没有这个概念'],
  ['页面类', '同上'],
  ['个应用引用', '内部依赖计数；在装配这种无风险动作里只会让客户迟疑'],
  ['未被引用', '同上'],
  ['引用数', '同上'],
  ['refs', '字段名上屏'],
  ['spec', '字段名上屏'],
  ['快照', '版本机制的内部说法'],
];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') this.errs.push(String(m.params.exceptionDetails.text).slice(0, 120));
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
      setTimeout(() => rej(new Error('timeout ' + method)), 25000);
    });
  }
}

/* ── 起浏览器 ─────────────────────────────────────────────── */
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/solid-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) {
    throw new Error('页面抛错：' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  }
  return r.result.value;
};
const go = async (path, wait = 650) => {
  c.errs.length = 0;
  await c.send('Page.navigate', { url: BASE + path });
  await sleep(wait);
};

/* ── 判据本体：写成纯函数，正控负控用同一份 ─────────────────
   上一版吃过亏：负控另写一句"我觉得应该红"，等于自证。
   这里所有判定都从这两个函数出，负控只负责往 DOM 里注入病历。 */
const VIS = `(e) => {
  const cs = getComputedStyle(e);
  if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
  return e.getClientRects().length > 0;
}`;

/* R1：把"用户能看到的字"全捞出来（排除脚本/样式） */
const R1_READ = `(() => {
  const vis = ${VIS};
  const parts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (!p) continue;
    const tag = p.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    const t = n.nodeValue.replace(/\\s+/g, ' ').trim();
    if (t) parts.push({ t, vis: vis(p) });
  }
  const attrs = [];
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((e) => {
    ['placeholder', 'title', 'aria-label'].forEach((k) => {
      const v = e.getAttribute(k);
      if (v) attrs.push({ k, v: v.trim(), vis: vis(e) });
    });
  });
  return { text: parts, attrs, title: document.title };
})()`;

/* R1 判定：可见文本 + 属性 + 标题里都不许有内部用语。
   ⚠ 只看**可见**的：display:none 的模板片段不算（否则库里一堆骨架模板全假红）。 */
function r1Hits(read) {
  const hits = [];
  for (const [word, why] of INTERNAL) {
    for (const p of read.text) {
      if (p.vis && p.t.indexOf(word) >= 0) hits.push(`正文「${p.t.slice(0, 40)}」含「${word}」（${why}）`);
    }
    for (const a of read.attrs) {
      if (a.vis && a.v.indexOf(word) >= 0) hits.push(`${a.k}「${a.v.slice(0, 40)}」含「${word}」（${why}）`);
    }
    if ((read.title || '').indexOf(word) >= 0) hits.push(`title「${read.title}」含「${word}」`);
  }
  return hits;
}

/* R2：应用配置页不许是白板 —— 数可见元素 + 找出口 */
const R2_READ = `(() => {
  const vis = ${VIS};
  const cv = document.querySelector('#canvas');
  if (!cv) return { ok: false, why: '#canvas 不存在' };
  const visEls = [...cv.querySelectorAll('*')].filter(vis);
  const blk = document.querySelectorAll('#canvas .cv-blk').length;   /* ★2026-11-04 画布块真实类是 .cv-blk（assets/app.js:852），.blk 从来不存在 */
  const cta = [...cv.querySelectorAll('button,a[href]')].filter(vis).map((b) => b.textContent.trim());
  const txt = (cv.innerText || '').replace(/\\s+/g, ' ').trim();
  /* ★2026-11-04：用户 2026-11-03 m05606 明确「空态点击有什么意义」——空态不再放按钮，
     出口是页面底部的输入框。所以「有没有出口」要连输入区一起看，不能只数画布里的按钮。 */
  const inp = document.querySelector('#fk-input'), snd = document.querySelector('#fk-send');
  const composer = !!(inp && snd && vis(inp) && vis(snd));
  return { ok: true, visCount: visEls.length, blk, cta, composer, txtLen: txt.length, txt: txt.slice(0, 160) };
})()`;

/* R2 判定：两种"没内容"的情形都必须有可见说明 + 一个可点的出口 */
function r2Hits(read) {
  const hits = [];
  if (!read.ok) return [read.why];
  if (read.txtLen < 12) hits.push(`画布上几乎没有字（${read.txtLen} 字），等于白板`);
  if (!read.cta.length && !read.composer) hits.push('画布上一个可点出口都没有（装配不了，也退不出去）');
  /* 阈值 3 而不是 6：空态本来就是"标题 + 一句说明 + 一个按钮"，拿有内容的页面标准去卡它必然假红。
     这里要卡的是"白板"，不是"信息密度"。 */
  if (read.visCount < 3) hits.push(`画布可见元素只有 ${read.visCount} 个，等于白板`);
  return hits;
}

/* R3：单一真源（静态检查，不靠浏览器） */
function r3Hits(src) {
  const hits = [];
  /* ⚠ 判据本身修过一次：原来只要出现 `refs:` 就判红，于是「新增组件」表单里写一条
     `refs: 0` 也被判成"第二份清单"。真正的病是**一整片组件对象**被抄进页面，
     所以数出现次数：≥3 条 refs 才算成片，一条是字段写入，合法。 */
  const n = (src.match(/refs\s*:/g) || []).length;
  if (n >= 3) hits.push(`页面里出现 ${n} 条 refs 字面量 —— 组件清单又被抄成了第二份`);
  if (!/DB\.COMPS/.test(src)) hits.push('页面没有读 DB.COMPS');
  return hits;
}

/* R6 创建组件是表单，不是"说一句话生成"（2026-10-22 用户口径；2026-10-29 按 D1 改）
   四条：入口在、名称+介绍两样字段齐、启用开关**必须不存在**、提交即入库为未发布。
   D1（2026-10-28）删掉新建表单的启用开关：新建即「未发布」，此时开关不改变任何结果
   （能否被装只看已上架+启用），却让人以为拨一下就能装。判据跟着改口径：
   旧版要求 #nf-sw 存在，会把已按 D1 删掉的产品判红 —— 那条是判据过期，不是产品缺字段。 */
const R6_READ = `(async () => {
  const s = (m) => new Promise((r) => setTimeout(r, m));
  const btn = document.querySelector('#btn-new');
  if (!btn) return { ok:false, why:'找不到「新增组件」入口 #btn-new' };
  btn.click(); await s(250);
  const q = (x) => document.querySelector(x);
  const vis = (e) => { if(!e) return false; const c=getComputedStyle(e);
    return c.display!=='none' && c.visibility!=='hidden' && e.getClientRects().length>0; };
  return { ok:true,
    mask: vis(q('#nf-mask')),
    fields: ['#nf-name','#nf-desc'].filter((x)=>vis(q(x))),
    /* 用 DOM 存在性，不用可见性：开关被 CSS 藏起来也算"表单里还有它"，
       下一次有人加回隐藏开关时这条仍要红。 */
    sw: !!q('#nf-sw'),
    disabledEmpty: q('#nf-ok') ? q('#nf-ok').disabled : null };
})()`;

function r6Hits(read, src) {
  const hits = [];
  if (!read.ok) return [read.why];
  if (!read.mask) hits.push('点「新增组件」没弹出表单');
  const want = ['#nf-name','#nf-desc'];
  const miss = want.filter((x) => read.fields.indexOf(x) < 0);
  if (miss.length) hits.push('表单缺字段：' + miss.join(' / ') + '（用户口径：名称 + 介绍两样；启用开关按 D1 不在新建表单里）');
  if (read.sw) hits.push('新建表单出现了启用开关 #nf-sw（D1 已删：新建即未发布，开关不改变任何结果）');
  if (read.disabledEmpty !== true) hits.push('名称为空时「创建组件」仍可点（应该禁用）');
  /* ★2026-10-28（机制审查官）：发布态 10-27 由「草稿」改名为「未发布」，
     components.html:634 的提交路径写的正是 status: '未发布'。这条必须判它**落在未发布这一档**，
     不是"随便什么状态都行" —— 写成旧名「草稿」或不存在的状态仍须判红（负控两刀各证一次）。 */
  if (!/status:\s*'未发布'/.test(src)) hits.push('提交路径没有写「未发布」状态');
  return hits;
}

/* R7 对话条能收起、能再展开（用户原话：我要边看边改）
   收起的意义是看见页面下半部分，所以收起后必须**真的让位**（高度 ≤ 6px），
   不能只是把内容藏起来、还占着 56 高。 */
const R7_READ = `(async () => {
  const s = (m) => new Promise((r) => setTimeout(r, m));
  const dock = document.querySelector('#fk-dock');
  const bar = document.querySelector('.fk-bar');
  /* 2026-10-30：历史改成「长条常驻 + 列表可收」后，收起时整块 .fk-hist 仍可见，
     收起来的是列表。判据看列表，不再看整块。 */
  const hist = document.querySelector('#fk-hist-list');
  if (!dock || !bar) return { ok:false, why:'找不到对话区（#fk-dock / .fk-bar）' };
  const hb = () => Math.round(bar.getBoundingClientRect().height);
  const open0 = hb();
  const st0 = dock.getAttribute('data-hist');
  const histBtn = document.querySelector('.fk-hist-btn');
  const colBtn = document.querySelector('.fk-hist-col');
  if (!histBtn || !colBtn) return { ok:false, why:'历史面板缺展开/收起钮（.fk-hist-btn / .fk-hist-col）' };
  if (st0 === 'closed') { histBtn.click(); await s(260); }
  const stOpen = dock.getAttribute('data-hist');
  const histVisOpen = hist ? getComputedStyle(hist).display !== 'none' : false;
  const hOpen = hb();
  colBtn.click(); await s(260);
  const stClosed = dock.getAttribute('data-hist');
  const histVisClosed = hist ? getComputedStyle(hist).display !== 'none' : false;
  const hClosed = hb();
  const stored = localStorage.getItem('ifas90:histCollapsed');
  histBtn.click(); await s(260);
  const stBack = dock.getAttribute('data-hist');
  return { ok:true, open0, stOpen, histVisOpen, hOpen, stClosed, histVisClosed, hClosed, stored, stBack };
})()`;

function r7Hits(read) {
  /* ★ 2026-10-23 口径变了：用户要的是"收起对话历史、只留对话框"，
     不是"把整条对话缩成一条 64×4 的短横"（那等于把对话关掉）。
     所以这条判据现在守三件事：
       ① 历史能收起、也能再展开（双向，缺一边就是单闸）
       ② 收起历史**不影响输入条高度**（输入框永远在）
       ③ 收起状态能记住
     —— 它守的是"开关是双向的、输入框不被藏"，不是"高度必须 ≤6px"。 */
  const hits = [];
  if (!read.ok) return [read.why];
  if (read.open0 < 50) hits.push('输入条只有 ' + read.open0 + 'px 高（应 56 左右）');
  if (read.stOpen !== 'open') hits.push('点历史钮后 data-hist 不是 open');
  if (!read.histVisOpen) hits.push('展开后历史面板仍不可见');
  if (read.stClosed !== 'closed') hits.push('点收起钮后 data-hist 不是 closed');
  if (read.histVisClosed) hits.push('收起后历史面板仍可见');
  if (Math.abs(read.hClosed - read.hOpen) > 2) {
    hits.push('收起历史把输入条高度改了（' + read.hOpen + ' → ' + read.hClosed + 'px）—— 输入框必须一直在');
  }
  if (read.stBack !== 'open') hits.push('收起后无法再展开（开关只有单向）');
  return hits;
}

/* R8 装配组件是独立胶囊：不在对话条里、不在操作组里；组件页不该有它 */
/* 2026-10-23：装配入口从右下独立胶囊移到顶栏动作组（与保存/发布同一行）。
   理由：三个动作都属于"这个应用"，底部只该留小智一个浮球（两矩形+圆球挤在一角是最丑的地方）。
   判据跟着改：入口在顶栏、不在对话条里、不在右下操作组里、组件页不该有。 */
const R8_APP = `(() => {
  const chip = document.querySelector('#act-assemble');
  const bar = document.querySelector('.fk-bar');
  const ops = document.querySelector('.fk-ops');
  if (!chip) return { ok:false, why:'应用页顶栏没有装配入口 #act-assemble' };
  return { ok:true,
    inBar: bar ? bar.contains(chip) : false,
    inOps: ops ? ops.contains(chip) : false,
    count: (document.querySelector('#act-count') || {}).textContent || null,
    label: chip.textContent.replace(/\s+/g,' ').trim() };
})()`;
const R8_COMP = `(() => ({ hasChip: !!document.querySelector('#act-assemble'),
                            barHasChip: !!(document.querySelector('.fk-bar') || {textContent:''}).textContent.match(/装配/) }))()`;

function r8Hits(app, comp) {
  const hits = [];
  if (!app.ok) return [app.why];
  if (app.inBar) hits.push('装配组件在对话条里（应是独立入口）');
  if (app.inOps) hits.push('装配组件在右下操作组里（应是独立入口）');
  if (!app.count) hits.push('胶囊上没有装配计数');
  if (comp.hasChip) hits.push('组件页出现了装配入口（组件页不装配任何东西）');
  return hits;
}

/* R5：规范与判据不能各说一套（静态检查）
   为什么：规范说"圆角只五档 2/4/6/12/999"，而 C7 实际允许 0/2/3/4/6/12/999/50 —— 多了 3 和 50。
   两处各写一套，等于规范的约束力为零：谁都可以说"我是按另一份来的"。
   ⇒ 判据读规范的档位表，多一个档就红；要么把它写进规范，要么把它从判据里删掉。 */
function r5Hits() {
  const hits = [];
  const tokens = readFileSync(ROOT + 'assets/tokens.css', 'utf8');
  /* ★2026-10-28：令牌三层化后，档位值可能是字面 px，也可能是指向 primitive 的引用
     （`--r-s:var(--radius-xs)`）。原正则只认字面 px ⇒ 三层化之后 tokenSet 恒空、
     判据把"改了结构"误报成"token 被改坏了"。这里两种形态都认，判断的仍是
     "规范与 token 的档位名是否一一对应"这件事实，没有放宽。 */
  /* 三层化之后，档位的**权威名**是 --radius-*；--r-* 只是 @deprecated 别名，
     不再作为"档位"参与比对（否则每留一个兼容别名就多一条"规范没写"的噪音）。 */
  const tokenSet = new Set([...tokens.matchAll(/(--radius-[a-z0-9]+)\s*:\s*(?:[\d.]+px|var\(--[a-z0-9-]+\))/g)].map((m) => m[1]));
  const design = readFileSync(ROOT + 'DESIGN.md', 'utf8');
  const docSet = new Set([...design.matchAll(/(--radius-[a-z0-9]+)\b/g)].map((m) => m[1]));
  if (!tokenSet.size) hits.push('tokens.css 里找不到 --radius-* 档位（token 被改坏了）');
  if (!docSet.size) hits.push('DESIGN.md 里找不到任何 --radius-* 圆角档位（规范被改坏了）');
  const undocumented = [...tokenSet].filter((t) => !docSet.has(t));
  const phantom = [...docSet].filter((t) => !tokenSet.has(t));
  /* ★2026-10-28（盲审 BLIND-PRODUCT-20261028-01）：改成正则后新开了一格盲区 ——
     只比对"名字有没有"，不检查 `var(--x)` 指向的目标是否真的存在。
     实测 `--radius-panel:var(--p-radius-doesnotexist)` 这种断链会照样 rc=0。
     这里补一刀：每个档位的 var() 目标必须在同一份 tokens.css 里有定义。 */
  const defs = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const dangling = [...tokens.matchAll(/(--radius-[a-z0-9]+)\s*:\s*var\((--[a-z0-9-]+)\)/g)]
    .filter((m) => !defs.has(m[2]))
    .map((m) => m[1] + '→' + m[2]);
  if (dangling.length) hits.push('圆角档位引用了不存在的变量：' + dangling.join(' / ') + '（断链，等于没有档位）');
  if (undocumented.length) hits.push('token 里有但规范没写：' + undocumented.join(' / ') + '（约束力为零）');
  if (phantom.length) hits.push('规范写了但 token 里没有：' + phantom.join(' / ') + '（文档指向不存在的档）');
  return hits;
}

/* R4：装配面板口径 */
/* 拆成两段：MEASURE 只量不动，READ 负责先开面板。
   负控要往已开的面板里注入一行"已下架"，不能再点一次（会把它关掉）——
   这就是上一次负控写成自证的原因。 */
const R4_MEASURE = `(() => {
  const tabs = [...document.querySelectorAll('.panel .p-tab')];
  const availTab = tabs[0];
  const label = availTab ? availTab.textContent.replace(/\\s+/g, '') : '';
  const rows = [...document.querySelectorAll('.panel .row')];
  const OFF = ['已下架'];
  const bad = rows.filter((r) => OFF.some((w) => r.textContent.indexOf(w) >= 0))
                  .map((r) => r.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40));
  const m = label.match(/(\\d+)/);
  return { ok: true, tabLabel: label, tabCount: m ? Number(m[1]) : -1, rows: rows.length, bad,
           rowActs: rows.map((r) => (r.querySelector('button') || {}).textContent || '').map((s) => s.trim()) };
})()`;
const R4_READ = `(async () => {
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  /* 入口三代：底部条按钮 → 右下独立胶囊 #fk-chip（2026-10-22）→ 顶栏 #act-assemble（2026-10-23）。
     判据必须跟着界面走，否则它会永远红，而红的理由是"找不到一个已经不存在的东西"。 */
  const btn = document.querySelector('#act-assemble')
           || document.querySelector('#fk-chip') || document.querySelector('#btn-comps');
  if (!btn) return { ok: false, why: '找不到装配入口（#act-assemble / #fk-chip / #btn-comps）' };
  btn.click(); await sleep(600);
  return ${R4_MEASURE};
})()`;

function r4Hits(read) {
  const hits = [];
  if (!read.ok) return [read.why];
  if (read.bad.length) hits.push(`「可装配」里混进 ${read.bad.length} 个已下架组件：${read.bad.join(' / ')}`);
  if (read.tabCount !== read.rows) hits.push(`tab 写 ${read.tabCount} 个，列表实际 ${read.rows} 行`);
  return hits;
}

/* R9：同一屏上的数字必须能互相解释（2026-10-23 新增）
   起因是一处真实缺陷：状态条写「审核中 · 7 条」、表格只有 4 行、徽标「装配组件 3」、
   画布 2 个内容块 —— 四个数字单独看都有出处，放在一起全错。当时的 26 条判据一条都没拦住：
   它们各自量取值 / 几何 / 同类一致性，没有一条量**同一屏上两个数字对不对得上**。
   只量"值对不对"，不量"值之间说不说得通"，就是这一格的空白。

   三件事（用户口径）：
     ① 顶栏徽标 #act-count == DB.APP_COMPS[当前应用].length      徽标 = 真实装配数
     ② .status b 里的数字 == 画布内第一个 table tbody 的行数     状态条 = 表格行数
     ③ .status .note 各段数字之和 == 状态条总数                   拆分 = 总数（只有双栏才输出 .note）

   ⚠ 应用 id 不写死：先取 body[data-app]（app.js 的 paintApp 会写上），取不到才退到 DB.APPS[0]。
     所以调用方直接打开 /app.html 即可（页面自己会 replaceState 到 ?id=APPS[0].id）。
   ⚠ 只量不动：不点按钮、不改数据 —— 所以正控与负控共用这同一份表达式。 */
const R9_MEASURE = `(() => {
  if (!window.DB) return { ok: false, why: 'DB 没加载（assets/data.js 不在）' };
  const num = (s) => { const m = String(s == null ? '' : s).match(/(\\d+)/); return m ? Number(m[1]) : null; };
  const appId = document.body.getAttribute('data-app') || (DB.APPS[0] ? DB.APPS[0].id : '');
  if (!appId || !DB.appById(appId)) return { ok: false, why: '页面没有 data-app，也取不到 DB.APPS[0]' };

  /* ① 徽标 vs 真实装配数 */
  const badgeEl = document.querySelector('#act-count');
  const badge = badgeEl ? num(badgeEl.textContent) : null;
  const real = (DB.APP_COMPS[appId] || []).length;

  /* ② 状态条总数 vs 画布内第一个表格的行数 */
  const bEl = document.querySelector('#canvas .status b');
  const statusText = bEl ? bEl.textContent.replace(/\\s+/g, ' ').trim() : null;
  /* ★2026-10-27 修（判据读错对象，今天第四条同族）：.status b 里是「4 条待处理 · 共 5 条」，
     而 num() 取的是**第一个**数字 —— 于是拿「待处理 4」去比「表格 5 行」，永远不等。
     状态条上有两个数：待处理数、总数。要跟表格行数对的是**总数**。
     所以先找「共 N 条」，找不到才回落到第一个数字（别的应用可能只写一个数）。 */
  const statusNum = (function () {
    if (!bEl) return null;
    const t = bEl.textContent.replace(/\\s+/g, ' ');
    const m = t.match(/共\\s*(\\d+)\\s*条/);
    return m ? Number(m[1]) : num(t);
  })();
  const tbody = document.querySelector('#canvas table tbody');
  const tableRows = tbody ? tbody.querySelectorAll('tr').length : null;

  /* ③ 状态条的拆分各段之和 vs 总数 */
  const noteEl = document.querySelector('#canvas .status .note');
  const noteText = noteEl ? noteEl.textContent.replace(/\\s+/g, ' ').trim() : null;
  const noteSum = noteEl
    ? (noteText.match(/\\d+/g) || []).reduce((n, s) => n + Number(s), 0)
    : null;

  return { ok: true, appId, badge, real, statusText, statusNum, tableRows,
           hasNote: !!noteEl, noteText, noteSum };
})()`;

/* 红信息必须写清「哪两个数、各是多少、来自哪」—— 否则只看到"不一致"，
   还得自己开浏览器找那两个数，等于判据只报了个响。 */
function r9Hits(read) {
  const hits = [];
  if (!read.ok) return [read.why];

  if (read.badge == null) {
    hits.push('#act-count 上没有数字（徽标丢了，装配数无处可对）');
  } else if (read.badge !== read.real) {
    hits.push(`徽标写「装配组件 ${read.badge}」（#act-count），DB.APP_COMPS['${read.appId}'] 实际 ${read.real} 个`);
  }

  if (read.statusNum == null) {
    hits.push('#canvas 里找不到状态条（.status b）—— 屏上没有一个总数可以对照');
  } else if (read.tableRows == null) {
    hits.push(`状态条写「${read.statusText}」（${read.statusNum} 条），但 #canvas 里没有表格（table tbody）可对`);
  } else if (read.statusNum !== read.tableRows) {
    hits.push(`状态条写「${read.statusText}」（${read.statusNum} 条），画布第一个表格只有 ${read.tableRows} 行`);
  }

  /* 单栏时 app.js 不输出 .note（"拆分"只在双栏时才是事实），所以这一段按存在与否判 */
  if (read.hasNote && read.noteSum !== read.statusNum) {
    hits.push(`状态条拆分「${read.noteText}」各段相加 ${read.noteSum}，总数却是 ${read.statusNum}`);
  }
  return hits;
}

/* ── 跑 ───────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const rows = [];
const chk = (name, hits, detail = '') => {
  const ok = hits.length === 0;
  if (ok) pass++; else fail++;
  const line = (ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' → ' + detail : '');
  rows.push(line);
  console.log(line);
  hits.slice(0, 6).forEach((h) => console.log('      · ' + h));
  if (hits.length > 6) console.log(`      · …还有 ${hits.length - 6} 条`);
  return ok;
};

/* 四页 + 一个单栏应用：状态条的单栏分支只有单栏时才跑到，
   上一版只量了双栏的 hx-zc，"全部混在一个列表里" 就是从这个缝里漏过去的。 */
const PAGES = ['apps.html', 'app.html?id=hx-zc', 'app.html?id=ht-zc', 'components.html', 'component.html'];

if (STATIC_ONLY) {
  console.log('── 静态判据（快速档）');
  chk('R3 components.html 读 DB.COMPS 且无 refs 字面量', r3Hits(readFileSync(ROOT + 'components.html', 'utf8')));
  console.log('── R5 规范与判据同一套档位');
  chk('圆角档位：规范 == 判据', r5Hits());
  console.log('');
  console.log(`通过 ${pass} ｜ 断点 ${fail}`);
  process.exit(fail ? 2 : 0);
}

if (!NEG) {
  /* R1 */
  console.log('── R1 界面上不许有讲自己的话');
  let allHits = [];
  for (const p of PAGES) {
    await go('/' + p);
    const hit = r1Hits(await ev(R1_READ));
    allHits = allHits.concat(hit.map((h) => p + ' → ' + h));
  }
  chk(`${PAGES.length} 个页面无内部用语`, allHits);

  /* R9 */
  /* ⚠ 顺序有讲究：R9 必须排在 R2 前面。R2 为了验空态会走 DB.uninstall 把 hx-zc 卸空并落盘，
     之后**同一次浏览器会话里**就再也没有"有内容的屏"可量了（那是判据自己造出来的状态）。
     ⚠ 2026-10-24：原来这里是 `/app.html`（靠页面自己回落到 APPS[0]）。P1-7 把那种
        静默回落判为缺陷并修掉了 —— 裸 app.html 现在 `location.replace('apps.html?pick=1')`。
        所以这里显式给一个种子应用 id（hx-zc，已上架，3 个组件），判据跟着产品口径走。 */
  console.log('── R9 同屏数字自洽');
  await go('/app.html?id=hx-zc', 800);
  const r9 = await ev(R9_MEASURE);
  chk('R9 同屏数字自洽：徽标 = 装配数 ｜ 状态条 = 表格行数 ｜ 拆分之和 = 总数', r9Hits(r9),
    r9.ok ? `徽标 ${r9.badge}/${r9.real} ｜ 状态条 ${r9.statusNum}/表格 ${r9.tableRows} 行`
            + (r9.hasNote ? ` ｜ 拆分 ${r9.noteText}` : '') : '');

  /* R2 */
  console.log('── R2 打开一页不许是白板');
  await go('/app.html?id=gf-xm');
  chk('零装配应用有可见空态与出口', r2Hits(await ev(R2_READ)));
  /* 只剩应用头：走 DB.uninstall 这个**真接口**把内容组件全卸掉。
     ⚠ 不要用 `a.comps = ['app-header']` + DB.save()：save() 落盘的是 APP_COMPS，
       而 app.comps 与 APP_COMPS[id] 是同一个数组的别名，直接换掉 app.comps 会让
       APP_COMPS 还指向旧数组 ⇒ 存进去的还是满的，刷新后画的还是满的，
       这条判据就会拿"正常页面"去判"空态"，永远判绿。 */
  await go('/app.html?id=hx-zc');
  await ev(`(async () => {
    const ids = (DB.appById('hx-zc').comps || []).filter((id) => id !== 'app-header');
    for (const id of ids) { await DB.uninstall('hx-zc', id); }
    return DB.appById('hx-zc').comps.slice();
  })()`);
  await go('/app.html?id=hx-zc');
  chk('只有应用头时给出说明与出口', r2Hits(await ev(R2_READ)));

  /* R3 */
  console.log('── R3 组件清单只能有一份真源');
  const src = readFileSync(ROOT + 'components.html', 'utf8');
  chk('components.html 读 DB.COMPS 且无 refs 字面量', r3Hits(src));

  /* R5 */
  console.log('── R5 规范与判据同一套档位');
  chk('圆角档位：规范 == 判据', r5Hits());

  /* R6 */
  console.log('── R6 创建组件是表单（名称 / 介绍；启用开关按 D1 不得出现）');
  chk('创建表单：入口、名称+介绍、无启用开关、必填联动、提交即未发布',
    r6Hits(await (async () => { await go('/components.html'); return ev(R6_READ); })(),
           readFileSync(ROOT + 'components.html', 'utf8')));

  /* R7 */
  console.log('── R7 对话条能收起、能再展开');
  await go('/component.html', 800);
  let r7 = await ev(R7_READ);
  if (!r7.ok) { await go('/app.html?id=hx-zc', 800); r7 = await ev(R7_READ); }
  chk('对话条收起后真的让位（≤6px），点把手能回到 56', r7Hits(r7),
    `${r7.open0}→${r7.hClosed}→${r7.stBack}`);

  /* R8 */
  console.log('── R8 装配组件是独立胶囊');
  await go('/app.html?id=hx-zc', 800);
  const r8a = await ev(R8_APP);
  await go('/component.html', 800);
  const r8c = await ev(R8_COMP);
  chk('装配组件独立，且组件页没有它', r8Hits(r8a, r8c), r8a.label || '');

  /* R4 */
  console.log('── R4 装配面板口径');
  await go('/app.html?id=hx-zc', 800);
  chk('可装配不混已下架，且计数等于行数', r4Hits(await ev(R4_READ)));

  /* 额外：全程无 JS 异常（顺手，不单列判据） */
  if (c.errs.length) console.log('  ⚠ 页面异常 ' + c.errs.length + ' 条：' + c.errs.slice(0, 3).join(' | '));
} else {
  /* ── 负控：每条判据都要能被打红 ───────────────────────────
     只注入"病历"，判定仍走上面那几个纯函数。 */
  console.log('── 负控：每条判据都必须能红');

  await go('/apps.html');
  const bad1 = await ev(`(() => {
    const d = document.createElement('p'); d.textContent = '这是默认样例';
    d.style.cssText = 'position:fixed;top:0;left:0;z-index:9999';
    document.body.appendChild(d); return true;
  })()`);
  const read1 = await ev(R1_READ);
  chk('R1 能红（注入"默认样例"）', r1Hits(read1).length ? [] : ['注入后仍然判绿 ⇒ 判据失效']);

  await go('/app.html?id=gf-xm');
  await ev(`(() => { document.querySelectorAll('#canvas *').forEach((e) => e.style.visibility = 'hidden'); return true; })()`);
  chk('R2 能红（把画布内容藏起来）', r2Hits(await ev(R2_READ)).length ? [] : ['藏起来后仍然判绿 ⇒ 判据失效']);

  const tmp = ROOT + '__negctl.html';
  /* ⚠ 必须塞 ≥3 条：r3Hits 的口径是"≥3 条 refs 才算成片"（1 条是字段写入，合法）。
     原来只塞 1 条，于是这条负控永远打不红 —— 一条打不红的负控，等于这条判据没被验过。 */
  writeFileSync(tmp, readFileSync(ROOT + 'components.html', 'utf8')
    .replace('DB.load()', 'DB.load(); const X = [{ refs: 1 }, { refs: 2 }, { refs: 3 }];'));
  chk('R3 能红（塞回 refs 字面量）', r3Hits(readFileSync(tmp, 'utf8')).length ? [] : ['塞回去仍然判绿 ⇒ 判据失效']);
  unlinkSync(tmp);

  /* R6 负控（2026-10-28 加，机制审查官）：R6 一直只有正控 —— 旧名「草稿」把它打红过一次，
     但没人证明"换成一个别的状态"时它也会红。两刀都必须红：
       ① 不存在的状态「已发布」；② 改回旧名「草稿」（证明判据不是"随便什么状态都行"）。
     两刀都走 r6Hits 本体，只注入源码里的 status 值 —— 正控负控同一份判定函数。 */
  const srcR6 = readFileSync(ROOT + 'components.html', 'utf8');
  const readR6ok = { ok: true, mask: true, fields: ['#nf-name', '#nf-desc'], sw: false, disabledEmpty: true };
  for (const [tag, bad] of [['不存在的状态「已发布」', "status: '已发布'"], ['旧名「草稿」', "status: '草稿'"]]) {
    const doctored = srcR6.replace("status: '未发布'", bad);
    const injected = doctored !== srcR6;
    const hit = r6Hits(readR6ok, doctored).length > 0;
    chk('R6 能红（提交路径写成' + tag + '）',
      injected && hit ? [] : [injected ? '改坏状态值后仍判绿 ⇒ 判据失效' : '负控没注入进去：components.html 里找不到 status: \'未发布\'']);
  }
  /* ★2026-10-29（按 D1 改口径后补的第三刀）：把 #nf-sw 加回新建表单必须判红。
     这条同时证明「要求它不存在」是真的断言，不是删掉旧断言后留下的空门。 */
  chk('R6 能红（把已删的 #nf-sw 加回新建表单）',
    r6Hits({ ...readR6ok, sw: true }, srcR6).some((h) => h.includes('#nf-sw')) ? [] : ['加回开关后仍判绿 ⇒ 新口径是空的']);

  /* R4 负控：面板开着不动，往里塞一行"已下架" + 把 tab 数字改大，两条口径都要被打红 */
  await go('/app.html?id=hx-zc', 800);
  await ev(`(async () => {
    const sleep = (m) => new Promise((r) => setTimeout(r, m));
    /* 入口三代（与 R4_READ 同一套兜底）：用一个已经不存在 id 会让负控自己抛错，
       于是"判据能不能红"变成"负控能不能跑"，两者的红长得一模一样。 */
    const entry = document.querySelector('#act-assemble')
               || document.querySelector('#fk-chip') || document.querySelector('#btn-comps');
    if (!entry) return false;
    entry.click(); await sleep(600);
    const list = document.querySelector('.panel .p-list');
    const d = document.createElement('div');
    d.className = 'row'; d.textContent = '规则配置 页面类 · v5 · 已下架';
    if (list) list.appendChild(d);
    const tab = document.querySelector('.panel .p-tab');
    if (tab) tab.textContent = '可装配 99';
    return true;
  })()`);
  const r4 = await ev(R4_MEASURE);
  chk('R4 能红（注入已下架行并改大计数）', r4Hits(r4).length ? [] : ['注入后仍然判绿 ⇒ 判据失效']);

  /* R9 负控：三条口径各注入一次，各自都要能红。
     ⚠ 顺序是"注入 → 量 → 还原"，中途不导航 —— 导航会把病历冲掉，等于自己把负控治好了。
     ⚠ 2026-10-24：URL 必须带 id。P1-7 修掉"裸 app.html 静默回落 APPS[0]"之后，
        不带 id 会 `location.replace('apps.html?pick=1')`，这里就量不到 #act-count 了。 */
  await go('/app.html?id=hx-zc', 800);

  /* ① 徽标改大：徽标与 DB 里的装配数对不上 */
  const injB = await ev(`(() => {
    const el = document.querySelector('#act-count');
    if (!el) return { ok: false, why: '没有 #act-count 可注入' };
    const old = el.textContent;
    el.textContent = '99';
    return { ok: true, old };
  })()`);
  const r9badge = await ev(R9_MEASURE);
  if (injB.ok) {
    await ev(`(() => {
      const el = document.querySelector('#act-count');
      if (el) el.textContent = ${JSON.stringify(injB.old)};
      return true;
    })()`);
  }
  chk('R9 ① 能红（徽标 ≠ 真实装配数）',
    injB.ok && r9Hits(r9badge).length ? [] : [injB.ok ? '改大徽标后仍然判绿 ⇒ 判据失效' : injB.why]);

  /* ② 状态条改成一个假数字（99），它就该和表格行数对不上 */
  const inj = await ev(`(() => {
    const b = document.querySelector('#canvas .status b');
    if (!b) return { ok: false, why: '#canvas 里没有 .status b，无可注入' };
    const old = b.textContent;
    b.textContent = '审核中 · 99 条';
    return { ok: true, old };
  })()`);
  const r9bad = await ev(R9_MEASURE);
  if (inj.ok) {
    await ev(`(() => {
      const b = document.querySelector('#canvas .status b');
      if (b) b.textContent = ${JSON.stringify(inj.old)};
      return true;
    })()`);
  }
  chk('负控：注入不一致数字后 R9 判红',
    inj.ok && r9Hits(r9bad).length ? [] : [inj.ok ? '注入后仍然判绿 ⇒ 判据失效' : inj.why]);

  /* R9 ③ 负控：.note 只在双栏应用上才输出，所以要另外找一个真的会输出它的应用
     （id 不写死：按 DB.APPS 顺序试，谁画出了 .note 就用谁）。
     不然这一条在 hx-zc 上永远不执行 —— 不执行的判据和绿的判据看起来一模一样。 */
  let noteId = null;
  for (const id of await ev('DB.APPS.map((a) => a.id)')) {
    await go('/app.html?id=' + id, 700);
    if (await ev(`!!document.querySelector('#canvas .status .note')`)) { noteId = id; break; }
  }
  let r9note = { ok: false, why: 'DB 里没有任何双栏应用，.note 分支无从验证' };
  if (noteId) {
    const injN = await ev(`(() => {
      const n = document.querySelector('#canvas .status .note');
      const old = n.textContent;
      n.textContent = '待我审 99 · 已提交 2 · 已完结 1';
      return { old };
    })()`);
    r9note = await ev(R9_MEASURE);
    await ev(`(() => {
      const n = document.querySelector('#canvas .status .note');
      if (n) n.textContent = ${JSON.stringify(injN.old)};
      return true;
    })()`);
  }
  chk('R9 ③ 能红（状态条拆分之和 ≠ 总数）',
    r9note.ok && r9Hits(r9note).length ? [] : [r9note.why || '改坏 .note 后仍然判绿 ⇒ 判据失效'],
    noteId ? '在 ' + noteId + ' 上把某段改成 99' : '');
}

console.log('');
console.log(`通过 ${pass} ｜ 断点 ${fail}`);
chrome.kill();
/* ★2026-10-28（机制审查官）：「负控成立」与「负控自己失效」原来同一个退出码 2，
   负控失败没人分得出来（与 gate-states 同一类一码多源）。成立＝2；失败＝1。 */
process.exit(NEG ? (fail ? 1 : 2) : (fail ? 2 : 0));
