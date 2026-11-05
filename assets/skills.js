  /* 2026-11-05（用户）：真源里「编辑」进的是 Skill 编辑器（文件树 + 代码区），不是弹窗。
     新增才是弹窗，只有名称和描述两个字段。 */
  /* 2026-11-05（用户）：真源里「编辑」进的是 Skill 编辑器（文件树 + 代码区），不是弹窗。
     新增才是弹窗，且只有名称和描述两个字段。 */
  function openEdit(id) {
    location.href = 'skill-edit.html?id=' + encodeURIComponent(id);
  }
/* skills.js —— 小智技能列表 + 新建 + 导入
   列与真源 /Expert/Management/SkillsLibrary 一致，骨架交给 List。 */
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

  var S = { kw: '', on: '' };
  var DET = null;
  var ST = {
    ok:   { t: '生成成功', c: 'var(--color-success-ink)' },
    fail: { t: '生成失败', c: 'var(--color-danger)' }
  };

  function list() {
    return CAP.skills().filter(function (x) {
      if (S.on === '1' && !x.on) return false;
      if (S.on === '0' && x.on) return false;
      if (S.kw) {
        var h = (x.name + ' ' + x.desc).toLowerCase();
        if (h.indexOf(S.kw.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function paint() {
    /* 2026-11-05 体检：这个文件也被 skill-edit.html 引用，那页只有编辑器、没有列表，
       也没引 list.js/spec.js。原来无条件调 List.render → ReferenceError，整页交互停摆。 */
    if (!document.querySelector('.sk-table') || typeof List === 'undefined') return;
    var rows = list();
    List.render(SPEC['skills.html'], {
      table: '.sk-table', head: '#head', body: '#list', total: '#total',
      rows: rows,
      rowClass: 'gtable-row',
      cell: function (key, r) {
        if (key === 'name') return '<span class="sk-name">' + esc(r.name) + '</span>';
        if (key === 'desc') return '<span class="sk-desc" title="' + esc(r.desc) + '">' + esc(r.desc) + '</span>';
        if (key === 'on') return '<button class="sw" type="button" role="switch" aria-checked="' + (r.on ? 'true' : 'false') + '" aria-label="启用' + esc(r.name) + '" data-act="toggle" data-id="' + esc(r.id) + '"></button>';
        if (key === 'at') return '<span class="sk-at">' + esc(r.at || '—') + '</span>';
        if (key === 'by') return esc(r.by || '—');
        if (key === 'ops') {
          return '<div class="sk-ops">'
            + '<button class="sk-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="sk-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      empty: function () {
        return '<div class="empty"><div>'
          + (S.kw || S.on ? '没有匹配的 skill' : '还没有导入技能')
          + '</div></div>';
      }
    });
    var total = $('#total');
    if (total) total.textContent = '共 ' + rows.length + ' 条数据';
  }

  var EDIT = null;
  function openNew() {
    EDIT = null; $('#dlg-t').textContent = '新建 skill';
    $('#f-name').value = ''; $('#f-desc').value = '';
    $('#dlg').hidden = false;
    setTimeout(function () { $('#f-name').focus(); }, 0);
  }
  function closeNew() { $('#dlg').hidden = true; EDIT = null; }
  /* 有「最近更新时间」就必然有编辑：改名、改描述都从这一行进。 */

  function openDetail(id) {
    var it = CAP.skillById(id); if (!it) return;
    $('#det-t').textContent = it.name;
    $('#det-bd').innerHTML = ''
      + '<p class="sk-hint">' + (it.on ? '已启用' : '已停用') + ' · ' + esc(it.at || '') + '</p>'
      + '<p style="margin:var(--space-12) 0 0;line-height:1.7">' + esc(it.desc || '—') + '</p>'
      + (it.content ? '<pre style="margin:var(--space-12) 0 0;padding:var(--space-12);border:1px solid var(--color-border-hairline);border-radius:var(--radius-xs);background:var(--surface-sunken);white-space:pre-wrap;line-height:1.7">' + esc(it.content) + '</pre>' : '')
      + '<p class="sk-hint" style="margin-top:var(--space-12)">创建人 ' + esc(it.by || '—') + '</p>';
    DET = id;
    $('#det-toggle').textContent = it.on ? '停用' : '启用';
    $('#det').hidden = false;
  }
  function closeDetail() { $('#det').hidden = true; DET = null; }
  /* 2026-11-05 体检：这个文件被 skills.html 与 skill-edit.html 共用，两页元素不一样。
     原来直接 $('#x').addEventListener，缺一个元素就抛 TypeError，
     同一文件后面所有绑定都不再执行（页面看着在、点哪儿都没反应）。统一改用 on()。 */
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  on('#det-toggle', 'click', function () {
    if (!DET) return;
    var r = CAP.toggleSkill(DET); paint(); openDetail(DET);
    toast(r && r.on ? '已启用' : '已停用');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#det').hidden) closeDetail();
  });

  on('#act-new', 'click', openNew);
  on('#dlg-x', 'click', closeNew);
  on('#dlg-cancel', 'click', closeNew);
  on('#dlg-save', 'click', function () {
    var name = $('#f-name').value.trim();
    if (!name) { toast('先填名称', 'error'); $('#f-name').focus(); return; }
    if (EDIT) {
      CAP.updateSkill(EDIT, { name: name, desc: $('#f-desc').value.trim() || '—' });
      closeNew(); paint(); toast('已保存'); return;
    }
    var it = CAP.addSkill({ name: name, desc: $('#f-desc').value.trim() || '—', state: 'ok' });
    closeNew(); paint(); toast('已新建');
  });

  /* ── 导入 ── */
  var FILE = null;
  function openImp() {
    FILE = null; $('#file').value = ''; $('#i-name').value = ''; $('#drop-t').textContent = '点击选择技能包';
    $('#imp-do').disabled = true; $('#imp').hidden = false;
  }
  function closeImp() { $('#imp').hidden = true; FILE = null; }

  on('#act-import', 'click', openImp);
  on('#imp-x', 'click', closeImp);
  on('#imp-cancel', 'click', closeImp);

  on('#file', 'change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    FILE = f;
    $('#drop-t').textContent = f.name;
    $('#i-name').value = f.name.replace(/\.[^.]+$/, '');
    $('#imp-do').disabled = false;
  });

  on('#imp-do', 'click', function () {
    if (!FILE) { toast('先选文件', 'error'); return; }
    var name = $('#i-name').value.trim();
    if (!name) { toast('先填名称', 'error'); $('#i-name').focus(); return; }
    var dup = CAP.skills().filter(function (x) { return x.name === name; })[0];
    var doAdd = function () {
      CAP.addSkill({
        name: name,
        desc: '来自 ' + FILE.name,
        state: 'ok'
      });
      closeImp(); paint(); toast('已导入');
    };
    if (dup) {
      ask({ title: '同名技能', body: '已存在「' + name + '」，导入会用新的替换它。', ok: '覆盖', danger: true, onOk: doAdd });
    } else doAdd();
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) return;
    var id = a.getAttribute('data-id'), act = a.getAttribute('data-act');
    if (a.tagName === 'A') e.preventDefault();
    if (act === 'view') { openDetail(id); return; }
    if (act === 'edit') { openEdit(id); return; }
    if (act === 'toggle') {
      var r = CAP.skillById(id); if (!r) return;
      CAP.toggleSkill(id); paint(); toast(r.on ? '已启用' : '已停用');
      return;
    }
    if (act === 'del') {
      var it = CAP.skillById(id); if (!it) return;
      ask({
        title: '删除技能',
        body: '删除「' + it.name + '」后，小智不再加载它。',
        ok: '删除', danger: true,
        onOk: function () { CAP.removeSkill(id); paint(); toast('已删除'); }
      });
    }
  });

  on('#kw', 'input', function () { S.kw = this.value.trim(); paint(); });
  on('#f-on', 'change', function () { S.on = this.value; paint(); });

  paint();
})();
