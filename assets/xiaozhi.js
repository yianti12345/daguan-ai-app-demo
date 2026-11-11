/* ─────────────────────────────────────────────────────────────
   xiaozhi.js —— 小智（页面内 agent）。
   逻辑本体原样取自 _work/aiwb/index.html 第 5298–6288 行，未重写一行。
   本文件只在前面补它依赖的外部件（G / att / here / render / sv / 挂载点）。
   ⚠ xzPlanModel 走 fetch(XZ_CFG.endpoint)，需要 xz-server 转发模型；
     静态预览下没有这个接口，会走到「没接上模型」的提示，不假装执行。

   ⚠ 数据边界（改这个文件前先读这一条）：
     window.__xzLog（只在 ?debug=1 时挂）是"动作元数据流水"，
     **只记谁/第几个/成没成/为什么没成，绝不记输入值**。
     fill 的文本可能含用户业务内容（客户名、金额、规则口径），
     往流水里加任何 value / text 字段之前，先问一遍"这东西能不能落到
     外部审计、能不能进日志文件"。要记值的场景请另开一个显式的开关，
     不要顺手往这里加。
     ───────────────────────────────────────────────────────────── */
var G = window.G || (window.G = {});

function att(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}
function here(){ return location.hash.split('?')[0]; }
function xzHost(){ return document.getElementById('xz-host'); }
function render(){ xzPaint(); renderXz(); try { xzHistSaveSoon(); } catch (e) {} }

var XZ_SV = {
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  right: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  mic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V21"/></svg>'
};
function sv(n){ return XZ_SV[n] || ''; }

/* ── 浮球可拖，面板跟着走 ─────────────────────────────────────────────
   ★2026-10-22：用户要的是"小智图标能拖，默认在右下角，和预览胶囊挨着"。
   四个坑，逐个堵：

   ① **节点每次 render 都重建**：`.xz-fab` 是 xzHtml() 产出的字符串，
      开合面板 / 跑完一轮都会重写 #xz-host.innerHTML —— 直接在启动时挂一次
      Draggable，第一次开合之后就失效（睿克斯踩过这个）。所以挂在 renderXz
      之后：重建一次、重挂一次；旧实例用 destroy() 从 Dragable 的模块级
      instances 清单里摘掉，不然清单会随着重绘一直涨。
      位置由 drag.js 自己落 localStorage（ifas90:pos:xz-fab），重挂时它会
      自动把 left/top 写回来，所以"拖走 → 刷新 → 还在那儿"不需要我额外存。

   ② **drag.js 不拖 button**：pointerdown 落在 button/input/a 上直接返回。
      浮球整颗都是按钮 ⇒ 永远拖不动。所以标签换成 div[role=button]，
      回车/空格在这里手动补 click，键盘可达性不掉。

   ③ **面板要贴着浮球**：CSS 里 .xz-panel 是 right:24px;bottom:92px（贴着
      默认位置的浮球）。浮球一拖走，面板就会留在右下角孤零零。所以
      xzPlacePanel()：只要浮球被打过拖动标记（drag.js 的 data-dragging-placed），
      就把面板按浮球的实测矩形摆过去（优先上方、右边缘对齐、放不下翻到下方、
      水平夹在视口内）。没拖过就什么都不做，还是让 CSS 说了算。

   ④ **拖动会补一个 click**：drag.js 已经在 window 捕获阶段吞掉（250ms 窗），
      所以"拖一下顺手把面板打开"不会发生。验收里专门点了一次（见交付说明）。 */
/* ── 焦点归还 ────────────────────────────────────────────────────────
   ★2026-10-22（优希-2 实测）：小智的开关一律走 renderXz()，而 renderXz()
   重建 #xz-host 整棵 —— 刚被点的那颗节点（浮球 / ✕）直接消失，
   浏览器只好把 document.activeElement 掉回 body。键盘用户收起面板后
   Tab 得从页面开头重新走，等于"失忆"。
   所以开/关之后都要显式把焦点安置到人预期的地方：
     · 收起 → 浮球（下一次按回车能再打开）
     · 展开 → 输入框（打开就是要说话）
   preventScroll 必须带：面板贴边时聚焦可能把页面滚一下，很突兀。 */
function xzFocusTo(node){
  if (!node) return false;
  try { node.focus({ preventScroll: true }); }
  catch (e1){ try { node.focus(); } catch (e2){ return false; } }
  return document.activeElement === node;
}
function xzFocusFab(){
  return xzFocusTo(document.querySelector('.xz-fab'));
}
function xzFocusPanel(){
  var box = document.getElementById('xzBody');
  var input = box ? box.parentNode.querySelector('.xz-inputwrap input') : null;
  return xzFocusTo(input);
}

function xzMountFab(host){
  if (!host) return;
  var fab = host.querySelector('.xz-fab');
  if (!fab) return;
  if (G.xzFabDrag && G.xzFabDrag.destroy) G.xzFabDrag.destroy();
  G.xzFabDrag = null;
  /* div[role=button] 不会自己响应回车/空格，这里补上（走 click，和鼠标同一条路） */
  fab.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){
      e.preventDefault();
      fab.click();
    }
  });
  if (window.Draggable){
    G.xzFabDrag = window.Draggable(fab, {
      key: 'xz-fab',
      /* 松手后如果面板正开着，跟着浮球挪过去。
         顺手清掉 drag.js 写的内联 transform：它为了防"一碰就跳"会把
         计算出来的 transform 置成 none，而 .xz-fab 的 hover 抬升正好用的
         transform —— 不清的话，拖过一次之后就再也不抬了。位置靠 left/top，
         清掉 transform 不会挪位。 */
      onChange: function(){
        if (fab.style.transform === 'none') fab.style.transform = '';
        xzPlacePanel(xzHost());
      }
    });
  }
}
/* ── 面板本身也能拖（2026-10-23 用户要求：「小智是可以全屏幕拖动的」）
   之前只有浮球能拖，面板被 xzPlacePanel 钉在浮球旁边 —— 想把面板挪到不挡内容的地方，
   只能先拖浮球、再让面板跟着跳，等于不能挪。
   现在：浮球可拖（任意角落）、面板可拖（抓手＝头部，任意位置）。
   两条位置各存各的 localStorage key，互不干扰。
   ⚠ 顺序必须是「先挂拖动（它会写回上次位置）→ 再决定要不要按浮球摆」，
     否则刚恢复的位置会被 xzPlacePanel 覆盖掉。 */
function xzMountPanel(host){
  if (!host) return;
  var panel = host.querySelector('.xz-panel');
  if (!panel) return;
  if (G.xzPanelDrag && G.xzPanelDrag.destroy) G.xzPanelDrag.destroy();
  G.xzPanelDrag = null;
  if (!window.Draggable) return;
  G.xzPanelDrag = window.Draggable(panel, {
    key: 'xz-panel',
    handle: '.xz-head',            /* 只认头部：正文要能选中/滚动，不能被误拖 */
    onChange: function(){
      if (panel.style.transform === 'none') panel.style.transform = '';
    }
  });
}

/* 面板贴浮球。只在浮球被拖过之后接管定位 —— 没拖过时 CSS 的 right/bottom 更准
   （面板比浮球宽得多，CSS 那套是照默认位置调好的）。 */
function xzPlacePanel(host){
  host = host || xzHost();
  if (!host) return;
  var fab = host.querySelector('.xz-fab');
  var panel = host.querySelector('.xz-panel');
  if (!fab || !panel) return;
  /* 面板自己被拖过 → 用户已经给它定了位置，不许再按浮球摆回去。
     （"拖一次就被弹回原位"是最容易被当成"拖动坏了"的行为。） */
  if (panel.getAttribute('data-dragging-placed')) return;
  if (!fab.getAttribute('data-dragging-placed')) return;
  var fr = fab.getBoundingClientRect();
  var pw = panel.offsetWidth, ph = panel.offsetHeight;
  var gap = 12, pad = 8;
  var vw = window.innerWidth, vh = window.innerHeight;
  var left, top;
  var roomAbove = fr.top - gap - pad;
  var roomBelow = vh - fr.bottom - gap - pad;
  var roomRight = vw - fr.right - gap - pad;
  var roomLeft = fr.left - gap - pad;
  var clampT = function(t){ return Math.max(pad, Math.min(t, vh - ph - pad)); };

  if (ph <= roomAbove){                 /* ① 上方放得下：右边缘对齐，压在浮球上方 */
    left = fr.right - pw; top = fr.top - ph - gap;
  } else if (ph <= roomBelow){          /* ② 贴下方 */
    left = fr.right - pw; top = fr.bottom + gap;
  } else if (pw <= roomRight){          /* ③ 上下都不够（屏矮、浮球在中间）：挪到侧边，
                                           让浮球露出来 —— 否则面板正好盖住浮球，
                                           既看不见也拖不动了 */
    left = fr.right + gap; top = fr.top;
  } else if (pw <= roomLeft){           /* ④ 左侧 */
    left = fr.left - pw - gap; top = fr.top;
  } else {                              /* ⑤ 真放不下：挑宽敞的那边贴边，接受重叠 */
    left = fr.right - pw;
    top = (roomAbove >= roomBelow) ? pad : (vh - ph - pad);
  }
  left = Math.max(pad, Math.min(left, vw - pw - pad));
  top = clampT(top);
  panel.style.left = Math.round(left) + 'px';
  panel.style.top = Math.round(top) + 'px';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}
/* 窗口一变：drag.js 自己会把浮球夹回视口（它的 resize 监听比我们早注册，先跑），
   我们只做两件收尾的事：清掉它写的内联 transform（见 onChange 里的原因），
   再按浮球的新位置重摆面板。 */
window.addEventListener('resize', function(){
  var fab = document.querySelector('.xz-fab');
  if (fab && fab.style.transform === 'none') fab.style.transform = '';
  xzPlacePanel();
});

function renderXz(){
  var host = xzHost();
  if (!host) return;
  host.innerHTML = xzHtml(window.__xzMode || 'admin');
  /* 首绘不跑 xzPaint（它只重绘 #xzBody），顶部的进度在这里补上 */
  xzProgPaint();
  /* ★2026-10-22：顺序不能反 —— 先重挂拖动（它会写回上次的位置），
     再按浮球的真实位置摆面板。 */
  xzMountFab(host);
  xzMountPanel(host);
  /* ★2026-11-04：首绘不跑 xzPaint，附件入口就永远挂不上 —— 面板 HTML 里有 #xzAttBar，
     回形针却一直停在「输入框里 0 个按钮」（实测 .xz-inputwrap .uik-att-btn = 0）。
     打开即挂一次，之后的每次重绘由 xzPaint 自己再挂。 */
  xzAttachSync();
  xzPlacePanel(host);
  /* ★2026-10-22：任何一次重建之后，只要面板是开着的，就把"这一轮的结论"保持在
     可视区内。**这一步不能只放在 toggle 里** —— 面板状态是持久化的（sessionStorage
     `xz:open`），刷新/换页后会直接以打开状态恢复，此时没有任何 toggle 发生，
     结论块可能停在可视区外（e2e 实测：块 1012 ｜ 视区 353…691）。
     放这里就等于"只要面板可见，结论就可见"这一条不依赖某条进入路径。 */
  if (xzState().open) xzScrollToResult();
  /* 面板是整棵重建的：录音/识别状态必须重画回去，否则一重绘按钮就"忘"了自己在录 */
  xzMicUi();
}
document.addEventListener('click', function(e){
  var b = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!b) return;
  var act = b.getAttribute('data-act');
  var arg = b.getAttribute('data-arg') || '';
  /* 对话历史（2026-11-02）：图标只在小智面板里生效；装配对话框那套
     也发 hist* 动作，靠 closest('.xz-panel') 隔离，互不抢事件。 */
  if (act.indexOf('hist') === 0){
    if (!b.closest('.xz-panel')) return;
    e.stopPropagation(); e.preventDefault();
    var H = xzState();
    if (act === 'histToggle'){
      H.view = (H.view === 'chat' || !H.view) ? 'list' : 'chat';
      H.detail = '';
      renderXz();
      setTimeout(function(){
        if (H.view === 'list'){
          var f = document.querySelector('.xz-panel .hist-item');
          if (f) f.focus();
        } else xzFocusPanel();
      }, 0);
      return;
    }
    if (act === 'histOpen'){
      H.view = 'detail'; H.detail = arg;
      renderXz();
      setTimeout(function(){
        var f = document.querySelector('.xz-panel .hist-back');
        if (f) f.focus();
      }, 0);
      return;
    }
    if (act === 'histBack'){
      H.view = 'list'; H.detail = '';
      renderXz();
      setTimeout(function(){
        var f = document.querySelector('.xz-panel .hist-item');
        if (f) f.focus();
      }, 0);
      return;
    }
    if (act === 'histNew'){ xzHistNew(); return; }
    if (act === 'histDel'){ xzHistDel(arg || H.detail); return; }
    if (act === 'histClear'){ xzHistClear(); return; }
    return;
  }
  /* ★2026-10-22：这里必须 stopPropagation。
     实测：xiaozhi.js 内部还有一套事件代理，同一次点击会被两边各处理一次 ⇒
     两个 xzRun 并发跑，m 对象互相覆盖，面板会莫名其妙消失或状态打架。
     外层接管后要吃掉这个事件。 */
  if (act === 'xzToggle'){
    e.stopPropagation(); e.preventDefault();
    var X = xzState();
    /* ★2026-10-22（优希-2 实测，真 bug）：原来开和关共用一句
       `X.open = !X.open; X.unread = 0;` —— 于是**关面板也会清未读**。
       后果：事故发生时面板多半是开着的（人正看着），他看完把面板一关，
       徽标和「有一件事等你确认」一起消失 —— 而"人会不会走开"正是事故态唯一要防的事。
       ⇒ 只有**打开**才算"人看过了"（面板一开就会滚到底、事故块就在那儿），
         关闭一律不动 unread。 */
    if (X.open){
      X.open = false;                       /* 收起：保留未读，别替用户宣布"已处理" */
      X.view = 'chat'; X.detail = '';        /* 下次打开回到对话，不留在历史里 */
    } else {
      X.open = true; X.unread = 0; X.unreadReason = '';   /* 展开：这才是"看过" */
    }    /* ★2026-10-22：开合状态落 sessionStorage。原因见 xzDocRoot 的注释 ——
       只要文档被换掉，G.xz 这份内存状态就归零，面板会缩回浮球。
       现在主因已经堵住（不许跳页），但用户自己跳页、或页面里某个异步 handler
       触发跳转时，也不能让小智"自己没了"。同标签页内跟着走，关掉标签页就清。 */
    try { sessionStorage.setItem('xz:open', X.open ? '1' : '0'); } catch (err) {}
    renderXz();
    /* ★2026-10-22（优希-2 实测）：收起来之后焦点不能丢。
       renderXz() 会重建 #xz-host 整棵，被点的那颗浮球/✕ 随之消失，
       document.activeElement 掉回 body —— 键盘用户关完面板就"失忆"，
       Tab 得从头再走一遍。所以收起后把焦点还给浮球。
       展开时同理，把焦点放进输入框（人打开面板就是要说话）。 */
    /* 展开时：先把结论块滚进可视区（"打开即已读"必须真的看得见，见 xzScrollToResult），
       再把焦点放进输入框。顺序不能反 —— 聚焦也可能带动滚动。 */
    if (X.open){ xzScrollToResult(); xzFocusPanel(); } else xzFocusFab();
    return;
  }
  if (act === 'xzStop'){ e.stopPropagation(); e.preventDefault(); xzStop(); return; }
  if (act === 'xzMic'){ e.stopPropagation(); e.preventDefault(); xzMicToggle(); return; }
  if (act === 'xzGrant'){ e.stopPropagation(); e.preventDefault(); xzGrant(); return; }
  if (act === 'xzDeny'){ e.stopPropagation(); e.preventDefault(); xzDeny(); return; }
  /* 计划条折叠：就地改 hidden / aria-expanded，不重建整块 —— 焦点留在按钮上，
     键盘用户按完不会"失忆"。状态同时写回 m.plan.open，下一次 paint 也一致。 */
  if (act === 'xzPlanToggle'){
    e.stopPropagation(); e.preventDefault();
    var ph = xzPlanMsg();
    if (!ph || !ph.m.plan) return;
    ph.m.plan.touched = 1;
    ph.m.plan.open = !(ph.m.plan.open !== false);
    var pl = document.getElementById('xzTaskList');
    if (pl){
      if (ph.m.plan.open) pl.removeAttribute('hidden'); else pl.setAttribute('hidden', '');
      b.setAttribute('aria-expanded', ph.m.plan.open ? 'true' : 'false');
      var pi = b.querySelector('.xz-plan-ic');
      if (pi) pi.textContent = ph.m.plan.open ? '▾' : '▸';
    }
    return;
  }
  /* 失败三出口：分类卡上的按钮，各走各的路 */
  if (act === 'xzRetry'){ e.stopPropagation(); e.preventDefault(); xzRetry(+arg); return; }
  if (act === 'xzRephrase'){ e.stopPropagation(); e.preventDefault(); xzRephrase(+arg); return; }
  if (act === 'xzJump'){ e.stopPropagation(); e.preventDefault(); xzJump(+arg, b); return; }
  /* ★2026-10-22：事故块的出口。按名字在当前快照里重新定位（当时的元素引用早被重绘冲掉了） */
  if (act === 'xzIncidentGo'){ e.stopPropagation(); e.preventDefault(); xzLocate(arg, b); return; }
  if (act === 'xzAsk'){ e.stopPropagation(); e.preventDefault(); xzAsk(arg); return; }
  if (act === 'xzSend'){
    e.stopPropagation(); e.preventDefault();
    var xi = document.querySelector('[data-act="xzInput"]');
    var xv = xi ? String(xi.value || '').trim() : '';
    var fromVoice = !!(xi && xi.getAttribute('data-voice') === '1');
    if (xi) xi.removeAttribute('data-voice');
    var atts = xzAttTake();
    if (xv || atts.length){ xi.value = ''; xzInputFit(xi); xzAsk(xv, fromVoice, atts); }
    return;
  }
}, true);

/* ── 回车发送（2026-10-24 用户当面指出「按回车什么都没发生」）──────────
   原因：发送只绑在 38×38 的发送按钮上（act === 'xzSend'），输入框没有任何
   keydown 分支。实测：输入文字按 Enter 后 11.2 s 内面板零变化（kb.json/xz.json），
   而这正是对话式输入最主要的提交方式。
   规则：Enter（不带 Shift、不在输入法组合中）＝ 点发送；Shift+Enter 不拦（留给换行）。
   `e.keyCode === 229` 是 IME 组合态的老浏览器口径，一并排除，避免中文选词回车被吃掉。 */
document.addEventListener('keydown', function(e){
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  var t = e.target;
  if (!t || !t.getAttribute || t.getAttribute('data-act') !== 'xzInput') return;
  e.preventDefault(); e.stopPropagation();
  var ev = String(t.value || '').trim();
  var fromVoice = t.getAttribute('data-voice') === '1';
  t.removeAttribute('data-voice');
  var atts2 = xzAttTake();
  if (ev || atts2.length){ t.value = ''; xzInputFit(t); xzAsk(ev, fromVoice, atts2); }
}, true);

/* ── 输入框随内容长高（2026-11-04）───────────────────────────────
   两行起、三行封顶，超出就滚动。高度按 scrollHeight 现算，不写死像素 ——
   字号一改（判据 tokscale 会动），这里不用跟着改。 */
function xzInputFit(el){
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 63) + 'px';
}
document.addEventListener('input', function(e){
  var t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-act') === 'xzInput') xzInputFit(t);
}, true);

/* ── 第二道闸：小智操作期间，不许任何点击把文档换掉 ──────────────────
   ★2026-10-22 根因（实测复现，见 xzDocRoot 注释）：小智点了侧栏的
     <a href="apps.html">「应用管理」，浏览器真的整页导航走了。
     新文档里 G.xz 是重新初始化的 open:false，#xz-host 只画出浮球
     （innerHTML 2244 → 99）——看起来就是"面板自己消失、open 变 false"，
     而且控制台没有任何异常：确实什么都没坏，是页面被换掉了。
   第一道闸在 xzAct（会如实报失败，并让模型知道不能跳）；
   这里是第二道闸，兜"页面自己的 click handler 也会跳"的情况（onclick=location.href=…）。
   只在 G.xzHold（小智正在动手）时生效 —— 用户自己点链接照常跳，不干扰人。 */
document.addEventListener('click', function(e){
  if (!G.xzHold) return;
  var a = (e.target && e.target.closest) ? e.target.closest('a[href]') : null;
  if (!a) return;
  var raw = a.getAttribute('href') || '';
  if (!raw || raw.charAt(0) === '#' || /^(javascript:|mailto:|tel:)/i.test(raw)) return;
  var u;
  try { u = new URL(raw, location.href); } catch (err){ return; }
  /* 同文档的 hash 路由放行：那是页面内部的视图切换，不换文档 */
  if (u.pathname === location.pathname && u.search === location.search) return;
  e.preventDefault();
  G.xzNavBlocked = raw;
}, true);

/* ── Esc 收起小智面板 ────────────────────────────────────────────────
   ★2026-10-22（优希-2 实测到的真缺陷）：面板打开后按 Esc 关不掉。
   页面里已有同类做法（app.js 对装配面板的 Esc），小智这一层漏了。
   "Esc 关最上面那层"是通用心智，所以按这个口径接：
   · 只有自己开着时才接；
   · 页面自己的遮罩弹窗开着时**让给它** —— 那边的 Esc 语义是"关弹窗"，
     两件事一起发生会让人觉得按一下关了两个东西；
   · 用捕获阶段 + stopPropagation：面板浮在最上层，先关它，
     再轮到页面里别的 Esc 行为。 */
function xzPageModalOpen(){
  return !!document.querySelector('.mask[data-open="true"], dialog[open], [role="dialog"][data-open="true"]');
}

/* ── 页面自己的**确认框**开着吗（不是"任意弹层"）──────────────────────
   ★2026-10-28（跨页误报，实例 M-NFMASK-20261028-01）：finish() 原来直接判
   `.nf-mask:not([hidden])`。而 `.nf-mask` 是本仓的**通用**弹层类 ——
   apps.html 的「新建应用」(#ap-mask)、components.html 的「新增组件」(#nf-mask)
   与「编辑信息」(#ei-mask) 都用它。于是这几页上只要开着**表单**，一轮
   已授权、动过手的任务收尾就会被改写成「停在页面自己的确认框了，最后一下归你」：
   实测（apps.html 开着「新建应用」）kind 从 done 变成 wait，文案是一句假承诺。
   本仓"确认"只有一个定义处：confirm.js（它自己的注释写着"同一件事不许有两个定义处"）。
   它产出的框带两个页面表单没有的标记，页面表单一个都不带：
     · role="alertdialog"（confirm.js:61-64；全仓只有它产出 alertdialog）
     · class .nf-confirm（sys.css 里有它的样式，删掉这个类会掉样式）
   所以判据收窄到这两个标记。仍要求祖先 `.nf-mask` 没被 hidden 掉 ——
   关框只是 hidden=true、节点常驻 DOM，判"存在"会永远为真（盲审两轮踩过）。
   收窄后真确认框照旧命中（同一个 confirm.js 框），行为只在"开着表单"时改变。 */
function xzPageConfirmOpen(){
  return !!document.querySelector(
    '.nf-mask:not([hidden]) [role="alertdialog"], .nf-mask:not([hidden]) .nf-confirm');
}
document.addEventListener('keydown', function(e){
  if (e.key !== 'Escape' && e.key !== 'Esc' && e.keyCode !== 27) return;
  var X = xzState();
  if (!X.open) return;
  if (xzPageModalOpen()) return;
  e.stopPropagation();
  X.open = false; X.unread = 0;
  X.view = 'chat'; X.detail = '';
  try { sessionStorage.setItem('xz:open', '0'); } catch (err) {}
  renderXz();
  /* 收起后焦点回浮球（同 xzToggle 里的原因：节点重建，焦点会掉回 body） */
  xzFocusFab();
}, true);

/* ══ 以下为原逻辑（原样抽出，未改写）═══════════════════════════ */
var XZ_CFG = {
  /* ★2026-11-03（用户 m01931「公网链接小智用不了了」）：GitHub Pages 是纯静态站，
     没有 /xz/plan。演示机就跑在本机，所以公网页面直连本机转发（浏览器视 127.0.0.1 为可信源），
     本机转发没起 / 被挡时仍按原有逻辑退回内置规则，不会白屏。 */
  endpoint: (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:')
    ? '/xz/plan' : 'http://127.0.0.1:8941/xz/plan',
  temp: 0,
  batch: 6,          /* 一批最多几个动作：一次规划太多，错在第三步后面全错 */
  maxSteps: 40,      /* 整个任务最多几轮（他定的 40） */
  settle: 900,       /* 点完之后最多等页面稳定多久 ms */
  opPace: 700,       /* 两个动作之间留多久 ms —— 给眼睛的，不是给机器的（实测 260 快到看不见） */
  /* ★2026-10-22：3000 不够用。deepseek-flash 是推理模型，reasoning 先吃掉一截，
     剩下的正文经常正好卡在 acts 数组中间 —— 实测报 "Expected ',' or ']'"。
     这台机器只有这一个模型，不能换，所以给足输出预算：7000 是"一次规划
     6 个动作 + 2 个阶段 + 一句话"的 4 倍余量，再多也不会更慢（一次请求就一个）。 */
  maxTokens: 7000,
  useModel: true     /* 关掉就退回本地规划器（调试用） */
};

/* 原语集：给模型看的工具定义。这一层永远不随业务增加而变。 */
var XZ_PRIMS = [
  { n:'observe', d:'重新读当前页面（点了会弹窗/翻页时用它）' },
  { n:'click',   d:'点第 i 个元素' },
  { n:'fill',    d:'往第 i 个输入框填文本' },
  { n:'pick',    d:'在第 i 个下拉里选某个值' },
  { n:'go',      d:'跳到某个路由（#xxx）' },
  { n:'scroll',  d:'滚到第 i 个元素' }
];

var XZ_Q = {
  /* ★2026-10-23 修：原来只有 admin/client/app 三个角色，组件库页（components.html）
     落到 admin，于是推荐「把这套应用授权给华信证券」—— 那一页既没有授权也没有客户筛选，
     点下去必然失败（实测小智回「没找到「清除筛选」或「筛选」」）。
     推荐问题必须是**这一页真做得到**的事，所以按页面加一个 lib 角色。 */
  lib: ['点一下「新增组件」', '只看已上架的组件', '搜一下「规则」'],
  /* 组件配置页（component.html）：
     ★ 2026-10-23 修。这一页原来落到 admin 角色，推荐「搜一下「复核」」「只看已上架的应用」
     —— 这页既没有应用列表也没有筛选，点下去必然"没做成"。
     这一页真正能被小智做的事只有一类：**读懂当前这一页**（快照里有块、列、字段）。
     改内容走底部对话框（那是生成器），不是让小智去点。所以推荐问题全是可读可答的。 */
  comp: ['这一页有几块内容', '表格里有哪些列', '这一页是做什么的'],
  admin: ['搜一下「复核」', '只看已上架的应用', '刷新一下列表'],
  client: ['我是制造业，帮我筛出能用的应用', '有没有做采购预检的', '推荐一个开箱即用的'],
  /* ★2026-10-22 改：应用配置页原来的两条（"哪些规则是我改过的""把金额阈值调到 3000"）
     在这一页上根本查不到也点不到 —— 实测点第一条，模型转身去点「返回应用管理」，
     被"不许跳页"的闸拦下，面板上红了一条。推荐问题是**这一页**的推荐，
     不是整套系统的推荐：写成这页真做得到的事，第一条点下去就能看见它动手。 */
  app: ['打开「可用资产」', '保存草稿']
};

/* ── 不可逆动作的代码闸 ─────────────────────────────────────────────
   ★ 这条绝对不能只写在 prompt 里。实测过：prompt 里明确写了"授权前停住"，
     模型还是给了 {"p":"click","i":4} —— i=4 正是「授权并复制 v4」按钮，
     而且真执行了，数据里多出一条「潍柴动力@v4」。
     结论：撤不回来的动作必须在**执行层**拦，不看模型怎么说、不赌它听不听话。
     放行只有一个口子：用户自己说"确认"，放行一次（G.xzOnce）。 */
var XZ_IRREVERSIBLE = /^(授权|确认授权|确认修改|确认删除|发布|提交|删除|下线|移除|停用|启用|立即|重置|回流)/;
/* 用户这句话本身是不是在要一个撤不回来的结果（"把这份应用发布给客户"）。
   模型这一轮一个动作都没做时，不能报"做完了"——那是假完成，见 finish。 */
var XZ_USER_IRREV = /(发布|上线|删除|下线|授权|提交|停用|启用|移除|重置)/;

var XZ_REF = [];
var XZ_GEN = 0;
function xzNow(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }

/* ── 遮挡层 ─────────────────────────────────────────────────────────
   ★ 抄 BrowserSkill 的 detectBlockingLayer：判断"谁盖在谁上面"不能只看 z-index
     （z-index 有 stacking context 陷阱），要看几何覆盖 + pointerEvents + position。
   两条判定跟它一致：
     · 必须是 fixed/absolute/sticky 且没有 pointer-events:none
     · 必须**盖满大半个视口**才算折叠底页 —— 大侧栏旁边还有可用内容，不算遮挡。
   为什么这事关"配套做好"：点了按钮弹出弹窗之后，模型要能**看见弹窗里的东西**。
   如果 observe 还在读底页，它会拿着底页的元素去点一个被遮住的按钮，然后失败。 */
function xzCoverLayer(){
  var vw = window.innerWidth, vh = window.innerHeight;
  if (!vw || !vh) return null;
  var best = null, bestCov = 0;
  var all = document.querySelectorAll('div,section,aside,form,dialog');
  for (var i = 0; i < all.length && i < 4000; i++){
    var e = all[i];
    var s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'absolute' && s.position !== 'sticky') continue;
    if (s.pointerEvents === 'none') continue;
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    var ix = Math.min(r.right, vw) - Math.max(r.left, 0);
    var iy = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (ix <= 0 || iy <= 0) continue;
    var cov = (ix * iy) / (vw * vh);
    if (cov > 0.5 && cov > bestCov){ best = e; bestCov = cov; }
  }
  return best;
}

/* 读哪一块：有弹窗就读弹窗，没有就读主内容区。
   这就是"点了之后弹窗配套"的落点 —— 不用特判某个弹窗的类名。 */
/* ★2026-10-22 根因修（实测复现）：这四个页面没有 #main-content，原来兜底是
   document.body —— 于是语义快照把**整个全局外壳**都算了进去：侧栏 20 多个
   <a href="apps.html">、面包屑、返回链接。模型要"把这套应用授权给华信证券"，
   正文里找不到「客户配置」，就顺着外壳点了一个导航链接（实测 i=2 ＝ 侧栏
   「应用管理」），浏览器真的整页跳走了。新文档里小智是全新初始化的 open:false，
   #xz-host 只画出浮球 —— 现象就是"约 2.5 秒后面板整体消失、xzState().open 变 false"，
   控制台无异常、xzToggle 只被调用过一次、G.xz 也没被重置：因为一层都没错，
   是文档被换掉了，内存状态自然归零。
   修法两层：① 根只取正文区（landmark <main>），全局外壳导航不进快照；
            ② xzAct 的 click 加"会离开这一页"的闸（xzLeavesDoc）。
   为什么用 <main> 而不是白名单某个页面类名：<main> 是语义 landmark，
   四个页面都有，不绑业务、不随改版漂。 */
function xzDocRoot(){
  /* ★2026-10-22 修（实测踩到，而且是我上一轮"修 bug"时自己埋的）：
     原来返回 `#main-content || <main> || body`，目的是限制观测范围、防止模型点侧栏把页面跳走。
     但配置页的 <main> 就是画布本身，而底部对话条 / 装配组件胶囊 / 右下操作组全挂在 body 上
     ⇒ 这三件浮层在小智眼里根本不存在，它会说"这一页没有我能动的入口"，一个动作都执行不了。
     ⇒ 范围改回 body，改用两件更准的**排除**：
        ① 小智自己的 UI（#xz-host）—— 否则模型"找到入口"时会点自己的浮球把面板关掉；
        ② 平台侧栏（.sider）—— 点它等于跳页，不是操作当前页。
     一句话：用"缩小范围"来防跑偏会误伤，用"排除项"才准。 */
  return document.body;
}
function xzRoot(){
  var layer = xzCoverLayer();
  if (layer) return layer;
  return xzDocRoot();
}
function xzInLayer(){
  return !!xzCoverLayer();
}

function xzVisible(e){
  var r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  var s = getComputedStyle(e);
  return !(s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0');
}
function xzName(e){
  var t = (e.getAttribute('aria-label') || '').trim();
  if (!t) t = (e.getAttribute('placeholder') || '').trim();
  if (!t) t = (e.getAttribute('title') || '').trim();
  if (!t) t = (e.textContent || '').replace(/\s+/g, ' ').trim();
  if (!t && e.tagName === 'INPUT') t = (e.value || '').trim() || '(空)';
  return t.slice(0, 36);
}
/* ★2026-10-26（可测性，同 xzAct 那条毛病）：`xzName` 是函数声明 = 作用域绑定，
   不是 window 属性查找。测试桩 `window.xzName = …` 只改了同名属性，执行层照旧调局部函数，
   于是桩想制造的"目标被改名成『发布新版本』"从未生效 —— 事故链判据因此永远看不到事故块。
   所有取名字的地方统一走这里：无桩时 window.xzName === xzName，行为一模一样。 */
function xzNameOf(e){ return (window.xzName || xzName)(e); }
function xzRole(e){
  var tag = e.tagName;
  if (tag === 'INPUT'){
    var ty = (e.type || 'text').toLowerCase();
    if (ty === 'checkbox' || ty === 'radio') return '勾选';
    return '输入';
  }
  if (tag === 'SELECT') return '下拉';
  if (tag === 'TEXTAREA') return '文本域';
  if (tag === 'A') return '链接';
  return '按钮';
}

/* ── 分区 ───────────────────────────────────────────────────────────
   元素一多，模型准头掉得厉害（行业实测 >2000 个可交互元素掉到 67%）。
   解法不是把树压得更狠，是**先给区域概览，让它选区域再展开**：
   喂给模型的永远是几十个元素，不是一个页面的全部。 */
function xzZonesOf(root){
  var out = [];
  function walk(parent, depth){
    var kids = [].slice.call(parent.children).filter(function(e){
      var r = e.getBoundingClientRect();
      if (r.height < 40 || r.width < 80) return false;
      var s = getComputedStyle(e);
      return !(s.display === 'none' || s.visibility === 'hidden');
    });
    var n = parent.querySelectorAll('button,a,input,select,textarea,[data-act]').length;
    if (depth >= 2 || n <= 40 || !kids.length){ out.push({ el:parent, n:n }); return; }
    for (var i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
  }
  walk(root, 0);
  if (!out.length) out.push({ el:root, n:0 });
  return out;
}
function xzZoneName(el, i){
  var h = el.querySelector('h1,h2,h3,h4,legend,caption');
  if (h && (h.textContent || '').trim()) return h.textContent.trim().slice(0, 16);
  var c = (el.className || '').toString().split(' ')[0];
  if (c && c !== 'main') return c;
  return '区 ' + (i + 1);
}

/* ── 可交互元素识别 ─────────────────────────────────────────────────
   抄 BrowserSkill 的 applyVomInteractionRecovery：只查 button/a/input 会漏掉一半 ——
   卡片、菜单项、筛选钮大量是 div + data-act，客户自己搭的界面更是如此。
   按三种迹象恢复：① 挂了 data-act / onclick ② tabindex>=0 ③ contenteditable */
var XZ_QUERY = 'button,a,input,select,textarea,[data-act],[role="button"],[role="link"],'
  + '[role="tab"],[role="checkbox"],[role="menuitem"],[role="radio"],[tabindex]:not([tabindex="-1"]),'
  + '[contenteditable=""],[contenteditable="true"],[onclick]';
var XZ_EVT = ['onclick','onmousedown','onkeydown','data-act','data-action'];
var XZ_NATIVE = ['BUTTON','A','INPUT','SELECT','TEXTAREA'];

function xzInteractive(e){
  if (XZ_NATIVE.indexOf(e.tagName) >= 0) return true;
  if (e.isContentEditable) return true;
  var ti = e.getAttribute('tabindex');
  if (ti !== null && parseInt(ti, 10) >= 0) return true;
  for (var i = 0; i < XZ_EVT.length; i++){
    if (e.hasAttribute(XZ_EVT[i])) return true;
  }
  return false;
}

/* ── observe：读一屏 ─────────────────────────────────────────────────
   每次 observe 都清空重打引用、推进代数。动一下之后旧引用全部作废。 */
function xzObserve(zoneIdx){
  var root = xzRoot();
  /* ★2026-10-22：判据跟着 xzDocRoot 走 —— 两边用不同的兜底，会把"在正文里"
     误判成"在读弹窗"，模型就会以为弹窗还开着。 */
  var inLayer = root !== xzDocRoot();
  var zones = inLayer ? [{ el:root, n:0 }] : xzZonesOf(root);
  var scope = (typeof zoneIdx === 'number' && zones[zoneIdx]) ? zones[zoneIdx].el : root;
  XZ_REF = [];
  XZ_GEN++;
  var els = [], all = scope.querySelectorAll(XZ_QUERY);
  /* ★2026-10-22 修（实测踩到）：观测范围是 document.body，把小智自己的浮球也算了进去 ——
     浮球是 <button data-act="xzToggle">，模型"找到入口"时索引落到它身上，点一下就把面板关了。
     结果：用户以为它跑完了，面板却消失，什么也看不到。自身 UI 必须排除在可操作集合之外。 */
  var selfHost = document.getElementById('xz-host');
  for (var i = 0; i < all.length && els.length < 60; i++){
    var e = all[i];
    if (selfHost && selfHost.contains(e)) continue;
    /* 平台侧栏不是"这个页面"的东西：点它等于跳页，不是操作当前页 */
    var _aside = null; try { _aside = e.closest ? e.closest('.sider') : null; } catch (err) { _aside = null; }
    if (_aside) continue;
    if (!xzVisible(e)) continue;
    if (!xzInteractive(e)) continue;
    var val = '';
    if (e.tagName === 'SELECT'){
      /* 下拉必须把可选项一起给它看：只给"当前值=空"，模型只能猜一个值，
         猜错就成了"说选了其实没选"。 */
      var opts = [];
      for (var q = 0; q < e.options.length && q < 12; q++){
        opts.push((e.options[q].text || '').trim());
      }
      val = (String(e.value || '') || '未选') + ' | 可选: ' + opts.join(' / ');
    } else if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA'){
      /* 密码一律打码：快照会被送去模型，不能把值带出去（抄 SENSITIVE_MASK）*/
      val = (e.type === 'password') ? '•••' : String(e.value || '').slice(0, 200);
    }
    XZ_REF.push(e);
    els.push({ i: XZ_REF.length - 1, r: xzRole(e), n: xzNameOf(e), v: val });
  }
  return {
    gen: XZ_GEN,
    scope: (typeof zoneIdx === 'number') ? zoneIdx : -1,
    layer: inLayer ? 'yes' : 'no',          /* 当前是不是在读弹窗 */
    zones: inLayer ? [{ k:0, n:'弹窗', c:els.length }]
                   : zones.map(function(z, k){ return { k:k, n:xzZoneName(z.el, k), c:z.n }; }),
    els: els
  };
}

/* ── act：执行一个原语 ───────────────────────────────────────────────
   返回 {ok, why}。失败绝不重试 —— 幻觉是随机的，重试只会换一种错法。 */

/* ★2026-10-22 第一道闸：点一个 <a href> 会把文档换掉。
   文档一换，G.xz（面板开合、对话、正在跑的循环）全部归零，用户看到的就是
   "小智把面板自己搞没了"。agent 的职责是操作**这一页**，不是替用户跳站，
   所以：会换文档的链接一律不点，如实报失败，让模型下轮换别的办法。
   同文档的 #hash 路由放行 —— 那是页内视图切换（下面 go 原语也一样）。
   返回 null 表示"可以点"，否则返回那个 href，用于说明为什么不点。 */
function xzLeavesDoc(el){
  var a = null;
  try { a = el.closest ? el.closest('a[href]') : null; } catch (e){ a = null; }
  if (!a) return null;
  var raw = a.getAttribute('href') || '';
  if (!raw || raw.charAt(0) === '#' || /^(javascript:|mailto:|tel:)/i.test(raw)) return null;
  var u;
  try { u = new URL(raw, location.href); } catch (e){ return null; }
  if (u.pathname === location.pathname && u.search === location.search) return null;
  return raw;
}

/* ── 小智动作的"是我点的"打标（data.js 的改动流水据此写 actor='小智'）─────────
   ★2026-10-28 三处修（E8b / E8a / E8c）：
   ① **嵌套**（E8b）：原来是 `window.__xzActing = 1; … finally { = 0 }`。
      一次动作里再触发一次动作（点开菜单再点菜单项、点按钮里再点一次）时，
      内层 finally 把外层也清成 0 —— 外层剩下的同步代码就被记成"你"。
      改成计数 + 保存-恢复：进栈 +1，出栈恢复成进栈前的值。嵌套两层读数 1 → 1（不再掉 0）。
   ② **异常不穿出去**（E8a）：DOM 事件处理函数里抛出的异常会被浏览器接住并报给 window，
      **不会**从 `el.click()` 冒出来 —— 所以 try/catch 拿不到，函数照样返回 {ok:true}。
      必须临时挂 window 的 error 监听（实测同步触发，见下）。
   ③ **fill / pick 也要打标**（E8c）：这两条路径原来一个字节都没打标，
      于是"填一个值"这种人改的动作用小智做完，流水里永远记成"你"。 */
function xzActingPush(){
  var prev = window.__xzActing;
  window.__xzActing = (Number(prev) || 0) + 1;
  return prev;
}
function xzActingPop(prev){ window.__xzActing = prev; }

/* 在一个"会抛错的同步动作"外面收错误：返回 {err} 或者 {err:null}。
   Chrome 里 error 事件在 click() 返回前同步触发（2026-10-28 实测：
   `b.click(); got` 当场就有 "Uncaught Error: boom"），所以这里不需要改成异步。 */
function xzCatchErrors(fn){
  var err = null;
  function onErr(ev){
    if (err) return;
    err = String((ev && (ev.message || (ev.error && ev.error.message))) || '脚本出错');
  }
  window.addEventListener('error', onErr);
  try { fn(); }
  finally { window.removeEventListener('error', onErr); }
  return err;
}
function xzAct(st){
  if (st.p === 'go'){
    /* 没给目标就设，会把 hash 写成 "#undefined"，等于制造一个假路由 */
    if (!st.v) return { ok:false, why:'没说跳到哪儿' };
    location.hash = st.v; return { ok:true };
  }
  if (st.p === 'observe') return { ok:true };   /* 只表示"想再看一眼"，不改页面 */
  /* re:1 或"要求重读"：上一步点开了菜单/弹了窗，旧索引全废。
     必须重读再按名字定位 —— 拿旧索引点，会点到别的元素上而且不报错。 */
  if (st.re && st.match){
    if (G.xzHold){ G.xzHold = 0; if (G.xzDirty){ G.xzDirty = 0; render(); } G.xzHold = 1; }
    var s2 = xzObserve();
    for (var j = 0; j < s2.els.length; j++){
      if (st.match.test(s2.els[j].n)){ st.i = s2.els[j].i; st.gi = s2.gen; break; }
    }
    if (typeof st.i !== 'number' || st.gi !== s2.gen) return { ok:false, why:'重读后没找到「' + st.match + '」' };
    st.gen = s2.gen;
  }
  var el = XZ_REF[st.i];
  if (!el || !el.isConnected || st.gen !== XZ_GEN) return { ok:false, why:'引用已失效（页面变了），需要重读' };
  try{
    if (st.p === 'click'){
      var nm = xzNameOf(el);
      /* ★2026-10-22：先拦"会换文档"的链接（见 xzLeavesDoc 注释）。
         放在不可逆闸**之前**：跳走比"点了撤不回来的按钮"更严重 ——
         前者把整个会话弄丢，后者至少还在这一页上。 */
      var jump = xzLeavesDoc(el);
      if (jump){
        return { ok:false, why:'「' + nm + '」会离开这一页（' + jump + '）—— 我只在这一页里操作，不替你跳走' };
      }
      /* G.xzGrant＝本轮已由人点卡片授权：同一轮里不再逐个停（用户 2026-10-28：
         「确认后小智就会一直操作下去了」），但只在这一轮有效，finish 即作废。 */
      if (XZ_IRREVERSIBLE.test(nm) && !st.confirm && !G.xzOnce && !G.xzGrant){
        return { ok:false, needConfirm:true, name:nm,
                 why:'「' + nm + '」是撤不回来的动作，需要你点头' };
      }
      if (G.xzOnce) G.xzOnce = 0;      /* 只放行一次，不是一直放行 */
      G.xzPendingName = '';
      /* 给小智这一次动作打个标：data.js 的改动流水据此写"谁改的"。
         它只会在这一个同步调用栈里为真 —— 人点的和它点的走同一个 handler，只能这样分。
         ★2026-10-28：改成"计数 + 保存-恢复"（E8b），并收住 handler 抛错（E8a）——
         抛错时 DOM 不会让异常从这里冒出来，所以必须听 window 的 error 事件。 */
      var prevActing = xzActingPush();
      var boom = xzCatchErrors(function () { el.click(); });
      xzActingPop(prevActing);
      if (boom) return { ok:false, why:'点了「' + nm + '」，页面报错：' + boom };
      return { ok:true };
    }
    if (st.p === 'scroll'){ el.scrollIntoView({ block:'center' }); return { ok:true }; }
    if (st.p === 'fill'){
      /* ★2026-10-28（E8c）：填值也会写 data（input/change ⇒ 自动保存 ⇒ 改动流水），
         所以要和小智点的按钮一样打标；否则"填了一个字段"永远记成"你"。
         抛错也要收：受控组件在 input 里 throw 时，异常同样不从这里冒出来。 */
      var prevFill = xzActingPush();
      var fillErr = xzCatchErrors(function () {
        el.focus(); el.value = st.v;
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
      });
      xzActingPop(prevFill);
      if (fillErr) return { ok:false, why:'填「' + st.v + '」时页面报错：' + fillErr };
      /* 填完必须回读一遍：受控组件会把你写的值改回去，
         不回读就会"以为填了其实没填"，然后一路错到底。 */
      if (String(el.value) !== String(st.v)) return { ok:false, why:'填进去又被改回去了，实际值是「' + el.value + '」' };
      return { ok:true };
    }
    if (st.p === 'pick'){
      if (el.tagName !== 'SELECT') return { ok:false, why:'这个元素不是下拉框' };
      /* 按显示文本选，不按 value —— 模型看到的是文本，option 的 value 常常是 id。
         实测踩过：模型说"选了华信证券"，下拉其实还停在"选择客户"，
         因为 value 对不上，赋了个空值，而界面不报错。 */
      var want = String(st.v == null ? '' : st.v).trim();
      var hit = null;
      for (var o = 0; o < el.options.length && !hit; o++){
        var op = el.options[o];
        if ((op.text || '').trim() === want || String(op.value) === want) hit = op;
      }
      for (var o2 = 0; o2 < el.options.length && !hit; o2++){
        if (want && (el.options[o2].text || '').indexOf(want) >= 0) hit = el.options[o2];
      }
      if (!hit){
        var names = [];
        for (var o3 = 0; o3 < el.options.length && names.length < 8; o3++) names.push(el.options[o3].text.trim());
        return { ok:false, why:'下拉里没有「' + want + '」，可选项是：' + names.join(' / ') };
      }
      el.value = hit.value;
      /* ★2026-10-28（E8c）：下拉的 change 同样会触发保存/流水，和 fill 一样打标。 */
      var prevPick = xzActingPush();
      var pickErr = xzCatchErrors(function () {
        el.dispatchEvent(new Event('change', { bubbles:true }));
      });
      xzActingPop(prevPick);
      if (pickErr) return { ok:false, why:'选「' + want + '」时页面报错：' + pickErr };
      /* 命令 + 校验：改完回读，不假设成功 */
      if (el.value !== hit.value) return { ok:false, why:'选了「' + want + '」但没生效' };
      return { ok:true };
    }
    return { ok:false, why:'不认识的动作：' + st.p };
  }catch(e){ return { ok:false, why:e.message }; }
}

/* ── 等页面稳定 ─────────────────────────────────────────────────────
   点完之后页面会重绘、可能弹窗、可能发请求。不等稳定就接着读，
   读到的是半截页面 —— 这是"点了没反应"最主要的来源。 */
function xzSig(){
  var r = xzRoot();
  return [location.hash, r.querySelectorAll('*').length, xzCoverLayer() ? 'L' : 'P'].join('|');
}
function xzWaitStable(cb){
  var t0 = xzNow(), prev = xzSig(), same = 0;
  (function tick(){
    var now = xzSig();
    if (now === prev) same++; else { same = 0; prev = now; }
    /* 连续两次签名一样就算稳；封顶 settle 毫秒，不能无限等 */
    if (same >= 2 || (xzNow() - t0) > XZ_CFG.settle) return cb();
    setTimeout(tick, 50);
  })();
}

/* ── 页面上"看得见的事实" ──────────────────────────────────────────
   规划要基于这些真实读数，不是基于我给它的假设。 */
function xzFacts(){
  var root = xzRoot();
  var cards = [];
  var cs = root.querySelectorAll('.pcard, .card, tr');
  for (var i = 0; i < cs.length && cards.length < 40; i++){
    if (!xzVisible(cs[i])) continue;
    cards.push((cs[i].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80));
  }
  return { cards: cards, here: here(), layer: xzInLayer() };
}

/* ── 本地规划器（没有模型时兜底，调试用）─────────────────────────────
   它读的是快照和事实，不是预置答案。找不到就说找不到，绝不编一个动作出来。 */
function xzPlan(intent, snap, facts){
  var S = intent;
  var els = snap.els;
  /* ★2026-11-06（用户原话：『我去跟小智说帮我生成一个页面，然后小智去模拟人的操作，
     输入文字到对话框再点发送』）：这一页真有配置对话框时，小智不自己动 DOM 改页面，
     而是像人一样用这条框 —— 把话写进输入框、再点发送，让配置页那条通道去生成。
     只认最窄的一类话（生成/搭/做一个页面），避免抢掉本该点业务控件的指令。 */
  var fkIn = null, fkSend = null;
  try {
    fkIn = document.querySelector('#fk-input');
    fkSend = document.querySelector('#fk-send');
  } catch (e) { fkIn = null; fkSend = null; }
  if (fkIn && fkSend && /(生成|搭|做|画|建)一?[个版套]?页面|生成一版|帮我生成/.test(S)){
    /* ★2026-11-06 实测（8941 真浏览器）：同一条指令会被这条路径送进对话框 3 次 ——
       计划在"本地规则 → 模型失败 → 回退本地规则"这条链上会被执行不止一遍。
       对着真模型这等于重复下单：一次点击生成三版。所以加一道闸：
       同一句话 6 秒内只发一次，第二次开始只回话、不再动手。 */
    var K = '__xzFkSent';
    var now = Date.now();
    try {
      var prev = window[K] || { t:0, s:'' };
      if (prev.s === S && now - prev.t < 6000){
        return {
          say: '这句我刚替你发过一次了，等它跑完再看画布。',
          stages: [{ t:'没重复发', steps:['同一句话 6 秒内只发一次'] }]
        };
      }
      window[K] = { t:now, s:S };
    } catch (e) {}
    return {
      say: '这句我不自己改页面 —— 我把它放进下面那条对话框，再替你点发送。',
      stages: [
        { t:'在对话框里说', steps:['「' + S + '」'] },
        { t:'点发送', steps:['等它生成完，画布会变'] }
      ],
      acts: [
        { p:'fill',  match:/请输入你的想法|说要改什么/, v:S, re:1, gen:snap.gen },
        /* 填完必须重读再找发送钮：填值会让浮条重绘一遍，旧索引当场作废。
           不写 re:1 的话这一刀会拿 undefined 索引去点，直接报「引用已失效」。 */
        { p:'click', match:/发送/, re:1, gen:snap.gen }
      ]
    };
  }
  function find(re, role){
    for (var i = 0; i < els.length; i++){
      if (role && els[i].r !== role) continue;
      if (re.test(els[i].n)) return els[i];
    }
    return null;
  }
  function cardLike(re){ return facts.cards.filter(function(c){ return re.test(c); }); }

  if (/没授权|未授权|还没给|没配客户/.test(S)){
    var hit = cardLike(/未配置客户|未授权|0 家/);
    var st0 = [{ t:'读页面', steps:['扫过 ' + facts.cards.length + ' 条记录'] }];
    if (hit.length){
      st0.push({ t:'结果', steps:hit.map(function(c){ return c.slice(0, 40); }) });
      return { say:'有 ' + hit.length + ' 套还没给任何客户。', stages:st0 };
    }
    st0.push({ t:'结果', steps:['没找到未授权的记录'] });
    return { say:'这一页上所有记录都配过客户了。', stages:st0 };
  }
  if (/筛|过滤|只看/.test(S)){
    var clear = find(/清除筛选|重置|清空/);
    var chips = els.filter(function(e){
      return e.r === '按钮' && /^(全部|已上架|未上架|内测中|金融|制造业|证券|产业|制造|其他)$/.test(e.n);
    });
    var want = /制造业|产业/.test(S) ? /制造|产业/
             : (/金融/.test(S) ? /金融/ : (/证券/.test(S) ? /证券/ : (/未上架|内测/.test(S) ? /未上架|内测/ : null)));
    if (want){
      var pref = chips.filter(function(c){ return want.test(c.n); });
      chips = pref.length ? pref : [];
    }
    chips = chips.slice(0, 2);
    var acts = [];
    if (/清空|清除|重置|全部/.test(S) && clear) acts.push({ p:'click', i:clear.i, gen:snap.gen });
    chips.forEach(function(c){ acts.push({ p:'click', i:c.i, gen:snap.gen }); });
    if (!acts.length){
      return { say:'这一页我没有找到能筛的东西 —— 快照里 ' + els.length + ' 个元素，没有筛选控件。',
        stages:[{ t:'读页面', steps:['没找到「清除筛选」或筛选钮'] }] };
    }
    var desc = [];
    if (clear && acts.length) desc.push('「' + clear.n + '」');
    chips.forEach(function(c){ desc.push('「' + c.n + '」'); });
    return { say:'这一页的筛选是 ' + desc.length + ' 个按钮，我按你说的点。',
      stages:[{ t:'点筛选', steps:desc }], acts: acts };
  }
  if (/授权|复制给|给哪家客户/.test(S)){
    var more = find(/更多操作|更多|⋮/);
    var direct = find(/客户配置/);
    var stages = [{ t:'读页面', steps:['当前在 ' + facts.here + '，可操作元素 ' + els.length + ' 个'] }];
    var a2 = [];
    if (direct){ a2.push({ p:'click', i:direct.i, gen:snap.gen }); stages.push({ t:'进入客户配置', steps:['点击「客户配置」'] }); }
    else if (more){
      a2.push({ p:'click', i:more.i, gen:snap.gen });
      a2.push({ p:'click', match:/客户配置/, re:1 });
      stages.push({ t:'进入客户配置', steps:['点开「更多操作」菜单', '菜单里选「客户配置」（重读页面再定位）'] });
    }
    if (!a2.length){
      stages.push({ t:'停在这里', stop:true, steps:[{ t:'这一页没找到客户配置入口', done:false }] });
      return { say:'我没找到进客户配置的入口。', stages:stages };
    }
    stages.push({ t:'停在这里', stop:true, steps:[{ t:'授权会把母版复制一份到客户租户，这一步我不替你点', done:false }] });
    return { say:'我把入口找到并点进去，到"授权"那一下停住 —— 它会复制一份，撤不回来。', stages:stages, acts:a2 };
  }
  if (/找|筛出|推荐|有没有|开箱即用|能用的/.test(S)){
    var got = facts.cards;
    var st2 = [{ t:'读页面', steps:['当前 ' + facts.cards.length + ' 条可选'] }];
    if (got.length){
      st2.push({ t:'挑出来', steps:got.slice(0, 3).map(function(c){ return c.slice(0, 40); }) });
      return { say:'按你说的，这几套对得上。', stages:st2 };
    }
    st2.push({ t:'结果', steps:['没对上'] });
    return { say:'这一页没有对得上的。', stages:st2 };
  }
  /* ★2026-10-22 加：兜底里最有用的一条 —— 你说的话里出现了某个控件的名字，我就点它。
     加之前，兜底只会列一遍"这一页有 N 个地方可点"，等于把活又推回给人；
     而"名字对上就点"这条规则是零耦合的：名字是当场从快照里读的，
     以后加页面、加按钮都不用改这里，也不会把某个页面的业务词写死进规划器。
     比对前先去掉尾部的序号 —— 快照里叫「装配组件3」（3 是已装数量），人不会说那个 3。 */
  var said = String(S || '').replace(/\s/g, '');
  var hitEl = null;
  for (var q = 0; q < els.length; q++){
    var core = String(els[q].n || '').replace(/[0-9]+$/, '').replace(/\s/g, '');
    if (core.length < 2) continue;
    if (said.indexOf(core) < 0) continue;
    if (!hitEl || core.length > hitEl.core.length) hitEl = { el: els[q], core: core };
  }
  if (hitEl){
    return {
      say:'好，我点「' + hitEl.el.n + '」。',
      stages:[{ t:'点一下', steps:['「' + hitEl.el.n + '」'] }],
      acts:[{ p:'click', i:hitEl.el.i, gen:snap.gen }]
    };
  }

  var brief = els.slice(0, 5).map(function(e){ return e.r + '「' + e.n + '」'; });
  return {
    say:'这一页我能动的有 ' + els.length + ' 个地方。你说具体要做什么，我来点。',
    stages:[{ t:'读页面', steps:brief.length ? brief : ['这一页没有可操作元素'] }]
  };
}

/* ── 术语表（数据，不是代码）───────────────────────────────────────
   ★ 这是"加页面不用改代码"的那一层，也是模型最容易卡住的地方。
   实测过：模型会找"授权"这两个字，菜单里叫"客户配置"它就找不着，于是每轮重开菜单打转。
   所以把业务说法喂给它。加页面/加菜单只往这里加一条文本，不动任何逻辑。
   注意：这是说明，不是规则 —— 它不限制模型怎么走，只是让它认得这些词。 */
var XZ_TERMS = [
 ['资产中心','包含能力管理和模版管理。'],
 ['能力管理','本版维护接口能力。'],
 ['模版管理','导入、预览和更新模版文件包。更新不联动已生成应用。'],
 ['可用资产','已授权的能力和模版清单，个人开关控制模型可用性。'],
 ['保存草稿','保存本应用的编辑内容，不发布。'],
 ['保存并发布','保存应用自己的新版本，客户授权版本仍由授权流程管理。']
];

/* ── 模型通道 ───────────────────────────────────────────────────────
   同源 POST /xz/plan，服务端带 key 转发。前端拿不到密钥。 */
function xzSystemPrompt(snap, facts){
  return '你是页面操作助手。组件库和装配功能已退役，不得选择旧组件、装配或组件升级操作。本版只有接口能力与模版资产；Skill暂不提供。模版仅作生成参考，后续改动不联动应用。\n'+(window.CAP && CAP.catalog ? '当前身份的可用资产目录：'+JSON.stringify(CAP.discoverCandidates ? CAP.discoverCandidates(document.querySelector('#xz-input') ? document.querySelector('#xz-input').value : '',20) : [])+'\n' : '')+'你只能使用这些原语：\n' + JSON.stringify(XZ_PRIMS)
    + '\n当前页面语义快照（i 是元素索引，n 是名字，r 是角色，v 是当前值）：\n'
    + JSON.stringify({ where: facts.here, inDialog: facts.layer, zones: snap.zones, els: snap.els })
    + '\n页面上的记录：' + JSON.stringify(facts.cards.slice(0, 12))
    + '\n这个系统的叫法（重要，别按字面找）：\n' + JSON.stringify(XZ_TERMS)
    + (XZ_HIST.length ? '\n你和用户之前的对话（可能是省略句的指代来源）：\n' + JSON.stringify(XZ_HIST.slice(-XZ_HIST_MAX).map(function(m){return (m.role==='user'?'用户：':'你：')+String(m.content).slice(0,80);})) : '')
    + (G.xzGrant ? '\n★用户刚点了「确认执行」，本轮已授权：这个动作可以直接做，不要再停下问；但**页面自己弹出的确认框里的最终按钮不要替用户点**（实测模型会在这两个按钮之间来回打转），停在那里如实报告"到确认框了"；也不要计划"关掉这个弹窗"。' : '')
    + '\n规则：'
    + '① 一次尽量多规划几步，能连着做的别拆开问；'
    + '② 不要编造快照里没有的元素，索引只能用上面出现过的；'
    + '③ 撤不回来的动作（最终提交、发布生效、删除、下线）前面要停，在 stages 里加 {"t":"停在这里","stop":true}。'
    + '但**只打开菜单、查看内容、展开弹窗这些不算，不要加 stop** —— 一旦加了，任务就终止，不会再有下一轮；'
    + '④ 不确定就用 observe 看一眼再决定；'
    + '⑤ 事情已经做完、不需要再动页面时，acts 给空数组；'
    + '⑥ 如果上一轮已经打开了菜单但还没点进去，这一轮就直接点进去，不要重复打开菜单；'
    + '⑦ **用户要的是结果，不是穷举。** 拿到足以回答他的信息就停（acts 给空数组并在 say 里说结论），'
    + '不要为了"再确认一下"逐个核对同类项；'
    + '⑧ 同一页面上同一种操作不要超过 2 次，第 3 次就该停下来把情况告诉用户。'
    + '⑨ **「把某个应用授权给某客户」这类任务，三件事做完才算到终点**：'
    + '打开客户配置 → 在「选择客户」下拉里真的选中那个客户（用 pick，不是只看选项）→ 停在「授权并复制」按钮前。'
    + '只打开弹窗、只读取下拉有哪些选项，都**不算做到** —— 这时候 acts 不许给空数组。'
    + '只输出 JSON，不要任何解释：'
    + '{"say":"一句话说明你要做什么","stages":[{"t":"阶段名","steps":["做什么"]}],'
    + '"acts":[{"p":"click","i":3},{"p":"observe"}]}'
    /* ★2026-10-22 输出越短，被截断的概率越低：模型是推理模型，reasoning 先花 token，
       正文一旦拖长就会被截在半截 JSON 上（实测 "Expected ',' or ']'"）。
       这里压的是**形状**，不是语气 —— 文案风格一个字没动。
       另外明确要求"前后不要写字"：它一写 ```json 或"好的，我这就……"，
       JSON 就得靠 xzParsePlan 去猜边界。 */
    + '\n输出格式（必须严格遵守，越短越好）：'
    + '① 只输出一个 JSON 对象，前后不许有任何字（不要 ```json 围栏、不要解释、不要空行）；'
    + '② stages 最多 2 个，每个 stages[].steps 最多 2 条，每条不超过 20 字；'
    + '③ acts 里每个对象只写这几个键：p / i / v，不要写别的字段，不要写注释；'
    + '④ say 一句话，不超过 40 字；'
    + '⑤ 字符串里不要出现换行和英文双引号（要引号就用「」）。';
}

/* 兜模型的坏输出（抄 page-agent 的 autoFixer）：
   JSON 可能被包在解释文字里、可能带尾随逗号、可能被截断、可能给了快照里没有的索引。
   稳定不是靠 prompt 求它别错，是错了也能收拾。

   ★2026-10-22 实测补的三种坏法（原来只会补尾部括号，前两种直接报 "Expected ',' or ']'"）：
     ① **漏逗号**：[{...} {...}] / ["a" "b"] —— 推理模型偶尔把逗号吃掉；
     ② **截断**：正文在 acts 数组中间断掉，连右括号都没有。
        原来只按"计数差"补尾部括号，一旦截断点落在某个字符串或半个对象里，
        补出来的还是坏 JSON，整段丢弃 —— 于是这一轮什么也没做。
        现在：按**括号栈**补（真的知道缺的是 ] 还是 }），并且解析不了就
        从尾部往前一个逗号一个逗号地退，退到"最后一个完整元素"再补括号重试。
        退到只剩 say 也能成 —— 至少有话说，不至于整轮空转。
   注意这只修**结构**，不修内容：索引越界照样由 xzParsePlan 丢掉。 */

/* 按括号栈把没闭合的字符串/对象/数组补齐（顺序是 LIFO，天然对） */
function xzCloseJson(t){
  var stack = [], inStr = false, esc = false;
  for (var i = 0; i < t.length; i++){
    var c = t[i];
    if (esc){ esc = false; continue; }
    if (c === '\\'){ esc = true; continue; }
    if (inStr){
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"'){ inStr = true; continue; }
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']'){
      if (stack.length) stack.pop();
    }
  }
  if (inStr) t += '"';
  while (stack.length) t += (stack.pop() === '{' ? '}' : ']');
  return t;
}
/* 结构性的小毛病：尾随逗号、元素之间漏逗号。
   必须逐字符扫、认字符串边界 —— 用正则会误伤内容：
   say 里写「点了 } 之后」这种文案时，} 后面的空格 + 引号会被当成漏逗号，
   在**字符串内部**插进一个逗号，把好好的 JSON 改坏。
   （这一版是踩过的：第一版用正则，`({}|])\s*(?=["{[])` 会把文案改烂。） */
function xzFixPunct(t){
  var out = '', inStr = false, esc = false;
  function afterValue(k){            /* 从 k 起跳过空白，返回下一个非空白字符 */
    while (k < t.length && /\s/.test(t.charAt(k))) k++;
    return { k: k, c: k < t.length ? t.charAt(k) : '' };
  }
  for (var i = 0; i < t.length; i++){
    var c = t.charAt(i);
    if (inStr){
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"'){
        inStr = false;
        /* 值结束后直接跟下一个值：["a" "b"] / {"k":"v" "k2":1} */
        var nx1 = afterValue(i + 1);
        if (nx1.c === '"') out += ',';
      }
      continue;
    }
    if (c === '"'){ inStr = true; out += c; continue; }
    if (c === ','){                  /* 尾随逗号：后面只有空白再跟闭合符 → 丢掉这个逗号 */
      var nx2 = afterValue(i + 1);
      if (nx2.c === '}' || nx2.c === ']') continue;
      out += c; continue;
    }
    if (c === '}' || c === ']'){     /* 值结束后直接跟下一个值/键：[{..} {..}] */
      out += c;
      var nx3 = afterValue(i + 1);
      if ((nx3.c === '{' || nx3.c === '[' || nx3.c === '"') && nx3.k > i + 1) out += ',';
      continue;
    }
    out += c;
  }
  return out;
}
/* 从尾部退一个逗号再补括号重试 —— 截断时"尽量保留最后一个完整元素" */
function xzRepairJson(s){
  var base = xzFixPunct(s);
  var tries = 0;
  var cur = base;
  while (tries < 40){
    try { return JSON.parse(xzCloseJson(cur)); } catch (e){}
    /* 退到上一个逗号（字符串里的逗号不算） */
    var cut = -1, inStr = false, esc = false;
    for (var i = cur.length - 1; i >= 0; i--){
      var c = cur.charAt(i);
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === '"'){ inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === ','){ cut = i; break; }
    }
    if (cut < 0) break;
    /* 再把 "key": 这种悬空的尾巴一起切掉 */
    cur = cur.slice(0, cut).replace(/[{\[,]\s*$/, '');
    tries++;
  }
  /* 最后一路：只要 say 能捞出来就给一个"只说话不动手"的计划 */
  var say = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (say){
    try { return { say: JSON.parse('"' + say[1] + '"'), stages: [], acts: [] }; } catch (e){}
  }
  return null;
}
function xzParsePlan(txt, snap){
  if (!txt) throw new Error('模型没返回内容');
  var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  /* 截断的输出可能一个 } 都没有：这时别丢，交给 xzRepairJson 补 */
  var raw = (a < 0) ? txt : (b > a ? txt.slice(a, b + 1) : txt.slice(a));
  var plan = null, e1 = null;
  try{ plan = JSON.parse(raw); }
  catch(err){
    e1 = err;
    plan = xzRepairJson(raw);
    if (!plan){
      /* 细节留给开发者看控制台；面板上只给人话（见 step 里的 m.err） */
      var bad = new Error('模型输出不是合法 JSON');
      bad.code = 'parse';
      bad.detail = (e1 && e1.message) + ' ｜ 原始输出：' + raw.slice(0, 300);
      throw bad;
    }
  }
  if (!plan || typeof plan !== 'object') {
    var bad2 = new Error('模型给的不是一个对象');
    bad2.code = 'parse';
    bad2.detail = raw.slice(0, 300);
    throw bad2;
  }
  if (!plan.say) plan.say = '按你说的走。';
  if (!plan.stages || !plan.stages.length) plan.stages = [];
  if (!plan.acts) plan.acts = [];
  var names = XZ_PRIMS.map(function(p){ return p.n; });
  plan.acts = plan.acts.filter(function(x){
    if (!x || names.indexOf(x.p) < 0) return false;
    /* 索引越界的一律丢掉：模型编一个不存在的 i，点下去就是点错东西 */
    if (x.p !== 'go' && x.p !== 'observe' && typeof x.i === 'number' && x.i >= snap.els.length) return false;
    return true;
  });
  return plan;
}
/* ── 会话历史：让"再加一列""把它改成红色"这类省略句能落地 ──────────
 * ★ 2026-10-23 补的缺口：原来每次请求只带 system + 当次这句话，
 *   模型完全不知道上一轮说了什么。表现是——用户说"再加一列"，
 *   它反问"给哪个表加"；说"改成红色"，它不知道"它"是什么。
 *   这不叫"模型笨"，叫**没给它上下文**。
 * 只带最近 3 轮、且只带 say 摘要不带完整 acts（acts 里的索引下一轮就失效了，
 * 带进去会让模型引用已经变了的元素）。
 */
var XZ_HIST = [];
var XZ_HIST_MAX = 6;   /* 3 轮 = 6 条 */

/* 当前在飞的规划请求。两个用途：停止键真能把它掐掉；超时后不留一个孤儿请求。
   ★2026-10-24：原来 fetch 没有 signal、没有超时 —— 服务端不回话，面板就永远停在
   「正在读这一页…」，既没有已等秒数，也没有重试入口。DESIGN.md:418 自己写着
   「超过 3 秒报已等 N 秒」，此处原本一条都没实现。 */
var XZ_REQ = null;
var XZ_REQ_ID = null;
function xzAbortReq(){
  if (XZ_REQ && XZ_REQ.abort){ try { XZ_REQ.abort(); } catch (e) {} }
  if(XZ_REQ_ID){fetch('/xz/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:XZ_REQ_ID}),keepalive:true}).catch(function(){});XZ_REQ_ID=null;}
  XZ_REQ = null;
}
function xzPlanModel(intent, snap, facts){
  xzAbortReq();
  XZ_REQ_ID='xz-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  var ctl = null, timer = null;
  try { ctl = new AbortController(); XZ_REQ = ctl; } catch (e) { ctl = null; }
  var opt = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id:XZ_REQ_ID,
      messages: [
        { role:'system', content: xzSystemPrompt(snap, facts) },
        ...XZ_HIST.slice(-XZ_HIST_MAX),
        { role:'user', content: intent }
      ],
      temperature: XZ_CFG.temp,
      max_tokens: XZ_CFG.maxTokens
    })
  };
  if (ctl) opt.signal = ctl.signal;
  var req = fetch(XZ_CFG.endpoint, opt).then(function(r){
    /* ★2026-10-22 发布用：静态托管环境没有 /xz/plan 这个转发接口，
       它会把请求打到 404 页并回一段 HTML，于是 r.json() 抛出
       "Unexpected token '<'，界面显示成"模型没接上（Unexpected token）"——用户看不懂。
       这里先看内容类型：不是 JSON 就当成"这个环境没有模型"，给一句话说清。 */
    var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (ct.indexOf('json') < 0) {
      var e2 = new Error('这轮没连上规划服务，先按内置规则走');
      e2.code = 'offline';
      throw e2;
    }
    return r.json().then(function(j){
      if (!r.ok || j.error) throw new Error((j && (j.error + ' ' + (j.detail || ''))) || ('HTTP ' + r.status));
      return j;
    });
  }).then(function(j){
    var plan = xzParsePlan(j.text, snap);
    plan._ms = j.ms;
    /* 只记"说过的话"，不记 acts：动作里的元素索引下一轮就失效了 */
    XZ_HIST.push({ role: 'user', content: intent });
    XZ_HIST.push({ role: 'assistant', content: plan.say || '（做了）' });
    return plan;
  });
  /* 15 秒硬超时：宁可说"没等到"，也不能让一句话永远挂着。
     超时先 abort 再抛 —— 不 abort 的话那个请求还活着，下一次点发送会并发两条。 */
  return new Promise(function(resolve, reject){
    timer = setTimeout(function(){
      xzAbortReq();
      var e = new Error('等了 15 秒没有回音');
      e.code = 'timeout';
      reject(e);
    }, 15000);
    req.then(function(v){ clearTimeout(timer); XZ_REQ = null; resolve(v); },
             function(e){ clearTimeout(timer); XZ_REQ = null; reject(e); });
  });
}

/* ── "它说的是做了，还是只是看了一眼"───────────────────────────────
   ★2026-10-22 假成功：模型 stages 里写「定位入口 / 读取当前页面结构，找到 ⋮ 更多操作」，
     acts 给空数组 —— 一次 el.click() 都没发生，面板却报「做完了 · 动了 0 下」。
     这比报错更糟：人以为改完了，页面一动没动。
   判据只取模型自己写的那几句话（阶段名 + 步骤），不猜：
     · 出现动作词（点/打开/进入/填/选中/定位/展开/提交/授权…）＝它声称自己动了手
     · 停在这里的阶段不算（那是在等你，没声称做完）
     · 「结果 / 读页面 / 扫过 N 条 / 挑出来」这类汇报读数的话不含动作词，
       所以纯问答（比如"找出还没授权客户的应用"，本来就不该有动作）不会被误判成失败。 */
var XZ_ACT_WORD = /(点击|点一下|点开|单击|打开|进入|填入|填写|选中|选择|定位|展开|滚动|跳到|切换|提交|保存|授权|复制|勾选)/;
function xzClaimedAction(stages){
  for (var i = 0; i < stages.length; i++){
    var s = stages[i];
    if (!s || s.stop) continue;
    if (s.t && XZ_ACT_WORD.test(s.t)) return true;
    for (var j = 0; j < (s.steps || []).length; j++){
      var t = (s.steps[j] && s.steps[j].t) ? s.steps[j].t : '';
      if (XZ_ACT_WORD.test(t)) return true;
    }
  }
  return false;
}

/* ── run：主循环（多轮）──────────────────────────────────────────────
   一轮 = 读页面 → 规划 → 执行一批 → 等稳定 → 再看一眼。
   为什么不一轮干完：点了会弹窗、会跳页、会出新数据，一口气规划的后面几步
   在第一步做完之后就失效了 —— 那正是"跑到第三步开始乱点"的来源。 */
function xzRun(intent, list){
  var t0 = xzNow();
  list.push({ who:'me', text:intent });
  xzHistTouch();
  /* ask＝这一轮的原话，「再说一次」重跑的就是它；plan＝这一轮声明的步骤（与阶段打勾同一批对象）。 */
  var m = { who:'xz', text:'正在读这一页…', stages:[], foot:'', err:'', ask:intent,
            plan:null, fail:'', suspect:'', userIrrev: XZ_USER_IRREV.test(intent) };
  list.push(m);
  xzHistTouch();
  G.xzBusy = 1;
  xzPaint();
  /* ★2026-10-24：等的时候要让人知道"还在等、等了多久"。
     原来这句永远停在「正在读这一页…」，模型慢一点，人只能怀疑它死了。
     3 秒起把秒数接在句尾，1 秒一跳。 */
  var waitT0 = xzNow();
  var waitTick = setInterval(function(){
    if (stopped) return;
    var s = Math.floor((xzNow() - waitT0) / 1000);
    if (s < 3) return;
    m.text = '正在读这一页…（已等 ' + s + ' 秒）';
    xzPaint();
  }, 1000);
  /* 接管信号：从这一刻起页面上有东西在动，任务结束才关 */
  G.xzAbort = 0;
  xzOp(1);

  var turn = 0, actsTotal = 0, msTotal = 0, stopped = false;
  /* 防打转：连着几轮做同一件事、页面也没变化，就停下来。
     实测踩过：客户端说"筛制造业"，模型连续 10 轮点同一个「产业」按钮，
     每轮页面都没变 —— 40 步上限是兜底，但走到第 40 步之前人已经疯了。 */
  var prevSig = '', sameTurns = 0;
  /* ★2026-10-24（用户：「把做成功的事报成失败」）：开跑时的业务签名。
     没有它就只能判"最近两轮没变化"，判不出"整轮到底变过没有" ——
     实测：让它筛「只看已上架的组件」，第 1 轮页面 total 已经从 18 变 6，
     后面模型重复同一个动作、签名不动，于是 giveup 报了「结果一条没变」。
     有了 sigStart 才能说清：变过 ⇒ 不能报没做成；一次没变 ⇒ 才叫没做成。 */
  var sigStart = '', sig0Cards = -1;

  /* ok === false 表示被人按了停止；其余情况按现场状态推断结果类型。 */
  function finish(ok, hint){
    if (stopped) return;
    stopped = true;
    /* 授权过、也确实动了手、最后一轮停在页面自己的确认框上（模型此时常给空 acts）：
       这不是"做完了"，是"交到你手上"。记下来，等 kind 算完再改口径。 */
    var wasGranted = !!G.xzGrant;
    G.xzGrant = 0;          /* 授权只覆盖这一轮任务，做完即作废 */
    /* ★2026-10-28（复验打回）：模型按 prompt 规则③"在 stages 里停手"时 acts 是空的，
       闸没东西可拦 ⇒ 用户看到的是"没做成"，不是一张等授权的卡。
       这里把"它自己说要停 + 一个动作都没做"翻译成授权卡。 */
    if ((m.hasStop || m.userIrrev) && !m.pending && !m.err && actsTotal === 0 && !G.xzOnce && !G.xzGrant){
      /* 两种都算"它在等授权"：①它自己说停手；②用户要的是撤不回来的结果、
         它这一轮却一个动作没做（截图实测：让它发布，它只"读弹窗内容"就报"做完了"）。 */
      m.pending = '刚才停下的那一步';
      m.pendingGeneric = 1;
    }
    clearInterval(waitTick);
    /* 兜底：任何异常路径（出错/被停止）都要把面板放回来，不能让界面一直收着 */
    document.body.classList.remove('xz-acting');
    /* 兜底：任何漏掉的探针都在这里结账，不能让一条动作永远停在 changed:null */
    xzProbeClose();
    xzSpot(0);
    /* 被停止要排在最前：中途按停时，手上那个动作常常会跟着报错，
       按 m.err 判就会显示成'没做成' —— 人明明是自己叫停的，不能算失败。 */
    m.kind = G.xzAbort ? 'stop'
           : hint === 'giveup' ? 'fail'        /* 没进展 = 没做成，不能算 done */
           : ok === false ? 'stop'
           : (hint === 'wait' || m.pending) ? 'wait'
           : m.err ? 'fail'
           : 'done';
    /* ★2026-10-22：一个动作都没执行，就不是"做完了"（假成功）。
       原来这里会显示「做完了 · 动了 0 下」—— 人以为改完了，页面一动没动。
       现在按失败收，并把话说清楚。注意不是"actsTotal 为 0 一律失败"：
       纯问答本来就没有动作，那样会把对的判成错的（见 xzClaimedAction）。 */
    if (m.kind === 'done' && actsTotal === 0 && xzClaimedAction(m.stages)){
      m.kind = 'fail';
      m.text = '这一页没有我能动的入口 —— 模型说它做完了，但实际一个动作都没执行';
    }
    /* ★2026-10-28（盲审打回）：必须按"框还开着没有"判，不能只看"授权过+动过手"。
       上一版无条件改口径，结果它其实已经替用户点了两次「保存 v4」（v3→v6），
       界面还写"最后一下归你"——文案与执行记录正面对撞。
       ★2026-10-28（跨页误报）：这里原来判通用的 `.nf-mask`，把「新建应用」
       「新增组件」这类表单也算成确认框。判据收窄到 confirm.js 自己的框，
       见上面 xzPageConfirmOpen 的注释（实测表在 开发-跨页弹层判据-20261028.md）。 */
    if (m.kind === 'done' && wasGranted && actsTotal > 0 && xzPageConfirmOpen()){
      m.kind = 'wait';
      m.text = '停在页面自己的确认框了，最后一下归你。';
    }
    if (m.kind === 'stop') m.text = '好，我停下了。';
    if (hint === 'giveup') m.text = '没做成 —— 连着几轮点下来，页面上的结果一条没变，我停下来不硬试了。';
    /* ★2026-10-24：整轮真变过的收尾。既不许说"没做成"（与事实相反），
       也不许说"全部做完"（后面几轮确实没推进）—— 说清"变了多少、停在哪"。 */
    if (hint === 'settled'){
      m.kind = 'done';
      m.text = '按你说的做完了：记录从 ' + sig0Cards + ' 条变成 ' + m.settledCards + ' 条，'
             + '后面几轮页面没有新变化，我就停在这儿。';
    }
    /* ── 失败分三类（2026-10-28）────────────────────────────────────
       "没做成"太钝：超时是再试一次的事，页面变了是你得看一眼的事，
       没听懂是换个说法的事。分类**只认关键词**（见 xzFailClass），
       不把模型原文往卡片上贴；卡片的字是固定的人话。 */
    m.hint = hint || '';
    if (m.kind === 'fail') m.fail = xzFailClass(m); else m.fail = '';
    /* 收尾自动收起计划清单：执行中它是"现在第几步"的唯一落点；结束后正文的阶段
       已经是一份带勾的记录，再把同一批步骤摊在顶上就是同一件事说两遍（实测截图里
       「核对结果」连着出现两次，像坏了）。用户自己动过折叠钮就不替他决定。 */
    if (m.plan && !m.plan.touched) m.plan.open = false;
    G.xzBusy = 0;
    /* 只说人关心的：花了多久、动了几下。轮次和模型耗时是内部指标，不往面板上放。
       ★2026-10-22：一下没动的时候不许写"动了 0 下" —— 那是内部计数的口气，
       人要读的是"它到底碰没碰页面"。 */
    var secs = ((xzNow() - t0) / 1000).toFixed(1);
    m.foot = (hint === 'settled')
      ? '用了 ' + secs + ' 秒 · 动了 ' + actsTotal + ' 下 · 记录 ' + sig0Cards + ' → ' + m.settledCards + ' 条'
      : (hint === 'giveup')
      ? '用了 ' + secs + ' 秒 · 点了 ' + actsTotal + ' 下，但结果没变'
      : (actsTotal > 0)
        ? '用了 ' + secs + ' 秒 · 动了 ' + actsTotal + ' 下'
        : '用了 ' + secs + ' 秒 · 没有动页面';
    /* ★2026-10-22：发生过"报没做成但页面变了"的事故时，底下这句不能还写
       "没有动页面" —— 它和事故块自己说的"实际状态：已经变了"正面对撞，
       读屏播报也会跟着说错。事故优先，措辞让位。 */
    if (m.incidents && m.incidents.length){
      m.foot = '用了 ' + secs + ' 秒 · 有 ' + m.incidents.length + ' 次操作没报成功，但页面已经变了（见上）';
    }
    /* 停在授权卡上时「没有动页面」是实情，但会被读成失败 —— 这一行只在等确认时换说法。 */
    if (m.pending) m.foot = '用了 ' + secs + ' 秒 · 等你的确认';
    /* ★2026-10-22：收尾记一条，门禁拿它和面板文案对照 —— 两边一致才算真的，
       只信文案就会"文案写对判据就绿"（见 xzLogPush 的注释）。 */
    xzLogPush({ ev:'finish', kind: m.kind, actsTotal: actsTotal, err: m.err || '', secs: secs });
    /* 底部胶囊在完成时换成"做完了"再退场，别一声不响地消失 ——
       否则人只会觉得"它不亮了"，不会觉得"它做完了"。 */
    if (m.kind === 'done') xzOpDone(); else xzOp(0);
    /* 未读标记统一走 xzMarkUnread（徽标 + 浮球 aria-label 一起改）。
       ★2026-10-22 优先级：事故 > 有新结果。
       实测踩过：事故处理器先把原因写成「有一件事等你确认」，紧接着 finish() 又用
       「有新结果」覆盖回去 —— 徽标在，但读屏听到的是"有新结果"，
       而人根本不知道那是"请你确认"。所以事故在场时一律用事故口径，且面板开着也挂。 */
    var hasInc = !!(m.incidents && m.incidents.length);
    if (hasInc || !xzState().open){
      xzMarkUnread(hasInc ? '有一件事等你确认' : '有新结果');
    }
    xzPaint();
    /* ★2026-10-22：finish 里的 xzPaint() 会**再滚一次底**，把刚才滚出来的结论块又顶走
       （实测：滚到底 scrollTop=389，块 191…288，可视区 293…604 —— 差 5px 看不见；
        e2e 那条"结论块落在可视区内"也是一样红：块=[701,746] 视区=[353,691]）。
       所以收尾之后必须再滚一次 —— 这是"结论要看得见"的最后一道。 */
    if (xzState().open) xzScrollToResult();
    /* ★2026-10-22 ②b：结果要能被读屏听见。
       三条口径（按 team-lead 的更正）：
       · 载体是**常驻节点**（挂 body，不在 #xz-host 里），所以 renderXz() 重建整棵也换不掉它
         —— 无障碍树里必须"先有一个已存在的 live region"，之后内容变化才播报；
         节点每次新建+同一帧写入文本，很多读屏器什么都不念。
       · 只写**最新一条结论**（一句），不写整块 body —— 整块 innerHTML 重建会被当成
         "内容全变了"，把整段对话重念一遍，比不播更糟。
       · 分档：**只有 incident（事故）走 assertive**，其余（done / wait / stop / fail）一律 polite。
         fail 也必须 polite —— 它是高频稳态（模型不通、解析失败、"过几秒再试"），
         每次失败都打断，用户会干脆关掉播报，真事故也就传不出去了。
         assertive 的价值来自稀缺，别把它花在日常失败上。
         实现上用**两个常驻节点**而不是改同一个节点的 aria-live：
         多数读屏器在节点插入时就把 politeness 记住了，运行时改属性并不生效
         （这也是为什么"先切档再写内容"在这里等于"先选对节点再写"）。
       · 面板关着也播 —— 人没在看画面，但那是他让做的事有了结论，该听见。
         事故块自己已经用 assertive 播过一次，这里就不再重复一遍整段。 */
    if (!(m.incidents && m.incidents.length)){
      var KT = { done:'做完了', wait:'等你确认', fail:'没做成', stop:'已停止' };
      /* ★2026-10-22（优希-2 + team-lead 定稿）：这里**一律 polite**，包括 fail。
         原来 fail 走 assertive —— 但 fail 是高频稳态（模型不通、解析失败、"过几秒再试"），
         assertive 在多数读屏器上会打断当前朗读。一个每次失败都打断的工具，
         用户会干脆关掉播报，那时真事故也传不出去 —— assertive 的价值来自稀缺。
         ⇒ assertive 只留给 incident（事故在 onDone 里自己播），#xzAlert 只服务事故一种情况。 */
      xzAnnounce('小智：' + (KT[m.kind] || '结束了') + '，' + m.foot + '。', false);
    }
  }
  /* 返回**这一批新进到界面上的步骤对象**。计划区要拿它当唯一真源：
     计划里的每一步就是阶段里那一步（同一个对象），打勾时一起变 ——
     不另算一个计数器，否则"计划说 3 步、阶段只勾了 2 个"这种对不上迟早出现。
     合并进上一段（标题相同）时返回的也是 fresh：它们才是现在留在 m.stages 里的对象。 */
  function pushStage(t, stop, steps){
    var arr = (steps || []).slice();
    /* 模型有时只给 {"t":"停在这里","stop":true} 不给 steps，
       结果界面上只有一个空标题，用户看不到它为什么停。补一句兜底。 */
    if (stop && !arr.length) arr = ['停在这一步等你 —— 我没有继续往下走'];
    var norm = arr.map(function(x){
      return (typeof x === 'string') ? { t:x, done:false } : x;
    });
    /* ★2026-10-24（xz3.png 实测）：模型连着三轮做同一件事，面板就把
       「筛选状态 / 点状态下拉 / 选已上架 / 复核 看了一眼…」原样铺三遍 ——
       实测三段文字一模一样，人只会以为它卡住了（而这一轮其实成功了）。
       ⇒ 标题相同的相邻阶段合并成一段：步骤一样就整段跳过，步骤有变化就替换。 */
    /* ★2026-10-24（xz3.log 实测）：同一句「复核 · 看了一眼：这页有 24 个能点的地方、
       6 条记录」连着三轮一模一样铺了三次，而模型每轮给的小标题都不一样
       （筛选状态 / 筛选 / 复核），所以按标题合并治不了它。
       ⇒ 按**步骤文本**去重：整条消息里已经出现过的同一句话不再重复显示，
         一段话全被去光就整段不显示。 */
    var seen = {};
    for (var i = 0; i < m.stages.length; i++){
      for (var j = 0; j < m.stages[i].steps.length; j++) seen[m.stages[i].steps[j].t] = 1;
    }
    var fresh = norm.filter(function (x) { return !seen[x.t]; });
    if (!fresh.length) return [];
    var last = m.stages[m.stages.length - 1];
    if (last && last.t === t && !last.stop && !stop){
      var sig = function(a){ return a.map(function(x){ return x.t; }).join('|'); };
      if (sig(last.steps) === sig(fresh)) return [];
      last.steps = fresh;
      return fresh;
    }
    m.stages.push({ t:t, stop:!!stop, steps:fresh });
    return fresh;
  }
  /* 这一轮的步骤确实执行完了才打勾 —— 不是画上去的。
     "分批"和"停在这里"不打勾：前者表示还有没做的，后者表示等你说。 */
  function markTurn(from){
    for (var z = from; z < m.stages.length; z++){
      var s = m.stages[z];
      if (s.stop || /^分批/.test(s.t)) continue;
      for (var y = 0; y < s.steps.length; y++) s.steps[y].done = true;
    }
  }

  function step(){
    if (stopped) return;
    if (G.xzAbort){ m.text = '好，我停下了。'; finish(false); return; }
    if (turn >= XZ_CFG.maxSteps){
      pushStage('停在这里', true, ['已经走了 ' + XZ_CFG.maxSteps + ' 轮还没做完 —— 我不再自己往下走，等你说']);
      m.text += ' 到步数上限了。';
      finish(); return;
    }
    turn++;
    var markFrom = m.stages.length;

    var snap = xzObserve();
    var facts = xzFacts();
    /* 第一轮把"开跑时"的业务签名钉下来（口径与无进展检测的 nowSig 完全一致，
       否则两条读数不可比）。 */
    if (turn === 1){
      sig0Cards = facts.cards.length;
      sigStart = sig0Cards + '|' + snap.els.length + '|' + (facts.layer ? 'L' : 'P');
    }
    /* 进了弹窗要说出来：让人知道它现在在看的是弹窗，不是底页 */
    if (facts.layer && turn > 1) pushStage('看到弹窗', false, ['页面弹出了对话框，我改看对话框里的内容']);

    var planP;
    if (XZ_CFG.useModel && XZ_CFG.endpoint){
      planP = xzPlanModel(intent, snap, facts).catch(function(e){
        /* ★2026-10-22：面板是给人看的，不许写 "Expected ',' or ']'"。
           解析细节（哪个字符、原始输出前 300 字）只留给控制台，
           面板上一律说人话 —— 人要知道的是"再说一次"还是"环境没接上"。 */
        if (window.console && console.warn){
          console.warn('[小智] 模型输出没解析成计划：' + (e.detail || e.message));
        }
        m.err = (e && e.code === 'parse')
          ? '模型这轮没给出可执行的动作（输出格式不对），再说一次或者换个说法。'
          : (e && e.code === 'timeout')
            ? '等了 15 秒没有回音，我把这次请求停了 —— 要么重说一遍，要么把话说短一点。'
            : (e && e.code === 'offline')
              ? '这轮没连上规划服务，我先按内置规则走；做的事我都会回读页面核对结果。'
              : (e && e.name === 'AbortError')
                ? '这次请求被我停了。'
                : '模型这轮没接上（' + e.message + '），我按本地规则走。';
        return xzPlan(intent, snap, facts);
      });
    } else {
      planP = Promise.resolve(xzPlan(intent, snap, facts));
    }

    planP.then(function(plan){
      if (stopped) return;
      if (plan._ms) msTotal += plan._ms;

      /* ★2026-10-24（xz3.log 实测）：原来只在 turn===1 时写 m.text，于是面板上
         一直挂着首轮的「正在读这一页…（已等 5 秒）」等待文案，直到任务结束都没换掉 ——
         用户看到的是"它好像卡在读页面"，而它其实早就做完了。改成每轮都换成这一轮的话。 */
      if (plan.say) m.text = plan.say;
      else if (turn === 1) m.text = '';
      /* 不再把"第 N 轮"画进面板 —— 那是内部概念，用户只关心它做了什么。
         每轮做的事 stages 里已经有了，多说一句轮次只会显得吵。 */
      var hasStop = false;
      var roundSteps = [];
      (plan.stages || []).forEach(function(s){
        /* 判据要和渲染时一致：模型常常只给标题「停在这里」，不给 stop:true。
           只认布尔字段的话，界面上写着"停在这里"，代码却当成"做完了"。 */
        var stopLike = !!s.stop || /^(停|暂不|等你|待你|需要你)/.test(s.t);
        if (stopLike) hasStop = true;
        var added = pushStage(s.t, s.stop, s.steps);
        /* 计划只收"真要做"的步骤：停手/等你是交还控制权，不是一步活。
           同一轮里两段同名阶段会被合并，旧对象已经不在 m.stages 里 ——
           下面按"现存对象"过滤，计划里不会留下一个永远勾不上的幽灵步骤。 */
        if (!stopLike){
          for (var q = 0; q < added.length; q++){
            if (roundSteps.indexOf(added[q]) < 0) roundSteps.push(added[q]);
          }
        }
      });
      /* prompt 规则③教的正是"在 stages 里写停在这里"——模型照做时 acts 是空的，
         闸没有动作可拦，卡就出不来。这个标记给 finish 用：说停手也要出卡。 */
      m.hasStop = hasStop;
      /* ── 计划先摊开，再动手（2026-10-28）────────────────────────────
         拿到 stages 就把本轮声明的步骤接进任务计划，先画出来；下面的 acts 才开始跑。
         计划里的每一步都是上面 pushStage 放进 m.stages 的**同一个对象**，
         markTurn 给阶段打勾时计划同步变 —— 进度数字与勾同源，不另算。 */
      if (roundSteps.length){
        var liveSteps = [];
        for (var lz = 0; lz < m.stages.length; lz++){
          for (var ly = 0; ly < m.stages[lz].steps.length; ly++) liveSteps.push(m.stages[lz].steps[ly]);
        }
        if (!m.plan) m.plan = { steps:[], open:true, partial:true };
        for (var lr = 0; lr < roundSteps.length; lr++){
          if (liveSteps.indexOf(roundSteps[lr]) < 0) continue;
          if (m.plan.steps.indexOf(roundSteps[lr]) >= 0) continue;
          m.plan.steps.push(roundSteps[lr]);
        }
        m.plan.partial = m.plan.steps.length <= 1;
      }
      xzPaint();

      var acts = (plan.acts || []).slice();
      var real = acts.filter(function(a){ return a.p !== 'observe'; });

      /* ★ 用户已经说了"确认"：这一步优先于一切，包括"模型这轮没给动作"。
         实测踩过：确认之后模型只在 stages 里写"提交授权"、acts 给空，
         结果在下面的 `if (!real.length) finish()` 就返回了，确认被吃掉。
         而且这时候**不能信模型给的索引** —— 弹窗里元素只有几个，i 非常容易漂。
         所以按上次拦下的那个按钮名，在本轮快照里重新定位。 */
      if (G.xzOnce && G.xzPendingName){
        var hitIdx = -1;
        for (var z = 0; z < snap.els.length; z++){
          if (snap.els[z].n === G.xzPendingName){ hitIdx = z; break; }
        }
        if (hitIdx < 0){
          m.suspect = G.xzPendingName || m.suspect || '';
          m.err = '确认要执行「' + G.xzPendingName + '」，但这一页找不到它了 —— 界面可能变了，再说一次我重来。';
          G.xzOnce = 0; G.xzPendingName = '';
          finish(); return;
        }
        real = [{ p:'click', i: hitIdx, gen: snap.gen, confirm: 1 }];
        pushStage('你已确认', false, ['按名字重新定位到「' + G.xzPendingName + '」，不用模型给的序号']);
      }

      /* ★2026-10-28（盲审实测打回）：不可逆动作原来只在"真点到那一下"才拦 ——
         模型这一轮不给点击（只写 stages 说"停在这里"），卡就永远不出来，
         用户看到的是"没做成"。改成**执行前预扫**：本轮计划里只要打算点
         不可逆按钮，就先停下出卡，一个动作都不做。授权（G.xzOnce/G.xzGrant）
         之后走下面"按名字重新定位"那条路，不再被这里拦住。 */
      if (!G.xzOnce && !G.xzGrant){
        for (var pz = 0; pz < real.length; pz++){
          if (real[pz].p !== 'click') continue;
          var pzel = snap.els[real[pz].i];
          var pznm = pzel ? (pzel.n || '') : '';
          if (pznm && XZ_IRREVERSIBLE.test(pznm)){
            m.pending = pznm; G.xzPendingName = pznm; m.suspect = pznm;
            pushStage('停在这里', true, ['「' + pznm + '」撤不回来 —— 点下面的「确认执行」，我才往下做']);
            finish(); return;
          }
        }
      }

      /* 模型说"完事了"或只想看一眼：没有要动的，直接收 */
      if (!real.length){
        /* ★2026-10-22：这一步原来无条件 markTurn —— 于是一次点击都没发生，
           阶段上却全是 √。√ 的意思是"这一步做完了"，而它根本没做。
           现在只有"确实只是汇报读数"（没有声称动手）才打勾；
           声称动手却没动作的，一个勾都不给，收尾会按假成功判失败。 */
        if (!xzClaimedAction(m.stages.slice(markFrom))) markTurn(markFrom);
        finish(); return;
      }

      /* 一批最多 batch 个：一次做太多，错在第三步后面全废 */
      if (real.length > XZ_CFG.batch){
        var drop = real.length - XZ_CFG.batch;
        real = real.slice(0, XZ_CFG.batch);
        pushStage('分批', false, ['还剩 ' + drop + ' 个动作 —— 一批走 ' + XZ_CFG.batch + ' 个']);
      }

      G.xzHold = 1; G.xzDirty = 0;
      var okN = 0;

      /* ★2026-10-22 加：单步指令，点着了就收。
         实测踩到：说「点一下装配组件」，它点开面板之后，接着把面板里一排同族按钮
         挨个点了一遍（点规则结论的装配 / 点文档抽取的装配 / 点击装配按钮…），
         页面上可点元素从 10 掉到 4，而"无进展检测"的签名一直在变（元素数变了），
         判不出来，最后只能撞 40 步上限 —— 用户看着它自己在那儿表演。
         判据放在**意图**这一层，不靠猜模型：用户说的是"点一下/打开/展开"这种单步动作，
         且这一批里点的正是它点名的那一个，点成即收。翻页那种"点下一页"不在这个句式里，
         不会被误伤。 */
      var oneShotHit = false;
      if (/(点一下|点开|打开|展开)/.test(intent)){
        var flatIntent = String(intent).replace(/\s/g, '');
        for (var qi = 0; qi < real.length; qi++){
          if (real[qi].p !== 'click') continue;
          var nmq = ((snap.els[real[qi].i] || {}).n || '').replace(/[0-9]+$/, '').replace(/\s/g, '');
          if (nmq.length >= 2 && flatIntent.indexOf(nmq) >= 0){ oneShotHit = true; break; }
        }
      }

      /* 一批做完之后的收尾：重绘、判定停/续。抽成函数，是因为执行不再是同步循环了。 */
      function afterActs(){
        /* ★ 这里**不能**收回面板。实测：一次查询常分多轮（模型每轮返回一批动作），
           afterActs 之后还会 step() 进下一轮 —— 若在此展开，面板会 743→72→743→72 反复抽搐。
           只在 finish() 里收，那才是整轮真正结束。 */
        /* 最后一条动作的账在这里结：再晚就要等 finish，而 finish 之后面板已经收尾了 */
        xzProbeClose();
        G.xzHold = 0;
        if (G.xzAbort){ m.text = '好，我停下了。'; finish(false); return; }
        xzSpotWait();
        /* ★ 按动作类型决定要不要重绘，这一步错过一次：
           弹窗的内容是"打开那一刻的字符串快照"（G.modal.body），每次 render 都拿旧快照重建，
           所以选完下拉再 render，值立刻被打回空 —— 状态明明已经写进去了，界面却是空的。
           ⇒ 只有"会改变页面结构"的动作（点按钮、跳路由）才重绘；
             填值/选下拉不重绘，DOM 已经被改好了，重绘反而把它冲掉。 */
        var structural = false;
        for (var q = 0; q < real.length; q++){
          /* 只统计真执行成功的 —— 被硬闸拦下的点击没有改页面，重绘只会把已填好的值冲掉 */
          if ((real[q].p === 'click' || real[q].p === 'go') && real[q]._ok) structural = true;
        }
        if (structural && G.xzDirty){ G.xzDirty = 0; render(); }
        else G.xzDirty = 0;
        actsTotal += okN;

        /* 撞到不可逆动作：已经停在它前面了，这一轮就到此为止 */
        if (m.pending){
          markTurn(markFrom);
          pushStage('停在这里', true, ['「' + m.pending + '」撤不回来 —— 点下面的「确认执行」，我才往下做']);
          finish(); return;
        }

        if (okN !== real.length){
          pushStage('中断', true, ['有动作没成，我没有重试 —— 重试只会换一种错法']);
          finish(); return;
        }

        /* 单步指令已经点到了：到此为止。不替人把它没说的按钮也按一遍。 */
        if (oneShotHit && okN > 0){
          pushStage('做完', false, ['你说的那一下已经点到了 —— 后面同族的按钮我没替你点']);
          markTurn(markFrom);
          finish(); return;
        }

        /* 模型在这轮的规划里标了"停在这里"：这一轮的动作已经做完了，
           到此为止，不再自己往下走 —— 剩下那一步要人点头。 */
        if (hasStop){ markTurn(markFrom); finish(true, 'wait'); return; }

        /* 等页面稳定：弹窗、重绘、请求都可能还在路上。不等就读，读的是半截页面 */
        xzWaitStable(function(){
          if (stopped) return;
          markTurn(markFrom);
          var after = xzObserve();
          var box = xzFacts();
          pushStage('复核', false, [{
            t: '看了一眼：这页有 ' + after.els.length + ' 个能点的地方'
               + (box.layer ? '，现在在看弹窗' : '')
               + (box.cards.length ? '、' + box.cards.length + ' 条记录' : ''),
            done: true
          }]);
          xzPaint();
          /* 无进展检测：连着几轮业务结果都没变，就是白走。
             判据用"业务结果有没有变"，不用"动作是不是一模一样" ——
             实测过模型会逐个点不同的细分项绕圈，动作各不相同，但一条新信息都没拿到。 */
          var box2 = xzFacts();
          var nowSig = box2.cards.length + '|' + after.els.length + '|' + (box2.layer ? 'L' : 'P');
          if (nowSig === prevSig) sameTurns++; else { sameTurns = 0; prevSig = nowSig; }
          if (sameTurns >= 2){
            /* ★2026-10-24（用户：「把自己做成功的事报成失败」）：先看**整轮**变过没有。
               实测：说「只看已上架的组件」，第 1 轮 total 已从 18 变 6，后面模型重复同一动作、
               签名不再动 ⇒ 旧逻辑在 giveup 里报「结果一条没变」，正与事实相反。
               变过 ⇒ 报"做到这里"并给出条数前后；一次没变 ⇒ 才叫没做成。 */
            if (sigStart && nowSig !== sigStart){
              m.settledCards = box2.cards.length;
              /* ★2026-10-24：这一行原来把「记录从 8 条变成 6 条」又说了一遍，
                 和下面 m.text 的结论、和最后那行 foot 里的「记录 8 → 6 条」
                 三处同义 —— 实测面板上三句话说的是同一件事（xz3.png）。
                 条数只在一处说（结论句 + foot 的脚注），这里只留"为什么停"。 */
              pushStage('做到这里', true, [
                '后面几轮没有新东西可动，我停在这里，不往下乱点'
              ]);
              markTurn(markFrom);
              finish(true, 'settled');
              return;
            }
            pushStage('停在这里', true, ['连着 ' + (sameTurns + 1) + ' 轮转下来，页面上的结果一条没变 —— 我不再往下试了。你说具体一点，或者告诉我要点哪个']);
            /* ★ 2026-10-23 修：这里原来调 `finish()`（不带参），于是 kind 落到 'done'，
               面板显示「✓ 做完了 · 动了 4 下」。实测：让它装配"任务详情"，它连开三次弹窗、
               一条都没装上，仍然报"做完了"。**假成功比做不成严重得多** ——
               人会以为已经改好了，然后带着一个没改的页面去发布。 */
            finish(false, 'giveup'); return;
          }
          /* 还有活就下一轮（模型会看到新页面，包括刚弹出来的东西）*/
          step();
        });
      }

      /* ★ 逐条执行，每条之间 opPace 毫秒。
         这个间隔不是"等页面"——我们自己写的页面不用等；是"等眼睛"。
         批量瞬间点完，人只看到结果变了，看不到过程，就会说"页面根本没动"。
         腾讯那套每步都有一圈蓝色描边、面板里同步打勾，同一个道理。 */
      /* ★ 2026-10-23（用户当面指出，腾讯那套的做法）：动手期间面板挡住操作对象，
         人就看不到"在操作什么"。所以动作一开始先把面板平滑收起，收尾再展开。
         时机选在这里而不是每个 xzAct 里：一次查询可能有多条动作，收一次就够。 */
      document.body.classList.add('xz-acting');
      var actI = 0;
      /* ★2026-10-28（实测打转）：授权后放行，模型会在「点发布 → 点保存 → 再点发布」
         之间来回转，日志里 140 次调用仍在转。同一个元素连点 3 次就强制停 —— 这不是规则，
         是"一直跑"必须配的刹车。 */
      var lastActSig = '', repAct = 0;
      (function stepAct(){
        if (stopped) return;
        /* 上一条动作的账在这里结（此时页面已经稳了） */
        xzProbeClose();
        if (G.xzAbort){ m.text = '好，我停下了。'; finish(false); return; }
        if (actI >= real.length){ afterActs(); return; }
        var aNow = real[actI++];
        if (aNow.gen == null) aNow.gen = snap.gen;
        var tgt = (aNow.p === 'go') ? null : XZ_REF[aNow.i];
        var tname = tgt ? (xzNameOf(tgt) || '') : '';
        /* 「跳到那儿」要有个落点：记下这一轮最后碰过的那个名字。
           页面变了、名字还在 —— 按名字重新定位比按索引稳（索引下一轮就漂）。 */
        if (tname) m.suspect = tname;
        var actSig = aNow.p + ':' + (tgt ? (xzNameOf(tgt) || aNow.i) : aNow.i);
        if (actSig === lastActSig) repAct++;
        else { lastActSig = actSig; repAct = 1; }
        if (repAct >= 3){
          pushStage('绕圈了', true, ['「' + (tgt ? xzNameOf(tgt) : aNow.i)
            + '」连着点了 ' + repAct + ' 次，页面没有新变化 —— 我停下，你看看缺什么']);
          /* ★2026-10-28：原来这里 finish() 不带 err ⇒ kind=done，面板上
             「绕圈了」下面写着「做完了」。刹车停下不等于做完了，
             按失败收，出口是「跳到那儿」——让用户去看那个点在绕的元素。 */
          if (!m.err) m.err = '同一个位置连着点了 3 次，页面没有新变化';
          finish(); return;
        }
        /* 动手之前先把目标框出来 —— "看得见"的全部来源就是这一步 */
        xzSpot(1, tgt, xzActLabel(aNow, tgt));
        /* ★2026-10-22 A 方案：动作前后各量一次真值（DOM 三项 + 持久化一项）。
           条目先落、账后结（xzProbeClose），因为失败会立刻 afterActs()，
           先量后记会让"没记上"变成漏判。 */
        var probe = xzProbeOpen();
        /* ★2026-10-26（可测性）：这里原来直接调局部绑定 `xzAct(aNow)`。
           函数声明创建的是作用域绑定，不是属性查找 —— 于是测试桩 `window.xzAct = …`
           只是改了个同名属性，执行层照旧走原函数。后果：e2e 的事故链「它说没做成但页面变了」
           这条安全判据，桩显示 stub=true 却一个字都没生效，事故块永远 0 个（假红也是假绿）。
           改成 window 优先、局部兜底：默认行为一模一样，但桩能真的接管。 */
        var rr = (window.xzAct || xzAct)(aNow);
        /* ★2026-10-22（优希-2 的 agent-truth 缺口）：留一份**可机读**的动作流水。
           ?debug=1 时才挂到 window.__xzLog，正常访问零开销、不泄数据。 */
        var entry = xzLogAct(aNow, tgt, rr);
        if (probe){
          probe.entry = entry;
          /* 事故（报失败、但页面/存储真被改了，且这个动作撤不回来）：
             必须当场说出来 —— 用户看到"没做成"就不会去核对，这种谎最难被发现。 */
          probe.onDone = function(res){
            if (res.verdict !== 'incident') return;
            var n3 = res.changed.nodes + res.changed.attrs;
            var what;
            if (res.changed.store && !n3) what = '只改了存储，界面还没重绘';
            else if (res.changed.store) what = '界面变了（新增/移除 ' + res.changed.nodes + ' 处、属性 ' + res.changed.attrs + ' 处），存储也变了';
            else what = '界面变了（新增/移除 ' + res.changed.nodes + ' 处、属性 ' + res.changed.attrs + ' 处）';
            /* ★2026-10-22（team-lead 拍板，SOP §9）：把"被改的项"单独列一行，不再塞进括号里。
               界面变了也照样列 —— 只写"界面变了 5 处"用户仍然不知道**改了什么**。 */
            var items = (res.storeDiff || []).map(xzStoreLabel);
            if (!m.incidents) m.incidents = [];
            m.incidents.push({ name: entry.name, why: entry.why || '', what: what, items: items });
            /* ★2026-10-22（优希-2 实测）：原来只置 unread + xzPaint()，
               但徽标是画在浮球上的、而 xzPaint 只重绘 #xzBody ⇒ 徽标根本不出现。
               事故态存在的全部意义就是"不被遗忘"，所以这里必须显式落到浮球上。 */
            xzMarkUnread('有一件事等你确认');
            xzPaint();
            /* ★2026-10-22：面板开着的时候也要把它滚进可视区 ——
               xzPaint 的自动滚底会被后面的 chips 顶掉，结论块反而看不见。 */
            if (xzState().open) xzScrollToResult();
            /* 事故播报：assertive（打断），且先定档再写内容 */
            xzAnnounce('需要你确认：我试的是「' + entry.name + '」，我报的是没做成，但' + what + '。请核对。', true);
          };
        }
        if (rr.ok){ okN++; aNow._ok = true; }
        /* 撞到不可逆动作：停，不是失败。等用户说"确认"再放行一次。 */
        else if (rr.needConfirm){ m.pending = rr.name; G.xzPendingName = rr.name; afterActs(); return; }
        /* 失败原因只给人看，不写进正文 —— 瞬时错误进了上下文，
           模型会开始"解释那个错误"而不是继续做事（page-agent 源码注释原话）。 */
        else { m.err = rr.why; afterActs(); return; }
        setTimeout(stepAct, XZ_CFG.opPace);
      })();

    }).catch(function(e){
      m.err = '这一轮出错：' + (e && e.message ? e.message : e);
      finish();
    });
  }

  step();
}

/* ── 可机读的动作流水（只在 ?debug=1 时对外暴露）──────────────────────
   ★2026-10-22：门禁判"真的动了手"原来靠匹配面板里的中文"动了 N 下"——
   读的是我们自己写的文案，不是真值。这里给一个独立的事实来源：
     window.__xzLog = [
       { seq, at, p, i, name, ok, why, pending },   // 每个动作一条
       { seq, at, ev:'finish', kind, actsTotal, err, secs }  // 每轮收尾一条
     ]
   · 只在 URL 带 debug=1 时挂到 window，正常访问不暴露；
   · 不记录输入值（fill 的 v 可能含用户内容），只记目标名和成败；
   · 上限 200 条，超了从头丢 —— 长会话不会无限涨。 */
/* ★2026-10-22：`?debug=1` 不能只看 location.search —— 这页（app.js）启动时会把
   地址改成 `?id=hx-zc`，等本文件执行到这里，debug 参数已经被换掉了（实测：
   导航到 app.html?debug=1 后 location.search 只剩 "?id=hx-zc"）。
   原始导航地址还留在 Navigation Timing 里，所以两处都读；
   另外留一个 `localStorage['xz:debug']='1'` 的口子，方便门禁在跳转前设一次。 */
var XZ_DEBUG = (function(){
  try { if (localStorage.getItem('xz:debug') === '1') return true; } catch (e) {}
  var hay = String(location.href || '');
  try {
    var nav = (window.performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation')[0] : null;
    if (nav && nav.name) hay += ' ' + nav.name;
  } catch (e) {}
  return /(?:^|[?&#\s])debug=1(?:[&#]|$)/.test(hay);
})();
var XZ_LOG = [];
/* 一开始就挂上（哪怕是空数组）：门禁要能在"还没跑过任何任务"时就判断
   "这个页面有没有暴露真值入口"，而不是等第一条动作之后才出现。 */
if (XZ_DEBUG) window.__xzLog = XZ_LOG;
/* ── 动作真值探针 ───────────────────────────────────────────────────
   ★2026-10-22（team-lead 拍板的 A 方案）：__xzLog 原来只记 `rr.ok`，
   那是"执行层说自己做了"——和面板文案是同一个嘴的两份证词，不是真值。
   现在每个动作前后各量一次，四类证据分开记：
     changed = { nodes, attrs, text, store }   各自动没动
     rootId / rootChanged                      作用面有没有换（main→mask 之类）
   四条硬约束，每条都是量出来的，不是想出来的：
   ① **观测点必须是 document.body**：最典型的动作"打开装配面板"改的是 #mask，
      它在 <main> 之外；只盯正文区会漏（实测 A 场景 nodes=5/attrs=6）。
   ② **必须排除小智自己的节点**：一轮里自己的改动 22 次、页面真改动 4 次
      （22:4），不排就是恒真 —— 判据看着有真值源，其实永远绿。
   ③ **changed 分项**：关闭弹窗实测 nodes=0 / attrs=1，
      合并成一个布尔就分不清"没变"和"只变了属性"，而"关闭"正是最该被看见的动作。
      ★2026-10-22 去掉原来的 text（characterData）：正控/负控 B 两次实测都是 0 ——
      这个项目所有动态内容都走 `innerHTML` 重建（节点替换），characterData 拿不到样本。
      留一个永远为 false 的指标，等于给"文本变化已被覆盖"发一张空头支票，
      比不采更糟。文本变化由 attrs（value 等）与 nodes（节点替换）覆盖。
   ④ **持久化也要看**：保存/发布只落 localStorage（app.js:293 / data.js:155），
      DOM 上只有一个会自己消失的 toast。只判 DOM 会把唯一真做成的判成假成功
      —— 那是最坏的假红。
   自己的节点判定要处理文本节点：characterData 的 target 是 nodeType===3，
   没有 closest，不转 parentElement 会静默漏掉（本页 text 恒 0，测不出来）。 */
var XZ_OWN_SEL = '#xz-host, #xzSpot, #xzVig, #xzOpFoot, #xzLive, #xzAlert';
function xzIsOwn(t){
  var e = (t && t.nodeType === 3) ? t.parentElement : t;
  return !!(e && e.closest && e.closest(XZ_OWN_SEL));
}
function xzRootId(){
  var r = xzRoot();
  if (!r) return '-';
  if (r === document.body) return 'body';
  return String(r.id || r.tagName || '?').toLowerCase();
}
/* 持久化快照：这个项目的真相有一半不在 DOM 里（DB + 版本号 + 保存时间戳）。
   拖动位置键排除掉 —— 它跟任务无关，且只由用户手势改。
   ★2026-10-22（优希-2 建议，我采纳）：不只记一个总哈希，按**键**记 ——
   这样事故态第三句能写出"被改的项：apps、ifas90:app:saved:hx-zc"，
   比"请你核对"有用，而且不需要任何逆操作记录（只是把已经采到的帧 diff 出来）。 */
function xzHashStr(s){
  var h = 0;
  for (var i = 0; i < s.length; i++){ h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}
function xzStoreSnap(){
  var map = {};
  try {
    if (window.DB){
      for (var k in window.DB){
        if (!Object.prototype.hasOwnProperty.call(window.DB, k)) continue;
        var v = '';
        try { v = JSON.stringify(window.DB[k]) || ''; } catch (e) { v = ''; }
        map['DB.' + k] = xzHashStr(v) + ':' + v.length;
      }
    }
  } catch (e) {}
  try {
    for (var i = 0; i < localStorage.length; i++){
      var key = localStorage.key(i);
      if (!key || key.indexOf('ifas90:pos:') === 0) continue;
      var raw = String(localStorage.getItem(key) || '');
      map[key] = xzHashStr(raw) + ':' + raw.length;
    }
  } catch (e) {}
  var names = Object.keys(map).sort();
  var line = names.map(function(n){ return n + '=' + map[n]; }).join('|');
  return { sig: xzHashStr(line) + ':' + line.length, map: map };
}
/* 两次快照之间变了的键名（新增、改动、删除都算） */
function xzStoreDiff(a, b){
  var out = [];
  var names = {}, n;
  for (n in a) names[n] = 1;
  for (n in b) names[n] = 1;
  for (n in names){
    if (a[n] !== b[n]) out.push(n);
  }
  return out.sort();
}

var XZ_PROBE = null;
function xzProbeCount(p, list){
  for (var i = 0; i < list.length; i++){
    var m = list[i];
    if (xzIsOwn(m.target)){ p.own++; continue; }
    if (m.type === 'childList') p.nodes++;
    else if (m.type === 'attributes') p.attrs++;
    /* characterData 不采（见上面 ③ 的说明） */
  }
}
function xzProbeOpen(){
  var s0 = xzStoreSnap();
  var p = { nodes:0, attrs:0, own:0, snap0: s0, root0: xzRootId(), entry:null, onDone:null, mo:null };
  if (typeof MutationObserver === 'function'){
    p.mo = new MutationObserver(function(recs){ xzProbeCount(p, recs); });
    try {
      p.mo.observe(document.body, { subtree:true, childList:true, attributes:true });
    } catch (e) { p.mo = null; }
  }
  XZ_PROBE = p;
  return p;
}
/* 收尾：把这一下动作的账算清，写回日志条目，必要时升级成"事故" */
function xzProbeClose(){
  var p = XZ_PROBE;
  if (!p) return null;
  XZ_PROBE = null;
  if (p.mo){
    try { xzProbeCount(p, p.mo.takeRecords()); } catch (e) {}   /* 同步触发的可能还没投递 */
    try { p.mo.disconnect(); } catch (e) {}
  }
  var snap1 = xzStoreSnap();
  var storeDiff = xzStoreDiff(p.snap0.map, snap1.map);
  var store = storeDiff.length > 0;
  var changed = { nodes:p.nodes, attrs:p.attrs, store:store };
  var any = (changed.nodes + changed.attrs) > 0 || store;
  var rootChanged = xzRootId() !== p.root0;
  var verdict = null;
  if (p.entry){
    if (p.entry.ok && !any) verdict = 'fake-success';
    else if (!p.entry.ok && any) verdict = XZ_IRREVERSIBLE.test(String(p.entry.name || '')) ? 'incident' : 'mismatch';
    p.entry.changed = changed;
    p.entry.rootId = p.root0;
    p.entry.rootChanged = rootChanged;
    p.entry.verdict = verdict;
    if (storeDiff.length) p.entry.storeDiff = storeDiff.slice(0, 6);
  }
  if (p.onDone) { try { p.onDone({ changed: changed, any: any, verdict: verdict, own: p.own, storeDiff: storeDiff }); } catch (e) {} }
  return { changed: changed, any: any, verdict: verdict, rootChanged: rootChanged, storeDiff: storeDiff };
}

/* 播报：读屏用户现在能听见结果了。
   ★2026-10-22：这个面板此前**没有任何 live region**（grep aria-live = 0），
   读屏用户打开小智之后，"做完了 / 没做成 / 停在等你确认"一个都听不到。
   两个常驻节点（挂在 body 上，不随面板重建消失），都用内联样式视觉隐藏，
   不新增 CSS 文件改动：
     #xzLive  role=status → 普通结果，polite（不打断）
     #xzAlert role=alert  → 事故，assertive（必须打断） */
function xzLiveNode(assertive){
  var id = assertive ? 'xzAlert' : 'xzLive';
  var n = document.getElementById(id);
  if (n) return n;
  n = document.createElement('div');
  n.id = id;
  n.setAttribute('role', assertive ? 'alert' : 'status');
  n.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  n.setAttribute('aria-atomic', 'true');
  n.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;'
    + 'overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none';
  document.body.appendChild(n);
  return n;
}
/* ★2026-10-22（优希-2 的建议，我采纳）：播报带一个**单调递增的轮次标记**。
   理由：判据如果用"文本变了"判"本轮结论是否落在这个节点"，会假红 ——
   两轮完全可能产生同一句话（「用了 1.0 秒 · 动了 1 下」出现两次）。
   标记与文本在同一个 setTimeout 里写，于是"标记前进"就等于"这一轮真写过这里"。
   同时清空另一个节点：否则判据读到的是**上一轮的残留**（a11y 判据最常见的假绿，
   不是"没测"，是"测到了上一次的东西"）。 */
var XZ_ROUND = 0;
function xzAnnounce(text, assertive){
  if (!text) return;
  var n = xzLiveNode(!!assertive);
  var other = document.getElementById(assertive ? 'xzLive' : 'xzAlert');
  if (other && other.textContent) other.textContent = '';
  n.textContent = '';
  var r = String(++XZ_ROUND);
  setTimeout(function(){ n.textContent = text; n.dataset.round = r; }, 30);
}

/* 事故块的「跳到…」出口：不靠当时那个元素引用（早被重绘冲掉了），
   按名字在当前快照里重新找 —— 和"确认"那条路同一个思路。
   ★2026-10-22（team-lead 拍板，三态）：
   名字是身份，所以**重名时绝不能挑一个**。指错方向比指不到更坏，而且它偏发生在
   事故态 —— 人最需要一个准信的时刻。因此：
     'ok'        唯一命中 → 滚过去 + 高亮 + 焦点跟过去
     'missing'   一个都没有 → 不高亮、不动焦点，说"这个位置现在找不到了"
     'ambiguous' 命中多个   → 同上，但说的是"有 N 处都叫这个名字，我不确定是哪个"
   两个失败态的用户动作不同（前者翻页找、后者核对自己指的东西），所以文案必须分开。
   返回三态并记在 G.xzLocateLast /（debug 下）window.__xzLocateLast —— 判据读结果，
   不再靠 activeElement 猜。 */
function xzLocate(name, btn){
  var snap = xzObserve();
  var hits = [];
  for (var i = 0; i < snap.els.length; i++){
    if (snap.els[i].n === name && XZ_REF[i]) hits.push(XZ_REF[i]);
  }
  if (!name || hits.length === 0) return xzLocateSettle('missing', name, btn, 0);
  if (hits.length > 1) return xzLocateSettle('ambiguous', name, btn, hits.length);
  var el = hits[0];
  if (el.scrollIntoView){ try { el.scrollIntoView({ block:'center' }); } catch (e) {} }
  xzSpot(1, el, name);
  try {
    if (!el.hasAttribute('tabindex')){
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-xz-tabi', '1');   /* 留痕：这个 -1 是小智加的，不是页面本来就有 */
    }
    el.focus({ preventScroll: true });
  } catch (e) {}
  return xzLocateSettle('ok', name, btn, 1);
}
/* 落地：记结果 + 失败态就地写一句人话（不重建整块，避免又去滚一次） */
function xzLocateSettle(state, name, btn, n){
  G.xzLocateLast = { name: String(name || ''), state: state, at: Math.round(xzNow()) };
  if (XZ_DEBUG) window.__xzLocateLast = G.xzLocateLast;
  if (state === 'ok') return state;
  xzSpot(0);                                   /* 失败态：不高亮 */
  var msg = (state === 'ambiguous')
    ? ('页面里有 ' + n + ' 处都叫「' + name + '」，我不确定你指的是哪一个 —— 先不动，你核对一下再点')
    : ('这个位置现在找不到了（「' + name + '」）—— 可能已经被移走或改名，麻烦你自己翻一下');
  var host = (btn && btn.closest) ? btn.closest('.xz-incident, .xz-fail') : null;
  if (host){
    var note = host.querySelector('[data-locate-note]');
    if (!note){
      note = document.createElement('p');
      note.className = 'xz-err';
      note.setAttribute('data-locate-note', '1');
      host.appendChild(note);
    }
    note.textContent = msg;
  }
  xzAnnounce(msg, false);                      /* 点击的结果也要能被读屏听见（polite） */
  return state;
}

/* ── 未读徽标：唯一落点 ──────────────────────────────────────────────
   ★2026-10-22（优希-2 实测）：事故发生后把面板关掉，`.xz-badge` 根本不存在，
   浮球 aria-label 还是「小智助手」—— 用户发指令、AI 出了事故、人关掉面板去干别的，
   **没有任何信号告诉他"有一件事等你确认"**。事故态的整块价值就是"不被遗忘"，
   所以徽标必须显式画到浮球上（`xzPaint()` 只重绘 #xzBody，画不到浮球）。

   另外两条一并处理：
   · 徽标本身不进无障碍树（`aria-hidden`）：在非 live 元素上放 aria-label 不会被念，
     留着只会让人误以为"读屏能听到"；
   · 语义放到浮球的 `aria-label` 上：`小智助手 · 有一件事等你确认`，
     这样 Tab 到浮球时读屏念的是"有事等你"，而不是干巴巴的"小智助手"。 */
/* ★2026-10-22：**事件驱动**的兜底 —— 只要 #xzBody 里的内容变了，就把结论拉回可视区。
   为什么还要这一层：前面那些调用点（finish / toggle / renderXz）覆盖了"我知道的路径"，
   但实测 e2e 里仍有一种状态：面板是开的、结论块却在可视区外（`块=1012 ｜ 视区 353…691`），
   说明有一次 `innerHTML` 重建把 `scrollTop` 归零、而之后没有任何我知道的路径再滚。
   与其继续猜"是哪条路径漏了"，不如让**内容变化本身**成为触发器 —— 这是事件，不是时长。
   不会自激：滚动只改 scrollTop，不产生 DOM 变更。 */
var XZ_BODY_OBS = null;
function xzWatchBody(){
  if (XZ_BODY_OBS || typeof MutationObserver !== 'function') return;
  XZ_BODY_OBS = new MutationObserver(function(recs){
    if (!xzState().open) return;
    for (var i = 0; i < recs.length; i++){
      var t = recs[i].target;
      var e = (t && t.nodeType === 3) ? t.parentElement : t;
      if (e && e.closest && e.closest('#xzBody')){ xzScrollToResult(); return; }
    }
  });
  try { XZ_BODY_OBS.observe(document.body, { subtree:true, childList:true, attributes:true }); } catch (e) {}
}

/* 这一轮"要看的范围"：事故块 + 结论块（同一个消息里两者相邻）。
   ★2026-10-22（e2e 探针打回第二版）：只挑一个元素会左右打脸 ——
   挑 `.xz-err` 会把下面的 `.xz-done` 留在可视区外；挑 `.xz-done` 会把上面的
   事故块挤出可视区（面板只有 338 高，两块加起来约 200，其实**都放得下**）。
   所以目标不是一个元素，而是"从最上面的结论块到最下面的结论块"这段区间：
   能一起放下就一起滚进来；放不下（跨消息等）才退回最后一个。 */
function xzScrollSpan(){
  var box = document.getElementById('xzBody');
  if (!box) return null;
  var incs = box.querySelectorAll('.xz-incident');
  var dones = box.querySelectorAll('.xz-done');
  var errs = box.querySelectorAll('.xz-err');
  var pick = [];
  if (incs.length) pick.push(incs[incs.length - 1]);
  if (dones.length) pick.push(dones[dones.length - 1]);
  if (!pick.length && errs.length) pick.push(errs[errs.length - 1]);
  if (!pick.length) return null;
  var top = Infinity, bottom = -Infinity;
  for (var i = 0; i < pick.length; i++){
    var r = pick[i].getBoundingClientRect();
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { top: top, bottom: bottom, height: bottom - top, els: pick };
}
/* 调试/判据用：当前会把哪个元素滚进来（取区间里最后一个） */
function xzScrollTarget(){
  var s = xzScrollSpan();
  return (s && s.els.length) ? s.els[s.els.length - 1] : null;
}
/* 滚一次，返回状态：
     'none'  没有面板/没有结论块
     'ok'    目标已经完整可见
     'moved' 这次真的动了 scrollTop
     'stuck' 算出了 delta 但滚不动 —— **面板还没完成布局**（scrollHeight 还没长起来，
             scrollTop 被夹在 0）。这一种绝不能被当成"已经可见"，见下面的 step()。
   ★2026-10-22（team-lead 冻结窗口里量出"重开面板 scrollTop 恒 0"之后）：
   原来这里返回布尔，`false` 同时表示"已可见"和"滚不动"，而外层只在 moved 为真时才续帧
   ⇒ 重开那一刻布局没算完（scrollHeight == clientHeight），delta 算出也滚不动，
   链就断了；随后内容长起来，结论块直接被推到可视区外（1012 vs 691）。 */
function xzScrollStep(){
  var box = document.getElementById('xzBody');
  if (!box) return 'none';
  var s = xzScrollSpan();
  if (!s) return 'none';
  var b = box.getBoundingClientRect();
  var pad = 8, usable = b.height - pad * 2;
  /* 区间太高（跨消息/内容极长）时退回"只保证最后一块" */
  if (s.height > usable){
    var els = s.els, lastEl = els[els.length - 1], lr = lastEl.getBoundingClientRect();
    s = { top: lr.top, bottom: lr.bottom, height: lr.height, els: els };
  }
  if (s.top >= b.top + 1 && s.bottom <= b.bottom - 1) return 'ok';   /* 已经完整可见 */
  var delta;
  if (s.height >= usable) delta = s.top - b.top - pad;                    /* 实在放不下：顶对齐 */
  else if (s.bottom > b.bottom - pad) delta = s.bottom - (b.bottom - pad); /* 在下面：往下滚 */
  else delta = s.top - (b.top + pad);                                      /* 在上面：往上滚 */
  if (!delta) return 'stuck';
  var before = box.scrollTop;
  box.scrollTop = before + delta;
  return (box.scrollTop !== before) ? 'moved' : 'stuck';   /* 滚不动 = 布局还没好 */
}
/* ── 把"这一轮的结论"滚进可视区 ───────────────────────────────────────
   ★2026-10-22（team-lead 两次连跑量出间歇 10px 之后重写）：
   问题不是"没滚"，是**滚得早了一帧**：`scrollTop = scrollHeight` 执行完之后，
   还有一次布局变化（推荐 chips 撑开 / 字体换行）把内容又往下推约 10px，
   于是写的时候可见、读的时候不可见 —— 两次连跑一次绿一次红。

   所以不能"滚一次就完事"，也不能用 setTimeout 猜时间（那是把竞态换成更长的赌）。
   做法是**跟着帧走，直到稳定**：
     · 每次滚动都放到 requestAnimationFrame 里（等这一帧的布局算完再读）；
     · 只要这一帧还滚得动，就再来一帧；连续滚不动就停；
     · 用 token 保证只有最后一次请求有效（连开两次面板不会互相拉锯）；
     · 字体加载完成是另一次确定的布局变化，也在那一刻补一次（事件驱动，不是定时）。
   最多 8 帧（≈130ms）封顶，避免异常情况下空转。 */
var XZ_SCROLL_TOKEN = 0;
var XZ_FONT_HOOKED = false;
function xzScrollToResult(){
  var token = ++XZ_SCROLL_TOKEN;
  var pass = 0, insideStreak = 0;
  var raf = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame
    : function(f){ return setTimeout(f, 16); };   /* 无 rAF 的环境退化成下一帧，不是"等多久" */
  /* ★2026-10-22（team-lead 的定位，我采纳并加固）：
     续帧条件不能是"这次滚动了" —— 重开面板那一帧布局还没算完（scrollHeight == clientHeight），
     delta 算得出来但 scrollTop 被夹在 0，于是"没动"被判成"不用动"，链当场断掉，
     随后内容长起来，结论块被推到可视区外（1012 vs 691，稳定复现）。
     ⇒ 现在：
       · 'stuck'（滚不动/还没布局）也继续探，最多 12 帧；
       · 'ok' 要**连续两帧都完整可见**才收工，避免"布局中间态碰巧可见"就停；
       · 'none'（没有面板/没有结论块）才立即结束。
     固定帧数只是上限（防空转），"稳定"由 insideStreak 判定，不是拿次数当稳定。 */
  function step(){
    if (token !== XZ_SCROLL_TOKEN) return;       /* 有更新的请求，放弃这条链 */
    pass++;
    var st = xzScrollStep();
    if (st === 'none') return;
    if (st === 'ok'){ insideStreak++; if (insideStreak >= 2) return; }
    else insideStreak = 0;
    if (pass < 12) raf(step);
  }
  raf(step);
  /* 字体加载完会再变一次行高（确定的事件，不是猜的时长）。
     ★只能挂一次：`document.fonts.ready` 一旦 resolve，`.then` 会立刻以微任务执行；
       如果在回调里再调 xzScrollToResult()，它又 .then 一次 —— **微任务死循环，页面直接冻死**
       （实测：e2e 报 `timeout Runtime.evaluate`，整页无响应）。 */
  try {
    if (!XZ_FONT_HOOKED && document.fonts && document.fonts.ready && document.fonts.ready.then){
      XZ_FONT_HOOKED = true;
      document.fonts.ready.then(function(){ xzScrollToResult(); });
    }
  } catch (e) {}
}

/* 把 storeDiff 的键名翻成人话。翻不出来就照原样显示 —— 
   宁可露出 ifas90:xxx，也不要编一个可能错的中文名。 */
function xzStoreLabel(k){
  var s = String(k || '');
  /* 真实键名以 data.js 为准：DB 的顶层是 APPS / COMPS / APP_COMPS（大写）。
     先按实测名映射，再留小写兜底 —— 翻不出来就照原样显示，
     宁可露出原始键名，也不要编一个可能错的中文名。 */
  if (s === 'DB.APPS' || s === 'DB.apps') return '应用数据';
  if (s === 'DB.COMPS' || s === 'DB.comps') return '组件库';
  if (s === 'DB.APP_COMPS') return '装配关系';
  if (s === 'DB.seed') return '种子数据';
  if (s.indexOf('DB.') === 0) return s.slice(3);
  if (s === 'ifas90:ver') return '版本号';
  if (s === 'ifas90:seed') return '种子版本';
  if (s.indexOf('ifas90:app:saved:') === 0) return '保存时间（' + s.slice(18) + '）';
  if (s.indexOf('ifas90:') === 0) return s.slice(7);
  return s;
}

function xzMarkUnread(reason){
  var X = xzState();
  X.unread = 1;
  X.unreadReason = reason || '';
  var fab = document.querySelector('.xz-fab');
  if (!fab) return false;
  fab.setAttribute('aria-label', '小智助手' + (reason ? ' · ' + reason : ''));
  if (!fab.querySelector('.xz-badge')){
    var bd = document.createElement('b');
    bd.className = 'xz-badge';
    bd.setAttribute('aria-hidden', 'true');
    fab.appendChild(bd);
  }
  return true;
}

function xzLogPush(o){
  if (!XZ_DEBUG) return;
  o.seq = XZ_LOG.length + 1;
  o.at = Math.round(xzNow());
  XZ_LOG.push(o);
  if (XZ_LOG.length > 200) XZ_LOG.shift();
  window.__xzLog = XZ_LOG;
}
function xzLogAct(a, el, rr){
  var entry = {
    p: a && a.p, i: (a && a.i), name: el ? xzNameOf(el) : '(无目标)',
    ok: !!(rr && rr.ok), why: (rr && !rr.ok) ? (rr.why || '') : '',
    pending: !!(rr && rr.needConfirm),
    changed: null, rootId: null, rootChanged: false, verdict: null
  };
  /* fill 的值不进日志：可能是用户输入的业务内容（见文件头的数据边界） */
  xzLogPush(entry);
  return entry;
}

/* ── 操作指示层 ───────────────────────────────────────────────────────
   为什么不往目标元素上加 class：render() 会重建 DOM，class 立刻被冲掉，
   高亮跟着消失，看起来就像"什么都没发生"。改成独立覆盖框，目标还在就一直在。
   位置用 getBoundingClientRect（视口坐标），和 fixed 定位天然对齐。 */
function xzSpot(on, el, label){
  var box = document.getElementById('xzSpot');
  if (!box){
    box = document.createElement('div');
    box.id = 'xzSpot';
    box.className = 'xz-spot';
    box.innerHTML = '<b class="xz-spot-lb"></b>';
    document.body.appendChild(box);
  }
  var lb = box.querySelector('.xz-spot-lb');
  if (!on || !el){ box.classList.remove('is-on'); return; }
  var r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1){ box.classList.remove('is-on'); return; }
  box.style.left = (r.left - 5) + 'px';
  box.style.top = (r.top - 5) + 'px';
  box.style.width = (r.width + 10) + 'px';
  box.style.height = (r.height + 10) + 'px';
  if (lb){
    lb.textContent = label || '';
    /* 目标贴着顶部时，标签翻到框内下方 —— 否则会压住上面那排工具 */
    if (r.top < 46){ lb.style.bottom = 'auto'; lb.style.top = 'calc(100% + 6px)'; }
    else { lb.style.top = 'auto'; lb.style.bottom = 'calc(100% + 6px)'; }
  }
  box.classList.remove('is-wait');
  box.classList.add('is-on');
}
/* 模型在想的这几秒，框别消失，切成虚线并挂一句"在想"。
   任务总共十几秒，思考占大半 —— 框一闪就没，用户看到的还是"没动"。 */
function xzSpotWait(){
  var box = document.getElementById('xzSpot');
  if (!box || !box.classList.contains('is-on')) return;
  var lb = box.querySelector('.xz-spot-lb');
  if (lb) lb.textContent = '在想下一步…';
  box.classList.add('is-wait');
}
/* 顶部流动线 + 底部接管提示。一开一关，不参与任何判断逻辑。 */
function xzOp(on){
  var vig = document.getElementById('xzVig');
  if (!vig){
    vig = document.createElement('div');
    vig.id = 'xzVig';
    vig.className = 'xz-vig';
    document.body.appendChild(vig);
  }
  var foot = document.getElementById('xzOpFoot');
  if (!foot){
    foot = document.createElement('div');
    foot.id = 'xzOpFoot';
    foot.className = 'xz-opfoot';
    foot.innerHTML = '<span class="xz-opdot"></span><span class="xz-optext">小智正在操作</span>'
      + '<button type="button" class="xz-opstop" data-act="xzStop">停止</button>';
    document.body.appendChild(foot);
    /* 单独绑一次：页面的事件代理绑在 #root 上，而这个胶囊挂在 body 下，
       走代理永远收不到点击（实测点了没反应，任务照跑到底）。 */
    var stopBtn = foot.querySelector('.xz-opstop');
    if (stopBtn){
      stopBtn.addEventListener('click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        xzStop();
      });
    }
  }
  /* ★2026-10-22（优希-2 的指示层缺口挖出来的真 bug）：完成态 xzOpDone() 会把
     「停止」按钮 remove 掉，但 #xzOpFoot 这颗胶囊是复用的 —— 于是**第二次任务
     的接管条上没有「停止」**，用户按不下去。这里开任务时补回来。 */
  if (on && !foot.querySelector('.xz-opstop')){
    var sp2 = document.createElement('button');
    sp2.type = 'button';
    sp2.className = 'xz-opstop';
    sp2.setAttribute('data-act', 'xzStop');
    sp2.textContent = '停止';
    sp2.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation(); xzStop();
    });
    foot.appendChild(sp2);
    var tx0 = foot.querySelector('.xz-optext');
    if (tx0) tx0.textContent = '小智正在操作';
    foot.classList.remove('is-done');
  }
  if (on){ vig.classList.add('is-on'); }
  else { vig.classList.remove('is-on'); }
  /* 接管条的显隐只走这一个出口（见 xzFootSet） */
  xzFootSet(foot, on);
}
/* ── 接管条的显隐：**唯一出口** ───────────────────────────────────────
   ★2026-10-22（优希-2 复核后的建议，我采纳）：原来 xzOp() 和 xzOpDone() 各写一次
   `foot.style.pointerEvents` —— 两处写入靠"人记得保持一致"，而这个项目已经因为
   "同一件事两处各写一套"返工过四次（float.js 注释里自己写的）。收成一处：
   谁想让接管条出现/消失，都调这里，class、命中、文案一次到位。

   为什么命中必须跟着切（真 bug，实测）：接管条是靠 opacity:0 藏起来的，
   CSS 里却是 `pointer-events:auto` + `z-index:75`，而且它常驻 DOM、只切 class
   —— 于是它**看不见但还在挡点击**。实测小智跑完一次之后，页面底部输入框
   正中心 `document.elementFromPoint(692,761)` 命中的是 `.xz-optext` 而不是
   TEXTAREA，用户看到的就是"用完小智，底部输入框点不动了"。
   高亮框和流动线本来就是 pointer-events:none，只有这一个层会吃点击。 */
function xzFootSet(foot, on){
  if (!foot) return;
  if (on){
    foot.classList.add('is-on');
    foot.style.pointerEvents = 'auto';     /* 可见才接点击：里面的「停止」要能按 */
  } else {
    foot.classList.remove('is-on', 'is-done');
    foot.style.pointerEvents = 'none';     /* 隐藏时必须让开 */
    var tx = foot.querySelector('.xz-optext');
    if (tx) tx.textContent = '小智正在操作';
  }
}
/* 完成态：光晕先收，胶囊留 5 秒说"做完了"，再自己退。
   顺序反了（先退光晕再等）也行，但光晕先收能让人立刻知道"它不再动了"。 */
function xzOpDone(){
  var vig = document.getElementById('xzVig');
  if (vig) vig.classList.remove('is-on');
  var foot = document.getElementById('xzOpFoot');
  if (!foot) return;
  /* 完成态仍是"可见"，但换文案；显隐/命中依旧只由 xzFootSet 决定 */
  xzFootSet(foot, true);
  foot.classList.add('is-done');
  var sp = foot.querySelector('.xz-opstop');
  if (sp) sp.remove();
  var tx = foot.querySelector('.xz-optext');
  if (tx) tx.textContent = '交接完成';
  /* 2.4 秒太短 —— 人可能刚把视线从页面挪回来，它已经没了。给 5 秒。 */
  setTimeout(function(){ xzFootSet(foot, false); }, 5200);
}
/* 用户按「停止」：立刻断掉，不再往下走。
   标志放在 G 上而不是 xzRun 的闭包里，因为按钮的点击在闭包外面。 */
function xzStop(){
  G.xzAbort = 1;
  /* 2026-11-06：停止必须把「小智正在动手」的闸一起放下。
     原来只 abort 请求，xzHold 留在 1 —— 站内所有 <a href> 的点击被导航闸吞掉
     （实测 defaultPrevented=true），用户表现为「点菜单没反应」，只能刷新。 */
  G.xzHold = 0; G.xzDirty = 0;
  /* 停在等模型的那一刻：不 abort 的话请求还在飞，人以为停了，其实后台还在烧 token */
  xzAbortReq();
  xzOp(0);
  xzSpot(0);
  render();
}
/* 框边上那句说明：要让人一眼知道"它要点的是这个" */
function xzActLabel(a, el){
  var nm = '';
  try { nm = el ? xzNameOf(el) : ''; } catch(e){ nm = ''; }
  if (a.p === 'click')  return '点「' + (nm || '这里') + '」';
  if (a.p === 'fill')   return '填「' + (nm || '输入框') + '」';
  if (a.p === 'pick')   return '选「' + (a.v || nm || '下拉') + '」';
  if (a.p === 'go')     return '跳到 ' + (a.v || '');
  if (a.p === 'scroll') return '滚到「' + (nm || '') + '」';
  return '';
}

/* ── 对话历史（2026-11-02）────────────────────────────────────────
   用户要的是：同一个"圆圈里有时钟"的图标，点开一条条历史，每条有名字，
   点一条在同一个弹窗里看当时的对话。
   小智原来只有内存里一段 X.box，刷新就没；这里升级成按 admin/client 分开的多会话，
   会话正文落 localStorage，标题取第一条用户原话（不改写、不总结）。
   ★ 历史只读：点开旧会话不会把它切成"当前"，避免用户以为接着聊。 */
var XZ_CKEY = 'ifas90:xz:convs:v1';
var XZ_C_MAX = 30;
var XZ_C_MSG_MAX = 120;

function xzHistId(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function xzHistBlank(){ return { id:xzHistId(), at:Date.now(), msgs:[] }; }
function xzHistInit(X){
  if (X.__histReady) return;
  X.__histReady = 1;
  X.convs = X.convs || {admin:[], client:[]};
  X.cur = X.cur || {};
  if (!X.view) X.view = 'chat';
  if (X.detail == null) X.detail = '';
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(XZ_CKEY) || 'null'); } catch (e) { raw = null; }
  if (raw && raw.convs){
    ['admin','client'].forEach(function(k){
      if (!Array.isArray(raw.convs[k])) return;
      X.convs[k] = raw.convs[k].filter(function(c){
        return c && Array.isArray(c.msgs) && c.msgs.length;
      }).slice(0, XZ_C_MAX).map(function(c){
        return { id:String(c.id || xzHistId()), at:+c.at || Date.now(),
                 msgs:c.msgs.slice(-XZ_C_MSG_MAX) };
      });
    });
    if (raw.cur){
      X.cur.admin = raw.cur.admin || '';
      X.cur.client = raw.cur.client || '';
    }
  }
  ['admin','client'].forEach(function(k){
    /* 旧版只有内存 X.box：第一次升级时把那一段搬进历史，不丢用户刚说的话 */
    if ((!X.convs[k] || !X.convs[k].length) && X.box && X.box[k] && X.box[k].length){
      X.convs[k] = [{ id:xzHistId(), at:Date.now(), msgs:X.box[k].slice(-XZ_C_MSG_MAX) }];
    }
    if (!X.convs[k] || !X.convs[k].length) X.convs[k] = [xzHistBlank()];
    var hit = null;
    for (var i = 0; i < X.convs[k].length; i++){
      if (X.convs[k][i].id === X.cur[k]){ hit = X.convs[k][i]; break; }
    }
    if (!hit) hit = X.convs[k][0];
    X.cur[k] = hit.id;
    X.box[k] = hit.msgs;
  });
}
function xzHistCur(k){
  var X = xzState();
  var arr = X.convs[k] || [];
  for (var i = 0; i < arr.length; i++) if (arr[i].id === X.cur[k]) return arr[i];
  return arr[0] || null;
}
function xzHistById(k, id){
  var arr = xzState().convs[k] || [];
  for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
  return null;
}
function xzHistSave(){
  var X = xzState();
  try {
    var out = { v:1, cur:{admin:X.cur.admin || '', client:X.cur.client || ''},
                convs:{admin:[], client:[]} };
    ['admin','client'].forEach(function(k){
      out.convs[k] = (X.convs[k] || []).slice(0, XZ_C_MAX).map(function(c){
        return { id:c.id, at:c.at, msgs:(c.msgs || []).slice(-XZ_C_MSG_MAX) };
      });
    });
    localStorage.setItem(XZ_CKEY, JSON.stringify(out));
  } catch (e) {}
}
function xzHistSaveSoon(){
  var X = xzState();
  if (X.__histT) clearTimeout(X.__histT);
  X.__histT = setTimeout(function(){ X.__histT = 0; xzHistSave(); }, 200);
}
/* 有新消息时把当前会话顶到最前、刷新时间；只在发/收消息时调，不在每次重绘时调，
   否则等待秒数一跳，"最后一次对话"的时间就跟着乱动。 */
function xzHistTouch(){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  var c = xzHistCur(k);
  if (!c) return;
  if (X.box[k] && X.box[k] !== c.msgs) c.msgs = X.box[k];
  c.at = Date.now();
  var arr = X.convs[k], i = arr.indexOf(c);
  if (i > 0){ arr.splice(i, 1); arr.unshift(c); }
  xzHistSaveSoon();
}
function xzHistList(k){
  var X = xzState();
  /* 只列"真的说过话"的对话：空会话（只有开场白）不算历史，
     否则列表里会多一条「新对话 · 0 条」，点开还是空白。 */
  return (X.convs[k] || []).filter(function(c){
    return (c.msgs || []).some(function(m){ return m && m.who === 'me'; });
  });
}
function xzHistNew(){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  var cur = xzHistCur(k);
  if (cur && !(cur.msgs || []).some(function(m){ return m && m.who === 'me'; })){
    X.view = 'chat'; X.detail = '';
    renderXz();
    return;
  }
  var c = xzHistBlank();
  X.convs[k].unshift(c);
  X.cur[k] = c.id;
  X.box[k] = c.msgs;
  X.view = 'chat'; X.detail = '';
  xzHistSave();
  renderXz();
}
/* ★2026-11-06（用户：「历史里躺着你好/111 这种测试遗留」）：历史原来只能新建、不能删。
   删单条与清空全部都写回本地存储，刷新后不再出现。 */
function xzHistDel(id){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  var arr = X.convs[k] || [];
  var i = -1;
  for (var j = 0; j < arr.length; j++) if (arr[j].id === id){ i = j; break; }
  if (i < 0) return;
  var wasCur = (X.cur[k] === arr[i].id);
  arr.splice(i, 1);
  if (!arr.length) arr.push(xzHistBlank());
  if (wasCur){ X.cur[k] = arr[0].id; X.box[k] = arr[0].msgs; }
  X.view = 'list'; X.detail = '';
  xzHistSave();
  renderXz();
}
function xzHistClear(){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  var c = xzHistBlank();
  X.convs[k] = [c];
  X.cur[k] = c.id;
  X.box[k] = c.msgs;
  X.view = 'list'; X.detail = '';
  xzHistSave();
  renderXz();
}
function xzState(){
  if (!G.xz){
    /* ★2026-10-22：恢复上次的开合状态。G.xz 是内存状态，文档一换就没了；
       主因（小智点链接跳页）已经在 xzLeavesDoc 堵住，这里兜用户自己跳页、
       或页面里异步 handler 触发跳转的情况 —— 人不会觉得"小智自己消失了"。 */
    var op = false;
    try { op = sessionStorage.getItem('xz:open') === '1'; } catch (e){}
    G.xz = { open: op, mode:'admin', box:{admin:[], client:[]},
             convs:{admin:[], client:[]}, cur:{admin:'', client:''},
             view:'chat', detail:'' };
  }
  xzHistInit(G.xz);
  return G.xz;
}
/* 对话按壳分开存：平台侧聊的是授权和配置，客户端聊的是找应用和调参数，
   混在一个列表里会让客户看到"把这套授权给某某"这种内部说法。 */
function xzMsgs(){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  var c = xzHistCur(k);
  if (!c){
    c = xzHistBlank();
    X.convs[k].unshift(c);
    X.cur[k] = c.id;
  }
  X.box[k] = c.msgs;
  if (!c.msgs.length){
    /* 开场白不要在面板里重复副标题那句话 —— 副标题已经说了"我能帮你操作"。 */
    c.msgs.push({ who:'xz', icon:1,
      text: (k === 'client')
        ? '说一句你想找什么，我来筛。'
        : '说一句你要做什么，我来点。' });
    xzHistSaveSoon();
  }
  return c.msgs;
}
/* 这一页该按哪种角色给推荐问题 / 示例话术。
   抽出来给「换个说法」共用：按钮填进输入框的那句，必须是这一页真做得到的。 */
function xzPageRole(){
  var X = xzState();
  /* 角色按页面定，不按"有没有 app 上下文"二分：
     components.html 是组件库（lib），apps.html 是应用列表（admin）。
     二分法会把组件库判成 admin，推荐问题就全错。 */
  var pageName = (location.pathname.split('/').pop() || '').replace('.html', '');
  return X.mode === 'client' ? 'client'
       : pageName === 'component' ? 'comp'
       : (X.app ? 'app' : (pageName === 'components' ? 'lib' : 'admin'));
}
/* 消息区渲染抽成一处：面板首绘与步骤点亮都走它。
   步骤按"阶段"分组，不是 ①..⑫ 平铺 —— 平铺那是执行日志，不是给人看的。 */
function xzMsgsHtml(){
  var X = xzState();
  var role = xzPageRole();
  var qs = XZ_Q[role] || XZ_Q.admin;
  var body = xzMsgs().map(function(m, mi){
    if (m.who === 'me') return '<p class="xz-say is-me">' + att(m.text) + '</p>' + (m.atts ? UIK.Attach.msgHtml(m.atts) : '');
    /* ★2026-10-24（xz3.log 实测）：成功的那一轮里模型照样塞一段「做到这里 ■
       后面几轮没有新东西可动，我停在这里，不往下乱点」——同一条消息上面已经写着
       「✓ 做完了 用了 5.9 秒 · 动了 3 下」，下面再挂一块"停在这里"就是自相矛盾。
       ⇒ 结论是成功时，丢掉 stop 段；顺带把「看了一眼：这页有 24 个能点的地方」
       这种内部计数从用户视野里拿掉（那是我的内部语言，不是用户的语言）。 */
    var shown = (m.stages || []).map(function(s){
      var steps = (s.steps || []).filter(function(x){
        return !/看了一眼：这页有/.test(x.t || '');
      });
      return { t:s.t, stop:s.stop, steps:steps };
    }).filter(function(s){
      if (m.v && m.v.kind === 'ok' && (s.stop || /^(做到这里|停在这里)/.test(s.t))) return false;
      return s.steps.length > 0;
    });
    var stages = (shown.length) ? '<div class="xz-stages">' + shown.map(function(s){
      var steps = '<ul class="xz-steps">' + s.steps.map(function(x){
        /* "停住"的判据不能只认"停在这里"四个字 —— 模型会说"停在提交前""暂不提交""等你确认"，
           只认一种写法，结果就是该强调的地方没有强调，用户看不出这里在等他。 */
        var stop = !!s.stop || /^(停|暂不|等你|待你|需要你)/.test(s.t)
                   || /^(停|中断|有动作失败)/.test(x.t);
        /* 2026-10-22 QA：原来是 '⏸' / '✓' / '○' 三个字符当图标 —— 前两个是 emoji 区码位，
      按设计工作室主理人 SOP 的「AI 味检测」第 7 条（不许 emoji 当 icon）必须换掉。
      改用几何字符：■ 停 / √ 完成 / ○ 待办，都是排版符号，不是 emoji。 */
    var mark = stop ? '■' : (x.done ? '√' : '○');
        return '<li class="xz-step' + (stop ? ' is-stop' : (x.done ? ' is-done' : '')) + '">'
          + '<span class="xz-dot">' + mark + '</span><span>' + att(x.t) + '</span></li>';
      }).join('') + '</ul>';
      return '<div class="xz-stage' + (s.stop ? ' is-stop' : '') + '">'
        + '<p class="xz-stage-h">' + att(s.t) + '</p>' + steps + '</div>';
    }).join('') + '</div>' : '';
    /* 失败时不再单挂一行红字：三类失败卡已经把"为什么/怎么办"说全，
       红字再念一遍只会重复，而且长句会被正文的自动滚动裁成半行（实测截图里
       顶部挂着半句红字，像坏了）。原始原因仍在 m.err 里（调试流水可查），
       面板上只留卡片这一份人话。 */
    var errLine = (m.err && m.kind !== 'fail') ? '<p class="xz-err">' + att(m.err) + '</p>' : '';
    /* ── 事故块 ────────────────────────────────────────────────────
       ★2026-10-22：一个动作"报没做成，但页面/存储真的被改了"，而且它撤不回来。
       这是最难被发现的一种谎 —— 用户看到"没做成"就不会去核对，于是不会怀疑。
       所以这一块必须：
       · 说清三件事（我试的是什么 / 我怎么回报的 / 实际变成什么样），不能只说"出错了"；
       · 给出口（定位到它），不能只有描述；
       · 进对话流、不自动消失、不放进 5.2 秒就退场的接管条；
       · role="alert"（assertive 打断），普通结果才用 polite。
       样式复用现有 .xz-err 与 .chip，不新增 CSS。
       （2026-10-29 注：`.chip` 已于本文件改名 `.xz-chip`，见下面推荐问题那段；
         本块最终也没用 `.chip`，见下一条。） */
    var inc = (m.incidents && m.incidents.length) ? m.incidents.map(function(x){
      /* ★2026-10-22（优希-2 实测）：这里原来是 role="alert"，与常驻的 #xzAlert 同文同源
         ⇒ 读屏念两遍、互相打断；而且这块在 #xzBody 里，每次渲染都被重建
         ⇒ 用户每发一句新话都会被"需要你确认…"再打断一次。
         现在播报只留给 #xzAlert（常驻 + 延迟写文本 + 不被重建），
         可见块只负责"给人看、可停留、带出口"，用 group 装起来即可。 */
      /* ★2026-10-22（team-lead 判必修）：原来这个出口复用了 `.chip`
         （= 推荐问题的样式），于是它看起来像"再说需求一句"，实际是"滚过去并高亮"。
         外观与行为错位比"点不动"更坏：不会报错、不会红，只会让人反复点错。
         现在改成**文字链**样式（内联，不新增 CSS 规则）+ 导航语汇：
           · 文案「跳到「目标」」明确是"带你去某处"，不是"要执行什么"；
           · 前缀用 ↗（排版符号，不是 emoji），和"发送/提问"区分开；
           · aria-label 说清"会滚动并高亮，不会替你操作"。 */
      var incItems = (x.items && x.items.length)
        ? '<p class="xz-err">被改的项：' + att(x.items.slice(0, 4).join('、'))
          + (x.items.length > 4 ? ' 等 ' + x.items.length + ' 项' : '') + '</p>'
        : '';
      var goLabel = '跳到「' + x.name + '」';
      return '<div class="xz-incident" role="group" aria-label="需要你确认">'
        + '<p class="xz-err">' + '\u0021' + ' 需要你确认 · 我报没做成，但页面已经变了<br>'
        + '我试的是：' + att(x.name) + '<br>'
        + '我的回报：没做成' + (x.why ? '（' + att(x.why) + '）' : '') + '<br>'
        + '实际状态：' + att(x.what) + '</p>'
        + incItems
        + '<button type="button" class="xz-incident-go" data-act="xzIncidentGo" data-arg="' + att(x.name) + '"'
        + ' aria-label="' + att(goLabel + '（会滚动到它并高亮，不会替你操作）') + '"'
        + '>'
        + '<span aria-hidden="true">\u2197</span> ' + att(goLabel) + '</button>'
        + '</div>';
    }).join('') : '';
    /* 结束块：任务一停就画一块，让人知道"到此为止了"。
       四种结果用不同的字和底色 —— 做完、等确认、没做成、被停止，
       长得一样就分不清"它做完了"和"它卡住了"。 */
    var done = '';
    if (m.kind){
      var KM = {
        done:['\u2713', '做完了', ''],
        wait:['\u23F8', '等你确认', ''],
        fail:['!', '没做成', 'is-fail'],
        stop:['\u25A0', '已停止', 'is-stop']
      };
      var kk = KM[m.kind] || KM.done;
      done = '<div class="xz-done' + (kk[2] ? ' ' + kk[2] : '') + '">'
        + '<span class="xz-done-ic">' + kk[0] + '</span>'
        + '<span class="xz-done-t">' + kk[1] + '</span>'
        + (m.foot ? '<span class="xz-done-s">' + att(m.foot) + '</span>' : '')
        + '</div>';
    }
    var foot = (!m.kind && m.foot) ? '<p class="xz-foot-n">' + att(m.foot) + '</p>' : '';
    /* ── 失败出口（2026-10-28）──────────────────────────────────────
       一类一个动作，不再只有"没做成"四个字：
         可重试   → 再说一次（重跑同一句）
         要你看一眼 → 跳到那儿（滚过去并高亮）
         没听懂   → 换个说法（把一句这一页做得到的示例填进输入框）
       分类只认关键词（xzFailClass），卡片上的字是固定人话；
       模型原文一个字都不往这里贴。 */
    var fail = '';
    if (m.kind === 'fail'){
      if (!m.fail) m.fail = xzFailClass(m);
      var F = XZ_FAIL[m.fail] || XZ_FAIL.check;
      fail = '<div class="xz-fail" role="group" aria-label="' + att(F.t) + '">'
        + '<p class="xz-fail-t">' + att(F.t) + '</p>'
        + '<p class="xz-fail-s">' + att(F.s) + '</p>'
        + (m.fail === 'listen' ? '<p class="xz-fail-e">比如：' + att(xzExample()) + '</p>' : '')
        + '<button type="button" class="xz-fail-a" data-act="' + F.act + '" data-arg="' + mi + '">'
        + att(F.a) + '</button>'
        + '</div>';
    }
    /* 授权卡（2026-10-28）：撤不回来的动作停在它前面，等**人点**。
       不给"说确认"的路：语音识别错一个字就能把发布放出去。 */
    var grant = '';
    if (m.pending){
      grant = '<div class="xz-grant" role="group" aria-label="需要你授权">'
        + '<p class="xz-grant-t">' + (m.pendingGeneric ? '继续做刚才停下的那一步吗？' : ('要执行「' + att(m.pending) + '」吗？')) + '</p>'
        + '<p class="xz-grant-s">这一步撤不回来。点「确认执行」我接着做；如果后面弹出页面自己的确认框，我到那儿停下，最后一下归你。</p>'
        + '<div class="xz-grant-a">'
        + '<button type="button" class="xz-grant-ok" data-act="xzGrant">确认执行</button>'
        + '<button type="button" class="xz-grant-no" data-act="xzDeny">不用了</button>'
        + '</div></div>';
    }
    return '<p class="xz-say">' + att(m.text) + '</p>' + stages + errLine + inc + done + fail + grant + foot;
  }).join('');
  /* ★2026-10-29（缺陷·点不到）：这枚胶囊原来写 class="chip"，与 sys.css 的只读状态角标
     同名。那边 `pointer-events:none` 是"只读"的语义，这里只覆盖了排版没覆盖它，
     于是三枚推荐胶囊 computed 全是 none、elementFromPoint 命中父 .xz-q，点了没反应。
     现在用面板自己的命名空间 `.xz-chip`（与 .xz-q/.xz-qi/.xz-qt/.xz-qa 同族）：
     可点与只读是两个组件、两个类，谁也不用覆盖谁。样式见 xiaozhi.css 同名一节。 */
  return body + '<div class="xz-q">' + qs.map(function(q){
    return '<button class="xz-chip" data-act="xzAsk" data-arg="' + att(q) + '">'
      + '<span class="xz-qi">' + xzSpark() + '</span>'
      + '<span class="xz-qt">' + att(q) + '</span>'
      + '<span class="xz-qa" aria-hidden="true">\u2192</span>'
      + '</button>';
  }).join('') + '</div>';
}

/* ── 历史详情：只读 ─────────────────────────────────────────────────
   这里刻意不渲染按钮（授权卡、失败出口、推荐问题都不给）：历史是"当时发生了什么"，
   不是"接着往下聊"。给了按钮，人会以为点它会重跑；那是另一种谎。
   步骤符号只用 √ / ○（与正文一致，不用 emoji）。 */
function xzHistThreadHtml(msgs){
  return (msgs || []).map(function(m){
    if (m.who === 'me'){
      return '<p class="xz-say is-me">' + att(m.text) + '</p>';
    }
    var stages = (m.stages || []).map(function(s){
      var steps = (s.steps || []).map(function(x){
        return '<li class="xz-step' + (x.done ? ' is-done' : '') + '">'
          + '<span class="xz-dot">' + (x.done ? '√' : '○') + '</span>'
          + '<span>' + att(x.t) + '</span></li>';
      }).join('');
      if (!steps) return '';
      return '<div class="xz-stage"><p class="xz-stage-h">' + att(s.t) + '</p>'
        + '<ul class="xz-steps">' + steps + '</ul></div>';
    }).join('');
    if (stages) stages = '<div class="xz-stages">' + stages + '</div>';
    var done = '';
    if (m.kind){
      var KM = { done:'做完了', wait:'等你确认', fail:'没做成', stop:'已停止' };
      var k = KM[m.kind] || KM.done;
      done = '<div class="xz-done' + (m.kind === 'fail' ? ' is-fail' : (m.kind === 'stop' ? ' is-stop' : '')) + '">'
        + '<span class="xz-done-ic">' + (m.kind === 'done' ? '√' : (m.kind === 'wait' ? '■' : '!')) + '</span>'
        + '<span class="xz-done-t">' + k + '</span></div>';
    }
    return '<p class="xz-say">' + att(m.text) + '</p>' + stages + done;
  }).join('');
}
function xzHistBodyHtml(){
  var X = xzState();
  var k = X.mode === 'client' ? 'client' : 'admin';
  if (X.view === 'detail'){
    var c = xzHistById(k, X.detail);
    if (!c){ X.view = 'list'; X.detail = ''; }
    else return UIK.hist.detailHtml(c, xzHistThreadHtml(c.msgs));
  }
  return UIK.hist.listHtml(xzHistList(k), X.cur[k]);
}

/* ── 执行计划 / 进度 / 失败出口（2026-10-28，FE-XZ-LOGIC-20261028）──
   组件契约（样式在 xiaozhi.css 的「执行计划」一节，全部走令牌）：
     .xz-task            计划条（在头部下方、正文上方；执行时正文让位，它留下）
       .xz-plan-h        折叠开关：button + aria-expanded + aria-controls
       .xz-plan-t        标题「我打算做 N 步」/「我先做这一步」
       .xz-plan-ic       折叠箭头（纯排版符号，不是 emoji）
       .xz-plan-l        ol，步骤清单；li 复用 .xz-step / .xz-dot
       .xz-plan-x        计划不完整时的一句实情
     #xzProg            面板顶部的「第 N / M 步」，role=status
     .xz-fail           失败卡（retry / check / listen 三型，文案见 XZ_FAIL）
   数据只有一个真源：m.plan.steps 里放的就是 m.stages 里那批步骤对象。
   markTurn 打勾时一起变，所以"第 N/M 步"和清单上的 √ 不可能各说各话。 */
var XZ_FAIL = {
  retry: { t:'再试一次就行', s:'这次是没等到回话（超时或没连上）。页面没有改动，再试一次通常就好。',
           a:'再说一次', act:'xzRetry' },
  check: { t:'有一处要你看一眼', s:'我按计划去动的时候没走通 —— 页面可能变了，或者那个入口不在原来的位置。我先停下，你去那儿看一眼。',
           a:'跳到那儿', act:'xzJump' },
  listen:{ t:'这句我没听懂', s:'没拿到能执行的做法，我没有动页面。换个更具体的说法，比如：',
           a:'换个说法', act:'xzRephrase' }
};
/* 分类只认关键词 —— 不读模型原文，不改写模型原文。 */
var XZ_FAIL_RETRY = /(超时|没有回音|15 秒|没连上|连不上|断了|断网|网络|请求失败|服务没回|offline|HTTP \d)/i;
var XZ_FAIL_LISTEN = /(没给出可执行|输出格式|不是合法|没听懂|没看懂|无法理解|没给出可用|意图|说不清)/;

function xzFailClass(m){
  var hay = [m && m.err, m && m.text, m && m.hint].join(' ');
  if (XZ_FAIL_RETRY.test(hay)) return 'retry';
  if (XZ_FAIL_LISTEN.test(hay)) return 'listen';
  return 'check';
}
/* 这一页真做得到的一句示例（推荐问题的第一条），只用来填输入框，不自动发送。 */
function xzExample(){
  var qs = XZ_Q[xzPageRole()] || XZ_Q.admin;
  return (qs && qs.length) ? qs[0] : '点一下「新增组件」';
}

var XZ_CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function xzNo(i){ return i < XZ_CIRCLED.length ? XZ_CIRCLED.charAt(i) : ((i + 1) + '.'); }

/* 最近一条小智消息 —— 计划条只显示"当前这件事"的计划，不在聊天记录里重复铺。 */
function xzPlanMsg(){
  var list = xzMsgs();
  for (var i = list.length - 1; i >= 0; i--){
    if (list[i].who === 'xz') return { m:list[i], i:i };
  }
  return null;
}
function xzPlanStat(p){
  var done = 0, total = 0;
  if (!p || !p.steps) return { done:0, total:0 };
  total = p.steps.length;
  for (var i = 0; i < total; i++) if (p.steps[i].done) done++;
  return { done:done, total:total };
}
/* 进度读数：running 时 N＝已完成+1（当前这一步），结束后 N＝已完成。
   M 未知（模型只声明了 1 步）时不写分母，如实说"第 N 步"。 */
function xzProgMeta(m){
  var p = m && m.plan;
  if (!p || !p.steps.length) return null;
  var st = xzPlanStat(p);
  var running = !m.kind;
  var n = running ? Math.min(st.done + 1, st.total) : st.done;
  var unknown = !!p.partial || st.total <= 1;
  var text = running
    ? (unknown ? ('第 ' + n + ' 步') : ('第 ' + n + ' / ' + st.total + ' 步'))
    : ('共 ' + st.total + ' 步 · 完成 ' + st.done + ' 步');
  return { n:n, m:unknown ? 0 : st.total, done:st.done, total:st.total, running:running, text:text };
}
function xzProgPaint(){
  var pg = document.getElementById('xzProg');
  if (!pg) return;
  var hit = xzPlanMsg();
  var meta = hit ? xzProgMeta(hit.m) : null;
  if (!meta){ pg.hidden = true; pg.textContent = ''; return; }
  pg.hidden = false;
  if (pg.textContent !== meta.text) pg.textContent = meta.text;
  pg.setAttribute('data-prog-n', meta.n);
  pg.setAttribute('data-prog-m', meta.m || '');
  pg.setAttribute('data-running', meta.running ? '1' : '0');
}
function xzTaskAttrs(){
  var hit = xzPlanMsg();
  if (!hit || !hit.m.plan || !hit.m.plan.steps.length) return '';
  var st = xzPlanStat(hit.m.plan);
  return ' data-plan-total="' + st.total + '" data-plan-done="' + st.done + '"'
    + ' data-plan-partial="' + ((hit.m.plan.partial || st.total <= 1) ? '1' : '0') + '"';
}
function xzTaskHtml(){
  var hit = xzPlanMsg();
  if (!hit) return '';
  var m = hit.m, p = m.plan;
  if (!p || !p.steps.length) return '';
  var st = xzPlanStat(p);
  var partial = !!p.partial || st.total <= 1;
  var open = p.open !== false;
  var title = partial ? '我先做这一步' : ('我打算做 ' + st.total + ' 步');
  var items = p.steps.map(function(x, i){
    var d = !!x.done;
    /* aria-label 把"第几步/做没做"说全：√ 和 ○ 是给眼睛看的，读屏不能只念步骤文字。 */
    return '<li class="xz-step' + (d ? ' is-done' : '') + '" data-plan-step="' + (i + 1) + '" data-done="' + (d ? 1 : 0) + '"'
      + ' aria-label="第 ' + (i + 1) + ' 步，' + (d ? '已完成' : '未完成') + '：' + att(x.t) + '">'
      + '<span class="xz-dot" aria-hidden="true">' + (d ? '√' : '○') + '</span>'
      + '<span>' + xzNo(i) + ' ' + att(x.t) + '</span></li>';
  }).join('');
  return '<button type="button" class="xz-plan-h" data-act="xzPlanToggle" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="xzTaskList">'
    + '<span class="xz-plan-t">' + att(title) + '</span>'
    + '<span class="xz-plan-ic" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>'
    + '</button>'
    + '<ol class="xz-plan-l" id="xzTaskList" aria-label="执行计划"' + (open ? '' : ' hidden') + '>' + items + '</ol>'
    + (partial ? '<p class="xz-plan-x">先做这一步，后面的走一步看一步</p>' : '');
}

/* ── 三个出口 ─────────────────────────────────────────────────────── */
/* 再说一次：重跑这一条消息的原话。正在跑的时候不接，避免两句并发。 */
function xzRetry(mi){
  if (G.xzBusy) return;
  var m = xzMsgs()[mi];
  if (!m || m.who !== 'xz' || !m.ask) return;
  xzRun(m.ask, xzMsgs());
}
/* 换个说法：把这一页做得到的一句示例放进输入框，由人改、人发。
   不自动发送 —— 示例只是起点，替人发出去就把"换个说法"变成"替你说话"了。 */
function xzRephrase(mi){
  var m = xzMsgs()[mi];
  if (!m) return;
  var ex = xzExample();
  var inp = document.querySelector('[data-act="xzInput"]');
  if (!inp || !ex) return;
  inp.value = ex;
  inp.removeAttribute('data-voice');
  inp.focus();
  try { inp.setSelectionRange(0, inp.value.length); } catch (e) {}
  xzAnnounce('已把示例填进输入框：' + ex + '。改一改再发。', false);
}
/* 跳到那儿：先按名字重新定位（索引早漂了）；名字也找不到时，
   框出这一页交互最密的区域 —— 至少让人知道该往哪看，而不是只给一句"出错了"。 */
function xzJump(mi, btn){
  var m = xzMsgs()[mi];
  if (!m) return;
  var nm = m.suspect || '';
  if (nm){
    var st = xzLocate(nm, btn);
    if (st === 'ok' || st === 'ambiguous') return;
    /* missing：xzLocate 已经写了人话并播报过，这里只补一个区域高亮，不再念第二遍 */
    xzSpotZone();
    return;
  }
  xzSpotZone();
  xzAnnounce('我把这一页的主要区域框出来了 —— 你核对一下哪里和预期不一样', false);
}
function xzSpotZone(){
  var zone = null;
  try {
    var zs = xzZonesOf(xzRoot());
    for (var i = 0; i < zs.length; i++){
      if (!zone || zs[i].n > zone.n) zone = zs[i];
    }
  } catch (e) {}
  var el = zone ? zone.el : (document.querySelector('main') || document.body);
  if (el.scrollIntoView){ try { el.scrollIntoView({ block:'center' }); } catch (e2) {} }
  xzSpot(1, el, '这一页的主要区域');
}
/* 小智的形象：圆角方头 + 两点眼 + 一道微笑。
   形态来自 AI 生成的概念图（生成的是位图，带水印、留白不可控、缩到 48 会糊），
   这里按那个形态矢量化 —— 图标本来就应该这么做：概念用图，落地用矢量。
   用 currentColor 着色：悬浮球上是白色（叠在品牌渐变底上），头像是品牌蓝（叠在淡蓝底上）。 */
/* 推荐卡左侧的星芒：四角星，走 currentColor（品牌蓝），不新造图标集。 */
function xzSpark(){
  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0.5l1.85 5.65L15.5 8l-5.65 1.85L8 15.5 6.15 9.85.5 8l5.65-1.85z"'
    + ' fill="currentColor"/></svg>';
}
function xzHtml(mode){
  var X = xzState();
  X.mode = (mode === 'client') ? 'client' : 'admin';
  var msgs = xzMsgs();   /* 首次进入时把开场白落好 */
  /* ★2026-10-24（实测 xz3.png 后改）：开场白的两行大字 + 一行副标题占了 230px，
     明明已经聊起来了，它还在那儿介绍自己 —— 结论块被挤到下面，人得滚。
     ⇒ 一旦说过话（消息多于开场白一条），头部收成一行「小智」，副标题整条撤掉。
     首次打开才用两行大字当视觉重心，那是它唯一的用处。 */
  var isHist = !!(X.view && X.view !== 'chat');
  var talk = !isHist && msgs.length > 1;
  /* 标题两行、22px、是整块面板的视觉重心 —— 原来只有 15px 一行，撑不住。
     不经过 att()，因为要保留 <br>。 */
  var h1 = isHist ? '对话历史' : talk ? '小智' : (X.mode === 'client')
    ? 'Hi，我是小智 ~<br>想找什么应用，跟我说'
    : 'Hi，我是小智 ~<br>随时可以让我帮你操作';
  var sub = isHist ? '点一条，看看当时说了什么' : (X.mode === 'client')
    ? '按你说的条件筛应用，进去之后改配置也可以'
    : '能直接操作这个页面；撤不回来的动作，会先问你';
  /* ★2026-10-22：浮球从 <button> 改成 <div role="button" tabindex="0">。
     原因是 drag.js 的硬规则：pointerdown 落在 button/input/a… 上直接不拖
     （怕误拖输入框）。浮球整颗都是按钮，用 button 就永远拖不动。
     .xz-fab 的 CSS 已经 padding:0;border:0;background:transparent;display:block，
     换标签不掉任何样式；键盘回车/空格由 xzMountFab 里补。 */
  /* ★2026-10-22：浮球的无障碍名要能带上"有事等你"。
     徽标 aria-hidden：在非 live 元素上设 aria-label 不会被念，语义统一走这里。 */
  var fabLbl = '小智助手' + (X.unread && X.unreadReason ? ' · ' + X.unreadReason : '');
  /* 计划条在首绘时也要有内容（renderXz 不跑 xzPaint）；之后由 xzPaint 增量刷新。 */
  var taskHtml = xzTaskHtml();
  return '<div class="xz-fab" role="button" tabindex="0" data-act="xzToggle" title="点开小智 · 按住可以拖"'
    + ' aria-label="' + att(fabLbl) + '" aria-expanded="' + X.open + '">'
    + '<i></i>' + (X.unread ? '<b class="xz-badge" aria-hidden="true"></b>' : '') + '</div>'
    + (X.open
      ? '<section class="xz-panel" aria-label="小智助手">'
        + '<div class="xz-head' + (talk ? ' is-talk' : '') + (isHist ? ' is-hist' : '') + '">'
        + '<div class="xz-top">'
        /* ★2026-11-04（用户：「那个拖拽的图标完全没用，谁会把对话框拖来拖去」）：
           六点抓手删掉。拖拽本身仍在（Draggable 的 handle 是 .xz-head，不认这个点），
           只是不再画一个"看得出能拖、但没人会拖"的记号。 */
        + '<button class="hist-ico" data-act="histToggle" aria-label="对话历史" aria-pressed="' + (isHist ? 'true' : 'false') + '">' + UIK.hist.icon(15) + '</button>'
        + '<button class="xz-x" data-act="xzToggle" aria-label="收起小智">' + sv('close') + '</button>'
        + '</div>'
        /* 进度：面板顶部第一行。role=status 让读屏在「第 N/M 步」变化时轻声播报；
           空的就 hidden，不占位置。历史视图里不摆进度和头像 —— 那是"这次对话"的，
           不是"当时那条对话"的，摆上去会让人以为正在跑。 */
        + (isHist ? '' : '<p class="xz-sub xz-prog" id="xzProg" role="status" hidden></p>'
          + '<div class="xz-ava" aria-hidden="true"></div>')
        + '<h2 class="xz-h1">' + h1 + '</h2>'
        + ((isHist || !talk) ? '<p class="xz-sub">' + att(sub) + '</p>' : '')
        + '</div>'
        + (isHist ? '' : '<div class="xz-task" id="xzTask"' + xzTaskAttrs() + (taskHtml ? '' : ' hidden') + '>' + taskHtml + '</div>')
        + '<div class="xz-body' + (isHist ? ' is-hist' : '') + '" id="xzBody">' + (isHist ? xzHistBodyHtml() : xzMsgsHtml()) + '</div>'
        + (isHist ? '' : '<div class="uik-att-bar" id="xzAttBar"></div>')
        + (isHist ? '' : '<div class="xz-foot"><div class="xz-inputwrap">'
          /* ★2026-11-04（用户：「高度可以高一些，支持 2~3 行，不然都挤在一起，完全没有
             文字输入的空间」）：单行 input 换成 textarea，起手两行、最多三行。
             Enter 仍发送、Shift+Enter 换行 —— 原 keydown 分支本来就只拦非 Shift 的 Enter，
             换成 textarea 之后换行自然生效，不用改判定。 */
          + '<textarea data-act="xzInput" rows="2" aria-label="说需求" placeholder="直接说你要做什么"></textarea>'
          /* 三个控件收进自己的一行：和正文同一行时，430 宽的面板里文字只剩 ~240px，
             两行下来每行不到 15 个字，等于"能输但没法用"。 */
          + '<div class="xz-iact">'
          + '<button class="xz-mic" data-act="xzMic" aria-label="按下说话" aria-pressed="false" title="按下说话">' + sv('mic') + '</button>'
          + '<button class="xz-send" data-act="xzSend" aria-label="发送">' + sv('right') + '</button>'
          + '</div></div></div>'
          + '<p class="xz-note">AI 生成，请核对</p>')
        + '</section>'
      : '');
}
function xzSpark(){
  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0.5l1.85 5.65L15.5 8l-5.65 1.85L8 15.5 6.15 9.85.5 8l5.65-1.85z"'
    + ' fill="currentColor"/></svg>';
}
function xzPaint(){
  var box = document.getElementById('xzBody');
  if (!box) return;
  /* 历史视图是被"钉住"的：后台消息、计划 tick、等待秒数都不许把它刷回对话。
     切回对话由 histToggle / histNew 显式重建。 */
  var HX = xzState();
  if (HX.view && HX.view !== 'chat'){
    box.innerHTML = xzHistBodyHtml();
    return;
  }
  /* ★2026-10-24（xz3.png 实测）：头部只在 renderXz() 时重建，而面板是"先打开、
     后说话"——于是说完话头部还挂着「Hi，我是小智 ~ / 随时可以让我帮你操作」那 230px，
     结论被挤到下面。这里在每次重绘时顺手把头部收成一行（幂等：已经收过就不再动）。 */
  var head = document.querySelector('.xz-panel .xz-head');
  if (head && !head.classList.contains('is-talk') && xzMsgs().length > 1){
    head.classList.add('is-talk');
    var h1el = head.querySelector('.xz-h1');
    if (h1el) h1el.textContent = '小智';
    /* 只撤副标题，不许动进度行：进度也挂着 .xz-sub（为了复用副标题的水平内边距），
       原来按 .xz-sub 取第一个，会把 #xzProg 一起删掉 —— 实测顶部进度直接消失。 */
    var subEl = head.querySelector('.xz-sub:not(.xz-prog)');
    if (subEl) subEl.remove();
  }
  box.innerHTML = xzMsgsHtml();
  xzAttachSync();
  /* 计划条与顶部进度。HTML 没变就不重建 —— 否则每次 tick 都会把计划的滚动位置
     和折叠按钮的焦点冲掉。计划步骤是阶段里同一批对象，markTurn 打勾后这里自然跟着变。 */
  var task = document.getElementById('xzTask');
  if (task){
    var th = xzTaskHtml();
    if (task.__xzHtml !== th){ task.innerHTML = th; task.__xzHtml = th; }
    task.hidden = !th;
    var hitT = xzPlanMsg();
    if (th && hitT && hitT.m.plan){
      var stT = xzPlanStat(hitT.m.plan);
      task.setAttribute('data-plan-total', stT.total);
      task.setAttribute('data-plan-done', stT.done);
      task.setAttribute('data-plan-partial', (hitT.m.plan.partial || stT.total <= 1) ? '1' : '0');
    }
  }
  xzProgPaint();
  box.scrollTop = box.scrollHeight;
  /* ★2026-10-22：滚到底只是"过程态"（正在跑、还没有结论）该有的样子；
     一旦有结论块，就该停在结论上而不是停在页面最底 —— 因为结论块后面还挂着推荐 chips，
     滚到底恰恰把结论顶出可视区。这里作为**最后一道兜底**：任何一次 paint 之后，
     只要有结论块就把它拉回可视区（rAF 跟帧，见 xzScrollToResult）。 */
  xzScrollToResult();
  /* ★2026-10-22：内容一变高，贴着浮球的面板就得重算 —— 否则浮球被拖到上方时，
     面板长高会顶出屏幕。这里只做一次 getBoundingClientRect + 两次 style 写入，
     不触发重绘循环（没有 MutationObserver 参与）。 */
  xzPlacePanel();
}
/* ── 语音输入（2026-11-04 统一成一种行为）────────────────────
   识别结果只落进输入框，由人确认再点发送；模式切换与自动发送已撤。
   识别在本机做（xz-server 的 /asr → whisper.cpp），不走外网。 */
var XZ_MIC = { st:'', mr:null, ch:[], stream:null, timer:0, tick:0, ctx:null };
var XZ_MIC_PH = '直接说你要做什么';

function xzMicUi(){
  var b = document.querySelector('[data-act="xzMic"]');
  var inp = document.querySelector('[data-act="xzInput"]');
  var snd = document.querySelector('[data-act="xzSend"]');
  if (b){
    b.classList.toggle('is-rec', XZ_MIC.st === 'rec');
    b.classList.toggle('is-busy', XZ_MIC.st === 'busy');
    b.setAttribute('aria-label', XZ_MIC.st === 'rec' ? '结束录音' : XZ_MIC.st === 'busy' ? '正在识别' : '按下说话');
    b.setAttribute('aria-pressed', XZ_MIC.st === 'rec' ? 'true' : 'false');
  }
  if (inp) inp.setAttribute('placeholder', XZ_MIC.st === 'rec' ? '正在听…说完点一下麦克风'
    : XZ_MIC.st === 'busy' ? '正在转成文字…'
    : XZ_MIC_PH);
  if (snd) snd.disabled = !!XZ_MIC.st;
}

/* 状态提示只改占位文字：不往输入框里写东西，免得被当成用户内容发出去 */
function xzMicNote(msg){
  var inp = document.querySelector('[data-act="xzInput"]');
  if (!inp) return;
  inp.setAttribute('placeholder', msg);
  setTimeout(function(){ if (!XZ_MIC.st) xzMicUi(); }, 4500);
}

function xzMicCleanup(){
  clearTimeout(XZ_MIC.timer); XZ_MIC.timer = 0;
  if (XZ_MIC.tick){ clearInterval(XZ_MIC.tick); XZ_MIC.tick = 0; }
  if (XZ_MIC.ctx){ try { XZ_MIC.ctx.close(); } catch(e){} XZ_MIC.ctx = null; }
  if (XZ_MIC.stream){ try { XZ_MIC.stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){} XZ_MIC.stream = null; }
}
function xzMicStop(){
  clearTimeout(XZ_MIC.timer);
  if (XZ_MIC.mr && XZ_MIC.mr.state !== 'inactive') XZ_MIC.mr.stop();
  else xzMicCleanup();
}

/* 把当前页面上的业务词喂给识别器当偏置：客户名、应用名、表头这些词，
   通用语音模型几乎必错一个（实测「华信证券」→「花信证券」）。
   只取可见的短标题，排除小智自己面板，最多 120 字。 */
function xzAsrHint(){
  var host = document.getElementById('xz-host');
  var scope = document.querySelector('main') || document.body;
  var els = scope.querySelectorAll('h1,h2,h3,h4,th,b,strong');
  var out = [], seen = {};
  for (var i = 0; i < els.length && out.length < 20; i++){
    var e = els[i];
    if (host && host.contains(e)) continue;
    var t = String(e.textContent || '').replace(/\s+/g, ' ').trim();
    /* 卡片标题长这样：「华信证券 · 债承审核」—— 分隔符和空格要放行，
       但整句（带标点/英文混排的长句）不要，那是正文不是词。 */
    var chk = t.replace(/[\s·\-—]/g, '');
    if (chk.length < 2 || chk.length > 14) continue;
    if (!/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(chk)) continue;
    if (seen[t]) continue;
    seen[t] = 1; out.push(t);
  }
  return out.join('、').slice(0, 120);
}

function xzMicToggle(){
  if (XZ_MIC.st === 'rec'){ xzMicStop(); return; }
  if (XZ_MIC.st === 'busy') return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){
    xzMicNote('这个浏览器不能录音，请用键盘输入'); return;
  }
  navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    .then(function(stream){
      var mr = new MediaRecorder(stream);
      XZ_MIC.stream = stream; XZ_MIC.mr = mr; XZ_MIC.ch = [];
      mr.ondataavailable = function(e){ if (e.data && e.data.size) XZ_MIC.ch.push(e.data); };
      mr.onstop = function(){
        xzMicCleanup();
        var blob = new Blob(XZ_MIC.ch, { type: mr.mimeType || 'audio/webm' });
        XZ_MIC.st = 'busy'; XZ_MIC.mr = null; XZ_MIC.ch = []; xzMicUi();
        if (!blob.size){ XZ_MIC.st = ''; xzMicUi(); xzMicNote('没有录到声音，再点一次'); return; }
        fetch(XZ_CFG.endpoint.replace('/xz/plan','/asr'), {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'application/octet-stream',
                     'X-XZ-Hint': encodeURIComponent(xzAsrHint()) },
          body: blob
        })
          .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j || {} }; }); })
          .then(function(res){
            XZ_MIC.st = ''; xzMicUi();
            var t = res.ok ? String(res.j.text || '').trim() : '';
            if (!t){ xzMicNote(res.ok ? '没听清，再说一次' : '语音识别不可用，请用键盘输入'); return; }
            var inp = document.querySelector('[data-act="xzInput"]');
            if (!inp) return;
            /* 追加，不覆盖：用户可能先打了半句，又说半句 */
            var cur = String(inp.value || '').replace(/\s+$/, '');
            inp.value = (cur ? cur + ' ' : '') + t;
            /* 标记来源：语音说的"确认"不能当授权用，见 xzAsk */
            inp.setAttribute('data-voice', '1');
            inp.focus();
            try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) {}
          })
          .catch(function(){ XZ_MIC.st = ''; xzMicUi(); xzMicNote('连不上识别服务，请用键盘输入'); });
      };
      mr.start();
      XZ_MIC.st = 'rec'; xzMicUi();
      xzAnnounce('正在录音，说完停一下，或再点一下麦克风');
      /* 静默判停：说过话之后连续 1.2s 没声音就收；10s 一直没开口也收。
         确认模式只是"发不发"的区别，收录音本身一样自动。 */
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC){
        try {
          XZ_MIC.ctx = new AC();
          var src = XZ_MIC.ctx.createMediaStreamSource(stream);
          var an = XZ_MIC.ctx.createAnalyser(); an.fftSize = 1024;
          src.connect(an);
          var buf = new Uint8Array(an.fftSize);
          var spoke = false, lastLoud = 0, started = Date.now();
          XZ_MIC.tick = setInterval(function(){
            an.getByteTimeDomainData(buf);
            var sum = 0;
            for (var i = 0; i < buf.length; i++){ var d = (buf[i] - 128) / 128; sum += d * d; }
            var rms = Math.sqrt(sum / buf.length), now = Date.now();
            if (rms > 0.02){ spoke = true; lastLoud = now; }
            if (spoke && now - lastLoud > 1200) xzMicStop();
            else if (!spoke && now - started > 10000) xzMicStop();
          }, 100);
        } catch(e){ XZ_MIC.ctx = null; }
      }
      /* 60 秒上限：一整段塞进一次识别，等的人也难受 */
      XZ_MIC.timer = setTimeout(xzMicStop, 60000);
    })
    .catch(function(err){
      XZ_MIC.st = ''; xzMicUi();
      var d = String((err && err.name) || '');
      xzMicNote(d === 'NotAllowedError' ? '麦克风没被授权：点地址栏左侧的图标允许麦克风'
        : d === 'NotFoundError' ? '这台机器上没找到麦克风'
        : '打不开麦克风，请用键盘输入');
      xzAnnounce('麦克风不可用，请用键盘输入');
    });
}

/* ── 授权卡的两个按钮（2026-10-28）────────────────────────────────
   「确认执行」走的是同一条确认路径（G.xzOnce 让模型给的动作被替换成
   "按名字重新定位那个按钮"），另加 G.xzGrant：本轮剩下的不可逆动作不再逐个停。
   「不用了」只清掉待确认态，不动页面。 */
function xzGrant(){
  var list = xzMsgs();
  for (var i = list.length - 1; i >= 0; i--){
    if (list[i].who === 'xz' && list[i].pending){
      var generic = !!list[i].pendingGeneric;
      list[i].pending = null; list[i].pendingGeneric = 0;
      G.xzGrant = 1;
      if (!generic){
        G.xzOnce = 1;
        xzRun('执行「' + (G.xzPendingName || '那一步') + '」', list);
      } else {
        /* 泛型卡背后没有具体元素名可重新定位：让模型重跑，prompt 会告诉它"已授权"。 */
        xzRun('用户已确认，继续做刚才停下的那一步', list);
      }
      return;
    }
  }
}

function xzDeny(){
  var list = xzMsgs();
  for (var i = list.length - 1; i >= 0; i--){
    if (list[i].who === 'xz' && list[i].pending){ list[i].pending = null; break; }
  }
  G.xzOnce = 0; G.xzGrant = 0; G.xzPendingName = '';
  list.push({ who: 'xz', text: '好，那一步我不动。想继续的时候再说。' });
  xzHistTouch();
  render();
}

/* 一次问答：多轮直到做完或该停。
   如果上一轮停在"等确认"，而用户这次说的是"确认/继续"，就放行一次。
   语音转出来的"确认"一律不认 —— 授权只能点卡片。 */
/* ★2026-11-04 附件：面板每次 render 都整块 innerHTML 重画，控制器必须重建，
   附件列表靠 xzAttCache 跨重画带回来 —— 用户选完文件点一下别处，附件不该凭空消失。 */
var xzAttCtl = null, xzAttCache = [];
function xzAttachSync(){
  var bar = document.getElementById('xzAttBar');
  var wrap = document.querySelector('.xz-inputwrap');
  if (!bar || !wrap || !window.UIK || !UIK.Attach) return;
  var ctl = UIK.Attach.create(bar).seed(xzAttCache);
  xzAttCtl = ctl;
  /* 回形针住进控件行（.xz-iact），不再是正文旁边的一个图标 ——
     正文那一行要还给文字。控件行不存在时退回输入区，别让按钮凭空消失。 */
  var row = wrap.querySelector('.xz-iact');
  if (row) row.insertBefore(ctl.button, row.firstChild); else wrap.appendChild(ctl.button);
  ctl.bindDrop(wrap);
  /* 2026-11-06：回调只认自己这一份控制器。原来读全局 xzAttCtl，
     面板重画后它指向新实例，旧按钮选到的文件等于丢掉。 */
  ctl.onChange(function(n){
    if (xzAttCtl === ctl) xzAttCache = ctl.all();
    var inp = document.querySelector('[data-act="xzInput"]');
    var snd = document.querySelector('[data-act="xzSend"]');
    if (snd) snd.setAttribute('data-ready', ((inp && inp.value.trim()) || n) ? 'true' : 'false');
  });
}
function xzAttTake(){ if (!xzAttCtl) return []; var out = xzAttCtl.take(); xzAttCache = []; return out; }

function xzAsk(me, fromVoice, atts){
  atts = atts || [];
  if (!me && !atts.length) return;
  if (atts.length){
    var al = xzMsgs();
    al.push({ who:'me', text:me || '', atts:atts });
    var got = UIK.Attach.reply(atts);
    if (got) al.push({ who:'xz', text:got });
    xzHistTouch(); render(); return;
  }
  var list = xzMsgs();
  var last = null;
  for (var i = list.length - 1; i >= 0; i--){
    if (list[i].who === 'xz' && list[i].pending){ last = list[i]; break; }
  }
  /* ★2026-10-28（盲审打回）：原来按"开头关键词"判语音确认，于是「好，确认」
     「那就确认吧」这类说法根本不进拒绝分支，直接被当普通指令发出去。
     只要卡在等授权，语音来源就一律不放行 —— 只说「取消」这一条路。 */
  if (last && fromVoice){
    if (/^(取消|不用|算了|不要|别做)/.test(me.trim())){ xzDeny(); return; }
    list.push({ who: 'xz', text: '授权请点卡片上的「确认执行」。语音不放行 —— 识别错一个字，撤不回来的动作就放出去了。要取消就说「不用了」，或者点卡片上的按钮。' });
    xzHistTouch();
    render();
    return;
  }
  if (last && /^(确认|确定|继续|执行|可以|去吧|行|ok|OK)/.test(me.trim())){
    G.xzOnce = 1;
    var nm = last.pending;
    last.pending = null;
    me = me.replace(/^(确认|确定|继续|执行|可以|去吧|行|ok|OK)[，,。\s]*/, '') || ('执行「' + nm + '」');
  }
  xzRun(me, list);
}

/* 静态预览没有 /xz/plan 这个转发接口，指向不存在的地址只会 404 —— 明确标出来，不假装能跑 */
/* ★2026-11-03：这里原来把 endpoint 硬写回 '/xz/plan'，把上面的公网分流覆盖掉了，
   公网页因此永远拿到 404、退回内置规则。删掉这行，统一用上面的 endpoint 取值。 */
document.addEventListener('DOMContentLoaded', renderXz);

/* ★2026-10-22：两个播报节点**一开始就建好**（空内容）。
   原因：无障碍树里必须"先有 live region，之后内容变化才播报"；
   如果等到第一次要播时才创建节点、同帧写入文本，很多读屏器什么都不念。
   这也是"加了等于没加"的最常见形态，实测踩过（正控第一版里 #xzAlert 根本不存在）。 */
if (document.body){ xzLiveNode(false); xzLiveNode(true); xzWatchBody(); }
