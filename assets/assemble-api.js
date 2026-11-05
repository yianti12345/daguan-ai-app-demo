/* assemble-api.js —— 组件配置页的「引用能力」面板
   形态照应用配置页的「装配组件」：同一个 .mask/.panel/.p-hd/.p-tabs/.p-batch/.p-list/.row。
   装配关系存在 CAP 的 compApis 里；能力只是生成时的知识，不做运行时绑定。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };
  var SPARK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"/><path d="M19 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>';
  /* AI 按钮的两态：空闲「AI 搜索」/ 生效「退出 AI」。文字换了才看得出点它会发生什么。 */
  function setAi(on) {
    var b = $('#api-ai'); if (!b) return;
    b.classList.toggle('is-on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = SPARK + (on ? '退出 AI' : 'AI 搜索');
  }

  var COMP = null, TAB = 'avail', KW = '', PICK = {}, AI_IDS = null;

  function ensure() {
    if ($('#api-mask')) return;
    document.body.insertAdjacentHTML('beforeend', ''
      + '<div class="mask" id="api-mask" data-open="false" role="dialog" aria-modal="true" aria-labelledby="api-title">'
      +   '<div class="panel">'
      +     '<div class="p-hd">'
      +       '<b id="api-title">装配能力</b>'
      +       '<div class="p-search"><input id="api-search" type="text" placeholder="搜能力，或说要做什么" aria-label="搜索能力" autocomplete="off">'
      +         '<button type="button" class="p-ai" id="api-ai" aria-pressed="false" title="让模型按你的描述找能力"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"/><path d="M19 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>AI 搜索</button></div>'
      +       '<button type="button" class="p-x" id="api-close" aria-label="关闭">'
      +         '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      +       '</button>'
      +     '</div>'
      +     '<div class="p-tabs" role="tablist" aria-label="能力范围">'
      +       '<button type="button" role="tab" class="p-tab" data-tab="avail" aria-selected="true">可装配 <span id="api-n-avail">0</span></button>'
      +       '<button type="button" role="tab" class="p-tab" data-tab="on" aria-selected="false">已装配 <span id="api-n-on">0</span></button>'
      +     '</div>'
      +     '<div class="p-batch">'
      +       '<label class="p-selall"><input type="checkbox" id="api-selall" aria-label="全选当前列表"><span>全选</span></label>'
      +       '<button type="button" class="btn-text" id="api-batch" disabled>装配（0）</button>'
      +     '</div>'
      +     '<div class="p-list" id="api-list" role="tabpanel"></div>'
      +     '<p class="p-note">装配＝把能力复制给模型参考。之后改或删能力，已生成的组件不受影响。</p>'
      +   '</div>'
      + '</div>');

    $('#api-close').addEventListener('click', close);
    $('#api-mask').addEventListener('mousedown', function (e) { if (e.target === this) close(); });
    $('#api-search').addEventListener('input', function () {
      KW = this.value.trim().toLowerCase(); PICK = {};
      if (AI_IDS) { AI_IDS = null; setAi(false); }
      render();
    });
    /* 回车＝按关键词筛，顺便退出 AI 结果。没有单独的「搜索」按钮，就是它。 */
    $('#api-search').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (AI_IDS) { AI_IDS = null; setAi(false); }
      render();
    });
    $('#api-ai').addEventListener('click', function () {
      var btn = this;
      if (AI_IDS) { AI_IDS = null; setAi(false); render(); return; }
      var q = $('#api-search').value.trim();
      if (!q) { toast('先说要找什么', 'error'); $('#api-search').focus(); return; }
      btn.classList.add('is-busy');
      AISearch.run(q, CAP.apis()).then(function (ids) {
        btn.classList.remove('is-busy');
        if (ids === null) { toast('AI 检索没连上，按关键词找', 'error'); return; }
        AI_IDS = ids; setAi(true);
        if (!ids.length) toast('没找到相关的');
        render();
      });
    });
    $$('#api-mask .p-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        TAB = t.getAttribute('data-tab'); PICK = {};
        $$('#api-mask .p-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        render();
      });
    });
    $('#api-selall').addEventListener('change', function () {
      var all = rows().list;
      if (this.checked) all.forEach(function (a) { PICK[a.id] = 1; });
      else PICK = {};
      render();
    });
    $('#api-batch').addEventListener('click', function () {
      var ids = Object.keys(PICK).filter(function (k) { return PICK[k]; });
      if (!ids.length) return;
      var cur = CAP.compApis(COMP);
      if (TAB === 'avail') {
        ids.forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
        CAP.setCompApis(COMP, cur); toast('已装配 ' + ids.length + ' 个');
      } else {
        CAP.setCompApis(COMP, cur.filter(function (id) { return ids.indexOf(id) < 0; }));
        toast('已移除 ' + ids.length + ' 个');
      }
      PICK = {}; render(); syncBadge();
    });
    $('#api-list').addEventListener('change', function (e) {
      var c = e.target.closest('.p-pick'); if (!c) return;
      var row = c.closest('.row'); if (!row) return;
      PICK[row.getAttribute('data-id')] = c.checked ? 1 : 0;
      syncBatch();
    });
    $('#api-list').addEventListener('click', function (e) {
      if (e.target.closest('[data-ai-try]')) { $('#api-ai').click(); return; }
      var b = e.target.closest('[data-do]'); if (!b) return;
      var row = b.closest('.row'); if (!row) return;
      var id = row.getAttribute('data-id');
      var ids = CAP.compApis(COMP);
      if (b.getAttribute('data-do') === 'add') {
        ids.push(id); CAP.setCompApis(COMP, ids); toast('已装配');
      } else {
        CAP.setCompApis(COMP, ids.filter(function (x) { return x !== id; })); toast('已移除');
      }
      delete PICK[id]; render(); syncBadge();
    });
    document.addEventListener('keydown', function (e) {
      var m = $('#api-mask');
      if (!m || m.getAttribute('data-open') !== 'true') return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = $$('.panel button, .panel input, .panel a[href]', m).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function installed() { return CAP.compApis(COMP); }

  /* 已装配里可能有能力被删掉的旧编号：照样列出来，给一键移除，不静默吞掉。 */
  function rows() {
    var on = installed();
    var alive = [], gone = [];
    on.forEach(function (id) {
      var a = CAP.apiById(id);
      if (a) alive.push(a); else gone.push(id);
    });
    var list;
    if (TAB === 'on') {
      list = alive.map(function (a) { return { id: a.id, api: a }; })
        .concat(gone.map(function (id) { return { id: id, api: null }; }));
    } else {
      list = CAP.apis().filter(function (a) { return on.indexOf(a.id) < 0; }).map(function (a) { return { id: a.id, api: a }; });
    }
    if (AI_IDS) {
      list = list.filter(function (x) { return AI_IDS.indexOf(x.id) >= 0; });
    } else if (KW) {
      list = list.filter(function (x) {
        var hay = x.api ? (x.api.name + ' ' + x.api.desc + ' ' + (x.api.source || '')) : ('已删除 ' + x.id);
        return hay.toLowerCase().indexOf(KW) >= 0;
      });
    }
    return { on: on, list: list };
  }

  function rowHtml(x, isOn) {
    var a = x.api;
    var pick = '<input type="checkbox" class="p-pick" aria-label="选择' + esc(a ? a.name : '已失效能力') + '"'
      + (PICK[x.id] ? ' checked' : '') + '>';
    if (!a) {
      return '<div class="row is-gone" data-id="' + esc(x.id) + '">'
        + '<div class="row-hd">' + pick + '<b>能力已删除</b><div class="act">'
        + '<button class="btn-uninstall" type="button" data-do="rm">移除</button></div></div>'
        + '<p class="row-desc">这条能力已从能力管理里删除，组件里只留了一个旧编号。</p>'
        + '<p class="row-meta">' + esc(x.id) + '</p></div>';
    }
    return '<div class="row" data-id="' + esc(a.id) + '">'
      + '<div class="row-hd">' + pick + '<b>' + esc(a.name) + '</b><div class="act">'
      + (isOn
          ? '<span class="on-tag">已装配</span><button class="btn-uninstall" type="button" data-do="rm">移除</button>'
          : '<button class="btn-install" type="button" data-do="add">装配</button>')
      + '</div></div>'
      + '<p class="row-desc">' + esc(a.desc) + '</p>'
      + '<p class="row-meta">' + esc(a.source || '未标注') + ' · ' + (a.on ? '已启用' : '已停用') + '</p>'
      + '</div>';
  }

  function syncBatch() {
    var n = Object.keys(PICK).filter(function (k) { return PICK[k]; }).length;
    var b = $('#api-batch');
    if (!b) return;
    b.textContent = (TAB === 'on' ? '移除（' : '装配（') + n + '）';
    b.disabled = !n;
    var all = rows().list;
    var sel = $('#api-selall');
    if (sel) sel.checked = all.length > 0 && n === all.length;
  }

  function render() {
    var r = rows(), ids = r.on;
    $('#api-n-avail').textContent = CAP.apis().filter(function (a) { return ids.indexOf(a.id) < 0; }).length;
    $('#api-n-on').textContent = ids.length;
    var list = $('#api-list');
    if (!r.list.length) {
      /* 关键词一条都没命中时不让人干瞪眼：就地给 AI 入口。整句话的需求本来就搜不到关键词，
         这一步比在头部再摆一颗「搜索」按钮有用得多。 */
      var tryAi = KW && !AI_IDS && TAB === 'avail';
      list.innerHTML = '<div class="p-empty">'
        + (KW ? '没有匹配的能力'
              : (TAB === 'on' ? '还没装配任何能力' : '能装的都装上了。去「能力配置」导入更多。'))
        + (tryAi ? '<button type="button" class="p-ai-try" data-ai-try>用 AI 搜这句话</button>' : '')
        + '</div>';
      syncBatch();
      return;
    }
    list.innerHTML = r.list.map(function (x) { return rowHtml(x, ids.indexOf(x.id) >= 0); }).join('');
    syncBatch();
  }

  function syncBadge() {
    var el = $('#api-count');
    if (el) el.textContent = '已装 ' + CAP.compApis(COMP).length;
  }

  function open(compId) {
    ensure();
    COMP = compId || 'draft';
    TAB = 'avail'; KW = ''; PICK = {}; AI_IDS = null;
    $('#api-search').value = '';
    var aib = $('#api-ai'); if (aib) aib.classList.remove('is-busy');
    setAi(false);
    $$('#api-mask .p-tab').forEach(function (x) {
      x.setAttribute('aria-selected', String(x.getAttribute('data-tab') === 'avail'));
    });
    render(); syncBadge();
    $('#api-mask').setAttribute('data-open', 'true');
    setTimeout(function () { $('#api-search').focus(); }, 0);
  }

  function close() {
    var m = $('#api-mask'); if (!m) return;
    m.setAttribute('data-open', 'false');
    PICK = {};
    syncBadge();
  }

  window.AssembleApi = {
    open: open,
    close: close,
    count: function (id) { return CAP.compApis(id).length; },
    syncBadge: function (id) { if (id) COMP = id; syncBadge(); }
  };

  /* 自动绑定：组件页顶栏那颗按钮。id 从地址栏拿，没有就是新建中的草稿。 */
  (function bind() {
    var btn = document.getElementById('act-apis');
    if (!btn) return;
    var id = 'draft';
    try { id = new URLSearchParams(location.search).get('id') || 'draft'; } catch (e) { id = 'draft'; }
    COMP = id;
    syncBadge();
    btn.addEventListener('click', function () { open(id); });
  })();
})();
