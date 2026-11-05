#!/usr/bin/env node
/* reach-walk —— 状态机遍历：把界面**所有可达状态**枚举出来，逐个验"这个态能不能离开"。
 *
 * 与 walk.mjs 的分工（SPEC §0）：walk 是"照着当前屏幕点一遍"，回答"此刻有没有死控件"；
 * 本工具是 BFS 状态图，回答"有没有进得去出不来的态"。后者才是实际事故的形态
 * （面板打开后关不掉、发送后对话框消失、切到预览回不去）。
 *
 * 核心不是"多点几个按钮"，是三条：
 *   ① sig() 必须能看见"关掉了"：只数节点会把关闭判成没反应（关闭时 nodes 增量 0、attrs +1）。
 *   ② 回到某状态靠 navigate + 重放 path，且重放后 sig 必须相等 —— 不许"大概回去了就点"。
 *   ③ 出口要**分别**试三种关法（关闭钮 / Esc / 点遮罩），全关不掉才是 R3 红；
 *      不允许像 walk.mjs 那样每点一下无条件按 Esc 替被测对象擦屁股。
 *
 * 用法：
 *   node tools/reach-walk.mjs                正控（期望能跑完并给出状态图）
 *   node tools/reach-walk.mjs --negctl       四条负控全跑（期望 rc=2，每条各自打红）
 *   node tools/reach-walk.mjs --negctl=3     只跑第 3 条负控
 *   node tools/reach-walk.mjs --verbose
 * 退出码：0 正控跑完且 R1–R5 无红 ｜ 2 有红（或负控未打红）｜ 3 环境不可用
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBase, debugPort } from './base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes('--verbose');
const TRACE = process.argv.includes('--trace');
const NEG_ARG = process.argv.find((a) => a.startsWith('--negctl'));
const NEG_ONE = NEG_ARG && /^--negctl=(\d)$/.test(NEG_ARG) ? Number(NEG_ARG.slice(-1)) : null;
const NEG_ALL = !!NEG_ARG && NEG_ONE === null;

/* 安全边界（SPEC §4）：不点不可逆动作。命中即 skipped，宁可少覆盖，不许误操作。
   白名单之外的一律不点 —— 这是"没测"和"没问题"的分界线。 */
const IRREVERSIBLE = /发布|删除|下线|提交|授权|清空|重置/;

/* 预算（写死，超时记 timeout 而不是崩） */
const BUDGET = { stateMs: 6000, totalMs: 90000, maxStates: 12, maxDepth: 4, maxActions: 14 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const PAGE = 'app.html?id=hx-zc';

let BASE;
try { BASE = await resolveBase(); } catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

/* ══ 页面侧探针：全部返回 JSON 字符串 ══════════════════════════
   sig() 是这套判据的地基，SPEC §1 规定死的四段：
     root / nodes / attrs / store
   另外把"面板三件事"放进去（exists / busy / done），否则 closed→open→busy→done
   四个态在签名上分不开。
   ⚠ 排除 #xz-host 整棵是错的（面板就在它里面），正确做法是**排除浮球/徽标等
     面板以外的部分**：否则小智的未读徽标、浮球动画会把每个签名都搅一遍。
     —— 这条与 SPEC 字面有出入，按"能观测到面板态"优先，已在报告里说明。 */
const SIG = `(() => {
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(16); };
  const panel = document.querySelector('.xz-panel');
  const inHost = (e) => !!(e.closest && e.closest('#xz-host'));
  const inPanel = (e) => !!(e.closest && e.closest('.xz-panel'));
  const vis = (e) => { const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const parts = []; let nodes = 0;
  for (const e of document.body.querySelectorAll('*')) {
    if (inHost(e) && !inPanel(e)) continue;          /* 浮球/徽标/动画不参与签名 */
    if (e.matches('#xzLive,#xzAlert,#xzSpot,#xzVig')) continue;
    /* 瞬时反馈不算状态：提示条 3 秒就消失，算进签名会让每个动作凭空多出两个态，
       而且抓到"出现"还是"消失"取决于轮询时机 —— 状态图就不稳定了（实测两次跑差 5 条边）。 */
    if (e.id === 'hint' || e.closest('#hint')) continue;
    if (e.matches('[role="status"],[role="alert"]') || e.closest('[role="status"],[role="alert"]')) continue;
    if (!vis(e)) continue;
    nodes++;
    let a = '';
    for (const at of e.attributes) if (/^(data-|aria-)/.test(at.name)) a += at.name + '=' + at.value + ',';
    parts.push(e.tagName + '|' + String(e.className || '') + '|' + a + '|' +
      (e.value === undefined ? '' : String(e.value).slice(0, 24)) + '|' +
      String(e.innerText || '').length);
  }
  let store = '';
  try { if (window.DB && DB.APPS) store = DB.APPS.map(a => a.id + ':' + a.status + ':' + a.comps.length).join(';'); } catch (e) { store = 'noDB'; }
  const ls = [];
  /* 墙钟值不进签名：ifas90:app:saved:* 存的是"2026-10-23 08:14"这种时刻，两次跑差一分钟
     签名就分叉，于是"保存草稿"之后的整张图都跟着变（实测 43 条边 vs 49 条边，同一条边
     toSig 不同）。只中和"长得像时刻"的值 —— DB 内容、装配数、计数器照旧进签名，
     不能把整个 store 抹掉，那等于关掉负控 4。 */
  const CLOCKY = /^\\d{4}-\\d{2}-\\d{2}([ T]\\d{2}:\\d{2}(:\\d{2})?)?$/;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = String(localStorage.getItem(k));
      ls.push(k + '=' + (CLOCKY.test(v) ? '<clock>' : v.slice(0, 40)));
    }
  } catch (e) {}
  ls.sort();
  const maskOpen = !!document.querySelector('.mask[data-open="true"]');
  const panelInfo = panel ? {
    exists: true,
    n: panel.querySelectorAll('*').length,
    done: !!panel.querySelector('.xz-done'),
    err: !!panel.querySelector('.xz-err'),
    busy: !panel.querySelector('.xz-done') && /正在/.test(panel.innerText || ''),
    says: panel.querySelectorAll('.xz-say').length
  } : { exists: false, n: 0, done: false, err: false, busy: false, says: 0 };
  const obj = {
    root: maskOpen ? 'mask' : (panel ? 'panel' : 'body'),
    nodes, attrs: fnv(parts.join('~')),
    store: fnv(store + '|' + ls.join(';')),
    panel: panelInfo, maskOpen
  };
  obj.hash = fnv(JSON.stringify(obj));
  return JSON.stringify(obj);
})()`;

/* 枚举：可见与不可见**都要**（SPEC §1）。不可见的不是噪音 ——
   "DOM 里有、但用户点不到"正是 R1 要抓的东西，过滤掉就等于把负控 2 关掉。 */
const ENUM = `(() => {
  const vis = (e) => { const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const SEL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
  const out = [];
  for (const e of document.querySelectorAll(SEL)) {
    const t = (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').trim();
    const owner = e.closest('#xz-host') ? 'xz' : (e.closest('.mask') ? 'mask' : (e.closest('.fk-ops') || e.closest('.fk-chip') || e.closest('.fk-bar') ? 'float' : 'page'));
    out.push({
      tag: e.tagName.toLowerCase(), id: e.id || '',
      cls: String(e.className || '').split(' ').filter(Boolean).slice(0, 2).join('.'),
      txt: t.slice(0, 24), href: e.getAttribute('href') || '',
      act: e.getAttribute('data-act') || '',
      visible: vis(e), disabled: !!e.disabled,
      precondition: e.getAttribute('data-ready') === 'false' || e.getAttribute('aria-disabled') === 'true',
      owner
    });
  }
  return JSON.stringify(out);
})()`;

/* 找元素：按"身份"找，不按索引（点开面板会让列表变长，索引必然错位） */
const FIND = (d) => `(() => {
  const D = ${JSON.stringify(d)};
  const SEL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 24);
  const all = [...document.querySelectorAll(SEL)];
  const e = all.find((x) => x.tagName.toLowerCase() === D.tag && (x.id || '') === D.id &&
      norm(x.innerText || x.value || x.getAttribute('aria-label') || '').slice(0, 24) === D.txt);
  if (!e) return JSON.stringify({ found: false });
  const r = e.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  return JSON.stringify({
    found: true, x: cx, y: cy,
    hitSelf: !!hit && (hit === e || e.contains(hit)),
    visible: getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0,
    disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true'
  });
})()`;

const ACTIVE = `(() => {
  const a = document.activeElement;
  if (!a) return '';
  return a.tagName.toLowerCase() + '#' + (a.id || '') + '.' + String(a.className || '').split(' ')[0];
})()`;

const CLICKJS = (d) => `(() => {
  const D = ${JSON.stringify(d)};
  const SEL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 24);
  const e = [...document.querySelectorAll(SEL)].find((x) => x.tagName.toLowerCase() === D.tag && (x.id || '') === D.id &&
      norm(x.innerText || x.value || x.getAttribute('aria-label') || '').slice(0, 24) === D.txt);
  if (!e) return 'GONE';
  e.click();
  return 'CLICKED';
})()`;

/* ══ 浏览器 ═══════════════════════════════════════════════════ */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        this.errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
      }
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

async function openBrowser(tag) {
  const port = await debugPort();
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/reach-${tag}-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  if (!wsUrl) { chrome.kill(); throw new Error('Chrome 起不来'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  const c = new CDP(ws);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { chrome, ws, c };
}

/* ══ 一次完整遍历 ═══════════════════════════════════════════ */
async function runOnce({ label, negctl = 0 }) {
  const { chrome, ws, c } = await openBrowser('rw' + (negctl || 'p'));

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160));
    return r.result.value;
  };

  /* 负控 4：把 sig 降级成"只数节点" —— 用来证明 attrs/store 不是装饰 */
  const sigExpr = negctl === 4
    ? `(() => { const o = { root: 'body', nodes: document.querySelectorAll('*').length, attrs: 0, store: 0 }; o.hash = String(o.nodes); return JSON.stringify(o); })()`
    : SIG;

  /* 每次导航后要重放的注入（负控 1/2/3 靠它） */
  const HOOK = negctl === 1
    /* 摘事件保 DOM：浮球换成克隆节点 + 窗口捕获阶段吞掉落在浮球上的指针事件。
       只 replaceWith 克隆是**打不红**的（实测 R2 绿、27 态 49 边与正控一模一样）：
       xiaozhi.js 的点击是委托到 document 的，克隆节点照样命中委托。
       所以"事件没了"必须真的没 —— 这才是死控件的形态。*/
    ? `(() => {
         const f = document.querySelector('#xz-host .xz-fab'); if (f) f.replaceWith(f.cloneNode(true));
         if (!window.__fabDead) {
           window.__fabDead = 1;
           const hit = (e) => !!(e.target && e.target.closest && e.target.closest('#xz-host .xz-fab'));
           ['pointerdown','mousedown','pointerup','mouseup','click','touchstart'].forEach(function (t) {
             window.addEventListener(t, function (e) { if (hit(e)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
           });
         }
         return 1; })()`
    /* 藏可达元素：把浮球塞进 display:none —— DOM 还在，用户点不到 */
    : negctl === 2
      ? `(() => { const f = document.querySelector('#xz-host .xz-fab'); if (f) f.style.display = 'none'; return 1; })()`
      /* 堵死出口：✕ 不可点 + 吞掉 Esc。面板没有遮罩，第三种关法本来就不存在 */
      : negctl === 3
        ? `(() => { const st = document.createElement('style'); st.textContent = '.xz-x{pointer-events:none !important}'; document.head.appendChild(st);
             if (!window.__escBlocked) { window.__escBlocked = 1;
               window.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopImmediatePropagation(); }, true); }
             return 1; })()`
        : `(() => 1)()`;

  /* ⚠ 重放必须从**同一初始态**开始：localStorage 里任何一个键（收起状态、保存时间戳、
     已装组件）都会让"navigate 之后"和上次不一样。实测踩到：点了「收起对话框」写入
     ifas90:dlgCollapsed=1 之后，下一次 replay 的页面是收起态，签名对不上 ⇒ 整轮 break，
     后面的控件全没测。所以每次导航前清一次 local_storage，由页面从种子重建。 */
  const ORIGIN = new URL(BASE).origin;
  const nav = async () => {
    try { await c.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' }); } catch (e) {}
    await c.send('Page.navigate', { url: BASE + '/' + PAGE });
    for (let i = 0; i < 25; i++) {                 /* 等就绪，别死睡：本地 200–300ms 就够 */
      try { if (await ev('document.readyState') === 'complete') break; } catch (e) {}
      await sleep(60);
    }
    await sleep(150);
    try { await ev(HOOK); } catch (e) {}
  };
  const sigNow = async () => JSON.parse(await ev(sigExpr));
  const enumNow = async () => JSON.parse(await ev(ENUM));

  const key = (d) => d.id ? `${d.tag}|#${d.id}` : `${d.tag}|${d.cls}|${d.txt}`;
  /* 白名单复用 walk-allow.json：同一控件在不同页的 tag 会变（div/button），
     所以按 page|cls|txt 宽松匹配，避免"换个标签就失配"。 */
  let ALLOW = {};
  try { ALLOW = JSON.parse(readFileSync(join(HERE, 'walk-allow.json'), 'utf8')); } catch (e) { ALLOW = {}; }
  const allowReason = (d) => {
    for (const k of Object.keys(ALLOW)) {
      if (k.startsWith('_')) continue;
      const [pg, , cls, txt] = k.split('|');
      if (cls === d.cls && txt === d.txt) return ALLOW[k];
    }
    return '';
  };
  const isLinks = (d) => d.tag === 'a' && d.href && !/^javascript:/.test(d.href);

  /* 真指针点击（SPEC §1 要求，不用 el.click()）：
     先做命中测试，被别的元素挡住就说明"用户点不到"，按命中元素算；
     拿不到坐标（隐藏元素）才算不可点。 */
  async function clickReal(d) {
    const info = JSON.parse(await ev(FIND(d)));
    if (!info.found) return 'GONE';
    if (!info.visible) return 'HIDDEN';
    if (info.disabled) return 'DISABLED';
    if (!info.hitSelf) {
      /* 被遮挡：仍然走一次 el.click()，但要记录"用户点不到"这件事 */
      const r = await ev(CLICKJS(d));
      return r === 'CLICKED' ? 'COVERED' : r;
    }
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y });
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    return 'CLICKED';
  }
  const pressEsc = async () => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  };
  /* 点遮罩空白处：在遮罩矩形里找一个不被面板盖住的点 */
  const clickMask = async () => {
    const pt = JSON.parse(await ev(`(() => {
      const m = document.querySelector('.mask[data-open="true"]');
      if (!m) return JSON.stringify({ none: true });
      const p = m.querySelector('.panel');
      const mr = m.getBoundingClientRect();
      const cands = [[mr.left + 8, mr.top + 8], [mr.right - 8, mr.top + 8], [mr.left + 8, mr.bottom - 8], [mr.right - 8, mr.bottom - 8]];
      for (const [x, y] of cands) {
        const hit = document.elementFromPoint(Math.round(x), Math.round(y));
        if (hit && (hit === m) && !(p && p.contains(hit))) return JSON.stringify({ x: Math.round(x), y: Math.round(y) });
      }
      return JSON.stringify({ none: true });
    })()`));
    if (pt.none) return 'NO_MASK';
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    return 'CLICKED';
  };

  /* 观察：点完之后把签名变化链记下来。
     ⚠ 不能"稳定了就停"：busy→done 中间会有 >1s 的稳定期，早停就丢掉 done。
     规则：处于 busy 态时一直等到预算上限；其余情况连续两次没变就收。 */
  async function observe(capMs = 1600) {
    const seen = []; let last = null, stable = 0;
    const end = Date.now() + capMs;
    while (Date.now() < end) {
      const s = await sigNow();
      if (s.hash !== last) { seen.push(s); last = s.hash; stable = 0; }
      else {
        stable++;
        const busy = s.panel && s.panel.busy;
        if (!busy && stable >= 2 && seen.length > 0) break;
      }
      await sleep(130);
    }
    return seen;
  }

  const t0 = Date.now();
  const states = [];                 /* {id, path, hash, obj, depth, parent, controls} */
  const byHash = new Map();
  const edges = [];                  /* {from, how, to, ok, ms, notes} */
  const els = [];                    /* 元素级记录（SPEC §5 形状） */
  const unreached = [];              /* {state, el, why} */
  const clickedKeys = new Set();
  const hiddenSeen = new Map();     /* key -> {state, el}：只在这里登记，最后才判"到底有没有到达过" */
  const visibleKeys = new Set();    /* 曾经在任何一个态里可见过 —— 这就是"到达"的定义 */
  const tried = new Set();
  let cur = null;

  await nav();
  const rootSig = await sigNow();
  const root = { id: 's0', path: [], hash: rootSig.hash, obj: rootSig, depth: 0, parent: null, controls: [] };
  states.push(root); byHash.set(root.hash, root); cur = root;

  const settleTo = async (st) => {
    /* 已在就返回；否则先试"原地再点一次最后一步"（开→关→再开的常见情形，
       省掉一次整页导航），签名对上才算；对不上再整页重放。
       两条路都必须以 sig 相等收尾 —— 不许"大概回去了就点"。 */
    const now = await sigNow();
    if (now.hash === st.hash) { cur = st; return true; }
    if (st.path.length) {
      const last = st.path[st.path.length - 1];
      try {
        const r = await clickReal(last);
        if (r === 'CLICKED' || r === 'COVERED') {
          await observe(700);
          if ((await sigNow()).hash === st.hash) { cur = st; return true; }
        }
      } catch (e) {}
    }
    await nav();
    for (const step of st.path) {
      const r = await clickReal(step);
      if (r !== 'CLICKED' && r !== 'COVERED') return false;
      await observe(700);
    }
    const back = await sigNow();
    if (back.hash !== st.hash) {
      unreached.push({ state: st.id, el: '(整态)', why: 'unstable', note: '重放后签名不符' });
      return false;
    }
    cur = st;
    return true;
  };

  /* ── BFS 主体 ── */
  const queue = [root];
  while (queue.length) {
    if (Date.now() - t0 > BUDGET.totalMs) {
      for (const st of queue) unreached.push({ state: st.id, el: '(整态)', why: 'timeout', note: '总预算耗尽' });
      break;
    }
    const st = queue.shift();
    if (st.depth > BUDGET.maxDepth) { unreached.push({ state: st.id, el: '(整态)', why: 'no-path', note: '超过深度上限' }); continue; }
    if (!(await settleTo(st))) continue;

    const list = await enumNow();
    if (TRACE) console.log(`   [${st.id}] depth=${st.depth} 控件 ${list.length} 个 · ${Math.round((Date.now() - t0) / 1000)}s`);
    st.controls = list.map((x) => ({ key: key(x), txt: x.txt, owner: x.owner, visible: x.visible }));

    /* 不可见 / 禁用 / 不可逆：登记，不点 */
    for (const d of list) {
      const k = key(d);
      if (!d.visible) { hiddenSeen.set(k, { state: st.id, el: d }); continue; }
      visibleKeys.add(k);
      if (d.disabled || d.precondition) { els.push({ state: st.id, el: d, verdict: 'disabled', why: d.precondition ? '前置条件未满足（如空输入时的发送键）' : 'disabled', visible_at_rest: st.depth === 0 }); continue; }
      if (isLinks(d)) { els.push({ state: st.id, el: d, verdict: 'skipped', why: 'navigation', visible_at_rest: st.depth === 0 }); continue; }
      if (IRREVERSIBLE.test(d.txt)) { els.push({ state: st.id, el: d, verdict: 'skipped', why: 'irreversible', visible_at_rest: st.depth === 0 }); continue; }
      if (allowReason(d)) { els.push({ state: st.id, el: d, verdict: 'allowed', why: allowReason(d), visible_at_rest: st.depth === 0 }); continue; }
    }

    let acts = 0;
    const actCap = st.depth === 0 ? BUDGET.maxActions : 4;   /* 深态只补新控件，不做全量重试 */
    for (const d of list) {
      if (acts >= actCap) break;
      if (Date.now() - t0 > BUDGET.totalMs) break;   /* 单态里也要看总预算，否则一个态能把整轮吃掉 */
      if (!d.visible || d.disabled || d.precondition || isLinks(d) || IRREVERSIBLE.test(d.txt) || allowReason(d)) continue;
      const k = key(d);
      const tk = st.id + '|' + k;
      if (tried.has(tk)) continue;
      tried.add(tk); acts++;
      clickedKeys.add(k);

      const ts = Date.now();
      if (!(await settleTo(st))) break;
      const before = await sigNow();
      const t1 = Date.now();
      if (TRACE) console.log(`   · [${st.id}] ${d.owner}/${d.cls}「${d.txt}」 settle=${t1 - ts}ms`);
      let res;
      try { res = await clickReal(d); } catch (e) { res = 'ERR:' + String(e.message).slice(0, 40); }
      if (res === 'GONE' || res === 'HIDDEN') continue;

      const chain = await observe(Math.min(BUDGET.stateMs, 3200));
      c.errs.length = 0;
      const after = chain.length ? chain[chain.length - 1] : before;
      const changed = chain.some((s) => s.hash !== before.hash);
      const focusNow = await ev(ACTIVE);

      if (!changed) {
        els.push({ state: st.id, el: d, verdict: 'dead', why: res === 'COVERED' ? '被遮挡且无反应' : 'DOM/存储都没变', visible_at_rest: st.depth === 0, focusReturned: null });
      } else {
        els.push({ state: st.id, el: d, verdict: 'ok', why: res, visible_at_rest: st.depth === 0,
          effect: { nodes: after.nodes - before.nodes, store: after.store !== before.store }, focusReturned: null });
        /* 变化链上的每一跳都是一个新状态（busy→done 这种中间态必须留住） */
        let prev = st, prevSig = before;
        for (const s of chain) {
          if (s.hash === prevSig.hash) continue;
          let nxt = byHash.get(s.hash);
          if (!nxt) {
            nxt = { id: 's' + states.length, path: prev.path.concat([d]), hash: s.hash, obj: s, depth: prev.depth + 1, parent: prev, controls: [] };
            states.push(nxt); byHash.set(s.hash, nxt);
            if (states.length <= BUDGET.maxStates && nxt.depth <= BUDGET.maxDepth) queue.push(nxt);
            else unreached.push({ state: nxt.id, el: '(整态)', why: states.length > BUDGET.maxStates ? 'timeout' : 'no-path', note: '超出状态/深度上限' });
          }
          edges.push({ from: prev.id, how: 'act「' + (d.txt || k) + '」', to: nxt.id, ok: true, ms: Date.now() - t1, notes: s.panel && s.panel.busy ? 'busy' : '' });
          prev = nxt; prevSig = s;
        }
      }
    }
  }

  /* ── 出口（SPEC §3）：每个开态三种关法各试一次 ────────────────── */
  const closeRows = [];
  const overlayStates = states.filter((s) => (s.obj.panel && s.obj.panel.exists) || s.obj.maskOpen);
  /* 同一种浮层（同样的关闭钮、同样的遮罩构成）关法就一套，不按内容重复测 3 遍。
     第一次遇到时实测，其余记 inherited 并指回实测的那个态 —— 这样 R3 仍然是
     "每个开态都有可用的关法"，只是证据来自同类实测（负控 3 会先在第一个态打红）。 */
  const batteryDone = new Map();
  const batteryKey = (st) => (st.obj.maskOpen ? 'mask:.panel .p-x' : 'panel:.xz-x');
  for (const st of overlayStates) {
    const parent = st.parent || root;
    const kind = st.obj.maskOpen ? 'mask' : 'panel';
    const bk = batteryKey(st);
    if (batteryDone.has(bk)) {
      const src = batteryDone.get(bk);
      const rows = closeRows.filter((r) => r.state === src).map((r) => ({ ...r }));
      for (const r of rows) closeRows.push({ state: st.id, kind, how: r.how, ok: r.ok, why: r.why, focus: r.focus, inherited: src });
      if (!rows.some((r) => r.ok)) edges.push({ from: st.id, how: 'ALL', to: st.id, ok: false, ms: 0, notes: '继承自 ' + src + '：三种关法全败' });
      continue;
    }
    batteryDone.set(bk, st.id);
    for (const how of ['close-btn', 'esc', 'mask']) {
      if (Date.now() - t0 > BUDGET.totalMs) {
        closeRows.push({ state: st.id, kind, how, ok: false, why: 'timeout', untested: true });
        edges.push({ from: st.id, how, to: parent.id, ok: false, ms: 0, notes: 'timeout-untested' });
        continue;
      }
      if (!(await settleTo(st))) { closeRows.push({ state: st.id, kind, how, ok: false, why: 'unstable' }); continue; }
      if (TRACE) console.log(`     ~ ${st.id} ${kind}/${how} 开始 · ${Math.round((Date.now() - t0) / 1000)}s`);
      const t1 = Date.now();
      let howNote = '';
      if (how === 'close-btn') {
        const sel = kind === 'mask' ? '.panel .p-x' : '.xz-x';
        const btn = JSON.parse(await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return JSON.stringify({ none: true });
          const r = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
        if (btn.none) { closeRows.push({ state: st.id, kind, how, ok: false, why: '没有关闭钮' }); continue; }
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      } else if (how === 'esc') {
        await pressEsc();
      } else {
        const r = await clickMask();
        if (r === 'NO_MASK') { closeRows.push({ state: st.id, kind, how, ok: false, why: '没有遮罩（这类浮层本就没有遮罩）' }); edges.push({ from: st.id, how: 'mask', to: parent.id, ok: false, ms: 0, notes: 'no-mask' }); continue; }
      }
      await sleep(260);
      const after = await sigNow();
      const closed = (kind === 'mask' ? !after.maskOpen : !(after.panel && after.panel.exists));
      const restored = after.hash === parent.hash;
      const focusAfter = await ev(ACTIVE);
      const ok = closed && restored;
      closeRows.push({ state: st.id, kind, how, ok, why: ok ? '' : (!closed ? '关不掉' : '关掉了但界面没复原'), focus: focusAfter, ms: Date.now() - t1 });
      edges.push({ from: st.id, how, to: parent.id, ok, ms: Date.now() - t1, notes: ok ? focusAfter : (!closed ? '关不掉' : 'sig 未复原') });
    }
    /* 三种都关不掉 ⇒ 这个开态就是死胡同 */
    const rows = closeRows.filter((r) => r.state === st.id);
    if (!rows.some((r) => r.ok)) edges.push({ from: st.id, how: 'ALL', to: st.id, ok: false, ms: 0, notes: '三种关法全部失败' });
  }

  /* ── 后处理：把"同一个控件在不同态里的表现"合并成一条结论 ──────────
     ① 死控件是**控件的属性**，不是 (态,控件) 的属性：某个键在别的态里已经被点出反应，
        那这一处没反应就是幂等（保存同一个时间戳）或已选中（点当前 tab），不是死控件。
     ② 隐藏元素在**每个**未见过的态里都会被枚举到，按态记会刷出几十条重复的 unreached；
        真正该问的是"这个控件到底有没有在任何一个态里被点到过"。 */
  const okKeys = new Set(els.filter((e) => e.verdict === 'ok').map((e) => key(e.el)));
  for (const e of els) {
    if (e.verdict === 'dead' && okKeys.has(key(e.el))) {
      e.verdict = 'ok';
      e.why = '同控件在别的态有反应；此处幂等或已选中';
    }
  }
  /* ⚠ 只靠 :hover 出现的控件（行内「卸载」）在枚举时是 display:none，会被当成不可达 ——
     但它对鼠标用户是可达的。这里对它做一次真的悬停复查：把鼠标移到它所在行上，
     再问一次可见性；真的出现了就点它一次，算到达。 */
  const HOVER_AT = (d) => `(() => {
    const D = ${JSON.stringify(d)};
    const SEL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const e = [...document.querySelectorAll(SEL)].find((x) => x.tagName.toLowerCase() === D.tag && (x.id || '') === D.id &&
      norm(x.innerText || x.value || x.getAttribute('aria-label') || '') === D.txt);
    if (!e) return JSON.stringify({ found: false });
    const row = e.closest('.row') || e.parentElement;
    const r = (row || e).getBoundingClientRect();
    return JSON.stringify({ found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), elx: 0, ely: 0 });
  })()`;
  const VIS_AT = (d) => `(() => {
    const D = ${JSON.stringify(d)};
    const SEL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], input[type="checkbox"], summary';
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const e = [...document.querySelectorAll(SEL)].find((x) => x.tagName.toLowerCase() === D.tag && (x.id || '') === D.id &&
      norm(x.innerText || x.value || x.getAttribute('aria-label') || '') === D.txt);
    if (!e) return 'GONE';
    const cs = getComputedStyle(e);
    return (cs.display !== 'none' && e.getClientRects().length > 0) ? 'VISIBLE' : 'HIDDEN';
  })()`;

  for (const [k, v] of hiddenSeen) {
    if (visibleKeys.has(k)) continue;
    if (Date.now() - t0 > BUDGET.totalMs) break;
    const stt = states.find((x) => x.id === v.state);
    if (!stt) continue;
    if (!(await settleTo(stt))) continue;
    try {
      const at = JSON.parse(await ev(HOVER_AT(v.el)));
      if (!at.found) continue;
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
      await sleep(160);
      const vs = await ev(VIS_AT(v.el));
      if (TRACE) console.log(`   ~hover ${k} → ${vs}`);
      if (vs !== 'VISIBLE') continue;
      visibleKeys.add(k);                        /* 悬停后确实出现 ⇒ 对鼠标用户可达 */
      els.push({ state: stt.id, el: v.el, verdict: 'ok', why: 'hover-only：悬停行后出现', visible_at_rest: false });
    } catch (e) {}
  }

  const seenHidden = new Set();
  for (const [k, v] of hiddenSeen) {
    if (visibleKeys.has(k)) continue;            /* 在某个态里露过面 ⇒ 已到达（点不点是另一回事） */
    if (seenHidden.has(k)) continue;
    seenHidden.add(k);
    els.push({ state: v.state, el: v.el, verdict: 'unreachable', why: 'hidden', visible_at_rest: false });
    unreached.push({ state: v.state, el: v.el.txt || k, why: 'no-path', note: 'DOM 里有但任何态下都不可见' });
  }
  const pageErrs = c.errs.slice(0, 3);
  try { ws.close(); } catch (e) {}
  chrome.kill();

  /* ── R1–R5 ── */
  const restControls = new Set(((states.find((s) => s.id === 's0') || {}).controls || []).filter((x) => x.visible).map((x) => x.key));
  for (const e of els) e.visible_at_rest = restControls.has(key(e.el));
  const allControls = new Set();
  for (const s of states) for (const ctl of s.controls) allControls.add(ctl.key);
  const offRest = [...allControls].filter((k) => !restControls.has(k));

  const deadList = els.filter((e) => e.verdict === 'dead');
  const openStates = [...new Set(closeRows.map((r) => r.state))];
  const tested = (r) => !r.untested;
  const unclosable = openStates.filter((sid) => {
    const rows = closeRows.filter((r) => r.state === sid && tested(r));
    return rows.length > 0 && !rows.some((r) => r.ok);   /* 全都没关掉；一条没测到的不算红，另列 */
  });
  const untestedStates = openStates.filter((sid) => !closeRows.some((r) => r.state === sid && tested(r)));
  const escOnly = openStates.filter((sid) => {
    const rows = closeRows.filter((r) => r.state === sid);
    return rows.length && rows.filter((r) => r.ok).length === 1 && rows.find((r) => r.ok).how === 'esc';
  });

  const R = [];
  const unCtl = unreached.filter((u) => u.el !== '(整态)');
  const unState = unreached.filter((u) => u.el === '(整态)');
  R.push({ id: 'R1', name: '覆盖：首屏外的控件都到达过', ok: unCtl.length === 0,
    detail: `首屏外控件 ${offRest.length} 个（已到达 ${offRest.filter((k) => visibleKeys.has(k)).length}），控件级未到达 ${unCtl.length} 个`
      + (unState.length ? `；另有 ${unState.length} 个态因预算/深度未展开（已在 R4 记 why）` : '') });
  R.push({ id: 'R2', name: '死控件：点了没反应且无白名单', ok: deadList.length === 0, detail: deadList.length ? deadList.map((d) => `${d.state} ${d.el.txt || d.el.tag}（${d.why}）`).join(' / ') : '' });
  R.push({ id: 'R3', name: '出口：每个开态至少一种关法能关且界面复原', ok: unclosable.length === 0, detail: unclosable.length ? unclosable.map((sid) => `${sid}:` + closeRows.filter((r) => r.state === sid).map((r) => r.how + '=' + (r.ok ? 'ok' : r.why)).join(',')).join(' | ') : (untestedStates.length ? `未测到：${untestedStates.join(',')}` : '') });
  R.push({ id: 'R4', name: '可达性：未到达的每条都有原因', ok: unreached.every((u) => !!u.why), detail: unreached.length ? `${unreached.length} 条均有 why` : '空' });
  R.push({ id: 'R5', name: '安全：没有不可逆元素被点过', ok: ![...clickedKeys].some((k) => IRREVERSIBLE.test(k)), detail: '' });

  return { label, negctl, states, edges, closeRows, els, unreached, R, root, offRest, escOnly, pageErrs };
}

/* ══ 输出 ═══════════════════════════════════════════════════ */
function summarize(r) {
  const { states, edges, closeRows, R } = r;
  const rest = states.find((s) => s.id === 's0') || { controls: [] };
  const restVis = new Set(rest.controls.filter((x) => x.visible).map((x) => x.key));
  const all = new Set();
  for (const s of states) for (const c of s.controls) all.add(c.key);
  const offReached = [...all].filter((k) => !restVis.has(k));
  console.log(`\n── ${r.label}`);
  console.log(`   状态 ${states.length} 个：` + states.map((s) => {
    const o = s.obj;
    const tag = o.panel && o.panel.exists ? (o.panel.done ? 'DONE' : (o.panel.busy ? 'BUSY' : 'OPEN')) : (o.maskOpen ? 'DIALOG' : 'CLOSED');
    return `${s.id}(${tag}${s.id === 's0' ? '/rest' : ''})`;
  }).join(' '));
  console.log(`   边 ${edges.length} 条（其中关法 ${closeRows.length} 条）`);
  console.log(`   控件：可达总数 ${all.size} ｜ 首屏可见 ${rest.controls.length} ｜ 首屏外到达 ${offReached.length}`);
  for (const x of R) console.log(`   ${x.ok ? '✓' : '✗'} ${x.id} ${x.name}${x.detail ? ' → ' + x.detail : ''}`);
  if (r.escOnly.length) console.log(`   ⚠ 只有 Esc 能关的开态：${r.escOnly.join(', ')}（其余关法缺失，记黄不记红）`);
  if (r.pageErrs.length) console.log(`   ⚠ 页面异常 ${r.pageErrs.length} 条：${r.pageErrs.join(' | ')}`);
  if (VERBOSE) {
    for (const c of closeRows) console.log(`     · ${c.state} ${c.kind}/${c.how} → ${c.ok ? 'ok' : 'FAIL ' + c.why}${c.focus ? ' focus=' + c.focus : ''}`);
  }
}

function writeJsonl(all) {
  const lines = [];
  for (const r of all) {
    for (const e of r.els) {
      lines.push(JSON.stringify({ kind: 'el', page: PAGE, state: e.state, el: { tag: e.el.tag, id: e.el.id, cls: e.el.cls, name: e.el.txt, owner: e.el.owner, visible_at_rest: !!e.visible_at_rest }, verdict: e.verdict, why: e.why || '', effect: e.effect || null, focusReturned: e.focusReturned === undefined ? null : e.focusReturned }));
    }
    const sigOf = (id) => (r.states.find((s) => s.id === id) || {}).hash || '';
    for (const x of r.edges) lines.push(JSON.stringify({ kind: 'edge', page: PAGE, from: x.from, how: x.how, to: x.to, ok: x.ok, ms: x.ms, notes: x.notes || '', fromSig: sigOf(x.from), toSig: sigOf(x.to) }));
  }
  const p = join(HERE, 'reach-paths.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return { path: p, lines: lines.length };
}

/* ══ 入口 ═══════════════════════════════════════════════════ */
if (NEG_ALL || NEG_ONE) {
  /* 负控：每条都必须打红，且能指到具体元素/态/关法。判定用同一套 R1–R5，不另写"我觉得该红"。 */
  const want = NEG_ONE ? [NEG_ONE] : [1, 2, 3, 4];
  const EXPECT = {
    1: { R: 'R2', name: '摘事件保 DOM → 死控件点名到浮球' },
    /* 判据归位：藏起来 → unreached(why=no-path) → 打红的是 **R1 覆盖**。
       R4 问的是"未到达的有没有给出原因"，只要有 why 它就绿 —— 这是设计如此，
       原先让它去红 R4 是判据错位（实测 R1 红、R4 绿，被记成"负控不成立"）。 */
    2: { R: 'R1', name: '藏可达元素 → unreached(no-path)，打红 R1 覆盖' },
    3: { R: 'R3', name: '堵死出口 → 开态三种关法全败' },
    4: { R: 'R2', name: '劣化 sig（只数节点）→ 关闭类动作被判死' }
  };
  let bad = 0;
  for (const n of want) {
    const r = await runOnce({ label: `负控 ${n}：${EXPECT[n].name}`, negctl: n });
    summarize(r);
    const target = r.R.find((x) => x.id === EXPECT[n].R);
    const red = !target.ok;
    /* "指到具体位置"按**用户看得见的名字**算，不认内部类名：R2 的 detail 写的是
       「s0 小智助手（DOM/存储都没变）」，只认 xz-fab 会把真结果判成"没指到"。 */
    const pointed = (n === 1) ? /xz-fab|小智助手/.test(r.R.find((x) => x.id === 'R2').detail)
      : (n === 2) ? r.unreached.some((u) => /xz-fab/.test(u.el))
        : (n === 3) ? r.R.find((x) => x.id === 'R3').detail.includes('ALL') || r.R.find((x) => x.id === 'R3').detail.includes('关不掉')
          : r.R.find((x) => x.id === 'R2').detail.length > 0;
    console.log(`   ${red ? '✓' : '✗'} 负控 ${n}：${EXPECT[n].R} ${red ? '已打红' : '未打红'}${pointed ? '，且指到了具体位置' : '，但没指到具体位置'}`);
    if (!red || !pointed) bad++;
  }
  console.log(`\n负控汇总：${want.length - bad}/${want.length} 条成立${bad ? '（有假的）' : '（四条都真）'}`);
  process.exit(2);   /* 负控恒 2：它证明的是"能红"，不是"通过" */
}

const r = await runOnce({ label: '正控 app.html?id=hx-zc' });
summarize(r);
const out = writeJsonl([r]);
const allOk = r.R.every((x) => x.ok);
console.log(`\n路径记录：${out.path}（${out.lines} 行）`);
console.log(`结论：${allOk ? 'R1–R5 全过' : '有红项：' + r.R.filter((x) => !x.ok).map((x) => x.id).join(' ')}`);
process.exit(allOk ? 0 : 2);
