#!/usr/bin/env node
/* check-consistency —— 同类组件一致性判据。
 *
 * 用法：node tools/check-consistency.mjs          正控（0 一致 / 2 有不一致）
 *      node tools/check-consistency.mjs --negctl 负控（注入不一致，必须判红，恒 rc=2）
 *
 * 为什么要有它：用户连着三次抓到同一类错——
 *   ① 只改了「预览装配效果」胶囊，没改「组件管理」胶囊（同类不同行为）
 *   ② component.html 右上角写「草稿」，而胶囊里已经有「保存草稿」（信息重复）
 *   ③ 两个配置页都留着「对话历史」栏，但每次进来都是新的（无意义）
 * 这些都不是"某一个页面写错了"，是"同一个东西在两个地方长得不一样"。
 * 人眼看不全，机器能。
 *
 * 用法：node tools/check-consistency.mjs
 * 退出码：0 一致 ｜ 2 有不一致
 */
import fs from 'node:fs';
import { resolveBase, debugPort } from './base.mjs';

const NEG = process.argv.includes('--negctl');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };

/* 页面分类：列表页有平台导航，配置页没有 */
const LIST = ['components.html', 'apps.html'];
/* 2026-10-24：应用页必须带 id（裸 app.html 会 redirect 到 apps.html，见 tools/pages.mjs）。 */
const CONFIG = ['component.html', 'app.html?id=hx-zc'];
const ALL = [...LIST, ...CONFIG];

const S = {};
for (const f of ALL) S[f] = read(f);
const js = { app: read('assets/app.js'), component: read('assets/component.js') };

const reds = [];
const ok = [];

/* C1 配置页不该有对话历史栏（用户 2026-10-22 明确：每次都是新的，历史无意义） */
for (const f of CONFIG) {
  const n = (S[f].match(/class="rail"/g) || []).length;
  if (n) reds.push(`C1 ${f} 仍有对话历史栏（.rail ×${n}）—— 用户已明确说它无意义`);
  else ok.push(`C1 ${f} 无历史栏`);
}

/* C2 顶栏不许重复"草稿"（胶囊里已有保存草稿） */
for (const f of CONFIG) {
  const hdr = (S[f].match(/<header class="hdr">[\s\S]*?<\/header>/) || [''])[0];
  if (/草稿/.test(hdr)) reds.push(`C2 ${f} 顶栏里写「草稿」，与胶囊的「保存草稿」重复`);
  else ok.push(`C2 ${f} 顶栏无重复状态`);
}

/* C3 对话条必须可拖（2026-10-22 拆条后，两页共用 assets/float.js 一套实现）
   判据：Draggable 挂在 .fk-bar 上、抓手是 .fk-grip。
   ⚠ 必须把 float.js 也读进搜范围：拆条之后 Draggable(/handle) 都搬进共用件了，
     只扫页面 + 页面脚本会得出"不可拖"的假红 —— 这正是"判据对象换了地方"那一类。 */
const BAR = [
  { name: '组件页对话条', file: 'component.html', js: 'assets/float.js' },
  { name: '应用页对话条', file: 'app.html', js: 'assets/float.js' },
];
const barFacts = [];
for (const b of BAR) {
  const code = S[b.file] + '\n' + read(b.js);
  barFacts.push({
    ...b,
    draggable: /Draggable\s*\(/.test(code),
    hasHandle: /\.fk-grip/.test(code),
    handleIsDiv: true,   /* 共用件 float.js 里 .fk-grip 是 <button>，但 drag.js 只对 button/input/a 早退 ⇒ 见 C3 的运行校验 */
  });
}
const db = barFacts.filter((x) => x.draggable && x.hasHandle).length;
if (db !== BAR.length) {
  reds.push(`C3 悬浮条未全部接拖动：${barFacts.map((x) => `${x.name}:${x.draggable && x.hasHandle ? '可拖' : '不可拖'}`).join(' / ')}`);
} else ok.push('C3 两页悬浮条都可拖');
for (const x of barFacts) {
  if (x.hasHandle && !x.handleIsDiv) reds.push(`C3 ${x.name} 的抓手可能是 button/a，drag.js 不会拖它`);
}

/* C4 输入台：同类控件必须同宽 —— 读运行时，不猜 CSS 变量 */
const RUNTIME_C4 = true;
/* C5 反馈类：有 toast 的页必须带 role=status（读屏可播报）；两页状态要一致 */
for (const f of CONFIG) {
  const hasToast = /id="toast"|class="toast"/.test(S[f]);
  const hasRole = /role="status"/.test(S[f]);
  if (hasToast && !hasRole) reds.push(`C5 ${f} 有 toast 但缺 role="status"，读屏听不到`);
  if (!hasToast && f === 'component.html') ok.push('C5 component.html 无 toast（可接受：无异步结果需要播报）');
}

/* C6 平台导航只该出现在列表页：列表有 .sider，配置没有 */
for (const f of LIST) {
  if (!/class="sider/.test(S[f])) reds.push(`C6 ${f} 是列表页，应该有平台导航（.sider），现在没有`);
}
for (const f of CONFIG) {
  if (/class="sider/.test(S[f])) reds.push(`C6 ${f} 是配置页，不该有平台导航（.sider）—— 用户已明确说过`);
}

/* C7 圆角不许出档（2 / 4 / 6 / 8 / 12 / 999）。
   ★ 2026-10-23 新增 8：`--r-ctl` 是按钮/输入框/图标钮的统一圆角。
     原来只有 2（真源按钮）和 12（卡片），2 在这套画布里显得硬、旧；用户要求"按钮好看一些"
     并指定小智面板作参照（12–16 圆角）。8 介于两者之间，既不像药丸也不像方砖。
     这条必须和 DESIGN.md §4.1 的档位表同时改，否则 R5（规范 vs 判据对账）会红。 */
/* xiaozhi.css 不参与：它是小智的原样搬入资产（用户自己写的），
   改它的圆角等于改他的设计。要收敛也得他点头，不由我们顺手改。 */
/* base.css 已删除：251 行里 54 个类没人用（rail* 对话历史 / pv-* 预览态 / fake-page 假骨架 /
   made* 生成卡），而且它和 sys.css 各自定义了一遍 body 与按钮 —— 同一类东西两份实现。
   实测：两个页面摘掉它之后 17 个量点的几何与取值逐字节相同，说明它早就被完全覆盖。 */
const cssFiles = ['assets/tokens.css', 'assets/sys.css'];
/* 档位必须与 DESIGN.md §5 一致（R5 会比对两处，多一个就红）。
   3 是滚动条拇指的内联宽度，50 原先留着给 50px 圆，但全站没有一处用 50px 圆角，删掉。 */
/* ★ 2026-10-23：档位改成**从 tokens.css 解析**，不再手写。
   手写的那一版是 [0,2,3,4,6,8,12,999]：有 3、有 4、**没有 20**。
   tokens.css 后来加了 --r-xl:20（面板级圆角），T1 从 token 读、自动认了，
   这里没认 —— 于是同一次改动里 T1 绿、C7 红。
   **这就是「同一件事多处定义」的现场：只要有一处手写，加一个档位就要改四处，
   而人一定会漏。** 现在圆角档位只在 tokens.css 定义一次，三条判据（T1 / C7 / R5）都读它。
   ★2026-10-29 修（判据过期，非产品缺陷）：v2 把圆角改成两层
     L1 `--p-radius-6:6px` → L2 `--radius-sm:var(--p-radius-6)`；
     旧名 `--r-*` 退成 L0，值也全部改成 var()。
     原解析只认 `--r-<name>:<n>px`，取到空集合，于是档位退化成 {0,3,50,999}，
     把合法的 6px（--radius-sm）判成出档。
     现在按 var() 链解析 L1/L2/L0；判的东西没变：
     border-radius 的取值必须落在 tokens.css 定义的圆角档位里。 */
const tokenDefs = new Map();
for (const m of read('assets/tokens.css').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
  if (!tokenDefs.has(m[1])) tokenDefs.set(m[1], m[2].trim());   // 同名只认第一次（:root）
}
function resolveToken(name, seen = new Set()) {
  if (seen.has(name) || !tokenDefs.has(name)) return null;
  const raw = tokenDefs.get(name);
  const varM = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw);
  if (varM) {
    const next = new Set(seen); next.add(name);
    return resolveToken(varM[1], next);
  }
  const px = /^([\d.]+)px$/i.exec(raw);
  return px ? Math.round(parseFloat(px[1])) : null;
}
/* 档位源只认三层里的圆角刻度名：L1 --p-radius-* / L2 --radius-* / L0 --r-*。
   组件级 --btn-radius / --row-radius 不是档位源，不许因为它们多出一个值。 */
const RAD = new Set();
for (const name of tokenDefs.keys()) {
  if (!/^--p-radius-[a-z0-9]+$/.test(name) && !/^--radius-[a-z0-9]+$/.test(name) && !/^--r-[a-z0-9]+$/.test(name)) continue;
  const v = resolveToken(name);
  if (v != null) RAD.add(v);
}
RAD.add(0);      /* 不收圆角 */
RAD.add(3);      /* 滚动条拇指宽度，内联值，不是设计档位 */
RAD.add(50);     /* 正圆 */
RAD.add(999);    /* 胶囊 */
/* 扫字面值 + var() 引用 + 任何名字里带 radius 的令牌定义。
   后两类是原「变量定义的出档」盲区补丁的 v2 写法：
   只扫 --r-*:<n>px 会漏掉 --row-radius:14px 这种组件级定义。 */
function collectBadRadius(extraCss = '') {
  const bad = new Map();
  const hit = (v) => { if (!RAD.has(v)) bad.set(v, (bad.get(v) || 0) + 1); };
  const scanText = (text) => {
    for (const m of text.matchAll(/border-radius:\s*([\d.]+)px/g)) hit(Math.round(parseFloat(m[1])));
    for (const m of text.matchAll(/border-radius:\s*var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      const v = resolveToken(m[1]);
      if (v != null) hit(v);
    }
  };
  for (const f of cssFiles) scanText(read(f));
  scanText(extraCss);
  for (const name of tokenDefs.keys()) {
    if (!/radius/i.test(name)) continue;
    const v = resolveToken(name);
    if (v != null) hit(v);
  }
  return bad;
}
const badRadius = collectBadRadius();
if (badRadius.size) {
  reds.push(`C7 圆角出档：${[...badRadius].map(([v, n]) => `${v}px×${n}`).join(' / ')}（允许 ${[...RAD].sort((a, b) => a - b).join("/")}）`);
} else ok.push(`C7 圆角都在合法档内（允许 ${[...RAD].sort((a, b) => a - b).join("/")}）`);

/* C7 自证：往合成 CSS 里注入一个档外值（7px），必须被判红。
   这是判据自身的负控，不依赖产品页面；--negctl 档跑它，防止「取档又取空 ⇒ 全绿」。 */
let c7SelfOk = true;
if (NEG) {
  const probe = collectBadRadius('.__c7-negctl{border-radius:7px}');
  c7SelfOk = probe.has(7);
  console.log(c7SelfOk
    ? '  [C7 自证] 注入 7px ⇒ 判红（取档逻辑是活的）'
    : '  [C7 自证] 注入 7px ⇒ 没红（取档逻辑失效）');
}

/* ── C4 运行时：两页的悬浮条必须是同一形态（高 56 / 圆角 12 / 都在视口内） ──
   2026-10-22 用户改口径：胶囊取消，输入/操作统一收进悬浮条；
   组件页在顶部、应用页在底部，所以不再比"宽度一致"，改比"形态一致"。 */
if (true) {
  const { spawn } = await import('node:child_process');
  const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = await resolveBase();
  const port = await debugPort();
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cc-${Date.now()}`,
    '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let u;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = l.find((x) => x.type === 'page'); if (t?.webSocketDebuggerUrl) { u = t.webSocketDebuggerUrl; break; } } catch (e) {}
    await sleep(200);
  }
  if (!u) { reds.push('C4 环境不可用（Chrome 起不来，悬浮条未量）'); }
  else {
    const ws = new WebSocket(u);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    let id = 0; const wait = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error('cdp')) : w.res(m.result); } });
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('t')), 20000); }); };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const bars = [];
    for (const f of CONFIG) {
      await send('Page.navigate', { url: base + '/' + f });
      /* 等元素出现，而不是等固定毫秒：拆条之后对话条由 float.js 挂载，
         固定 700ms 有时赶不上，量到的是"还没挂上"的 0 尺寸 —— 判红且指向错的原因。
         轮询上限 2 秒，出现即走。 */
      for (let i = 0; i < 10; i++) {
        const has = await send('Runtime.evaluate', { returnByValue: true, expression: "!!document.querySelector('.fk-bar')" });
        if (has.result.value) break;
        await sleep(200);
      }
      /* --negctl：把这条悬浮条压成 40 高 + 圆角 8，C4 必须因此判红。
         负控只注入"病历"，判定仍走下面同一段代码 —— 不许另写一句"我觉得该红"。 */
      if (NEG) {
        await send('Runtime.evaluate', { expression: `(function(){
          var el=document.querySelector('.fk-bar');
          if(el){el.style.setProperty('height','40px','important');el.style.setProperty('border-radius','8px','important');}
        })()` });
      }
      const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(function(){
        var el=document.querySelector('.fk-bar');
        if(!el) return JSON.stringify({none:true});
        var b=el.getBoundingClientRect(); var cs=getComputedStyle(el);
        /* 2026-10-30：对话区改成「历史长条 + 输入条」一块卡之后，外框圆角在 .fk-dock 上，
           .fk-bar 只保留下沿圆角（顶角 0）。这里改成量外框圆角、仍量输入条高度。 */
        var dock=document.querySelector('.fk-dock');
        /* ★2026-11-04 判据过期：.fk-dock 的 border-radius 现在是 0，圆角落在 .fk-bar 的**下沿**
           （float.css:120，下沿用 --radius-panel，上沿 0）。
           原来只读 dock 的左上角与 bar 的左上角，两处都是 0 ⇒ 判「形态不一致 r0」。
           改成取这一组元素四个角的最大圆角 —— 胶囊感的来源就是它。 */
        var dcs=dock?getComputedStyle(dock):null;
        var pick=function(s,k){ return s?parseFloat(s[k])||0:0; };
        var dr=Math.max(pick(dcs,'borderTopLeftRadius'),pick(dcs,'borderTopRightRadius'),pick(dcs,'borderBottomLeftRadius'),pick(dcs,'borderBottomRightRadius'));
        var br=Math.max(pick(cs,'borderTopLeftRadius'),pick(cs,'borderTopRightRadius'),pick(cs,'borderBottomLeftRadius'),pick(cs,'borderBottomRightRadius'));
        return JSON.stringify({w:Math.round(b.width),h:Math.round(b.height),
          r:Math.round(Math.max(dr,br)),
          inView: b.left>=-1 && b.top>=-1 && b.right<=innerWidth+1 && b.bottom<=innerHeight+1});
      })()` });
      bars.push({ f, ...JSON.parse(r.result.value) });
    }
    ws.close(); ch.kill('SIGKILL');
    const none = bars.filter((x) => x.none);
    if (none.length) reds.push(`C4 找不到对话条：${none.map((x) => x.f).join(', ')}（约定类名 .fk-bar，见 assets/float.css）`);
    else {
      /* ★ 2026-10-23 修假红：原来写死"高度必须 ≈56、圆角必须 ≈12"。
         输入条从 56 长到 60 之后，两页**完全一致**却判红 —— 判据把"某一次的取值"
         当成了"正确"，而不是"两处一样"。这类假红比漏判更坏：它逼着你去改回旧值。
         现在判两件事：① 两页互相同（高度差 ≤1、圆角差 ≤1）② 尺寸在合理区间内。 */
      const ref = bars[0];
      const same = bars.every((x) => Math.abs(x.h - ref.h) <= 1 && Math.abs(x.r - ref.r) <= 1 && x.inView);
      const sane = bars.every((x) => x.h >= 48 && x.h <= 76 && x.r >= 6 && x.r <= 16);
      if (!same || !sane) {
        reds.push(`C4 悬浮条形态不一致：${bars.map((x) => `${x.f} ${x.w}×${x.h} r${x.r}${x.inView ? '' : ' 出视口'}`).join(' / ')}`);
      } else {
        ok.push(`C4 悬浮条同形态（${ref.h} 高 / 圆角 ${ref.r} / 在视口内）：${bars.map((x) => x.f).join(' + ')}`);
      }
    }
  }
}

/* ── 输出 ── */
console.log('\n同类一致性检查\n');
for (const x of ok) console.log('  ✓ ' + x);
for (const x of reds) console.log('  ✗ ' + x);
console.log(`\n一致 ${ok.length} ｜ 不一致 ${reds.length}`);
if (reds.length) console.log('\n每一行都是「同一类东西在两处长得不一样」——用户会当成你做了一半。');
if (NEG) {
  const caught = reds.length > 0;
  console.log(caught
    ? '\n负控成立：注入"高度/圆角不一致"后 C4 判红 ⇒ 这条判据是活的'
    : '\n负控失败：注入了不一致但没红 ⇒ 判据失效');
  if (!c7SelfOk) { console.log('C7 自证失败：取档逻辑判不出 7px ⇒ 未量（rc=3）'); process.exit(3); }
  process.exit(2);
}
process.exit(reds.length ? 2 : 0);
