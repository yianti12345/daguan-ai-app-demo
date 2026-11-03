#!/usr/bin/env node
/* e2e-flow —— 三条流程的一键验收。只判「能不能从入口走到出口」，不管样式。
 *
 * 为什么要有它：门禁全绿但流程断着，这是今天的核心教训。
 * 门经验的取值/跳转/状态，验不出「用户做不完一件事」。这个脚本补的就是这一层。
 *
 * 用法：node tools/e2e-flow.mjs [base]        默认 http://127.0.0.1:8977
 *       node tools/e2e-flow.mjs --flow B      只跑某一条（A 小智 / B 组件 / C 应用）
 * 退出码：0 全通 ｜ 2 有断点 ｜ 3 环境不可用
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

/* ── 本轮结论的三个判点：只读结构化记录 + 本轮专属元素，不猜散文 ─────────────
 * ★2026-10-28（机制审查官）：这三处原来都从 #xzBody 的**整段散文**里正则取数，踩了两个坑，
 *   20261028-020647 全量门禁里化成三个断点（日志第 15/49/61 行，被 run-gates 的 tail -10 截掉）：
 *   ① 产品对同一件事有**两种合法措辞**（assets/xiaozhi.js:1234-1238）：
 *      `用了 X 秒 · 动了 N 下`（done/settled）与 `用了 X 秒 · 点了 N 下，但结果没变`（giveup）。
 *      只认第一种 ⇒ giveup 那一轮"没等到动作计数"（12 秒轮空）；
 *      更坏的是 /动了 N 下/ 会匹配到**上一轮**的脚注 —— 实测"面板说 2 下，本轮流水记 3 次"，
 *      那个 2 是上一轮的数。两边都不是产品的问题，是判据在猜散文。
 *   ② `本轮成功的结论进了 polite 节点` 把"成功"写死成 /做完了/。而产品口径是
 *      **fail 也走 polite**、assertive 只服务事故（assets/xiaozhi.js:1284-1289）——
 *      一轮正当以 giveup 收尾时这条必红。红在判据，不在页面。
 * 现在：动作数读 `__xzLog` 的 finish 记录（xzLogPush 落的 {ev:'finish',kind,actsTotal,secs}），
 * 面板自称的数字读本轮专属的 `.xz-done-s`，档位词由 kind 映射。取不到结构化记录 ⇒ 红（不是跳过）。 */
const KT = { done: '做完了', wait: '等你确认', fail: '没做成', stop: '已停止' };
const claimOf = (s) => { const m = String(s || '').match(/(?:动了|点了)\s*(\d+)\s*下/); return m ? Number(m[1]) : null; };
export function judgeRound(fin, footText, liveText) {
  const n = fin && Number.isFinite(Number(fin.actsTotal)) ? Number(fin.actsTotal) : null;
  const claim = claimOf(footText);
  const want = fin && KT[fin.kind] ? KT[fin.kind] : null;
  return {
    acted: { ok: n != null && n >= 1,
      detail: fin ? `finish.actsTotal=${n} kind=${fin.kind} secs=${fin.secs}` : '读不到 finish 记录（__xzLog 无 ev=finish）—— 取不到结构化读数即红' },
    claim: { ok: n != null && claim != null && claim === n,
      detail: `本轮脚注说 ${claim == null ? '没写次数' : claim + ' 下'}，finish.actsTotal=${n == null ? '无' : n}` },
    polite: { ok: want != null && String(liveText || '').includes(want),
      detail: `kind=${fin ? fin.kind : '无'} ⇒ 应播「${want || '?'}」；live=${JSON.stringify(String(liveText || '').slice(0, 28))}` },
  };
}

/* ── 「那一下真点开了装配面板」的判点（2026-10-29 修假绿）──────────────────
 * 改前判的是 `#mask[data-open] === 'true'` —— 那是**存在**，不是**因果**。
 * 实测：这一页落地自带装配抽屉（`?panel=installed` ⇒ assets/app.js:2269 `openDlg('on')`），
 * 抽屉在流程一开始就开着，于是无论小智这一轮一个动作都没做（finish.actsTotal=0），
 * 还是点了别的东西，只要抽屉开着这条就绿。判"有没有开"和判"是不是这一下开的"是两回事。
 * 现在必须同时成立三件，缺一件判红：
 *   ① 本轮开始前抽屉是**关着**的（否则"开着"归因不到这一下 —— 不点也开着的场景必须红）；
 *   ② 本轮结束后抽屉是开着的；
 *   ③ 本轮 finish 记录存在且 actsTotal ≥ 1（它真的动了手）。
 * 只判 ①③ 不判 ② 会放过"没开"；只判 ② 就是改回原来的假绿。 */
export function judgeOpened(beforeOpen, afterOpen, actsTotal) {
  const n = (actsTotal == null || actsTotal === '' || !Number.isFinite(Number(actsTotal))) ? null : Number(actsTotal);
  const ok = beforeOpen === false && afterOpen === true && n !== null && n >= 1;
  return { ok, detail: `本轮开始前=${beforeOpen === true ? '开着' : beforeOpen === false ? '关着' : '未读'} · 本轮结束后=${afterOpen === true ? '开着' : afterOpen === false ? '关着' : '未读'} · 本轮 finish.actsTotal=${n == null ? '无' : n}` };
}

/* ── 事故构造判点（纯函数，--negctl 直接喂脏读数）──────────────────────
 * ★2026-10-29 修（盲审 A1）：走 `G.xzGrant=1` 兜底时，产品自己的授权卡没有被点过，
 * 「先走完产品自己的不可逆确认」这句话就被绕过了 —— 兜底只能当诊断（让下游 7 条事故判据
 * 有块可量），不许当通过。通过必须同时：桩装上 + 真出事故块 + 确认来自点授权卡。
 * 白名单式兜底之所以必须堵：卡坏了、卡没出现、卡点不到，三种情况在旧判据里都是绿。 */
export function judgeIncident({ stub, inc, grant }) {
  const ok = stub === true && Number(inc) >= 1 && grant === '已点确认执行';
  return { ok, detail: `桩=${stub === true} 事故块=${Number(inc) || 0} 不可逆确认=${grant}` };
}

/* ── 导航判点（纯函数）────────────────────────────────────────────────
 * ★2026-10-29 修（盲审 A3）：上一版把「这是新文档」简化成只比 pathname，
 * 把 id 一起放掉了 —— 同路径换 id 时旧文档 pathname 一样，判据会量到上一个文档。
 * 现在 id 是地址身份的一部分：目标带 id，就必须核对页面读回的 id；不带 id 的页（/apps.html）不要求。
 * 通过 = 文档已换（或同址重导）＋ pathname 相同 ＋ id 相同 ＋ readyState=complete ＋ 容器齐。 */
export function navCheck(o, fresh, sameDoc, want) {
  const freshDoc = fresh === true || sameDoc === true;
  const idOk = want.id == null || o.id === want.id;
  return { ok: freshDoc && o.here === want.path && idOk && o.rs === 'complete' && !(o.miss && o.miss.length),
    freshDoc, idOk,
    detail: `新文档=${fresh === true} 同址重导=${sameDoc === true} · path=${o.here}${want.id == null
      ? ' · id=不要求' : ' · id=' + (o.id == null ? '读不到' : o.id) + '/期望 ' + want.id}` };
}

/* ── 负控：同一份判逻辑喂脏读数，每一处必须各自判红（不起浏览器，纯函数自证）──
 * 没有这条，改完判据只能说"它绿了"，不能说"它还会红"。 */
if (process.argv.includes('--negctl')) {
  const good = { actsTotal: 3, kind: 'done', secs: '2.1' };
  const footOk = '用了 2.1 秒 · 动了 3 下';
  const liveOk = '小智：做完了，用了 2.1 秒 · 动了 3 下。';
  const base = judgeRound(good, footOk, liveOk);
  const baseOpened = judgeOpened(false, true, 2);
  const baseNav = navCheck({ here: '/app.html', id: 'hx-zc', rs: 'complete', miss: [] }, true, false, { path: '/app.html', id: 'hx-zc' });
  const baseInc = judgeIncident({ stub: true, inc: 1, grant: '已点确认执行' });
  const cuts = [
    ['动作数（finish 记录缺失）', judgeRound(null, footOk, liveOk).acted],
    ['脚注与流水不符（点了 2 下 vs 流水 3）', judgeRound(good, '用了 2.1 秒 · 点了 2 下，但结果没变', liveOk).claim],
    ['档位词与 kind 不符（kind=fail 却播「做完了」）',
      judgeRound({ actsTotal: 3, kind: 'fail', secs: '8.2' }, '用了 8.2 秒 · 点了 3 下，但结果没变', '小智：做完了，用了 8.2 秒 · 点了 3 下。').polite],
    ['装配面板：不点也开着（本轮开始前就开着 ⇒ 归因不到这一下）', judgeOpened(true, true, 3)],
    ['装配面板：装了 0 个动作却报"点开了"（原假绿）', judgeOpened(false, true, 0)],
    ['装配面板：点了但没开', judgeOpened(false, false, 2)],
    ['导航：同路径换了 id（旧版只比 pathname ⇒ 会量到上一个文档）',
      navCheck({ here: '/app.html', id: 'hx-other', rs: 'complete', miss: [] }, true, false, { path: '/app.html', id: 'hx-zc' })],
    ['导航：目标带 id 但页面读不到 id', navCheck({ here: '/app.html', id: null, rs: 'complete', miss: [] }, true, false, { path: '/app.html', id: 'hx-zc' })],
    ['事故构造：走了 G.xzGrant 兜底（产品授权卡没被点，不许算通过）', judgeIncident({ stub: true, inc: 1, grant: '授权位兜底' })],
  ];
  console.log('e2e 判点负控（同一份判逻辑，喂脏读数；执行路径见 judgeRound / judgeOpened 注释）');
  for (const [name, r] of cuts) console.log(`  ${r.ok === false ? '✓' : '✗'} ${name} → ${r.ok === false ? '判红' : '仍绿'}｜${r.detail}`);
  const positive = [...Object.entries(base), ['judgeOpened 正控', baseOpened], ['navCheck 正控', baseNav], ['judgeIncident 正控', baseInc]];
  const dirty = positive.filter(([, r]) => r.ok !== true);
  if (dirty.length) { console.error(`正控不成立：干净读数被判红（${dirty.map(([k]) => k).join(' / ')}）`); process.exit(3); }
  const bad = cuts.filter(([, r]) => r.ok !== false);
  if (bad.length) { console.error(`负控失败：${bad.length} 处弄脏后仍绿 —— 判点是空的`); process.exit(3); }
  console.log(`负控全部成立（rc=2）：${cuts.length} 处弄脏各自判红，干净读数 ${positive.length} 处全绿`);
  process.exit(2);
}

/* 基址统一由 tools/base.mjs 解析，本文件不写端口。 */
const BASE = await resolveBase();   /* 基址唯一来源，见 tools/base.mjs */
const ONLY = (() => { const i = process.argv.indexOf('--flow'); return i > 0 ? process.argv[i + 1] : null; })();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return new Promise((res, rej) => { this.wait.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 30000); });
  }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/e2e-${Date.now()}`,
  '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) {}
  await SLEEP(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
const c = new CDP(ws);
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

let pass = 0, fail = 0;
const rows = [];
function chk(flow, name, ok, detail = '') {
  if (ok) pass++; else fail++;
  rows.push(`${ok ? '  ✓' : '  ✗'} [${flow}] ${name}${detail ? ' → ' + detail : ''}`);
  return ok;
}
const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
  return r.result.value;
};
/* ── 导航：等"真的到了"，不等"大概到了" ─────────────────────────────────
 * ★2026-10-22 改：原来是 `Page.navigate` + 固定 `SLEEP(700)`。
 * 踩过的坑：一条断言 3 跑 1 红（`从列表能拿到某个应用的配置地址` 读到空 href），
 * 查下来是 apps.html 正被写、服务端吐了半个文件出来 —— 700ms 之后照样是白页。
 * 固定睡眠治不了这个病：它只是把"等多久"换成另一个猜的数字 —— 慢机器上照样红、快机器上白等。
 * 现在等三件同时成立：
 *   ① URL 已经是新地址 —— 否则量的是**上一个文档**：从 components.html 跳到 apps.html 时，
 *      旧文档本身就有 .card，第一版只等"readyState + 容器"就在这里"立刻就绪"了；
 *   ② readyState = complete；
 *   ③ 目标容器出现（按页传：列表页 .card；配置页 #canvas + #app-name + .xz-fab，
 *      因为紧接着就要点浮球，少一个都会在下游变成看不清来源的红）。
 * 3 秒还不成立就**判红并说明卡在哪一条** —— 不许静默继续，否则"环境慢"和"页面根本没渲染"
 * 在下游会变成同一种红，谁也分不清。 */
const go = async (flow, path, need = ['.kcard']) => {
  c.errs.length = 0;
  /* ★2026-10-29 修（这一条自己在判"相等"，而产品会合法改写地址）：
     原来拿 `location.pathname + location.search` 去 `indexOf(path) === 0` —— 比的是**带消费参数的落地地址**。
     而 app.js 吃掉 `panel=installed` / `updates=1` 后把地址改写成 `?id=hx-zc&debug=1`，
     于是这条**每一跑都白等满 3 秒再判红**，红在判据的字符串比较上，页面 78ms 就就绪了
     （实测：readyState=complete、缺 []、当前 /app.html?id=hx-zc&debug=1）。
     只把比较改成 pathname 会放过另一种错：同路径换 id 时，旧文档 pathname 一样，判据会量到上一个文档。
     所以要判的其实是"这是**新文档**"，不是"地址字符串像"：
       ① `performance.timeOrigin` 变了 = 换了文档（同路径导航也认得出）；
          唯一例外是同地址重导，解释器可能复用文档 —— 那种情况 URL 完全相同，用 `sameDoc` 放行；
       ② `location.pathname` === 目标 pathname（参数怎么被改写都不影响这一条）；
       ③ readyState=complete + 目标容器出现（原样保留）。
     3 秒上限未动；条件从"地址字符串相等"换成"文档确已更换 + 身份未变"。
     ★2026-10-29 再修（盲审 A3）：上一版只比 pathname，把 id 一起放掉了 —— 那是放宽。
     现在目标地址带 id 就必须核对页面读回的 id（同路径换 app 会判红），不带 id 的页不要求。 */
  const target = BASE + path;
  const want = (() => {
    try { const u = new URL(target); return { path: u.pathname, id: u.searchParams.get('id') }; }
    catch (e) { const q = path.split('?'); return { path: q[0], id: new URLSearchParams(q[1] || '').get('id') }; }
  })();
  let prev = { here: '', born: 0 };
  try {
    const p = JSON.parse(await ev(`JSON.stringify({here:location.pathname+location.search,born:(window.performance&&performance.timeOrigin)||0})`));
    if (p && !p.__err) prev = p;
  } catch (e) { /* 首个文档还没起来：prev 保持空，任何 timeOrigin 都算"换了文档" */ }
  const sameDoc = prev.here === path;
  await c.send('Page.navigate', { url: target });
  const t0 = Date.now(), LIMIT = 3000;
  let last = { here: '(导航中)', search: '', id: null, rs: '-', miss: need, born: 0 }, errs = 0;
  while (Date.now() - t0 < LIMIT) {
    try {
      const raw = await ev(`JSON.stringify((function(){
        var miss = ${JSON.stringify(need)}.filter(function(s){ return !document.querySelector(s); });
        return { here: location.pathname, search: location.search, id: new URLSearchParams(location.search).get('id'),
          rs: document.readyState, miss: miss, born: (window.performance && performance.timeOrigin) || 0 };
      })())`);
      const o = JSON.parse(raw);
      last = o;
      const fresh = o.born !== prev.born;
      const nc = navCheck(o, fresh, sameDoc, want);
      if (nc.ok) {
        chk(flow, `页面在 3 秒内就绪（${path}）`, true, `${Date.now() - t0}ms · ${nc.detail}`);
        return;
      }
    } catch (e) { errs++; }   /* 导航提交那一瞬执行上下文会被销毁，求值必然失败 —— 这是正常的，重试即可，不算红 */
    await SLEEP(50);
  }
  const nc = navCheck(last, last.born !== prev.born, sameDoc, want);
  chk(flow, `页面在 3 秒内就绪（${path}）`, false,
    `等满 ${Date.now() - t0}ms · readyState=${last.rs} · 缺 ${JSON.stringify(last.miss)} · 当前 ${last.here}${last.search || ''}` +
    ` · ${nc.detail}` + (errs ? ` · 求值失败 ${errs} 次` : ''));
};

/* 等生成真的结束，而不是死等一个拍脑袋的秒数。
 * 2026-10-26 实测：同一句话首次生成与二轮改写耗时不同（二轮实测第 5 秒才 data-busy=false），
 * 判据写死 SLEEP(4200) 就把"慢"报成了"没重画"——红在判据，不在页面。 */
const waitIdle = async (flow, label, limit = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const busy = await ev(`(function(){var c=document.querySelector('#canvas');return c?c.getAttribute('data-busy'):'NO_CANVAS';})()`);
    await SLEEP(250);
    if (busy === 'false') return Date.now() - t0;
  }
  chk(flow, `${label}（等生成结束）`, false, `${limit}ms 内 data-busy 一直不是 false —— 生成没收敛`);
  return -1;
};

/* ── 流程 B：造一个组件它出现在列表里 ─────────────────────── */
async function flowB() {
  /* 2026-10-26：组件库的卡不是应用卡。应用卡 .kcard（封面图三段式），组件卡 .crow.ccard（渐变底）。
     原判据在 components.html 上查 .kcard，永远 0 张 —— 页面有 8 张，红在判据不是在页面。 */
  await go('B', '/components.html', ['.crow.ccard']);
  const before = await ev(`document.querySelectorAll('.crow.ccard').length`);
  chk('B', '组件库渲染出卡片', before > 0, `${before} 张`);

  /* 2026-10-22 用户口径：创建组件是**一张表单**，不是"说一句话生成"。
     ★2026-10-29（盲审 A5）：表单从「名称/启用禁用/介绍」三样改成**两样**（名称/介绍）——
     产品 2026-10-28 按 D1 删掉「启用状态」开关（components.html:111-112：新建即未发布，
     开关不改变任何结果，只让人以为拨一下就能装）。判据还在等旧的三样 ⇒ 判据过期，
     改判产品当前契约；同时把"开关不在表单里"锁成断言，防止它被无声加回来。 */
  const entry = await ev(`(function(){var b=document.querySelector('#btn-new');if(!b)return 'NO_ENTRY';b.click();return 'clicked';})()`);
  chk('B', '有「新增组件」入口', entry !== 'NO_ENTRY', String(entry));
  await SLEEP(400);

  const formOpen = await ev(`(function(){
    var m=document.querySelector('#nf-mask');
    return JSON.stringify({open:!!m && !m.hidden,
      fields:['#nf-name','#nf-desc'].filter(function(q){return !!document.querySelector(q);}).length,
      sw:!!document.querySelector('#nf-sw'),
      ok:document.querySelector('#nf-ok') ? document.querySelector('#nf-ok').disabled : null});
  })()`);
  const F = JSON.parse(formOpen);
  /* 判的是产品当前契约：名称 + 介绍两样；启用开关按 D1 已从新建表单移除（不在表单里才算对）。
     不是删断言：从「三样齐」换成「两样齐 + 第三样确实不存在」，少一样或偷偷加回都判红。 */
  chk('B', '弹出了创建表单（名称 / 介绍 两样；启用开关按 D1 不在新建表单里）',
    F.open === true && F.fields === 2 && F.sw === false, JSON.stringify(F));
  chk('B', '名称为空时不能提交', F.ok === true, String(F.ok));

  const filled = await ev(`(function(){
    var n=document.querySelector('#nf-name'); if(!n) return 'NO_NAME';
    n.value='债承复核队列'; n.dispatchEvent(new Event('input',{bubbles:true}));
    var d=document.querySelector('#nf-desc'); if(d) d.value='待复核任务集中处理';
    return document.querySelector('#nf-ok').disabled ? 'STILL_DISABLED' : 'ok';
  })()`);
  chk('B', '填了名称后可以提交', filled === 'ok', String(filled));

  await ev(`(function(){var b=document.querySelector('#nf-ok'); if(b) b.click(); return 1;})()`);
  await SLEEP(1200);
  const onNew = await ev(`location.pathname.split('/').pop()`);
  chk('B', '创建后落到它的配置页（带 id）', onNew === 'component.html' && /\?id=/.test(await ev('location.search')), String(onNew));

  /* 画布首屏必须是**空的**（用户口径），底部有对话框。 */
  const first = JSON.parse(await ev(`JSON.stringify({
    guide: (document.querySelector('#canvas').innerText || '').replace(/\s+/g,' ').trim().length,
    bar: !!document.querySelector('.fk-bar'),
    input: !!document.querySelector('#fk-input')
  })`));
  chk('B', '首屏是空态引导 + 底部有对话框', first.guide >= 12 && first.bar && first.input, JSON.stringify(first));

  // 输入并发送
  const typed = await ev(`(function(){var t=document.querySelector('#fk-input');if(!t)return 'NO_INPUT';
t.value='债承项目任务列表，按状态筛选，能批量指派';t.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`);
  chk('B', '对话框能输入', typed === 'ok', String(typed));
  if (typed === 'ok') {
    const sent1 = await ev(`(function(){var b=document.querySelector('#fk-send');if(!b)return 'NO_SEND';b.click();return 'btn:send';})()`);
    chk('B', '找到发送键', String(sent1).indexOf('NO_SEND') < 0, String(sent1));
    await SLEEP(2600);
    // ★ 关键：发送后对话框必须还在（原缺陷：会永久消失）
    const stillThere = await ev(`(function(){var t=document.querySelector('#fk-input');if(!t)return false;var r=t.getBoundingClientRect();return r.width>0&&getComputedStyle(document.querySelector('.fk-bar')).display!=='none';})()`);
    chk('B', '发送后对话框仍在', stillThere === true);

    const t1 = await waitIdle('B', '首次生成', 15000);
    const v1 = JSON.parse(await ev(`JSON.stringify({
      steps: document.querySelectorAll('#canvas .cstep').length,
      busy: (document.querySelector('#canvas')||{}).getAttribute ? document.querySelector('#canvas').getAttribute('data-busy') : null,
      name: ((document.querySelector('#comp-name')||{}).textContent)||'',
      page: ((document.querySelector('#canvas .page')||{}).textContent)||'',
      text: ((document.querySelector('#canvas')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
      emptyGone: !document.querySelector('#canvas .comp-empty')
    })`));
    chk('B', '说完画布长出页面（空态消失）', v1.steps >= 3 && v1.emptyGone === true, `${v1.steps} 块 · 空态已消失=${v1.emptyGone} · ${v1.name} · 等 ${t1}ms`);
    chk('B', '生成结束 data-busy 回到 false', v1.busy === 'false', String(v1.busy));

    /* 连续改：每次生成都是整页重画，判"页面内容变了"而不是"多一张卡"。
       2026-10-26：判据原来只比 #canvas .page —— 生成结果是 .cstep 块，.page 只在预置组件才存在，
       于是这条比的是两个空串。改成比整块 #canvas 的文本。 */
    if (stillThere) {
      await ev(`(function(){var t=document.querySelector('#fk-input');t.value='再加一条金额校验';t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
      await ev(`(function(){var b=document.querySelector('#fk-send');if(b)b.click();return 1;})()`);
      const t2 = await waitIdle('B', '第二次生成', 15000);
      const v2 = JSON.parse(await ev(`JSON.stringify({
        steps: document.querySelectorAll('#canvas .cstep').length,
        text: ((document.querySelector('#canvas')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
        name: ((document.querySelector('#comp-name')||{}).textContent)||''
      })`));
      chk('B', '能连续改（整页被重画）', v2.text !== v1.text || v2.name !== v1.name,
        `块 ${v1.steps}→${v2.steps} · 文案${v2.text !== v1.text ? '变了' : '没变'} · 等 ${t2}ms · 文本 ${v1.text.length}→${v2.text.length}`);
    }
  }
  const noErr = c.errs.length === 0;
  chk('B', '该页无 JS 异常', noErr, c.errs.slice(0, 2).join(' | '));
}

/* ── 流程 C：进一个应用、装卸组件、计数变化 ───────────────── */
async function flowC() {
  await go('C', '/apps.html');
  const cards = await ev(`document.querySelectorAll('.kcard').length`);
  chk('C', '应用列表渲染出卡片', cards > 0, `${cards} 张`);

  const jumped = await ev(`(function(){var a=document.querySelector('.kcard .kbtn[href]');if(!a)return 'NO_LINK';var h=a.getAttribute('href');a.click();return h;})()`);
  chk('C', '卡片「配置」带应用 id', /app\.html\?id=/.test(String(jumped)), String(jumped));
  await SLEEP(1400);

  if (/app\.html/.test(String(await ev(`location.pathname`)))) {
    const nameShown = await ev(`(function(){var h=document.querySelector('#app-name');return h?h.textContent.trim().slice(0,40):''})()`);
    chk('C', '顶栏显示了当前应用', !!nameShown, nameShown);

    /* 2026-10-26：app.html 的已装计数就在 #act-count（实测值 "3"），装配入口是 #act-assemble。
       原判据查 .fab .count / #fk-chip* —— 那是已在 10-26 改版中消失的旧 DOM，全部 MISSING。 */
    const cnt0 = await ev(`(function(){var e=document.querySelector('#act-count');return e?e.textContent.trim():'NO_COUNT';})()`);
    chk('C', '底部条有已装计数', cnt0 !== 'NO_COUNT', String(cnt0));

    const opened = await ev(`(function(){var b=document.querySelector('#act-assemble');if(!b)return 'NO_BTN';b.click();return 'ok';})()`);
    await SLEEP(700);
    const rowsN = await ev(`document.querySelectorAll('#dlg-list .row').length`);
    chk('C', '装配面板列出组件', rowsN > 0, `${rowsN} 行 · 入口 ${opened}`);

    if (rowsN > 0) {
      await ev(`(function(){var r=document.querySelector('#dlg-list .row');if(!r)return 0;r.click();return 1;})()`);
      await SLEEP(600);
      const cnt1 = await ev(`(function(){var e=document.querySelector('#act-count');return e?e.textContent.trim():'NO_COUNT';})()`);
      chk('C', '装卸后计数变化', String(cnt1) !== String(cnt0), `${cnt0} → ${cnt1}`);
    }
  }
  chk('C', '该页无 JS 异常', c.errs.length === 0, c.errs.slice(0, 2).join(' | '));
}

/* ── 流程 A：小智能说一句并给出结果 ───────────────────────── */
async function flowA() {
  /* ★2026-10-22 修：原来直接开 /app.html（不带 id），路由会把它弹回列表页 ——
     于是整条 A 流程其实跑在 apps.html 上，而"装配组件"胶囊只存在于某个应用的配置页。
     判据盯着一个这页上根本没有的控件，红得毫无意义。先从列表取真实 id 再进。 */
  await go('A', '/apps.html');
  const appHref = await ev(`(function(){var a=document.querySelector('.kcard .kbtn[href]');return a?a.getAttribute('href'):'';})()`);
  chk('A', '从列表能拿到某个应用的配置地址', /app\.html\?id=/.test(String(appHref)), String(appHref));
  if (!/app\.html\?id=/.test(String(appHref))) { chk('A', '该页无 JS 异常', c.errs.length === 0, ''); return; }
  /* ?debug=1 让 xiaozhi.js 挂出 window.__xzLog（可机读的动作流水）。
     为什么要它：原来"它到底动没动手"只能读面板上助手自己写的中文 —— 判据的输入是被告的供词。 */
  await go('A', '/' + String(appHref).replace(/^\//, '') + '&debug=1', ['#canvas', '#app-name', '.xz-fab']);
  /* 进页面第一件事：把两个播报节点的**引用**记下来。
     为什么要记引用：这两个节点必须是常驻的 —— 如果哪天有人把它们挪进 renderXz 的模板字符串里，
     每次渲染换一个新节点，读屏器不会播（新节点首次插入不算"内容变更"）。判引用相同就是在判这件事。 */
  let alertBefore = '';
  let okBefore = 0;
  const liveInit = JSON.parse(await ev(`(function(){
    window.__liveRef = document.getElementById('xzLive');
    window.__alertRef = document.getElementById('xzAlert');
    var l = window.__liveRef, a = window.__alertRef;
    return JSON.stringify({
      live: !!l, alert: !!a,
      liveRole: l ? l.getAttribute('role') : null, liveLevel: l ? l.getAttribute('aria-live') : null,
      alertRole: a ? a.getAttribute('role') : null, alertLevel: a ? a.getAttribute('aria-live') : null,
      liveText: l ? l.textContent : '', alertText: a ? a.textContent : ''
    });
  })()`));
  chk('A', '页面一加载就有两个常驻播报节点（不是用的时候才建）', liveInit.live && liveInit.alert,
    `#xzLive=${liveInit.live} #xzAlert=${liveInit.alert}`);
  chk('A', '播报档位靠两个节点分开：status/polite + alert/assertive',
    liveInit.liveRole === 'status' && liveInit.liveLevel === 'polite'
    && liveInit.alertRole === 'alert' && liveInit.alertLevel === 'assertive',
    `live=${liveInit.liveRole}/${liveInit.liveLevel} alert=${liveInit.alertRole}/${liveInit.alertLevel}`);
  /* 两个节点初始必须是空的：非空说明它是"上一轮残留"，后面的播报判据会被它骗过 */
  chk('A', '播报节点初始为空（否则后面读到的是上一轮残留）',
    !liveInit.liveText && !liveInit.alertText,
    `live=${JSON.stringify(liveInit.liveText)} alert=${JSON.stringify(liveInit.alertText)}`);
  const opened = await ev(`(function(){var f=document.querySelector('.xz-fab');if(!f)return 'NO_FAB';f.click();return 'ok';})()`);
  chk('A', '小智浮球可点开', opened === 'ok', String(opened));
  /* ★2026-10-22 加：浮层的键盘出口。放在这里而不是流程末尾，是因为后面的段会自己点开装配抽屉。
     ★2026-10-29 修（前置假设错）：这段原来假定"面板刚打开=干净状态"，而这一页**落地就带装配抽屉**
     （`?panel=installed` ⇒ assets/app.js:2269 `openDlg('on')`），抽屉 z-index 100 压在小智面板 71 之上。
     于是 Esc 被抽屉吃掉、面板仍然开着 ⇒ 「Esc 能关掉」「焦点回浮球」两条必红，红在判据的起点，不在页面。
     现在按**用户的做法**先把抽屉收掉（点它自己的关闭钮），再量 Esc —— 量之前的状态由判据自己负责，
     不假定产品落地即干净。判的东西（Esc 关面板 / 焦点回浮球）与判定条件一个字未改；
     抽屉收没收干净写进 detail，收不干净时下面两条红得出来源。 */
  await SLEEP(300);
  const drawer0 = JSON.parse(await ev(`JSON.stringify((function(){
    var m=document.querySelector('#mask');
    return { open: !!m && m.getAttribute('data-open') === 'true', close: !!document.querySelector('#dlg-close') };
  })())`));
  if (drawer0.open) {
    await ev(`(function(){var b=document.querySelector('#dlg-close');if(b)b.click();return 1;})()`);
    await SLEEP(400);
  }
  const drawer1 = JSON.parse(await ev(`JSON.stringify((function(){
    var m=document.querySelector('#mask');
    return { open: !!m && m.getAttribute('data-open') === 'true' };
  })())`));
  const drawerNote = `Esc 前抽屉：改前=${drawer0.open ? '开着（落地自带）' : '关着'} · 改后=${drawer1.open ? '仍开着' : '已收干净'}`;
  await SLEEP(600);
  /* ⚠ 判"开没开"必须按**它实际的表达方式**：小智面板是 `X.open ? '<section class="xz-panel">' : ''`
     条件渲染出来的 —— 开=元素在，关=元素不在。我第一版写成读 `data-open` 属性，
     而这个属性**从来不存在**，于是"关不掉"和"打不开"都会被读成 false（假绿/假红都能造出来）。 */
  const readOpen = async () => JSON.parse(await ev(`JSON.stringify({
    open: !!document.querySelector('.xz-panel')
  })`));
  let esc0 = await readOpen();
  if (!esc0.open) {
    await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`);
    await SLEEP(500);
    esc0 = await readOpen();
  }
  chk('A', '面板处于打开态（否则下面的 Esc 判据会空跑）', esc0.open === true, `open=${esc0.open}`);
  if (esc0.open) {
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await SLEEP(400);
    const after = JSON.parse(await ev(`JSON.stringify({
      open: !!document.querySelector('.xz-panel'),
      onFab: !!(document.activeElement && document.activeElement.classList.contains('xz-fab'))
    })`));
    chk('A', '浮层按 Esc 能关掉', after.open === false, `open=${after.open} · ${drawerNote}`);
    chk('A', '关掉后焦点回到浮球（不是掉回 body）', after.onFab === true, `onFab=${after.onFab} · ${drawerNote}`);
    /* 继续后面的流程，面板必须处于**打开**态 —— 但"开着没有"要**读**出来，不许靠再点一下碰运气。
       ★2026-10-29 修（自毁前置，机制审查官）：原来是**无条件**点一次浮球当"重新打开"。
       而落地地址带 `?panel=installed`（assets/app.js:2269 `openDlg('on')`），装配抽屉先开着、
       z-index 100 压在小智面板 71 之上 —— 上面那一下 Esc 被抽屉吃掉，面板其实**还开着**。
       于是这一次点击不是"重新打开"，是**把面板关掉**：其后 chips=0，整段判据被 if 跳过，
       未跳过的连锁判红。改前实测：面板有推荐问题 0 条 ｜ 20 通过 / 19 断点。
       但这一条也是**判据在骗自己**的典型：它假定"面板刚打开=干净状态"，而这一页落地自带弹层。
       现在只做一件事：真关着才点开，开着就不碰 —— 不靠"再点一下"把状态碰对。 */
    const stillOpen = await readOpen();
    if (!stillOpen.open) {
      await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`);
      await SLEEP(500);
    }
  }

  await SLEEP(600);
  /* 2026-10-29：`.xz-q .chip` → `.xz-q .xz-chip`。可点胶囊与只读角标 `.chip` 撞名（`.chip`
     带 pointer-events:none），前端把可点件收回 xiaozhi 命名空间。判据照实现改名跟随，
     判的东西一个字没动：面板上有几枚推荐问题 / 点第一枚。 */
  const chips = await ev(`document.querySelectorAll('.xz-q .xz-chip').length`);
  chk('A', '面板有推荐问题', chips > 0, `${chips} 条`);

  if (chips > 0) {
    await ev(`(function(){document.querySelectorAll('.xz-q .xz-chip')[0].click();return 1;})()`);
    let sawPanel = false, sawResult = false, last = '';
    /* 2026-10-26：`.xz-err` 之前被当成"给出了结果块"，于是模型输出坏掉时也判绿。
       现在单独记一个标志：它 true 说明本轮没量到真实结论，不是"通过"。 */
    let sawModelBad = false;
    for (let i = 0; i < 10; i++) {
      await SLEEP(2200);
      const st = await ev(`(function(){var p=document.querySelector('.xz-panel');var b=document.querySelector('.xz-body');
        return JSON.stringify({panel:!!p,body:!!b,len:b?b.innerText.length:0,done:b?!!b.querySelector('.xz-done'):false,
          err:b?((b.querySelector('.xz-err')||{}).textContent||'').slice(0,40):''});})()`);
      last = String(st);
      /* ★2026-10-26 修（假绿）：原来 `if (v.done || v.err)` 就把"给出了结果块"判真，
         而 `.xz-err` 里装的是「模型这轮没给出可执行的动作（输出格式不对）」——
         那是**模型坏了**，不是"给出了结论"。实测第 4 次跑 rc=0，而首问明确写着这句。
         现在两者分开：done 才算结果块；err 单独一条判据，并且它红了说明本轮未量到真实结论。 */
      try { const v = JSON.parse(last); if (v.panel) sawPanel = true;
        if (v.done) { sawResult = true; break; }
        if (v.err) { sawModelBad = true; break; }
      } catch (e) {}
    }
    chk('A', '面板全程没消失（原缺陷：会自动关闭）', sawPanel, last.slice(0, 80));
    chk('A', '给出了结果块（做完 / 没做成 / 等确认）', sawResult, last.slice(0, 100));
    chk('A', '模型这轮给了可执行输出（不是"输出格式不对"）', !sawModelBad,
      sawModelBad ? '本轮模型输出不可解析 ⇒ 上面几条"结论"类判据未量到真实值，不能当绿' : 'ok');


  /* ★2026-10-22 加：小智"说做完了"不算，必须**真的动了手**。
     为什么加：修观测范围之前，它在这两页上一直报「没做成 · 没有动页面」，
     而当时的判据只看"面板在 + 有结果块"——**结果块本身可以是"没做成"，所以判据一直绿着**。
     第一版这里用的是推荐问题（"这套规则里哪些是我改过的"）—— 那是**打听**，它回话不动手，
     所以这条判据永远红。红得没错，是判据挑错了输入：验"动手"就得给一句有落点的指令。
     现在改成第二问「点一下装配组件」，并且**边跑边看**（高亮框只在动作那一刻存在，
     等做完了再查等于查不到）。盯三件事：动了 N≥1 下 / 高亮框带标签（选中状态） / 顶部线+底部条。 */
  /* 记下这一轮**开始前** assertive 节点的文本：本轮若成功，它不该被再写一次。
     不做这个快照就只能看"alert 是不是空的"，而这条流程里前面有一轮是失败的，
     那个残留会一直在 —— 断言会永远红。（第一版就是这么错的，红在一条本来对的实现上。） */
  alertBefore = await ev(`(function(){var a=document.getElementById('xzAlert');return a?a.textContent:'';})()`);
  /* 动作流水是**整页累积**的，而面板上的「动了 N 下」只属于**最后那一轮**。
     不记水位就会拿"两轮之和"去比"最后一轮的数字" —— 只要前面那轮也真动过手，必然对不上。
     （这条以前没红，是因为前面那轮恰好一次都没动手；模型行为一变它就红，属于偶发假红。） */
  okBefore = await ev(`(function(){return ((window.__xzLog||[]).filter(function(x){
    return x && x.p && x.p !== 'observe' && x.ok === true;})).length;})()`);
  /* 本轮"结束"的唯一机器信号：__xzLog 里多出一条 ev=finish（xzLogPush 在 finish() 里落）。
     原来等的是散文 /动了 N 下|没有动页面/，giveup 那一轮写的是「点了 N 下，但结果没变」——
     等满 12 秒也等不到，红在判据。 */
  const finBefore = await ev(`(function(){return ((window.__xzLog||[]).filter(function(x){return x && x.ev==='finish';})).length;})()`);
  /* ★2026-10-29 修（假绿的前置）：判"这一下点开了"之前，抽屉必须是**关着**的。
     实测：装配抽屉在落地时就开着（`?panel=installed`），也可能被上一问的推荐问题点开 ——
     那样"开着"归因不到这一下。先按用户做法收掉，再把"收干净了"当成量具的零点读出来。 */
  const opPre = JSON.parse(await ev(`JSON.stringify((function(){
    var m=document.querySelector('#mask');
    return { open: !!m && m.getAttribute('data-open') === 'true' };
  })())`));
  if (opPre.open) {
    await ev(`(function(){var b=document.querySelector('#dlg-close');if(b)b.click();return 1;})()`);
    await SLEEP(350);
  }
  const opBefore = (await ev(`(function(){var m=document.querySelector('#mask');return !!m && m.getAttribute('data-open')==='true';})()`)) === true;
  const typed2 = await ev(`(function(){var t=document.querySelector('input[data-act="xzInput"]');
    if(!t) return 'NO_INPUT'; t.value='点一下装配组件'; t.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
  chk('A', '面板能接着听第二句', typed2 === 'ok', String(typed2));
  if (typed2 === 'ok') {
    await ev(`(function(){var b=document.querySelector('.xz-send');if(b)b.click();return 1;})()`);
    const seen = { on:false, wait:false, vig:false, foot:false, label:'' };
    for (let i = 0; i < 48; i++) {
      await SLEEP(250);
      const st = JSON.parse(await ev(`JSON.stringify({
        on: (function(){var s=document.getElementById('xzSpot');return !!s && s.classList.contains('is-on');})(),
        wt: (function(){var s=document.getElementById('xzSpot');return !!s && s.classList.contains('is-wait');})(),
        lbl: (function(){var s=document.getElementById('xzSpot');
          var b = s ? s.querySelector('.xz-spot-lb') : null; return b ? b.textContent : '';})(),
        vig: !!document.getElementById('xzVig'),
        foot: !!document.getElementById('xzOpFoot'),
        finN: (function(){return ((window.__xzLog||[]).filter(function(x){return x && x.ev==='finish';})).length;})()
      })`));
      if (st.on) seen.on = true;
      if (st.wt) seen.wait = true;
      if (st.vig) seen.vig = true;
      if (st.foot) seen.foot = true;
      /* "在想下一步…" 是等待态，不是"点在哪儿" —— 只认真正标出目标的那句 */
      if (st.lbl && st.lbl !== '在想下一步…') seen.label = String(st.lbl);
      if (st.finN > finBefore) break;
    }
    chk('A', '操作时有"选中状态"（高亮框框住目标 + 写明点的是谁）', seen.on && !!seen.label,
      `is-on=${seen.on}${seen.label ? ' label=' + seen.label.slice(0, 20) : ''}`);
    chk('A', '思考期间高亮框不消失（切成虚线"在想下一步…"）', seen.wait === true, String(seen.wait));
    chk('A', '操作指示层齐备（顶部流动线 / 底部接管条）', seen.vig && seen.foot,
      `vig=${seen.vig} foot=${seen.foot}`);
    /* 点没点着，看结果：装配面板真被点开才算数。只看"发了 click 事件"是自欺。
       ★2026-10-26 修（判据读错对象，实测 5 次里 2 次假红）：
       原来读 `#dlg-list .row` 的数量 —— 那是**当前过滤后的行数**，不是"面板开没开"。
       实测：抽屉开着但搜索框残留「复核」且唯一匹配项被装掉 ⇒ rows=0、空态「没有匹配的组件」，
       而 `mask[data-open]` 仍是 true。于是无论模型点错目标还是顺手装掉过滤项，这条都必然红。
       现在读 mask 的开合状态（那才是它声称要量的东西）。
       ★2026-10-29 修（假绿）：只读 mask 的开合判的是**存在**，不是**因果** ——
       抽屉在落地时就开着，`actsTotal=0`（一个动作没做）也照样绿。现在三件事同时成立才绿：
       本轮开始前关着（上面已把零点收干净并由 opBefore 读出）／本轮结束后开着／
       本轮 finish 记录存在且 actsTotal ≥ 1。判逻辑抽成 judgeOpened，正控与三条负控见 --negctl。 */
    const roundFin = JSON.parse(await ev(`JSON.stringify((function(){
      var fs=(window.__xzLog||[]).filter(function(x){return x && x.ev==='finish';});
      return { n: fs.length, last: fs.length ? fs[fs.length-1] : null };
    })())`));
    const thisActs = roundFin.n > Number(finBefore || 0) ? (roundFin.last ? roundFin.last.actsTotal : null) : null;
    const openState = await ev(`(function(){
      var m=document.querySelector('#mask');
      var rows=document.querySelectorAll('#dlg-list .row').length;
      return JSON.stringify({open: (m && m.getAttribute('data-open') === 'true') === true, raw: m ? m.getAttribute('data-open') : null, rows: rows});
    })()`);
    let op = {}; try { op = JSON.parse(openState); } catch (e) {}
    const jop = judgeOpened(opBefore, op.open === true, thisActs);
    chk('A', '那一下真点开了装配面板（不是空点）', jop.ok,
      `${jop.detail} · data-open=${op.raw} · 列表 ${op.rows} 行（行数会被搜索过滤，不能用它判开关）`);
  }
  }
  /* ★2026-10-22 加：不信助手自述，用**它自己的动作流水**对账。
     面板上的"动了 N 下"是助手打印的中文，可以被写成任意数字；
     __xzLog 是每个动作执行时落的一条记录（p/ok/name），两边必须自洽。
     这是 agent-truth 的最小可用版：不能证明"动作选得对"，但能证明"它说动过，就真发过动作"。 */
  const logRaw = await ev(`JSON.stringify((window.__xzLog || []).filter(function(x){ return x && x.p && x.p !== 'observe'; }))`);
  let actsLog = null;
  try { actsLog = JSON.parse(logRaw); } catch (e) { actsLog = null; }
  chk('A', '动作流水可读（?debug=1 生效）', Array.isArray(actsLog), Array.isArray(actsLog) ? actsLog.length + ' 条' : String(logRaw).slice(0, 60));
  /* ── 本轮的结构化读数：finish 记录 + 本轮专属脚注（见 judgeRound 注释）──
     `#xzBody .xz-done-s` 是**本轮**的脚注（上一轮的块在同一次重绘里被替换，不会累积），
     所以"取末个匹配"这个问题从源头上没有了。 */
  const finRaw = await ev(`JSON.stringify((window.__xzLog||[]).filter(function(x){return x && x.ev==='finish';}).slice(-1)[0]||null)`);
  let fin = null; try { fin = JSON.parse(finRaw); } catch (e) { fin = null; }
  const footText = String(await ev(`(function(){var ns=document.querySelectorAll('#xzBody .xz-done-s');return ns.length?ns[ns.length-1].textContent:'';})()`) || '');
  if (Array.isArray(actsLog)) {
    const okN = actsLog.filter((x) => x.ok === true).length;
    const thisRound = okN - Number(okBefore || 0);
    chk('A', '本轮流水里成功动作数 >= 1（真执行过，不只是回话）', thisRound >= 1, '本轮 ok=' + thisRound + ' / 累计 ' + okN);
    const j = judgeRound(fin, footText, /*live 由后面那段读，这里先用本轮播报前的空串占位 */ '');
    chk('A', '小智真的操作了页面（动了手，不是只回话）', j.acted.ok, j.acted.detail);
    chk('A', '面板自称「动了 N 下」与本轮流水对得上', j.claim.ok, j.claim.detail);
  }
  /* ★2026-10-22 加：上面那两条只证明"它真发了动作 + 自己数得清"，而这两个数字出自**同一份自述** ——
     一起撒谎时对不出账。踩过的坑：把执行层桩成 `return {ok:true}`（根本不点），流水照旧落 ok=true、
     面板照旧报"动了 N 下"，两边完美自洽，判据全绿，用户眼前却一寸没动。
     第 3 代给每条流水挂了 changed：动作窗口内真的数了一遍页面 DOM（新增/移除几个节点、改了几个属性），
     所以这里只认 nodes+attrs 真 > 0 的那几条 —— 桩出来的 ok 永远凑不出这个数。
     （text 那一项废弃不用：重绘型页面里 characterData 基本不触发，恒为 0，拿它判等于没判。） */
  const acts = Array.isArray(actsLog) ? actsLog : [];   /* actsLog 已滤掉 observe，见上；缺字段也不许抛，下面全走可选链/判空 */
  const withChanged = acts.filter((x) => x && x.changed && typeof x.changed === 'object');
  const realN = withChanged.filter((x) => x.ok === true && x.verdict == null
    && ((x.changed.nodes || 0) + (x.changed.attrs || 0)) > 0).length;
  chk('A', '成功动作里至少有一条页面真的变了（不是桩出来的 ok）', realN >= 1,
    withChanged.length === 0
      ? '没有带 changed 的流水（__xzLog 没挂，或这一版还没埋点）'
      : `真变 ${realN} 条 / 共 ${acts.length} 条动作`);

  /* ★2026-10-22 加：反方向也得锁死。changed 只说明"页面变了"，不说明"变的正是它说要做的那件事"；
     产品收尾时会把"报 ok 但页面一动不动"判成 fake-success 并记在流水上（verdict 字段）——
     那是它能给出的最诚实的信号，门禁不读，它就白记了。
     口径：读不到也按 0 条算（没有 fake-success 的流水 == 0 条），所以只判 === 0，不做"字段缺失就跳过"。 */
  const fake = acts.filter((x) => x && x.verdict === 'fake-success');
  chk('A', '没有被判为假成功的动作（它说成功、页面没变）', fake.length === 0,
    fake.length === 0 ? '0 条'
      : `${fake.length} 条：` + fake.slice(0, 3).map((x) => String(x.name || '(无名)')).join(' / '));
  /* ★2026-10-22 加：浮层出口的三条剩余覆盖（关闭钮 / aria-expanded 同步 / Esc 分层）。
     都已在代码里实现过、只是没人锁着 —— 这种"行为对了但没有判据护着"的地方，下一次改动就会被悄悄破坏。 */
  const st = async () => JSON.parse(await ev(`JSON.stringify({
    xz: !!document.querySelector('.xz-panel'),
    fabExpanded: (function(){var f=document.querySelector('.xz-fab');
      return f ? f.getAttribute('aria-expanded') : null;})(),
    mask: !!document.querySelector('.mask[data-open="true"]')
  })`));
  /* 先收干净，再开一层 */
  for (let i = 0; i < 3; i++) {
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await SLEEP(200);
  }
  let s0 = await st();
  if (!s0.xz) { await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`); await SLEEP(500); }
  const s1 = await st();
  chk('A', '打开面板后浮球 aria-expanded 同步为 true', s1.fabExpanded === 'true', `aria-expanded=${s1.fabExpanded}`);
  /* 关闭钮（不是 Esc）也要能关，且 aria-expanded 回到 false */
  const closed = await ev(`(function(){var b=document.querySelector('.xz-x');if(!b)return 'NO_BTN';b.click();return 'ok';})()`);
  chk('A', '面板有关闭钮', closed === 'ok', String(closed));
  await SLEEP(400);
  const s2 = await st();
  chk('A', '点关闭钮能关掉面板', s2.xz === false, `open=${s2.xz}`);
  chk('A', '关闭后 aria-expanded 回到 false', s2.fabExpanded === 'false', `aria-expanded=${s2.fabExpanded}`);

  /* Esc 分层：两层都开时，一次 Esc 只许关最上面那层（装配面板），小智不许被带走 */
  await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`);
  await SLEEP(400);
  /* 2026-10-26：#fk-chip 已在改版中并入顶栏，改为 #act-assemble（app.html:294，绑定 app.js:572）。
     原选择器取不到元素，`if(b)` 静默跳过 ⇒ mask 永远 false，连带下面三条 Esc 判据整块被 if 跳过。 */
  await ev(`(function(){var b=document.querySelector('#act-assemble');if(b)b.click();return 1;})()`);
  await SLEEP(600);
  const s3 = await st();
  chk('A', '两层都能打开（小智 + 装配面板）', s3.xz === true && s3.mask === true, `xz=${s3.xz} mask=${s3.mask}`);
  if (s3.xz && s3.mask) {
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await SLEEP(400);
    const s4 = await st();
    chk('A', '一次 Esc 只关最上面那层（弹窗关了、小智还在）', s4.mask === false && s4.xz === true,
      `mask=${s4.mask} xz=${s4.xz}`);
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await SLEEP(400);
    const s5 = await st();
    chk('A', '再按一次才轮到底下那层（小智关掉）', s5.xz === false, `xz=${s5.xz}`);
  }

  /* ★2026-10-22 加：播报的**内容**判据。
     只看"档位属性写对没有"会绿着骗人 —— 坑在于 #xzAlert 里可能还是上一轮的残留。
     所以要比对：本轮结论进了哪个节点、另一个节点有没有被动过、节点引用有没有换。
     （诺亚第一版就是因为只判属性，在"fail 写成 polite"时照样绿。） */
  const liveNow = JSON.parse(await ev(`(function(){
    var l = document.getElementById('xzLive'), a = document.getElementById('xzAlert');
    return JSON.stringify({
      liveText: l ? l.textContent : '', alertText: a ? a.textContent : '',
      sameLive: l === window.__liveRef, sameAlert: a === window.__alertRef
    });
  })()`));
  chk('A', '播报节点没被重新创建（还是页面加载时那两个）', liveNow.sameLive && liveNow.sameAlert,
    `live=${liveNow.sameLive} alert=${liveNow.sameAlert}`);
  chk('A', '这一轮的结论真的写进了播报节点（不是空转）',
    !!(liveNow.liveText || liveNow.alertText),
    `live=${JSON.stringify(String(liveNow.liveText).slice(0, 30))} alert=${JSON.stringify(String(liveNow.alertText).slice(0, 30))}`);
  /* 本轮结论必须进 polite 那个节点，且**档位词与执行结果一致**。
     ★2026-10-28：原来写死成 /做完了/ —— 一轮正当以 giveup 收尾（产品口径：
     点了 N 下但结果没变）时必红。产品口径是 fail 也走 polite、assertive 只服务事故
     （assets/xiaozhi.js:1284-1289），所以判"档位对不对"而不是判"是不是成功"。 */
  const jp = judgeRound(fin, footText, liveNow.liveText);
  chk('A', '本轮结论的一句话进了 polite 节点，且档位与执行结果一致',
    jp.polite.ok, jp.polite.detail);
  /* 判"成功文案有没有漏进 assertive"就够了 —— 不要判"alert 有没有被清空"。
     实测两次运行结果不一致（单跑时残留着上一轮的失败文案，全量跑时被清空了），
     说明"清空时机"本身不是稳定契约；拿它当判据会偶发假红，而偶发假红的判据最后会被人关掉。 */
  chk('A', '成功文案没有漏进 assertive 节点（它只承载失败/事故）',
    !String(liveNow.alertText).includes('做完了'),
    `alert=${JSON.stringify(String(liveNow.alertText).slice(0, 24))}`);

  /* ★2026-10-22 加：**结论块必须落在面板可视区内**。
     背景：口径「打开面板即已读」的地基是 `xzPaint()` 里那句 `box.scrollTop = box.scrollHeight`，
     而那句今天没有任何判据护着。聊天面板几乎都会加"用户上翻时别强制滚底"，
     一旦加上，面板可能停在半空 —— 用户没看见结论，而 unread 已经被清，徽标不出现，且没有任何东西会红。
     判"结论块在可视区内"，不判"滚到底"：滚底是手段，"人看见了"才是目的。
     判滚底的话，那个正确的改进会被判红。
     现场证据（优希-2 在 27a0d0b8 上四次分时采样，2/4/6/8 秒四帧完全相同）：
       同一条事故消息，首次落点 scrollTop=279、关掉再重开落点 scrollTop=175 ——
       而块区间 incident[361,458] + done[488,576] 在两种落点下都完整可见，落点本身却是变的。
       ⇒ 能锁的只有"区间完整可见"，锁 scrollTop 一定锁不住（落点差异是产品有意的最小位移，不是缺陷）。 */
  /* 上面那组 Esc 断言最后把面板关掉了 —— 这里要判"结论块在不在可视区"，得先把面板打开。
     （第一版忘了这步，判据自己报"没有 #xzBody"，红在判据自己的时序上，不是产品问题。） */
  const needOpen = await ev(`!document.getElementById('xzBody')`);
  if (needOpen === true) {
    await ev(`(function(){var f=document.querySelector('.xz-fab');if(f)f.click();return 1;})()`);
    await SLEEP(500);
  }
  const inView = JSON.parse(await ev(`(function(){
    var body = document.getElementById('xzBody');
    if (!body) return JSON.stringify({ ok:false, why:'没有 #xzBody' });
    /* ⚠ 取**末个**结论块，不是第一个。踩过的坑：flow A 跑两轮，#xzBody 里就有两个 .xz-done，
       querySelector 拿到的是**上一轮**那块 —— 它永远停在滚动区上方，于是判据红在一个
       用户根本看不见的旧块上，和"这一轮人有没有读到"毫不相干（实测 块[133,179] / 视区[293,604]）。
       产品侧滚的是**区间**，不是某个节点（xzScrollSpan：末条 .xz-incident ∪ 末条 .xz-done，
       两者都没有时才用 .xz-err 兜底，取并集的上下界）—— 判据必须量同一个区间。
       ★2026-10-22 修：第一版这里量的是"最后一个块"，诺亚指出事故场景下最后那个块是页脚（done），
       它本来就看得见，于是 incident 被裁到视区外也照样绿 —— 一条只量页脚的判据，等于没验事故结论。
       现在按产品的口径取区间上下界。本流程**末尾会用确定性桩造一条真实事故**（见下面的事故段），
       所以 incident 那一半也被常规门禁覆盖了，不再只靠离线算术。
       已知残留弱点（接受）：本轮若压根没渲染出结论块，末个仍是上一轮的，这条会假绿 ——
       所以它得和上面「给出了结果块」「本轮结论写进了播报节点」一起看，单看它不算数。
       前提 X：DOM 文档顺序 == 消息时间顺序。"取末个"只是"取最新"在当前渲染顺序下的等价写法，
       而这条前提今天成立、却**没有任何判据在看它**。哪天消息流改成倒序渲染 / 上翻加载 / 虚拟列表，
       这行会静默变错：它照样返回一条结论块，只是不是最新的，看起来完全正常。
       届时的正解是给块挂可机读轮次、取轮次最大 —— 但注意：结论块现在**没有** data-round，
       只有播报节点 #xzLive / #xzAlert 有（见 xiaozhi.js 的 xzAnnounce）。所以今天别改成
       reduce 取 dataset.round：全都 undefined 会退化成跟这一行完全一样的行为，只是把前提藏得更深、
       看着像已经解决了 —— 那比现在明写着前提更糟。要改就两步走：产品先给块加 data-round，
       判据再改，同时补一条"所有结论块都带 data-round"的断言，否则那个分支永远不执行、等于没写。 */
    var incs = body.querySelectorAll('.xz-incident');
    var dones = body.querySelectorAll('.xz-done');
    var errs = body.querySelectorAll('.xz-err');
    var pick = [];
    if (incs.length) pick.push(incs[incs.length - 1]);
    if (dones.length) pick.push(dones[dones.length - 1]);
    if (!pick.length && errs.length) pick.push(errs[errs.length - 1]);
    if (!pick.length) return JSON.stringify({ ok:false, why:'没有结论块' });
    var top = Infinity, bottom = -Infinity;
    for (var i = 0; i < pick.length; i++) {
      var rr = pick[i].getBoundingClientRect();
      if (rr.top < top) top = rr.top;
      if (rr.bottom > bottom) bottom = rr.bottom;
    }
    var b = body.getBoundingClientRect();
    return JSON.stringify({ ok: top >= b.top - 1 && bottom <= b.bottom + 1, why:'', n: pick.length,
      block:[Math.round(top),Math.round(bottom)], box:[Math.round(b.top),Math.round(b.bottom)] });
  })()`));
  chk('A', '结论块落在面板可视区内（"打开即已读"的地基）', inView.ok === true,
    inView.ok ? '' : `${inView.why} 区间=${JSON.stringify(inView.block)} 视区=${JSON.stringify(inView.box)}`);

  /* ★2026-10-22 加：**确定性事故段** —— 把"它说没做成、但页面真的变了"这条路径纳入常规门禁。
     为什么非得造：本流程前面全是成功路径，区间口径里 incident 那一半在门禁里从不执行，
     于是"事故态是否可见"这个最贵的部分，只剩一次性人工采样。造法只用产品自己的钩子，不依赖模型随机性。
     三个坑，都踩过：
       ① 不能拿"新注入的节点"当靶子：页面重绘会把它冲掉，名字对不上，桩点在空元素上，changed 全是 0，
          看起来像"产品没动"。只能给**已有**元素打标记再改名（data-xz-test + 覆盖 xzName）。
       ② 计划里 i:0 之所以稳定指向关闭钮，是因为**先打开了装配面板** —— 观测根切到 mask 后，
          第一个可点元素才是它。漏掉 chip.click() 那步就退化成 mismatch、造不出事故（实测 inc=0）。
       ③ 桩点的元素和被改名的元素**不能是同一个**：桩点关闭钮会把它关掉，出口就"定位不到"，
          几何断言会红在一个与产品无关的地方。所以桩点的是面板里的一行。
     桩必须留下原函数（__stubAct）：哪天 xzAct 被改名或挪进闭包，桩会静默失效，
     而失效后区间断言量到的是本来就可见的 done ⇒ 又变假绿。下面第一条断言专门盯这个。
     还原要带守卫：原函数本来就不存在时无条件还原，会把 xzAct 设成 undefined —— 那是用"还原"造一个新故障。 */
  const accSetup = await ev(`(function(){
    var out = [];
    try {
      /* 2026-10-26：#fk-chip 并入顶栏后改名为 #act-assemble（app.html:294）。
         取不到元素时这里会提前 return NO_CHIP，桩一个字都不装 ⇒ 整段事故链 8 条判据空跑变红。
         实测换成 #act-assemble 后 stub=true / inc=1 / incRole=group / locate 三态 ok·missing·ambiguous 全对。 */
      var chip = document.querySelector('#act-assemble');
      if (!chip) return JSON.stringify({ err:'NO_CHIP', out: out });
      /* ★2026-10-29 修（前置状态）：#act-assemble 是**开关**。这一段原来无条件点它 ——
         而前一段刚让抽屉开着（判"那一下点开了"之后它一直开着），这里再点就是把它**关掉**：
         随后 #dlg-close 虽在 DOM 里却不可见，观测根回到底页，改名与桩都不在观测面里
         ⇒ 事故块永远 0 个。而且 NO_CLOSE 只进 accSetup 的返回值、不进读数，改前那一跑看不出断在这里。
         现在先按用户做法收干净，再点开，并**读回开合**确认 —— 造事故的前提状态由判据自己负责。 */
      var mk = document.querySelector('#mask');
      if (mk && mk.getAttribute('data-open') === 'true') {
        var c0 = document.querySelector('#dlg-close'); if (c0) c0.click();
      }
      chip.click();                                  /* ② 观测根切到 mask，i:0 才稳定是关闭钮 */
      var mk1 = document.querySelector('#mask');
      if (!mk1 || mk1.getAttribute('data-open') !== 'true') return JSON.stringify({ err:'DRAWER_NOT_OPEN', out: out });
      if (!window.__stubAct) {
        window.__stubName = window.xzName;
        window.__stubPlan = window.xzPlanModel;
        window.__stubAct = window.xzAct;
      }
      var close = document.querySelector('#dlg-close');
      if (!close) return JSON.stringify({ err:'NO_CLOSE', out: out });
      close.setAttribute('data-xz-test', 'irr');
      /* 只改 xzName 是不够的：那只是产品内部的称呼，DOM 的可访问名还是"关闭"，
         于是"框住的元素可访问名 === 文案点名的目标"这条会因**构造造假**而红，不是产品错。
         所以把真实可访问名一起改 —— 让三个地方（xzName / aria-label / 事故文案）指向同一个名字。 */
      /* 名字要用**页面上唯一**的不可逆词。原来用「发布新版本」，而页头那个发布按钮也叫这个，
         于是定位永远同名两处、判据把"重名要显式失败"和"高亮框要对准"两条互相打死。
         「确认删除」在 XZ_IRREVERSIBLE 词表里，且页面上没有第二个 —— 定位能唯一命中。 */
      close.setAttribute('aria-label', '确认删除');
      var onName = window.__stubName;
      /* 只给这一个元素改名：定位是按名字比的，全量同名必然 ambiguous，
         "高亮框要对准"与"重名要显式失败"两条会互相打死。 */
      window.xzName = function(e){
        return (e && e.getAttribute && e.getAttribute('data-xz-test') === 'irr') ? '确认删除' : onName(e);
      };
      window.xzAct = function(){
        var row = document.querySelector('#dlg-list .row');
        if (row) { try { row.click(); } catch (e) {} }                                  /* 真点一下：产生 mutation */
        try { window.DB.APPS[0].updated = '2099-01-01 00:00'; } catch (e) {}             /* 改一个必然不同的值，才造得出 storeDiff */
        return { ok: false, why: '桩：做了但报失败' };
      };
      /* ⚠2026-10-29 复核：这个桩**没有接线** —— 产品只在 :1461 直接调词法绑定 xzPlanModel，
         全文没有 window.xzPlanModel 的回读（grep 只剩定义与调用两处）。所以"计划"这一层由真模型给，
         让它稳定指向改名元素的**不是**这里。真正让后面可复现的是产品自己的另一条路：
         授权卡点下去后 :1541-1551 按 G.xzPendingName **重新定位**，不用模型给的索引。
         保留原桩只为不动 2026-10-26 的构造；读数上不许把它当"计划已受控"。 */
      window.xzPlanModel = function(){
        /* 让这一轮真的点那个被改名的元素：先让产品自己 observe 一次拿快照，
           再在 XZ_REF 里按 data-xz-test=irr 找索引。原来写死 i:0，
           快照第一个是别的按钮 ⇒ entry.name 不是「确认删除」⇒ verdict=mismatch ⇒ 事故块永不出现。 */
        var idx = 0;
        try {
          if (window.xzObserve) window.xzObserve();
          var ref = window.XZ_REF || [];
          for (var k = 0; k < ref.length; k++) {
            if (ref[k] && ref[k].getAttribute && ref[k].getAttribute('data-xz-test') === 'irr') { idx = k; break; }
          }
        } catch (e) {}
        return Promise.resolve({ say: '点删除', stages: [{ t: '删除', steps: ['点「确认删除」'] }],
          acts: [{ p: 'click', i: idx }] });
      };
      xzAsk('把这个删掉');
      out.push('asked');
    } catch (e) { out.push('err=' + e); }
    return JSON.stringify(out);
  })()`);
  /* ★2026-10-29 修（8 条事故判据被产品**合法**停顿互相打死）：
     靶子「确认删除」在 XZ_IRREVERSIBLE 词表里（assets/xiaozhi.js:420）。产品有两条合法停顿：
     执行前预扫（:1561-1573：本轮计划里打算点不可逆按钮 ⇒ 一个动作都不做，出授权卡）
     与执行时硬闸（:710）。桩装在 xzAct 上，只有"产品决定执行"之后才轮得到它 ——
     任何一条闸先停，桩就一个字没跑：kind=wait、actsTotal=0、事故块永不出现；
     而 :1954 判 incident 又要求 entry.name 命中同一张词表。两条规则互相打死，红在判据。
     换靶子不行（换了 :1954 那条口径就测不到），正解是**把不可逆动作的确认走完再制造事故**：
     产品为此留的口子就是授权卡「确认执行」（xzGrant ⇒ G.xzGrant/G.xzOnce，:2993-3010）。
     下面第一轮：出授权卡就点它（用户路径），出了事故块说明本轮已授权；两样都没有 ⇒ 读数里明说构造断在哪。
     兜底只在"7 秒过去、产品已空闲、既没授权卡也没事故块"时触发：置 G.xzGrant=1（产品自己的授权位，
     等同点过卡）再问一次 —— 它替代不了上面那条真路径，读数里分得清哪条走通。 */
  let accView = { inc:0, done:0, span:null, box:null, inside:null, incRole:null, alerts:0, stub:false, grant:false, busy:false, goArg:null };
  let accGrant = '未出现', accAsk = 1;
  for (let i = 0; i < 40; i++) {          /* 最多 20 秒：含"授权卡 → 再执行一轮"；出事故块立刻停 */
    await SLEEP(500);
    accView = JSON.parse(await ev(`JSON.stringify((function(){
      var body = document.getElementById('xzBody');
      if (!body) return { err:'NO_BODY' };
      var incs = body.querySelectorAll('.xz-incident'), dones = body.querySelectorAll('.xz-done');
      var pick = [];
      if (incs.length) pick.push(incs[incs.length - 1]);
      if (dones.length) pick.push(dones[dones.length - 1]);
      var top = Infinity, bottom = -Infinity;
      pick.forEach(function(e){ var r = e.getBoundingClientRect();
        if (r.top < top) top = r.top; if (r.bottom > bottom) bottom = r.bottom; });
      var b = body.getBoundingClientRect();
      var li = incs.length ? incs[incs.length - 1] : null;
      var go = document.querySelector('.xz-incident-go');
      return { inc: incs.length, done: dones.length,
        span: pick.length ? [Math.round(top), Math.round(bottom)] : null,
        box: [Math.round(b.top), Math.round(b.bottom)],
        inside: pick.length ? (top >= b.top - 1 && bottom <= b.bottom + 1) : null,
        incRole: li ? li.getAttribute('role') : null,
        incRect: li ? (function(){ var r = li.getBoundingClientRect();
          return [Math.round(r.top), Math.round(r.bottom)]; })() : null,
        alerts: document.querySelectorAll('[role="alert"]').length,
        stub: (typeof window.__stubAct === 'function') && window.xzAct !== window.__stubAct,
        grant: !!document.querySelector('.xz-grant-ok'),
        busy: document.body.classList.contains('xz-acting'),
        goArg: go ? go.getAttribute('data-arg') : null };
    })())`));
    if (accView && accView.inc >= 1) break;
    if (accView.grant && accGrant === '未出现') {
      const hit = await ev(`(function(){var b=document.querySelector('.xz-grant-ok');if(!b)return 0;b.click();return 1;})()`);
      accGrant = hit === 1 ? '已点确认执行' : '卡在但点不到';
      await SLEEP(300);
      continue;
    }
    if (accGrant === '未出现' && i >= 12 && !accView.busy) {
      const re = await ev(`(function(){try{window.G.xzGrant=1;}catch(e){} xzAsk('把这个删掉');return 1;})()`);
      accGrant = re === 1 ? '授权位兜底' : '兜底失败';
      accAsk = 2;
    }
  }
  /* ★2026-10-29 修（盲审 A1）：通过判据必须认「不可逆确认」怎么走完的。
     旧版通过只认 `stub && inc>=1`，于是 `G.xzGrant=1` 兜底（产品授权卡没点）也绿 ——
     白名单把"先走完产品自己的不可逆确认"绕过去了。现在判逻辑抽成 judgeIncident：
     桩装上 + 真出事故块 + accGrant==='已点确认执行' 三条同时成立才通过。
     兜底仍保留（让下游 7 条事故判据有块可量），但走兜底这一轮**单列红**，读数里写明是哪条路。 */
  const incJudge = judgeIncident({ stub: accView.stub, inc: accView.inc, grant: accGrant });
  chk('A', '事故场景构造生效（桩装上 + 真出了事故块 + 走的是产品授权卡「确认执行」）', incJudge.ok,
    `${incJudge.detail} 结论块=${accView.done} 问=${accAsk} 次` +
    (accGrant === '授权位兜底' ? ' —— 走的是 G.xzGrant 兜底，产品卡未被点，不算通过' : '') +
    (accSetup && accSetup.indexOf('err=') >= 0 ? ` · 桩装置=${accSetup}` : '') + (accView.err ? ' ' + accView.err : ''));
  chk('A', '事故块是 group 而不是 alert（播报单源在 #xzAlert，可见块不许再念一遍）',
    accView.incRole === 'group' && accView.alerts === 1,
    `role=${accView.incRole} · [role=alert]总数=${accView.alerts}`);
  /* 2026-10-26 假绿：这条在 inc=0 时是绿的 —— 它取 .xz-incident ∪ .xz-done 的并集，没有 incident
     就只剩页脚 done，而页脚本来就看得见。事故块一个没出却判"区间落在视区内"，
     等于用"页脚可见"冒充"事故块可见"。所以先要求 incident 真的存在。 */
  chk('A', '事故区间完整落在视区内（incident 那一半这才真被量到）',
    accView.inside === true && (accView.inc || 0) >= 1,
    `事故块 ${accView.inc || 0} 个 · 区间=${JSON.stringify(accView.span)} 视区=${JSON.stringify(accView.box)}`);
  /* 区间通过不代表事故块自己通过（页脚 done 在里面、incident 被裁掉一半时，区间会红而这条也会红，
     但反过来 incident 单独可见时区间可能因页脚超出而红）—— 两条量的是不同的失败，所以分开判。 */
  chk('A', '事故块本身（最后一条 .xz-incident）落在视区内',
    !!accView.incRect && accView.incRect[0] >= accView.box[0] - 1 && accView.incRect[1] <= accView.box[1] + 1,
    `事故块=${JSON.stringify(accView.incRect)} 视区=${JSON.stringify(accView.box)}`);
  /* ★2026-10-22 加：事故块的**出口** —— 高亮 / 焦点 / 文案三处必须指向同一个东西。
     为什么不按名字判：这条事故是用 xzName 改名合成出来的，按名字找必然自证（名字是我给的）。
     几何与可访问名不吃这一套：一个问"框在哪儿、焦点在哪儿"，一个问"框住的那个东西对外叫什么"。
     ⚠ 先判 is-on 再比几何：xzSpot(0) 只摘 is-on，**left/top/width/height 会留在原地**，
     不先判就会把失败态用残留几何读成"重合"（lead 点过这个坑）。
     产品侧 xzLocate 是三态：ok 才 scrollIntoView + 高亮 + focus；missing / ambiguous 一律不高亮不聚焦。
     所以下面正向、反向三支都要判 —— 只测 ok 分支的话，"找不到也敢乱指"这件事永远测不出来。 */
  const accProbe = `JSON.stringify((function(){
    var sp = document.getElementById('xzSpot'), ae = document.activeElement;
    var li = (function(){ var b = document.getElementById('xzBody');
      var xs = b ? b.querySelectorAll('.xz-incident') : []; return xs.length ? xs[xs.length - 1] : null; })();
    function R(e){ if (!e) return null; var r = e.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }
    function OV(a, b){ if (!a || !b) return false;
      return !(a[2] < b[0] - 2 || b[2] < a[0] - 2 || a[3] < b[1] - 2 || b[3] < a[1] - 2); }
    var on = !!sp && sp.classList.contains('is-on');
    var sr = on ? R(sp) : null;                       /* 只有 is-on 才认这套几何 */
    var ar = (ae && ae !== document.body) ? R(ae) : null;
    /* "框住的是谁"用几何找：取框中心命中的元素（xzSpot 不吃指针事件，命中的是下面的真实元素） */
    var accName = '';
    if (sr) {
      var hit = document.elementFromPoint((sr[0] + sr[2]) / 2, (sr[1] + sr[3]) / 2);
      var host = hit && hit.closest
        ? (hit.closest('[aria-label]') || hit.closest('button, a, [role="button"]') || hit) : hit;
      if (host) accName = (host.getAttribute('aria-label') || String(host.textContent || '').trim()
        || host.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
    }
    var claimed = '';
    if (li) claimed = (((li.innerText || '').match(/我试的是：([^\\n]+)/) || [])[1] || '').trim();
    return { on: on, spot: sr, active: ar, ov: on && OV(sr, ar),
      tag: ae ? ae.tagName : '', accName: accName, claimed: claimed,
      locate: (window.__xzLocateLast && window.__xzLocateLast.state) || '' };
  })())`;

  const accClick = await ev(`(function(){var g = document.querySelector('.xz-incident-go');
    if (!g) return 'NO_GO'; g.click(); return 'ok';})()`);
  await SLEEP(400);
  const accGeo = JSON.parse(await ev(accProbe));
  chk('A', '事故出口点下去后，高亮框与焦点是同一个东西（几何判，不按名字）',
    accGeo.on === true && accGeo.ov === true,
    `is-on=${accGeo.on} spot=${JSON.stringify(accGeo.spot)} active=${JSON.stringify(accGeo.active)}(${accGeo.tag}) locate=${accGeo.locate}`);
  chk('A', '高亮框框住的那个元素，可访问名 === 事故文案里点名的目标',
    !!accGeo.accName && accGeo.accName === accGeo.claimed,
    `框住="${accGeo.accName}" 文案说="${accGeo.claimed}" 点击=${accClick}`);

  /* 反向之一：目标没了 —— 摘掉标记让 xzLocate 只能落到 missing，此时**不许有任何高亮**。
     注意要连 aria-label 一起还原：xzName 取名字时会回落到 aria-label，
     只摘 data-xz-test 的话名字还活着，locate 照样 ok（第一版就是这么红的，红在构造没造干净）。 */
  await ev(`(function(){var xs = document.querySelectorAll('[data-xz-test]');
    for (var i = 0; i < xs.length; i++) xs[i].removeAttribute('data-xz-test');
    var c = document.querySelector('#dlg-close'); if (c) c.setAttribute('aria-label', '关闭');
    return 1;})()`);
  await SLEEP(150);
  await ev(`(function(){var g = document.querySelector('.xz-incident-go'); if (g) g.click(); return 1;})()`);
  await SLEEP(400);
  const accMiss = JSON.parse(await ev(accProbe));
  chk('A', '目标找不到时不许高亮（残余几何不许被读成重合）',
    accMiss.locate === 'missing' && accMiss.on === false,
    `locate=${accMiss.locate} is-on=${accMiss.on} spot=${JSON.stringify(accMiss.spot)}`);

  /* 反向之二：重名 —— 系统宁可说"我不确定是哪个"，也不许随便挑一个指过去 */
  const dup = await ev(`(function(){
    var refs = window.XZ_REF || [], cand = [];
    for (var i = 0; i < refs.length && cand.length < 2; i++) {
      var e = refs[i];
      if (e && e.isConnected && e.getBoundingClientRect().width > 0) cand.push(e);
    }
    if (cand.length < 2) {
      var bs = document.querySelectorAll('.mask[data-open="true"] button, .panel button');
      for (var j = 0; j < bs.length && cand.length < 2; j++) if (cand.indexOf(bs[j]) < 0) cand.push(bs[j]);
    }
    for (var k = 0; k < cand.length; k++) cand[k].setAttribute('data-xz-test', 'irr');
    return cand.length;})()`);
  await SLEEP(150);
  await ev(`(function(){var g = document.querySelector('.xz-incident-go'); if (g) g.click(); return 1;})()`);
  await SLEEP(400);
  const accAmb = JSON.parse(await ev(accProbe));
  chk('A', '重名时必须显式失败、不许随便指一个（ambiguous 同样不高亮）',
    Number(dup) >= 2 && accAmb.locate === 'ambiguous' && accAmb.on === false,
    `同名元素=${dup} locate=${accAmb.locate} is-on=${accAmb.on}`);

  await ev(`(function(){
    var xs = document.querySelectorAll('[data-xz-test]');
    for (var i = 0; i < xs.length; i++) xs[i].removeAttribute('data-xz-test');
    if (typeof window.__stubAct === 'function') window.xzAct = window.__stubAct;
    if (typeof window.__stubName === 'function') window.xzName = window.__stubName;
    if (typeof window.__stubPlan === 'function') window.xzPlanModel = window.__stubPlan;
    var c = document.querySelector('#dlg-close'); if (c) c.setAttribute('aria-label', '关闭');
    return 1;})()`);
  /* 卸载也要验：守卫能防"还原成 undefined"，但防不了"还原没生效" ——
     万一哪天这些属性变成只读，赋值会静默失败（非严格模式），后面段落继续跑在被桩过的执行器上，而它是绿的。 */
  chk('A', '事故桩已卸载（还原真的生效，不是静默失败）',
    (await ev(`window.xzAct === window.__stubAct && window.xzName === window.__stubName`)) === true,
    'xzAct / xzName 均已还原');

  chk('A', '该页无 JS 异常', c.errs.length === 0, c.errs.slice(0, 2).join(' | '));
}
console.log(`\n三条流程验收 @ ${BASE}\n`);
if (!ONLY || ONLY === 'B') await flowB();
if (!ONLY || ONLY === 'C') await flowC();
if (!ONLY || ONLY === 'A') await flowA();

console.log(rows.join('\n'));
console.log(`\n通过 ${pass} ｜ 断点 ${fail}`);
if (fail) {
  console.log('\n断点就在上面打了 ✗ 的几行 —— 每一行都是一个「用户走不下去」的位置。');
}
ws.close(); chrome.kill('SIGKILL');
process.exit(fail ? 2 : 0);
