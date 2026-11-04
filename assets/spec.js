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
      cols: '96px 120px 200px minmax(0,1fr)',
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
