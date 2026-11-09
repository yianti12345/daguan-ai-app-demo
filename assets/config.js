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

  /* 2026-11-06：「模型类型」表单字段曾一度从界面撤除（当时只建对话模型）。
     ★2026-11-09 恢复：用户要求「模型类型肯定要，不然新增的模型怎么选类型、怎么跟类型关联」，
       类型重回新增/编辑表单，并按类型联动字段。数据层的 kind 从头到尾没删过。
       定稿值域见 _reports/方案-v1-能力配置与基础配置-20261109.md 第九节 9.6。 */
  /* 这条规则：kind 在数据层只有一个值，不要在别处另立 type 字段。 */
  var EDIT_ID = null;

  function chatModels() {
    return CAP.models().filter(function (m) { return m.kind === 'chat' && m.on; });
  }

  function paintScenes() {
    var box = $('#scenes');
    box.innerHTML = CAP.scenes().map(function (s) {
      /* ★2026-11-09：每条绑定只列它自己那一类模型。原来固定列 chat，
         加语音/向量/重排之后会把对话模型塞进向量下拉，选了就绑错。 */
      var kind = s.kind || 'chat';
      var ms = CAP.models().filter(function (m) { return m.kind === kind && m.on; });
      var kl = (KIND_DEF.filter(function (x) { return x.k === kind; })[0] || { label: '' }).label;
      var opts = ms.length
        ? ms.map(function (m) {
            return '<option value="' + esc(m.id) + '" title="' + esc(m.name) + '"' + (m.id === s.model ? ' selected' : '') + '>'
              + esc(m.label) + (m.vision ? ' · 多模态' : '') + '</option>';
          }).join('')
        : '<option value="">没有可用的' + esc(kl) + '模型</option>';
      return '<div class="scene" data-key="' + esc(s.key) + '">'
        + '<div class="scene-t"><b>' + esc(s.name) + '</b><p>' + esc(s.desc) + '</p></div>'
        + '<label class="field scene-sel"><select data-scene="' + esc(s.key) + '" aria-label="' + esc(s.name) + '使用的模型">' + opts + '</select></label>'
        + '</div>';
    }).join('');
  }

  /* ★2026-11-09（用户：模型要区分类型，不然新增的模型怎么选类型、怎么跟类型关联）：
     按类型筛选。视觉不做 Tab —— 它是「对话」模型的一个属性（多模态），
     单列成一个类型会逼一个既能对话又能读图的模型二选一。
     计数为 0 的类型不出现：真源那个「视觉(0)」就是纯噪音。 */
  var KIND_TABS = [
    { k: 'all', label: '全部' },
    { k: 'chat', label: '对话' },
    { k: 'embed', label: '向量' },
    { k: 'rerank', label: '重排' },
    { k: 'asr', label: '语音' }
  ];
  var modelKind = 'all';

  function kindCount(k) {
    return CAP.models().filter(function (m) { return k === 'all' || m.kind === k; }).length;
  }

  function paintTabs() {
    var box = $('#mtabs'); if (!box) return;
    /* ★2026-11-09（用户）：没有对应模型的类型也要显示 —— 不显示就不知道系统支持哪几类。
       空 Tab 是能力声明，不是噪音。所以这里不再按计数过滤。 */
    box.innerHTML = KIND_TABS.map(function (t) {
      var c = kindCount(t.k);
      return '<button class="mtab" type="button" role="tab" data-kind="' + t.k + '" aria-selected="'
        + (modelKind === t.k ? 'true' : 'false') + '">' + esc(t.label)
        + '<span class="n">(' + c + ')</span></button>';
    }).join('');
  }

  /* 连接状态只有三种可见值：正常 / 待重测 / 空白（从没测过）。
     存量模型一律空白 —— 不给"你有一堆没测"的压力。 */
  function connCell(r) {
    var t = r.test;
    if (!t) return '<span class="m-conn" title="还没测过"></span>';
    if (t.fp !== CAP.modelFp(r)) return '<span class="m-conn is-stale" title="配置改过，需要重新测试">待重测</span>';
    if (t.ok) return '<span class="m-conn is-ok">连接正常</span>';
    return '<span class="m-conn is-bad" title="' + esc('HTTP ' + (t.status || '—')) + '">连接失败</span>';
  }

  function paintModels() {
    paintTabs();
    var rows = CAP.models().filter(function (m) { return modelKind === 'all' || m.kind === modelKind; });
    List.render(SPEC['config.html'], {
      table: '.cfg-table', head: '#head', body: '#list', total: '#total',
      rows: rows,
      rowClass: 'gtable-row',
      cell: function (key, r) {
        if (key === 'name') {
          return '<span class="m-name">' + esc(r.label || r.name) + '</span>';
        }
        if (key === 'vendor') return esc(r.vendor || '—');
        if (key === 'conn') return connCell(r);
        if (key === 'temp') return r.kind === 'chat' ? String(r.temp) : '—';
        if (key === 'react') return r.react ? String(r.react) : '—';
        if (key === 'outMax') return r.outMax ? String(r.outMax) : '—';
        if (key === 'ctx') return r.ctx ? String(r.ctx) : '—';
        if (key === 'on') {
          return '<button class="sw" type="button" role="switch" aria-checked="' + (r.on ? 'true' : 'false') + '"'
            + ' aria-label="启用' + esc(r.label || r.name) + '" data-act="toggle" data-id="' + esc(r.id) + '"></button>';
        }
        if (key === 'ops') {
          return '<div class="m-ops">'
            + '<button class="m-op" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>'
            + '<button class="m-op is-danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button>'
            + '</div>';
        }
        return '';
      },
      /* ★2026-11-09：空 Tab 现在会显示（全部/对话/向量/重排/语音），点进来不能只说"还没有模型" ——
         那会让人以为是整个清单空。要说出是"哪一类"还空着。 */
      empty: function () {
        var t = KIND_TABS.filter(function (x) { return x.k === modelKind; })[0];
        var what = modelKind === 'all' ? '模型' : (t ? t.label : '') + '类模型';
        return '<div class="empty"><div>还没有' + what + '</div></div>';
      }
    });
    var total = $('#total');
    if (total) total.textContent = '共 ' + rows.length + ' 条数据';
  }

  /* ══ 模型类型与来源（2026-11-09）══════════════════════════════════
     用户原话：「模型类型不是肯定要的吗？不然新增的模型怎么去选择类型，怎么跟类型关联啊」
     类型是第一项，且决定下面出现哪些字段。视觉不做类型 —— 它是对话模型的属性（见 f-vision）。 */
  var KIND_DEF = [
    { k: 'chat', label: '对话' },
    { k: 'embed', label: '向量' },
    { k: 'rerank', label: '重排' },
    { k: 'asr', label: '语音' }
  ];
  var SRC_DEF = [{ k: 'api', label: 'API' }, { k: 'ollama', label: 'Ollama' }];
  var dlgKind = 'chat', dlgSrc = 'api', pendingTest = null;

  function paintChips() {
    var kb = $('#k-chips'), sb = $('#s-chips');
    if (kb) kb.innerHTML = KIND_DEF.map(function (t) {
      return '<button type="button" class="fchip" data-kind="' + t.k + '" aria-pressed="'
        + (dlgKind === t.k) + '">' + t.label + '</button>';
    }).join('');
    if (sb) sb.innerHTML = SRC_DEF.map(function (t) {
      /* 重排不支持 Ollama（真源与两家厂商文档一致），直接禁用而不是选了再报错 */
      var dis = t.k === 'ollama' && dlgKind === 'rerank';
      return '<button type="button" class="fchip" data-src="' + t.k + '" aria-pressed="'
        + (dlgSrc === t.k) + '"' + (dis ? ' disabled' : '') + '>' + t.label + '</button>';
    }).join('');
  }

  function applyNeed() {
    var box = $('#m-form'); if (!box) return;
    [].forEach.call(box.querySelectorAll('[data-need]'), function (el) {
      var ok = el.getAttribute('data-need').split(' ').indexOf(dlgKind) >= 0;
      /* 变灰不可改，但值留着 —— 手一滑切了类型再切回来，配置不能丢 */
      el.toggleAttribute('data-off', !ok);
      var inp = el.querySelector('input, select');
      if (inp) inp.disabled = !ok;
    });
    var isOllama = dlgSrc === 'ollama';
    var keyBox = box.querySelector('label[for="f-key"]');
    if (keyBox) keyBox.hidden = isOllama;
    if ($('#f-key')) $('#f-key').disabled = isOllama;
    if (isOllama && !($('#f-url').value || '').trim()) $('#f-url').value = 'http://localhost:11434/v1';
    syncTestBtn();
  }

  function setTestRes(kind) {
    var el = $('#dlg-test-res'); if (!el) return;
    el.textContent = kind === 'ok' ? '连接成功' : kind === 'bad' ? '连接失败' : '';
    el.className = 'rt' + (kind === 'ok' ? ' is-ok' : kind === 'bad' ? ' is-bad' : '');
  }

  /* 必填没齐时「测试连接」是灰的（真源图 2 同款）。embed 另要向量维度。 */
  function syncTestBtn() {
    var btn = $('#dlg-test'); if (!btn) return;
    var ok = ['f-name', 'f-url'].every(function (id) { return ($('#' + id).value || '').trim(); });
    if (dlgKind === 'embed' && !($('#f-dim').value || '').trim()) ok = false;
    btn.disabled = !ok || btn.getAttribute('data-run') === '1';
  }

  function collectHeaders() {
    var out = [];
    [].forEach.call(document.querySelectorAll('#hd-list .hd-row'), function (row) {
      var ins = row.querySelectorAll('input');
      var k = (ins[0].value || '').trim();
      if (k) out.push({ k: k, v: (ins[1].value || '').trim() });
    });
    return out;
  }

  function paintHeaders(list) {
    var box = $('#hd-list'); if (!box) return;
    box.innerHTML = '';
    (list || []).forEach(function (h) {
      var row = document.createElement('div');
      row.className = 'hd-row';
      row.innerHTML = '<input placeholder="头名，如 X-Tenant" aria-label="请求头名称" value="' + esc(h.k || '') + '">'
        + '<input placeholder="值" aria-label="请求头的值" value="' + esc(h.v || '') + '">'
        + '<button type="button" class="m-op is-danger" aria-label="删除这个请求头">删除</button>';
      row.querySelector('button').addEventListener('click', function () { row.remove(); });
      box.appendChild(row);
    });
  }

  /* 最小真实请求：不是 ping 端口，是问一句"这个模型存在吗"。
     ★生产必须走同源代理（xz-server 的 /xz/probe）：客户内网不会给前端域名开 CORS，
       浏览器直连一定失败。这里先直连，代理接口一接就换成它。 */
  /* 探测一个地址通不通。★2026-11-09 改走同源代理 /xz/probe：
     客户内网不会给前端域名开 CORS，浏览器直连 100% 失败 —— 那时这个按钮永远显示「连接失败」。
     服务端发请求还有一个好处：API Key 不出前端。
     代理不存在时（公网静态部署）退回直连，至少能测已开 CORS 的地址。 */
  function probe(url, method, key, headers) {
    var payload = { url: url, method: method || 'GET', key: key || '', headers: headers || [] };
    return fetch('/xz/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('no-proxy');
      return r.json();
    }).then(function (j) {
      return { ok: !!j.ok, status: j.status || 0, ms: j.ms || 0 };
    }).catch(function () {
      return fetch(url, { method: method || 'GET' }).then(function (r) {
        return { ok: r.ok, status: r.status, ms: 0 };
      }).catch(function () { return { ok: false, status: 0, ms: 0 }; });
    });
  }

  function openDlg(id) {
    EDIT_ID = id || null;
    var m = id ? CAP.modelById(id) : null;
    $('#dlg-t').textContent = m ? '编辑模型' : '新建模型';
    $('#f-name').value = m ? m.name : '';
    $('#f-label').value = m ? (m.label || '') : '';
    $('#f-vendor').value = m ? (m.vendor || '') : '';
    $('#f-url').value = m ? (m.url || '') : '';
    $('#f-key').value = m ? (m.key || '') : '';
    $('#f-temp').value = m ? m.temp : 0.2;
    $('#f-react').value = m ? m.react : 10;
    $('#f-out').value = m ? m.outMax : 32768;
    $('#f-ctx').value = m ? m.ctx : 128000;
    /* ★2026-11-09：类型/来源回填，并按类型决定哪些字段可用 */
    dlgKind = (m && m.kind) || 'chat';
    dlgSrc = (m && m.source) || 'api';
    pendingTest = (m && m.test) || null;
    $('#f-dim').value = m && m.embedDim ? m.embedDim : '';
    $('#f-topn').value = m && m.topn ? m.topn : '';
    $('#f-afmt').value = m && m.afmt ? m.afmt : '';
    $('#f-vision').value = m && m.vision ? '1' : '0';
    paintHeaders(m ? m.headers : []);
    paintChips(); applyNeed();
    setTestRes(pendingTest && pendingTest.fp === CAP.modelFp(m) ? (pendingTest.ok ? 'ok' : 'bad') : '');
    $('#dlg').hidden = false;
    setTimeout(function () { $('#f-name').focus(); }, 0);
  }
  function closeDlg() { $('#dlg').hidden = true; EDIT_ID = null; }

  /* ★2026-11-09：类型 Tab 点击。事件绑在容器上，Tab 是动态渲染的，绑不到每个按钮。 */
  var tabsBox = $('#mtabs');
  if (tabsBox) tabsBox.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-kind]') : null;
    if (!b) return;
    modelKind = b.getAttribute('data-kind');
    paintModels();
  });

  /* ── 类型 / 来源 chip ── */
  function bindChips(box, attr, apply) {
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[' + attr + ']') : null;
      if (!b || b.disabled) return;
      apply(b.getAttribute(attr));
      paintChips(); applyNeed();
    });
  }
  bindChips($('#k-chips'), 'data-kind', function (k) {
    dlgKind = k;
    if (k === 'rerank' && dlgSrc === 'ollama') dlgSrc = 'api';
  });
  bindChips($('#s-chips'), 'data-src', function (s) { dlgSrc = s; });

  /* ── 自定义请求头：加一行空键值对 ── */
  var hdAdd = $('#hd-add');
  if (hdAdd) hdAdd.addEventListener('click', function () { paintHeaders(collectHeaders().concat([{ k: '', v: '' }])); });

  /* ── 测试连接（左下角）── */
  var testBtn = $('#dlg-test');
  if (testBtn) testBtn.addEventListener('click', function () {
    var btn = this, saveBtn = $('#dlg-save');
    btn.setAttribute('data-run', '1'); btn.disabled = true; saveBtn.disabled = true;
    btn.textContent = '测试中…'; setTestRes('');
    var m = {
      source: dlgSrc,
      url: ($('#f-url').value || '').trim(),
      name: ($('#f-name').value || '').trim(),
      key: ($('#f-key').value || '').trim(),
      headers: collectHeaders()
    };
    var fp = CAP.modelFp(m);
    function done(ok, status) {
      btn.removeAttribute('data-run'); btn.textContent = '测试连接'; saveBtn.disabled = false;
      setTestRes(ok ? 'ok' : 'bad');
      /* 失败原因不上界面，只挂在 title 上给人排查（定稿 §9.7：界面只有两个词） */
      btn.title = 'HTTP ' + (status || '—');
      pendingTest = { at: Date.now(), ok: ok, status: status, fp: fp };
      if (EDIT_ID) { CAP.updateModel(EDIT_ID, { test: pendingTest }); paintModels(); }
      syncTestBtn();
    }
    probe(($('#f-url').value || '').trim().replace(/\/+$/, '') + '/models', 'GET', ($('#f-key').value || '').trim(), collectHeaders()).then(function (r) { done(r.ok, r.status); }).catch(function (e) {
      try { console.debug('[probe] 测试连接失败的原因（只给排查，不上界面）', e); } catch (x) {}
      done(false, 0);
    });
  });

  /* 必填项变了，按钮跟着变灰/可点 */
  ['f-name', 'f-url', 'f-dim'].forEach(function (id) {
    var el = $('#' + id);
    if (el) el.addEventListener('input', function () { setTestRes(''); syncTestBtn(); });
  });

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
      url: $('#f-url').value.trim(),
      key: $('#f-key').value.trim(),
      temp: Number($('#f-temp').value) || 0,
      react: Number($('#f-react').value) || 0,
      outMax: Number($('#f-out').value) || 0,
      ctx: Number($('#f-ctx').value) || 0,
      kind: dlgKind,
      source: dlgSrc,
      vision: $('#f-vision').value === '1',
      headers: collectHeaders(),
      embedDim: Number($('#f-dim').value) || 0,
      topn: Number($('#f-topn').value) || 0,
      afmt: $('#f-afmt').value.trim()
    };
    /* 测过、且测的就是这一版配置 → 把结果一起存下来。
       否则不传 test（保留旧值），列表里会因为指纹对不上显示「待重测」。 */
    var fpNow = CAP.modelFp({ source: dlgSrc, url: v.url, name: v.name, key: v.key, headers: v.headers });
    if (pendingTest && pendingTest.fp === fpNow) v.test = pendingTest;
    var isEdit = !!EDIT_ID;
    if (isEdit) CAP.updateModel(EDIT_ID, v);
    else CAP.addModel(v);
    closeDlg(); paintModels(); paintScenes();
    toast(isEdit ? '已保存' : '已新增');
  });

  /* 2026-11-05（用户）：「整页保存」。下拉改了先记在 PENDING 里，点右上「保存」才落库；
     没改过时保存按钮是灰的。下面的模型清单是即时动作，跟这张表单分开。 */
  var PENDING = {};
  function syncSave() {
    var dirty = Object.keys(PENDING).some(function (k) { return PENDING[k] !== CAP.sceneModel(k); });
    var b = $('#act-save'); if (b) b.disabled = !dirty;
  }
  $('#scenes').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-scene]'); if (!sel) return;
    PENDING[sel.getAttribute('data-scene')] = sel.value;
    syncSave();
  });
  $('#act-save').addEventListener('click', function () {
    Object.keys(PENDING).forEach(function (k) { CAP.setSceneModel(k, PENDING[k]); });
    PENDING = {}; syncSave(); toast('已保存');
  });
  syncSave();

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

  paintScenes();
  paintModels();
})();
