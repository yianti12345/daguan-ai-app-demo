/* judgments.mjs —— 判据台账（唯一一份）。新增/删除判据必须同时改这里。
 *
 * 为什么要有它：这一轮最贵的一课不是"漏了哪个功能"，是**判据自己没人验**。
 * 实际发生过的：
 *   · L5 一直找 `.toast`，而 toast 已被 `#hint` 取代 ⇒ 找不到就跳过 ⇒ 恒绿；
 *   · R2 的验证样本改的是别名数组，存进去还是满的 ⇒ 量到的是正常页面 ⇒ 恒绿；
 *   · check-preview 偷偷连 8977，门禁跑在 8941 ⇒ 判绿的是另一份代码。
 * 三次的共同点：判据的**对象消失了或换了地方，判据不报错，只安静地变绿**。
 *
 * 所以每条判据在这里必须写清三件事：
 *   subject —— 它到底量的是界面上哪个东西（能被查在不在）
 *   negctl  —— 它能不能被证明会红（不能证就是失效）
 *   tool    —— 哪个脚本在判
 * `check-judgments.mjs` 会把这三件事逐条跑一遍：主体命中 0 条 ⇒ 判红；负控跑不出 rc=2 ⇒ 判红。
 * 这就是"判据的判据"。
 *
 * ★ 2026-10-23 追加一条口径（米拉-2 提出，实测有效）：
 *   凡是量「只在特定条件下才出现的容器」的判据（菜单、弹层、配置器条…），
 *   subject 必须写成「先造出它，再量它」，并在 about 里注明造它的动作。
 *   否则主体命中 0 条时 check-judgments 只红一次，然后有人把那个选择器删掉，
 *   这条就永远绿了 —— 和 L5 找 `.toast`（已被 `#hint` 取代）是同一个死法。
 */
export const CRITERIA = [
  /* ── 卡面文案溯源（2026-10-24 新增，第 26 项；起因是用户 m04062）──
     门禁全绿的同时，两份卡片上长出了「页面类 / 字段 5 项 / 装配 5 个应用 / 图标砖」
     这些没有产品背书的东西 —— 令牌、对比度、像素、描边、词表没有一条问得出
     "这个字在这套产品里存在吗"。这条判据就只干这一件事：卡面写死的中文必须逐条
     对得上白名单（= data.js 字段或用户原话），对不上就红。
     negctl 用 flag 注入「字段 5 项」，证明它会红。
     ★2026-10-25 组件库从「4 列卡片阵列」整段换成「单列行式列表」后，"卡面"的落点变了：
       components.html 的卡＝一行 <div class="crow">（模板变量 rowHtml），外加本次结构变化
       才出现的一行表头 .cl-head。断言一条没删，只把 subject 换成新骨架上的真实落点。 */
  { id: 'DEADEND', tool: 'check-no-dead-end.mjs', negctl: 'flag',
    about: '页面上不许有没有出口的入口与状态：D1 每个菜单项（<button class="k-mi"> 到它的 </button>）必须带 data-act；D2 文案不许把动作挂在站外角色上（需/等/待＋客户/甲方/第三方/上级/领导/管理员＋确认/审批/签字/同意）。--negctl 注入一条 aria-disabled 的死菜单项必须 rc=2',
    /* ★2026-10-30：应用卡「需客户确认 v3」＋灰掉的「需客户确认后才能升级」被走查判 P0 后仍然过夜，
       第二天用户在原处又撞到一次。40+ 条判据全绿却没人问过"这个菜单项点下去有没有动作"、
       "这个状态是不是挂在一个不会出现的人身上" —— 所以单开一条，只判这两件事。 */
    subject: [{ page: 'apps.html', sel: '.kcard' }, { page: 'components.html', sel: '.crow' }] },
  { id: 'APPINV', tool: 'check-app-invariants.mjs', negctl: 'inject',
    about: '对象级状态不变量：底层 status 只能投影成三态（未上架/内测中/已上架）、历史值「未发布/已下架」必须落「未上架」、筛选器只给三态与筛选逻辑一致；--negctl 注入一条非法投影必须 rc=2',
    /* ★2026-11-04 登记：脚本 2026-11-03 就写了、还补过 amendment，但既没进 run-gates 也没进台账，
       gatecover 判红才把它揪出来。现在已接进 run-gates 的 browser 档（appinv 组），这里补台账。 */
    subject: [{ page: 'apps.html', sel: '.kcard' }] },
  /* ★2026-11-04（一轮被连骂五次之后登记的）：装配/升级这一处的"唯一落点"契约。
     升级只能住「装配面板 · 已装配页签」，不许回顶栏、不许串到可装配页签、不许自动弹抽屉；
     界面文案禁用内部状态词（需手动 / 已自定义 / 已单独改过 / 当前可装配的版本 …）。
     negctl 把每条断言的坏样本喂给同一批检测函数，任何一条没判红即 rc=2。 */
  { id: 'PANELIA', tool: 'check-panel-ia.mjs', negctl: 'flag',
    about: '装配/升级信息架构：IA1 顶栏无独立升级按钮 ｜ IA2 工具行无重复计数（已选 N 与 装配（N））｜ IA3 带参进页面不自动开抽屉 ｜ IA4 已装配页签挂可升级角标 ｜ IA5 全部升级只在已装配页签 ｜ IA6 七页与 assets/*.js 无内部状态词 ｜ IA7 顶栏次要按钮描边；--negctl 坏样本必须 rc=2',
    /* ★2026-11-04 删掉 subject：PANELIA 是纯静态判据（扫 app.html 与 assets/*.js 的源码串），
       不做浏览器渲染，采样点对它没有意义。原登记 #act-assemble / #tab-upd-chip 两个只在
       "选中某个应用"之后才存在的锚点，check-judgments 在无参 app.html 上量 ⇒ 命中 0 ⇒ 每天一次假红。
       锚点真没了，PANELIA 自己会红（IA1/IA4 就是查这两处）。 */
  },
  /* ★2026-11-04（用户：「这些问题、整改的思路、优化的方向，都可以抽象成为通用的逻辑，根治掉」）：
     12 条界面通用逻辑写在 `_docs/界面通用逻辑-20261104.md`，但文档本身不是闸 ——
     写完就走、下次照犯。这条把「规范句」与「判据」之间的契约变成可机器核对的一行：
     每个 L# 在台账里恰好一行；写的判据键必须真的登记过（写个不存在的键＝假装覆盖）；
     无判据 / 射程承认判不到的行，必须写谁判 + 到期日且未过期；无判据条数按基线只许减。
     它判不到「判据本身测得对不对」（PRED/NEGCTL 管）和「兜底判定人有没有真判」（四席读数管）。 */
  { id: 'LOGICWIRE', tool: 'check-logic-wiring.mjs', negctl: 'flag',
    about: '规范↔判据接线：_docs/界面通用逻辑-*.md 每个 L# 在「判据接线台账」恰好一行；引用未登记的判据键即红（假装覆盖）；无判据行必须写兜底判定人 + 未到期；射程承认「判不到」同样要有人接；无判据条数按 tools/logic-wiring-baseline.json 只许减。--selftest 7 例 ｜ --negctl 四类坏样本必须 rc=2 且正控必须绿' },
  { id: 'CARDCOPY', tool: 'check-card-copy.mjs', negctl: 'flag',
    about: '两页写死的中文逐段溯源（apps 的 .kcard 卡模板 ＋ components 换形后的「一行」模板 rowHtml 与表头 .cl-head）：未登记 0 条才绿；--negctl 往 components.html 注入「装配 5 个应用」必须 rc=1',
    /* ★2026-10-27 修（选择器过期，与今天其余四条同族）：组件库从「单列行式列表」改成卡片之后，
       原来的 .cl-head（表头已删）、.cl-refs .cl-names（现为 .cc-meta）、.cl-st .card-tag（现为 .cc-sw）
       三个落点在页面上**已不存在**，于是 CARDCOPY 报「命中 0」—— 不是卡面有问题，是取样点错位。
       断言一条没删，只把 subject 换成卡片上的真实落点；表头那一条直接去掉（表头这个东西没了）。 */
    subject: [{ page: 'apps.html', sel: '.kcard' },
              { page: 'components.html', sel: '.crow .cl-tt' },
              { page: 'components.html', sel: '.crow .cl-desc' },
              /* ★2026-11-04 选择器过期：`.cc-meta` 在渲染后的卡上已不存在（真机 .cc-meta=0，.cl-desc=8）。 */
              { page: 'components.html', sel: '.crow .cl-desc' },
              { page: 'components.html', sel: '.crow .cc-sw' },
              { page: 'components.html', sel: '.crow .cl-ops .k-mi' }] },

  /* ── 卡面信息契约（2026-10-24 新增，第 27 项；起因是用户 m04536 那句
        「是不是在写代码、写样式的时候就缺少准备」）──
      CARDCOPY 只管**文案**，管不住"卡片模板读了哪个字段"：`c.fields` 这类字段访问
      不在卡面留下一句可搜索的中文，白名单天然看不见它。这条判据把"这页的卡片
      允许出现哪些字段"写成契约（tools/content-contract.json），双向校验：
        · 契约里的字段名必须在 assets/data.js 里真实存在（否则＝我编字段）
        · 页面脚本访问的字段必须在 allowed、且不得命中 forbidden
        · required 字段必须被读到或被 derived 函数现算（如 DB.appVer）
      negctl 用 flag 注入 `a.fields` / `c.fields`，证明它会红。
      ★2026-10-25：components.html 的"卡"换成一行 .crow，契约里的 required（name/desc/status/
        refs/ver）现在落在行的 .cl-tt/.cl-desc/.cl-st/.cl-refs/.cl-ver 上；contract 的 notes
        已同轮复核（refs 走 DB.APPS.filter 现算）。subject 跟着换成行的落点。 */
  { id: 'CONTENTCONTRACT', tool: 'check-content-contract.mjs', negctl: 'flag',
    about: '卡面字段契约（components.html 的"卡"已换成一行 .crow）：契约字段必须在 data.js 存在、页面访问不得命中 forbidden、required 必须落地（refs 走 DB.APPS.filter 现算）；--negctl 注入 a.fields / c.fields 必须 rc=1',
    subject: [{ page: 'apps.html', sel: '.kcard' },
              { page: 'components.html', sel: '.crow' },
              /* ★2026-10-27：.cl-refs → .cc-meta（卡片的元信息行，refs 就写在这里）；
                 .cl-ver 直接去掉 —— 版本号按用户口径「版本不在卡上」，卡上没有这个落点是**对的**，
                 判据不该要求它存在。
                 ★2026-11-04：`.cc-meta` 这行在渲染后的卡上已不存在（真机 .cc-meta=0、.cl-desc=8），
                 取样点改成 `.cl-desc`（卡片描述行，卡面正文；缺了照样判红）。 */
              { page: 'components.html', sel: '.cl-desc' }] },

  /* ── 与真源的逐角色对齐（2026-10-22 新增，第 14 项）──
     性质和其他 13 条不同：上面量"我的规范有没有被执行"，这条量"我的规范本身像不像线上"。
     基准来自真源，不来自我 —— 这是这一轮最贵的教训。 */
  { id: 'REF', tool: 'ref-parity.mjs', negctl: 'flag',
    about: '15 组角色（侧栏/菜单三级态/面包屑/主按钮/图标钮/输入框/卡片四件/角标）与真源逐项对齐',
    subject: [{ page: 'apps.html', sel: '.sider .gt' }, { page: 'apps.html', sel: '.kcard' }, { page: 'apps.html', sel: '.icon-btn' }] },

  /* ── 真源样本冻结（第 17 项）──
     补的是 REF 的失效形态：REF 连不上真源就 SKIP，而 SKIP 在长时段里
     和绿长得一样。现在"没量"本身有一条判据看着它。
     ⚠ 它不验"我像不像线上"，只验"用来判像不像的那份基准还在不在、过没过期"。
     两件事分开，谁红了就查谁。 */
  { id: 'REF-SNAP', tool: 'ref-snapshot.mjs', negctl: 'flag',
    about: '样本每条带出处；at 超 30 天 / 缺 source / 角色集合与 ref-parity 不一致 / 选择器漂移 ⇒ 红',
    subject: [{ page: 'apps.html', sel: '.sider' }, { page: 'apps.html', sel: '.grid > *' }] },

  /* ── 资源完整性（第 18 项）──
     补的是"引用写在字符串里"。assets/app-cover.png 是在内联脚本里拼 HTML 用的，
     只看 .html 的 src/href 永远看不见它；真 404 时它静默变成一个灰块。
     subject 取 .kcard：卡壳 2026-10-24 由 .card 改名 .kcard 后仍必须命中，
     check-judgments 会先红 —— 这一条防止它退化成"扫不到就算过"。 */
  { id: 'AST', tool: 'asset-integrity.mjs', negctl: 'flag',
    about: '4 页 + assets 全部 css/js 里的本地资源引用：存在 / 非空 / ?v=等于内容哈希 / 无未登记外链',
    subject: [{ page: 'apps.html', sel: '.kcard' }, { page: 'components.html', sel: 'link[rel=stylesheet]' }] },

  /* ── 取值 / 对比度 / 同构 / 骨架 ──
     ★2026-10-25 组件页骨架＝`#grid > .cl-head + 8 × .crow`（原 4 列 .kcard 阵列已撤）：
       gate-tokens 量的是 body 全量元素的 computed 值，行/表头自动覆盖；
       这里只把"骨架在不在"的锚点从 #grid .kcard 换成 #grid 的行与表头。 */
  { id: 'J1-J3,J6', tool: 'gate-tokens.mjs', negctl: 'flag',
    about: '颜色字号圆角只取自 token；对比度过 AA；两页同构；骨架未破坏（组件页骨架＝#grid > .cl-head + 8 行 .crow）',
    subject: [{ page: 'components.html', sel: 'body' },
              /* ★2026-10-27：表头 .cl-head 已随卡片化删除，取样点换成卡片本身。 */
              { page: 'components.html', sel: '#grid .crow' },
              { page: 'components.html', sel: '#grid .crow' }] },

  /* ★2026-10-25：J4 量的是本页正文的词表；组件页正文的落点从卡说明 .card-desc
     换成了行说明 .cl-desc ＋ 新增的表头 .cl-head。 */
  { id: 'J4', tool: 'gate-copy.mjs', negctl: 'flag',
    about: '本页正文不出现本页禁用词（组件页正文＝#grid 的表头 .cl-head ＋ 8 行 .crow，行说明在 .cl-desc）',
    subject: [{ page: 'components.html', sel: '#grid .crow' },
              { page: 'components.html', sel: '#grid .crow .cl-desc' }] },

  { id: 'J5', tool: 'gate-states.mjs', negctl: 'flag',
    about: '状态矩阵里标 ✓ 的态在 CSS 里都有规则',
    subject: [{ page: 'component.html', sel: '.fk-bar' }] },

  { id: 'J7', tool: 'gate-links.mjs', negctl: 'flag',
    about: '资源存在 / 无孤立页 / 侧栏定位 / 无假链接 / 行可键盘（L5 播报区已于 2026-10-29 按用户裁决停用，见裁决台账 R-122）',
    subject: [{ page: 'components.html', sel: '.sider' }, { page: 'components.html', sel: '.sider a' }] },

  /* ── 画布骨架 ── */
  { id: 'P1', tool: 'check-preview.mjs', negctl: 'flag',
    about: '首屏有默认样 / 说一句后确实变了 / 失败不白屏 / 无 JS 异常',
    subject: [{ page: 'component.html', sel: '#canvas' }, { page: 'component.html', sel: '#fk-input' }] },

  /* ── 生成页面的版式契约（2026-10-23 新增）──
     它补的是"样式数值全对、看起来不对"那一格：
       · 块标题里带方位词（「抽取字段对照（右侧）」）——布局指令被当文案念；
       · 同一页块间距 12 / 18 并存（两条 CSS 特异性相同）——就是用户说的"零散样式"；
       · 用户说左右，渲染成上下——方位词剥掉了，并排却没发生。
     口径：**先造出页面再量**。它自己注入三套 spec 调 Gen.renderComponent，
     所以主体取注入的落点 #canvas-inner（渲染前就存在），不取 .bd-group（渲染后才有）。 */
  { id: 'L1-L3', tool: 'check-layout.mjs', negctl: 'flag',
    about: '造页后量：标题无方位词 / 顶层块间距唯一 / 并排两栏等宽（各带独立负控）',
    subject: [{ page: 'component.html', sel: '#canvas-inner' }, { page: 'component.html', sel: '#fk-input' }] },

  /* ── 容器描边（2026-10-23 新增）──
     补的是「审美原则只在文档里、没人执行」这一格。用户原话：
     「你觉得我喜欢边框线条吗？现在好看的审美一般都不带边框了」。
     判据形态是**容器名单断言**（14 个容器类不许有 border…solid），
     不做全量扫描 —— 表格行分隔、输入框、行内小控件的线是功能性的，去掉就读不成行。 */
  { id: 'NB', tool: 'check-noborder.mjs', negctl: 'flag',
    about: '14 个容器类（卡片/块/面板/浮层/胶囊）不许用 1px 描边表达边界',
    /* ★2026-11-04 选择器过期：组件配置页的空态从 `.seed`（示例卡）改成 `.cv-empty`（一句话空态）
       —— 用户 2026-10-28 定调「空态不要示例句、不要模板」。真机实测 .seed=0 / .cv-empty=1。 */
    subject: [{ page: 'component.html', sel: '.cv-empty' }, { page: 'apps.html', sel: '.kcard' }] },

  /* ── 界面是不是实的 ── */
  { id: 'R1', tool: 'check-solid.mjs', negctl: 'flag',
    about: '可见文本里没有讲给自己的话（默认样例 / 全部混在 / 画布 / 原型）',
    subject: [{ page: 'components.html', sel: '#grid' }, { page: 'app.html?id=hx-zc', sel: '#canvas' }] },

  { id: 'R2', tool: 'check-solid.mjs', negctl: 'flag',
    about: '零装配 / 只剩应用头 都不是白板，有说明与出口',
    subject: [{ page: 'app.html?id=gf-xm', sel: '#canvas .cv-empty' },
              /* ★2026-11-04 选择器过期：画布块的真实类是 `section.cv-blk`（assets/app.js:852），
                 历史台账写的 `.blk` 在页面上从来不存在；且种子已改「从零演示」，hx-zc 进来就是空态 ⇒ 取样点应是 .cv-empty。 */
              /* 取样点用 `#canvas`（画布永远在，空态/有内容两种世界都成立）；
                 「零装配不是白板」的语义断言在 check-solid.mjs 里，不靠取样点表达。 */
              { page: 'app.html?id=hx-zc', sel: '#canvas' }] },

  { id: 'R3', tool: 'check-solid.mjs', negctl: 'flag',
    about: '组件清单只有一份真源（components.html 不许自带 refs 字面量）',
    subject: [{ file: 'components.html', sel: 'DB.COMPS' }] },

  /* ── 2026-10-23 新增的三件：状态清单 / 状态体检 / 批量截图 ──
     为什么必须登记：check-judgments 会扫 tools/*.mjs，**不在台账里的脚本会被判"无主的判据"**——
     那正是"有人以为有覆盖，其实没有"的反面：有覆盖，但没人知道它在守什么。 */
  /* ★2026-10-30：negctl 原来是 null —— 运行器只跳过 'none'，null 会被当成"应该能红"去跑
     `states.mjs --negctl`，而它是个纯数据模块（没有 CLI），恒 rc=0 ⇒ Q1 永久假红。
     这条一直躲在"前一条失败就停"后面；把台账补全后才露出来。 */
  { id: 'ST1', tool: 'states.mjs', negctl: 'none',
    about: '全站真实可达状态的唯一清单（从 data.js 抽 id，不手抄）—— 页面清单没有「状态」这一维时，判据守的是空态页',
    subject: [{ page: 'apps.html', sel: 'body' }] },

  { id: 'AS1', tool: 'audit-states.mjs', negctl: null,
    about: '全量状态体检：空画布 / 死白 / 截断 / 横向溢出 / 同屏重复标题 / 内部用语 / 无层次',
    subject: [{ page: 'app.html?id=hx-zc', sel: 'main' }] },

  { id: 'SH1', tool: 'shot.mjs', negctl: null,
    about: '批量截图器（复用同一个浏览器）：给人工复核用，不是判据——它只产出图，不下结论',
    subject: [{ page: 'apps.html', sel: 'body' }] },

  { id: 'R4', tool: 'check-solid.mjs', negctl: 'flag',
    about: '装配面板：可装配不混已下架、计数 = 行数',
    subject: [{ page: 'app.html?id=hx-zc', sel: '#act-assemble' }] },

  { id: 'R6', tool: 'check-solid.mjs', negctl: 'flag',
    about: '创建组件是表单：名称 / 启用禁用 / 介绍三样，名称必填，提交即入未发布',
    subject: [{ page: 'components.html', sel: '#btn-new' }] },

  { id: 'R7', tool: 'check-solid.mjs', negctl: 'flag',
    about: '对话历史能收起也能再展开（双向），且收起不影响输入条高度',
    subject: [{ page: 'component.html', sel: '.fk-bar' }] },

  { id: 'R8', tool: 'check-solid.mjs', negctl: 'flag',
    about: '装配组件是独立胶囊：不在对话条里、不在操作组里，组件页没有它',
    subject: [{ page: 'app.html?id=hx-zc', sel: '#act-assemble' }] },

  /* ── 同屏数字自洽（2026-10-23 新增）──
     补的是"每个数各自都有出处、放在一起全错"这一格：状态条「审核中 · 7 条」/ 表格 4 行 /
     徽标「装配组件 3」/ 画布 2 块 —— 26 条判据全绿，一条都没拦。
     前 26 条量的是取值、几何、同类一致性；没有一条量**两个数字能不能互相解释**。
     ⚠ 第二个 subject 取 gtja-zc 的 .note，因为 .note 只在双栏应用上输出（hx-zc 是单栏，
       那里永远命中 0）。不写这一条，③ 就成了"主体不存在也没人报"的死码。 */
  { id: 'R9', tool: 'check-solid.mjs', negctl: 'flag',
    about: '同屏数字自洽：徽标 = 真实装配数（DB.APP_COMPS）/ 状态条 = 画布第一个表格行数 / .note 各段之和 = 总数；任一条对不上 ⇒ 红',
    subject: [{ page: 'app.html?id=hx-zc', sel: '#canvas .status b' },
              { page: 'app.html?id=hx-zc', sel: '#act-count' },
              { page: 'app.html?id=gtja-zc', sel: '#canvas .status .note' }] },

  /* ── 拖动 / 刷新保留 ── */
  { id: 'D1-D5', tool: 'check-drag.mjs', negctl: 'flag',
    about: '三条悬浮件拖得动、刷新还在；按按钮不许拖（D5 是内建负控）',
    subject: [{ page: 'component.html', sel: '.fk-bar .fk-grip' },
              { page: 'app.html?id=hx-zc', sel: '.fk-bar .fk-grip' },
              { page: 'components.html', sel: '.xz-fab' }] },

  /* ── 同类一致性 ── */
  { id: 'C1-C4,C7', tool: 'check-consistency.mjs', negctl: 'flag',
    about: '无历史栏 / 顶栏无重复状态 / 两条悬浮条都可拖且同形态 / 圆角不出档',
    subject: [{ page: 'component.html', sel: '.fk-bar' }, { page: 'app.html?id=hx-zc', sel: '.fk-bar' }] },

  /* ── 令牌映射完整性 ── */
  { id: 'T1', tool: 'token-audit.mjs', negctl: 'flag',
    about: '引用的 token 都定义了 / 没有近白文字色 / 圆角无出档裸值；并列出死 token 与同值多 token',
    subject: [{ file: 'assets/tokens.css', sel: '--bg' }, { file: 'assets/sys.css', sel: 'var(--' }] },

  /* ── 资源版本号 ── */
  { id: 'S1', tool: 'stamp.mjs', negctl: 'flag',
    about: 'HTML 里的 ?v= 等于资源内容哈希（防缓存混版）',
    subject: [{ file: 'index-of-assets', sel: 'assets/tokens.css' }] },

  /* ── 视觉回归（第 19 项）──
     判的是"我的今天有没有变"，不是"我像不像真源"。基线冻结在 tools/px-baseline/。
     阈值 0.032 来自标定（同页连截两次 0.0000 / 整体右移 20px 0.0639 取中），不是拍数。
     ⚠ 已知弱点：内容稀疏的页对位移不敏感（component.html 实测 0.0285 < 0.032），
       这一条要靠"内容区归一化"补，不是靠放宽阈值。放宽等于把判据调成恒绿。 */
  { id: 'PX', tool: 'px-parity.mjs', negctl: 'flag',
    about: '四页视觉回归：ratioFull>0.032 ∨ rowCover>0.05 ∨ colCover>T ∨ maxTile>T ⇒ 红；基线超 60 天 ⇒ 红。四把尺子互补（面积/水平位移/垂直位移/小面积替换），没有一把能单独覆盖全部',
    subject: [{ file: 'tools/px-baseline/index.json', sel: 'apps.html' }] },

  /* ── 按点击探哑控件（第 20 项）──
     about 必须是"按点击探没有哑控件"，不许写成"界面没有哑控件"：
     0 只覆盖 click 一种动作，hover 才出现的控件至今无人覆盖。
     ★2026-10-25：组件页的可点面已从 4 列卡换成行列表 —— 每行有「配置」链、⋮、三项菜单项。
       interact-audit 扫的是全页可交互元素，主体写成行与行内 ⋮，别写回已消失的 #grid .kcard。 */
  { id: 'IA', tool: 'interact-audit.mjs', negctl: 'flag',
    about: '按点击探没有哑控件（300ms 内 DOM/hash/焦点三路都不动即判哑）；组件页扫的是行列表里每行的「配置」链/⋮/菜单项；allow 里的 coveredBy 必须指向真实存在的判据文件',
    subject: [{ page: 'components.html', sel: '#grid .crow' },
              { page: 'components.html', sel: '#grid .crow .cl-ops .k-more' },
              { page: 'app.html?id=hx-zc', sel: '.fk-bar button' }] },

  /* ── 像素自证（第 21 项）──
     判"computed 有没有说谎"，不判"像不像真源"。能抓的事故形状：
     .ant-layout-sider 的 computed 底色报深蓝、像素实为浅灰 —— 所有 CSS 判据全绿。
     单独成文件，是因为 check-judgments 的负控按工具去重：一个文件里两个模式，
     只有一支能被验到负控，另一支就成了没人验的恒绿。
     覆盖角色数随 ref-parity 的 ROLES 里带 bg 的行数变化，工具自己会打出来。 */
  { id: 'PXC', tool: 'px-refcolors.mjs', negctl: 'flag',
    about: '每个带底色的角色：computed backgroundColor 与截图像素众数色必须一致；不一致 ⇒ 红',
    subject: [{ page: 'apps.html', sel: '.sider' }, { page: 'apps.html', sel: '.kcard' }] },

  /* ── 2026-10-23 补登记：这三个一直没进台账 ──
     原因很蠢但值得记：check-judgments 的"台账齐不齐"是按文件名前缀 `gate-`/`check-`
     筛的，而 walk / hit-audit / doc-parity 三个都不带前缀 ⇒ **从来没被点名过**。
     也就是"判据齐不齐"这条判据自己按名字认人，漏掉了三个真判据。
     已把筛选改成"tools/ 下所有 .mjs，不在 EXEMPT 里就必须在台账里"。 */
  /* ★2026-10-25：walk 逐页穷举可点元素，组件页的点面换成行列表 ——
     主体写 #grid .crow 与行内「配置」链（a.cl-ops .kbtn），与 IA 同口径。 */
  { id: 'W1', tool: 'walk.mjs', negctl: 'flag',
    about: '穷举走查：所有可点元素逐个点，找死控件与未定义样式（组件页的点面＝行列表：每行「配置」链 ＋ ⋮ ＋ 菜单项）',
    subject: [{ page: 'components.html', sel: '#grid .crow' },
              { page: 'components.html', sel: '#grid .crow .cl-ops .k-more' },   /* ★2026-11-04 .kbtn 已不存在：行内动作钮真实类是 .k-more（真机 8 个） */
              { page: 'apps.html', sel: '.sider a' }] },

  { id: 'H1', tool: 'hit-audit.mjs', negctl: 'flag',
    about: '不可见但仍吃点击的浮层（elementFromPoint 逐个可交互元素中心点验命中）',
    subject: [{ page: 'app.html?id=hx-zc', sel: '.fk-bar' }, { page: 'app.html?id=hx-zc', sel: '.xz-fab' }] },

  { id: 'D2', tool: 'doc-parity.mjs', negctl: 'flag',
    about: '规范文档里声明的值 vs 代码里的值，逐条对账（文档自己也要被验）',
    subject: [{ file: 'DESIGN.md', sel: '判据' }] },

  /* ══ 2026-10-24 新增七条：交付链上「没有实体的环节」（起因：用户 m04973）══
     客户的判断是「链条里每一环都该有专家、有工具、有判据」。当时缺的正是
     需求/语言/语义/评审这四环的实体件 —— 结果卡面上长出了没有出处的名词。
     这七条判据就是那四环的机器形态，缺一条那一环就退回「靠我即兴」。 */
  { id: 'TERM', tool: 'check-terminology.mjs', negctl: 'flag',
    about: '界面文案的术语一致性 + 台账双向一致：同义词（模块/插件/区块/挂载/引入/装载/在用/停用/暂停/已装配/草稿/下线/上线/投递/快照/批次/发布号）不许上屏；00c 的 §一 行数/正名/禁用词/允许上下文与 TERMS 逐项相等，§四 逐词裁决不许与机器表相反；只查人读得到的字（title/innerText/placeholder/aria-label/title/option/th）',
    subject: [{ page: 'apps.html', sel: 'body' }, { page: 'components.html', sel: 'body' }] },

  /* 2026-10-28 补（盲审条件 1）：这条闸 10-27 上线当天就在跑，但**没进判据台账**，
     于是"每个判据脚本都在台账里"这一条自己看不到它 —— 和它没进 run-gates.sh 是同一个病：
     判据存在、没人执行、账面上看不出来。
     ★2026-10-28 同轮再修（盲审条件 6）：判据自己也在扫描面里，--selftest 的模板被当成一条引文
       （抽到 23 条里有 1 条是自指），已把自己剔出扫描面并另报"几条取不出针、不判"。 */
  { id: 'QUOTE', tool: 'check-quote-provenance.mjs', negctl: 'flag',
    about: '声明式引文（用户原话／用户口径／用户要求／他说）后面引的那句话，必须在真实会话转写里逐字找到；读数分列「可核 N 条 / 取不出 12 字针 M 条（不判）」；--negctl 注入一条没人说过的引文必须 rc=2，--negctl-self 证明判据不扫自己',
    /* ★2026-10-29：DESIGN.md v3 改写成取值契约后，全文已无「用户原话」标记（实测 0 条），
       旧 subject 会让 Q1 把"对象没了"判红。判据本身仍扫根目录 *.md，保留术语件这一条主体。 */
    subject: [{ file: 'tools/check-terminology.mjs', sel: '用户原话' }] },

  { id: 'PRED', tool: 'check-predicate.mjs', negctl: 'flag',
    about: '装配资格谓词唯一：全仓只许一处 DB.canInstall（status=已上架 且 enabled!==false），页面不得再写 inline 谓词',
    subject: [{ file: 'assets/data.js', sel: 'canInstall' }] },

  { id: 'M3GAPS', tool: 'check-m3-gaps.mjs', negctl: 'flag',
    about: 'M3 三格最小判据：6 链接文字必须自带对象名（裸动词/无 aria-label 的图标链判红）／7 列表页要有批量入口且卡上有就地动作／10 空装配必须就地写下一步；负控三格各注入一处必须 rc=2',
    subject: [{ file: 'assets/app.js', sel: 'cv-empty' }] },

  { id: 'PUBEMPTY', tool: 'check-publish-empty.mjs', negctl: 'flag',
    about: 'A5：一个组件都不用的应用也能直接存版/发布，不拦不提示；doPublish/commitPublish 里出现按装配数量早退即红；--negctl 注入 !app.comps.length 必须 rc=2',
    subject: [{ page: 'app.html?id=hx-zc', sel: '#act-publish' }] },

  { id: 'CLIENTREG', tool: 'check-client-registry.mjs', negctl: 'flag',
    about: '授权是「应用 × 客户」多条记录（用户 m01548）：data.js 有 AUTH_FIELDS/DB.AUTHS 且持久化 auths；authGrant 只收 (appId, clientIds, months, at)、版本取 latestVer，authUpgrade 单条升级；client-auth.html 有 #fm-clients 多选与 #fm-ver-note 只读版本、无 #fm-ver/#fm-tenant；apps.html 无 #ap-client 且卡面读 DB.authRows。--negctl 注回 select#ap-client 必须 rc=2',
    subject: [{ page: 'client-auth.html', sel: '#fm-clients' }] },

  /* ── ENTITY（2026-11-02，第 33 项；第二击）──
     实体关系先冻结成表，代码必须跟「1 — N」对得上。起因：我把用户一句界面指路读成数据关系，
     做了「应用挂一个客户」的全局台账，四席与 98 条判据全绿也拦不住 —— 因为所有判据都是照着我
     的实现写的（自我参照）。这条判据不读实现，读 _docs 里的冻结表与真源。 */
  { id: 'ENTITY', tool: 'check-entity-model.mjs', negctl: 'flag',
    about: '_docs/实体-客户授权-20261102.md 的 ENTITY-MODEL 段 ≥3 行、每行真源是 文件:行号 或 mNNNNN；AUTH_FIELDS 挂 appId+clientId 且 APP_FIELDS 无 clientId；删除只在已取消分支。--negctl 注 clientId 回 APP_FIELDS ＋ 删除插到公共区必须 rc=2',
    subject: [{ file: '_docs/实体-客户授权-20261102.md', sel: 'ENTITY-MODEL' }] },

  { id: 'REVIEW', tool: 'check-review.mjs', negctl: 'flag',
    about: '独立评审留痕：tools/review-log.jsonl 必须存在、评审者不是作者、评审时间晚于界面最后改动、被否的发现要写理由',
    subject: [{ file: 'tools/review-log.jsonl', sel: 'reviewer' }] },

  { id: 'CHAIN', tool: 'check-chain.mjs', negctl: 'flag',
    about: '交付链八环节：每环的交接物存在且非占位、每环声明的判据脚本存在并登记在本台账（缺环即红）',
    subject: [{ file: 'tools/chain.json', sel: 'stages' }] },

  { id: 'DOMAIN', tool: 'check-data-domain.mjs', negctl: 'flag',
    about: '数据值域与外键：status ∈ 三值、enabled 布尔、version ≥0 整数、APP_COMPS 外键都指向存在实体、无孤儿组件（此前注入「已上线」三道门全绿）',
    subject: [{ file: 'assets/data.js', sel: 'APPS' }] },

  { id: 'DLGFOCUS', tool: 'check-dialog-focus.mjs', negctl: 'flag',
    about: '模态弹窗焦点契约（APG）：开→焦点进弹层、Tab 圈禁在弹层内、Esc 关、关→焦点回触发钮；负控删掉 .focus() 必须红',
    subject: [{ page: 'apps.html', sel: '#ap-mask' }, { page: 'components.html', sel: '#nf-mask' }, { page: 'app.html?id=hx-zc', sel: '#mask' }] },

  { id: 'FOCUSOBSC', tool: 'check-focus-obscure.mjs', negctl: 'flag',
    about: '焦点不被遮挡（WCAG 2.4.11）：每个 tabbable 取 9 点 elementFromPoint，整块被浮层盖住即红；负控把 .xz-fab 撑大必须报出被遮元素',
    subject: [{ page: 'apps.html', sel: '.kc-hit' }, { page: 'components.html', sel: '.cl-ops .k-more' }] },   /* ★2026-11-04 .kbtn → .cl-ops .k-more */

  { id: 'DISABLED', tool: 'check-disabled-state.mjs', negctl: 'flag',
    about: '「已禁用」这条状态三处同判：卡面 chip 出现、DB.canInstall 返回 false、装配候选里消失；负控渲染后删掉 chip 节点必须红（此前种子里 0 条 enabled:false，这三处代码从没被验过）',
    subject: [{ page: 'components.html', sel: '.cc-sw' }, { page: 'app.html?id=hx-zc', sel: '#mask' }] },


  /* ★2026-10-25：组件页的"卡"＝一行 .crow，⋮ 在操作列 .cl-ops 里（行内实心按钮、常显），
     行内主链接是「配置」a.kbtn（Tab 的下一站就是同行 ⋮）。apps.html 一字未动。 */
  { id: 'CARDMENU', tool: 'check-card-menu.mjs', negctl: 'flag',
    about: '卡/行的 ⋮「更多操作」（用户 m01293）：apps 卡悬停才显形（未悬停 opacity<0.5、悬停 300ms 后 ≥0.99）；components 的"卡"＝一行 .crow，⋮ 是 .cl-ops 里的实心按钮（常显、悬停升档）、原地是操作列「配置」；两页共同：菜单 role=menu 且 menuitem≥3、每项点了都有可见结果、Esc 关闭回 ⋮、真 Tab 能到 ⋮；负控删掉 ⋮ 必须红',
    subject: [{ page: 'apps.html', sel: '.kcard' },
              { page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.cl-ops .k-more' },
              { page: 'components.html', sel: '.cl-ops .k-mi' }] },

  /* ★2026-10-27 重锚（T11）：判据曾停在 10-25 的「单列行表」形态，而现行组件页是 4 列卡片网格
     （.crow.ccard）—— 旧断言的对象 .cl-head/.cl-ver/.cl-ico 全不存在，正控自己先红 7 条，
     负控里 2 刀连靶子都造不出来。尺子（同类型元素宽高两两相等、对齐由模板给、容差 0）一个字没放松，
     只把量测对象再翻译回卡片；并加「基线红则负控 rc=4」的前置，堵死"基线红着让刀随便命中"。 */
  { id: 'UNIFORM', tool: 'check-card-uniform.mjs', negctl: 'flag',
    about: '组件库同类型元素统一尺寸（用户 2026-10-24：「为什么每个卡片大小都是不一样的？统一不知道吗」；2026-10-27 重锚到 4 列卡片网格，容差一个没放宽）：① .crow.ccard 数 = DB.COMPS.length；②③ 卡宽、卡高两两相等（容差 0）；④ 同行卡顶全等 + 行距 = row-gap（≤0.5）+ 全部卡左缘落在同一套 4 条列线（跨行同列全等，容差 0）；④b 严格 4 列＝轨道 4 条、Σ轨道+Σ列距 = #grid 内容盒（≤0.5）、每卡宽 = 轨道宽（末行不拉伸）；⑤ 撤干净：本页 #grid 里 .kcard 必须 = 0、DOM 无 .is-main/.k-used；⑥ 1440 下 doc/#grid 无横向溢出；⑦ 每卡都有 .k-more、opacity ≥0.9 且占位；⑧ 两页可分：组件卡无 .kc-cover/无 .k-ico 且有 .cc-sw、应用卡有 .kc-cover 且无 .cc-sw；⑨ 卡内文字格不出卡右缘 ＋ 被截断的必须有覆盖全文的 title；⑩ .cl-tt 顶距 / .cc-ft 顶距 / .cc-ft 高跨 8 卡全等（容差 0）；⑪ 状态开关每卡 1 个、高 ≥24、右缘距卡右缘跨卡全等 ≤1px。负控五刀：卡高 80px／⋯ opacity 0／.cl-tt 超长且无 title／删 .cc-sw／首卡 margin-left 10px，每刀必须命中点名的断言（rc=2），基线红则 rc=4',
    subject: [{ page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.cl-ops .k-more' }] },

  { id: 'CANVAS', tool: 'check-canvas-empty.mjs', negctl: 'flag',
    about: '画布空态（用户实测「点卡片进去一片空白」）：DB.COMPS 全部 + DB.APPS 全部逐页量，每页要么有内容（.page/.sheet 且可见文本 ≥24 字），要么有带引导的空态（.empty-wrap+seed，或 section.cv-empty+按钮），两者都没有才判纯空白；负控清空画布必须红',
    subject: [{ page: 'component.html', sel: '#canvas-inner' }, { page: 'app.html?id=hx-zc', sel: '#canvas' }] },

  /* ★2026-10-27 重锚（T11）：上一版读的是"行自己的" grid-template-columns（卡片形态里行不是网格容器
     ⇒ 解析出 0 档）与行内首个子元素的左缘（卡片有 1px 边框 ⇒ 恒定差 1px），正控先红 3 条；
     负控报的"还原后仍有 2 处 FAIL"其实是基线红。现在量 #grid 的轨道与卡本身的左缘。 */
  { id: 'CROSSPAGE', tool: 'check-cross-page.mjs', negctl: 'flag',
    about: '跨页同一套体系（2026-10-24 零上下文评审席：组件页 278.5/24/236 vs 应用页 272.5/32/194，"用户说卡片大小不一样，印象很可能来自两页对比"）。2026-10-27 重锚到 4 列卡片网格、容差未放宽：①a 两页 #grid 面板左缘/右缘/宽各自相等（≤0.5）；①b 各自栅格 Σ轨道+Σ列距 = 内容盒（≤0.5，读 #grid 不读行）；①c 两页列距同属 8px 节奏；①d 页内两侧留白对称；①e 首卡左缘 = 面板左缘 + 声明内距（≤0.5，元素自带 margin 会红）；② 卡内操作带 .cc-ft 里 .cl-ops 上下留白对称 ≤2px 且 .cc-ft 等高（替代旧「下半截发空」）；⓪ 结构前提：组件页 #grid .kcard=0 且 .kc-cover=0、有 .crow。负控六刀：面板左移 6px／四轨道定死 200px／列距 14px／左右内距 26 vs 10／卡 margin-left 8px／操作组顶对齐，每刀必须命中点名的断言（rc=2），基线红则 rc=4',
    subject: [{ page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.crow' },
              { page: 'apps.html', sel: '.kcard' }] },

  /* ── 行式列表（2026-10-25 新增，第 35 项；起因是组件库从「4 列卡片阵列」整段换成
        「一张白面板 + 一行一个组件」）──
      必须新开一条，不能靠 UNIFORM / CROSSPAGE 兜着：那两条量的是 .kcard 的卡几何，
      而换形之后组件页上 .kcard = 0 —— 主体消失，它们不会报错，只会安静地变绿
      （台账开头写的第一种死法，一模一样的写法）。这条把量测对象换成行：
      R1 行高全等（容差 0）+ 表头与 8 行共用列左缘（≤1px）+ doc/#grid 无横向溢出；
      R2 .cl-tt/.cl-ver/.cl-st 不截断，.cl-desc/.cl-refs 省略时 title 必须非空且更长；
      R3 .cl-refs 每个应用名必须逐字等于 DB.APPS 里的名字且确实引用这行、零引用写「还没有应用使用」、
         +N chip 不越出引用列；
      R4 ⋮ 静止态 ≥3:1、盒子 32×32、点开 role=menu ≥3 项且 data-act ∈ {edit,toggle,refs}、Esc 关并回焦；
      R5 两页结构可分（组件页 #grid .kcard=0 / .cl-head / 8 .crow，应用页 .kcard=6）；
      R6 只在页面里把 DB.COMPS 克隆成 32 行（不碰 data.js）重渲染，首屏 top<900 必须 ≥9 行。
      负控四刀（页面内覆写，不落盘）：行高 80px / 注入假应用名「某某不存在的应用」/ 删 ⋮ / 把 .crow 包进 .kcard，
      任一刀没被判红 ⇒ 自己退 rc=3「未量」，不许当绿。 */
  /* ★2026-10-27 重锚（T11）：整条按「单列行表」写，而组件库 10-25 晚已改回卡片（用户「我服了，
     组件管理我需要的是好看的卡片」）—— .cl-head/.cl-ver/.cl-refs/.cl-ico 一个都不存在，
     正控先红 7 条、7 刀里 3 刀连靶子都造不出来。R1-R8 逐条翻译到卡片形态（阈值不变）。 */
  { id: 'LISTROWS', tool: 'check-list-rows.mjs', negctl: 'flag',
    about: '组件库卡片逐条体检（原「单列行表」八条，2026-10-27 翻译到 4 列卡片网格，阈值未放宽）：R1 卡高全等(容差 0)+卡左缘落在同一套列线(≤1px)+doc/#grid 无横向溢出；R2 被截断的文字必须有覆盖全文的 title；R3 引用数文案逐字等于 DB.APPS 现算（「被 N 个应用使用」/「还没有应用使用」）；R4 ⋮ 静止 ≥3:1 且 32×32、点开 role=menu ≥3 项 data-act ⊆ {edit,toggle,vers,refs} 且必含 edit/vers/refs、Esc 关并回焦点；R5 两页结构可分（组件页 .kcard=0/.kc-cover=0/.crow=8，应用页 .kcard=6）；R6 32 张压测首屏 top<900 ≥9 张；R7 状态表示与状态值一一对应（文案 ∈ 启用/禁用/草稿、data-on=1 ⇔ 启用、aria-checked 同）；R8 引用数文案无「…+数字」拼接残句。负控七刀：卡高 80px／截断且无 title／假引用数／⋮ 压到 rgba(0,0,0,.2)／把 .crow 包进 .kcard／data-on 与文案漂移／塞回拼接残句，每刀必须命中点名的规则（rc=2），基线红则 rc=4',
    subject: [{ page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.crow' },
              { page: 'components.html', sel: '.k-more' },
              { page: 'components.html', sel: '.cl-desc' }] },   /* ★2026-11-04 .cc-meta → .cl-desc（前者已不在渲染结果里） */

  { id: 'ECONTRAST', tool: 'check-empty-contrast.mjs', negctl: 'flag',
    about: '首屏空态对比度（用户 2026-10-24：「点进去是空白待机页、看不到提示文」——提示文在，但太淡）：真浏览器 computed color 按 alpha 合成到实际背景再算，主句 ≥7:1、说明 ≥4.5:1、示例文字与箭头 ≥4.5:1、小智输入占位 ≥3:1；负控把三处压到 rgba(0,0,0,.2) 必须红；找不到元素判"未量"rc=3 不许当绿',
    subject: [{ page: 'component.html', sel: '.cv-empty' }, { page: 'component.html', sel: '.cv-empty > b' }, { page: 'component.html', sel: '.cv-empty > p' }] },   /* ★2026-11-04 .empty-lead/.seed 已不存在：空态现在是 .cv-empty 一套骨架（assets/app.js:818） */


  /* ── 配置器契约（CONFIGURATOR.md K 系列）──
     它判的不是 DESIGN.md 的界面规范，是"宿主与配置器的边界"；
     所以放在台账里但 about 写清来源，避免和 J/P/R 组混着读。 */
  { id: 'K1-K13', tool: 'configurator-parity.mjs', negctl: 'flag',
    about: 'CONFIGURATOR.md 的契约判据：字段词表 / 动作白名单 / patch 增量语义 / 三态不崩 / 无 id 不冒充 / 往返不写库',
    subject: [{ page: 'component.html', sel: '#canvas' }, { page: 'component.html?id=task-list&cfg=cfg-comp-form', sel: '.cfg-bd' }] },

  { id: 'RW', tool: 'reach-walk.mjs', negctl: 'external',
    about: '状态机遍历：27 个可达态 / 49 条边，每个开态至少一种关法能关且界面复原（抓"走进去出不来"）。⚠ 单轮 1-2 分钟，不进 Q1 的负控扫，由 run-gates 单独一项跑；它的 --negctl 必须在收尾手工跑一次',
    subject: [{ page: 'app.html?id=hx-zc', sel: '.xz-fab' }] },

  /* ── 关键控件可见性（第 22 项）──
     补的是第三种"看不到"：gate-states 只验 CSS 有规则、interact-audit 只验点了有反应、
     px-parity 只比"今天 vs 基线"（基线里就没有的东西永远无差异）。
     实测抓到的形状：控件被祖先压成零尺寸 / 被 overflow 裁掉 / 祖先 opacity:0。
     清单 65 条、每条带 why —— 没有 why 的条目半年后没人敢删也说不清为什么不能删。
     ★2026-10-25 结构换形：这条的主体不由本台账定，而是 tools/must-see.json（另一条门禁的
       数据件）。换形后 components.html 的正文＝单列行列表，must-see.json 里那 4 条
       （.kcard / .card-tt / .card-desc / .k-meta）已成死指针 —— 本台账不替它改数据，所以这里
       只登记 VIS 现在真的在量、盘上也真的存在的对象（.sider / #btn-new）。
       ⚠ 那 4 条换成 .crow / .cl-tt / .cl-desc / .cc-meta 之前，visible-audit 会在那 4 行判
       「命中 0 条（主体不存在 = 没量）」—— 那是真红，别把这一条的绿读成"行列表被看住了"。 */
  { id: 'VIS', tool: 'visible-audit.mjs', negctl: 'flag',
    about: '关键控件可见性清单（tools/must-see.json）：①有盒子 ②非 none/hidden ③opacity>0 ④未被 overflow:hidden|clip 祖先裁掉；命中 0 条判红（主体不存在 = 没量）。组件页换形后正文＝#grid > .cl-head + 8 × .crow，行内对象（.cl-tt/.cl-desc/.cc-meta/.k-more）要由 must-see.json 换成行选择器后才算被看住',
    subject: [{ page: 'apps.html', sel: '.sider' },
              { page: 'components.html', sel: '.sider' },
              { page: 'components.html', sel: '#btn-new' },
              { page: 'component.html', sel: '.fk-bar' },
              { page: 'component.html?id=task-list&cfg=cfg-comp-form', sel: '.cfg-bd' }] },

  /* ── 2026-10-25 新增四条（补登台账：此前跑过、有读数，但没进台账 ⇒ Q1「每个判据脚本都在台账里」判红）──
   * 补登不是补形式：每条都写清"它守哪一格、那一格的已知边界是什么"，否则半年后没人知道它为什么必须在。 */
  { id: 'TOKENSCALE', tool: 'check-token-scale.mjs', negctl: 'flag',
    about: '间距/圆角/字号是否只在既有档位里取值（出档即红），例外必须落 tools/token-allow.tsv 且精确到 CSS 选择器（第 5 列，段切 AND 匹配；理由空或到期即判红）。已知边界：只量 CSS 里写死的裸值，不量 JS 运行时算出来的尺寸；`--strict` 会把已登记的欠账也翻成断点（本轮 6 条）',
    subject: [{ file: 'tools/token-allow.tsv', sel: 'spacing' }] },

  { id: 'ALIGN', tool: 'check-align.mjs', negctl: 'flag',
    about: '同一页里"主容器的直接子块"左缘/右缘对齐（≤1px）——量的是**看得见的边**（自身与直接子元素盒子的极值），不是容器 padding 盒。已知边界：兄弟块之间有意错位（如表格行内缩进）不算，只看顶层块；装饰性浮层不参与',
    subject: [{ file: 'apps.html', sel: '#grid' }] },

  { id: 'DOCTRUTH', tool: 'check-design-truth.mjs', negctl: 'flag',
    about: 'DESIGN.md 的令牌表 vs assets/tokens.css 现值逐条对账：①表里点名的 --token 必须存在 ②取值字面一致 ③"白底对比度"列必须等于按现值重算（容差 0.15）。已知边界：只认单元格里第一个反引号 token；带 ⚠ 或"压 --x-bg"的行不核对比度（那是另一块底）；README 式叙述不核',
    subject: [{ file: 'DESIGN.md', sel: '--ink-3' }] },

  { id: 'VISLINT', tool: 'check-visual-lint.mjs', negctl: 'flag',
    about: '视觉默认做法与全站文字对比度，双证据：A＝外部 oil-ui lint（14 条规则，可读性四项 contrastLow/smallText/tightLeading/stuck 必须为 0，其余默认做法须落 tools/lint-allow.tsv 精确到选择器）；B＝本机自查（真实 computed color 按 alpha 合成到实际背景后算比值，正文 4.5 / 大字 3）。已知边界：渐变底与图片底跳过并打印（交人看）；只量有直系文本的可见元素；`.logo` 这类 logotype 记例外而不是改色',
    subject: [{ page: 'apps.html', sel: '.sider .gs' },
              { page: 'apps.html', sel: '#btn-new' }] },

  { id: 'INSET', tool: 'check-inset.mjs', negctl: 'flag',
    about: '一张卡内部"读者从左往右读的行"左缘最大差 ≤1px：标题 .kc-title / 说明 .kc-desc / 元信息 .k-meta / 底栏动作 .card-ft .k-more 必须同一条线（此前的真实值：标题 232 vs 底栏动作 228 = 4px）。例外落 tools/inset-allow.tsv（理由+到期）。已知边界：只量应用卡，组件库是行表不是卡；跨列对齐由 check-align / check-cross-page 管',
    subject: [{ page: 'apps.html', sel: '.kcard' }] },
  /* ── 2026-10-27 补齐台账遗漏的 19 条 ──────────────────────────
     起因：check-judgments 的「每个判据脚本都在台账里」实测缺 19 条 ——
     里面既有今天新建的六条（承诺/结构树/锚点契约/锚点普查/覆盖闸/负控台账），
     也有早就存在却从没登记的（图标尺寸/几何/反向/自检/值出处/版本/全局元素/盲扫/出图）。
     台账不是装饰：它决定「这条判据有没有人知道它存在」。缺登记＝它红了也没人认领。
     这些条目不写 subject —— subject 是给"需要在页面上取样的判据"用的，
     纯文件判据（如判据锁、覆盖闸）本来就没有取样点，写了反而是假信息。 */

  { id: 'GLOBALISS', tool: 'check-global.mjs', negctl: 'flag',
    about: '全局元素必须真的全局：小智浮球在五页都得存在且可点（实测 component.html 曾 display:none、versions.html 连 #xz-host 都没有）' },
  { id: 'SCANBLIND', tool: 'scan-blind.mjs', negctl: 'none',
    about: '「没人看的那几类」批量探针：层叠遮挡 / 截断挤压 / 四态视觉，遍历全部页面与展开态出可核清单（探索性扫描，不作为门禁判红依据）' },
  { id: 'BLINDIN', tool: 'blind-inputs.mjs', negctl: 'none',
    about: '出盲审输入：18 张 1440×1000 截图 + manifest + stamp.json（出图时刻与 23 份源文件 md5），让评审能证明"我看的是这一版"' },
  { id: 'ICONSIZE', tool: 'check-icon-size.mjs', negctl: 'flag',
    about: '内联 SVG 尺寸契约：8–32px、显式来源、同图标同尺寸（图标尺寸漂移在页面上看不出来，并排才显）' },
  { id: 'GEOM', tool: 'check-geometry.mjs', negctl: 'flag',
    about: 'fixed 元素没被 transform 祖先捕获：祖先一旦有 transform，浮球/对话条会换定位基准而"跑位"' },
  { id: 'REVERSE', tool: 'check-reversible.mjs', negctl: 'flag',
    about: '反向路径：下架→上架、组件开关往返、切版本可切回（每个破坏性动作都得有回头路）' },
  { id: 'SEATPASS', tool: 'check-seat-pass.mjs', negctl: 'flag',
    about: '四席过一遍：改过的每一页必须有 product/design/frontend/ux 四份读数（按页面内容 hash 配对），缺一席即红' },
  { id: 'SELFCHECK', tool: 'check-selfcheck.mjs', negctl: 'flag',
    about: '判据自检：过期选择器 / 函数定义顺序（判据自己的代码烂了，它照样可能报绿）' },
  { id: 'VALUEPROV', tool: 'check-value-provenance.mjs', negctl: 'flag',
    about: '视觉值出处：裸色值/裸字号必须有出处，存量放过、新增判红（防止"看着差不多就写个 14px"' },
  { id: 'VERSIONS', tool: 'check-versions.mjs', negctl: 'flag',
    about: '版本模型：草稿/正式/唯一启用 + 四条死命令（版本线是本产品最不能错的一块）' },
  { id: 'CONFIRM', tool: 'check-confirm.mjs', negctl: 'flag',
    about: '不可逆动作先问一句：下架/发布前必须有确认，且确认正文写清后果' },
  { id: 'CARDSHAPE', tool: 'check-card-shape.mjs', negctl: 'flag',
    about: '卡片形态契约：等高 / 行数 / 操作带 / 卡面身份锚点（类型点+阴影+单一底色）/ 两页可分 / 间距档位（六张并排时才看得出集体歪）' },
  /* ★2026-11-04 退役：三态菜单/电源/确认由 STATEACT 按真机抓的 truth-apps-menu.json 验（单一真源）；
     state-matrix.json 是第二份手抄表，已停在旧状态词与旧菜单文案，两套事实并存必红。登记见 tools/not-gated.tsv。 */
  { id: 'DEPRECATED', tool: 'check-deprecated.mjs', negctl: 'flag',
    about: '已作废口径还在被使用：剥注释后扫，防止旧说法（如"停用"）从注释漏回界面' },
  { id: 'CRITLOCK', tool: 'check-criteria-lock.mjs', negctl: 'flag',
    about: '判据锁：每条判据的内容哈希 + 台账里必须有合格理由，改判据不留记录即红（含变异测试自证）' },
  { id: 'NEGCTL', tool: 'check-negctl.mjs', negctl: 'flag',
    about: '负控台账：43 条判据逐条记「负控怎么跑 / 上次实测 / 结果 / 到期日」，缺账或过期即红' },
  { id: 'GATECOV', tool: 'check-gate-coverage.mjs', negctl: 'flag',
    about: '覆盖闸：tools/ 下每个判据要么进闸、要么在 not-gated.tsv 里写清为什么不跑；在闸内但每轮 rc=3 未量的也要记账并挂到期 —— 判据存在不等于判据执行' },
  { id: 'ANCHORCOV', tool: 'check-anchor-coverage.mjs', negctl: 'flag',
    about: '锚点普查：被 ≥3 个判据依赖的选择器必须在 ui-contract.json 里有名字，否则改名是无声的' },
  { id: 'UICONTRACT', tool: 'check-ui-contract.mjs', negctl: 'flag',
    about: '锚点契约：判据与小智依赖的 id/class/文案必须还在，每条写清"坏了会废掉谁"（两路：静态 0.12s / 浏览器查文案）' },
  { id: 'STRUCT', tool: 'check-structure.mjs', negctl: 'flag',
    about: '结构树：每页必须存在的区逐条判 found/visible/content（"少了整整一个区"此前对所有判据都不可见）' },
  { id: 'PROMISE', tool: 'check-promise.mjs', negctl: 'flag',
    about: '卡面承诺兑现：卡上写的话，画面上必须找得到对应物（29 句只兑现 5 句那次之后立）' },
  { id: 'VIEWMODE', tool: 'check-view-mode.mjs', negctl: 'flag',
    about: '客户视图（?mode=view）不许漏出管理控件：走查 P0-3「客户能打开的那一页不存在、复制链接复制的是管理列表地址」之后立。按可见性判不按存在性判，负控跑在编辑态上必须抓到 ≥1 个可见控件' },
  { id: 'TOPBARLEAN', tool: 'check-topbar-lean.mjs', negctl: 'flag',
    about: '顶栏只回答"哪个应用的哪一版"：.app-edit 只能是 v<N>（可带 · 未保存/只读/保存失败），.float-hd 除名字与版本号外不许有可见文字，直接子元素恰好 3 个，文字总长 ≤ 名字+版本+2。2026-11-03 用户 m00984「左上角，毫无意义…就显示当前应用名称、版本号就行了」；同族第二次（10-25 删过"多余标注"）⇒ 立判据。--negctl 往 .float-hd 注入「已上架 · 1 家客户 · 都是最新」必须 rc=2',
    subject: [{ page: 'app.html?id=zxjt-yy', sel: '.float-hd' }] },
  { id: 'STATEACT', tool: 'check-state-actions.mjs', negctl: 'flag',
    about: '三态×动作×反馈必须是真点出来的：列表同时出现 已上架/内测中/未上架；筛选三值齐全；每态有两套菜单——电源钮=发布内测版/上架正式版、上架正式版/下架、发布内测版/下架，⋮=客户配置/编辑/查看/导出；下架、发布内测、上架正式三种动作必须弹出确认框且文案含「无法使用」/「内测客户可以立即使用」/「所有已授权客户都会看到」。2026-11-03 实机 BSK 核对：真系统状态动作在电源钮、⋮ 只有通用动作；原合并菜单与 disabled 电源钮均已纠正。2026-11-03 用户 m02251「为什么现在才做？为什么最开始复刻时不去做？」——此前 74 条像素/文案判据全绿而三态与菜单是错的，属静态图冒充交互真源。--negctl 把内测中菜单期望写成 上架正式版/删除应用 必须红',
    subject: [{ page: 'apps.html', sel: '.kcard .k-menu' }] },
  { id: 'FORMHYGIENE', tool: 'check-form-hygiene.mjs', negctl: 'flag',
    about: '表单卫生：图标上传键必须 88×32、1px 实线 #D9D9D9、直角、无伪元素加号、旁边无提示行；编辑弹窗不许有 #ei-note/.nf-hint 或解释性长句；.nf-bd 直接子元素间距全为 16、标签到控件为 8；租户 ID 输入框旁不许有静态 .fm-hint。2026-11-03 用户 m04152 怒斥「名称是它在库里……」为脑残文案、m04268「这种非必要提示，狗屎描述，都不需要」；同一轮图标被反复改成 88×88 虚线框，属同族第三次 ⇒ 立机器判据。--negctl 注入说明句、把间距改乱、加提示行，必须红',
    subject: [{ page: 'components.html', sel: '#ei-mask .nf-bd' }, { page: 'apps.html', sel: '#ap-cover-thumb' }] },
  { id: 'PUBPARITY', tool: 'check-publish-parity.mjs', negctl: 'flag',
    about: '本地改动必须真的到公网：逐文件比对本地发布集与发布仓库 /tmp/daguan-site 的 HEAD，工作区脏 / HEAD 缺文件 / 内容不等都红（rc=2），修法直接打出来。2026-11-03 用户 m01612「什么我看还是没变化？？？」——本地全绿、截图也验过，但发布仓库停在 09:30，体系里没有任何判据覆盖"本地 → 公网"这一步，属假绿。--negctl 人为制造一条差异必须 rc=2',
    subject: [{ file: 'tools/run-gates.sh', sel: 'check-publish-parity.mjs' }] },

  /* ══ 2026-10-28 补三条账（E9-1：check-judgments --quick 报 rc=2 的三个未登记脚本）══
     前两条本来就接在 run-gates.sh 里跑（editunit / R2），却从来没进本台账 ——
     于是「每个判据脚本都在台账里」这条自己看不到它们，和 QUOTE 当初没进 run-gates 是同一个病：
     判据存在、执行了、账面上没有，出事时没人能顺着台账找到它。
     第三条（op-accept）不是判据，进 EXEMPT 并写清理由。 */
  { id: 'EDITUNIT', tool: 'check-edit-unit.mjs', negctl: 'flag',
    about: '改版单位：改一处 → 表头只追加一列、行数与原有单元格逐字不变、其余块逐字不变、其余组件 spec/fields 不变；提示条只报事实且不许出现撤回入口（00e §4）。--negctl 注入越界必须 rc=2',
    subject: [{ page: 'app.html?id=hx-zc', sel: 'section.cv-blk[data-comp]' }] },
  { id: 'UXREVIEW', tool: 'check-ux-review.mjs', negctl: 'flag',
    about: '任务走查盲审：_reports/ 里必须有一份**对象对得上**（前 30 行点名本产品文件）且**晚于产品最后改动**的盲审/走查/UE 报告；只看时间不看对象会拿外部参考站的评审冒名顶替（10-27 实测假绿）。subject 取 run-gates 里的调用点：这条闸被摘掉调用时，主体就消失',
    subject: [{ file: 'tools/run-gates.sh', sel: 'check-ux-review.mjs' }] },
  /* 2026-10-28（机制审查官）：族 gate-key-dup 的承载判据（此前记"未立"）。
     它不判页面，判 run-gates.sh 自己的接线：want 组名必须在 case 里有分支，run_one 注册必须一一对应。
     subject 取 run-gates 里的调用点 —— 调用被摘掉时，这条闸自己也会失去主体，不许静默消失。 */
  { id: 'GATEWIRE', tool: 'check-gate-wiring.mjs', negctl: 'flag',
    about: '判据接线：want() 的 case 里没有的组名 ⇒ case 落空返回 0 ⇒ 该行恒真（组开关失效、红被 grp_of 兜底分支吞掉）；同一（脚本＋参数）两个 key ⇒ 一次红数两次。解析 run-gates.sh 自身且注释不算注册；--negctl-want / --negctl-dup 各自必须 rc=2',
    subject: [{ file: 'tools/run-gates.sh', sel: 'check-gate-wiring.mjs' }] },

  /* 2026-10-28（机制审查官）：并发席位 09:38 新加的 e33-struct-undo.mjs 已接进 run-gates.sh
     第 457 行 `run_one structundo`，却没进本台账 —— check-judgments 的「每个判据脚本都在台账里」
     当场抓到（judge 项 rc=2 的唯一来源）。本席**先复核再登记，不替它编绿**：
       · 复核：正控 rc=0（9/9）。V0 的基线与 5 列、V1 的"末位就是新列"都是先验断言，
         不是"跑完自己跟自己相等"；V2/V3/V5/V5b 都挂 `added` 前置，空操作骗不过去。
       · 负控：该文件原本**没有 --negctl**，`--negctl` 会被当普通参数吞掉、照跑真机
         —— 那等于把"正控通过"读成"负控通过"（同 check-judgments 2026-10-27 踩过的坑）。
         本席补了 9 格断言逐条改坏的负控（rc=2），正负两路共用同一个 verdict()，不是两份断言。
       · 射程：只验 fields 那条路；spec 分支现盘（8 个组件 spec 全 null）触发不到，属"未量"，
         写在该文件头注里，不许读成"spec 路也验过了"。 */
  /* ══ 2026-10-29：Q1 台账补齐（7 个判据脚在跑/在盘，却不在台账里）════
     同 2026-10-28 那批：判据存在、执行了、账面上没有，出事时没人能顺着台账找到它。
     这里只补登记，不替它们编绿；negctl 标 'none' 的必须写清"为什么没有可证伪断言"。 */
  { id: 'CARDUPD', tool: 'check-card-updates.mjs', negctl: 'flag',
    about: '应用卡「{N} 个组件可升级」徽标（U1–U4）：N 独立复算 / 两处各算一次相等 / 文案逐字 / 无更新不留空节点。2026-11-02 卡面改版后，旧的双入口/几何/令牌落点断言已退役（那些断言建立在旧版 footer 配置链 + 旧徽标类上，现卡面只有一个入口 a.kc-hit 与 .kc-upd-flag）。--negctl 必须 rc=2' },
  { id: 'COMPFIRST', tool: 'check-component-first.mjs', negctl: 'flag',
    about: '先组件后页面：页面内联 <style> 体积棘轮 / 页面私有类必须登记并挂到期 / 十三类组件唯一实现在登记表里点名且规范根不复制到页面。--negctl 13/13 各自 rc=2' },
  { id: 'ENTRYPARAM', tool: 'check-entry-params.mjs', negctl: 'flag',
    about: '应用卡带参落地点：参被消费且不吞 id / 面板落在「已装配」/ 筛选行 N 与 DB 各算一次相等 / 无更新与未装空态 / 已下架不承诺更新。--negctl 必须 rc=2' },
  { id: 'SCHEMART', tool: 'check-schema-roundtrip.mjs', negctl: 'flag',
    about: '字段单一真源往返：DB.SCHEMA 每个字段写成非默认值后必须能从 localStorage 读回；落盘键数 = schema 键数。--negctl 摘掉一个派生键必须被抓住（rc=2）' },
  { id: 'SPECCONTRACT', tool: 'check-spec-contract.mjs', negctl: 'flag',
    about: '组件规范不是纸：规范点名的类 CSS 里必须有定义 / 声明唯一实现的类不许重复定义 / props 表 boolean 行 ≤1。--negctl 注入三类坏法必须判红（rc=2）' },
  { id: 'TOKENSCAN', tool: 'check-tokens.mjs', negctl: 'flag',
    about: '令牌裸值预算档（2026-10-29 接闸）：判据内违规 184 处为基线，--max=184 只在新增长时红；--negctl 往临时目录注入一条裸色值，必须 184→185 判红（rc=2）。已知边界：按条数判，修一条+新增一条计数不变抓不到；逐条签名基线留到令牌迁移轮' },
  { id: 'UPDVIEW', tool: 'check-update-view-tokens.mjs', negctl: 'flag',
    about: '「已装配行 · 有更新」段：段落锚点在位 / 裸 hex 与裸 px = 0 / var() 全部闭合 / 渲染函数无内联 style / 类都有规则 / 按压位移走令牌。--negctl 塞 13px 必须判红（rc=2）' },
  { id: 'CARDFOOTER', tool: 'check-card-footer.mjs', negctl: 'flag',
    about: '卡底栏三态几何契约：footer 49 / padding 12·12·13 / 动作组 68×24 / 电源与 ⋮ 24×24、ml10、r2、icon20；草稿电源 disabled 占位、已下架 opacity=1。--negctl 把按钮改成 32×32 必须整排判红（rc=2）',
    subject: [{ page: 'apps.html', sel: '.kcard' }] },
  { id: 'COMPBIND', tool: 'check-component-binding.mjs', negctl: 'flag',
    about: '组件绑定七项：规范小节 / canonical 根选择器在 CSS 中恰好一行 / 令牌已定义且被引用 / 状态矩阵存在 / 页面使用 / 判据点名 / 负控在账。--negctl 去令牌、去状态、去判据、去页面四刀都必须 rc=2',
    subject: [{ file: 'tools/component-first.registry.json', sel: 'bindingPolicy' }, { file: 'tools/component-first.registry.json', sel: 'canonical' }] },
  { id: 'COMPLIFE', tool: 'check-component-lifecycle.mjs', negctl: 'flag',
    about: '组件生命周期治理：登记集合与 registry 一致 / 状态合法 / 日期与复审不过期 / deprecated 必须有替代件和移除日 / 不许自指。--negctl 注入「deprecated 但无 replacement」必须命中（rc=2）',
    subject: [{ file: 'tools/component-lifecycle.json', sel: 'components' }] },
  { id: 'DEADCSS', tool: 'check-dead-css.mjs', negctl: 'flag',
    about: '死 CSS：CSS 选择器引用的类名必须在页面 HTML 或 assets/*.js 出现；注释先抹掉，动态拼接类走 allow 台账逐条登记。--negctl 注入 .ghost-dead-xyz 必须判红（rc=2）',
    subject: [{ file: 'assets/sys.css', sel: '.kcard' }] },
  { id: 'TOKENSRC', tool: 'token-source.mjs', negctl: 'flag',
    about: '令牌源台账（DTCG 子集）与 tokens.css 双向一致：四层 466 条，缺失/多出/改值都判红。--negctl 改一个原始值必须 1 条判红（rc=2）',
    subject: [{ file: 'assets/tokens.css', sel: '--p-white' }, { file: 'tools/tokens.dtcg.json', sel: '$schema' }] },
];


/* ══ 不是判据的脚本（必须写明理由，否则台账会漏检）═════════
 * `check-judgments` 的做法：tools/ 下每个 .mjs，要么在 CRITERIA 里有一条，
 * 要么在这里，否则判红。**按名单认，不按文件名前缀认** —— 前缀认人的代价是
 * walk / hit-audit / doc-parity 三个真判据被静默漏掉了整整一轮。
 */
export const EXEMPT = {
  'base.mjs': '共用工具：基址与调试端口唯一来源，本身不出 PASS/FAIL',
  'judgments.mjs': '台账本身',
  'check-judgments.mjs': '判据的判据（自指，不能自己验自己）',
  'pages.mjs': '页面清单唯一来源',
  'probe.mjs': '量测器：把任意 JS 丢进真浏览器跑并打回 JSON，不出 PASS/FAIL',
  'ref-vs-mine.mjs': '已被 ref-parity 取代的早期对照脚本，保留备查；**它不该再被当判据用**',
  'check-state-matrix.mjs': '2026-11-04 退役：与 STATEACT 重复覆盖「状态×菜单/电源/确认」，且它读的 state-matrix.json 是手抄第二份真源、已停在旧状态词；登记见 tools/not-gated.tsv',   /* ★2026-11-04 */
  'e2e-flow.mjs': '三条真实流程（A 小智 / B 造组件并发布 / C 装配）；比门禁慢，且验的是"流程通不通"不是"值对不对"，收尾单独跑',
  /* 2026-10-28（E9-1）：它一直在"跑"，但从来没被判过 —— 因为它根本不出红绿。
     放进 CRITERIA 会让「每条判据都能被证明会红」这条断言收进一个永远不会红的条目，
     等于给这条断言开一个后门。它是量器，不是判据。 */
  'e33-struct-undo.mjs': '2026-11-02 退役：撤回功能已被用户取消（00e §4），该判据整套验的是不存在的功能；文件保留备查，断言已迁入 check-edit-unit 的 B1/B1b（提示条只报事实、页面无撤回入口）',
  'op-accept.mjs': '只出读数不下结论（rc 恒 0，无 --negctl）：按《操作验收方案-20261027》跑 O1–O7 并落 JSON，判不判由人；把它当判据会让「能红」这条断言永远成立不了',
};
