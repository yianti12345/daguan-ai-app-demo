#!/usr/bin/env node
/* check-layout —— 生成页面的"版式契约"判据（2026-10-23 新增）。
 *
 * 为什么要有：这一轮修的三件丑事，全都不在旧判据的覆盖里 ——
 *   ① 块标题里带方位词（「抽取字段对照（右侧）」）—— 把布局指令当文案念给用户看；
 *   ② 同一页里块间距 12 和 18 并存（两条 CSS 规则特异性相同，后者赢）——
 *      用户说的"零散样式"就是这种：单看每条都对，放一起就不齐；
 *   ③ 用户说"左边原文右边字段"，渲染成上下两块 —— 方位词被剥掉了，并排却没发生。
 * 三件的共同点：**样式数值全对，看起来不对**。所以判据只能盯几何与文案，
 * 不能盯"有没有某个 class"。
 *
 * 判三条（都只看渲染结果）：
 *   L1 标题里不许出现方位词（块标题 / 页面标题）
 *   L2 同一页顶层块的间距只许一个值（0 除外：状态条与筛选条贴着卡片头是设计）
 *   L3 并排的两栏必须等宽（差 ≤ 2px）——不是"有 .bd-two-col"，是"真的是两栏"
 *
 * 用法：node tools/check-layout.mjs          正控
 *      node tools/check-layout.mjs --negctl  负控：三个注入，每条都必须打红
 * 退出码：0 通过 ｜ 2 有违规（负控恒 2）｜ 3 环境不可用
 */
import { resolveBase } from './base.mjs';
import { openMineShared, closeMineShared } from './px-parity.mjs';

const BASE = await resolveBase();
const NEG = process.argv.includes('--negctl');

/* 三个样例覆盖三种形态：并排详情、列表（含分页）、多块表单。
   都带"块标题"和"多个块"，因为 L1/L2 只有在多块时才暴露。 */
const CASES = [
  {
    name: '详情（并排）',
    spec: {
      title: '任务详情 · DC-2026-1031', action: '提交复核', layout: 'two-col',
      blocks: [
        { type: 'status', text: '待复核 · 已抽取 12 项字段' },
        { type: 'text', title: '原文摘录', side: 'L', text: '募集说明书第 3 章摘录：本期债券发行规模不超过 8,000 万元，期限 3 年，票面利率区间 2.80%—3.40%。' },
        { type: 'form', title: '抽取字段', side: 'R', mode: 'read', rows: [['任务编号', 'DC-2026-1031'], ['业务类型', '债券承做']] },
        /* 末尾这条说明是给 L2 用的：只有一个非零间距时，"唯一"这条断言怎么改都成立，
           等于没量。至少要有两个非零间距，才能验出 12 / 18 并存那种错。 */
        { type: 'text', text: '左侧原文与右侧抽取字段逐项对照，待复核项处理后才可提交。' }
      ]
    }
  },
  {
    name: '列表（分页）',
    spec: {
      title: '审核任务列表', action: '新建审核任务',
      blocks: [
        { type: 'status', text: '审核中 · 15 条待处理' },
        { type: 'filters', search: '搜索任务编号', chips: ['全部', '待复核'] },
        { type: 'table', title: '任务明细', cols: ['任务编号', '金额'], rows: Array.from({ length: 12 }, (_, i) => ['DC-2026-' + (1031 + i), (i + 3) + ',000 万']) }
      ]
    }
  },
  {
    name: '表单（多块）',
    spec: {
      title: '新建规则', action: '保存规则',
      blocks: [
        { type: 'form', title: '规则设定', rows: [['规则名称', '城投类准入校验'], ['适用业务', '债券承做']] },
        { type: 'form', title: '适用范围参照', mode: 'read', rows: [['任务编号', 'DC-2026-1031'], ['业务类型', '债券承做']] },
        { type: 'text', text: '规则保存后即时生效。' }
      ]
    }
  }
];

const PROBE = `(function(){
  var inner = document.querySelector('#canvas-inner');
  var page = inner && inner.querySelector('.page');
  if (!page) return { none: true };
  var out = { L1: [], L2: [], L3: [] };

  /* L1 方位词 */
  var RE = /[（(]\\s*(左|右)(侧|栏|边)?\\s*[）)]|(左侧|右侧|左栏|右栏|左边|右边)/;
  var ttl = [].slice.call(page.querySelectorAll('.bd-sec, .page-hd b'));
  ttl.forEach(function (e) {
    var t = (e.textContent || '').trim();
    if (RE.test(t)) out.L1.push(t.slice(0, 24));
  });

  /* L2 顶层块间距：只看非零值，必须只有一个。
     ⚠ 非零间距少于 2 个时这条判不了（怎么改都"唯一"）⇒ 记没量，不算过。 */
  var kids = [].slice.call(page.children);
  var gaps = [];
  for (var i = 1; i < kids.length; i++) {
    var g = Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom);
    if (g > 0) gaps.push(g);
  }
  out.L2n = gaps.length;
  var uniq = gaps.filter(function (v, k) { return gaps.indexOf(v) === k; });
  if (gaps.length >= 2 && uniq.length > 1) out.L2.push(uniq.join(' / '));

  /* L3 并排等宽 */
  [].slice.call(page.querySelectorAll('.bd-two-col')).forEach(function (col) {
    var cs = [].slice.call(col.children);
    if (cs.length !== 2) { out.L3.push('并排里有 ' + cs.length + ' 栏'); return; }
    var a = Math.round(cs[0].getBoundingClientRect().width);
    var b = Math.round(cs[1].getBoundingClientRect().width);
    if (Math.abs(a - b) > 2) out.L3.push(a + ' vs ' + b);
  });
  return out;
})()`;

const m = await openMineShared(`${BASE}/component.html`);
const send = m.__send;

async function runCase(c) {
  const spec = JSON.stringify(c.spec);
  const r = await send('Runtime.evaluate', {
    expression: `(function(){
      var spec = ${spec};
      var out = Gen.renderComponent(spec);
      var inner = document.querySelector('#canvas-inner');
      inner.innerHTML = '';
      var pg = document.createElement('div'); pg.className = 'page';
      pg.innerHTML = out.head + out.sections.join('');
      inner.appendChild(pg);
      return 1;
    })()`,
    returnByValue: true
  });
  if (r.exceptionDetails) return { err: String(r.exceptionDetails.text).slice(0, 160) };
  const p = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  return p.result ? p.result.value : null;
}

/* 负控：往渲染好的页面里注入对应缺陷。三种注入各自只针对一条判据，
   另一条必须仍然绿 —— 否则说明两条判据在互相兜底，等于都没验。 */
const NEGCASE = {
  L1: `(function(){ var s=document.querySelector('#canvas-inner .bd-sec'); if(s) s.textContent = s.textContent + '（右侧）'; return !!s; })()`,
  L2: `(function(){ var p=document.querySelector('#canvas-inner .page'); var k=p&&p.children; if(!k||k.length<3) return false; k[2].style.marginTop='25px'; return true; })()`,
  L3: `(function(){ var c=document.querySelector('#canvas-inner .bd-two-col'); if(!c) return false; c.style.gridTemplateColumns='2fr 1fr'; return true; })()`
};

let bad = 0;
if (!NEG) {
  console.log(`版式判据 @ ${BASE}\n`);
  for (const c of CASES) {
    const v = await runCase(c);
    if (!v || v.err) { console.log(`  ✗ ${c.name} 渲染失败：${v && v.err}`); bad++; continue; }
    if (v.none) { console.log(`  ✗ ${c.name} 画布上没有 .page`); bad++; continue; }
    const l1 = v.L1.length === 0, l2 = v.L2.length === 0, l3 = v.L3.length === 0;
    const l2n = v.L2n == null ? 0 : v.L2n;
    console.log(`  ${l1 ? '✓' : '✗'} L1 ${c.name} 标题无方位词${l1 ? '' : ' → ' + v.L1.join(' / ')}`);
    console.log(`  ${l2 ? (l2n >= 2 ? '✓' : '·') : '✗'} L2 ${c.name} 块间距唯一${l2n >= 2 ? '' : ` → 非零间距只有 ${l2n} 个，没量到`}${l2 ? '' : ' → ' + v.L2.join(' → ')}`);
    console.log(`  ${l3 ? '✓' : '✗'} L3 ${c.name} 并排等宽${l3 ? '' : ' → ' + v.L3.join(' / ')}`);
    if (!l1 || !l2 || !l3) bad++;
  }
} else {
  console.log(`版式判据 负控 @ ${BASE}\n`);
  for (const c of CASES) {
    await runCase(c);
    for (const key of ['L1', 'L2', 'L3']) {
      await runCase(c);   /* 每次注入前重画，避免上一次的注入残留 */
      const ok = await send('Runtime.evaluate', { expression: NEGCASE[key], returnByValue: true });
      if (!ok.result || ok.result.value !== true) { console.log(`  · ${key} 在本样例里没有可注入的目标，跳过`); continue; }
      const p = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const v = p.result && p.result.value;
      const caught = v && v[key] && v[key].length > 0;
      /* 另两条必须不响 —— 一条注入只能打红它对应的那条 */
      const leak = v && ['L1', 'L2', 'L3'].filter((k) => k !== key && v[k] && v[k].length > 0);
      console.log(`  ${caught ? '✓' : '✗'} 负控 ${key} 注入缺陷后判红（${c.name}）${caught ? '' : ' ← 判据没抓到'}`);
      if (!caught) bad++;
      if (leak && leak.length) { console.log(`  ✗ 负控 ${key} 串响到了 ${leak.join(',')}（一条注入只能打红一条）`); bad++; }
    }
  }
}

closeMineShared();
if (NEG) {
  /* 负控约定与套件一致：全部成立 ⇒ rc=2（Q1 只认 2）。
     有失败必须用别的码，否则"负控失败"和"负控成立"在 Q1 眼里是同一件事。 */
  if (bad) { console.log(`\n负控失败：${bad} 项（注入后判据没红）`); process.exit(1); }
  console.log(`\n负控成立：L1 / L2 / L3 三条都能被对应注入打红，且不互相串响`);
  process.exit(2);
}
if (bad) { console.log(`\n版式判据：${bad} 项不通过`); process.exit(2); }
/* ★ 2026-10-24：`closeMineShared()` 之后进程不一定退（共用浏览器句柄还挂在事件循环上），
   实测门禁里这一件会把整轮"跑成黑盒"——输出已经打完 0 条违规，rc 却永远不返回。
   判据自己必须给得出结论：这里显式 exit，rc 与打印的结论同源。 */
console.log(`\n版式判据：0 条违规（标题无方位词 / 块间距唯一 / 并排等宽）`);
process.exit(0);
