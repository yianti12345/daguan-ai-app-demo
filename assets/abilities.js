/* abilities.js —— 能力清单（一条记录 = 一个独立任务，不是一个接口）
   数据：CAP.abilities()；能力里的接口用 apiIds 引用池子，不复制字段。
   MD 状态只回答一件事：这份能力现在能不能拿去建组件。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };

  var S = { kw: '' };

  /* MD 三态：只读、不可手改。没有 MD 的能力在装配面板里勾不上，所以这里必须一眼看出来。 */
  var MD = {
    ready: { t: '已就绪', c: 'var(--color-text-body)' },
    run:   { t: '生成中', c: 'var(--color-text-tertiary)' },
    fail:  { t: '生成失败', c: 'var(--color-danger)' },
    none:  { t: '未生成', c: 'var(--color-text-tertiary)' }
  };

  function rows() {
    var kw = S.kw.toLowerCase();
    return CAP.abilities().filter(function (b) {
      /* 名字还没填的草稿不进清单：那是"正在建"的一条，不是一个能力。 */
      if (!String(b.name || '').trim()) return false;
      if (!kw) return true;
      return (b.name + ' ' + (b.intro || '')).toLowerCase().indexOf(kw) >= 0;
    });
  }

  function paint() {
    var rs = rows();
    List.render(SPEC['abilities.html'], {
      table: '.ab-table', head: '#head', body: '#list', total: '#total',
      rows: rs,
      rowClass: 'gtable-row',
      cell: function (key, r) {
        if (key === 'name') {
          /* 名字是纯文字：这一行的"编辑"已经是唯一入口，再来一个可点的蓝字就是两个入口。 */
          return '<span class="ab-name">' + esc(r.name) + '</span>';
        }
        if (key === 'desc') {
          var d = r.intro || '—';
          return '<span class="ab-desc" title="' + esc(d) + '">' + esc(d) + '</span>';
        }
        if (key === 'cnt') return '<span class="ab-cnt">' + (r.apiIds || []).length + '</span>';
        if (key === 'md') {
          var st = MD[r.docState] || MD.none;
          return '<span class="ab-md" style="color:' + st.c + '">' + st.t + '</span>';
        }
        if (key === 'project') return esc(r.project || '—');
        if (key === 'at') return '<span class="ab-at">' + esc(r.at || '—') + '</span>';
        if (key === 'ops') {
          return '<div class="ab-ops">'
            + '<button class="ab-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="ab-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      empty: function () {
        return '<div class="empty"><div>'
          + (S.kw ? '没有匹配的能力' : '还没有能力，先「导入项目」把接口拆进来，再「新建能力」')
          + '</div></div>';
      }
    });
    var t = $('#total');
    if (t) t.textContent = '共 ' + rs.length + ' 条';
  }

  /* 删除：只说删的是什么，不吓唬人。能力走了，池子里的接口还在。 */
  function del(id) {
    var b = CAP.abilityById(id); if (!b) return;
    Confirm.ask({
      title: '删除能力',
      body: '「' + b.name + '」会从清单里移除。池子里的接口不受影响。',
      ok: '删除', danger: true,
      onOk: function () { CAP.removeAbility(id); paint(); toast('已删除'); }
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (a) {
      var id = a.getAttribute('data-id');
      if (a.getAttribute('data-act') === 'edit') { location.href = 'ability.html?id=' + encodeURIComponent(id); return; }
      if (a.getAttribute('data-act') === 'del') { del(id); return; }
    }
    if (e.target.id === 'act-new') { location.href = 'ability.html?id=new'; }
    if (e.target.id === 'act-import') { openImport(); }
  });

  $('#kw').addEventListener('input', function () { S.kw = this.value.trim(); paint(); });

  /* ── 导入项目：把一份文档拆成接口进池子。P0 只做「拆」，不在此处分组。 ── */
  function parseDoc(raw) {
    var out = [];
    var d = null;
    try { d = JSON.parse(raw); } catch (err) { d = null; }
    if (d && d.paths && typeof d.paths === 'object') {
      var proj = (d.info && d.info.title) || '未标注';
      Object.keys(d.paths).forEach(function (p) {
        ['get', 'post', 'put', 'patch', 'delete'].forEach(function (m) {
          var op = d.paths[p][m];
          if (!op) return;
          out.push({
            name: op.summary || op.operationId || (m.toUpperCase() + ' ' + p),
            method: m.toUpperCase(), path: p, host: '', project: proj,
            summary: String(op.description || op.summary || p).replace(/\s+/g, ' ').slice(0, 60),
            raw: m.toUpperCase() + ' ' + p + (op.summary ? '\n' + op.summary : '')
          });
        });
      });
      if (out.length) return out;
    }
    var parts = /\n\s*---+\s*\n/.test(raw) ? raw.split(/\n\s*---+\s*\n/) : raw.split(/\n\s*\n/);
    return parts.filter(function (b) { return b.trim(); }).map(function (b) {
      var mp = CAP.pickMethodPath(b);
      var lines = b.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var first = lines[0] || '';
      var nm = first.replace(/^(curl\s+)?(-X\s+)?(GET|POST|PUT|PATCH|DELETE)\s+/i, '')
        .replace(/^(https?:\/\/\S+|\/\S*)\s*/, '').trim();
      /* 第一行只有「方法 路径」时（客户最常这么贴），名字取第二行，别拿路径当名字。 */
      if (!nm && lines[1]) nm = lines[1];
      return {
        name: nm.slice(0, 24) || (mp.method + ' ' + mp.path),
        method: mp.method, path: mp.path, host: '', project: '未标注',
        summary: b.replace(/\s+/g, ' ').slice(0, 60), raw: b.trim()
      };
    });
  }

  function openImport() {
    var m = $('#imp-mask');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="nf-mask" id="imp-mask" hidden><div class="nf" role="dialog" aria-modal="true" aria-labelledby="imp-t">'
        + '<div class="nf-hd"><b id="imp-t">导入项目</b>'
        + '<button type="button" class="icon-btn" id="imp-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
        + '<div class="nf-bd"><label class="it-lb" for="imp-raw">内容</label>'
        + '<textarea class="it-raw" id="imp-raw" style="min-height:260px" placeholder="贴 OpenAPI / Swagger 的 JSON，或一段段接口说明（空行分隔）"></textarea></div>'
        + '<div class="nf-ft"><span class="it-sp"></span>'
        + '<button type="button" class="btn ghost" id="imp-cancel">取消</button>'
        + '<button type="button" class="btn primary" id="imp-ok" disabled>导入</button></div>'
        + '</div></div>');
      $('#imp-x').addEventListener('click', function () { $('#imp-mask').hidden = true; });
      $('#imp-cancel').addEventListener('click', function () { $('#imp-mask').hidden = true; });
      $('#imp-raw').addEventListener('input', function () {
        $('#imp-ok').disabled = !this.value.trim();
      });
      $('#imp-ok').addEventListener('click', function () {
        var list = parseDoc($('#imp-raw').value.trim());
        if (!list.length) { toast('没解析出接口', 'error'); return; }
        var ids = [], added = 0;
        list.forEach(function (x) {
          var id = CAP.fingerprint(x.method, x.path, x.host);
          if (CAP.apiById(id)) { if (ids.indexOf(id) < 0) ids.push(id); return; }
          CAP.addApi({
            id: id, name: x.name, desc: x.summary, summary: x.summary,
            method: x.method, path: x.path, project: x.project,
            source: x.project, raw: x.raw, doc: '', state: 'ok', on: true, at: ''
          });
          ids.push(id); added++;
        });
        $('#imp-mask').hidden = true;
        $('#imp-raw').value = ''; $('#imp-ok').disabled = true;
        if (!ids.length) { paint(); toast('没解析出新接口'); return; }
        /* 拆出来的接口要有归属：直接落成一条能力，进去命名、删掉不要的，一保存就出 MD。
           否则接口躺在池子里，没有第二个入口能捡回来。 */
        var proj = (list[0] && list[0].project) || '';
        var b = CAP.addAbility({
          /* 有项目名就用项目名；纯文本贴进来的没有项目名，留空当草稿，等人在详情页命名。 */
          name: proj === '未标注' ? '' : proj,
          intro: '', apiIds: ids, project: proj
        });
        location.href = 'ability.html?id=' + encodeURIComponent(b.id);
      });
    }
    /* 第一次点：上面刚把节点插进 DOM，局部变量 m 还是 null，必须重新取，
       否则下一行就是 null.hidden —— 第一次点打不开、第二次才开。 */
    m = $('#imp-mask');
    m.hidden = false;
    setTimeout(function () { $('#imp-raw').focus(); }, 0);
  }

  paint();
})();
