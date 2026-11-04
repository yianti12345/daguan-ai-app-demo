/* 客户授权（2026-11-02 重做）
   ────────────────────────────────────────────────────────────────
   模型改了：真实系统（客户配置页）是「应用 × 租户」授权 —— 一个应用可以授权给 N 个客户，
   每个客户单独记「授权时的那一版」。所以应用上不再有 clientId，授权记录单独一张表（DB.AUTHS）。

   ★用户口径（2026-11-02）：
     · 一个应用可以授权多个客户；
     · 每个客户有当时授权的版本；
     · 新增授权和升级版本时，默认都指向当前应用的最新版本 —— 版本不给选，少一个出错的地方。
*/
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iso(d) {
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function today() { return iso(new Date()); }
  /* 授权时间到分就够（真源列表里也是分）——秒是数据库字段，摆给人看只会让列变宽。 */
  function fmtAt(v) { return v ? String(v).replace(/:\d{2}$/, '') : '—'; }

  var tTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.setAttribute('data-kind', kind || 'ok');
    t.setAttribute('data-on', 'true');
    clearTimeout(tTimer);
    tTimer = setTimeout(function () { t.setAttribute('data-on', 'false'); }, 3200);
  }

  /* ?id= 是老入口（应用管理里的「客户配置」也用它），?app= 是这次新加的别名 */
  var qs = new URLSearchParams(location.search);
  var APP_ID = qs.get('id') || qs.get('app') || '';
  var KW = '';
/* ★2026-11-04（用户：「客户授权页面可以有个下拉筛选版本，筛选哪个客户有哪些版本」）：
   版本筛选是这一页的事，不往版本管理页塞客户名单。'' = 全部。 */
var VER = '';
function byVer(r) { return !VER || String(r.version) === VER; }
  /* 批量升级的选中态：按 authId 记，重画不丢；筛选/升级后自动剔除失效项。 */
  var sel = {};

  /* 2026-11-02 第二次整改：进了某个应用之后，一行＝一家客户（不再按授权记录出行）——
     没授权的客户也要出现，否则「还有谁没给」这件事在页面上根本看不到。
     全局页（没带 id）仍按授权记录列，回答的是「哪些应用授权给了谁」。 */
  function rows() {
    if (!APP_ID) {
      /* 全局页：一行 = 一条授权记录（同一家客户用了几个应用就几行）。字段归一成与
         「一行一家客户」同一套，渲染与动作只写一份，避免两套模板各改各的。 */
      var all = DB.authRows('').map(function (x) {
        return {
          kind: 'record', clientId: x.clientId, clientName: x.clientName, tenantId: x.tenantId,
          authId: x.id, rec: x, appName: x.appName, status: x.status || '已授权',
          canceled: (x.status || '已授权') !== '已授权', version: x.version || 0,
          latest: x.latest, behind: !!x.behind, authAt: x.authAt, expireAt: x.expireAt
        };
      }).filter(function (x) { return (x.status || '已授权') === '已授权'; });   /* 同上：列表只列已授权 */
      var vb = all.filter(byVer);
      return KW ? vb.filter(function (r) {
        return (r.clientName + ' ' + r.appName + ' ' + r.tenantId).toLowerCase().indexOf(KW.toLowerCase()) >= 0;
      }) : vb;
    }
    var top = DB.latestVer(APP_ID);
    var out = (DB.clients() || []).map(function (c) {
      var rec = DB.authOf(APP_ID, c.id);
      var a = DB.appById(APP_ID) || {};
      return {
        kind: 'client', clientId: c.id, clientName: c.name, tenantId: c.tenantId || '',
        authId: rec ? rec.id : '', rec: rec,
        appName: a.name || '',
        status: rec ? (rec.status || '已授权') : '未授权',
        canceled: !!rec && rec.status !== '已授权',
        version: rec ? (rec.version || 0) : 0,
        latest: top, behind: !!rec && rec.status === '已授权' && (rec.version || 0) < top,
        authAt: rec ? rec.authAt : '', expireAt: rec ? rec.expireAt : ''
      };
    }).filter(function (r) {
      /* ★2026-11-04（用户：「刚开始都是空的，需要新增授权啊，列表里边都是已经配置好授权的客户」）：
         原来这里是拿「客户池」当「授权表」铺 —— 11 家客户全占一行，没授权的显示「未授权」+「授权」按钮。
         列表只回答"谁被授权了"；"还有谁没授权"由「新增客户授权」弹窗回答。
         已取消的授权也不在这里出现 —— 取消即从此表消失，回到弹窗的可选池。 */
      return r.rec && r.status === '已授权';
    });
    var vb = out.filter(byVer);
    if (!KW) return vb;
    var k = KW.toLowerCase();
    return vb.filter(function (r) {
      return (r.clientName + ' ' + r.tenantId + ' ' + (r.version ? 'v' + r.version : '未授权')).toLowerCase().indexOf(k) >= 0;
    });
  }

  /* 客户台账（2026-11-02 第二次整改）：原来自成一张表，现在并进主表 —— 一行一家客户，
     编辑客户的入口也在那一行上。这里只剩「新增/编辑客户」的弹窗逻辑。 */
  var clMask = null, clEditing = '';
  function openClient(id) {
    clMask = clMask || $('#cl-mask');
    clEditing = id || '';
    var c = clEditing ? DB.clientById(clEditing) : null;
    $('#cl-name').value = c ? c.name : '';
    $('#cl-tenant').value = c ? c.tenantId : '';
    $('#cl-title').textContent = c ? '编辑客户' : '新增客户';
    clMask.setAttribute('data-open', 'true');
    setTimeout(function () { $('#cl-name').focus(); }, 30);
  }
  function closeClient() { if (clMask) clMask.setAttribute('data-open', 'false'); }
  function submitClient() {
    var nm = $('#cl-name').value.trim(), tid = $('#cl-tenant').value.trim();
    var r = clEditing ? DB.updateClient(clEditing, nm, tid) : DB.addClient(nm, tid);
    if (!r.ok) { toast(r.msg, 'err'); return; }
    closeClient();
    paint();
    toast(clEditing ? '已保存「' + r.client.name + '」' : '已新增客户「' + r.client.name + '」');
  }

  /* ★2026-11-04：版本下拉的选项按"最新版本"现填，不写死在 HTML 里 ——
     版本涨到 v9 时这里自动跟着变；当前选中项在重绘后保留。 */
  function paintVerOptions() {
    var el = $('#f-ver');
    if (!el) return;
    var top = DB.latestVer(APP_ID) || 0;
    var want = [''].concat(top ? Array.apply(null, { length: top }).map(function (_, i) { return String(top - i); }) : []);
    var now = el.value;
    if (el.dataset.fill === want.join(',') ) { el.value = now; return; }
    el.innerHTML = want.map(function (v) {
      return '<option value="' + v + '">' + (v ? 'v' + v : '全部版本') + '</option>';
    }).join('');
    el.dataset.fill = want.join(',');
    el.value = want.indexOf(now) >= 0 ? now : '';
  }

  function paint() {
    paintVerOptions();
    var pgTitle = $('#pg-title'), latestBox = $('#au-latest');
    var crumbApp = $('#crumb-app'), crumbPage = $('#crumb-page'), crumbSep2 = $('#crumb-sep2');
    var addBtn = $('#act-add'), addC = $('#act-add-client'), kwEl = $('#kw');
    var tbl = document.querySelector('.au-table');
    if (tbl) tbl.classList.toggle('is-sub', !!APP_ID);
    /* ★2026-11-02（独立走查 P0-2 / P1-3）：不带 id 的页面不是"另一个客户授权页"，是**全部授权** ——
       它一行 = 一条授权（跨应用），带 id 才是一行 = 一家客户。同一个标题下两种主语，
       用户没法知道自己在看什么。这里把名字、面包屑、工具条按作用域分开：
         全部：授权总览         / 只有「新增授权」
         单应用：客户授权       / 「批量授权」+「新增客户」/ 面包屑带回配置页的应用名
       标题不再在正文里再写一遍（平台标准件没有页内大标题），只留读屏 h1。 */
    var missing = !!APP_ID && !DB.appById(APP_ID);
    if (missing) {
      if (pgTitle) pgTitle.textContent = '应用不存在';
      document.title = '应用不存在 · AI 应用方案';
      if (crumbApp) { crumbApp.hidden = false; crumbApp.textContent = '应用不存在'; crumbApp.removeAttribute('href'); }
      if (crumbSep2) crumbSep2.hidden = true;
      if (crumbPage) crumbPage.textContent = '客户授权';
      if (latestBox) latestBox.hidden = true;
      if (addC) addC.hidden = true;
      if (kwEl) kwEl.placeholder = '搜客户或租户 ID';
    } else if (APP_ID) {
      var app = DB.appById(APP_ID);
      if (pgTitle) pgTitle.textContent = app ? app.name + ' · 客户授权' : '客户授权';
      document.title = (app ? app.name + ' · 客户授权' : '客户授权') + ' · AI 应用方案';
      if (crumbApp) {
        crumbApp.hidden = false;
        crumbApp.textContent = app ? app.name : '客户授权';
        if (app) crumbApp.href = 'app.html?id=' + encodeURIComponent(APP_ID);
      }
      if (crumbSep2) crumbSep2.hidden = false;
      if (crumbPage) crumbPage.textContent = '客户授权';
      if (addBtn) addBtn.textContent = '新增客户授权';
      if (addC) addC.hidden = false;
      if (kwEl) kwEl.placeholder = '搜客户或租户 ID';
      var topV = app ? DB.latestVer(APP_ID) : 0;
      if (latestBox) {
        latestBox.hidden = !topV;
        latestBox.innerHTML = topV ? '最新版本 <b>v' + topV + '</b>' : '';
      }
    } else {
      if (pgTitle) pgTitle.textContent = '授权总览';
      document.title = '授权总览 · AI 应用方案';
      if (crumbApp) crumbApp.hidden = true;
      if (crumbSep2) crumbSep2.hidden = true;
      if (crumbPage) crumbPage.textContent = '授权总览';
      if (latestBox) latestBox.hidden = true;
      if (addBtn) addBtn.textContent = '新增授权';
      if (addC) addC.hidden = true;
      if (kwEl) kwEl.placeholder = '搜客户、应用或租户 ID';
    }

    var list = rows();
    var box = $('#list'), total = $('#total');
    if (!box) return;

    var card = document.querySelector('.au-card');
    if (card) card.classList.toggle('is-missing', missing);
    if (missing) {
      box.innerHTML = '<p class="au-empty">这个应用已经不在了（链接过期或已被删除）。' +
        '<a href="apps.html">回应用列表</a>重新选一个。</p>';
      if (total) total.textContent = '共 0 条';
      return;
    }

    /* 空态也走 List.render —— 列宽由 spec 设置；绕过它的话表头没有列定义，会塌成一列。
       （2026-11-04 17:55 用户截图抓到的就是这个：CSS 里的 --gt-cols 已删，空态时 spec 没跑。） */
    var emptyHtml = !list.length ? (KW
      ? '<p class="au-empty">没有匹配「' + esc(KW) + '」的客户</p>'
      : (APP_ID ? '<p class="au-empty">还没有客户授权</p>' : '<p class="au-empty">还没有任何授权</p>')) : '';

    function clientOps(r) {
      /* ★2026-11-04（用户：「取消授权，如果客户不是最新版本，还有个升级版本操作」）：
         列表只出已授权行，所以这里就两个动作 —— 落后最新版的给「升级版本」，任何时候都能「取消授权」。
         「授权」「恢复」「删除记录」三个按钮随「未授权行」一起退场：未授权的客户不在这一页出现。 */
      return (r.behind ? '<button class="au-btn is-main" type="button" data-act="upgrade" data-id="' + esc(r.authId) + '"' +
          ' title="升到 v' + r.latest + '（现在是 v' + r.version + '），立刻生效">升级版本</button>' : '') +
        '<button class="au-btn" type="button" data-act="revoke" data-id="' + esc(r.authId) + '">取消授权</button>';
    }

    /* 只保留当前可见、且仍可升级的选中项，避免筛选后计数与批量动作对不上。 */
    var live = {};
    list.forEach(function (r) { if (r.behind) live[r.authId] = 1; });
    Object.keys(sel).forEach(function (id) { if (!live[id]) delete sel[id]; });

    /* ★2026-11-04 根治 C 类（_reports/根因分析-20261104.md）：
       表头、列宽、行骨架、空态不再在这一页拼 —— 交给 List（assets/list.js）一处定义。
       这一页只声明"有哪些列、每列取什么、行里有什么动作"。
       client-auth.css 里的 --gt-cols 和 is-sub 隐藏第 4 列的规则已一并删除，
       否则会与这里声明的列组合打架（那条 nth-child(4) 会误伤 7 列版的「授权版本」）。 */
    var SUB = !!APP_ID;
    var headCols = [
      { key: 'pick', cls: 'au-sel' },
      { key: 'client', label: '客户', cls: 'au-c' },
      { key: 'tenant', label: '租户 ID', cls: 'au-id' }
    ].concat(SUB ? [] : [{ key: 'app', label: '应用', cls: 'au-app' }]).concat([
      { key: 'ver', label: '授权版本', cls: 'au-ver' },
      { key: 'at', label: '授权时间', cls: 'au-at' },
      { key: 'exp', label: '有效期', cls: 'au-exp' },
      { key: 'ops', label: '操作', cls: 'au-o' }
    ]);

    List.render({
      table: '.au-table', head: '#head', body: '#list', total: '#total',
      cols: SUB
        ? '40px minmax(0,1fr) 220px 80px 150px 108px 240px'
        : '40px 170px 190px minmax(0,1fr) 80px 150px 108px 240px',
      headCols: headCols,
      rows: list,
      empty: function () { return emptyHtml || '<p class="au-empty">还没有客户授权</p>'; },
      rowClass: 'au-row gtable-row',
      rowExtra: function (r) { return (r.behind && sel[r.authId]) ? 'is-selected' : ''; },
      rowAttr: function (r) {
        return ' data-cid="' + esc(r.clientId) + '"' +
          (r.authId ? ' data-auth="' + esc(r.authId) + '"' : '') +
          ' data-status="' + esc(r.status) + '"';
      },
      cellAttr: function (key, r) {
        return (key === 'exp' && r.expireAt && r.expireAt < today()) ? ' data-expired="1"' : '';
      },
      cell: function (key, r) {
        if (key === 'pick') return r.behind
          ? '<input type="checkbox" class="au-check" data-pick="' + esc(r.authId) + '"' +
            (sel[r.authId] ? ' checked' : '') +
            ' aria-label="选择 ' + esc(r.clientName) + '，从 v' + r.version + ' 升级到 v' + r.latest + '">'
          : '';
        if (key === 'client') return '<b title="' + esc(r.clientName) + '">' + esc(r.clientName) + '</b>';
        if (key === 'tenant') return esc(r.tenantId || '—');
        if (key === 'app') return esc(r.appName);
        if (key === 'ver') return '<b>v' + r.version + '</b>';
        if (key === 'at') return esc(fmtAt(r.authAt));
        if (key === 'exp') return esc(r.expireAt || '—');
        if (key === 'ops') return clientOps(r) +
          '<button class="au-btn" type="button" data-act="edit-client" data-cid="' + esc(r.clientId) + '">编辑客户</button>';
        return '';
      },
      foot: function (rs) { return '第 1-' + rs.length + ' 条/共 ' + rs.length + ' 条'; },
      after: function () {
        syncBatch();
        var pg = $('#pager');
        if (pg) pg.innerHTML = '<span class="pg-cur">1</span><span class="pg-size">10 条/页</span>';
      }
    });
  }

  /* ── 批量选择 ────────────────────────────────────────────────
     只有「授权中且落后最新版」的行有勾选框：当前唯一的批量动作是升级，
     让不可升级的行也能勾，只会制造「选了 3 个却只升 1 个」的误解。 */
  function pickedRows() {
    return rows().filter(function (r) { return r.behind && sel[r.authId]; });
  }
  function syncBatch() {
    var btn = $('#act-batch'), nEl = $('#batch-n'), all = $('#au-all');
    var can = rows().filter(function (r) { return r.behind; });
    var picked = pickedRows();
    if (nEl) nEl.textContent = String(picked.length);
    /* ★2026-11-04（用户：「狗屎没意义的提示」）：0 家可升级时这颗按钮整颗不出现，
       原来常驻一个禁用的「一键升级（0）」，等于在页面上摆一个永远点不动的东西。 */
    if (btn) { btn.disabled = !picked.length; btn.hidden = !can.length; }
    var nWrap = $('#batch-n-wrap');
    if (nWrap) nWrap.hidden = !picked.length;
    if (all) {
      /* 没有可升级的行时，表头那颗全选框没有任何作用 —— 藏掉，不要让一列空勾选框占着 40px。 */
      if (all.parentNode) all.parentNode.hidden = !can.length;
      all.disabled = !can.length;
      all.checked = !!can.length && picked.length === can.length;
      all.indeterminate = picked.length > 0 && picked.length < can.length;
    }
  }
  function batchUpgrade() {
    var picked = pickedRows();
    if (!picked.length) return;
    Confirm.ask({
      title: '批量升级',
      body: '将选中的 ' + picked.length + ' 家客户升级到各自应用的最新版本？升级后立刻生效。',
      ok: '确定升级',
      onOk: function () {
        var ok = 0, fail = 0;
        picked.forEach(function (r) {
          var x = DB.authUpgrade(r.authId);
          if (x && x.ok) ok++; else fail++;
        });
        sel = {};
        paint();
        toast(fail ? '已升级 ' + ok + ' 家，' + fail + ' 家失败' : '已升级 ' + ok + ' 家客户');
      }
    });
  }

  /* ── 升级 / 取消 / 恢复 / 删除 ─────────────────────────────── */
  function recOf(id) {
    for (var i = 0; i < DB.AUTHS.length; i++) if (DB.AUTHS[i].id === id) return DB.AUTHS[i];
    return null;
  }
  function clientNameOf(rec) {
    var c = rec ? DB.clientById(rec.clientId) : null;
    return c ? c.name : '（客户已删）';
  }
  function upgrade(id) {
    var rec = recOf(id);
    if (!rec) return;
    var a = DB.appById(rec.appId);
    var top = DB.latestVer(rec.appId);
    if (top <= (rec.version || 0)) { toast('已经是最新版本 v' + top, 'err'); return; }
    Confirm.ask({
      title: '操作确认',
      body: '升级后，' + clientNameOf(rec) + ' 将从 v' + (rec.version || 0) + ' 升到 v' + top +
            '，其他客户不受影响，是否确认升级？',
      ok: '确定',
      onOk: function () {
        var r = DB.authUpgrade(id);
        if (!r.ok) { toast(r.msg, 'err'); return; }
        paint();
        toast('「' + clientNameOf(rec) + '」已从 v' + r.from + ' 升到 v' + r.to);
      }
    });
  }
  function revoke(id) {
    var rec = recOf(id);
    if (!rec) return;
    Confirm.ask({
      title: '操作确认',
      /* ★2026-11-04：原文句尾「是否确认取消授权？」把按钮语义又念一遍。
         改成点名：谁、失去什么、能不能反悔。 */
      body: (function () { var a = DB.appById(rec.appId);
        return '取消后，' + clientNameOf(rec) + '就打不开「' + (a ? a.name : '这个应用') + '」了。之后还能再授权。'; })(),
      ok: '确定',
      cancel: '取消',
      danger: true,
      onOk: function () {
        var r = DB.authRevoke(id);
        if (!r.ok) { toast(r.msg, 'err'); return; }
        paint();
        toast('已取消「' + clientNameOf(rec) + '」的授权');
      }
    });
  }
  function restore(id) {
    var rec = recOf(id);
    if (!rec) return;
    var r = DB.authRestore(id);
    if (!r.ok) { toast(r.msg, 'err'); return; }
    paint();
    toast('已恢复「' + clientNameOf(rec) + '」的授权 · 仍是 v' + (rec.version || 0));
  }
  function removeAuth(id) {
    var rec = recOf(id);
    if (!rec) return;
    Confirm.ask({
      title: '操作确认',
      body: '删除后，该授权记录将被清除且无法恢复，是否确认删除？',
      ok: '确定',
      cancel: '取消',
      danger: true,
      onOk: function () {
        var r = DB.authRemove(id);
        if (!r.ok) { toast(r.msg, 'err'); return; }
        paint();
        toast('已删除这条授权');
      }
    });
  }
  function nameOfApp(a) { return a ? a.name : '这个应用'; }

  /* ── 新增授权弹窗 ─────────────────────────────────────────── */
  var mask = null;
  function openDlg(presetCid) {
    if (APP_ID && !DB.appById(APP_ID)) { toast('这个应用已经不在了，不能再授权', 'err'); return; }
    mask = mask || $('#mask');
    var selApp = $('#fm-app');
    var apps = (DB.APPS || []).filter(function (a) { return DB.latestVer(a.id) > 0; });
    if (!apps.length) { toast('还没有可授权的应用：先去应用配置页存一版', 'err'); return; }
    selApp.innerHTML = apps.map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (a.id === APP_ID ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
    /* 2026-11-02（独立走查 P1-5）：从某个应用的授权页进来，就不许在弹窗里把客户授给别的应用 ——
       原来下拉列出全部应用，改一下选项就在不知情的情况下换了对象。这里锁死为当前应用；
       要跨应用授权，走「授权总览」。 */
    selApp.disabled = !!APP_ID;
    selApp.classList.toggle('is-locked', !!APP_ID);
    /* 2026-11-04：在这个应用的授权页里，弹窗再列一次"应用"是重复 —— 面包屑和标题已经说了对象。
       只在「授权总览」跨应用授权时才需要选应用。 */
    var appRow = selApp.closest ? selApp.closest('.fm-row') : null;
    if (appRow) appRow.hidden = !!APP_ID;
    paintClientPick();
    /* 行内「授权」：把这家的勾先打上，弹窗仍可改主意（有效期、要不要多选几家）。 */
    if (presetCid) {
      Array.prototype.forEach.call(document.querySelectorAll('#fm-clients input[name="fm-client"]'), function (cb) {
        if (cb.value === presetCid && !cb.disabled) cb.checked = true;
      });
    }
    mask.setAttribute('data-open', 'true');
    setTimeout(function () { selApp.focus(); }, 30);
  }
  /* 客户多选：一次可以授给多家（真实系统就是 tenantIds 多选）。
     已经授权过的置灰勾不上；已取消的那条再授 = 恢复并升到最新。 */
  function paintClientPick() {
    var appId = $('#fm-app').value;
    var box = $('#fm-clients');
    if (!box) return;
    var latest = DB.latestVer(appId);
    var note = $('#fm-ver-note');
    /* 2026-11-04：原来是「本次授权记 v5（当前最新版本）—— 版本不在这里选，升级也默认取最新」，
       半句都是解释。改成只报那个值：授权记的是哪一版。没有版本时才说要先存一版。 */
    if (note) note.innerHTML = latest
      ? '<b>v' + latest + '</b>'
      : '这个应用还没有版本，先去画布存一版';
    /* ★2026-11-04（用户：「列表里边都是已经配置好授权的客户」）：
       已经授权的客户在这一页的列表里，不该在弹窗里再出现一次（原来会出现、只是置灰勾不上）——
       弹窗只回答"还能授给谁"。一家都没有可选时，直接说清楚。 */
    var clients = (DB.clients() || []).filter(function (c) {
      var rec = DB.authOf(appId, c.id);
      return !(rec && rec.status === '已授权');
    });
    if (!(DB.clients() || []).length) {
      box.innerHTML = '<p class="fm-hint">还没有客户，先在列表上方「编辑客户」里新增。</p>';
      return;
    }
    if (!clients.length) {
      box.innerHTML = '<p class="fm-hint">这个应用的客户都已授权，没有可新增的了。</p>';
      return;
    }
    box.innerHTML = clients.map(function (c) {
      var rec = DB.authOf(appId, c.id);
      return '<label class="fm-client">' +
        '<input type="checkbox" name="fm-client" value="' + esc(c.id) + '">' +
        '<span class="fm-client-name">' + esc(c.name) + '</span>' +
        '<span class="fm-client-id">' + esc(c.tenantId || '—') + '</span>' +
        '<span class="fm-client-state">' + (rec ? '已取消，再授即恢复' : '') + '</span>' +
      '</label>';
    }).join('');
  }
  function closeDlg() { if (mask) mask.setAttribute('data-open', 'false'); }
  function submitDlg() {
    var appId = $('#fm-app').value;
    var ids = Array.prototype.slice.call(document.querySelectorAll('#fm-clients input:checked')).map(function (x) { return x.value; });
    var months = $('#fm-exp').value;
    if (!appId) { toast('还没有可授权的应用', 'err'); return; }
    if (!ids.length) { toast('先选客户', 'err'); return; }
    var r = DB.authGrant(appId, ids, months, today());
    if (!r.ok) { toast(r.msg, 'err'); return; }
    closeDlg();
    KW = ''; var kw = $('#kw'); if (kw) kw.value = '';
    paint();
    var names = r.added.slice(0, 3).join('、') + (r.added.length > 3 ? ' 等 ' + r.added.length + ' 家' : '');
    toast('已授权 ' + names + ' · v' + r.version);
  }

  /* ── 接线 ─────────────────────────────────────────────────── */
  function boot() {
    try { DB.load(); } catch (e) { console.error('[客户授权] 数据没载入', e); }
    paint();

    var list = $('#list');
    if (list) list.addEventListener('change', function (e) {
      var c = e.target.closest && e.target.closest('[data-pick]');
      if (!c) return;
      var id = c.getAttribute('data-pick');
      if (c.checked) sel[id] = 1; else delete sel[id];
      var row = c.closest('.au-row');
      if (row) row.classList.toggle('is-selected', !!c.checked);
      syncBatch();
    });
    if (list) list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id') || b.getAttribute('data-auth');
      var cid = b.getAttribute('data-cid');
      if (act === 'grant') return openDlg(cid);
      if (act === 'edit-client') return openClient(cid);
      if (act === 'upgrade') return upgrade(id);
      if (act === 'revoke') return revoke(id);
      if (act === 'restore') return restore(id);
      if (act === 'remove') return removeAuth(id);
    });

    var kw = $('#kw');
    if (kw) kw.addEventListener('input', function () { KW = kw.value.trim(); paint(); });
var verEl = $('#f-ver');
if (verEl) verEl.addEventListener('change', function () { VER = verEl.value; paint(); });

    var batch = $('#act-batch');
    if (batch) batch.addEventListener('click', batchUpgrade);
    var all = $('#au-all');
    if (all) all.addEventListener('change', function () {
      var on = all.checked;
      $$('#list [data-pick]').forEach(function (c) {
        var id = c.getAttribute('data-pick');
        c.checked = on;
        if (on) sel[id] = 1; else delete sel[id];
        var row = c.closest('.au-row');
        if (row) row.classList.toggle('is-selected', on);
      });
      syncBatch();
    });

    var add = $('#act-add');
    if (add) {
      if (APP_ID && !DB.appById(APP_ID)) {
        add.disabled = true;
        add.title = '这个应用已经不在了，不能再授权';
      }
      add.addEventListener('click', openDlg);
    }
    /* 弹窗底栏的「新建客户」：关掉授权弹窗，打开客户弹窗；存完重新 paint 会带回这里的数据。 */
    var nc = $('#fm-add-client');
    if (nc) nc.addEventListener('click', function () { closeDlg(); openClient(''); });
    var x = $('#dlg-x'), c = $('#dlg-cancel'), ok = $('#dlg-ok');
    if (x) x.addEventListener('click', closeDlg);
    if (c) c.addEventListener('click', closeDlg);
    if (ok) ok.addEventListener('click', submitDlg);
    /* 不要叫 sel：外层 sel 是批量选中的 authId 表，同名 var 提升会把勾选写进这里。 */
    var appSel = $('#fm-app');
    if (appSel) appSel.addEventListener('change', paintClientPick);

    var addC = $('#act-add-client');
    if (addC) addC.addEventListener('click', function () { openClient(''); });
    var clx = $('#cl-x'), clc = $('#cl-cancel'), clok = $('#cl-ok'), clm = $('#cl-mask');
    if (clx) clx.addEventListener('click', closeClient);
    if (clc) clc.addEventListener('click', closeClient);
    if (clok) clok.addEventListener('click', submitClient);
    if (clm) clm.addEventListener('click', function (e) { if (e.target === clm) closeClient(); });
    [$('#cl-name'), $('#cl-tenant')].forEach(function (n) {
      if (n) n.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitClient(); } });
    });
    var m = $('#mask');
    if (m) m.addEventListener('click', function (e) { if (e.target === m) closeDlg(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (m && m.getAttribute('data-open') === 'true') closeDlg();
      if (clm && clm.getAttribute('data-open') === 'true') closeClient();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
