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
    'interfaces.html': {
      object: '能力（登记进来的外部 API 及其说明书，模型写组件时读的就是它）',
      source: '真源 /Expert/Management/SkillsLibrary 的列表形态（8 列 / 表头 39 / 行 69 / 分页 15 条）',
      truth: '能力管理下新增第 8 项；列与技能页同一套',
      states: ['无能力', '有数据', '搜索无结果', '生成失败', '已停用'],
      headCols: [
        { key: 'name', label: '名称' },
        { key: 'desc', label: '描述' },
        { key: 'source', label: '来源' },
        { key: 'at', label: '最近更新时间' },
        { key: 'by', label: '创建人' },
        { key: 'ops', label: '操作' }
      ],
      cols: '200px minmax(240px,1fr) 140px 150px 130px 120px'
    },
    'config.html': {
      object: '模型（对话/视觉/向量/重排）以及各场景绑定哪一个',
      source: '真源 /Expert/Management/Config（真源页面名是「能力配置」，这里叫模型配置，避免与一级的「能力管理」撞出"能力XX"；默认模型不可下线，温度/迭代/输出上限/上下文）',
      truth: '按场景绑定建模：应用配置对话 / 组件配置对话 / 技能生成',
      states: ['无模型', '有数据', '有停用项', '默认模型'],
      headCols: [
        { key: 'name', label: '模型' },
        { key: 'vendor', label: '供应商' },
        { key: 'kind', label: '类型' },
        { key: 'temp', label: '温度' },
        { key: 'react', label: '最大迭代' },
        { key: 'outMax', label: '输出上限' },
        { key: 'ctx', label: '上下文' },
        { key: 'on', label: '状态' },
        { key: 'ops', label: '操作' }
      ],
      cols: '220px 100px 80px 70px 100px 110px 110px 90px 150px'
    },
    'skills.html': {
      object: '技能（小智的专属技能包）',
      source: '真源 /Expert/Management/SkillsLibrary（skill名称/可用范围/skill描述/状态/是否启用/最近更新时间/创建人/操作）',
      truth: '真源实测：表头 39 / #F2F3F5 / 600，行 69，主按钮 106.7×32 r2',
      states: ['无技能', '有数据', '搜索无结果', '生成失败', '已停用'],
      headCols: [
        { key: 'name', label: 'skill名称' },
        { key: 'scope', label: '可用范围' },
        { key: 'desc', label: 'skill描述' },
        { key: 'state', label: '状态' },
        { key: 'on', label: '是否启用' },
        { key: 'at', label: '最近更新时间' },
        { key: 'by', label: '创建人' },
        { key: 'ops', label: '操作' }
      ],
      cols: '160px 100px minmax(180px,1fr) 90px 90px 150px 130px 140px'
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
            { key: 'pick', label: '', docLabel: '选择框', cls: 'au-sel' },
            { key: 'client', label: '客户', cls: 'au-c' },
            { key: 'tenant', label: '租户 ID', cls: 'au-id' },
            { key: 'app', label: '应用', cls: 'au-app' },
            { key: 'ver', label: '授权版本', cls: 'au-ver' },
            { key: 'at', label: '授权时间', cls: 'au-at' },
            { key: 'exp', label: '有效期', cls: 'au-exp' },
            { key: 'ops', label: '操作', cls: 'au-o' }
          ],
          cols: '40px 170px 190px minmax(0,1fr) 80px 150px 108px 240px'
        },
        sub: {
          headCols: [
            { key: 'pick', label: '', docLabel: '选择框', cls: 'au-sel' },
            { key: 'client', label: '客户', cls: 'au-c' },
            { key: 'tenant', label: '租户 ID', cls: 'au-id' },
            { key: 'ver', label: '授权版本', cls: 'au-ver' },
            { key: 'at', label: '授权时间', cls: 'au-at' },
            { key: 'exp', label: '有效期', cls: 'au-exp' },
            { key: 'ops', label: '操作', cls: 'au-o' }
          ],
          cols: '40px minmax(0,1fr) 220px 80px 150px 108px 240px'
        }
      }
    }
  };
});
