/* interfaces.js —— 接入清单 + 新增/编辑 + 批量导入
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
        if (key === 'at') return '<span class="it-at">' + esc(r.at || '—') + '</span>';
        if (key === 'by') return esc(r.by || '—');
        if (key === 'ops') {
          return '<div class="it-ops">'
            + '<button class="it-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="it-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      empty: function () {
        return '<div class="empty"><div>'
          + (S.kw || S.state || S.on || S.src ? '没有匹配的' : '还没有接入任何接口或项目')
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
    $('#dlg-t').textContent = it ? '编辑' : '接入';
    PARSED = []; $('#bres').innerHTML = ''; showMulti(false); $('#dlg-save').textContent = '接入';
    $('#raw').value = it ? (it.raw || '') : '';
    $('#intro').value = it ? (it.desc && it.desc !== '—' ? it.desc : '') : '';
    $('#cnt').textContent = ($('#raw').value.length) + ' 字';
    $('#pv-name').value = it ? (it.name || '') : '';
    $('#pv-md').value = it ? (it.doc || '') : '';
    $('#dlg-save').disabled = !(it && it.doc);
    $('#dlg').hidden = false;
    setTimeout(function () { $('#raw').focus(); }, 0);
  }
  function closeDlg() { $('#dlg').hidden = true; EDIT_ID = null; }

  $('#raw').addEventListener('input', function () {
    $('#cnt').textContent = this.value.length + ' 字';
  });


  function doGen() {
    var raw = $('#raw').value.trim();
    if (!raw) { toast('先贴点东西', 'error'); $('#raw').focus(); return; }
    /* 2026-11-05（用户）：入口合并成一个 —— 贴一条走单条编辑，贴一整份就自动切到列表。 */
    var many = parseProject(raw);
    if (many.length > 1) {
      PARSED = many; renderParsed(); showMulti(true);
      $('#dlg-save').disabled = false;
      return;
    }
    showMulti(false);
    var pv = $('#pv');
    $('#pv-md').value = '正在生成…';
    setTimeout(function () {
      var d = makeDoc(raw, '');
      /* 说明书直接写进可编辑框：这里是新增/编辑页，两栏都能改，不再多一步「改说明书」。 */
      $('#pv-md').value = d.md;
      pv.setAttribute('data-desc', d.desc);
      if (!$('#pv-name').value.trim()) $('#pv-name').value = d.name;
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
    if (!$('#multi').hidden) {
      if (!PARSED.length) return;
      var src0 = $('#src').value.trim() || '未标注';
      PARSED.forEach(function (x) { x.source = src0; CAP.addApi(x); });
      var n0 = PARSED.length;
      closeDlg(); paint(); toast('已接入 ' + n0 + ' 条');
      return;
    }
    var pv = $('#pv');
    var name = $('#pv-name').value.trim();
    if (!name) { toast('填能力名称', 'error'); $('#pv-name').focus(); return; }
    var md = $('#pv-md').value.trim();
    if (!md) { toast('先生成说明书', 'error'); return; }
    var old = EDIT_ID ? CAP.apiById(EDIT_ID) : null;
    var v = {
      name: name,
      desc: $('#intro').value.trim() || pv.getAttribute('data-desc') || '—',
      source: (old && old.source) || pv.getAttribute('data-src') || '未标注',
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
      + (it.raw ? '<details style="margin-top:12px"><summary class="it-lb">内容</summary><pre class="it-pv" style="white-space:pre-wrap;max-height:200px;margin-top:8px">' + esc(it.raw) + '</pre></details>' : '');
    DET = id;
    $('#det').hidden = false;
  }
  function closeDetail() { $('#det').hidden = true; DET = null; }
  $('#det-x').addEventListener('click', closeDetail);
  $('#det-close').addEventListener('click', closeDetail);
  $('#det').addEventListener('mousedown', function (e) { if (e.target === this) closeDetail(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#det').hidden) closeDetail();
  });

  $('#dlg-x').addEventListener('click', closeDlg);
  $('#dlg-cancel').addEventListener('click', closeDlg);

  /* ── 批量导入 ── */
  var PARSED = [];

  /* 导入项目：先认 OpenAPI / Swagger（paths 是真结构，能一条条拆准），
     认不出来再按空行 / --- 切纯文本。项目级导入就是把整份 spec 或整份文档贴进来。 */
  function parseProject(raw) {
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (data && data.paths && typeof data.paths === 'object') {
      var out = [], METHODS = ['get', 'post', 'put', 'patch', 'delete'];
      var projName = (data.info && data.info.title) || '导入项目';
      Object.keys(data.paths).forEach(function (path) {
        var item = data.paths[path] || {};
        METHODS.forEach(function (m) {
          var op = item[m];
          if (!op) return;
          var body = m.toUpperCase() + ' ' + path
            + (op.summary ? '\n' + op.summary : '')
            + (op.description ? '\n' + op.description : '');
          var d = makeDoc(body, '');
          out.push({
            name: op.summary || op.operationId || (m.toUpperCase() + ' ' + path),
            desc: String(op.description || op.summary || path).replace(/\s+/g, ' ').slice(0, 60),
            raw: body, doc: d.md, source: projName, state: 'ok'
          });
        });
      });
      if (out.length) return out;
    }
    var parts = /\n\s*---+\s*\n/.test(raw) ? raw.split(/\n\s*---+\s*\n/) : raw.split(/\n\s*\n/);
    return parts.filter(function (b) { return b.trim(); }).map(function (b) {
      var d = makeDoc(b, '');
      return { name: d.name, desc: d.desc, raw: b.trim(), doc: d.md, source: '未标注', state: 'ok' };
    });
  }

  function showMulti(on) {
    var m = $('#multi'), one = $('#single'), b = $('#dlg-save');
    if (!m || !one) return;
    m.hidden = !on; one.hidden = on;
    b.textContent = on ? ('导入 ' + PARSED.length + ' 条') : '接入';
    b.disabled = on ? !PARSED.length : b.disabled;
  }

  function picked() {
    return [].slice.call(document.querySelectorAll('#bres [data-mk]'))
      .filter(function (x) { return x.checked; })
      .map(function (x) { return Number(x.getAttribute('data-mk')); });
  }

  function renderParsed() {
    $('#bres').innerHTML = PARSED.map(function (p, i) {
      return '<li><input class="it-mk" type="checkbox" data-mk="' + i + '" aria-label="选择「' + esc(p.name) + '」">'
        + '<input class="it-rn" type="text" data-rn="' + i + '" value="' + esc(p.name) + '" aria-label="名称，可改">'
        + '<span>' + esc(p.desc) + '</span>'
        + '<button class="it-op is-danger" type="button" data-i="' + i + '">移除</button></li>';
    }).join('');
    $('#bstat').textContent = PARSED.length ? ('解析出 ' + PARSED.length + ' 条') : '没解析出东西';
    $('#bd-merge').disabled = picked().length < 2;
  }

  function doParse() {
    var raw = $('#raw').value.trim();
    if (!raw) { toast('先贴点东西', 'error'); return; }
    PARSED = parseProject(raw);
    renderParsed();
    showMulti(PARSED.length > 1);
  }

  $('#bres').addEventListener('click', function (e) {
    var b = e.target.closest('[data-i]'); if (!b) return;
    PARSED.splice(Number(b.getAttribute('data-i')), 1);
    renderParsed();
  });
  /* 名称就地改：模型拆出来的名字经常要顺手修一下，不该逼人重新贴。 */
  $('#bres').addEventListener('input', function (e) {
    var n = e.target.closest('[data-rn]'); if (!n) return;
    var it = PARSED[Number(n.getAttribute('data-rn'))];
    if (it) it.name = n.value;
  });
  $('#bres').addEventListener('change', function (e) {
    if (!e.target.closest('[data-mk]')) return;
    $('#bd-merge').disabled = picked().length < 2;
  });
  /* 同一份文档里常被切成几条重复的，勾上合并成一条：名称留第一条，说明与原文相加。 */
  $('#bd-merge').addEventListener('click', function () {
    var idx = picked();
    if (idx.length < 2) return;
    var first = PARSED[idx[0]];
    var parts = idx.map(function (i) { return PARSED[i]; });
    var mergedRaw = parts.map(function (p) { return p.raw; }).join('\n\n');
    var md = makeDoc(mergedRaw, '');
    first.raw = mergedRaw;
    first.doc = md.md;
    first.desc = parts.map(function (p) { return p.desc; }).join('；').slice(0, 60);
    PARSED = PARSED.filter(function (p, i) { return idx.indexOf(i) < 0 || p === first; });
    renderParsed();
    toast('已合并 ' + idx.length + ' 条');
  });

  /* 选文件：读成文本走同一条解析，不另写一套。 */
  $('#bfile-btn').addEventListener('click', function () { $('#bfile').click(); });
  $('#bfile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      $('#raw').value = String(fr.result || '');
      doGen();
      doParse();
      $('#bstat').textContent = f.name + ' ｜ ' + $('#bstat').textContent;
    };
    fr.readAsText(f);
    this.value = '';
  });



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
        title: '删除',
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
