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
  /* 有效期 = 授权日 ~ 到期日（真源就是这个形态）。原来只印一个到期日，
     起点在看板上另一列里，读起来要左右对两次。 */
  function fmtRange(from, to) {
    var a = from ? String(from).slice(0, 10) : '';
    var b = to ? String(to).slice(0, 10) : '';
    if (!a && !b) return '—';
    if (!b) return a + ' 起';
    return (a || '—') + ' ~ ' + b;
  }

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
  /* ★2026-11-05：一页 20 家。原来把全部客户铺在一屏（1000 家就是 1000 行 DOM），
     底部却写着「10 条/页」—— 数字是假的，翻页也是假的。现在真分页，勾选跨页保留。 */
  var PGSZ = 10, PG = 0;
  var VIEW = [];            /* 当前筛选后的整份列表（不分页），「全部升级」按它算 */

  /* 2026-11-02 第二次整改：进了某个应用之后，一行＝一家客户（不再按授权记录出行）——
     没授权的客户也要出现，否则「还有谁没给」这件事在页面上根本看不到。
     全局页（没带 id）仍按授权记录列，回答的是「哪些应用授权给了谁」。 */
  function rows() {
    if (!APP_ID) {
      /* 全局页：一行 = 一条授权记录（同一家客户用了几个应用就几行）。字段归一成与
         「一行一家客户」同一套，渲染与动作只写一份，避免两套模板各改各的。 */
      var all = DB.authRows('').map(function (x) {
        return {
          kind: 'record', clientId: x.clientId, clientName: x.clientName,
          /* 授权记录上可能没记租户 ID，退回客户台账里的那一份 —— 这一列不允许空着。 */
          tenantId: x.tenantId || (DB.clientById(x.clientId) || {}).tenantId || '',
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

  /* 2026-11-05：租户（客户）主数据由平台的「租户管理」统一维护 ——
     这一页只做授权关系：选已有租户、升级版本、取消授权。
     原来这里的「新建客户 / 编辑客户」是自己造的第二套租户入口，已删。 */

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

  /* 空态里的两个出口：开新增、清空搜索。用事件委托挂一次，重绘不会丢。 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="empty-add"],[data-act="empty-clear"]');
    if (!b) return;
    if (b.getAttribute('data-act') === 'empty-add') { var add = $('#act-add'); if (add) add.click(); return; }
    var kw = $('#kw'); if (kw) { kw.value = ''; KW = ''; PG = 0; paint(); kw.focus(); }
  });

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
    VIEW = list;
    var pages = Math.max(1, Math.ceil(list.length / PGSZ));
    if (PG > pages - 1) PG = pages - 1;
    if (PG < 0) PG = 0;
    var start = PG * PGSZ;
    var slice = list.slice(start, start + PGSZ);
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
    /* 空态要有出口（2026-11-05）：原来只有一句灰字"还没有客户授权"，
       底下还跟着一句"共 0 条" —— 说了两遍"没有"，但没说"怎么开始"。
       现在：一句标题 + 一句怎么开始 + 一个按钮（搜不到时给"清空搜索"）。 */
    var emptyHtml = !list.length ? (KW
      ? '<div class="au-empty"><p class="au-empty-t">没有匹配「' + esc(KW) + '」的客户</p>'
        + '<p class="au-empty-d">换个关键词，或者清空搜索看全部。</p>'
        + '<button class="btn ghost" type="button" data-act="empty-clear">清空搜索</button></div>'
      : '<div class="au-empty"><p class="au-empty-t">'
        + (APP_ID ? '还没有客户授权' : '还没有任何授权')
        + '</p><p class="au-empty-d">'
        + (APP_ID ? '把「' + esc((DB.appById(APP_ID) || {}).name || '这个应用') + '」授权给客户，他们登录后就能用这一版。'
                  : '选一个应用和客户，建立第一条授权。')
        + '</p><button class="btn primary" type="button" data-act="empty-add">新增客户授权</button></div>') : '';

    function clientOps(r) {
      /* ★2026-11-04（用户：「取消授权，如果客户不是最新版本，还有个升级版本操作」）：
         列表只出已授权行，所以这里就两个动作 —— 落后最新版的给「升级版本」，任何时候都能「取消授权」。
         「授权」「恢复」「删除记录」三个按钮随「未授权行」一起退场：未授权的客户不在这一页出现。 */
      return (r.behind ? '<button class="au-btn is-main" type="button" data-act="upgrade" data-id="' + esc(r.authId) + '"' +
          ' title="升到 v' + r.latest + '（现在是 v' + r.version + '），立刻生效">升级版本</button>' : '') +
        '<button class="au-btn" type="button" data-act="revoke" data-id="' + esc(r.authId) + '">取消授权</button>';
    }

    /* ★2026-11-05：勾选不再跟着筛选/翻页丢。原来这里按「当前可见」裁选中项 ——
       先勾 5 家、再换个版本筛选，那 5 家就悄悄出列了，批量升级少升几家人也不会说一声。
       现在只在「这条授权真的不可升级了」时出列（见 pickedRows）。 */

    /* ★2026-11-04 根治 C 类（_reports/根因分析-20261104.md）：
       表头、列宽、行骨架、空态不再在这一页拼 —— 交给 List（assets/list.js）一处定义。
       这一页只声明"有哪些列、每列取什么、行里有什么动作"。
       client-auth.css 里的 --gt-cols 和 is-sub 隐藏第 4 列的规则已一并删除，
       否则会与这里声明的列组合打架（那条 nth-child(4) 会误伤 7 列版的「授权版本」）。 */
    /* ★ 根治 C：主对象 / 状态机 / 真源 / 列组合全部来自 assets/spec.js。
       SUB（进到某个应用）只是选一份列变体，页面不再自己拼列。 */
    var SUB = !!APP_ID;
    var baseSpec = SPEC['client-auth.html'];
    var viewSpec = Object.assign({}, baseSpec, SUB ? baseSpec.variants.sub : baseSpec.variants.global);
    /* ★2026-11-05（真源基线 · _docs/基线-客户授权.md 第一列）：
       「选择框：该行可升级才有；**无可用行时整列不出现**」。
       原来不管有没有可升级的客户，这一列都占着 40px，表头还空着一格 ——
       0 家客户的应用（比如监控大屏）看上去就是"表格左边缺了一块"。 */
    var CAN_PICK = list.some(function (r) { return r.behind; });
    if (!CAN_PICK) {
      viewSpec = Object.assign({}, viewSpec, {
        headCols: viewSpec.headCols.filter(function (c) { return c.key !== 'pick'; }),
        /* 列宽按段删，不用正则猜 40px：与 List 自己的拆段规则同一套（括号里的空格不算分隔）。 */
        cols: (function () {
          var segs = String(viewSpec.cols).trim().split(/\s+(?![^(]*\))/);
          segs.shift();
          return segs.join(' ');
        })()
      });
    }

    List.render(viewSpec, {
      table: '.au-table', head: '#head', body: '#list', total: '#total',
      rows: slice,
      empty: function () { return emptyHtml || '<p class="au-empty">还没有客户授权</p>'; },
      rowClass: 'au-row gtable-row',
      rowExtra: function (r) { return (r.behind && sel[r.authId]) ? 'is-selected' : ''; },
      rowAttr: function (r) {
        return ' data-cid="' + esc(r.clientId) + '"' +
          (r.authId ? ' data-auth="' + esc(r.authId) + '"' : '') +
          ' data-status="' + esc(r.status) + '"';
      },
      cellAttr: function (key, r) {
        var a = (key === 'exp' && r.expireAt && r.expireAt < today()) ? ' data-expired="1"' : '';
        /* 这两列会按列宽截断：截断时必须能把全文调出来，否则「海通证券 · 债承复核」看不全也没处问。 */
        if (key === 'app') a += ' title="' + esc(r.appName) + '"';
        if (key === 'client') a += ' title="' + esc(r.clientName) + '"';
        return a;
      },
      /* 表头全选框由页面给：List 每次重绘都会重建表头，写死在 HTML 里会被覆盖掉
         （2026-11-05 实测：#au-all 渲染完就不存在了，全选一直是死的）。 */
      headCell: function (key) {
        if (key !== 'pick') return null;
        return '<input type="checkbox" id="au-all" aria-label="全选本页可升级客户">';
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
        /* 版本列承担「升级相关信息」：落后时直接写清从哪一版到哪一版，
           不用点进去才知道要升到几。箭头用弱色，不占品牌色（品牌色只给能点的）。 */
        if (key === 'ver') {
          return '<b>v' + r.version + '</b>' + (r.behind
            ? '<span class="au-to">→ v' + r.latest + '</span>' : '');
        }
        if (key === 'exp') return esc(fmtRange(r.authAt, r.expireAt));
        if (key === 'ops') return clientOps(r);
        return '';
      },
      foot: function (rs) {
        /* 空态里已经说了"还没有"，表尾再写一句"共 0 条"是同一件事的第二遍。 */
        return rs.length
          ? ('第 ' + (start + 1) + '-' + (start + rs.length) + ' 条/共 ' + list.length + ' 条')
          : '';
      },
      after: function () {
        syncBatch();
        /* 2026-11-05：没有行就没有分页可言。空列表连"共 0 条"也不写 ——
           空态块里已经说了"还没有"，表尾再说一遍是同一件事的第二遍。 */
        if (!list.length) {
          if (total) total.textContent = '';
          var pg0 = $('#pager');
          if (pg0) pg0.innerHTML = '';
          return;
        }
        paintPager(pages);
      }
    });
  }

  /* ── 批量升级 ────────────────────────────────────────────────
     三个数各说一件事，不许混：
       · 表头全选框   = 本页里有勾选框的行
       · 批量升级（N）= 勾了几个（跨页、跨筛选都算）
       · 全部升级（N）= 当前筛选结果里所有落后最新版的客户（不看勾选）
     ★2026-11-05：原来只有「一键升级（N）」—— 想升 1000 家得先翻 50 页去勾，
       而翻页时勾选还会被"当前可见"裁掉。现在这两条都改了。 */
  function pickedRows() {
    var out = [];
    Object.keys(sel).forEach(function (id) {
      var rec = recOf(id);
      if (!rec) { delete sel[id]; return; }
      var top = DB.latestVer(rec.appId);
      /* 已经升到最新的自动出列：计数永远等于"真能升的"，不用人自己对账。 */
      if ((rec.version || 0) >= top) { delete sel[id]; return; }
      var c = DB.clientById(rec.clientId);
      var a = DB.appById(rec.appId) || {};
      out.push({ authId: id, clientName: c ? c.name : '（客户已删）', appName: a.name || '', from: rec.version || 0, to: top });
    });
    return out;
  }
  function behindInView() { return VIEW.filter(function (r) { return r.behind; }); }

  function syncBatch() {
    var btn = $('#act-batch'), nEl = $('#batch-n'), allBtn = $('#act-all'), allN = $('#all-n');
    var picked = pickedRows();
    var pageBoxes = $$('#list [data-pick]');
    var pagePicked = pageBoxes.filter(function (c) { return c.checked; });

    if (nEl) nEl.textContent = String(picked.length);
    /* 0 个勾选时整颗不出现（用户 2026-11-04：「没意义的提示」）；勾了就带着数出现。 */
    if (btn) { btn.disabled = !picked.length; btn.hidden = !picked.length; }

    /* 全部升级常驻在可升级时：它是"1000 家一次升完"的唯一入口。 */
    var all = behindInView();
    if (allBtn) { allBtn.disabled = !all.length; allBtn.hidden = !all.length; }
    if (allN) allN.textContent = String(all.length);

    /* 勾选里有一部分不在这一页：括号里的数永远是勾选总数，但鼠标停上去要说清
       "其中 N 家不在当前页"，否则"选了 12 只看到 3 个勾"很像出错。 */
    var hiddenPicked = Math.max(0, picked.length - pagePicked.length);
    if (btn) {
      btn.title = hiddenPicked
        ? ('共勾选 ' + picked.length + ' 家，其中 ' + hiddenPicked + ' 家不在当前页')
        : (picked.length ? ('只升勾选的这 ' + picked.length + ' 家') : '');
    }

    var selAll = $('#au-all');
    if (selAll) {
      /* 2026-11-05：这一格是网格里的一列，把它 hidden 掉会让整张表错位一格 ——
         本页没有可升级的行时只禁用，不隐藏（列本身由整份列表决定在不在）。 */
      selAll.disabled = !pageBoxes.length;
      selAll.checked = pageBoxes.length > 0 && pagePicked.length === pageBoxes.length;
      selAll.indeterminate = pagePicked.length > 0 && pagePicked.length < pageBoxes.length;
      selAll.setAttribute('aria-label', '全选本页 ' + pageBoxes.length + ' 家可升级客户');
    }
  }

  function paintPager(pages) {
    var pg = $('#pager');
    if (!pg) return;
    if (pages <= 1) { pg.innerHTML = '<span class="pg-size">每页 ' + PGSZ + ' 家</span>'; return; }
    pg.innerHTML =
      '<button class="au-btn" type="button" data-pg="-1"' + (PG === 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="pg-cur">' + (PG + 1) + '</span>' +
      '<span class="pg-size">共 ' + pages + ' 页</span>' +
      '<button class="au-btn" type="button" data-pg="1"' + (PG >= pages - 1 ? ' disabled' : '') + '>下一页</button>';
  }

  /* 勾了谁就升谁。确认框里把数量再报一次 —— 和按钮上的括号是同一个数。 */
  /* 确认框只说"37 家"等于什么都没说：得让人看见升到哪一版、是哪几家。
     单应用页写明目标版本；总览页各应用版本不同，只能写"各自最新"。 */
  function upgradeWhere(list) {
    if (APP_ID) {
      var a = DB.appById(APP_ID);
      return '「' + (a ? a.name : '这个应用') + '」的 v' + (DB.latestVer(APP_ID) || 0);
    }
    var tops = {};
    list.forEach(function (r) { tops[r.appName] = 1; });
    var names = Object.keys(tops);
    return names.length === 1 ? ('「' + names[0] + '」的最新版本') : '各自应用的最新版本';
  }
  function whoText(list) {
    var names = list.slice(0, 3).map(function (r) { return r.clientName; }).join('、');
    return list.length > 3 ? (names + ' 等 ' + list.length + ' 家') : names;
  }
  function batchUpgrade() {
    var picked = pickedRows();
    if (!picked.length) return;
    Confirm.ask({
      title: '批量升级',
      body: '将把勾选的 <b>' + picked.length + '</b> 家客户升到 ' + upgradeWhere(picked) + '，升级后立刻对客户生效。'
        + '<br>' + whoText(picked),
      ok: '升级这 ' + picked.length + ' 家',
      onOk: function () { run(picked, '批量'); }
    });
  }

  /* 全部升级 = 当前筛选内的所有落后客户，不看勾选。1000 家客户的主路径。 */
  function upgradeAll() {
    var targets = behindInView();
    if (!targets.length) return;
    var scope = [];
    if (VER) scope.push('版本 v' + VER);
    if (KW) scope.push('搜索「' + KW + '」');
    Confirm.ask({
      title: '全部升级',
      body: '将把 <b>' + targets.length + '</b> 家客户升到 ' + upgradeWhere(targets) + '，升级后立刻对客户生效。'
        + '<br>' + whoText(targets)
        + (scope.length ? '<br>范围：当前筛选（' + scope.join(' · ') + '），筛选外的客户不动。' : ''),
      ok: '全部升级（' + targets.length + ' 家）',
      onOk: function () { run(targets, '全部'); }
    });
  }

  /* 一次跑完：本地数据，没有网络等待，所以不假装"逐条 500ms 推进"。
     跑完给一条回执（升了几家、谁失败），并且留 10 秒撤销窗口 ——
     一千家一次升完，点错了没有任何人工办法退回去，这窗口是唯一的安全网。 */
  var resultTimer = 0;
  function run(list, word) {
    var ok = 0, fail = [];
    list.forEach(function (r) {
      var x = DB.authUpgrade(r.authId);
      if (x && x.ok) { ok++; }
      else fail.push(r.clientName + (x && x.msg ? '（' + x.msg + '）' : ''));
    });
    sel = {};
    paint();
    showResult(word, ok, fail);
  }
  /* ★2026-11-05 二次定稿：**不做撤销**。
     客户原来是 v1、升到 v4，撤回去等于把版本号往回写，既破坏"版本只增"这个前提，
     也解释不清（这期间客户可能已经用过 v4）。真正该走的是**前滚**：
     发现问题就发 v5，再点一次「全部升级」把所有人推到 v5 —— 全员到位，一步。
     这里只留一条回执：升了几家、谁失败。 */
  function showResult(word, ok, fail) {
    var box = $('#bulk-result');
    if (!box) return;
    clearTimeout(resultTimer);
    box.hidden = false;
    box.setAttribute('data-kind', fail.length ? 'warn' : 'ok');
    $('#bulk-result-t').textContent = fail.length
      ? (word + '升级：成功 ' + ok + ' 家，失败 ' + fail.length + ' 家 · ' + fail.slice(0, 3).join('；')
         + (fail.length > 3 ? ' 等' : ''))
      : (word + '升级：' + ok + ' 家已升到最新版本');
    resultTimer = setTimeout(function () { box.hidden = true; }, 12000);
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
    PICKED = {};
    var selApp = $('#fm-app');
    var apps = (DB.APPS || []).filter(function (a) { return DB.latestVer(a.id) > 0; });
    if (!apps.length) { toast('还没有可授权的应用，先去存一版', 'err'); return; }
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
    /* ★2026-11-05：必须判类型。原来这里只写 if (presetCid) —— 而「新增客户授权」按钮
       是 addEventListener('click', openDlg)，第一个参数是 MouseEvent（truthy），
       于是每次打开弹窗都凭空写入一个幽灵勾选，底栏显示"已选 1 家"（实测抓到）。 */
    if (typeof presetCid === 'string' && presetCid) {
      /* 行内「授权」预设这一家：写进 PICKED 后重绘，勾选框与行底色都跟着对 */
      PICKED[presetCid] = 1;
      paintClientPick();
    }
    mask.setAttribute('data-open', 'true');
    syncPickLabel();
    setTimeout(function () { var k = $('#fm-kw'); if (k) k.focus(); }, 30);
  }
  /* 客户多选：一次可以授给多家（真实系统就是 tenantIds 多选）。
     已经授权过的置灰勾不上；已取消的那条再授 = 恢复并升到最新。 */
  function paintClientPick() {
    var appId = $('#fm-app').value;
    var box = $('#fm-clients');
    if (!box) return;
    var latest = DB.latestVer(appId);
    /* 真源的新增授权不问版本，所以这里不再渲染「授权版本」那一行；
       没有版本时仍然要拦住（授权必须有可指向的版本）。 */
    if (!latest) {
      box.innerHTML = '<p class="fm-hint">这个应用还没有版本，先在配置页存一版。</p>';
      return;
    }
    /* ★2026-11-04（用户：「列表里边都是已经配置好授权的客户」）：
       已经授权的客户在这一页的列表里，不该在弹窗里再出现一次（原来会出现、只是置灰勾不上）——
       弹窗只回答"还能授给谁"。一家都没有可选时，直接说清楚。 */
    var kw = (($('#fm-kw') || {}).value || '').trim().toLowerCase();
    var clients = (DB.clients() || []).filter(function (c) {
      var rec = DB.authOf(appId, c.id);
      if (rec && rec.status === '已授权') return false;
      if (!kw) return true;
      return (c.name + ' ' + (c.tenantId || '')).toLowerCase().indexOf(kw) >= 0;
    });
    if (!(DB.clients() || []).length) {
      box.innerHTML = '<p class="fm-hint">还没有客户，先新增一家。</p>';
      return;
    }
    if (!clients.length) {
      box.innerHTML = '<p class="fm-hint">' + (kw ? '没有匹配的客户' : '这个应用的客户都已授权，没有可新增的了。') + '</p>';
      syncPickLabel();
      return;
    }
    box.innerHTML = clients.map(function (c) {
      var rec = DB.authOf(appId, c.id);
      return '<label class="fm-client' + (PICKED[c.id] ? ' is-checked' : '') + '">' +
        '<input type="checkbox" name="fm-client" value="' + esc(c.id) + '"' + (PICKED[c.id] ? ' checked' : '') + '>' +
        '<span class="fm-client-name">' + esc(c.name) + '</span>' +
        '<span class="fm-client-id">' + esc(c.tenantId || '—') + '</span>' +
      '</label>';
    }).join('');
    syncPickLabel();
  }
  /* 「选择客户」触发器：说得清选了几家，点开才出列表（与真源同一形态） */
  /* 勾选存在内存里，不靠 DOM（2026-11-05）：搜索会重绘列表，
     靠 DOM 的话"勾了 5 家、改一下搜索词"就全丢了 —— 与桌面列表那条"勾选不跟筛选丢"同一条规矩。 */
  var PICKED = {};

  function syncPickLabel() {
    var n = Object.keys(PICKED).length;
    var el = $('#fm-picked-lb');
    /* 数字加粗：底栏一行里，用户先看的是"选了几家"，不是"已选" */
    if (el) el.innerHTML = n ? ('已选 <b>' + n + '</b> 家') : '未选客户';
    /* 结果多才给"全选 / 清空"：3 家的场景摆两颗按钮是噪声（用户 2026-11-04 定过这条） */
    var boxes = document.querySelectorAll('#fm-clients input').length;
    var allBtn = $('#fm-pick-all'), noneBtn = $('#fm-pick-none');
    if (allBtn) {
      allBtn.hidden = boxes <= 5;
      allBtn.textContent = '全选 ' + boxes + ' 家';
    }
    if (noneBtn) noneBtn.hidden = boxes <= 5 || n === 0;
  }
  function closeDlg() { if (mask) mask.setAttribute('data-open', 'false'); }
  function submitDlg() {
    var appId = $('#fm-app').value;
    var ids = Object.keys(PICKED);
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
      if (act === 'upgrade') return upgrade(id);
      if (act === 'revoke') return revoke(id);
      if (act === 'restore') return restore(id);
      if (act === 'remove') return removeAuth(id);
    });

    var kw = $('#kw');
    if (kw) kw.addEventListener('input', function () { KW = kw.value.trim(); PG = 0; paint(); });
var verEl = $('#f-ver');
if (verEl) verEl.addEventListener('change', function () { VER = verEl.value; PG = 0; paint(); });

    var batch = $('#act-batch');
    if (batch) batch.addEventListener('click', batchUpgrade);
    var allUp = $('#act-all');
    if (allUp) allUp.addEventListener('click', upgradeAll);
    var pager = $('#pager');
    if (pager) pager.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      PG += Number(b.getAttribute('data-pg'));
      paint();
    });
    /* ★2026-11-05：改为委托在 #head 上。表头每次重绘都换元素，直接绑在 #au-all 上
       第一帧之后就失效了 —— 这正是"表头全选点了没反应"的原因。 */
    var headEl = $('#head');
    if (headEl) headEl.addEventListener('change', function (e) {
      var all = e.target.closest && e.target.closest('#au-all');
      if (!all) return;
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
      /* 不直接把 openDlg 当 handler：那样第一个参数是 MouseEvent，会被当成 presetCid */
      add.addEventListener('click', function () { openDlg(); });
    }
    /* 弹窗底栏的「新建客户」：关掉授权弹窗，打开客户弹窗；存完重新 paint 会带回这里的数据。 */
    /* 真源的新增授权只有 取消/确定，没有「新建客户」；客户管理在「编辑客户」那一侧。 */
    var kwEl2 = $('#fm-kw');
    if (kwEl2) kwEl2.addEventListener('input', paintClientPick);
    var pa = $('#fm-pick-all');
    if (pa) pa.addEventListener('click', function () {
      /* 全选的是"当前搜索结果"，不是全部未授权客户 —— 筛过之后按钮上的数字也跟着变 */
      document.querySelectorAll('#fm-clients input').forEach(function (c) {
        c.checked = true; PICKED[c.value] = 1;
        c.closest('.fm-client').classList.add('is-checked');
      });
      syncPickLabel();
    });
    var pn = $('#fm-pick-none');
    if (pn) pn.addEventListener('click', function () {
      document.querySelectorAll('#fm-clients input').forEach(function (c) {
        c.checked = false; delete PICKED[c.value];
        c.closest('.fm-client').classList.remove('is-checked');
      });
      syncPickLabel();
    });
    /* 勾选写进 PICKED：搜索重绘后能回填 */
    var pickBoxEl = $('#fm-clients');
    if (pickBoxEl) pickBoxEl.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || cb.name !== 'fm-client') return;
      if (cb.checked) PICKED[cb.value] = 1; else delete PICKED[cb.value];
      cb.closest('.fm-client').classList.toggle('is-checked', cb.checked);
      syncPickLabel();
    });
    var pickBox = $('#fm-clients');
    if (pickBox) pickBox.addEventListener('change', syncPickLabel);
    var x = $('#dlg-x'), c = $('#dlg-cancel'), ok = $('#dlg-ok');
    if (x) x.addEventListener('click', closeDlg);
    if (c) c.addEventListener('click', closeDlg);
    if (ok) ok.addEventListener('click', submitDlg);
    /* 不要叫 sel：外层 sel 是批量选中的 authId 表，同名 var 提升会把勾选写进这里。 */
    var appSel = $('#fm-app');
    if (appSel) appSel.addEventListener('change', paintClientPick);

    var m = $('#mask');
    if (m) m.addEventListener('click', function (e) { if (e.target === m) closeDlg(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (m && m.getAttribute('data-open') === 'true') closeDlg();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
