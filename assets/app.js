/* 应用配置：独立应用内容、对话生成、草稿与发布。资产通过统一授权目录按需发现。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 取到才绑：结构改名、或者缓存里混进新旧两个版本时，宁可少绑一个交互，
     也不要 `null.addEventListener` 把整页搞挂。 */
  function on(sel, ev, fn) {
    var n = typeof sel === 'string' ? $(sel) : sel;
    if (n) n.addEventListener(ev, fn);
    return n;
  }
  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  /* 结构数据一律过这一道：谁拿到谁一份，改它不会改到别人（E22）。 */
  function dc(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /* ── 一个反馈面：悬浮条上方的提示条。装配/卸载 3 秒，对话回复长一点。
     读屏靠 role="status"（写在 HTML 上，不在这里改）。

     ★2026-10-28 E23：做完一步结构编辑后，这一条同时长出唯一一颗「撤回」。
       不新造浮层 —— 位置（悬浮条上方那条缝）、层级、出现/消失全沿用本条规则，
       所以它不会压住画布内容，也不需要重新算避让。
       同一时刻只有一条：新消息（含新的结构编辑）直接替换旧的，旧动作一并撤走。 ── */
  var hintTimer, hintAct = null;
  /* onHide：这条提示真正收起时通知调用方（组件更新的「已更新」行与撤回窗口同长，
     见规格 §4.4/§4.5）。放在这里而不是各行自己再开一个 8 秒定时器：
     提示条被新消息顶掉、被焦点暂停、被撤回手动收起 —— 三种收场都要同时结束那一行，
     两份定时器迟早只停一份，然后屏幕上留着一条没有撤回入口的「已更新」。 */
  var hintOnHide = null;
  function hideHint() {
    var h = $('#hint');
    if (!h) return;
    h.setAttribute('data-on', 'false');
    h.removeAttribute('data-act');
    if (hintAct) {
      /* 收起后这颗按钮不许还留在 Tab 序里 —— opacity:0 不会把按钮移出键盘可达范围 */
      hintAct.tabIndex = -1;
      h.setAttribute('inert', '');
      hintAct = null;
    }
    var cb = hintOnHide;
    hintOnHide = null;
    if (cb) { try { cb(); } catch (e) { /* 收起回调不许把提示条自己的收尾打断 */ } }
  }
  function hint(msg, opt) {
    var h = $('#hint');
    if (!h) return;
    var o = opt || {};
    var err = o.kind === 'err';
    /* 上一条还挂着收尾回调（它的撤回窗口已经结束）先结算，再换新消息 */
    if (hintOnHide) { var prev = hintOnHide; hintOnHide = null; try { prev(); } catch (e) {} }
    h.removeAttribute('inert');
    h.removeAttribute('data-act');
    h.textContent = '';             /* 先清空：上一条的「撤回」不许留在 DOM 里 */
    hintAct = null;
    h.appendChild(document.createTextNode(msg));
    if (o.action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hint-act';
      b.id = 'hint-act';
      b.textContent = o.action.label;
      b.addEventListener('click', function () { o.action.run(); });
      /* 键盘用户停在这颗按钮上时，别在脚下把条子收走；8 秒是给"没在看"的 */
      b.addEventListener('focus', function () { if (hintAct === b) clearTimeout(hintTimer); });
      b.addEventListener('blur', function () {
        /* 已被新消息替换掉的旧按钮（hintAct 已换人）不许再改新条的倒计时 */
        if (hintAct === b && h.getAttribute('data-on') === 'true') arm(o.ms || 8000);
      });
      h.appendChild(b);
      hintAct = b;
      h.setAttribute('data-act', 'true');
    }
    h.setAttribute('data-kind', err ? 'err' : 'info');
    /* ★2026-10-28 P1-B：排查用的原文只挂在 title 上（不展开、不占版面），
       界面上那句正文必须是人话。没有 title 时清掉上一条的，免得留个旧 tooltip。 */
    if (o.title) h.setAttribute('title', String(o.title).slice(0, 300));
    else h.removeAttribute('title');
    /* 失败要立刻被读屏打断，成功走 polite 排队 */
    h.setAttribute('role', err ? 'alert' : 'status');
    h.setAttribute('aria-live', err ? 'assertive' : 'polite');
    h.setAttribute('data-on', 'true');
    hintOnHide = typeof o.onHide === 'function' ? o.onHide : null;
    function arm(ms) {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(hideHint, ms);
    }
    arm(o.ms || 3000);
  }

  /* ══ 0. 数据 ═════════════════════════════════════════════════ */
  if (!window.DB) { console.error('[app] assets/data.js 没加载，本页不工作'); return; }
  DB.load();
  if (!DB.APPS.length) { console.error('[app] DB 里没有任何应用'); return; }

  /* ══ 1. 这个页面是哪个应用：只认 URL ═══════════════════════════
     ★2026-10-24 修 P0-3：原来 id 缺失或找不到就 `app = DB.APPS[0]`，静默换成第一个应用 ——
     而且用 replaceState 把 URL 也改掉，用户根本看不出自己被换了页。
     实测：「新建应用」链接不带 id，进来是「华信证券 · 债承审核」，一保存就改到别人头上。
     现在的口径：没有 id ⇒ 回列表页选/建；id 存在但查不到 ⇒ 回列表页并提示「这个应用不在了」。 */
  var qs = new URLSearchParams(location.search);
  var failDemo = qs.get('fail') === '1';
  var appId = qs.get('id') || '';
  var app = appId ? DB.appById(appId) : null;

  /* ★2026-10-27（UE 走查 P0-3）：**客户看的那一页不存在。**
     走查实测：应用卡「复制链接」生成的是 `apps.html?id=…` —— 那是管理列表页，
     客户打开看到的是一堆别人的应用。全站 5 个页面没有一个能当客户视图。
     于是「发布」这个动作没有落点：发布完之后，没有任何地址能证明客户看到了什么。

     这里不新写一套渲染（那会变成第二份画布，两份必然走偏），
     而是同一份画布加一个视图模式：`?mode=view`。
     该模式下把管理侧的东西全部拿掉（顶栏操作、编辑态提示、块操作、对话条、提示条），
     只剩「应用名 + 这一页长什么样」。判据见 check-view-mode.mjs。 */
  var VIEW_MODE = qs.get('mode') === 'view';

  if (VIEW_MODE) {
    document.body.setAttribute('data-mode', 'view');
    /* 标题同样去前缀：客户在浏览器标签上看到自己的公司名两次是没有意义的 */
    document.title = viewName(app ? app.name : '应用');
    /* 2026-11-06：客户视图的「返回」回到「我的应用」（SaaS 端客户首页），
       不是配置台 apps.html。返回链条：我的应用 → 应用 → 返回我的应用。
       ★2026-11-06 下午补上 my-apps.html 之后，这条链才真正闭合；
       在那之前这一屏不存在，只能先退回落地汇总页。 */
    var vBack = document.getElementById('act-back');
    if (vBack) { vBack.setAttribute('href', 'my-apps.html'); vBack.setAttribute('aria-label', '返回我的应用'); }
  }

  if (!app) {
    var why = appId ? 'miss=1' : 'pick=1';
    try { location.replace('app-manage.html?' + why); } catch (e) {}
    return;
  }

  /* ── 草稿：下次进来优先看草稿，没有草稿才回到最新版本（m05120）──────────
     草稿只存在本机，不产生版本号、不影响客户；「保存新版本并发布」才冻成快照。 */
  var DRAFT_KEY = 'ifas90:draft:app:' + appId;
  function readDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      var d = raw ? JSON.parse(raw) : null;
      return d && typeof d === 'object' && Array.isArray(d.comps) ? d : null;
    } catch (e) { return null; }
  }
  function clearDraft() {
    try{if(draftSession)draftSession.clear();else localStorage.removeItem(DRAFT_KEY);return true;}
    catch(e){hint('版本已保存，但草稿未能清除',{kind:'err',ms:9000});return false;}
  }
  function applySnap(snap, persist, opt) {
    if (!snap) return;
    if (Array.isArray(snap.comps)) {
      app.comps.length = 0;
      snap.comps.forEach(function (id) { if (DB.compById(id)) app.comps.push(id); });
    }
    if (snap.name != null) app.name = snap.name;
    if (snap.desc != null) app.desc = snap.desc;
    /* ★2026-11-04：进页面 = 回到最后一次保存的那一版，内容层整包还原。
       之前被误判为"给每块都盖已单独改过章"的根因是那颗标，标已删（647b077），
       内容层还原本身是对的：画布必须和 v4 快照一致，否则一进来就报「未保存」。 */
    app.content = JSON.parse(JSON.stringify(snap.content || {}));
    if (persist !== false) DB.save();
  }
  function saveDraft() {
    try {
      draftSession.save();
      paintSaveState();
      hint('草稿已保存', { ms: 5000 });
      return true;
    } catch (e) {
      hint('草稿没存上', { kind: 'err', ms: 9000 });
      return false;
    }
  }
  if (!VIEW_MODE) {
    var bootDraft = readDraft();
    if (bootDraft) applySnap(bootDraft, false);
    else {
      /* 没有草稿：回到**最大号**的稳定版，不是 active —— 未上架应用没有 active，
         但它的最新版本仍应作为下次编辑的起点。 */
      var bootList = (DB.versOf('app', appId) || []).filter(function (r) {
        return r.kind === 'stable' && r.snap;
      });
      bootList.sort(function (a, b) { return b.v - a.v; });
      if (bootList[0]) applySnap(bootList[0].snap, false);
    }
  }

  /* ★2026-10-27：版本化只读视图 `?mode=view&v=N`。
     客户视图默认看"当前启用版"；带 v 时看指定的历史版本，用于会话改动卡的「查看这一版」。
     内容取快照里的 content，不回落到当前组件库 —— 否则"看历史版"看到的还是今天的内容。 */
  var draftSession=AppDraft.create({
    storage:localStorage,key:DRAFT_KEY,now:today,
    snapshot:function(){return {name:app.name,desc:app.desc,comps:app.comps.slice(),content:DB.resolveContent(appId)};},
    restore:function(s){applySnap(s,false);},persist:function(){return DB.save();}
  });

  function latestFormal(){var rows=DB.versOf('app',appId).filter(function(r){return r.kind==='stable';}).sort(function(a,b){return b.v-a.v;});return rows[0]&&rows[0].snap?rows[0]:null;}
  function syncReset(){var b=$('#act-reset');if(!b)return;b.hidden=VIEW_MODE;var formal=latestFormal();b.disabled=VIEW_MODE||!!genBusy||!formal||(!readDraft()&&!draftSession.isDirty());b.title=formal?'':'暂无正式版本可恢复';}
  function resetDraft(){var formal=latestFormal();if(VIEW_MODE||!formal||genBusy)return;Confirm.ask({title:'重置为 v'+formal.v+'？',body:'当前修改和已保存的草稿将被清除。',ok:'重置',onOk:function(){try{var current=latestFormal();if(!current)throw new Error('没有可恢复的正式版本');draftSession.reset(current.snap);paintApp();renderCanvas();syncReset();hint('已重置为 v'+current.v);}catch(e){hint(e.message||'重置失败',{kind:'err',ms:9000});}}});}
  window.addEventListener('beforeunload',function(e){if(!VIEW_MODE&&draftSession.isDirty()){e.preventDefault();e.returnValue='';}});

  var viewV = parseInt(qs.get('v'), 10) || 0;
  var VIEW_SNAP = null;
  var viewMissing = false;
  var viewBlocked = false;
  if (VIEW_MODE) {
    var vrec = viewV
      ? DB.versOf('app', appId).filter(function (r) { return r.kind === 'stable' && r.v === viewV; })[0]
      : DB.versActive('app', appId);
    if (viewV) {
      /* 指定版本：只认快照，取不到就显示"不存在"，绝不回落到当前内容 */
      if (vrec && vrec.snap) VIEW_SNAP = vrec.snap;
      else { viewMissing = true; viewBlocked = true; }
    } else if (app.status === '已上架' && vrec && vrec.snap) {
      /* 客户链接：必须已上架且有 active 快照 */
      VIEW_SNAP = vrec.snap;
    } else {
      /* 未发布 / 已下架 / 没有 active 快照：客户什么都看不到 */
      viewBlocked = true;
    }
  }

  /* ★2026-11-01（用户原话）：「把客户那个数据拉下来，用我们最新的应用去给它跑起来，
     报错了 404 了，就说明兼容性有问题」——这一句要能在本地真的跑出来，不能只比结构。
     做法：**结构取 v（新版），内容取 dataV（客户在用的那一版）**，
     然后用这台机器上同一份渲染器真渲染一遍。
       ?id=hx-zc&mode=view&v=4&dataV=3  → 用 v4 的结构渲染 v3 的数据。
     渲染时该抛的错照抛（缺列、块没了、结构对不上），这就是"跑起来报错"的本地等价物。 */
  var DATA_V = parseInt(qs.get('dataV'), 10) || 0;
  if (VIEW_MODE && DATA_V && VIEW_SNAP) {
    var drec = DB.versOf('app', appId).filter(function (r) { return r.kind === 'stable' && r.v === DATA_V; })[0];
    if (drec && drec.snap) {
      /* 只换内容，不换装配（装配是结构，属于新版）
         ⚠ 客户数据里某一块的 spec/fields，可能新版已经没有对应的块结构了 —— 
         这里不做任何清洗，让渲染器自己去撞，撞出来的错才是真错。 */
      VIEW_SNAP = {
        comps: VIEW_SNAP.comps,
        name: drec.snap.name || VIEW_SNAP.name,
        desc: drec.snap.desc || VIEW_SNAP.desc,
        client: drec.snap.client || VIEW_SNAP.client,
        content: drec.snap.content || {},
        contentHash: drec.snap.contentHash,
        at: drec.snap.at
      };
      document.body.setAttribute('data-preview', '1');
    }
  }

  /* 版本号来源：台账 active 快照 > 最大号。第一次保存快照 = v1。 */
  function getVer() {
    /* 2026-10-27：当前线上 = active 的那一版；没有 active 就是 0（未上线），
       不再回落到最大号 —— 否则下架后顶栏还会写「当前线上 v6」。 */
    var act = DB.versActive('app', appId);
    return act ? act.v : 0;
  }
  function topVer() {
    /* 新快照号只增不回收：取现有最大号，+1 在 doPublish 里算。 */
    var st = DB.versOf('app', appId).filter(function (r) { return r.kind === 'stable'; });
    return st.length ? st[0].v : 0;
  }
  /* ★2026-10-27 单一工作区模型：不再有"当前编辑的是草稿还是线上"这个问题。
     画布永远只有一份最新实时状态，改动自动保存；版本只在点「保存快照」时产生。
     顶栏这行只说两件事实：当前线上是哪版、刚才有没有自动保存。 */
  /* ★2026-11-01（用户）：「更新你要写就写年月日时分秒 —— 我一天可能更新好多个版本，
     怎么知道这个版本是今天什么时候更新的？」
     ⇒ today() 从「YYYY-MM-DD」升级成「YYYY-MM-DD HH:mm:ss」，与数据层 DB.now() 同一格式。
     名字还叫 today 是为了不动 11 处调用点；它现在的返回值是时间戳，不是日期。 */
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function hhmm() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ══ 2. 应用名铺到页面（左上浮标 + 画布标题），没有一处写死 ══════ */
  /* 客户视图的名字口径（2026-11-06）：去掉「客户 · 」前缀。
     后台列表是平台方看所有客户，「华信证券 · 债承审核」里的前缀回答的是"这是谁的"；
     客户登录后看的就是自己的应用，每处都挂一遍自己公司名等于重复他自己。
     真源 SaaS 里也只有场景名（研究报告审核 / 基金代销合同审核）。 */
  function viewName(n) {
    var s = String(n || '');
    if (!VIEW_MODE) return s;
    var i = s.indexOf(' · ');
    return i > 0 ? s.slice(i + 3) : s;
  }

  function paintApp() {
    var shownName = viewName((VIEW_SNAP && VIEW_SNAP.name) ? VIEW_SNAP.name : app.name);
    $$('[data-bind="app-name"]').forEach(function (n) { n.textContent = shownName; });
    /* ★2026-11-04（用户：「应用配置详情左上角也加一行介绍，太长能点开看全部」）。 */
    var hdDesc = $('#app-desc');
    if (hdDesc) {
      var dTxt = (VIEW_SNAP && VIEW_SNAP.desc) ? VIEW_SNAP.desc : (app.desc || '');
      if(dTxt==='还没装配组件。')dTxt='客户线索跟进与状态管理';
      if (hdDesc.textContent !== dTxt) {
        hdDesc.textContent = dTxt;
        delete hdDesc.dataset.fullBound;
        hdDesc.classList.remove('is-clip');
      }
      if (window.UIK && UIK.Full) UIK.Full.bindLine(hdDesc, shownName, dTxt);
    }
    /* ★2026-11-03：顶栏第二行（客户 · 发布态）已删（用户 m00984：只留应用名 + 版本号）。
       删的是**显示**，不是数据：客户在客户授权页、发布态在应用卡与客户授权页，
       各自都有动作可做；顶栏里它们既不能点、也回答不了"我现在能干什么"。
       唯一保留的状态是"未保存/保存失败"——那两件会改变下一步动作，见 paintSaveState()。 */
    var cnt = $('#act-count');
    /* ★ 2026-10-26：「装配组件 3」里的 3 没有单位 —— 是"还能装 3 个"还是"已装 3 个"？
       现在写成「已装 3 / 8」：分母是组件库总数，从 DB.COMPS 现取，不写死。
       ⚠ 数字只能待在括号里，按钮上必须留着「装配组件」四个字：
         小智是按可访问名在元素快照里找这个入口的，换成纯状态词它就说"没有动页面"。 */
    /* ★2026-10-26 修（盲审 v11 P1，同一个矛盾第三次出现）：
       分母原来写 DB.COMPS.length（8），而抽屉页签是「可装配 3 / 已装配 3」= 6，
       差的 2 个是禁用态、装配面板里根本不显示 —— 屏上没有任何一处解释这个差。
       用户会以为漏装。分母改成「能装的」：已装 + 可装配，与页签同一个口径。
       禁用掉的那几个在抽屉里用一行说明，不藏。 */
    var usable = DB.COMPS.filter(function (c) { return DB.canInstall(c) || isOn(c.id); }).length;
    if (cnt) cnt.textContent = '已装 ' + (VIEW_SNAP && Array.isArray(VIEW_SNAP.comps) ? VIEW_SNAP.comps.length : app.comps.length) + ' / ' + usable;
    /* ★2026-11-04（用户）：「只需要在已装配旁边显示 X 个可升级的标签」——
       可升级数只留在装配面板「已装配」页签的角标上；顶栏不再重复一遍同一个数。 */
    /* 「保存」做的事是把当前内容冻成一版给客户看；这行说的是"现在离那一版差多远"。
       文案口径见 paintSaveState —— 这里不再写「已自动保存」（P0-2 语义冲突）。 */
    paintSaveState();
    /* ★2026-10-31 用户原话：「谁他妈说的一定要装组件呀，有一些就纯定制化的这种应用，
       一个组件都不用的，它不应该存在吗？它不合理吗？」
       ⇒ 这里原来按「装配数 0 就禁用」处理，是把我自造的「空应用」概念又锁进了界面。
         纯定制应用是常见形态，按钮永远可点，不许禁用、不许改文案。 */
    var pub = $('#act-publish');
    if(pub)pub.textContent='保存并发布';
    /* ★2026-10-27：客户视图（?mode=view）里不该出现「应用配置」——
       客户不需要知道这是个配置页，他只知道"这是我的审核应用"。
       注意这一行在 paintApp 里，会覆盖上面 VIEW_MODE 分支设过的 title，
       所以判断必须写在这里，不能只在开头设一次。 */
    document.title = VIEW_MODE ? shownName : shownName + ' · 应用配置';
    document.body.setAttribute('data-app', appId);
    var cv = $('#canvas');
    if (cv) cv.setAttribute('data-app', appId);
    paintSaveState();
  }

  /* ★ 2026-10-28 修 P0-2（语义冲突）：页头这行不再说「已自动保存」。
     用户在应用页看到页头写"已自动保存"，旁边按钮又叫「保存」——
     会以为按钮是把自动保存补一下，而它实际做的是把当前内容存成一版、客户立刻看到。
     两个说法在同一屏上打架，按下去会发生什么没人说得准。
     现在这行只回答一个问题：**现在的内容和线上那一版是什么关系**。
       从未保存过任何版本        → 还没保存过版本
       与线上那一版逐项相同      → 与线上 v5 一致
       和线上那一版不一样        → 有改动还没保存成版本
       保存过、但当前没有线上版  → 没有线上版本（下架中；三种常态之外的兜底）
     判据不看改动流水（撤回 / 外部写入会让流水与内容对不上），
     直接比内容本身：装配顺序 + 名称/客户/说明 + 每块的 resolveContent。
     对象键序不算差异（canon 排过序）；数组顺序算差异（装配顺序就是客户看到的顺序）。 */
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  function sameAsSnap(snap) {
    if (!snap || !Array.isArray(snap.comps) || snap.content == null) return false;
    if (!app.comps || app.comps.length !== snap.comps.length) return false;
    for (var i = 0; i < app.comps.length; i++) {
      if (app.comps[i] !== snap.comps[i]) return false;
    }
    if (String(app.name || '') !== String(snap.name || '')) return false;
    if (String(app.client || '') !== String(snap.client || '')) return false;
    if (String(app.desc || '') !== String(snap.desc || '')) return false;
    return JSON.stringify(canon(DB.resolveContent(appId))) === JSON.stringify(canon(snap.content));
  }

  function paintSaveState() {
    syncReset();
    var ed = $('#app-edit');
    if (!ed) return;
    /* 写盘失败优先：先报"没存上"，版本关系等写盘恢复了再说 */
    if (DB.lastSaveOk === false) {
      ed.textContent = '保存失败';
      ed.setAttribute('data-err', '1');
      ed.title = '存不进去：隐私模式或空间满了。别关页，换个浏览器或清出空间再试。';
      return;
    }
    ed.removeAttribute('data-err');
    ed.removeAttribute('title');
    ed.removeAttribute('data-dirty');
    if (VIEW_SNAP) { ed.textContent = '只读'; return; }
    /* ★2026-11-03（用户 m00984）：「左上角…就显示当前应用名称、版本号就行了」。
       这一行原来印「已存成 v2 · 1 家客户 · 都是最新」——三件事，全都只在别处才有动作
       （存版本在右上按钮、客户在客户授权页），读得到却做不了，等于噪声。
       现在只印一个版本号 = **最新存档版**（我刚存下的那版）；"客户在用哪版"一家客户
       一个答案，没有单一数字可写，所以不在这里说。
       只有两种状态才追加文字，因为它们是下一步动作的输入：
         · 内容和存档版不一致 → 「未保存」（该去点「保存新版本并发布」）
         · 写盘失败          → 「保存失败」（红字，上面已 early return）
       一版都没存过时印 v0：数据层里草稿的 version 就是 0，不另造一个词。 */
    var stables = DB.versOf('app', appId).filter(function (r) { return r.kind === 'stable'; });
    var top = stables.length
      ? stables.reduce(function (a, b) { return b.v > a.v ? b : a; }, stables[0])
      : null;
    var ver = 'v' + (top ? top.v : (app.version || 0));
    ed.removeAttribute('title');
    if (draftSession && draftSession.isDirty()) {
      ed.setAttribute('data-dirty', '1');
      ed.textContent = ver + ' · 未保存';
    } else {
      ed.textContent = ver + (readDraft() ? ' · 草稿' : '');
    }
  }

  /* ══ 3. 画布：装了什么就长什么样 ══════════════════════════════
     按组件身份分槽位（这也是"装配"看得见的地方）：
       应用头   → 屏幕顶部那条
       任务列表 → 整宽表格
       审批流   → 左列
       原文对照 / 逐条结论 / 任务详情 → 右列
     左列右列都有才是双栏；只有一边就是一列。 */
  /* 画布上的一块 = 应用自己的内容覆盖优先，没覆盖才回落到组件库。
     版本化只读视图再从快照里取，优先于应用当前内容。

     ★2026-10-28 修 E22（跨应用串味）：这里返回的 spec/config 必须是**副本**。
       修前：没有覆盖时 contentOf() 给的是 `DB.COMPS[i].spec` 本体，画布上的
       「加一列」直接 push 进去 ⇒ 给华信加一列，中金/国泰两家也白得一条幽灵列。
       现在 contentOf() 已深拷贝；快照这一路赋值时再拷一次，两层都不留共用引用。 */
  function effectiveComp(id) {
    var c = DB.contentOf(appId, id);
    if (!c) return null;
    var o = (VIEW_SNAP && VIEW_SNAP.content) ? VIEW_SNAP.content[id] : null;
    if (o) {
      if (o.name) c.name = o.name;
      if (o.spec !== undefined) c.spec = dc(o.spec);
      if (Array.isArray(o.fields)) c.fields = o.fields.slice();
      if (o.config !== undefined) c.config = dc(o.config);
    }
    return c;
  }
  function installedComps() {
    var ids = (VIEW_SNAP && Array.isArray(VIEW_SNAP.comps)) ? VIEW_SNAP.comps : app.comps;
    return ids.map(effectiveComp).filter(function (c) { return !!c; });
  }
  function isOn(id) {
    var ids = (VIEW_SNAP && Array.isArray(VIEW_SNAP.comps)) ? VIEW_SNAP.comps : app.comps;
    return ids.indexOf(id) >= 0;
  }

  /* ★2026-10-28：版面读组件自己的声明（full / left / right），不再按 id 认人。
     新生成的组件只要写 layout 就能落到正确位置。 */
  function slotOf(c) {
    var L = c.layout || 'full';
    if (L === 'left' || L === 'right' || L === 'full') return L;
    if (L === 'split') return 'right';       /* 旧值兼容 */
    return 'full';
  }
  function halves() {
    var l = 0, r = 0;
    installedComps().forEach(function (c) {
      if (c.id === 'app-header') return;
      var s = slotOf(c);
      if (s === 'left') l++; else if (s === 'right') r++;
    });
    return (l && r) ? 2 : 1;
  }

  /* ★ 2026-10-23：这里原本是 hardcode 的 [['初审',4],['复核',2],['终审',1]]，求和 7，
     而表格只有 5 行 —— 同一屏上「7 条待处理」和 5 行数据对不上，用户一眼就能看出来。
     病根不是数字写错，是**同一件事有两个数据源**：状态条数 STAGES，表格数 TASKS。
     现在只有一个来源 TASKS，其余全部派生。 */
  function stageRows() {
    var order = ['待我审', '已提交', '已完结'];
    var m = {};
    TASKS.forEach(function (r) { m[r[3]] = (m[r[3]] || 0) + 1; });
    return order.filter(function (k) { return m[k]; }).map(function (k) { return [k, m[k]]; });
  }

  /* ── 真实行数据 ──────────────────────────────────────────────
     ★ 2026-10-23：这三组数据是为了替掉原来满屏的 `.sk` 骨架条。
     原来 task-list 是 5 行 × 5 列 = 25 个灰条，整块看起来像"加载中"或"没做完"；
     `rule-panel`、`cmp` 也一样。用户问「是不是没有设计」，直接原因就是看到一页灰条。
     骨架条是**加载态**的视觉，不是内容 —— 原型要表达「装上之后长什么样」，就必须有真行。
     数据与 component.js 的 RULES 同源，不新编第二套口径。 */
  var TASKS = [   /* 4 行：5 行 × 65 的行高会让整张卡超过一屏，第一眼要能看到末尾那块 */
    ['DC-2026-1031', '债券承做',   '2.40 亿',  '待我审', '张启明'],
    ['DC-2026-1027', '债券承做',   '8,000 万', '待我审', '张启明'],
    /* 2026-10-26 修（盲审 v11 P1）：这一列是「处理人」，原来在其中两行填了「待分派」——
       一列两种语义（人名 + 状态词），扫一列人名的眼睛会被橙色截断。
       状态本来就有独立的列（「已提交」），所以这里只放人名。 */
    ['DC-2026-1019', '项目收益债', '1.20 亿',  '已提交', '李静'],
    ['DC-2026-1014', '债券承做',   '5,600 万', '已提交', '王立'],
    ['DC-2026-1008', '中登查重',   '—',        '已完结', '王立']
  ];
  var RULE_ROWS = [
    ['主体资格', '已通过', '第 2 页 3.1'],
    ['关联交易', '待复核', '第 5 页 4.2'],
    ['重大违法', '已驳回', '第 7 页 5.1']
  ];
  /* 状态词 → chip 色调。没有登记的走纯文本，不硬塞颜色。 */
  var TONE = { '已通过': 'done', '已完结': 'done', '已抽取': 'done', '已判定': 'done', '已读取': 'done',
               '待复核': 'wait', '待我审': 'wait', '待分派': 'wait', '已提交': 'wait',
               '已驳回': 'bad' };

  /* 卡头写"这一屏在审核什么"，不写应用名（顶栏已有）、不写布局技术名（工作台式/表单式）。
     ★ 「工作台式」这类词是研发侧的布局代号，用户不需要知道。同一类问题今天已经犯过一次
       （把应用名换成「工作台式」显示在卡片头上，等于用内部术语替掉了冗余文字）。 */
  var TITLE_OF = {
    'task-list': '审核任务', 'task-form': '任务信息', 'rule-panel': '规则结论',
    'task-detail': '任务详情', 'doc-extract': '文档抽取', 'verify-queue': '复核队列',
    'cmp-orig': '原文对照', 'flow-stat': '流程进度'
  };

  /* 卡头只写「这一屏在做什么」。应用名在顶栏，不再说第二遍；
     「装配 N 个组件」是内部话术（客户不关心你装了几个零件），也去掉。 */
  /* 这张"纸"的标题 = 这个应用叫什么。
     ★ 2026-10-23 改：原来取"第一个非应用头组件的名字"，于是页面标题会变成
       「文档抽取」「审核任务」这种**某个块的名字**。单块应用时凑巧能看，
       一旦一页里有三四个块（比如合同用印 + 文档抽取 + 规则结论），
       标题就变成了排在第一位的那块的名字，跟这一页到底是什么毫无关系。
       标题只有一个正确答案：这是哪个应用。 */
  function sheetTitle() {
    return (VIEW_SNAP && VIEW_SNAP.name) ? VIEW_SNAP.name : app.name;
  }

  /* 应用头的右侧只放客户名。
     ★ 2026-10-23：原来印着「已上架 · v2」——状态 + 版本号。这两样都是后台字段：
       状态是运营在组件库里管的，版本号是发布记录里的，跟"这个应用长什么样"无关。 */
  function sheetHead() {
    /* 应用头右侧：原来是"客户名"，但应用已经不挂客户了（一应用可授多家）。
       现在说家数；老快照里存过 client 的，仍按快照显示（预览历史版本要看当时的样子）。 */
    var who = '';
    if (VIEW_SNAP && VIEW_SNAP.client) who = VIEW_SNAP.client;
    else {
      try {
        var n = DB.authRows(app.id).filter(function (r) { return r.status === '已授权'; }).length;
        who = n ? n + ' 家客户' : '';
      } catch (e) {}
    }
    return '<div class="sheet-hd"><b>' + esc(sheetTitle()) + '</b>'
      + '<span class="right"><span class="who">' + esc(who) + '</span></span></div>';
  }

  function stripHtml(two) {
    /* 只有声明了 strip 的组件在场时才画这条汇总 —— 画布不认识业务，
       也不替任何组件做决定。没装任务池的应用就不该出现「审核中·N 条」。 */
    var hasStrip = installedComps().some(function (c) { return c.strip === true; });
    if (!hasStrip) return '';
    var rows = stageRows();
    var total = rows.reduce(function (n, r) { return n + r[1]; }, 0);
    var note = rows.map(function (r) { return r[0] + ' ' + r[1]; }).join(' · ');
    /* 单栏时不输出 .note：拆分只在双栏时才是事实。 */
    /* 评审 A-01：原来写"审核中 · N 条"，而 N 里夹着已完结的行 —— 数字对但话不对。
       现在分开说：多少条还在流转、一共多少条。 */
    var open = rows.filter(function (r) { return r[0] !== '已完结'; })
                   .reduce(function (s2, r) { return s2 + r[1]; }, 0);
    return '<div class="status"><i></i><b>' + open + ' 条待处理 · 共 ' + total + ' 条</b>'
      + (two ? '<span class="note">' + note + '</span>' : '')
      + '</div>';
  }

  /* ── 批量指派（2026-10-26）──────────────────────────────────────
     卡头写着「支持批量指派与转人工留痕」，而这张表原来一行都勾不动 ——
     界面承诺了、画面兑现不了。这里把「批量指派」落成三样看得见的东西：
       ① 首列复选框：表头全选、行内单选（只加这一列，不加行号、不加「操作」列）；
       ② 选中 ≥1 行时，表格上方浮出一条批量带：已选 N 条 · 批量指派 · 取消；
       ③ 点「批量指派」在这条带里展开选人（行内，不跳页），候选 = 表格里已有的人名去重。
     确认后处理人真的换人，整块重绘：勾选清空、批量带消失，另出一条「已指派 N 条」。
     ⚠ 选中态存在 sel 里、不是只看勾选框：画布是整块 innerHTML 重画的，
        DOM 一换勾选就没了；sel 跟着数据走，重画后仍对得上。 */
  var sel = {};            /* 任务编号 → true */
  var pickerOpen = false;  /* 选人区是否展开（只在有选中时有意义） */

  function assignees() {
    /* 候选只从表格里出现过的人名去重，不新编一个人 */
    var seen = {}, out = [];
    TASKS.forEach(function (r) {
      var n = r[4];
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }
  function selCount() { return Object.keys(sel).length; }

  /* 选人块的 HTML 只有一份（assets/ui-kit.js）。原来这里与 component.js 各存一份
     逐字相同的实现，改一处忘另一处 —— 本页只负责"候选是谁"，长什么样不归它管。 */

  /* 选中为 0 时这条带留在 DOM 里但 hidden —— 勾第一行的瞬间不需要重画整块，
     否则刚点中的复选框会被一杯新 DOM 换掉，焦点也跟着掉。 */
  function batchBar(n) {
    var open = pickerOpen && n > 0;
    return '<div class="tb-batch" id="tb-batch"' + (n ? '' : ' hidden') + '>'
      + '<b id="tb-batch-n">已选 ' + n + ' 条</b>'
      + '<button type="button" class="tb-batch-btn" id="tb-assign" aria-expanded="'
      + (open ? 'true' : 'false') + '">批量指派</button>'
      + '<button type="button" class="tb-batch-btn tb-batch-cancel" id="tb-cancel">取消</button>'
      + (open ? UIK.pickHtml(assignees()) : '')
      + '</div>';
  }

  function tableBlock(c, rows, note, lead, src) {
    /* rows=0 表示全部（slice(0,0) 是空数组，原来这里会静默渲染出空表） */
    /* 数据源由组件声明（block.src），不再按 id 猜。
       ★2026-10-28（A4）：生成出来的组件没有内置数据源可指，block 可以自带 rows ——
       内联数据优先，其次才回落到内置两份常量。没有这条，新业务组件装上去就是空表。 */
    var SRC = src || (c.block && c.block.src) || 'tasks';
    var inline = (c.block && Array.isArray(c.block.rows)) ? c.block.rows : null;
    var base = (inline && inline.length) ? inline : ((SRC === 'rules') ? RULE_ROWS : TASKS);
    var data = rows ? base.slice(0, rows) : base;
    /* 只有**声明了**任务池这个数据源的表才带复选框。
       生成出来的组件 block.src 是 null（数据是内联行），不能因为兜底值恰好是
       'tasks' 就给它套上批量勾选 —— 那不是任务池，勾了也没有可批量处理的对象。 */
    var declared = (c.block && c.block.src) || ((src === 'tasks' || src === 'rules') ? src : '');
    var canPick = !VIEW_MODE && declared === 'tasks' && !(inline && inline.length);
    var th = (canPick ? '<th class="tb-ck"><input type="checkbox" id="ck-all" aria-label="全选"></th>' : '')
      + c.fields.map(function (f) { return '<th>' + esc(f) + '</th>'; }).join('');
    var tr = data.map(function (r) {
      return '<tr>' + (canPick
        ? '<td class="tb-ck"><input type="checkbox" data-ck="' + esc(r[0]) + '"'
          + (sel[r[0]] ? ' checked' : '') + ' aria-label="选择 ' + esc(r[0]) + '"></td>'
        : '') + c.fields.map(function (_, i) {
        /* 值按"这一列在原始行数据里的位置"取；裁过列（v2 三列）时位置不再是 i */
        var src = (c.fieldSrc && c.fieldSrc[i] != null && c.fieldSrc[i] >= 0) ? c.fieldSrc[i] : i;
        var v = r[src] == null ? '—' : String(r[src]);
        var tone = TONE[v];
        return '<td>' + (tone
          ? '<span class="cond" data-k="' + tone + '">' + esc(v) + '</span>'
          : esc(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    /* 「v3 · 单栏列表」= 版本号 + 布局实现方式，都是研发概念，界面上不出现 */
    return '<section class="blk"><div class="blk-hd"><b>' + esc(c.name) + '</b>'
      + (note ? '<span>' + esc(note) + '</span>' : '') + '</div>'
      /* lead = 这块自己的汇总条（只有声明了 strip 的组件有）。放在块头之下、表格之上：
         它是这张卡自己的摘要，不是画布级横幅 —— 位置由 renderCanvas 决定，这里只负责落位。 */
      + (lead || '')
      + '<div class="blk-bd">' + (canPick ? batchBar(selCount()) : '')
      + '<table class="tb"><thead><tr>' + th + '</tr></thead>'
      + '<tbody>' + tr + '</tbody></table></div></section>';
  }

  /* 批量带的四条动作。监听挂在 document 上而不是 #canvas：
     画布每次重绘都换 innerHTML，document 一直在；判据是"点在不在画布里的那几件东西上"。 */
  function syncBatch() {
    var n = selCount();
    var bar = $('#tb-batch');
    if (!bar) return;
    if (!n && pickerOpen) {          /* 取消掉最后一行，选人区跟着收 */
      pickerOpen = false;
      renderCanvas();
      return;
    }
    bar.hidden = !n;
    var cnt = $('#tb-batch-n');
    if (cnt) cnt.textContent = '已选 ' + n + ' 条';
    var boxes = $$('#canvas input[data-ck]');
    var all = $('#ck-all');
    if (all && boxes.length) {
      all.checked = n === boxes.length;
      /* 半选：表头框既不是"全选"也不是"没选"，用浏览器原生三态说清 */
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }

  function pickRow(box) {
    var code = box.getAttribute('data-ck');
    if (box.checked) sel[code] = true; else delete sel[code];
    syncBatch();
  }

  function pickAll(box) {
    $$('#canvas input[data-ck]').forEach(function (b) {
      b.checked = box.checked;
      if (box.checked) sel[b.getAttribute('data-ck')] = true;
      else delete sel[b.getAttribute('data-ck')];
    });
    syncBatch();
  }

  /* 选人区一展开，焦点落到第一个候选上：键盘用户不用再 Tab 一圈找入口。
     焦点回填用 preventScroll —— 重绘会改页面高度，直接 focus 容易顺带滚一下。 */
  function focusAll() {
    var a = $('#ck-all');
    if (!a) return;
    try { a.focus({ preventScroll: true }); } catch (e) { a.focus(); }
  }

  function openPicker() {
    if (!selCount() || pickerOpen) return;
    pickerOpen = true;
    renderCanvas();
    var first = $('#tb-pick input[type="radio"]');
    if (first) first.focus();
  }

  function clearSel() {
    sel = {};
    pickerOpen = false;
    renderCanvas();
    focusAll();
  }

  function applyAssign() {
    var pick = $('#tb-pick input[name="tb-assignee"]:checked');
    if (!pick) return;
    var who = pick.value, n = 0;
    TASKS.forEach(function (r) { if (sel[r[0]]) { r[4] = who; n++; } });
    sel = {};
    pickerOpen = false;
    renderCanvas();                  /* 重绘后：处理人换人、勾选清空、批量带消失 */
    focusAll();
    hint('已指派 ' + n + ' 条');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#canvas')) return;
    if (t.id === 'ck-all') return pickAll(t);
    if (t.getAttribute('data-ck')) return pickRow(t);
    if (t.id === 'tb-assign') return openPicker();
    if (t.id === 'tb-cancel') return clearSel();
    if (t.id === 'tb-ok') return applyAssign();
  });
  /* 选中一个人之后「确定」才可用：先挑人、再确认，两步都不猜。 */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.name !== 'tb-assignee') return;
    var ok = $('#tb-ok');
    if (ok) window.UIK.setDisabled(ok, false);
  });

  function flowBlock(c) {
    var stageData = stageRows();
    var total = stageData.reduce(function (n, r) { return n + r[1]; }, 0);
    var bars = stageData.map(function (s) {
      var w = Math.round(s[1] / total * 100);
      return '<div class="flow-row"><span class="flow-nm">' + s[0] + '</span>'
        + '<span class="flow-bar"><i style="width:' + w + '%"></i></span>'
        + '<span class="flow-n">' + s[1] + '</span></div>';
    }).join('');
    return '<section class="blk"><div class="blk-hd"><b>' + esc(c.name) + '</b>'
      + '<span>按状态分组</span></div>'
      + '<div class="blk-bd"><div class="flow">' + bars + '</div></div></section>';
  }

  function cmpBlock(c) {
    /* 原文侧原来是 5 条不等宽的灰条（.sk）。那不是"原文"，是"假装有原文" ——
       换成法条式短句，两侧对照才看得出「抽取结果对应原文哪一段」。 */
    var bars = [
      '本次债券发行规模不超过人民币 20 亿元，期限不超过 5 年。',
      '由主承销商余额包销。',
      '发行人最近三年不存在重大违法行为。',
      '募集资金拟用于偿还到期债务及补充流动资金。'
    ].map(function (t) { return '<p class="orig">' + esc(t) + '</p>'; }).join('');
    var chips = c.fields.map(function (f) { return '<span class="fx">' + esc(f) + '</span>'; }).join('');
    return '<section class="blk"><div class="blk-hd"><b>' + esc(c.name) + '</b>'
      + '<span>原文 / 抽取结果</span></div>'
      + '<div class="blk-bd"><div class="cmp">'
      +   '<div class="cmp-side"><span class="lbl">原文</span>' + bars + '</div>'
      +   '<div class="cmp-side"><span class="lbl">抽取结果</span><div class="fx-wrap">' + chips + '</div></div>'
      + '</div></div></section>';
  }

  function detailBlock(c) {
    var ex = isOn('doc-extract'), rp = isOn('rule-panel');
    function chip(f) {
      if (f.indexOf('抽取') >= 0) return ex ? ['已抽取', 'done'] : ['未抽取', 'wait'];
      if (f.indexOf('结论') >= 0 || f.indexOf('规则') >= 0) return rp ? ['已判定', 'done'] : ['待人工', 'wait'];
      return ['已读取', 'done'];
    }
    /* ★ 2026-10-23：原来是一列「字段名 …… 状态」的细行，右边 60% 宽度全空，
       底部再挂一句「还没装抽取能力…」，整块看起来像没画完。
       改成三列表格：字段 / 状态 / 依据。宽度用满、信息对得上、缺能力这件事写在块头而不是压在底部。 */
    var rows = c.fields.map(function (f, i) {
      var r = chip(f);
      var ref = r[1] === 'done' ? ('第 ' + (i + 1) + ' 页') : '—';
      return '<tr><td>' + esc(f) + '</td>'
        + '<td><span class="cond" data-k="' + r[1] + '">' + r[0] + '</span></td>'
        + '<td class="ref">' + ref + '</td></tr>';
    }).join('');
    return '<section class="blk"><div class="blk-hd"><b>' + esc(c.name) + '</b>'
      /* ★2026-10-26 修：这句只看 ex（doc-extract），不看 rp（rule-panel）——
         于是 hx-zc 装上 rule-panel 之后，块里三行已有两行带依据页（已读取·第1页 / 已判定·第3页），
         小标题却还印「需人工补填」，自己打自己。改成两者都看，且分别说清缺哪半。 */
      + '<span>' + ((ex && rp) ? '逐条结论与依据'
                   : (rp ? '规则结论已判定，抽取待补'
                   : (ex ? '逐条结论与依据' : '需人工补填'))) + '</span></div>'
      + '<div class="blk-bd"><table class="tb tb-detail"><thead><tr>'
      + '<th style="width:40%">字段</th><th style="width:26%">状态</th><th>依据</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  /* 兜底渲染：既没有 AI 生成的结构（spec），也没有专用形态的组件，只把它有哪些字段列出来。
     这是最后一条路 —— 正常情况应该走 specBlock（AI 生成）或该组件自带的形态。 */
  function genBlock(c) {
    var chips = c.fields.map(function (f) { return '<span class="fx">' + esc(f) + '</span>'; }).join('');
    return '<section class="blk"><div class="blk-hd"><b>' + esc(c.name) + '</b></div>'
      + '<div class="blk-bd"><div class="fx-wrap">' + chips + '</div></div></section>';
  }

  /* 有 spec 的组件：按它自己的结构渲染，而不是走下面那些写死的函数。
     ★ 这一步是「对话式改效果」能成立的前提：只有组件的内容是数据（spec），
       模型才有东西可改；写死的 HTML 函数只能靠改代码，对话改不了。
     只要 sections，不要 page-hd —— 这块的标题由 .blk-hd 承担，
     再画一次页面标题就是同一句话在同一张卡里出现两遍。 */
  function specBlock(c, lead) {
    var out = Gen.renderComponent(c.spec);
    /* 块标题优先用 spec.title：用户说"把标题改成 X"就是改这个。
       用 c.name（组件名）的话，改完标题画布上看不出变化 —— 等于没改。 */
    var title = (c.spec && c.spec.title) ? c.spec.title : c.name;
    /* ★ 2026-10-23：块头原来右侧印着「v1 · 页面类」——版本号 + 内部类型。
       这两样在装配弹层里刚被用户点名删掉，这里又原样出现一次。
       同一类东西必须一次清干净：客户看这一块只想知道它是什么，不关心它是第几版、
       被归到哪个内部类别。 */
    return '<section class="blk" style="'+Gen.themeStyle(c.spec)+'"><div class="blk-hd"><b>' + esc(title) + '</b></div>'
      + (lead || '')
      + '<div class="blk-bd blk-bd--gen">' + out.sections.join('') + '</div></section>';
  }

  function blockFor(c, lead) {
    /* 优先级：模型生成的结构 > 组件自己声明的画法 > 老的按 id 兜底。
       第一条让"生成出来的新组件"能画；第二条让"人工建的组件"也能画；
       第三条只是兼容早期没有 block 的数据，新数据不该走到那里。 */
    if (c.spec && window.Gen) return specBlock(c, lead);
    var b = c.block || null;
    if (b && b.kind) {
      if (b.kind === 'table') return tableBlock(c, b.limit || 0, '', lead, b.src);
      if (b.kind === 'bars') return flowBlock(c);
      if (b.kind === 'chips') return cmpBlock(c);
      if (b.kind === 'detail') return detailBlock(c);
    }
    if (c.id === 'task-list') return tableBlock(c, 0, '', lead, 'tasks');
    if (c.id === 'rule-panel') return tableBlock(c, 3, '', lead, 'rules');
    if (c.id === 'verify-queue') return flowBlock(c);
    if (c.id === 'doc-extract') return cmpBlock(c);
    if (c.id === 'task-detail') return detailBlock(c);
    return genBlock(c);
  }

  /* 空态只有一套骨架，两个入口共用：一个组件都没装 / 只装了应用头。
     之前只装了应用头时，head 被吃掉后三个槽位全空，输出只剩头部 + 状态条 —— 整片白。 */
  function emptyHtml(title, desc) {
    /* 空态是"画布本来就该是空的"，不是"这里摆了一张卡"。
       不带 .blk：应用编辑页的空态也是纯空白，两边必须长一样。 */
    return '<section class="cv-empty">'
      + (title ? '<b>' + esc(title) + '</b>' : '')
      + '<p>' + esc(desc) + '</p>'
      /* ★2026-11-03（用户 m05606）：「直接说需求是什么意思？？有什么意义吗？
         点击有什么意义吗？」。它只是把焦点送回页面底部的输入框，等于让用户
         先点一下再打字，和直接点输入框完全重复；空态不再放这个按钮。 */
      + '</section>';
  }


  /* ── 画布上的组件边界（P0，2026-10-26）──────────────────────────
     每块外面一层：左侧 2px 品牌色竖条 + 一行「序号 · 组件名」+ hover 才出的操作组。
     改前这一屏只有两块没有边界、没有序号、没有卸下入口的白卡，页头却写着「装配组件 3」；
     第三块（应用头）长得和页面标题一模一样，用户看不出这个应用由哪几块组成、按什么顺序。
     默认态**不显示**操作组：一直是编辑器的样子，就不像"这个应用长什么样"的预览了。 */

  function frameBlock(c, inner, idx, total, isHead) {
    var num = ('0' + (idx + 1)).slice(-2);
    return '<section class="cv-blk' + (isHead ? ' cv-blk--head' : '') + '" data-comp="' + esc(c.id) + '" data-t="' + ((c.layout || 'full') === 'split' ? 'r' : 'f') + '">'
      + '<i class="cv-blk-bar" aria-hidden="true"></i>'
      + '<div class="cv-blk-hd">'
      +   '<span class="cv-blk-tag"><b>' + num + '</b> · ' + esc(c.name) + '</span>'
      /* ★2026-11-04（用户：「没有所谓的定制！！给我去掉『已单独改过』的小标」）：
         这个标已删。块头只留 序号·组件名 与操作组，不再给任何一块盖状态章。 */
      +   '<span class="cv-blk-ops" role="group" aria-label="' + esc(c.name) + ' 的操作">'
      /* 首块「上移」、末块「下移」置灰不隐藏：隐藏会让 hover 时整组宽度跳一下。 */
      +     '<button type="button" class="cv-op" data-move="up" data-id="' + esc(c.id) + '"' + (idx === 0 ? ' disabled' : '') + '>上移</button>'
      +     '<button type="button" class="cv-op" data-move="down" data-id="' + esc(c.id) + '"' + (idx === total - 1 ? ' disabled' : '') + '>下移</button>'
      +     '<button type="button" class="cv-op cv-op--off" data-remove="' + esc(c.id) + '">移除</button>'
      +   '</span>'
      /* ★2026-11-04（用户：「一并去掉啊」）：块头常驻的「改这一块」「改共用件 · 影响 N 家」
         两颗入口整组删除 —— 产品里没有"定制"这回事，块头只留 序号·组件名、上移/下移/卸下、⋯。 */
      /* 常驻的 ⋯（2026-10-26，盲审 P1）：操作带只在 hover 出，静态图/触屏上等于没有 ——
         没有它，「这一块能拆」只能靠猜去开装配面板。它不新造一套操作，只是把同一条
         操作带钉住不收起（data-open）。aria-expanded 说清当前是展开还是收起。
         ★2026-10-28：挪到「改这一块」右边 —— 主操作与「更多」现在是同一个右端操作簇，
           点开的带子就在它左边展开，不再隔着半个块头。 */
      +   '<button type="button" class="cv-blk-more" data-more="' + esc(c.id) + '"'
      +     ' aria-expanded="false" aria-label="' + esc(c.name) + ' 的更多操作">'
      +     '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">'
      +       '<circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle>'
      +     '</svg>'
      +   '</button>'
      + '</div>'
      + inner
      + '</section>';
  }

  /* 画布上的渲染顺序：应用头永远第一；双栏时整宽块 → 左列 → 右列；单栏时严格按装配顺序。
     这份列表同时是**编号**和**上移/下移**的唯一依据 —— 各算一次就会出现
     「标签写 03、按钮却把它当最后一块」这种错位。 */
  function visualList() {
    var comps = installedComps();
    var head = null, full = [], left = [], right = [];
    comps.forEach(function (c) {
      if (c.id === 'app-header') { head = c; return; }
      var s = slotOf(c);
      if (s === 'left') left.push(c);
      else if (s === 'right') right.push(c);
      else full.push(c);
    });
    var two = !!(left.length && right.length);
    var order = head ? [head] : [];
    if (two) order = order.concat(full, left, right);
    else order = order.concat(comps.filter(function (c) { return c.id !== 'app-header'; }));
    return { head: head, full: full, left: left, right: right, two: two, order: order };
  }

  function renderCanvas() {
    var cv = $('#canvas');
    if (!cv) return;
    /* 客户视图先判可见性，再谈渲染：未上线/已下架/版本不存在都只出一张说明，
       绝不回落到当前内容（否则"客户立刻打不开"是假的）。 */
    if (VIEW_MODE && viewBlocked) {
      cv.innerHTML = '<section class="cv-empty"><b>' + (viewMissing ? '这一版不存在' : '应用未上线') + '</b>'
        + '<p>' + (viewMissing ? '链接指向的版本不存在或已失效。' : '这个应用现在没有对客户开放。') + '</p></section>';
      return;
    }
    /* 整页系统＝画布本身铺满：不留左右边距、不套 1080 卡片、不留圆角。
       用户 2026-11-03：「无限画布是指背景画布的所有内容都可以铺满」。 */
    document.body.setAttribute('data-sys', 'off');
    var v = visualList();
    if (!v.order.length) {
      /* 「按业务长成页面」是内部话术（长成 = 生成）。客户听不懂，也不关心实现。
       空态要说的只有两件事：现在是什么、下一步做什么。 */
      /* ★2026-10-28 用户定调：空态只要一句话说清"有哪两种起步方式"，**不要示例句、不要模板**。 */
      cv.innerHTML = emptyHtml('这个应用还没有内容',
        '直接在下面说：谁用、要看到什么。页面会边问边生成。');
      return;
    }

    if (!v.full.length && !v.left.length && !v.right.length) {
      cv.innerHTML = emptyHtml('页面还差内容',
        '直接在下面说还缺哪几块，页面补上后你随时改。');
      return;
    }

    var total = v.order.length;
    var idx = {};
    v.order.forEach(function (c, i) { idx[c.id] = i; });
    /* ★ 2026-10-26（零上下文盲审 P2）：这条汇总原来画在 .sheet 上、夹在 01 与 02 两块中间，
       不在任何编号块内 —— 屏上读起来像应用头的一部分或画布级横幅，左侧编号竖线正好在它那里断开。
       它本来是「声明了 strip 的那个组件」自己的摘要，所以现在只交给那一块，落在它的卡内。
       没人声明 strip ⇒ strip 是空串，行为与改前一致。 */
    var strip = stripHtml(v.two);
    var part = function (c) {
      /* 整页系统（kind:'monitor'）：这本身就是应用界面，不再套「01 · 名称 / 改这一块」的编辑器壳。
         套壳会让它看起来仍是一堆可拆零件 —— 用户明确否定的正是这个模型。 */
      return frameBlock(c, blockFor(c, c.strip === true ? strip : ''), idx[c.id], total, false);
    };

    var html = '<div class="sheet">';
    if (v.head) html += frameBlock(v.head, sheetHead(), idx[v.head.id], total, true);
    html += '<div class="sheet-bd">';
    if (v.two) {
      html += v.full.map(part).join('')
        + '<div class="cols">'
        + '<div class="col">' + v.left.map(part).join('') + '</div>'
        + '<div class="col">' + v.right.map(part).join('') + '</div>'
        + '</div>';
    } else {
      html += v.order.filter(function (c) { return c.id !== 'app-header'; }).map(part).join('');
    }
    html += '</div></div>';
    /* 版本化只读视图的抬头：客户/评审一眼知道"这不是当前版"，并能一键回到当前版。
       没有内容快照的当前版也如实说一句，不假装看到了历史内容。 */
    if (VIEW_MODE && viewV) {
      html = '<div class="view-ver">'
        + '<b>只读 · v' + viewV + '</b>'
        + '<span>' + (viewMissing ? '这一版不存在，下面显示的是当前版本'
          : ((VIEW_SNAP && VIEW_SNAP.at) ? '发布于 ' + esc(VIEW_SNAP.at) : '')) + '</span>'
        + '<a href="app.html?id=' + encodeURIComponent(appId) + '&mode=view">回到当前版本</a>'
        + '</div>' + html;
    } else if (VIEW_MODE && VIEW_SNAP && !VIEW_SNAP.content) {
      html = '<div class="view-ver"><b>只读</b>'
        + '<span>这一版当时没有存内容，下面显示的是当前内容</span></div>' + html;
    }
    cv.innerHTML = html;
    /* ★2026-11-04（CANVAS 判据抓到的真洞）：装配里有块、但块渲染出来是空壳时（组件没有 spec/fields，
       只剩编号与名字），整屏正文不到 24 字也**没有空态引导** —— 用户点进去看着像没加载完。
       这里兜一层：画布没有 .cv-empty 且可见正文不足 24 字，就按「从零演示」的空态重画，
       保证「有内容」或「有引导」二者必居其一。 */
    (function () {
      if (cv.querySelector('.cv-empty')) return;
      var t = (cv.innerText || '').replace(/\s+/g, '').length;
      if (t >= 24) return;
      cv.innerHTML = emptyHtml('这个应用还没有内容', '直接在下面说：谁用、要看到什么。页面会边问边生成。');
    })();
  }

  /* 上移 / 下移：改的是装配顺序本身（app.comps 原地重排后落盘），不是只挪 DOM ——
     刷新之后顺序必须还在，否则"排过序"是假的。 */
  function moveComp(id, dir) {
    /* ★2026-11-01（用户：「上移是什么意思，画布赶紧改」）——根因在这里：
       原来按 visualList().order 算位置，而那个列表把 app-header **钉死在第一个**。
       于是一块被挪到应用头之前时，app.comps 真的变了、画布却按 visualList 重画，
       看起来一模一样 ⇒ 点了像没反应。
       现在按 app.comps 的真实顺序算；应用头是页面顶栏，不许被挪走、也不许有块挪到它上面。 */
    var ids = app.comps.slice();
    var i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    if (ids[i] === 'app-header' && dir > 0) {
      hint('应用头固定在最上面', { ms: 4000 }); return;
    }
    if (ids[j] === 'app-header' && dir < 0) {
      hint('不能挪到应用头上面', { ms: 4000 }); return;
    }
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    app.comps.length = 0;
    ids.forEach(function (x) { app.comps.push(x); });
    DB.save();
    renderCanvas();
    /* 重画之后把焦点还给这块的上移/下移按钮：原来重画完焦点掉回 body，
       连着按两次上移中间要重新 Tab 一段。 */
    var nb = document.querySelector('[data-move="' + id + '"]');
    if (nb && nb.focus) { try { nb.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* 卸下：画布上直接拆块，和装配面板里的「卸载」是同一条写入口（DB.uninstall），
     但它是"把应用拆开"的动作，所以先问一句，并写清可逆（随时能装回）。 */
  function removeComp(id) {
    var c = DB.contentOf(appId,id);
    if (!c) return;
    Confirm.ask({
      title: '移除「' + c.name + '」？',
      /* 拆块是不可撤销感的动作（客户那边立刻少一块），所以既说清"客户会怎样"，
         也说清"我能怎么回去" —— 两句话才能让人敢按。 */
      body: '从当前应用移除此内容？',
      ok: '移除',
      onOk: function () {
        DB.uninstall(appId, id);
        renderCanvas();
        paintApp();


        hint('已移除「' + c.name + '」');
      }
    });
  }

  /* 画布上的操作组：hover/focus 出组、点按钮改顺序、点卸下走确认。
     监听挂在 #canvas 上（canvas 元素本身不会被重绘替换，只有它的 innerHTML 会）。 */
  function bindCanvasOps() {
    var cv = $('#canvas');
    if (!cv || cv.getAttribute('data-ops') === '1') return;
    cv.setAttribute('data-ops', '1');
    var blockOf = function (t) { return t && t.closest ? t.closest('.cv-blk') : null; };
    cv.addEventListener('mouseover', function (e) {
      var el = blockOf(e.target);
      if (el) el.setAttribute('data-hov', '1');
    });
    cv.addEventListener('mouseout', function (e) {
      var el = blockOf(e.target);
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.removeAttribute('data-hov');
    });
    cv.addEventListener('focusin', function (e) {
      var el = blockOf(e.target);
      if (el) el.setAttribute('data-hov', '1');
    });
    cv.addEventListener('focusout', function (e) {
      var el = blockOf(e.target);
      if (el) el.removeAttribute('data-hov');
    });

    /* ── ⋯ 把操作带钉住（2026-10-26，盲审 P1）────────────────────
       hover 出带是快路，但静态图/触屏/第一次进来的人看不到它 —— 「拆一块」在那三处等于不存在。
       ⋯ 是常驻入口：点一下把这一块的操作带展开并保持，Esc / 点块外收起。
       展开的就是同一条带（不重复造按钮），所以这里只改 data-open 一个状态。 */
    var closeMore = function (keep) {
      $$('.cv-blk[data-open="1"]', cv).forEach(function (blk) {
        if (blk === keep) return;
        blk.removeAttribute('data-open');
        var m = blk.querySelector('.cv-blk-more');
        if (m) m.setAttribute('aria-expanded', 'false');
      });
    };
    cv.addEventListener('click', function (e) {
      var mo = e.target.closest ? e.target.closest('[data-more]') : null;
      if (!mo) return;
      var blk = blockOf(mo);
      if (!blk) return;
      var was = blk.getAttribute('data-open') === '1';
      closeMore(blk);
      if (was) {
        blk.removeAttribute('data-open');
        mo.setAttribute('aria-expanded', 'false');
      } else {
        blk.setAttribute('data-open', '1');
        mo.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      /* 装配抽屉开着时 Esc 归抽屉（它自己有一条关闭通道），这里不抢。 */
      if (document.body.getAttribute('data-drawer') === 'on') return;
      var open = $('.cv-blk[data-open="1"]', cv);
      if (!open) return;
      var m = open.querySelector('.cv-blk-more');
      open.removeAttribute('data-open');
      if (m) {
        m.setAttribute('aria-expanded', 'false');
        /* 必须 blur：焦点留在 ⋯ 上时 :focus-within 又把带子点亮，看起来像 Esc 没关。 */
        m.blur();
      }
    });
    document.addEventListener('click', function (e) {
      var open = $('.cv-blk[data-open="1"]', cv);
      if (!open || open.contains(e.target)) return;
      closeMore(null);
    });

    cv.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-move],[data-remove]') : null;
      if (!b || b.disabled) return;
      if (b.hasAttribute('data-remove')) { removeComp(b.getAttribute('data-remove')); return; }
      moveComp(b.getAttribute('data-id'), b.getAttribute('data-move') === 'up' ? -1 : 1);
    });
  }

  /* ══ 4. 三件浮层：对话条 / 操作组 / 装配胶囊 ══════════════════
     位置、尺寸、收起、拖动、键盘全在 assets/float.js 里定义一次。
     这里只接回调 —— 不再自己写条、按钮和收起逻辑（这类重复返工过四次）。 */
  var ui = null;

  /* ── 对话即装配：模型从**真实组件清单**里挑，代码执行装卸 ─────────
     改法（2026-10-23，用户原话「必须真实」）：
       旧：replyFor(text) 在页面里做关键词匹配，然后拼一句"去哪点哪个按钮"。
           它永远不会真的动页面 —— 那是话术，不是能力。
       新：这句话交给本机 WorkBuddy 的模型，它返回 {say, install, uninstall}，
           再由这里真正调用 DB.install / DB.uninstall 并重绘画布。
     为什么不让模型自己在界面上点：装配面板要先开面板、再找对那一行、再点按钮（三步链），
       任何一步找错就卡住（小智实测就卡在这里过）。结构化输出一步到位，而且可控 ——
       模型只能返回清单里的 id，别的会被过滤掉。
     失败显式：模型不通 / 没给 JSON / 结构不对，各说各的，画布一个像素不动。 */
  var genBusy = false;
  /* ★2026-11-06：忙碌态一处开关。除了内部标志，还要让浮条那颗键变「停止」——
     业内做法：跑的时候要能中断，而不是把人锁在外面等。 */
  function setGenBusy(on) {
    genBusy = !!on;
    if (ui && ui.setBusy) ui.setBusy(genBusy);
    syncReset();
  }
  /* 这一句正在改哪一块（P1-B）。失败时唯一要说的信息是"没改成什么"，
     所以在动手改之前把它记下来；没有目标（整页重排那一路）就留 null。 */
  var failTarget = null;

  /* 组件名是唯一身份（2026-10-25 修 B-02）：同一个组件在组件库卡上叫「客户标识」、
     在装配面板里叫「应用头」—— 两页对不上，用户会以为它是两个组件。
     label 是 10-23 之前"卡面用短名"的遗留字段，现在已经没有一处界面读它；
     对外一律取 name。 */
  function nameOf(id) {
    var c = DB.contentOf(appId,id);
    return c ? c.name : id;
  }

  /* ══ 结构指令：本地确定性执行（2026-10-27，独立盲审 P0-1）══════════════
     盲审实测：同一句「在规则结论表里加一列『触发规则』」跑三次，得到 4 种结构 ——
     3 行变 7/8 行、"关联交易"的结论从"待复核"变"进行中"、依据列有时变成《公司债审核问答》第 5 号。
     根因不是模型差，是**把确定性操作交给了模型**：加一列根本不需要重画整张表。
     所以：能确定性执行的先本地执行（只动 cols 与每行末位，行数一个字不改，跑几次都一样）；
     本地没把握的（改布局、改内容口径、跨块重组）才回模型。
     ⚠ 新列的值一律填「待补充」，不编数据 —— 编出来的结论会被客户当成真结论。 */
/* 2026-10-31：撤回栈（lastStruct）已随撤回功能一起删除。此处不再记录任何"可退回的一步"。 */

  function tablesOf(c) {
    return (c && c.spec && (c.spec.blocks || []).filter(function (b) { return b.type === 'table'; })) || [];
  }
  /* 表格的列有两个来源：组件库 spec 里的 table 块（生成器写的），和老数据里的 fields 数组。
     现盘 8 个组件 spec 都是 null、列全在 fields —— 只认 spec 的话「加一列」永远选不中目标组件，
     会静默落到模型那一路。统一成一个入口，两条路都能改。 */
  function colsOf(c) {
    var t = tablesOf(c);
    /* 只取第一个 table 块；残缺 spec（cols 不是数组）按"这条路走不通"处理，
       不许在 indexOf 处抛错把整条指令打断（盲审 BLIND-E33-20261028-01 第 9 条）。 */
    if (t.length && Array.isArray(t[0].cols)) return { kind: 'spec', cols: t[0].cols };
    if (c && Array.isArray(c.fields) && c.fields.length) return { kind: 'fields', cols: c.fields };
    return null;
  }
  function pickComp(text) {
    var cand = installedComps().filter(function (c) { return !!colsOf(c); });
    if (!cand.length) return null;
    var titleOf = function (c) { return (c.spec && c.spec.title) || c.name || ''; };
    var named = cand.filter(function (c) { return text.indexOf(titleOf(c)) >= 0 || (c.name && text.indexOf(c.name) >= 0); });
    if (named.length) return named[0];
    if (/规则/.test(text)) {
      var byKw = cand.filter(function (c) { return /规则/.test(titleOf(c)); });
      if (byKw.length) return byKw[0];
    }
    return cand.length === 1 ? cand[0] : null;
  }
  function applyStructCmd(text) {
    /* 撤回：只在本地栈里回退一步，不假装能回到任意历史版本 */
    if (/撤回|撤销|退回上一步|还原上一步/.test(text)) {
      /* 栈空时**不要**落到模型那一路：那样同一句「撤回」会去花一次模型调用，
         还可能被模型编出一个"撤回了"的假动作。明确说清"只有一步"。 */
      /* ★2026-10-31 用户明确：撤回这件事整个不要。原文：「没有任何一家 Agent 平台做这种撤回」
         「撤回一次是不是还要支持撤回好几步…撤回了之后是不是还有说再取消撤回」。
         这句只回一句话说清替代路径，**不落到模型那一路** —— 否则模型会编一个"已撤回"的假动作。 */
      return { msg: '这里没有撤回。要退到以前的样子，去「应用管理」这张卡的菜单 →「历史版本」点「替换」；不想留这次的改动，离开时选「不保存」。' };
    }
    var m = /(?:加|新增|增加|插入)\s*(?:一)?(?:列|栏)\s*[「"“]?([^」"”，,。\s]{1,12})[」"”]?/.exec(text);
    if (!m) return null;
    var col = String(m[1] || '').replace(/[列栏]$/, '');
    if (!col) return null;
    var c = pickComp(text);
    if (!c) return null;
    var src = colsOf(c);
    if (!src) return null;
    var ttl = (c.spec && c.spec.title) || c.name;
    if (src.cols.indexOf(col) >= 0) {
      return { msg: '「' + ttl + '」已经有「' + col + '」这一列了，这次没有改动。' };
    }
    var before = src.cols.length;
    var rows;
    var patch;
    if (src.kind === 'spec') {
      /* ★copy-on-write：在**副本**上改结构，改完只把副本存进本应用的内容层。
         修前这里直接 push(c.spec) —— c 就是共用件本体，三家一起长出一列（E22）。 */
      var next = dc(c.spec);
      var tbl = tablesOf({ spec: next })[0];
      tbl.cols.push(col);
      rows = (tbl.rows || []).length;
      (tbl.rows || []).forEach(function (r) { r.push('待补充'); });
      patch = { spec: next };
    } else {
      /* fields 模型：列就是表头数组，行是固定样例。新列只加表头、行里显示「—」，
         不往行里编数据（编出来的值会被客户当成真结论）。同样只改副本。 */
      var nf = c.fields.slice();
      nf.push(col);
      rows = 0;
      patch = { fields: nf };
    }
    /* 2026-10-31：这里原来往撤回栈（lastStruct）里记一步。栈已随撤回功能删除，
       **这一行也必须删** —— 严格模式下给未声明变量赋值会抛 ReferenceError，
       而它外面没有 try：整条"加一列"就断在这里，界面还标"成功"。
       删撤回时漏了这两处，就是靠盲审的走查抓出来的。 */
    /* 改动落在本应用的内容层：共用组件一个字不动，别家应用不受影响 */
    DB.setAppContent(appId, c.id, patch, false);
    DB.save();
    return {
      msg: '已给「' + ttl + '」加了一列「' + col + '」：列 ' + before + '→' + (before + 1)
        + (src.kind === 'spec'
          ? '，' + rows + ' 行各补了一格「待补充」，其余列没动。'
          : '，行里先显示「—」，其余列和所有行都没动。'),
      /* 屏幕上那条轻提示说的是一件事：刚刚加了什么、要不要退回 */
      bar: '已加一列：' + col
    };
  }

  function askModel(text) {
    if (genBusy) { hint('上一句还在处理，稍等', { ms: 2000 }); return; }
    if (!window.Gen) { hint('生成器没加载（assets/gen.js 不在）', { ms: 6000 }); return; }
    setGenBusy(true);
    failTarget = null;   /* 每次都说清"这一次在改什么"，别把上一句的目标带进这一句的失败里 */
    /* ★2026-11-06（用户截图：屏幕上浮出一条「在想…」）：这类进度提示一律撤掉。
       "正在处理"已经有三个就地反馈 —— 状态位「生成中」、输入条呼吸描边、发送键变停止方块，
       再朝画面扔一个浮条是重复，而且它长得像一条消息，最容易被当成 AI 说了句废话。
       tick 保留为空实现：下面 stopTick() 的调用点不改，避免再引一次漏清。 */
    var tick = null;
    var stopTick = function () { if (tick) { clearInterval(tick); tick = null; } };

    /* 先本地：确定性结构指令（加列 / 撤回）不花模型、不重造表、跑几次都一样 */
    var struct = applyStructCmd(text);
    if (struct) {
      stopTick();
      setGenBusy(false);
      DB.save();
      renderCanvas();
      paintApp();
      if (struct.undo) {
        /* E23：改完这一步，屏幕上就有一颗能按的「撤回」—— 不必再对着对话框说 */
        /* 浮条与消息只留一份：消息是持久的，浮条是重复。 */
        if (ui && ui.addMsg) ui.addMsg('cfg', struct.msg);
      } else {
        /* 同上：只保留下面那条消息。 */
        if (ui && ui.addMsg) ui.addMsg('cfg', struct.msg);
      }
      return;
    }

    var current = installedComps();
    var target = current.filter(function(c){return text.indexOf(c.name)>=0;})[0] || (current.length === 1 ? current[0] : null);
    Gen.componentSpec(text, { app:app.name, name:target ? target.name : app.name, fields:target ? target.fields : [], existing:target ? target.spec : null }).then(function(spec){
      if (!genBusy) return;
      (spec._abilityRefs || []).forEach(function(ref){ CAP.contextFor([ref.id]); });
      var id=target ? target.id : 'app-private-'+appId+'-'+Date.now().toString(36);
      var fields=Gen.specFields(spec);
      if (!target) {
        DB.COMPS.push({id:id,name:spec.title || app.name,fields:fields,spec:spec,status:'已上架',enabled:true,ver:'v1',layout:'full',refs:1});
        app.comps.push(id);DB.APP_COMPS[appId]=app.comps;app.compVer=app.compVer || {};app.compVer[id]='v1';
      }
      DB.setAppContent(appId,id,{name:spec.title || app.name,spec:spec,fields:fields},false);
      DB.save();renderCanvas();paintApp();setGenBusy(false);stopTick();
      if(ui && ui.addMsg)ui.addMsg('cfg',window.__genMode==='local' ? '已生成页面草稿（本地模板，未调用模型或业务接口）' : '改好了：'+(spec.title || app.name));
    }).catch(function (e) {
      setGenBusy(false);
      stopTick();
      /* ★2026-10-28 P1-B（体验盲审）：失败只给人话。
         改前这里把 e.message 原样印上屏，而 gen.js 的错误串里嵌着模型原文
         （「前 300 字：{…}」/「原样：{…}」/ 尾部原文），于是 4 次失败里有 1 次，
         用户就在界面上看到一坨 JSON —— 他既看不懂，也不知道自己的内容动没动。
         原文不是丢掉，是**不上面**：console.debug 与提示条 title（悬停才看到）留给排查。
         分类只认关键词，绝不回显原文里的任何片段（原文本身不可信）。 */
      var raw = String((e && e.message) || e || '');
      try { console.debug('[app] 这次失败的原因（只给排查，不上界面）', raw); } catch (err) {}
      /* ★2026-11-06：人点「停止」也会走到 catch（请求被 abort）—— 那不是失败，别按失败报。 */
      if (/abort/i.test(raw)) {
        hint('已经停下来了，这一版没动。', { ms: 6000 });
        if (ui && ui.addMsg) ui.addMsg('cfg', '已经停下来了，画布这一版没动。');
        return;
      }
      var bad = failWords(raw, failTarget);
      /* ★2026-11-06（同一条判断）：请求失败也不新开一条气泡 ——
         把那条消息标成没执行，原因用一条短提示说清，重试入口就在消息下面。 */
      if (ui && ui.failLast) ui.failLast();
      hint(bad, { ms: 8000, kind: 'err' });
    });
  }

  /* 把一句技术错误折成一句人话。**只认关键词，不回显原文**：
     模型有时会在错误串里塞进它自己写坏的 JSON，回显哪一段都可能带出来。 */
  function failWords(raw, target) {
    var why;
    if (/429|quota|额度|配额|rate.?limit/i.test(raw)) why = '模型额度用完了，等额度恢复再试';
    else if (/没回应|超时|timeout|AbortError/i.test(raw)) why = '模型 75 秒没回应';
    else if (/连不上|Failed to fetch|NetworkError|没起|不是 JSON/.test(raw)) why = '连不上本机的模型服务';
    else if (/没给出可用的 JSON|JSON 不完整|没法识别|没有可识别的块|不是对象/.test(raw)) why = '模型这次给的结果没法用';
    else why = '模型这次没做成';
    var head = target ? '没改成「' + target + '」' : '这一句没做成';
    return head + '：' + why + '。这次的内容一个字没动，可以点「再说一次」重试，或换个说法。';
  }

  function doPublish() {
    /* ★2026-10-31 用户纠正：没有「空应用」这个概念，也没有「通用组件」这个词。
       模块叫 AI 组件库，里面装的东西就叫组件。一个组件都不用的纯定制应用是常见形态，
       **直接保存即可，不拦、不提示。**
       （前两版我先后写过「空对象不可发布」「空应用可发布但提示未使用通用组件」，
         两个都是我自造概念的产物，已全部撤掉。） */
    /* ★2026-10-27 单一工作区模型：没有"发布草稿"这回事。
       当前画布已经自动保存；这一步只做一件事：把当前所有内容冻成不可变快照。
       所以问句说的是"保存哪一版、客户会看到什么"，不是"要不要发布草稿"。 */
    var next = topVer() + 1;
    /* ★2026-11-03（用户 m05120）：「保存新版本并发布」—— 存快照和让客户看到
       在这一颗按钮里完成，不再让用户存完再找授权页。 */
    Confirm.ask({
      title: '保存并发布 v' + next + '？',
      /* 2026-11-05：原来这句写「设为客户可见版本」—— 只对没有授权记录的访问者成立。
         已授权的客户看的是自己授权上的版本，得去「客户授权」推送才会跟上。 */
      body: '当前内容存为 v' + next + '，并设为这个应用当前的版本；'
        + '已授权的客户要升到 v' + next + '，得在「客户授权」里推送。',
      ok: '保存并发布',
      onOk: commitPublish
    });
  }

  /* 发布快照：不只存"装了哪几个组件"，还要存每一块当时的内容（spec/fields/config）。
     没有这一层，版本就只是一个号码：看不见、回不去，也证明不了客户当时看到什么。 */
  function namesOf(ids, content) {
    return (ids || []).slice(0, 2).map(function (id) {
      return (content && content[id] && content[id].name) ? content[id].name : id;
    }).join('、');
  }
  function summarizeSnap(prev, next) {
    var comps = next.comps || [];
    if (!prev || !prev.comps) return '首版：' + comps.length + ' 块';
    var added = comps.filter(function (id) { return prev.comps.indexOf(id) < 0; });
    var removed = (prev.comps || []).filter(function (id) { return comps.indexOf(id) < 0; });
    /* ★2026-10-31（盲审抓出）：原来只比"增/删/改标题/字段数"，不比**顺序**。
       实测把某块上移之后存版，装配顺序确实变了，摘要却写「内容无变化」——
       版本列表于是答不出"这一版到底改了什么"，而它存在的唯一理由就是回答这个。 */
    var moved = 0;
    var common = comps.filter(function (id) { return prev.comps.indexOf(id) >= 0; });
    var prevCommon = (prev.comps || []).filter(function (id) { return comps.indexOf(id) >= 0; });
    for (var mi = 0; mi < common.length; mi++) {
      if (common[mi] !== prevCommon[mi]) { moved++; }
    }
    var titleChanges = 0, fieldDelta = 0;
    comps.forEach(function (id) {
      var a = prev.content && prev.content[id], b = next.content && next.content[id];
      if (!a || !b) return;
      var ta = (a.spec && a.spec.title) || a.name || '';
      var tb = (b.spec && b.spec.title) || b.name || '';
      if (ta !== tb) titleChanges++;
      fieldDelta += ((b.fields || []).length - (a.fields || []).length);
    });
    var bits = [];
    if (added.length) bits.push('新增 ' + added.length + ' 块（' + namesOf(added, next.content) + '）');
    if (removed.length) bits.push('去掉 ' + removed.length + ' 块（' + namesOf(removed, prev.content) + '）');
    if (moved) bits.push('调了 ' + moved + ' 块的顺序');
    if (titleChanges) bits.push('改标题 ' + titleChanges + ' 处');
    if (fieldDelta) bits.push('字段 ' + (fieldDelta > 0 ? '+' : '') + fieldDelta);
    if (!bits.length) bits.push('内容无变化');
    return bits.join(' · ');
  }

  function commitPublish() {
    /* 2026-10-26：发布改成"把当前内容冻成一个正式版并启用"。
       2026-10-27：冻结的内容不再只有组件 id，而是每一块的 spec/fields/config 快照；
       同时算一句人话摘要和内容指纹，会话里那张改动卡直接用它。 */
    var prevRec = DB.versActive('app', appId);
    var prevSnap = prevRec ? prevRec.snap : null;
    var content = DB.resolveContent(appId);
    var snap = {
      comps: (app.comps || []).slice(), name: app.name, desc: app.desc, client: app.client,
      content: content, contentHash: DB.hash(content), at: today(),
      /* ★2026-11-01（用户：「什么叫保存人，最后编辑人不行吗」）：
         就叫**最后编辑人**，而且必须真的写进去 —— 原来快照里根本没这个字段，
         版本页只能显示「—」，等于这一栏从来没工作过。 */
      editor: DB.editor()
    };
    snap.summary = summarizeSnap(prevSnap, snap);
    /* ★2026-10-31：versPublish → versSave。存一版不再顺手把客户看到的换掉，
       客户的版本只由「客户授权」页的那一个升级动作改（见 00e-版本与授权模型）。 */
    var v = DB.versSave('app', appId, snap, today());
    if (!v) {
      hint('没保存上，内容还在', { kind: 'err', ms: 9000 });
      return;
    }
    var published = DB.versActivate('app', appId, v);
    if (!published) {
      hint('版本存下了但没发布；去「客户授权」启用 v' + v, { kind: 'err', ms: 9000 });
      return;
    }
    app.updated = today();
    if(!clearDraft()){paintApp();renderCanvas();return;}
    /* 发布＝已经生效：之前那些"还能退回旧版本"的入口一起作废（发布后不可退）。 */
    app.updUndo = {};
    DB.save();
    /* ★ 2026-10-25 修 F04：发布后只调了 renderCanvas()，没调 paintApp() ——
       画布刷新了，但顶栏那行 meta 还挂着「草稿」。DB 已经改了，界面没跟着改。 */
    paintApp();
    renderCanvas();
    /* ★2026-11-05：原来这里写「客户现在看到的是这一版」—— 不成立。
       发布只换掉应用的启用版本；每家客户看到的是自己授权记录上的版本，
       没在「客户授权」升级过的客户还停在旧版（这正是"前滚"要接上的那一环）。 */
    var behindN = (DB.authsOfApp(appId) || []).filter(function (a) {
      return (a.status || '已授权') === '已授权' && (a.version || 0) < v;
    }).length;
    hint(behindN
      ? ('已发布 v' + v + ' · 还有 ' + behindN + ' 家客户在用旧版本，去「客户授权」推送')
      : ('已保存并发布 v' + v + ' · ' + ((DB.authsOfApp(appId) || []).length ? '客户看到的都是这一版' : '还没有客户授权')), { ms: 9000 });
    /* 会话里留一张可回看的改动卡：版本号 + 一句人话 + 内容指纹 + 两个动作。
       这不是装饰 —— 没有它，用户发完就只剩一句 toast，过十分钟就找不到那一版。 */
    if (ui && ui.addCard) {
      ui.addCard({
        v: v, at: today(), summary: snap.summary, hash: snap.contentHash,
        viewHref: 'app.html?id=' + encodeURIComponent(appId) + '&v=' + v + '&mode=view',
        /* 客户地址：不是给本机看的相对路径，而是"复制到手机上能打开"的完整地址。
           发布后全站原来只有"已发布 vN"一句话 —— 用户拿不到要发给客户的链接。 */
        url: new URL('app.html?id=' + encodeURIComponent(appId) + '&mode=view&v=' + v, location.href).href,
        /* 前滚闭环的入口：发完就告诉你还有几家没跟上，点一下就到推送那一页。
           没有这一行，"发布完等于完成"这个错觉会一直留着。 */
        push: behindN ? { n: behindN, href: 'client-auth.html?id=' + encodeURIComponent(appId) } : null
      });
      if (ui.setCollapsed) ui.setCollapsed(false);
    } else if (ui && ui.addMsg) {
      ui.addMsg('cfg', '已保存为 v' + v + '：' + snap.summary);
    }
  }

  /* 从会话改动卡回到某一版：**只还原内容，不动客户看到的版本**（00e）。
     ★2026-10-31 盲审抓出来的矛盾：这里原来调 versApply 不带 keepActive，
       于是"恢复此版"会顺手把客户切换过去，确认框还写着"客户会立刻看到" ——
       跟历史版本页的「替换」（只还原内容、明说客户不受影响）是完全相反的。
       同一个意思，客户侧结果相反，是最不该有的那种不一致。 */
  function restoreVersion(v) {
    var want = parseInt(v, 10);
    var rec = DB.versOf('app', appId).filter(function (r) {
      return r.kind === 'stable' && r.v === want;
    })[0];
    if (!rec) { hint('找不到 v' + want, { kind: 'err', ms: 6000 }); return; }
    if (!rec.snap || !rec.snap.content) {
      hint('v' + want + ' 没有内容快照，只能切版本号，内容无法还原', { kind: 'err', ms: 9000 }); return;
    }
    var actNow = DB.versActive('app', appId);
    Confirm.ask({
      title: '把画布内容换成 v' + want + '？',
      body: '画布换成 v' + want + '，未保存的改动会丢。' +
        '客户不受影响，仍看 v' + (actNow ? actNow.v : '—') + '；需在「客户授权」升级后才可见。',
      ok: '换成 v' + want,
      onOk: function () {
        var r = DB.versApply('app', appId, want, true);   /* keepActive：不换客户版本 */
        if (!r) {
          hint('没换成，内容没动', { kind: 'err', ms: 9000 });
          return;
        }
        paintApp();
        renderCanvas();

        /* 同上：这条信息已经写在下面的消息里，浮条是重复。 */
        if (ui && ui.addMsg) ui.addMsg('cfg', '画布已换成 v' + want + '（授权版本仍是 v' + (actNow ? actNow.v : '—') + '）。');
      }
    });
  }

  if (window.Float) {
    ui = Float.mount({
      /* 人点浮条上的「停止」：掐断当前这次模型调用。 */
      onStop: function () { try { if (window.Gen && Gen.abort) Gen.abort(); } catch (e) {} },
      dialog: {
        placeholder: '请输入你的想法💡',
        /* ★2026-10-28 P1-A：发一句话的时候 float.js 会先把自己的「我」那条写进历史并从 msgs
           整块重绘 —— 会话里那条「撤回」记录会被一起擦掉，而模型要跑几秒到几十秒，
           这段时间里用户就找不到它了。所以进 onSend 时先补回来（补的是同一步，不是新一步）。 */
        onSend: function (t) { askModel(t); }
      },
      /* 会话历史按应用分开：否则 A 应用的改动卡会出现在 B 应用里，
         点「恢复此版」只会得到「找不到 vN」 */
      historyKey: 'ifas90:hist:app:' + appId,
      /* 历史卡上的版本号先向台账核一次：不在了就不再给「查看/恢复」的假入口（2026-11-02） */
      versionExists: function (v) {
        return (DB.versOf('app', appId) || []).some(function (r) {
          return r.kind === 'stable' && r.v === parseInt(v, 10);
        });
      },
      /* 会话改动卡的「恢复此版」回到这里：先确认，再应用快照 */
      onRestore: restoreVersion,
      /* ops / chip 都不再传给 Float：三个动作已收到顶栏（见 app.html .topbar）。
         右下角只留小智一个球 —— 两矩形+圆球挤在同一角，是上一版最难看的地方。 */
    });

    /* ── 会话里那条「撤回」记录的两处接线（P1-A，2026-10-28）────────────
       ① 会话卡就在 #fk-hist-list 里。历史由 float.js 整块重绘（innerHTML = msgs…），
          所以**每次写消息之后再补一次**，而不是只在生成那一刻插一次（插一次会被下一次
          addMsg 擦掉，而且不报错 —— 正是"看起来还在、其实早没了"那类缺陷）。
       ② 点它和点提示条上那颗，进的是同一个 undoFromBar()：一处实现，一套状态。 */

    /* 顶栏三个动作：与右下浮球分离，各归其位 */
    /* 浮层在场时给 body 打标记，画布据此让出一条底边（见 app.html body[data-float]） */
    document.body.setAttribute('data-float', 'on');
    /* ★2026-11-03（m05120）：开关放在对话框**旁边**，不是塞进输入条里。
       样式是真正的开关（文字 + 轨道 + 圆点），收起后顶栏和整条对话框一起消失，
       开关自己留在原位，所以不需要另一颗「显示操作」按钮。 */
    var opsSwitch = document.createElement('button');
    opsSwitch.type = 'button';
    opsSwitch.id = 'ops-switch';
    opsSwitch.className = 'ops-switch';
    opsSwitch.setAttribute('role', 'switch');
    opsSwitch.setAttribute('aria-checked', 'false');
    opsSwitch.innerHTML = '<span class="ops-switch-label">隐藏操作</span>' +
      '<span class="ops-switch-track" aria-hidden="true"><span class="ops-switch-knob"></span></span>';
    document.body.appendChild(opsSwitch);
    var opsLabel = opsSwitch.querySelector('.ops-switch-label');
    function setOps(off) {
      if (off) document.body.setAttribute('data-ops', 'off');
      else document.body.removeAttribute('data-ops');
      opsSwitch.setAttribute('aria-checked', off ? 'true' : 'false');
      opsLabel.textContent = off ? '显示操作' : '隐藏操作';
    }
    opsSwitch.addEventListener('click', function () {
      setOps(document.body.getAttribute('data-ops') !== 'off');
    });

    on('#act-publish', 'click', doPublish);
    on('#act-draft', 'click', saveDraft);
    on('#act-reset','click',resetDraft);
    syncReset();
    // Leaving the editor saves the same draft as the toolbar; publishing is explicit.
    var backBtn = $('#act-back');
    if (backBtn) backBtn.addEventListener('click', function (e) {
      if (VIEW_MODE || !draftSession.isDirty()) return;
      e.preventDefault();
      Confirm.ask({
        title:'保存草稿后退出？',
        body:'当前修改尚未保存。',
        ok:'保存草稿并退出',
        cancel:'不保存并退出',
        onOk:function(){
          if(!saveDraft())return;
          location.href='app-manage.html';
        },
        onCancel:function(){
          applySnap(draftSession.savedSnapshot(),false);
          if(DB.save()===false){hint('修改未能还原，请重试',{kind:'err',ms:9000});return;}
          location.href='app-manage.html';
        }
      });
    });
    on('#act-available', 'click', function () { openAvailableAbilities(); });

    /* 存一次通知一次：谁在存、存成没成，界面不该靠轮询猜 */
    DB.onSave = function (ok) { paintSaveState(); };

    /* 起步句：点一下把话填进对话条并聚焦，由人自己按发送 —— 不替人做主。 */
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-say]');
      if (!b) return;
      var ta = $('#fk-input');
      if (!ta) return;
      ta.value = b.getAttribute('data-say');
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (err) {}
    });
  } else {
    console.error('[app] assets/float.js 没加载：对话条或操作组不可用');
  }

  /* 旧装配/组件联动升级流程已删除；旧链接参数不再触发动作。 */
  function stripEntryParams(){
    var u=new URL(location.href);['panel','updates','tab'].forEach(function(k){u.searchParams.delete(k);});
    history.replaceState(null,'',u.pathname+u.search+u.hash);
  }

  /* ══ 7. 起手 ═════════════════════════════════════════════════ */
  bindCanvasOps();
  paintApp();

  renderCanvas();

  if (!VIEW_MODE) stripEntryParams();
})();
