/* ability.js —— 一个能力：名称 + 说明 + 接口清单 + 能力说明书
   能力只是容器：apiIds 引用池子，界面不复制接口字段。
   ★ 说明书才是产物：装配到组件里的是这份文本。它由按钮生成，也可以由人直接改
     （改完就是人写的版本，docFrom 记成 manual，机器不再覆盖它）。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };

  var ID = '';
  var B = null;
  var BUSY = false;    /* 正在生成，防止保存键按第二下 */
  var CHANGED = false; /* 自上次生成后，接口清单动过 */

  /* 新建：先建一条空记录再改地址栏，刷新不会丢。 */
  function boot() {
    var q = new URLSearchParams(location.search);
    ID = q.get('id') || 'new';
    if (ID === 'new') {
      /* 「新建」会先落一条空记录（刷新不丢）。上次点到一半就走的空壳在这里收掉，
         否则清单里会越攒越多「未命名能力」。 */
      CAP.abilities().forEach(function (x) {
        if (!String(x.name || '').trim()) CAP.removeAbility(x.id);
      });
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

  function formDirty() {
    return $('#f-name').value.trim() !== (B.name || '')
      || $('#f-intro').value.trim() !== (B.intro || '')
      || $('#doc').value.trim() !== String(B.doc || '').trim();
  }
  /* 说明是选填（用户 2026-11-05 明确）。必填只有名称和至少一个接口。 */
  function filled() {
    return $('#f-name').value.trim() && (CAP.abilityById(ID).apiIds || []).length;
  }

  function paint() {
    B = CAP.abilityById(ID);
    if (!B) return;
    $('#crumb-name').textContent = B.name || '新建能力';
    document.title = (B.name || '新建能力') + ' · 能力详情';
    $('#f-name').value = B.name || '';
    $('#f-intro').value = B.intro || '';
    paintState();
    paintDoc();
    paintApis();
    syncBar();
  }

  /* 状态只描述事实：在生成、已就绪、这次没生成出来（带原因）、还没生成、
     接口变了说明书没跟上。 */
  function paintState() {
    var st = B.docState || 'none';
    var el = $('#md-state');
    var moved = (B.apiIds || []).join(',') !== String(B.docApis || '');
    if (BUSY || st === 'run') {
      el.textContent = '生成中…';
      el.style.color = 'var(--color-text-tertiary)';
    } else if (st === 'fail') {
      el.textContent = '这次没生成出来：' + (B.docErr || '模型没返回');
      el.style.color = 'var(--color-danger)';
    } else if (st === 'ready') {
      if (B.doc && moved) { el.textContent = '接口有变动，说明书要重新生成'; el.style.color = 'var(--color-warn-ink, var(--color-text-secondary))'; }
      else { el.textContent = '已就绪' + (B.docAt ? ' · ' + B.docAt : ''); el.style.color = 'var(--color-text-tertiary)'; }
    } else {
      el.textContent = '还没生成';
      el.style.color = 'var(--color-text-tertiary)';
    }
  }

  function paintDoc() {
    $('#doc').value = B.doc || '';
  }

  function paintApis() {
    var rows = CAP.abilityApis(ID);
    $('#api-title').textContent = '接口清单（' + rows.length + '）';
    var box = $('#api-list');
    if (!rows.length) {
      box.innerHTML = '<div class="abt-row" style="grid-template-columns:1fr;color:var(--color-text-tertiary)">还没有接口，点「添加接口」贴文档或填一条</div>';
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

  /* 保存键：没改过就是灰的；名称 + 至少一个接口是必须的，说明选填。 */
  function syncBar() {
    var btn = $('#act-save');
    var ok = filled();
    btn.disabled = BUSY || !(ok && (CHANGED || formDirty()));
    btn.title = ok ? '' : '要填能力名称，再加至少一个接口';
  }

  ['#f-name', '#f-intro', '#doc'].forEach(function (sel) {
    $(sel).addEventListener('input', function () { paintState(); syncBar(); });
  });

  /* ── 生成说明书：点了才生成。手改过的内容要覆盖，先说一声。 ── */
  function regenerate() {
    if (BUSY) return;
    if (!window.Gen || !Gen.abilityDoc) { toast('生成脚本没加载', 'error'); return; }
    if (!(CAP.abilityById(ID).apiIds || []).length) { toast('先加接口', 'error'); return; }
    BUSY = true;
    CAP.updateAbility(ID, { docState: 'run', docErr: '' });
    B = CAP.abilityById(ID);
    paintState(); syncBar();
    Gen.abilityDoc(CAP.abilityById(ID)).then(function (r) {
      CAP.updateAbility(ID, {
        doc: r.text, docState: 'ready', docAt: CAP.now(), docApis: (B.apiIds || []).join(','),
        docFrom: r.from || 'model', docErr: r.from === 'local' ? (r.why || '') : ''
      });
      BUSY = false; B = CAP.abilityById(ID);
      paintDoc(); paintState(); syncBar();
      toast('说明书已生成');
    }).catch(function (e) {
      CAP.updateAbility(ID, { docState: 'fail', docErr: String((e && e.message) || e) });
      BUSY = false; B = CAP.abilityById(ID);
      paintState(); syncBar();
      toast('没生成出来', 'error');
    });
  }

  $('#act-gen').addEventListener('click', function () {
    var cur = $('#doc').value.trim();
    if (!cur || cur === String(B.doc || '').trim()) { regenerate(); return; }
    Confirm.ask({
      title: '重新生成', body: '右边现在的内容会被覆盖。', ok: '重新生成',
      onOk: regenerate
    });
  });

  /* 保存只落库，不偷偷生成 —— 生成是按钮上的事，什么时候写由人决定。 */
  $('#act-save').addEventListener('click', function () {
    var n = $('#f-name').value.trim(), i = $('#f-intro').value.trim(), d = $('#doc').value.trim();
    if (!n) { toast('填能力名称', 'error'); $('#f-name').focus(); return; }
    if (!(CAP.abilityById(ID).apiIds || []).length) { toast('先加接口', 'error'); return; }
    var old = String(B.doc || '');
    var patch = { name: n, intro: i, doc: d };
    if (d !== old.trim()) { patch.docFrom = 'manual'; patch.docErr = ''; patch.docAt = CAP.now(); }
    if (d) patch.docState = 'ready';
    else { patch.docState = 'none'; patch.docAt = ''; }
    CAP.updateAbility(ID, patch);
    CHANGED = false; B = CAP.abilityById(ID);
    paintDoc(); paintState(); paintApis(); syncBar();
    toast('已保存');
  });

  $('#api-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="rm"]'); if (!b) return;
    var aid = b.getAttribute('data-id');
    var cur = (CAP.abilityById(ID).apiIds || []).filter(function (x) { return x !== aid; });
    CAP.updateAbility(ID, { apiIds: cur });
    CHANGED = true;
    B = CAP.abilityById(ID);
    paintApis(); paintState(); syncBar();
    toast('已移除');
  });

  /* ── 添加接口：两条路 ──────────────────────────────────────────────
     100 个接口不可能手敲 100 次。默认给「贴一段内容自动拆」：
       OpenAPI / Swagger 的 JSON、YAML、一段段接口说明（含 curl）都行，
       本地规则先拆（不花模型钱），拆不动再交给模型读；
       拆完先列出来给人看一眼，再一次性加入。
     手填一条留在旁边：客户只口头说了一个接口时用它。 */
  var ADD = { mode: 'bulk', parsed: null, busy: false, text: '' };

  /* 入参和返回都是 JSON（用户 2026-11-05 定），写进文档时用代码块，模型照着好读。 */
  function apiDoc(v) {
    var s = '### ' + v.name + '\n\n**用途**：' + (v.summary || v.desc || v.name);
    if (v.params) s += '\n\n**入参**：\n\n```json\n' + v.params + '\n```';
    if (v.returns) s += '\n\n**返回**：\n\n```json\n' + v.returns + '\n```';
    return s;
  }

  /* 加入接口：同一个方法+路径只存一条；已经在这个能力里的不重复加。 */
  function addItems(items) {
    var ids = (CAP.abilityById(ID).apiIds || []).slice(), n = 0;
    items.forEach(function (x) {
      if (!x.path) return;
      var id = CAP.fingerprint(x.method, x.path, '');
      if (!CAP.apiById(id)) {
        CAP.addApi({
          id: id, name: (x.name || (x.method + ' ' + x.path)).slice(0, 24),
          desc: x.summary || '', summary: x.summary || '', method: x.method, path: x.path,
          host: '', project: (B && B.project) || x.project || '未标注',
          source: (B && B.project) || x.project || '未标注',
          params: x.params || '', returns: x.returns || '',
          raw: x.raw || (x.method + ' ' + x.path), doc: apiDoc(x), state: 'ok', on: true, at: ''
        });
      }
      if (ids.indexOf(id) < 0) { ids.push(id); n++; }
    });
    CAP.updateAbility(ID, { apiIds: ids });
    CHANGED = true; B = CAP.abilityById(ID);
    return n;
  }

  function openAdd() {
    var old = $('#pk-mask'); if (old) old.remove();
    ADD = { mode: 'bulk', parsed: null, busy: false, text: '' };
    document.body.insertAdjacentHTML('beforeend',
      '<div class="nf-mask" id="pk-mask"><div class="nf" role="dialog" aria-modal="true" aria-labelledby="pk-t" style="width:660px;max-width:calc(100vw - 48px)">'
      + '<div class="nf-hd"><b id="pk-t">添加接口</b>'
      + '<button type="button" class="icon-btn" id="pk-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
      + '<div class="nf-bd" id="pk-bd"></div>'
      + '<div class="nf-ft"><span id="pk-left" style="margin-right:auto"></span>'
      + '<button type="button" class="btn ghost" id="pk-cancel">取消</button>'
      + '<button type="button" class="btn primary" id="pk-ok">解析</button></div>'
      + '</div></div>');
    $('#pk-x').addEventListener('click', function () { $('#pk-mask').remove(); });
    $('#pk-cancel').addEventListener('click', function () { $('#pk-mask').remove(); });
    $('#pk-ok').addEventListener('click', onAddOk);
    paintAdd();
  }

  function paintFoot(leftHtml, okText, okOff) {
    $('#pk-left').innerHTML = leftHtml;
    var ok = $('#pk-ok');
    ok.textContent = okText; ok.disabled = !!okOff;
    var l = $('#pk-left').firstChild;
    if (l && l.id === 'pk-to-form') l.addEventListener('click', function () { ADD.mode = 'form'; paintAdd(); });
    if (l && l.id === 'pk-to-bulk') l.addEventListener('click', function () { ADD.mode = 'bulk'; paintAdd(); });
    if (l && l.id === 'pk-back') l.addEventListener('click', function () { ADD.mode = 'bulk'; paintAdd(); });
  }

  function paintAdd() {
    var bd = $('#pk-bd');
    if (ADD.mode === 'bulk') {
      var cur = CAP.abilityById(ID).apiIds || [];
      bd.innerHTML = ''
        + '<div class="nf-row"><label for="fb-raw">把接口文档或说明贴进来</label>'
        + '<textarea id="fb-raw" style="min-height:210px" placeholder="OpenAPI / Swagger 的 JSON 或 YAML；也可以是一段段接口说明，空行分开。贴完点「解析」。"></textarea></div>'
        + '<div class="nf-row" style="flex-direction:row;align-items:center;gap:var(--space-12)">'
        + '<label for="fb-file" class="abt-op" style="margin:0">或者选一个文件</label>'
        + '<input type="file" id="fb-file" accept=".json,.yaml,.yml,.txt,.md" style="font-size:var(--font-size-caption);max-width:260px">'
        + '<span class="abt-hint" id="fb-tip" style="margin-left:auto"></span></div>';
      $('#fb-raw').value = ADD.text || '';
      $('#fb-file').addEventListener('change', onAddFile);
      paintFoot('<button type="button" class="abt-op" id="pk-to-form">手动填一条</button>',
        ADD.busy ? '解析中…' : '解析', ADD.busy);
      return;
    }
    if (ADD.mode === 'form') {
      bd.innerHTML = ''
        + '<div class="nf-row"><label for="fa-name">接口名称<span class="nf-req">*</span></label><input id="fa-name" placeholder="这个接口叫什么"></div>'
        + '<div class="nf-row" style="flex-direction:row;gap:var(--space-8)">'
        +   '<div style="flex:0 0 108px;display:flex;flex-direction:column;gap:var(--space-8)"><label for="fa-m">方法</label><select id="fa-m"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></div>'
        +   '<div style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--space-8)"><label for="fa-path">路径<span class="nf-req">*</span></label><input id="fa-path" placeholder="/api/v1/…"></div>'
        + '</div>'
        + '<div class="nf-row"><label for="fa-desc">说明</label><input id="fa-desc" placeholder="干什么用，一句话"></div>'
        + '<div class="nf-row"><label for="fa-in">入参</label><textarea id="fa-in" style="min-height:80px;font-family:var(--font-family-mono);font-size:var(--font-size-caption)" placeholder="{&quot;page&quot;: 1, &quot;status&quot;: &quot;done&quot;}"></textarea></div>'
        + '<div class="nf-row"><label for="fa-out">返回</label><textarea id="fa-out" style="min-height:80px;font-family:var(--font-family-mono);font-size:var(--font-size-caption)" placeholder="{&quot;total&quot;: 0, &quot;items&quot;: []}"></textarea></div>';
      ['#fa-name', '#fa-path'].forEach(function (sel) {
        $(sel).addEventListener('input', function () {
          $('#pk-ok').disabled = !($('#fa-name').value.trim() && $('#fa-path').value.trim());
        });
      });
      paintFoot('<button type="button" class="abt-op" id="pk-to-bulk">贴一段内容，一次拆多条</button>', '添加', true);
      return;
    }
    /* list：拆出来的先给人看一眼 */
    var items = ADD.parsed || [];
    var curIds = CAP.abilityById(ID).apiIds || [];
    var dup = 0, rows = items.map(function (x) {
      var inIt = curIds.indexOf(CAP.fingerprint(x.method, x.path, '')) >= 0;
      if (inIt) dup++;
      return '<div class="abt-row" style="grid-template-columns:minmax(0,1fr) 60px minmax(0,190px) 72px">'
        + '<span>' + esc(x.name || '未命名') + '</span>'
        + '<span class="abt-m">' + esc(x.method) + '</span>'
        + '<span class="abt-p" title="' + esc(x.path) + '">' + esc(x.path) + '</span>'
        + '<span class="abt-hint" style="text-align:right">' + (inIt ? '已在里面' : '') + '</span></div>';
    }).join('');
    bd.innerHTML = '<div class="abt-sec" style="margin:0 0 var(--space-8)"><b>识别到 ' + items.length + ' 个接口</b>'
      + (dup ? '<span class="abt-hint" style="margin-left:var(--space-8)">其中 ' + dup + ' 个已经在这个能力里</span>' : '') + '</div>'
      + '<div class="abt-list" style="max-height:320px;overflow:auto">' + rows + '</div>';
    paintFoot('<button type="button" class="abt-op" id="pk-back">重新贴</button>',
      '加入 ' + (items.length - dup) + ' 个', items.length - dup === 0);
  }

  function onAddFile(e) {
    var f = (e.target.files || [])[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      ADD.text = String(r.result || '').slice(0, 20000);
      var ta = $('#fb-raw'); if (ta) ta.value = ADD.text;
      var tp = $('#fb-tip'); if (tp) tp.textContent = '已读入 ' + f.name;
    };
    r.readAsText(f);
  }

  function onAddOk() {
    if (ADD.mode === 'form') {
      var v = {
        name: $('#fa-name').value.trim(), method: $('#fa-m').value, path: $('#fa-path').value.trim(),
        desc: $('#fa-desc').value.trim(), summary: $('#fa-desc').value.trim(),
        params: $('#fa-in').value.trim(), returns: $('#fa-out').value.trim()
      };
      if (!v.name || !v.path) return;
      addItems([v]);
      $('#pk-mask').remove();
      paintApis(); paintState(); syncBar();
      toast('已添加接口');
      return;
    }
    if (ADD.mode === 'list') {
      var items = (ADD.parsed || []).filter(function (x) { return x.path; });
      var n = addItems(items);
      $('#pk-mask').remove();
      paintApis(); paintState(); syncBar();
      toast(n ? ('已加入 ' + n + ' 个接口，保存后生成说明书') : '这些接口都已经在里面了');
      return;
    }
    /* bulk：先本地规则，拆不出来再交给模型 */
    var t = ($('#fb-raw') ? $('#fb-raw').value : '').trim();
    if (!t) { toast('先把内容贴进来', 'error'); return; }
    ADD.text = t;
    var local = CAP.parseApis(t);
    if (local.length) { ADD.parsed = local; ADD.mode = 'list'; paintAdd(); return; }
    ADD.busy = true; paintAdd();
    Gen.parseApis(t).then(function (r) {
      ADD.busy = false;
      if (!r || !r.length) {
        ADD.mode = 'bulk'; paintAdd();
        var tp = $('#fb-tip'); if (tp) tp.textContent = '这段内容里没认出接口';
        return;
      }
      ADD.parsed = r; ADD.mode = 'list'; paintAdd();
    }).catch(function (e) {
      ADD.busy = false; ADD.mode = 'bulk'; paintAdd();
      var t2 = $('#fb-tip'); if (t2) t2.textContent = '没拆出来：' + String((e && e.message) || e);
    });
  }

  var sec = $('#api-title') ? $('#api-title').parentNode : null;
  if (sec) {
    sec.insertAdjacentHTML('beforeend', '<button type="button" class="abt-op" id="act-add" style="margin-left:auto">＋ 添加接口</button>');
    $('#act-add').addEventListener('click', openAdd);
  }

  if (boot()) paint();
})();
