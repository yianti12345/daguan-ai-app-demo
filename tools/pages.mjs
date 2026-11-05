/* pages.mjs —— **全站页面清单的唯一来源。**
 *
 * 为什么要有它（2026-10-22，被前端专家点出来的）：
 *   同一份页面清单在 8 个地方各写一遍，其中 `gate-tokens.mjs` 只写了
 *   ['component.html','app.html'] —— 也就是说 **J1/J2/J3/J6 这四项从来没跑过两个列表页**。
 *   判据不报错，它只是安静地少验了两页，而"全绿"照样打印。
 *
 * 规矩：以后不允许任何判据自己写页面数组，一律 import 这里。
 *   不知道有几页就别猜，问这个文件。
 */
/* ★2026-10-24：`app.html` 改成**带 id 的深链**。
 *   这一轮把 P1-7 判为缺陷并修掉：以前 `app.html` 不带 id 会静默回落到
 *   `DB.APPS[0]`（用户看到的是别人的应用，地址栏却不告诉你），现在改成
 *   `location.replace('apps.html?miss=1'|'?pick=1')`。
 *   于是"裸 app.html"不再是可渲染页，而判据里凡是拿它当页面的地方都会量到
 *   apps.html 的骨架 —— 那不是产品坏了，是**判据的 URL 过期了**。
 *   官方深链以这里为准：hx-zc 是种子里的已上架应用（3 个组件）。 */
/* ★2026-10-26：新增版本管理子页面。它是**带参深链**（scope + id），裸 versions.html
   没有 id 会走"对象不在了"的空态 —— 那是兜底，不是页面本身，所以清单里写深链。
   ⚠ 加进 PAGES 之后，J1/PX/walk 这些通用判据都会开始量它。这是应该的：
     不被任何判据覆盖的页面，等于没有资产。 */
export const PAGES = ['apps.html', 'components.html', 'app.html?id=hx-zc', 'component.html',
  'versions.html?scope=app&id=hx-zc', 'versions.html?scope=comp&id=task-list', 'downloads.html'];

/* 复刻类判据（ref-parity / spec-diff）只对**线上有对应页**的页面成立；
   两个画布式配置页线上没有同构页面，不能硬比。 */
export const LIST_PAGES = ['apps.html', 'components.html'];

/* 配置器形态（带 ?cfg= 的两条）：只给 configurator-parity 用。
   **不并进 PAGES** —— 它们不是"另一页"，是同一个页面换了配置界面。
   并进去的后果：J1/PX/PXC/walk 会拿一条没有冻结基线的 URL 去比，直接假红，
   而那种红会让人以为"配置器把页面改坏了"。
   单列一份 = 同一份事实只有一个来源（仍然是这个文件），但消费方各取所需。 */
export const CFG_PAGES = [
  'component.html?id=task-list&cfg=cfg-comp-form',
  'component.html?id=task-list&cfg=cfg-comp-dialog'
];
