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
  var B = null,DRAFT=null;
  function currentAbility(){return DRAFT?DRAFT.record():CAP.abilityById(ID);}
  function patchAbility(p){return DRAFT?DRAFT.update(p):CAP.updateAbility(ID,p);}
  function currentApis(){return DRAFT?DRAFT.apis():CAP.abilityApis(ID);}
  var BUSY = false;    /* 正在生成，防止保存键按第二下 */
  var CHANGED = false; /* 自上次生成后，接口清单动过 */

  /* 新建：先建一条空记录再改地址栏，刷新不会丢。 */
  function boot() {
    var q = new URLSearchParams(location.search);
    ID = q.get('id') || 'new';
    if(ID==='new'){DRAFT=AbilityDraft.create(CAP);return true;}
    if (currentAbility() && currentAbility().kind==='skill') { location.replace('skill-edit.html?id='+encodeURIComponent(ID)); return false; }
    if (!currentAbility() || !CAP.isGranted(currentAbility())) {
      toast('这个能力不存在了', 'error');
      setTimeout(function () { location.href = 'abilities.html'; }, 800);
      return false;
    }
    return true;
  }

  function formDirty() {
    return $('#f-name').value.trim() !== (B.name || '')
      || $('#f-intro').value.trim() !== (B.intro || '')
      || $('#doc').value.trim() !== String(B.doc || '').trim()
      || JSON.stringify(AbilityEditor.scope()) !== JSON.stringify(B.useScope)
      || AbilityEditor.kind() !== B.kind
      || JSON.stringify(AbilityEditor.files()) !== JSON.stringify(B.files || []);
  }
  /* 说明是选填（用户 2026-11-05 明确）。必填只有名称和至少一个接口。 */
  function filled() {
    return AbilityEditor.editable && $('#f-name').value.trim() && (AbilityEditor.kind()==='skill' ? $('#doc').value.trim() : (currentAbility().apiIds || []).length);
  }

  function paint() {
    B = currentAbility();
    if (!B) return;
    $('#crumb-name').textContent = B.name || '新建能力';
    document.title = (B.name || '新建能力') + ' · 能力详情';
    $('#f-name').value = B.name || '';
    $('#f-intro').value = B.intro || '';
    paintDoc();
    paintState();
    paintApis();
    syncBar();
  }

  /* 状态只描述事实：在生成、已就绪、这次没生成出来（带原因）、还没生成、
     接口变了说明书没跟上。 */
  /* ★2026-11-09 盲审：原来 docApis 只存接口 id，所以「改了路径/方法」它察觉不到 ——
     说明书照样显示「已就绪」、里面还印着旧路径。把方法路径也纳入签名。 */
  function apisSig(ids) {
    return (ids || []).map(function (id) {
      var a = CAP.apiById(id);
      return a ? (id + '|' + (a.method || '') + '|' + (a.path || '')) : id;
    }).join(',');
  }
  /* 旧存档的 docApis 是纯 id 拼接（没有 |），按旧口径比，避免存量能力全部误报"要重新生成"。 */
  function docMoved(b) {
    var saved = String(b.docApis || '');
    if (saved.indexOf('|') >= 0) return apisSig(b.apiIds) !== saved;
    return (b.apiIds || []).join(',') !== saved;
  }

  function paintState() {
    UIK.Ability.editorFeedback($('#md-state'), BUSY ? 'generating' : formDirty() ? 'dirty' : 'idle');
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
      /* 盲审：原来只认数组，用户按占位符填 {"page": 1} 这种对象时解析成 null，
         卡片就回退去读 raw，改完入参数字纹丝不动，看着像没保存。对象也要能读。 */
      if (v && !Array.isArray(v) && typeof v === 'object') {
        var keys = Object.keys(v);
        if (!keys.length) return null;
        return keys.map(function (k) {
          var t = v[k] === null ? 'null' : (Array.isArray(v[k]) ? 'array' : typeof v[k]);
          return { name: k, type: t, required: false, desc: '示例：' + (typeof v[k] === 'string' ? v[k] : JSON.stringify(v[k])) };
        });
      }
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
    var rows = currentApis();
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
        /* ★2026-11-09（用户：为什么居然没有编辑）：接口信息虽然全展示了，却改不了 ——
           想改路径或入参只能删掉重加。编辑按危险程度排在移除之前。 */
        +     '<button class="abt-op" type="button" data-act="edit" data-id="' + esc(a.id) + '">编辑</button>'
        +     '<button class="abt-op" type="button" data-act="test" data-id="' + esc(a.id) + '"'
        +       (apiUrl(a) ? '' : ' disabled title="这个接口没填地址，先在编辑里补上"') + '>测试连通</button>'
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
    if (!(currentAbility().apiIds || []).length) { toast('先加接口', 'error'); return; }
    if(DRAFT)patchAbility({name:$('#f-name').value.trim(),intro:$('#f-intro').value.trim()});
    BUSY = true;
    patchAbility( { docState: 'run', docErr: '' });
    B = currentAbility();
    paintState(); syncBar();
    Gen.abilityDoc(currentAbility()).then(function (r) {
      patchAbility( {
        doc: r.text, docState: 'ready', docAt: CAP.now(), docApis: apisSig(B.apiIds),
        /* 生成成功 = 这份说明书已经按当前接口写过一遍，各接口的 docStale 可以摘掉了。 */
        docStaleCleared: (function () {
          (B.apiIds || []).forEach(function (id) { CAP.updateApi(id, { docStale: false }); });
          return true;
        })(),
        docFrom: r.from || 'model', docErr: r.from === 'local' ? (r.why || '') : ''
      });
      BUSY = false; B = currentAbility();
      paintDoc(); paintState(); syncBar();
      toast('说明书已生成');
    }).catch(function (e) {
      patchAbility( { docState: 'fail', docErr: String((e && e.message) || e) });
      BUSY = false; B = currentAbility();
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
    if (!filled()) { toast(AbilityEditor.kind()==='skill'?'填写技能说明':'先加接口','error'); return; }
    if (!CAP.canManage(B)) return;
    var old = String(B.doc || '');
    var patch = { name:n, intro:i, doc:d, kind:AbilityEditor.kind(), useScope:AbilityEditor.scope(), files:AbilityEditor.files() };
    if (d !== old.trim()) { patch.docFrom = 'manual'; patch.docErr = ''; patch.docAt = CAP.now(); }
    if (d) patch.docState = 'ready';
    else { patch.docState = 'none'; patch.docAt = ''; }
    try { CAP.validateFiles(patch.files); if(DRAFT){var created=DRAFT.commit(patch);ID=created.id;DRAFT=null;var url=new URL(location.href);url.searchParams.delete('new');url.searchParams.set('id',ID);history.replaceState(null,'',url.pathname+url.search+url.hash);}else patchAbility(patch); } catch(e) { toast(e.message || '没保存上','error'); return; }
    CHANGED = false; B = currentAbility();
    paintDoc(); paintState(); paintApis(); syncBar();
    toast('已保存');
  });

  /* ★2026-11-09 盲审：这一页一半操作即时落库（移除/添加接口）、一半要按保存，
     用户点面包屑回列表时改动全丢且没有任何提示。离开前先问一句。 */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href="abilities.html"]') : null;
    if (!a) return;
    if (!(CHANGED || formDirty())) return;
    e.preventDefault();
    Confirm.ask({
      title: '离开这一页？',
      body: '当前修改尚未保存，确认离开？',
      ok: '离开',
      onOk: function () { location.href = a.getAttribute('href'); }
    });
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
      /* ★2026-11-09 盲审：展开第 4 个时第 1 个不该还占着屏 ——
         一次只看一个接口，打开新的先收起其它。 */
      if (!open) {
        [].forEach.call(document.querySelectorAll('#api-list .api-card [data-act="fold"]'), function (o) {
          if (o === f) return;
          o.setAttribute('aria-expanded', 'false');
          var b = o.closest('.api-card').querySelector('.api-body');
          if (b) b.hidden = true;
        });
      }
      f.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
      return;
    }
    var ed = e.target.closest ? e.target.closest('[data-act="edit"]') : null;
    if (ed) { openAdd(ed.getAttribute('data-id')); return; }
    var t = e.target.closest ? e.target.closest('[data-act="test"]') : null;
    if (t) testApi(t.getAttribute('data-id'), t);
  });

  /* 接口的「测试连通」：发一个真实请求看通不通。
     ★地址从哪来：数据层只有 api.host（种子里是空串）与 api.path。
       path 本身是完整 URL 就直接打它；否则拼 host+path；两个都没有 → 说清缺什么，不给死按钮。
     ★生产必须走同源代理（xz-server 的 /xz/probe）：客户内网不会给前端开 CORS，
       浏览器直连一定失败。这里先直连，代理一接就替换成它（与模型页的 probe 同一口径）。 */
  /* ══ 探测：一个纯函数，单条与批量共用（2026-11-09）══════════════════════════
     为什么要抽出来：用户说「几十上百个接口，一个个点，累死了」——
     批量测试若另写一套请求逻辑，两边的超时、代理降级、成功判定迟早不一致，
     那时会出现"单条通过、批量失败"这种没人能解释的现象。 */

  /* 这个接口该打哪个地址：path 是完整 URL 就用它，否则 host+path，都没有返回 ''。 */
  function apiUrl(a) {
    if (!a) return '';
    var path = a.path || '';
    if (/^https?:\/\//i.test(path)) return path;
    var base = (a.host || parseRaw(a.raw).host || '').replace(/\/+$/, '');
    return base ? base + path : '';
  }

  /* 发一次探测 → { ok, status }。走同源代理；没有代理（公网静态）退回直连。
     ★2026-11-09 盲审：原来没有超时，网关不回包就永远「测试中…」。
       现在 10 秒必断（弹窗里人等在面前，60s 太长）。 */
  function probeApi(a, url) {
    var pr = parseRaw(a.raw);
    /* 入参要进请求：原来 payload 只有 url/method/headers，
       填不填参数测的都是同一个请求，「参数不对」永远测不出来。 */
    var q = (pr.query || []).map(function (x) { return x.k + '=' + encodeURIComponent(x.v == null ? '' : x.v); }).join('&');
    var full = url + (q ? (url.indexOf('?') >= 0 ? '&' : '?') + q : '');
    var payload = { url: full, method: a.method || 'GET', headers: pr.headers || [] };
    return fetchT('/xz/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('no-proxy');
      return r.json();
    }).then(function (j) {
      return { ok: !!j.ok, status: j.status || 0 };
    }).catch(function (err) {
      try { console.debug('[probe] 退回直连（本页可能没有 /xz/probe）', err); } catch (x) {}
      return fetchT(full, { method: a.method || 'GET' }).then(function (r) {
        return { ok: r.ok, status: r.status };
      }).catch(function () { return { ok: false, status: 0 }; });
    });
  }

  /* 带 10s 超时的 fetch：超时按「连接失败」处理，不留悬空状态。 */
  function fetchT(url, opt) {
    if (!window.AbortController) return fetch(url, opt);
    var ac = new AbortController();
    var t = setTimeout(function () { ac.abort(); }, 10000);
    return fetch(url, Object.assign({}, opt, { signal: ac.signal })).then(function (r) {
      clearTimeout(t); return r;
    }, function (e) { clearTimeout(t); throw e; });
  }

  /* 结果写在这一条卡片上：没有就造一个，位置在「测试连通」按钮左边。 */
  function ensureRes(card) {
    if (!card) return null;
    var el = card.querySelector('.api-testres');
    if (el) return el;
    var ops = card.querySelector('.api-ops');
    if (!ops) return null;
    el = document.createElement('span');
    el.className = 'api-testres';
    ops.insertBefore(el, ops.firstChild);
    return el;
  }

  function paintRes(card, r) {
    var el = ensureRes(card);
    if (!el) return;
    if (!r) { el.textContent = ''; el.className = 'api-testres'; card.removeAttribute('data-bad'); return; }
    if (r.na) { el.textContent = '无地址'; el.className = 'api-testres is-na'; card.removeAttribute('data-bad'); return; }
    el.textContent = r.ok ? '连接成功' : '连接失败';
    el.className = 'api-testres ' + (r.ok ? 'is-ok' : 'is-bad');
    el.title = 'HTTP ' + (r.status || '—');
    if (r.ok) card.removeAttribute('data-bad'); else card.setAttribute('data-bad', 'true');
  }

  function testApi(id, btn) {
    var a = ((window.CAP && CAP.apis()) || []).filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var url = apiUrl(a);
    if (!url) { toast('这个接口没填地址，先在编辑里补上'); return; }
    var card = btn.closest ? btn.closest('.api-card') : null;
    btn.disabled = true; btn.textContent = '测试中…';
    paintRes(card, null);
    probeApi(a, url).then(function (r) {
      btn.disabled = false; btn.textContent = '测试连通';
      paintRes(card, r);
      btn.title = 'HTTP ' + (r.status || '—');
    });
  }

  /* ══ 测试全部（用户 2026-11-09：「几十上百个接口，一个个点，累死了」）═════════
     并发 4，不一次性打出去 —— 客户网关一般扛不住几十个同时到。
     无地址的直接计入「无地址」，不发请求，也不假装失败（那不是接口坏了，是没填）。
     结束后：标题行给汇总；失败的卡片留红边，点汇总里的数字跳到第一条失败的。 */
  var BATCH = { running: false, cancel: false };

  function testAll() {
    var btn0 = $('#act-testall');
    /* 跑着的时候这颗键变成「停止」——几十上百个接口、全超时的话要好几分钟，
       中途不能停是不合理的。已经发出去的请求拦不住（fetch 没有 abort 也没必要），
       但可以不再派新的，并如实报「还有几个没测」。 */
    if (BATCH.running) {
      BATCH.cancel = true;
      if (btn0) { btn0.textContent = '正在停…'; btn0.disabled = true; }
      return;
    }
    var btn = $('#act-testall'), sum = $('#api-sum');
    var cards = [].slice.call(document.querySelectorAll('#api-list .api-card[data-id]'))
      .filter(function (c) { return c.getAttribute('data-off') !== 'true'; });
    if (!cards.length) { toast('这条能力还没有接口'); return; }
    if (!sum) return;

    var n = cards.length, done = 0, ok = 0, bad = 0, na = 0;
    var started = 0, running = 0, finished = false;
    BATCH.running = true;
    BATCH.cancel = false;
    btn.disabled = true;
    sum.hidden = false;
    /* ★2026-11-09 实机发现：开始新一轮时若不清，汇总还挂着上一轮的数字
       （"通过 1 · 失败 1 · 无地址 4"），看起来像这一轮已经出结果了。 */
    sum.textContent = '';
    cards.forEach(function (c) { paintRes(c, null); });

    /* 进度写在汇总位、按钮专管「停止」——一颗键同时显示进度又当停止钮，读起来是乱的。 */
    function tick() {
      sum.innerHTML = '<span class="run">测试中 ' + done + '/' + n + '</span>';
      if (!BATCH.cancel) { btn.textContent = '停止'; btn.disabled = false; }
    }
    tick();

    function finish() {
      if (finished) return;
      finished = true;
      BATCH.running = false;
      btn.disabled = false;
      btn.textContent = '测试全部';
      var parts = ['<span class="ok">通过 ' + ok + '</span>'];
      if (bad) parts.push('<button type="button" class="bad" data-act="jumpbad">失败 ' + bad + '</button>');
      else parts.push('<span class="ok">失败 0</span>');
      if (na) parts.push('<span class="na">无地址 ' + na + '</span>');
      var left = n - done;
      if (left > 0) parts.push('<span class="na">未测 ' + left + '</span>');
      sum.innerHTML = parts.join('<span class="dot">·</span>');
      sum.title = left > 0
        ? '已停止：共 ' + n + ' 个接口，测了 ' + done + ' 个'
        : '共 ' + n + ' 个接口，测试完成';
    }

    function runOne(card) {
      var a = CAP.apiById(card.getAttribute('data-id'));
      var url = apiUrl(a);
      if (!url) { done++; na++; paintRes(card, { na: true }); tick(); return Promise.resolve(); }
      return probeApi(a, url).then(function (r) {
        done++; if (r.ok) ok++; else bad++;
        paintRes(card, r); tick();
      });
    }

    function pump() {
      if (!BATCH.cancel) {
        while (running < 4 && started < n) {
          running++;
          runOne(cards[started++]).then(function () { running--; pump(); });
        }
      }
      if ((started >= n || BATCH.cancel) && running === 0) finish();
    }
    pump();
  }

  /* 点汇总里的「失败 N」→ 滚到第一条失败的卡片。几十条里靠眼睛找红边太慢。 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act="jumpbad"]') : null;
    if (!b) return;
    var first = document.querySelector('#api-list .api-card[data-bad="true"]');
    if (!first) return;
    /* ★2026-11-09 实测：原来写 behavior:'smooth'，滚动容器的 scrollTop 一直是 0 ——
       平滑滚动在部分环境（无头、被系统减弱动效）里根本不执行，等于按钮没反应。
       改成默认的立即滚动，行为确定，且滚动容器是 main（overflow:auto）也能正确居中。 */
    first.scrollIntoView({ block: 'center' });
    first.setAttribute('data-flash', 'true');
    setTimeout(function () { first.removeAttribute('data-flash'); }, 1200);
  });

  $('#api-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="rm"]'); if (!b) return;
    var aid = b.getAttribute('data-id');
    var cur = (currentAbility().apiIds || []).filter(function (x) { return x !== aid; });
    patchAbility( { apiIds: cur });
    CHANGED = true;
    B = currentAbility();
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
    var ids = (currentAbility().apiIds || []).slice(), n = 0;
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
    patchAbility( { apiIds: ids });
    CHANGED = true; B = currentAbility();
    return n;
  }

  /* editId 为空 = 添加；给了就变成「编辑这个接口」：直接进手填表单、预填现有值、按钮改「保存」。
     没有另做一个编辑弹层 —— 字段是同一批字段，另做一套必然两边越改越不像。 */
  function openAdd(editId) {
    var old = $('#pk-mask'); if (old) old.remove();
    var editing = editId ? CAP.apiById(editId) : null;
    ADD = { mode: editing ? 'form' : 'bulk', parsed: null, busy: false, text: '', editId: editId || '' };
    document.body.insertAdjacentHTML('beforeend',UIK.Dialog.html({id:'pk-mask',titleId:'pk-t',title:editing?'编辑接口':'添加接口',closeId:'pk-x',bodyId:'pk-bd',
      tabs:editing?'':'<div class="p-tabs" id="pk-tabs" role="tablist" aria-label="添加方式"><button type="button" role="tab" class="p-tab" data-mode="bulk" aria-selected="true">贴内容自动拆</button><button type="button" role="tab" class="p-tab" data-mode="form" aria-selected="false">手动填一条</button></div>',
      footer:'<button type="button" class="btn ghost" id="pk-cancel">取消</button><button type="button" class="btn primary" id="pk-ok">解析</button>'}));
    /* 盲审：改了一半点 X 或取消，弹层直接销毁、内容全丢，也没有任何提示。
       编辑态下先比一次表单和原值，有差异就问一句。 */
    function closeAddDlg() {
      var mask = $('#pk-mask');
      if (!mask) return;
      var ea = ADD.editId ? CAP.apiById(ADD.editId) : null;
      var dirty = ea && (
        ($('#fa-name') || {}).value.trim() !== (ea.name || '') ||
        ($('#fa-path') || {}).value.trim() !== (ea.path || '') ||
        ($('#fa-host') || {}).value.trim() !== (ea.host || parseRaw(ea.raw).host || '') ||
        ($('#fa-desc') || {}).value.trim() !== (ea.desc || ea.summary || '') ||
        ($('#fa-in') || {}).value.trim() !== (ea.params || '') ||
        ($('#fa-out') || {}).value.trim() !== (ea.returns || '')
      );
      if (dirty && window.Confirm && Confirm.ask) {
        Confirm.ask({
          title: '放弃这次修改？',
          body: '这个接口改了还没保存，关掉就没了。',
          ok: '放弃',
          onOk: function () { mask.remove(); }
        });
        return;
      }
      mask.remove();
    }
    $('#pk-x').addEventListener('click', closeAddDlg);
    $('#pk-cancel').addEventListener('click', closeAddDlg);
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
        + '<div class="nf-row"><label for="fa-host">地址</label><input id="fa-host" placeholder="https://api.example.com，留空表示不知道"></div>'
        + '<div class="nf-row"><label for="fa-path">路径<span class="nf-req">*</span></label><input id="fa-path" placeholder="/api/v1/…"></div>'
        + '<div class="nf-row"><label for="fa-desc">说明</label><input id="fa-desc" placeholder="干什么用，一句话"></div>'
        + '<div class="nf-row"><label for="fa-in">入参（JSON）</label><textarea id="fa-in" placeholder="{&quot;page&quot;: 1, &quot;status&quot;: &quot;done&quot;}"></textarea></div>'
        + '<div class="nf-row"><label for="fa-out">返回（JSON）</label><textarea id="fa-out" placeholder="{&quot;total&quot;: 0, &quot;items&quot;: []}"></textarea></div>';
      /* 编辑：把现有值填回去。raw 是接口信息的来源，一并放进入参/返回之外的说明区，
         这样"我看到的"和"我能改的"是同一份数据。 */
      if (ADD.editId) {
        var ea = CAP.apiById(ADD.editId);
        if (ea) {
          $('#fa-name').value = ea.name || '';
          $('#fa-m').value = (ea.method || 'GET').toUpperCase();
          /* 盲审：表单原来没有「地址」，而「测试连通」失败时提示"去编辑里补地址" —— 补不了，死循环。
             地址优先取 host，没有就从 raw 里解析（种子接口的域名都在 raw 里）。 */
          $('#fa-host').value = ea.host || parseRaw(ea.raw).host || '';
          $('#fa-path').value = ea.path || '';
          $('#fa-desc').value = ea.desc || ea.summary || '';
          $('#fa-in').value = ea.params || '';
          $('#fa-out').value = ea.returns || '';
        }
      }
      ['#fa-name', '#fa-path'].forEach(function (sel) {
        $(sel).addEventListener('input', function () {
          $('#pk-ok').disabled = !($('#fa-name').value.trim() && $('#fa-path').value.trim());
        });
      });
      paintFoot(ADD.editId ? '保存' : '添加', true);
      /* 预填之后按钮要按"有没有值"重新判一次，否则一进来永远是灰的 */
      if (ADD.editId) $('#pk-ok').disabled = !($('#fa-name').value.trim() && $('#fa-path').value.trim());
      return;
    }
    /* list：拆出来的先给人看一眼 */
    var items = ADD.parsed || [];
    var curIds = currentAbility().apiIds || [];
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
        host: ($('#fa-host') ? $('#fa-host').value.trim() : ''),
        desc: $('#fa-desc').value.trim(), summary: $('#fa-desc').value.trim(),
        params: $('#fa-in').value.trim(), returns: $('#fa-out').value.trim()
      };
      if (!v.name || !v.path) return;
      if (ADD.editId) {
        /* 改完清掉上一次的测试结果：地址或方法变了，旧的「连接成功」不再作数（与模型页同一口径）。 */
        CAP.updateApi(ADD.editId, {
          name: v.name, method: v.method, path: v.path, host: v.host,
          /* 接口改了，它自己那份说明就过期了。生成说明书时要跳过它，否则旧路径会被当成
             "原有文档"再喂给模型，重新生成也洗不掉（盲审指出的原话：用户点重新生成也洗不掉旧路径）。 */
          docStale: true,
          desc: v.desc, summary: v.summary, params: v.params, returns: v.returns,
          test: null
        });
        $('#pk-mask').remove();
        /* 旧存档的 docApis 只存了接口 id，改了路径它察觉不到（docMoved 走旧口径会判"没变"）。
           这里直接把签名清掉，逼它下一次必然判"接口有变动"，提示重新生成。 */
        patchAbility( { docApis: '' });
        CHANGED = true; B = currentAbility();
        /* 只改了接口，上一轮的批量测试结果就作废了 —— 不清的话顶上还挂着"通过 1 · 失败 2"，
           看着像新接口也测过了。 */
        var sumEl = $('#api-sum');
        if (sumEl) { sumEl.textContent = ''; sumEl.hidden = true; }
        paintApis(); paintState(); syncBar();
        toast('已保存，记得点右上「保存」');
        return;
      }
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
    /* ★2026-11-09：接口清单标题行右侧三项 —— 汇总 / 测试全部 / 添加接口。
       汇总平时空着不占位，测完才出现（"通过 5 · 失败 2 · 无地址 1"）。
       三者包在一个容器里靠 margin-left:auto 推右，这样汇总为空时按钮仍在右边。 */
    sec.insertAdjacentHTML('beforeend',
      '<span class="abt-ops">'
      + '<span class="abt-sum" id="api-sum" hidden></span>'
      + '<button type="button" class="abt-op" id="act-testall">测试全部</button>'
      + '<button type="button" class="abt-op" id="act-add">＋ 添加接口</button>'
      + '</span>');
    /* ★2026-11-09 盲审抓到的致命 bug：直接传 openAdd 会把 MouseEvent 当成 editId，
       于是"添加接口"变成"编辑接口"（按钮显示保存、点击 updateApi(事件对象) 静默返回 null），
       用户看到"已保存"但一条都没写进去。必须包一层、明确传空串。 */
    $('#act-add').addEventListener('click', function () { openAdd(''); });
    $('#act-testall').addEventListener('click', testAll);
  }

  if (boot()) { paint(); AbilityEditor.paint(); }
})();
