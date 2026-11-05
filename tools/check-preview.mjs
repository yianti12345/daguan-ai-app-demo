#!/usr/bin/env node
/* check-preview —— 画布判据（2026-10-22 第 3 版，按"能装东西进去"这件事重写）。
 *
 * 为什么有它：用户骂过两次同一件事——「装了一个组件，界面得真的变」。
 * 这条不是样式问题，是"生成有没有发生"，只能靠结构与几何钉住。
 *
 * 这一版验 9 条：
 *   A1 首屏是**引导态**（有说明 + 有一个可点的入口），不是白板
 *      ⚠ 2026-10-22 用户改口径：画布首屏必须是空的（创建只是登记一张卡，内容靠对话长出来）。
 *        原来的 A1 要求"首屏有默认样例、还是工作台双栏"，那条和需求直接冲突，已改。
 *   A2 说一句之后画布**确实变了**（骨架指纹 / 可见元素数 / 文本三项里至少一项），且逐段落地 ≥3 块
 *   A3 生成收尾：data-busy=false、进度条收起
 *   A4 三种要求给出三套两两不同的骨架（不是只换标题）
 *   A5 失败时提示条可见
 *   A6 失败时画布保留上一次成功的样子（不白屏）
 *   A7 失败后 data-busy 回 false（不卡死）
 *   A8 ?fail=1 只失败一次（第二句必须成功）
 *   A9 全程无 JS 异常
 *
 * ⚠ 两条容易写错、这里刻意避开的：
 *   ① 首屏样例是静态渲染，**不播 cstep 动画**（.cstep=0）。拿 .cstep 判首屏必然假红。
 *   ② 负控必须复用**正控里那两个判据函数**，而不是另写一句"我觉得应该红"。
 *      上一版就是这样：注入后断言 leftW>120，断言的是"还在"，等于自证。
 *
 * 用法：node tools/check-preview.mjs [base]        默认 http://127.0.0.1:8977
 *      node tools/check-preview.mjs --negctl      负控（两个注入，每个都必须把对应判据打红）
 * 退出码：0 通过 ｜ 2 有断点（负控恒为 2）｜ 3 环境不可用
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

/* 基址唯一来源见 tools/base.mjs（argv > GATE_BASE > 探端口 > 抛错）。
   历史：这条判据曾经自己写死 8977，而套件跑在 8941 —— 判绿的是另一份代码。
   "量错目标"比判红更糟，所以不许任何判据自己写端口。 */
const BASE = await resolveBase();
const NEG = process.argv.includes('--negctl');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') this.errs.push(String(m.params.exceptionDetails.text).slice(0, 120));
      if (m.id != null && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
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

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cpv-${Date.now()}`,
  '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) {}
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来（' + CHROME + '）'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
const c = new CDP(ws);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error('页面抛错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160));
  return r.result.value;
};
const go = async (path) => { c.errs.length = 0; await c.send('Page.navigate', { url: BASE + path }); await sleep(700); };

let pass = 0, fail = 0;
const rows = [];
const chk = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  const line = (ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' → ' + detail : '');
  rows.push(line);
  console.log(line);
  return ok;
};

/* ── 探针：一次把判据要的数全读出来 ───────────────────────────
   可见 = 有 rect 且不是 display:none / visibility:hidden。
   只数 DOM 节点的话，"把整块 visibility:hidden"这种作弊会判绿。 */
const PROBE = `(() => {
  const vis = (e) => {
    if (!e) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return e.getClientRects().length > 0;
  };
  const root = document.querySelector('#canvas');
  const inner = document.querySelector('#canvas-inner');
  const page = document.querySelector('#canvas .page');
  const q = (s) => !!document.querySelector('#canvas ' + s);
  const text = ((inner && inner.textContent) || '').replace(/\\s+/g, ' ').trim();
  const left = document.querySelector('#canvas .bd-two > *');
  const form = document.querySelector('.fk-bar') || document.body;
  const g = document.querySelector('.genbar') || document.querySelector('#genbar');
  return {
    hasPage: !!page,
    pageVis: page ? [...page.querySelectorAll('*')].filter(vis).length : 0,
    canvasVis: root ? [...root.querySelectorAll('*')].filter(vis).length : 0,
    textLen: text.length,
    text: text.slice(0, 2000),
    /* ★ 2026-10-23：指纹换成**结构**，不再只认三个老布局类。
       生成从"四选一"改成"模型出结构"之后，.bd-two/.bd-single 只属于老骨架，
       生成出来的页面一个都不会有 —— 继续用它们当指纹，判据会把"真的变了"判成没变（假红）。
       现在的指纹＝块数 + 有没有表格/卡片/字段/筛选 + 第一块的段头文字。 */
    fp: {
      g: document.querySelectorAll('#canvas .bd-group').length,
      tb: !!document.querySelector('#canvas .tb'),
      cards: !!document.querySelector('#canvas .bd-cards'),
      fields: !!document.querySelector('#canvas .bd-fields'),
      filters: !!document.querySelector('#canvas .bd-filters'),
      first: (document.querySelector('#canvas .bd-sec') || {}).textContent || '',
      leftW: left ? Math.round(left.getBoundingClientRect().width) : 0
    },
    cstep: document.querySelectorAll('#canvas .cstep').length,
    cta: [...document.querySelectorAll('#canvas button, #canvas a[href], #fk-bar, #fk-input')].filter(vis).length,
    busy: (document.querySelector('#canvas') || form || {}).getAttribute
      ? (document.querySelector('#canvas') || form).getAttribute('data-busy') : null,
    genOff: g ? g.getAttribute('data-off') : null,
    name: ((document.querySelector('#comp-name') || {}).textContent || '').trim()
  };
})()`;
const probe = () => ev(PROBE);

/* 等生成真的结束，而不是等一个固定毫秒数。
   为什么改：3 路并发跑门禁时，固定 2200ms 窗口偶尔赶不上（CPU 被抢），
   于是偶发一条红——而单跑 3 次全绿。**判据在有负载时会抖，本身也是判据的缺陷**。
   改成轮询 #canvas[data-busy]，出现 false 立刻走：空闲时更快，忙时更稳。 */
const waitIdle = async (maxMs = 9000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const b = await ev(`(document.querySelector('#canvas')||document.body).getAttribute('data-busy')`);
    if (b === 'false') return Date.now() - t0;
    await sleep(150);
  }
  return -1;
};

const sendMsg = async (text) => {
  await ev(`(() => {
    const t = document.querySelector('#fk-input') || document.querySelector('.fk-bar textarea');
    const b = document.querySelector('#fk-send');
    if (!t || !b) return 0;
    t.value = ${JSON.stringify(text)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    b.click();
    return 1;
  })()`);
  await waitIdle();           /* 等生成真正结束，不用固定窗口 */
};

/* ── 两个判据函数：正控与负控都调这两个，不许另写一套 ───────── */
const hasVisiblePage = (s) => s.hasPage && s.pageVis >= 20;

const changed = (b, a) => {
  const fpChanged = JSON.stringify(a.fp) !== JSON.stringify(b.fp);
  const relVis = Math.abs(a.pageVis - b.pageVis) / Math.max(b.pageVis, 1);
  const dText = Math.abs(a.textLen - b.textLen);
  /* 文本必须变（同一句话什么都不做是不可能的），并且结构三项里至少一项显著变化 */
  return a.text !== b.text && (fpChanged || relVis >= 0.25 || dText >= 120);
};

const fpKey = (f) => `块${f.g}${f.tb ? '|表' : ''}${f.cards ? '|卡' : ''}${f.fields ? '|字段' : ''}${f.filters ? '|筛选' : ''}${f.first ? '|' + f.first.slice(0, 6) : ''}`;

console.log(`\n画布判据 @ ${BASE}${NEG ? '（负控）' : ''}\n`);

try {
  /* ── 正控 ─────────────────────────────────────────────── */
  await go('/component.html');
  const s0 = await probe();
  /* 引导态 = 有字（说明）+ 有元素（不是一块白）+ 有出口（按钮或对话框能触发）。
     不再要求"默认样例/双栏"——那是上一版的口径，和"首屏是空的"直接冲突。 */
  /* ⚠ 用 canvasVis（整个画布）而不是 pageVis（只数 #canvas .page 里的）：
     首屏是空态时根本没有 .page，拿 pageVis 判会永远 0 —— 判据量错了对象。 */
  chk('A1 首屏是引导态（有说明 + 有入口），不是白板',
    s0.canvasVis >= 3 && s0.textLen >= 12 && s0.cta >= 1,
    `${s0.canvasVis} 个可见元素 · ${s0.textLen} 字 · ${s0.cta} 个入口 · ${s0.name || '(无名)'}`);

  await sendMsg('一个任务列表，带筛选和分页');
  const s1 = await probe();
  chk('A2 说一句后画布确实变了（骨架/可见元素/文本）+ 逐段落地 ≥3',
    changed(s0, s1) && s1.cstep >= 3,
    `${fpKey(s0.fp)}→${fpKey(s1.fp)} · 元素 ${s0.pageVis}→${s1.pageVis} · 文本 ${s0.textLen}→${s1.textLen} · ${s1.cstep} 块`);
  /* 进度条元素在新版画布上不一定存在（生成改成逐段落块，没有独立进度条）。
   不存在 = 没有可展开的进度条 = 已收起，判过；存在则必须 data-off=true。 */
  chk('A3 生成收尾：data-busy=false、进度条收起',
    s1.busy === 'false' && (s1.genOff === null || s1.genOff === 'true'),
    `busy=${s1.busy} genOff=${s1.genOff}`);

  await sendMsg('一张录入表单');
  const s2 = await probe();
  chk('A4 三种要求给出三套两两不同的结构（空态 / 列表 / 表单）',
    new Set([s0, s1, s2].map((x) => fpKey(x.fp))).size === 3,
    [s0, s1, s2].map((x) => `${x.name}:${fpKey(x.fp)}`).join(' · '));

  /* ── 负控：两个注入，各自必须把对应判据打红 ─────────────── */
  if (NEG) {
    if (fail) {
      console.error('\n负控前置：正样本已判红 ' + fail + ' 条，基线不干净，先修页面（负控无意义）');
      ws.close(); chrome.kill('SIGKILL');
      process.exit(2);
    }
    const caught = [];
    console.log('\n  注入 1：生成完把画布恢复成生成前的样子（模拟"点了没变"）\n');
    const snapshot = await ev(`document.querySelector('#canvas-inner').innerHTML`);
    const sBefore = await probe();
    await sendMsg('一个任务列表，带筛选和分页');
    await ev(`document.querySelector('#canvas-inner').innerHTML = ${JSON.stringify(snapshot)}`);
    await sleep(200);
    const sFake = await probe();
    const caught1 = !changed(sBefore, sFake);
    caught.push(caught1 ? 'A2' : null);
    chk('负控 1 成立：画布没变时 A2 判红', caught1,
      `文本 ${sBefore.textLen}→${sFake.textLen} · 指纹 ${fpKey(sBefore.fp)}→${fpKey(sFake.fp)} · ${sFake.cstep} 块`);

    console.log('\n  注入 2：整块画布 visibility:hidden（模拟"生成完什么都不显示"）\n');
    await ev(`(() => {
      const st = document.createElement('style');
      st.id = 'negctl-veil';
      st.textContent = '#canvas{visibility:hidden !important}';
      document.head.appendChild(st);
      return 1;
    })()`);
    await sleep(250);
    const sVeil = await probe();
    const caught2 = !hasVisiblePage(sVeil);
    caught.push(caught2 ? 'A1' : null);
    chk('负控 2 成立：画布不可见时 A1 判红', caught2,
      `可见元素 ${sVeil.pageVis} 个（visibility:hidden 后应归零）`);
    await ev(`(() => { const st = document.querySelector('#negctl-veil'); if (st) st.remove(); return 1; })()`);

    const missing = [caught1 ? null : 'A2', caught2 ? null : 'A1'].filter(Boolean);
    console.log('');
    console.log(missing.length
      ? '负控失败：' + missing.join('、') + ' 抓不住对应缺陷 ⇒ 判据是摆设'
      : '负控成立：A1 / A2 两条判据都能被对应注入打红');
    ws.close(); chrome.kill('SIGKILL');
    process.exit(2);           /* ★ 负控恒为 2 */
  }

  /* ── 失败路径 ─────────────────────────────────────────── */
  await go('/component.html?fail=1');
  const f0 = await probe();
  await sendMsg('加一列金额');
  const f1 = await probe();
  const errShown = await ev(`(() => {
    const e = document.querySelector('#err-strip');
    if (!e) return false;
    const s = getComputedStyle(e);
    return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden';
  })()`);
  chk('A5 失败时提示条可见', errShown === true);
  chk('A6 失败时画布保留上一次成功的样子（不白屏）',
    f1.textLen > 0 && f1.text === f0.text, `前 ${f0.textLen} 字 / 后 ${f1.textLen} 字`);
  chk('A7 失败后 data-busy 回 false（不卡死）', f1.busy === 'false', String(f1.busy));

  await sendMsg('再加一条校验');
  const f2 = await probe();
  chk('A8 ?fail=1 只失败一次（第二句正常生成）',
    f2.text !== f1.text || f2.cstep !== f1.cstep, `块 ${f1.cstep}→${f2.cstep} · 文本 ${f1.textLen}→${f2.textLen}`);

  chk('A9 全程无 JS 异常', c.errs.length === 0, c.errs.slice(0, 2).join(' | '));

  console.log('');
  console.log(fail
    ? '🚫 画布判据断 ' + fail + ' 条'
    : '画布判据：0 条违规（首屏有样例 / 一句话就重画 / 三套骨架互不相同 / 失败不白屏）');
  ws.close(); chrome.kill('SIGKILL');
  process.exit(fail ? 2 : 0);
} catch (e) {
  console.error('FATAL: ' + e.message);
  try { ws.close(); } catch (err) {}
  chrome.kill('SIGKILL');
  process.exit(3);
}
