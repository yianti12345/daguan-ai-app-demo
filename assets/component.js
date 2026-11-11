/* ─────────────────────────────────────────────────────────────
   component.js —— 组件配置：一块全屏画布 = 最终页面本身。

   架构变了，不是加功能：
   · 没有"预览"这个动作 —— 说完就边生成边长出来（逐段落进画布）
   · 没有顶栏 / 侧栏 / 对话历史 —— 返回是左上角一颗浮钮，组件名跟着它
   · 没有生成卡 (.made) —— 生成的结果就是画布本身
   · 输入台是一条浮在顶层的悬浮条（可拖、可收起），条上是 发送/保存/发布/收起

   画布内容不写死：三套骨架（工作台 / 表单页 / 列表页）由关键词路由，
   表头与字段名取自 DB.COMPS，应用名取自 DB.APPS。
   数据一律走 DB（assets/data.js），本文件不存副本。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ── toast：唯一实现在 assets/ui-kit.js（2.5 秒 · 新消息替换旧 · 错误升级 alert）。
     这里只留别名，调用处不用改；本页不再自己维护一份计时器。 ── */
  var toast = window.UIK.toast;

  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ══ 0. 数据源 ══════════════════════════════════════════════ */
  var TEMPLATE_MODE=!!window.TemplateBridge;
  var DB=TEMPLATE_MODE?TemplateBridge.db:window.DB;
  if (DB && DB.load) DB.load();

  var LS_LAST_APP = 'ifas90:lastApp';
  var LS_NEW_COMP = 'ifas90:newComp';
  /* 一次性「置顶」信号：组件库读到就消费。与 LS_NEW_COMP 分开是 2026-10-28
     盲审回归的修法 —— 指针要长期活着给配置页认回自己，旧版却把它当置顶标记
     2 秒后删掉，于是「生成 → 组件库 → 回来」成了空白新建页。 */
  var LS_NEW_COMP_FLASH = 'ifas90:newCompFlash';
  /* ?new=1＝从组件库「创建组件」进来，明确要一条新的（见下面的认回逻辑） */
  var NEW_FLAG = /[?&]new=1(&|$)/.test(location.search);

  var appList = function () { return (DB && DB.APPS) ? DB.APPS : []; };
  function appById(id) { return (DB && DB.appById) ? DB.appById(id) : null; }
  function targetApp() {
    var last = null;
    try { last = localStorage.getItem(LS_LAST_APP); } catch (e) {}
    return (last && appById(last)) || appList()[0]
      || { id: '', name: '未选择应用', client: '', status: '', updated: '', comps: [] };
  }
  function cname(id, fb) {
    var c = (DB && DB.compById) ? DB.compById(id) : null;
    return c ? c.name : fb;
  }
  function fieldsOf(id, fb) {
    var c = (DB && DB.compById) ? DB.compById(id) : null;
    return (c && c.fields && c.fields.length) ? c.fields : fb;
  }

  /* ── 唯一 id ────────────────────────────────────────────────
     为什么不能用写死的 id：写死过（comp-review-desk），后果是数据丢失 ——
     第二条生成按同一个 id 写库，第一条被静默顶掉；装过第一条的应用
     下一次打开就换成了第二条的内容，界面上没有任何提示。
     现在：一次真·新建铸一个新 id，id 只在**第一次生成成功**时铸
     （那时候才知道这条叫什么），同一页后来再说的话沿用这个 id（= 迭代）。 */
  function mintCompId(name) {
    var taken = function (id) { return !!(DB && DB.compById && DB.compById(id)); };
    /* ① comp-<名称 slug>：只有纯英文名取得出 slug（中文没有可拼的字母） */
    var slug = String(name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    if (slug) {
      var base = 'comp-' + slug, id = base, n = 2;
      while (taken(id)) { id = base + '-' + n; n++; }
      return id;
    }
    /* ② comp-<序号>：序号按库里已有 comp-N 的最大值 +1。
       不用时间戳 —— 时间戳做 id 读不出这是什么，列表里也排不出新老。 */
    var max = 0;
    ((DB && DB.COMPS) || []).forEach(function (c) {
      var m = /^comp-(\d+)$/.exec(String((c && c.id) || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    var num = max;
    do { num++; } while (taken('comp-' + num));
    return 'comp-' + num;
  }

  /* ── 一句描述：由这句话落成的结构里派生 ───────────────────────
     原来 desc 恒为字面量「双栏工作台：左边审批流……」，做完「合同到期提醒」
     卡上还是那句与本句无关的模板残留 —— 用户无法靠它认这条是什么。
     三级派生：① 第一个 text 块的正文（按标点收，不超过卡片两行）
     ② 前两个块标题拼「A · B」③ 都没有就空串。**不写任何写死的业务描述。**

     ★2026-10-28（体验官 F4）：原来 `.slice(0, 40)` 是**按字数硬切**。
       实测卡上出现「…暂停新业务发」「…推送提醒，」：半句、断在词中间、
       还以逗号收尾。40 字仍是两行的预算（卡面 --cc-measure 20em ÷ 14px
       每行 20 字、两行 40 字），但落点改由标点决定：
         ① 窗口内有句末标点（。！？…）→ 收到那一句为止；
         ② 只有停顿标点（，、；：）→ 收到停顿前的整段，补「…」；
         ③ 一个标点都没有 → 退到空格/数字字母串的边界，补「…」。
       三种落点都以标点收尾，且不会把数字/字母词从中间劈开。
       ⚠ 中文没有词间空格，③ 在纯中文长句里只能保证"不劈数字/字母"；
         这是标点优先策略的已知边界，不是"应该没问题"。 */
  var DESC_LIMIT = 40;                 /* 卡面两行容量（含收尾标点） */
  var DESC_END = /[。！？!?…]$/;
  function specDesc(spec) {
    var bs = (spec && spec.blocks) || [];
    var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
    /* 收尾：先去句尾停顿标点（避免「…提醒，」），再补真正的收尾标记。
       预算按**含标记**的 40 字算，卡面仍是两行（C3 量 scrollH = 38）。 */
    var finish = function (body, mark) {
      body = String(body || '').replace(/[\s，,、；;：:]+$/, '');
      var room = DESC_LIMIT - mark.length;
      if (body.length > room) body = body.slice(0, room).replace(/[\s，,、；;：:]+$/, '');
      return body ? body + mark : '';
    };
    var clip = function (raw) {
      var s = clean(raw);
      if (!s) return '';
      if (s.length < DESC_LIMIT) {
        /* 整段放得下：已经是句末标点就原样；否则补句号 ——
           卡上「…推送提醒」看起来仍像被系统截断，补一个句号才读成"说完了"。 */
        return DESC_END.test(s) ? s : finish(s, '。');
      }
      var head = s.slice(0, DESC_LIMIT);
      var m, last = -1;
      var SENT = /[。！？!?…]/g;
      while ((m = SENT.exec(head))) last = m.index;
      if (last >= 2) return s.slice(0, last + 1);
      last = -1;
      var CLAUSE = /[，,、；;：:]/g;
      while ((m = CLAUSE.exec(head))) last = m.index;
      if (last >= 8) return finish(s.slice(0, last), '…');
      /* 窗口里一个标点都没有：退到词边界再收。
         ① 有空格就切在空格；② 数字/字母串整段保留（不把「30」切成「3」）。 */
      var cut = DESC_LIMIT - 1;
      var sp = head.lastIndexOf(' ');
      if (sp >= 8) cut = sp;
      while (cut > 8 && /[0-9A-Za-z]/.test(s.charAt(cut - 1))) cut--;
      return finish(s.slice(0, cut), '…');
    };
    for (var i = 0; i < bs.length; i++) {
      if (bs[i] && bs[i].type === 'text' && bs[i].text) {
        var t = clip(bs[i].text);
        if (t) return t;
      }
    }
    var titles = [];
    bs.forEach(function (b) {
      var t = b && b.title ? clean(b.title) : '';
      if (t && titles.indexOf(t) < 0) titles.push(t);
    });
    /* 标题派生的是名词短语（不是半句），但没有句末标点时卡上仍像被截断；
       统一由 clip 补「。」，让卡面每一句都读得完。 */
    return clip(titles.slice(0, 2).join(' · '));
  }

  /* ── 兜底描述符 block:{kind,src,limit} ───────────────────────
     边界：spec 在时一律渲染 spec（app.js 的 blockFor 里 spec 优先，这条不变）；
     block 只在 spec 缺失/被删时接手，保证画布还能画出主块的形状（表头 + 行），
     而不是白屏或只剩一串字段名。主块＝第一个 table，没有则 cards → form → text。 */
  function specBlockOf(spec) {
    var bs = (spec && spec.blocks) || [];
    var first = function (t) {
      for (var i = 0; i < bs.length; i++) if (bs[i] && bs[i].type === t) return bs[i];
      return null;
    };
    var tb = first('table');
    if (tb) return { kind: 'table', src: null, limit: 0, rows: (tb.rows || []).slice(0, 18) };
    if (first('cards')) return { kind: 'cards', src: null, limit: 0 };
    if (first('form')) return { kind: 'detail', src: null, limit: 0 };
    if (first('text')) return { kind: 'text', src: null, limit: 0 };
    return null;
  }

  /* 正在造的组件：id 空 = 这一页还没落过库，生成成功时铸（见 mintCompId） */
  var COMP = {
    id: '',
    name: '',
    ver: 'v1',
    status: '未发布',
    desc: '',        /* 由 specDesc 派生，不写死业务描述 */
    fields: [],
    /* spec＝模型生成的那份页面骨架。库里存着它，刷新才能回到同一条页面；
       只有 fields 的话，刷新只能按名字猜骨架，等于"生成结果用完就丢"。 */
    spec: null,
    /* block＝spec 被删/丢失时的兜底描述符（kind/src/limit），见 specBlockOf */
    block: null
  };

  /* 编辑入口：列表页「配置」带 ?id=<组件 id> 进来改一个老组件。
     找得到 → 认这条记录（发布时更新、不新增）；找不到 → 就是新建。 */
  var EDIT_ID = (function () {
    var m = /[?&]id=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  })();
  var EDIT_COMP = (EDIT_ID && DB && DB.compById) ? DB.compById(EDIT_ID) : null;
  /* 记录存在 ≠ 有内容：列表页的"创建组件"是张表单，提交后立刻建了一条
     fields=[] 的草稿再跳过来。那种情况必须还是空态（等对话编排），
     但 id 要认下来，保存/发布才是更新而不是再插一条。 */
  var MISSING_COMP = !!(EDIT_ID && !EDIT_COMP);   /* 链接指向已删组件：不静默当新建 */
  var EXISTS = !!EDIT_COMP;
  var HAS_CONTENT = !!(EDIT_COMP && EDIT_COMP.fields && EDIT_COMP.fields.length);
  var IS_EDIT = EXISTS;
  /* ★2026-10-27（UE 走查实测）：标签页标题是 HTML 里写死的「新建组件」，永远不变。
     于是从应用配置页点「配置」跳到一个**已有**组件（?id=rule-panel）时，
     浏览器标签仍报「新建组件」—— 第一眼会以为自己误触了新建。
     而这一页的「保存草稿 / 发布新版本」改的是**共享组件**（实测抬头「装于 … 等 3 个」），
     误判代价不是"白干一次"，是改掉另外两个客户的应用。
     无 id 时继续沿用「新建组件」，只有认到已有组件才换成真名。 */
  if (IS_EDIT) {
    document.title = EDIT_COMP.name + ' · 组件配置';
    COMP.id = EDIT_COMP.id;
    COMP.name = EDIT_COMP.name;
    COMP.ver = EDIT_COMP.ver || COMP.ver;
    COMP.desc = EDIT_COMP.desc || '';
    COMP.status = EDIT_COMP.status;
    COMP.spec = EDIT_COMP.spec || null;
    COMP.block = EDIT_COMP.block || null;
  } else if (DB && DB.compById) {
    /* ★2026-10-28（四个实测缺陷之 1）：新建页认回**哪一条**，只由指针
       `ifas90:newComp` 决定 —— 这个指针以前只写不读，于是"刷新认回同一条"
       根本无从谈起（id 写死成 comp-review-desk，认回的永远是那一条）。
       三态：
         · ?new=1            → 明确要一条新的：不认指针（id 留空，生成时铸）
         · 指针解析得到       → 认回那条最近草稿（刷新不空白、不换条）
         · 指针悬空 / 没有    → id 留空，第一次生成成功时铸一个唯一 id
       带 id 但库里没有（链接指向已删组件）→ 沿用链接里的 id 当新建，不另铸。 */
    var POINTER = '';
    try { POINTER = localStorage.getItem(LS_NEW_COMP) || ''; } catch (e) {}
    var SAVED = (!NEW_FLAG && POINTER) ? DB.compById(POINTER) : null;
    if (SAVED) {
      COMP.id = SAVED.id;
      COMP.name = SAVED.name || '';
      COMP.desc = SAVED.desc || '';
      COMP.ver = SAVED.ver || COMP.ver;
      COMP.status = SAVED.status || COMP.status;
      COMP.spec = SAVED.spec || null;
      COMP.block = SAVED.block || null;
      if (SAVED.fields && SAVED.fields.length) COMP.fields = SAVED.fields.slice();
      /* 认回的是一条已经落库的记录：面包屑该说「未装配到应用」，不是「新建组件」 */
      EXISTS = true;
      HAS_CONTENT = !!((SAVED.fields && SAVED.fields.length) || SAVED.spec);
      /* 标签页标题跟着这条走。原来只有 ?id 分支会改标题，指针认回的这一支
         浏览器标签一直报「新建组件」—— 和可见标题（#comp-name）不是一回事，
         用户低头看一眼标签会以为回来的是另一张空页。 */
      document.title = (SAVED.name || '组件') + ' · 组件配置';
    } else if (EDIT_ID) {
      /* ★2026-11-02（独立前端审计）：原来把链接里的 id 直接收下当新建，
         用户从一张过期链接进来会以为在改旧组件，保存后还可能用旧 id 复活它。
         现在只报"不在了"，COMP.id 留空，保存时铸新 id。 */
    }
  }
  if (MISSING_COMP) {
    document.title = '组件不存在 · 组件配置';
    var strip = document.createElement('div');
    strip.className = 'err-strip';
    strip.setAttribute('role', 'alert');
    strip.innerHTML = '<span>这个组件已经不在了（链接过期或已被删除）。下面是新建空白组件，不会覆盖任何旧数据。</span>'
      + '<a class="strip-act" href="components.html">回组件库</a>';
    var cv = document.getElementById('canvas');
    if (cv && cv.parentNode) cv.parentNode.insertBefore(strip, cv);
  }

  /* 描述这一格归谁写：空着 ⇒ 归生成（每次迭代跟着这句话更新）；
     已经有字（创建表单里人写的）⇒ 归人，生成不许盖掉。 */
  var DESC_AUTO = !COMP.desc;

  /* ★2026-10-28（产品判断第 8 位 E6）：?v=N 从版本台账取那一版快照，按它渲染。
     只读：进来只为了"看旧版长什么样"，不在这里改。 */
  var VIEW_V = (function () { var m = /[?&]v=(\d+)/.exec(location.search); return m ? parseInt(m[1], 10) : 0; })();
  var VIEW_ONLY = false;
  if (VIEW_V && EDIT_ID && DB && DB.versOf) {
    var _rec = DB.versOf('comp', EDIT_ID).filter(function (r) { return r.kind === 'stable' && r.v === VIEW_V; })[0];
    if (_rec && _rec.snap) {
      COMP.spec = _rec.snap.spec || null;
      if (_rec.snap.fields) COMP.fields = _rec.snap.fields.slice();
      if (_rec.snap.name) COMP.name = _rec.snap.name;
      if (_rec.snap.desc) COMP.desc = _rec.snap.desc;
      COMP.ver = 'v' + VIEW_V;
      VIEW_ONLY = true;
      /* 只读提示：不标出来，用户会以为正在改当前版 */
      document.addEventListener('DOMContentLoaded', function () {
        var cv = document.getElementById('comp-ver');
        if (cv) cv.textContent = '只读 · v' + VIEW_V;
        var ta = document.querySelector('textarea');
        if (ta) { ta.disabled = true; ta.placeholder = '这是历史版本，只读；要改请回到当前版'; }
        var pb = document.getElementById('act-publish');
        if (pb) {
          /* 2026-10-29：默认口径下这颗不可执行，但原因必须看得见（原生 disabled 的 title 不弹）。 */
          if (window.UIK && UIK.setDisabled) UIK.setDisabled(pb, true, '历史版本只读：要改请回到当前版');
          pb.textContent = '历史版本只读';
        }
      });
    }
  }

  /* ══ 1. 画布里的样例数据（这套业务里的真实取值，不是 Lorem）═══ */
  /* 金额要带单位：「8,000」看不出是万还是元，这种数字在审核场景里等于没写。
     行数补到 8：列表页一屏 8 行是常态，4 行会让卡片下半空一大块。 */
  /* ★2026-10-24（组件页截图实测）：第 5 列「处理人」原来没有数据，
     通用渲染器（tableFor → listRows）会补 '—'，一屏八行全是「—」，
     看起来像"这个字段没做"。补上真名字，taskTable 与 tableFor 两个渲染器共用同一份。 */
  var TASKS = [
    ['DC-2026-1031', '债券承做',   '8,000 万',  '待复核', '张启明'],
    ['DC-2026-1029', '债券承做',   '1.20 亿',   '已通过', '王立'],
    ['DC-2026-1027', '债券承做',   '6,500 万',  '待复核', '张启明'],
    ['DC-2026-1024', '项目收益债', '1.50 亿',   '已驳回', '陈静'],
    ['DC-2026-1019', '债券承做',   '4,300 万',  '已通过', '李审核'],
    ['DC-2026-1014', '中登查重',   '—',          '已通过', '王立'],
    ['DC-2026-1008', '债券承做',   '9,800 万',  '待复核', '陈静'],
    ['DC-2026-1002', '项目收益债', '2,600 万',  '已通过', '李审核']
  ];
  /* 状态 → chip 色调。原来映射到 .bd-st-*（纯色字），被 .tb td 的 color 盖掉了，
     界面上三个状态全是灰的 —— 页面"显示不正常"但没有任何判据会红。 */
  var ST = { '待复核': 'wait', '已通过': 'done', '已驳回': 'bad',
             '已启用': 'done', '已禁用': 'wait', '草稿': 'wait' };

  /* 单元格示例值：按字段名派生。
     为什么要有它 —— 原来列表骨架只画「审核任务列表」那一张表，任何组件落进来都长成它。
     判据判不出"内容对不对"，只有人一眼看得出。这里给每个已知字段一组值，
     **未登记的字段回退到「—」**，宁可显示空也不编一句假话。 */
  var CELL = {
    '规则组':   ['医药准入规则组', '采购合规规则组', '供应商资质规则组', '价格异常规则组',
                 '票据合规规则组', '合同条款规则组', '发票抬头规则组', '预算科目规则组'],
    '口径':     ['医药', '医药', '医药', '医药', '医药', '医药', '医药', '医药'],
    '排序':     ['1', '2', '3', '4', '5', '6', '7', '8'],
    '启用状态': ['已启用', '已启用', '已禁用', '已启用', '已禁用', '已启用', '已启用', '已禁用'],
    '任务':     ['DC-2026-1031', 'DC-2026-1029', 'DC-2026-1027', 'DC-2026-1024',
                 'DC-2026-1019', 'DC-2026-1014', 'DC-2026-1008', 'DC-2026-1002'],
    '复核人':   ['王立', '张启明', '王立', '王锐', '张启明', '王锐', '王立', '张启明'],
    '复核意见': ['已核对原始凭证', '金额与合同一致', '需补充授权文件', '已核对原始凭证',
                 '待补材料', '与承做端结论一致', '已核对原始凭证', '金额需复核'],
    '字段名':   ['发行人名称', '债券代码', '发行规模', '票面利率', '债券期限', '起息日', '到期日', '主承销商'],
    '抽取值':   ['华信证券股份有限公司', '012345.HK', '20 亿元', '3.85%', '5 年', '2026-09-01', '2031-09-01', '中信建投'],
    '置信度':   ['0.98', '0.96', '0.99', '0.97', '0.95', '0.99', '0.98', '0.93'],
    '规则名':   ['主体资格', '关联交易', '重大违法', '发行规模', '募集用途', '担保安排', '信息披露', '决议程序'],
    '结论':     ['已通过', '待复核', '已驳回', '已通过', '已通过', '待复核', '已通过', '已通过'],
    '依据引用': ['第 2 页 3.1', '第 5 页 4.2', '第 7 页 5.1', '第 3 页 2.4',
                 '第 4 页 3.6', '第 6 页 4.8', '第 8 页 5.3', '第 9 页 6.1']
  };
  var FLOW = [
    ['DC-2026-1031', '债券承做 · 等我复核'],
    ['DC-2026-1027', '债券承做 · 等我复核'],
    ['DC-2026-1019', '项目收益债 · 我提交']
  ];
  var DOC = [
    '本次债券发行规模不超过人民币 20 亿元，期限不超过 5 年，由主承销商余额包销。',
    '发行人最近三年不存在重大违法行为，<mark>最近三年财务报表未被出具非标准审计意见</mark>。',
    '募集资金拟用于偿还到期债务及补充流动资金，不用于房地产相关业务。'
  ];
  var RULES = [
    ['主体资格', '已通过', '第 2 页 3.1'],
    ['关联交易', '待复核', '第 5 页 4.2'],
    ['重大违法', '已驳回', '第 7 页 5.1']
  ];

  /* ══ 2. 画布骨架：三段共用的小零件 ═══════════════════════════ */
  function pageHead(app, tag) {
    /* ★ 2026-10-23：原来这里再写一遍 app.name，而页面顶栏已经显示同一个名字 ——
       同一屏出现两次同样的字，是信息冗余，不是层次。卡片头只留"这是什么视图"+动作。 */
    /* 动作文字按组件走。原来所有组件都写「新建审核」—— 在"规则配置"页上它说不通。
       默认退回「新建」：宁可泛一点，也不要在规则页上说"新建审核"。 */
    var NEW_LABEL = {
      'task-list': '新建审核', 'task-detail': '新建审核', 'rule-panel': '新建规则',
      'verify-queue': '新建复核', 'ruleset-cfg': '新建规则组', 'ruleset-med': '新建规则组',
      'doc-extract': '新建抽取'
    };
    var lbl = NEW_LABEL[COMP.id] || '新建';
    return '<div class="page-hd"><b>' + esc(tag) + '</b>'
      + '<button type="button" class="btn primary page-act" title="预览示意：不会真的新建">' + esc(lbl) + '</button></div>';
  }
  function statusBar() {
    /* 「由「应用头」生成」是**内部用语**：组件名是研发侧的概念，用户不需要知道这一页是哪个组件拼的。
       （同一类问题 2026-10-23 早上已经因为「进配置调组件、发布新版本」被骂过一次。） */
    return '<div class="status"><i></i><b>审核中 · 12 条待处理</b></div>';
  }
  function flowPane() {
    return '<aside class="bd-flow">'
      /* ★ 原来这里是「审批流 + 复核队列」——「复核队列」是组件名，是研发概念。
         用户不需要知道这一栏是哪个组件拼的，只需要知道这是审批流。 */
      + '<div class="bd-sec">审批流</div>'
      + '<div class="bd-seg" aria-current="true"><span>待我审</span><b>7</b></div>'
      + '<div class="bd-seg"><span>我提交</span><b>3</b></div>'
      + '<div class="bd-seg"><span>已完结</span><b>2</b></div>'
      + '<ul class="bd-list">'
      + FLOW.map(function (f, i) {
          return '<li' + (i === 0 ? ' aria-current="true"' : '') + '><b>' + esc(f[0]) + '</b>'
            + '<span>' + esc(f[1]) + '</span></li>';
        }).join('')
      + '</ul></aside>';
  }
  /* 处理记录：右栏第三块。
     加它的理由不是"好看"，是这块内容本来就该在 —— 审核页不留操作痕迹，
     人无法回答"这条结论是谁在什么时候改的"。顺带把右栏下半的空补齐。 */
  function auditTrail() {
    var rows = [
      ['10-23 09:12', '张启明', '初审结论：2 条通过、1 条待复核'],
      ['10-22 17:40', '王立',   '双人复核，驳回「重大违法」并附依据'],
      ['10-22 15:03', '系统',   '抽取 12 个字段，置信度均高于 0.9']
    ];
    return '<div class="bd-trail"><div class="bd-sec">处理记录</div>'
      + rows.map(function (r) {
          return '<div class="trail-row"><span class="trail-t">' + esc(r[0]) + '</span>'
            + '<span class="trail-who">' + esc(r[1]) + '</span>'
            + '<span class="trail-txt">' + esc(r[2]) + '</span></div>';
        }).join('')
      + '</div>';
  }
  function docPane() {
    return '<section class="bd-orig">'
      + '<div><div class="bd-sec">原文对照</div>'
      + '<div class="bd-doc">' + DOC.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div></div>'
      + '</section>';
  }
  /* 表单页的一行字段（label 在上、值在下；表单页是单列，一行一个） */
  function fieldRow(label, value) {
    return '<div class="bd-field"><label>' + esc(label) + '</label>'
      + '<span class="bd-input">' + esc(value) + '</span></div>';
  }
  /* 当前组件自己的字段。取不到就用列表骨架的默认五个 —— 但要能看出"这是默认"。 */
  function listFields() {
    var c = (COMP && COMP.id && DB.compById) ? DB.compById(COMP.id) : null;
    var fs = (c && c.fields && c.fields.length) ? c.fields
           : ((COMP.fields && COMP.fields.length) ? COMP.fields : LAYOUTS.list.fields);
    return fs.slice();
  }

  /* 行数据：task-list 用真实业务数据（它有具体含义），其它组件按字段名派生示例值。 */
  function listRows() {
    if (COMP.id === 'task-list') return TASKS;
    var fs = listFields();
    var n = 8;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(fs.map(function (f) {
        var arr = CELL[f];
        return arr ? arr[i % arr.length] : '—';
      }));
    }
    return out;
  }

  /* ── 预览里的「勾选 / 批量指派 / 状态筛选」（2026-10-26）────────────
     这一页是"这个组件长什么样"的**唯一凭据**：用户在组件库点进来看到的就是它。
     而它原来只有一张 5 列静态表 + 一颗点不动的「全部（状态）」——
     同一块在应用画布上有首列勾选（表头全选 + 行内单选）、批量带、行内选人、
     真改处理人、toast 报数。两处形态不同，看预览的人会得出"这个组件只能看、
     不能批量处理"的结论。那不是样式差异，是预览在说谎。
     这里把同一套能力搬过来，判断条件与 app.js 一字不差（canPick = 任务列表）。
     ⚠ 选中态存 PICK（任务编号 → true），不是只看勾选框：
       画布整块重绘，DOM 一换勾选就没了；状态跟着数据走，重画后仍对得上。 */
  var PICK = {};          /* 任务编号 → true */
  var PICKING = false;    /* 选人区是否展开（只在有选中时有意义） */
  var FILTER = '';        /* 状态筛选值；'' = 全部 */
  var KWS = '';           /* 预览里的关键字；空 = 不过滤 */

  function pickable() { return COMP.id === 'task-list'; }
  function pickCount() { return Object.keys(PICK).length; }

  /* 能当筛选依据的那一列：与 list 骨架挑 chip 文案时用的是同一条判据 */
  function statusCol() {
    var fs = listFields();
    for (var i = 0; i < fs.length; i++) if (/状态|口径|结论/.test(fs[i])) return i;
    return -1;
  }
  function ownerCol() {
    var fs = listFields();
    for (var i = 0; i < fs.length; i++) if (/处理人/.test(fs[i])) return i;
    return fs.length - 1;
  }
  /* 筛选项 = 这一列里**真出现过**的值，去重、按出现顺序 —— 不编一个数据里没有的状态 */
  function statusOpts() {
    var idx = statusCol(), seen = {}, out = [];
    if (idx < 0) return out;
    listRows().forEach(function (r) {
      var v = r[idx] == null ? '—' : String(r[idx]);
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }
  /* 表格里现在该出现哪些行。筛选只改"看得见哪些"，不删数据；
     行数、计数、批量带都从这一份算，屏幕上数得清的和写出来的一致。 */
  function shownRows() {
    var rows = listRows(), idx = statusCol();
    if (FILTER && idx >= 0) rows = rows.filter(function (r) { return String(r[idx]) === FILTER; });
    if (KWS) {
      var k = KWS.toLowerCase();
      rows = rows.filter(function (r) {
        return r.some(function (v) { return String(v == null ? '' : v).toLowerCase().indexOf(k) >= 0; });
      });
    }
    return rows;
  }

  function tableFor() {
    var fs = listFields();
    var rows = shownRows();
    var canPick = pickable();
    var th = (canPick ? '<th class="tb-ck"><input type="checkbox" id="ck-all" aria-label="全选"></th>' : '')
      + fs.map(function (f) { return '<th>' + esc(f) + '</th>'; }).join('');
    var tr = rows.map(function (r) {
      return '<tr>' + (canPick
        ? '<td class="tb-ck"><input type="checkbox" data-ck="' + esc(r[0]) + '"'
          + (PICK[r[0]] ? ' checked' : '') + ' aria-label="选择 ' + esc(r[0]) + '"></td>'
        : '') + fs.map(function (_, i) {
        var v = r[i] == null ? '—' : String(r[i]);
        var tone = ST[v];
        return '<td>' + (tone
          ? '<span class="cond" data-k="' + tone + '">' + esc(v) + '</span>'
          : esc(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var body = tr || '<tr><td class="tb-empty" colspan="' + (fs.length + (canPick ? 1 : 0)) + '">没有匹配的行</td></tr>';
    return '<table class="tb"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  /* 批量带 + 行内选人。候选只从表格里出现过的人名去重，不新编一个人。
     这一条带**常驻可见**（0 条时按钮置灰），与应用画布"选中才浮出"不同：
     预览页的职责是把组件会的动作摆出来，藏起来等于没做（承诺"支持批量指派"，
     屏上却找不到这四个字，就是同一类假话）。 */
  /* 选人块 HTML 只有一份（assets/ui-kit.js）；本页只算「候选是谁」。
     这条与 app.js 原来各存一份 494 字符逐字相同的实现，已合并。 */

  function assignees() {
    var idx = ownerCol(), seen = {}, out = [];
    listRows().forEach(function (r) {
      var n = r[idx];
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }
  function batchBar() {
    var n = pickCount(), open = PICKING && n > 0;
    return '<div class="tb-batch" id="tb-batch">'
      + '<b id="tb-batch-n">已选 ' + n + ' 条</b>'
      + '<button type="button" class="tb-batch-btn" id="tb-assign"' + (n ? '' : ' disabled')
      + ' aria-expanded="' + (open ? 'true' : 'false') + '">批量指派</button>'
      + '<button type="button" class="tb-batch-btn tb-batch-cancel" id="tb-cancel"'
      + (n ? '' : ' disabled') + '>取消</button>'
      + (open ? UIK.pickHtml(assignees()) : '')
      + '</div>';
  }

  /* 状态筛选：真控件。原来那颗 `.bd-chip` 是 span —— 写着"全部（状态）"、点不动，
     等于把"能筛"这件事画在纸上。选项从数据来，切换后行数真的变。 */
  function filterHtml() {
    var fs = listFields(), idx = statusCol();
    var st = idx >= 0 ? fs[idx] : '';
    if (!st) return '<span class="bd-chip">全部</span>';
    return '<select class="bd-chip bd-chip-sel" id="bd-filter" aria-label="按' + esc(st) + '筛选">'
      + '<option value="">全部</option>'
      + statusOpts().map(function (v) {
          return '<option value="' + esc(v) + '"' + (v === FILTER ? ' selected' : '') + '>'
            + esc(v) + '</option>';
        }).join('')
      + '</select>';
  }

  function taskTable() {    var f = fieldsOf('task-list', ['任务编号', '业务类型', '金额', '状态', '处理人']);
    var rows = TASKS.map(function (t) {
      return '<tr><td>' + esc(t[0]) + '</td><td>' + esc(t[1]) + '</td><td>' + esc(t[2]) + '</td>'
        + '<td><span class="cond" data-k="' + (ST[t[3]] || '') + '">' + esc(t[3]) + '</span></td>'
        + '<td>' + esc(t[4] || '李审核') + '</td></tr>';
    }).join('');
    return '<table class="tb"><thead><tr>'
      + '<th style="width:26%">' + esc(f[0]) + '</th><th style="width:20%">' + esc(f[1]) + '</th>'
      + '<th style="width:16%">' + esc(f[2]) + '</th><th style="width:18%">' + esc(f[3]) + '</th>'
      + '<th>' + esc(f[4] || '处理人') + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ══ 3. 三套骨架：每套由"段"组成，生成时逐段落地 ═════════════ */
  var LAYOUTS = {
    workbench: {
      name: '审核工作台',
      tag: '工作台式',
      desc: '双栏工作台：左边审批流，右边原文对照，规则结论逐条可追溯。',
      fields: ['任务编号', '业务类型', '金额', '状态', '处理人'],
      steps: [
        { html: function (app) { return pageHead(app, '审核工作台') + statusBar(); } },
        { html: function () { return '<div class="bd-two">' + flowPane() + '</div>'; } },
        { into: '.bd-two', html: docPane },
        { into: '.bd-orig', html: function () {
            return '<div class="bd-rules"><div class="bd-sec">' + esc(cname('rule-panel', '规则结论')) + '</div>'
              + '<table><thead><tr><th style="width:34%">规则名</th><th style="width:24%">结论</th><th>依据</th></tr></thead>'
              + '<tbody>' + RULES.map(function (r) {
                  return '<tr><td>' + esc(r[0]) + '</td><td class="' + (ST[r[1]] || '') + '">' + esc(r[1])
                    + '</td><td>' + esc(r[2]) + '</td></tr>';
                }).join('') + '</tbody></table></div>' + auditTrail();
          } }
      ]
    },

    form: {
      name: '审核任务表单',
      tag: '表单式',
      desc: '单列表单：字段分两组纵向排列，底部两个动作。',
      fields: ['任务编号', '业务类型', '金额', '期限', '处理人'],
      /* 骨架必须和工作台不同：工作台是 220px + 1fr 双栏，这里是**单列居中**。
         只有"整页结构不一样"，用户才看得出"装了一个东西"，而不是换了个标题。 */
      steps: [
        { html: function (app) {
            return pageHead(app, '任务信息')
              + '<div class="bd-form-hd"><b>新建审核任务</b><span>5 个字段 · 提交后进入复核队列</span></div>';
          } },
        { html: function () {
            return '<div class="bd-single">'
              + '<div class="bd-group">'
              + '<div class="bd-sec">基本信息</div>'
              + '<div class="bd-fields">'
              + fieldRow('任务编号', 'DC-2026-1032') + fieldRow('业务类型', '债券承做')
              + '</div></div></div>';
          } },
        { into: '.bd-single', html: function () {
            return '<div class="bd-group">'
              + '<div class="bd-sec">金额与期限</div>'
              + '<div class="bd-fields">'
              + fieldRow('金额（万元）', '8,000') + fieldRow('期限', '5 年') + fieldRow('处理人', '李审核')
              + '</div></div>';
          } },
        { into: '.bd-single', html: function () {
            return '<div class="bd-form-acts"><button type="button" class="ghost">保存</button>'
              + '<button type="button" class="primary">提交审核</button></div>';
          } }
      ]
    },

    /* ★ 2026-10-23 新增：页头骨架。
       之前「应用头」落到工作台，打开看到的是审批流 + 原文对照 + 规则结论 —— 一个页头组件
       被画成了一整页审核工作台。它不是页面，它是一条装在页面顶部的横条。
       这套骨架只做两件事：画一条真实的页头预览 + 列出它包含哪几样东西。 */
    header: {
      name: '应用头',
      tag: '页头',
      desc: '应用名、客户标识与全局操作位，装在每个应用最上方。',
      fields: ['应用名', '客户标识', '全局操作位'],
      steps: [
        { html: function (app) {
            return pageHead(app, '应用头')
              + '<div class="bd-single">'
              + '<div class="bd-group"><div class="bd-sec">装到应用顶部时的样子</div>'
              + '<div class="bd-hdprev"><b>' + esc(app.name || '应用名') + '</b>'
              + '<span class="cond" data-k="done">已上架</span>'
              + '<span class="bd-hdprev-act">新建审核</span></div></div>'
              + '<div class="bd-group"><div class="bd-sec">它包含</div><div class="bd-fields">'
              + fieldRow('应用名', app.name || '—')
              /* ★2026-11-02：应用不再挂客户（一应用可授多家），这里说授权家数 */
              + fieldRow('客户授权', (function () {
                  try {
                    var n = DB.authRows(app.id).filter(function (r) { return r.status === '已授权'; }).length;
                    return n ? n + ' 家已授权' : '还没有授权';
                  } catch (e) { return '—'; }
                })())
              + fieldRow('全局操作位', '新建审核 · 导入')
              + '</div></div></div>';
          } }
      ]
    },

    list: {
      name: '任务列表',
      tag: '列表式',
      desc: '一条筛选带一张表，底部计数与分页。',
      fields: ['任务编号', '业务类型', '金额', '状态', '处理人'],
      /* ★ 2026-10-23：这三段原来是写死的（卡头「任务列表」、搜索"任务编号或业务类型"、
         表格是 TASKS、分页写「第 1-4 条」）。所以任何组件落进 list 骨架，都长成"审核任务列表"。
         现在全部按 COMP 自己的字段算 —— 骨架只提供布局，内容来自这个组件本身。 */
      steps: [
        { html: function (app) {
            var fs = listFields();
            return pageHead(app, COMP.name || '列表')
              + '<div class="bd-filters">'
              + '<input class="bd-search" type="search" id="bd-search" value="' + esc(KWS) + '"'
              + ' placeholder="搜索' + esc(fs[0] || '关键字') + '" aria-label="搜索' + esc(fs[0] || '关键字') + '">'
              + filterHtml()
              + '</div>';
          } },
        /* 批量带与表格同一块：带在表上方，勾选后数字与按钮状态就地更新（不重画） */
        { html: function () {
            return '<div class="bd-one">' + (pickable() ? batchBar() : '') + tableFor() + '</div>';
          } },
        { into: '.bd-one', html: function () {
            /* ★2026-10-24（实测）：原来写死「共 (n+4) 条」再挂一个不可点的「2」
               —— 8 行却说共 12 条、点 2 没反应，正是 gen.js:470 自己禁的
               "死控件 + 编总数"。这里改成：总数就是**当前筛出来的**真行数；
               只有一页就不出翻页按钮链。 */
            var n = shownRows().length;
            return '<div class="bd-pager"><span>第 1-' + n + ' 条 / 共 ' + n + ' 条</span>'
              + '<span class="pg" aria-current="true">1</span></div>';
          } }
      ]
    }
  };

  function pickLayout(text) {
    if (/表单|录入|填写|新建页/.test(text)) return 'form';
    if (/列表|表格|筛选|分页/.test(text)) return 'list';
    return 'workbench';
  }

  /* 改老组件时，首屏按它原来的名字推一套骨架（名字里带"列表"就出列表页），
     没有 ?id 就是新建，首屏给工作台样例。 */
  /* ★ 2026-10-23：布局分派改了两次，记下来免得再走回头路。
     第一版只认「表单」「列表」两个词 → 复核队列/规则配置/规则修订/文档抽取 全部落到工作台，
     打开"规则配置"看到的是审批流 + 原文对照，跟规则配置毫无关系。
     第二版按组件名加词表 → 还是漏：文档抽取的名字里没有那几个词。
     第三版（现在）**按字段语义判**：只有"原件/原文"这种并列语义才需要双栏工作台，
     其余一律是列表 —— 因为绝大多数组件本质就是"一堆同类条目"。名字会骗人，字段不会。 */
  function layoutByName(name, fields) {
    var fs = fields || [];
    if (COMP.id === 'app-header') return 'header';   /* 页头组件：一条横条，不是一整页 */
    if (/表单|录入|填写/.test(name)) return 'form';
    if (fs.some(function (f) { return /原件|原文/.test(f); })) return 'workbench';
    return 'list';
  }
  var START_LAYOUT = HAS_CONTENT ? LAYOUTS[layoutByName(COMP.name, EDIT_COMP && EDIT_COMP.fields)] : LAYOUTS.workbench;

  /* ★2026-11-03（用户 m02760）：「每个应用或者组件进去，我不是都说了要都清空，变为空态吗？」
     组件页原来一进来就铺满示例（任务表/详情/规则面板），看的人会以为这里已经有真实内容。
     现在一律从空态起步：要什么，对话里说一句再生成。 */
  if(!TEMPLATE_MODE)HAS_CONTENT = false;

  /* ══ 4. 画布渲染 ═════════════════════════════════════════════ */
  var canvasEl = $('#canvas');
  var canvasInner = $('#canvas-inner');
  var genbar = $('#genbar');

  /* 把一段 html 落地。直接搬子节点（不包 wrapper），双栏的 grid 关系才不会被破坏 */
  function appendTo(host, html, animate) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) {
      var n = tmp.firstChild;
      tmp.removeChild(n);
      if (n.nodeType === 1 && animate) n.classList.add('cstep');
      host.appendChild(n);
    }
  }

  function renderAll(layout, app, animate) {
    var page = el('div', 'page');
    layout.steps.forEach(function (s) {
      var html = typeof s.html === 'function' ? s.html(app) : (s.html || '');
      var host = s.into ? page.querySelector(s.into) : page;
      if (host) appendTo(host, html, animate);
    });
    return page;
  }

  /* 顶栏只显示**当前应用名**。组件名/版本/发布状态是内部信息，不该占标题位
     （用户 2026-10-23 原话：「直接就是只显示当前应用名称就行了」）；
     而且画布里的内容本身已经在表达"这是什么"。 */
  function setCompName() {
    if(TEMPLATE_MODE){TemplateBridge.refreshHeader();return;}
    var n = $('#comp-name');
    if (!n) return;
    /* ★ 判定"新建还是编辑"只能用 EXISTS（id 是否真在库里）：带一个库里没有的
       id 同样是新建态。COMP.id 现在也不是常量了（新建时由 mintCompId 铸，
       见文件上半段），拿它拼"有没有落库"同样会判错 —— 落库与否是 DB 的事实。 */
    /* 新建组件生成之后，顶栏应该显示**它叫什么**（模型给的名字），
       而不是永远「新建组件」—— 那会让人以为这一页还没落地。 */
    /* ★ 2026-10-24 改口：标题位给**组件名**，应用名退到前面的面包屑里。
       上一版按 10-23 的话"只显示当前应用名"，结果站在组件配置页上标题写着应用名，
       用户第一眼以为走错页（m03024「配置页面设计不合理」）。
       "装在哪"与"在配什么"是两条信息，一个占标题、一个占面包屑，不再互相顶掉。 */
    n.textContent = (COMP && COMP.name) ? COMP.name : (EXISTS ? '组件' : '新建组件');
    /* ★2026-11-04（用户：「配置详情左上角再加一行介绍，太长也要能点开看全部」）：
       介绍写进顶栏第二行，超长单行省略；截断时才挂点击（未截断点它没反应更糟）。 */
    var hdDesc = $('#comp-desc');
    if (hdDesc) {
      var dTxt = (COMP && COMP.desc) ? COMP.desc : '';
      if (hdDesc.textContent !== dTxt) {
        hdDesc.textContent = dTxt;
        delete hdDesc.dataset.fullBound;
        hdDesc.classList.remove('is-clip');
      }
      if (window.UIK && UIK.Full) UIK.Full.bindLine(hdDesc, n.textContent, dTxt);
    }
    /* ★2026-10-26 P1「归属说不清」（图04）：
       这一行原来**无条件**写 targetApp().name，而 targetApp() 会回落到 lastApp / APPS[0] ——
       于是「新建组件」页上也挂着「华信证券 · 债承审核」，用户会以为自己在那个应用里新建、
       以为新组件绑死在那应用上。
       判新建还是编辑只能用 EXISTS（id 在库里是否真存在），不能用 EDIT_ID：
       带一个库里没有的 id 同样是新建态。
       三态各说各的：
         · 新建态 → 「新建组件」，这一段**不许**出现任何应用名；
         · 编辑态但没有任何应用装着 → 「未装配到应用」；
         · 编辑态且被 N 个应用装着 → 分隔符从「/」换成「装于」，第二段写「第一个 等 N 个」——
           这一行才读成"它装在哪"，而不是"它在哪个应用里"。N 从 DB.APPS 现算，不写死。 */
    var crumb = $('#comp-app');
    var owners = !EXISTS ? [] : appList().filter(function (a) {
      return a.comps && a.comps.indexOf(COMP.id) >= 0;
    });
    if (crumb) {
      var sepEl = $('#comp-sep');
      if (!EXISTS) {
        if (sepEl) sepEl.textContent = '/';
        crumb.textContent = '新建组件';
      } else if (!owners.length) {
        if (sepEl) sepEl.textContent = '/';
        crumb.textContent = '未装配到应用';
      } else {
        /* 拼成一句人话：「装于 华信证券 · 债承审核」「装于 华信证券 · 债承审核 等 3 个应用」。
           ★2026-10-28 修（E3a）：上一版分隔符写的是「·」，尾句是「在用」——
           只装一个应用时整行读成「组件库 · 华信证券 · 债承审核 在用」，尾句没有主语；
           而且「·」既接前缀又接应用名，一行里两个同样的分隔符，看不出"装于"是关系。
           现在分隔符就是关系词（装于），数量只在 >1 时补「等 N 个应用」，
           0 个 / 新建态的句子一个零件都没动（它们本来就是完整句）。 */
        if (sepEl) sepEl.textContent = '装于';
        crumb.textContent = owners[0].name
          + (owners.length > 1 ? ' 等 ' + owners.length + ' 个应用' : '');
      }
    }
    paintMeta();
    var chip = $('#comp-status');
    if (chip && COMP && COMP.status) {
      /* 2026-10-30：这一页原来直接印 COMP.status（已上架/已下架），组件库印的是
         DB.compState（启用/禁用/未发布）—— 同一件事两种说法，且「上架」是电商词。
         现在两页同源：词与配色都取 DB 那一份，这里不再写第二套对照表。 */
      chip.hidden = true;   /* 2026-11-04 m01223：状态只在名称右边那一句里说一次 */
      chip.textContent = DB.compState(COMP);
      chip.setAttribute('data-st', DB.compStateCls(COMP));
    }
  }

  /* 首屏空态：第一次进配置页没有内容，等对话生成。
     ★ 2026-10-23（第二轮）：上一版是「一行灰字 + 一个开始对话按钮」，占了整屏却只说了
       一句正确但没用的话 —— 用户看着一大片灰，仍然不知道"我该说什么"。
       现在补的是**起手示例**：三句话，点了填进输入框（不是直接生成）。
       不画样例页 —— 用户定过"首屏必须是空的，内容靠对话长出来"。
       示例句是"提示"，不是"内容"：画布上没有一个像素是假数据。 */
  function renderEmpty() {
    /* ★2026-11-04（用户 m01223）：「跟应用配置页面基本类似」——
       空态不再是一张自造的卡 + 三条示例，改成与应用配置页同一种：两行字，居中。
       输入条也不再上抬（原来靠 body.is-empty 抬到卡下方），它本来就该在底部常态位。 */
    document.body.classList.remove('is-empty');
    canvasInner.innerHTML = '<section class="cv-empty">'
      + '<b>这个组件还没有内容</b>'
      + '<p>说清它解决什么问题、谁在用，边问边生成。</p>'
      + '</section>';
    /* 空态还没有东西可存：保存快照置灰。
       之前它是可点的 —— 点了会真的把版本号 +1，
       用户会发现自己保存了一个空页面。 */
    setOpsDisabled(true);
  }

  function setOpsDisabled(v) {
    if(TEMPLATE_MODE)TemplateBridge.setBusy(v);
    ['#act-publish'].forEach(function (sel) {
      var b = document.querySelector(sel);
      if (!b) return;
      /* ★2026-11-04（用户 m01223）：与应用配置页同一套 —— 两颗按钮常驻、可点；
         没内容时点了由 onPublish/onDraft 说一句"先说要做什么"，不改名字、不变灰。 */
      b.textContent = TEMPLATE_MODE?'发布':'保存并发布版本';
      if (window.UIK && UIK.setDisabled) UIK.setDisabled(b, TEMPLATE_MODE&&!TemplateBridge.canManage(), '');
    });
  }

  /* 顶栏第二段：更新时间 + 启用状态（用户 m01223：左上角只显示名称、版本号、版本时间、启用状态） */
  function paintMeta() {
    if(TEMPLATE_MODE)return;
    var meta = document.getElementById('comp-meta');
    if (!meta) return;
    var rec = (DB && COMP && COMP.id && DB.compById) ? DB.compById(COMP.id) : null;
    var when = (COMP && (COMP.updated || COMP.savedAt)) || (rec && rec.updated) || '';
    var st = (DB && DB.compState) ? DB.compState(COMP) : ((COMP && COMP.status) || '');
    var t = when ? String(when).replace(/^20\d\d-/, '').replace(/-/g, '/') : '';
    /* 2026-11-04 m01223：名称右边读起来要是一件完整的事 —— 「v2 · 更新于 10/30 10:02:17 · 启用」。
       分隔符在这里给，不靠两个 span 之间的空白去猜。 */
    meta.textContent = (t ? '· 更新于 ' + t + ' · ' : ' · ') + st;
  }

  function paintInitial() {
    if(TEMPLATE_MODE&&TemplateBridge.previewHtml()){setCompName();return;}
    canvasEl.setAttribute('data-busy', 'false');
    canvasEl.setAttribute('data-error', 'false');
    /* 版本号的格子里只放版本号；「未发布/启用/禁用」由右边那一句说一次（同页不重复播报）。 */
    $('#comp-ver').textContent = COMP.ver;
    paintMeta();
    /* ① 有生成结果（spec）→ 照它画。这是"生成的东西真的留下来了"的唯一证据：
       刷新之后还长这样。之前只存 fields，刷新就退回按名字猜的骨架，
       等于每次刷新都把我当时生成的那一页丢掉。
       ⚠ 这一支必须在"空态"之前判：新建页的 HAS_CONTENT 恒为 false（库里还没有这条），
         放在后面的话生成完一刷新就落到空态 —— 实测就是这样丢的。 */
    if (COMP.spec && window.Gen) {
      setOpsDisabled(false);
      document.body.classList.remove('is-empty');
      var out = Gen.renderComponent(COMP.spec);
      var pg = el('div', 'page');
      /* 含表格的页面 = 列表页形态：一屏一页、表格体内部滚动、分页钉在底部。
         不加这个类的话，10 行表 + 表头 + 筛选就超出视口，分页被压到屏幕外 ——
         用户看到的是"一张长得没头、也没有分页的表"。 */
      if ((COMP.spec.blocks || []).some(function (b) { return b.type === 'table'; })) {
        pg.className = 'page has-table';
      }
      appendTo(pg, out.head, false);
      out.sections.forEach(function (h) { appendTo(pg, h, false); });
      canvasInner.innerHTML = '';
      canvasInner.appendChild(pg);
      setCompName(COMP.name || COMP.spec.title);
      cur = COMP.spec;
      return;
    }
    if (!HAS_CONTENT) {
      /* 空态：刚从创建表单进来（或直接打开新建页）。
         有名字就先用名字，没有就是"新组件"。 */
      setCompName(COMP.name || '新组件');
      renderEmpty();
      return;
    }
    /* ② 老组件（库里只有 fields、没有 spec）→ 按字段语义推骨架 */
    var L = START_LAYOUT;
    document.body.classList.remove('is-empty');
    canvasInner.innerHTML = '';
    canvasInner.appendChild(renderAll(L, targetApp(), false));
    setCompName(COMP.name + ' · ' + L.tag);
    cur = L;
    COMP.fields = L.fields.slice();
  }

  /* ══ 5. 边生成边预览：进度条 + 逐段落地 ═════════════════════ */
  var busy = false, pending = '', lastText = '', cur = null, failNext = false;

  function progress(pct) {
    genbar.removeAttribute('data-off');
    genbar.style.width = pct + '%';
  }
  function progressDone() {
    progress(100);
    if (ui && ui.addMsg && lastText) {
      var local = window.__genMode === 'local';
      ui.addMsg('cfg', '已按「' + lastText + '」改好了，看画布。'
        + (local ? '（本机没接上模型，这一版是按规则搭的；接上模型后同一句话会搭得更贴。）' : ''));
    }
    setTimeout(function () { genbar.setAttribute('data-off', 'true'); }, 300);
    setTimeout(function () { genbar.style.width = '0'; }, 520);
  }

  function endBusy() {
    busy = false;
    if (ui && ui.setBusy) ui.setBusy(false);   /* ★2026-11-06 浮条那颗键从「停止」回到「发送」 */
    canvasEl.setAttribute('data-busy', 'false');
    canvasEl.setAttribute('aria-busy', 'false');
  }
  /* ★ 2026-10-25 补第 9 条（Nielsen「帮用户识别、诊断、恢复」）：
     真实失败时提示的是 e.message —— "模型没给出可用的 JSON""模型 75 秒没回应"，
     这些是给工程师看的。用户需要三件事：出了什么、为什么、我能做什么。
     技术原文仍然打到 console，方便排查；屏幕上一律说人话。 */
  function humanizeErr(e) {
    var raw = String((e && e.message) || e || '');
    try { console.warn('[生成失败]', raw); } catch (x) {}
    if (/JSON|结构|解析|不完整|补不齐/.test(raw)) return '模型这次返回的内容不完整。可以再说一次，或者把要求写短一点。';
    if (/秒没回应|超时|timeout|abort/i.test(raw)) return '模型响应太慢，等超时了。点「重试」再来一次。';
    if (/连不上|网络|fetch|Failed/i.test(raw)) return '连不上模型服务。检查网络或本机服务是否在跑。';
    /* ★2026-11-06：额度用尽时上游回 429/quota，原来落到「这次没做成」，
       用户不知道是额度问题，会反复重试。这条要单独说清。 */
    if (/429|quota|额度|配额|rate.?limit/i.test(raw)) return '模型额度用完了，等额度恢复再试。';
    if (/没有模型代理|xz\/plan/.test(raw)) return '这个环境没接模型，换到本地起的服务再试。';
    return '这次没做成。点「重试」再来一次，或把要求写短一点。';
  }

  function showError(msg) {
    endBusy();
    canvasEl.setAttribute('data-error', 'true');
    $('#err-txt').textContent = msg || '这次没生成出来';
    $('#err-strip').hidden = false;
    $('#comp-ver').textContent = COMP.ver;
    paintMeta();
  }
  function clearError() {
    canvasEl.setAttribute('data-error', 'false');
    $('#err-strip').hidden = true;
  }

  /* ── 真生成（2026-10-23 改，用户原话：「必须真实」）──────────────
     旧：pickLayout(text) 在四个写死的 LAYOUTS 里挑一个。不管你说"做一个供应商准入复核页"
         还是"做一个发票查验页"，出来的永远是那三套骨架之一 —— 那是演示，不是生成。
     新：这句话交给本机 WorkBuddy 的模型（同源 /xz/plan），拿回页面骨架 JSON，
         再用设计系统的组件落地。
     分工写死：**模型决定结构（有哪几块、每块说什么），契约决定样式（长什么样）**。
     不让模型直接吐 HTML 是故意的：它会给每个元素各写一套圆角/阴影/字号，
     那正是这套系统一直在治的病。
     三种失败各自说清，且画布保留上一次成功的画面：
       服务没起 / 模型没给 JSON / 结构不可用。 */
  /* ★2026-10-31 用户明确：撤回整个不要（「没有任何一家 Agent 平台做这种撤回」）。
     原来这里存一份"生成前"快照供撤回用，随按钮一起删除；生成仍然即落库、不可逆。 */
  /* ── 这一句是"改这条"还是"另起一条"──────────────────────────
     同一页连续说多句，默认是对**当前这条**的迭代（沿用 id，不新建）。
     例外是用户明确在说另一条业务：「做一个 X」再「做一个 Y」，
     Y 是另一条，不该把 X 顶掉（实测就是被顶掉了）。
     判据只看句首创建动词 + 数量词，且句子里没有迭代词（再加/改成/删掉…）；
     宁可少判新建，也不要把"在现有这条上加一列"误判成新建。 */
  var NEW_INTENT = /(^|[，。；、\s]|再|又|另外)(帮我)?(做|建|新建|生成|来|要)(一|一个|一条|一份|张)(?!改|成)/;
  var EDIT_INTENT = /(再加|增加|补充|加一|加上|改成|改为|换成|删掉|去掉|在这|这块|这一块|这条|当前)/;
  function wantsNewComp(text) {
    var s = String(text || '');
    return NEW_INTENT.test(s) && !EDIT_INTENT.test(s);
  }

  /* 另起一条：清掉"正在造"的状态，id 留空等生成成功时铸
     （这样 id 能带名称，而不是先铸一个无名号再改名）。
     上一条已经落库，这次不会写它。 */
  function newCompSession() {
    COMP = { id: '', name: '', ver: 'v1', status: '未发布', desc: '', fields: [], spec: null, block: null };
    cur = null;
    EXISTS = false;
    if(!TEMPLATE_MODE)HAS_CONTENT = false;
    DESC_AUTO = true;   /* 这条还没有描述，归生成写 */
    /* 另起一条＝这一条还没落过库，"未发布/选不到"这件事要重新说一次 */
    noticeShown = false;
    if (typeof setCompName === 'function') setCompName();
  }

  function generate(text) {
    if(TEMPLATE_MODE&&!TemplateBridge.canManage()){toast('仅查看');return;}
    if (!text) return;
    if (busy) { pending = text; toast('前面还有一句在生成'); return; }
    /* 另起一条：这一页已经落过库，而这句话是"做一个 Y" ⇒ 换一条，
       Y 写进新 id，X 原样留在库里（组件库件数 +1，不是把 X 顶掉）。 */
    if (!TEMPLATE_MODE && !IS_EDIT && COMP.id && DB && DB.compById && DB.compById(COMP.id) && wantsNewComp(text)) {
      newCompSession();
    }
    if (!window.Gen) { showError('生成器没加载（assets/gen.js 不在）'); return; }
    lastText = text;
    clearError();
    busy = true;
    if (ui && ui.setBusy) ui.setBusy(true);    /* ★2026-11-06 执行态：描边呼吸 + 键变停止 */
    canvasEl.setAttribute('data-busy', 'true');
    canvasEl.setAttribute('aria-busy', 'true');
    $('#comp-ver').textContent = '正在生成…';
    progress(8);
    /* ★ 2026-10-24：说了话必须有回音。原来只有一条 2px 进度条 + 一句 6 秒后的回复，
       用户实测得到的是"什么都没发生"。现在这三处都进对话区：开始、成、败。 */
    /* ★2026-11-06（用户：对话只有"开始处理"或"失败"两种结果）：进度不播报成一句对话，
       否则会在结果之上多一条"我在干活"的话。就地反馈靠状态位 + 画布进度条。 */

    /* ?fail=1：下一次生成失败一次（只失败一次）。画布一个像素都不动。 */
    if (failNext) {
      failNext = false;
      setTimeout(function () { progress(34); }, 240);
      setTimeout(function () {
        genbar.setAttribute('data-off', 'true');
        setTimeout(function () { genbar.style.width = '0'; }, 200);
        showError('这次没生成出来');
        toast('这次没生成出来，画布还是上一次的样子', 'error');
        /* ★ 2026-10-28：失败这一轮也要进对话区，和下面 catch 分支说同一件事。
           原来这里只弹 toast + 提示条，对话里最后一条还是「正在搭一版」——
           收起后折叠条读到的是"进行中"，而实际已经失败了（浮层该不该自己收，
           也靠这条消息判：「报错」要留着让人看见，不能收）。 */
        if (ui && ui.addMsg) ui.addMsg('cfg', '这次没搭成。画布还是上一次的样子。');
      }, 760);
      return;
    }

    var app = targetApp();
    /* 模型要几秒。这段进度是"等待"的反馈，不是假完成：
       它只到 42%，答案回来之后才继续。 */
    var wait = 8;
    var tick = setInterval(function () {
      wait = Math.min(42, wait + 3);
      progress(wait);
    }, 360);

    Gen.componentSpec(text, {
      app: app ? app.name : '',
      name: IS_EDIT ? COMP.name : '',
      fields: COMP.fields,
      compId: COMP.id || ''
    }).then(function (spec) {
      clearInterval(tick);
      progress(50);
      /* 名字：新建用模型给的标题；改老组件不覆盖名字（名字是它在库里的身份）。
         迭代（同一页第 2 句起）同样不覆盖 —— 实测「把状态这一列去掉」会把
         「合同到期提醒」改成「债承合同台账」，用户以为换了一条。
         只有用户明确在改名（"改名叫…"）时才跟着改。
         描述同理：由这句话派生（specDesc），但只接管**还没人写过**的那一格；
         打开已有组件（?id）时不动它的描述 —— 那是它在库里的介绍。 */
      if (!IS_EDIT) {
        var RENAME = /改名|改叫|叫做|命名为|名字改|标题改/.test(String(lastText || ''));
        if (!COMP.name || RENAME) COMP.name = spec.title;
        if (DESC_AUTO) COMP.desc = specDesc(spec);
      }
      COMP.fields = Gen.specFields(spec);
      COMP.spec = spec;
      COMP.block = specBlockOf(spec);
      /* 第一次生成成功才铸 id：这时候才知道这条叫什么。 */
      if (!COMP.id) {
        COMP.id = mintCompId(spec.title);
      }
      paintSpec(spec);
    }).catch(function (e) {
      clearInterval(tick);
      /* ★2026-11-06：人点「停止」时请求被 abort，走到这里 —— 说"停了"，别当失败。 */
      if (/abort/i.test(String((e && e.message) || e || ''))) {
        endBusy();
        if (ui && ui.addMsg) ui.addMsg('cfg', '已经停下来了，画布还是上一次的样子。');
        return;
      }
      genbar.setAttribute('data-off', 'true');
      setTimeout(function () { genbar.style.width = '0'; }, 200);
      showError(humanizeErr(e));
      toast('没生成出来', 'error');
      /* ★2026-11-06：原来这里直接拼 e.message，界面上就出现
         「这次没搭成：上游模型失败（502）：{"error": "upstream 429 …"}」——
         客户看到一坨 JSON。画布上的错误条早就用 humanizeErr 折成人话了，
         对话里这条漏了，改成同一个来源。 */
      /* ★2026-11-06（同一条：失败不要额外气泡）：标成"没执行"，原因走提示条。 */
      if (ui && ui.failLast) ui.failLast();
      toast(humanizeErr(e), 'error');
      /* 失败这一轮也留在同一条组件的会话里（迭代时 id 已经有了） */
      mirrorHistoryToComp();
    });
  }

  /* 逐段落地：每落一段就是模型结构里的一块。
     这是"边做边给你看"的真实版本 —— 段的边界来自结构，不来自定时器编的步数。 */
  function paintSpec(spec) {
    setOpsDisabled(false);
    /* ★ 2026-10-28（必需，不是顺手改）：空态那一屏把输入条抬到了页面中部
       （component.html:77 `body.is-empty .fk-dock{top:calc(50% + 132px)}`），
       内容一落地必须把类摘掉 —— 这一支漏了，于是生成完之后输入条停在 582..942
       （视口底 900，半个条在屏幕外），对话收起也收不到底：收起条仍压着表格行，
       "收起＝让出画布"就不成立（实测收起态交集 209920 px²，收起与展开一个样）。
       paintInitial / renderAll 两支早就这么写了，这里补上同一句。 */
    document.body.classList.remove('is-empty');
    var out = Gen.renderComponent(spec);
    var page = el('div', 'page');
    /* 同 render()：含表格的页面走"一屏一页 + 表格体内部滚动 + 分页钉底"的形态 */
    if ((spec.blocks || []).some(function (b) { return b.type === 'table'; })) {
      page.className = 'page has-table';
    }
    var steps = out.sections;
    var i = 0;
    var total = steps.length + 1;

    function step() {
      if (i === 0) {
        canvasInner.innerHTML = '';
        canvasInner.appendChild(page);
        appendTo(page, out.head, true);
      } else {
        appendTo(page, steps[i - 1], true);
      }
      i++;
      progress(Math.round(50 + (i / total) * 50));
      if (i < total) setTimeout(step, 260);
      else setTimeout(done, 220);
    }

    function done() {
      progressDone();
      cur = spec;
      /* 生成成功即落库：不落库刷新就回到旧画面，等于"生成了但没留下"。
         状态保持原样 —— 生成不该把已上架的组件偷偷降回草稿。 */
      var prev = (DB && DB.compById && DB.compById(COMP.id)) ? DB.compById(COMP.id).status : '未发布';
      if(!TEMPLATE_MODE)upsert(prev);
      /* ★2026-10-28（体验官 F2）：顶栏必须在**落库之后**再画。
         上一版这一句在 upsert 之前：那一刻 id 是刚铸的、库里还没有这条，
         EXISTS 仍是 false，面包屑画成「新建组件」；去组件库再后退，页面从
         指针认回同一条（EXISTS=true），面包屑变成「未装配到应用」——
         同一页面两个名字，用户会读成"状态变了"。
         落库后再画，两处读的是同一件事实：它已经落库、只是还没装进任何应用，
         所以生成完成与后退回来都读「未装配到应用」，逐字相同。
         标签页标题是同一件事：不同步的话，生成完低头看标签仍是「新建组件」。 */
      setCompName(COMP.name || spec.title);
      if (COMP.id && DB && DB.compById && DB.compById(COMP.id)) {
        document.title = (COMP.name || '组件') + ' · 组件配置';
      }
      $('#comp-ver').textContent = COMP.ver + (prev === '已上架' ? '' : ' · 未发布');
      paintMeta();
      /* ★2026-10-28（断点）：落库之后才谈得上"它现在能不能装"。
         这一句读的是 upsert 之后的 COMP.status（事实），不是生成前的猜测；
         已上架 / 已下架 都不适用，条件写在 tellDraftNotInstallable 里。 */
      tellDraftNotInstallable();
      endBusy();
      /* 会话（含上一行的「未发布」提示）跟到这条组件的 id 名下：
         下一次从组件库回来，认回的是同一条，对话区也还是这一段。 */
      mirrorHistoryToComp();
      /* 2026-10-31：「撤回这次生成」按钮已删，这里不再控制它的显隐。 */
      if (pending) { var t = pending; pending = ''; generate(t); }
    }

    step();
  }

  /* ══ 5.1 生成成功 ≠ 能装：当场说清它卡在哪一步 ═══════════════════
     装配面板只列已上架（DB.canInstall 是唯一谓词）。刚生成的这一条还是未发布，
     不说这句话，用户会去装配面板找不到，再回来以为"刚才根本没生成成功"。
     三个信息必须同一句说完，缺一条用户就还得自己猜：
       ①现在是什么状态（未发布）②不能装到什么程度（装配面板里选不到）
       ③那一步在哪（右上角「保存」，按钮上印的就是这两个字，不另造词）。
     只说**这次生成**：重新打开一条已上架的组件不该看到这句（见 pruneDraftNotice）。 */
  /* 2026-11-05：原来三句话把同一件事说了两遍（"选不到" / "才会出现" / "那时才能装配"）。 */
  var DRAFT_NOTICE = '这一版还没发布，装配面板里选不到它；点右上角「保存」发布。';
  /* 同一页连续说几句（迭代）只提示一次：这件事没变，重复播报等于噪音。
     另起一条（newCompSession）时重新计。 */
  var noticeShown = false;

  /* 这句话只在"还没发布"时成立。历史按组件 id 存 localStorage，重新打开会原样重播 ——
     组件已经上架之后再看到"还选不到它"，是**错的**：那时它在装配面板里。
     所以打开一条已上架的组件时，读历史之前先把这句摘掉（只摘这一句，用户说的话一条不碰）。 */
  function pruneDraftNotice() {
    var key = 'ifas90:hist:comp:' + (COMP && COMP.id ? COMP.id : 'new');
    try {
      var arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (!arr || typeof arr.length !== 'number') return 0;
      var kept = arr.filter(function (m) {
        return !(m && m.who === 'xz' && m.text === DRAFT_NOTICE);
      });
      if (kept.length !== arr.length) localStorage.setItem(key, JSON.stringify(kept));
      return arr.length - kept.length;
    } catch (e) { return 0; }
  }

  /* ★ 2026-10-28（体验官 F7：同一条「未发布」提示重复播报，11 条里第 4、8 条同文）
     来路：这句是"这条组件还没发布"的一次性告知，内存里用 noticeShown 去重；
     但从组件库回来（或刷新）是一次整页加载，noticeShown 归零，而历史里那句还在
     （首次生成时镜像到 …:comp:<id>）—— 回来第一次迭代又把同一句写了一遍。
     第 3 次不复现，是因为那次页面没重载、内存标记已经置上。
     修法两层：①挂载前先把同一组件历史里的重复句收成一句（旧数据也洗干净）；
              ②说话前问历史（ui.hasMsg），已经说过就不再写。 */
  function dedupeDraftNotice() {
    if(TEMPLATE_MODE)return;
    if (!COMP || !COMP.id) return 0;
    var key = 'ifas90:hist:comp:' + COMP.id;
    try {
      var arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (!arr || typeof arr.length !== 'number') return 0;
      var seen = false;
      var kept = arr.filter(function (m) {
        if (m && m.who === 'xz' && m.text === DRAFT_NOTICE) {
          if (seen) return false;      /* 只留最早那句；后写的都是同一件事 */
          seen = true;
        }
        return true;
      });
      if (kept.length !== arr.length) localStorage.setItem(key, JSON.stringify(kept));
      return arr.length - kept.length;
    } catch (e) { return 0; }
  }

  function tellDraftNotInstallable() {
    if(TEMPLATE_MODE)return;
    if (noticeShown) return;
    /* 已上架：装得进去，没什么可说的。已下架：那是"重新上架"的事，
       不是"发布后才能装配"，同一句话会误导 —— 不在本条射程内就不说。 */
    if (!COMP || COMP.status !== '未发布') return;
    if (!(ui && ui.addMsg)) return;
    /* F7：这句已经在**这条组件自己的历史**里说过，就不再重复。
       只认"历史确实属于当前这条"（HIST_COMP_ID＝挂载时历史指向的组件）：
       另起一条时历史键还停在上一条上，不能拿上一条的提示把这一条也吞掉。 */
    if (COMP.id && COMP.id === HIST_COMP_ID && ui.hasMsg && ui.hasMsg(DRAFT_NOTICE)) {
      noticeShown = true;
      return;
    }
    noticeShown = true;
    ui.addMsg('cfg', DRAFT_NOTICE);
  }

  /* 2026-10-31：「撤回这次生成」整段已删（按钮 + 点击绑定 + 快照恢复）。
     用户原话：「没有任何一家 Agent 平台做这种撤回」；撤一步就要支持撤多步、还要能取消撤回。
     生成仍然即落库、不可逆。 */

  /* ══ 6. 浮层：底部对话框 + 右下操作组（都来自 assets/float.js）══════
     位置 / 尺寸 / 收起 / 拖动 / 键盘行为只在 float.js 里定义一次，
     本页只挂行为（onSend / 保存 / 发布），不再自己写条、按钮、收起逻辑。 */
  /* 2026-10-27 单一工作区：没有手动「保存草稿」。
     生成/编辑即自动 upsert；版本只在点「保存快照」时产生。 */

  /* 装了这个组件的应用有几个 —— 只读统计。
     发布前要问的那句话里必须有它：组件的"新版本"不是只改自己，装了它的应用
     画布跟着换。不说这个数，用户在点「发布」的时候根本不知道自己动了谁。 */
  function usersOf() {
    return (DB && DB.APPS ? DB.APPS : appList()).filter(function (a) {
      var list = (DB && DB.APP_COMPS[a.id]) || a.comps || [];
      return list.indexOf(COMP.id) >= 0;
    }).length;
  }

  function nextCompV() {
    var st = (DB && DB.versOf) ? DB.versOf('comp', COMP.id).filter(function (r) { return r.kind === 'stable'; }) : [];
    return (st.length ? Math.max.apply(null, st.map(function (r) { return r.v; })) : 0) + 1;
  }

  function onPublish() {
    if(TEMPLATE_MODE){var next=nextCompV();Confirm.ask({title:'发布新版本 v'+next+'？',body:UIK.esc(COMP.name),ok:'发布',onOk:function(){try{upsert(COMP.status,next);toast('已发布 v'+next);}catch(e){toast(e.message,'error');}}});return;}
    if (!cur) { toast('先说要做什么，还没有可以保存的内容'); return; }
    /* 发号只认台账最大号：不再用 COMP.status/ver 猜，避免造出两条同号 */
    var n = usersOf();
    var bump = 'v' + nextCompV();
    Confirm.ask({
      title: '保存为 ' + bump + '？',
      body: n
        ? '装了它的 <b>' + n + '</b> 个应用会跟着换成 ' + bump + '。客户要等各自的应用重新发布后才看到 —— 组件变了不等于应用已发布。'
        : '当前没有应用装配它。',
      ok: '保存 ' + bump,
      onOk: function () { commitPublish(bump); }
    });
  }

  function commitPublish(bump) {
    /* 先写快照，写成了才改状态/报成功；写失败不许留下"已上架"的假象 */
    var snap = { spec: COMP.spec || null, fields: (COMP.fields || []).slice(), desc: COMP.desc, name: COMP.name };
    var v = null;
    try { if (COMP.id) v = DB.pushCompVer(COMP.id, bump, snap); } catch (e) { v = null; }
    if (!v) { toast('没保存上，内容还在'); return; }
    COMP.ver = 'v' + v;
    upsert('已上架');
    setCompName();
    var n = usersOf();
    $('#comp-ver').textContent = COMP.ver;
    paintMeta();
    showPub('已保存 ' + COMP.ver + ' · 影响到 ' + n + ' 个应用');
  }

  /* 已上架的组件重新打开：历史里那句"还没发布"已经不成立，读历史之前先摘掉
     （必须在 Float.mount 之前 —— 它一挂载就把 localStorage 里的历史读进内存）。
     未发布的组件：旧历史里可能已经重复了同一句（F7），挂载前收成一句。 */
  if (COMP && COMP.status === '已上架') pruneDraftNotice();
  else dedupeDraftNotice();

  /* ★2026-10-28（盲审「生成 → 组件库 → 回来」回归的配套）：
     从"还没有 id"的新建态进来时，Float 的历史键在挂载那一刻就定死了（…:comp:new）；
     而 id 是**第一次生成成功**才铸的。不把这段会话镜像到 id 名下，
     回来认回组件后对话区是空的 —— 「未发布」那句提示也跟着丢
     （画布在、字段在、字没了，用户同样会以为刚才那次生成不算数）。
     只镜像、不搬走：本页后续消息仍写 …:comp:new，每次生成成功后再镜像一次，
     所以 …:<id> 始终是本页的最新副本。 */
  var HIST_FOLLOW_NEW = !(COMP && COMP.id);
  /* F7：挂载那一刻历史归属哪条组件。空＝新建态共用 …:comp:new（里面可能还有
     上一条组件的提示，不能当成本条的历史）。 */
  var HIST_COMP_ID = (COMP && COMP.id) ? COMP.id : '';
  function mirrorHistoryToComp() {
    if (!HIST_FOLLOW_NEW || !COMP || !COMP.id) return;
    try {
      var raw = localStorage.getItem('ifas90:hist:comp:new');
      if (raw) localStorage.setItem('ifas90:hist:comp:' + COMP.id, raw);
    } catch (e) {}
  }

  var ui = window.Float ? window.Float.mount({
    /* 人点浮条上的「停止」：掐断当前这次模型调用。 */
    onStop: function () { try { if (window.Gen && Gen.abort) Gen.abort(); } catch (e) {} },
    dialog: {
      placeholder: TEMPLATE_MODE?'描述你要调整的模版':'描述你要的组件',
      onSend: function (text) { generate(text); }
    },
    /* 历史按组件分开存：换一个组件不该看到上一个组件的对话 */
    historyKey: (TEMPLATE_MODE?'ifas90:hist:template:':'ifas90:hist:comp:') + (COMP && COMP.id ? COMP.id : 'new'),
    /* 历史卡上的版本号向台账核一次，不在了就不给假入口（2026-11-02） */
    versionExists: function (v) {
      return (DB.versOf('comp', COMP && COMP.id) || []).some(function (r) {
        return r.kind === 'stable' && r.v === parseInt(v, 10);
      });
    }
    /* ops 不再传给 Float：保存/发布已移到顶栏（见 component.html #topbar .tb-ops） */
  }) : null;

  /* 浮层在场时画布让出一条底边（见 component.html body[data-float]） */
  document.body.setAttribute('data-float', 'on');

  /* ★2026-11-03（m05120）：与应用配置页同一枚**对话框旁**的开关。
     收起后顶栏和整条对话框一起消失，开关留在原位，不再另放「显示操作」按钮。 */
  (function () {
    var sw = document.createElement('button');
    sw.type = 'button'; sw.id = 'ops-switch'; sw.className = 'ops-switch';
    sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', 'false');
    sw.innerHTML = '<span class="ops-switch-label">隐藏操作</span>' +
      '<span class="ops-switch-track" aria-hidden="true"><span class="ops-switch-knob"></span></span>';
    document.body.appendChild(sw);
    var label = sw.querySelector('.ops-switch-label');
    function setOps(off) {
      if (off) document.body.setAttribute('data-ops', 'off');
      else document.body.removeAttribute('data-ops');
      sw.setAttribute('aria-checked', off ? 'true' : 'false');
      label.textContent = off ? '显示操作' : '隐藏操作';
    }
    sw.addEventListener('click', function () {
      setOps(document.body.getAttribute('data-ops') !== 'off');
    });
  })();

  /* 顶栏两个动作（2026-11-04 用户 m01223：「右上角是保存草稿、保存并发布版本」）。
     与应用配置页同一套口径：
       保存草稿        → 内容落库、不铸新版本、不动启用状态；
       保存并发布版本  → 铸新版本 + 启用（onPublish）。
     历史版本入口不在顶栏（应用页也不放），从组件库的 ⋮ 进，这里连节点都收起来了。 */
  (function () {
    var bPub = document.getElementById('act-publish');
    var bDraft = document.getElementById('act-draft');
    if (bPub) { bPub.textContent = TEMPLATE_MODE?'发布':'保存并发布版本'; bPub.addEventListener('click', onPublish); }
    if (bDraft) bDraft.addEventListener('click', onDraft);
    /* 历史版本按钮已随 m01223 下线：顶栏只留「保存草稿 / 保存并发布版本」两颗，
       入口回到组件库卡片的 ⋮（与应用配置页同一个口径）。 */
  })();

  /* 保存草稿：写内容，不发版。新建态第一次点它才真的落库（那时还没有 id）。 */
  function onDraft() {
    if(TEMPLATE_MODE){TemplateBridge.saveDraft();return;}
    if (!cur) { toast('先说要做什么，还没有可以保存的内容'); return; }
    var st = EXISTS ? (COMP.status || '未发布') : '未发布';
    upsert(st);
    setCompName();
    toast(EXISTS ? '已存草稿：内容保住了，还没生成新版本' : '已存草稿：还没发布，别人装不到它');
  }

  /* 保存 / 发布：写回 DB，并把"影响到谁"说清楚。
     两种入口都走这里，但语义不同：
       新建（无 ?id）  → 库里没有这条 id，unshift 一条新的
       改老组件（?id） → 库里有这条 id，就地更新；name/desc 不动
                        （名字是它在库里的身份，不能被画布骨架名覆盖） */
  function upsert(status, expectedVersion) {
    var c = (DB && DB.compById) ? DB.compById(COMP.id) : null;
    /* ★2026-10-28 E44：保存只写内容，不改"上不上架"。
       已经禁用（enabled=false / 已下架）的组件，保存后必须仍是禁用 ——
       原来这里不仅强制 enabled=true，还把 status 写回「已上架」，两处一起把
       用户做的禁用悄悄撤销。新建（库里没有这条 id）仍按传入状态首次上线。 */
    var wasOff = !!(c && (c.enabled === false || c.status === '已下架'));
    var eff = wasOff ? c.status : status;
    COMP.status = eff;
    if (c) {
      c.status = eff;
      c.ver = COMP.ver;
      if (COMP.fields && COMP.fields.length) c.fields = COMP.fields.slice();
      /* ★ spec 必须一起落库。少了这一行，生成结果是"这一次会话里好看" ——
         刷新就没了（实测：生成后 2 块 8 行，重载后 0 块 0 行）。
         fields 只能推出一个近似骨架，推不出模型当时给的那一页。 */
      if (COMP.spec) c.spec = COMP.spec;
      /* block 只在记录自己没声明数据源时写：库里老组件（task-list 的 src:'tasks'、
         rule-panel 的 src:'rules' + limit:3）声明的是**真数据源**，
         生成出来的内联行数据没有资格把它盖掉。spec 在时渲染本来也走 spec。 */
      if (COMP.block && (!c.block || !c.block.src)) c.block = COMP.block;
      if (!IS_EDIT) { c.name = COMP.name; c.desc = COMP.desc; }
    } else if (DB && DB.COMPS) {
      DB.COMPS.unshift({
        id: COMP.id, name: COMP.name, status: status,
        ver: COMP.ver, refs: 0, desc: COMP.desc, fields: (COMP.fields || []).slice(),
        spec: COMP.spec || null, block: COMP.block || null, enabled: true
      });
      /* 这一条现在是库里真实存在的一条了：面包屑/后续判断都该按"已落库"说 */
      EXISTS = true;
    }
    if (DB && DB.save) DB.save(expectedVersion);
    /* 指针＝"这一页正在造的是哪一条"。读它的是下次打开新建页（见文件上半段）：
       刷新/再进来认回同一条，而不是铸一条新的、把刚才的结果留在库里当孤儿。
       Flash 是给组件库的一次性置顶信号：每次落库/发布都重新写，
       组件库读完即消费 —— 同一条不会在之后每次进库时反复置顶。 */
    try {
      if(!TEMPLATE_MODE)localStorage.setItem(LS_NEW_COMP, COMP.id);
      if(!TEMPLATE_MODE)localStorage.setItem(LS_NEW_COMP_FLASH, COMP.id);
    } catch (e) {}
  }

  var pubTimer;
  function showPub(text) {
    var p = $('#pub');
    $('#pub-tt').textContent = text;
    p.hidden = false;
    clearTimeout(pubTimer);
    pubTimer = setTimeout(function () { p.hidden = true; }, 5000);   /* 5 秒自动消失，不阻断 */
  }

  $('#btn-retry').addEventListener('click', function () {
    clearError();
    if (lastText) generate(lastText);
  });

  /* 分页：页码是生成的页面里的控件，必须真的能点。
     委托在画布上（画布内容整块重画，挂在按钮上会被换掉）。
     数据全在 DOM 里，翻页只是切 hidden —— 不请求、不重排、不编数据。 */
  var canvasEl = $('#canvas');
  if (canvasEl) {
    canvasEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.bd-pager .pg[data-pgto]') : null;
      if (!btn) return;
      var to = btn.getAttribute('data-pgto');
      var group = btn.closest('.bd-group');
      if (!group) return;
      var rows = group.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        var pg = rows[i].getAttribute('data-pg') || '1';
        rows[i].hidden = pg !== to;
      }
      var all = group.querySelectorAll('.bd-pager .pg');
      for (var k = 0; k < all.length; k++) {
        if (all[k] === btn) all[k].setAttribute('aria-current', 'true');
        else all[k].removeAttribute('aria-current');
      }
    });
  }

  /* ── 勾选 / 批量指派 / 筛选：事件全部委托在 #canvas 上 ─────────────
     画布每次都换 innerHTML，挂在按钮上的监听会被一起换掉；#canvas 自己一直在。
     这一组行为与 app.js 的 task-table 一一对应（同一个组件在两处是同一件事）。 */
  function focusAll() {
    var a = $('#ck-all');
    if (!a) return;
    try { a.focus({ preventScroll: true }); } catch (e) { a.focus(); }
  }

  function repaint() {
    /* 只服务"老组件按字段推骨架"这条分支（cur 是 LAYOUT 而不是生成出来的 spec）：
       勾选、筛选、改人三件事都会同时动到表格、计数、批量带 ——
       各改各的 DOM 迟早漏一处，整块重画跟应用画布的行为也一致。 */
    if (!cur || !cur.steps) return;
    canvasInner.innerHTML = '';
    canvasInner.appendChild(renderAll(cur, targetApp(), false));
  }

  function syncBatch() {
    var n = pickCount();
    var bar = $('#tb-batch');
    if (!bar) return;
    var cnt = $('#tb-batch-n');
    if (cnt) cnt.textContent = '已选 ' + n + ' 条';
    var go = $('#tb-assign'), cancel = $('#tb-cancel');
    if (go) go.disabled = !n;
    if (cancel) cancel.disabled = !n;
    /* 只剩下 0 条时选人区跟着收 —— 重画，把展开的那一段一并摘掉 */
    if (!n && PICKING) { PICKING = false; repaint(); return; }
    var boxes = canvasInner.querySelectorAll('input[data-ck]');
    var all = $('#ck-all');
    if (all && boxes.length) {
      all.checked = n === boxes.length;
      /* 半选：表头框既不是"全选"也不是"没选"，用浏览器原生三态说清 */
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }

  function pickRow(box) {
    var code = box.getAttribute('data-ck');
    if (box.checked) PICK[code] = true; else delete PICK[code];
    syncBatch();
  }

  function pickAll(box) {
    var boxes = canvasInner.querySelectorAll('input[data-ck]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = box.checked;
      if (box.checked) PICK[boxes[i].getAttribute('data-ck')] = true;
      else delete PICK[boxes[i].getAttribute('data-ck')];
    }
    syncBatch();
  }

  function openPicker() {
    if (!pickCount() || PICKING) return;
    PICKING = true;
    repaint();
    var first = $('#tb-pick input[type="radio"]');
    if (first) first.focus();
  }

  function clearPick() {
    PICK = {};
    PICKING = false;
    repaint();
    focusAll();
  }

  function applyAssign() {
    var pick = $('#tb-pick input[name="tb-assignee"]:checked');
    if (!pick) return;
    var who = pick.value, n = 0, oc = ownerCol();
    TASKS.forEach(function (r) { if (PICK[r[0]]) { r[oc] = who; n++; } });
    PICK = {};
    PICKING = false;
    repaint();                      /* 重画后：处理人换人、勾选清零、批量带回 0 条 */
    focusAll();
    toast('已指派 ' + n + ' 条');
  }

  if (canvasEl) {
    canvasEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest('#canvas')) return;
      /* 预览里的页头按钮不是真动作：给一句明确反馈，别让它点了像坏了 */
      var pa = t.closest('.page-act');
      if (pa) { toast('预览示意，不会真的新建'); return; }
      if (t.id === 'ck-all') return pickAll(t);
      if (t.getAttribute('data-ck')) return pickRow(t);
      if (t.id === 'tb-assign') return openPicker();
      if (t.id === 'tb-cancel') return clearPick();
      if (t.id === 'tb-ok') return applyAssign();
    });
    /* ★2026-11-02（独立前端审计）：预览搜索原来是 span，改成真输入后必须挂 input ——
       change 只在失焦时触发，边打字边筛才是搜索框的行为。 */
    canvasEl.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.id !== 'bd-search') return;
      KWS = t.value;
      var pos = t.selectionStart;
      repaint();
      var si = $('#bd-search');
      if (si) { try { si.focus({ preventScroll: true }); si.setSelectionRange(pos, pos); } catch (x) {} }
    });
    canvasEl.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'bd-filter') {
        /* 切筛选时把已选清掉：否则会留下"选中了但屏幕上看不见"的行 ——
           批量带上写着已选 N 条，画面里却一条都没勾，这是另一种说谎。 */
        FILTER = t.value;
        PICK = {};
        PICKING = false;
        repaint();
        var f = $('#bd-filter');
        if (f) { try { f.focus({ preventScroll: true }); } catch (x) {} }
        return;
      }
      /* 选中一个人之后「确定」才可用：先挑人、再确认，两步都不猜 */
      if (t.name === 'tb-assignee') {
        var ok = $('#tb-ok');
        if (ok) ok.disabled = false;
      }
    });
  }

  /* ══ 7. 起手 ═══════════════════════════════════════════════ */
  failNext = /[?&]fail=1(&|$)/.test(location.search);
  paintInitial();
  if(TEMPLATE_MODE)TemplateBridge.attach({
    snapshot:function(){return {fields:(COMP.fields||[]).slice(),spec:COMP.spec||null,block:COMP.block||null,layout:COMP.layout||TemplateBridge.db.compById(COMP.id).layout||'full'};},
    restore:function(s){['fields','spec','block','layout'].forEach(function(k){COMP[k]=s[k];});HAS_CONTENT=!!((COMP.fields||[]).length||COMP.spec);START_LAYOUT=HAS_CONTENT?LAYOUTS[layoutByName(COMP.name,COMP.fields)]:LAYOUTS.workbench;cur=COMP.spec||null;paintInitial();}
  });
})();
