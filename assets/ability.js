/* ability.js —— 一个能力：名称 + 说明 + 接口清单 + 能力说明书
   能力只是容器：apiIds 引用池子，界面不复制接口字段。
   ★ 说明书才是产物：装配到组件里的是这份文本。它由按钮生成，也可以由人直接改
     （改完就是人写的版本，docFrom 记成 manual，机器不再覆盖它）。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
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
      el.classList.remove('is-danger');
    } else if (st === 'fail') {
      el.textContent = '这次没生成出来：' + (B.docErr || '模型没返回');
      el.classList.add('is-danger');
    } else if (st === 'ready') {
      el.classList.remove('is-danger');
      el.textContent = (B.doc && moved)
        ? '接口有变动，说明书要重新生成'
        : ('已就绪' + (B.docAt ? ' · ' + B.docAt : ''));
    } else {
      el.textContent = '还没生成';
      el.classList.remove('is-danger');
    }
  }

  function paintDoc() {
    $('#doc').value = B.doc || '';
  }

  /* ══ 接口卡片：把"看得到"这件事做出来（2026-11-09）══════════════════════
     用户原话：「接口的具体信息我现在完全看不到，还需要每个单独编辑看下，太恶心了，
                我需要每个接口所有的信息都展示出来」。
     原来每行只画 4 格（名称/方法/路径/移除），入参、返回、原始文本一个都没露过。
     数据层其实一直有这三样（params / returns / raw）。 */

  /* 入参在数据里是**一段 JSON 文本**（capability.js 的 paramJson 写进去的），不是数组。
     能解析成数组就画四列表格；解析不了（自由文本、或空的）就原样给 <pre> —— 不假装成表格。 */
  function parseList(str) {
    if (!str) return null;
    try {
      var v = JSON.parse(str);
      if (!Array.isArray(v) || !v.length) return null;
      return v.map(function (p) {
        var t = p.type || (p.schema && p.schema.type) || '';
        return {
          name: p.name || p.key || '',
          type: typeof t === 'string' ? t : '',
          required: !!p.required,
          desc: p.description || p.desc || ''
        };
      });
    } catch (e) { return null; }
  }

  /* ★2026-11-09：raw 里其实什么都有，只是从没被解析过。
     实测第一条的 raw 是：
       curl 'https://audit.example.com/api/v1/audit/tasks?page=1&per_page=10&status=done' -H 'Authorization: Bearer <token>'
     域名、三个 query 参数、请求头全在里面 —— 而界面上原来只显示「入参 —」。
     能确定的就抽出来（域名 / query / 请求头）；抽不到的（返回结构）老实说没有。 */
  function parseRaw(raw) {
    var out = { host: '', url: '', query: [], headers: [], body: [] };
    var s = String(raw || '');
    if (!s) return out;

    /* ① 完整 URL → 域名 + query 参数 */
    var m = s.match(/https?:\/\/[^\s'"]+/);
    if (m) {
      out.url = m[0];
      var parts = m[0].split('?');
      var hm = parts[0].match(/^(https?:\/\/[^\/]+)/);
      out.host = hm ? hm[1] : '';
      if (parts[1]) {
        parts[1].split('&').forEach(function (kv) {
          var p = kv.split('=');
          if (p[0]) out.query.push({ name: p[0], type: 'string', required: false, desc: p[1] ? '示例：' + p[1] : '' });
        });
      }
    }

    /* ② 请求头 -H 'Name: value' */
    var re = /-H\s+'([^:'"]+):\s*([^']*)'/g, h;
    while ((h = re.exec(s))) out.headers.push({ k: h[1], v: h[2] });

    /* ③ curl -d 'a=1&b=2' 这种表单体（原来看不见，等于把入参吞了） */
    var dm = s.match(/(?:-d|--data(?:-raw|-binary)?)\s+['"]([^'"]+)['"]/);
    if (dm && dm[1].indexOf('=') >= 0 && dm[1].indexOf('{') < 0) {
      dm[1].split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) out.body.push({ name: p[0], type: 'string', required: false, desc: p[1] ? '示例：' + p[1] : '' });
      });
    }

    /* ④ 文字里写的 body: {"k":"v"} */
    var bm = s.match(/body:\s*(\{[\s\S]*?\})(?:\s|$)/);
    if (bm) {
      try {
        var obj = JSON.parse(bm[1]);
        Object.keys(obj).forEach(function (k) {
          var v = obj[k];
          out.body.push({
            name: k,
            type: v === null ? 'null' : (Array.isArray(v) ? 'array' : typeof v),
            required: false,
            desc: '示例：' + (typeof v === 'string' ? v : JSON.stringify(v))
          });
        });
      } catch (e) { /* 不是合法 JSON 就不猜 */ }
    }

    /* ⑤ 路径参数：/clients/C00012 这类末尾的具体值，说明这个接口要带一个 id */
    var pm = (out.url || s).match(/\/[A-Za-z0-9_-]+\/([A-Z]{1,3}\d{3,}|\d{3,})(?:[\s'"?#]|$)/);
    if (pm) out.query.push({ name: 'path 参数', type: 'string', required: true, desc: '示例：' + pm[1] });

    return out;
  }

  function block(title, list, raw, fromRaw) {
    /* 登记过就用登记的；没登记但 raw 里解析得出来，就用解析出来的，并注明来源 ——
       不把"解析出来的"和"登记过的"混为一谈。 */
    var use = (list && list.length) ? list : (fromRaw && fromRaw.length ? fromRaw : null);
    var note = (!list || !list.length) && fromRaw && fromRaw.length ? '（从原始请求里解析）' : '';
    if (use) {
      return '<div class="api-cap">' + title + (note ? '<span class="api-note">' + note + '</span>' : '') + '</div>'
        + '<table class="api-tbl"><thead><tr>'
        + '<th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>'
        + use.map(function (p) {
            return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.type) + '</td>'
              + '<td>' + (p.required ? '是' : '') + '</td><td>' + esc(p.desc) + '</td></tr>';
          }).join('')
        + '</tbody></table>';
    }
    if (raw && String(raw).trim()) {
      return '<div class="api-cap">' + title + '</div><pre class="api-raw">' + esc(raw) + '</pre>';
    }
    return '<div class="api-cap">' + title + '</div><p class="api-empty">没有登记' + title + '</p>';
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
        /* ★2026-11-09：容器换成 .api-list（flex 纵向）后，这里还留着 .abt-row（4 列 grid + 底边），
           放进来就是一条横排错位的东西。改成与正常卡片同构的占位卡。 */
        return '<div class="api-card" data-off="true" data-id="' + esc(x.id) + '">'
          + '<div class="api-hd"><span class="api-p">接口已删除</span><span class="api-m">' + esc(x.id) + '</span></div>'
          + '<div class="api-sub"><span>这个接口已从库里移除</span>'
          +   '<span class="api-ops"><button class="abt-op is-danger" type="button" data-act="rm" data-id="' + esc(x.id) + '">移除</button></span>'
          + '</div></div>';
      }
      var a = x.api;
      var pin = parseList(a.params), pout = parseList(a.returns);
      var pr = parseRaw(a.raw);
      return '<div class="api-card" data-id="' + esc(a.id) + '">'
        /* 第一行：方法 + 路径 + 折叠箭头（整行可点） */
        + '<button class="api-hd" type="button" aria-expanded="false" data-act="fold">'
        +   '<svg class="api-caret" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
        +   '<span class="api-m">' + esc(a.method || 'GET') + '</span>'
        +   '<span class="api-p" title="' + esc(a.path || '') + '">' + esc(a.path || '—') + '</span>'
        + '</button>'
        /* 第二行：名称 + 规模 + 操作 */
        + '<div class="api-sub">'
        +   '<span class="api-n">' + esc(a.name) + '</span>'
        +   '<span>' + (pin || pr.query.length ? '入参 ' + (pin ? pin.length : pr.query.length) : '入参 —')
            + ' · ' + (pout ? '返回 ' + pout.length : '返回 —') + '</span>'
        +   '<span class="api-ops">'
        +     '<button class="abt-op" type="button" data-act="test" data-id="' + esc(a.id) + '">测试连通</button>'
        +     '<button class="abt-op is-danger" type="button" data-act="rm" data-id="' + esc(a.id) + '">移除</button>'
        +   '</span>'
        + '</div>'
        /* 展开：入参表 / 返回表 / 原始文本 */
        + '<div class="api-body" hidden>'
        +   (pr.host ? '<div class="api-cap">地址</div><pre class="api-raw">' + esc(pr.url || (pr.host + (a.path || ''))) + '</pre>' : '')
        +   block('入参', pin, a.params, pr.query)
        +   (pr.body.length ? block('请求体', null, '', pr.body) : '')
        +   (pr.headers.length ? '<div class="api-cap">请求头</div><table class="api-tbl"><thead><tr><th>名称</th><th>值</th></tr></thead><tbody>'
              + pr.headers.map(function (h) { return '<tr><td>' + esc(h.k) + '</td><td>' + esc(h.v) + '</td></tr>'; }).join('')
              + '</tbody></table>' : '')
        +   block('返回', pout, a.returns)
        +   (a.raw && String(a.raw).trim() ? '<div class="api-cap">原始</div><pre class="api-raw">' + esc(a.raw) + '</pre>' : '')
        + '</div>'
        + '</div>';
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

  /* ── 折叠 / 测试连通（2026-11-09）──
     单独一个监听器：原来那个处理「移除」，这里只处理新加的两个动作，互不干扰。 */
  $('#api-list').addEventListener('click', function (e) {
    var f = e.target.closest ? e.target.closest('[data-act="fold"]') : null;
    if (f) {
      var card = f.closest('.api-card');
      var body = card ? card.querySelector('.api-body') : null;
      if (!body) return;
      var open = f.getAttribute('aria-expanded') === 'true';
      f.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
      return;
    }
    var t = e.target.closest ? e.target.closest('[data-act="test"]') : null;
    if (t) testApi(t.getAttribute('data-id'), t);
  });

  /* 接口的「测试连通」：发一个真实请求看通不通。
     ★地址从哪来：数据层只有 api.host（种子里是空串）与 api.path。
       path 本身是完整 URL 就直接打它；否则拼 host+path；两个都没有 → 说清缺什么，不给死按钮。
     ★生产必须走同源代理（xz-server 的 /xz/probe）：客户内网不会给前端开 CORS，
       浏览器直连一定失败。这里先直连，代理一接就替换成它（与模型页的 probe 同一口径）。 */
  function testApi(id, btn) {
    var a = ((window.CAP && CAP.apis()) || []).filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var path = a.path || '';
    var base = (a.host || parseRaw(a.raw).host || '').replace(/\/+$/, '');
    var url = /^https?:\/\//i.test(path) ? path : (base ? base + path : '');
    if (!url) { toast('这个接口没填地址，先在编辑里补上'); return; }
    var card = btn.closest ? btn.closest('.api-card') : null;
    var resEl = card ? card.querySelector('.api-testres') : null;
    if (!resEl) {
      resEl = document.createElement('span');
      resEl.className = 'api-testres';
      btn.parentNode.insertBefore(resEl, btn);
    }
    btn.disabled = true; btn.textContent = '测试中…';
    resEl.textContent = ''; resEl.className = 'api-testres';
    /* ★2026-11-09 走同源代理（与模型页同一口径）：客户内网不给前端开 CORS，直连必失败。
       ★同轮修正：这里原来写 pr.headers —— pr 是渲染函数里的局部变量，testApi 作用域里根本没有，
         抛的是同步 ReferenceError，Promise 的 .catch 捕不到，按钮就永远卡在「测试中…」。
         现在自己在函数里重新解析一次。 */
    var pr2 = parseRaw(a.raw);
    var payload = { url: url, method: a.method || 'GET', headers: pr2.headers || [] };
    fetch('/xz/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('no-proxy');
      return r.json();
    }).then(function (j) {
      return { ok: !!j.ok, status: j.status || 0 };
    }).catch(function (err) {
      try { console.debug('[probe] 接口测试退回直连（本页可能没有 /xz/probe）', err); } catch (x) {}
      return fetch(url, { method: a.method || 'GET' }).then(function (r) {
        return { ok: r.ok, status: r.status };
      }).catch(function () { return { ok: false, status: 0 }; });
    }).then(function (r) {
      btn.disabled = false; btn.textContent = '测试连通';
      resEl.textContent = r.ok ? '连接成功' : '连接失败';
      resEl.className = 'api-testres ' + (r.ok ? 'is-ok' : 'is-bad');
      btn.title = 'HTTP ' + (r.status || '—');
    });
  }

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
      '<div class="nf-mask" id="pk-mask"><div class="nf" role="dialog" aria-modal="true" aria-labelledby="pk-t">'
      + '<div class="nf-hd"><b id="pk-t">添加接口</b>'
      + '<button type="button" class="icon-btn" id="pk-x" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
      /* 页签用现成的 .p-tabs / .p-tab（装配能力面板同一套），间距一行都不许在这里改；
         上一版给它加了 padding:0 和负 margin，等于把现成组件的样式改掉了 —— 那就是另搞一套。 */
      + '<div class="p-tabs" id="pk-tabs" role="tablist" aria-label="添加方式">'
      +   '<button type="button" role="tab" class="p-tab" data-mode="bulk" aria-selected="true">贴内容自动拆</button>'
      +   '<button type="button" role="tab" class="p-tab" data-mode="form" aria-selected="false">手动填一条</button>'
      + '</div>'
      + '<div class="nf-bd" id="pk-bd"></div>'
      + '<div class="nf-ft">'
      + '<button type="button" class="btn ghost" id="pk-cancel">取消</button>'
      + '<button type="button" class="btn primary" id="pk-ok">解析</button></div>'
      + '</div></div>');
    $('#pk-x').addEventListener('click', function () { $('#pk-mask').remove(); });
    $('#pk-cancel').addEventListener('click', function () { $('#pk-mask').remove(); });
    $('#pk-ok').addEventListener('click', onAddOk);
    $$('#pk-tabs .p-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        var ta = $('#fb-raw'); if (ta) ADD.text = ta.value;   /* 切页签不丢已贴的内容 */
        ADD.mode = t.getAttribute('data-mode'); ADD.parsed = null; paintAdd();
      });
    });
    paintAdd();
  }

  function paintTabs() {
    var act = ADD.mode === 'list' ? 'bulk' : ADD.mode;
    $$('#pk-tabs .p-tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.getAttribute('data-mode') === act));
    });
  }

  function paintFoot(okText, okOff) {
    var ok = $('#pk-ok');
    ok.textContent = okText; ok.disabled = !!okOff;
  }

  function paintAdd() {
    var bd = $('#pk-bd');
    paintTabs();
    if (ADD.mode === 'bulk') {
      bd.innerHTML = ''
        + '<div class="nf-row"><label for="fb-raw">把接口文档或说明贴进来</label>'
        + '<textarea id="fb-raw" rows="9" placeholder="OpenAPI / Swagger 的 JSON 或 YAML；也能贴一段段接口说明。"></textarea></div>'
        + '<div class="abt-hint" id="fb-tip" hidden></div>';
      $('#fb-raw').value = ADD.text || '';
      paintFoot(ADD.busy ? '解析中…' : '解析', ADD.busy);
      return;
    }
    if (ADD.mode === 'form') {
      bd.innerHTML = ''
        + '<div class="nf-row"><label for="fa-name">接口名称<span class="nf-req">*</span></label><input id="fa-name" placeholder="这个接口叫什么"></div>'
        + '<div class="nf-row"><label for="fa-m">方法</label><select id="fa-m"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></div>'
        + '<div class="nf-row"><label for="fa-path">路径<span class="nf-req">*</span></label><input id="fa-path" placeholder="/api/v1/…"></div>'
        + '<div class="nf-row"><label for="fa-desc">说明</label><input id="fa-desc" placeholder="干什么用，一句话"></div>'
        + '<div class="nf-row"><label for="fa-in">入参（JSON）</label><textarea id="fa-in" placeholder="{&quot;page&quot;: 1, &quot;status&quot;: &quot;done&quot;}"></textarea></div>'
        + '<div class="nf-row"><label for="fa-out">返回（JSON）</label><textarea id="fa-out" placeholder="{&quot;total&quot;: 0, &quot;items&quot;: []}"></textarea></div>';
      ['#fa-name', '#fa-path'].forEach(function (sel) {
        $(sel).addEventListener('input', function () {
          $('#pk-ok').disabled = !($('#fa-name').value.trim() && $('#fa-path').value.trim());
        });
      });
      paintFoot('添加', true);
      return;
    }
    /* list：拆出来的先给人看一眼 */
    var items = ADD.parsed || [];
    var curIds = CAP.abilityById(ID).apiIds || [];
    var dup = 0, rows = items.map(function (x) {
      var inIt = curIds.indexOf(CAP.fingerprint(x.method, x.path, '')) >= 0;
      if (inIt) dup++;
      return '<div class="abt-row">'
        + '<span>' + esc(x.name || '未命名') + '</span>'
        + '<span class="abt-m">' + esc(x.method) + '</span>'
        + '<span class="abt-p" title="' + esc(x.path) + '">' + esc(x.path) + '</span>'
        + '<span class="abt-hint" style="text-align:right">' + (inIt ? '已在里面' : '') + '</span></div>';
    }).join('');
    bd.innerHTML = '<div class="abt-sec" style="margin:0 0 var(--space-8)"><b>识别到 ' + items.length + ' 个接口</b>'
      + (dup ? '<span class="abt-hint" style="margin-left:var(--space-8)">其中 ' + dup + ' 个已经在这个能力里</span>' : '')
      + '<button type="button" class="abt-op" id="pk-back" style="margin-left:auto">重新贴</button></div>'
      + '<div class="abt-list">' + rows + '</div>';
    $('#pk-back').addEventListener('click', function () { ADD.mode = 'bulk'; ADD.parsed = null; paintAdd(); });
    paintFoot('加入 ' + (items.length - dup) + ' 个', items.length - dup === 0);
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
        var tp = $('#fb-tip'); if (tp) { tp.textContent = '这段内容里没认出接口'; tp.hidden = false; }
        return;
      }
      ADD.parsed = r; ADD.mode = 'list'; paintAdd();
    }).catch(function (e) {
      ADD.busy = false; ADD.mode = 'bulk'; paintAdd();
      var t2 = $('#fb-tip'); if (t2) { t2.textContent = '没拆出来：' + String((e && e.message) || e); t2.hidden = false; }
    });
  }

  var sec = $('#api-title') ? $('#api-title').parentNode : null;
  if (sec) {
    sec.insertAdjacentHTML('beforeend', '<button type="button" class="abt-op" id="act-add" style="margin-left:auto">＋ 添加接口</button>');
    $('#act-add').addEventListener('click', openAdd);
  }

  if (boot()) paint();
})();
