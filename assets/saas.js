/* ─────────────────────────────────────────────────────────────
   saas.js —— SaaS 端（客户侧）「我的应用」的渲染与交互。2026-11-06

   数据来源：DB.APPS（与后台同一份存储，不另建一套）。
   「我的应用」只列客户能看到的状态：已上架 / 内测中。
   未发布的应用是配置者还没交付的东西，客户侧不出现 —— 这是语义，不是筛选漏了。

   ★ 应用名去掉「客户 · 」前缀：
     后台列表是平台方看所有客户，名字带客户前缀才有意义（「华信证券 · 债承审核」）。
     客户登录后看自己的应用，前缀是他的公司名 —— 挂在每张卡上就是重复他自己。
     真源同样只有场景名（研究报告审核 / 基金代销合同审核），没有公司前缀。

   ★ 演示账号：「达观数据」租户，所以能看到全部 9 个已交付应用。
     真实系统里这份列表由租户授权决定（AUTHS 表）；demo 不做登录态，
     固定用一个能看全的账号，是为了让分组和筛选有内容可看，不是为了模拟越权。
   ───────────────────────────────────────────────────────────── */
(function () {
  var VISIBLE = ['已上架', '内测中'];      /* 客户侧可见状态 */
  var F = { kw: '', st: '全部', scene: '全部' };
  var VIEW = 'grid';
  var kwTimer = null;

  function esc(s) {
    return (window.UIK && UIK.esc) ? UIK.esc(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
  }

  /* ── 两种页面：我的应用（看自己的）/ 应用市场（挑着开通）─────────────
     同一份渲染代码，靠 body[data-saas] 分叉。市场多两样东西：
     封面右上角的「已购买」、底栏的购物车（已购买则换成进入箭头）。 */
  var MODE = document.body.getAttribute('data-saas') === 'market' ? 'market' : 'my-apps';
  var BUYER = '达观数据';                        /* 顶条账号块里写的那个组织 */
  var BUYER_TID = 'a1b2c3d4e5f60001';            /* 演示租户 ID：16 位，与种子同格式 */

  function isBought(id) {
    if (!window.DB || !DB.AUTHS) return false;
    for (var i = 0; i < DB.AUTHS.length; i++) {
      if (DB.AUTHS[i].appId === id && DB.AUTHS[i].status === '已授权') return true;
    }
    return false;
  }
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 「华信证券 · 债承审核」→「债承审核」。没有前缀的原样返回。 */
  function shortName(n) {
    var s = String(n || '');
    var i = s.indexOf(' · ');
    return i > 0 ? s.slice(i + 3) : s;
  }
  /* 时间戳取日期部分：卡片上只回答"哪天建的"，时分秒在卡片上是噪声。 */
  function dayOf(t) { return String(t || '').slice(0, 10) || '—'; }

  function rows() {
    var all = (window.DB && DB.APPS) ? DB.APPS : [];
    var out = all.filter(function (a) { return VISIBLE.indexOf(a.status) >= 0; });
    var kw = F.kw.trim().toLowerCase();
    if (kw) {
      out = out.filter(function (a) {
        return (a.name + ' ' + shortName(a.name) + ' ' + (a.desc || '')).toLowerCase().indexOf(kw) >= 0;
      });
    }
    if (F.st !== '全部') out = out.filter(function (a) { return a.status === F.st; });
    if (F.scene !== '全部') out = out.filter(function (a) { return (a.scene || '其他') === F.scene; });
    return out;
  }

  /* ── 筛选区 ────────────────────────────────────────────────────
     两行：状态、业务场景。两行的候选都从真实数据里取，不写死 ——
     写死一份候选，加一种状态就要记得回来改两处。 */
  function scenes() {
    var all = (window.DB && DB.APPS) ? DB.APPS : [];
    var seen = [], out = [];
    all.forEach(function (a) {
      if (VISIBLE.indexOf(a.status) < 0) return;
      var s = a.scene || '其他';
      if (seen.indexOf(s) < 0) { seen.push(s); out.push(s); }
    });
    return out;
  }
  function chip(kind, val, label) {
    var on = (kind === 'st' ? F.st : F.scene) === val;
    return '<button type="button" class="fchip" data-k="' + kind + '" data-v="' + esc(val) + '"'
      + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label || val) + '</button>';
  }
  function paintFilters() {
    var box = document.getElementById('filters');
    if (!box) return;
    var sts = ['全部'].concat(VISIBLE);
    var scs = ['全部'].concat(scenes());
    box.innerHTML =
      '<div class="sf-row">'
      + '<span class="sf-k">状态</span>'
      + '<div class="sf-v">' + sts.map(function (s) { return chip('st', s); }).join('') + '</div>'
      + viewToggle()
      + '</div>'
      + '<div class="sf-row">'
      + '<span class="sf-k">业务场景</span>'
      + '<div class="sf-v">' + scs.map(function (s) { return chip('scene', s); }).join('') + '</div>'
      + '</div>';
  }

  function viewToggle() {
    return '<div class="sv-toggle" role="group" aria-label="列表视图">'
      + '<button type="button" class="sv-btn" data-view="grid" aria-pressed="' + (VIEW === 'grid') + '" aria-label="卡片视图" title="卡片视图">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'
      + '<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/>'
      + '<rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/></svg></button>'
      + '<button type="button" class="sv-btn" data-view="list" aria-pressed="' + (VIEW === 'list') + '" aria-label="列表视图" title="列表视图">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'
      + '<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/></svg></button>'
      + '</div>';
  }

  /* ── 分组卡片 ──────────────────────────────────────────────────
     分组顺序按「组内第一个应用在列表里的位置」，不按字母/写死顺序：
     客户关心的是"我最近在用的"，不是字典序。 */
  function coverHtml(a) {
    if (a.cover) return '<img src="' + esc(a.cover) + '" alt="">';
    return '<img src="assets/common_card.webp" alt="">';
  }
  var IC_GO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  /* 购物车：真源市场卡底栏那颗（24×24 描边）。未开通才有 —— 已开通的卡片给箭头。 */
  var IC_CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h2.2l2.1 9.6a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>';

  /* 卡片结构：`<a class="ac-hit">封面+标题</a>` + `<div class="ac-ft">时间 + 动作</div>`。
     不能把动作塞进 <a> 里 —— 按钮嵌链接是无效 HTML，点一下会同时触发两个行为。 */
  function cardHtml(a) {
    var href = 'app.html?id=' + encodeURIComponent(a.id) + '&mode=view';
    var nm = shortName(a.name);
    var bought = isBought(a.id);
    var cta;
    if (MODE === 'market' && !bought) {
      cta = '<button type="button" class="ac-cart" data-buy="' + esc(a.id) + '"'
        + ' aria-label="开通「' + esc(nm) + '」" title="开通">' + IC_CART + '</button>';
    } else {
      cta = '<a class="ac-go" href="' + esc(href) + '" aria-label="进入「' + esc(nm) + '」">' + IC_GO + '</a>';
    }
    return '<article class="acard">'
      + '<a class="ac-hit" href="' + esc(href) + '" aria-label="进入应用「' + esc(nm) + '」">'
      + '<span class="ac-cover">' + coverHtml(a)
      + (MODE === 'market' && bought ? '<span class="ac-buy">已购买</span>' : '')
      + '</span>'
      + '<span class="ac-bd">'
      + '<span class="ac-nm">' + esc(nm) + '</span>'
      + '<span class="ac-desc">' + esc(a.desc || '—') + '</span>'
      + '</span>'
      + '</a>'
      + '<div class="ac-ft">'
      + '<span class="ac-time">' + esc(dayOf(a.updated)) + ' 创建</span>'
      + cta
      + '</div>'
      + '</article>';
  }

  /* 开通：真的往授权表里加一条 —— 不是假装成功。
     租户取顶条那个组织（达观数据），首次开通时自动建这条客户台账。 */
  function doBuy(id) {
    var a = DB.appById(id);
    if (!a) { if (window.UIK) UIK.toast('这个应用已经不在了', 'error'); return; }
    var nm = shortName(a.name);
    if (!window.Confirm) return;
    Confirm.ask({
      title: '开通「' + nm + '」',
      body: '开通后这条授权会写进客户授权，' + BUYER + ' 的账号可以用它。',
      ok: '开通',
      onOk: function () {
        var cl = DB.clientByName(BUYER);
        if (!cl) {
          var r = DB.addClient(BUYER, BUYER_TID);
          if (!r || !r.ok) { UIK.toast((r && r.msg) || '客户台账没写进去', 'error'); return; }
          cl = DB.clientByName(BUYER);
        }
        if (!cl) { UIK.toast('客户台账没写进去', 'error'); return; }
        var res = DB.authGrant(id, [cl.id], 12, today());
        if (!res || !res.ok) { UIK.toast((res && res.msg) || '没开通成功', 'error'); return; }
        repaint();
        UIK.toast('已开通 · 授权已写进客户授权');
      }
    });
  }

  function paintGroups() {
    var box = document.getElementById('groups');
    if (!box) return;
    var list = rows();
    if (!list.length) {
      /* 空态必须自带出口：客户筛到 0 条时，唯一能做的是把条件清掉。
         只写一句"没有应用"等于把人留在死路口。 */
      box.innerHTML = '<div class="empty"><b>没有符合条件的应用</b>'
        + '<button type="button" class="btn ghost" id="act-clear">清空筛选条件</button></div>';
      return;
    }
    var order = [], map = {};
    list.forEach(function (a) {
      var s = a.scene || '其他';
      if (!map[s]) { map[s] = []; order.push(s); }
      map[s].push(a);
    });
    box.innerHTML = order.map(function (s) {
      return '<section class="saas-group">'
        + '<h2 class="sg-hd">' + esc(s) + '</h2>'
        + '<div class="saas-grid' + (VIEW === 'list' ? ' is-list' : '') + '">'
        + map[s].map(cardHtml).join('')
        + '</div></section>';
    }).join('');
  }

  function repaint() { paintFilters(); paintGroups(); }

  function reset() {
    F = { kw: '', st: '全部', scene: '全部' };
    var inp = document.getElementById('kw');
    if (inp) inp.value = '';
    repaint();
  }

  function boot() {
    if (window.DB) DB.load();
    repaint();

    /* 筛选与视图切换都走同一条委托：按钮是重画出来的，逐个绑会随重画丢监听。 */
    document.addEventListener('click', function (e) {
      /* 购物车：先拦（它在 <a> 外面，不拦也不会跳转，但拦一下更稳，防止以后结构变化） */
      var cart = e.target.closest ? e.target.closest('.ac-cart') : null;
      if (cart) { e.preventDefault(); doBuy(cart.getAttribute('data-buy')); return; }
      var c = e.target.closest ? e.target.closest('.fchip') : null;
      if (c) {
        var k = c.getAttribute('data-k'), v = c.getAttribute('data-v');
        if (k === 'st') F.st = v; else F.scene = v;
        repaint();
        return;
      }
      var vb = e.target.closest ? e.target.closest('.sv-btn') : null;
      if (vb) {
        VIEW = vb.getAttribute('data-view');
        repaint();
        return;
      }
      if (e.target.closest && e.target.closest('#act-clear')) { reset(); return; }
    });

    var inp = document.getElementById('kw');
    if (inp) {
      /* 防抖 200ms：每敲一个字就整表重画，输入法组字时会把候选框顶飞。 */
      inp.addEventListener('input', function () {
        clearTimeout(kwTimer);
        kwTimer = setTimeout(function () { F.kw = inp.value; repaint(); }, 200);
      });
      /* 回车立刻生效，不等防抖 */
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { clearTimeout(kwTimer); F.kw = inp.value; repaint(); }
      });
      var sBtn = document.getElementById('act-search');
      if (sBtn) sBtn.addEventListener('click', function () { clearTimeout(kwTimer); F.kw = inp.value; repaint(); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
