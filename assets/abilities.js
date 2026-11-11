/* abilities.js —— 能力清单（一条记录 = 一个独立任务，不是一个接口）
   数据：CAP.abilities()；能力里的接口用 apiIds 引用池子，不复制字段。
   列表只展示管理启用开关；模型使用前另行检查授权及配置完整性。 */
(function () {
  'use strict';

  var Parts=UIK.Ability;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };

  /* 分页与勾选都在这一层，不塞进 List —— 列表契约只管表头/列宽/行骨架，
     分页是这页的业务。sel 用对象当集合（id → 1），跨页保留。 */
  var S = { kw: '', kind: '', page: 1, size: 15, sel: {} };


  function allRows() {
    var kw = S.kw.toLowerCase();
    return CAP.visibleAbilities().filter(function (b) {
      if (S.kind && b.kind !== S.kind) return false;
      /* 名字还没填的草稿不进清单：那是"正在建"的一条，不是一个能力。 */
      if (!String(b.name || '').trim()) return false;
      if (!kw) return true;
      return (b.name + ' ' + (b.intro || '')).toLowerCase().indexOf(kw) >= 0;
    });
  }
  function pageRows(all) {
    var s = (S.page - 1) * S.size;
    return all.slice(s, s + S.size);
  }
  function selRows(all) { return all.filter(function (r) { return S.sel[r.id] && CAP.canManage(r); }); }
  function selCount() { return Object.keys(S.sel).length; }

  function paint() {
    var all = allRows();
    var pages = Math.max(1, Math.ceil(all.length / S.size));
    if (S.page > pages) S.page = pages;
    if (S.page < 1) S.page = 1;
    var rows = pageRows(all);
    var allChecked = rows.length > 0 && rows.every(function (r) { return S.sel[r.id]; });

    List.render(SPEC['abilities.html'], {
      table: '.ab-table', head: '#head', body: '#list', total: '#total',
      rows: rows,
      rowClass: 'gtable-row',
      rowAttr: function (r) { return ' data-id="' + esc(r.id) + '"'; },
      /* 表头控件必须走 headCell：表头每次重绘都是整段重建，写死在 HTML 里会被覆盖。 */
      headCell: function (key) {
        if (key !== 'sel') return null;
        return '<input type="checkbox" id="sel-all" aria-label="全选本页"' + (allChecked ? ' checked' : '') + '>';
      },
      cell: function (key, r) {
        if (key === 'sel') {
          return '<input type="checkbox" data-sel="' + esc(r.id) + '" aria-label="选择 ' + esc(r.name) + '"'
            + (S.sel[r.id] ? ' checked' : '') + (!CAP.canManage(r) ? ' disabled' : '') + '>';
        }
        if (key === 'name') {
          /* 名字是纯文字：这一行的"编辑"已经是唯一入口，再来一个可点的蓝字就是两个入口。 */
          return '<span class="ab-name">' + esc(r.name) + '</span>';
        }
        if (key === 'desc') {
          var d = r.intro || '—';
          return '<span class="ab-desc" title="' + esc(d) + '">' + esc(d) + '</span>';
        }
        if (key === 'kind') return Parts.kindTag(r.kind);
        if (key === 'scope') return '<span class="ab-desc" title="'+esc(CAP.scopeLabel(r))+'">'+esc(CAP.scopeLabel(r))+'</span>';
        if (key === 'owner') return esc(r.ownerName);
        if(key==='docState'){var st=r.docState||'none',label=st==='run'?'生成中':st==='fail'?'生成失败':r.doc&&r.doc.trim()?'已生成':'未生成',tone=label==='已生成'?'done':label==='生成失败'?'bad':'wait';return '<span class="cond" data-k="'+tone+'">'+label+'</span>';}
        if(key==='source'){var src=r.source||r.project||'—';return '<span class="ab-desc" title="'+esc(src)+'">'+esc(src)+'</span>';}
        if (key === 'cnt') return '<span class="ab-cnt">' + (r.kind==='skill' ? (r.files || []).length : (r.apiIds || []).length) + '</span>';
        if (key === 'enabled') return Parts.enableSwitch(r,'management');
        if (key === 'at') return '<span class="ab-at">' + esc(r.at || '—') + '</span>';
        if (key === 'ops') {
          return '<div class="ab-ops">'
            + '<button class="ab-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">'+(CAP.canManage(r)?'编辑':'查看')+'</button>'
            + (CAP.canManage(r) ? '<button class="ab-op" type="button" data-act="exp" data-id="' + esc(r.id) + '">导出</button>' : '')
            + (CAP.canManage(r) ? '<button class="ab-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>' : '')
            + '</div>';
        }
        return '';
      },
      empty: function () {
        return '<div class="empty"><div>'
          + (S.kw ? '没有匹配的能力' : '还没有能力，先「导入」把接口或能力 JSON 带进来，再「新建能力」')
          + '</div></div>';
      }
    });

    var t = $('#total');
    if (t) {
      var n = selCount();
      t.textContent = '共 ' + all.length + ' 条' + (n ? ' · 已选 ' + n + ' 条' : '');
    }
    /* 勾选数直接长在按钮上：勾 1 个就写「批量导出（1）」，没勾就是灰的。
       不再弹一层让人选范围 —— 那三行单选没人看得懂。 */
    var eb = $('#act-export');
    if (eb) {
      var nsel = selCount();
      eb.textContent = nsel ? ('批量导出（' + nsel + '）') : '批量导出';
      eb.disabled = !nsel;
      eb.title = nsel ? '' : '先勾选要导出的能力';
    }
    var pg = $('#pg');
    if (pg) {
      pg.innerHTML = '<button type="button" class="ab-op" data-pg="prev"' + (S.page <= 1 ? ' disabled' : '') + '>上一页</button>'
        + '<span>' + S.page + ' / ' + pages + '</span>'
        + '<button type="button" class="ab-op" data-pg="next"' + (S.page >= pages ? ' disabled' : '') + '>下一页</button>';
    }
  }

  /* ── 导出 ───────────────────────────────────────────────────────── */
  function abilityPack(b) {
    var apis = (b.apiIds || []).map(function (id) {
      var a = CAP.apiById(id);
      if (!a) return null;
      return {
        name: a.name || '', summary: a.desc || '', method: a.method || 'GET',
        path: a.path || '', host: a.host || '',
        params: a.params || '', returns: a.returns || '', raw: a.raw || ''
      };
    }).filter(Boolean);
    return {
      kind: 'ability', abilityType: b.kind, v: 2, at: CAP.now(),
      files: b.files || [],
      name: b.name || '', intro: b.intro || '', project: b.project || '未标注',
      doc: b.doc || '', docFrom: b.docFrom || '', docAt: b.docAt || '',
      apis: apis
    };
  }

  function download(obj, fn) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fn;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportOne(id) {
    var b = CAP.abilityById(id); if (!b || !CAP.canManage(b)) return;
    var pack = abilityPack(b);
    var stamp = String(pack.at).replace(/[^0-9]/g, '').slice(0, 12);
    download(pack, '能力-' + (b.name || '未命名') + '-' + stamp + '.json');
    toast('已导出「' + (b.name || '未命名') + '」');
  }

  /* 批量导出：不弹层。勾了几个，按钮上就写几个；点一下直接导走。
     单个导出仍走每行的「导出」（exportOne），两条路互不干扰。 */
  function batchExport() {
    var list = selRows(allRows());
    if (!list.length) { toast('先勾选要导出的能力', 'error'); return; }
    var at = CAP.now();
    download({
      v: 1, exportedAt: at,
      abilities: list.map(abilityPack)
    }, '能力-' + list.length + '条-' + String(at).replace(/[^0-9]/g, '').slice(0, 12) + '.json');
    toast('已导出 ' + list.length + ' 条');
  }

  /* ── 删除 ───────────────────────────────────────────────────────── */
  function del(id) {
    var b = CAP.abilityById(id); if (!b) return;
    Confirm.ask({
      title: '删除能力',
      body: '「' + b.name + '」会从清单里移除。池子里的接口不受影响。',
      ok: '删除', danger: true,
      onOk: function () {
        CAP.removeAbility(id);
        delete S.sel[id];
        paint();
        toast('已删除');
      }
    });
  }

  /* ── 导入：两步（贴 → 预览 → 新建/合并）──────────────────────────
     原实现点一下就直接落库，冲突被静默合并，用户看不到跳过了几条。
     现在第二步把「能力名 / 接口数 / 冲突」摆出来，再让他选新建还是合并。 */
  var PENDING = null;

  function openImport() {
    var m = $('#imp-mask');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="nf-mask" id="imp-mask" hidden><div class="nf" role="dialog" aria-modal="true" aria-labelledby="imp-t">'
        + '<div class="nf-hd"><b id="imp-t">导入</b>'
        + '<button type="button" class="icon-btn" id="imp-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
        + '<div class="nf-bd">'
        + '<div id="imp-s1">'
        /* ★2026-11-09（用户）：导出给的是文件，导入只能贴内容 —— 两头不对等。
           第一步就要能「选文件 / 拖进来」，读到的内容和粘贴走同一条解析。 */
        + '<div class="imp-drop" id="imp-drop">'
        + '<button type="button" class="btn ghost" id="imp-file">选择文件</button>'
        + '<span>或把导出的 JSON 拖到这里</span>'
        + '<input type="file" id="imp-input" accept=".json,application/json" multiple hidden>'
        + '</div>'
        + '<label class="it-lb" for="imp-raw">也可以直接贴</label>'
        + '<textarea class="it-raw" id="imp-raw" rows="8" placeholder="OpenAPI / Swagger 的 JSON、一段段接口说明（空行分隔），或一份导出过的能力 JSON"></textarea></div>'
        + '<div id="imp-s2" hidden></div>'
        + '</div>'
        + '<div class="nf-ft"><span class="it-sp"></span>'
        + '<button type="button" class="btn ghost" id="imp-cancel">取消</button>'
        + '<button type="button" class="btn ghost" id="imp-merge" hidden>合并进去</button>'
        + '<button type="button" class="btn primary" id="imp-ok" disabled>下一步</button>'
        + '</div></div></div>');
      $('#imp-x').addEventListener('click', closeImp);
      $('#imp-cancel').addEventListener('click', closeImp);
      $('#imp-raw').addEventListener('input', function () {
        $('#imp-ok').disabled = !this.value.trim();
        backStep1();
      });
      $('#imp-ok').addEventListener('click', function () {
        if (PENDING) { doImport('new'); return; }
        preview();
      });
      $('#imp-merge').addEventListener('click', function () { doImport('merge'); });
      /* 选文件 / 拖文件：和"贴"走同一条解析，不另立一套。 */
      $('#imp-file').addEventListener('click', function () { $('#imp-input').click(); });
      $('#imp-input').addEventListener('change', function () { readFiles(this.files); this.value = ''; });
      var bd = $('#imp-mask .nf-bd');
      if (bd) {
        bd.addEventListener('dragover', function (e) { e.preventDefault(); });
        bd.addEventListener('drop', function (e) {
          e.preventDefault();
          readFiles(e.dataTransfer && e.dataTransfer.files);
        });
      }
    }
    m = $('#imp-mask');
    m.hidden = false;
    backStep1();
    setTimeout(function () { var t = $('#imp-raw'); if (t) t.focus(); }, 0);
  }

  function closeImp() {
    var m = $('#imp-mask'); if (m) m.hidden = true;
    var t = $('#imp-raw'); if (t) t.value = '';
    backStep1();
  }

  function backStep1() {
    PENDING = null;
    var s1 = $('#imp-s1'), s2 = $('#imp-s2');
    if (s1) s1.hidden = false;
    if (s2) { s2.hidden = true; s2.innerHTML = ''; }
    var ok = $('#imp-ok'); if (!ok) return;
    ok.textContent = '下一步';
    ok.disabled = !(($('#imp-raw') || {}).value || '').trim();
    var mg = $('#imp-merge'); if (mg) mg.hidden = true;
  }

  /* 解析成统一形状：{ items:[{name,project,intro,doc,apis}], from:'pack'|'text' } */
  function parseInput(raw) {
    var j = null;
    try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (j && j.kind === 'ability' && j.name) return { from: 'pack', items: [j] };
    if (j && Array.isArray(j.abilities)) return { from: 'pack', items: j.abilities };
    if (Array.isArray(j)) return { from: 'pack', items: j };
    var list = CAP.parseApis(raw);
    if (!list.length) return null;
    var proj = (list[0] && list[0].project) || '';
    return {
      from: 'text',
      items: [{
        name: (proj && proj !== '未标注') ? proj : '未命名能力',
        project: proj, intro: '', doc: '', apis: list
      }]
    };
  }

  /* 冲突口径必须与 importAbilities 一致：host 缺失用 project 占位 */
  function conflictOf(item) {
    var same = CAP.abilities().filter(function (x) { return x.name === item.name; }).length;
    var pool = CAP.apis();
    var dup = 0;
    (item.apis || []).forEach(function (a) {
      if (!a || !a.path) return;
      var hk = a.host || ('project:' + (item.project || '未标注'));
      var key = hk + ' ' + (a.method || 'GET') + ' ' + a.path;
      var hit = pool.filter(function (x) {
        return ((x.host || ('project:' + (x.project || '未标注'))) + ' ' + (x.method || 'GET') + ' ' + x.path) === key;
      })[0];
      if (hit) dup++;
    });
    return { same: same, dup: dup };
  }

  /* 读文件：多个文件合并成一次导入，逐个 parse 后拼 items。
     不做 size 上限之外的拦截 —— 解析不出就明说，不吞。 */
  function readFiles(files) {
    var arr = [].slice.call(files || []);
    if (!arr.length) return;
    var texts = new Array(arr.length), done = 0;
    function tick() {
      if (++done < arr.length) return;
      var items = [];
      texts.forEach(function (t) {
        var p = t && parseInput(t);
        if (p) items = items.concat(p.items);
      });
      if (!items.length) { toast('文件里没解析出能力', 'error'); return; }
      showPreview({ from: 'file', items: items });
    }
    arr.forEach(function (f, i) {
      var r = new FileReader();
      r.onload = function () { texts[i] = String(r.result || ''); tick(); };
      r.onerror = function () { texts[i] = ''; tick(); };
      r.readAsText(f);
    });
  }

  function preview() {
    var raw = (($('#imp-raw') || {}).value || '').trim();
    var p = parseInput(raw);
    if (!p) { toast('没解析出接口', 'error'); return; }
    showPreview(p);
  }

  function showPreview(p) {
    PENDING = p;
    var it = p.items[0] || {};
    var c = conflictOf(it);
    var total = p.items.reduce(function (n, x) { return n + (x.apis || []).length; }, 0);
    $('#imp-s1').hidden = true;
    var s2 = $('#imp-s2');
    s2.hidden = false;
    s2.innerHTML = '<div class="imp-pv">'
      + row('能力名', esc(it.name || '—'))
      + row('接口数', String(total))
      + row('同名能力', c.same ? ('已存在 ' + c.same + ' 条，合并会追加接口') : '无')
      + row('已存在接口', c.dup ? ('将跳过 ' + c.dup + ' 个') : '无')
      + '</div>'
      + '<p class="imp-tip">' + (p.items.length > 1 ? ('这份文件含 ' + p.items.length + ' 条能力，会一并导入。') : '') + '</p>';
    var ok = $('#imp-ok');
    ok.textContent = '新建一条';
    ok.disabled = false;
    var mg = $('#imp-merge');
    mg.hidden = !c.same;

    function row(k, v) {
      return '<div class="imp-row"><span>' + k + '</span><b>' + v + '</b></div>';
    }
  }

  function doImport(mode) {
    if (!PENDING) return;
    var r;
    try { r = CAP.importAbilities(PENDING.items.map(function(b){return Object.assign({},b,{kind:b.abilityType || (b.kind==='skill'?'skill':'api')});}), { mode: mode }); } catch(e) { toast(e.message,'error'); return; }
    closeImp();
    paint();
    var msg = '导入完成：新增 ' + r.abilities + ' 条能力、' + r.apis + ' 个接口';
    if (r.skipped) msg += '，跳过 ' + r.skipped + ' 个已存在接口';
    toast(msg);
  }

  /* ── 事件 ───────────────────────────────────────────────────────── */
  document.addEventListener('change', function (e) {
    if (e.target.id === 'sel-all') {
      var rows = pageRows(allRows());
      var on = e.target.checked;
      rows.forEach(function (r) { if (on) S.sel[r.id] = 1; else delete S.sel[r.id]; });
      paint();
      return;
    }
    if (e.target.hasAttribute && e.target.hasAttribute('data-sel')) {
      var id = e.target.getAttribute('data-sel');
      if (e.target.checked) S.sel[id] = 1; else delete S.sel[id];
      paint();
    }
  });

  document.addEventListener('click', function (e) {
    var pg = e.target.closest('[data-pg]');
    if (pg && !pg.disabled) {
      S.page += pg.getAttribute('data-pg') === 'next' ? 1 : -1;
      paint();
      return;
    }
    var a = e.target.closest('[data-act]');
    if (a) {
      var id = a.getAttribute('data-id');
      var act = a.getAttribute('data-act');
      if (act === 'edit') { location.href = Parts.kinds[CAP.abilityById(id).kind].editor+'?id=' + encodeURIComponent(id); return; }
      if (act === 'exp') { exportOne(id); return; }
      if (act === 'del') { del(id); return; }
      if (act === 'toggle') { var item=CAP.abilityById(id); if(!item || !CAP.canManage(item))return; try { var next=item.on===false; CAP.updateAbility(id,{on:next}); paint(); UIK.toast(next?'已启用':'已停用'); } catch(err) { UIK.toast(err.message,'error'); } return; }
    }
    if (e.target.id === 'act-new') { location.href='ability.html?new=1'; }
    if (e.target.id === 'act-import') { openImport(); }
    if (e.target.id === 'act-export') { batchExport(); }
  });

  $('#kw').addEventListener('input', function () {
    S.kw = this.value.trim();
    S.page = 1;
    paint();
  });


  if(new URLSearchParams(location.search).get('new')==='1'){location.replace('ability.html?new=1');return;}
  paint();
})();
