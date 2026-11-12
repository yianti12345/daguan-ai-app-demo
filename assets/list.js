/* 列表契约（2026-11-04）
   ────────────────────────────────────────────────────────────────
   为什么有这个文件：客户授权页与版本管理页各写一套表头、各拼一套行、
   各把列宽写进自己的 CSS —— 同一件东西四份实现，改一处另外三处不跟。
   根因分析（_reports/根因分析-20261104.md）把它归成 C 类：有 token，没有契约。
   token 统一的是"值"；契约要统一的是"谁说了算"。

   所以这里只做四件，别的一概不管：
     1. 表头 —— 由 headCols 生成，页面不再写死 <span> 列表
     2. 列宽 —— 由 cols 生成 --gt-cols，页面 CSS 不再声明
     3. 行骨架 —— 每行固定 N 个单元格，按 headCols 顺序，内容由 cell(key, row) 给
     4. 空态与表尾 —— 由 spec 提供文案，不在这里猜

   它不接管：数据从哪来、什么时候重绘、行内按钮的点击行为。
   那些是页面的业务，属于另外两层（对象模型 / 状态机）。

   spec 字段：
     table     表容器选择器（用来设 --gt-cols）
     head      表头行选择器
     body      行容器选择器
     total     表尾字选择器（可选）
     cols      列宽字符串，例 '96px 120px 200px minmax(0,1fr)'
     headCols  [{ key, label, cls, align }]  label 可为空（选择列）
     rows      行对象数组
     rowClass  每行基础类名
     rowExtra  function(row) -> 额外类名（可选）
     rowAttr   function(row) -> ' data-x="1"'（可选）
     cell      function(key, row) -> 单元格内层 HTML
     headCell  function(key) -> 表头单元格内层 HTML（可选）。表头要放控件（比如全选框）
               就必须走这里：表头每次重绘都是整段重建，写死在页面 HTML 里的控件会被覆盖。
     cellAttr  function(key, row) -> 单元格上的额外属性（可选），例 ' data-expired="1"'
     empty     function() -> 空态 HTML（整块，含自己的类名）
     foot      function(rows) -> 表尾文字；不给则不动表尾
     after     function() -> 渲染完的回调（可选）
*/
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 契约自检：声明了几列就必须给出几列，列宽数要对得上。
     不这么干的话，「表头 8 列、行 7 格」这种错会安静地渲染出来，
     而且看起来只是"最后一列没对齐"。 */
  function assertSpec(spec) {
    /* ★ 根治 A：三问卡的拦截点。不是提醒、不是台账 —— 缺一个字段，这一页就渲染不出来。
       object：主对象是谁；states：有哪几种状态；source：真源/基线表对应哪一屏。 */
    ['object', 'states', 'source'].forEach(function (k) {
      if (!spec[k] || (Array.isArray(spec[k]) && !spec[k].length)) {
        throw new Error('[List] 规格缺「' + k + '」：动手前没答完三问，不许出界面');
      }
    });
    var cols = spec.headCols || [];
    if (!cols.length) throw new Error('[List] headCols 为空');
    if (spec.cols) {
      var n = String(spec.cols).trim().split(/\s+(?![^(]*\))/).length;
      if (n !== cols.length) {
        throw new Error('[List] 列宽 ' + n + ' 段 ≠ 表头 ' + cols.length + ' 列');
      }
    }
    /* ★2026-11-05 列级来源：spec 打开 requireColFrom 后，每一列必须交代它从哪来。
       truth=真源取证文件里有；user=用户原话要的；mine=我自己加的 —— mine 必须带到期日，
       到期没并回真源或用户口径，这一页就渲染不出来。
       为什么做成拦断不是提醒：这一页的错全是"我补出一个真源没有的东西"，
       而加判据拦不住新形态 —— 只有"说不出谁要的就不许画"能拦住。 */
    if (spec.requireColFrom) {
      cols.forEach(function (c) {
        var f = c.from;
        if (f !== 'truth' && f !== 'user' && f !== 'mine') {
          throw new Error('[List] 列「' + (c.label || c.key) + '」没交代来源（truth / user / mine）');
        }
        if (f === 'mine' && !c.due) {
          throw new Error('[List] 列「' + (c.label || c.key) + '」是我自己加的，但没写到期日');
        }
      });
    }
    var keys = {};
    cols.forEach(function (c) {
      if (!c.key) throw new Error('[List] 有一列没写 key');
      if (keys[c.key]) throw new Error('[List] 重复的列 key：' + c.key);
      keys[c.key] = 1;
    });
    if (typeof spec.cell !== 'function') throw new Error('[List] 缺 cell()');
  }

  /* 两种调用：
       List.render(spec, overrides) —— 规格来自 assets/spec.js（唯一真源），页面只给数据/渲染函数
       List.render(merged)          —— 老调用；若它没带三问字段，assertSpec 会把它挡下来 */
  function render(a, b) {
    var spec = b ? Object.assign({}, a, b) : a;
    var q = function (sel) { return sel ? document.querySelector(sel) : null; };
    var body0 = q(spec.body);
    try {
      assertSpec(spec);
    } catch (e) {
      /* 拦截要看得见：不是白屏让人猜，而是把"缺哪一问"写在界面上 */
      if (body0) body0.innerHTML = '<p class="lst-blocked">规格没答完：' + esc(e.message) + '</p>';
      throw e;
    }
    var table = q(spec.table), head = q(spec.head), body = body0, total = q(spec.total);
    if (!body) return;

    /* ① 列宽：唯一的声明处。页面 CSS 里不许再写 --gt-cols。 */
    if (table && spec.cols) {
      var tracks = String(spec.cols).trim().split(/\s+(?![^(]*\))/);
      var minWidth = tracks.reduce(function (sum, track) {
        var value = track.match(/^(?:minmax\(\s*)?(\d+(?:\.\d+)?)px\b/);
        return sum + (value ? Number(value[1]) : 0);
      }, 0);
      table.style.setProperty('--gt-cols', spec.cols);
      table.style.setProperty('--gt-min-w', 'calc(' + minWidth + 'px + ' +
        (tracks.length - 1) + ' * var(--gt-gap) + 2 * var(--gt-pad-x))');
      table.setAttribute('role', 'table');
      table.setAttribute('aria-label', body.getAttribute('aria-label') || table.getAttribute('aria-label') || spec.object);
      table.tabIndex = 0;
      body.setAttribute('role', 'rowgroup');
      body.removeAttribute('aria-label');
    }

    /* ② 表头 */
    if (head) {
      head.setAttribute('role', 'row');
      head.removeAttribute('aria-hidden');
      head.innerHTML = spec.headCols.map(function (c) {
        var inner = (typeof spec.headCell === 'function') ? spec.headCell(c.key) : null;
        if (inner == null) inner = (c.label == null ? '' : esc(c.label));
        return '<span role="columnheader"' + (c.key === 'ops' ? ' data-table-actions' : '') + (c.cls ? ' class="' + esc(c.cls) + '"' : '') +
          (c.align ? ' style="text-align:' + esc(c.align) + '"' : '') + '>' +
          inner + '</span>';
      }).join('');
    }

    var rows = spec.rows || [];

    /* ③ 空态：文案由页面给，这里只决定"没有行时整块换掉" */
    if (!rows.length) {
      body.innerHTML = spec.empty ? spec.empty() : '';
      if (total) total.textContent = '';
      if (spec.after) spec.after();
      return;
    }

    /* ④ 行骨架：一行 = headCols 个格子，顺序与表头一一对应 */
    body.innerHTML = rows.map(function (r) {
      var cls = spec.rowClass || '';
      if (spec.rowExtra) cls += ' ' + (spec.rowExtra(r) || '');
      var attr = spec.rowAttr ? (spec.rowAttr(r) || '') : '';
      return '<div class="' + cls.trim() + '" role="row"' + attr + '>' +
        spec.headCols.map(function (c) {
          var inner = spec.cell(c.key, r);
          var cattr = spec.cellAttr ? (spec.cellAttr(c.key, r) || '') : '';
          return '<span role="cell"' + (c.key === 'ops' ? ' data-table-actions' : '') + (c.cls ? ' class="' + esc(c.cls) + '"' : '') + cattr + '>' +
            (inner == null ? '' : inner) + '</span>';
        }).join('') +
      '</div>';
    }).join('');

    /* ⑤ 表尾 */
    if (total && spec.foot) total.textContent = spec.foot(rows);
    if (spec.after) spec.after();
  }

  window.List = { render: render, esc: esc, assert: assertSpec };
})();
