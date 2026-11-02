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
    ['AI 应用方案', [
      ['应用管理', 'apps.html', 'apps'],
      ['组件库', 'components.html', 'components']
      /* ★2026-11-01（用户原话：「左侧只有两个模块，一个是应用管理，一个是 AI 组件库」）：
         这里**只许有两项**。
         上一版我擅自在中间加了「客户授权」，在末尾挂着「下载客户端」——两个都错了：
           · 客户授权是**某个应用的属性**（这个应用给谁用、客户看到哪一版），
             它该从应用卡片进去，是子页面，不配占一级导航；
           · 导航从 7 组 21 项砍到 2 项是用户定过的决定（"入口承诺了走不到的地方，
             比没有入口更差"），我加项等于把这条决定推翻了，而且没问。
         加项之前必须先问：这个东西是"跨应用的模块"，还是"某个应用身上的属性"？
         属后者，一律进页面，不进导航。 */
    ]]
  ];

  /* ★2026-10-22：图标换成**真源 sprite 里的 symbol 原样 path**（不是我看图重画的）。
     取法：bsk 接真源 → document.getElementById('icon-menu-xxx').innerHTML。
     真源图标是填充式（fill=currentColor），不是我原来那套 1.7 描边线性图标 ——
     混用两套线条粗细，是"图标不统一"最直接的原因。
     ★2026-10-28：只剩「AI 应用方案」一组，其余 7 组的图标随组一起删除（无任何地方引用）。 */
  var GROUP_ICON = {
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
  function build(active) {
    var html = '<div class="logo"><i>达</i><b>达观智能审核平台</b></div>'
      + '<div class="menu">';
    for (var g = 0; g < NAV.length; g++) {
      var group = NAV[g], items = group[1], cur = false;
      for (var k = 0; k < items.length; k++) {
        if (items[k][2] && items[k][2] === active) cur = true;
      }
      html += '<div class="grp" data-open="' + (cur ? 'true' : 'false') + '">'
        + '<button class="gt" type="button" aria-expanded="' + (cur ? 'true' : 'false') + '">'
          + '<span class="gi">' + ic(GROUP_ICON[group[0]] || GROUP_ICON['AI 应用方案']) + '</span>'
          + '<span class="gn">' + group[0] + '</span>'
          + chev(cur)
        + '</button>'
        + '<div class="gs">';
      for (var i = 0; i < items.length; i++) {
        var item = items[i], name = item[0], href = item[1], key = item[2];
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

  function mount() {
    var navs = document.querySelectorAll('.sider[data-active]');
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].dataset.filled === '1') continue;
      navs[i].innerHTML = build(navs[i].getAttribute('data-active'));
      navs[i].dataset.filled = '1';
      /* 事件委托绑在 sider 上：render 只在首绘发生一次，
         但委托写法让以后"重画侧栏"也不用重新绑。 */
      navs[i].addEventListener('click', function (e) {
        var gt = e.target.closest ? e.target.closest('.gt') : null;
        if (gt) { toggle(gt); return; }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.Shell = { mount: mount, NAV: NAV };
})();
