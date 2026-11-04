/* ─────────────────────────────────────────────────────────────
   data.js —— 全站唯一的数据源（window.DB）。

   为什么要有它：components.html 和 app.html 各自存了一份 COMPS 常量，
   于是同一批组件出现了「组件库 6 个已上架 / 应用页已装 3 个」这种互斥数字，
   引用数也是手写的。合成一份之后，只可能有一种数字。

   两层语义保持独立，别混：
     COMPS[i].status  —— 零件层：这个组件「已上架 / 已下架」（能不能被装）
     APP_COMPS[appId] —— 装配层：这个应用「装没装」某个组件
   两者不互相推导：已上架的组件可以没被任何应用装，已装进应用的组件也可能后来被下架。

   数据来源（不是新编）：COMPS 合并自 components.html 的 COMPS 常量
   （名称/类型/描述/上下架）与 app.js 的 COMPS 常量（id/版本/引用）；两边冲突处以
   components.html 为准，id 取 app.js 的。APPS 里除「华信证券 · 债承审核」外的 5 个
   客户名取自设计稿里已有的客户（中金/国泰君安/招商/海通/广发），用于让列表页有内容。

   用法：
     DB.load()                    页面初始化读一次（后面所有读都走内存）
     DB.appById(id)               应用对象或 null
     DB.compById(id)              组件对象或 null
     DB.installedCount(appId)     装了几个
     DB.install / DB.uninstall    写；内部会 save()
     DB.save()                    仅在你直接改了数组后需要手动调
     DB.cloneApp / DB.cloneComp   复制：派生一份未发布副本，不碰原件
     DB.exportApp / DB.exportComp 导出：返回整包对象（应用包连它用到的组件定义一起带）
     DB.importPayload(obj)        导入：永不覆盖，返回 { ok, msg, name }
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ★2026-10-28 E39（「应用消失」的真因）：多个会话共用 localhost:8941 这一份
     localStorage，谁后写谁覆盖 —— A 席位建的应用会被 B 席位整库写没。
     隔离办法：键名带命名空间，`?ns=<席位号>` 进来一次即记进 sessionStorage（本 tab 生效，
     不影响别的 tab）。不带 ns 时行为与以前完全一致。 */
  var NS = (function () {
    try {
      var m = /[?&]ns=([a-z0-9_-]{1,16})/i.exec(location.search);
      if (m) { sessionStorage.setItem('ifas90:ns', m[1].toLowerCase()); return ':' + m[1].toLowerCase(); }
      var s = sessionStorage.getItem('ifas90:ns');
      return s ? ':' + s : '';
    } catch (e) { return ''; }
  })();
  var KEY = 'ifas90:db' + NS;           /* 带项目前缀，不污染同域其它项目 */

  /* 种子版本。这不是生产逻辑，是原型的种子迁移策略：
     种子内容一改（比如给某个应用补默认装配），已经存过 localStorage 的浏览器
     会一直停在旧种子上 —— 用户看到的是"改了半天没变化"。
     版本号一变就整体重置成新种子；本文件里任何种子改动都必须同时 +1。 */
  /* ★2026-11-01 bump 14 → 15：应用从 6 条补到 10 条（1536 起 5 列，6 条会留一张孤卡），
     且 updated 全换成完整时间戳。不 bump，浏览器里的旧存档会原样读回来 ——
     改完看着"没变化"，最容易让人以为改的是别处。 */
  /* ★2026-11-02 bump 15 → 16：授权模型从「应用挂一个客户 + 一个授权版本」改成
     「应用 × 客户授权表」。不 bump，浏览器里那份旧存档会按旧模型读回来，
     新页面看到的是 0 条授权 —— 看起来像没做。 */
  /* ★2026-11-04 bump 17 → 18：①六个组件介绍改成客观属性描述（原来全是「装上后，…等你填内容」
     这种内部话术）；②演示的装配清单全部留空（从零演示）。bump 之外还要把台账/改动流水的键
     也带上种子版本 —— 原来只重置 db，台账 'ifas90:vers:*' 留在 localStorage 里，
     于是画布空了、版本页还写着「装配 3 块」，同一屏两个事实互相打脸。 */
  var SEED_VER = '25';
  var SEED_KEY = 'ifas90:seed' + NS;

  /* ── 种子：APP 与 COMPS 的现有内容 ── */
  function seed() {
    return {
      apps: [
        /* version：当前线上版本号。草稿＝0（一版都没发过），已上架＝发过几版。
           2026-10-24 加：原来版本号只存在 localStorage 的 `ifas90:app:ver:<id>` 里，
           列表页根本读不到 ⇒ 卡上没法显示"当前版本"，点开「版本管理」也无从列起。
           ★2026-11-01（用户）：「今天一天可能更新好几个版本，我怎么知道是今天什么时候更新的」
           ⇒ updated 从「2026-10-20」这种纯日期改成完整时间戳「2026-10-20 14:32:08」。
           同一天改多次靠时分秒区分，不靠日期。
           演示数据补到 10 条：1536 起是 5 列（线上 2xl:grid-cols-5），
           6 条会排成 5+1 留一张孤卡 —— 该补的是数据，不是把栅格删掉。 */
        { id: 'hx-zc',   name: '华信证券 · 债承审核',   client: '华信证券', status: '已上架', updated: '2026-10-20 14:32:08', version: 3,
          tenantId: '32df4a2e0f4fa467', authAt: '2026-10-20 14:32:08', expireAt: '2027-10-20',
          /* ★2026-10-28 演示场景（《设计-组件更新提示-20261028》）：这一家留 2 个"装的时候是旧版"的件
             —— task-list 装的是 v2（库里 v3）、task-detail 装的是 v1（库里 v2），
             其余应用不写 compVer（载入时补成当前版本）⇒ 列表页同屏能看到"有更新"与"没更新"两种卡。
             只在首次载入（无存档）时生效：SEED_VER 没有跟着 +1，已有 localStorage 一律不动。 */
          compVer: { 'task-list': 'v2', 'task-detail': 'v1' },
          desc: '债承任务逐条列出，详情标明原件、抽取与规则结论状态。' },
        { id: 'zj-cg',   name: '中金 · 采购合同预检',   client: '中金公司', status: '已上架', updated: '2026-10-18 09:47:21', version: 2,
          tenantId: '7b1c9d3e5a2f8801', authAt: '2026-10-18 09:47:21', expireAt: '2027-10-18',
          desc: '规则逐条给出结论与依据引用，原文列在同页。' },
        { id: 'gtja-zc', name: '国泰君安 · 债券承做',   client: '国泰君安', status: '未发布', updated: '2026-10-15 16:05:43', version: 0,
          desc: '承做任务按状态分组复核，规则逐条给出结论与依据。' },
        { id: 'zs-dj',   name: '招商证券 · 中登查重',   client: '招商证券', status: '已上架', updated: '2026-10-11 11:23:56', version: 4,
          tenantId: 'c4e5f60718293a4b', authAt: '2026-10-11 11:23:56', expireAt: '2027-04-11',
          desc: '查重复核队列按状态分组：待我审、已提交、已完结。' },
        { id: 'ht-zc',   name: '海通证券 · 债承复核',   client: '海通证券', status: '已上架', updated: '2026-10-08 18:41:02', version: 5,
          /* 2026-11-04：这一家 task-list 装的是 v2（库里 v3）—— 与 hx-zc 一起构成
             「同一组件被 2 个应用装着、其中 2 个落后」的演示样本。 */
          compVer: { 'task-list': 'v2' },
          tenantId: '9a8b7c6d5e4f3021', authAt: '2026-10-08 18:41:02', expireAt: '2027-10-08',
          desc: '复核任务按状态分组，逐条显示处理人与当前状态。' },
        /* ★2026-11-02：种子不能十张全证券审核。产品口径（场景清单 §0.1 逐字）是
           「通用 AI 应用搭建平台……可以是审核、合同、CRM，甚至 AI 游戏，没有预设的行业分类」。
           只换两条**空装配**的未发布项，不动已上架的六个真实客户案例，也不动条数（10 条＝5 列×2 行）。 */
        { id: 'gf-xm',   name: '星野科技 · 客户线索跟进',   client: '星野科技', status: '未发布', updated: '2026-10-05 10:12:35', version: 0,
          desc: '尚未装配组件，向小智描述业务场景即可装配出应用。' },
        { id: 'zxjt-yy', name: '中信建投 · 用印申请审核', client: '中信建投', status: '已上架', updated: '2026-11-01 09:18:44', version: 2,
          tenantId: '5e2c8f1a9d7b6403', authAt: '2026-11-01 09:18:44', expireAt: '2027-11-01',
          desc: '用印申请逐条比对授权表与合同金额，超标转人工。' },
        { id: 'swhy-jd', name: '申万宏源 · 尽调报告核验', client: '申万宏源', status: '已上架', updated: '2026-10-31 15:07:12', version: 1,
          tenantId: 'a1b2c3d4e5f60718', authAt: '2026-10-31 15:07:12', expireAt: '2027-10-31',
          desc: '尽调底稿按清单核验，缺件与超期在正文旁标出。' },
        { id: 'dfzq-zg', name: '东方证券 · 资管合同审查', client: '东方证券', status: '内测中', updated: '2026-10-29 20:53:30', version: 3,
          desc: '资管合同要素与备案信息交叉核对，差异逐条列出。' },
        { id: 'ifas-mon', name: 'DataGrand IFAS · 监控大屏', client: 'DataGrand', status: '已上架', updated: '2026-11-03 14:20:00', version: 1,
          desc: '完整的管理后台：左侧导航、顶栏、指标卡、漏斗、趋势图与 Top10，一屏即一个系统。' },
        { id: 'gx-pj',   name: '蓝湾互娱 · 关卡内容生成', client: '蓝湾互娱', status: '未发布', updated: '2026-10-26 13:29:05', version: 0,
          desc: '关卡文案与数值逐项校对，对不上的地方标红。' }
      ],
      /* ★2026-11-02 授权表种子：一个应用给多家客户、每家的版本可以不同。
         这里只写 clientName，load 时按名字落成 clientId（种子不该知道生成的 id）。
         故意留几条落后的：hx-zc 最新 v4，华信证券 v3、中信建投 v2；ht-zc 最新 v5，国泰君安 v4。
         这样「升级到 vN」在演示里真有东西可点，而不是一列永远空白。 */
      auths: [
        { appId: 'hx-zc',   clientName: '华信证券', version: 3, authAt: '2026-10-20 14:32:08', expireAt: '2027-10-20' },
        { appId: 'hx-zc',   clientName: '中信建投', version: 2, authAt: '2026-10-25 10:06:11', expireAt: '2027-10-25' },
        { appId: 'hx-zc',   clientName: '申万宏源', version: 3, authAt: '2026-10-30 16:22:40', expireAt: '2027-10-30' },
        { appId: 'zj-cg',   clientName: '中金公司', version: 2, authAt: '2026-10-18 09:47:21', expireAt: '2027-10-18' },
        { appId: 'zs-dj',   clientName: '招商证券', version: 4, authAt: '2026-10-11 11:23:56', expireAt: '2027-04-11' },
        { appId: 'ht-zc',   clientName: '海通证券', version: 5, authAt: '2026-10-08 18:41:02', expireAt: '2027-10-08' },
        { appId: 'ht-zc',   clientName: '国泰君安', version: 4, authAt: '2026-10-12 14:05:33', expireAt: '2027-10-12' },
        { appId: 'zxjt-yy', clientName: '中信建投', version: 2, authAt: '2026-11-01 09:18:44', expireAt: '2027-11-01' },
        { appId: 'swhy-jd', clientName: '申万宏源', version: 1, authAt: '2026-10-31 15:07:12', expireAt: '2027-10-31' }
      ],
      comps: [
        /* strip: true —— 这个组件头上带一条状态汇总（审核中 · N 条）。
           2026-10-23 加：原来这条汇总是画布级硬编码，于是任何应用都会顶上一条
           「审核中 · 5 条」，哪怕它装的是合同用印申请、跟审核一点关系没有。
           状态汇总属于「任务池」这种组件自己的附属物，不属于画布。 */
        { id: 'monitor-screen', tags: ['page_frame'], name: '管理后台整页', label: '监控大屏', layout: 'full', status: '已上架', ver: 'v1', refs: 0, config: {}, block: null,
          updated: '2026-11-03 14:20:00',
          desc: '整页后台的容器，内容由对话生成。',
          fields: [] },
        { id: 'task-list', tags: ['task_flow'],    name: '审核任务列表', label: '待办任务',       layout: 'full', status: '已上架', ver: 'v3', refs: 0, config: {}, strip: true, block: { kind: 'table', src: 'tasks' },
          updated: '2026-10-29 17:03:41',
          desc: '审核任务的总览表：一行一个任务，列出任务编号、业务类型、金额、状态与处理人；按状态分组，可多选批量指派处理人。',
          fields: ['任务编号', '业务类型', '金额', '状态', '处理人'],
          /* ★2026-10-28：组件按装配版本渲染。v2 只有三列，v3 才加「业务类型」「处理人」。
             没有这份表，更新组件版本就只是改一笔账，画布一个像素都不会动（需求官判的 P0）。 */
          fieldsByVer: { 'v2': ['任务编号', '金额', '状态'] } },
        { id: 'task-detail', tags: ['task_flow'],  name: '任务详情', label: '任务详情',          layout: 'right', status: '已上架', ver: 'v2', refs: 0, config: {}, block: { kind: 'detail' },
          updated: '2026-10-27 11:48:09',
          desc: '审批流程与原文并排的详情视图：左边走审批环节，右边对照原文，规则结论给出可追溯的依据。',
          fields: ['原件', '抽取结果', '规则结论'],
          fieldsByVer: { 'v1': ['原件', '抽取结果'] } },
        { id: 'rule-panel', tags: ['rule_judge', 'result_view'],   name: '规则结论', label: '规则结论',          layout: 'right', status: '已上架', ver: 'v1', refs: 0, config: {}, block: { kind: 'table', src: 'rules', limit: 3 },
          updated: '2026-10-24 15:26:33',
          desc: '逐条规则给结论：一条规则一行，结论与依据引用并列，引用精确到原文页码。',
          fields: ['规则名', '结论', '依据引用'] },
        { id: 'doc-extract', tags: ['mtrl_extract'],  name: '文档抽取', label: '文档抽取',          layout: 'right', status: '已上架', ver: 'v2', refs: 0, config: {}, block: { kind: 'chips' },
          updated: '2026-10-30 10:02:17',
          desc: '文档抽取结果表：字段名、抽取值、置信度三列；抽取范围与必填项在组件配置里设定。',
          fields: ['字段名', '抽取值', '置信度'] },
        { id: 'verify-queue', tags: ['task_flow', 'result_view'], name: '复核队列', label: '复核队列',          layout: 'left', status: '已上架', ver: 'v1', refs: 0, config: {}, block: { kind: 'bars' },
          updated: '2026-10-21 14:39:55',
          desc: '复核任务清单：一行一条复核任务，记录复核人与复核意见，可集中查阅。',
          fields: ['任务', '复核人', '复核意见'] },
        { id: 'ruleset-cfg', tags: ['rule_judge'],  name: '规则配置', label: '规则配置',          layout: 'full', status: '已下架', ver: 'v5', refs: 0, config: {},
          updated: '2026-10-19 16:57:04',
          desc: '规则组配置：规则按排序编号列出，逐条标注启用状态与适用口径。',
          fields: ['规则组', '排序', '启用状态'] },
        { id: 'ruleset-med', tags: ['rule_judge'],  name: '规则配置（医药口径）', label: '规则修订', layout: 'full', status: '已下架', ver: 'v2', refs: 0, config: {},
          updated: '2026-10-16 08:44:28',
          desc: '规则组均为医药口径，逐条标注口径与启用状态。',
          fields: ['规则组', '口径', '启用状态'] }
      ],
      appComps: {
        /* ★2026-11-04（用户：「怎么没有几个应用待升级的标签呢？？都给我查」）：
           上一版把这里的装配清单全清空了，于是 8 个组件的引用数全算成 0 ——
           组件库卡上既没有「N 个应用在用」，也不可能出现「N 个应用待升级」角标。
           演示要讲的是「组件被多个应用共用、改组件要顾影响面」，清单必须是真数据，不是卡面写死的字。
           现在：除最后一条 `gx-pj`（未发布，专门留给「从零说一句话生成」的演示）之外，
           其余应用都真装着组件；配合上面 hx-zc / ht-zc 的 compVer 落后值，
           「审核任务列表」「任务详情」上会各出现「N 个应用待升级」。
           顺序有意义：页面类块在前、规则结论收在最后（app-header 是应用头，钉在第一位）。 */
        'hx-zc':   ['app-header', 'task-list', 'task-detail', 'rule-panel'],
        'zj-cg':   ['app-header', 'doc-extract', 'rule-panel'],
        'gtja-zc': ['app-header', 'task-list', 'verify-queue', 'rule-panel'],
        'zs-dj':   ['app-header', 'verify-queue'],
        'ht-zc':   ['app-header', 'task-list', 'verify-queue'],
        /* gf-xm 是卡面就写着「尚未装配组件，向小智描述业务场景即可装配出应用」的那一条，
           刻意留空 —— 演示「从零说一句话生成」就从它进。 */
        'gf-xm':   [],
        'zxjt-yy': ['app-header', 'task-list', 'rule-panel'],
        'swhy-jd': ['app-header', 'task-detail', 'verify-queue'],
        'dfzq-zg': ['app-header', 'rule-panel'],
        'ifas-mon': ['app-header', 'monitor-screen'],
        'gx-pj':   ['app-header', 'doc-extract']
      }
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* refs 不手写：有几个应用装着它，就是几个。写完自动重算，永远不会和 APP_COMPS 打架 */
  function recomputeRefs() {
    DB.COMPS.forEach(function (c) {
      c.refs = DB.APPS.filter(function (a) { return a.comps.indexOf(c.id) >= 0; }).length;
    });
  }

  /* ── 对外对象：先占位，load() 再填 ── */
  var DB = {
    APPS: [],
    /* 客户台账：与 APPS 同生共死，只在这里落盘一次（persistRaw） */
    CLIENTS: [],
    /* 授权记录：应用 × 客户。谁在用哪一版，只认这张表（APP 上不再存） */
    AUTHS: [],
    COMPS: [],
    APP_COMPS: {},
    KEY: KEY
  };


  /* ── 字段单一真源（2026-10-28 根治）──────────────────────────────
     组件的属性原来散在五处：种子 / load 白名单 / save 白名单 / contentOf / 渲染分支。
     每加一个字段要在六处同步，漏一处就是一个"写了但读不回来"的 bug ——
     一天之内踩了四次（fieldsByVer、updUndo 的 load 与 save、block）。
     现在只在下面声明一次：load 与 save 都从它派生，谁也不用记得去补另一处。 */
  /* ── 数据字典（本地快照）──────────────────────────────────────────
     真产品读「系统设置 › 字典配置」：每个字典有**字典编码**（如 file_type / bond_type_category），
     字典数据是一组条目。组件库标签用的是 comp_tag 这一条。
     demo 没有字典模块，所以这里放一份**同构**的快照（code + 标签），
     将来把这一行换成接口返回即可 —— 组件存的是 code，页面只认 label，两边都不用改。
     ⚠ 加值只改这里；不要在组件种子里写中文标签。 */
  DB.DICT = {
    comp_tag: [
      { code: 'page_frame',   label: '页面骨架' },
      { code: 'mtrl_extract', label: '材料抽取' },
      { code: 'task_flow',    label: '任务流转' },
      { code: 'rule_judge',   label: '规则判定' },
      { code: 'result_view',  label: '结果呈现' }
    ]
  };
  /* code → 标签。查不到就原样返回（字典删了条目，老组件不至于显示空白） */
  DB.tagLabel = function (code) {
    var it = (DB.DICT.comp_tag || []).filter(function (x) { return x.code === code; })[0];
    return it ? it.label : String(code || '');
  };

  var COMP_FIELDS = {
    id: { d: '' }, name: { d: '' }, label: { d: null }, status: { d: '已上架' },
    ver: { d: 'v1' }, refs: { d: 0 }, desc: { d: '' },
    /* ★2026-11-01：组件卡要显示「最近更新」，与应用卡同一口径（精确到秒）。
       不写进白名单 pickSchema 就不存，刷新即丢 —— 这个坑今天已经踩过两次。 */
    updated: { d: null },
    fields: { d: [] }, fieldsByVer: { d: null }, spec: { d: null },
    /* 2026-10-30：标签（多值、可选）。存的是**字典项的 code**，不是中文 ——
       真产品里这些值来自「系统设置 › 字典配置」的 comp_tag，改字典不用改代码。 */
    tags: { d: [] },
    enabled: { d: true }, config: { d: {} }, configBy: { d: null }, strip: { d: false },
    /* ★2026-11-04 真 bug（content-contract 抓到的）：编辑弹窗与「新增组件」表单都在写
       c.visScope / c.cfgScope（components.html:246/264/785/786），但 COMP_FIELDS 没这两个键，
       pickSchema 一存就丢 —— 正是上面 249 行注释说的那个坑。补进模型，两个作用域才真的存得住。 */
    visScope: { d: null }, cfgScope: { d: null },
    layout: { d: 'full' }, block: { d: null },
    /* ★2026-11-03（m03263）：可见 / 可配置范围。白名单漏一个键 = 刷新后静默丢，
       这个坑今天已经踩过三次，所以组件与应用两边同时登记。 */
    visScope: { d: null }, cfgScope: { d: null }
  };
  var APP_FIELDS = {
    id: { d: '' }, name: { d: '' }, client: { d: '' }, desc: { d: '' }, status: { d: '' },
    updated: { d: null }, version: { d: 0 },
    /* ★2026-11-01 授权四件：不写进白名单就等于没存 —— pickSchema 只存这里声明的键，
       新页面写进去的字段刷新后会被静默丢掉（这个坑今天就是它让授权列表变空的）。 */
    tenantId: { d: '' }, authAt: { d: null }, expireAt: { d: null }, prevVer: { d: 0 },
    /* ★2026-11-01 封面：卡片封面的 dataURL。不写进白名单 = 刷新就丢（这个坑今天踩过两次） */
    cover: { d: '' },
    /* ★2026-11-02 生成封面的样式序号。同一个坑第三次：cover 进了白名单、coverStyle 漏了，
       于是"换个样式"选完能看见，刷新回到按位置算的那一种。 */
    coverStyle: { d: null },
    /* ★2026-11-03（m03263）：可见 / 可配置范围；{mode:'self'|'public'|'custom', roles:[], depts:[], users:[]} */
    visScope: { d: null }, cfgScope: { d: null },
    content: { d: {} }, compVer: { d: {} }, updUndo: { d: {} }, comps: { d: [] }
    /* ★2026-11-02（第二次改，m01548 的重做指令）：一个应用可以授权给多个客户，
       应用不再挂 clientId。谁在用哪一版，只存在 AUTH_FIELDS 那张授权表里。
       老存档里应用的 client/tenantId/authAt/version 只作迁移输入，迁移完不再写。 */
  };
  /* 客户（租户）：客户授权页的配置对象。name 用于显示，tenantId 是与甲方系统对号的那个串。 */
  var CLIENT_FIELDS = {
    id: { d: '' }, name: { d: '' }, tenantId: { d: '' }, note: { d: '' }, createdAt: { d: null }
  };
  /* ── 授权记录（2026-11-02 重构）──────────────────────────────
     真实系统（172.26.26.61:10612 客户配置页）的模型：一个应用授权给 N 个租户，
     每个租户单独记「有效期 / 规则 / 管理方式 / 流程」；这里保留最关键的「哪一版」。
     一条记录 = 一个应用 × 一个客户：
       appId + clientId 唯一；version = 授权时客户拿到的那一版；
       status = 已授权 / 已取消（取消不删记录，留着可恢复、可删）。
     用户口径（2026-11-02）：「新增授权和升级版本时，默认都指向当前应用的最新版本」。 */
  var AUTH_FIELDS = {
    id: { d: '' }, appId: { d: '' }, clientId: { d: '' },
    version: { d: 0 }, status: { d: '已授权' },
    authAt: { d: null }, expireAt: { d: null }, upgradedAt: { d: null }, canceledAt: { d: null }
  };
  function pickSchema(raw, S) {
    var out = {};
    Object.keys(S).forEach(function (k) {
      var def = S[k].d, v = raw ? raw[k] : undefined;
      if (v === undefined || v === null) {
        out[k] = (def && typeof def === 'object') ? JSON.parse(JSON.stringify(def)) : def;
      } else {
        out[k] = v;
      }
    });
    return out;
  }
  DB.SCHEMA = { comp: COMP_FIELDS, app: APP_FIELDS, client: CLIENT_FIELDS, auth: AUTH_FIELDS };   /* 给判据用：往返测试按它逐键比 */

  /* 写盘只有这一处：种子回填与 DB.save 共用，避免两份 pickSchema 漂移 */
  function persistRaw() {
    localStorage.setItem(KEY, JSON.stringify({
      apps: DB.APPS.map(function (a) { var o = pickSchema(a, APP_FIELDS); o.comps = a.comps.slice(); return o; }),
      comps: DB.COMPS,
      clients: DB.CLIENTS.map(function (c) { return pickSchema(c, CLIENT_FIELDS); }),
      auths: DB.AUTHS.map(function (x) { return pickSchema(x, AUTH_FIELDS); }),
      appComps: DB.APP_COMPS
    }));
  }

  /* ── 客户（租户）────────────────────────────────────────────────
     2026-11-02：客户原来是应用表单里手打的一行字，没有 id、没有租户 ID，重名就变成两家。
     现在它是实体：客户授权页配置，应用只存 clientId。回填规则写在这里，页面不用各算一遍。 */
  function clientIdOf(tenantId, taken) {
    var base = 'cl-' + String(tenantId || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (base === 'cl-') base = 'cl-x';
    var id = base, n = 1;
    while (taken[id]) { id = base + '-' + (n++); }
    return id;
  }
  function sortClients() {
    DB.CLIENTS.sort(function (x, y) { return String(x.name).localeCompare(String(y.name), 'zh-Hans-CN'); });
  }
  /* 台账里没有就建一个。客户名唯一；租户 ID 有就必须唯一（同名同租户不再建第二条）。 */
  function ensureClient(name, tenantId, createdAt) {
    var nm = String(name || '').trim();
    if (!nm || nm === '待填写客户') return null;
    var c = DB.clientByName(nm);
    if (c) {
      if (!c.tenantId && tenantId) c.tenantId = String(tenantId).trim();
      return c;
    }
    var taken = {};
    DB.CLIENTS.forEach(function (x) { taken[x.id] = 1; });
    c = { id: clientIdOf(tenantId, taken), name: nm, tenantId: String(tenantId || '').trim(),
          note: '', createdAt: createdAt || new Date().toISOString().slice(0, 10) };
    DB.CLIENTS.push(c);
    return c;
  }
  DB.clients = function () { return DB.CLIENTS; };
  DB.clientById = function (id) {
    for (var i = 0; i < DB.CLIENTS.length; i++) if (DB.CLIENTS[i].id === id) return DB.CLIENTS[i];
    return null;
  };
  DB.clientByName = function (name) {
    var n = String(name || '').trim();
    for (var i = 0; i < DB.CLIENTS.length; i++) if (String(DB.CLIENTS[i].name).trim() === n) return DB.CLIENTS[i];
    return null;
  };
  /* 客户装了几个应用：只数「已授权」的授权记录（一个应用可被同一客户重复授权吗？不允许，见 authGrant） */
  DB.appsOfClient = function (id) {
    var seen = {};
    return DB.AUTHS.filter(function (x) {
      if (x.clientId !== id || x.status !== '已授权' || seen[x.appId]) return false;
      seen[x.appId] = 1; return true;
    }).map(function (x) { return DB.appById(x.appId); }).filter(Boolean);
  };
  /* 加客户：名字与租户 ID 都必填且唯一 —— 重名会让"这家有几个应用"永远算不对。 */
  DB.addClient = function (name, tenantId) {
    var nm = String(name || '').trim(), tid = String(tenantId || '').trim();
    if (!nm) return { ok: false, msg: '客户名称必填' };
    if (!tid) return { ok: false, msg: '租户 ID 必填' };
    if (DB.clientByName(nm)) return { ok: false, msg: '已经有同名客户：' + nm };
    var dup = DB.CLIENTS.filter(function (c) { return String(c.tenantId).toLowerCase() === tid.toLowerCase(); })[0];
    if (dup) return { ok: false, msg: '租户 ID 已被「' + dup.name + '」占用' };
    var taken = {};
    DB.CLIENTS.forEach(function (c) { taken[c.id] = 1; });
    var c = { id: clientIdOf(tid, taken), name: nm, tenantId: tid, note: '', createdAt: new Date().toISOString().slice(0, 10) };
    DB.CLIENTS.push(c);
    sortClients();
    DB.save();
    return { ok: true, client: c };
  };
  /* 改客户：客户名与租户 ID 是授权表 join 出来的，授权记录只存 clientId，所以改这里不用同步别处。 */
  DB.updateClient = function (id, name, tenantId) {
    var c = DB.clientById(id);
    if (!c) return { ok: false, msg: '这个客户不存在' };
    var nm = String(name || '').trim(), tid = String(tenantId || '').trim();
    if (!nm) return { ok: false, msg: '客户名称必填' };
    if (!tid) return { ok: false, msg: '租户 ID 必填' };
    var same = DB.clientByName(nm);
    if (same && same.id !== id) return { ok: false, msg: '已经有同名客户：' + nm };
    var dup = DB.CLIENTS.filter(function (x) {
      return x.id !== id && String(x.tenantId).toLowerCase() === tid.toLowerCase();
    })[0];
    if (dup) return { ok: false, msg: '租户 ID 已被「' + dup.name + '」占用' };
    c.name = nm; c.tenantId = tid;
    sortClients();
    DB.save();
    return { ok: true, client: c };
  };

  /* ── 授权表（2026-11-02）──────────────────────────────────────
     m01548 定下的模型：一个应用可以授权多个客户，每个客户记当时授权的版本；
     新增授权和升级版本都默认指向当前应用的最新版本。
     ⇒ 版本不让人选：新增和升级都取 latestVer(appId)。要停在一版，就别升级。 */
  DB.latestVer = function (appId) {
    var a = DB.appById(appId);
    var v = 0;
    try {
      (DB.versOf('app', appId) || []).forEach(function (r) {
        if (r.kind === 'stable' && r.v > v) v = r.v;
      });
    } catch (e) {}
    if (!v && a) v = parseInt(a.version, 10) || 0;
    return v;
  };
  DB.authOf = function (appId, clientId) {
    for (var i = 0; i < DB.AUTHS.length; i++) {
      if (DB.AUTHS[i].appId === appId && DB.AUTHS[i].clientId === clientId) return DB.AUTHS[i];
    }
    return null;
  };
  DB.authsOfApp = function (appId) {
    return DB.AUTHS.filter(function (x) { return x.appId === appId; });
  };
  DB.authsOfClient = function (clientId) {
    return DB.AUTHS.filter(function (x) { return x.clientId === clientId; });
  };
  DB.authCount = function (appId) {
    return DB.authsOfApp(appId).filter(function (x) { return x.status === '已授权'; }).length;
  };
  /* 授权行 join 出显示要用的字段；页面不再各拼一份，避免两处口径 */
  DB.authRows = function (appId) {
    var list = appId ? DB.authsOfApp(appId) : DB.AUTHS.slice();
    return list.map(function (x) {
      var a = DB.appById(x.appId) || {}, c = DB.clientById(x.clientId) || {};
      var latest = DB.latestVer(x.appId);
      return {
        id: x.id, appId: x.appId, appName: a.name || '（应用已删）',
        clientId: x.clientId, clientName: c.name || '（客户已删）', tenantId: c.tenantId || '',
        version: x.version, latest: latest, behind: (x.version || 0) < latest,
        status: x.status || '已授权', authAt: x.authAt, expireAt: x.expireAt,
        upgradedAt: x.upgradedAt, canceledAt: x.canceledAt,
        appStatus: a.status || '', updated: a.updated || null
      };
    }).sort(function (p, q) {
      if (p.appId !== q.appId) return String(p.appName).localeCompare(String(q.appName), 'zh-Hans-CN');
      return String(p.clientName).localeCompare(String(q.clientName), 'zh-Hans-CN');
    });
  };
  /* 新增授权：一次可以选多个客户；版本一律取最新。已经授权的跳过（避免一条应用×客户两条记录）。 */
  DB.authGrant = function (appId, clientIds, months, at) {
    var a = DB.appById(appId);
    if (!a) return { ok: false, msg: '应用不存在', added: [] };
    var v = DB.latestVer(appId);
    if (!v) return { ok: false, msg: '这个应用还没有版本，先「存成新版本」再授权', added: [] };
    var ids = Array.isArray(clientIds) ? clientIds : (clientIds ? [clientIds] : []);
    /* ★2026-11-02：有效期允许「长期」。原来只认月份，"0" 是真值 ⇒ addMonths(0) 当天到期；
       真实系统用 9999-12-31 表示长期，这里同一个哨兵值。 */
    var forever = (months === 0 || months === '0');
    var added = [], skipped = [];
    ids.forEach(function (cid) {
      var c = DB.clientById(cid);
      if (!c) { skipped.push(cid); return; }
      var rec = DB.authOf(appId, cid);
      if (rec) {
        if (rec.status === '已授权') { skipped.push(c.name); return; }
        rec.status = '已授权'; rec.version = v; rec.authAt = at || nowStamp();
        rec.expireAt = forever ? '9999-12-31' : (months ? addMonths(months) : rec.expireAt); rec.canceledAt = null;
      } else {
        rec = { id: 'au-' + appId + '-' + cid, appId: appId, clientId: cid, version: v, status: '已授权',
                authAt: at || nowStamp(), expireAt: (forever || !months) ? '9999-12-31' : addMonths(months),
                upgradedAt: null, canceledAt: null };
        DB.AUTHS.push(rec);
      }
      added.push(c.name);
    });
    if (added.length) { a.status = a.status === '已下架' ? '已上架' : a.status; DB.save(); }
    return { ok: added.length > 0, added: added, skipped: skipped, version: v,
             msg: added.length ? '' : (skipped.length ? '选中的客户已经授权过了' : '没有可授权的客户') };
  };
  /* 升级：只改这条授权的版本，其它客户的版本不动。版本一律取最新。 */
  DB.authUpgrade = function (authId) {
    var rec = null;
    for (var i = 0; i < DB.AUTHS.length; i++) if (DB.AUTHS[i].id === authId) rec = DB.AUTHS[i];
    if (!rec || rec.status !== '已授权') return { ok: false, msg: '这条授权不存在或已取消' };
    var v = DB.latestVer(rec.appId);
    if (!v) return { ok: false, msg: '这个应用还没有版本' };
    if (v <= (rec.version || 0)) return { ok: false, msg: '已经是最新版本 v' + v };
    var from = rec.version || 0;
    rec.version = v; rec.upgradedAt = nowStamp();
    if (DB.save() === false) return { ok: false, msg: '没存进去' };
    return { ok: true, from: from, to: v };
  };
  DB.authRevoke = function (authId) {
    var rec = null;
    for (var i = 0; i < DB.AUTHS.length; i++) if (DB.AUTHS[i].id === authId) rec = DB.AUTHS[i];
    if (!rec) return { ok: false, msg: '这条授权不存在' };
    rec.status = '已取消'; rec.canceledAt = nowStamp();
    if (DB.save() === false) return { ok: false, msg: '没存进去' };
    return { ok: true };
  };
  /* 恢复：沿用当时授权的那一版（不是最新）；要最新就再点一次「升级到 vN」。 */
  DB.authRestore = function (authId) {
    var rec = null;
    for (var i = 0; i < DB.AUTHS.length; i++) if (DB.AUTHS[i].id === authId) rec = DB.AUTHS[i];
    if (!rec) return { ok: false, msg: '这条授权不存在' };
    rec.status = '已授权'; rec.canceledAt = null;
    if (DB.save() === false) return { ok: false, msg: '没存进去' };
    return { ok: true };
  };
  DB.authRemove = function (authId) {
    var i = DB.AUTHS.findIndex(function (x) { return x.id === authId; });
    if (i < 0) return { ok: false, msg: '这条授权不存在' };
    DB.AUTHS.splice(i, 1);
    if (DB.save() === false) return { ok: false, msg: '没存进去' };
    return { ok: true };
  };
  function nowStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function addMonths(n) {
    var d = new Date(); d.setMonth(d.getMonth() + (parseInt(n, 10) || 12));
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  /* 读到旧存档时把授权补出来：
     ① 有 s.auths ⇒ 用 auths（允许种子只写 clientName，按名字落成 clientId）；
     ② 没有 ⇒ 从应用上那几列迁移（老模型一个应用只有一个客户）。 */
  function loadAuths(rawApps, savedAuths) {
    var out = [];
    (Array.isArray(savedAuths) ? savedAuths : []).forEach(function (x) {
      var cid = x.clientId || (DB.clientByName(x.clientName) || {}).id || '';
      /* 版本可能被写成 'v3'（显示层写法混进存档）——parseInt('v3') 是 NaN，整条授权会静默消失，
         2026-11-02 真踩过。这里按 v?数字 取值，宁可留一条坏版本记录也不静默丢授权。 */
      var vn = parseInt(String(x.version == null ? '' : x.version).replace(/^v/i, ''), 10);
      if (!x.appId || !cid || !(vn > 0)) return;
      out.push(pickSchema({ id: x.id || ('au-' + x.appId + '-' + cid), appId: x.appId, clientId: cid,
        version: vn, status: x.status || '已授权', authAt: x.authAt || null,
        expireAt: x.expireAt || null, upgradedAt: x.upgradedAt || null, canceledAt: x.canceledAt || null }, AUTH_FIELDS));
    });
    if (!out.length) {
      (rawApps || []).forEach(function (a) {
        var cid = a.clientId || (DB.clientByName(a.client || '') || {}).id || '';
        var v = parseInt(a.version, 10) || 0;
        if (!cid || !v || !a.authAt) return;
        out.push(pickSchema({ id: 'au-' + a.id + '-' + cid, appId: a.id, clientId: cid, version: v,
          status: '已授权', authAt: a.authAt, expireAt: a.expireAt || null }, AUTH_FIELDS));
      });
    }
    return out;
  }

  DB.load = function () {
    var s = null;
    var ver = null;
    var seeded = false;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) s = JSON.parse(raw);
      ver = localStorage.getItem(SEED_KEY);
    } catch (e) { s = null; }

    /* 种子版本不一致 ⇒ 旧存档作废，用新种子重来（理由见 SEED_VER 上方注释） */
    if (s && ver !== SEED_VER) s = null;

    /* 结构不对就退回种子：坏数据不该把整页搞白 */
    if (!s || !Array.isArray(s.apps) || !Array.isArray(s.comps) || !s.apps.length) { s = seed(); seeded = true; }
    try { localStorage.setItem(SEED_KEY, SEED_VER); } catch (e) {}

    var rawApps = s.apps.slice();          /* 迁移要看原始字段（client/clientId/authAt），下面 pickSchema 会过滤掉 */
    var savedMap = (s.appComps && typeof s.appComps === 'object') ? s.appComps : {};

    /* 从 schema 派生：以后加字段只改 COMP_FIELDS 一处 */
    DB.COMPS = s.comps.map(function (c) {
      var o = pickSchema(c, COMP_FIELDS);
      o.label = o.name;          /* 历史兼容：label 是 name 的镜像，不再做第二个名字 */
      o.refs = 0;                /* refs 由 recomputeRefs 现算，不存 */
      if (!Array.isArray(o.fields)) o.fields = [];
      return o;
    });

    DB.APPS = s.apps.map(function (a) {
      var list = Array.isArray(savedMap[a.id]) ? savedMap[a.id]
               : (Array.isArray(a.comps) ? a.comps : []);
      var o = pickSchema(a, APP_FIELDS);
      o.version = parseInt(o.version, 10) || 0;
      o.comps = list.filter(function (id) { return !!DB.compById(id); });
      return o;
    });

    /* compVer 的键必须与 comps 一一对应：多一个（已卸载的残键）会让人以为还装着，
       少一个（老存档 / 撤回装回）会被当成"与最新一致"。这两种都只在读的时候出错，
       所以在这里一次性补齐、裁齐（补的值＝组件当前版本）。 */
    DB.APPS.forEach(syncCompVer);

    /* 客户台账：客户是独立实体；应用上写过的客户名、授权里只写了名字的，都先补进台账。 */
    DB.CLIENTS = (Array.isArray(s.clients) ? s.clients : []).map(function (c) { return pickSchema(c, CLIENT_FIELDS); });
    rawApps.forEach(function (a) { ensureClient(a.client || '', a.tenantId, a.authAt || a.updated); });
    (Array.isArray(s.auths) ? s.auths : []).forEach(function (x) {
      if (x.clientName) ensureClient(x.clientName, x.tenantId, x.authAt);
    });
    sortClients();
    /* 授权表：一个应用 × 一个客户一条；版本是授权时的那一版（应用可再出新版，这条不动）。 */
    DB.AUTHS = loadAuths(rawApps, s.auths);

    /* 让 APP_COMPS[appId] 与 APPS[i].comps 是同一个数组：
       两种形状都对外暴露，但只有一份数据 */
    DB.APP_COMPS = {};
    DB.APPS.forEach(function (a) { DB.APP_COMPS[a.id] = a.comps; });

    recomputeRefs();
    /* 改动流水的基线：这是"现在盘上长什么样"，之后每次 save 都与它比 */
    DB._prev = snapAll();

    /* ★2026-10-30：用了种子就必须当场写回。否则只有第一个打开的页面看到新种子，
       下一个页面 SEED_KEY 已经对上、KEY 还是旧存档 ⇒ 又退回旧数据（现象就是"改了半天没变化"）。 */
    if (seeded) { try { persistRaw(); } catch (e) {} }
    return DB;
  };

  DB.save = function () {
    var next = snapAll();
    var ok = true;
    try {
      persistRaw();
    } catch (e) {
      ok = false;   /* 隐私模式 / 配额满：写不进去就是没保存，界面必须能说出来 */
    }
    if (ok) {
      if (!DB._quiet) diffAndRecord(DB._prev, next);
      DB._prev = next;
    }
    DB.lastSaveOk = ok;
    /* 谁在存、存成没成，界面不该靠轮询猜。存一次通知一次。 */
    if (typeof DB.onSave === 'function') { try { DB.onSave(ok); } catch (e2) {} }
    return ok;
  };

  /* ══ 改动流水（2026-10-27）══════════════════════════════════════════
     单一工作区模型里，"自动保存"是体验，但不能是"不可追"：
     用户改了什么、小智改了什么，必须能看见、能退回。
     这一层不占版本号，也不新造一套状态 —— 它只是"上次保存快照之后，攒了哪些改动"。

     记录点只有一个：DB.save()。谁改的不用各处上报（那样迟早漏一处），
     这里在写盘前后各拍一次快照，比出差异。写盘失败就不记 —— 没落盘的东西不算改动。

     每条：{ uid(稳定唯一键), at(ms), clock('HH:MM'), actor('你'|'小智'), label(人话), before(改前整条记录) }
     撤回＝把 before 整条还原回去，并丢掉比它更新的那些步（它们的前提已经不存在了）。
     保存快照＝这些改动入档，清单清零。

     ★2026-10-28 加 uid（E3c）：原来拿 at（毫秒时间戳）当身份键。同一毫秒连写两条时
     at 相同 ⇒ 点"最旧那条"的退回，`list[i].at === at` 先命中的是列表第一条（最新那条），
     于是静默退掉了最新一步，最旧那步留在原地。**身份不能用可重复的量**。
     uid 在写入时生成；老存档没有 uid，读的时候按"同一个 at 出现的前后次序"补齐并**回写一次**，
     补齐即固化 —— 之后新增记录不会改变已有 uid（不像下标，会随 unshift 漂）。 */
  var CHG_KEY = function (scope, id) { return 'ifas90:chg:' + scope + ':' + id + NS + ':' + SEED_VER; };
  var MAX_CHG = 40;
  var CHG_SEQ = 0;

  /* 同会话内序号 + 毫秒 + 4 位随机：三者合起来保证"同一毫秒里连着写"也不撞。 */
  function chgUid(at) {
    CHG_SEQ = (CHG_SEQ + 1) % 1296;
    return 'c' + Number(at || 0).toString(36) + '-' + ('00' + CHG_SEQ.toString(36)).slice(-2) + '-' +
           Math.random().toString(36).slice(2, 6);
  }

  /* 老记录补 uid：同一个 at 的第 1/2/3 条分别是 L<at> / L<at>-1 / L<at>-2。
     返回 true 表示补过（调用方负责回写，补一次就固化）。 */
  function chgMigrate(list) {
    var seen = {}, changed = false;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      if (r.uid) { seen[r.uid] = 1; continue; }
      var base = 'L' + String(r.at == null ? '' : r.at), n = 0, uid = base;
      while (seen[uid]) { n++; uid = base + '-' + n; }
      r.uid = uid; seen[uid] = 1; changed = true;
    }
    return changed;
  }

  function chgRead(scope, id) {
    try {
      var raw = localStorage.getItem(CHG_KEY(scope, id));
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      if (chgMigrate(arr)) chgWrite(scope, id, arr);   /* 补一次即固化，不每次读都写盘 */
      return arr;
    } catch (e) { return []; }
  }
  function chgWrite(scope, id, list) {
    try { localStorage.setItem(CHG_KEY(scope, id), JSON.stringify(list.slice(0, MAX_CHG))); } catch (e) {}
  }
  function appRec(a) {
    return { id: a.id, name: a.name, client: a.client, desc: a.desc || '',
             status: a.status, updated: a.updated, version: a.version || 0,
             content: JSON.parse(JSON.stringify(a.content || {})),
             /* 装配版本也要进快照：撤回一次"装/卸"必须连它一起回到当时的样子，
                否则撤回后仍带着"旧版本"的印记，卡上会凭空多一条更新提示。 */
             compVer: JSON.parse(JSON.stringify(a.compVer || {})),
             comps: a.comps.slice() };
  }
  function compRec(c) {
    return { id: c.id, name: c.name, layout: c.layout || 'full', block: c.block || null, status: c.status, ver: c.ver,
             desc: c.desc || '', fields: (c.fields || []).slice(),
             spec: c.spec == null ? null : c.spec, config: c.config || {},
             enabled: c.enabled !== false, strip: c.strip === true };
  }
  function snapAll() {
    var out = { apps: {}, comps: {}, built: Date.now() };
    DB.APPS.forEach(function (a) { out.apps[a.id] = appRec(a); });
    DB.COMPS.forEach(function (c) { out.comps[c.id] = compRec(c); });
    return out;
  }

  /* 一句话说清"改了什么"。只报人看得懂的事实，不报 JSON 差异。 */
  function labelOf(scope, before, after) {
    var L = [];
    if (before.name !== after.name) L.push('改名为「' + after.name + '」');
    if (scope === 'app') {
      if (before.client !== after.client) L.push('客户改为「' + after.client + '」');
      if (before.desc !== after.desc) L.push('改了应用说明');
      if (before.comps.join('|') !== after.comps.join('|')) {
        var add = after.comps.filter(function (x) { return before.comps.indexOf(x) < 0; });
        var del = before.comps.filter(function (x) { return after.comps.indexOf(x) < 0; });
        if (add.length) L.push('装上「' + add.map(nmOf).join('」「') + '」');
        if (del.length) L.push('卸下「' + del.map(nmOf).join('」「') + '」');
        if (!add.length && !del.length) L.push('调整了块的顺序');
      }
      var keys = {};
      [before.content || {}, after.content || {}].forEach(function (o) {
        Object.keys(o).forEach(function (k) { keys[k] = 1; });
      });
      Object.keys(keys).forEach(function (k) {
        var b = (before.content || {})[k], a2 = (after.content || {})[k];
        if (JSON.stringify(b || null) === JSON.stringify(a2 || null)) return;
        var d = [];
        if (b && a2) {
          if (b.name !== a2.name) d.push('改名「' + a2.name + '」');
          var bf = (b.fields || []), af = (a2.fields || []);
          var fa = af.filter(function (x) { return bf.indexOf(x) < 0; });
          var fd = bf.filter(function (x) { return af.indexOf(x) < 0; });
          if (fa.length) d.push('+' + fa.join('、'));
          if (fd.length) d.push('−' + fd.join('、'));
          if (JSON.stringify(b.config) !== JSON.stringify(a2.config)) d.push('改了参数');
          if (JSON.stringify(b.spec) !== JSON.stringify(a2.spec)) d.push('改了内容');
        }
        L.push('改「' + nmOf(k) + '」' + (d.length ? '：' + d.join(' ') : ''));
      });
    } else {
      if (before.desc !== after.desc) L.push('改了说明');
      if (JSON.stringify(before.fields) !== JSON.stringify(after.fields)) L.push('改了字段');
      if (before.status !== after.status) L.push('状态改为「' + after.status + '」');
    }
    return L.join('；');
  }
  function nmOf(id) {
    var a = DB.compById(id);
    if (a) return a.name;
    for (var i = 0; i < DB.APPS.length; i++) if (DB.APPS[i].id === id) return DB.APPS[i].name;
    return id;
  }

  function diffAndRecord(prev, next) {
    if (!prev) return;
    var now = Date.now();
    var clock = ('0' + new Date(now).getHours()).slice(-2) + ':' + ('0' + new Date(now).getMinutes()).slice(-2);
    var actor = (typeof window !== 'undefined' && window.__xzActing) ? '小智' : '你';
    var forced = DB._label; DB._label = null;

    var hits = [];
    Object.keys(next.apps).forEach(function (id) {
      var b = prev.apps[id], a = next.apps[id];
      if (!b) return;
      if (JSON.stringify(b) === JSON.stringify(a)) return;
      /* 状态与版本号是台账派生出来的，不是人改的：只在它们变的时候不记流水，
         否则每点一次"保存快照"都会多一条"状态改为已上架"的噪音。 */
      var b2 = { name: b.name, client: b.client, desc: b.desc, content: b.content, comps: b.comps };
      var a2 = { name: a.name, client: a.client, desc: a.desc, content: a.content, comps: a.comps };
      if (JSON.stringify(b2) === JSON.stringify(a2)) return;
      hits.push({ scope: 'app', id: id, before: b, label: forced || labelOf('app', b, a) });
    });
    Object.keys(next.comps).forEach(function (id) {
      var b = prev.comps[id], a = next.comps[id];
      if (!b || JSON.stringify(b) === JSON.stringify(a)) return;
      hits.push({ scope: 'comp', id: id, before: b, label: forced || labelOf('comp', b, a) });
    });
    if (!hits.length) return;
    /* 同一次保存里改了好几个应用（极少见）：各记各的，别把 A 的改动挂到 B 名下 */
    hits.forEach(function (h) {
      if (!h.label) return;
      var list = chgRead(h.scope, h.id);
      list.unshift({ uid: chgUid(now), at: now, clock: clock, actor: actor, label: h.label, before: h.before });
      chgWrite(h.scope, h.id, list);
    });
  }

  DB.changesOf = function (scope, id) { return chgRead(scope, id); };
  DB.changesClear = function (scope, id) { chgWrite(scope, id, []); };

  /* 有没有**真的**还没入档的改动（2026-11-02 修"净零改动仍显示 4 步"）。
     旧口径只看改动流水条数：改一版再改回原样，流水还是 4 条，页面照旧说"还没保存的改动"。
     现在跟**最新一版快照**逐项比：名字、说明、装配顺序、内容指纹全一致 ⇒ 没有待存内容。
     组件页没有"当前内容快照"这一层，退回按条数判。 */
  DB.hasPending = function (scope, id) {
    var rows = chgRead(scope, id);
    if (!rows.length) return false;
    if (scope !== 'app') return true;
    var a = DB.appById(id);
    if (!a) return true;
    var list = DB.versOf('app', id) || [];
    var stables = list.filter(function (r) { return r.kind === 'stable' && r.snap; });
    if (!stables.length) return true;
    var top = stables[0];
    for (var i = 1; i < stables.length; i++) if (stables[i].v > top.v) top = stables[i];
    var s = top.snap;
    if ((s.name || '') !== (a.name || '') || (s.desc || '') !== (a.desc || '')) return true;
    if (JSON.stringify(s.comps || []) !== JSON.stringify(a.comps || [])) return true;
    var now = DB.resolveContent(id);
    if (s.contentHash) return s.contentHash !== DB.hash(now);
    return JSON.stringify(s.content || {}) !== JSON.stringify(now);
  };

  /* 退回某一步之前：还原那一条的 before，并丢掉比它新的步骤（它们的前提已不存在）。
     ★2026-10-28（E3c）：第三个参数是 **uid**（稳定唯一键），不是时间戳。
     老调用方若还传时间戳，只在"这个毫秒只有一条"时接受 —— 有二义就返回 null，
     宁可不退也不退错（旧病正是"同一毫秒两条时退掉了最新那条"）。 */
  DB.changeUndo = function (scope, id, key) {
    var list = chgRead(scope, id);
    var want = String(key == null ? '' : key);
    var idx = -1, i;
    for (i = 0; i < list.length; i++) { if (String(list[i].uid) === want) { idx = i; break; } }
    if (idx < 0) {
      var same = [];
      for (i = 0; i < list.length; i++) { if (String(list[i].at) === want) same.push(i); }
      if (same.length === 1) idx = same[0];
      else if (same.length > 1) return null;      /* 二义：同一个时间戳挂着多步，退哪一步都是猜 */
    }
    if (idx < 0) return null;
    var rec = list[idx].before;
    var dropped = idx;                     /* 比它新的步数 */
    DB._quiet = 1;
    if (scope === 'app') {
      var a = DB.appById(id);
      if (!a) { DB._quiet = 0; return null; }
      a.name = rec.name; a.client = rec.client; a.desc = rec.desc;
      a.content = JSON.parse(JSON.stringify(rec.content || {}));
      a.comps.length = 0;
      (rec.comps || []).forEach(function (x) { if (DB.compById(x)) a.comps.push(x); });
      /* 装配版本跟着回到那一步之前；老快照没有 compVer 时补成当前版本（不误报） */
      a.compVer = JSON.parse(JSON.stringify(rec.compVer || {}));
      syncCompVer(a);
      recomputeRefs();
      DB.save();
    } else {
      var c = DB.compById(id);
      if (!c) { DB._quiet = 0; return null; }
      c.name = rec.name; c.desc = rec.desc;
      c.fields = (rec.fields || []).slice();
      c.spec = rec.spec;
      c.config = JSON.parse(JSON.stringify(rec.config || {}));
      DB.save();
    }
    DB._quiet = 0;
    chgWrite(scope, id, list.slice(idx + 1));
    return { dropped: dropped, restored: rec };
  };

  /* ── 三个查询（别人只该用这三个读） ── */
  DB.appById = function (id) {
    for (var i = 0; i < DB.APPS.length; i++) if (DB.APPS[i].id === id) return DB.APPS[i];
    return null;
  };
  DB.compById = function (id) {
    for (var i = 0; i < DB.COMPS.length; i++) if (DB.COMPS[i].id === id) return DB.COMPS[i];
    return null;
  };
  DB.installedCount = function (appId) {
    var a = DB.appById(appId);
    return a ? a.comps.length : 0;
  };
  /* ★2026-10-24（链路 S2 抓到）：「这个组件能不能被装进应用」这件事曾经有两套谓词 ——
     应用配置页的装配面板只看 status === '已上架'，配置器看 启用 + 发布 两个维度。
     于是把一个组件设成「已禁用」之后，它仍然躺在装配候选里。
     data.js:144 的注释自己写着「启用/禁用讲的是"是否出现在装配候选里"」，代码没照做。
     现在只有这一个定义处：任何"能不能装"的判断都调它，判据 tools/check-predicate.mjs 钉住。 */
  DB.canInstall = function (c) {
    return !!c && c.status === '已上架' && c.enabled !== false;
  };

  /* ★2026-10-26 晚：**上屏只有一个状态维度**（草稿 / 启用 / 禁用）。
     数据里仍是两维（status 发布态 × enabled 装配许可），但界面不许把两维分别念出来 ——
     那正是「同一件事四套词」的来源：已上架/已下架 讲发布流程，启用/禁用 讲能不能装，
     两个词都在屏上，用户没法判断「禁用」和「已下架」是不是一回事。
     这个函数是**全站唯一**把两维折成一维的地方，任何页面要显示"这个组件现在什么状态"都调它：
       草稿 = 一版都没发过（要先去配置页发布）
       启用 = 现在能被装进应用（canInstall 为真）
       禁用 = 发不过 / 但装不了（下架了，或装配许可被关掉）
     禁用**不会**动已经装配它的应用：装配关系存在 APP_COMPS 里，与这里无关。 */
  DB.compState = function (c) {
    if (!c) return '';
    /* 2026-10-27：草稿这个词退役。老存档里的「草稿」与新写的「未发布」都折成「未发布」。 */
    if (c.status === '未发布' || c.status === '草稿') return '未发布';
    return DB.canInstall(c) ? '启用' : '禁用';
  };
  /* 状态 → CSS 钩子（on / off / draft）。
     为什么要有它：卡片要把"未发布"画成警示橙而不是灰 —— 那是三种不同的运维处境。
     映射只写这一处（state 的唯一来源是上面的 compState），页面里不许再写第二份
     "中文状态 → 类名"的对照表：两份表迟早只改一份，然后界面上的颜色和文案对不上。
     加这一条的直接原因：在模板里写 {'未发布':'draft', …} 会让卡面判据把中文当文案抓。 */
  DB.compStateCls = function (c) {
    var s = DB.compState(c);
    return s === '启用' ? 'on' : (s === '未发布' ? 'draft' : 'off');
  };

  /* ── 启用 / 禁用：一次写完两维，别处不许各写一半 ─────────────────────
     2026-10-26 之前，卡片开关写 enabled、版本页只写台账 —— 两处各改一半，
     于是"版本页停用了、卡片还写着启用、装配面板里照样能装"。现在只有这两个入口改它。
     禁用 = 台账里没有启用中的版本 + 装配许可关掉；
     启用 = 启用最近的一版正式版 + 装配许可打开（草稿不能上线，返回 null）。 */
  DB.compEnable = function (id, v) {
    var c = DB.compById(id);
    if (!c) return null;
    var st = DB.versOf('comp', id).filter(function (r) { return r.kind === 'stable'; });
    if (!st.length) return null;
    var want = parseInt(v, 10) || st[0].v;
    /* 只留一条还原路径：versApply 负责 spec/fields/desc/name + active */
    var rec = DB.versApply('comp', id, want);
    if (!rec) return null;
    c.status = '已上架'; c.enabled = true; c.ver = 'v' + want;
    DB.save();
    return c;
  };
  DB.compDisable = function (id) {
    var c = DB.compById(id);
    if (!c) return null;
    var saved = DB.versDeactivate('comp', id);
    if (!saved) return null;
    /* 未发布禁用之后还是未发布 —— 它本来就没上过线，不该被写成「已下架」 */
    if (c.status !== '未发布' && c.status !== '草稿') c.status = '已下架';
    c.enabled = false;
    DB.save();
    return c;
  };
  /* 某应用装了哪些组件对象（按装配顺序）。
     列表页封面要画"这个应用由什么构成"，只给计数不够 —— 所以这里返回对象数组，
     不在调用处自己 map 一遍（否则"装配顺序"这件事会有两份实现）。 */
  DB.compList = function (appId) {
    var a = DB.appById(appId);
    if (!a) return [];
    return a.comps.map(DB.compById).filter(Boolean)
      .map(function (c) { return { id: c.id, name: c.name }; });
  };

  /* ── 装配版本 compVer：谁落后了（2026-10-28）────────────────────────
     在这之前应用只记"装了哪些组件 id"，不记"装的时候它是什么版本" ——
     组件升到 v3 之后，没有任何数据能回答"这个应用落后了没有"，
     卡上写「{N} 个组件有更新」就只能靠猜，猜错就是把没问题的应用喊去返工。

     口径（规格 §11.2 单一公式）：
       可更新 = 组件已上架 + 启用（DB.canInstall 是唯一谓词）
                + 最新版号 > 该应用装配的版号
     ★已下架的组件不进 N（规格 §5.4）：它没有"可装配的最新版"，
       编号更大也不画箭头 —— 画了就是假承诺。
     ★N 只有一处算法：卡片徽标、抽屉筛选行、（下一单）筛选列表行数都调 updateCount()；
       谁自己再 filter 一遍，三处数字就会漂移。 */
  DB.verNum = function (v) { return parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10) || 0; };

  /* 装配版本缺失 ⇒ 返回组件当前版本（= 与最新一致）。
     老存档没有 compVer，这条兜底保证"升级功能上线当天，全站不炸出一片假红"。 */
  DB.installedVer = function (appId, compId) {
    var a = DB.appById(appId), c = DB.compById(compId);
    if (!a || !c) return '';
    var v = a.compVer && a.compVer[compId];
    return (typeof v === 'string' && v) ? v : c.ver;
  };

  /* 键=已装件、值=装配版本。补缺（老存档/撤回装回）＋裁多（已卸载的残键）。 */
  function syncCompVer(a) {
    if (!a) return;
    var prev = (a.compVer && typeof a.compVer === 'object') ? a.compVer : {};
    var keep = {};
    (a.comps || []).forEach(function (id) {
      var c = DB.compById(id);
      if (!c) return;
      var v = prev[id];
      keep[id] = (typeof v === 'string' && v) ? v : c.ver;
    });
    a.compVer = keep;
  }

  DB.updatesOf = function (appId) {
    var a = DB.appById(appId), out = [];
    if (!a) return out;
    a.comps.forEach(function (id) {
      var c = DB.compById(id);
      if (!c || !DB.canInstall(c)) return;
      var have = DB.installedVer(appId, id);
      if (DB.verNum(c.ver) > DB.verNum(have)) out.push({ id: id, name: c.name, from: have, to: c.ver });
    });
    return out;
  };
  DB.updateCount = function (appId) { return DB.updatesOf(appId).length; };

  /* ★2026-11-01（用户原话）：「我一个应用装配了 100 个插件，我一个个点升级吗？我是不是要累死了，
     是不是应该有一个一键升级，括号里有 76 个」。
     该有，而且与 DECISIONS §4「不做批量」不冲突 —— 那条说的是**批量挑不同组件装配**
     （不同风险叠在一张单上）；这里是把同一件事（升到最新版）×N，风险同质。
     语义：只改装配版本号，不碰内容、不动客户可见版本（要客户看到还得去授权页升级）。
     返回 { n, list }：n=升了几个，list=升前的 from→to，给 toast 用。 */
  DB.upgradeAll = function (appId) {
    var a = DB.appById(appId);
    if (!a) return null;
    var ups = DB.updatesOf(appId);
    if (!ups.length) return { n: 0, list: [] };
    syncCompVer(a);
    ups.forEach(function (u) { a.compVer[u.id] = u.to; });
    a.updated = DB.now();
    /* ★2026-11-01（评审 P0）：原来无条件 return {n}，写盘失败也报成功。
       隐私模式/配额满时：内存里 76 个 compVer 已经前移、按钮随即消失、toast 报"已升级 76 个"，
       刷新后全部回到旧版 —— 用户以为升完了，接着去存版、去授权，客户拿到的还是旧组件。 */
    if (DB.save() === false) return null;
    return { n: ups.length, list: ups };
  };

  /* ★2026-11-03（m05719）：多选批量升级。与 upgradeAll 同语义，只是范围收窄到 ids；
     供装配面板「一键升级（N）」用。 */
  DB.upgradeSome = function (appId, ids) {
    var a = DB.appById(appId);
    if (!a) return null;
    var want = {};
    (ids || []).forEach(function (id) { want[id] = 1; });
    var ups = DB.updatesOf(appId).filter(function (u) { return want[u.id]; });
    if (!ups.length) return { n: 0, list: [] };
    syncCompVer(a);
    ups.forEach(function (u) { a.compVer[u.id] = u.to; });
    a.updated = DB.now();
    if (DB.save() === false) return null;
    return { n: ups.length, list: ups };
  };

  /* ── 组件反向升级：从组件看"谁落后了"（2026-11-04）──────────────
     应用侧只看得到自己装了哪几件；组件侧要一次回答"这个组件被哪些应用装着、
     谁落后、谁自定义过这一块"。口径与 DB.updatesOf 完全相同（canInstall + 版本比较），
     不许在页面里另写一份 filter —— 否则卡片角标与引用名单会各说各的数。
     overlay：应用自己改过这一块（app.content[compId] 存在），自动升级会覆盖私有改动。 */
  DB.compRefs = function (compId) {
    var c = DB.compById(compId);
    if (!c) return [];
    var latest = c.ver;
    return DB.APPS.filter(function (a) {
      return (a.comps || []).indexOf(compId) >= 0;
    }).map(function (a) {
      var have = DB.installedVer(a.id, compId);
      var behind = DB.canInstall(c) && DB.verNum(latest) > DB.verNum(have);
      return {
        app: a, id: a.id, name: a.name,
        have: have, latest: latest, behind: behind,
        overlay: !!(a.content && a.content[compId])
      };
    }).sort(function (x, y) {
      if (x.behind !== y.behind) return x.behind ? -1 : 1;
      if (x.overlay !== y.overlay) return x.overlay ? 1 : -1;
      return String(x.name).localeCompare(String(y.name), 'zh-Hans-CN');
    });
  };
  DB.compUpgradeStats = function (compId) {
    var refs = DB.compRefs(compId);
    var behind = refs.filter(function (r) { return r.behind; });
    var auto = behind.filter(function (r) { return !r.overlay; });
    return { total: refs.length, behind: behind.length, auto: auto.length, manual: behind.length - auto.length };
  };

  /* 一次升级某个组件在多个应用里的装配版本。只改 a.compVer[compId]，不碰应用内容、
     不动客户授权版本 —— 与 upgradeAll/upgradeSome 的语义完全一致。
     ids 省略 = 全部引用（"全部升级"无视分页，就靠这一条）。
     写盘失败才进 failed（2026-11-04：overlay 跳过已退役）。
     逐条 save 是为了失败时只回滚那一条，不把已经成功的也一起退掉。 */
  DB.upgradeCompRefs = function (compId, ids) {
    var c = DB.compById(compId);
    var out = { ok: [], skipped: [], failed: [] };
    if (!c) return out;
    var want = null;
    if (ids) { want = {}; ids.forEach(function (id) { want[id] = 1; }); }
    DB.compRefs(compId).forEach(function (r) {
      if (!r.behind) return;
      if (want && !want[r.id]) return;
      /* ★2026-11-04（用户：「没有所谓的需手动和已自定义！给我移除掉」）：
         不再有"改过就不升"这条分支 —— 升级只动 compVer，应用自己的内容层
         （app.content）原封不动，渲染仍以应用那份为准，所以不存在"覆盖私有改动"。
         引用管理页也只讲两件事：谁落后了、升到最新。 */
      var a = DB.appById(r.id);
      if (!a) return;
      var old = (a.compVer && a.compVer[compId]) || null;
      syncCompVer(a);
      a.compVer[compId] = c.ver;
      a.updated = DB.now();
      if (DB.save() === false) {
        if (old) a.compVer[compId] = old; else delete a.compVer[compId];
        out.failed.push({ id: r.id, name: r.name, reason: '这台电脑写不进去，这一条没有升级' });
        return;
      }
      out.ok.push({ id: r.id, name: r.name, from: r.have, to: c.ver });
    });
    return out;
  };

  /* 组件类型（页面类 / 能力类）已退役：用户两次否决这个分类，COMP 里不再有 type。
     apps.html 的封面还按这一格取色（DB.typeClass(c.type)），所以函数保留，
     但只回一种中性色 —— 分类没了，就没有第二种颜色可讲。 */
  DB.typeClass = function () { return 'slate'; };

  /* ── 应用自己的内容层（2026-10-27）──────────────────────────────
     组件是共用件：同一个 rule-panel 装着 3 个应用。如果应用版本快照只存
     "装了哪几个组件"，回滚就会把共用件改回旧内容 —— 三家一起变。
     所以应用必须先有一层自己的内容覆盖：app.content[compId] = {name,spec,fields,config}。
     版本快照拍的是这一层；画布优先读这一层，没覆盖才回落到组件库。

     ★2026-10-28 修 E22（跨应用串味）：读出来的 spec/config **一律是深拷贝**。
       病根：没有覆盖时 contentOf() 直接返回 `DB.COMPS[i].spec` 那个对象引用，
       画布拿它当自己的内容去 `cols.push()`，改的是共用件本体 ——
       给 A 应用加一列，装同一组件的 B/C 也白得一条幽灵列。
       写入侧（setAppContent）同样深拷贝：内容层不保留调用方的引用，
       否则"本应用私有"又会变成"和共用件同一份"。
       这一层只加读/写/撤三个口子，别处不许直接改 app.content。 */
  function deepCopy(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  DB.contentOf = function (appId, compId) {
    var a = DB.appById(appId);
    var c = DB.compById(compId);
    if (!a || !c) return null;
    var own = (a.content && a.content[compId]) || null;
    /* 装配的是哪个版本，就渲哪一版的内容。应用自己改过这一块（own.fields）时以应用为准。 */
    var av = (a.compVer && a.compVer[compId]) || null;
    var fullFields = c.fields || [];
    var baseFields = (av && c.fieldsByVer && c.fieldsByVer[av]) ? c.fieldsByVer[av] : fullFields;
    /* 行数据是按「完整字段表」的位置存的定位数组；裁列后必须记住每列原来在第几位，
       否则表头三列、值还是五列的顺序 —— 金额列会显示成业务类型（盲审 F1 blocker）。 */
    var fieldSrc = baseFields.map(function (f) { return fullFields.indexOf(f); });
    return {
      id: c.id, name: (own && own.name) ? own.name : c.name,
      layout: c.layout || 'full', block: c.block || null, status: c.status, enabled: c.enabled !== false,
      refs: c.refs || 0, strip: c.strip === true,
      fields: (own && Array.isArray(own.fields)) ? own.fields.slice() : baseFields.slice(),
      fieldSrc: (own && Array.isArray(own.fields))
        ? own.fields.map(function (f) { return fullFields.indexOf(f); })
        : fieldSrc.slice(),
      spec: deepCopy((own && own.spec !== undefined) ? own.spec : c.spec),
      config: deepCopy((own && own.config !== undefined) ? own.config : c.config)
    };
  };
  DB.resolveContent = function (appId) {
    var a = DB.appById(appId), out = {};
    if (!a) return out;
    a.comps.forEach(function (id) {
      var c = DB.contentOf(appId, id);
      if (c) out[id] = { name: c.name, spec: c.spec, fields: c.fields, fieldSrc: c.fieldSrc, config: c.config };
    });
    return out;
  };
  DB.setAppContent = function (appId, compId, patch, save) {
    var a = DB.appById(appId);
    if (!a || !DB.compById(compId) || !patch) return null;
    if (!a.content || typeof a.content !== 'object') a.content = {};
    var cur = a.content[compId] || {};
    ['name', 'spec', 'fields', 'config'].forEach(function (k) {
      if (patch[k] === undefined) return;
      /* spec/config 是结构数据：存进来的是副本，不能和调用方（或共用件）共用一个对象 */
      cur[k] = (k === 'spec' || k === 'config') ? deepCopy(patch[k])
        : (k === 'fields' ? patch[k].slice() : patch[k]);
    });
    a.content[compId] = cur;
    if (save !== false) DB.save();
    return cur;
  };
  /* 撤回用：把内容层恢复到"改前没有这一块覆盖"的状态。
     如果只把 spec 改回旧值、却留着一条覆盖，画布以后就不再跟随组件库 ——
     同名同值，看不出来，直到下一次组件升级才发现这家没跟上。 */
  DB.dropAppContent = function (appId, compId, save) {
    var a = DB.appById(appId);
    if (!a || !a.content || !a.content[compId]) return false;
    delete a.content[compId];
    if (save !== false) DB.save();
    return true;
  };
  /* 老存档里被写进去的工程词（"内容快照 8eea44e3" / "种子快照"）在**渲染时**抹掉。
     那是我们曾经漏到界面上的词，不该因为历史记录就一直挂在屏幕上；
     新写的文案已经不生成它，这里负责把存量洗干净。

     ★2026-10-28 修（E3b）：上一版正则判的是"6 位以上十六进制"，于是四类正常文本被误伤：
       「内容快照 20261027 已归档」→「已归档」（日期被当成哈希吃掉）
       「内容快照 abcdefghi」→「ghi」（半截匹配，留个尾巴）
       「这版内容快照 123456 份」→「这版 份」（句中挖洞，句子断了）
       「基于种子快照生成结论」→「基于生成结论」（无条件整词删除）
     根因是**拿正文开刀去洗词**：只要句子里出现"内容快照 + 长得像哈希的串"就必然被吃。
     口径改成：只认历史上真正写进去的那三种形态，其余**一字不动**。
       ① 我们拼在 summary 尾部的「 · 内容快照 <8 位小写十六进制>」——整段剥掉
          （DB.hash 恒返回 8 位小写 hex，见 pushVer / commitPublish）
       ② summary 整段就是「种子快照」——整串相等才丢，句中不动
       ③ 整段就是「内容快照 <8 位>」——没有可读正文，丢
     ⚠ 也不做 trim：这是"抹词"，不是"格式化"；多一个空格也算改了正常句子。 */
  DB.plain = function (s) {
    var t = String(s == null ? '' : s);
    if (/^\s*种子快照\s*$/.test(t)) return '';
    var out = t.replace(/\s*·\s*内容快照\s+[0-9a-f]{8}\s*$/, '');
    if (/^\s*内容快照\s+[0-9a-f]{8}\s*$/.test(out)) return '';
    return out;
  };

  /* 内容指纹：只用来证明"这一版拍到的内容是哪一份"，不是安全哈希。 */
  DB.hash = function (obj) {
    var s = JSON.stringify(obj == null ? null : obj), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  };

  /* ── 写入口：B/C 两组都要装卸，与其各写一遍 splice，不如留在这里 ── */
  DB.install = function (appId, compId) {
    var a = DB.appById(appId);
    var c = DB.compById(compId);
    if (!a || !c || a.comps.indexOf(compId) >= 0) return false;
    a.comps.push(compId);
    /* 记的是"装这一刻它是什么版本"（不是"最新版"）：以后组件升版才判得出落后。
       漏写这一行 = 装完立刻被视为"与最新一致"，更新提示对这个应用永久失效。 */
    if (!a.compVer || typeof a.compVer !== 'object') a.compVer = {};
    a.compVer[compId] = c.ver;
    recomputeRefs();
    DB.save();
    return true;
  };
  DB.uninstall = function (appId, compId) {
    var a = DB.appById(appId);
    if (!a) return false;
    var i = a.comps.indexOf(compId);
    if (i < 0) return false;
    a.comps.splice(i, 1);
    /* 装配记录与装配版本一起删：留一条残键，以后同一组件再装回来时
       会把"上一轮的旧版本"当成这次装的版本，凭空报一条更新。 */
    if (a.compVer) delete a.compVer[compId];
    recomputeRefs();
    DB.save();
    return true;
  };

  /* ── 新建应用（2026-10-24 加，修 P0-3）────────────────────────────
     原来「新建应用」是一个 href="app.html" 的链接，不带 id，于是 app.html 回落到
     列表第一条 ⇒ 用户要新建，却被送进「华信证券 · 债承审核」的配置页，改完保存就改到别人的应用。
     现在只留一个真入口：建一条草稿 → 返回它的 id → 由调用方跳 app.html?id=<新 id>。
     id 用 `app-<时间戳>`，与种子里的短 id 不冲突（种子里没有 app- 前缀）。 */
  DB.createApp = function (opt) {
    opt = opt || {};
    var id = opt.id || ('app-' + Date.now().toString(36));
    var n = 1;
    while (DB.appById(id)) { id = 'app-' + Date.now().toString(36) + '-' + (n++); }
    var now = opt.updated || new Date().toISOString().slice(0, 10);
    /* ★2026-11-02（第二次改）：应用不再有"所属客户"这一个字段 ——
       一个应用授权给谁，全在 DB.AUTHS 里。新建应用只建自己。 */
    var app = {
      id: id,
      name: opt.name || '未命名应用',
      desc: opt.desc || '还没有填写说明',
      status: opt.status || '未发布',
      updated: now,
      version: 0,
      content: {},
      /* 装配版本：新建的应用一件都没装，所以是空表（不是"与最新一致"的缺键状态）。 */
      compVer: {},
      comps: [],
      /* ★2026-11-02：新建时选的封面原来被这里吞掉了 —— apps.html 传了 cover，这个对象字面量
         没有 cover 字段，于是新建完封面又变回默认图（用户选了等于没选）。
         coverStyle：生成封面的样式序号（0..15，4 色系 × 4 图形），null＝按应用在列表里的位置算。 */
      cover: opt.cover || '',
      coverStyle: (typeof opt.coverStyle === 'number' ? opt.coverStyle : null),
      /* ★2026-11-03（m03263）：可见 / 可配置范围。没选就落 null，
         读取方按「仅自己」解释 —— 老记录没有这两个键也走同一条路。 */
      visScope: opt.visScope || null,
      cfgScope: opt.cfgScope || null
    };
    DB.APPS.unshift(app);
    DB.APP_COMPS[app.id] = app.comps;
    DB.save();
    return app;
  };
  /* 改名/改说明/改状态都要落盘 —— 否则"改了没保存"会在刷新时无声回滚 */
  DB.updateApp = function (id, patch) {
    var a = DB.appById(id);
    if (!a || !patch) return null;
    ['name', 'client', 'desc', 'status', 'updated', 'version'].forEach(function (k) {
      if (patch[k] != null) a[k] = patch[k];
    });
    DB.save();
    return a;
  };

  /* ══ 复制 / 导出 / 导入（2026-10-30；用户点名「这么基本的逻辑为什么没有」）══════════
     三条口径，先定死，页面不许各写一份：
       ① **复制＝派生新记录，不碰原件**。副本一律「未发布、版本 0、无授权」——
          复制出来的是可以随便改的草稿，不是又一份对客户生效的应用。
       ② **导出＝一整包**。应用包连它用到的组件定义一起带走，否则换台机器导进来是个空壳。
       ③ **导入＝新建，永不覆盖**。同 id 的组件已存在就复用；同名就加序号 ——
          导入一份文件不该改掉别人正在用的东西。 */
  /* ★2026-11-01（用户）：「今天一天可能更新好几个版本，那我怎么知道是今天什么时候更新的？」
     ⇒ 所有写入的时间一律存**完整时间戳** YYYY-MM-DD HH:mm:ss（DB.now()），不再存纯日期。
     为什么手拼而不是 toISOString().slice(0,10)：那个是 UTC，
     北京时间 00:00–08:00 之间取到的是前一天 —— 日期本身就是错的，只是白天看不出来。 */
  function stamp(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  DB.now = function () { return stamp(); };
  DB.stamp = stamp;

  function todayStr() { return stamp(); }
  function uniqueName(list, base) {
    var taken = {};
    list.forEach(function (x) { taken[x.name] = 1; });
    if (!taken[base]) return base;
    var i = 2;
    while (taken[base + ' ' + i]) i++;
    return base + ' ' + i;
  }
  function freshId(prefix, list) {
    var id = prefix + Date.now().toString(36);
    var n = 1;
    while (list.some(function (x) { return x.id === id; })) id = prefix + Date.now().toString(36) + '-' + (n++);
    return id;
  }
  function appRecord(a) { var o = pickSchema(a, APP_FIELDS); o.comps = a.comps.slice(); return o; }
  function compRecord(c) { return pickSchema(c, COMP_FIELDS); }

  DB.cloneApp = function (id, wantName) {
    var a = DB.appById(id);
    if (!a) return null;
    var copy = JSON.parse(JSON.stringify(appRecord(a)));
    copy.id = freshId('app-', DB.APPS);
    /* ★2026-11-04（m07271）：复制时名称由用户输，唯一性在数据层再挡一道。
       页面已经校验过；这里仍是唯一入口，防别的调用方绕过 UI 造出重名。 */
    if (wantName != null) {
      var wn = String(wantName).trim();
      if (!wn || DB.APPS.some(function (x) { return x.name === wn; })) return null;
      copy.name = wn;
    } else {
      copy.name = uniqueName(DB.APPS, a.name + '（副本）');
    }
    copy.status = '未发布';
    copy.version = 0;
    copy.updated = todayStr();
    DB.APPS.unshift(copy);
    DB.APP_COMPS[copy.id] = copy.comps;
    recomputeRefs();
    DB.save();
    return copy;
  };

  DB.cloneComp = function (id, wantName) {
    var c = DB.compById(id);
    if (!c) return null;
    var copy = JSON.parse(JSON.stringify(compRecord(c)));
    copy.id = freshId('comp-', DB.COMPS);
    if (wantName != null) {
      var wn = String(wantName).trim();
      if (!wn || DB.COMPS.some(function (x) { return x.name === wn; })) return null;
      copy.name = wn;
    } else {
      copy.name = uniqueName(DB.COMPS, c.name + '（副本）');
    }
    copy.label = copy.name;
    copy.status = '未发布';
    copy.ver = 'v1';
    copy.refs = 0;
    /* 版本快照是按原件的版本号建的，副本不继承 —— 否则「v3 的字段」会挂在只有 v1 的新件上 */
    copy.fieldsByVer = null;
    copy.configBy = null;
    DB.COMPS.unshift(copy);
    DB.save();
    return copy;
  };

  DB.exportApp = function (id) {
    var a = DB.appById(id);
    if (!a) return null;
    return {
      kind: 'daguan-app', schema: 1, at: new Date().toISOString(),
      app: appRecord(a),
      comps: a.comps.map(function (cid) { var c = DB.compById(cid); return c ? compRecord(c) : null; })
        .filter(function (x) { return !!x; })
    };
  };

  DB.exportComp = function (id) {
    var c = DB.compById(id);
    if (!c) return null;
    return { kind: 'daguan-comp', schema: 1, at: new Date().toISOString(), comp: compRecord(c) };
  };

  /* 返回 { ok, msg, name } —— 页面只负责把 msg 说出来，不再各自判断一堆条件 */
  DB.importPayload = function (obj, wantName) {
    if (!obj || typeof obj !== 'object') return { ok: false, msg: '这个文件不是本系统导出的 JSON' };
    var want = wantName == null ? '' : String(wantName).trim();

    if (obj.kind === 'daguan-comp') {
      if (!obj.comp || !obj.comp.name) return { ok: false, msg: '组件文件里没有内容' };
      if (want && DB.COMPS.some(function (x) { return x.name === want; })) {
        return { ok: false, msg: '已经有同名组件「' + want + '」' };
      }
      var nc = pickSchema(obj.comp, COMP_FIELDS);
      if (DB.compById(nc.id)) nc.id = freshId('comp-', DB.COMPS);
      nc.name = want || uniqueName(DB.COMPS, nc.name);
      nc.label = nc.name;
      nc.status = '未发布';
      nc.ver = 'v1';
      nc.refs = 0;
      nc.fieldsByVer = null;
      nc.configBy = null;
      DB.COMPS.unshift(nc);
      DB.save();
      return { ok: true, name: nc.name };
    }

    if (obj.kind === 'daguan-app') {
      if (!obj.app || !obj.app.name) return { ok: false, msg: '应用文件里没有内容' };
      /* 重名先挡：下面会往组件库补件，先挡在这里才不会留下半次导入 */
      if (want && DB.APPS.some(function (x) { return x.name === want; })) {
        return { ok: false, msg: '已经有同名应用「' + want + '」' };
      }
      /* 先补组件：已存在同 id 的一律复用，不覆盖别人的共用件 */
      var added = 0;
      (obj.comps || []).forEach(function (raw) {
        if (!raw || !raw.id || DB.compById(raw.id)) return;
        var c = pickSchema(raw, COMP_FIELDS);
        c.label = c.name;
        c.refs = 0;
        DB.COMPS.push(c);
        added++;
      });
      var na = pickSchema(obj.app, APP_FIELDS);
      na.id = freshId('app-', DB.APPS);
      na.name = want || uniqueName(DB.APPS, na.name);
      na.status = '未发布';
      na.version = 0;
      na.updated = todayStr();
      na.comps = (obj.app.comps || []).filter(function (cid) { return !!DB.compById(cid); });
      DB.APPS.unshift(na);
      DB.APP_COMPS[na.id] = na.comps;
      recomputeRefs();
      DB.save();
      return { ok: true, name: na.name, comps: added };
    }

    return { ok: false, msg: '这个文件不是本系统导出的（缺 kind 标记）' };
  };

  /* ══ 版本台账（2026-10-27 单一工作区模型：用户重定）══════════════════════
     只有两种东西：
       当前状态  —— 永远一份，在 DB.APPS 里自动保存，不占版本号，不叫草稿
       快照      —— 用户点「保存快照」时把当前内容整包冻成 stable，不可变
     active 只有一个：同一 owner 下最多一条 stable.active=true；它就是当前授权版本。

     ★四条死命令：
       ① 唯一：同 owner 下 active=true 的 stable ≤1 条（versSet 归一化保证）。
       ② 原子：切换版本一次写完整个数组，不留"两条 active"的中间态。
       ③ 无草稿：normalize 丢弃 draft；旧存档里的 draft 行不影响当前状态。
       ④ 不可变：snap 深拷贝落盘，之后改画布不会改到历史快照。

     snap 是整包快照：应用＝comps + content（每块 spec/fields/config）+ name/desc/client + contentHash；
     组件＝spec/fields/desc。恢复时内容与装配一起还原，不再只切版本号。 */
  /* 台账键带上种子版本：种子一改，旧台账就再也读不到，重新按当前种子种一份。
     不带的话，改了种子只重置 db，台账原样读回 —— 页面显示的是上一版种子的事实。 */
  var LEDGER_KEY = function (scope, id) { return 'ifas90:vers:' + scope + ':' + id + NS + ':' + SEED_VER; };
  var LEGACY_APP = function (id) { return 'ifas90:app:vers:' + id; };
  var LEGACY_COMP = function (id) { return 'ifas90:comp:vers:' + id; };
  var MAX_VERS = 60;
  /* 版本页要能说清"更早的被清理了"：上限不是暗规则 */
  DB.MAX_VERS = MAX_VERS;

  function todayISO() { return stamp(); }
  /* ★2026-11-04：种子补历史版本要用到"往前 N 天"，只在种子期调用。 */
  function dayBefore(iso, n, hh, mm) {
    var d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() - n);
    if (typeof hh === 'number') { d.setHours(hh); d.setMinutes(typeof mm === 'number' ? mm : 0); }
    var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
      + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }   /* 2026-11-01：与 DB.now() 同源，不再单独算 */

  /* 归一化 = 四条死命令在数据层的落点。所有写入都必须经过它。
     ★2026-10-27 单一工作区模型：版本只存"保存过的快照"，不再有草稿行。
       当前状态永远在 DB.APPS 里自动保存，不占版本号；旧存档里的 draft 行直接丢弃
       （不丢内容 —— 内容本来就在应用记录上）。 */
  function normalize(list) {
    var stables = (list || []).filter(function (r) {
      return r && r.kind === 'stable' && (parseInt(r.v, 10) || 0) > 0;
    }).map(function (r) {
      r.v = parseInt(r.v, 10) || 0;
      r.kind = 'stable';
      r.active = !!r.active;
      /* ★2026-11-01 时间格式归一：这一版之前 at 存的是纯日期「2026-10-20」，
         现在统一存「2026-10-20 14:32:08」。老记录没有时分秒，补成 "--:--:--"，
         **不补 00:00:00** —— 那会让人以为真是半夜零点存的，是把"没记"写成"记了"。
         同一条列表里两种格式并存，比缺时间更糟。 */
      if (r.at && /^\d{4}-\d{2}-\d{2}$/.test(r.at)) r.at = r.at + ' --:--:--';
      if (r.snap && r.snap.at && /^\d{4}-\d{2}-\d{2}$/.test(r.snap.at)) r.snap.at = r.snap.at + ' --:--:--';
      return r;
    }).sort(function (a, b) { return b.v - a.v; });
    /* 同号去重：旧版本发号 bug 会留下两条 vN，读回时只保留一条；
       如果被丢的那条是 active，把 active 合并到保留的那条。 */
    var seenV = {};
    stables = stables.filter(function (r) {
      if (seenV[r.v]) {
        if (r.active) seenV[r.v].active = true;
        return false;
      }
      seenV[r.v] = r;
      return true;
    });
    /* ② 唯一启用：按版本号降序取第一条 active，其余全关 —— 一次算完，不留中间态 */
    var used = false;
    stables.forEach(function (r) {
      if (r.active) { if (used) r.active = false; used = true; }
    });
    var keep = stables.slice(0, MAX_VERS);
    /* F9（独立盲审）：当前 active 恰好在最老一版、版本数又超过上限时，
       直接 slice 会把 active 一起切掉，应用会被派生成「已下架」。
       截断后如果 active 不在保留集里，就用它替掉最后一条。 */
    var act = stables.filter(function (r) { return r.active; })[0];
    if (act && keep.indexOf(act) < 0) {
      keep = keep.slice(0, MAX_VERS - 1).concat([act]).sort(function (a, b) { return b.v - a.v; });
    }
    return keep;
  }

  /* 种子：老数据只有 {v,at} 或只有记录上的 version 字段。
     ★2026-10-27 单一工作区模型：只种"保存过的快照"，不再生成草稿行。
       当前状态永远在 DB.APPS 里自动保存，不占版本号。 */
  function seedLedger(scope, id) {
    var at = todayISO(), arr = [];
    if (scope === 'app') {
      var a = DB.appById(id);
      if (!a) return [];
      var v = parseInt(a.version, 10) || 0;
      if (v > 0) {
        var content = DB.resolveContent(id);
        /* ★2026-11-04：只有"当前这一版"时，卡上写 v5、版本页写「共 1 个版本」——
           版本管理页里连一条历史都没有。按版本号补 v1..vN-1（快照同当前版，
           只把时间按版本号错开），让历史与"恢复"在演示里是真的。 */
        var baseSnap = { comps: (a.comps || []).slice(), name: a.name, desc: a.desc, client: a.client,
                         content: content, contentHash: DB.hash(content), summary: '第一版',
                         at: a.updated || at, editor: (DB.editor ? DB.editor() : 'admin') };
        for (var hv = 1; hv < v; hv++) {
          var oldSnap = {}; for (var k in baseSnap) oldSnap[k] = baseSnap[k];
          oldSnap.at = dayBefore(a.updated || at, (v - hv) * 4, 10 + ((hv * 3) % 7), (hv * 13) % 60);
          arr.push({ v: hv, kind: 'stable', active: false, at: oldSnap.at, snap: oldSnap });
        }
        arr.push({ v: v, kind: 'stable', active: a.status === '已上架', at: a.updated || at,
          snap: { comps: (a.comps || []).slice(), name: a.name, desc: a.desc, client: a.client,
                  content: content, contentHash: DB.hash(content), summary: '第一版', at: a.updated || at,
                  editor: (DB.editor ? DB.editor() : 'admin') } });
        /* ★2026-11-01 演示数据：华信 / 招商各留一版"**存了但还没给客户升级**"。
           这一版在真实系统里的来路就是"配置页点了存成新版本"；
           留它是为了让客户授权页能让人看到「升级到 vN」这个动作真实的样子 ——
           否则那一列永远是空的，等于没做。 */
        var demoPending = { 'hx-zc': 4, 'zs-dj': 5 };
        var pv = demoPending[id];
        if (pv && pv > v && !arr.some(function (r) { return r.v === pv; })) {
          /* ★2026-11-01：这一版的内容跟 v3 **故意不一样** —— 多两列。
             目的：让「兼容性预演」有东西可报。真实系统里这就是"新版加了列，
             客户那份旧数据没有"，正是升级前最该拦住的情况。
             如果两版内容一样，预演永远显示"跑通了"，等于没做。 */
          var demoContent = JSON.parse(JSON.stringify(content));
          var tgtId = demoContent['task-list'] ? 'task-list' : (demoContent['rule-panel'] ? 'rule-panel' : null);
          var tgt = tgtId ? demoContent[tgtId] : null;
          if (tgt && Array.isArray(tgt.fields)) {
            tgt.fields = tgt.fields.concat(['触发规则', '责任人']);
            /* ★2026-11-04（用户：「怎么没有几个应用待升级的标签」引发的连带修）：
               加了列没加列位，快照里的 fieldSrc 仍只有 3 位，而现场按 app.content 重算出来是 5 位
               —— 一进配置页就判「v4 · 未保存」，可用户什么都没改。列位跟着列一起补。 */
            var fullFields = ((DB.compById(tgtId) || {}).fields || []);
            tgt.fieldSrc = tgt.fields.map(function (f) { return fullFields.indexOf(f); });
          }
          arr.push({ v: pv, kind: 'stable', active: false, at: at,
            snap: { comps: (a.comps || []).slice(), name: a.name, desc: a.desc, client: a.client,
                    content: demoContent, contentHash: DB.hash(demoContent),
                    /* ★2026-11-04：没有装配清单就没有「加 2 列」这回事 —— 画布是空的。
                       摘要留空（表格里显示「—」），不许拿「共 0 块」凑一句。 */
                    summary: tgt ? '加 2 列（触发规则、责任人）' : '', at: at,
                    editor: (DB.editor ? DB.editor() : 'admin') } });
        }
      }
      /* 台账按版本号降序：syncOwner 用 stables[0].v 当"最新"，顺序错了最新版就会被读错 */
      arr.sort(function (x, y) { return y.v - x.v; });
      return arr;
    }
    var c = DB.compById(id);
    if (!c) return [];
    var cv = parseInt(String(c.ver || '').replace(/\D/g, ''), 10) || 0;
    /* 只有真正发过的（status ≠ 草稿）才种正式版；没发过就是"零快照"，
       不再用一个草稿行假装它有一版。 */
    /* ★2026-11-04：组件原来只种"当前这一版"，于是卡上写 v3、版本页写「共 1 个版本」——
       版本管理页连一条历史都没有，「恢复」永远点不出来。按当前版本号补齐 v1..vN-1：
       快照内容与当前版相同（演示里没造"每版差一点"），只把时间往前排，排出一个真实的历史。 */
    if (cv > 0 && c.status !== '未发布' && c.status !== '草稿') {
      var snapOf = function () { return { spec: c.spec || null, fields: (c.fields || []).slice(), desc: c.desc }; };
      for (var hv = 1; hv < cv; hv++) {
        /* 时间不许每版都印同一个「09:55:18」—— 那是明显的假数据。按版本号错开日期与时刻。 */
        arr.push({ v: hv, kind: 'stable', active: false,
          at: dayBefore(todayISO(), (cv - hv) * 3, 9 + ((hv * 5) % 8), (hv * 17) % 60), snap: snapOf() });
      }
      arr.push({ v: cv, kind: 'stable', active: c.status !== '已下架', at: todayISO(), snap: snapOf() });
    }
    return arr;
  }

  /* 应用的状态是**派生**的，不是另一个真源：草稿 / 已上架 / 已下架 全由台账算出来。
     这样"停用"就只是"没有任何版本 active"，不需要第三套状态机。 */
  function syncOwner(scope, id, list) {
    var stables = list.filter(function (r) { return r.kind === 'stable'; });
    var act = stables.filter(function (r) { return r.active; })[0] || null;
    var top = stables.length ? stables[0].v : 0;
    if (scope === 'app') {
      var a = DB.appById(id);
      if (!a) return;
      var st = act ? '已上架' : (stables.length ? '已下架' : '未发布');
      /* ★2026-11-01（体检 B02/B03 阻断）：原来这一行还顺手写 a.version = act ? act.v : top。
         那是"没有 active 就用最新存档版顶上"——结果**取消授权这个减法动作，反而把
         客户的版本号往上一版推**，授权页立刻画出「客户在用 v4」，跟"已取消"完全相反。
         同时它让 a.version 有两个写者（台账同步 + 授权动作），两个页面各读一个，互相打脸。
         现在钉死：**a.version 只由授权动作写**（authGrant / authUpgrade / authRevoke），
         台账同步只管状态，一个字节都不碰版本号。 */
      if (a.status !== st) {
        a.status = st;
        DB.save();
      }
      return;
    }
    var c = DB.compById(id);
    if (!c) return;
    c.ver = act ? 'v' + act.v : (top ? 'v' + top : (c.ver || 'v1'));
    DB.save();
  }

  DB.versOf = function (scope, id) {
    var raw = null;
    try { raw = localStorage.getItem(LEDGER_KEY(scope, id)); } catch (e) {}
    if (raw) {
      try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          var clean = normalize(arr);
          /* 去重结果写回：否则原始台账里同号两条会一直在，页面只是读时看不见 */
          try { localStorage.setItem(LEDGER_KEY(scope, id), JSON.stringify(clean)); } catch (e2) {}
          return clean;
        }
      } catch (e) {}
    }
    var seed = seedLedger(scope, id);
    if (!seed.length) return [];
    var list = normalize(seed);
    try { localStorage.setItem(LEDGER_KEY(scope, id), JSON.stringify(list)); } catch (e) {}
    syncOwner(scope, id, list);
    return list;
  };

  DB.versSet = function (scope, id, list) {
    var clean = normalize(list);
    try {
      localStorage.setItem(LEDGER_KEY(scope, id), JSON.stringify(clean));
    } catch (e) {
      /* 写不进去就是没保存：返回 null。调用方必须据此报失败，不许再写"已保存" */
      return null;
    }
    syncOwner(scope, id, clean);
    return clean;
  };

  /* 发布＝把草稿转成正式版并启用：草稿被消费掉，不留第二行；
     新版本号 = 现有正式版最大号 + 1（不许回收、不许跳号复用旧号）。 */
  DB.versPublish = function (scope, id, snap, at, forceV) {
    var list = DB.versOf(scope, id);
    var stables = list.filter(function (r) { return r.kind === 'stable'; });
    var next = parseInt(forceV, 10) ||
      (stables.length ? Math.max.apply(null, stables.map(function (r) { return r.v; })) + 1 : 1);
    /* 发号不许撞号：撞了就是调用方算错了，返回 null，不许造出两条同号快照 */
    if (list.some(function (r) { return r.kind === 'stable' && r.v === next; })) return null;
    list = list.filter(function (r) { return r.kind !== 'draft'; });
    /* 不可变：快照一旦落盘就与当前对象脱钩，后续改画布不会改到历史版 */
    var frozen = snap ? JSON.parse(JSON.stringify(snap)) : null;
    list.push({ v: next, kind: 'stable', active: true, at: at || todayISO(), snap: frozen });
    var saved = DB.versSet(scope, id, list);
    /* 快照把当前内容整包冻住了 —— 之前攒的改动都已入档，流水清零。
       不清的话，用户会看到"刚存完快照，未入档改动还是 5 条"。 */
    if (saved) DB.changesClear(scope, id);
    return saved ? next : null;
  };

  /* 只存档、不启用：2026-10-31 按 `00e-版本与授权模型.md` 拆出来的第二半。
     versPublish 把「存一版」和「让客户看到」合成了一步，实际业务里这是两件事：
     配置完只是产出一个新版本，客户看到的仍然是他被授权的那一版；
     要让客户看到，必须另外走一次升级（授权页 / 列表的「升级到 vN」）。
     active 原样保留 —— 谁当前生效，不因存了一版而改变。 */
  DB.versSave = function (scope, id, snap, at) {
    var before = DB.versActive(scope, id);
    var keepV = before ? before.v : 0;
    var list = DB.versOf(scope, id);
    var stables = list.filter(function (r) { return r.kind === 'stable'; });
    var next = stables.length ? Math.max.apply(null, stables.map(function (r) { return r.v; })) + 1 : 1;
    if (list.some(function (r) { return r.kind === 'stable' && r.v === next; })) return null;
    list = list.filter(function (r) { return r.kind !== 'draft'; });
    var frozen = snap ? JSON.parse(JSON.stringify(snap)) : null;
    list.push({ v: next, kind: 'stable', active: false, at: at || todayISO(), snap: frozen });
    var saved = DB.versSet(scope, id, list);
    if (saved) DB.changesClear(scope, id);
    /* 把"当前授权版本"钉回去：normalize/versSet 都不该动 active，
       但这里是模型的关键不变量，写一句断言式还原，宁可多写一行 */
    if (saved && keepV) DB.versActivate(scope, id, keepV);
    return saved ? next : null;
  };

  /* 启用某一版：整个数组一次写完（关旧 + 开新在同一次遍历里），
     所以任何一个时刻都不存在"两条 active"或"短暂全关"。 */
  DB.versActivate = function (scope, id, v) {
    var want = parseInt(v, 10);
    var list = DB.versOf(scope, id);
    /* 目标不存在就什么都不做：旧代码会把所有 active 置 false，等于静默下架 */
    if (!list.some(function (r) { return r.kind === 'stable' && r.v === want; })) return null;
    var hit = null;
    list.forEach(function (r) {
      if (r.kind === 'stable' && r.v === want) { r.active = true; hit = r; }
      else { r.active = false; }
    });
    var saved = DB.versSet(scope, id, list);
    return saved ? hit : null;
  };

  /* 停用＝所有版本都 active=false。它就是"没有启用版本"这件事本身，
     不是另一个叫「已下架」的状态。 */
  DB.versDeactivate = function (scope, id) {
    var list = DB.versOf(scope, id);
    list.forEach(function (r) { r.active = false; });
    return DB.versSet(scope, id, list);
  };
  /* 启用并应用快照：版本页的「启用此版本」和会话改动卡的「恢复此版」都走这一条，
     不许各写一遍"先激活、再还原内容"。
     应用侧只改应用自己的 content/comps，不动共用组件；组件侧才会改组件库。 */
  /* keepActive：只还原内容，不动「当前授权版本」。
     2026-10-31 加 —— 「离开配置页选不保存」要的是"我的编辑白做了"，
     不是"客户的界面也回退"，这两件事在 00e 里是分开的。 */
  DB.versApply = function (scope, id, v, keepActive) {
    var want = parseInt(v, 10);
    var list = DB.versOf(scope, id);
    var rec = list.filter(function (r) { return r.kind === 'stable' && r.v === want; })[0] || null;
    if (!rec) return null;
    /* 恢复也是一次改动：流水里要写成人话"恢复了 v3"，
       而不是由 diff 猜出一串"装上…卸下…改了…"。 */
    DB._label = '恢复了 v' + want + ' 的内容';
    if (scope === 'app') {
      var a = DB.appById(id);
      if (!a) return null;
      if (Array.isArray(rec.snap && rec.snap.comps)) {
        var ids = rec.snap.comps.filter(function (x) { return !!DB.compById(x); });
        a.comps.length = 0;
        ids.forEach(function (x) { a.comps.push(x); });
        /* 恢复历史版本**不回滚组件版本**（用户已定：组件版本是全局的，
           一个应用不能把全公司的修复退回去）。所以这里只把缺的键补成"与最新一致"，
           不把任何键改回旧值 —— 装配清单回来了，版本仍按现盘记。 */
        syncCompVer(a);
        recomputeRefs();
      }
      if (rec.snap) {
        if (rec.snap.name != null) a.name = rec.snap.name;
        if (rec.snap.desc != null) a.desc = rec.snap.desc;
        if (rec.snap.client != null) a.client = rec.snap.client;
        if (rec.snap.content && typeof rec.snap.content === 'object') {
          a.content = JSON.parse(JSON.stringify(rec.snap.content));
        }
      }
      DB.save();
    } else {
      var c = DB.compById(id);
      if (!c) return null;
      if (rec.snap) {
        if (rec.snap.name != null) c.name = rec.snap.name;
        if (rec.snap.spec !== undefined) c.spec = rec.snap.spec;
        if (Array.isArray(rec.snap.fields)) c.fields = rec.snap.fields.slice();
        if (rec.snap.desc != null) c.desc = rec.snap.desc;
      }
      DB.save();
    }
    if (keepActive) return rec;
    return DB.versActivate(scope, id, want);
  };

  /* 下一个正式版号（只读）。版本页要在确认框里说"将生成 V4"，
     必须与 versPublish 用同一条发号规则，不能在页面里另算一次。 */
  DB.versNext = function (scope, id) {
    var st = DB.versOf(scope, id).filter(function (r) { return r.kind === 'stable'; });
    return (st.length ? Math.max.apply(null, st.map(function (r) { return r.v; })) : 0) + 1;
  };

  /* ── 前向恢复：恢复旧版 = 生成新版本，不倒退指针（2026-11-04）────────
     用户口径：V3 出故障时点 V2 的「恢复」，不是把 active 拨回 V2，
     而是把 V2 的全量快照复制成 V4 并上线；V3 原样留在历史里。
     这样客户看到的版本号、审计时间线永远向前，也不会出现"V2 又变成当前版"
     让授权页的 v2/v3 记录全部对不上。

     ★2026-11-04：客户授权版本不动（用户已拍板）。应用侧只把 active 指到 V4；
     客户仍 pin 在自己的授权版本，要客户看到 V4 还得去授权页升级。
     组件侧同理：只把组件最新版推到 V4，已装配应用在引用管理里升级。 */
  DB.versRestoreForward = function (scope, id, v) {
    var want = parseInt(v, 10);
    var rec = DB.versOf(scope, id).filter(function (r) {
      return r.kind === 'stable' && r.v === want;
    })[0] || null;
    if (!rec) return { error: 'gone' };
    if (!rec.snap) return { error: 'no-snap' };
    var snap = JSON.parse(JSON.stringify(rec.snap));
    var at = todayISO();
    snap.restoredFrom = want;
    snap.summary = '基于 v' + want + ' 恢复生成';
    snap.at = at;
    snap.editor = DB.editor();
    var to = DB.versPublish(scope, id, snap, at);
    if (!to) return { error: 'write' };

    /* 版本台账已经指向新号，当前对象也必须换成这一版的快照内容。
       顺序不能反：先发新号再落内容，写盘失败时至少不会出现"内容变了、版本没变"。 */
    if (scope === 'app') {
      var a = DB.appById(id);
      if (!a) return { error: 'gone', to: to };
      if (Array.isArray(snap.comps)) {
        var ids = snap.comps.filter(function (x) { return !!DB.compById(x); });
        a.comps.length = 0;
        ids.forEach(function (x) { a.comps.push(x); });
        syncCompVer(a);
        recomputeRefs();
      }
      if (snap.name != null) a.name = snap.name;
      if (snap.desc != null) a.desc = snap.desc;
      if (snap.client != null) a.client = snap.client;
      if (snap.content && typeof snap.content === 'object') {
        a.content = JSON.parse(JSON.stringify(snap.content));
      }
      a.updated = DB.now();
    } else {
      var c = DB.compById(id);
      if (!c) return { error: 'gone', to: to };
      if (snap.name != null) c.name = snap.name;
      if (snap.spec !== undefined) c.spec = snap.spec;
      if (Array.isArray(snap.fields)) c.fields = snap.fields.slice();
      if (snap.desc != null) c.desc = snap.desc;
      c.status = '已上架';
      c.enabled = true;
      c.ver = 'v' + to;
      c.updated = DB.now();
    }
    if (DB.save() === false) return { error: 'write', to: to };
    return { from: want, to: to };
  };


  /* ── 最后编辑人（2026-11-01）────────────────────────────────────
     用户原话：「什么叫保存人，最后编辑人不行吗」——对，就叫最后编辑人。
     这一版产品还没有登录态（本地原型），所以取值顺序写死两条：
       ① localStorage 里显式设过 ifas90:editor 就听它；
       ② 否则返回页面右上角显示的那个账号（admin），**不许两处不一样**。 */
  DB.EDITOR_KEY = 'ifas90:editor';
  DB.editor = function () {
    try { var v = localStorage.getItem(DB.EDITOR_KEY); if (v) return String(v); } catch (e) {}
    return 'admin';
  };

  DB.versActive = function (scope, id) {
    return DB.versOf(scope, id).filter(function (r) { return r.kind === 'stable' && r.active; })[0] || null;
  };

  /* 老的读写口子保留，内部换成台账 —— 别处还在用它们，不能留两套实现 */
  DB.appVer = function (id) {
    var act = DB.versActive('app', id);
    return act ? act.v : 0;
  };


  /* 组件版本走同一个台账（2026-10-26 起不再有自己的存储键）。
     用户口径：「应用管理的版本控制逻辑基本上也是这样的，无非字段和归属有差别」——
     所以这里只留转发，不许再写一套 normalize。 */
  DB.compVers = function (id) { return DB.versOf('comp', id); };
  DB.pushCompVer = function (id, v, snap) {
    var n = parseInt(String(v || '').replace(/\D/g, ''), 10);
    return DB.versPublish('comp', id, snap || null, null, n || null);
  };

  window.DB = DB;})();
