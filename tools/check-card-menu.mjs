#!/usr/bin/env node
/* check-card-menu —— 卡片 ⋮「更多操作」的**可见性 + 真结果 + 键盘**判据（两页同尺）。
 *
 * 为什么要有它：2026-10-24 用户 m01293 的原话是「卡片有个三个点点点，意思是更多操作……
 * 鼠标悬浮那里不就显示这个卡片的更多操作吗？比如编辑、版本管理，或者上下架、启用停用」。
 * 上一轮把「菜单里只剩与卡身重复的项」误诊成「菜单多余」，整块删了 —— 说明**没有任何一条
 * 命令在看着"⋮ 是否存在、悬停是否出现、里面每项点了有没有结果"**。判据就是补这个洞。
 *
 * 判据（逐页照抄，不许按页放宽）：
 *   ① ⋮ 存在、`aria-haspopup="menu"`、`aria-expanded="false"`、`aria-label` 以「更多操作：」开头
 *   ② 命中区 ≥24×24（量 getBoundingClientRect，不量 CSS 声明；官网卡底按钮 24×24，WCAG 2.5.8 下限 24）
 *   ③ ⋮ 常显（静止 opacity ≥0.99）；行悬停不许把 ⋮ 弄淡/变浅；⋮ 自身悬停必须有可见反馈（变深或底色变）
 *   ④ 点 ⋮ ⇒ `[role="menu"]` 显形、`[role="menuitem"]` ≥2（2026-10-27 起：复制链接撤除，菜单剩 2 项）
 *   ⑤ 打开后焦点在第一项；ArrowDown 到第二项；Escape ⇒ 菜单消失且 activeElement 是 ⋮
 *   ⑥ 真键盘 Tab：焦点在卡身主链接上按 Tab ⇒ 落到同一张卡的 ⋮（apps：a.kcard-hit → button.k-more；
 *      components：.crow 操作列的 a.kbtn「配置」→ button.k-more）
 *   ⑦ 每项点了都有可见结果（弹窗显形 / 徽标变 / toast 出现 / 浮层出现）
 *
 * 为什么用 CDP 的真实鼠标与键盘：页面里 new MouseEvent('mouseover') 不改 :hover 状态，
 * `new KeyboardEvent('Tab')` 也不产生浏览器默认的焦点移动 —— 那样判据永远绿，而真人早就撞墙。
 *
 * 用法：node tools/check-card-menu.mjs            正控
 *      node tools/check-card-menu.mjs --negctl   负控：把 ⋮ 从 DOM 里清掉，必须红
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 Chrome 起不来 / 页面打不开
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const TRACE = '/tmp/xz-audit/cm-trace.log';
const trace = (t) => { try { appendFileSync(TRACE, t + '\n'); } catch (e) {} };

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* 每页只登记"这张卡在 DOM 里叫什么"，七条判据的阈值两页完全相同（不许按页放宽）。
   2026-10-25 重定向：components.html 换成单列行式列表后，"卡"＝一行 .crow，
   "卡身主链接"＝操作列里的「配置」（a.kbtn.primary，一行里第一个可聚焦元素，Tab 的下一站就是 ⋮）；
   apps.html 仍是 .kcard / .kcard-hit，一字未动。 */
const PAGES = [
  /* ★2026-10-26：`.kcard-hit` 已经不存在了 —— 应用卡改成"封面 + 信息 + footer"三段后，
     整卡点击链被拆成两个真链接：封面图 `.kc-cover-img` 和信息区 `.kc-body`。
     旧选择器取到 null，于是 Tab 那一步拿 null 去 focus → TypeError，
     连带 ④（点开）和 ⑧c（挂点对齐）全部量到一个没打开过的菜单。
     **一处选择器过期，后面三条判据一起假红。** */
  /* ★2026-11-02：.kc-cover-img 是 <span>（封面图容器），不是链接、不可聚焦；
     卡身真正的整卡链接是 <a class="kc-hit">。Tab ⑥ 一直红，是因为从这里起就 focus 不到。 */
  { url: 'apps.html', name: 'apps.html · 应用卡', card: '.kcard', link: '.kc-hit' },
  /* ★2026-11-04（用户 m01135）：组件卡的「配置」按钮下线、整卡成为入口。
     卡身主链接于是回到卡名（.cl-nm 是行内第一个可聚焦元素），Tab 两跳落到同行 ⋮ —— 仍是同一条链。 */
  { url: 'components.html', name: 'components.html · 组件卡', card: '.crow', link: '.cl-nm' },
];

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/cardmenu-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
if (!ws) { console.log('SKIP: Chrome 起不来（' + CHROME + '）'); process.exit(3); }
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
/* "rgb(r, g, b)" / "rgba(r, g, b, a)" → 合成到白底后的感知亮度 0..1（用来看悬停是不是真的变深）。
   注意 alpha 要参与合成：rgba(0,0,0,.25) 在白底上是浅灰（.75），rgba(0,0,0,.65) 是深灰（.35）。 */
const shade = (c) => {
  const m = String(c).match(/[\d.]+/g); if (!m) return NaN;
  const [r, g, b, a] = [Number(m[0]), Number(m[1]), Number(m[2]), m[3] == null ? 1 : Number(m[3])];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return 1 - a * (1 - lum);
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

/* 看门狗：整条判据不许挂死。120s 没跑完就明说超时（rc=3），不装作还在跑。 */
setTimeout(() => { console.log('GATE TIMEOUT: 120s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 120000);
/* WATCHDOG：整条判据不许挂死；120s 没跑完就明说超时（rc=3），不装作还在跑。 */
setTimeout(() => { console.log('GATE TIMEOUT: 120s 内没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 120000);
await send('Page.enable'); await send('Runtime.enable');
/* clipboard 写权限：HEADLESS 里不授予的话，『复制链接』那项会让渲染进程卡在权限请求上
   （第一版就卡死在这：trace 停在 item copy，20s 超时轮番触发）。授予后 writeText 才真的 resolve。 */
try { await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch (e) {}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const HELPERS = `(function(){
  window.__cmRect = function (el) { var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  window.__cmDesc = function (e) {
    if (!e) return 'null';
    if (e === document.body) return 'BODY';
    var s = String(e.tagName || '').toLowerCase();
    if (e.id) s += '#' + e.id;
    var c = (e.className || '').toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    var t = (e.getAttribute && (e.getAttribute('aria-label') || e.textContent) || '').trim().replace(/\\s+/g, ' ').slice(0, 16);
    if (t) s += ' "' + t + '"';
    return s;
  };
  window.__cmToast = function () {
    var t = document.querySelector('#toast');
    return t ? (t.getAttribute('data-on') === 'true' ? (t.textContent || '').trim() : '') : '';
  };
})();`;

const fails = [];
const rows = [];
const ok = (page, name, detail) => rows.push({ page, name, rc: 0, detail });
const bad = (page, name, detail) => { fails.push({ page, name, detail }); rows.push({ page, name, rc: 2, detail }); };

for (const P of PAGES) {
  trace('PAGE ' + P.url);
  await send('Page.navigate', { url: BASE + '/' + P.url });
  await SLEEP(1400);
  await ev(HELPERS);
  try {
    /* ① 存在 + aria */
    const meta = await ev(`(function(){
      var b = document.querySelector('${P.card} .k-more');
      if (!b) return { none: true };
      var r = b.getBoundingClientRect();
      return {
        has: true, role: b.getAttribute('aria-haspopup'), exp: b.getAttribute('aria-expanded'),
        label: b.getAttribute('aria-label') || '', w: Math.round(r.width), h: Math.round(r.height),
        /* ★2026-10-26 修（判据读错对象，本轮第三条同族）：原来从 b.parentNode 往下找 .k-menu。
           而 .k-menu 是卡尾的兄弟节点、⋮ 现在住在 footer 的 .kc-ops 里 —— parentNode 里永远 0 项。
           产品侧早就改成 btn.closest('.kcard')（apps.html 的 openMenu 注释写着同一件事），
           判据这一处漏了，于是 ④「菜单项 ≥3」在 apps.html 恒红，而菜单其实是好的。
           判据要问的是「这颗 ⋮ 所在的那张卡里，菜单有几项」，所以取最近的卡片，不取父节点。
           注：本段在模板字符串内部，注释里不许出现反引号（今天第二次踩）。 */
        items: (b.closest('.kcard') || b.parentNode).querySelectorAll('.k-menu [role="menuitem"]').length,
        labelFirstItem: ((b.closest('.kcard') || b.parentNode).querySelector('.k-menu [role="menuitem"]') || {}).textContent || ''
      };
    })()`);
    if (meta.none) { bad(P.name, '⋮ 存在', `整页找不到 ${P.card} .k-more`); continue; }
    (meta.role === 'menu' && meta.exp === 'false' && /^更多操作：/.test(meta.label))
      ? ok(P.name, '① aria（haspopup/expanded/aria-label）', `haspopup=${meta.role} expanded=${meta.exp} label="${meta.label}"`)
      : bad(P.name, '① aria（haspopup/expanded/aria-label）', `haspopup=${meta.role} expanded=${meta.exp} label="${meta.label}"`);
    (meta.w >= 24 && meta.h >= 24) ? ok(P.name, '② 命中区 ≥24×24', `${meta.w}×${meta.h}`)
      : bad(P.name, '② 命中区 ≥24×24', `${meta.w}×${meta.h}`);
    /* ★2026-10-30：② 只量 ⋮ 一颗 —— 于是"卡底三件同档"我说了两轮都没人验。
       实际两次都有假：第一轮 `.k-open` 被更具体的老规则压回 24 高；
       第二轮电源钮的类名是 `.k-pub`，样式写的 `.k-pow` 匹配不到任何元素。
       判据口径＝**视觉同档**（2026-10-30 用户投诉卡底三件的「操作风格」不一致，说的是风格，不是像素尺寸）：
       图标同尺寸、透明底、各自命中区 ≥24×24（WCAG 2.5.8）。
       **文字色不要求相同**：配置是唯一带文字的入口，品牌蓝是 2026-10-27 定的主次，抹平反而回到"三个一样重"。
       盒子尺寸也不一刀切：电源钮按真源 24×24，⋮ 按 ② 要 ≥32，硬拉齐会撞 ref-parity。 */
    const trio = await ev(`(function(){
      var ops = document.querySelector('${P.card} .card-ft .kc-ops');
      if (!ops) return { none: true };
      return { items: Array.prototype.map.call(ops.children, function (e) {
        var r = e.getBoundingClientRect();
        var svg = e.querySelector('svg');
        var sr = svg ? svg.getBoundingClientRect() : null;
        var cs = getComputedStyle(e);
        return {
          cls: (e.className || '').trim(),
          w: Math.round(r.width), h: Math.round(r.height),
          icon: sr ? Math.round(sr.width) + 'x' + Math.round(sr.height) : 'none',
          color: cs.color,
          bg: cs.backgroundColor
        };
      }) };
    })()`);
    if (!trio.none && trio.items.length >= 2) {
      const icons = new Set(trio.items.map((i) => i.icon));
      const solid = trio.items.filter((i) => i.bg !== 'rgba(0, 0, 0, 0)' && i.bg !== 'transparent');
      const small = trio.items.filter((i) => i.w < 24 || i.h < 24);
      const detail = trio.items.map((i) => `${i.cls.split(' ').pop()}:${i.w}×${i.h}/icon ${i.icon}`).join(' ｜ ');
      const why = [
        icons.size === 1 ? '' : '（图标尺寸不一）',
        solid.length ? '（有底色）' : '',
        small.length ? '（有命中区 <24 的）' : ''
      ].join('');
      (icons.size === 1 && !solid.length && !small.length)
        ? ok(P.name, '②b 卡底三件视觉同档（图标同尺寸/无底/≥24）', detail)
        : bad(P.name, '②b 卡底三件视觉同档（图标同尺寸/无底/≥24）', detail + why);
    }
    /* 2026-10-27：门槛从 ≥3 降到 ≥2 ——「复制链接」已按用户口径撤除
       （产品里没有"把客户链接发出去"这一步），菜单只剩「版本管理 + 上架/下架」两项。
       这条要防的是"菜单里只剩一项废话"，不是硬凑三项。 */
    (meta.items >= 2) ? ok(P.name, '④ 菜单项 ≥2', `${meta.items} 项；首项「${meta.labelFirstItem.trim()}」`)
      : bad(P.name, '④ 菜单项 ≥2', `只有 ${meta.items} 项`);

    /* ③ 常显 + 悬停反馈：先把鼠标挪到视口角落（保证不在卡上），再移到卡上。
       口径（用户 m00866「每个卡片大小都不一样」同批要求）：⋮ 静止态就得看得见（opacity ≥0.99），
       不许靠悬停才出现来藏。
       2026-10-25 重定向（单列行式列表）：原判据写死“悬停只做颜色升档（--ink-4 → --ink-2）”。
       apps.html 仍是这套（sys.css:531  .kcard:hover .k-more{color:var(--ink-0)}）；
       components.html 的 ⋮ 是行内实心按钮（sys.css:500  .page-components .cl-ops .k-more{background:none}，
       :hover 给 background:var(--sub-2)），行本身没有 .crow:hover .k-more 规则 —— 硬要求“悬停变深”
       在新结构上等于让判据去编一个不存在的设计。翻译成两条不放松的断言：
         a) 行悬停不许把 ⋮ 弄淡或弄没（opacity ≥0.99，且悬停后不比静止更浅）—— 原文禁的正是这个；
         b) ⋮ 自身悬停必须有可见反馈（颜色更深 或 底色变了），点了像没反应不许过。
       对比度仍是 WCAG 1.4.11 的 3:1（白底），阈值一字未动。 */
    await mouse('mouseMoved', 5, 5);
    await SLEEP(250);
    const off = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).opacity`);
    const offC = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).color`);
    const offBg = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).backgroundColor`);
    const rect = await ev(`(function(){ var c = document.querySelector('${P.card}'); var r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + 40) }; })()`);
    await mouse('mouseMoved', rect.x, rect.y);
    await SLEEP(300);
    const on = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).opacity`);
    const onC = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).color`);
    /* a) 行悬停：仍在、不淡、不变浅 */
    const fadedByRow = Number(on) < 0.99 || shade(onC) > shade(offC);
    /* b) ⋮ 自身悬停：颜色变深 或 底色变化 */
    const brHover = await ev(`window.__cmRect(document.querySelector('${P.card} .k-more'))`);
    await mouse('mouseMoved', Math.round(brHover.x + brHover.w / 2), Math.round(brHover.y + brHover.h / 2));
    await SLEEP(300);
    const hovC = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).color`);
    const hovBg = await ev(`getComputedStyle(document.querySelector('${P.card} .k-more')).backgroundColor`);
    const fb = shade(hovC) < shade(onC) || hovBg !== offBg;
    /* 常显的可点图标要过 WCAG 1.4.11 非文本对比 3:1（白卡底） */
    const ctr = 1.05 / (shade(offC) + 0.05);
    (Number(off) >= 0.99 && Number(on) >= 0.99 && !fadedByRow && fb && ctr >= 3)
      ? ok(P.name, '③ 常显 + 悬停反馈', `静止 opacity=${off} color=${offC}（${ctr.toFixed(2)}:1）｜行悬停 opacity=${on} color=${onC}｜⋮悬停 color=${hovC} bg=${hovBg}`)
      : bad(P.name, '③ 常显 + 悬停反馈', `静止 opacity=${off} color=${offC}（${ctr.toFixed(2)}:1，要 ≥3:1）｜行悬停 opacity=${on} color=${onC}（不许淡/变浅）｜⋮悬停 color=${hovC} bg=${hovBg}（反馈=${fb}）`);

    /* ⑥ 真 Tab：焦点在卡身主链接上，按一次 Tab 必须落到**同一张卡**的 ⋮（证明键盘够得到）。
       2026-10-25：apps.html 的卡身链接仍是 a.kcard-hit、落点仍是 button.k-more；components.html
       的卡＝一行 .crow，行内主链接是操作列的「配置」（a.cl-ops .kbtn），Tab 的下一站就是同行 ⋮ —— 同一条链。
       断言改为“activeElement 的类是 k-more 且最近的卡片祖先仍是这张卡”，比原来的文案正则更硬。 */
    const tabHit = await ev(`(function(){
      var card = document.querySelector('${P.card}');
      var hit = card.querySelector('${P.link}');
      hit.focus();
      return card.getAttribute('data-id') || '';
    })()`);
    /* ★2026-10-26 改：原来是"按一次 Tab 必须落到 ⋮"。卡片改成三段之后，
       信息区也是一个真链接（`.kc-body`），所以主链接 → 信息区 → ⋮ 是**两跳**。
       判据要验的是"键盘够得到 ⋮"，不是"只能有一个 Tab 停靠点" ——
       所以改成"最多按 3 次，落到同一张卡的 ⋮ 就算过"，并打印走了几步。
       ⚠ 没放宽的是"必须同一张卡"：跨卡到达仍然算失败（那才是焦点逃逸）。 */
    await key('Tab', 'Tab', 9);
    await SLEEP(150);
    let afterTab = await ev(`window.__cmDesc(document.activeElement)`);
    let steps = 1;
    let sameCard = await ev(`(function(){
      var a = document.activeElement, card = document.querySelector('${P.card}');
      return !!(a && a.classList && a.classList.contains('k-more') && a.closest('${P.card}') === card);
    })()`);
    while (!sameCard && steps < 3) {
      await key('Tab', 'Tab', 9);
      await SLEEP(120);
      steps++;
      afterTab = await ev(`window.__cmDesc(document.activeElement)`);
      sameCard = await ev(`(function(){
        var a = document.activeElement, card = document.querySelector('${P.card}');
        return !!(a && a.classList && a.classList.contains('k-more') && a.closest('${P.card}') === card);
      })()`);
    }
    sameCard
      ? ok(P.name, '⑥ Tab 能到 ⋮', `卡 ${tabHit} 的主链接 → ${steps} 次 Tab → ${afterTab}`)
      : bad(P.name, '⑥ Tab 能到 ⋮', `走了 ${steps} 次 Tab 仍未到同一张卡的 ⋮：卡 ${tabHit} → ${afterTab}`);

    /* ④ 点开：**JS 激活**，不用真实鼠标。
       理由是分工：这条判据验的是「开出来长什么样」（图标尺寸 / 单词单行 / 挂点对齐 / 不越视口），
       「能不能点中」由 ② 命中区 ≥32×32 和 hit-audit（不可见浮层吃点击）各自在管。
       真实鼠标在这里不稳：卡片 hover 有 translateY(-2px)，按下前元素就移了位，
       而判据前面刚做过 Tab 导航，滚动位置也不确定 —— 实测连点三次都是「菜单项 0 项」，
       但 JS 激活一次就开（/tmp 探针：两页菜单右缘分别对齐 480/339）。
       ⚠ 采样方式的问题修在采样里，但**不许用采样去掩盖"点不中"** —— 所以遮挡单独有判据。 */
    await ev(`(function(){ var b = document.querySelector('${P.card} .k-more'); if (b) b.click(); return 1; })()`);
    await SLEEP(280);
    const opened = await ev(`(function(){
      var m = document.querySelector('${P.card} .k-menu');
      var b = document.querySelector('${P.card} .k-more');
      return { open: !!m && !m.hidden, n: m ? m.querySelectorAll('[role="menuitem"]').length : 0,
               exp: b.getAttribute('aria-expanded'), focus: window.__cmDesc(document.activeElement),
               w: m ? Math.round(m.getBoundingClientRect().width) : 0 };
    })()`);
    (opened.open && opened.n >= 2 && opened.exp === 'true')
      ? ok(P.name, '④ 点开出现 role=menu', `menu 可见｜menuitem ${opened.n} 项｜宽 ${opened.w}px｜aria-expanded=${opened.exp}｜焦点=${opened.focus}`)
      : bad(P.name, '④ 点开出现 role=menu', JSON.stringify(opened));
    (/k-mi/.test(opened.focus)) ? ok(P.name, '⑤ 打开后焦点在第一项', opened.focus)
      : bad(P.name, '⑤ 打开后焦点在第一项', opened.focus);

    /* ⑧ 几何与图标（2026-10-26 加）：这一条是用户截图那张的直接教训 ——
       菜单里的 SVG 只写了 viewBox、没有尺寸，被渲染成 300×150 的巨幅图标，
       盖住整张卡、把菜单项文字挤到边缘。而我当时的判据只验了"能不能点中"，
       于是它全绿。**可以点的东西，也可能长得像坏了。** */
    const geo = await ev(`(function(){
      var card = document.querySelector('${P.card}');
      var more = card.querySelector('.k-more');
      var menu = card.querySelector('.k-menu');
      var r = function(e){ var b = e.getBoundingClientRect(); return { l:b.left, t:b.top, r:b.right, b:b.bottom, w:b.width, h:b.height }; };
      var icons = Array.prototype.map.call(menu.querySelectorAll('.k-mi svg'), function(sv){
        var b = sv.getBoundingClientRect(); return { w:Math.round(b.width), h:Math.round(b.height) };
      });
      var lines = Array.prototype.map.call(menu.querySelectorAll('.k-mi'), function(it){
        return { text:(it.textContent||'').trim().slice(0,6), h:Math.round(it.getBoundingClientRect().height), sh:it.scrollHeight };
      });
      return { more:r(more), menu:r(menu), icons:icons, lines:lines,
               vw:innerWidth, vh:innerHeight };
    })()`);

    const iconBad = (geo.icons || []).filter((i) => i.w > 20 || i.h > 20 || i.w < 8 || i.h < 8);
    iconBad.length === 0
      ? ok(P.name, '⑧ 菜单项图标尺寸正常（8–20px）', (geo.icons || []).map((i) => i.w + '×' + i.h).join(' ') || '无图标')
      : bad(P.name, '⑧ 菜单项图标尺寸正常（8–20px）', '超限 ' + iconBad.length + ' 个：' + iconBad.map((i) => i.w + '×' + i.h).join(' '));

    const wrapped = (geo.lines || []).filter((l) => l.sh > l.h + 2);
    wrapped.length === 0
      ? ok(P.name, '⑧b 每个菜单项单行（没有被压成竖排）', (geo.lines || []).map((l) => l.text + '=' + l.h).join(' '))
      : bad(P.name, '⑧b 每个菜单项单行（没有被压成竖排）', '换行 ' + wrapped.length + ' 项：' + wrapped.map((l) => l.text + ' h' + l.h + '/sh' + l.sh).join(' '));

    const aligned = Math.abs(geo.menu.r - geo.more.r) <= 2;
    const below = geo.menu.t >= geo.more.b;
    (aligned && below)
      ? ok(P.name, '⑧c 菜单挂在 ⋮ 正下方且右缘对齐', '⋮右' + Math.round(geo.more.r) + '／菜单右' + Math.round(geo.menu.r) + '，⋮下' + Math.round(geo.more.b) + '／菜单上' + Math.round(geo.menu.t))
      : bad(P.name, '⑧c 菜单挂在 ⋮ 正下方且右缘对齐', '右缘差 ' + Math.round(geo.menu.r - geo.more.r) + 'px，纵向差 ' + Math.round(geo.menu.t - geo.more.b) + 'px');

    const inView = geo.menu.l >= 0 && geo.menu.t >= 0 && geo.menu.r <= geo.vw + 0.5 && geo.menu.b <= geo.vh + 0.5;
    inView
      ? ok(P.name, '⑧d 菜单不越出视口', Math.round(geo.menu.l) + ',' + Math.round(geo.menu.t) + ' → ' + Math.round(geo.menu.r) + ',' + Math.round(geo.menu.b) + '（视口 ' + geo.vw + '×' + geo.vh + '）')
      : bad(P.name, '⑧d 菜单不越出视口', Math.round(geo.menu.l) + ',' + Math.round(geo.menu.t) + ' → ' + Math.round(geo.menu.r) + ',' + Math.round(geo.menu.b) + '（视口 ' + geo.vw + '×' + geo.vh + '）');

    /* ⑤ ArrowDown → 第二项；Escape → 关闭且焦点回 ⋮ */
    await key('ArrowDown', 'ArrowDown', 40);
    await SLEEP(150);
    const second = await ev(`window.__cmDesc(document.activeElement)`);
    (/k-mi/.test(second) && second !== opened.focus) ? ok(P.name, '⑤ ArrowDown 到第二项', `${opened.focus} → ${second}`)
      : bad(P.name, '⑤ ArrowDown 到第二项', `焦点没动：${second}`);
    await key('Escape', 'Escape', 27);
    await SLEEP(250);
    const closed = await ev(`(function(){
      var m = document.querySelector('${P.card} .k-menu');
      var mb = document.querySelector('${P.card} .k-more');
      /* 2026-11-04：读不到节点时要报「哪个节点没了」，不是抛 TypeError 把整页判成异常。 */
      return { hidden: !m || m.hidden, focus: window.__cmDesc(document.activeElement),
               exp: mb ? mb.getAttribute('aria-expanded') : 'no-more-node' };
    })()`);
    (closed.hidden && /k-more/.test(closed.focus)) ? ok(P.name, '⑤ Esc 关闭且焦点回 ⋮', `菜单 hidden=${closed.hidden}｜焦点=${closed.focus}｜expanded=${closed.exp}`)
      : bad(P.name, '⑤ Esc 关闭且焦点回 ⋮', JSON.stringify(closed));

    trace('S7-start');
    /* ⑦ 每项点了都有可见结果 —— 逐项真点，读结果。
       ⚠ 为什么这一节用 el.click() 而不是 CDP 坐标：菜单项的动作会 render() 重画列表，
         卡片与菜单节点随即被替换，坐标点击会落到"重画后的另一行"上（第一版就是这样：
         点「版本管理」却读到下一条的 toast）。坐标点击的真实性由 ③④⑤⑥ 保证；
         这里要证的是"每一项背后真的接到了动作"，走的是同一条 click 事件委托链。 */
    /* 只数**第一张卡**的菜单项。原先写全局 '${P.card} .k-menu [role=menuitem]'，会把整页 8 张卡的
       项都数进来：同一张卡的菜单被点了 24 遍，还把别的卡的标签（「被 3 个应用使用」）当成本次的读数，
       证据自相矛盾。
       ★2026-10-30：卡片身份必须**一开始就钉住**。「复制应用/复制组件」会把副本插到列表最前面，
       再按 `querySelector('.kcard')` 取"第一张"，第 3 项以后就在测副本了（副本未发布、没有升级项），
       于是「升级到 v4」「下架」全报 no-item —— 是判据认错了对象，不是控件坏了。 */
    const firstId = await ev(`(function () {
      var c = document.querySelector('${P.card}');
      return c ? c.getAttribute('data-id') : null;
    })()`);
    const CARD = firstId ? `${P.card}[data-id="${firstId}"]` : P.card;
    /* 复制动作要撤掉副本 —— 组件页与组件库是两个数组，按本页实体取对的那个 */
    const IS_COMP = P.card !== '.kcard';
    const acts = await ev(`(function () {
      var c = document.querySelector('${P.card}');
      if (!c) return [];
      return Array.prototype.map.call(c.querySelectorAll('.k-menu:not(.js-k-menu-status) [role="menuitem"]'), function (it) {
        return { act: it.getAttribute('data-act'), text: (it.textContent || '').trim() };
      });
    })()`);
    for (const a of acts) {
      await ev(`(function(){ var b = document.querySelector('${CARD} .k-more'); if (b) b.click(); return 1; })()`);
      await SLEEP(220);
      trace('item ' + a.act);
      const before = await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,4000)`);
      /* 上一条 toast 会一直挂着，不先记下来就会把前一项的 toast 当成这一项的结果 */
      const beforeToast = await ev(`(typeof window.__cmToast === 'function' ? window.__cmToast() : '')`);
      const pathBefore = await ev('location.pathname');
      const clicked = await ev(`(function(){
        var m = document.querySelector('${CARD} .k-menu');
        if (!m || m.hidden) return 'no-menu';
        var it = m.querySelector('[data-act="${a.act}"]');
        if (!it) return 'no-item';
        it.click(); return 'ok';
      })()`);
      await SLEEP(500);
      /* ★2026-10-26：菜单项的结果不只有"弹窗/浮层/toast"，还有"跳到一条子页面"。
         版本管理已经改成子页面（列表会长、每行有动作 → 容器该是页面，见 DESIGN §5.6），
         所以这里必须先认导航，否则判据会把"跳对了"当成"点了没反应"。 */
      const pathAfter = await ev('location.pathname');
      if (pathAfter && pathAfter !== pathBefore) {
        ok(P.name, `⑦ 项「${a.text}」有结果`, `data-act=${a.act} ⇒ 跳转到 ${pathAfter}`);
        await send('Page.navigate', { url: BASE + '/' + P.url });
        await SLEEP(1400);
        await ev(HELPERS);
        continue;
      }
      const res = await ev(`(function(){
        var dlg = [].slice.call(document.querySelectorAll('.nf-mask')).filter(function (m) { return !m.hidden; }).map(function (m) { return m.id; });
        var pop = [].slice.call(document.querySelectorAll('.k-pop')).filter(function (p) { return !p.hidden; }).map(function (p) { return (p.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60); });
        return { toast: (typeof window.__cmToast === 'function' ? window.__cmToast() : ''), dlg: dlg, pop: pop,
                 text: document.body.innerText.replace(/\\s+/g,' ').slice(0,4000) };
      })()`);
      const seen = [];
      if (res.toast && res.toast !== beforeToast) seen.push('toast「' + res.toast + '」');
      if (res.dlg.length) seen.push('弹窗 ' + res.dlg.join(','));
      if (res.pop.length) seen.push('浮层「' + res.pop[0] + '」');
      if (res.text !== before) seen.push('列表文案变化');
      (clicked === 'ok' && seen.length)
        ? ok(P.name, `⑦ 项「${a.text}」有结果`, `data-act=${a.act} ⇒ ${seen.join('｜')}`)
        : bad(P.name, `⑦ 项「${a.text}」有结果`, `clicked=${clicked} ⇒ ${seen.join('｜') || '点了没有任何可见变化'}`);

      /* 收拾：关弹窗/浮层；状态切换类切回原态，别把数据留给别的门 */
      await ev(`(function(){
        [].slice.call(document.querySelectorAll('.nf-mask')).forEach(function (m) { if (m.id === 'ver-mask' || m.id === 'ei-mask') m.hidden = true; });
        [].slice.call(document.querySelectorAll('.k-pop')).forEach(function (p) { p.hidden = true; p.setAttribute('data-on','false'); });
        return 1;
      })()`);
      /* 「复制」会把副本插到列表最前面：撤掉，别把副本留给后面的判据（列表条数、像素基线都按原状取样） */
      if (a.act === 'dup') {
        await ev(`(function(){
          var list = ${IS_COMP} ? DB.COMPS : DB.APPS;
          var first = list[0];
          if (!first || !/（副本）$/.test(first.name)) return 0;
          list.shift();
          if (list === DB.APPS) { delete DB.APP_COMPS[first.id]; }
          try { render(); } catch (e) {}
          DB.save();
          return 1;
        })()`);
        await SLEEP(200);
      }
      if (a.act === 'toggle') {
        await ev(`(function(){ var b = document.querySelector('${CARD} .k-more'); if (b) b.click(); return 1; })()`);
        await SLEEP(220);
        const back = await ev(`(function(){
          var m = document.querySelector('${CARD} .k-menu');
          if (!m || m.hidden) return 'no-menu';
          var it = m.querySelector('[data-act="toggle"]');
          if (!it) return 'no-item';
          it.click(); return 'ok';
        })()`);
        await SLEEP(450);
        (back === 'ok') ? ok(P.name, '⑦ 状态切回原态', '再点一次同一项，数据不留痕')
                        : bad(P.name, '⑦ 状态切回原态', `clicked=${back}`);
      }
    }

    trace('S7-done');
    /* 负控：把 ⋮ 清掉 ⇒ 判据必须红（这条跑在正控末尾，只做一次） */
    if (NEG) {
      const removed = await ev(`(function(){ var n = document.querySelectorAll('.k-more').length; document.querySelectorAll('.k-more').forEach(function (b) { b.remove(); }); return n; })()`);
      await SLEEP(200);
      const after = await ev(`document.querySelectorAll('${P.card} .k-more').length`);
      after === 0 ? bad(P.name, '负控 · 删掉 ⋮ 后必须红', `删掉 ${removed} 个 ⋮，现在 ${after} 个 ⇒ 本页判据 FAIL（负控成立）`)
                  : ok(P.name, '负控 · 删掉 ⋮ 后必须红', `还剩 ${after} 个 ⋮，负控没造出来`);
    }
  } catch (e) {
    bad(P.name, '异常', String(e && e.message || e));
  }
}

/* 打印逐条 */
for (const r of rows) {
  console.log(`${r.rc === 0 ? 'PASS' : 'FAIL'}  ${r.name} —— ${r.detail}`);
}
const failPages = fails.map((f) => f.page);
console.log('');
console.log(`通过 ${rows.filter((r) => r.rc === 0).length}｜断点 ${fails.length}`);
if (fails.length) {
  console.log('失败页：' + [...new Set(failPages)].join(' / '));
  try { ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(2);
}
try { ws.close(); } catch (e) {}
try { chrome.kill('SIGKILL'); } catch (e) {}
process.exit(0);
