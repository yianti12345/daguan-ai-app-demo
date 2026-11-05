/* assemble-api.js —— 组件配置页的「装配接口」面板
   形态照应用配置页的「装配组件」：同一个 .mask/.panel/.p-hd/.p-tabs/.p-list/.row，
   不另造抽屉、不另造弹层。装配关系存在 CAP 的 compApis 里，不接口运行时。 */
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

  var COMP = null, TAB = 'avail', KW = '';

  function ensure() {
    if ($('#api-mask')) return;
    var html = ''
      + '<div class="mask" id="api-mask" data-open="false" role="dialog" aria-modal="true" aria-labelledby="api-title">'
      +   '<div class="panel">'
      +     '<div class="p-hd">'
      +       '<b id="api-title">装配接口</b>'
      +       '<div class="p-search"><input id="api-search" type="text" placeholder="搜索接口名或描述" aria-label="搜索接口" autocomplete="off"></div>'
      +       '<button type="button" class="p-x" id="api-close" aria-label="关闭">'
      +         '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      +       '</button>'
      +     '</div>'
      +     '<div class="p-tabs" role="tablist" aria-label="接口范围">'
      +       '<button type="button" role="tab" class="p-tab" data-tab="avail" aria-selected="true">可装配 <span id="api-n-avail">0</span></button>'
      +       '<button type="button" role="tab" class="p-tab" data-tab="on" aria-selected="false">已装配 <span id="api-n-on">0</span></button>'
      +     '</div>'
      +     '<div class="p-list" id="api-list" role="tabpanel"></div>'
      +   '</div>'
      + '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    $('#api-close').addEventListener('click', close);
    $('#api-mask').addEventListener('mousedown', function (e) { if (e.target === this) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('#api-mask').getAttribute('data-open') === 'true') close();
    });
    $('#api-search').addEventListener('input', function () { KW = this.value.trim().toLowerCase(); render(); });
    $$('#api-mask .p-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        TAB = t.getAttribute('data-tab');
        $$('#api-mask .p-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        render();
      });
    });
    $('#api-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-do]'); if (!b) return;
      var row = b.closest('.row'); if (!row) return;
      var id = row.getAttribute('data-id');
      var ids = CAP.compApis(COMP);
      if (b.getAttribute('data-do') === 'add') {
        ids.push(id); CAP.setCompApis(COMP, ids); toast('已装配');
      } else {
        CAP.setCompApis(COMP, ids.filter(function (x) { return x !== id; })); toast('已移除');
      }
      render(); syncBadge();
    });
  }

  function installed() { return CAP.compApis(COMP); }

  function rows() {
    var on = installed();
    var all = CAP.apis().filter(function (a) {
      if (TAB === 'on' ? on.indexOf(a.id) < 0 : on.indexOf(a.id) >= 0) return false;
      if (!KW) return true;
      return (a.name + ' ' + a.desc + ' ' + (a.source || '')).toLowerCase().indexOf(KW) >= 0;
    });
    return { on: on, all: all };
  }

  function rowHtml(a, isOn) {
    return '<div class="row" data-id="' + esc(a.id) + '">'
      + '<div class="row-hd"><b>' + esc(a.name) + '</b><div class="act">'
      + (isOn
          ? '<span class="on-tag">已装配</span><button class="btn-uninstall" type="button" data-do="rm">移除</button>'
          : '<button class="btn-install" type="button" data-do="add">装配</button>')
      + '</div></div>'
      + '<p class="row-desc">' + esc(a.desc) + '</p>'
      + '<p class="row-meta">' + esc(a.source || '未标注') + ' · ' + (a.on ? '已启用' : '已停用') + '</p>'
      + '</div>';
  }

  function render() {
    var r = rows();
    var ids = r.on;
    $('#api-n-avail').textContent = CAP.apis().filter(function (a) { return ids.indexOf(a.id) < 0; }).length;
    $('#api-n-on').textContent = ids.length;
    var list = $('#api-list');
    if (!r.all.length) {
      list.innerHTML = '<div class="p-empty">'
        + (KW ? '没有匹配的接口'
              : (TAB === 'on' ? '还没装配任何接口'
                              : '能装的都装上了。去能力管理登记更多接口。'))
        + '</div>';
      return;
    }
    list.innerHTML = r.all.map(function (a) { return rowHtml(a, ids.indexOf(a.id) >= 0); }).join('');
  }

  function syncBadge() {
    var el = $('#api-count');
    if (el) el.textContent = '已装 ' + CAP.compApis(COMP).length;
  }

  function open(compId) {
    ensure();
    COMP = compId || 'draft';
    TAB = 'avail'; KW = '';
    $('#api-search').value = '';
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
    syncBadge();
  }

  window.AssembleApi = {
    open: open,
    close: close,
    count: function (id) { return CAP.compApis(id).length; },
    syncBadge: function (id) { if (id) COMP = id; syncBadge(); }
  };
})();

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
