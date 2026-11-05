#!/usr/bin/env node
/* check-component-first —— 判「先组件后页面」（2026-10-29 立，机制审查官）
 *
 * 为什么有它：`components.spec.md` 只是一份文档，页面里照样各写一份。盘点读数
 * （2026-10-28）：令牌引用 93.6% 走 L0 旧名；5 页内联 <style> 46,636 B = sys.css 的
 * 50.8%；页面私有类 152 个；按钮/胶囊/输入/表格/菜单各有 2 份以上实现。
 * 现在没有任何一条臂判「这块该复用组件，还是又在页面里抄一份」。
 *
 * 判什么（三条，都是文件级，不启浏览器）：
 *   A 页面内联 <style> 体积：每页各有自己的冻结基线，某页比自己的基线多 1,024 B 即红
 *     （2026-10-29 前是 5 页合计基线，页面级还留 33,419 B 免费额度＝假绿）；
 *     sys.css 占比 30% 是第二阶段目标，到 enforceFrom 后目标线本身判红。
 *   B 页面 <style> 里定义的类，必须在 componentCss（sys/float/xiaozhi/configurator/
 *     generated）里有定义；页面私有类必须进白名单，且每类挂 clear/migrate/renew/
 *     component-debt 之一，到期未清即红。renew 必须写新到期日＋理由；
 *     component-debt 必须指向 C 段已登记债，B 段不重复计红。
 *   C 十三类组件（按钮/胶囊/输入/表格/菜单/列表卡/装配面板/画布块/顶栏/
 *     批量指派/侧栏/内容对照/生成块）的唯一实现必须在登记表里点名，且：
 *     C0 登记表点名的规范小节必须真的在 components.spec.md 里
 *     C1 规范根只许在登记的那个面定义（复制一份到页面即红）
 *     C2 登记的实现点必须真实存在、到期即红（退役也是产出：消失的登记应销账）
 *     C3 表格渲染点按 <table 逐文件计数（多一个即红）
 *     C4 页面里出现组件族类名（btn- 前缀 / tag / chip / kcard / cv-blk / p-* / …），未登记即红
 *
 * 口径（射程到此为止，别当全覆盖）：
 *   · 「内联体积」= 每个页面 <style> 块内文本的 UTF-8 字节；分母是 assets/sys.css。
 *     分母换成「全部组件 CSS」会更好，但本轮沿用盘点口径，便于对照历史读数。
 *   · 「页面私有类」只认出现在选择器位置的 `.cls`（不含 url/值里的 `.xxx`）。
 *     盘点口径 152 是任意 `.foo` 出现；2026-10-29 复测 51 个（历史白名单 144 条，
 *     93 条已不是页面私有类，按 B3 销账）。
 *   · 组件重复只认登记表列出的类名根与页面族名；元素选择器（`.nf-row input`）
 *     按字面量登记，新增写法不在射程。
 *
 * 用法：
 *   node tools/check-component-first.mjs              正控
 *   node tools/check-component-first.mjs --report     结构债读数：现值/目标线/差距
 *   node tools/check-component-first.mjs --json       机器可读（正控结论）
 *   node tools/check-component-first.mjs --selftest   解析器自检（合成样例，不读盘）
 *   node tools/check-component-first.mjs --negctl     十五条负控，各自必须 rc=2
 * 退出码：0 绿（含「债务在宽限内」）｜ 1 未量/负控不成立 ｜ 2 红（负控成立也是 2）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REG_PATH = path.join(HERE, 'component-first.registry.json');

const read = (p) => {
  try { return fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8'); }
  catch { return null; }
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

/* ── 解析器（--selftest 只测这一段）────────────────────────────────── */
function styleText(html) {
  let out = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out += m[1] + '\n';
  return out;
}
/* 只在选择器位置出现的类名：`.x` 之后到 `{` 之间没有 `;` 或 `{}`（排除声明值里的 .xxx） */
function selectorClasses(css) {
  const s = strip(css);
  return new Set([...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)(?=[^;{}]*\{)/g)].map((m) => m[1]));
}
function classDefined(css, name) {
  if (!css) return false;
  return new RegExp('\\.' + esc(name) + '(?![\\w-])(?=[^;{}]*\\{)').test(strip(css));
}
function declNames(text) {
  return new Set([...text.matchAll(/(?:^|[;{\n])\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}
function tokenSets(tokensText) {
  const i0 = tokensText.indexOf('L0 ·');
  const all = declNames(tokensText);
  const l0 = i0 >= 0 ? declNames(tokensText.slice(i0)) : new Set();
  return { all, l0 };
}
function rootsOf(css) {
  const s = strip(css);
  const out = [];
  for (const name of selectorClasses(css)) {
    const re = new RegExp('(^|[},])\\s*\\.' + esc(name) + '\\s*(?::[\\w-]+(\\([^)]*\\))?)?\\s*(,[^{}]*)?\\{', 'gm');
    if (re.test(s)) out.push(name);
  }
  return out;
}
/* 页面族名命中：C4 用；模式来自登记表，坏正则不命中并在 C4p 判红 */
function regexOk(re) {
  try { new RegExp(re); return true; } catch { return false; }
}
function watchHit(patterns, cls) {
  for (const re of patterns || []) {
    if (regexOk(re) && new RegExp(re).test(cls)) return true;
  }
  return false;
}
function planOf(entry) { return entry && Array.isArray(entry.plan) ? entry.plan : []; }
function planGroupFor(entry, cls) {
  const gs = planOf(entry).filter((g) => Array.isArray(g.classes) && g.classes.includes(cls));
  return gs.length === 1 ? gs[0] : null;
}
/* 生效到期日：renew 用新日期；migrate/clear 用组日期回落页面日期；component-debt 交给 C2 */
function planDue(group, entryDue) {
  if (!group) return null;
  if (group.action === 'component-debt') return null;
  if (group.action === 'renew') return isDate(group.to) ? group.to : null;
  const d = group.due || entryDue;
  return isDate(d) ? d : null;
}
function planProblems(entry, wl, compDebtKeys) {
  const out = [];
  const seen = new Set();
  for (const g of planOf(entry)) {
    const action = g.action;
    if (!['clear', 'migrate', 'renew', 'component-debt'].includes(action)) out.push('未知处置 action=' + action);
    if (!Array.isArray(g.classes) || !g.classes.length) out.push('处置组缺 classes');
    for (const c of Array.isArray(g.classes) ? g.classes : []) {
      if (seen.has(c)) out.push('重复处置 ' + c);
      seen.add(c);
    }
    if (action === 'renew') {
      if (!isDate(g.to)) out.push('renew 缺合法新到期日：' + (g.classes || []).join(','));
      else if (isDate(entry.due) && g.to <= entry.due) out.push('renew 新日期未晚于原到期日：' + (g.classes || []).join(','));
      if (!g.why || String(g.why).trim().length < 10) out.push('renew 缺理由：' + (g.classes || []).join(','));
    }
    if (action === 'migrate') {
      if (!g.to) out.push('migrate 缺目标：' + (g.classes || []).join(','));
      if (g.due && !isDate(g.due)) out.push('migrate 到期日不合法：' + (g.classes || []).join(','));
    }
    if (action === 'component-debt') {
      for (const c of Array.isArray(g.classes) ? g.classes : []) {
        if (!compDebtKeys.has(c)) out.push('component-debt 无 C 段登记债：' + c);
      }
    }
  }
  for (const c of wl) if (!seen.has(c)) out.push('白名单类无处置路径：' + c);
  for (const c of seen) if (!wl.includes(c)) out.push('处置了非白名单类：' + c);
  return out;
}

/* ── 读盘成模型（judge 只吃模型，负控改模型）───────────────────────── */
function buildModel(reg) {
  const cache = new Map();
  const get = (p) => {
    const key = p;
    if (!cache.has(key)) cache.set(key, read(p));
    return cache.get(key);
  };
  const pages = {};
  for (const p of reg.surfaces.pages) {
    const html = get(p);
    if (html === null) return { error: '读不到页面 ' + p };
    pages[p] = styleText(html);
  }
  const cssFiles = {};
  for (const f of reg.surfaces.componentCss) {
    const t = get(f);
    if (t === null) return { error: '读不到样式 ' + f };
    cssFiles[f] = t;
  }
  const tokensText = get('assets/tokens.css');
  if (tokensText === null) return { error: '读不到 assets/tokens.css' };
  const spec = get('components.spec.md');
  if (spec === null) return { error: '读不到 components.spec.md' };
  const surfaces = { ...cssFiles, ...pages };
  return { reg, get, pages, cssFiles, tokensText, spec, surfaces };
}

function tokenStats(model, surf = model.surfaces) {
  const { all, l0 } = tokenSets(model.tokensText);
  let total = 0, legacy = 0, unknown = 0;
  const byFile = {};
  for (const [f, css] of Object.entries(surf)) {
    const refs = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    const lg = refs.filter((n) => l0.has(n)).length;
    const un = refs.filter((n) => !all.has(n)).length;
    total += refs.length; legacy += lg; unknown += un;
    byFile[f] = { refs: refs.length, legacy: lg, unknown: un };
  }
  return { total, legacy, unknown, byFile, l0Names: l0.size, allNames: all.size };
}

function inlineStats(model) {
  const perPage = {};
  let total = 0;
  for (const p of Object.keys(model.pages)) {
    const b = bytes(model.pages[p]);
    perPage[p] = b; total += b;
  }
  const sysKey = model.reg.surfaces.componentCss.find((f) => /sys\.css$/.test(f)) || model.reg.surfaces.componentCss[0];
  const sysBytes = bytes(model.cssFiles[sysKey]);
  return { perPage, total, sysBytes, ratio: sysBytes ? total / sysBytes : 0 };
}

function coverageStats(model) {
  const sysKey = model.reg.surfaces.componentCss.find((f) => /sys\.css$/.test(f)) || model.reg.surfaces.componentCss[0];
  const sysCls = selectorClasses(model.cssFiles[sysKey]);
  const specCls = new Set([...model.spec.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
    .filter((c) => !['css', 'js', 'html', 'mjs', 'md', 'png', 'svg', 'json'].includes(c)));
  const covered = [...sysCls].filter((c) => specCls.has(c));
  const roots = rootsOf(model.cssFiles[sysKey]);
  const rootsCovered = roots.filter((c) => specCls.has(c));
  return { sysCls, specCls, covered, total: sysCls.size, roots, rootsCovered };
}

/* ── 家族覆盖率（口径件 _docs/设计-规范覆盖率口径-20261029.spec.md §3）──
   分母＝registry.specCoverage.families 里状态为 spec/must-spec/waived 的家族；
   未登记类＝未量，不默认当布局；排除项单列计数，不匿名消化。 */
function sectionByHeading(spec, title) {
  if (!title) return null;
  const lines = spec.split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === title.trim()) { start = i; break; }
  }
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}
function contractComplete(spec, ref) {
  const sec = sectionByHeading(spec, ref);
  return !!sec && /anatomy|槽位/.test(sec) && /props/i.test(sec) && /状态/.test(sec) && /\.[a-z][\w-]*/i.test(sec);
}
function familyCoverage(model) {
  const sc = model.reg.specCoverage;
  if (!sc || !Array.isArray(sc.families)) return null;
  const scan = (sc.scan && sc.scan.length) ? sc.scan : ['assets/sys.css'];
  const scanCls = new Set();
  for (const f of scan) {
    const t = model.get(f);
    if (t === null) return { error: '读不到扫描面 ' + f };
    for (const c of selectorClasses(t)) scanCls.add(c);
  }
  const byClass = new Map();
  const dup = [];
  for (const fam of sc.families) {
    for (const c of [fam.root, ...(fam.aliases || []), ...(fam.parts || [])]) {
      if (byClass.has(c)) dup.push(c);
      byClass.set(c, fam);
    }
  }
  const exMap = new Map();
  const exCls = {};
  for (const [k, arr] of Object.entries(sc.exclusions || {})) {
    exCls[k] = (arr || []).length;
    for (const c of arr || []) exMap.set(c, k);
  }
  const unregistered = [...scanCls].filter((c) => !byClass.has(c) && !exMap.has(c));
  const active = sc.families.filter((f) => ['spec', 'must-spec', 'waived'].includes(f.status));
  const specd = active.filter((f) => f.status === 'spec' && contractComplete(model.spec, f.specRef));
  const partial = active.filter((f) => f.status === 'spec' && !contractComplete(model.spec, f.specRef));
  const must = active.filter((f) => f.status === 'must-spec');
  const waived = active.filter((f) => f.status === 'waived');
  const D = active.length, N = specd.length;
  return { N, D, ratio: D ? N / D : 0, unregistered, dup, partial, must, waived, scanClasses: scanCls.size, exCls };
}

/* ── 每页内联棘轮（2026-10-29 修假绿）──────────────────────────────
 * 旧口径是「5 页合计 ≤ 61,570 B＋1,024 B」：现盘合计只有 29,175 B，
 * 于是页面级还留着 33,419 B 免费额度 —— 盲审往任一页加 33 KB 仍 rc=0。
 * 现在每页各自锁定基线，某页超过自己的基线＋1,024 B 即红；缺基线单列（新页面必须先冻）。 */
function inlineRatchet(perPage, perPageBaseline, slack) {
  const missing = [], over = [], near = [];
  for (const [p, n] of Object.entries(perPage)) {
    const b = perPageBaseline[p];
    if (typeof b !== 'number') { missing.push(p); continue; }
    if (n > b + slack) over.push({ page: p, bytes: n, baseline: b, delta: n - b });
    else if (n > b) near.push({ page: p, bytes: n, baseline: b, delta: n - b });
  }
  return { missing, over, near };
}

/* ── 判 ──────────────────────────────────────────────────────────── */
function judge(model) {
  const reg = model.reg;
  const surf = { ...model.cssFiles, ...model.pages };   /* 负控改的是 model.pages，判据必须看快照后的合面 */
  const findings = [];
  const red = (code, msg) => findings.push({ level: 'red', code, msg });
  const warn = (code, msg) => findings.push({ level: 'warn', code, msg });
  const ok = (code, msg) => findings.push({ level: 'ok', code, msg });
  const t = today();

  /* A 内联样式：每页各自的棘轮（不再用全局基线） */
  const ins = inlineStats(model);
  const at = reg.targets.inlineStyleRatio;
  const slack = typeof at.slackBytes === 'number' ? at.slackBytes : 1024;
  if (!isDate(at.enforceFrom) || !at.perPageBaseline || typeof at.perPageBaseline !== 'object') {
    red('A0', '登记表 targets.inlineStyleRatio 缺 perPageBaseline/enforceFrom');
  } else {
    const ratchet = inlineRatchet(ins.perPage, at.perPageBaseline, slack);
    const fmt = (x) => x.page + ' ' + x.bytes + ' B（基线 ' + x.baseline + '＋' + slack + '）';
    if (ratchet.missing.length) {
      red('A0', '页面缺本页内联基线，先冻基线再改页面：' + ratchet.missing.join(','));
    }
    if (ratchet.over.length) {
      red('A1p', '页面内联超过本页基线＋' + slack + ' B：' + ratchet.over.map(fmt).join('；'));
    } else if (ratchet.near.length) {
      warn('A1w', '页面内联较本页基线在容差内：' + ratchet.near.map((x) => x.page + ' +' + x.delta + ' B').join(','));
    } else if (!ratchet.missing.length) {
      ok('A1p', '每页内联 ≤ 本页基线（' + Object.keys(ins.perPage).length + ' 页，容差 ' + slack + ' B/页）');
    }
    const stale = Object.keys(at.perPageBaseline).filter((p) => !(p in ins.perPage));
    if (stale.length) warn('A0s', '内联基线有已不存在的页面，可销账：' + stale.join(','));
  }
  /* 30% 占比是第二阶段目标，不是页面级棘轮的替代：比例是合计口径，拦不住单页私货 */
  if (ins.ratio > at.max && t >= at.enforceFrom) {
    red('A1', '内联样式占比 ' + (ins.ratio * 100).toFixed(1) + '% > 目标 ' + (at.max * 100) + '%（宽限已过 ' + at.enforceFrom + '）');
  } else if (ins.ratio > at.max) {
    warn('A1d', '内联样式占比 ' + (ins.ratio * 100).toFixed(1) + '% 超目标 ' + (at.max * 100) + '%，债务宽限至 ' + at.enforceFrom + '（页面级棘轮见 A1p）');
  }

  /* B 页面私有类白名单 */
  /* ★先堵「对象不在射程里」：新页面/新样式层不登记，判据就静默扫不到——这是最上游的假绿 */
  const unregPages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !reg.surfaces.pages.includes(f));
  if (unregPages.length) red('B0', '新页面未登记，判据扫不到：' + unregPages.join(','));
  const allowedCss = new Set([...reg.surfaces.componentCss.map((f) => f.replace(/^assets\//, '')), 'tokens.css']);
  const unregCss = fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.css') && !allowedCss.has(f));
  if (unregCss.length) red('B0', '新样式层未登记：assets/' + unregCss.join(','));
  const compCls = new Set();
  for (const css of Object.values(model.cssFiles)) for (const c of selectorClasses(css)) compCls.add(c);
  /* 页面私有类若已由 C 段登记债管到期，B 段不再重复计红（component-debt 的机器前提） */
  const compDebtByPage = {};
  for (const k of Object.values(reg.components)) {
    for (const d of k.debt || []) {
      if (d.file && d.root) (compDebtByPage[d.file] ||= new Set()).add(d.root);
    }
  }
  let privTotal = 0, privOk = 0;
  for (const p of Object.keys(model.pages)) {
    const entry = reg.pagePrivate[p];
    const priv = [...selectorClasses(model.pages[p])].filter((c) => !compCls.has(c));
    privTotal += priv.length;
    if (!entry) { red('B0', p + ' 没有私有类登记'); continue; }
    if (!isDate(entry.due)) { red('B4', p + ' 的登记缺到期日'); continue; }
    const wl = new Set(entry.classes || []);
    const unreg = priv.filter((c) => !wl.has(c));
    if (unreg.length) red('B1', p + ' 新增页面私有类（未登记）：' + unreg.slice(0, 8).join(',') + (unreg.length > 8 ? ' …共' + unreg.length + '个' : ''));
    const problems = planProblems(entry, [...wl], compDebtByPage[p] || new Set());
    if (problems.length) red('B4p', p + ' 私有类到期处置不完整：' + problems.slice(0, 6).join('；') + (problems.length > 6 ? ' …共' + problems.length + '处' : ''));
    const dueNow = [], soon = [];
    for (const c of priv) {
      const eff = planDue(planGroupFor(entry, c), entry.due);
      if (!eff) continue;   /* component-debt：到期由 C2 负责 */
      if (eff < t) dueNow.push(c + '@' + eff);
      else if (dayDiff(t, eff) <= 14) soon.push(c + '@' + eff);
    }
    if (dueNow.length) red('B2', p + ' 私有类到期未清：' + dueNow.slice(0, 8).join(',') + (dueNow.length > 8 ? ' …共' + dueNow.length + '个' : ''));
    else if (soon.length) warn('B5w', p + ' 私有类处置 ' + soon.length + ' 个将在 14 天内到期：' + soon.slice(0, 6).join(','));
    const stale = entry.classes.filter((c) => !priv.includes(c));
    if (stale.length) warn('B3', p + ' 白名单有 ' + stale.length + ' 条已不是页面私有类，可销账');
    if (!unreg.length && !problems.length && !dueNow.length) privOk++;
  }
  if (privOk === Object.keys(model.pages).length) ok('B', '页面私有类 ' + privTotal + ' 个，全部在白名单且按处置路径未到期');

  /* C 组件唯一实现 */
  const canOk = [];
  if (reg.judgedFamilies && reg.judgedFamilies.judged !== Object.keys(reg.components).length) {
    red('C0', 'judgedFamilies.judged=' + reg.judgedFamilies.judged + ' 与 components 实际 ' + Object.keys(reg.components).length + ' 类不一致');
  }
  for (const [kind, k] of Object.entries(reg.components)) {
    const label = k.label || kind;
    if (k.pageWatch && !Array.isArray(k.pageWatch)) red('C4p', label + ' 的 pageWatch 不是数组');
    for (const re of Array.isArray(k.pageWatch) ? k.pageWatch : []) if (!regexOk(re)) red('C4p', label + ' 的 pageWatch 正则不合法：' + re);
    if (k.specHeading && !model.spec.includes(k.specHeading)) red('C0', label + ' 的规范小节不在 components.spec.md：' + k.specHeading);

    const specRoot = k.specRoot || (k.canonical && k.canonical.root);
    if (specRoot && !model.spec.includes('.' + specRoot)) red('C0', label + ' 的规范未点名 .' + specRoot);
    if (k.canonical) {
      const { root, file } = k.canonical;
      const hits = Object.keys(surf).filter((f) => classDefined(surf[f], root));
      const allowed = new Set([file, ...(k.debt || []).filter((d) => d.root === root).map((d) => d.file)]);
      const extra = hits.filter((f) => !allowed.has(f));
      if (!hits.length) red('C1', label + ' 的唯一实现 .' + root + ' 在盘上找不到（登记 ' + file + '）');
      else if (extra.length) red('C1', label + ' 的唯一实现 .' + root + ' 被复制到：' + extra.join(', ') + '（登记只在 ' + file + '）');
      else canOk.push(label);
    } else if (k.missingCanonicalDue && k.missingCanonicalDue < t) {
      red('C1', label + ' 没有唯一实现，补件到期已过（' + k.missingCanonicalDue + '）');
    } else if (isDate(k.missingCanonicalDue) && dayDiff(t, k.missingCanonicalDue) <= 30) {
      warn('C1w', label + ' 无唯一实现，补件 ' + dayDiff(t, k.missingCanonicalDue) + ' 天后到期（' + k.missingCanonicalDue + '）');
    } else {
      warn('C1d', label + ' 无唯一实现，补件到期 ' + k.missingCanonicalDue);
    }

    for (const d of k.debt || []) {
      if (!d.root && d.mode !== 'literal') continue;   /* 表格按 <table 计数，不走类名债 */
      const raw = model.pages[d.file] !== undefined ? model.pages[d.file] : model.get(d.file);
      let present;
      if (d.mode === 'literal') present = (raw || '').includes(d.literal);
      else present = classDefined(raw, d.root);
      const name = d.mode === 'literal' ? d.literal : '.' + d.root;
      if (!present) { warn('C2s', label + ' 登记债 ' + name + '@' + d.file + ' 已不存在，可销账'); continue; }
      if (!isDate(d.due)) { red('C2d', label + ' 登记债 ' + name + '@' + d.file + ' 缺到期日'); continue; }
      if (d.due < t) red('C2', label + ' 登记债 ' + name + '@' + d.file + ' 到期未清（' + d.due + '）');
      else if (dayDiff(t, d.due) <= 30) warn('C2w', label + ' 登记债 ' + name + '@' + d.file + ' 将于 ' + d.due + ' 到期（' + dayDiff(t, d.due) + ' 天）');
    }

    if (k.pageWatch) {
      for (const p of Object.keys(model.pages)) {
        const owned = new Set((k.debt || []).filter((d) => d.file === p).map((d) => d.root));
        const hits = [...selectorClasses(model.pages[p])].filter((c) => watchHit(k.pageWatch, c));
        const unreg = hits.filter((c) => !owned.has(c) && c !== (k.canonical && k.canonical.root));
        if (unreg.length) red('C4', label + ' 在 ' + p + ' 里又写了一份：' + unreg.slice(0, 6).join(',') + (unreg.length > 6 ? ' …' : ''));
      }
    }
    if ((k.debt || []).length) canOk.push(label + '(' + k.debt.length + '条登记债)');
  }
  /* C3 表格渲染点 */
  const tk = reg.components.table;
  if (tk) {
    const jsFiles = (() => {
      try { return fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js')); }
      catch { return []; }
    })();
    const actual = {};
    for (const f of jsFiles) {
      const t2 = model.get('assets/' + f) || '';
      const n = (t2.match(/<table/gi) || []).length;
      if (n) actual['assets/' + f] = n;
    }
    for (const [f, n] of Object.entries(actual)) {
      const regd = (tk.debt || []).find((d) => d.file === f);
      if (!regd) red('C3', '表格新增渲染点：' + f + ' ×' + n + '（未登记）');
      else if (n > regd.expected) red('C3', '表格渲染点变多：' + f + ' ' + regd.expected + '→' + n);
      else if (n < regd.expected) warn('C3s', '表格渲染点变少：' + f + ' ' + regd.expected + '→' + n + '，可改登记');
    }
    for (const d of tk.debt || []) if (!actual[d.file]) warn('C3s', '表格登记点 ' + d.file + ' 已无 <table，可销账');
  }

  const reds = findings.filter((f) => f.level === 'red');
  return { rc: reds.length ? 2 : 0, findings, readings: { inline: ins, tokens: tokenStats(model, surf), coverage: coverageStats(model), privTotal, kindCount: Object.keys(reg.components).length } };
}

/* ── 输出 ────────────────────────────────────────────────────────── */
function loadReg() {
  const raw = read(REG_PATH);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function printJudge(r) {
  console.log('组件先行判据 @ 90-AI应用方案-会话式配置（文件级，不启浏览器）');
  const ins = r.readings.inline;
  console.log('  A 内联/组件 ' + (ins.ratio * 100).toFixed(1) + '%（' + ins.total + '/' + ins.sysBytes + ' B）');
  console.log('  B 页面私有类 ' + r.readings.privTotal + ' 个');
  console.log('  C 组件唯一实现 ' + r.readings.kindCount + ' 类');
  for (const f of r.findings) {
    const mark = f.level === 'red' ? '✗' : f.level === 'warn' ? '⚠' : '✓';
    console.log('   ' + mark + ' ' + f.code + ' ' + f.msg);
  }
  console.log('\n' + (r.rc === 0 ? '绿（债务在宽限内；读数见 --report）' : '红 ' + r.findings.filter((f) => f.level === 'red').length + ' 条（rc=2）'));
}

function report() {
  const reg = loadReg();
  if (!reg) { console.log('未量：读不到或解析不了 tools/component-first.registry.json'); return 1; }
  const model = buildModel(reg);
  if (model.error) { console.log('未量：' + model.error); return 1; }
  const ts = tokenStats(model);
  const ins = inlineStats(model);
  const cov = coverageStats(model);
  const fam = familyCoverage(model);
  const t = today();
  const pct = (x) => (x * 100).toFixed(1) + '%';
  const legacyRatio = ts.total ? ts.legacy / ts.total : 0;
  const covRootRatio = cov.roots.length ? cov.rootsCovered.length / cov.roots.length : 0;
  const covClsRatio = cov.total ? cov.covered.length / cov.total : 0;
  const tgtLegacy = Math.round(ts.total * reg.targets.legacyTokenRatio.max);
  const tgtInline = Math.round(ins.sysBytes * reg.targets.inlineStyleRatio.max);
  const tgtRoots = Math.ceil(cov.roots.length * reg.targets.specCoverage.min);

  console.log('结构债读数 @ ' + t + '（口径见 tools/check-component-first.mjs 头注释）');
  console.log('旧名引用比例      现值 ' + pct(legacyRatio) + '（' + ts.legacy + '/' + ts.total + ' 条）｜ 目标 ≤' + pct(reg.targets.legacyTokenRatio.max) + '（≤' + tgtLegacy + ' 条）｜ 差距 ' + ((legacyRatio - reg.targets.legacyTokenRatio.max) * 100).toFixed(1) + 'pp，需迁移 ' + (ts.legacy - tgtLegacy) + ' 条');
  console.log('页面内联样式占比   现值 ' + pct(ins.ratio) + '（' + ins.total + '/' + ins.sysBytes + ' B）｜ 目标 ≤' + pct(reg.targets.inlineStyleRatio.max) + '（≤' + tgtInline + ' B）｜ 差距 ' + ((ins.ratio - reg.targets.inlineStyleRatio.max) * 100).toFixed(1) + 'pp，需迁出 ' + Math.max(0, ins.total - tgtInline) + ' B');
  if (!fam) {
    console.log('规范覆盖率（家族口径） 未量：registry 无 specCoverage.families（口径件 _docs/设计-规范覆盖率口径-20261029.spec.md）');
  } else if (fam.error) {
    console.log('规范覆盖率（家族口径） 未量：' + fam.error);
  } else {
    const sc = reg.specCoverage;
    const line = sc.interim || { min: sc.min, due: sc.final && sc.final.due };
    const final = sc.final || { min: 1, due: '-' };
    const short = Math.max(0, Math.ceil(fam.D * line.min) - fam.N);
    console.log('规范覆盖率（家族口径） 现值 ' + pct(fam.ratio) + '（' + fam.N + '/' + fam.D + ' 族）｜ 阶段线 ≥' + pct(line.min) + '（≥' + Math.ceil(fam.D * line.min) + ' 族，到 ' + line.due + '）｜ 终线 ' + pct(final.min) + '（' + fam.D + ' 族，到 ' + final.due + '）｜ 差距 ' + short + ' 族');
    console.log('  分母构成         spec\'d ' + fam.N + '｜must-spec ' + fam.must.length + '｜waived ' + fam.waived.length + '（上限 ' + sc.maxWaived + '）｜排除：merge ' + fam.exCls.merge + '／layout ' + fam.exCls.layout + '／pageScope ' + (fam.exCls.pageScope || 0) + '／未登记 ' + fam.unregistered.length + '（扫描面 ' + fam.scanClasses + ' 类）');
    if (fam.partial.length) console.log('  契约不完整       ' + fam.partial.map((f) => f.id).join(',') + '（anatomy/props/状态/根落点 四缺一即不算 spec\'d）');
    if (fam.must.length) console.log('  待补契约         ' + fam.must.map((f) => f.id + '@' + f.due).join(','));
    if (fam.dup.length) console.log('  重复登记         ' + fam.dup.join(','));
    if (fam.unregistered.length) console.log('  未登记类         ' + fam.unregistered.slice(0, 12).join(',') + (fam.unregistered.length > 12 ? ' …共' + fam.unregistered.length + ' 类' : ''));
  }
  console.log('旧口径（类名根）   现值 ' + pct(covRootRatio) + '（' + cov.rootsCovered.length + '/' + cov.roots.length + ' 组件根；' + pct(covClsRatio) + ' = ' + cov.covered.length + '/' + cov.total + ' 类）｜ 仅供对照，不作判据分母');
  const debts = Object.values(reg.components).reduce((a, k) => a + (k.debt || []).length, 0);
  const pb = reg.targets.inlineStyleRatio.perPageBaseline || {};
  const slack = typeof reg.targets.inlineStyleRatio.slackBytes === 'number' ? reg.targets.inlineStyleRatio.slackBytes : 1024;
  const perPage = Object.keys(ins.perPage).map((p) => p.replace(/\.html$/, '') + ' ' + ins.perPage[p] + '/' + (typeof pb[p] === 'number' ? pb[p] : '未登记')).join(' · ');
  console.log('组件族判据        已登记 ' + Object.keys(reg.components).length + ' 类（C 段；页面里出现族根/部件未登记即红）');
  console.log('附：已登记重复组件实现 ' + debts + ' 条 ｜ 页面私有类 ' + Object.values(reg.pagePrivate).reduce((a, x) => a + x.classes.length, 0) + ' 条（全部有到期处置路径）');
  console.log('页面内联（每页 B）  ' + perPage + ' ｜ 容差 +' + slack + ' B/页（2026-10-29 重冻；合计 ' + ins.total + ' B）');
  console.log('\n目标线怎么定的：');
  console.log('  旧名 ≤10%：' + reg.targets.legacyTokenRatio.why);
  console.log('  内联 ≤30%：' + reg.targets.inlineStyleRatio.why);
  console.log('  覆盖 ≥80%：' + reg.targets.specCoverage.why);
  return 0;
}

/* ── 自检 ────────────────────────────────────────────────────────── */
function selftest() {
  const cases = [];
  const eq = (name, got, want) => cases.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const st = styleText('<div><style>.a{color:red}</style><style>.b{}</style></div>');
  eq('styleText 只取 style 块', st, '.a{color:red}\n.b{}\n');
  eq('styleText 字节', bytes(st), 19);
  eq('selectorClasses 只认选择器位', [...selectorClasses('.a{}.b .c{color:red}.btn-install{}.5em{background:url(x.y.png)}')].sort(), ['a', 'b', 'btn-install', 'c']);
  eq('classDefined 真', classDefined('.x .btn{color:red}', 'btn'), true);
  eq('classDefined 不误伤前缀', classDefined('.btn-install{color:red}', 'btn'), false);
  eq('classDefined 不误伤后缀', classDefined('.cl-desc{color:red}', 'desc'), false);   /* ★2026-11-04 用真实类名，别再引用不存在的 .kbtn */
  const tk = ['/* L1 */', '--a:1;', '/* L0 · 兼容层 */', '--old: var(--a);', '--old2: 2px;'].join('\n');
  const sets = tokenSets(tk);
  eq('tokenSets L0 只取 L0 段', [...sets.l0].sort(), ['--old', '--old2']);
  eq('tokenSets 全量', sets.all.size, 3);
  eq('rootsOf 只认根', rootsOf('.btn{}.btn-i{}.k .btn{}.x:hover{}').sort(), ['btn', 'btn-i', 'x']);
  const comp = new Set([...selectorClasses('.a{}.b{}.c{}')]);
  const priv = [...selectorClasses('.b{}.d{}')].filter((c) => !comp.has(c));
  eq('页面私有类差集', priv, ['d']);
  /* 每页棘轮：+2 KB 必红；恰好 +容差 仍绿；缺基线单列 */
  eq('每页棘轮 +2048 判超', inlineRatchet({ 'a.html': 3048 }, { 'a.html': 1000 }, 1024).over.map((x) => x.page), ['a.html']);
  eq('每页棘轮 恰好 +1024 不判超', inlineRatchet({ 'a.html': 2024 }, { 'a.html': 1000 }, 1024).over.length, 0);
  eq('每页棘轮 +1025 判超', inlineRatchet({ 'a.html': 2025 }, { 'a.html': 1000 }, 1024).over.length, 1);
  eq('每页棘轮 缺基线单列', inlineRatchet({ 'new.html': 1 }, {}, 1024).missing, ['new.html']);
  eq('每页棘轮 不串页（b 超不连累 a）', inlineRatchet({ 'a.html': 1001, 'b.html': 5000 }, { 'a.html': 1000, 'b.html': 1000 }, 1024).over.map((x) => x.page), ['b.html']);
  eq('watchHit 族名命中', watchHit(['^p-[\\w-]+$'], 'p-hd'), true);
  eq('watchHit 不误伤前缀', watchHit(['^p-[\\w-]+$'], 'vl-p-hd'), false);
  eq('watchHit 坏正则不命中', watchHit(['(['], 'p-hd'), false);
  eq('gtable 五类都命中表格族 pageWatch', ['gtable', 'gtable-head', 'gtable-body', 'gtable-row', 'gtable-foot'].every((c) => watchHit(['^gtable(-(head|body|row|foot))?$'], c)), true);
  eq('gtable 不误伤前缀', watchHit(['^gtable(-(head|body|row|foot))?$'], 'xgtable-row'), false);
  eq('regexOk 好正则', regexOk('^p-'), true);
  eq('regexOk 坏正则', regexOk('(['), false);
  eq('planDue renew 取新日期', planDue({ action: 'renew', to: '2027-03-31' }, '2026-11-30'), '2027-03-31');
  eq('planDue migrate 取组日期', planDue({ action: 'migrate', due: '2026-12-31' }, '2026-11-30'), '2026-12-31');
  eq('planDue migrate 回落页面日期', planDue({ action: 'migrate' }, '2026-11-30'), '2026-11-30');
  eq('planDue component-debt 跳过', planDue({ action: 'component-debt' }, '2026-11-30'), null);
  eq('planProblems 全覆盖通过', planProblems({ due: '2026-11-30', plan: [{ action: 'renew', classes: ['x'], to: '2027-03-31', why: '页面单例无复用收益，续期观察' }] }, ['x'], new Set()).length, 0);
  eq('planProblems 缺路径判红', planProblems({ due: '2026-11-30', plan: [] }, ['x'], new Set())[0].includes('无处置路径'), true);
  eq('planProblems component-debt 无债判红', planProblems({ due: '2026-11-30', plan: [{ action: 'component-debt', classes: ['x'] }] }, ['x'], new Set())[0].includes('无 C 段登记债'), true);
  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  got=' + JSON.stringify(c.got) + ' want=' + JSON.stringify(c.want)));
  console.log('\n自检 ' + (cases.length - bad.length) + '/' + cases.length);
  return bad.length ? 1 : 0;
}

/* ── 负控：改模型，不动盘 ────────────────────────────────────────── */
function negctl() {
  const reg = loadReg();
  if (!reg) { console.log('未量：登记表读不到'); return 1; }
  const base = buildModel(reg);
  if (base.error) { console.log('未量：' + base.error); return 1; }
  const run = (name, mutate, wantCode, wantText) => {
    const m = buildModel(reg);
    mutate(m);
    const r = judge(m);
    const hit = r.findings.some((f) => f.level === 'red' && f.code === wantCode && (!wantText || f.msg.includes(wantText)));
    console.log((hit ? '✓ ' : '✗ ') + name + '  rc=' + r.rc + (hit ? '' : '  ← 没红或没命中 ' + wantCode + (wantText ? '/' + wantText : '')));
    return hit;
  };
  const okN = [];
  okN.push(run('N1 任一页加 2 KB 内联 ⇒ 该页 A1p 红', (m) => {
    m.pages['app.html'] += '\n/*' + 'x'.repeat(2048) + '*/\n';
  }, 'A1p', 'app.html'));
  okN.push(run('N1b 页面缺本页基线 ⇒ A0 红（新页面不许绕过棘轮）', (m) => {
    m.reg = JSON.parse(JSON.stringify(m.reg));
    delete m.reg.targets.inlineStyleRatio.perPageBaseline['app.html'];
  }, 'A0', 'app.html'));
  okN.push(run('N2 加一个页面私有类 ⇒ B 红', (m) => { m.pages['versions.html'] += '\n.zz-private-probe{color:red}\n'; }, 'B1'));
  okN.push(run('N3 复制一份按钮实现到页面 ⇒ C 红', (m) => { m.pages['component.html'] += '\n.btn{color:red}\n'; }, 'C1'));
  /* 新增 8 族各一刀：页面里抄一份族根/部件，必须红 */
  okN.push(run('N4 页面里抄 .kcard（盲审例）⇒ C1 红', (m) => { m.pages['app.html'] += '\n.kcard{border:1px solid red}\n'; }, 'C1', '列表卡'));
  okN.push(run('N4b 页面里抄 .cc-body 部件 ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.cc-body{padding:1px}\n'; }, 'C4', '组件卡'));
  okN.push(run('N5 页面里抄装配面板 .p-hd ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.p-hd{padding:1px}\n'; }, 'C4', '装配面板'));
  okN.push(run('N6 页面里抄画布块 .cv-op ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.cv-op{height:1px}\n'; }, 'C4', '画布块'));
  okN.push(run('N7 页面里抄顶栏 .crumb ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.crumb{gap:1px}\n'; }, 'C4', '顶栏'));
  okN.push(run('N8 页面里抄批量指派 .tb-pick ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.tb-pick{padding:1px}\n'; }, 'C4', '批量指派'));
  okN.push(run('N9 页面里抄侧栏 .gt ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.gt{height:1px}\n'; }, 'C4', '侧栏'));
  okN.push(run('N10 页面里抄内容对照 .orig ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.orig{margin:1px}\n'; }, 'C4', '内容对照'));
  okN.push(run('N11 页面里抄生成块 .blk-hd ⇒ C4 红', (m) => { m.pages['app.html'] += '\n.blk-hd{padding:1px}\n'; }, 'C4', '生成块'));
  okN.push(run('N13 页面里抄 .gtable-row（盲审例）⇒ C4 红', (m) => { m.pages['apps.html'] += '\n.gtable-row{padding:1px}\n'; }, 'C4', '表格'));
  okN.push(run('N12 抽掉私有类到期处置 ⇒ B4p 红', (m) => {
    m.reg = JSON.parse(JSON.stringify(m.reg));
    delete m.reg.pagePrivate['component.html'].plan;
  }, 'B4p', 'component.html'));
  const hits = okN.filter(Boolean).length;
  console.log('\n负控命中 ' + hits + '/' + okN.length);
  return hits === okN.length ? 2 : 1;
}

/* ── main ────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) process.exit(selftest());
if (argv.includes('--negctl')) process.exit(negctl());
if (argv.includes('--report')) process.exit(report());
const reg = loadReg();
if (!reg) { console.log('未量：读不到或解析不了 tools/component-first.registry.json'); process.exit(1); }
const model = buildModel(reg);
if (model.error) { console.log('未量：' + model.error); process.exit(1); }
const r = judge(model);
if (argv.includes('--json')) {
  console.log(JSON.stringify({ rc: r.rc, findings: r.findings, readings: { inline: r.readings.inline, tokens: r.readings.tokens, coverage: { total: r.readings.coverage.total, covered: r.readings.coverage.covered.length, roots: r.readings.coverage.roots.length, rootsCovered: r.readings.coverage.rootsCovered.length }, kindCount: r.readings.kindCount, privTotal: r.readings.privTotal } }, null, 2));
} else {
  printJudge(r);
}
process.exit(r.rc);
