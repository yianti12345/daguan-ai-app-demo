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
  /* ★2026-11-09：勾选状态按 id 存在对象里，翻页不丢（列表只渲染当前页，用数组会丢）。 */
  var SEL = {};
  /* ★2026-11-09：当前页的行。全选只能选「当前页」—— 跨页全选会让人以为"全都选上了"，
     实际导出时又只出看到的那几条，这类误会比不给全选更糟。 */
  var CUR = [];
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

  /* 全选框的三态：没选 / 选了一部分（半选）/ 当前页全选。 */
  function syncAllCk() {
    var all = $('#it-all-ck');
    if (!all) return;
    var hit = CUR.filter(function (r) { return SEL[r.id]; }).length;
    all.checked = hit > 0 && hit === CUR.length;
    all.indeterminate = hit > 0 && hit < CUR.length;
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
      /* 勾选列的表头：全选框。没有它，8 条要逐个点；客户真有上百个接口时这是硬伤。 */
      headCell: function (key) {
        if (key !== 'sel') return null;
        return '<input type="checkbox" class="it-ck it-ck-all" id="it-all-ck" aria-label="全选当前页">';
      },
      cell: function (key, r) {
        if (key === 'sel') {
          return '<input type="checkbox" class="it-ck" data-id="' + esc(r.id) + '"'
            + (SEL[r.id] ? ' checked' : '') + ' aria-label="选择 ' + esc(r.name) + '">';
        }
        if (key === 'name') return '<span class="it-name">' + esc(r.name) + '</span>';
        if (key === 'desc') return '<span class="it-desc" title="' + esc(r.desc) + '">' + esc(r.desc) + '</span>';
        if (key === 'source') return esc(r.source || '—');
        if (key === 'at') return '<span class="it-at">' + esc(r.at || '—') + '</span>';
        /* ★2026-11-09：这一列原来读 r.by（创建人），但 api 与 ability 都没有这个字段 ——
           永远显示「—」，等于白占一列。换成 state（说明书生成状态）：它一直存在数据里、
           界面上却从来没露过，而"哪条能力还没生成说明书"正是这一页要看的。 */
        if (key === 'state') {
          var st = ST[r.state] || ST.ok;
          return '<span class="it-st" style="color:' + st.c + '">' + st.t + '</span>';
        }
        if (key === 'ops') {
          /* ★2026-11-09（用户：筛选有「是否启用」，操作呢？）：筛选一直是通的，
             但行上没有任何地方能改启用状态 —— 能筛不能改。
             toggle 的处理（data-act="toggle"）早就写在下面的事件里，只是没人渲染这个开关。 */
          return '<div class="it-ops">'
            + '<button class="sw" type="button" role="switch" aria-checked="' + (r.on ? 'true' : 'false') + '"'
            + ' aria-label="启用' + esc(r.name) + '" data-act="toggle" data-id="' + esc(r.id) + '"></button>'
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
    CUR = rows;
    syncAllCk();
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

  /* ══ 导出 / 导入能力（2026-11-09）════════════════════════════════════════
     用户原话：「这个是导入导出吧，没看到导出……导出的是能力，导入的也是能力」
     列表这一页渲染的是接口（编辑/新增/批量导入都围绕接口），但导出要按**能力**口径 ——
     一个能力带说明书 + N 个接口。所以导出时按 apiIds 反查能力，把说明书一起带走。
     为什么不直接把列表换成能力：编辑弹窗、批量导入、贴文本解析全建在接口对象上，
     换对象等于重写整页，收益只有"名字对了"，不划算。 */
  function buildExport() {
    /* 有勾选就只导勾选的；一条没勾才导「当前筛选的全部」。
       弹层里会把这两个数额分别写出来，不静默改变范围。 */
    var all = list();
    var picked = all.filter(function (a) { return SEL[a.id]; });
    var apis = picked.length ? picked : all;
    if (!apis.length) return null;
    var ids = {};
    apis.forEach(function (a) { ids[a.id] = 1; });
    var allApis = CAP.apis();
    var abs = CAP.abilities().filter(function (b) {
      return (b.apiIds || []).some(function (id) { return ids[id]; });
    });
    return {
      type: 'ability-export', schema: 1, at: Date.now(),
      count: { apis: apis.length, abilities: abs.length },
      picked: apis !== all,
      abilities: abs.map(function (b) {
        var mine = (b.apiIds || []).filter(function (id) { return ids[id]; });
        return {
          name: b.name || '', intro: b.intro || '', project: b.project || '',
          doc: b.doc || '', docFrom: b.docFrom || '', docAt: b.docAt || '',
          apis: mine.map(function (id) {
            var a = allApis.filter(function (x) { return x.id === id; })[0];
            if (!a) return null;
            return { id: a.id, name: a.name || '', method: a.method || '', path: a.path || '',
                     host: a.host || '', summary: a.desc || '',
                     params: a.params || '', returns: a.returns || '', raw: a.raw || '' };
          }).filter(Boolean)
        };
      })
    };
  }

  /* zip 里那份 README：说清里面有什么、怎么用。客户不解压也能看懂。 */
  function readme(pkg) {
    var nd = pkg.abilities.filter(function (b) { return b.doc; }).length;
    return [
      '达观智能审核平台 · 能力包',
      '',
      '导出时间：' + new Date(pkg.at || Date.now()).toLocaleString('zh-CN'),
      '内容：' + pkg.count.abilities + ' 个能力，' + pkg.count.apis + ' 个接口，' + nd + ' 份说明书',
      '',
      '包里有什么——',
      '  能力包.json      可再导入回平台（列表页「导入」，选这个文件即可，不必解压）',
      '  说明书/*.md      每个能力的说明书，可直接阅读、也可给别的模型当上下文',
      '',
      '怎么导回去——',
      '  1. 打开「能力配置」列表页',
      '  2. 点「导入」，选中 能力包.json（也可直接选本 zip，系统会自动解包）',
      '  3. 接口按 域名+方法+路径 去重；能力同名的会合并接口，不会重复建',
      ''
    ].join('\n');
  }

  function doExport() {
    var pkg = buildExport();
    if (!pkg) { toast('没有可导出的接口', 'error'); return; }
    var nDoc = pkg.abilities.filter(function (b) { return b.doc; }).length;
    ask({
      title: '导出能力',
      /* ★2026-11-09（真人体验时发现）：原来写「将导出 10 个能力（来自 12 个接口）」——
         勾了 12 条却导出 10 个，两个数字并排会让人以为漏了。真实原因是 2 个接口同属一个能力，
         所以要把"归并"这件事说出来，而不是让人自己推。 */
      body: (pkg.picked ? '已勾选 ' + pkg.count.apis + ' 个接口' : '当前筛选的全部 ' + pkg.count.apis + ' 个接口')
        + (pkg.count.apis > pkg.count.abilities
            ? '，归并成 ' + pkg.count.abilities + ' 个能力（有的能力含多个接口）'
            : '，对应 ' + pkg.count.abilities + ' 个能力')
        + '，其中 ' + nDoc + ' 个带说明书。'
        + '下载为 zip，内含可导回的 JSON 与 ' + nDoc + ' 份说明书。',
      okText: '导出',
      onOk: function () {
        if (!window.Transfer) { toast('这一页没接下载组件', 'error'); return; }
        /* ★2026-11-09：导 zip 而不是裸 JSON —— 客户拿到手要能直接读，不只是能导回来。
           一个包 = 可导回的 JSON + 每个能力的说明书 MD + 一份 README。
           浏览器不许一次存多个文件，所以必须打包；zip 用 STORE 手写，没引依赖。 */
        var files = [{ name: 'README.txt', text: readme(pkg) }];
        files.push({ name: '能力包.json', text: JSON.stringify(pkg, null, 2) });
        pkg.abilities.forEach(function (b, i) {
          if (!b.doc) return;
          var safe = String(b.name || ('能力' + (i + 1))).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
          files.push({ name: '说明书/' + (i + 1) + '-' + safe + '.md', text: b.doc });
        });
        Transfer.downloadZip('能力包', files);
        toast('已导出 ' + pkg.count.abilities + ' 个能力（zip 内含 JSON 与说明书）');
      }
    });
  }

  function doImport() {
    if (!window.Transfer) return;
    Transfer.pick(function (obj) {
      if (!obj || !Array.isArray(obj.abilities)) {
        toast('这不是能力包：缺少 abilities', 'error');
        return;
      }
      var r = CAP.importAbilities(obj.abilities);
      paint();
      toast('已导入 ' + r.abilities + ' 个能力、' + r.apis + ' 个接口');
    }, function () { toast('文件读不出来', 'error'); });
  }

  /* ── 生成 MD 文档：本地按内容抽取，失败也给可编辑的草稿 ── */
  function makeDoc(raw, src) {
    var text = String(raw || '').trim();
    var url = (text.match(/https?:\/\/[^\s'"]+/) || [])[0] || '';
    var method = (text.match(/-X\s+([A-Z]+)/) || [])[1] || (/curl/i.test(text) ? 'POST' : 'GET');
    var firstLine = (text.split(/\n/).filter(function (l) { return l.trim(); })[0] || '').replace(/^#+\s*/, '').trim();
    /* ★2026-11-05：原来直接取第一行前 24 字，贴一条 cURL 就会把名字填成 "GET /api/v1/audit/tasks?" ——
       地址不是名字。规则：先剥掉方法/curl 前缀；剩下的如果是地址或路径，就取地址后面那段人话；
       连人话都没有就**留空**（名称是必填，交给人填），绝不拿一串路径冒充名字。 */
    var rest = firstLine
      .replace(/^(curl\s+)?(-X\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/i, '')
      .replace(/^(https?:\/\/\S+|\/\S*)\s*/, '')
      .replace(/^["']+|["']+$/g, '')
      .trim();
    var name = rest.length >= 2 ? rest.slice(0, 24) : '';
    var desc = rest.length > 2 ? rest.slice(0, 60) : (src ? src + ' 的能力' : '');
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
      lines.push('**内容**：');
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
    $('#cnt').textContent = ($('#raw').value || '').length + ' 字';
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
    $('#cnt').textContent = ($('#raw').value || '').length + ' 字';
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
      /* MD 文档直接写进可编辑框：这里是新增/编辑页，两栏都能改，不再多一步「先点编辑」。 */
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
      + '<div class="it-pv" style="margin-top:var(--space-12)">'
      +   (it.doc ? mdToHtml(it.doc) : '<span class="it-hint">还没有说明书</span>')
      + '</div>'
      + (it.raw ? '<details style="margin-top:var(--space-12)"><summary class="it-lb">内容</summary><pre class="it-pv" style="white-space:pre-wrap;margin-top:var(--space-8)">' + esc(it.raw) + '</pre></details>' : '');
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
    var hint = $('#multi-hint');
    if (hint) hint.textContent = PARSED.length ? ('解析出 ' + PARSED.length + ' 条，逐条确认') : '没解析出东西';
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



  /* 导入 / 导出（2026-11-09） */
  var btnEx = $('#act-export'); if (btnEx) btnEx.addEventListener('click', doExport);
  var btnIm = $('#act-import'); if (btnIm) btnIm.addEventListener('click', doImport);

  /* 勾选（事件委托，列表每次重绘都会换掉 DOM） */
  /* ★2026-11-09：原来绑在 #list 上 —— 而「全选」框在表头 #head 里，事件冒泡不到 #list，
     点了完全没反应（实测 allChecked=true 但 rowChecked=0）。改成委托到 document。 */
  var listBox = document;
  if (listBox) listBox.addEventListener('change', function (e) {
    var cb = e.target;
    if (cb && cb.id === 'it-all-ck') {
      var on = cb.checked;
      CUR.forEach(function (r) { if (on) SEL[r.id] = 1; else delete SEL[r.id]; });
      [].forEach.call(document.querySelectorAll('#list .it-ck'), function (x) { x.checked = on; });
      syncAllCk();
      return;
    }
    if (!cb || cb.className.indexOf('it-ck') < 0) return;
    var id = cb.getAttribute('data-id');
    if (cb.checked) SEL[id] = 1; else delete SEL[id];
    syncAllCk();
  });

  /* ★2026-11-09（用户：接入是什么鬼，给我去掉）：列表页不再有「接入」这个入口。
     新建单个接口走能力详情页的「＋ 添加接口」；整包走「导入」。
     编辑仍用 openDlg(id)，所以弹层本身保留。 */

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
