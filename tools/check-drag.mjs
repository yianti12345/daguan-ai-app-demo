#!/usr/bin/env node
/* check-drag —— 悬浮元素能不能拖、拖完刷不刷新得掉（2026-10-22 第 1 版）。
 *
 * 为什么有它：用户对这件事说过两次硬要求 ——「支持可以拖动」「刷新保留」。
 * 之前只有静态判据（check-consistency C3：条上有一个 div 手柄），
 * 那判的是"写了 Draggable"，不是"拖得动、拖完还在"。这两件事差得很远：
 * drag.js 里 pointerdown 命中 button/input/a/select/label 会直接 return，
 * 所以一个 `<button>` 包手柄的悬浮条，静态看完全合格，实际一丝都拖不动。
 *
 * 判据：
 *   D1 组件页顶部悬浮条：按住手柄拖 (dx,dy) 后，条的位移与 (dx,dy) 一致（±3）
 *   D2 拖完刷新，位置还在（读的是刷新后的 rect，不是内存里的变量）
 *   D3 应用页底部悬浮条：同上
 *   D4 小智图标：同上（两个页面上都要能拖）
 *   D5 负控：按住条上的按钮拖，条不许动（证明 D1 测的是"拖"，不是"碰巧在那儿"）
 *
 * 用法：node tools/check-drag.mjs [base]          正控（要求全绿）
 *      node tools/check-drag.mjs --negctl        负控：把把手藏起来，必须拖不动（恒 rc=2）
 * 退出码：0 通过 ｜ 2 有断点 ｜ 3 环境不可用
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

/* 基址统一由 tools/base.mjs 解析，本文件不写端口。 */
const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 900;
const NEG = process.argv.includes('--negctl');

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

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/drag-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars',
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
await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error('页面抛错：' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  return r.result.value;
};
const go = async (path, wait = 1800) => {
  c.errs.length = 0;
  await c.send('Page.navigate', { url: BASE + path });
  await sleep(wait);
};
const reload = async () => { await c.send('Page.reload', {}); await sleep(700); };

/* ── 真实鼠标：不是 element.dispatchEvent（合成事件没有 pointerId/capture 语义） ── */
const mouse = (type, x, y, extra = {}) => c.send('Input.dispatchMouseEvent', {
  type, x: Math.round(x), y: Math.round(y), button: 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse', ...extra,
});

async function dragFrom(x, y, dx, dy) {
  await mouse('mousePressed', x, y);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps);
    await sleep(14);
  }
  await mouse('mouseReleased', x + dx, y + dy);
  await sleep(220);
}

/* ── 取"能按住的那个点"：手柄中心（手柄优先，没有手柄就取条本身偏左的空白处） ── */
const PICK = (barSel, handleSel) => `(() => {
  const bar = document.querySelector(${JSON.stringify(barSel)});
  if (!bar) return null;
  const h = ${JSON.stringify(handleSel)} ? bar.querySelector(${JSON.stringify(handleSel)}) : null;
  const t = h || bar;
  const r = t.getBoundingClientRect();
  const br = bar.getBoundingClientRect();
  return { hx: r.left + r.width / 2, hy: r.top + r.height / 2,
           bx: br.left, by: br.top, w: br.width, h: br.height,
           tag: t.tagName, cls: String(t.className).slice(0, 40) };
})()`;

const POS = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top)];
})()`;

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' → ' + detail : ''));
  return ok;
};
const near = (a, b, tol = 4) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/* ── 一个场景：拖一次、量、刷新、再量 ───────────────────────── */
async function scene(label, path, barSel, handleSel, dx, dy) {
  await go('/' + path);
  const pick = await ev(PICK(barSel, handleSel));
  if (!pick) {
    chk(label + '：找到悬浮条', false, barSel + ' 不存在');
    return;
  }
  /* 负控：让它们接不到指针事件。
     ⚠ 第一次写的是 `.dz-handle{display:none}`，结果两栏拖不动、小智照样动 ——
       因为小智浮球**自己就是把手**（没有 .dz-handle 子元素）。
       这说明"藏把手"只对带把手的条成立，不能当成通用注入。
       改成一刀切：给把手和浮球都上 pointer-events:none，谁都不该再动。
       如果这时还能拖，那才说明判据测的不是"拖动"这件事。 */
  if (NEG) {
    await ev(`(() => { const s=document.createElement('style');
      s.textContent='.fk-grip,.xz-fab{pointer-events:none !important}';
      document.head.appendChild(s); return 1; })()`);
  }
  const before = await ev(POS(barSel));
  await dragFrom(pick.hx, pick.hy, dx, dy);
  const after = await ev(POS(barSel));
  const moved = [after[0] - before[0], after[1] - before[1]];
  const okMove = Math.abs(moved[0] - dx) <= 4 && Math.abs(moved[1] - dy) <= 4;
  if (NEG) {
    chk(label + '：藏掉把手后必须拖不动', !okMove, `位移(${moved[0]},${moved[1]})，要求(0,0)`);
  } else {
    chk(label + '：拖得动', okMove, `手柄 ${pick.tag}.${pick.cls} 拖(${dx},${dy}) → 实际位移(${moved[0]},${moved[1]})`);
  }

  if (NEG) return;
  await reload();
  const afterReload = await ev(POS(barSel));
  const okKeep = near(afterReload, after, 3);
  chk(label + '：刷新后位置还在', okKeep, `刷新前(${after}) 刷新后(${afterReload})`);
  return { before, after, afterReload };
}

console.log('── D1/D2 组件页顶部悬浮条');
await scene('组件页底栏', 'component.html', '.fk-bar', '.fk-grip', 0, -80);

console.log('── D3 应用页底部悬浮条');
/* 2026-10-22 拆条之后两页的对话条是同一份共用件（assets/float.*）：.fk-bar + .fk-grip。
   以前一个是顶部 #form、一个是底部 #sbar，两边结构不同，判据得写两套 —— 那正是"同类两套实现"的病。 */
await scene('应用页底栏', 'app.html?id=hx-zc', '.fk-bar', '.fk-grip', -120, -70);

console.log('── D4 小智图标');
/* ★2026-10-25：component.html 这一页按设计**没有浮球** ——
   本页的 AI 入口是中间那条输入轴，右下再挂一颗发光球＝同屏两个入口（见 component.html
   `#xz-host .xz-fab{display:none}` 的注释）。判据不许把"按设计没有"判成"坏了"，
   但也不许静默放过：必须先证明它确实是被设计藏掉的，再打一行 N/A 把理由写出来。
   反面教材就在同一天：C6「配置页不该有平台导航」被我自己装的侧栏判红 —— 判据是对的，
   我不知道那条规则。所以这里把"有没有浮球"当成**被测事实**，不是当成前提。 */
{
  await go('/component.html');
  const fab = await ev(`(() => {
    const f = document.querySelector('.xz-fab');
    if (!f) return { state: 'absent' };
    const cs = getComputedStyle(f);
    const r = f.getBoundingClientRect();
    return { state: (cs.display === 'none' || r.width < 2) ? 'hidden' : 'shown', display: cs.display, w: Math.round(r.width) };
  })()`);
  if (!fab || fab.state === 'shown') {
    await scene('组件页小智', 'component.html', '.xz-fab', null, -90, -60);
  } else {
    pass++;
    console.log(`  ✓ 组件页小智：本页按设计不出现浮球（display=${fab.display || '—'}）—— N/A，不计拖动`);
  }
}
await scene('应用页小智', 'app.html?id=hx-zc', '.xz-fab', null, -90, -60);

console.log(NEG ? '── D5（负控模式跳过）' : '── D5 负控：按住条上的按钮拖，条不许动');
if (!NEG) {
await go('/component.html');
const neg = await ev(`(() => {
  const f = document.querySelector('.fk-bar');
  const b = f && f.querySelector('button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const fr = f.getBoundingClientRect();
  return { hx: r.left + r.width / 2, hy: r.top + r.height / 2, bx: fr.left, by: fr.top, txt: b.textContent.trim() };
})()`);
if (!neg) {
  chk('D5 负控', false, '条上找不到按钮');
} else {
  const b4 = await ev(POS('.fk-bar'));
  await dragFrom(neg.hx, neg.hy, 140, 90);
  const b5 = await ev(POS('.fk-bar'));
  const moved = [b5[0] - b4[0], b5[1] - b4[1]];
  chk('D5 负控：按住按钮拖不动条', near(moved, [0, 0], 2), `按的是「${neg.txt}」，位移(${moved[0]},${moved[1]})，要求(0,0)`);
}

}
console.log('');
console.log(`通过 ${pass} ｜ 断点 ${fail}`);
chrome.kill();
if (NEG) {
  console.log(fail === 0
    ? '负控成立：把手消失后三条悬浮件都拖不动 ⇒ D1/D3/D4 测的是"拖动"这件事本身'
    : '负控失败：藏了把手还能拖 ⇒ 判据测的不是拖动');
  process.exit(2);
}
process.exit(fail ? 2 : 0);
