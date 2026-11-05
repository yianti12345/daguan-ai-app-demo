#!/usr/bin/env node
/* check-ui-contract —— 界面锚点契约：判据和 AI 能力依赖的那些 id / class / 文案，还在不在。
 *
 * 为什么有它（2026-10-26，一天之内三次）：
 *   ① 组件库真卡是 `.crow.ccard`，e2e 判据查 `.kcard` ⇒ 永远 0 张，页面明明有 8 张；
 *   ② 装配入口从 `#fk-chip` 并进顶栏改名 `#act-assemble` ⇒ 9 条判据的点击全静默跳过，桩一个字没装；
 *   ③ 按钮文案「装配组件 3」改成「已装配 3 / 8」⇒ 用户说"点一下装配组件"，模型找不到目标，返回空动作。
 *   三次都不是页面坏，是**锚点漂移**：改页面的人不知道有谁在读这个 id / 这段文案。
 *
 * 机制：`tools/ui-contract.json` 是唯一声明处。缺一个就红。
 *   加锚点的门槛：必须能回答"哪条判据或哪个能力在读它"，答不出不许加（写进 why 字段）。
 *
 * 两路，各有各的用途：
 *   --static  纯文件：读 *.html 源码查 id / class 还在不在。~0.1s，进 --fast 挡「改名 / 删 id」。
 *             `"runtime": true` 的锚点由 JS 渲染出来，源码里没有，静态路显式跳过并报数。
 *   默认      真浏览器：实测渲染后的 DOM，并查 textMust 文案。~16s，进 --stylequick 挡「文案被改掉」。
 *             文案是今天最贵的那次漂移（小智失效），所以静态路挡不住的那部分必须由这一路兜。
 *
 * 用法：
 *   node tools/check-ui-contract.mjs --static
 *   node tools/check-ui-contract.mjs [baseUrl]
 *   node tools/check-ui-contract.mjs [baseUrl] --negctl
 * 退出码：0 全部成立 ｜ 1 有锚点缺失或文案不符 ｜ 3 环境不可用 / 读不到契约
 */
import { resolveBase } from './base.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTRACT = path.join(HERE, 'ui-contract.json');
const PROBE = path.join(HERE, 'probe.mjs');

const ARGV = process.argv.slice(2);
const STATIC = ARGV.includes('--static');
const NEGCTL = ARGV.includes('--negctl');
const argBase = ARGV.find((a) => /^https?:\/\//.test(a));

let contract;
try { contract = JSON.parse(readFileSync(CONTRACT, 'utf8')); }
catch (e) {
  console.log('✗ 读不到 tools/ui-contract.json：' + (e && e.message ? e.message : e));
  process.exit(3);
}
const pages = contract.pages || {};
const pageKeys = Object.keys(pages);
if (!pageKeys.length) { console.log('✗ 契约里一个页面都没声明 —— 空契约等于没契约'); process.exit(1); }

/* 负控：往契约里注入一个绝不存在的锚点，期望判红。
 * 不写负控的话，"契约成立"可能只是因为判据根本没在查（选择器拼错、页面没打开、正则写漏）。 */
if (NEGCTL) {
  console.log('【负控】注入一个不存在的锚点 #__no_such_anchor__，期望判红');
  for (const p of pageKeys) {
    pages[p].must = pages[p].must || {};
    pages[p].must['#__no_such_anchor__'] = { why: '负控注入，不该存在', runtime: STATIC ? false : undefined };
  }
}

let bad = 0, checked = 0, skippedRuntime = 0, textUnchecked = 0;

/* ── 静态路 ──────────────────────────────────────────────────────── */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function staticCheck() {
  console.log('界面锚点契约（静态路：读源码，不启浏览器）');
  for (const page of pageKeys) {
    const must = pages[page].must || {};
    const file = page.split('?')[0];
    const abs = path.join(ROOT, file);
    let html;
    try { html = readFileSync(abs, 'utf8'); }
    catch (e) { console.log('\n✗ ' + page + '：读不到 ' + file); bad++; continue; }

    const classAttrs = [...html.matchAll(/class\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
    console.log('\n' + page);
    for (const sel of Object.keys(must)) {
      const spec = must[sel] || {};
      if (spec.runtime) { skippedRuntime++; continue; }   /* JS 渲染的，源码里本来就没有 */
      checked++;
      const ok = sel.startsWith('#')
        ? new RegExp('id\\s*=\\s*["\']' + esc(sel.slice(1)) + '["\']').test(html)
        : (() => {
            const need = sel.split('.').filter(Boolean);
            return classAttrs.some((c) => need.every((n) => c.split(/\s+/).indexOf(n) >= 0));
          })();
      if (ok) { console.log('  ✓ ' + sel); }
      else {
        bad++;
        console.log('  ✗ ' + sel + ' · 源码里不存在');
        if (spec.why) console.log('      为什么重要：' + spec.why);
      }
      if ((spec.textMust || []).length) textUnchecked++;
    }
  }
  console.log('\n静态路：通过 ' + (checked - bad) + ' ｜ 缺失 ' + bad +
    ' ｜ 跳过运行时锚点 ' + skippedRuntime + ' 个（要浏览器才看得见）');
  if (textUnchecked) {
    console.log('· 有 ' + textUnchecked + ' 个锚点带文案要求，静态路查不了 —— 收尾前跑一次浏览器路：node tools/check-ui-contract.mjs <base>');
  }
  return bad ? 1 : 0;
}

/* ── 浏览器路 ────────────────────────────────────────────────────── */
async function liveCheck() {
  let BASE;
  try { BASE = argBase ? argBase.replace(/\/$/, '') : await resolveBase(); }
  catch (e) {
    console.log('✗ 环境不可用：' + (e && e.message ? e.message : e));
    return 3;
  }

  const exprFor = (anchors) => `(function(){
  var A = ${JSON.stringify(anchors)};
  var out = [];
  for (var k in A) {
    var e = null;
    try { e = document.querySelector(k); } catch (err) { e = null; }
    var rec = { sel: k, found: !!e, text: '', accName: '' };
    if (e) {
      rec.text = String(e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      rec.accName = String(e.getAttribute('aria-label') || rec.text).slice(0, 60);
    }
    out.push(rec);
  }
  return JSON.stringify(out);
})()`;

  const TMP = path.join('/tmp', 'ui-contract-expr-' + process.pid + '.js');
  let envFail = 0;

  console.log('界面锚点契约（浏览器路）@ ' + BASE);
  for (const page of pageKeys) {
    const must = pages[page].must || {};
    const sels = Object.keys(must);
    if (!sels.length) { console.log('\n· ' + page + '：未声明锚点（跳过）'); continue; }

    writeFileSync(TMP, exprFor(must));
    let rows;
    try {
      const stdout = execFileSync(process.execPath, [PROBE, BASE + '/' + page, TMP], {
        encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      rows = JSON.parse(String(stdout).trim().split('\n').filter(Boolean).pop());
      /* probe 会把页面返回值再序列化一次，页面里我们又 stringify 过一次 ⇒ 这里可能是两层。
         只解一层会得到字符串，for..of 去遍历字符 —— 输出变成几百行 undefined。 */
      if (typeof rows === 'string') rows = JSON.parse(rows);
      if (!Array.isArray(rows)) throw new Error('探针返回不是数组：' + JSON.stringify(rows).slice(0, 120));
    } catch (e) {
      console.log('\n✗ ' + page + '：量不到（环境失败，不是锚点问题）');
      console.log('  ' + String(e && e.message ? e.message : e).slice(0, 200));
      envFail++;
      continue;
    }

    console.log('\n' + page);
    for (const r of rows) {
      checked++;
      const spec = must[r.sel] || {};
      const problems = [];
      if (!r.found) problems.push('元素不存在');
      else {
        for (const t of (spec.textMust || [])) {
          /* 文案既可能落在 textContent，也可能落在 aria-label —— 小智读的是可访问名，两边都要看 */
          if (String(r.text).indexOf(t) < 0 && String(r.accName).indexOf(t) < 0) {
            problems.push('文案缺「' + t + '」（实际：' + r.text + '）');
          }
        }
      }
      if (problems.length) {
        bad++;
        console.log('  ✗ ' + r.sel + ' · ' + problems.join('；'));
        if (spec.why) console.log('      为什么重要：' + spec.why);
      } else {
        console.log('  ✓ ' + r.sel + (spec.textMust ? ' · 文案含「' + spec.textMust.join('」「') + '」' : ''));
      }
    }
  }
  try { execFileSync('/bin/rm', ['-f', TMP]); } catch (e) {}

  console.log('\n通过 ' + (checked - bad) + ' ｜ 缺失 ' + bad + ' ｜ 环境失败 ' + envFail + ' 页');
  if (envFail && !bad) {
    console.log('全部锚点要么成立、要么没量到 —— 没量到的不算通过（rc=3）');
    return 3;
  }
  return bad ? 1 : 0;
}

const rc = STATIC ? staticCheck() : await liveCheck();
if (rc) {
  console.log('修法二选一：①把页面改回去；②确实要改名/改文案，就同步改 tools/ui-contract.json，并在 why 里写清现在谁在读它。');
}
process.exit(rc);
