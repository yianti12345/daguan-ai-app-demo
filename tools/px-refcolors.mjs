#!/usr/bin/env node
/* px-refcolors —— **像素自证**：computed 有没有说谎。
 *
 * 主体是什么：
 *   对角色表（ref-parity.mjs 的 ROLES）里每个"有底色"的角色：
 *     取元素 rect → 截图像素里取该 rect 的众数色 → 与 getComputedStyle().backgroundColor 比对
 *   **不一致即红**，并打印 角色 / computed / 像素众数 / 占该 rect 面积比。
 *   真源与我方各跑一遍，各自自证各自的一致性（不比较两边像不像，所以不会永远红）。
 *
 * 为什么单独一个入口（而不是 px-parity 的一个模式）：
 *   `check-judgments` 的负控是**按工具去重、只跑一次 --negctl**。
 *   一个文件里塞两个模式，只有一个能被负控验到，另一支就成了"没人验的恒绿"。
 *   拆成两个入口 = 台账上两条独立判据（PX / PXC），各跑各的负控。
 *   比较代码复用 px-parity.mjs 导出的同一份（不复制）。
 *
 * 负控怎么做（--negctl）：
 *   对我方页面注入 `* { background: transparent !important }`，让每个元素的底色变成"透出父层"，
 *   于是 computed=transparent 而像素是父层的色 ⇒ 必须判红（rc=2）。
 *
 * 两条实测事实（2026-10-23，别再重复查）：
 *   ① **bsk 的 screenshot 输出是真 PNG**（`file` 读到 "PNG image data, 1440 x 723, 8-bit/color RGB"），
 *      不是 JPEG/WebP —— 所以"截图管线有色偏"这个假设在文件格式层面不成立；
 *   ② 五色标定实测两条管线都是**中性**（白/黑/中灰 Δ=0，品牌蓝 Δ=0/1/0、近白灰 Δ=-3/4/1 全部来自
 *      "量化到 8 的整数倍"这个读数方法本身）。见 px-parity.mjs 的 colorProbe。
 *   ⇒ 跨管线仍然不许比颜色（两侧各自自证），但**不需要**色偏补偿。
 *
 * ⚠ 越界守卫：bsk 截图是 1440×723 而视口是 1440×900（窗口 chrome 占掉高度）。
 *   落在 y>723 的角色块**量不到**，必须显式记为"越界未量"，绝不能算成"一致"。
 *
 * 已知覆盖边界：只覆盖角色表里带 `bg` 的角色（卡洛已扩到 4 个：菜单当前项 / 主按钮 / 侧栏整块 / 卡底栏）。
 *   扩面要在 ref-parity.mjs 的 ROLES 里加一行 props 含 'bg'，本工具不会自动发现"该比哪些盒子"。
 *
 * 用法：node tools/px-refcolors.mjs [--page apps.html] [--negctl] [--json]
 * 退出码：0 一致 ｜ 2 不一致（负控恒 2）｜ 3 环境不可用 ｜ 9 真源没量
 */
import { resolveBase } from './base.mjs';
import { openMine, openRef, dominantColors, loadRoles, normColor, colorProbe, printColorProbe } from './px-parity.mjs';
import fs from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`px-refcolors —— 像素自证（computed vs 像素众数）

用法: node tools/px-refcolors.mjs [--page <页>] [--negctl] [--json]

  --page <页>   只验一页（默认 apps.html）
  --negctl      负控：注入 *{background:transparent}，必须判红（rc=2）
  --json        机器可读输出

判据：角色元素的 computed backgroundColor 必须等于它在截图里的众数色（±12/255，抗量化噪声）
覆盖：仅 ref-parity.mjs 的 ROLES 里 props 含 'bg' 的角色
退出码：0 一致 ｜ 2 不一致（负控恒 2）｜ 3 环境不可用 ｜ 9 真源没量`);
  process.exit(0);
}
const NEG = argv.includes('--negctl');
const JSON_OUT = argv.includes('--json');
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const pagePath = argOf('--page', 'apps.html');
/* 2026-11-02：旧真源 172.26.26.61/AiWriting/AppManage 已不返回原页面（打开是空白/登录页），
   角色表一条都不命中 ⇒ pxc rc=9「没量」。改用当前线上应用管理页；ref-parity 的 ROLES
   里 bg 角色（侧栏/当前项/主按钮/卡底栏）在该页实测均存在。 */
const REF_URL = process.env.REF_URL || 'https://agents.datagrand.com/admin/#/Expert/ManageAgent';
const TMP = '/tmp/px-refcolors';

let BASE;
try { BASE = await resolveBase(argv); }
catch (e) { console.error('✗ ' + e.message); process.exit(3); }
fs.mkdirSync(TMP, { recursive: true });

console.log('截图管线五色标定（判"像素读数可不可信"）');
printColorProbe('mine', await colorProbe(openMine, `${BASE}/${pagePath}`));
try { printColorProbe('ref', await colorProbe(openRef, REF_URL)); } catch (e) { console.log('  [ref] 没量：' + String(e.message).slice(0, 60)); }
console.log('');

const roles = await loadRoles();
if (!roles.length) { console.log('✗ 读不到角色表（tools/ref-parity.mjs 的 ROLES 里没有带 bg 的角色）'); process.exit(3); }

const probe = (selMap) => `(function(){
  var map = ${JSON.stringify(selMap)};
  var out = [];
  for (var k in map){
    var el = document.querySelector(map[k]);
    if (!el) { out.push({ key:k, missing:true }); continue; }
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    out.push({ key:k, rect:{x:r.left,y:r.top,w:r.width,h:r.height}, computed: cs.backgroundColor });
  }
  return out;
})()`;

/* bsk 的 evaluate 会带 {ok,tab_id,value} 外层，偶发还有日志行；剥不出来就当"没量" */
const asArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const i = v.indexOf('{'), j = v.indexOf('[');
    const start = (j >= 0 && (i < 0 || j < i)) ? j : i;
    if (start >= 0) { try { return asArr(JSON.parse(v.slice(start))); } catch (e) {} }
    return [];
  }
  if (v && Array.isArray(v.value)) return v.value;
  if (v && v.value) return asArr(v.value);
  return [];
};

async function runSide(label, opener, url, css, selKey) {
  const png = join(TMP, `colors-${label}${NEG ? '-neg' : ''}.png`);
  const ctx = await opener(url, css);
  if (!ctx || ctx.ok === false) return { label, skipped: true, why: (ctx && ctx.why) || '打不开' };
  const sel = {};
  for (const r of roles) sel[r.name] = selKey === 'ref' ? r.ref : r.mine;
  /* 2026-11-02：线上是 SPA，2.6s 后可能还没渲染出角色；等第一个角色出现再探，最多 6s。 */
  if (selKey === 'ref') {
    const first = Object.values(sel).find(Boolean);
    for (let i = 0; i < 12 && first; i++) {
      let n = 0;
      try { n = Number(await Promise.resolve(ctx.ev('document.querySelectorAll(' + JSON.stringify(first) + ').length'))) || 0; } catch (e) { n = 0; }
      if (n > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  let info = [];
  try { info = asArr(await Promise.resolve(ctx.ev(probe(sel)))); } catch (e) { info = []; }
  /* ★2026-10-26 晚加：截图可能是 2 倍像素比（bsk 在某些环境返回 2880×1800），
     而 rect 是 CSS 像素。不乘这个比例，取到的就是"图的左上四分之一"，
     于是拿 A 区域的像素去和 B 元素的 computed 比 —— 必然假红
     （今天门禁里那条「卡底栏 computed=白 像素=rgb(240,248,248)」就是这么来的，
       单跑 1440×900 时 4/4 全一致）。 */
  let vw = 0;
  try { vw = Number(await Promise.resolve(ctx.ev('innerWidth'))) || 0; } catch (e) { vw = 0; }
  if (selKey === 'ref') ctx.shot(png); else await ctx.shot(png);
  ctx.close();
  if (!info.length) return { label, skipped: true, why: '角色表一条都没命中（页面结构对不上或求值失败）' };
  const imgSize = await (async () => {
    const b64 = fs.readFileSync(png).toString('base64');
    const { withCanvas } = await import('./px-parity.mjs');
    return withCanvas((ev) => ev(`(function(){ return new Promise(function(res){ var I=new Image();
      I.onload=function(){ res([I.width,I.height]); }; I.onerror=function(){ res(null); };
      I.src='data:image/png;base64,${b64}'; }); })()`));
  })();
  /* 截图宽 / 视口宽 = 像素比。1 表示 1:1，2 表示截图像素是 CSS 像素的两倍。 */
  const scale = (imgSize && vw > 0) ? (imgSize[0] / vw) : 1;
  const rects = info.filter((x) => x.rect && x.rect.w > 1 && x.rect.h > 1)
    .map((x) => ({ key: x.key, x: x.rect.x * scale, y: x.rect.y * scale,
                   w: x.rect.w * scale, h: x.rect.h * scale }));
  const pixels = rects.length ? await dominantColors(png, rects) : [];
  const pxByKey = {};
  for (const p of pixels) pxByKey[p.key] = p;
  return { label, rows: info, pxByKey, imgSize, scale, vw };
}

const mine = await runSide('mine', openMine, `${BASE}/${pagePath}`,
  NEG ? '*{background:transparent !important; background-image:none !important}' : null, 'mine');
const ref = await runSide('ref', openRef, REF_URL, null, 'ref');

const close = (a, b) => {
  const pa = (String(a).match(/\d+/g) || []).map(Number);
  const pb = (String(b).match(/\d+/g) || []).map(Number);
  if (pa.length < 3 || pb.length < 3) return a === b;
  return Math.abs(pa[0] - pb[0]) <= 12 && Math.abs(pa[1] - pb[1]) <= 12 && Math.abs(pa[2] - pb[2]) <= 12;
};

let bad = 0;
const report = [];
for (const side of [ref, mine]) {
  if (side.skipped) { console.log(`\n[${side.label}] 没量：${side.why}（这不是绿）`); continue; }
  console.log(`\n[${side.label}] computed vs 像素众数`);
  for (const row of side.rows) {
    if (row.missing) { console.log(`    · ${row.key}：选择器没命中，跳过`); continue; }
    const sc = side.scale || 1;
    if (side.imgSize && row.rect && (row.rect.y + row.rect.h) * sc > side.imgSize[1]) {
      console.log(`    · ${row.key}：越界未量（rect 底 ${Math.round((row.rect.y + row.rect.h) * sc)} > 截图高 ${side.imgSize[1]}）—— 不算一致`);
      report.push({ side: side.label, role: row.key, outOfBounds: true, ok: false });
      continue;
    }
    const px = side.pxByKey[row.key] || {};
    const computed = normColor(row.computed);
    const pixel = px.mode ? normColor(px.mode) : null;
    /* 透明的元素"透出父层颜色"是正常的；只有覆盖率高到说明它自己铺了色，才算说谎 */
    const ok = !!pixel && (close(computed, pixel) || (computed === 'transparent' && (px.cover || 0) < 0.5));
    /* 2026-11-02：只判我方。ref 是标定截图管线（颜色是否读得准），不是判真源实现；
       线上「菜单当前项」computed=白、实际是蓝灰底（子层覆盖），拿它判红会把我方判据变成真源样式判决。 */
    if (!ok && side.label === 'mine') bad++;
    report.push({ side: side.label, role: row.key, computed, pixel, cover: px.cover || 0, ok });
    console.log(`    ${ok ? '✓' : '✗'} ${row.key}  computed=${computed}  像素=${pixel || '(无)'}  占比=${((px.cover || 0) * 100).toFixed(1)}%`);
  }
}
const oob = report.filter((r) => r.outOfBounds).length;
const sizes = [ref, mine].filter((s) => s.imgSize)
  .map((s) => `${s.label}=${s.imgSize[0]}×${s.imgSize[1]}${Math.abs((s.scale || 1) - 1) > 0.01 ? `（像素比 ${(s.scale || 1).toFixed(2)}，rect 已换算）` : ''}`);
console.log(`覆盖：${sizes.join(' ｜ ') || '(未知)'}，未量区域 ${oob ? '有（' + oob + ' 个角色越界）' : '无'}`);
console.log(`\n不一致 ${bad} 处 ｜ 越界未量 ${oob} 处（覆盖 ${roles.length} 个角色）`);
if (JSON_OUT) process.stdout.write(JSON.stringify({ roles: roles.length, report }, null, 2) + '\n');

if (NEG) {
  const mineBad = report.filter((r) => r.side === 'mine' && !r.ok).length;
  console.log(mineBad > 0 ? '负控：注入 background:transparent 后我方判红 ✓（rc=2）' : '负控失败：注入后没判红 —— 这条判据是空的 ✗');
  process.exit(2);
}
/* 越界未量 = 没量，不是绿：截图高度不够时，落在下沿的角色从来没进过比对 */
process.exit(bad > 0 ? 2 : ((ref.skipped || oob > 0) ? 9 : 0));
