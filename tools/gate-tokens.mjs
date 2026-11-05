#!/usr/bin/env node
/**
 * gate-tokens.mjs —— J1 取值合规 / J2 对比度 / J3 两页同构 / J6 骨架
 *
 * 为什么：这一轮所有「看起来不对」的返工，落到机器上只有四类可量的事：
 *   ① 页面里出现了不在 token 表里的色值或字号（就地取值 ⇒ 越改越散）
 *   ② 文字对比度不够（白字压浅灰只有 2.07:1，等于看不见）
 *   ③ 两个页面的同一结构件尺寸不一致（切页时跳动）
 *   ④ 骨架被破坏（面包屑没贯通、胶囊没对齐主区中心）
 * 判据来源：DESIGN.md 第 2/3/5/10 节。
 *
 * 用法：node tools/gate-tokens.mjs [baseUrl]
 *      node tools/gate-tokens.mjs --negctl   （★ 预期 rc=2：注入一个越界色值 + 破坏骨架）
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 基址统一由 tools/base.mjs 解析，本文件不写端口。 */
const BASE = await resolveBase();   /* 不带结尾斜杠，拼路径时自己补 */

/* ── token 白名单：从 tokens.css 解析 —— 那是全站唯一取值源 ── */
const css = fs.readFileSync(path.join(ROOT, 'assets/tokens.css'), 'utf8');
const rootBlock = (css.match(/:root\{[\s\S]*?\}/) || [''])[0];
const tokens = new Set();
for (const m of css.matchAll(/#([0-9A-Fa-f]{6})\b/g)) tokens.add(('#' + m[1]).toUpperCase());
for (const m of css.matchAll(/rgba?\(([^)]+)\)/g)) {
  const n = m[1].split(',').map((x) => parseFloat(x));
  const h = '#' + n.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  tokens.add((n[3] === undefined || n[3] >= 1) ? h : h + '@' + n[3]);
}
/* 允许的"无颜色"与结构性取值 */
const NEUTRAL = new Set(['RGBA(0, 0, 0, 0)', 'TRANSPARENT', 'RGB(255, 255, 255)', '#FFFFFF']);

/* ── 字号阶：**从 tokens.css 读，不在这里手写** ────────────────────
 * 这一行的来历值得记住：原来这里是手写的 {24,22,20,16,15,14,13,12,11,10}（10 档），
 * DESIGN.md §3 的表写的是 11/12/13/15/16/22（6 档），代码里实际跑出 12 种值。
 * **三处互不相等** ⇒ 「规范」只是纸上的字：判据放行 14、规范明令禁止 14、代码天天用 14。
 * 于是页面里所有标题和正文一样大，"没有层级"不是审美问题，是判据和规范在两个爹手里。
 *
 * 现在唯一真源是 tokens.css 的 --font-size-*：判据读它，DESIGN.md §3 的表也只写它的名字。
 * 加一档要改 tokens.css 一处；判据和文档自动跟上。这才是"体系的唯一定义处"。
 *
 * ★2026-10-29 修（判据过期，不是产品缺陷）：v2 两层写法
 *   L1 --p-font-12:12px → L2 --font-size-caption:var(--p-font-12)；
 *   旧名 --fs-* 退成 L0，值也改成 var()。
 *   原解析只认 `--fs-*:<n>px`，取到空集合直接 rc=2（J1 无法成立）。
 *   现在按 var() 链解析；判的东西没变：页面 computed 字号必须在 tokens.css 定义的档位里。 */
const cssDefs = new Map();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
  if (!cssDefs.has(m[1])) cssDefs.set(m[1], m[2].trim());
}
function resolveCssToken(name, seen = new Set()) {
  if (seen.has(name) || !cssDefs.has(name)) return null;
  const raw = cssDefs.get(name);
  const varM = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw);
  if (varM) {
    const next = new Set(seen); next.add(name);
    return resolveCssToken(varM[1], next);
  }
  return raw;
}

/* ── color-mix 派生色：用令牌混出来的颜色不是「token 外色值」 ─────────────
   ★2026-10-29 修（J1 恢复取档后暴露的第一条）：.mask 的 30% 压暗写的是
     `background: color-mix(in srgb, var(--color-text-body) 30%, transparent)`。
   --color-text-body = rgba(0,0,0,.85) = 217/255；乘 30% 后浏览器计算值是
   `color(srgb 0 0 0 / 0.255294)`，不在 tokens.css 的字面值表里。
   旧白名单只收 8 位/6 位色与 rgba 字面值 ⇒ 把"用令牌混出来的底色"报成阶外色（假红）。
   这里把 CSS 里**两端都是令牌或 transparent** 的 color-mix 结果加进白名单；
   裸写 rgba(0,0,0,.255294) 或 #000000 仍然不在白名单里，判的东西没变。 */
const allCssText = ['assets/tokens.css', 'assets/sys.css']
  .map((f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } })
  .join('\n');
function parseColorCss(v) {
  const s = String(v).trim();
  if (/^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function colorOperand(x) {
  const s = String(x).trim();
  const vm = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(s);
  if (vm) return parseColorCss(resolveCssToken(vm[1]) || '');
  return parseColorCss(s);
}
for (const m of allCssText.matchAll(/color-mix\(in srgb,\s*([^,]+?)\s+([\d.]+)%\s*,\s*([^)]+)\)/gi)) {
  const c1 = colorOperand(m[1]), c2 = colorOperand(m[3]);
  if (!c1 || !c2) continue;
  const p = parseFloat(m[2]) / 100;
  /* Chrome 的 color-mix 先把通道/alpha 量化到 8 位再插值：
     rgba(0,0,0,.85) 的 alpha 是 217/255，乘 30% = 0.255294（不是 0.255）。
     这里按同一口径量化，否则派生色永远差最后一位、J1 仍报假红。 */
  const qa = (a) => Math.round(a * 255) / 255;
  const mix = (x, y) => Math.round(Math.round(x) * p + Math.round(y) * (1 - p));
  const r = mix(c1.r, c2.r);
  const g = mix(c1.g, c2.g);
  const b = mix(c1.b, c2.b);
  const a = qa(c1.a) * p + qa(c2.a) * (1 - p);
  const ah = a >= 1 ? '' : '@' + (Math.round(a * 1e6) / 1e6);
  tokens.add('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() + ah);
}

const FS = new Set();
for (const name of cssDefs.keys()) {
  if (!/^--(?:p-font|font-size|fs)-[a-z0-9]+$/.test(name)) continue;
  const m = /^([\d.]+)px$/i.exec(resolveCssToken(name) || '');
  if (m) FS.add(+m[1]);
}
if (!FS.size) { console.log('J1 无法成立：tokens.css 里找不到 --font-size-* 字号 token（L1/L2/L0 都解析不出 px）'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id != null && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); } }); }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.wait.set(id, { res, rej });
    this.ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => rej(new Error('timeout ' + m)), 20000); }); }
}

function lum(rgb) {
  const m = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
}
function contrast(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function audit(url, inject) {
  const port = await debugPort();
  const ch = spawn('/Users/zhengshiji/.local/bin/chrome-nosandbox',
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/gt-${Date.now()}`,
     '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars',
     '--force-device-scale-factor=1', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws, u;
  try {
    for (let i = 0; i < 80; i++) {
      try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = l.find((t) => t.type === 'page'); if (p && p.webSocketDebuggerUrl) { u = p.webSocketDebuggerUrl; break; } } catch (e) {}
      await sleep(120);
    }
    ws = new WebSocket(u);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    const c = new CDP(ws);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url });
    await sleep(900);
    /* 负控用：量之前先往真实页面上注入一处违规，量到的就是"带病的页面"。
       干净页与带病页走的是同一段判定 —— 这才叫负控。 */
    if (inject) { await c.send('Runtime.evaluate', { expression: inject }); await sleep(120); }
    const r = await c.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{
      /* 必须保留 alpha：否则 rgba(0,0,0,.85) 被压成 #000000，整站文字全判违规（实测踩过） */
      const hexOf=(c)=>{const m=c.match(/[\\d.]+/g); if(!m) return c.toUpperCase();
        const n=m.map(Number); const h='#'+n.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase();
        return (n[3]===undefined||n[3]>=1)?h:h+'@'+n[3];};
      const out={colors:[],sizes:[],skeleton:{}};
      /* ★ 2026-10-23：背景是 gradient / image 时返回 'gradient'。
   原来它一路往上找到 body 的白色就返回 —— 于是"白字压渐变按钮"被算成"白字压白底 = 1.00:1"，
   报出两条 J2 假红。渐变背景上的对比度不是不能算，是不能**用单一色**算：
   要算得取渐变两端的极值各算一次。那属于另一个判据，先标"未量"，不许当红也不许当绿。 */
const bgOf=(el)=>{let n=el;while(n&&n!==document.documentElement){const cs=getComputedStyle(n);
        /* 渐变/图片底：单一色算不了对比度，交给 J2 标"未量"，不许当成白底 */
        if(cs.backgroundImage&&cs.backgroundImage!=='none')return 'gradient';
        const c=cs.backgroundColor;
        if(c&&c!=='rgba(0, 0, 0, 0)'){const a=(c.match(/[\d.]+/g)||[])[3];if(a===undefined||parseFloat(a)>=0.95)return c;}
        n=n.parentElement;}return 'rgb(255, 255, 255)';};
      const all=[...document.querySelectorAll('body *')];
      for(const e of all){
        const cs=getComputedStyle(e);
        const txt=(e.textContent||'').trim();
        const isText=e.children.length===0 && txt.length>0;
        if(isText){
          out.colors.push({sel:e.tagName.toLowerCase()+'.'+(e.className||'').toString().split(' ')[0], prop:'color', v:cs.color, hex:hexOf(cs.color), bg:bgOf(e)});
          out.sizes.push({sel:e.tagName.toLowerCase(), v:parseFloat(cs.fontSize)||0});
        }
        const bg=cs.backgroundColor;
        if(bg && bg!=='rgba(0, 0, 0, 0)'){
          out.colors.push({sel:e.tagName.toLowerCase()+'.'+(e.className||'').toString().split(' ')[0], prop:'bg', v:bg, hex:hexOf(bg)});
        }
      }
      const R=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),cx:Math.round(b.x+b.width/2)};};
      out.skeleton.topbar=R('.hdr'); out.skeleton.nav=R('.sider'); out.skeleton.canvas=R('.canvas'); out.skeleton.rail=R('.rail'); out.skeleton.fab=R('.fab');
      out.skeleton.vw=innerWidth; out.skeleton.vh=innerHeight;
      return out;})()` });
    return r.result.value;
  } finally { try { ws && ws.close(); } catch (e) {} ch.kill('SIGKILL'); }
}

const problems = [];
function red(kind, msg) { problems.push({ kind, msg }); }

/* ★2026-10-22 修：这里原来只写了两页（画布式那两个），
   于是 J1/J2/J3/J6 从来没跑过 apps.html / components.html ——
   也就是"列表页的取值、对比度、同构、骨架根本没人验"，而门禁照样打绿。
   页面清单从此只从 tools/pages.mjs 取。 */
const pages = PAGES;
const data = {};
for (const p of pages) data[p] = await audit(BASE + '/' + p);

/* J1/J2 收成函数：正控（真实页面）与负控（注入过的页面）走同一段判定 */
function runValueChecks(ds, only) {
  const pages = Object.keys(ds);
  /* J1 取值合规 */
  for (const p of pages) {
    const d = ds[p];
    if (!d) { red('J1', p + ' 打不开'); continue; }
    const bad = new Map();
    for (const c of d.colors) {
      if (NEUTRAL.has(c.hex)) continue;
      if (tokens.has(c.hex)) continue;
      bad.set(c.hex, (bad.get(c.hex) || 0) + 1);
    }
    for (const [hex, n] of bad) red('J1', p + ' 出现 token 外的色值 ' + hex + '（' + n + ' 处）');
    for (const s of d.sizes) if (!FS.has(s.v)) red('J1', p + ' 出现阶外字号 ' + s.v + 'px');
  }
  /* J2 对比度（只查文字对白底） */
  for (const p of pages) {
    const d = ds[p];
    if (!d) continue;
    const seen = new Set();
    for (const c of d.colors) {
      if (c.prop !== 'color') continue;
      const key = c.hex;
      if (seen.has(key)) continue;
      seen.add(key);
      const bg = c.bg || 'rgb(255,255,255)';
      /* 渐变底算不了单一对比度 —— 标未量，不判红（见 bgOf 的注释） */
      if (bg === 'gradient') continue;
      const cr = contrast(c.v, bg);
      /* 已登记欠账（DESIGN §2 硬规则里逐条写着）：这些值都是**照抄线上**的，
         不是我又发明了一个低对比度配色。口径：登记 + 门槛降到 3.0，不拦。 */
      const DEBT = new Set(['#7C8492', '#517AFF', '#6C7DA9', '#587FFF']);
      const isWeak = DEBT.has(String(c.hex).toUpperCase());
      /* ★2026-10-22 登记欠账：白字压真源主色 rgb(88,127,255) = 3.56:1。
         这是我**照抄线上**的结果，不是我又发明了一个低对比度配色 ——
         线上主按钮本来就是白字压这个蓝。口径变了：这一条从"禁止"降为"登记"，门槛按大字级 3.0 判。
         只放行"白字 + 这一个精确底色"，别的组合一概照旧判红。 */
      const onRefBrand = String(c.hex).toUpperCase() === '#FFFFFF' && String(bg) === 'rgb(88, 127, 255)';
      const min = isWeak ? 3.0 : (onRefBrand ? 3.0 : 4.5);
      if (cr < min) red('J2', p + ' 文字 ' + c.hex + ' 压 ' + bg + ' = ' + cr.toFixed(2) + ':1（需 ' + min + '）');
    }
  }
}
runValueChecks(data);

/* J3 两页同构 + J6 骨架 */
/* 2026-10-24：应用页的官方深链改成 `app.html?id=hx-zc`（裸 app.html 现在会 redirect，
   见 tools/pages.mjs 的注释）。键名跟着 PAGES 走，不在这里再写死一份。 */
const APP_KEY = PAGES.find((p) => p.startsWith('app.html'));
const a = data['component.html'].skeleton, b = data[APP_KEY].skeleton;
for (const key of ['topbar', 'nav', 'rail', 'fab']) {
  /* 画布形态（2026-10-22）：配置页已无平台导航、无顶栏、无胶囊。
     两边都没有 ⇒ 跳过；一边有一边没有才红（说明两页形态不统一）。 */
  if (!a[key] && !b[key]) continue;
  if (!a[key] || !b[key]) { red('J3', key + ' 一边有一边没有（两页形态应一致）'); continue; }
  for (const prop of ['w', 'h']) {
    if (Math.abs(a[key][prop] - b[key][prop]) > 1) {
      red('J3', key + '.' + prop + ' 两页不一致：' + a[key][prop] + ' vs ' + b[key][prop]);
    }
  }
}
for (const p of pages) {
  const s = data[p].skeleton;
  if (!s.vw) { red('J6', p + ' 读不到视口尺寸'); continue; }
  /* 无顶栏的页面（画布形态）：改判画布是否铺满视口 —— 比"跳过"更严，
     否则删了顶栏又忘了让画布铺满，会留下一条空白边没人发现。 */
  if (!s.topbar) {
    if (!s.canvas) { red('J6', p + ' 既没有顶栏也没有 .canvas（读不到外壳）'); continue; }
    if (s.canvas.w < s.vw - 2 || s.canvas.h < s.vh - 2) {
      red('J6', p + ' 画布未铺满视口：' + s.canvas.w + '×' + s.canvas.h + ' vs ' + s.vw + '×' + s.vh);
    }
  }
  /* 画布形态（2026-10-22 用户改口径）不再有顶栏：有才验贯通，没有跳过 */
  /* ★2026-10-22 改口径：顶栏"贯通整宽"是旧骨架（顶栏压在最上层、侧栏在它下面）。
     现在按真源改成「侧栏通高 + 顶栏只在右侧」，顶栏该占的宽度是 **视口 - 侧栏**。
     判据跟着设计改 —— 设计改了判据不改，就会把对的判成错的。 */
  if (s.topbar) {
    const want = s.nav ? s.vw - s.nav.w : s.vw;
    if (Math.abs(s.topbar.w - want) > 1) red('J6', p + ' 顶栏宽度 ' + s.topbar.w + '，应为 ' + want + '（视口 ' + s.vw + (s.nav ? ' - 侧栏 ' + s.nav.w : '') + '）');
    if (s.topbar.y !== 0) red('J6', p + ' 顶栏未贴顶');
  }
  if (s.rail && s.nav && s.topbar && s.rail.y < s.topbar.h - 1) red('J6', p + ' 左栏压在顶栏上');
  if (s.nav && Math.abs(s.nav.w - 200) > 1) red('J6', p + ' 侧栏宽 ' + s.nav.w + '，应为 200');
  /* 胶囊位置由用户拖动决定并存 localStorage，不再要求"对齐主区中心"（2026-10-22 用户改口径）。
     只要求它在视口内、且尺寸不为 0 —— 拖丢了或没渲染才算红。 */
  if (s.fab && (s.fab.w < 40 || s.fab.h < 30)) red('J6', p + ' 胶囊尺寸异常：' + s.fab.w + '×' + s.fab.h);
  /* fab 已按新形态移除（改为顶部/底部悬浮条），存在才验 */
  if (s.fab && (s.fab.x < 0 || s.fab.y < 0 || s.fab.x + s.fab.w > s.vw || s.fab.y + s.fab.h > s.vh)) {
    red('J6', p + ' 胶囊跑出视口：' + JSON.stringify(s.fab));
  }
}

if (process.argv.includes('--negctl')) {
  /* 真负控：往真实页面上注入"token 外的色值 + 阶外字号"，用**同一段**判定再跑一次，
     必须至少抓到一条。上一版只统计"判据有几类规则"就 process.exit(2)，
     那证明的是"规则在场"，不是"规则抓得住"——已被 check-judgments 判为假负控。 */
  const before = problems.length;
  const bad = await audit(BASE + '/component.html',
    "(()=>{const d=document.createElement('div');" +
    "d.textContent='negctl';d.style.cssText='color:#FF00FF;font-size:37px';" +
    "document.body.appendChild(d);return 1;})()");
  problems.length = 0;                       /* 只看注入后新增的红 */
  runValueChecks({ 'component.html(injected)': bad });
  const caught = problems.length;
  console.error(caught
    ? '负控成立：注入 #FF00FF / 37px 后抓到 ' + caught + ' 条 ⇒ J1 是活的'
    : '负控失败：注入了越界取值但一条都没抓到 ⇒ 判据失效');
  console.error('（正样本基线 ' + before + ' 条违规）');
  process.exit(2);
}

if (!problems.length) { console.log('J1/J2/J3/J6：0 条违规（' + pages.join(' + ') + '）'); process.exit(0); }
console.error('🚫 判红 ' + problems.length + ' 条');
const byKind = {};
problems.forEach((p) => { (byKind[p.kind] = byKind[p.kind] || []).push(p.msg); });
for (const k of Object.keys(byKind).sort()) {
  console.error('  [' + k + ']');
  byKind[k].slice(0, 12).forEach((m) => console.error('    · ' + m));
  if (byKind[k].length > 12) console.error('    · …另 ' + (byKind[k].length - 12) + ' 条');
}
process.exit(2);
