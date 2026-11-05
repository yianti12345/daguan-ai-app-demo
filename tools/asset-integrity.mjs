#!/usr/bin/env node
/* asset-integrity —— 代码里出现的**每一条本地资源引用**逐个验真。
 *
 * 主体（这条判据量的是什么）：
 *   4 个页面 HTML（tools/pages.mjs）+ assets 下全部 .css / .js 里出现的本地资源引用。
 *   四类来源都抽：
 *     ① HTML 的 src= / href=
 *     ② CSS 的 url(...)
 *     ③ JS 字符串里拼出来的路径（`'<img src="assets/x.png">'` 这种）
 *     ④ HTML 内联 <script> 里拼出来的路径（同样算"死在字符串里"）
 *
 * 为什么需要它（真事故）：
 *   `assets/app-cover.png` 的引用写在 apps.html 的**内联脚本**里
 *   （`pageStub()` 拼 `style="background-image:url(assets/app-cover.png)"`）。
 *   现有门禁只看 `.html` 的 src/href —— 这个引用它们根本看不见。
 *   文件真丢了也不会报错：浏览器 404，页面只剩一个灰块，而门禁全绿。
 *
 * 判红四种：
 *   · 文件不存在
 *   · 0 字节
 *   · 带 ?v=<hash> 但和文件内容哈希对不上（stamp 失效 = 可能吃到旧缓存）
 *   · 引用了 http(s):// 外链（本地原型不该有；要放行必须在 tools/walk-allow.json 登记）
 *
 * 负控（怎么证明它会红）：
 *   把 assets/app-cover.png 临时改名成 app-cover-NOPE.png（cp 备份 + try/finally 还原），
 *   再跑同一个扫描函数 —— 那个只出现在字符串里的引用必须被抓到。跑完文件必须还原。
 *
 * 用法：
 *   node tools/asset-integrity.mjs            正控（要求 0 条红）
 *   node tools/asset-integrity.mjs --negctl   负控（★ 预期 rc=2，跑完自动还原）
 *   node tools/asset-integrity.mjs --json     机器可读
 *   node tools/asset-integrity.mjs --help
 * 退出码：0 通过 ｜ 2 有红（负控恒为 2）
 *
 * ⚠ 不开浏览器、不需要端口；页面清单从 tools/pages.mjs 取，不许在这里另写一份。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PAGES } from './pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ALLOW_FILE = path.join(HERE, 'walk-allow.json');

const ARGS = process.argv.slice(2);
const HELP = ARGS.includes('--help') || ARGS.includes('-h');
const NEGCTL = ARGS.includes('--negctl');
const AS_JSON = ARGS.includes('--json');

const ASSET_EXT = 'png|jpe?g|svg|webp|gif|ico|css|js|json|woff2?|ttf|otf|mp4|webm';
/* 只在字符串/属性里出现的"裸资源路径"：assets/xxx.ext（后面可能跟 ?v= 或引号） */
/* ★2026-11-02 修假红：结尾必须带边界 (?!…)。原来 ext 组是 js|json，而路径字符集含「.」，
   于是 assets/card-metrics.json 被**前缀匹配**成 assets/card-metrics.js（吃掉了 "on"），
   在 sys.css:2414 判出一条「文件不存在」——那行只是注释里写的文件名。
   负控仍要红：--negctl 改名后必须 rc=2。 */
const BARE = new RegExp('assets/[A-Za-z0-9._@/-]+\\.(?:' + ASSET_EXT + ')(?![A-Za-z0-9._-])', 'g');
const ATTR = /(?:src|href)\s*=\s*"([^"]*)"/g;
const URLF = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;

const EXTERNAL_OK = (() => {
  /* 外链放行口子：walk-allow.json 里以 "external:" 开头的键。文件是别人的，只读。 */
  try {
    const j = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'));
    return new Set(Object.keys(j).filter((k) => k.startsWith('external:')).map((k) => k.slice(9)));
  } catch (e) { return new Set(); }
})();

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

/* ── 扫描：返回 {refs:[…], reds:[…]} ───────────────────────────────
   refs 每条：{ file, line, raw, clean, kind, version } */
function scan() {
  const files = [];
  for (const p of PAGES) if (fs.existsSync(path.join(ROOT, p))) files.push({ rel: p, kind: 'html' });
  const assetsAbs = path.join(ROOT, 'assets');
  for (const f of fs.readdirSync(assetsAbs)) {
    if (/\.(css|js)$/i.test(f)) files.push({ rel: 'assets/' + f, kind: /\.css$/i.test(f) ? 'css' : 'js' });
  }

  const refs = [];
  const seen = new Set();
  const push = (rel, text, raw, idx, kind) => {
    const at = raw.trim();
    /* 模板表达式（' + esc(href) + ' / ${href}）不是路径，跳过 —— 否则会报一堆假红 */
    if (at.includes("'") || at.includes('${') || at.includes('"')) return;
    if (!at || at.startsWith('#') || at.startsWith('data:') ||
        at.startsWith('mailto:') || at.startsWith('javascript:') || at.startsWith('//')) return;
    const key = rel + '|' + at + '|' + idx;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ file: rel, line: lineOf(text, idx), raw: at, kind });
  };

  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f.rel), 'utf8');
    /* ①② HTML 属性 / CSS url() —— 按文件类型各取一种 */
    if (f.kind === 'html') {
      /* <script> 里的"属性"是 JS 拼串，不是 markup；注释里的同理。
         用等长空白替换（不是删除），这样 index 不变、行号依然准。 */
      const markup = text
        .replace(/<script[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length))
        .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
      for (const m of markup.matchAll(ATTR)) push(f.rel, text, m[1], m.index, 'attr');
    } else if (f.kind === 'css') {
      for (const m of text.matchAll(URLF)) push(f.rel, text, m[1], m.index, 'cssurl');
    }
    /* ③④ 任何文件里"死在字符串里"的裸路径（HTML 内联脚本同样覆盖） */
    for (const m of text.matchAll(BARE)) push(f.rel, text, m[0], m.index, f.kind === 'html' ? 'inline' : 'string');
  }

  const reds = [];
  const okRefs = [];
  for (const r of refs) {
    const raw = r.raw;
    if (/^https?:\/\//i.test(raw)) {
      if (!EXTERNAL_OK.has(raw)) reds.push({ ...r, why: '外链（本地原型不该有；要放行在 walk-allow.json 写 external:<url>）' });
      else okRefs.push(r);
      continue;
    }
    /* 解 ?v=hash 与 #frag */
    const hash = (/\?v=([0-9a-f]+)/i.exec(raw) || [])[1] || null;
    const clean = raw.split('?')[0].split('#')[0];
    if (!clean || /^[a-z]+:$/i.test(clean)) { continue; }          /* 纯协议/空 */
    /* ★2026-10-26：解析基准要按**引用所在文件**算。
       CSS 里的 url() 按规范是相对该 CSS 文件解析的；一律相对 ROOT 会把
       url(common_card.png)（正确写法，图在 assets/ 下）判成"文件不存在" ——
       那是判据的口径错，不是引用错。同类：之前只有 html 里的 url(assets/x.png)，
       所以这个 bug 一直没露头。 */
    const baseDir = (r.kind === 'cssurl') ? path.dirname(path.join(ROOT, r.file)) : ROOT;
    const abs = path.resolve(baseDir, clean);
    if (!abs.startsWith(ROOT)) { reds.push({ ...r, why: '指到仓库外' }); continue; }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      reds.push({ ...r, why: '文件不存在' });
      continue;
    }
    if (fs.statSync(abs).size === 0) { reds.push({ ...r, why: '0 字节' }); continue; }
    if (hash && /\.(css|js)$/i.test(clean)) {
      const now = md5(abs);
      if (now !== hash) { reds.push({ ...r, why: '版本号 ' + hash + ' ≠ 内容哈希 ' + now + '（跑 node tools/stamp.mjs）' }); continue; }
    }
    okRefs.push(r);
  }
  return { refs, okRefs, reds, files: files.length };
}

function report(res) {
  const n = res.refs.length;
  if (!res.reds.length) {
    console.log('  ✓ ' + n + ' 条本地资源引用全部落地（' + res.files + ' 个文件：存在 / 非空 / 版本号=内容哈希）');
    return true;
  }
  console.log('  ✗ ' + res.reds.length + ' / ' + n + ' 条引用有问题');
  for (const r of res.reds.slice(0, 15)) {
    console.log('      ' + r.file + ':' + r.line + '  ' + r.raw + '   ' + r.why);
  }
  if (res.reds.length > 15) console.log('      …另 ' + (res.reds.length - 15) + ' 条');
  return false;
}

/* ── 入口 ───────────────────────────────────────────────────────── */
if (HELP) {
  console.log(`asset-integrity —— 代码里所有本地资源引用逐个验真

用法：
  node tools/asset-integrity.mjs            正控（0 条红才 rc=0）
  node tools/asset-integrity.mjs --negctl   负控：临时把 app-cover.png 改名，必须抓到（rc=2，自动还原）
  node tools/asset-integrity.mjs --json     机器可读
  node tools/asset-integrity.mjs --help

抽哪四类：
  ① HTML 的 src= / href=
  ② CSS 的 url(...)
  ③ JS 字符串里拼的 assets/xxx.ext
  ④ HTML 内联 <script> 里拼的 assets/xxx.ext（"死在字符串里"的主力）

判红：文件不存在 / 0 字节 / ?v= 与内容哈希不符 / http(s) 外链未登记
页面清单：tools/pages.mjs（不在这里另写一份）`);
  process.exit(0);
}

if (NEGCTL) {
  /* 负控只动**资源文件本身**（改名），不碰任何页面/代码文件。
     这就是真事故的形态：引用还在，文件没了。
     ★2026-11-02：原来受害者写死成 assets/app-cover.png，而那张图**已经不再被任何页面引用**
     —— 改名后一条红都不可能有，负控永远输出「失败」。判据自己也烂掉了。
     现在改成从**本次真实引用**里挑一个受害者，判据不会因为某张图被删而变成摆设。
     只挑图片/字体/媒体：CSS/JS 是扫描输入，改名会让扫描器自己读不到文件而崩。 */
  const MEDIA = /\.(png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf|mp4|webm)$/i;
  const base = scan();
  const pick = base.okRefs.find((r) => MEDIA.test(r.raw.split('?')[0]));
  if (!pick) {
    console.error('负控前置：本次扫描没有任何媒体引用可当受害者，负控无法成立');
    process.exit(2);
  }
  const relVictim = pick.raw.split('?')[0];
  /* 解析基准必须和 scan() 里一致：CSS url() 是相对该 CSS 文件，不是相对 ROOT。 */
  const baseDir = (pick.kind === 'cssurl') ? path.dirname(path.join(ROOT, pick.file)) : ROOT;
  const victim = path.resolve(baseDir, relVictim);
  const renamedPath = victim.slice(0, victim.lastIndexOf('.')) + '-NOPE' + victim.slice(victim.lastIndexOf('.'));
  let caught = false;
  try {
    fs.renameSync(victim, renamedPath);
    const res = scan();
    report(res);
    caught = res.reds.some((r) => r.raw.split('?')[0] === relVictim && /不存在/.test(r.why));
    console.log('');
    console.log('  受害者：' + relVictim);
    console.log(caught
      ? '负控成立：只把文件改名、引用原样留在字符串里，被「文件不存在」抓到'
      : '负控失败：文件消失后仍判绿 ⇒ 判据是摆设');
  } finally {
    /* 一定要还原：判据可以红，文件不许留在脏状态 */
    try { if (fs.existsSync(renamedPath)) fs.renameSync(renamedPath, victim); } catch (e) {}
  }
  const back = fs.existsSync(victim) && fs.statSync(victim).size > 0;
  console.log('  还原检查：' + relVictim + ' ' + (back ? '已还原 (' + fs.statSync(victim).size + ' 字节)' : '**没还原**'));
  process.exit(2);   /* ★ 负控恒为 2 */
}

const res = scan();
if (AS_JSON) {
  console.log(JSON.stringify({ files: res.files, refs: res.refs.length, ok: res.okRefs.length, reds: res.reds }, null, 1));
} else {
  console.log('\n资源完整性\n');
  report(res);
  console.log('');
  console.log(res.reds.length ? '  FAIL' : '  PASS');
}
process.exit(res.reds.length ? 2 : 0);
