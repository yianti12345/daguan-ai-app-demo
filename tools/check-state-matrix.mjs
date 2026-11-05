#!/usr/bin/env node
/* check-state-matrix —— **状态 × 动作矩阵**（2026-11-01 立）
 *
 * 为什么有它：这一轮 60 条问题里最大的一类，不是"某处写错了"，而是
 * **"某个状态下这个动作该不该有、叫什么，从来没被定义过"** ——
 * 于是它靠实现者临时判断，判断错了没有任何东西会红。
 * 实测到的实例（都是点了才知道）：
 *   · 已上架卡 ⋮ 有 7 项、未发布卡只有 6 项（少「下架」）；已下架卡第 6 项换成「上架」
 *   · 未发布卡没有电源按钮，同排 ⋮ 比别的卡靠右 24px
 *   · 组件页未发布卡的开关是假控件（点下去只弹错误）
 *   · 状态词跟线上真机对不上：线上 已上架/内测中/未上架，我方 已上架/未发布/已下架
 *
 * 修法不是"把这三处改对"，是把判断挪进 `tools/state-matrix.json`：
 * 新增状态、改菜单、改按钮文案，都必须先改那张表，改了表判据才跟着走；
 * 反过来，只改代码不改表 ⇒ 这里立刻红。
 *
 * 判什么（每个状态各取一张卡，逐格核）：
 *   S1 这个状态的卡在页面上存在（矩阵声明了的状态没出现 ⇒ 未量，rc=3）
 *   S2 底栏电源按钮：矩阵写 null 就不许有，写文字就必须有且 aria-label 以它开头
 *   S3 ⋮ 菜单项集合 = 矩阵声明的那一组（顺序不计，多一项少一项都红）
 *
 * 用法：node tools/check-state-matrix.mjs [baseUrl]
 * 退出码：0 全过 ｜ 2 有断点 ｜ 3 环境起不来／状态没出现
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const M = JSON.parse(fs.readFileSync(new URL('./state-matrix.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0, skip = 0;
const ok = (t, d) => { pass++; console.log(`  ✓ ${t}${d ? '｜' + d : ''}`); };
const bad = (t, d) => { fail++; console.log(`  ✗ ${t}${d ? '｜' + d : ''}`); };

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/sm-${Date.now()}`, '--remote-allow-origins=*',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 70; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

console.log('状态 × 动作矩阵｜基准 tools/state-matrix.json｜基址 ' + BASE + '\n');

for (const key of ['apps']) {
  const spec = M[key];
  await send('Page.navigate', { url: BASE + '/' + spec.page });
  await SLEEP(1800);
  const cards = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('${spec.card}')).map(function(c,i){
      var tag = c.querySelector('${spec.statusSelector}');
      var p = c.querySelector('.k-pub');
      return { i: i, st: tag ? tag.textContent.trim() : '', hasPower: !!p,
               powerLabel: p ? (p.getAttribute('aria-label') || '') : null,
               powerDisabled: p ? !!p.disabled : null };
    });
  })()`);
  if (!Array.isArray(cards) || !cards.length) { console.log('  ✗ 应用列表量不到卡片'); fail++; continue; }

  for (const [state, rule] of Object.entries(spec.states)) {
    const hit = cards.filter((c) => c.st === state);
    if (!hit.length) {
      console.log(`  · ${state}：页面上没有这种状态的卡 ⇒ 这一格没量（rc=3）`);
      skip++; continue;
    }
    const c0 = hit[0];

    /* S2 底栏电源按钮 */
    if (rule.power === null) {
      ok(`${state} S2 底栏不出现电源按钮`, `该状态 ${hit.length} 张卡都没有 .k-pub`);
      if (hit.some((c) => c.hasPower)) bad(`${state} S2 不应该有电源按钮`, '但页面上有');
    } else if (rule.powerDisabled) {
      /* 未发布：官网用 disabled 电源位占住 24px，而不是隐形 ghost。矩阵显式声明 disabled，
         防止下一个人又把它删成 null（那会让同排 ⋮ 左移 34px）。 */
      const wrong = hit.filter((c) => !c.hasPower || !String(c.powerLabel || '').startsWith(rule.power) || c.powerDisabled !== true);
      ok(`${state} S2 电源按钮 disabled＝「${rule.power}」`, `该状态 ${hit.length} 张卡全部命中`
        + (wrong.length ? '' : `｜首卡 aria-label「${c0.powerLabel}」`));
      if (wrong.length) bad(`${state} S2 电源位对不上`, `矩阵要 disabled「${rule.power}」，实际：`
        + wrong.slice(0, 2).map((c) => `#${c.i}「${c.powerLabel || '无按钮'}」disabled=${c.powerDisabled}`).join('；'));
    } else {
      const wrong = hit.filter((c) => !c.hasPower || !String(c.powerLabel || '').startsWith(rule.power) || c.powerDisabled);
      ok(`${state} S2 电源按钮＝「${rule.power}」`, `该状态 ${hit.length} 张卡全部命中`
        + (wrong.length ? '' : `｜首卡 aria-label「${c0.powerLabel}」`));
      if (wrong.length) bad(`${state} S2 电源按钮文案对不上`, `矩阵要「${rule.power}」，实际：`
        + wrong.slice(0, 2).map((c) => `#${c.i}「${c.powerLabel || '无按钮'}」`).join('；'));
    }

    /* S3 ⋮ 菜单项集合 */
    const menu = await ev(`(function(){
      var cards = [].slice.call(document.querySelectorAll('${spec.card}'));
      var c = null;
      for (var i=0;i<cards.length;i++){ var t=cards[i].querySelector('${spec.statusSelector}'); if(t && t.textContent.trim()===${JSON.stringify(state)}){c=cards[i];break;} }
      if (!c) return null;
      var more = c.querySelector('.k-more'); if (!more) return null;
      more.click();
      var m = c.querySelector('.k-menu:not([hidden])');
      if (!m) return null;
      var items = [].slice.call(m.querySelectorAll('.k-mi')).map(function(b){ return b.textContent.trim(); });
      more.click();
      return items;
    })()`);
    if (!Array.isArray(menu)) { console.log(`  · ${state} S3 ⋮ 菜单打不开 ⇒ 这一格没量`); skip++; continue; }
    const want = rule.menu.slice().sort();
    const got = menu.slice().sort();
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    ok(`${state} S3 ⋮ 菜单＝矩阵那 ${want.length} 项`, got.join(' / '));
    if (missing.length || extra.length) {
      bad(`${state} S3 ⋮ 菜单与矩阵不符`,
        (missing.length ? '少：' + missing.join('、') : '')
        + (missing.length && extra.length ? '；' : '')
        + (extra.length ? '多：' + extra.join('、') : ''));
    }
  }
}

try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
console.log(`\n通过 ${pass} ｜ 断点 ${fail}` + (skip ? ` ｜ 未量 ${skip} 格` : ''));
if (skip) { console.log('有格子没量到 ⇒ 不算通过（rc=3）'); process.exit(3); }
process.exit(fail ? 2 : 0);
