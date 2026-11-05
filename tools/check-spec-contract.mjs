#!/usr/bin/env node
/* check-spec-contract —— 「组件规范是不是纸」判据（2026-10-28 立）
 *
 * 为什么有它：`components.spec.md` 写了 12 类组件的 anatomy / props / 唯一实现，
 * 但没有任何东西检查"盘上是不是真长这样"。独立盲审 BLIND-PRODUCT-20261028-01 第 12 条
 * 原话：`DESIGN.md`/`components.spec.md` 作为契约是否成立，**未量**。
 * 规范没有判据咬住 = 谁都可以说"我是按另一份来的"。
 *
 * 判什么（三条，都只读文件）：
 *   S1 规范里点名的每个组件类名，CSS 里必须真有定义（否则规范指向不存在的实现）
 *   S2 规范声明"唯一实现"的类名，在 CSS 里不许被重复定义（同一选择器出现在 ≥2 处）
 *   S3 每类组件的 props 表里，boolean 行 ≤ 1（规范自己写的三条 props 规则第 1 条）
 *
 * 用法：
 *   node tools/check-spec-contract.mjs              正控
 *   node tools/check-spec-contract.mjs --negctl     负控：注入三类坏法，每条都必须红
 * 退出码：0 绿 ｜ 1 未量（规范件读不到/解析出 0 类）｜ 2 红
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE + '/../';
const SPEC = ROOT + 'components.spec.md';
const CSS_FILES = ['assets/sys.css', 'assets/float.css', 'assets/xiaozhi.css', 'assets/configurator.css', 'assets/viewmode.css'];

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* 从规范里取组件小节：`## N 名称（.cls）` 或 `## N 名称 Chips`。
   ★2026-10-29：原来写死 `no >= 1 && no <= 12`。PickRow 从 §8 挪到 §15 后掉出射程，
   判据照样 rc=0 并打印「解析 12 类」——一类组件静默脱靶，绿色的那份不会提醒人。
   现在不写死上限，改用「有没有主类名」筛：没有主类名的章节（概述/变更记录）自然跳过。 */
function parseSpec(md) {
  const out = [];
  const blocks = md.split(/\n(?=## )/);
  for (const b of blocks) {
    const head = b.match(/^## (\d+) ([^\n（(]+)[（(]?([^）)\n]*)[）)]?/);
    if (!head) continue;
    const no = Number(head[1]);
    if (!(no >= 1)) continue;
    const body = b;
    const impl = (body.match(/\*\*现状实现\*\*：([^\n]+)/) || [, ''])[1];
    /* 类名：从「现状实现」那一行里取 .foo / .foo.bar，以及标题括号里的 */
    const cls = new Set();
    for (const m of impl.matchAll(/\.([a-z][a-z0-9-]{1,24})/g)) {
      if (m[1] === 'css' || m[1] === 'js' || m[1] === 'html') continue;  /* 「sys.css:118」不是类名 */
      cls.add(m[1]);
    }
    for (const m of head[3].matchAll(/\.([a-z][a-z0-9-]{1,24})/g)) cls.add(m[1]);
    /* props 表里 boolean 行数：只看**类型列**（第 2 列）。
       ★2026-10-29：原来按"整行里出现 boolean/disabled 字样"计数，于是
       `assignee | 人名（radio 值） | 未选时「确定」disabled` 这类说明列里提到 disabled 的
       普通 prop 被误判成第二个布尔（假红）。判"这一列的类型是不是 boolean"，不是判"这一行提没提到布尔"。 */
    const propSec = (body.match(/\*\*props\*\*([\s\S]*?)(?=\n\*\*|$)/) || [, ''])[1];
    const boolRows = [...propSec.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|\n]*)\|/gm)]
      .filter((m) => /boolean|disabled|aria-/i.test(m[2]))
      .length;
    const titleCls = [...head[3].matchAll(/\.([a-z][a-z0-9-]{1,24})/g)].map((m) => m[1])
      .filter((c) => c !== 'css' && c !== 'js' && c !== 'html');
    const main = titleCls[0] || [...cls][0] || null;
    /* 没有主类名的章节不是组件（叠加态/缺口清单这类），跳过而不是当成空组件 */
    if (!main) continue;
    out.push({ no, name: head[2].trim(), cls: [...cls], main, boolRows });
  }
  return out;
}

/* 某个类名在 CSS 里被"作为选择器定义"的次数（粗口径：行首的 .cls 或 .cls., .cls:, .cls{） */
function defCount(css, name) {
  if (!css) return 0;
  const s = strip(css);
  /* 只数「根选择器恰好是 .cls」的定义（`.btn {` / `,.btn {`）。
     `.btn:hover`、`.btn.primary`、`.btn-i` 都是变体，不算重复定义 —— 粗口径会把
     正常的变体样式误报成"同一组件被定义 16 次"。 */
  const re = new RegExp('(^|[},])\\s*\\.' + name + '\\s*(,[^{}]*)?\\{', 'gm');
  return [...s.matchAll(re)].length;
}

/* 宽松口径：`.crow` 也算被 `.crow.ccard{` 定义了（复合选择器里的主类名）。
   S1 用它，S2 不用 —— S2 要看的是"同一组件被写了几份根样式"。 */
function defCountLoose(css, name) {
  if (!css) return 0;
  const s2 = strip(css);
  const re = new RegExp('(^|[},])\\s*[^{}]*\\.' + name + '(\\.[a-z0-9-]+)*\\s*(,[^{}]*)?\\{', 'gm');
  return [...s2.matchAll(re)].length;
}

function judge(specText, cssMap) {
  const hits = [];
  const kinds = parseSpec(specText);
  if (!kinds.length) return { rc: 1, hits: ['解析出 0 类组件（规范件格式变了？）'], kinds };

  /* S1 只查每类的**主类名**（标题括号里的第一个）。「现状实现」那一行会带变体
     （`.quiet`）与复合选择器（`.crow.ccard`）与子元素，逐个查会把变体误报成"组件不存在"。 */
  let missing = [];
  for (const k of kinds) {
    const main = k.main;
    if (!main) continue;
    const total = Object.values(cssMap).reduce((a, css) => a + defCountLoose(css, main), 0);
    if (total === 0) missing.push(k.no + '-' + k.name + ':' + '.' + main);
  }
  if (missing.length) hits.push('S1 规范点名但 CSS 里没有定义：' + missing.join(' / '));

  /* S2 只查规范里"主类名"（标题括号里第一个），避免把子元素也当组件 */
  const dup = [];
  for (const k of kinds) {
    const main = k.cls[0];
    if (!main) continue;
    const per = Object.entries(cssMap).map(([f, css]) => [f, defCount(css, main)]).filter(([, n]) => n > 0);
    const total = per.reduce((a, [, n]) => a + n, 0);
    if (total > 1) dup.push('.' + main + ' ×' + total + '（' + per.map(([f, n]) => f + ':' + n).join(',') + '）');
  }
  if (dup.length) hits.push('S2 同一组件被重复定义：' + dup.join(' / '));

  const boolBad = kinds.filter((k) => k.boolRows > 1).map((k) => k.name + '(' + k.boolRows + '个布尔)');
  if (boolBad.length) hits.push('S3 props 布尔超过 1 个：' + boolBad.join(' / '));

  return { rc: hits.length ? 2 : 0, hits, kinds };
}

function run(specPath = SPEC, cssPaths = CSS_FILES) {
  const spec = read(specPath);
  if (!spec) return { rc: 1, hits: ['读不到 ' + specPath], kinds: [] };
  const cssMap = {};
  for (const p of cssPaths) { const c = read(p.startsWith('/') ? p : ROOT + p); if (c) cssMap[p] = c; }
  if (!Object.keys(cssMap).length) return { rc: 1, hits: ['读不到任何 CSS'], kinds: [] };
  return judge(spec, cssMap);
}

function main() {
  if (process.argv.includes('--negctl')) return negctl();
  const r = run();
  console.log('组件规范契约 @ components.spec.md');
  console.log('  解析 ' + r.kinds.length + ' 类：' + r.kinds.map((k) => k.no + '.' + k.name).join(' ｜ '));
  if (!r.hits.length) console.log('  ✓ S1/S2/S3 全过');
  for (const h of r.hits) console.log('  ✗ ' + h);
  console.log('\n' + (r.rc === 0 ? '规范与实现一致 ✓' : r.rc === 2 ? '契约破裂（rc=2）' : '未量（rc=1）'));
  process.exit(r.rc);
}

function negctl() {
  const base = read(SPEC);
  if (!base) { console.log('未量：读不到规范件'); process.exit(1); }
  const tmp = mkdtempSync(join(os.tmpdir(), 'specctl-'));
  const cs = ROOT + 'assets/sys.css';
  const css = read(cs) || '';
  const cases = [
    ['N1 规范点名一个不存在的类 ⇒ 必红', base.replace('`.btn`（', '`.btn-xyz-not-exist`（', 1), css],
    /* 注入行必须自带行尾 `|`（新口径是两列正则），且锚点取**那一整行**——
       原来锚 `| `disabled` | boolean |` 命中的是带说明列的别的行，替换没落地，
       于是 N3 一直不红。锚到带「唯一布尔」的那行，注入才真的变成两个布尔。 */
    ['N3 props 塞两个布尔 ⇒ 必红',
      base.replace('| `expanded` | boolean（`aria-expanded`） | 唯一布尔；展开＝选人区出现 |',
        '| `expanded` | boolean（`aria-expanded`） | 唯一布尔；展开＝选人区出现 |\n| `loading` | boolean | 注入的第二个布尔 |', 1), css],
  ];
  let ok = 0;
  for (const [name, spec, c] of cases) {
    const sp = join(tmp, 'spec.md');
    writeFileSync(sp, spec);
    const r = run(sp, ['assets/sys.css']);
    const red = r.rc === 2;
    console.log((red ? '✓ ' : '✗ ') + name + '  rc=' + r.rc + (red ? '' : '  ← 没红，负控不成立'));
    if (red) ok++;
  }
  /* S2 负控：在临时 CSS 里把 .btn 再定义一次 */
  const dupCss = css + '\n.btn{color:red}\n';
  const sp2 = join(tmp, 'css');
  const r2 = judge(read(SPEC), { 'assets/sys.css': dupCss });
  const red2 = r2.rc === 2 && r2.hits.some((h) => h.startsWith('S2'));
  console.log((red2 ? '✓ ' : '✗ ') + 'N2 同一组件重复定义 ⇒ 必红  rc=' + r2.rc);
  if (red2) ok++;
  rmSync(tmp, { recursive: true, force: true });
  console.log('\n负控命中 ' + ok + '/3');
  /* ★2026-10-29（盲审）：原来写 `ok === 3 ? 2 : 0` —— 全中退 2、**不全中反而退 0**，
     于是 N3 不红时这条臂照样报绿。负控臂的语义只能是「全中才算臂成立」。 */
  process.exit(ok === 3 ? 0 : 2);
}

main();
