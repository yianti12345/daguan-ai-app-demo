#!/usr/bin/env node
/* check-form-hygiene.mjs —— 表单卫生判据（2026-11-03，m04152 / m04268 之后立）
 *
 * 为什么要有它：图标上传件被反复改错（88×88 虚线框 vs 截图里的 88×32 描边键）；
 * 编辑弹窗底部长期挂着一句解释文案，标签到控件 22、字段之间 30，一组大一组小。
 * 这些都不是"某一次手滑"，是没有任何机器在看"表单里允不允许出现说明句、间距是否同一个节奏"。
 *
 * 判据：
 *   F1 应用图标上传键：88×32、直角、1px 实线 #D9D9D9、无 ::before、旁边无提示行
 *   F2 编辑信息弹窗：无 #ei-note / .nf-note，正文里没有解释性长句
 *   F3 表单节奏：.nf-bd 直接子元素间距全部 16；每个 .nf-row 内标签到控件 8
 *   F4 租户 ID 输入框旁没有静态说明（.fm-hint）
 *
 * 用法：node tools/check-form-hygiene.mjs [--negctl]
 *   --negctl 往页面注入一句说明、把图标改宽、把间距改乱，四项都必须红。
 */
import { openMine } from './px-parity.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8941';
const NEG = process.argv.includes('--negctl');
const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails.push(m); console.log('  ✗ ' + m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const near = (a, b) => Math.abs(a - b) <= 1;

const b = await openMine(BASE + '/apps.html');
await sleep(500);

/* ── F1 应用图标上传键 ─────────────────────────────── */
await b.ev('document.querySelector("#btn-new").click()');
await sleep(250);
if (NEG) {
  await b.ev(`(function(){
    var t=document.querySelector('#ap-cover-thumb');
    t.style.width='89px';
    var h=document.createElement('span');h.className='nf-hint';h.textContent='PNG / JPG';
    t.parentNode.appendChild(h);
  })()`);
}
const icon = await b.ev(`(() => { var t=document.querySelector('#ap-cover-thumb'); var r=t.getBoundingClientRect(); var cs=getComputedStyle(t); return {w:Math.round(r.width),h:Math.round(r.height),bw:cs.borderTopWidth,bs:cs.borderTopStyle,bc:cs.borderTopColor,br:cs.borderRadius,plus:getComputedStyle(t,'::before').content,hints:t.parentNode.querySelectorAll('.nf-hint').length}; })()`);
(near(icon.w, 88) && near(icon.h, 32)) ? ok('图标键 88×32') : bad('图标键尺寸 ' + icon.w + '×' + icon.h + '（应 88×32）');
(icon.bw === '1px' && icon.bs === 'solid' && icon.bc === 'rgb(217, 217, 217)') ? ok('图标键 1px 实线 #D9D9D9') : bad('图标键边框 ' + icon.bw + ' ' + icon.bs + ' ' + icon.bc);
(icon.br === '0px') ? ok('图标键直角') : bad('图标键圆角 ' + icon.br + '（应 0）');
(icon.plus === 'none') ? ok('图标键无伪元素加号') : bad('图标键出现伪元素 ' + icon.plus);
(icon.hints === 0) ? ok('图标键无提示行') : bad('图标键旁又长出 ' + icon.hints + ' 条提示');

/* ── F2/F3 编辑信息弹窗 ───────────────────────────── */
await b.nav(BASE + '/components.html');
await sleep(500);
await b.ev("document.querySelector('.k-more').click(); document.querySelector('[data-act=\"edit\"]').click()");
await sleep(250);
if (NEG) {
  await b.ev(`(function(){
    var bd=document.querySelector('#ei-mask .nf-bd');
    bd.style.gap='20px';
    var p=document.createElement('p');p.className='nf-note';p.id='ei-note';p.textContent='名称是同一个名字；改完只影响组件库。';
    bd.appendChild(p);
  })()`);
}
const dlg = await b.ev(`(() => {
  var bd=document.querySelector('#ei-mask .nf-bd');
  var kids=[...bd.children];
  var gaps=[]; for(var i=1;i<kids.length;i++){var a=kids[i-1].getBoundingClientRect(),c=kids[i].getBoundingClientRect();gaps.push(Math.round(c.y-(a.y+a.height)));}
  var rows=[...bd.querySelectorAll('.nf-row')].map(function(row){var l=row.querySelector('label'),c=row.querySelector('input,textarea');if(!l||!c)return null;var a=l.getBoundingClientRect(),d=c.getBoundingClientRect();return Math.round(d.y-(a.y+a.height));}).filter(function(x){return x!==null;});
  return {gaps:gaps,rows:rows,note:!!document.querySelector('#ei-note')||bd.querySelectorAll('.nf-hint').length>0,text:bd.innerText};   /* ★2026-11-04 .nf-note 不存在，提示行真实类是 .nf-hint */
})()`);
(dlg.note === false) ? ok('编辑弹窗无静态说明节点') : bad('编辑弹窗又出现静态说明节点');
(dlg.gaps.length && dlg.gaps.every(g => g === 16)) ? ok('字段组间距全部 16：' + dlg.gaps.join('/')) : bad('字段组间距不齐：' + dlg.gaps.join('/'));
(dlg.rows.length && dlg.rows.every(g => g === 8)) ? ok('标签到控件全部 8：' + dlg.rows.join('/')) : bad('标签到控件间距不齐：' + dlg.rows.join('/'));
const banned = ['改完', '影响组件库', '同一个名字', '不用再手打', '唯一标识'];
const hits = banned.filter(w => dlg.text.includes(w));
(hits.length === 0) ? ok('弹窗正文无解释性长句') : bad('弹窗正文仍有解释句：' + hits.join('/'));

/* ── F4 租户 ID 旁无静态说明 ──────────────────────── */
await b.nav(BASE + '/client-auth.html');
await sleep(400);
if (NEG) await b.ev(`(function(){var i=document.querySelector('#cl-tenant');var p=document.createElement('p');p.className='fm-hint';p.textContent='唯一标识';i.parentNode.appendChild(p);})()`);
const tenantHint = await b.ev('!!document.querySelector("#cl-tenant + .fm-hint")');
(tenantHint === false) ? ok('租户 ID 旁无静态说明') : bad('租户 ID 旁又有静态说明');

b.close();
console.log(fails.length ? '\nFAIL ' + fails.length + ' 条' : '\nPASS 表单卫生：图标 / 文案 / 间距 / 静态说明');
/* ★2026-11-04 负控口径对齐 tools/negctl.tsv：负控档「抓到坏输入」必须 rc=2（此前一律 rc=1，台账记不合格）。 */
process.exit(NEG ? (fails.length ? 2 : 1) : (fails.length ? 1 : 0));
