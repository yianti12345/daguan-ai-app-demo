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
    'templates.html': {object:'模版资产文件包',source:'复用原组件库卡片与工具栏',truth:'独立生成，模版更新不联动已创建应用',states:['空','启用','禁用','只读'],renderer:'UIK.AssetCard.template',layout:'sys.css .page-components #grid / .crow.ccard'},
    'template.html': {object:'独立模版的画布配置',source:'用户明确沿用原组件配置体验；模版配置无可用资产/编辑信息/文件按钮',truth:'预览/代码、对话、保存草稿、重置与发布；草稿优先恢复，重置回最新正式内容，不联动应用',states:['已有内容','空模版','生成中','未保存','只读'],toolbarActions:['act-draft','act-reset','act-publish'],forbiddenActions:['act-available','tm-detail-edit','tm-show-files']},
    'abilities.html': {
      object: '接口能力（仅创建人和管理员维护，按可用范围提供给应用创建和编辑）',
      source: '真源 /Expert/Management/SkillsLibrary 的列表形态；分组模型对齐 Coze「插件=工具集」与 MCP「server 含多个 tool」',
      truth: '一条记录 = 一个能力。接口是池子里的原子，能力只记 apiIds，不复制接口字段',
      states: ['无能力', '有数据', '搜索无结果', '说明书生成中', '说明书生成失败'],
      headCols: [
        { key: 'sel', label: '' },
        { key: 'name', label: '能力名称' },
        { key: 'desc', label: '说明' },
        { key: 'cnt', label: '接口数' },
        { key: 'docState', label: '能力说明书' },
        { key: 'source', label: '来源' },
        { key: 'scope', label: '可用范围' },
        { key: 'owner', label: '创建人' },
        { key: 'enabled', label: '启用状态' },
        { key: 'at', label: '更新时间' },
        { key: 'ops', label: '操作' }
      ],
      cols: '40px 140px minmax(160px,1fr) 64px 90px 80px 88px 64px 80px 132px 112px'
    },
    /* ★2026-11-05 补：这两页此前也没有规格（preflight 报「spec.js 里没有这一页」）。
       批量升级的三处入口都在它们身上，先把"这一页在管什么"写下来，再谈按钮。 */
    'components.html': {object:'旧组件入口',source:'2026-11-11用户确认模版资产',truth:'只跳转模版管理，不提供装配或升级',states:['跳转']},
    'app.html': {object:'独立应用内容与草稿、发布版本',source:'2026-11-11用户确认接口能力与模版资产',truth:'授权资产自动发现；模版仅作生成参考，后续修改不联动应用',states:['空应用','有内容','有未保存改动','未上架','内测中','已上架','已下架']},
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
      object: '模型（对话/向量/重排/语音）以及各场景绑定哪一个',
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
      source: '真源 /Expert/Management/SkillsLibrary（skill名称/skill描述/是否启用/最近更新时间/创建人/操作）',
      truth: '真源实测：表头 39 / #F2F3F5 / 600，行 69，主按钮 106.7×32 r2',
      states: ['无技能', '有数据', '搜索无结果', '已停用'],
      headCols: [
        { key: 'name', label: 'skill名称' },
        { key: 'desc', label: 'skill描述' },
        { key: 'on', label: '是否启用' },
        { key: 'at', label: '最近更新时间' },
        { key: 'by', label: '创建人' },
        { key: 'ops', label: '操作' }
      ],
      cols: '220px minmax(200px,1fr) 100px 160px 130px 120px'
    },
    'versions.html': {
      object: '版本（应用或模版的版本存档）',
      source: '_docs/基线-版本管理.md',
      truth: '真源 /Expert/TaskCenter/History（表头 39/#F2F3F5/600、行 69）',
      states: ['无版本', '只有 1 版（只有查看）', '多版（历史行可复制为新版本）', '搜索无匹配'],
      headCols: [
        { key: 'v', label: '版本', cls: 'vl-v' },
        { key: 'st', label: '状态' },
        { key: 'creator', label: '创建人' },
        { key: 'at', label: '保存时间', cls: 'vl-at' },
        { key: 'ops', label: '操作', cls: 'vl-o' }
      ],
      /* 2026-11-04 按真源改：原来把 1fr 给了操作列，4 列里最后一列吃掉 600+ px，
         1 行时「查看」孤零零挂在最右、中间全空 —— 用户截图说「列表真的合理吗」。
         创建人与保存时间分配剩余，操作列固定 184 靠右，和真源列表的收口一致。 */
      cols: '96px 120px minmax(120px,1fr) minmax(180px,1fr) 184px',
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
          cols: '40px 170px 190px minmax(130px,1fr) 96px 200px 210px'
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
          cols: '40px minmax(130px,1fr) 220px 96px 200px 210px'
        }
      }
    }
  };
});
