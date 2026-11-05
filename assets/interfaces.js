/* interfaces.js —— 能力注册列表 + 新增/编辑 + 批量导入
   列表骨架、列宽、空态全部交给 List（assets/list.js），这一页只说每格画什么。 */
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

  var S = { kw: '', state: '', on: '', src: '' };
  var DET = null;
  var PAGE = 15, PG = 1;
  var EDIT_ID = null;

  var ST = {
    ok:   { t: '生成成功', c: 'var(--color-success-ink)' },
    run:  { t: '生成中',   c: 'var(--color-text-secondary)' },
    fail: { t: '生成失败', c: 'var(--color-danger)' }
  };

  function list() {
    var all = CAP.apis();
    return all.filter(function (x) {
      if (S.state && x.state !== S.state) return false;
      if (S.on === '1' && !x.on) return false;
      if (S.on === '0' && x.on) return false;
      if (S.src && (x.source || '未标注') !== S.src) return false;
      if (S.kw) {
        var h = (x.name + ' ' + x.desc + ' ' + x.source + ' ' + (x.raw || '')).toLowerCase();
        if (h.indexOf(S.kw.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function paint() {
    var all = list();
    var pages = Math.max(1, Math.ceil(all.length / PAGE));
    if (PG > pages) PG = pages;
    var start = (PG - 1) * PAGE;
    var rows = all.slice(start, start + PAGE);
    List.render(SPEC['interfaces.html'], {
      table: '.it-table', head: '#head', body: '#list', total: '#total',
      rows: rows,
      rowClass: 'gtable-row',
      cell: function (key, r) {
        if (key === 'name') return '<a class="it-name" href="#" data-act="view" data-id="' + esc(r.id) + '">' + esc(r.name) + '</a>';
        if (key === 'desc') return '<span class="it-desc" title="' + esc(r.desc) + '">' + esc(r.desc) + '</span>';
        if (key === 'source') return esc(r.source || '—');
        if (key === 'state') {
          var s = ST[r.state] || ST.ok;
          return '<span style="color:' + s.c + '">' + s.t + '</span>';
        }
        if (key === 'on') return '<span style="color:' + (r.on ? 'var(--color-success-ink)' : 'var(--color-text-tertiary)') + '">' + (r.on ? '已启用' : '已停用') + '</span>';
        if (key === 'at') return '<span class="it-at">' + esc(r.at || '—') + '</span>';
        if (key === 'by') return esc(r.by || '—');
        if (key === 'ops') {
          return '<div class="it-ops">'
            + '<button class="it-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="it-op" type="button" data-act="toggle" data-id="' + esc(r.id) + '">' + (r.on ? '停用' : '启用') + '</button>'
            + '<button class="it-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      empty: function () {
        return '<div class="empty"><div>'
          + (S.kw || S.state || S.on || S.src ? '没有匹配的能力' : '还没有能力')
          + '</div></div>';
      }
    });
    var total = $('#total');
    if (total) total.textContent = '第 ' + (all.length ? start + 1 : 0) + '-' + (start + rows.length) + ' 条 / 共 ' + all.length + ' 条';
    var pager = $('#pager');
    if (pager) {
      var h = '';
      for (var i = 1; i <= pages; i++) {
        h += '<button type="button" class="it-pn" data-pg="' + i + '"' + (i === PG ? ' aria-current="true"' : '') + '>' + i + '</button>';
      }
      pager.innerHTML = h;
    }
  }

  /* ── 生成说明书：本地按原文抽取，失败也给可编辑的草稿 ── */
  function makeDoc(raw, src) {
    var text = String(raw || '').trim();
    var url = (text.match(/https?:\/\/[^\s'"]+/) || [])[0] || '';
    var method = (text.match(/-X\s+([A-Z]+)/) || [])[1] || (/curl/i.test(text) ? 'POST' : 'GET');
    var firstLine = (text.split(/\n/).filter(function (l) { return l.trim(); })[0] || '').replace(/^#+\s*/, '').trim();
    var name = firstLine.slice(0, 24) || (url ? url.split('/').filter(Boolean).pop() : '') || '未命名能力';
    var desc = firstLine.length > 24 ? firstLine.slice(0, 60) : (src ? src + ' 的能力' : '外部能力');
    var lines = [];
    lines.push('### ' + name);
    lines.push('');
    lines.push('**用途**：' + desc);
    lines.push('');
    lines.push('**调用**：`' + method + (url ? ' ' + url : '（原文未给地址）') + '`');
    lines.push('');
    lines.push('**入参**：按原文描述组装，未写的字段不传。');
    lines.push('');
    lines.push('**返回**：JSON；字段含义以原文为准。');
    if (text) {
      lines.push('');
      lines.push('**原文**：');
      lines.push('');
      lines.push('```');
      lines.push(text.slice(0, 1200));
      lines.push('```');
    }
    return { name: name, desc: desc, md: lines.join('\n') };
  }

  function mdToHtml(md) {
    var out = [], inCode = false;
    String(md).split(/\n/).forEach(function (l) {
      if (/^```/.test(l)) { out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; return; }
      if (inCode) { out.push(esc(l)); return; }
      if (/^###\s+/.test(l)) { out.push('<h4>' + esc(l.replace(/^###\s+/, '')) + '</h4>'); return; }
      if (!l.trim()) { out.push(''); return; }
      out.push('<p>' + esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>') + '</p>');
    });
    if (inCode) out.push('</code></pre>');
    return out.join('\n').replace(/\n{2,}/g, '\n');
  }

  /* ── 新增 / 编辑弹窗 ── */
  function openDlg(id) {
    EDIT_ID = id || null;
    var it = id ? CAP.apiById(id) : null;
    $('#dlg-t').textContent = it ? '编辑能力' : '新增能力';
    $('#raw').value = it ? (it.raw || '') : '';
    $('#src').value = it ? (it.source || '') : '';
    $('#cnt').textContent = ($('#raw').value.length) + ' 字';
    $('#pv').innerHTML = it && it.doc ? mdToHtml(it.doc) : '<span class="it-hint">生成后在这里看结果</span>';
    $('#pv-name').value = it ? (it.name || '') : '';
    $('#pv-md').value = it ? (it.doc || '') : '';
    $('#pv-md').hidden = true;
    $('#pv').hidden = false;
    $('#pv-edit').textContent = '编辑';
    $('#dlg-save').disabled = !(it && it.doc);
    $('#dlg').hidden = false;
    setTimeout(function () { $('#raw').focus(); }, 0);
  }
  function closeDlg() { $('#dlg').hidden = true; EDIT_ID = null; }

  $('#raw').addEventListener('input', function () {
    $('#cnt').textContent = this.value.length + ' 字';
  });

  /* 生成结果可改：模型可能理解错，人得能直接修，不能只能重贴原文。 */
  $('#pv-edit').addEventListener('click', function () {
    var md = $('#pv-md'), pv = $('#pv');
    if (md.hidden) {
      if (!pv.getAttribute('data-md')) return;   /* 还没生成，没有可改的东西 */
      md.value = pv.getAttribute('data-md');
      md.hidden = false; pv.hidden = true; this.textContent = '预览';
    } else {
      pv.innerHTML = mdToHtml(md.value);
      pv.setAttribute('data-md', md.value);
      md.hidden = true; pv.hidden = false; this.textContent = '编辑';
    }
  });

  function doGen() {
    var raw = $('#raw').value.trim();
    if (!raw) { toast('先贴点东西', 'error'); $('#raw').focus(); return; }
    var pv = $('#pv');
    pv.innerHTML = '<p class="it-hint">正在生成…</p>';
    setTimeout(function () {
      var d = makeDoc(raw, $('#src').value.trim());
      pv.innerHTML = mdToHtml(d.md);
      pv.setAttribute('data-name', d.name);
      pv.setAttribute('data-desc', d.desc);
      pv.setAttribute('data-md', d.md);
      $('#pv-name').value = d.name;
      $('#pv-md').value = d.md;
      $('#pv-md').hidden = true; pv.hidden = false; $('#pv-edit').textContent = '编辑';
      $('#dlg-save').disabled = false;
    }, 600);
  }
  /* 贴完就生成，不用先点按钮。停顿 0.9 秒再跑，打字过程不打断。 */
  var genTimer = null;
  $('#raw').addEventListener('input', function () {
    clearTimeout(genTimer);
    var v = this.value.trim();
    if (v.length < 20) return;
    genTimer = setTimeout(doGen, 900);
  });
  $('#gen').addEventListener('click', function () { clearTimeout(genTimer); doGen(); });

  $('#dlg-save').addEventListener('click', function () {
    var pv = $('#pv');
    var md = $('#pv-md').hidden ? pv.getAttribute('data-md') : $('#pv-md').value;
    if (!md) { toast('先生成说明书', 'error'); return; }
    var v = {
      name: ($('#pv-name').value.trim() || pv.getAttribute('data-name')),
      desc: pv.getAttribute('data-desc'),
      source: $('#src').value.trim() || '未标注',
      raw: $('#raw').value.trim(),
      doc: md,
      state: 'ok'
    };
    if (EDIT_ID) CAP.updateApi(EDIT_ID, v);
    else CAP.addApi(v);
    closeDlg(); paint();
    toast(EDIT_ID ? '已更新' : '已注册');
  });

  function openDetail(id) {
    var it = CAP.apiById(id); if (!it) return;
    var st = ST[it.state] || ST.ok;
    $('#det-t').textContent = it.name;
    $('#det-bd').innerHTML = ''
      + '<p class="it-hint">' + esc(it.source || '未标注') + ' · ' + st.t + ' · ' + (it.on ? '已启用' : '已停用') + ' · ' + esc(it.at || '') + '</p>'
      + '<div class="it-pv" style="min-height:0;max-height:320px;margin-top:12px">'
      +   (it.doc ? mdToHtml(it.doc) : '<span class="it-hint">还没有说明书</span>')
      + '</div>'
      + (it.raw ? '<details style="margin-top:12px"><summary class="it-lb">原文</summary><pre class="it-pv" style="white-space:pre-wrap;max-height:200px;margin-top:8px">' + esc(it.raw) + '</pre></details>' : '');
    DET = id;
    $('#det').hidden = false;
  }
  function closeDetail() { $('#det').hidden = true; DET = null; }
  $('#det-x').addEventListener('click', closeDetail);
  $('#det-close').addEventListener('click', closeDetail);
  $('#det').addEventListener('mousedown', function (e) { if (e.target === this) closeDetail(); });
  $('#det-edit').addEventListener('click', function () { var id = DET; closeDetail(); if (id) openDlg(id); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#det').hidden) closeDetail();
  });

  $('#dlg-x').addEventListener('click', closeDlg);
  $('#dlg-cancel').addEventListener('click', closeDlg);

  /* ── 批量导入 ── */
  var PARSED = [];
  function closeBd() { $('#bd').hidden = true; PARSED = []; $('#bres').innerHTML = ''; $('#bd-do').disabled = true; $('#bstat').textContent = ''; }

  $('#act-batch').addEventListener('click', function () {
    $('#braw').value = ''; PARSED = []; $('#bres').innerHTML = ''; $('#bd-do').disabled = true; $('#bstat').textContent = '';
    $('#bd').hidden = false;
  });

  function doParse() {
    var raw = $('#braw').value.trim();
    if (!raw) { toast('先贴点东西', 'error'); return; }
    var parts = /\n\s*---+\s*\n/.test(raw) ? raw.split(/\n\s*---+\s*\n/) : raw.split(/\n\s*\n/);
    var blocks = parts.filter(function (b) { return b.trim(); });
    PARSED = blocks.map(function (b) {
      var d = makeDoc(b, '');
      return { name: d.name, desc: d.desc, raw: b.trim(), doc: d.md, source: '未标注', state: 'ok' };
    });
    $('#bres').innerHTML = PARSED.map(function (p, i) {
      return '<li><b>' + esc(p.name) + '</b><span>' + esc(p.desc) + '</span>'
        + '<button class="it-op is-danger" type="button" data-i="' + i + '">移除</button></li>';
    }).join('');
    $('#bstat').textContent = '解析出 ' + PARSED.length + ' 条';
    $('#bd-do').disabled = !PARSED.length;
  }
  var parseTimer = null;
  $('#braw').addEventListener('input', function () {
    clearTimeout(parseTimer);
    var v = this.value.trim();
    if (v.length < 20) return;
    parseTimer = setTimeout(doParse, 900);
  });
  $('#parse').addEventListener('click', function () { clearTimeout(parseTimer); doParse(); });

  $('#bres').addEventListener('click', function (e) {
    var b = e.target.closest('[data-i]'); if (!b) return;
    PARSED.splice(Number(b.getAttribute('data-i')), 1);
    $('#bres').innerHTML = PARSED.map(function (p, i) {
      return '<li><b>' + esc(p.name) + '</b><span>' + esc(p.desc) + '</span>'
        + '<button class="it-op is-danger" type="button" data-i="' + i + '">移除</button></li>';
    }).join('');
    $('#bstat').textContent = '解析出 ' + PARSED.length + ' 条';
    $('#bd-do').disabled = !PARSED.length;
  });

  $('#bd-do').addEventListener('click', function () {
    if (!PARSED.length) return;
    PARSED.forEach(function (p) { CAP.addApi(p); });
    var n = PARSED.length;
    closeBd(); paint(); toast('已导入 ' + n + ' 条');
  });

  $('#bd-x').addEventListener('click', closeBd);
  $('#bd-cancel').addEventListener('click', closeBd);

  $('#act-new').addEventListener('click', function () { openDlg(null); });

  /* ── 行内动作 ── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) return;
    var id = a.getAttribute('data-id'), act = a.getAttribute('data-act');
    if (a.tagName === 'A') e.preventDefault();
    if (act === 'view') { openDetail(id); return; }
    if (act === 'edit') { openDlg(id); return; }
    if (act === 'toggle') {
      var r = CAP.apiById(id); if (!r) return;
      CAP.toggleApi(id); paint(); toast(r.on ? '已启用' : '已停用');
      return;
    }
    if (act === 'del') {
      var it = CAP.apiById(id); if (!it) return;
      ask({
        title: '删除能力',
        body: '删除「' + it.name + '」后，组件装配时不再可选。已生成的组件不受影响。',
        ok: '删除', danger: true,
        onOk: function () { CAP.removeApi(id); paint(); toast('已删除'); }
      });
    }
  });

  $('#pager').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pg]'); if (!b) return;
    PG = Number(b.getAttribute('data-pg')); paint();
  });
  $('#kw').addEventListener('input', function () { S.kw = this.value.trim(); PG = 1; paint(); });
  $('#f-state').addEventListener('change', function () { S.state = this.value; PG = 1; paint(); });
  $('#f-on').addEventListener('change', function () { S.on = this.value; PG = 1; paint(); });

  paint();
})();
