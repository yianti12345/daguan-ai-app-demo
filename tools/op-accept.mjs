#!/usr/bin/env node
/* op-accept —— 按《操作验收方案-20261027》跑 O1–O7，只出读数，不下结论。
 *
 * 为什么单独写一个：probe.mjs 每次启动都是全新 profile，localStorage 不跨次保留，
 * 而本方案的核心（改 → 撤回 → 版本）必须**同一个浏览器会话连做多步**，否则每步都是一次全新安装。
 * 判据对象是"用户看到的东西"：section.cv-blk[data-comp] 的文字、table 的表头与行。
 *
 * 用法：node tools/op-accept.mjs [base]
 * 退出码：0 跑完（不管红绿）｜3 环境不可用
 * 产物：_reports/op-accept-<YYYYMMDD-HHmm>.json
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') this.errs.push(String(m.params.exceptionDetails.text).slice(0, 160));
      if (m.id != null && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.wait.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
  }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=' + port, '--user-data-dir=/tmp/opacc-' + Date.now(),
  '--remote-allow-origins=*', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) {}
  await SLEEP(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
const c = new CDP(ws);
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0, 200) };
  return r.result.value;
};

const APP = 'app.html?id=hx-zc';
const R = { at: new Date().toISOString(), base: BASE, steps: {} };

/* ── 读页面：只用用户能看见的 DOM，外加 DB.COMPS 的 spec 有无（模型缺口的直接证据） ── */
const state = async () => {
  const raw = await ev(`JSON.stringify((function(){
    var blocks = [].slice.call(document.querySelectorAll('section.cv-blk'));
    var tables = [].slice.call(document.querySelectorAll('#canvas table')).map(function(t){
      var host = t.closest('section.cv-blk');
      return {
        comp: host ? host.getAttribute('data-comp') : '',
        head: [].slice.call(t.querySelectorAll('thead th')).map(function(x){return x.innerText.replace(/\\s+/g,' ').trim();}),
        rows: [].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){return [].slice.call(tr.children).map(function(td){return td.innerText.replace(/\\s+/g,' ').trim();});})
      };
    });
    var msgs = [].slice.call(document.querySelectorAll('.fk-msg')).map(function(m){return m.innerText.replace(/\\s+/g,' ').trim();});
    var h = document.querySelector('#hint');
    var bt = document.querySelector('#fk-send');
    var cv = document.querySelector('#canvas');
    return {
      comps: blocks.map(function(b){return b.getAttribute('data-comp');}),
      texts: blocks.map(function(b){return b.innerText.replace(/\\s+/g,' ').trim();}),
      tables: tables,
      msgN: msgs.length,
      lastMsg: msgs.length ? msgs[msgs.length-1] : '',
      hints: msgs.filter(function(s){return /版本|V\\d/.test(s);}).length,
      hint: h ? { on: h.getAttribute('data-on'), kind: h.getAttribute('data-kind'), text: (h.innerText||'').trim() } : null,
      sendReady: bt ? bt.getAttribute('data-ready') : 'NO_SEND',
      busy: cv ? cv.getAttribute('data-busy') : 'NO_CANVAS',
      hasSpec: window.DB ? DB.COMPS.map(function(x){return x.id + '=' + (x.spec ? 'Y' : 'N');}).join(',') : 'NO_DB',
      installed: window.DB ? DB.COMPS.filter(function(x){return (window.DB.appById(location.search.replace(/^.*id=/,'')).comps||[]).indexOf(x.id)>=0;}).map(function(x){return x.id;}).join(',') : ''
    };
  })())`);
  try { return JSON.parse(raw); } catch (e) { return { __parse: String(raw).slice(0, 200) }; }
};

const goApp = async (label) => {
  c.errs.length = 0;
  await c.send('Page.navigate', { url: BASE + '/' + APP });
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const s = await ev(`JSON.stringify({u:location.pathname+location.search, rs:document.readyState, fab:!!document.querySelector('#fk-input'), cv:!!document.querySelector('#canvas')})`);
    try { const o = JSON.parse(s); if (o.rs === 'complete' && o.fab && o.cv) return { ok: true, ms: Date.now() - t0 }; } catch (e) {}
    await SLEEP(80);
  }
  return { ok: false, ms: -1, errs: c.errs.slice() };
};

/* ── 说话：真输入真点发送（不是直接调函数，否则测的是函数不是路径） ── */
const say = async (text) => {
  const r = await ev(`(function(){
    var ta = document.querySelector('#fk-input'), bt = document.querySelector('#fk-send');
    if (!ta || !bt) return 'NO_INPUT';
    ta.value = ${JSON.stringify(text)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    var ready = bt.getAttribute('data-ready');
    bt.click();
    return ready;
  })()`);
  return r;
};

/* 等落地：小智回了一句 + 画布不忙 + 已连两次稳定。把 hint 时间线一起收下（那就是"有没有进度交代"的证据）。 */
const settle = async (prevMsgN, limit = 90000) => {
  const t0 = Date.now();
  const hints = [];
  let stable = 0, last = '';
  while (Date.now() - t0 < limit) {
    const s = await state();
    if (s.__err || s.__parse) { await SLEEP(300); continue; }
    if (s.hint && s.hint.text && s.hint.text !== last) { hints.push({ ms: Date.now() - t0, kind: s.hint.kind, text: s.hint.text }); last = s.hint.text; }
    const replied = s.msgN > prevMsgN;
    const idle = s.busy === 'false' || s.busy === 'NA' || s.busy === 'NO_CANVAS';
    if (replied && idle) { stable++; if (stable >= 2) return { ms: Date.now() - t0, hints, state: s }; }
    else stable = 0;
    await SLEEP(300);
  }
  return { ms: -1, hints, state: await state() };
};

const resetRaw = async (raw) => {
  await ev(`localStorage.setItem('ifas90:db', ${JSON.stringify(raw)}); 'ok'`);
  await goApp('reset');
};

const J = (x) => JSON.stringify(x);

/* ══ 起点：清空 → 首次打开 ══════════════════════════════════════ */
await c.send('Page.navigate', { url: BASE + '/' + APP });
await SLEEP(800);
await ev(`localStorage.clear(); 'ok'`);
const nav0 = await goApp('first');
await SLEEP(500);
R.steps.起点 = { nav: nav0, state: await state() };
const RAW0 = await ev(`localStorage.getItem('ifas90:db')`);

/* ══ O1 首轮生成 ══════════════════════════════════════════════ */
{
  const before = await state();
  const ready = await say('做一个债券承做审核的应用，我要看审核任务列表和每条规则的结论');
  const s = await settle(before.msgN, 90000);
  R.steps.O1 = {
    sendReadyBeforeClick: ready,
    ms: s.ms,
    hintTimeline: s.hints,
    before: { comps: before.comps, tables: before.tables.length, hasSpec: before.hasSpec },
    after: { comps: s.state.comps, tables: s.state.tables.map((t) => ({ comp: t.comp, cols: t.head.length, rows: t.rows.length })), lastMsg: s.state.lastMsg },
    msgGrew: s.state.msgN - before.msgN,
    canvasChanged: J(before.comps) !== J(s.state.comps) || J(before.tables) !== J(s.state.tables)
  };
}

/* ══ O2 拿不准先说（加一列，没点名哪张表） ════════════════════════ */
{
  const before = await state();
  await say('加一列触发规则');
  /* O2 的判据是"动手之前有没有先问"，所以先看头 5 秒 */
  await SLEEP(5000);
  const early = await state();
  const s = await settle(before.msgN, 90000);
  R.steps.O2 = {
    earlyCols: early.tables.map((t) => ({ comp: t.comp, cols: t.head.length })),
    earlyMsg: early.lastMsg,
    sendReadyAtEarly: early.sendReady,
    changedBeforeAsk: J(before.tables) !== J(early.tables),
    finalMsg: s.state.lastMsg,
    finalCols: s.state.tables.map((t) => ({ comp: t.comp, cols: t.head.length })),
    ms: s.ms
  };
}

/* ══ O3 同一句三次（每次回到同一初始状态） ═══════════════════════ */
{
  const RUNS = [];
  for (let i = 0; i < 3; i++) {
    await resetRaw(RAW0);
    const before = await state();
    await say('在规则结论表里加一列触发规则');
    const s = await settle(before.msgN, 90000);
    const tbl = s.state.tables.filter((t) => t.head.length);
    RUNS.push({
      run: i + 1, ms: s.ms,
      beforeTables: before.tables.map((t) => ({ comp: t.comp, cols: t.head.length, rows: t.rows.length })),
      after: tbl.map((t) => ({ comp: t.comp, head: t.head, rows: t.rows.length, lastColVals: t.rows.map((r) => r[r.length - 1]) })),
      lastMsg: s.state.lastMsg
    });
  }
  const key = (x) => J(x.after);
  R.steps.O3 = {
    runs: RUNS,
    identical: key(RUNS[0]) === key(RUNS[1]) && key(RUNS[1]) === key(RUNS[2]),
    rowCountStable: new Set(RUNS.map((r) => J(r.after.map((t) => t.rows)))).size === 1
  };
}

/* ══ O4 改一处只动一处 ════════════════════════════════════════ */
{
  const before = await state();
  await say('规则结论表只显示待复核的行');
  const s = await settle(before.msgN, 90000);
  const diff = [];
  const n = Math.max(before.texts.length, s.state.texts.length);
  for (let i = 0; i < n; i++) if (before.texts[i] !== s.state.texts[i]) diff.push(before.comps[i] || s.state.comps[i] || ('#' + i));
  R.steps.O4 = {
    ms: s.ms, lastMsg: s.state.lastMsg,
    compsBefore: before.comps, compsAfter: s.state.comps,
    changedBlocks: diff, changedCount: diff.length,
    rowCountBefore: before.tables.map((t) => t.rows.length),
    rowCountAfter: s.state.tables.map((t) => t.rows.length)
  };
}

/* ══ O5 撤回一步 ═════════════════════════════════════════════ */
{
  const before = await state();
  await say('撤回刚才那一步');
  const s = await settle(before.msgN, 30000);
  const s2pre = await state();
  await say('撤回刚才那一步');
  const s2 = await settle(s2pre.msgN, 20000);
  R.steps.O5 = {
    ms: s.ms, lastMsg: s.state.lastMsg,
    colsBefore: before.tables.map((t) => t.head.length),
    colsAfter: s.state.tables.map((t) => t.head.length),
    secondWithdraw: s2.state.lastMsg
  };
}

/* ══ O6 版本：发布一次，看快照里到底有什么 ═══════════════════════ */
{
  const pre = await state();
  /* 点发布 → 确认框 → 确认 */
  const clicked = await ev(`(function(){var b=document.querySelector('#act-publish'); if(!b) return 'NO_BTN'; b.click(); return 'clicked';})()`);
  await SLEEP(600);
  const dlg = await ev(`JSON.stringify((function(){
    var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.offsetParent!==null && /发布/.test(b.innerText);});
    return {n:bs.length, texts:bs.map(function(b){return b.innerText.trim();})};
  })())`);
  const okd = await ev(`(function(){
    var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.offsetParent!==null && /发布/.test(b.innerText);});
    if(!bs.length) return 'NO_OK';
    bs[bs.length-1].click(); return bs[bs.length-1].innerText.trim();
  })()`);
  await SLEEP(1200);
  const snap = await ev(`JSON.stringify((function(){
    var id = location.search.replace(/^.*id=/,'');
    var list = DB.versOf('app', id) || [];
    var top = list[0] || null;
    return {
      n: list.length,
      stable: list.filter(function(v){return v.kind==='stable';}).length,
      top: top ? { v: top.v, kind: top.kind, active: !!top.active, snapKeys: top.snap ? Object.keys(top.snap) : null, hasContent: !!(top.snap && top.snap.content), comps: top.snap && top.snap.comps ? top.snap.comps : null } : null,
      draft: (list.filter(function(v){return v.kind==='draft';})[0] || {}).v
    };
  })())`);
  const hintNow = await state();
  R.steps.O6 = {
    publishClick: clicked, confirmButtons: dlg, confirmClicked: okd,
    hintAfterPublish: hintNow.hint,
    versions: JSON.parse(snap || '{}'),
    cardInChat: hintNow.hints
  };
  /* 版本页：当前线上标记数 */
  const vp = await ev(`(async function(){
    var r = await fetch('versions.html'); var t = await r.text();
    var d = document.createElement('div'); d.innerHTML = t;
    return JSON.stringify({ len: t.length, mark: (t.match(/当前线上/g)||[]).length });
  })()`);
  R.steps.O6.versionPage = JSON.parse(vp || '{}');
}

/* ══ O7 听不懂 ═══════════════════════════════════════════════ */
{
  const before = await state();
  await say('今天天气不错');
  const s = await settle(before.msgN, 60000);
  R.steps.O7 = {
    ms: s.ms, lastMsg: s.state.lastMsg,
    hint: s.state.hint,
    canvasUnchanged: J(before.texts) === J(s.state.texts) && J(before.tables) === J(s.state.tables),
    sendReadyAfter: s.state.sendReady,
    consoleErrs: c.errs.slice()
  };
}

R.final = await state();
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
writeFileSync(new URL('../_reports/op-accept-' + stamp + '.json', import.meta.url), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
chrome.kill('SIGKILL');
process.exit(0);
