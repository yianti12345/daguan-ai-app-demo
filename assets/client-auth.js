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
      });
      return KW ? all.filter(function (r) {
        return (r.clientName + ' ' + r.appName + ' ' + r.tenantId).toLowerCase().indexOf(KW.toLowerCase()) >= 0;
      }) : all;
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
    });
    if (!KW) return out;
    var k = KW.toLowerCase();
    return out.filter(function (r) {
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

  function paint() {
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
      if (addBtn) addBtn.textContent = '批量授权';
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

    if (!list.length) {
      var emptyMsg = APP_ID
        ? (KW ? '没有匹配「' + esc(KW) + '」的客户' : '还没有客户，先「新增客户」')
        : (KW ? '没有匹配「' + esc(KW) + '」的授权' : '还没有任何授权');
      box.innerHTML = '<p class="au-empty">' + emptyMsg + '</p>';
      if (total) total.textContent = '';
      var pg0 = $('#pager'); if (pg0) pg0.innerHTML = '';
      return;
    }

    function clientOps(r) {
      if (!r.rec) return '<button class="au-btn is-main" type="button" data-act="grant" data-cid="' + esc(r.clientId) + '">授权</button>';
      if (r.canceled) return '<button class="au-btn is-main" type="button" data-act="restore" data-id="' + esc(r.authId) + '">恢复授权</button>' +
        '<button class="au-btn is-danger" type="button" data-act="remove" data-id="' + esc(r.authId) + '">删除记录</button>';
      /* ★2026-11-02：删除只出现在**已取消**的行上（对齐真实系统：已授权时"删除"是隐藏的）。
         要先取消，才谈删除。 */
      return (r.behind ? '<button class="au-btn is-main" type="button" data-act="upgrade" data-id="' + esc(r.authId) + '"' +
          ' title="「' + esc(r.clientName) + '」会从 v' + r.version + ' 换成 v' + r.latest + '，立刻生效">升级到 v' + r.latest + '</button>' : '') +
        '<button class="au-btn" type="button" data-act="revoke" data-id="' + esc(r.authId) + '">取消授权</button>';
    }

    box.innerHTML = list.map(function (r) {
      var expired = r.expireAt && r.expireAt < today();
      return '<div class="au-row gtable-row" data-cid="' + esc(r.clientId) + '"' +
          (r.authId ? ' data-auth="' + esc(r.authId) + '"' : '') + ' data-status="' + esc(r.status) + '">' +
        '<span class="au-c"><b title="' + esc(r.clientName) + '">' + esc(r.clientName) + '</b>' +
          (r.canceled ? '<span class="au-tag">已取消</span>' : '') + '</span>' +
        '<span class="au-id">' + esc(r.tenantId || '—') + '</span>' +
        '<span class="au-app" title="' + esc(r.appName) + '">' + esc(r.appName) + '</span>' +
        '<span class="au-ver">' + (r.rec ? '<b>v' + r.version + '</b>' : '<span class="au-muted">未授权</span>') + '</span>' +
        '<span class="au-at">' + esc(r.authAt || '—') + '</span>' +
        '<span class="au-exp"' + (expired ? ' data-expired="1"' : '') + '>' + esc(r.expireAt || '—') + '</span>' +
        '<span class="au-o">' + clientOps(r) +
          '<button class="au-btn" type="button" data-act="edit-client" data-cid="' + esc(r.clientId) + '">编辑客户</button>' +
        '</span>' +
      '</div>';
    }).join('');

    /* 表尾照平台标准：左边「第 1-N 条/共 N 条」，右边当前页 + 每页条数。 */
    if (total) total.textContent = '第 1-' + list.length + ' 条/共 ' + list.length + ' 条';
    var pager = $('#pager');
    if (pager) pager.innerHTML = '<span class="pg-cur">1</span><span class="pg-size">10 条/页</span>';
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
      body: '取消授权后，客户将无法使用该应用，是否确认取消授权？',
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
    if (note) note.innerHTML = latest
      ? '本次授权记 <b>v' + latest + '</b>（当前最新版本）—— 版本不在这里选，升级也默认取最新'
      : '这个应用还没有版本，先去画布「存成新版本」';
    var clients = DB.clients() || [];
    if (!clients.length) {
      box.innerHTML = '<p class="fm-hint">还没有客户，先在上面新增客户。</p>';
      return;
    }
    box.innerHTML = clients.map(function (c) {
      var rec = DB.authOf(appId, c.id);
      var on = rec && rec.status === '已授权';
      return '<label class="fm-client' + (on ? ' is-on' : '') + '">' +
        '<input type="checkbox" name="fm-client" value="' + esc(c.id) + '"' + (on ? ' disabled' : '') + '>' +
        '<span class="fm-client-name">' + esc(c.name) + '</span>' +
        '<span class="fm-client-id">' + esc(c.tenantId || '—') + '</span>' +
        '<span class="fm-client-state">' + (on ? '已授权' : (rec ? '已取消' : '')) + '</span>' +
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

    var add = $('#act-add');
    if (add) {
      if (APP_ID && !DB.appById(APP_ID)) {
        add.disabled = true;
        add.title = '这个应用已经不在了，不能再授权';
      }
      add.addEventListener('click', openDlg);
    }
    var x = $('#dlg-x'), c = $('#dlg-cancel'), ok = $('#dlg-ok');
    if (x) x.addEventListener('click', closeDlg);
    if (c) c.addEventListener('click', closeDlg);
    if (ok) ok.addEventListener('click', submitDlg);
    var sel = $('#fm-app');
    if (sel) sel.addEventListener('change', paintClientPick);

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
