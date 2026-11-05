#!/usr/bin/env node
/**
 * gate-copy.mjs —— J4 词表反向断言
 *
 * 为什么：组件创建页曾出现「审核」字样，说明这页在按审核场景设计，不是按造零件设计。
 * 词表错是方向错在文案上的投影，不能靠人眼在截图里找。
 *
 * 用法：node tools/gate-copy.mjs            （rc=0 通过 / rc=2 判红）
 *      node tools/gate-copy.mjs --negctl    （★ 预期 rc=2：往临时副本注入禁用词，必须能抓）
 *
 * 判据来源：DESIGN.md 第 8 节。改词表先改那里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* 与 DESIGN.md 第 8 节逐字对应 */
const RULES = {
  /* allow = 属于「被嵌入/被预览对象」的词，不算本页文案（如预览里的应用名） */
  'component.html': {
    deny: ['审核', '应用管理', '客户', '基线', '上架'],
    allow: ['债承审核', '新建审核'],
  },
  'app.html': {
    deny: ['组件库', '基线', '生成组件'],
    allow: [],
  },
};
const COMMON = ['原型', '演示', '示例', '点击查看', '胶囊可点', '可勾选', '可过滤', 'TODO', '待补', '占位数据'];

function visibleText(file) {
  let s = fs.readFileSync(file, 'utf8');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<nav class="sidenav"[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<nav class="crumb"[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<!--[\s\S]*?-->/g, ' ')
       .replace(/<[^>]+>/g, ' ')
       .replace(/&nbsp;/g, ' ')
       .replace(/\s+/g, ' ');
  return s;
}

/* ── 口径台账（2026-11-05 加）─────────────────────────────
   用户说过的每一句"该叫什么/不该出现什么"，落成 tools/copy-ledger.tsv 的两列：
   never（不许再出现）、must（全站必须这么叫）。同一条判据、多一个方向，
   这样"改了一处、另一处照旧"会当场红。 */
function stripForScan(raw, isHtml) {
  let s = raw;
  if (isHtml) {
    s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|\n)(\s*)\/\/[^\n]*/g, '$1$2 ');
  return s;
}
function readLedger(root) {
  const fp = path.join(root, 'tools', 'copy-ledger.tsv');
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 5)
    .map((c) => ({ scope: c[0].trim(), never: (c[1] || '').trim(), must: (c[2] || '').trim(), date: c[3].trim(), why: c[4].trim() }));
}
function runLedger(root) {
  const hits = [];
  const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const assetDir = path.join(root, 'assets');
  const jsFiles = fs.existsSync(assetDir)
    ? fs.readdirSync(assetDir).filter((f) => f.endsWith('.js')).map((f) => 'assets/' + f)
    : [];
  const corpus = {};
  for (const f of htmlFiles.concat(jsFiles)) {
    const raw = fs.readFileSync(path.join(root, f), 'utf8');
    corpus[f] = stripForScan(raw, f.endsWith('.html'));
  }
  const all = Object.values(corpus).join('\n');
  for (const row of readLedger(root)) {
    const scopeFiles = row.scope === '*' ? Object.keys(corpus) : [row.scope];
    if (row.never) {
      for (const f of scopeFiles) {
        if (!(f in corpus)) continue;
        if (corpus[f].includes(row.never)) {
          hits.push({ file: f, word: row.never, note: '口径台账禁止（' + row.date + '：' + row.why + '）' });
        }
      }
    }
    if (row.must && !all.includes(row.must)) {
      hits.push({ file: row.scope, word: row.must, note: '口径台账要求必须出现（' + row.date + '：' + row.why + '）' });
    }
  }
  return hits;
}

function run(root, opts) {
  const hits = [];
  const files = Object.keys(RULES);
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { hits.push({ file: f, word: '(文件缺失)', note: '规则表里的页面不存在' }); continue; }
    let text = visibleText(p);
    for (const a of RULES[f].allow) text = text.split(a).join(' ');
    for (const w of RULES[f].deny) {
      if (text.includes(w)) hits.push({ file: f, word: w, note: '本页禁用词' });
    }
    for (const w of COMMON) {
      if (text.includes(w)) hits.push({ file: f, word: w, note: '全模块禁用词' });
    }
  }
  // 还要检查两页都不许出现的"页面切换器"痕迹：把两个页面拼成一页的历史事故
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    if (/class="[^"]*demo-bar/.test(raw)) hits.push({ file: f, word: 'demo-bar', note: '两页被拼成一页的痕迹' });
    if (/data-nav=/.test(raw)) hits.push({ file: f, word: 'data-nav', note: '页面切换器不该存在于独立页' });
  }
  return hits.concat(runLedger(root));
}

const isNeg = process.argv.includes('--negctl');
if (isNeg) {
  const tmp = fs.mkdtempSync('/tmp/gate-copy-');
  for (const f of Object.keys(RULES)) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  const inject = path.join(tmp, 'component.html');
  fs.writeFileSync(inject, fs.readFileSync(inject, 'utf8').replace('</body>', '<p>审核任务列表 · 示例</p><p>MD 文档</p></body>'));
  const hits = run(tmp, {});
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!hits.length) { console.error('负控失败：注入禁用词后仍判绿 ⇒ 判据是假的'); process.exit(2); }
  console.log('负控通过：抓到 ' + hits.length + ' 条 → ' + hits.map((h) => h.word).join('、'));
  process.exit(2); /* ★ 预期退出码 = 2 */
}

const hits = run(ROOT, {});
if (!hits.length) { console.log('J4 词表：0 条违规'); process.exit(0); }
console.error('🚫 J4 词表违规 ' + hits.length + ' 条');
hits.forEach((h) => console.error('  · ' + h.file + ' 出现「' + h.word + '」（' + h.note + '）'));
process.exit(2);
