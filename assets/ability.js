/* ability.js —— 一个能力：名称 + 说明 + 接口清单 + MD 文档（只读）
   能力只是容器：apiIds 引用池子，界面不复制接口字段。
   MD 是产物，由 AI 生成，界面不给手改（改了就说不清是谁写的）。 */
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

  /* MD 是给模型的，但人也要能读：只做最小渲染（标题/加粗/行内代码），
     不引第三方库、不搞完整 markdown。 */
  function mdHtml(md) {
    var e = esc;
    return String(md || '').split(/\n{2,}/).map(function (blk) {
      var h = blk.match(/^#{1,4}\s+(.+)$/m);
      if (h && blk.trim().indexOf(h[0]) === 0) {
        return '<p style="margin:0 0 8px;font-size:var(--font-size-heading);font-weight:600;color:var(--color-text-primary)">'
          + e(h[1]) + '</p>';
      }
      var t = e(blk)
        .replace(/\*\*([^*]+)\*\*/g, '<b style="font-weight:600">$1</b>')
        .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-family-mono);font-size:var(--font-size-caption);background:var(--surface-sunken-2);border-radius:var(--radius-xs);padding:0 4px">$1</code>')
        .replace(/\n/g, '<br>');
      return '<p style="margin:0 0 10px">' + t + '</p>';
    }).join('');
  }

  var ID = '';
  var MDTXT = {
    ready: function (b) { return 'MD 已就绪' + (b.docAt ? ' · ' + b.docAt : ''); },
    run:   function () { return 'MD 生成中'; },
    fail:  function () { return 'MD 生成失败'; },
    none:  function () { return 'MD 还没生成'; }
  };

  /* 新建：先建一条空记录再改地址栏，刷新不会丢。 */
  function boot() {
    var q = new URLSearchParams(location.search);
    ID = q.get('id') || 'new';
    if (ID === 'new') {
      var b = CAP.addAbility({ name: '', intro: '', project: q.get('project') || '' });
      location.replace('ability.html?id=' + encodeURIComponent(b.id));
      return false;
    }
    if (!CAP.abilityById(ID)) {
      toast('这个能力不存在了', 'error');
      setTimeout(function () { location.href = 'abilities.html'; }, 800);
      return false;
    }
    return true;
  }

  var B = null;

  function paint() {
    B = CAP.abilityById(ID);
    if (!B) return;
    $('#crumb-name').textContent = B.name || '新建能力';
    document.title = (B.name || '新建能力') + ' · 能力详情';
    $('#f-name').value = B.name || '';
    $('#f-intro').value = B.intro || '';
    var st = MDTXT[B.docState] || MDTXT.none;
    $('#md-state').textContent = st(B);
    $('#doc').innerHTML = B.doc
      ? mdHtml(B.doc)
      : '<span class="abt-hint">还没有 MD。保存后由 AI 汇总生成。</span>';
    paintApis();
    syncDirty();
  }

  function paintApis() {
    var rows = CAP.abilityApis(ID);
    $('#api-title').textContent = '接口清单（' + rows.length + '）';
    var box = $('#api-list');
    if (!rows.length) {
      box.innerHTML = '<div class="abt-row" style="grid-template-columns:1fr;color:var(--color-text-tertiary)">还没有接口，点上面「添加接口」从池子里挑</div>';
      return;
    }
    box.innerHTML = rows.map(function (x) {
      if (x.missing) {
        return '<div class="abt-row is-gone" data-id="' + esc(x.id) + '">'
          + '<span>接口已删除</span><span class="abt-m">—</span><span class="abt-p">' + esc(x.id) + '</span>'
          + '<button class="abt-op is-danger" type="button" data-act="rm" data-id="' + esc(x.id) + '">移除</button></div>';
      }
      var a = x.api;
      return '<div class="abt-row" data-id="' + esc(a.id) + '">'
        + '<span>' + esc(a.name) + '</span>'
        + '<span class="abt-m">' + esc(a.method || 'GET') + '</span>'
        + '<span class="abt-p" title="' + esc(a.path || '') + '">' + esc(a.path || '—') + '</span>'
        + '<button class="abt-op is-danger" type="button" data-act="rm" data-id="' + esc(a.id) + '">移除</button></div>';
    }).join('');
  }

  /* 保存按钮：没改过就是灰的，改一个字才亮。 */
  function syncDirty() {
    if (!B) return;
    var n = $('#f-name').value.trim(), i = $('#f-intro').value.trim();
    var dirty = n !== (B.name || '') || i !== (B.intro || '');
    var btn = $('#act-save');
    btn.disabled = !(dirty && n);
  }

  $('#f-name').addEventListener('input', syncDirty);
  $('#f-intro').addEventListener('input', syncDirty);

  $('#act-save').addEventListener('click', function () {
    var n = $('#f-name').value.trim(), i = $('#f-intro').value.trim();
    if (!n) { toast('填能力名称', 'error'); $('#f-name').focus(); return; }
    CAP.updateAbility(ID, { name: n, intro: i });
    paint(); toast('已保存');
  });

  $('#api-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="rm"]'); if (!b) return;
    var aid = b.getAttribute('data-id');
    var cur = (CAP.abilityById(ID).apiIds || []).filter(function (x) { return x !== aid; });
    CAP.updateAbility(ID, { apiIds: cur });
    paintApis(); toast('已移除');
  });

  /* ── 添加接口：从一个面板里勾。只勾，不填任何字段。 ── */
  function openPicker() {
    var cur = CAP.abilityById(ID).apiIds || [];
    var avail = CAP.apis().filter(function (a) { return cur.indexOf(a.id) < 0; });
    if (!avail.length) { toast('池子里没有可加的接口，先「导入项目」'); return; }
    var pick = {};
    document.body.insertAdjacentHTML('beforeend',
      '<div class="nf-mask" id="pk-mask"><div class="nf" role="dialog" aria-modal="true" aria-labelledby="pk-t">'
      + '<div class="nf-hd"><b id="pk-t">添加接口</b>'
      + '<button type="button" class="icon-btn" id="pk-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
      + '<div class="nf-bd" id="pk-list"></div>'
      + '<div class="nf-ft"><span class="it-sp"></span>'
      + '<button type="button" class="btn ghost" id="pk-cancel">取消</button>'
      + '<button type="button" class="btn primary" id="pk-ok" disabled>添加</button></div>'
      + '</div></div>');
    $('#pk-list').innerHTML = avail.map(function (a) {
      return '<label style="display:grid;grid-template-columns:20px minmax(0,1fr) 56px 160px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--color-border-hairline);font-size:var(--font-size-body);cursor:pointer">'
        + '<input type="checkbox" data-pick="' + esc(a.id) + '">'
        + '<span>' + esc(a.name) + '</span>'
        + '<span class="abt-m">' + esc(a.method || 'GET') + '</span>'
        + '<span class="abt-p">' + esc(a.path || '—') + '</span></label>';
    }).join('');
    function sync() {
      var n = Object.keys(pick).length;
      $('#pk-ok').disabled = !n;
      $('#pk-ok').textContent = n ? ('添加 ' + n + ' 个') : '添加';
    }
    $('#pk-list').addEventListener('change', function (e) {
      var c = e.target.closest('[data-pick]'); if (!c) return;
      if (c.checked) pick[c.getAttribute('data-pick')] = 1; else delete pick[c.getAttribute('data-pick')];
      sync();
    });
    function close() { var m = $('#pk-mask'); if (m) m.remove(); }
    $('#pk-x').addEventListener('click', close);
    $('#pk-cancel').addEventListener('click', close);
    $('#pk-ok').addEventListener('click', function () {
      var ids = (CAP.abilityById(ID).apiIds || []).concat(Object.keys(pick));
      CAP.updateAbility(ID, { apiIds: ids });
      close(); paintApis(); toast('已添加 ' + Object.keys(pick).length + ' 个接口');
    });
  }

  var sec = $('.abt-sec');
  if (sec) {
    sec.insertAdjacentHTML('beforeend', '<button type="button" class="abt-op" id="act-add" style="margin-left:auto">＋ 添加接口</button>');
    $('#act-add').addEventListener('click', openPicker);
  }

  if (boot()) paint();
})();
