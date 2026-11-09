/* 规格唯一真源（2026-11-04 · 根治 A+C）
   ────────────────────────────────────────────────────────────────
   这一份文件同时给三个消费者用，避免"同一件事三份手写"：
     · 浏览器：页面渲染（assets/list.js 的 spec 从这里来）
     · 判据：tools/baseline.mjs 直接 require 本文件，check-baseline-oracle 对账
     · 人：_docs/基线-*.md 是它的解释版，机器以本文件为准

   ★ A 的拦截在这里：object / states / source 三个字段是**必填**。
     assets/list.js 的 assertSpec 会在渲染时检查，缺一个就把页面挡下来 ——
     不是写进提醒、不是又加一条判据，而是"没答这三问就出不了界面"。
       object  = 这一页的主对象是谁（授权关系 / 版本 / 客户 / 组件）
       states  = 它有哪几种状态（空 / 只有一条 / 落后 / 已取消 / 搜索无结果）
       source  = 真源与基线表对应哪一屏
*/
(function (root, factory) {
  var SPEC = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = SPEC;
  else root.SPEC = SPEC;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    'abilities.html': {
      object: '能力（一个独立任务：由一到多个接口组成，产出一份 MD 给模型读）',
      source: '真源 /Expert/Management/SkillsLibrary 的列表形态；分组模型对齐 Coze「插件=工具集」与 MCP「server 含多个 tool」',
      truth: '一条记录 = 一个能力。接口是池子里的原子，能力只记 apiIds，不复制接口字段',
      states: ['无能力', '有数据', '搜索无结果', '说明书生成中', '说明书生成失败'],
      headCols: [
        { key: 'name', label: '能力名称' },
        { key: 'desc', label: '说明' },
        { key: 'cnt', label: '接口数' },
        { key: 'md', label: '能力说明书' },
        { key: 'at', label: '更新时间' },
        { key: 'ops', label: '操作' }
      ],
      cols: '200px minmax(220px,1fr) 80px 110px 150px 130px'
    },
    /* ★2026-11-05 补：这两页此前也没有规格（preflight 报「spec.js 里没有这一页」）。
       批量升级的三处入口都在它们身上，先把"这一页在管什么"写下来，再谈按钮。 */
    'components.html': {
      object: '一个组件（可被应用装配的积木，有版本、有引用它的应用）',
      source: '用户口径 2026-11-04：「组件升级要能一键选择、批量升级、全部升级」',
      truth: '引用关系由应用侧的装配记录反查（DB.compRefs），组件页不另存一份',
      /* 2026-11-06：原来写「未上架/内测中/已上架」，而数据层 DB.compState 只产出「未发布/启用/禁用」——
         规格写的词实现永远产不出来，等于这三条状态是纸面上的。改成实现真有的，并保留两个跨表状态。 */
      states: ['未发布', '启用', '禁用', '有应用落后待升级', '没有应用在用']
    },
    'app.html': {
      object: '一个应用的装配结构（装哪些组件、各装哪一版）与它的发布状态',
      source: '用户口径 2026-11-04：「装配组件里要有批量升级和全部升级，跟引用管理一样」',
      truth: '装配版本写在应用的 compVer 上；组件升级只改这一处，不动应用内容与客户授权版本',
      /* 2026-11-06：「已发布」是 apps.html:78 明确否决过的词（数据层从不产出），规格里却写着。
         改成实现真有的四态：未上架 / 内测中 / 已上架 / 已下架。 */
      states: ['空应用', '单栏', '双栏', '有组件待升级', '有未保存改动', '未上架', '内测中', '已上架', '已下架']
    },
    /* ★2026-11-05 补：这页此前没有规格 —— preflight 报「spec.js 里没有这一页」，
       也就是说能力详情是从想法直接写成界面的。三问补在这里，改之前先对一遍。 */
    'ability.html': {
      object: '一个能力（名称 + 说明 + 一组接口 + 一份能力说明书）',
      source: '用户口径 2026-11-05：「一个接口做不成一件事，能力=一组接口」「建能力就要生成说明书，装配的其实就是说明书」',
      truth: '说明书由「生成」按钮产出、也能手改；接口在这一页维护（手填或贴文档拆），不从别的清单里勾',
      states: ['新建空能力', '有接口还没生成', '生成中', '已生成', '这次没生成出来', '接口变了说明书没跟上']
    },
    'interfaces.html': {
      object: '能力（登记进来的外部 API 与它的能力说明书，模型写组件时读的就是这份说明书）',
      source: '真源 /Expert/Management/SkillsLibrary 的列表形态（8 列 / 表头 39 / 行 69 / 分页 15 条）',
      truth: '能力管理下新增第 8 项；列与技能页同一套',
      states: ['无能力', '有数据', '搜索无结果', '生成失败', '已停用'],
      headCols: [
        { key: 'sel', label: '' },
        { key: 'name', label: '名称' },
        { key: 'desc', label: '描述' },
        { key: 'source', label: '来源' },
        { key: 'at', label: '最近更新时间' },
        { key: 'state', label: '状态' },
        { key: 'ops', label: '操作' }
      ],
      cols: '40px 200px minmax(200px,1fr) 140px 150px 130px 176px'
    },
    'config.html': {
      object: '模型（对话/视觉/向量/重排）以及各场景绑定哪一个',
      source: '真源 /Expert/Management/Config（真源页面名是「能力配置」，这里叫模型配置，避免与一级的「能力管理」撞出"能力XX"；默认模型不可下线，温度/迭代/输出上限/上下文）',
      truth: '按场景绑定建模：应用配置对话 / 组件配置对话 / 技能生成',
      states: ['无模型', '有数据', '有停用项', '默认模型'],
      headCols: [
        { key: 'name', label: '模型' },
        { key: 'vendor', label: '供应商' },
        { key: 'conn', label: '连接' },
        { key: 'temp', label: '温度' },
        { key: 'react', label: '最大迭代' },
        { key: 'outMax', label: '输出上限' },
        { key: 'ctx', label: '上下文' },
        { key: 'on', label: '状态' },
        { key: 'ops', label: '操作' }
      ],
      cols: '240px 120px 84px 80px 110px 120px 110px 90px 150px'
    },
    'skills.html': {
      object: '技能（直接装给小智的技能包，只有一个归属：小智）',
      source: '真源 /Expert/Management/SkillsLibrary（skill名称/可用范围/skill描述/状态/是否启用/最近更新时间/创建人/操作）',
      truth: '真源实测：表头 39 / #F2F3F5 / 600，行 69，主按钮 106.7×32 r2',
      states: ['无技能', '有数据', '搜索无结果', '已停用'],
      headCols: [
        { key: 'name', label: 'skill名称' },
        { key: 'scope', label: '可用范围' },
        { key: 'desc', label: 'skill描述' },
        { key: 'on', label: '是否启用' },
        { key: 'at', label: '最近更新时间' },
        { key: 'by', label: '创建人' },
        { key: 'ops', label: '操作' }
      ],
      cols: '220px 110px minmax(200px,1fr) 100px 160px 130px 120px'
    },
    'versions.html': {
      object: '版本（应用或组件的版本存档）',
      source: '_docs/基线-版本管理.md',
      truth: '真源 /Expert/TaskCenter/History（表头 39/#F2F3F5/600、行 69）',
      states: ['无版本', '只有 1 版（只有查看）', '多版（历史行可复制为新版本）', '搜索无匹配'],
      headCols: [
        { key: 'v', label: '版本', cls: 'vl-v' },
        { key: 'st', label: '状态' },
        { key: 'at', label: '保存时间', cls: 'vl-at' },
        { key: 'ops', label: '操作', cls: 'vl-o' }
      ],
      /* 2026-11-04 按真源改：原来把 1fr 给了操作列，4 列里最后一列吃掉 600+ px，
         1 行时「查看」孤零零挂在最右、中间全空 —— 用户截图说「列表真的合理吗」。
         现在让保存时间吃掉剩余，操作列固定 120 靠右，和真源列表的收口一致。 */
      cols: '96px 120px minmax(200px,1fr) 120px',
      status: ['当前版本', '历史版本'],
      actions: { current: ['查看'], history: ['查看', '复制为新版本'] },
      forbidden: ['恢复', '在用的客户', '改了什么', '当前版本 v']
    },
    'client-auth.html': {
      /* ★2026-11-05：这一页的自造字段出过太多次（新建客户、授权版本、有效期、撤销…），
         所以打开列级来源校验：每列 / 每个操作都必须写明「真源有 / 用户说过 / 我加的（带到期日）」。 */
      requireColFrom: true,
      object: '授权关系（应用 × 客户）——不是客户池',
      source: '_docs/基线-客户授权.md',
      truth: '真源 /AuditAgent/AppManage/ClientConfig/775',
      states: ['应用不存在', '有版本、0 授权', 'N 条授权全部最新', '有落后版本', '搜索无匹配', '版本筛选', '弹窗里客户池全授完'],
      actions: { always: ['取消授权', '编辑客户'], behind: ['升级版本'] },
      forbidden: ['未授权', '恢复授权', '删除记录', '批量授权'],
      /* 全局页带上「应用」列；进到某个应用后上下文已定，列组合少一列 */
      variants: {
        global: {
          headCols: [
            { key: 'pick', label: '', docLabel: '选择框', cls: 'au-sel', from: 'user' },
            { key: 'client', label: '客户', cls: 'au-c', from: 'truth' },
            { key: 'tenant', label: '租户 ID', cls: 'au-id', from: 'truth' },
            { key: 'app', label: '应用', cls: 'au-app', from: 'truth' },
            { key: 'ver', label: '授权版本', cls: 'au-ver', from: 'user' },
            { key: 'exp', label: '有效期', cls: 'au-exp', from: 'truth' },
            { key: 'ops', label: '操作', cls: 'au-o', from: 'user' }
          ],
          /* ★2026-11-05（用户选 A：保留版本与升级，风格照真源）：
             真源的「有效期」是区间（2026-11-05 ~ 2027-11-01），起点就是授权日 ——
             所以原来单独的「授权时间」列是同一个数的第二次出现，删掉。 */
          cols: '40px 170px 190px minmax(0,1fr) 96px 200px 210px'
        },
        sub: {
          headCols: [
            { key: 'pick', label: '', docLabel: '选择框', cls: 'au-sel', from: 'user' },
            { key: 'client', label: '客户', cls: 'au-c', from: 'truth' },
            { key: 'tenant', label: '租户 ID', cls: 'au-id', from: 'truth' },
            { key: 'ver', label: '授权版本', cls: 'au-ver', from: 'user' },
            { key: 'exp', label: '有效期', cls: 'au-exp', from: 'truth' },
            { key: 'ops', label: '操作', cls: 'au-o', from: 'user' }
          ],
          /* 列宽：客户吃掉剩余，其余按内容收口；操作列 210 放得下两颗按钮。 */
          cols: '40px minmax(0,1fr) 220px 96px 200px 210px'
        }
      }
    }
  };
});
