/* audit-states.mjs —— 全站**真实状态**体检（不是"文件存在性"，是"这一页画出来了没有"）。

 * 为什么要有它（2026-10-23 用户原话：「是不是没有设计？还有多少问题？」）：
 *   在此之前所有视觉判据只截 4 个无参数页面。而 `component.html` 无参数＝空态页，
 *   真正被看的是 `component.html?id=app-header`。也就是说真实页面从来没进过任何判据。
 *
 * 判什么（每条都是"看得见"的事，不是"代码里有没有"）：
 *   E1 画布有没有内容        主容器子元素数 = 0 → 空页
 *   E2 死白占比              最后一块内容底边到视口底的距离 / 视口高
 *   E3 文字截断              块级元素 scrollHeight > clientHeight + 2
 *   E4 横向溢出              documentElement.scrollWidth > clientWidth
 *   E5 同屏重复标题          同一段文字在这个页面上出现 ≥2 次（视觉冗余）
 *   E6 内部用语              界面上出现组件名 / "由「…」生成" / "组件" 字样
 *   E7 层级缺失              内容区里"只有一层"（所有块同底色、同描边）→ 看不出分组
 *
 * 退出码：0 全过 ｜ 2 有问题 ｜ 3 环境不可用
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveBase } from './base.mjs';
import { ALL_URLS } from './states.mjs';
import { openMineShared, closeMineShared } from './px-parity.mjs';

const BASE = await resolveBase(process.argv.slice(2)).catch((e) => { console.error('✗ ' + e.message); process.exit(3); });
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const URLS = ONLY ? ALL_URLS.filter((u) => u.startsWith(ONLY)) : ALL_URLS;

/* 页面里跑的探针。全部只读，不改 DOM。 */
const PROBE = `(function(){
  var vh = window.innerHeight, vw = window.innerWidth;
  var doc = document.documentElement;

  /* 主内容容器：四个页面各自的名字，取第一个存在的 */
  var hostSel = ['.canvas-inner', '#canvas', '.canvas', 'main', '.grid'];
  var host = null, hostName = null;
  for (var i = 0; i < hostSel.length; i++) {
    var e = document.querySelector(hostSel[i]);
    if (e && e.getBoundingClientRect().height > 40) { host = e; hostName = hostSel[i]; break; }
  }
  var kids = host ? [...host.children].filter(function(c){
    var r = c.getBoundingClientRect();
    return r.height > 8 && getComputedStyle(c).display !== 'none';
  }).length : 0;

  /* 死白：所有可见块的最底边 → 视口底 */
  var blocks = [...document.querySelectorAll('body *')].filter(function(e){
    var r = e.getBoundingClientRect();
    var cs = getComputedStyle(e);
    return r.width > 40 && r.height > 12 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || 1) > 0.1;
  });
  var maxBottom = 0;
  blocks.forEach(function(e){ var r = e.getBoundingClientRect(); if (r.bottom > maxBottom) maxBottom = r.bottom; });
  var dead = Math.max(0, Math.round(vh - maxBottom));

  /* 截断 */
  var clipped = [];
  [...document.querySelectorAll('h1,h2,h3,b,p,span,td,th,div')].forEach(function(e){
    if (e.children.length) return;
    var cs = getComputedStyle(e);
    if (cs.overflow === 'visible') return;
    if (e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0) {
      clipped.push((e.innerText || '').trim().slice(0, 16));
    }
  });

  /* 同屏重复：只统计"像标题"的文字（≥6 字、块级） */
  var seen = {}, dup = [];
  [...document.querySelectorAll('h1,h2,h3,b,strong')].forEach(function(e){
    if (e.children.length) return;
    var t = (e.innerText || '').replace(/\\s+/g, '');
    if (t.length < 6) return;
    /* 只算页面级标题（≥14px）：12px 的小字是示例值/预览块内容，跟标题重复不是缺陷 */
    if (parseFloat(getComputedStyle(e).fontSize) < 14) return;
    seen[t] = (seen[t] || 0) + 1;
  });
  Object.keys(seen).forEach(function(k){ if (seen[k] > 1) dup.push(k + '×' + seen[k]); });

  /* 内部用语：组件名是研发概念 */
  var text = document.body.innerText || '';
  var jargon = [];
  ['由「', '生成的', '组件名', '工作台式', '画布', '配置态', '预览态'].forEach(function(w){
    if (text.indexOf(w) >= 0) jargon.push(w);
  });

  /* 层级：内容区里不同背景色 / 不同描边的数量 —— 只有 1 种就是"一整块白板" */
  var bgs = {}, borders = 0;
  if (host) {
    [host, ...host.querySelectorAll('*')].slice(0, 400).forEach(function(e){
      var cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (r.width < 30 || r.height < 10) return;
      bgs[cs.backgroundColor] = 1;
      if (parseFloat(cs.borderTopWidth) > 0) borders++;
    });
  }

  return {
    hostName: hostName,
    kids: kids,
    dead: dead,
    vh: vh,
    hOverflow: doc.scrollWidth > doc.clientWidth + 1,
    scrollW: doc.scrollWidth,
    clientW: doc.clientWidth,
    clipped: clipped.slice(0, 6),
    dup: dup.slice(0, 6),
    jargon: jargon,
    bgLayers: Object.keys(bgs).length,
    borders: borders
  };
})()`;

let bad = 0;
const rows = [];
for (const u of URLS) {
  let m, r;
  try {
    m = await openMineShared(`${BASE}/${u}`);
    r = await m.ev(PROBE);
    /* 复用同一个浏览器：不在这里关，整轮结束统一关（见文件末尾） */
  } catch (e) {
    rows.push([u, 'ERR', e.message.slice(0, 50), '', '', '', '']);
    bad++;
    continue;
  }
  const issues = [];
  if (r.kids === 0) issues.push('E1 空画布');
  if (r.dead > 260) issues.push(`E2 死白${r.dead}px`);
  if (r.clipped.length) issues.push(`E3 截断${r.clipped.length}`);
  if (r.hOverflow) issues.push(`E4 溢出${r.scrollW}>${r.clientW}`);
  if (r.dup.length) issues.push(`E5 重字${r.dup.length}`);
  if (r.jargon.length) issues.push(`E6 内语${r.jargon.join('/')}`);
  if (r.bgLayers <= 1) issues.push('E7 无层次');
  if (issues.length) bad++;
  rows.push([u, r.kids, r.dead + 'px', r.clipped.join('|').slice(0, 28), r.dup.join('|').slice(0, 28), r.jargon.join('/'), issues.join(' ')]);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`audit-states @ ${BASE}   共 ${URLS.length} 个真实状态\n`);
console.log(pad('页面', 34) + pad('块', 5) + pad('死白', 8) + pad('状态', 52));
console.log('-'.repeat(100));
for (const [u, kids, dead, clip, dup, jar, is] of rows) {
  console.log(pad(u, 34) + pad(kids, 5) + pad(dead, 8) + (is || 'ok'));
  if (dup) console.log(pad('', 34) + '   ↳ 重复：' + dup);
  if (clip) console.log(pad('', 34) + '   ↳ 截断：' + clip);
}
console.log(`\n结论：${URLS.length - bad} / ${URLS.length} 页无问题`);
closeMineShared();
process.exit(bad ? 2 : 0);
