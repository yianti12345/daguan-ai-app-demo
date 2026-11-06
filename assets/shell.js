/* ─────────────────────────────────────────────────────────────
   shell.js —— 管理后台外壳的唯一来源。
   品牌区、一级组、图标，只在这里定义一次；页面只写
   <nav class="sider" data-active="components"></nav>，其余由它填。
   改一处，三个页面同时变 —— 这不是承诺，是可验证的事实。

   ★2026-10-28 用户原话：「这个demo其实我只需要去做这个ai应用方案模块的功能。」
     只留「AI 应用方案」一组两项（应用管理 / 组件库）。原来另外 7 组共 21 项
     全部没有落地页，点了没用 —— 入口承诺了走不到的地方，比没有入口更差。
     形态（48 高、图标 18、缩进、字号）一个字节没动。

   ★2026-10-22 重写菜单形态：原来是我自己发明的「12px 小字分组标题 + 全带图标的行」，
     线上后台没有这种形态。线上是 **一级项（48 高、图标 18、右侧折叠箭头）+ 二级项（无图标、缩进）**，
     当前项白底 + 亮蓝 + 600。用户原话：「左侧的菜单真的是一模一样像素级复刻吗」。
     结构（组名/项名）仍取本地新版本，形态按线上实测：
       一级  li 48 高，icon x=31（18×18），文字 x=55，箭头靠右
       二级  li 48 高，文字 x≈63，无图标
       选中  白底通栏 + rgb(81,122,255) + 600
   ───────────────────────────────────────────────────────────── */
(function () {
  var NAV = [
    /* ★2026-11-05（用户定稿）：「整个平台的顶层架构变成极其经典的三足鼎立：
       应用管理、组件库、配置管理」。一级**只有这三项**，配置管理下面再挂三项。
       这是用户给的最终版结构，不再加第四项；加之前先读这段注释。 */
    ['应用管理', 'apps.html', 'apps'],
    ['组件库', 'components.html', 'components'],
    ['配置管理', [
      ['小智配置', 'xz-config.html', 'cfg-xz'],
      ['能力配置', 'abilities.html', 'cap-abilities'],
      ['基础配置', 'config.html', 'cfg-base']
    ]]
  ];

  /* ★2026-11-06（用户两次追问后补全）：
       ① 「要做，1:1 像素级复刻」→ 应用市场页落地 market.html；
       ② 「先把菜单模块加上，页面可以显示未接入」→ 系统设置那一组连 5 个子项一起挂出来，
          它们指向统一的 not-ready.html?p=<页名>，页面上明说"未接入"，不装样子。
     这一版不再有"点了没反应的入口"：每一项都真有一个落地页。 */
  var NAV_SAAS = [
    ['应用市场', 'market.html', 'market'],
    ['我的应用', 'my-apps.html', 'my-apps'],
    ['系统设置', [
      ['员工管理', 'not-ready.html?p=员工管理', 'sys-staff'],
      ['角色管理', 'not-ready.html?p=角色管理', 'sys-role'],
      ['部门管理', 'not-ready.html?p=部门管理', 'sys-dept'],
      ['素材中心', 'not-ready.html?p=素材中心', 'sys-media'],
      ['操作日志', 'not-ready.html?p=操作日志', 'sys-log']
    ]]
  ];

  /* 页面用 <nav class="sider" data-nav="saas" data-active="my-apps"> 选另一套。
     data-nav 缺省按 admin —— 12 个后台页面一个都不用改。 */
  var NAVS = { admin: NAV, saas: NAV_SAAS };


  /* ★2026-10-22：图标换成**真源 sprite 里的 symbol 原样 path**（不是我看图重画的）。
     取法：bsk 接真源 → document.getElementById('icon-menu-xxx').innerHTML。
     真源图标是填充式（fill=currentColor），不是我原来那套 1.7 描边线性图标 ——
     混用两套线条粗细，是"图标不统一"最直接的原因。
     ★2026-10-28：只剩「AI 应用方案」一组，其余 7 组的图标随组一起删除（无任何地方引用）。 */
  var GROUP_ICON = {
    /* 应用市场：购物袋（真源侧栏这一项就是"市场"语义的图，不是四宫格） */
    '应用市场': { vb:'0 0 24 24', d:'<path d="M3.5 8.5h17l-1.4 10.4a2 2 0 0 1-2 1.7H6.9a2 2 0 0 1-2-1.7L3.5 8.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path><path d="M8.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>' },
    /* 系统设置：齿轮 */
    '系统设置': { vb:'0 0 24 24', d:'<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" fill="none" stroke="currentColor" stroke-width="1.7"></path><path d="M19.4 13.6a7.8 7.8 0 0 0 0-3.2l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.8-1.6L14.2 3H9.8l-.3 2.2c-1 .3-2 .9-2.8 1.6l-2-.8L2.9 9.1l1.7 1.3a7.8 7.8 0 0 0 0 3.2L2.9 14.9l1.8 3.1 2-.8c.8.7 1.8 1.3 2.8 1.6l.3 2.2h4.4l.3-2.2c1-.3 2-.9 2.8-1.6l2 .8 1.8-3.1-1.7-1.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>' },
    /* ★2026-11-06：SaaS 端「我的应用」——四宫格。真源侧栏这一项是 Element Plus 的四格图标，
       形状是四个圆角方块；这里按同形重画（不是从 sprite 取的，取不到；形状一致即可）。 */
    '我的应用': { vb:'0 0 24 24', d:'<rect x="3" y="3" width="7.6" height="7.6" rx="1.6" fill="currentColor"></rect><rect x="13.4" y="3" width="7.6" height="7.6" rx="1.6" fill="currentColor"></rect><rect x="3" y="13.4" width="7.6" height="7.6" rx="1.6" fill="currentColor"></rect><rect x="13.4" y="13.4" width="7.6" height="7.6" rx="1.6" fill="currentColor"></rect>' },
    'AI 应用方案': { vb:'0 0 24 24', d:'<path d="m16.442 9.908-.067-.157-.614-1.626-1.774-.56c-1.607-.516-1.82-2.187-.614-2.983l-.96-.46a3.443 3.443 0 0 0-2.969 0l-5.77 2.792C2.647 7.419 2 8.394 2 9.448v6.133c0 1.054.636 2.03 1.663 2.534l5.77 2.826c.938.46 2.054.46 2.991 0l5.77-2.826c1.027-.504 1.663-1.468 1.663-2.534V9.986c-.725 1.39-2.734 1.368-3.415-.078Zm-1.685 3.51-2.132 1.255a3.396 3.396 0 0 1-3.393 0L7.1 13.417c-.022-.01-.033-.022-.055-.033-.402-.258-.503-.763-.224-1.133.28-.37.837-.46 1.24-.202l2.131 1.256a1.457 1.457 0 0 0 1.45 0l2.133-1.256c.401-.213.915-.112 1.183.236.3.37.212.874-.201 1.132Z" fill="currentColor"></path><path d="M18.267 2.26c-.123-.347-.313-.347-.425 0l-.661 1.95c-.112.347-.493.716-.84.84l-1.938.66c-.347.112-.347.314 0 .426l1.927.672c.347.123.717.493.84.84l.672 1.949c.123.347.313.347.425 0l.661-1.938c.112-.347.493-.728.84-.84l1.972-.672c.347-.112.347-.314 0-.426l-1.938-.65a1.544 1.544 0 0 1-.84-.84l-.695-1.97Z" fill="currentColor"></path>' },
  };

  /* 二级项不带图标：「AI 应用方案」这两项按线上形态是纯文字。
     ★2026-10-22：加了图标会让二级比一级更"重"，而线上二级永远是纯文字。图标因此只保留给一级项。 */
  /* 真源图标是**填充式**（svg 上 fill=currentColor，内部 path 不带 stroke），
     尺寸由 font-size 控制（真源 style="font-size:18px"）。这里用 width/height 18 等价实现。 */
  function ic(sym) {
    return '<svg width="18" height="18" viewBox="' + sym.vb + '" fill="currentColor" '
      + 'aria-hidden="true" focusable="false">' + sym.d + '</svg>';
  }
  function chev(open) {
    /* 展开 ∨ / 收起 ∧。旋转用 CSS，不换图形 —— 两个图形就有两处要维护 */
    return '<svg class="gv" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + '<path d="M6 9l6 6 6-6"/></svg>';
  }

  /* ── 一级可折叠、二级只在展开时出现（线上就是这个行为）。
     每一项都必须有落地页：没有 href 的 <a> 浏览器不当链接、不进 Tab 顺序、
     读屏不报"链接"、点了也不改地址栏 —— 那等于给用户一个点了没反应的入口。
     ★2026-10-28：原来 21 项没有落地页，只在右侧补一行小字说明。用户已明确
       只要这个模块，于是那些项连同占位分支一起删除，不留"承诺了走不到"的入口。 ── */
  function build(active, nav) {
    var html = '<div class="logo"><i>达</i><b>达观智能审核平台</b></div>'
      + '<div class="menu">';
    for (var g = 0; g < nav.length; g++) {
      var group = nav[g];
      /* 一级项如果是单页（应用管理 / 组件库），组头就是入口，不展开、不挂子项。 */
      if (typeof group[1] === 'string') {
        html += '<div class="grp" data-open="false" data-leaf="1">'
          + '<a class="gt" href="' + group[1] + '"'
            + (group[2] === active ? ' aria-current="page"' : '') + '>'
            + '<span class="gi">' + ic(GROUP_ICON[group[0]] || GROUP_ICON['AI 应用方案']) + '</span>'
            + '<span class="gn">' + group[0] + '</span>'
          + '</a></div>';
        continue;
      }
      var items = group[1], cur = false;
      for (var k = 0; k < items.length; k++) {
        if (items[k][2] && items[k][2] === active) cur = true;
        var kids0 = items[k][3];
        if (kids0) for (var q0 = 0; q0 < kids0.length; q0++) if (kids0[q0][2] === active) cur = true;
      }
      html += '<div class="grp" data-open="' + (cur ? 'true' : 'false') + '">'
        + '<button class="gt" type="button" aria-expanded="' + (cur ? 'true' : 'false') + '">'
          + '<span class="gi">' + ic(GROUP_ICON[group[0]] || GROUP_ICON['AI 应用方案']) + '</span>'
          + '<span class="gn">' + group[0] + '</span>'
          + chev(cur)
        + '</button>'
        + '<div class="gs">';
      for (var i = 0; i < items.length; i++) {
        var item = items[i], name = item[0], href = item[1], key = item[2], kids = item[3];
        if (kids) {
          var subOpen = false;
          for (var q = 0; q < kids.length; q++) if (kids[q][2] === active) subOpen = true;
          html += '<div class="grp sub" data-open="' + (subOpen ? 'true' : 'false') + '">'
            + '<button class="gt gt-sub" type="button" aria-expanded="' + (subOpen ? 'true' : 'false') + '">'
              + '<span class="gn">' + name + '</span>' + chev(subOpen)
            + '</button>'
            + '<div class="gs">';
          for (var w = 0; w < kids.length; w++) {
            html += '<a href="' + kids[w][1] + '"'
              + (kids[w][2] === active ? ' aria-current="page"' : '') + '>' + kids[w][0] + '</a>';
          }
          html += '</div></div>';
          continue;
        }
        html += '<a href="' + href + '"'
          + ((key && key === active) ? ' aria-current="page"' : '') + '>' + name + '</a>';
      }
      html += '</div></div>';
    }
    return html + '</div>';
  }

  /* 折叠：组少的时候也一样是"点一下切换"，不强制手风琴 ——
     以后再加组时需要同时展开两组做比对，手风琴会把这件事做死。 */
  function toggle(gt) {
    var grp = gt.parentElement;
    var open = grp.getAttribute('data-open') === 'true';
    grp.setAttribute('data-open', open ? 'false' : 'true');
    gt.setAttribute('aria-expanded', open ? 'false' : 'true');
  }

  /* ── 面包屑的返回图标（2026-11-06）────────────────────────────────
     用户原话：「为什么返回没了？面包屑的返回呢？你仔细看看我的系统，
     左上角有个返回小图标的」。真源实测：16px 圆圈+左箭头，位于面包屑最前
     （172.26.26.61:10612/admin/#/AuditAgent/AppManage，(216,16) 16×16，title="返回"）。
     放在这里而不是 11 个页面各写一遍 —— 面包屑是全站骨架，图标也该只有一处定义。
     返回目标：优先页面写的 data-back，其次面包屑里第一个链接，最后回汇总页。 */
  var BACK_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">'
    + '<path d="M13.47 7.47a.75.75 0 0 1 1.06 1.06L11.06 12l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1-.1-.9.75.75 0 0 1 .1-.23l4-3.93Z"/>'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"/>'
    + '</svg>';

  function mountCrumb() {
    /* 页面里已经写好的空壳（SaaS 页顶条那种）在这里补图形：图标只定义一处。 */
    var shells = document.querySelectorAll('.crumb-back');
    for (var s = 0; s < shells.length; s++) {
      if (!shells[s].children.length) shells[s].innerHTML = BACK_ICON;
    }
    var navs = document.querySelectorAll('nav.crumb');
    for (var i = 0; i < navs.length; i++) {
      var nav = navs[i];
      if (nav.dataset.backed === '1' || nav.querySelector('.crumb-back')) continue;
      var href = nav.getAttribute('data-back');
      if (!href) {
        /* 面包屑里的第一个链接只有当它指向**别的页**时才算"上一级"。
           组件库页的面包屑第一级就是它自己（<a href="components.html">组件库</a>），
           照着取会得到一个"返回自己"的图标 —— 点了什么都不发生。 */
        var same = function (h) {
          try { return new URL(h, location.href).pathname === location.pathname; } catch (e) { return false; }
        };
        var links = nav.querySelectorAll('a');
        for (var k = 0; k < links.length; k++) {
          if (links[k].hidden) continue;
          var h = links[k].getAttribute('href');
          if (h && !same(h)) { href = h; break; }
        }
      }
      if (!href) href = 'index.html';
      var a = document.createElement('a');
      a.className = 'crumb-back';
      a.href = href;
      a.title = '返回';
      a.setAttribute('aria-label', '返回');
      a.innerHTML = BACK_ICON;
      nav.insertBefore(a, nav.firstElementChild);
      nav.dataset.backed = '1';
    }
  }

  /* 「未接入」那五个子页共用一个 not-ready.html，靠 ?p=<页名> 区分。
     它们没法在 HTML 里写死 data-active（一页要顶五项），所以这里按页名反查 key。
     反查不到就不高亮 —— 宁可少亮一项，也不要亮错一项。 */
  function activeFromQuery(nav) {
    var p = '';
    try { p = new URLSearchParams(location.search).get('p') || ''; } catch (e) { return ''; }
    if (!p) return '';
    for (var g = 0; g < nav.length; g++) {
      var grp = nav[g];
      if (typeof grp[1] === 'string') { if (grp[0] === p) return grp[2]; continue; }
      for (var k = 0; k < grp[1].length; k++) {
        if (grp[1][k][0] === p) return grp[1][k][2];
      }
    }
    return '';
  }

  function mount() {
    var navs = document.querySelectorAll('.sider[data-active]');
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].dataset.filled === '1') continue;
      var set = NAVS[navs[i].getAttribute('data-nav') || 'admin'] || NAV;
      var act = navs[i].getAttribute('data-active') || activeFromQuery(set);
      navs[i].innerHTML = build(act, set);
      navs[i].dataset.filled = '1';
      /* 事件委托绑在 sider 上：render 只在首绘发生一次，
         但委托写法让以后"重画侧栏"也不用重新绑。 */
      navs[i].addEventListener('click', function (e) {
        var gt = e.target.closest ? e.target.closest('.gt') : null;
        if (gt) { toggle(gt); return; }
      });
    }
    mountCrumb();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.Shell = { mount: mount, NAV: NAV, NAVS: NAVS, backIcon: BACK_ICON };
})();
