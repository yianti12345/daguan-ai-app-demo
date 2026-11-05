#!/usr/bin/env node
/* check-app-invariants.mjs —— 对象级应用状态不变量（2026-11-03）
   不看某一个菜单点得对不对，先看所有应用对象与页面投影是否一致：
   1) 每个底层 status 只能映射到 未上架/内测中/已上架；
   2) 历史值「未发布」「已下架」必须落「未上架」，不能落「内测中」；
   3) 卡片徽章必须等于该对象映射值，且页面上不出现「已下架」；
   4) 筛选器只给三态。
   用法：node tools/check-app-invariants.mjs [--negctl]；--negctl 把历史值期望改成「内测中」，必须红。 */
import { openMine } from './px-parity.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8941';
const NEG = process.argv.includes('--negctl');
const ALLOWED = ['未上架', '内测中', '已上架'];
const MAP = { '未发布': '未上架', '已下架': '未上架', '内测中': '内测中', '已上架': '已上架' };
const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails.push(m); console.log('  ✗ ' + m); };

const b = await openMine(BASE + '/apps.html');
try {
  await b.ev('localStorage.clear()');
  await b.nav(BASE + '/apps.html');

  const data = await b.ev('(function(){return (window.DB&&DB.APPS||[]).map(a=>({id:a.id,name:a.name,status:a.status}))})()');
  const cards = await b.ev('Array.from(document.querySelectorAll(".kcard")).map(c=>({id:c.dataset.id, badge:(c.querySelector(".kc-tag")||{}).textContent||""}))');
  const opts = await b.ev('Array.from(document.querySelectorAll("#f-st option")).map(o=>o.textContent.trim()).filter(Boolean)');

  data.length ? ok('读到应用对象 ' + data.length + ' 个') : bad('DB.APPS 为空');
  const ids = data.map(a => a.id);
  new Set(ids).size === ids.length ? ok('应用 id 唯一') : bad('应用 id 有重复');

  const byId = new Map(cards.map(c => [c.id, c.badge]));
  for (const a of data) {
    const want = MAP[a.status];
    if (!want) { bad('未知底层状态：' + a.id + ' = ' + a.status); continue; }
    if (!ALLOWED.includes(want)) bad('映射值不在三态：' + a.id + ' -> ' + want);
    const got = byId.get(a.id);
    if (got === undefined) { bad('列表缺卡片：' + a.id); continue; }
    got === want ? ok(a.id + ' ' + a.status + ' -> ' + got) : bad(a.id + ' 徽章=' + got + '，应为 ' + want + '（底层 ' + a.status + '）');
  }

  const legacy = data.filter(a => a.status === '已下架' || a.status === '未发布');
  legacy.length ? ok('历史状态样本 ' + legacy.length + ' 个（未发布/已下架）') : bad('没有历史状态样本，翻译分支未被覆盖');
  const legacyBad = legacy.map(a => byId.get(a.id));
  const wantLegacy = NEG ? '内测中' : '未上架';
  legacyBad.every(x => x === wantLegacy)
    ? ok('历史状态全部落「' + wantLegacy + '」')
    : bad('历史状态投影=' + JSON.stringify(legacyBad) + '，应全部为「' + wantLegacy + '」');

  cards.some(c => c.badge.includes('已下架')) ? bad('页面仍出现「已下架」徽章') : ok('页面不出现「已下架」');

  const optSet = opts.filter(x => x !== '全部' && x !== '全部状态').sort().join('|');
  optSet === [...ALLOWED].sort().join('|')
    ? ok('筛选器只有三态：' + opts.join(' / '))
    : bad('筛选器状态项=' + opts.join(' / '));
} finally {
  b.close();
}
console.log(fails.length ? '\nFAIL ' + fails.length + ' 条' : '\nPASS 对象级状态不变量全部成立');
/* ★2026-11-04 负控口径对齐 tools/negctl.tsv：负控档「抓到坏输入」必须 rc=2（此前一律 rc=1，台账记不合格）。 */
process.exit(NEG ? (fails.length ? 2 : 1) : (fails.length ? 1 : 0));
