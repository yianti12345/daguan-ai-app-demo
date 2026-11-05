#!/usr/bin/env node
/* check-selfcheck —— **判据与脚本自己的自检**（防"同一模式再来一次"）。
 *
 * 为什么有它：今天最贵的两个错，都不是"改错一处"，而是"同一类只修了眼前那一处"：
 *   ① 选择器过期：卡片改结构后 `.kcard-hit` / `.k-meta` 消失了，
 *      我只改了当场撞见的那一个判据，**别的判据还在用旧名字** ——
 *      实测 `.kcard-hit` 仍出现在 3 个文件、`.k-meta` 4 个、`parentNode.querySelector` 2 个。
 *      每留一个，就在某一轮假红一次，而假红的代价是我去查一个不存在的缺陷。
 *   ② bash 函数定义在调用之后：`grp_of` 犯过一次（脚本里还留着注释警告），
 *      今天 `_gate_cost` 又犯一次 —— 而且是我"修复"它的时候又制造出三处。
 *
 * 所以这里不判页面，判**判据自己**：
 *   S1 判据里引用的类名，必须在页面/CSS 里真实存在（否则就是过期选择器）
 *   S2 run-gates.sh 里每个自定义函数，所有调用必须在定义之后
 *   S3 判据脚本之间不许有"同一件事两份实现"的类名（同一 selector 两处定义时提示）
 *
 * S1 的白名单：tools/selector-allow.tsv（类名 \t 理由 \t 由谁覆盖）。
 * 白名单必须写清"为什么这个不存在的类名是对的"，否则下一个人没法判断。
 *
 * 用法：node tools/check-selfcheck.mjs [--negctl]
 * 退出码：0 干净 ｜ 2 有过期选择器或函数顺序错（负控恒 2）｜ 3 读不到源
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NEG = process.argv.includes('--negctl');

let bad = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? '｜' + d : ''}`);
const no = (t, d) => { bad++; console.log(`  ✗ ${t}${d ? '｜' + d : ''}`); };

/* ── S1 选择器有效性 ───────────────────────────────────────────
 * 只查**本项目特有的类名前缀**，不查通用词。
 * 依据：项目类名一律带模块前缀，所以"带前缀 + 页面里不存在"基本只有一种解释 —— 改名了没人跟。 */
const PREFIX = /^\.(k|kc|cl|cc|card|nf|vl|vs|xz|fk|gt|gs|lg|kbtn|crow|kcard|nf)-[a-z0-9-]+$|^\.(kcard|crow|kmenu|kbtn|km|kmi)$/;

function realClasses() {
  const set = new Set();
  const add = (s) => String(s).split(/\s+/).forEach((c) => { if (c) set.add('.' + c); });
  for (const dir of ['assets', '.']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      const full = path.join(abs, f);
      if (!fs.statSync(full).isFile()) continue;
      if (/\.css$/.test(f)) {
        const s = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of s.matchAll(/\.([a-z][a-z0-9-]+)/gi)) set.add('.' + m[1]);
      } else if (/\.html$/.test(f)) {
        const s = fs.readFileSync(full, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const m of s.matchAll(/class="([^"]+)"/g)) add(m[1]);
        for (const m of s.matchAll(/class=\\?"([^"\\]+)/g)) add(m[1]);   /* 模板字符串里的拼接 */
        /* ★2026-10-26 补采集面：页面内的 <style> 也是真源。
           第一版只扫 assets/*.css，于是 versions.html 自己 <style> 里定义的
           .vl-row / .vl-cf / .vl-btn 全被判成"不存在" —— 18 条里 11 条是这种误报。
           判据误报多了就没人看，跟恒红是一回事。 */
        for (const m of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
          for (const mm of m[1].matchAll(/\.([a-z][a-z0-9-]+)/gi)) set.add('.' + mm[1]);
        }
      } else if (/\.js$/.test(f)) {
        /* JS 动态生成的类名（模板字符串 / classList / createElement 后赋 className） */
        const s = fs.readFileSync(full, 'utf8');
        for (const m of s.matchAll(/class="([^"]+)"/g)) add(m[1]);
        for (const m of s.matchAll(/class=\\?"([^"\\]+)/g)) add(m[1]);
        for (const m of s.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) add(m[1]);
        for (const m of s.matchAll(/className\s*=\s*'([^']+)'/g)) add(m[1]);
      }
    }
  }
  return set;
}

const ALLOW_FILE = path.join(HERE, 'selector-allow.tsv');
function allowSet() {
  const set = new Map();
  if (!fs.existsSync(ALLOW_FILE)) return set;
  for (const line of fs.readFileSync(ALLOW_FILE, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [sel, why, by, kind] = line.split('\t');
    if (sel && why && why.trim()) {
      set.set(sel.trim(), { why: why.trim(), by: (by || '').trim(), kind: (kind || 'allow').trim() });
    }
  }
  return set;
}

const real = realClasses();
const allow = allowSet();
const stale = new Map();   /* 类名 → [文件:行] */

/* ★2026-10-28 修（S1 的一类**误报**）：选择器是代码，注释不是。
   原来逐行扫源码，把注释里"上一版用的是 .cl-ver / .cl-ico"这类**说明改名经过**的句子
   也当成"判据还在引用这个类名"。于是 5 条命中全是注释（check-card-uniform / check-list-rows /
   judgments 里记录重锚历史的段落），而真正的过期选择器一条也没有 ——
   一条判据长期红在假因上，等于没人会看它。这里按 check-criteria-lock 的同一套做法先遮罩注释。 */
function commentMask(s) {
  const mask = new Uint8Array(s.length);
  const mark = (a, b) => { for (let i = a; i < b; i++) if (s[i] !== '\n') mask[i] = 1; };
  for (const x of s.matchAll(/\/\*[\s\S]*?\*\//g)) mark(x.index, x.index + x[0].length);
  for (const x of s.matchAll(/<!--[\s\S]*?-->/g)) mark(x.index, x.index + x[0].length);
  for (const x of s.matchAll(/\/\/[^\n]*/g)) mark(x.index, x.index + x[0].length);
  return mask;
}

/* ★2026-10-28 修（负控是空的）：原来 --negctl 只是把**当前盘面**再判一遍，`bad > 0` 就印"负控成立"、
   然后无条件 exit 2 —— 不注入任何东西。于是它永远 rc=2：判据真的失效时，check-judgments 照样读到
   "能红"，因为 2 是写死的。本轮把注释遮罩修好之后盘面变干净，它立刻暴露成"负控失败"。
   现在三支各**真注入**一处（走同一套扫描代码）：
     S1 伪源码行里写一个不存在的类名 .cl-negctlghost
     S2 在 run-gates.sh 首行插一句 `rc 1`（调用早于定义）
     S3 在 run-gates.sh 首行插一句 `echo "$TMP）"`
   三处都必须被判出来，rc=2 才算负控成立；一处没红即 rc=1。 */
const FILES = fs.readdirSync(HERE)
  .filter((x) => /\.mjs$/.test(x) && !/^check-selfcheck/.test(x))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(HERE, f), 'utf8') }));
if (NEG) FILES.push({ name: '__negctl-inject__.mjs', text: 'const ghost = document.querySelector(".cl-negctlghost");\n' });
for (const { name: f, text: raw } of FILES) {
  const mask = commentMask(raw);
  for (const m of raw.matchAll(/\.([a-z][a-z0-9-]{2,})/gi)) {
    if (mask[m.index]) continue;                                 /* 注释里的不算 */
    const lineStart = raw.lastIndexOf('\n', m.index) + 1;
    const lineEnd = raw.indexOf('\n', m.index);
    const lineText = raw.slice(lineStart, lineEnd < 0 ? raw.length : lineEnd);
    if (/selector-allow|PREFIX|白名单/.test(lineText)) continue;  /* 自检脚本自己的白名单表不算 */
    const cls = '.' + m[1];
    if (!PREFIX.test(cls)) continue;
    if (real.has(cls) || allow.has(cls)) continue;
    if (!stale.has(cls)) stale.set(cls, []);
    const at = stale.get(cls);
    if (at.length < 3) at.push(`${f}:${raw.slice(0, m.index).split('\n').length}`);
  }
}

console.log('=== S1 判据里引用的类名是否真实存在 ===');
/* 白名单分两类：allow＝合理例外（真源类名 / 故意的锚点），debt＝确实过期但判据待重写。
   debt 不算红，但必须打印 —— 混进"绿"里就等于假装它不存在。 */
const debts = [...stale].filter(([cls]) => (allow.get(cls) || {}).kind === 'debt');
for (const [cls] of debts) stale.delete(cls);
if (!stale.size) {
  ok('没有新增的过期选择器', `扫了 ${real.size} 个真实类名`);
} else {
  no(`有 ${stale.size} 个类名在页面/CSS 里不存在（判据会假红或量不到）`,
    '每个都可能是"改了结构没跟判据"');
  for (const [cls, at] of stale) console.log(`      ${cls.padEnd(22)} ${at.join(' ')}`);
}
if (debts.length) {
  console.log(`  · 已记账的判据债 ${debts.length} 条（不算红，但要重写）：`);
  for (const [cls, at] of debts) console.log(`      ${cls.padEnd(22)} ${at[0]}  ← ${(allow.get(cls) || {}).by || ''}`);
}

/* ── S2 bash 函数定义顺序 ─────────────────────────────────────
 * 这个坑犯过两次（grp_of、_gate_cost），而 bash 不会报"未定义"，只会打印 command not found 然后继续 ——
 * 脚本照样"跑完"，只是那一步静默失效。 */
console.log('\n=== S2 门禁脚本里的函数定义顺序 ===');
const SH = path.join(HERE, 'run-gates.sh');
if (!fs.existsSync(SH)) {
  console.log('  · 没有 run-gates.sh，跳过');
} else {
  const L = fs.readFileSync(SH, 'utf8').split('\n');
  /* 负控注入：首行插一句 `rc 1`（rc 定义在两百多行之后）—— 必须被判成"调用早于定义"。 */
  if (NEG) L.unshift('  rc 1');
  const defLine = new Map();
  L.forEach((l, i) => { const m = l.match(/^([a-zA-Z_]\w*)\(\)\s*\{/); if (m && !defLine.has(m[1])) defLine.set(m[1], i + 1); });
  const early = [];
  L.forEach((l, i) => {
    const n = i + 1;
    if (/^\s*#/.test(l)) return;
    for (const [fn, d] of defLine) {
      /* 调用形态：fn 空格 参数 / fn; / $(fn ...) */
      const re = new RegExp('(^|[;&|$(]\\s*|\\s)' + fn + '\\s*(["\'\\)$0-9]|$)');
      if (re.test(l) && n < d) early.push({ fn, call: n, def: d });
    }
  });
  if (!early.length) ok('所有自定义函数都在定义之后才被调用', `${defLine.size} 个函数`);
  else {
    no(`有 ${early.length} 处调用早于定义（bash 会打印 command not found 然后继续跑）`,
      early.map((e) => `${e.fn} 调@${e.call} 定义@${e.def}`).join(' ｜ '));
  }
}

/* ── S3 shell 变量名后紧跟非 ASCII ─────────────────────────────
 * 这个 family 今天犯了三次：`$TMP）`、`$GATE_MODE（`、`$CRITRC）`。
 * bash 会把多字节字符的第一个字节吃进变量名，报 unbound variable ——
 * 而 set -u 下它会**直接终止脚本**，看起来像"门禁莫名失败"。
 * 规矩是"变量后面接中文一律写 ${VAR}"，写成散文三天犯三次，
 * 所以现在写成检查：`$VAR` 后面紧跟非 ASCII 字节即红。
 *
 * 依据（failures.tsv 的规矩）：同一 family 第二次复发时，唯一允许的动作是加门禁。 */
console.log('\n=== S3 shell 变量名后紧跟非 ASCII ===');
/* 扫全部 tools/*.sh：原来写死 ['run-gates.sh']，verify-ui.sh 里同一个 bug 就看不见（2026-11-03 实测）。 */
const shFiles = fs.readdirSync(HERE).filter(f => f.endsWith('.sh')).sort();
let mbd = 0;
for (const f of shFiles) {
  const full = path.join(HERE, f);
  if (!fs.existsSync(full)) continue;
  const L = fs.readFileSync(full, 'utf8').split('\n');
  /* 负控注入：首行插一句 `echo "$TMP）"` —— 变量名后紧跟全角括号，必须被判红。 */
  if (NEG) L.unshift('echo "$TMP）"');
  L.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;                     /* 注释里写示例不算 */
    /* $VAR 后面紧跟非 ASCII（含全角括号、中文）——要求写成 ${VAR} */
    const re = /\$([A-Za-z_][A-Za-z0-9_]*)([^\x00-\x7F])/g;
    let m;
    while ((m = re.exec(line))) {
      mbd++;
      console.log(`      ${f}:${i + 1}  $${m[1]}${m[2]}  ← 应写 \${${m[1]}}`);
    }
  });
}
if (!mbd) ok('shell 变量名后没有紧跟非 ASCII 字符', `扫了 ${shFiles.length} 个脚本`);
else no(`有 ${mbd} 处 $VAR 后紧跟非 ASCII（bash 会吃进变量名，set -u 下直接终止）`, '一律写 ${VAR}');

/* ── S4 负控 ───────────────────────────────────────────────── */
if (NEG) {
  /* 三支各注入一处，全部都要红。bad 至少 3 才算负控成立（盘面本来干净时正好是 3）。 */
  const okNeg = bad >= 3;
  console.log(okNeg
    ? `\n负控：注入过期类名 / 函数前置调用 / $VAR 后接中文 三处全部判红 ✓（rc=2，共 ${bad} 处）`
    : `\n负控失败：注入了三处只判出 ${bad} 处 —— 有断言是空的 ✗（rc=1）`);
  process.exit(okNeg ? 2 : 1);
}
console.log(`\n自检问题 ${bad} 处`);
process.exit(bad > 0 ? 2 : 0);
