/* states.mjs —— **全站"真实可达状态"的唯一来源。**

 * 为什么要有它（2026-10-23）：
 *   px-parity 的基线只截 `component.html`（无参数）＝**空态页**。
 *   而人真正在看的是 `component.html?id=app-header`（有画布内容的页）。
 *   于是"四页 0.0000 / 全绿"这句话，在最重要的那一页上从来没有成立过 ——
 *   我改的全是 `.bd-*` 和 `.page`，空态页里根本没有这些元素。
 *
 *   根因不是基线选错了，是**页面清单里从来没有"状态"这一维**：
 *   PAGES 只有 4 个文件名，而真实可达的是 4 页 × N 个实体参数。
 *
 * 规则：任何要遍历页面的判据，一律从这里取清单；
 *   不许再写 `['apps.html','components.html']` 这种只有文件名的数组。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');

/* 从 data.js 抽实体 id —— 清单必须来自数据源，不许手抄。
   手抄的下场：新增一个组件后遍历清单不会变，新页面永远没人扫。 */
/* 种子里的键是小写 `apps:` / `comps:`（data.js 的 DB 是 DB.APPS / DB.COMPS，两套大小写）。
   切段必须切到 `],` 为止 —— 否则 comps 段会吃掉后面 APP_COMPS 的 id，
   把应用 id 当成组件 id 去渲染，得到的是一页空画布而不是报错。 */
function ids(key) {
  const src = fs.readFileSync(path.join(DEMO, 'assets/data.js'), 'utf8');
  const i = src.indexOf('\n      ' + key + ': [');
  if (i < 0) return [];
  const rest = src.slice(i);
  const end = rest.indexOf('\n      ],');
  const seg = end > 0 ? rest.slice(0, end) : rest;
  const out = new Set();
  for (const m of seg.matchAll(/id:\s*'([a-z0-9-]+)'/g)) out.add(m[1]);
  return [...out];
}

export const COMP_IDS = ids('comps');
export const APP_IDS = ids('apps');

/* 四类页面形态：
   list  —— 列表页，无参数
   empty —— 画布页的空态（无参数），它是**错误路径**，不是主路径
   state —— 画布页的真实内容（带 id）
   cfg   —— 配置器形态（带 cfg=），独立子系统，不在视觉统一面上 */
/* ★2026-10-30：加「下载客户端」页 —— 它是对外的交付入口，不是后台工具页。
   不进这份清单的页面，等于没有任何视觉/可用性判据看着它。 */
export const LIST = ['apps.html', 'components.html', 'downloads.html'];
/* ★ 2026-10-24：`app.html` 不再进 EMPTY。P1-7 修掉「裸 app.html 静默回落 APPS[0]」之后，
   裸地址是**跳转**（`apps.html?pick=1`），它已经不是"应用页的空态"了。
   应用页真正能走到的空态只有一个：装得下但一个模块都没装的 `app.html?id=gf-xm`（已在 STATE_URLS 里）。 */
export const EMPTY = ['component.html'];

export const STATE_URLS = [
  ...COMP_IDS.map((id) => `component.html?id=${id}`),
  ...APP_IDS.map((id) => `app.html?id=${id}`)
];

/* 全量清单：体检脚本默认扫这个 */
export const ALL_URLS = [...LIST, ...STATE_URLS];

/* 视觉基线只该覆盖"有人会看的页"：列表页 + 真实内容页。
   空态页进清单但单独标 —— 它有基线（防它自己坏），但不该代表真实页面。 */
export const BASELINE_URLS = [...LIST, ...STATE_URLS, ...EMPTY];

/* ══ 显式不可截：**这份清单是"缺口"，不是"没问题"** ═══════════════════════
   2026-10-26，零上下文盲审第 12 条原话：
     「12 张里没有一张"列表为空""搜索无结果""加载中""操作失败"……
       实施在客户现场最先撞的就是这几个屏，撞到时没有一句话可依。」

   四类里两类已经补进 tools/blind-inputs.mjs 的 INTERACTIVE（都是真点出来的，
   不是摆拍）：列表无结果 / 搜索无结果 / 已装配页签 / 筛选空结果。

   剩下两类补不了。原因写在下面，写下来的目的是**不让下一个人以为这里已经覆盖了**：

   · 「加载中」——没有可加载的东西。
     apps / components / app / component / versions 五页全是静态 HTML + assets/*.js，
     数据来自 localStorage 里的种子（data.js 同步注入），没有任何一次 fetch / XHR /
     lazyload。全站唯一的"等待"是 app.js doInstall 里的 450ms 进度条，
     而它自己的注释写着「进度条走到头才提交，是为了让人看清这一行正在装配」——
     那是动画节奏，不是网络等待。没有请求就没有加载态。
     真要截"加载中"，只能 setTimeout 里摆一块骨架屏 —— 那是伪造。

   · 「操作失败」——没有会失败的东西。
     没有后端就没有失败返回。全站唯一的失败路径是 `app.html?fail=1`
     （app.js：failDemo = qs.get('fail') === '1'；FAIL_ID = 'doc-extract'），
     紧挨着它的注释是「?fail=1＝故障注入开关：验证『装配失败 + 撤销』这条恢复路径，
     不是业务入口」。它是给 e2e 用的夹具，用户走不到 ——
     把 ?fail=1 的截图当"操作失败态"交出去，等于用一张自己造出来的图
     证明"我们处理了失败"。这正是本轮盲审最反感的那件事（"我用一张错的图，
     让他们得出了错的结论"），不做。

   规则：
     ① 这份清单里的东西，KPI / 报告里一律按**未覆盖**计，不许写成"已考虑"；
     ② 谁要说"加载中/失败态做过了"，先从这里删掉对应行，并且拿出真触发路径；
     ③ 接了真后端之后，这两类必须各补一张真图 —— 届时删行，不是加注释。 */
export const UNSCREENSHOTABLE = [
  {
    state: '加载中',
    why: '无网络请求：五页均为静态 HTML + localStorage 种子（data.js 同步注入），无 fetch/XHR；' +
         '唯一等待是 app.js doInstall 的 450ms 装配进度条，属动画节奏不是加载态'
  },
  {
    state: '操作失败',
    why: '无后端失败返回；唯一失败路径是 app.html?fail=1 故障注入开关（app.js failDemo + FAIL_ID），' +
         '其注释自述"验证恢复路径，不是业务入口"，属 e2e 夹具，截图即伪造'
  }
];

export { DEMO };
