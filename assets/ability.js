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
      box.innerHTML = '<div class="abt-row" style="grid-template-columns:1fr;color:var(--color-text-tertiary)">还没有接口，从「添加接口」里挑</div>';
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

  /* ── 添加接口：从一个面板里勾。只勾，不填任何字段。 ── */
  function openPicker() {
    var cur = CAP.abilityById(ID).apiIds || [];
    var avail = CAP.apis().filter(function (a) { return cur.indexOf(a.id) < 0; });
    if (!avail.length) { toast('池子里没有可加的接口，先「导入项目」'); return; }
    var pick = {};
    document.body.insertAdjacentHTML('beforeend',
      '<div class="nf-mask" id="pk-mask"><div class="nf" role="dialog" aria-modal="true" aria-labelledby="pk-t">'
      + '<div class="nf-hd"><b id="pk-t">添加接口</b>'
      + '<button type="button" class="icon-btn" id="pk-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
      + '<div class="nf-bd" id="pk-list"></div>'
      + '<div class="nf-ft"><span class="it-sp"></span>'
      + '<button type="button" class="btn ghost" id="pk-cancel">取消</button>'
      + '<button type="button" class="btn primary" id="pk-ok" disabled>添加</button></div>'
      + '</div></div>');
    $('#pk-list').innerHTML = avail.map(function (a) {
      return '<label style="display:grid;grid-template-columns:20px minmax(0,1fr) 56px 160px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--color-border-hairline);font-size:var(--font-size-body);cursor:pointer">'
        + '<input type="checkbox" data-pick="' + esc(a.id) + '">'
        + '<span>' + esc(a.name) + '</span>'
        + '<span class="abt-m">' + esc(a.method || 'GET') + '</span>'
        + '<span class="abt-p">' + esc(a.path || '—') + '</span></label>';
    }).join('');
    function sync() {
      var n = Object.keys(pick).length;
      $('#pk-ok').disabled = !n;
      $('#pk-ok').textContent = n ? ('添加 ' + n + ' 个') : '添加';
    }
    $('#pk-list').addEventListener('change', function (e) {
      var c = e.target.closest('[data-pick]'); if (!c) return;
      if (c.checked) pick[c.getAttribute('data-pick')] = 1; else delete pick[c.getAttribute('data-pick')];
      sync();
    });
    function close() { var m = $('#pk-mask'); if (m) m.remove(); }
    $('#pk-x').addEventListener('click', close);
    $('#pk-cancel').addEventListener('click', close);
    $('#pk-ok').addEventListener('click', function () {
      var ids = (CAP.abilityById(ID).apiIds || []).concat(Object.keys(pick));
      CAP.updateAbility(ID, { apiIds: ids });
      CHANGED = true;
      B = CAP.abilityById(ID);
      close(); paintApis(); paintState(); syncBar();
      toast('已添加 ' + Object.keys(pick).length + ' 个接口');
    });
  }

  var sec = $('#api-title') ? $('#api-title').parentNode : null;
  if (sec) {
    sec.insertAdjacentHTML('beforeend', '<button type="button" class="abt-op" id="act-add" style="margin-left:auto">＋ 添加接口</button>');
    $('#act-add').addEventListener('click', openPicker);
  }

  if (boot()) paint();
})();
