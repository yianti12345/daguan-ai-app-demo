#!/usr/bin/env node
/* check-ux-review —— "本产品改完之后，有没有一份**对象对得上**、且晚于它的盲审"。
 *
 * 为什么有这条：用户 2026-10-27 原话「以后所有的页面检查，必须有一个或多个真的建立一个
 * 用户体验师，或者类似的角色，去给我盲审，站在用户的角度、真实业务操作的角度，模拟真实操作路径」。
 * 一句话写在文档里等于没写（当天我写了角色卡、也跑了一次，但那一次没有独立上下文，
 * 判据是我写的、结论是我读的 —— 那是自己当裁判）。所以落成一条机器可判的。
 *
 * ★ 2026-10-27 第二版：第一版只比时间（产品最新 mtime < _reports/ 里任意一份
 *   「盲审/走查/UE」报告的 mtime），当天就产生了假绿：
 *     _reports/盲审-终审-飞象-20261027.md（14:01）第一行写着
 *     「对应产物：深挖-飞象老师-AI搭建逻辑-20261027.md」—— 审的是外部参考站，
 *     却因为文件名以「盲审」开头被当成本产品的复审；而本产品 app.html 11:44 改完、
 *     产品专属评审 11:38 就停了。判据报绿，产品实际没有被复审过。
 *   ⇒ 现在两条都要：①对象对得上 ②时间晚于改动。对不上对象的报告跳过、继续往前找。
 *
 * 判据：
 *   ① 报告发现：_reports/ 下文件名以「盲审 / 走查 / UE」开头的 .md（不是全文含这三个字 ——
 *      _reports/待办-盲审v10-*.md 这种进度清单不是评审）。
 *   ② 对象：报告头部**前 30 行**必须出现本产品标识之一
 *      app.html / component.html / components.html / assets/app.js / assets/sys.css /
 *      应用配置 / 组件配置。标识映射到盘上的产品文件；页面还会把它 <script src>/<link href>
 *      引入的 assets 一并算进覆盖集（评审者看到的是整页）。
 *   ③ 时序：该报告 mtime 必须晚于它所指的那个产品文件（= 全盘最新改动的产品文件）的 mtime。
 *   ④ 找不到合格报告 ⇒ rc=2（不降级成警告）：打印「最近一份报告 X 对应的是 Y，对象不符 /
 *      早于产品改动；缺一份对应 <产品文件> 且晚于 <时间> 的评审」。
 *
 * 它判不了什么（明写，别把它当"已经审好了"的证明）：
 *   · 报告是不是子代理 / 零上下文评审席写的 —— 判不了，只认文件与头部字样；
 *   · 报告作者是否真跑过浏览器、是否只是看了截图 —— 判不了；
 *   · 结论对不对、覆盖全不全 —— 判不了，那只能人判。
 *
 * 口径：rc=0 绿｜rc=2 找不到合格评审（含一份报告都没有）｜rc=3 盘上找不到产品文件（未量）
 * 负控：--selftest 抽象四组（红/绿/无报告/对象不符）；--negctl 复刻 2026-10-27 真实场景。
 */
import { readdirSync, statSync, writeFileSync, mkdirSync, utimesSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const ARGV = process.argv.slice(2);
const SELFTEST = ARGV.includes('--selftest');
const NEGCTL = ARGV.includes('--negctl');

/* 报告发现：文件名前缀。旧版是 /盲审|走查|UE/ 全文匹配，把「待办-盲审v10」这种进度清单也算成评审。 */
const REVIEW_NAME_RE = /^(盲审|走查|UE|ue-blind)/;

/* 报告头部只看前 30 行：声明对象要写在开头，写在正文第 80 行等于没声明。 */
const HEADER_LINES = 30;

/* 本产品标识 → 盘上的产品文件。左边是报告里能写出来的字样，右边是文件。
   「应用配置」是 app.html 的 <title>，「组件配置」是组件配置页的业务名。 */
const IDENT = [
  { id: 'app.html', file: 'app.html' },
  { id: 'component.html', file: 'component.html' },
  { id: 'components.html', file: 'components.html' },
  { id: 'assets/app.js', file: 'assets/app.js' },
  { id: 'assets/sys.css', file: 'assets/sys.css' },
  { id: '应用配置', file: 'app.html' },
  { id: '组件配置', file: 'component.html' },
];

const SKIP_DIR = new Set(['node_modules', '.git']);

function walk(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(p, out);
    } else out.push(p);
  }
  return out;
}

const relOf = (root, p) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p);

/* 产品文件索引：页面 + assets，并记下每个页面加载了哪些 assets。
   页面覆盖它引入的 assets，是因为评审者打开页面时看到的就是这些文件的结果。 */
function index(root) {
  const abs = walk(root).filter((p) =>
    !p.includes('/_reports/') && !p.includes('/tools/') &&
    (/\.html$/.test(p) || /\/assets\/[^/]+\.(js|css)$/.test(p)));
  const rels = new Set(abs.map((p) => relOf(root, p)));
  const deps = new Map();
  for (const p of abs) {
    const r = relOf(root, p);
    if (!/\.html$/.test(r)) continue;
    let src = '';
    try { src = readFileSync(p, 'utf8'); } catch { /* 读不到只算它自己 */ }
    const set = new Set([r]);
    for (const m of src.matchAll(/(?:src|href)="(assets\/[^"?#]+)/g)) {
      if (rels.has(m[1])) set.add(m[1]);
    }
    deps.set(r, set);
  }
  return { rels, deps };
}

function headerOf(p) {
  let s = '';
  try { s = readFileSync(p, 'utf8'); } catch { return ''; }
  return s.split(/\r?\n/).slice(0, HEADER_LINES).join('\n');
}

/* 报告自称"审的是什么"（对应产物 / 被测 / 走查对象…）。失败信息里要引用它。 */
function declaredOf(header) {
  const m = header.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:对应产物|被测对象|被测|评审对象|走查对象|审查对象)\s*[:：]\s*([^\n]+)/);
  return m ? m[1].trim() : '';
}

function objectsOf(header, rels, deps) {
  const out = new Set();
  for (const { id, file } of IDENT) {
    if (!header.includes(id) || !rels.has(file)) continue;
    out.add(file);
    for (const d of deps.get(file) || []) out.add(d);
  }
  return out;
}

function reportsOf(root, rels, deps) {
  return walk(join(root, '_reports'))
    .filter((p) => p.endsWith('.md') && REVIEW_NAME_RE.test(basename(p)))
    .map((p) => {
      let mtimeMs = 0;
      try { mtimeMs = statSync(p).mtimeMs; } catch { /* 刚被删 */ }
      const header = headerOf(p);
      return {
        path: p,
        name: relOf(root, p),
        mtimeMs,
        declared: declaredOf(header),
        objects: objectsOf(header, rels, deps),
      };
    })
    .filter((r) => r.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function judge(root) {
  const R = String(root).replace(/\/+$/, '') || '/';
  const { rels, deps } = index(R);
  if (!rels.size) return { rc: 3, why: '盘上找不到产品文件（*.html / assets/*.js|css）' };

  const files = [...rels]
    .map((r) => ({ rel: r, mtimeMs: statSync(join(R, r)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const F = files[0];

  const reports = reportsOf(R, rels, deps);
  const naming = reports.filter((r) => r.objects.size > 0);
  const covering = naming.filter((r) => r.objects.has(F.rel));
  /* 标识集之外的产品文件（apps.html / versions.html / proposal-wires/*.html）没有可写的标识，
     只能按时间判：任何指名本产品、且晚于它的报告都算 —— 与旧版同强度，不比旧版松。 */
  const identifiable = IDENT.some((x) => x.file === F.rel);
  const pool = identifiable ? covering : naming;
  const qualified = pool.filter((r) => r.mtimeMs > F.mtimeMs);

  const base = {
    product: F,
    files,
    reportCount: reports.length,
    namingCount: naming.length,
    skipped: reports.length - naming.length,
    /* 红绿两条路都要有：绿灯那条也要能报出"跳过了哪份对象不符的" */
    newest: reports[0] || null,
  };
  if (qualified.length) return { ...base, rc: 0, review: qualified[0], identifiable };
  return {
    ...base,
    rc: 2,
    review: null,
    closest: covering[0] || naming[0] || null,
    identifiable,
  };
}

function fmt(ms) {
  /* 用本地时间：toISOString 是 UTC，打印出来会与 mtime 差 8 小时，看的人会以为读数错了 */
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const min = (ms) => Math.round(ms / 60000);

function report(res) {
  const F = res.product;
  if (res.rc === 0) {
    console.log(`✓ 盲审：${res.review.name}（${fmt(res.review.mtimeMs)}）对应 ${F.rel}，晚于产品最新改动（${fmt(F.mtimeMs)}）`);
    if (res.skipped) {
      const n = res.newest;
      console.log(`  · 跳过 ${res.skipped} 份对象不符的报告（最近：${n.name}${n.declared ? ' → ' + n.declared : ''}）`);
    }
    return;
  }
  if (res.rc === 3) {
    console.log(`? 盲审：未量 —— ${res.why}（未量不等于通过）`);
    return;
  }

  console.log('✗ 盲审：找不到「对象对得上 + 晚于产品改动」的评审（rc=2）');
  const n = res.newest;
  if (!n) {
    console.log('  _reports/ 下没有任何以「盲审 / 走查 / UE」开头的报告');
  } else {
    const what = n.declared || '（头部 30 行未写被测对象）';
    let why;
    if (n.objects.size === 0) why = '对象不符（头部 30 行没有本产品标识）';
    else if (!n.objects.has(F.rel)) why = `对象不符（它指的是 ${[...n.objects].slice(0, 3).join('、')}，不是 ${F.rel}）`;
    else why = `早于产品改动 ${min(F.mtimeMs - n.mtimeMs)} 分钟`;
    console.log(`  最近一份报告：${n.name}（${fmt(n.mtimeMs)}）对应的是 ${what}，${why}`);
  }
  const c = res.closest;
  if (c && (!n || c.path !== n.path)) {
    const d = min(F.mtimeMs - c.mtimeMs);
    const miss = c.objects.has(F.rel) ? '' : `；但它指的是 ${[...c.objects].slice(0, 3).join('、')}，不是 ${F.rel}`;
    console.log(`  本产品最近一份评审：${c.name}（${fmt(c.mtimeMs)}），${d > 0 ? `早于产品改动 ${d} 分钟` : '晚于改动'}${miss}`);
  }
  if (res.skipped) console.log(`  另有 ${res.skipped} 份文件名像盲审、但头部 30 行没写本产品的报告，已跳过`);
  console.log(`  缺一份对应 ${F.rel}（${fmt(F.mtimeMs)} 改动）且晚于 ${fmt(F.mtimeMs)} 的评审`);
  console.log('  修法：派零上下文评审者真跑一遍页面，报告落 _reports/盲审-*.md，头部 30 行内写明被测页面（app.html / 应用配置 / 组件配置）');
}

/* ── 负控工具 ─────────────────────────────────────────────── */
function fixture(name) {
  const d = join(tmpdir(), 'ux-review-selftest', name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(join(d, '_reports'), { recursive: true });
  mkdirSync(join(d, 'assets'), { recursive: true });
  return d;
}

/* 本地时间的今天某时某分，转成 utimes 要的秒 */
function at(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function put(dir, rel, text, t) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  utimesSync(p, t, t);
}

function runCases(title, rows) {
  console.log(title);
  let bad = 0;
  for (const [name, want, got] of rows) {
    const ok = want === got;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}：期望 rc=${want}，实测 rc=${got}`);
  }
  console.log(bad ? `✗ ${bad}/${rows.length} 不成立` : `✓ ${rows.length}/${rows.length} 成立`);
  return bad;
}
if (SELFTEST) {
  /* 抽象四组：红 / 绿 / 无报告 / 最新一份对象不符 */
  const d = fixture('selftest');
  put(d, 'app.html', '<title>应用配置</title><script src="assets/app.js"></script>', at(12, 0));
  put(d, 'assets/app.js', '//x', at(12, 0));

  put(d, '_reports/盲审-20260101.md', '# 盲审\n被测：app.html\n', at(11, 0));
  const red = judge(d).rc;

  put(d, '_reports/盲审-20260101.md', '# 盲审\n被测：app.html\n', at(13, 0));
  const green = judge(d).rc;

  rmSync(join(d, '_reports/盲审-20260101.md'));
  const none = judge(d).rc;

  put(d, '_reports/盲审-飞象.md', '对应产物：深挖-飞象老师-AI搭建逻辑-20260101.md\n', at(14, 0));
  const mismatch = judge(d).rc;

  const bad = runCases('负控（抽象四组）', [
    ['红：产品 12:00 改过，评审 11:00（对象对得上）', 2, red],
    ['绿：评审 13:00 晚于产品改动', 0, green],
    ['红：一份报告都没有', 2, none],
    ['红：最新一份 14:00 但对象不符（飞象那种）', 2, mismatch],
  ]);
  process.exit(bad ? 1 : 0);
}

if (NEGCTL) {
  /* 复刻 2026-10-27 真实场景：产品 11:44 改过 / 产品专属评审 11:38 / 外部参考站报告 14:01 最新。
     构造方式：全部落在 /tmp 的 fixture 目录里，用 utimes 把 mtime 摆到当天的那几个时刻，
     不碰盘上任何真实文件、不 touch 产品文件、不伪造 _reports/ 下的报告。 */
  const d = fixture('negctl-real-20261027');
  put(d, 'app.html', '<title>应用配置</title><script src="assets/app.js"></script>', at(11, 44));
  put(d, 'assets/app.js', '//x', at(11, 44));
  put(d, 'components.html', '<title>组件库</title>', at(10, 44));
  put(d, '_reports/盲审-独立-ue-blind.md',
    '# 盲审 · 独立走查（ue-blind）\n\n被测：http://127.0.0.1:8941/app.html?id=hx-zc&mode=view\n', at(11, 38));
  put(d, '_reports/盲审-终审-飞象-20261027.md',
    '对应产物：深挖-飞象老师-AI搭建逻辑-20261027.md（本报告独立完成，未读该文件）\n', at(14, 1));

  const scene = judge(d).rc;

  /* 负控 2：把唯一一份本产品评审拿走，只剩对象不符的飞象报告 —— 也不许绿 */
  rmSync(join(d, '_reports/盲审-独立-ue-blind.md'));
  const onlyAlien = judge(d).rc;

  /* 负控 3：最新一份指名的是别的产品页（components.html），产品改的是 app.html —— 也不许绿 */
  put(d, '_reports/盲审-复审-组件库-20261027.md', '# 盲审 · 复审\n被测：components.html\n', at(11, 50));
  const wrongPage = judge(d).rc;
  rmSync(join(d, '_reports/盲审-复审-组件库-20261027.md'));

  /* 正控：补一份 11:50 指名 app.html 的评审 —— 必须绿（证明它不是恒红） */
  put(d, '_reports/盲审-复审-app-20261027.md', '# 盲审 · 复审\n被测：app.html（应用配置）\n', at(11, 50));
  const good = judge(d).rc;

  const bad = runCases('负控（2026-10-27 真实场景）', [
    ['场景：产品 11:44 改过 / 产品评审 11:38 / 飞象报告 14:01 最新 ⇒ 必须红', 2, scene],
    ['场景：拿走 11:38 的产品评审、只剩飞象报告 ⇒ 必须红', 2, onlyAlien],
    ['场景：最新一份审的是 components.html，改的是 app.html ⇒ 必须红', 2, wrongPage],
    ['正控：补一份 11:50 对应 app.html 的评审 ⇒ 必须绿', 0, good],
  ]);
  /* 与仓内同族一致（check-edit-unit 的「--negctl 预期也是 2」）：
     负控成立时退出码就是它证明的那个红，2 —— 别把这个 2 读成"判据失败"。
     有一条断言不成立 ⇒ 1（负控本身塌了）。 */
  console.log(bad ? '✗ 负控不成立' : '✓ 负控成立 ⇒ 退出码 2 就是它证明的那个红（不是判据失败）');
  process.exit(bad ? 1 : 2);
}

const res = judge(process.cwd());
report(res);
process.exit(res.rc);
