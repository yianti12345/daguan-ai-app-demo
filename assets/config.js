/* config.js —— 通用配置：对话模型（按场景绑定）+ 模型清单
   列表骨架交给 List；模型数据在 CAP 里，和接口/技能同一份存储。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };
  var ask = function (o) {
    if (window.Confirm && Confirm.ask) Confirm.ask(o);
    else if (window.confirm(o.body || '')) o.onOk && o.onOk();
  };

  var KIND = { chat: '对话', vision: '视觉', embed: '向量', rerank: '重排' };
  var EDIT_ID = null;

  function chatModels() {
    return CAP.models().filter(function (m) { return m.kind === 'chat' && m.on; });
  }

  function paintScenes() {
    var box = $('#scenes');
    box.innerHTML = CAP.scenes().map(function (s) {
      var opts = chatModels().map(function (m) {
        return '<option value="' + esc(m.id) + '" title="' + esc(m.name) + '"' + (m.id === s.model ? ' selected' : '') + '>'
          + esc(m.label) + '</option>';
      }).join('');
      return '<div class="scene" data-key="' + esc(s.key) + '">'
        + '<div><b>' + esc(s.name) + '</b><p>' + esc(s.desc) + '</p></div>'
        + '<span class="m-dim">' + (chatModels().length ? '' : '没有可用的对话模型') + '</span>'
        + '<label class="field"><select data-scene="' + esc(s.key) + '" aria-label="' + esc(s.name) + '使用的模型">' + opts + '</select></label>'
        + '</div>';
    }).join('');
  }

  function paintModels() {
    var rows = CAP.models();
    List.render(SPEC['config.html'], {
      table: '.cfg-table', head: '#head', body: '#list', total: '#total',
      rows: rows,
      rowClass: 'gtable-row',
      cell: function (key, r) {
        if (key === 'name') {
          return '<a class="m-name" href="#" data-act="edit" data-id="' + esc(r.id) + '">' + esc(r.label || r.name) + '</a>'
            + (r.isDefault ? ' <span class="m-dim">默认</span>' : '')
            + '<div class="m-dim" style="font-size:var(--font-size-caption)">' + esc(r.name) + '</div>';
        }
        if (key === 'vendor') return esc(r.vendor || '—');
        if (key === 'kind') return KIND[r.kind] || r.kind || '—';
        if (key === 'temp') return r.kind === 'chat' ? String(r.temp) : '—';
        if (key === 'react') return r.react ? String(r.react) : '—';
        if (key === 'outMax') return r.outMax ? String(r.outMax) : '—';
        if (key === 'ctx') return r.ctx ? String(r.ctx) : '—';
        if (key === 'on') {
          return '<span style="color:' + (r.on ? 'var(--color-success-ink)' : 'var(--color-text-tertiary)') + '">'
            + (r.on ? '已启用' : '已停用') + '</span>';
        }
        if (key === 'ops') {
          return '<div class="m-ops">'
            + '<button class="m-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="m-op" type="button" data-act="toggle" data-id="' + esc(r.id) + '">' + (r.on ? '停用' : '启用') + '</button>'
            + '<button class="m-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      empty: function () { return '<div class="empty"><div>还没有模型</div></div>'; }
    });
    var total = $('#total');
    if (total) total.textContent = '共 ' + rows.length + ' 条数据';
  }

  function openDlg(id) {
    EDIT_ID = id || null;
    var m = id ? CAP.modelById(id) : null;
    $('#dlg-t').textContent = m ? '编辑模型' : '新增模型';
    $('#f-name').value = m ? m.name : '';
    $('#f-label').value = m ? (m.label || '') : '';
    $('#f-vendor').value = m ? (m.vendor || '') : '';
    $('#f-kind').value = m ? m.kind : 'chat';
    $('#f-temp').value = m ? m.temp : 0.2;
    $('#f-react').value = m ? m.react : 10;
    $('#f-out').value = m ? m.outMax : 32768;
    $('#f-ctx').value = m ? m.ctx : 128000;
    $('#dlg').hidden = false;
    setTimeout(function () { $('#f-name').focus(); }, 0);
  }
  function closeDlg() { $('#dlg').hidden = true; EDIT_ID = null; }

  $('#act-new').addEventListener('click', function () { openDlg(null); });
  $('#dlg-x').addEventListener('click', closeDlg);
  $('#dlg-cancel').addEventListener('click', closeDlg);
  $('#dlg').addEventListener('mousedown', function (e) { if (e.target === this) closeDlg(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#dlg').hidden) closeDlg();
  });

  $('#dlg-save').addEventListener('click', function () {
    var name = $('#f-name').value.trim();
    if (!name) { toast('先填模型标识', 'error'); $('#f-name').focus(); return; }
    var v = {
      name: name,
      label: $('#f-label').value.trim() || name,
      vendor: $('#f-vendor').value.trim() || '未标注',
      kind: $('#f-kind').value,
      temp: Number($('#f-temp').value) || 0,
      react: Number($('#f-react').value) || 0,
      outMax: Number($('#f-out').value) || 0,
      ctx: Number($('#f-ctx').value) || 0
    };
    if (EDIT_ID) CAP.updateModel(EDIT_ID, v);
    else CAP.addModel(v);
    closeDlg(); paintModels(); paintScenes();
    toast(EDIT_ID ? '已保存' : '已新增');
  });

  $('#scenes').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-scene]'); if (!sel) return;
    CAP.setSceneModel(sel.getAttribute('data-scene'), sel.value);
    toast('已切换');
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) return;
    var id = a.getAttribute('data-id'), act = a.getAttribute('data-act');
    if (a.tagName === 'A') e.preventDefault();
    if (act === 'edit') { openDlg(id); return; }
    if (act === 'toggle') {
      var r = CAP.toggleModel(id);
      if (r && r.error) { toast(r.error, 'error'); return; }
      paintModels(); toast('已切换');
      return;
    }
    if (act === 'del') {
      var m = CAP.modelById(id); if (!m) return;
      if (m.isDefault) { toast('默认模型不可删除', 'error'); return; }
      ask({
        title: '删除模型',
        body: '删除「' + (m.label || m.name) + '」后，绑定它的场景会回到列表里的第一个模型。',
        ok: '删除', danger: true,
        onOk: function () {
          var x = CAP.removeModel(id);
          if (x && x.error) { toast(x.error, 'error'); return; }
          paintModels(); paintScenes(); toast('已删除');
        }
      });
    }
  });

  $('#act-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(CAP.exportAll(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'capability-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出');
  });
  $('#act-import').addEventListener('click', function () { $('#imp-file').click(); });
  $('#imp-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var obj;
      try { obj = JSON.parse(fr.result); } catch (e) { toast('不是有效的 JSON', 'error'); return; }
      ask({
        title: '导入数据',
        body: '导入会覆盖这台机器上的接口、技能、模型和装配关系。',
        ok: '导入', danger: true,
        onOk: function () {
          var r = CAP.importAll(obj);
          if (r && r.error) { toast(r.error, 'error'); return; }
          paintScenes(); paintModels(); toast('已导入');
        }
      });
    };
    fr.readAsText(f);
    this.value = '';
  });

  paintScenes();
  paintModels();
})();
