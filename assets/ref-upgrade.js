/* ★2026-11-04（m06113 需求一）：组件库 → 引用管理。
   一个组件被哪些应用装着、谁落后、谁自定义过这一块，都在这里一次看清。
   两个升级入口：全部升级（无视当前筛选/分页）与批量升级（N）（只认勾选）。
   升级只改应用的装配版本 a.compVer[compId]，不碰应用内容、不动客户授权版本；
   只讲两态：待升级 / 已最新（2026-11-04 用户否决「需手动 / 已自定义」）。

   异步口径：前端按 500ms/条分批执行，关掉弹窗也继续跑；完成 toast + 报告。
   刷新会丢任务 —— 与用户拍板一致，不假装后端队列。 */
(function () {
  'use strict';
  var PAGE = 10;
  var st = null;
  var dlg = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmt(v) {
    if (v == null || v === '') return '—';
    var s = String(v);
    return /^v\d+$/.test(s) ? s : 'v' + s;
  }
  function stateName(a) {
    var s = a && a.status;
    if (s === '未发布' || s === '已下架') return '未上架';
    if (s === '内测中') return '内测中';
    return '已上架';
  }
  function compName() { return st.comp ? st.comp.name : ''; }
  /* 当前视图（按页签+搜索筛过）里落后的那些。「全部升级（N）」的 N 就是它的长度 ——
     屏幕上有几个待升级，按钮就说几个；不拿"库里的总数"冒充，否则筛选后会出现
     「我只看到 3 个，它却说要升 37 个」。 */
  function behindAll() { return view().filter(function (r) { return r.behind; }); }
  function behindEvery() { return st.refs.filter(function (r) { return r.behind; }); }
  /* ★2026-11-04（用户：「没有所谓的需手动和已自定义！给我移除掉」）：
     引用管理只讲一件事 —— 谁落后了、升到最新。没有第三种状态。 */
  function selectable() { return st.refs.filter(function (r) { return r.behind; }); }
  function picked() { return selectable().filter(function (r) { return st.picks[r.id]; }); }

  function build() {
    if (dlg) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div class="ru-veil" id="ru-veil" hidden>' +
      ' <div class="ru-dlg" role="dialog" aria-modal="true" aria-labelledby="ru-title">' +
      '  <header class="ru-hd"><div class="ru-hd-t"><h2 id="ru-title">引用管理</h2>' +
      '   <p class="ru-sub" id="ru-sub"></p></div>' +
      '   <button type="button" class="ru-x" data-ru="close" aria-label="关闭">×</button></header>' +
      '  <div class="ru-stats" id="ru-stats"></div>' +
      '  <div class="ru-prog" id="ru-prog" hidden><div class="ru-prog-h"><span class="ru-spin" aria-hidden="true"></span>' +
      '   <b id="ru-prog-t">正在升级</b><span id="ru-prog-n"></span>' +
      '   <button type="button" class="ru-pg" id="ru-stop">停止</button></div>' +
      '   <div class="ru-bar"><i id="ru-bar"></i></div><p class="ru-prog-s">关掉这个窗口也会继续；刷新页面会中断。</p></div>' +
      '  <div class="ru-tools">' +
      '   <div class="ru-tabs" role="tablist"><button type="button" class="ru-tab on" data-tab="all" role="tab">全部</button>' +
      '    <button type="button" class="ru-tab" data-tab="behind" role="tab">待升级</button></div>' +
      '   <input class="ru-search" id="ru-search" type="search" placeholder="搜索应用" aria-label="搜索应用">' +
      '   <button type="button" class="btn primary ru-all" id="ru-all">全部升级</button>' +
      '   <button type="button" class="btn ru-batch" id="ru-batch" disabled>批量升级（0）</button></div>' +
      '  <div class="ru-list" id="ru-list" role="table" aria-label="引用应用"></div>' +
      '  <div class="ru-report" id="ru-report" hidden></div>' +
      '  <footer class="ru-ft"><span id="ru-count"></span>' +
      '   <div class="ru-pager"><button type="button" class="ru-pg" id="ru-prev">上一页</button>' +
      '    <span id="ru-page"></span><button type="button" class="ru-pg" id="ru-next">下一页</button></div></footer>' +
      ' </div></div>');
    dlg = document.getElementById('ru-veil');
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) close();
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      /* ★2026-11-04：引用管理的页签也按 APG Tabs 走方向键（与装配面板同一套操作）。 */
      var cur = e.target.closest && e.target.closest('.ru-tab');
      if (cur && /ArrowLeft|ArrowRight|Home|End/.test(e.key)) {
        var tabs = Array.prototype.slice.call(dlg.querySelectorAll('.ru-tab'));
        var i = tabs.indexOf(cur);
        var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
          : e.key === 'Home' ? 0 : tabs.length - 1;
        e.preventDefault();
        var to = tabs[(n + tabs.length) % tabs.length];
        to.focus(); to.click();
        return;
      }
      if (e.key !== 'Tab') return;
      var f = dlg.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('click', function (e) {
      var t = e.target.closest('[data-ru]');
      if (t) {
        var a = t.getAttribute('data-ru');
        if (a === 'close') close();
        if (a === 'report-close') { st.report = null; lastReport = null; render(); }
        return;
      }
      var tab = e.target.closest('[data-tab]');
      if (tab) { st.tab = tab.getAttribute('data-tab'); st.page = 0; render(); return; }
      var pick = e.target.closest('[data-pick]');
      if (pick) {
        var id = pick.getAttribute('data-pick');
        if (pick.checked) st.picks[id] = 1; else delete st.picks[id];
        renderRows(); renderTools(); return;
      }
      var one = e.target.closest('[data-one]');
      if (one) { askRun([one.getAttribute('data-one')]); return; }
      var pg = e.target.closest('[data-pg]');
      if (pg) { st.page += Number(pg.getAttribute('data-pg')); render(); return; }
    });
    dlg.querySelector('#ru-search').addEventListener('input', function () {
      st.q = this.value.trim(); st.page = 0; render();
    });
    dlg.querySelector('#ru-all').addEventListener('click', function () { askRun(null); });
    dlg.querySelector('#ru-batch').addEventListener('click', function () {
      askRun(picked().map(function (r) { return r.id; }));
    });
    dlg.querySelector('#ru-stop').addEventListener('click', function () {
      /* 1000 个约 8 秒，但"点了停不下来"本身就是一种焦虑：给了停止键，
         停的是剩下的，已经升完的不回滚（回滚是另一件事，见客户授权的撤销）。 */
      if (!st.busy) return;
      clearTimeout(st.timer);
      st.cancelled = true;
      finish();
    });
    dlg.querySelector('#ru-prev').addEventListener('click', function () { if (st.page > 0) { st.page--; render(); } });
    dlg.querySelector('#ru-next').addEventListener('click', function () {
      if (st.page < pages() - 1) { st.page++; render(); }
    });
  }

  function open(compId) {
    var c = DB.compById(compId);
    if (!c) { UIK.toast('这个组件不在了'); return; }
    build();
    if (!st || st.id !== compId) {
      st = { id: compId, comp: c, refs: [], picks: {}, page: 0, tab: 'all', q: '', busy: false, timer: null, progress: null };
      st.report = (lastReport && lastReport.id === compId) ? lastReport : null;
    }
    st.comp = c;
    st.refs = DB.compRefs(compId);
    dlg.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    refresh();
    var f = dlg.querySelector('[data-ru="close"]');
    if (f) f.focus();
  }
  function close() {
    if (!dlg) return;
    dlg.hidden = true;
    document.documentElement.style.overflow = '';
  }

  function pages() { return Math.max(1, Math.ceil(view().length / PAGE)); }
  function view() {
    return st.refs.filter(function (r) {
      if (st.tab === 'behind' && !r.behind) return false;
      if (st.q && String(r.name).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    });
  }

  function refresh() {
    st.refs = DB.compRefs(st.id);
    var s = DB.compUpgradeStats(st.id);
    dlg.querySelector('#ru-title').textContent = '引用管理 · ' + compName();
    /* 2026-11-05：原来这里挂着一句"只看谁落后了；升级只换装配版本…" —— 统计条和确认框
       各说了一遍，这是第三遍。留空并隐藏，不再占一行高度。 */
    var sub = dlg.querySelector('#ru-sub');
    if (sub) { sub.textContent = ''; sub.hidden = true; }
    dlg.querySelector('#ru-stats').innerHTML =
      '<span class="ru-stat"><b>' + s.total + '</b> 个应用在用</span>' +
      '<span class="ru-stat warn"><b>' + s.behind + '</b> 个待升级</span>' +
      '';
    render();
  }

  function render() {
    renderTools();
    renderRows();
    renderReport();
  }

  function renderTools() {
    var n = behindAll().length, pn = picked().length;
    var every = behindEvery().length;
    var allBtn = dlg.querySelector('#ru-all');
    allBtn.textContent = n ? '全部升级（' + n + '）' : '全部升级';
    allBtn.disabled = st.busy || n === 0;
    /* 筛过的时候，全部升级只管筛出来的那些 —— 鼠标停上去把这件事说清楚。 */
    allBtn.title = (st.q || st.tab === 'behind')
      ? ('把当前筛选里的 ' + n + ' 个应用升到 ' + fmt(st.comp.ver) + '（库里共 ' + every + ' 个待升级）')
      : ('把 ' + n + ' 个待升级应用一次升到 ' + fmt(st.comp.ver));
    var b = dlg.querySelector('#ru-batch');
    b.textContent = '批量升级（' + pn + '）';
    b.disabled = st.busy || pn === 0;
    /* 0 个勾选时整颗不出现 —— 与装配面板、客户授权同一口径：
       常驻一颗「批量升级（0）」等于在页面上摆一个永远点不动的东西。 */
    b.hidden = pn === 0;
    /* 勾选跨页保留：括号里是勾选总数，说清"有几页之外"的。 */
    b.title = pn ? ('只升勾选的 ' + pn + ' 个') : '';
    dlg.querySelectorAll('.ru-tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-tab') === st.tab);
      t.setAttribute('aria-selected', t.getAttribute('data-tab') === st.tab ? 'true' : 'false');
    });
  }

  function renderRows() {
    var list = view();
    var total = list.length;
    var cur = Math.min(st.page, pages() - 1);
    st.page = cur;
    var rows = list.slice(cur * PAGE, cur * PAGE + PAGE);
    /* ★2026-11-04（用户：「我理解多选应该是在下面列表每行的前面吧」）：
       能勾选的只有"落后且没被应用改过"的行；一页里连一行能勾的都没有时，
       表头那颗"全选"就是一颗点了没意义的空勾 —— 不渲染它。 */
    var pageCan = rows.filter(function (r) { return r.behind; });
    var head = '<div class="ru-thead" role="row">' +
      '<span class="ru-c">' + (pageCan.length
        ? '<input type="checkbox" id="ru-selall" aria-label="全选本页可升级应用"' + (st.busy ? ' disabled' : '') + '>'
        : '') + '</span>' +
      '<span>应用</span><span>装配版本</span><span>状态</span><span class="ru-a">操作</span></div>';
    if (!rows.length) {
      dlg.querySelector('#ru-list').innerHTML = head + '<div class="ru-empty">' +
        (st.tab === 'behind' ? '没有落后的应用' : '还没有应用装配这个组件') + '</div>';
      countLine(0);
      return;
    }
    var html = rows.map(function (r) {
      var can = r.behind && !st.busy;
      var stat = !r.behind ? '<span class="ru-ok">已最新</span>' : '<span class="ru-warn">待升级</span>';
      var act = r.behind ? '<button type="button" class="ru-one" data-one="' + esc(r.id) + '"' + (st.busy ? ' disabled' : '') + '>升级</button>' : '<span class="ru-dash">—</span>';
      return '<div class="ru-row" role="row" data-row="' + esc(r.id) + '">' +
        '<span class="ru-c">' + (can ? '<input type="checkbox" data-pick="' + esc(r.id) + '" aria-label="选择 ' + esc(r.name) + '"' + (st.picks[r.id] ? ' checked' : '') + '>' : '') + '</span>' +
        '<span class="ru-app"><b>' + esc(r.name) + '</b><small>' + esc(stateName(r.app)) + ' · ' + esc(r.id) + '</small></span>' +
        '<span class="ru-v">' + '<span class="ru-vf">' + esc(fmt(r.have)) + '</span>' +
          (r.behind ? '<span class="ru-arr">→</span><b class="ru-vt">' + esc(fmt(r.latest)) + '</b>' : '') + '</span>' +
        '<span class="ru-st">' + stat + '</span><span class="ru-a">' + act + '</span></div>';
    }).join('');
    dlg.querySelector('#ru-list').innerHTML = head + html;
    countLine(total);
    var all = dlg.querySelector('#ru-selall');
    var pagePicked = pageCan.filter(function (r) { return st.picks[r.id]; });
    if (all) {
      all.checked = pageCan.length > 0 && pagePicked.length === pageCan.length;
      all.indeterminate = pagePicked.length > 0 && pagePicked.length < pageCan.length;
      all.onchange = function () {
        var on = this.checked;
        pageCan.forEach(function (r) { if (on) st.picks[r.id] = 1; else delete st.picks[r.id]; });
        renderRows(); renderTools();
      };
    }
    dlg.querySelector('#ru-page').textContent = '第 ' + (cur + 1) + ' / ' + pages() + ' 页';
    dlg.querySelector('#ru-prev').disabled = cur === 0;
    dlg.querySelector('#ru-next').disabled = cur >= pages() - 1;
  }
  function countLine(total) {
    /* 勾选跨页、跨筛选都保留：这里把"勾了几个"白纸黑字写在页脚，
       否则筛完之后屏幕上没有勾、按钮却写着批量升级（2），看着像出错。 */
    var pn = picked().length;
    /* 只有"勾的里面有一部分不在这张表上"时才补那句括号，否则是废话。 */
    var onView = picked().filter(function (r) {
      return view().some(function (x) { return x.id === r.id; });
    }).length;
    dlg.querySelector('#ru-count').textContent = '共 ' + total + ' 个引用'
      + (pn ? ' · 已勾选 ' + pn + ' 个' + (pn > onView ? '（另有 ' + (pn - onView) + ' 个在筛选外）' : '') : '');
  }

  function askRun(ids) {
    if (st.busy) return;
    var targets = ids ? st.refs.filter(function (r) { return ids.indexOf(r.id) >= 0 && r.behind; }) : behindAll();
    if (!targets.length) { UIK.toast(ids ? '选中的应用都已经是最新版' : '没有需要升级的应用'); return; }
    /* 与客户授权同一口径：只说"3 个"等于没说是哪几个。列前三家，其余给总数。 */
    var who = targets.slice(0, 3).map(function (r) { return r.name; }).join('、');
    var body = '<p>将把 <b class="num">' + targets.length + '</b> 个应用对「' + esc(compName()) + '」的装配版本升到 <b class="num">' + fmt(st.comp.ver) + '</b>。</p>' +
      '<p class="ru-cf-quiet">' + esc(who) + (targets.length > 3 ? ' 等 ' + targets.length + ' 个' : '') + '</p>' +
      ((!ids && (st.q || st.tab === 'behind'))
        ? '<p class="ru-cf-quiet">范围：当前筛选里的 ' + targets.length + ' 个（库里共 ' + behindEvery().length + ' 个待升级）。</p>'
        : '') +
      '<p class="ru-cf-quiet">只改装配版本；应用内容与客户授权版本都不动。</p>';
    Confirm.ask({
      title: ids && ids.length === 1 ? '升级这个应用？' : '升级「' + compName() + '」的引用',
      body: body,
      ok: ids && ids.length === 1 ? '开始升级' : ('全部升级（' + targets.length + '）'),
      cancel: '取消',
      onOk: function () { start(targets.map(function (r) { return r.id; })); }
    });
  }

  var lastReport = null;

  function start(ids) {
    st.busy = true;
    st.cancelled = false;
    st.report = null;
    st.progress = { total: ids.length, done: 0, ok: [], skipped: [], failed: [] };
    dlg.querySelector('#ru-prog').hidden = false;
    dlg.querySelector('#ru-stop').hidden = false;
    renderTools(); renderRows();
    /* ★2026-11-05：原来 500ms/条 —— 37 个要 18 秒，1000 个要 8 分钟，中间还只能干看着。
       改成每拍 10 个（80ms），1000 个约 8 秒；进度条照样能看见在走。 */
    var i = 0, BATCH = 10;
    function step() {
      if (i >= ids.length) return finish();
      var end = Math.min(ids.length, i + BATCH);
      while (i < end) {
        var res = DB.upgradeCompRefs(st.id, [ids[i]]);
        st.progress.ok = st.progress.ok.concat(res.ok);
        st.progress.skipped = st.progress.skipped.concat(res.skipped);
        st.progress.failed = st.progress.failed.concat(res.failed);
        i++; st.progress.done++;
      }
      paintProgress();
      st.timer = setTimeout(step, 80);
    }
    paintProgress();
    st.timer = setTimeout(step, 80);
  }

  function paintProgress() {
    var p = st.progress;
    if (!p) return;
    dlg.querySelector('#ru-prog-t').textContent = '正在升级';
    dlg.querySelector('#ru-prog-n').textContent = p.done + ' / ' + p.total;
    dlg.querySelector('#ru-bar').style.width = Math.round(p.done / Math.max(1, p.total) * 100) + '%';
  }

  function finish() {
    var p = st.progress;
    st.busy = false;
    st.timer = null;
    st.progress = null;
    dlg.querySelector('#ru-prog').hidden = true;
    var stopBtn = dlg.querySelector('#ru-stop');
    if (stopBtn) stopBtn.hidden = true;
    st.report = {
      id: st.id, at: new Date().toLocaleString('zh-CN', { hour12: false }),
      total: p.total, done: p.done, cancelled: !!st.cancelled,
      ok: p.ok, skipped: p.skipped, failed: p.failed
    };
    lastReport = st.report;
    st.picks = {};
    st.refs = DB.compRefs(st.id);
    render();
    var msg = (st.cancelled ? '已停止 · ' : '') + '已升级 ' + p.ok.length + ' 个应用'
      + (st.cancelled ? '（还有 ' + (p.total - p.done) + ' 个没跑）' : '');
    if (p.failed.length) msg += ' · 失败 ' + p.failed.length + ' 个';
    UIK.toast(msg);
    if (typeof window.onCompRefsUpgraded === 'function') window.onCompRefsUpgraded(st.id);
  }

  function renderReport() {
    var box = dlg.querySelector('#ru-report');
    var r = st.report;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var skipped = r.skipped || [];
    var failed = r.failed || [];
    box.hidden = false;
    box.innerHTML = '<div class="ru-rep-h"><b>升级结果' + (r.cancelled ? '（已停止）' : '') + '</b><span>' + esc(r.at) + '</span></div>' +
      '<div class="ru-rep-n"><span class="ok"><b>' + (r.ok ? r.ok.length : 0) + '</b> 成功</span>' +
      '<span class="' + (skipped.length ? 'warn' : '') + '"><b>' + skipped.length + '</b> 跳过</span>' +
      '<span class="' + (failed.length ? 'bad' : '') + '"><b>' + failed.length + '</b> 失败</span></div>' +
      (skipped.length ? '<div class="ru-rep-list"><b>跳过：</b>' +
        skipped.map(function (x) { return '<span>' + esc(x.name) + '</span>'; }).join('') + '</div>' : '') +
      (failed.length ? '<div class="ru-rep-list bad"><b>失败：</b>' +
        failed.map(function (x) { return '<span>' + esc(x.name) + ' · ' + esc(x.reason) + '</span>'; }).join('') + '</div>' : '') +
      '<button type="button" class="ru-rep-x" data-ru="report-close">知道了</button>';
  }

  window.RefUpgrade = { open: open, close: close };
})();
