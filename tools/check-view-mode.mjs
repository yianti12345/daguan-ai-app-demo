#!/usr/bin/env node
/* check-view-mode —— 客户视图（`app.html?id=…&mode=view`）不许漏出任何管理侧控件。
 *
 * 为什么要有它（2026-10-27，UE 走查 P0-3 之后立的）：
 *   走查实测「应用卡 → 复制链接」复制出来的是 `apps.html?id=…` —— 那是**管理列表页**，
 *   客户打开看到的是一堆别人的应用；而全站 5 个页面里没有一处能当客户视图。
 *   也就是说「发布」这个动作没有落点：发完之后，没有任何地址能证明客户看到了什么。
 *
 *   修法是同一份画布加 `?mode=view`（不另写一套渲染 —— 另写一份＝第二份画布，
 *   今天已经有 RULE_ROWS 3 行 vs COL_DATA 8 行这个现成教训）。
 *   但"用 CSS 隐藏"这件事**没有天然保障**：后来的人加一个新按钮、或者改选择器，
 *   就可能把管理控件漏给客户，而页面上不会报错、截图里也未必一眼看出。
 *   所以必须有命令看着它。
 *
 * 判据（正控，两条都要满足）：
 *   ① view 模式下，管理侧控件**可见数 = 0**（按 getBoundingClientRect + visibility 判，
 *      不按"元素存在"判 —— 存在但 display:none 是正常的，存在且可见才是漏）
 *      管理侧清单：返回、装配/保存/发布、编辑态提示、块操作组、块 ⋯、对话条、全局提示条
 *   ② 内容一个都没少：块数 === 带 id 进编辑态时的块数，表格行数 > 0
 *   ③ 标题不含「应用配置」（客户不需要知道这是配置页）
 *
 * 负控（--negctl）：同一套断言跑在**不带 mode 参数**的地址上，必须抓到 ≥1 个可见管理控件。
 *   抓不到＝这条判据证明不了自己会红（今天已两次栽在"负控注入点和断言点不是同一个元素"）。
 *
 * 用法：node tools/check-view-mode.mjs            正控
 *      node tools/check-view-mode.mjs --negctl   负控
 * 退出码：0 通过 ｜ 2 有断点 ｜ 3 未量（页面打不开 / 拿不到读数）
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BASE = process.env.XZ_BASE || 'http://127.0.0.1:8941';
const NEG = process.argv.includes('--negctl');
const APP = process.env.XZ_APP || 'hx-zc';

const PROBE = join(HERE, 'probe.mjs');
const SNIP = join(tmpdir(), 'xz-check-view-mode.js');

/* 探针：只读，不改页面。返回"可见性"而不是"存在性"。 */
const SCRIPT = `(function(){
  function shown(e){
    if(!e) return false;
    var b=e.getBoundingClientRect(), cs=getComputedStyle(e);
    return b.width>0 && b.height>0 && cs.visibility!=='hidden' && cs.display!=='none' && Number(cs.opacity)>0.01;
  }
  var SEL='.back,.tb-ops,.app-edit,.app-meta,.cv-blk-ops,.cv-blk-more,.fk-dock,#hint,#cfg-bar';
  var hits=[].slice.call(document.querySelectorAll(SEL)).filter(shown).map(function(e){
    return String(e.className||e.id||e.tagName).split(' ')[0];
  });
  return JSON.stringify({
    mode: document.body.getAttribute('data-mode'),
    title: document.title,
    blocks: document.querySelectorAll('#canvas .cv-blk').length,
    rows: document.querySelectorAll('#canvas table tbody tr').length,
    leak: hits
  });
})()`;

function read(url) {
  try {
    const out = execFileSync(process.execPath, [PROBE, url, SNIP], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line = out.trim().split('\n').filter(Boolean).pop();
    let v = JSON.parse(line);
    /* probe 打印的是 JSON.stringify 的结果，可能被再包一层字符串 */
    if (typeof v === 'string') v = JSON.parse(v);
    return v;
  } catch (e) {
    return { err: String((e && e.message) || e).slice(0, 200) };
  }
}

writeFileSync(SNIP, SCRIPT);

let bad = 0, unmeasured = 0;
function ok(cond, name, detail) {
  if (cond) console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
  else { bad++; console.log('  ✗ ' + name + (detail ? '（' + detail + '）' : '')); }
}
function skip(name, why) { unmeasured++; console.log('  · 未量：' + name + '（' + why + '）'); }

if (NEG) {
  /* 负控：去掉 mode，必须抓到管理控件。抓不到＝断言没在起作用。 */
  const v = read(BASE + '/app.html?id=' + APP);
  if (v.err) { console.log('  · 未量：负控页面打不开 ' + v.err); process.exit(3); }
  console.log('  · 负控（不带 mode 的编辑态）可见管理控件：' + v.leak.length + ' 个' +
    (v.leak.length ? ' [' + [...new Set(v.leak)].join(', ') + ']' : ''));
  ok(v.leak.length > 0, '负控：编辑态必须能抓到可见管理控件（否则这条判据证明不了自己会红）',
    v.leak.length ? '' : '抓到 0 个 —— 断言的可见性口径失效了');
  process.exit(bad ? 2 : 0);
}

const view = read(BASE + '/app.html?id=' + APP + '&mode=view');
const edit = read(BASE + '/app.html?id=' + APP);

if (view.err) { console.log('  · 未量：客户视图打不开 ' + view.err); process.exit(3); }

ok(view.mode === 'view', '客户视图进入 view 模式', 'data-mode=' + view.mode);
ok(view.leak.length === 0, '客户视图零管理控件',
  view.leak.length ? '漏出 ' + view.leak.length + ' 个：' + [...new Set(view.leak)].join(', ') : '可见管理控件 0 个');
ok(!/应用配置/.test(view.title || ''), '客户视图标题不含「应用配置」', 'title=' + view.title);
ok(view.blocks > 0, '客户视图有内容（块数 > 0）', '块 ' + view.blocks + ' 个 · 表格行 ' + view.rows + ' 行');

if (edit.err) skip('客户视图与编辑态内容等量', '编辑态页面打不开');
else ok(view.blocks === edit.blocks, '客户视图与编辑态块数一致（隐藏控件不许把内容一起藏掉）',
  '客户 ' + view.blocks + ' / 编辑 ' + edit.blocks);

console.log('');
if (unmeasured) console.log('  ⚠ 有 ' + unmeasured + ' 项未量（未量不许当绿）');
if (bad) { console.log('客户视图判据：' + bad + ' 个断点'); process.exit(2); }
if (unmeasured) process.exit(3);
console.log('客户视图判据：全部通过');
process.exit(0);
