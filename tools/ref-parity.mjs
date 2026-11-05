#!/usr/bin/env node
/* ref-parity —— **把"像不像线上"从我的主观判断，变成一条能跑红的机器判据。**
 *
 * 为什么要有它（这一轮最贵的教训）：
 *   之前 13 项门禁全绿，左侧菜单却和线上完全不是一个形态。原因不是门禁写错了，
 *   而是**这 13 项量的全是我自己定的规范** —— 规范本身偏了，判据只会一起偏。
 *   判据的基准必须来自真源，不能来自我。
 *
 * 做法：
 *   1. 一张「角色映射表」：左边是真源的选择器，右边是我方的选择器。
 *      跨系统 class 名不重叠，所以必须逐个角色写清楚"这两个说的是同一件东西"。
 *   2. bsk 同一会话、同一视口（1440×900）分别打开真源与我方，读同一批属性。
 *   3. 按属性给容差：尺寸 ±1、位置 x ±1、颜色必须等值。
 *      y **不判** —— 页面头结构不同（我们有 H1、线上没有），纵向基线本来就不该一样。
 *
 * 用法：node tools/ref-parity.mjs [我的URL]     默认 GATE_BASE/apps.html（缺省时走 base.mjs 探测）
 *      显式 URL 的端口必须与 GATE_BASE 一致，否则 rc=3 并明说端口不一致
 *      node tools/ref-parity.mjs --json             机器可读
 *      node tools/ref-parity.mjs --force-snapshot   强制走冻结样本（模拟"没有 bsk"）
 * 退出码：0 全部在容差内 ｜ 2 有差异 ｜ 3 环境不可用 ｜ 9 样本过期/缺失（=没量，不是绿）
 *
 * ⚠ 真源需要登录态，所以主路径只能走 bsk（接管用户本人的 Chrome）。
 *   拿不到会话时**不再直接 SKIP**：改走 tools/ref-snapshot.json 的冻结样本，
 *   并且必须自报家门（首行写明"非实时"）—— 用旧样本判绿却不说，就是新的恒绿。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
/* 兜底路径要开本地无头浏览器量我方：基址与调试端口只许从这里取（见 base.mjs 的注释） */
import { debugPort, resolveBase } from './base.mjs';

const BSK = process.env.BSK_BIN || 'bsk';
const REF_URL = process.env.REF_URL || 'http://172.26.26.61:10612/admin/#/AiWriting/AppManage';
/* ★2026-10-29（盲审）：原来这里写死 8941，不读 GATE_BASE —— 门禁跑 8953 时
   「判绿的是 8953，量的是 8941」，两份内容碰巧同值才没露馅。现在一律走
   GATE_BASE > base.mjs，且显式 URL 的端口必须与 GATE_BASE 一致，否则拒绝开跑。 */
const GATE_BASE = (process.env.GATE_BASE || '').replace(/\/$/, '');
const AS_JSON = process.argv.includes('--json');
const NEGCTL = process.argv.includes('--negctl');
const FORCE_SNAP = process.argv.includes('--force-snapshot');
const VIEW = { w: 1440, h: 900 };
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';

function portOf(url) {
  const u = new URL(url);
  return u.port || (u.protocol === 'https:' ? '443' : '80');
}
/* 端口断言：GATE_BASE 在场时，显式 URL 必须和它同端口。不同端口＝量另一份服务，
   即使内容碰巧一样，判绿也没有意义（会掩盖真正的门禁目标）。 */
function assertSamePort(explicit, base) {
  if (!base) return;
  const p = portOf(explicit), bp = portOf(base);
  if (p !== bp) {
    throw new Error('我方 ' + explicit + ' 的端口 ' + p + ' ≠ GATE_BASE ' + base + ' 的端口 ' + bp +
      '（量错服务＝假绿，拒绝开跑；要量另一份就同步改 GATE_BASE）');
  }
}
async function pickMineUrl() {
  const explicit = process.argv.find((a) => /^https?:\/\//.test(a));
  const base = GATE_BASE || (await resolveBase(process.argv.slice(2)));
  if (explicit) { assertSamePort(explicit, base); return explicit; }
  return base.replace(/\/$/, '') + '/apps.html';
}

/* ── 角色映射表：一行 = 一件东西在两边叫什么 ────────────────────────
   加一个角色 = 加一行，不用改逻辑。这是"以后加页面不用改工具"的那一层。 */
/* ⚠⚠ 这张表最容易犯的错：**拿两个不是同一个盒子、或不是同一个状态的东西去比。**
  第一版就踩满了 —— 真源 `aside` 的 computed 底色是深蓝（内层盖住了），
  第一个 submenu 是"未展开未选中"而我方第一个是"当前展开"，
  真源 `li` 的字重 400、真正 600 的是里面那层 span……
  这样比出来的 34 条里大半是假差异。**角色 = 同一个盒子 + 同一个状态。** */
const ROLES = [
  { name: '侧栏整块',      ref: '.bixi-dashboard-layout-menu',                              mine: '.sider', props: ['w','bg'] },   /* bg 必比：真源 aside.ant-layout-sider 是 rgb(0,21,41) 深蓝，被内层这块 rgb(243,244,247) 盖住 —— 事故就出在"量的是 aside、看的是像素" */
  { name: '菜单一级项',    ref: '.ant-menu-submenu:not(.ant-menu-submenu-open):not(.ant-menu-submenu-selected) .ant-menu-submenu-title', mine: '.sider .grp[data-open="false"] .gt', props: ['h','x'] },   /* 二级项不比 w：宽度受组展开状态与侧栏滚动条影响，属结构差异 */
  { name: '菜单二级项',    ref: '.ant-menu-submenu-open .ant-menu-item:not(.ant-menu-item-selected)', mine: '.sider .gs a:not([aria-current])', props: ['h','x'] },
  { name: '菜单当前项',    ref: '.ant-menu-item-selected',                                   mine: '.sider a[aria-current]', props: ['h','bg','color'] },   /* 当前项同上，不比 w */
  { name: '面包屑',        ref: '.ant-breadcrumb',                                           mine: '.crumb', props: ['h'] },
  { name: '面包屑末项',    ref: '.ant-breadcrumb li:last-child',                             mine: '.crumb b:last-of-type', props: ['color'] },
  { name: '主按钮',        ref: '.ant-btn-primary',                                          mine: '.bar .btn.primary', props: ['h','br','bg','color'] },
  { name: '工具条图标钮',  ref: '.ant-btn-icon-only',                                        mine: '.icon-btn', props: ['w','h','br','bd'] },
  { name: '输入框',        ref: 'input[placeholder*="应用名"]',                              mine: '.field input', props: ['h','fs','color'] },
  { name: '卡片',          ref: '.grid > *',                                                 mine: '.grid > *', props: ['w','h','br','bd'] },
  { name: '卡标题',        ref: '.app-title > div',                                          mine: '.kc-title', props: ['fs','fw','color'] },
  { name: '卡描述',        ref: '.app-desc > div',                                           mine: '.kc-desc', props: ['fs','color','lh'] },
  { name: '卡底栏',        ref: 'footer',                                                    mine: '.card-ft', props: ['h','fs','color','bg'] },   /* 真源 footer 自己是 bg-white，白色来自它本身（卡片主体不自绘，见下） */
  { name: '卡底栏图标钮',  ref: '.card-actions-button',                                      mine: '.kc-ops .k-more', props: ['w','h','br','color'] },
  { name: '卡角标',        ref: '.available-app-tag',                                        mine: '.card-tag', props: ['w','h','br','fs','color'] },
];

/* 底色（bg）白名单为什么只有这几条 —— 补 bg 是为了让 px-parity --ref-colors 的
   「computed 底色 ↔ 真实像素」比对有角色可覆盖。但**只能给"自己画底"的元素加**：
     · 侧栏整块 / 卡底栏 / 菜单当前项 / 主按钮：真源这几处 computed backgroundColor 是不透明值，
       且就是它们自己画的 ── 加了才有意义。
     · 面包屑 .ant-breadcrumb、输入框 input[placeholder*="应用名"]（ant-input-borderless）、
       卡片 .grid > *：真源侧 computed 是 rgba(0,0,0,0)，白底来自祖先
       （.bixi-dashboard-layout-content / .bixi-page-container-body-inner）。
       给 transparent 的元素加 bg，computed 与像素**必然**对不上（像素是白的、computed 是透明的），
       只会造出一条永远红的判据 —— 所以这四条不加。卡片要追卡面像素，
       只能在 px-parity 里直接比"卡面中心像素 ↔ 卡面中心像素"，不能在这里比 computed。 */

/* ── 已批准的偏离 ────────────────────────────────────────────
 * 真源有明确值，我方**有意不同**。每条必须写清：为什么、依据、批准日期。
 * 判据不因它们判红，但**照样量、照样打印** —— 偏离不是"看不见"，是"看得见且说得出理由"。
 * 没有这张表时的下场：要么每次都红（然后所有人学会忽略这条判据），
 * 要么把设计改回去（用户明确要求的东西被一句"和真源不一致"推翻）。
 */
const DEVIATION = {
  /* 2026-11-02（本轮整改）：三处卡片角色的我方选择器随卡面改版改名（.card-tt→.kc-title、
     .card-desc→.kc-desc、.icbtn→.kc-ops .k-more）。只改映射、不改样本。
     同日新增两条已批准偏离，理由都是用户裁决过的方向，不是"对不上就豁免"： */
  '卡片|w': { mine: 269, why: '用户 2026-10-23「现在好看的审美一般都不带边框了」⇒ 卡片去 1px 描边（border:0 + 阴影表达边界），外框宽因此 273→269。不是尺寸失控：C6b 仍按卡宽−24 判封面宽度。', since: '2026-11-02' },
  '卡片|h': { mine: 299, why: '同上：去描边后高 303→299。', since: '2026-11-02' },
  '卡底栏图标钮|w': { mine: 32, why: 'CARDMENU ② 要求命中区 ≥32×32（2026-11-02 实测旧值 24×24 判红）；图标钮 24→32 是补可点面积，不是换风格。', since: '2026-11-02' },
  '卡底栏图标钮|h': { mine: 32, why: '同上：24→32。', since: '2026-11-02' },
  '卡底栏图标钮|color': { mine: 'rgba(0, 0, 0, 0.85)', why: '真源 rgb(37,37,36) 在卡底浅灰上 3.1:1；我方统一 --ink-85 后 5.25:1。2026-11-02 同时把静态色从 tertiary(2.23:1，WCAG 不过) 提到 ink-85 —— 这一维以 AA 为准。', since: '2026-11-02' },
  '主按钮|br': { mine: 8, why: '用户 2026-10-23「按钮样式好看一些啊，你看看小智的风格多好看」。真源 2px 在这套画布里显得硬、旧；控件圆角统一到 --r-ctl=8（与输入框、图标钮同档）。', since: '2026-10-23' },
  '工具条图标钮|br': { mine: 8, why: '同上：控件圆角统一 --r-ctl=8。', since: '2026-10-23' },
  /* ★ 2026-10-23 新增：卡底栏的 24px 图标钮。和上面两条同一个理由 ——
     全站按钮圆角统一 8 之后，只剩它还是 2（同一张卡里两种圆角＝没做完）。
     24px 上 2 与 8 的视觉差很明显，所以这里跟着统一，不是"顺手改了"。 */
  '卡底栏图标钮|br': { mine: 8, why: '与主按钮/工具条图标钮同档：控件圆角统一 --r-ctl=8。DESIGN §4.1 图标钮那条。', since: '2026-10-23' },
  '主按钮|bg': { mine: 'rgba(0, 0, 0, 0)', why: '底色改成 linear-gradient(--brand-btn → --brand-btn-hover)，computed backgroundColor 因此透明，像素上仍是品牌蓝。J2 对比度遇到渐变同样标"未量"而不是判红。【2026-10-23 后续：渐变已撤，主按钮改回纯色 --brand-btn，此项保留待下次重采样本时移除】', since: '2026-10-23' },
  '卡角标|br': { mine: 6, why: '真源 4。角标只有 20px 高，4 与 6 在这一尺寸上肉眼无差；而档位表里为 2px 单开一档代价更大 —— 每多一档，写页面的人就多一次选错的机会。2026-10-23 全站字号/圆角收敛时统一到 --r-sm，此处登记为已批准偏离。', since: '2026-10-23' },
  '卡角标|w': { mine: 52, why: '真源 50。同一串「已上架」在两边字体栈下差 2px（真源系统字体 / 我方 Inter + 思源），padding 都是 0 8px。2px 级字宽差不改设计。', since: '2026-10-23' },
  /* ★ 2026-10-28（机制审查官）：侧栏的一级组。
     真源 8 组 23 项；我方按用户原话只留 AI 应用方案 1 组 2 项（应用管理 / 组件库）。
     这条登记的是「折叠态的一级组一个都不剩」这一个具体状态，不是给侧栏开总口子：
     角色选择器是 `.grp[data-open="false"]`，若日后恢复其它模块（出现折叠组），
     本行的 mine 值会从「缺失」变回「有」⇒ 不再匹配 ⇒ 自动重新判红。 */
  '菜单一级项|存在性': { mine: '缺失', why: '用户 2026-10-28 原话「可以，这个demo其实我只需要去做这个ai应用方案模块的功能。」⇒ 侧栏只留本模块 1 组 2 项；本模块那组是展开态，页面上不存在「折叠的一级组」。依据件：开发-侧栏收口-20261028.md（原话＋改前/改后读数 8 组 23 项 → 1 组 2 项）＋ assets/shell.js 的 NAV。未批准任何其它侧栏差异。', since: '2026-10-28' },
  /* ★ 2026-10-28（机制审查官）：卡描述颜色。**只批颜色，不批字号** ——
     同族的 `卡描述|fs`（12 → 14）没有任何决策记录，仍在留红，别把这一行当整组豁免读。 */
  '卡描述|color': { mine: 'rgb(91,108,152)', why: '真源 rgb(108,125,169)：白底 4.08:1（1440 实测 + WCAG 相对亮度公式现算），低于 WCAG 2.2 SC 1.4.3 对正文的 4.5:1；我方 --ink-2 rgba(0,0,0,.65) 白底 6.98:1。照抄真源会与 check-visual-lint 的 AA 判据互相打架（那条会红），所以这一维以 AA 为准、不以真源为准。同一决策链早已记在 assets/tokens.css:286（真源 #98A2B3 2.9:1 ⇒ 加深；--card-ds 4.08 → 5.19:1；tokens.css:330）。', since: '2026-10-28' },
};

/* 这几组**不比高度**：两边内容不一样长（真源描述是 "-"，我方是"客户 · 已装 3 个组件"），
   高度差是内容差，不是样式差。 */
const SKIP_H = new Set(['卡描述', '菜单一级项', '菜单二级项']);

/* 属性容差：数字类按 |a-b| <= tol 判；颜色类必须等值（rgb 归一化后比） */
const NUM_PROPS = [
  { k: 'w', tol: 1 }, { k: 'h', tol: 1 }, { k: 'x', tol: 1 },
  { k: 'fs', tol: 0 }, { k: 'fw', tol: 0 }, { k: 'br', tol: 0 },
];
/* padding 单独比：同样按 4 个分量 ±1 */
const PAD_TOL = 1;

function sh(args) {
  return spawnSync(BSK, args, { encoding: 'utf8' });
}
function sessions() {
  const out = sh(['session', 'list']).stdout || '';
  return out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((x) => x && x !== 'SESSION');
}
/* ⚠ 会话列表里**常有残留的死 id**（列表顺序也不代表新旧）。
   只取最后一个会拿到已经停掉的 id，然后整条判据报 SKIP —— 看起来像"环境问题"，
   实际上是"我挑错了会话"。挨个探活，第一个活着的才是能用的那个。 */
function ensureSession() {
  for (const s of sessions()) {
    const p = sh(['evaluate', '--session', s, '1+1']).stdout || '';
    if (p.includes('2')) return s;
  }
  sh(['session', 'start', '--browser', process.env.DG_BSK_BROWSER || 'f8a0849e']);
  for (let i = 0; i < 5; i++) {
    spawnSync('sleep', ['1'], { encoding: 'utf8' });
    for (const s of sessions()) {
      const p = sh(['evaluate', '--session', s, '1+1']).stdout || '';
      if (p.includes('2')) return s;
    }
  }
  return null;
}

/* 测量用的 JS：两侧共用同一段（只有"角色→选择器"的表不同）。
   抽出来是为了让兜底路径用同一份测量口径，而不是抄一遍再慢慢漂。 */
function buildMeasureJS(pairs) {
  return `JSON.stringify((function(){
    var ROLES = ${JSON.stringify(pairs)};
    var N = function (v) { return Math.round(parseFloat(v) || 0); };
    var H = function (c) {
      c = String(c || '');
      if (c.indexOf('rgb(') === 0) {
        var m = c.match(/[\\d.]+/g) || [];
        return 'rgb(' + m.slice(0, 3).map(function (x) { return Math.round(+x); }).join(',') + ')';
      }
      return c;
    };
    var out = {};
    ROLES.forEach(function (r) {
      var name = r[0], sel = r[1];
      /* 我方这一侧真源那边不存在同名元素是正常的 —— 缺了记 null，由对比阶段判 */
      var e = null;
      try { e = document.querySelector(sel); } catch (err) { e = null; }
      if (!e || !document.body.contains(e)) { out[name] = null; return; }
      var s = getComputedStyle(e), b = e.getBoundingClientRect();
      out[name] = {
        w: N(b.width), h: N(b.height), x: N(b.x),
        fs: N(s.fontSize), fw: N(s.fontWeight),
        br: N(s.borderTopLeftRadius), lh: N(s.lineHeight),
        color: H(s.color), bg: H(s.backgroundColor), bd: H(s.borderTopColor),
        bw: N(s.borderTopWidth),
        pad: String(s.padding)
      };
    });
    return { url: location.href, items: out };
  })())`;
}

/* 在目标页上按角色读属性。返回 { 角色名: props|null } */
function measure(sess, url, inject) {
  sh(['navigate', '--session', sess, 'about:blank']);          /* 强制新文档，避免读到上一页 */
  sh(['navigate', '--session', sess, url]);
  spawnSync('sleep', ['1'], { encoding: 'utf8' });
  /* ★2026-10-30：真源在局域网另一台机器上。全量时 5 路浏览器判据并发，原来固定等 2 秒不够 ——
     页面还没画完就量，结果逐条报「真源 缺失 / 我方 有」，看起来像产品凭空多出一堆东西（假红）。
     改成**等它真画出来**：最多 12 秒，每 400ms 探一次本侧任一角色选择器；超时仍按缺失处理。 */
  /* 探针只认**列表真的渲染出来**的那一个选择器。用「任一角色存在」当信号是错的：
     面包屑先出来、卡片还没出来时就放行，量到的是半渲染页面（实测 8 条假红）。 */
  const probeSel = (ROLES.find((r) => r.name === '卡片') || {}).ref || '';
  if (probeSel) {
    const expr = '(function(){try{return !!document.querySelector(' + JSON.stringify(probeSel) + ')}catch(e){return false}})()';
    for (let i = 0; i < 30; i++) {
      let seen = false;
      try {
        const rr = sh(['evaluate', '--session', sess, '--json', expr]);
        const txt = (rr.stdout || '').trim();
        const outer = JSON.parse(txt);
        const inner = typeof outer.value === 'string' ? JSON.parse(outer.value) : outer;
        seen = !!(typeof inner === 'boolean' ? inner : (inner && inner.value));
      } catch (e) { seen = false; }
      if (seen) break;
      spawnSync('sleep', ['0.4'], { encoding: 'utf8' });
    }
  }
  /* 负控用：量之前往页面里打一段样式，制造一个**确定存在**的差异。
     不这么做，"0 条差异"无法区分"真的对上了"和"根本没读到"。 */
  if (inject) sh(['evaluate', '--session', sess, inject]);
  const js = buildMeasureJS(ROLES.map((r) => [r.name, r.ref]));

  /* 真源与我方用的是同一张映射表，所以这里要按"哪一侧"换选择器：
     传进来的 url 决定用 ref 还是 mine —— 由调用方把表换成对应字段。 */
  const r = sh(['evaluate', '--session', sess, '--json', js]);
  const txt = (r.stdout || '').trim();
  /* ⚠ bsk --json 输出是**缩进过的多行 JSON**（不是一行）。
     按行取"最后一行以 { 开头"会拿到空串 —— 这就是刚才一直 SKIP 的真正原因。整段解析。 */
  try {
    const outer = JSON.parse(txt);
    if (outer.code) return null;                    /* not_found / 会话失效 */
    const inner = typeof outer.value === 'string' ? JSON.parse(outer.value) : outer;
    return (inner && inner.items) || null;
  } catch (e) {
    return null;
  }
}

const pad4 = (s) => String(s || '0px').split(/\s+/).map((v) => Math.round(parseFloat(v) || 0));

/* ⚠ 比较逻辑只有这一份。两条路径（实时真源 / 冻结样本）都调它 ——
   复制一份 = 两套口径，这个项目已经为此返工过四次。 */
function comparePair(roles, a, b) {
  const diffs = [];
  for (const role of roles) {
    /* 每个角色只比它**真的可比**的那几项（props 白名单）。
       没有白名单就全比，是"看起来更严格、其实全是噪音"的典型 —— 第一版 34 条里
       一多半是容器字号、无边框元素的默认描边色、内容长度不同的高度。 */
    const only = new Set(role.props || null);
    const A = a[role.name], B = b[role.name];
    if (!A && !B) continue;
    if (!A || !B) {
      diffs.push({ role: role.name, prop: '存在性', ref: A ? '有' : '缺失', mine: B ? '有' : '缺失', hard: true });
      continue;
    }
    for (const p of NUM_PROPS) {
      if (only && !only.has(p.k)) continue;
      if (p.k === 'h' && SKIP_H.has(role.name)) continue;
      const d = Math.abs((A[p.k] || 0) - (B[p.k] || 0));
      if (d > p.tol) diffs.push({ role: role.name, prop: p.k, ref: A[p.k], mine: B[p.k], hard: true });
    }
    /* border 颜色只在**两边都真的有边框**时才比：没有边框的元素，computed 返回的是默认色，
       拿它比会造出一串"描边不一样"的假差异（第一版 34 条里有 10 条是这么来的）。 */
    if ((!only || only.has('bd')) && A.bw > 0 && B.bw > 0 && String(A.bd) !== String(B.bd)) {
      diffs.push({ role: role.name, prop: 'bd', ref: A.bd, mine: B.bd, hard: true });
    }
    const pa = pad4(A.pad), pb = pad4(B.pad);
    if (!only || only.has('pad')) for (let i = 0; i < 4; i++) {
      if (Math.abs(pa[i] - pb[i]) > PAD_TOL) {
        diffs.push({ role: role.name, prop: 'pad', ref: A.pad, mine: B.pad, hard: true });
        break;
      }
    }
    for (const k of ['color', 'bg']) {
      if (only && !only.has(k)) continue;
      if (String(A[k]) !== String(B[k])) diffs.push({ role: role.name, prop: k, ref: A[k], mine: B[k], hard: true });
    }
  }
  return diffs;
}

/* 主路径（实时真源）仍叫 compare()：语义与实现跟改之前完全一样 */
function compare(a, b) { return comparePair(ROLES, a, b); }

/* 负控注入的样式：主路径与兜底路径共用，保证两条路径证明的是同一件事 */
const NEG_STYLE = "document.head.insertAdjacentHTML('beforeend','<style>.kc-title{font-size:28px!important}.icon-btn{border-radius:12px!important}</style>');'ok'";

/* ── 兜底：没有 bsk 会话时，用 tools/ref-snapshot.json 当基准 ─────────
   三条硬规矩（都是为了不制造新的"恒绿"）：
   ① 首行自报家门：基准来自样本、采于何时、非实时；
   ② 判绿时末行必须写"（对样本，非实时）"，不许让人以为是实时比对的结论；
   ③ 样本缺失/过期 ⇒ rc=9 并明说"这不是绿，是没量"。 */
async function measureMineHeadless(url, injectStyle) {
  const port = await debugPort();
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/refp-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
    '--disable-gpu', `--window-size=${VIEW.w},${VIEW.h}`, '--hide-scrollbars',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = l.find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; break; }
    } catch (e) { /* Chrome 还没起 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!wsUrl) { chrome.kill('SIGKILL'); throw new Error('无头 Chrome 起不来'); }
  const ws = new WebSocket(wsUrl);
  let seq = 0; const wait = new Map();
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error('cdp')) : w.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; wait.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), 20000);
  });
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1600));
    if (injectStyle) await send('Runtime.evaluate', { expression: injectStyle, returnByValue: true });
    const js = buildMeasureJS(ROLES.map((r) => [r.name, r.mine]));
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    const inner = JSON.parse(r.result.value);
    return inner.items || null;
  } finally {
    try { ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
  }
}

async function snapshotFallback() {
  const samplePath = new URL('./ref-snapshot.json', import.meta.url);
  const die9 = (why) => {
    console.error('环境不可用：' + why);
    console.error('这不是绿，是没量 —— 真源没连上、样本也不可用，本轮"像不像线上"完全没有被验证。');
    console.error('  补救：跑 node tools/ref-snapshot.mjs --write（需要线上后台可达）');
    process.exit(9);
  };

  let snap = null;
  try { snap = JSON.parse(fs.readFileSync(samplePath, 'utf8')); }
  catch (e) { die9('没有 bsk 会话，冻结样本也读不到（' + e.message + '）'); }

  const items = Array.isArray(snap.items) ? snap.items : [];
  const at = (snap.meta && snap.meta.generatedAt) || (items[0] && items[0].source && items[0].source.at) || '';
  const t = Date.parse(at);
  if (!items.length || isNaN(t)) die9('冻结样本不可用（空样本或没有采集时间）');
  const days = (Date.now() - t) / 86400000;
  if (days > 30) die9('冻结样本已过期 ' + Math.floor(days) + ' 天（上限 30）');

  /* 我方域名/端口一律从 pickMineUrl 取：显式参数 > GATE_BASE > 自动探测，且端口必须一致 */
  let mineUrl;
  try { mineUrl = await pickMineUrl(); }
  catch (e) { die9(e.message); }

  let mine = null;
  try { mine = await measureMineHeadless(mineUrl, NEGCTL ? NEG_STYLE : null); }
  catch (e) { die9('量我方失败：' + e.message); }
  if (!mine) die9('我方页面读不到（' + mineUrl + '）');

  const refVals = {};
  for (const it of items) refVals[it.role] = it.values;
  const diffs = comparePair(ROLES, refVals, mine);

  const stamp = at.slice(0, 16) + 'Z';
  if (AS_JSON) {
    /* 兜底也给机器可读：否则"有没有真的比"只能靠人读中文，脚本侧没法定 */
    console.log(JSON.stringify({
      basis: 'ref-snapshot.json', realtime: false, sampledAt: at,
      ref: 'ref-snapshot.json', mine: mineUrl, roles: ROLES.length,
      views: [{ w: VIEW.w, h: VIEW.h }], perView: [{ view: VIEW, diffs }]
    }, null, 1));
    if (NEGCTL) {
      const caught = diffs.some((d) => d.role === '卡标题' && d.prop === 'fs')
                  && diffs.some((d) => d.role === '工具条图标钮' && d.prop === 'br');
      process.exit(caught ? 2 : 0);
    }
    const realDiffs = diffs.filter((d) => {
  const k = d.role + '|' + d.prop;
  return !(DEVIATION[k] && String(DEVIATION[k].mine) === String(d.mine));
});
/* 只有**真差异**才判红。已批准偏离照样打印，但不挡门禁 —— 否则门禁会教人忽略它。 */
process.exit(realDiffs.length ? 2 : 0);
  }
  console.log('基准来源：ref-snapshot.json（采于 ' + stamp + '，非实时）');
  console.log('我方 ' + mineUrl);
  console.log('角色 ' + ROLES.length + ' 组 · 断点 ' + VIEW.w + '×' + VIEW.h + '\n');
  if (!diffs.length) console.log('  ' + VIEW.w + '×' + VIEW.h + '  ✓ 全部在容差内（对样本）');
  else {
    console.log('  ' + VIEW.w + '×' + VIEW.h + '  ✗ ' + diffs.length + ' 条（对样本）');
    for (const d of diffs) console.log('      ' + d.role + '  ' + d.prop + '   样本 ' + d.ref + '   我方 ' + d.mine);
  }
  console.log('');

  if (NEGCTL) {
    /* 兜底路径也要自证会红：注入的差异必须被抓到，否则无 bsk 时这条判据是摆设 */
    const caught = diffs.some((d) => d.role === '卡标题' && d.prop === 'fs')
                && diffs.some((d) => d.role === '工具条图标钮' && d.prop === 'br');
    console.log(caught ? '负控成立：注入的差异被抓到了（对样本）' : '负控失败：注入差异后仍判绿 ⇒ 这条判据是假的');
    process.exit(caught ? 2 : 0);
  }
  console.log(diffs.length ? diffs.length + ' 差异（对样本，非实时）' : '0 差异（对样本，非实时）');
  const realDiffs = diffs.filter((d) => {
  const k = d.role + '|' + d.prop;
  return !(DEVIATION[k] && String(DEVIATION[k].mine) === String(d.mine));
});
/* 只有**真差异**才判红。已批准偏离照样打印，但不挡门禁 —— 否则门禁会教人忽略它。 */
process.exit(realDiffs.length ? 2 : 0);
}

/* --force-snapshot：强制走兜底（否则"没有 bsk"这条分支永远测不到） */
let MINE_URL;
try { MINE_URL = await pickMineUrl(); }
catch (e) {
  console.error('✗ 我方 URL 配置错误：' + e.message);
  console.error('这不是绿，是没量 —— 端口不一致时拒绝拿另一份服务冒充门禁目标。');
  process.exit(3);
}
const sess = FORCE_SNAP ? null : ensureSession();
if (!sess) await snapshotFallback();

/* 两边各读一次：真源用 ref 选择器、我方用 mine。
   实现上把 ROLES 临时换成单侧视图 —— 这样逻辑只有一份。 */
function measureSide(sess, url, side, inject) {
  const saved = ROLES.map((r) => r.ref);
  for (let i = 0; i < ROLES.length; i++) ROLES[i].ref = ROLES[i][side];
  const out = measure(sess, url, inject);
  for (let i = 0; i < ROLES.length; i++) ROLES[i].ref = saved[i];
  return out;
}

/* ── 多断点：真源在 2xl(1536) 会从 4 列变 5 列，只量 1440 等于只验了一半。
   视口必须**每个都重设**：emulation 是 per-tab 的，navigate 不重置，但换宽度必须重来。 */
const VIEWS = (() => {
  const hit = process.argv.find((a) => a.startsWith('--views='));
  if (!hit) return [VIEW];
  return hit.split('=')[1].split(',').map((x) => {
    const [w, h] = x.split('x').map(Number);
    return { w: w || 1440, h: h || 900 };
  });
})();

function emulate(sess, v) {
  sh(['emulate', '--session', sess, '--width', String(v.w), '--height', String(v.h)]);
}
emulate(sess, VIEWS[0]);
sh(['navigate', '--session', sess, REF_URL]);
spawnSync('sleep', ['1'], { encoding: 'utf8' });

const perView = [];
for (const v of VIEWS) {
  emulate(sess, v);
  const ref = measureSide(sess, REF_URL, 'ref');
  emulate(sess, v);
  const mine = measureSide(sess, MINE_URL, 'mine', NEGCTL ? NEG_STYLE : null);
  if (!ref || !mine) {
    perView.push({ view: v, error: '有一侧读不到（真源登录态失效或页面没加载）' });
    continue;
  }
  perView.push({ view: v, diffs: compare(ref, mine) });
}

const broken = perView.filter((r) => r.error);
const diffs = perView.flatMap((r) => (r.diffs || []).map((d) => ({ ...d, view: `${r.view.w}×${r.view.h}` })));

if (AS_JSON) {
  console.log(JSON.stringify({ ref: REF_URL, mine: MINE_URL, roles: ROLES.length, views: VIEWS, perView }, null, 1));
} else {
  console.log(`\n真源 ${REF_URL}`);
  console.log(`我方 ${MINE_URL}`);
  console.log(`角色 ${ROLES.length} 组 · 断点 ${VIEWS.map((v) => v.w + '×' + v.h).join(' / ')}\n`);
  for (const r of perView) {
    const tag = `${r.view.w}×${r.view.h}`;
    if (r.error) { console.log(`  ${tag}  SKIP：${r.error}`); continue; }
    if (!r.diffs.length) { console.log(`  ${tag}  ✓ 全部在容差内`); continue; }
    const dev = [], real = [];
    for (const d of r.diffs) {
      const k = d.role + '|' + d.prop;
      if (DEVIATION[k] && String(DEVIATION[k].mine) === String(d.mine)) dev.push(d);
      else real.push(d);
    }
    if (!real.length) {
      console.log(`  ${tag}  ✓ 真差异 0 条（已批准偏离 ${dev.length} 条）`);
      for (const d of dev) console.log(`      ~ ${d.role} ${d.prop}：真源 ${d.ref} / 我方 ${d.mine} —— ${DEVIATION[d.role + '|' + d.prop].why}`);
      continue;
    }
    console.log(`  ${tag}  ✗ 真差异 ${real.length} 条（另有已批准偏离 ${dev.length} 条）`);
    for (const d of real) console.log(`      ${d.role}  ${d.prop}   真源 ${d.ref}   我方 ${d.mine}`);
    for (const d of dev) console.log(`      ~ ${d.role} ${d.prop}：真源 ${d.ref} / 我方 ${d.mine}（已批准）`);
  }
  console.log(`\n差异项：真差异 ${diffs.filter((d) => !(DEVIATION[d.role + '|' + d.prop] && String(DEVIATION[d.role + '|' + d.prop].mine) === String(d.mine))).length} 条 ｜ 已批准偏离 ${diffs.filter((d) => DEVIATION[d.role + '|' + d.prop] && String(DEVIATION[d.role + '|' + d.prop].mine) === String(d.mine)).length} 条`);
}
if (broken.length && !diffs.length) process.exit(3);
if (NEGCTL) {
  /* 负控成立 = 必须真的抓到那两条被注入的差异 */
  const caught = diffs.some((d) => d.role === '卡标题' && d.prop === 'fs')
              && diffs.some((d) => d.role === '工具条图标钮' && d.prop === 'br');
  console.log(caught ? '负控成立：注入的差异被抓到了' : '负控失败：注入差异后仍判绿 ⇒ 这条判据是假的');
  process.exit(caught ? 2 : 0);
}
const realDiffs = diffs.filter((d) => {
  const k = d.role + '|' + d.prop;
  return !(DEVIATION[k] && String(DEVIATION[k].mine) === String(d.mine));
});
/* 只有**真差异**才判红。已批准偏离照样打印，但不挡门禁 —— 否则门禁会教人忽略它。 */
process.exit(realDiffs.length ? 2 : 0);
