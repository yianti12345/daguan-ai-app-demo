/* ability.js —— 一个能力：名称 + 说明 + 接口清单 + MD 文档
   能力只是容器：apiIds 引用池子，界面不复制接口字段。
   ★ MD 才是产物：装配到组件里的是这份文档，所以保存即生成，不给手改
     （改了就说不清是谁写的，也让"装配的是 MD"这句话落不了地）。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var toast = function (m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); };

  /* MD 是给模型的，但人也要能读：只做最小渲染（标题/加粗/行内代码），
     不引第三方库、不搞完整 markdown。 */
  /* 「## 用途」和它下面那句话常在同一块里（中间只有一个换行），
     按块整体判断是不是标题会把正文一起吞掉 —— 必须逐行看。 */
  function mdHtml(md) {
    var e = esc;
    function inline(s) {
      return e(s).replace(/\*\*([^*]+)\*\*/g, '<b style="font-weight:600">$1</b>')
        .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-family-mono);font-size:var(--font-size-caption);background:var(--surface-sunken-2);border-radius:var(--radius-xs);padding:0 4px">$1</code>')
        .replace(/\n/g, '<br>');
    }
    return String(md || '').split(/\n{2,}/).map(function (blk) {
      var lines = blk.split('\n'), out = [];
      var h = lines[0].match(/^#{1,4}\s+(.+)$/);
      if (h) { out.push('<p style="margin:0 0 8px;font-size:var(--font-size-heading);font-weight:600;color:var(--color-text-primary)">' + e(h[1]) + '</p>'); lines.shift(); }
      var rest = lines.join('\n').trim();
      if (rest) out.push('<p style="margin:0 0 10px">' + inline(rest) + '</p>');
      return out.join('');
    }).join('');
  }

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
      || $('#f-intro').value.trim() !== (B.intro || '');
  }
  function filled() {
    return $('#f-name').value.trim()
      && $('#f-intro').value.trim()
      && (CAP.abilityById(ID).apiIds || []).length;
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

  /* 状态只描述事实：在生成、已就绪、失败（带原因）、还没生成、改了没重生成。 */
  function paintState() {
    var st = B.docState || 'none';
    var el = $('#md-state'), rt = $('#act-retry');
    if (st === 'run') {
      el.textContent = 'MD 生成中…';
      el.style.color = 'var(--color-text-tertiary)';
    } else if (st === 'fail') {
      el.textContent = 'MD 生成失败：' + (B.docErr || '模型没返回');
      el.style.color = 'var(--color-danger)';
    } else if (st === 'ready') {
      var moved = CHANGED || formDirty();
      el.textContent = moved ? '有改动，保存后重新生成' : ('MD 已就绪' + (B.docAt ? ' · ' + B.docAt : ''));
      el.style.color = moved ? 'var(--color-text-tertiary)' : '';
    } else {
      el.textContent = 'MD 还没生成';
      el.style.color = 'var(--color-text-tertiary)';
    }
    /* 重试只在"本来该由模型写、但模型没写成"时出现：真失败，或者退成了按文档拼。 */
    var canRetry = st === 'fail' || (st === 'ready' && B.docFrom === 'local' && !!B.docErr);
    if (rt) rt.hidden = !(canRetry && !BUSY);
  }

  function paintDoc() {
    var body = B.doc
      ? mdHtml(B.doc)
      : '<span class="abt-hint">保存后按这些接口写出来</span>';
    var old = (B.docState === 'fail' && B.doc)
      ? '<div class="abt-hint" style="margin:0 0 8px;color:var(--color-danger)">下面是上一次生成的</div>'
      : '';
    $('#doc').innerHTML = old + body;
    /* 来源照实写：模型写的和按接口文档拼的，不是一回事，界面上得分得开。 */
    var src = $('#doc-src');
    if (src) {
      src.textContent = '只读 · ' + (B.docFrom === 'model' ? '模型生成' : (B.doc ? '按接口文档拼的' : '还没生成'));
      src.title = B.docErr || '';
    }
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

  /* 保存键：没改过就是灰的；名称、说明、至少一个接口三样齐了才算填完。 */
  function syncBar() {
    var btn = $('#act-save');
    var ok = filled();
    btn.disabled = BUSY || !(ok && (CHANGED || formDirty()));
    btn.title = ok ? '' : '要填名称和说明，再加至少一个接口';
  }

  $('#f-name').addEventListener('input', function () { paintState(); syncBar(); });
  $('#f-intro').addEventListener('input', function () { paintState(); syncBar(); });

  /* ── 保存 = 落库 + 生成 MD。生成失败就记失败，不拿旧内容冒充新的。 ── */
  function regenerate() {
    if (!window.Gen || !Gen.abilityDoc) {
      CAP.updateAbility(ID, { docState: 'fail', docErr: '生成脚本没加载' });
      paint(); return;
    }
    BUSY = true; CHANGED = false;
    CAP.updateAbility(ID, { docState: 'run', docErr: '' });
    B = CAP.abilityById(ID);
    paintState(); paintDoc(); syncBar();
    Gen.abilityDoc(CAP.abilityById(ID)).then(function (r) {
      CAP.updateAbility(ID, {
        doc: r.text, docState: 'ready', docAt: CAP.now(),
        docFrom: r.from || 'model', docErr: r.from === 'local' ? (r.why || '') : ''
      });
      BUSY = false; paint(); toast('MD 已生成');
    }).catch(function (e) {
      CAP.updateAbility(ID, { docState: 'fail', docErr: String((e && e.message) || e) });
      BUSY = false; paint(); toast('MD 没生成出来', 'error');
    });
  }

  $('#act-save').addEventListener('click', function () {
    var n = $('#f-name').value.trim(), i = $('#f-intro').value.trim();
    if (!n) { toast('填能力名称', 'error'); $('#f-name').focus(); return; }
    if (!i) { toast('填说明', 'error'); $('#f-intro').focus(); return; }
    if (!(CAP.abilityById(ID).apiIds || []).length) { toast('先加一个接口', 'error'); return; }
    CAP.updateAbility(ID, { name: n, intro: i });
    regenerate();
  });

  $('#act-retry').addEventListener('click', function () { regenerate(); });

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

  function apiDoc(v) {
    return '### ' + v.name + '\n\n**用途**：' + (v.summary || v.desc || v.name)
      + (v.params ? '\n\n**入参**：' + v.params : '')
      + (v.returns ? '\n\n**返回**：' + v.returns : '');
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
        + '<div class="nf-row"><label for="fa-in">入参</label><textarea id="fa-in" style="min-height:56px" placeholder="要传什么，没有就不写"></textarea></div>'
        + '<div class="nf-row"><label for="fa-out">返回</label><textarea id="fa-out" style="min-height:56px" placeholder="返回什么，没有就不写"></textarea></div>';
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
