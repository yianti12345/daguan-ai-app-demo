/* ─────────────────────────────────────────────────────────────
   app.js —— 应用配置页（app.html）：一块画布 + 一条底部悬浮条 + 一个装配面板。

   三块职责：
     画布   = 这个应用现在长什么样。装了什么就长什么，卸掉就少一块。
     悬浮条 = 说一句改这个应用；装配组件 / 保存 / 发布。整条可拖，位置落 localStorage。
     面板   = 装配组件（照 VS Code Extensions 的结构：头部 + 独占一行搜索 + 两个平文本切段
              + 56 行列表，右侧三态都在行内变化，没有「完成/取消」，没有 toast）。

   数据全在 window.DB（assets/data.js），拖动全在 window.Draggable（assets/drag.js）。
   本文件不存组件副本，也不自己算"装了几个" —— 只问 DB。
   ───────────────────────────────────────────────────────────── */
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
    document.title = (app ? app.name : '应用');
  }

  if (!app) {
    var why = appId ? 'miss=1' : 'pick=1';
    try { location.replace('apps.html?' + why); } catch (e) {}
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
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
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
    var snap = {
      name: app.name, desc: app.desc, comps: app.comps.slice(),
      content: DB.resolveContent(appId), at: today()
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snap));
      hint('草稿已保存 · 下次进来还是这份内容', { ms: 5000 });
    } catch (e) {
      hint('草稿没存上：这台电脑写不进去', { kind: 'err', ms: 9000 });
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
  function paintApp() {
    var shownName = (VIEW_SNAP && VIEW_SNAP.name) ? VIEW_SNAP.name : app.name;
    $$('[data-bind="app-name"]').forEach(function (n) { n.textContent = shownName; });
    /* ★2026-11-04（用户：「应用配置详情左上角也加一行介绍，太长能点开看全部」）。 */
    var hdDesc = $('#app-desc');
    if (hdDesc) {
      var dTxt = (VIEW_SNAP && VIEW_SNAP.desc) ? VIEW_SNAP.desc : (app.desc || '');
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
    if (pub) pub.textContent = '保存新版本并发布';
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
    var ed = $('#app-edit');
    if (!ed) return;
    /* 写盘失败优先：先报"没存上"，版本关系等写盘恢复了再说 */
    if (DB.lastSaveOk === false) {
      ed.textContent = '保存失败';
      ed.setAttribute('data-err', '1');
      ed.title = '本机存储写不进去（隐私模式或空间满了）。别关页；换个浏览器或清出空间后再改。';
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
    if (top && !sameAsSnap(top.snap)) {
      ed.setAttribute('data-dirty', '1');
      ed.textContent = ver + ' · 未保存';
      ed.title = '当前内容和 v' + top.v + ' 不一样，点「保存新版本并发布」才会存下来并让客户看到。';
    } else {
      ed.textContent = ver;
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
    return '<section class="blk"><div class="blk-hd"><b>' + esc(title) + '</b></div>'
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
       不带 .blk：组件配置页的空态也是纯空白，两边必须长一样。 */
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
      +     '<button type="button" class="cv-op cv-op--off" data-remove="' + esc(c.id) + '">↓卸下</button>'
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
      hint('应用头是页面顶栏，固定在最上面，不能往下挪', { ms: 4000 }); return;
    }
    if (ids[j] === 'app-header' && dir < 0) {
      hint('应用头是页面顶栏，别的块不能挪到它上面', { ms: 4000 }); return;
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
    var c = DB.compById(id);
    if (!c) return;
    Confirm.ask({
      title: '卸下「' + c.name + '」？',
      /* 拆块是不可撤销感的动作（客户那边立刻少一块），所以既说清"客户会怎样"，
         也说清"我能怎么回去" —— 两句话才能让人敢按。 */
      body: '卸下后客户立刻看不到这一块，可随时从装配面板装回。',
      ok: '卸下',
      onOk: function () {
        DB.uninstall(appId, id);
        renderCanvas();
        paintApp();
        paintCounts();
        renderList();
        hint('已卸下「' + c.name + '」，画布上少了一块');
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
  /* 这一句正在改哪一块（P1-B）。失败时唯一要说的信息是"没改成什么"，
     所以在动手改之前把它记下来；没有目标（整页重排那一路）就留 null。 */
  var failTarget = null;

  /* 组件名是唯一身份（2026-10-25 修 B-02）：同一个组件在组件库卡上叫「客户标识」、
     在装配面板里叫「应用头」—— 两页对不上，用户会以为它是两个组件。
     label 是 10-23 之前"卡面用短名"的遗留字段，现在已经没有一处界面读它；
     对外一律取 name。 */
  function nameOf(id) {
    var c = DB.compById(id);
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

  function ownSnap(compId) {
    var a = DB.appById(appId);
    var own = (a && a.content && a.content[compId]) || null;
    return own ? dc(own) : null;
  }
  function sharedSnap(compId) {
    var c = DB.compById(compId);
    return (c && c.spec !== undefined) ? dc(c.spec) : null;
  }

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
    var prevOwn = ownSnap(c.id);
    var prevShared = sharedSnap(c.id);
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
    genBusy = true;
    failTarget = null;   /* 每次都说清"这一次在改什么"，别把上一句的目标带进这一句的失败里 */
    hint('在想…', { ms: 1200 });
    /* 进度可见：本地模型单次响应 2–60 秒都有，没有进度的话用户看到的是
       "说完了，没反应"。每 3 秒报一次已等时长 —— 它不是装饰，是这个通道慢的唯一交代。
       结束（成功或失败）统一在 finallyStep 里清掉，不许漏。 */
    var t0 = Date.now();
    var tick = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      hint('正在按你说的做…已等 ' + s + ' 秒', { ms: 4000 });
    }, 3000);
    var stopTick = function () { if (tick) { clearInterval(tick); tick = null; } };

    /* 先本地：确定性结构指令（加列 / 撤回）不花模型、不重造表、跑几次都一样 */
    var struct = applyStructCmd(text);
    if (struct) {
      stopTick();
      genBusy = false;
      DB.save();
      renderCanvas();
      paintApp();
      if (struct.undo) {
        /* E23：改完这一步，屏幕上就有一颗能按的「撤回」—— 不必再对着对话框说 */
        hint(struct.bar, { ms: 8000 });   /* 2026-10-31：撤回已删，提示条只报事实 */
        if (ui && ui.addMsg) ui.addMsg('xz', struct.msg);
      } else {
        hint(struct.msg, { ms: 9000 });
        if (ui && ui.addMsg) ui.addMsg('xz', struct.msg);
      }
      return;
    }

    var comps = DB.COMPS.map(function (c) {
      return {
        id: c.id, name: c.name, status: c.status, installed: isOn(c.id),
        /* 带上"当前标题"，模型在选 edit 目标时能对上用户说的名字 */
        title: (c.spec && c.spec.title) || c.name
      };
    });

    Gen.appPlan(text, { app: app.name, comps: comps }).then(function (plan) {
      var did = [];
      plan.uninstall.forEach(function (id) { if (DB.uninstall(appId, id)) did.push('卸下 ' + nameOf(id)); });
      plan.install.forEach(function (id) { if (DB.install(appId, id)) did.push('装上 ' + nameOf(id)); });
      if (did.length) {
        paintApp(); renderCanvas(); genBusy = false; stopTick();
        if (ui && ui.addMsg) ui.addMsg('xz', plan.say || ('已' + did.join('、')));
      }
      /* ── 改某一块的呈现 ──
         模型只负责说"改哪个、怎么改"，真正重画走 Gen.componentSpec
         （和组件配置页同一套生成 + 版式契约），改完存回 DB 并重绘。
         ★ 这里原来没有这条路：对话只能装/卸，说"把标题改一下"会得到"这句我没听出要改哪里"。
           实测就是这么回事 —— 应用配置页不能对话改效果，只能换模块。 */
      if (plan.edit && plan.edit.id) {
        var target = DB.contentOf(appId, plan.edit.id);
        if (target) {
          /* 改前先留一份原样：这一步也要能在屏幕上退回（E23）。
             prevOwn = 改前本应用有没有自己的覆盖；prevShared = 组件库里的底。 */
          var editPrevOwn = ownSnap(target.id);
          var editPrevShared = sharedSnap(target.id);
          hint('正在改「' + target.name + '」…', { ms: 1200 });
          /* 失败时要说清"没改成什么" —— 目标名字在这里就能确定，别等到 catch 里再猜 */
          failTarget = target.name;
          return Gen.componentSpec(plan.edit.ask || text, {
            app: app.name, name: target.name, fields: target.fields || []
          }).then(function (spec) {
            var newFields = Gen.specFields(spec).length ? Gen.specFields(spec) : target.fields;
            /* 改的是本应用这一块，不是共用组件 —— 否则三家一起变 */
            DB.setAppContent(appId, target.id, {
              name: spec.title || target.name, spec: spec, fields: newFields
            }, false);
            var newName = spec.title || target.name;
            /* 2026-10-31：同上 —— 撤回栈已删，这里的赋值一并去掉（否则 ReferenceError 打断整条编辑）。 */
            DB.save();
            renderCanvas();
            genBusy = false;
            stopTick();
            /* 提示只说已完成的事实，不复述模型那句 say ——
               模型爱说"我准备把…改成…"（将来时），而后半句已经在说"已更新"，
               两句放一起自相矛盾。 */
            var done = '改好了：' + newName;
            hint('已改「' + newName + '」', { ms: 8000 });
            if (ui && ui.addMsg) ui.addMsg('xz', done);
          });
        }
      }
      if (did.length) return;
      genBusy = false;
      stopTick();
      var say = plan.say || '这句我没听出要改哪里。可以说"把某一块的标题改成…"或"只显示待复核的行"。';
      hint(say, { ms: 9000 });
      if (ui && ui.addMsg) ui.addMsg('xz', say);
    }).catch(function (e) {
      genBusy = false;
      stopTick();
      /* ★2026-10-28 P1-B（体验盲审）：失败只给人话。
         改前这里把 e.message 原样印上屏，而 gen.js 的错误串里嵌着模型原文
         （「前 300 字：{…}」/「原样：{…}」/ 尾部原文），于是 4 次失败里有 1 次，
         用户就在界面上看到一坨 JSON —— 他既看不懂，也不知道自己的内容动没动。
         原文不是丢掉，是**不上面**：console.debug 与提示条 title（悬停才看到）留给排查。
         分类只认关键词，绝不回显原文里的任何片段（原文本身不可信）。 */
      var raw = String((e && e.message) || e || '');
      try { console.debug('[app] 这次失败的原因（只给排查，不上界面）', raw); } catch (err) {}
      var bad = failWords(raw, failTarget);
      hint(bad, {
        /* ★2026-10-28 E45：原来把模型原始报错挂到 title 上（悬停可见）。原文只该给排查，
           已经 console.debug 过了；界面上一律只给人话。 */
        ms: 10000, kind: 'err',
        /* 可重试入口就在这一句旁边：重试的是同一句话，不用再打一遍 */
        action: { label: '再说一次', run: function () { askModel(text); } }
      });
      if (ui && ui.addMsg) ui.addMsg('xz', bad);
    });
  }

  /* 把一句技术错误折成一句人话。**只认关键词，不回显原文**：
     模型有时会在错误串里塞进它自己写坏的 JSON，回显哪一段都可能带出来。 */
  function failWords(raw, target) {
    var why;
    if (/没回应|超时|timeout|AbortError/i.test(raw)) why = '模型 75 秒没回应';
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
      body: '当前内容存为 v' + next + '，并设为客户可见版本；旧版本仍可回退。',
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
      hint('没保存上：这台电脑写不进去，当前内容还在', { kind: 'err', ms: 9000 });
      return;
    }
    var published = DB.versActivate('app', appId, v);
    if (!published) {
      hint('版本存下了，但没能发布；去「客户授权」页手动启用 v' + v, { kind: 'err', ms: 9000 });
      return;
    }
    app.updated = today();
    clearDraft();
    /* 发布＝已经生效：之前那些"还能退回旧版本"的入口一起作废（发布后不可退）。 */
    app.updUndo = {};
    justUpd = {};
    DB.save();
    /* ★ 2026-10-25 修 F04：发布后只调了 renderCanvas()，没调 paintApp() ——
       画布刷新了，但顶栏那行 meta 还挂着「草稿」。DB 已经改了，界面没跟着改。 */
    paintApp();
    renderCanvas();
    hint('已保存并发布 v' + v + ' · 客户现在看到的是这一版', { ms: 9000 });
    /* 会话里留一张可回看的改动卡：版本号 + 一句人话 + 内容指纹 + 两个动作。
       这不是装饰 —— 没有它，用户发完就只剩一句 toast，过十分钟就找不到那一版。 */
    if (ui && ui.addCard) {
      ui.addCard({
        v: v, at: today(), summary: snap.summary, hash: snap.contentHash,
        viewHref: 'app.html?id=' + encodeURIComponent(appId) + '&v=' + v + '&mode=view',
        /* 客户地址：不是给本机看的相对路径，而是"复制到手机上能打开"的完整地址。
           发布后全站原来只有"已发布 vN"一句话 —— 用户拿不到要发给客户的链接。 */
        url: new URL('app.html?id=' + encodeURIComponent(appId) + '&mode=view&v=' + v, location.href).href
      });
      if (ui.setCollapsed) ui.setCollapsed(false);
    } else if (ui && ui.addMsg) {
      ui.addMsg('xz', '已保存为 v' + v + '：' + snap.summary);
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
          hint('没换成：这台电脑写不进去，当前内容没动', { kind: 'err', ms: 9000 });
          return;
        }
        paintApp();
        renderCanvas();
        paintCounts();
        hint('已把内容换成 v' + want + ' · 客户那边仍是 v' + (actNow ? actNow.v : '—') + '，要客户用上，去「客户授权」页升级', { ms: 9000 });
        if (ui && ui.addMsg) ui.addMsg('xz', '画布已换成 v' + want + '（授权版本仍是 v' + (actNow ? actNow.v : '—') + '）。');
      }
    });
  }

  if (window.Float) {
    ui = Float.mount({
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
    /* ★2026-10-31（用户原话）：离开配置页要问一句「保存 / 不保存」。
       原文：「返回之后有一个弹窗问他是否保存草稿……要么保存，要么不保存；
       不保存的话直接再次进入配置详情页不就完事了吗？就直接重置了」。
       —— 保存并发布＝留成新版本并设为客户可见（2026-11-03 m05120）；
          不保存＝这次改动丢掉，回到客户当前那一版的内容，但**不改客户可见版本**
          （versApply 的 keepActive）。 */
    var backBtn = $('#act-back');
    if (backBtn) on(backBtn, 'click', function (e) {
      var pend = 0;
      try {
        /* ★2026-11-02：按内容判，不按流水条数 —— 改回原样再离开，不该问"要存一版吗" */
        pend = DB.hasPending('app', appId) ? (DB.changesOf('app', appId) || []).length : 0;
      } catch (err) {}
      if (!pend) return;                       /* 没有未存的改动就直接走，不拿空弹窗烦人 */
      e.preventDefault();
      Confirm.ask({
        title: '离开前要保存并发布吗？',
        body: '这次改了 ' + pend + ' 处，还没保存。<br>' +
              '「保存并发布」＝留成 v' + (topVer() + 1) + '，客户立即看到这一版。<br>' +
              '「不保存直接走」＝这次的改动丢掉，再进来是上次保存过的样子。',
        ok: '保存并发布',
        cancel: '不保存直接走',
        onOk: function () {
          var content = DB.resolveContent(appId);
          var prevRec = DB.versActive('app', appId);
          var snap = {
            comps: (app.comps || []).slice(), name: app.name, desc: app.desc, client: app.client,
            content: content, contentHash: DB.hash(content), at: today()
          };
          snap.summary = summarizeSnap(prevRec ? prevRec.snap : null, snap);
          var v = DB.versSave('app', appId, snap, today());
          if (!v) { hint('没存上：这台电脑写不进去，所以没有离开页面', { kind: 'err', ms: 9000 }); return; }
          DB.versActivate('app', appId, v);
          app.updated = today();
          DB.save();
          clearDraft();
          location.href = 'apps.html';
        },
        onCancel: function () {
          clearDraft();
          var act = DB.versActive('app', appId);
          if (act) {
            DB.versApply('app', appId, act.v, true);      /* 回到客户那一版的内容，不动客户可见版本 */
          } else {
            /* ★2026-10-31（盲审抓出）：一版都没存过的应用，原来这里什么都不做 ——
               用户选了「不保存」，再进来改动却还在，等于这个选项对"全新应用"失效。
               没有"上次存过的样子"可回，就回到空白：装配清空、本应用的内容层清掉。
               共用组件库一个字不动（那是全公司的资产，不是这次编辑的对象）。 */
            app.comps.length = 0;
            app.content = {};
            DB.save();
          }
          location.href = 'apps.html';
        }
      });
    });
    /* ★2026-11-04（用户）：「我应该点击装配组件去看，有哪些可以升级」——
       有落后组件时直接开「已装配」页签（每行自带 有更新 / 更新 按钮），
       没有更新才开「可装配」页签去装新的。卸下、装新的都在同一面板里切页签。 */
    on('#act-assemble', 'click', function () {
      var nUpd = 0;
      try { nUpd = DB.updateCount(app.id); } catch (e) {}
      openDlg(nUpd ? 'on' : 'avail', $('#act-assemble'));
    });

    /* ★2026-11-03（m05719）：「全选」只勾上当前列表里可升级的行，真正升级由下方批量键触发。 */
    on('#p-selall', 'change', function () { batchSelectAll(this.checked); });
    on('#p-upgrade-allnow', 'click', upgradeAllNow);
    on('#p-batch-do', 'click', batchDo);

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
    console.error('[app] assets/float.js 没加载：对话条/操作组/装配胶囊都不可用');
  }

  /* ══ 5. 装配面板 ══════════════════════════════════════════════
     结构照 VS Code Extensions：头部 → 搜索独占一行 → 两个平文本切段 → 列表 → 一行底注。
     状态全在行内变化：装配 / 装配中… / 已装配（悬浮变卸载）/ 装配失败 + 撤销。
     没有「完成」「取消」，没有 toast。 */
  var mask = $('#mask');
  var tab = 'avail';
  var pending = {};        /* 装配中：compId -> true */
  var failed = {};         /* 装配失败：compId -> 冲突对象名 */
  var FAIL_ID = 'doc-extract';   /* ?fail=1＝故障注入开关：验证「装配失败 + 撤销」这条恢复路径，不是业务入口 */

  /* ── 更新视图的状态（《设计-组件更新提示-20261028》§3–§6）──────────
     这里只放"界面此刻在干什么"，不放"谁落后了"：
     后者只有一处算法 DB.updatesOf / DB.updateCount（§11.2 单一数字公式）。
       updNow     每次重画现算：compId -> {id,name,from,to}
       confirmId  行内确认态的那一行（同一时刻只允许一行）
       updBusy    更新中的那一行（同一时刻只允许一行）
       updErr     更新失败：compId -> true（「有更新」标签保留 —— 失败不等于已更新）
       justUpd    刚更新完、还在撤回窗口里：compId -> {from,to,content}
     ★行体点击契约（§3.1）：已装配行**不绑**行体动作 ——
       改前点行体空白处就是卸载，且没有确认；现在卸载只走行内明确入口，且要确认。 */
  var updFilter = false;
  var updNow = {};
  var confirmId = null;
  var updBusy = null;
  var updErr = {};
  /* ★2026-10-28：撤回不再只活 8 秒——发布前一直可退。
     状态跟着应用记录走（app.updUndo），刷新、关页面都还在；发布时清空。 */
  var justUpd = (app && app.updUndo && typeof app.updUndo === 'object') ? app.updUndo : {};
  /* ★2026-11-03（m05719）：装配面板的多选表。键是 compId；切页签/筛选/动作完成时裁掉失效项。 */
  var batchSel = {};

  function updMap() {
    var m = {};
    DB.updatesOf(appId).forEach(function (u) { m[u.id] = u; });
    return m;
  }
  function inUpdView(id) { return !!updNow[id] || !!justUpd[id]; }

  /* 影响句逐字（规格 §4.2）。★不写「客户立刻看到」：客户视图取应用的 active 快照
     （本文件 VIEW_SNAP），组件版本要经「发布给客户」才进快照 —— 写"立刻"就是一句
     会被拿去承诺客户的假话。 */
  function impactOf(id) {
    var to = (updNow[id] && updNow[id].to) || (justUpd[id] && justUpd[id].to) || '';
    return app.status === '已下架'
      ? '画布按 ' + to + ' 重画；应用已下架，客户看不到。'
      : '画布按 ' + to + ' 重画，发布后客户才看到。';
  }

  /* 「有更新」标签：只由 ui-kit 出（文案与形态各一处），本文件不手拼这一段 */
  function updTagHtml() { return UIK.cardBadge({ variant: 'warn', size: 'sm' }); }

  /* 版本对比 v2 → v4（§3.4）：三段 inline-flex + 基线对齐；箭头是一个字符、读屏跳过，
     整组靠 aria-label 播成「已装配 v2，最新 v4」 */
  function verPairHtml(u) {
    return '<span class="ver-pair" aria-label="已装配 ' + esc(u.from) + '，最新 ' + esc(u.to) + '">'
      + '<span class="ver-from">' + esc(u.from) + '</span>'
      + '<span class="ver-arrow" aria-hidden="true">→</span>'
      + '<span class="ver-to">' + esc(u.to) + '</span></span>';
  }

  /* 一个过滤函数，切段计数与列表共用 —— 各算一套就会出现"写 5 实际 3"。
     可装配：调 DB.canInstall（发布态 × 启用态的唯一判据，别再在这里写 inline 条件）；
     已装配：装了就算（后来下架/禁用的也得留着，用户要能卸载）。 */
  function listOf(kind) {
    return DB.COMPS.filter(function (c) {
      if (isOn(c.id)) return kind === 'on';
      return kind === 'avail' && DB.canInstall(c);
    });
  }

  /* 当前视图（搜索/AI 结果、页签都算过）里的行 ——「全部升级（N）」的 N 按它算，
     做到"屏幕上看到几个可升级，按钮就说几个"。 */
  var CUR_ROWS = [];
  function viewUpgradeIds() {
    return CUR_ROWS.filter(function (c) { return isOn(c.id) && !!updNow[c.id]; })
      .map(function (c) { return c.id; });
  }

  /* 能进批量动作的行：可装配页签＝当前可安装；已装配页签＝当前有更新。
     不可升级的已装行不给勾选 —— 否则会出现「选了 3 个只升 1 个」的计数谎话。 */
  function canBatch(c) {
    if (tab === 'on') return isOn(c.id) && !!updNow[c.id] && updBusy !== c.id;
    return !isOn(c.id) && DB.canInstall(c);
  }

  /* ★2026-11-04（用户）：「只需要在已装配旁边显示 X 个可升级的标签」。
     可升级数只挂在「已装配」页签上，不再单独占一行；数字与卡片徽标、顶栏同源（DB.updatesOf）。 */
  function paintUpdBar() {
    var chip = $('#tab-upd-chip'), lab = $('#tab-upd-n');
    var n = Object.keys(updNow || {}).length;
    if (chip) chip.hidden = !n;
    if (n && lab) lab.textContent = n;
  }

  /* ★2026-11-04（用户）：「一个是批量升级，然后一个是全部升级」。
     口径与组件引用管理一致：批量只认勾选，全部不看勾选、直接升完所有落后件。 */
  /* ★2026-11-05：范围改成"当前视图"。
     原来它拿 DB.updatesOf(app.id) = 全库落后件，搜索过之后会出现
     「屏幕里只有 2 个可升级，按钮写着全部升级（8）」—— 一点下去升了 6 个看不到的。 */
  function upgradeAllNow() {
    var ids = viewUpgradeIds();
    var idsMap = {};
    ids.forEach(function (id) { idsMap[id] = 1; });
    var ups = DB.updatesOf(app.id).filter(function (u) { return idsMap[u.id]; });
    if (!ups.length) { hint('没有要升级的组件', { ms: 4000 }); return; }
    var total = DB.updatesOf(app.id).length;
    var names = ups.slice(0, 5).map(function (u) { return u.name + ' ' + u.from + '→' + u.to; }).join('、');
    Confirm.ask({
      title: '把 ' + ups.length + ' 个组件升到最新版？',
      body: (ups.length > 5 ? names + ' 等 ' + ups.length + ' 个' : names) +
            '<br>只改装配版本；客户那边不会立刻变，要生效还得去「客户授权」页升级。' +
            (ups.length < total ? '<br>范围：当前搜索出来的 ' + ups.length + ' 个（共 ' + total + ' 个待升级）。' : ''),
      ok: '全部升级（' + ups.length + '）',
      onOk: function () {
        var r = ups.length < total ? DB.upgradeSome(app.id, ids) : DB.upgradeAll(app.id);
        if (!r || !r.n) { hint('没升成功：这台电脑写不进去', { kind: 'err', ms: 9000 }); return; }
        batchSel = {};
        renderList(); paintCounts(); paintApp(); renderCanvas();
        hint('已升级 ' + r.n + ' 个组件到最新版 · 记得「保存新版本并发布」', { ms: 9000 });
      }
    });
  }

  /* ── 多选批量动作（★2026-11-03 m05719）────────────────────────
     可装配页签：勾多个 → 装配（N）；已装配页签：勾多个可升级的 → 一键升级（N）。
     计数只算**当前列表里真有勾选框的行**，不拿全库数冒充。 */
  function batchBoxes() { return $$('#dlg-list [data-pick]'); }
  function batchIds() {
    return batchBoxes().filter(function (c) { return c.checked; })
      .map(function (c) { return c.getAttribute('data-pick'); });
  }
  function syncBatch(show) {
    var bar = $('#p-batch'), btn = $('#p-batch-do');
    var allNow = $('#p-upgrade-allnow'), selall = $('#p-selall');
    var boxes = batchBoxes();
    var n = boxes.filter(function (c) { return c.checked; }).length;
    var nAll = viewUpgradeIds().length;
    /* 没有可操作的行走就别留一条「装配（0）」的空工具条：它既不可点，也占一行。 */
    if (bar) bar.hidden = !show || !boxes.length;
    if (selall) {
      selall.checked = boxes.length > 0 && n === boxes.length;
      selall.indeterminate = n > 0 && n < boxes.length;
      selall.disabled = !boxes.length;
    }
    /* ★2026-11-04（用户）：「右面的装配（0）又是什么意思」——
       它是"勾了几个就装几个"的批量键，0＝还什么都没勾。没勾的时候它就是一句废话，
       所以不显示；一勾就出现并报数（已装配页签的「批量升级（N）」同理）。 */
    if (btn) {
      btn.hidden = n === 0;
      btn.disabled = n === 0;
      btn.textContent = (tab === 'on' ? '批量升级（' : '装配（') + n + '）';
    }
    /* 「全部升级」只在已装配页签出现，数的是落后件总数（不看勾选），与引用管理一致。 */
    if (allNow) {
      allNow.hidden = tab !== 'on';
      allNow.textContent = '全部升级（' + nAll + '）';
      allNow.disabled = !nAll || !!updBusy;
      /* 搜过之后它只覆盖搜出来的那些 —— 鼠标停上去说清楚，别让人以为升了全库。 */
      var every = Object.keys(updNow || {}).length;
      allNow.title = nAll < every
        ? ('把当前列表里的 ' + nAll + ' 个升到最新（另有 ' + (every - nAll) + ' 个不在当前搜索里）')
        : ('把 ' + nAll + ' 个待升级组件一次升到最新');
    }
  }
  /* 全选 = 一次性全勾/全不勾当前列表里可操作的行（引用管理里那颗表头勾选框的行为）。 */
  function batchSelectAll(on) {
    var boxes = batchBoxes();
    boxes.forEach(function (c) {
      c.checked = on;
      if (on) batchSel[c.getAttribute('data-pick')] = 1;
      else delete batchSel[c.getAttribute('data-pick')];
      var r = c.closest('.row');
      if (r) r.classList.toggle('is-selected', !!on);
    });
    syncBatch(true);
  }
  function batchInstall() {
    var ids = batchIds();
    if (!ids.length) return;
    var wasTwo = halves();
    ids.forEach(function (id) { pending[id] = true; delete failed[id]; });
    batchSel = {};
    renderList();
    /* 450ms 与单行装配同节奏：让每一行都先走到「装配中…」，再一起提交。 */
    setTimeout(function () {
      var ok = 0, bad = 0;
      ids.forEach(function (id) {
        delete pending[id];
        if (failDemo && id === FAIL_ID) {
          failed[id] = '与「' + conflictName() + '」冲突';
          bad++;
        } else {
          DB.install(appId, id);
          ok++;
        }
      });
      renderList(); paintCounts(); renderCanvas(); paintApp();
      var nowTwo = halves();
      hint('已装配 ' + ok + ' 个组件' + (bad ? '，' + bad + ' 个失败' : '')
        + (nowTwo > wasTwo ? '，主区从单栏变成双栏' : ''), { ms: 6000 });
    }, 450);
  }
  function batchUpgrade() {
    var ids = batchIds();
    var ups = ids.map(function (id) { return updNow[id]; }).filter(Boolean);
    if (!ups.length) return;
    var names = ups.slice(0, 5).map(function (u) { return u.name + ' ' + u.from + '→' + u.to; }).join('、');
    Confirm.ask({
      title: '把 ' + ups.length + ' 个组件升到最新版？',
      body: (ups.length > 5 ? names + ' 等 ' + ups.length + ' 个' : names) +
            '<br>只改装配版本；客户那边不会立刻变，要生效还得去「客户授权」页升级。',
      ok: '批量升级',
      onOk: function () {
        var r = DB.upgradeSome(app.id, ups.map(function (u) { return u.id; }));
        if (!r || !r.n) { hint('没升成功：这台电脑写不进去', { kind: 'err', ms: 9000 }); return; }
        batchSel = {};
        renderList(); paintCounts(); paintApp(); renderCanvas();
        hint('已升级 ' + r.n + ' 个组件到最新版 · 记得「保存新版本并发布」', { ms: 9000 });
      }
    });
  }
  function batchDo() {
    if (tab === 'on') batchUpgrade(); else batchInstall();
  }

  function paintCounts() {
    var n = app.comps.length;
    if (ui && ui.setChipCount) ui.setChipCount(n);
    /* ★2026-11-03 用户 m03795：「这个应用装了 4 块？这什么狗屎提示，有任何意义吗？」
       头部计数与底注都删了：页签已经写着可装配/已装配，底部再复述一遍装配数
       只是在替用户数数，不回答任何下一步动作。 */
    var c = $('#n-avail'); if (c) c.textContent = listOf('avail').length;
    var d = $('#n-on'); if (d) d.textContent = listOf('on').length;
  }

  function actHtml(c) {
    if (pending[c.id]) {
      return '<span class="pending"><span>装配中…</span>'
        + '<span class="genbar" aria-hidden="true"><i></i></span></span>';
    }
    if (failed[c.id]) {
      return '<span class="err-strip" role="alert">装配失败 · ' + esc(failed[c.id]) + '</span>'
        + '<button type="button" class="btn-undo" data-undo="' + esc(c.id) + '">撤销</button>';
    }
    if (isOn(c.id)) {
      /* 装了但后来下架：留一个次级标记，卸载照旧可用 */
      return (c.status === '已下架' ? '<span class="off-tag">已下架</span>' : '')
        + '<span class="on-tag">已装配</span>'
        + '<button type="button" class="btn-uninstall" data-off="' + esc(c.id) + '">卸载</button>';
    }
    if (c.status === '已下架') return '<span class="off-tag">已下架</span>';
    /* ★ 2026-10-23：三个「装配」按钮文字完全一样，**谁也不知道自己在装哪一个**。
       小智实测就是卡在这里——它反复点「可装配」tab，因为按钮名里没有组件信息，
       它没法在 3 个同名的按钮里选中"任务详情"那一个。人读屏也一样。 */
    return '<button type="button" class="btn-install" data-on="' + esc(c.id) + '"'
      + ' aria-label="装配 ' + esc(c.name) + '" title="装配 ' + esc(c.name) + '">装配</button>';
  }

  /* 行内动作组：更新视图的五件之一 + 四态（§3.6 / §4）。
     普通已装配行原样交给 actHtml（「已下架」胶囊 + 「已装配」+ hover 出的「卸载」），
     这样"卸载入口"仍然只有一个定义处 —— 本函数不重写那一段。 */
  function actOf(c, state) {
    var u = updNow[c.id];
    var to = (u && u.to) || (justUpd[c.id] && justUpd[c.id].to) || c.ver;
    if (state === 'pending') {
      /* 更新中（§4.3）：按钮消失，原位换「更新中…」+ 进度条（沿用现盘 .pending / .genbar） */
      return '<span class="pending"><span>更新中…</span>'
        + '<span class="genbar" aria-hidden="true"><i></i></span></span>';
    }
    if (state === 'confirm') {
      /* 焦点默认落「取消」（§4.1）；两颗按钮的可读名都带组件信息（§3.6 同一条教训） */
      return '<button type="button" class="btn-plain" data-do="cancel"'
        + ' aria-label="取消更新 ' + esc(c.name) + '">取消</button>'
        + '<button type="button" class="btn-update" data-do="confirm"'
        + ' aria-label="确认更新 ' + esc(c.name) + ' 到 ' + esc(to) + '">确认更新</button>';
    }
    if (state === 'error') {
      /* 失败（§4.6）：「有更新」标签保留 —— 失败不等于已更新；动作换「重试」 */
      return updTagHtml()
        + '<button type="button" class="btn-plain" data-do="retry"'
        + ' aria-label="重试更新 ' + esc(c.name) + ' 到 ' + esc(to) + '">重试</button>'
        + '<button type="button" class="btn-uninstall" data-off="' + esc(c.id) + '"'
        + ' aria-label="卸载 ' + esc(c.name) + '">卸载</button>';
    }
    if (state === 'new') {
      /* 同一时刻只允许一行在更新：其余行的「更新」瞬态禁用（§3.6）
         ★2026-11-04（用户）：「有更新了，我万一不用了，不能卸载吗？」——
         有更新 ≠ 必须更新。这一行也必须带「卸载」，而且不是 hover 才冒出来。 */
      return updTagHtml()
        + '<button type="button" class="btn-update" data-do="update"'
        + (updBusy ? ' disabled' : '')
        + ' aria-label="更新 ' + esc(c.name) + ' 到 ' + esc(to) + '">更新</button>'
        + '<button type="button" class="btn-uninstall" data-off="' + esc(c.id) + '"'
        + ' aria-label="卸载 ' + esc(c.name) + '">卸载</button>';
    }
    /* ★2026-10-28 改：不再"更新完不留按钮"。
       8 秒一过就无路可退是体验官实测的阻断项；这里给一颗「退回 vN」，
       它一直留到应用发布 —— 发布后才真的作废（doPublish 会清 updUndo）。 */
    if (state === 'done') {
      var dn = justUpd[c.id];
      if (!dn) return '';
      return '<button type="button" class="btn-plain" data-do="undo"'
        + ' aria-label="退回 ' + esc(c.name) + ' 到 ' + esc(dn.from) + '">退回 ' + esc(dn.from) + '</button>'
        + '<button type="button" class="btn-uninstall" data-off="' + esc(c.id) + '"'
        + ' aria-label="卸载 ' + esc(c.name) + '">卸载</button>';
    }
    return actHtml(c);
  }

  /* 可读名拼接（2026-10-28 实测修）：组件的 desc 自带「。」，按「，」硬接下一段
     就得到「…处理人。，已装配 v2」—— 读屏会在句号后停一次、逗号后再停一次。
     这里只去掉每段**末尾**的标点再拼合；屏上的字一个不动，改的只是 aria-label。 */
  function spoken() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      out.push(String(s).replace(/[。；;，,、\s]+$/, ''));
    }
    return out.join('，');
  }

  function rowHtml(c) {
    /* ★ 2026-10-23 用户原话：「为什么要有第一个字的图标，有什么意义？而且我什么时候有组件
       还区分能力类这种字段，最后在这显示被 X 个应用引用啊，重要的是组件名称、组件介绍。」
       —— 原来这一行有三样东西都不该出现：
         ① 首字方块（规/文/复）：拿名字首字当图标，是"没图可放"的占位，不是信息；
         ② 「能力类 · v1」：内部字段，客户没有这个概念，他也不该看见；
         ③ 「被 N 个应用引用」：这句最坏 —— 它暗示"改这里会动别人的应用"，
            却在装配这种无风险的场景里吓人一跳。
       客户端真正要判断的是「装了会多出什么」，所以只剩名字 + 一句人话介绍。
       数据里本来就有 desc（一直没被用上），改用它。
       ⚠ 上一次改这里时用 shell 内联 node -e 做替换，引号全被吃掉，
         data-comp 的值变成了一个加号，装配按钮因此找不到行 —— 本文件禁止再用内联方式改。 */
    /* 三种行只差两处：动作组（actOf）与版本行（meta）。
       状态只落在 data-upd 上，样式在 app.html 的 .row[data-upd] 段，一处定义。 */
    var on = isOn(c.id);
    var upd = updNow[c.id] || null;
    var done = justUpd[c.id] || null;
    var state = '';
    if (on && updBusy === c.id) state = 'pending';
    else if (on && confirmId === c.id) state = 'confirm';
    else if (on && updErr[c.id]) state = 'error';
    else if (on && upd) state = 'new';
    else if (on && done) state = 'done';

    /* 可读名：读屏听到的是"这件东西现在什么处境、能做什么"，不是一串标签 */
    var label;
    if (state === 'confirm' && upd) label = spoken(c.name, '已装配 ' + upd.from, '最新 ' + upd.to, impactOf(c.id));
    else if (state === 'new' && upd) label = spoken(c.name, c.desc, '已装配 ' + upd.from, '最新 ' + upd.to, '有更新');
    else if (state === 'done' && done) label = spoken(c.name, c.desc, '已更新到 ' + done.to);
    else label = spoken(c.name, c.desc, on ? '已装配' : '未装配');

    /* 版本行：更新视图只写对比（旧的「类型 · 被 N 个应用使用」在这五件里不出现，
       清掉筛选回到普通行时原样恢复，§3.4）。已装配行写的是**装的那一版**，
       不是库里的最新版 —— 下架件两者会不同（§5.4 单值、不画箭头）。 */
    var meta;
    if (state === 'confirm') meta = esc(impactOf(c.id));
    else if (state === 'done' && done) meta = '已更新到 ' + esc(done.to);
    else if (state === 'error') meta = '<span role="alert">更新失败，请重试</span>';
    else if (state === 'new' && upd) meta = verPairHtml(upd);
    else {
      var vShown = on ? DB.installedVer(appId, c.id) : (c.ver || 'v1');
      /* 2026-11-04（q5 拍板）：零引用不印否定句，只报版本号。 */
      meta = esc(vShown) + (c.refs > 0 ? ' · ' + c.refs + ' 个应用在用' : '');
    }

    var pick = canBatch(c)
      ? '<span class="row-pick"><input type="checkbox" class="row-check" data-pick="' + esc(c.id) + '"' +
          (batchSel[c.id] ? ' checked' : '') +
          ' aria-label="选择 ' + esc(c.name) + '"></span>'
      : '<span class="row-pick"></span>';
    return '<div class="row' + (batchSel[c.id] && canBatch(c) ? ' is-selected' : '') + '" data-comp="' + esc(c.id) + '"'
      + (state ? ' data-upd="' + state + '"' : '')
      + ' aria-label="' + esc(label) + '">'
      + '<div class="row-hd">' + pick + '<b>' + esc(c.name) + '</b>'
      + '<span class="act">' + actOf(c, state) + '</span></div>'
      /* 三个既有字段（ver / type / refs）回到卡面。2026-10-23 它们被用户点名删过，
         2026-10-26 面板改抽屉后又需要它们：抽屉是"决定装不装"的地方 ——
         装的是哪一版、会不会连带改到别人的应用，是当场要判断的事实，不是内部术语。 */
      /* ★2026-10-28 设计审查 C2：普通行改回「名称 → 介绍 → 版本/引用」，与组件库卡片同一顺序；
         只有更新行（data-upd）把版本对比提到介绍之上 —— 那时候版本是判断依据，不是补充信息。 */
      + (state ? '<p class="row-meta">' + meta + '</p><p class="row-desc">' + esc(c.desc || '') + '</p>'
               : '<p class="row-desc">' + esc(c.desc || '') + '</p><p class="row-meta">' + meta + '</p>')
      + '</div>';
  }

  /* 搜索词别名：placeholder 举的例子（审批流 / 原文对照）不是组件名，
     不补这层，用户搜这两个词会得到空态 —— 那是假承诺。 */
  var KEYWORDS = {
    'app-header': '应用头 头部 顶栏',
    'task-list': '审核任务列表 任务列表 列表 单据',
    'task-detail': '任务详情 原件 原文 结论',
    'verify-queue': '复核队列 审批流 复核 审批',
    'doc-extract': '文档抽取 原文对照 抽取 文档',
    'rule-panel': '规则结论 逐条 判定'
  };

  /* 已装配页签的顺序：有更新的排最前，其余保持现有顺序（= app.comps 的装配序）。
     刚更新完、还在撤回窗口里的那一行也留在前段 —— 它此刻正显示「已更新到 v4」，
     若因为 compVer 已对齐就掉到队尾，屏幕上的行会凭空跳一次位置（§4.4）。 */
  function orderedOn() {
    var all = listOf('on');
    var top = all.filter(function (c) { return inUpdView(c.id); });
    var rest = all.filter(function (c) { return !inUpdView(c.id); });
    return top.concat(rest);
  }

  function renderList() {
    var list = $('#dlg-list');
    if (!list) return;
    updNow = updMap();                      /* 每次重画现算一次，N 只有一个算法（§11.2） */
    var kw = (($('#dlg-search') || {}).value || '').trim().toLowerCase();
    var wantOn = tab === 'on';
    var aiIds = window.__aiIds;
    var rows = (wantOn ? orderedOn() : listOf('avail')).filter(function (c) {
      /* 2026-11-05：AI 检索的结果优先；空数组＝AI 说没找到，就走空态，不再回落全量。 */
      if (aiIds) return aiIds.indexOf(c.id) >= 0;
      var hay = (c.name + c.id + (c.desc || '') + ' ' + (KEYWORDS[c.id] || '')).toLowerCase();
      return !kw || hay.indexOf(kw) >= 0;
    });
    /* ★2026-11-05：勾选不再跟着搜索丢。原来这里按「当前列表」裁选中项 ——
       先勾 5 个、再改一下搜索词，那 5 个就悄悄没了。现在只在"它真的不需要升级了"时出列。
       （切页签仍然清：可装配与已装配是两类动作，混着算必然出错。） */
    CUR_ROWS = rows;
    var liveSel = {};
    rows.forEach(function (c) { if (canBatch(c)) liveSel[c.id] = 1; });
    Object.keys(batchSel).forEach(function (id) {
      if (tab === 'on' ? !updNow[id] : !liveSel[id]) delete batchSel[id];
    });
    paintUpdBar();
    if (!rows.length) {
      /* 筛选空态（§5.3）：只留一句事实。清除筛选的入口是上面那行「显示全部」，
         同一屏同一动作不开第二个入口 —— 但「用 AI 搜这句话」不是同一个动作（换的是检索方式），
         整句话的需求本来就命中不了关键词，所以这里给它一个出口。 */
      list.innerHTML = '<div class="p-empty">'
        + (kw ? '没有匹配的组件' : (wantOn ? '还没装配任何组件' : '全部装上了，没有可装配的'))
        + (kw ? '<br><button type="button" class="btn-ghost-s" id="p-clear">清除搜索</button>' : '')
        + (kw && !aiIds ? '<button type="button" class="btn-ghost-s" id="p-ai-try">用 AI 搜这句话</button>' : '')
        + '</div>';
      on('#p-clear', 'click', function () {
        var s = $('#dlg-search'); if (s) s.value = '';
        renderList();
        if (s) s.focus();
      });
      on('#p-ai-try', 'click', function () {
        var b = $('#ai-comp'); if (b) b.click();
      });
      syncBatch(false);
      return;
    }
    /* 重画会把行整体重建一遍，焦点所在的那颗按钮随之消失 ——
       记下"哪一行、哪个动作"，画完若焦点已掉回 body，就按同一对坐标放回去。
       （§4.4 的同一条原则：动作完成后焦点不许掉回 body；撤回窗口到点时也一样。） */
    var keep = null, a0 = document.activeElement;
    if (a0 && list.contains(a0)) {
      var r0 = a0.closest('.row');
      keep = { comp: r0 && r0.getAttribute('data-comp'), act: a0.getAttribute('data-do') || '' };
    }
    list.innerHTML = rows.map(rowHtml).join('');
    syncBatch(true);
    /* tabindex 用 setAttribute 落（不是只写在模板里）：键盘能进每一行是硬要求。
       已装配行保留 tabindex：焦点落到行上时 :focus-within 才露出「卸载」
       （display:none 的按钮 Tab 跳不到，行本身是键盘用户唯一的触发器）。
       更新视图里的行不占 Tab 停靠点 —— 它们没有隐藏入口，可点的就在明面上。 */
    $$('.row', list).forEach(function (r) {
      var on = isOn(r.getAttribute('data-comp'));
      if (!on || r.getAttribute('data-upd') === null) r.setAttribute('tabindex', '0');
    });
    if (keep && mask && mask.getAttribute('data-open') === 'true'
        && (!document.activeElement || document.activeElement === document.body)) {
      var back = null;
      if (keep.comp) {
        var rr = null;
        $$('.row', list).forEach(function (x) { if (x.getAttribute('data-comp') === keep.comp) rr = x; });
        if (rr) back = keep.act ? $('[data-do="' + keep.act + '"]', rr) : rr;
      }
      if (!back) back = $('.btn-update', list);
      if (!back) back = $('#dlg-close');
      if (back) back.focus();
    }
  }

  function setTab(t) {
    tab = t === 'on' ? 'on' : 'avail';
    ['avail', 'on'].forEach(function (k) {
      var b = $('#tab-' + k);
      if (b) b.setAttribute('aria-selected', String(k === tab));
    });
    renderList();
  }

  function conflictName() {
    var t = DB.compById('task-detail');
    if (t && isOn(t.id)) return t.name;
    var first = installedComps()[0];
    return first ? first.name : '应用头';
  }

  function doInstall(id) {
    var c = DB.compById(id);
    if (!c || pending[id] || isOn(id)) return;
    if (c.status === '已下架') return;             /* 行里已经是「已下架」，没有可点的东西 */
    var wasTwo = halves();
    pending[id] = true;
    delete failed[id];
    renderList();
    /* 450ms = 进度条走完的时间（动画节奏），不是假加载：DB 写入本身是同步的，
       进度条走到头才提交，是为了让人看清"这一行正在装配"。 */
    setTimeout(function () {
      delete pending[id];
      if (failDemo && id === FAIL_ID) {
        failed[id] = '与「' + conflictName() + '」冲突';
        renderList();
        return;
      }
      DB.install(appId, id);
      renderList();
      paintCounts();
      renderCanvas();
      /* 2026-10-24：顶栏「装配组件 N」徽标原来只在进页面时刷一次，
         装配完还是 0 —— 实测装了两个、徽标仍显示 0。装配/卸载是改计数的事实源头，
         这里统一重铺一次。 */
      paintApp();
      var nowTwo = halves();
      hint('已装配「' + c.name + '」，' + (nowTwo > wasTwo ? '主区从单栏变成双栏' : '画布上多了一块'));
    }, 450);
  }

  /* 卸下要问一句（规格 §3.1 派单口径：卸载只能从明确入口进，且要确认）。
     改前：点行体空白 = 直接卸载，没有确认、也没有撤销 —— 拉抽屉时手一滑就少一块。 */
  function doUninstall(id) {
    var c = DB.compById(id);
    if (!c || pending[id] || !isOn(id)) return;
    var run = function () {
      var wasTwo = halves();
      DB.uninstall(appId, id);
      delete failed[id];
      delete updErr[id];
      delete justUpd[id];
      if (confirmId === id) confirmId = null;
      renderList();
      paintCounts();
      renderCanvas();
      paintApp();
      /* 行被重画掉了，焦点会掉回 body —— 落到下一行（或页签）上 */
      var first = $('#dlg-list .row');
      if (first && first.tabIndex >= 0) first.focus();
      else { var t = $('#tab-on'); if (t) t.focus(); }
      var nowTwo = halves();
      hint('已卸载「' + c.name + '」，' + (nowTwo < wasTwo ? '主区回到单栏' : '画布上去掉一块'));
    };
    if (window.Confirm) {
      Confirm.ask({
        title: '卸下「' + c.name + '」？',
        /* 与更新确认句同一条事实：改的是画布，客户视图取 active 快照，发布后才生效 */
        body: '画布上这一块会消失，发布后客户才看到；可随时从装配面板装回。',
        ok: '卸下',
        onOk: run
      });
    } else run();
  }

  function clearFail(id) {
    delete failed[id];
    renderList();
  }

  /* 行体只负责「装」：已装配行不绑行体动作（规格 §3.1）。
     卸载只走行内「卸载」按钮（带确认）或画布上的明确入口。 */
  function toggle(id) {
    if (pending[id]) return;
    if (failed[id]) { clearFail(id); return; }
    if (isOn(id)) return;
    doInstall(id);
  }

  /* ── 更新动作（规格 §4 / §5）────────────────────────────────
     入口只有一颗「更新」；出口三个，各有各的语义：
       取消 / Esc ⇒ 收回确认态（只退这一层，抽屉不关）
       确认更新   ⇒ 写 compVer、重画画布、给 8 秒撤回
       撤回       ⇒ 回到更新前的 compVer 与内容，撤回入口同时失效 */
  function focusUpdBtn(id) {
    var row = $('.row[data-comp="' + id + '"]');
    var b = row ? $('.btn-update', row) : null;
    if (b) { b.focus(); return true; }
    return false;
  }

  function askUpdate(id) {
    var c = DB.compById(id);
    if (!c || !updNow[id] || updBusy) return;    /* 一行更新中时其余按钮禁用（§3.6） */
    confirmId = id;                              /* 打开另一行 ⇒ 上一行收回常态 */
    renderList();
    var row = $('.row[data-comp="' + id + '"]');
    var b = row ? $('[data-do="cancel"]', row) : null;
    if (b) b.focus();                            /* 焦点落「取消」（§4.1） */
  }

  function cancelUpdate(id) {
    if (confirmId !== id) return;
    confirmId = null;
    renderList();
    focusUpdBtn(id);
  }

  /* 完成瞬间那颗按钮从 DOM 消失，焦点不许掉回 body（§4.4）：
     下一行的「更新」→ 没有就「显示全部」→ 再没有就抽屉关闭钮。 */
  function focusAfterDone(id) {
    var rows = $$('#dlg-list .row');
    var i = -1;
    rows.forEach(function (r, k) { if (r.getAttribute('data-comp') === id) i = k; });
    var nxt = null;
    for (var k = i + 1; k < rows.length && !nxt; k++) nxt = $('.btn-update', rows[k]);
    if (!nxt) nxt = $('#dlg-close');
    if (nxt) nxt.focus();
  }

  /* 撤回窗口结束：这一行移出「只看有更新」列表（§4.4 / §4.5）。
     由提示条的 onHide 触发 —— 焦点停在「撤回」上时提示条不收，这一行也不收。 */
  function endUpdWindow(id) {
    /* 8 秒只是"提示条多久收起"，不是"还能不能退"。撤回权保留到发布为止。 */
    if (mask && mask.getAttribute('data-open') === 'true') renderList();
  }

  /* ★2026-11-01（评审 P0）：「退回 vN」这颗按钮原来**没有处理器**。
     actOf 的 done 态渲染出 `data-do="undo"`，而下面的事件分发只认 update/cancel/confirm/retry，
     undo 一路落到 `return;` —— 点了没有任何反应，用户只能卸载重装，
     而 1796 行的注释还写着"撤回权保留到发布为止"。承诺了却没有出口，比不承诺更坏。
     这里补上：装配版本写回 from，被覆盖前的组件内容一起恢复，然后清掉撤回凭据（只能退一次）。 */
  function undoUpdate(id) {
    var dn = (app.updUndo && app.updUndo[id]) || justUpd[id];
    if (!dn) { hint('这一块没有可退回的版本', { ms: 4000 }); return; }
    if (!app.compVer || typeof app.compVer !== 'object') app.compVer = {};
    app.compVer[id] = dn.from;
    if (dn.content && app.content) app.content[id] = JSON.parse(JSON.stringify(dn.content));
    delete justUpd[id];
    if (app.updUndo) delete app.updUndo[id];
    if (DB.save() === false) { hint('没退成功：这台电脑写不进去', { kind: 'err', ms: 9000 }); return; }
    renderList(); renderCanvas();
    hint('已退回 ' + dn.from, { ms: 6000 });
  }

  function doUpdate(id) {
    var c = DB.compById(id), u = updNow[id];
    if (!c || !u || updBusy) return;
    var prevVer = (app.compVer && typeof app.compVer[id] === 'string' && app.compVer[id]) || u.from;
    var prevContent = (app.content && app.content[id]) ? JSON.parse(JSON.stringify(app.content[id])) : null;
    confirmId = null;
    delete updErr[id];
    updBusy = id;
    renderList();
    var row = $('.row[data-comp="' + id + '"]');
    if (row) { row.setAttribute('tabindex', '-1'); row.focus(); }
    /* 450ms = 现盘装配的既定节奏（§4.3「沿用」），不是假加载：
       DB 写入本身同步，进度条走到头才提交，是为了让人看清"这一行正在更新"。 */
    setTimeout(function () {
      if (!app.compVer || typeof app.compVer !== 'object') app.compVer = {};
      app.compVer[id] = c.ver;
      var ok = DB.save();        /* 配额满 / 隐私模式写不进 = 没更新，界面必须说出来 */
      updBusy = null;
      if (!ok) {
        app.compVer[id] = prevVer;               /* 内存也别停在"好像更新了"上 */
        updErr[id] = true;
        renderList();
        var retry = $('.row[data-comp="' + id + '"] [data-do="retry"]');
        if (retry) retry.focus();
        hint('更新失败：这一版没写进去（浏览器存储写满或被禁用）', { kind: 'err', ms: 8000 });
        return;
      }
      justUpd[id] = { from: prevVer, to: c.ver, content: prevContent };
      /* 同一份写进应用记录：刷新后「退回 vN」还在，直到发布 */
      if (!app.updUndo || typeof app.updUndo !== 'object') app.updUndo = {};
      app.updUndo[id] = { from: prevVer, to: c.ver, content: prevContent };
      DB.save();
      renderList();
      renderCanvas();            /* 画布按新版本重画 —— 影响句承诺的那一件事 */
      paintApp();
      hint('已更新「' + c.name + '」到 ' + c.ver, {
        ms: 8000,                /* 撤回窗口：与结构编辑同值（§4.5） */
        onHide: function () { endUpdWindow(id); }
      });
      focusAfterDone(id);
    }, 450);
  }


  /* 参数消费后从地址里摘掉（§11.4 收敛）：关掉抽屉、刷新，不许又自动弹开。
     只删 panel / updates 两个键，id / ns / fail / mode 这些一概不动。 */
  function stripEntryParams() {
    try {
      if (!/[?&](panel|updates)=/.test(location.search)) return;
      var keep = location.search.replace(/^\?/, '').split('&').filter(function (kv) {
        return kv && !/^(panel|updates)=/.test(kv);
      });
      history.replaceState(null, '', location.pathname + (keep.length ? '?' + keep.join('&') : '') + location.hash);
    } catch (e) { /* 老浏览器 / file:// 下 replaceState 可能抛，地址不动不影响本页行为 */ }
  }

  /* 关闭后要把焦点还给"打开它的那个元素"。
     不能用 document.activeElement 现取：面板内容每次都是 innerHTML 重建的，
     关闭时原先聚焦的节点已经没了，activeElement 会先掉回 body。
     所以打开时存引用，关闭时显式还回去（且要 preventScroll —— 关面板会改页面高度，
     直接 focus 容易顺带滚一下）。 */
  var dlgReturnTo = null;

  /* ★2026-10-24（判据 check-dialog-focus.mjs 实测）：这个弹层是 aria-modal="true"，
     但**没有焦点圈禁** —— 从「装配」按 Tab 会走到弹层背后的 .fk-grip / .fk-hist-btn /
     #fk-input（小智浮层），键盘用户被带进看不见的地方。两条补丁：
       ① 打开时给弹层以外的 body 直接子元素加 inert（背后既不可点也不可聚焦）；
       ② 在 #mask 内自己接 Tab / Shift+Tab 兜一圈（inert 在旧浏览器里不一定支持）。 */
  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      /* 包含弹层的容器（#mask 若被包在页面壳里）不能 inert —— 否则弹层自己也没法聚焦 */
      if (el === mask || el.contains(mask)) return;
      /* ★2026-10-28 组件更新：提示条 #hint 必须留在可用面里。
         它带的是全站唯一一颗「撤回」，而更新动作只发生在抽屉里 ——
         抽屉一开就把 body 其余子元素全 inert，等于把撤回泡在惰性层里：
         `.click()` 还能调通（程序化点击绕过 inert），真人点不动、键盘停不上。
         （上一轮 E23 的结构编辑撤回没撞上，是因为那条路径抽屉是关着的。） */
      if (el === $('#hint')) return;
      if (on) { if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); el.setAttribute('data-inert-by', 'dlg'); } }
      else if (el.getAttribute('data-inert-by') === 'dlg') { el.removeAttribute('inert'); el.removeAttribute('data-inert-by'); }
    });
  }
  function dlgTabStops() {
    return Array.prototype.filter.call(
      mask.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }
  function openDlg(t, trigger) {
    if (!mask) { console.error('[app] 缺少 #mask，装配面板不可用'); return; }
    if (typeof t === 'string') tab = t === 'on' ? 'on' : 'avail';
    dlgReturnTo = (trigger && trigger.isConnected) ? trigger
      : (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    setTab(tab);
    paintCounts();
    /* 抽屉标题要说清"往哪个应用里装" —— 原来只有「装配组件」四个字，
       而同一个人手上可能开着好几个应用的配置页。 */
    var ttl = $('#dlg-title');
    if (ttl) { ttl.textContent = '装配组件'; ttl.removeAttribute('title'); }
    /* 画布让出抽屉宽度（app.html body[data-drawer]）：装完当场看见变化，不被自己挡住。 */
    document.body.setAttribute('data-drawer', 'on');
    mask.setAttribute('data-open', 'true');
    setBackgroundInert(true);
    /* ★2026-10-24：原来用 setTimeout(…,30) 才 focus —— 判据实测「打开后 activeElement=BODY」，
       也就是这 30ms 里键盘用户按 Tab 会从 body 起跳。改成同步 focus + 一帧后兜底重试。 */
    var s0 = $('#dlg-search');
    if (s0) {
      s0.focus();
      if (document.activeElement !== s0) requestAnimationFrame(function () { s0.focus(); });
    }
  }
  function closeDlg() {
    if (!mask) return;
    /* ★2026-11-05：关掉面板＝结束这一次操作。原来勾选留在内存里，下次打开会看到
       「批量升级（1）」，而用户早忘了勾的是哪一个 —— 一不小心就升错了。 */
    batchSel = {};
    mask.setAttribute('data-open', 'false');
    document.body.removeAttribute('data-drawer');
    setBackgroundInert(false);
    var back = dlgReturnTo;
    dlgReturnTo = null;
    if (back && back.isConnected && back.focus) {
      try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); }
    }
  }
  /* 还有别的模态层开着（卸下确认框 <div class="nf-mask">）时，抽屉自己的 Tab 圈禁要让开：
     不然焦点会被从确认框里抢回抽屉 —— 用户按 Tab 看不到「卸下 / 取消」。
     Esc 不用管：confirm.js 在 capture 阶段就 stopPropagation 了。 */
  function otherLayerOpen() {
    return !!document.querySelector('.nf-mask:not([hidden])');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    if (!mask || mask.getAttribute('data-open') !== 'true') return;
    if (otherLayerOpen()) return;
    var stops = dlgTabStops();
    if (!stops.length) return;
    var first = stops[0], last = stops[stops.length - 1], a = document.activeElement;
    if (!mask.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  });

  on('#dlg-close', 'click', closeDlg);
  on(mask, 'click', function (e) { if (e.target === mask) closeDlg(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!mask || mask.getAttribute('data-open') !== 'true') return;
    if (otherLayerOpen()) return;
    /* Esc 只退一层（§4.1 / §12.5）：先收确认态，抽屉不关；再按一次才关抽屉 */
    if (confirmId) { cancelUpdate(confirmId); return; }
    closeDlg();
  });
  on('#tab-avail', 'click', function () { setTab('avail'); });
  on('#tab-on', 'click', function () { setTab('on'); });
  /* ★2026-11-04：页签是 role=tab，键盘不能只靠 Tab 键一个个过 —— APG 的 Tabs 模式要求
     左右方向键在同一组页签间移动、Home/End 跳首尾。两处页签（装配面板 / 引用管理）同一行为了。 */
  function arrowTabs(list, sel, activate) {
    list.forEach(function (t, i) {
      t.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
          : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
        if (n === null) return;
        e.preventDefault();
        var to = list[(n + list.length) % list.length];
        to.focus();
        activate(to);
      });
    });
  }
  arrowTabs($$('.p-tabs [role="tab"]'), null, function (t) { setTab(t.getAttribute('data-tab')); });
  on('#dlg-search', 'input', renderList);

  /* 行内三态：点按钮走按钮，点行体走 toggle；键盘 Space/Enter 同一条路。
     ★更新视图的那几颗按钮带 data-do，行体上什么都没有 —— 见 toggle 的注释。 */
  on('#dlg-list', 'change', function (e) {
    var c = e.target.closest ? e.target.closest('[data-pick]') : null;
    if (!c) return;
    var id = c.getAttribute('data-pick');
    if (c.checked) batchSel[id] = 1; else delete batchSel[id];
    var row = c.closest('.row');
    if (row) row.classList.toggle('is-selected', !!c.checked);
    syncBatch(true);
  });
  on('#dlg-list', 'click', function (e) {
    /* 勾选不触发行体「点一下就装」的旧路径 */
    if (e.target.closest && e.target.closest('[data-pick]')) return;
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (btn) {
      var act = btn.getAttribute('data-do');
      if (act) {
        var host = btn.closest('.row');
        var cid = host && host.getAttribute('data-comp');
        if (!cid) return;
        if (act === 'update') return askUpdate(cid);
        if (act === 'cancel') return cancelUpdate(cid);
        if (act === 'confirm' || act === 'retry') return doUpdate(cid);
        if (act === 'undo') return undoUpdate(cid);
        return;
      }
      if (btn.getAttribute('data-on')) return doInstall(btn.getAttribute('data-on'));
      if (btn.getAttribute('data-off')) return doUninstall(btn.getAttribute('data-off'));
      if (btn.getAttribute('data-undo')) return clearFail(btn.getAttribute('data-undo'));
      return;                                    /* 其它按钮（清除搜索）自己处理 */
    }
    var row = e.target.closest ? e.target.closest('.row') : null;
    if (row) toggle(row.getAttribute('data-comp'));
  });
  on('#dlg-list', 'keydown', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('row')) return;
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
      e.preventDefault();
      toggle(t.getAttribute('data-comp'));
    }
  });

  /* ══ 7. 起手 ═════════════════════════════════════════════════ */
  bindCanvasOps();
  paintApp();
  paintCounts();
  renderCanvas();

  /* ── 从应用卡带着「谁能更新」进来（规格 §11.4 / §11.5）──────────────
     应用卡上是 `app.html?id=X&panel=installed&updates=1`，进来要有四个效果：
       ① 抽屉自动展开 ② 页签停在「已装配」③ 只显示有更新的行 ④ 筛选行出现
     参数只消费一次：消费后立刻从地址里摘掉 —— 关掉抽屉再刷新，不许又弹开。

     ★「无更新时参数作废」（派单口径 + §11.4）：N=0 时**不打开筛选**，
       落到普通的已装配列表，不报错、不显示筛选行。
       （§5.1 表里"N=0 / 只看有更新"那一格写的是筛选空态 + 筛选行，与 §11.4 相反；
         两处冲突时按派单明写的"只在有更新时生效"走，筛选空态只在
         "进去时还有、当场更新到 0"这条路上出现。） */
  /* ★2026-11-04（用户）：「为什么一进去应用配置，就给我直接打开装配组件弹窗，逻辑给我改啊」。
     带参进来（应用卡的「N 个组件可升级」链接）不再自动展开抽屉 —— 只把参数从地址里摘掉。
     想升级就自己点顶栏「装配组件」，进去看已装配页签上的可升级数。 */
  if (!VIEW_MODE) stripEntryParams();
})();
