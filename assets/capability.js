/* capability.js —— 能力数据（接口 / 技能 / 组件的接口装配关系）
   为什么不塞进 data.js：data.js 有自己的种子版本与整库覆盖机制，
   这里是一块新资产，单独一个 key，互不影响。
   读写：localStorage 'ifas90:cap'；组件装配关系另存 'ifas90:comp-apis'。 */
(function () {
  'use strict';

  var KEY = 'ifas90:cap';
  var COMP_KEY = 'ifas90:comp-apis';

  var SEED = {
    apis: [
      { id: 'api-audit-tasks', name: '审核任务查询', desc: '按状态与时间分页查询审核任务，返回任务编号、审核结论与耗时。', source: '华信证券', state: 'ok', on: true, at: '2026-11-04 15:20', by: '系统超级管理员' },
      { id: 'api-audit-write', name: '审核结果回写', desc: '把人工复核结论回写到业务系统，支持单条与批量。', source: '华信证券', state: 'ok', on: true, at: '2026-11-04 15:18', by: '系统超级管理员' },
      { id: 'api-client-mdm', name: '客户主数据查询', desc: '按客户编号取主体信息、证照与风险等级。', source: '中金公司', state: 'ok', on: true, at: '2026-11-03 11:42', by: '系统超级管理员' },
      { id: 'api-contract-extract', name: '合同要素抽取', desc: '从合同正文抽取金额、期限、对手方与付款节点。', source: '海立电器', state: 'run', on: true, at: '2026-11-05 09:12', by: '系统超级管理员' },
      { id: 'api-invoice-check', name: '发票验真', desc: '对接税务平台校验发票代码、号码与开票金额。', source: '潍柴动力', state: 'fail', on: false, at: '2026-11-02 16:05', by: '系统超级管理员' },
      { id: 'api-supplier', name: '供应商准入查询', desc: '查询供应商准入状态、黑名单与授信额度。', source: '潍柴动力', state: 'ok', on: true, at: '2026-11-02 15:51', by: '系统超级管理员' },
      { id: 'api-fin-report', name: '财报三表勾稽', desc: '资产负债表、利润表、现金流量表交叉勾稽，返回差异项。', source: '申万宏源', state: 'ok', on: true, at: '2026-11-01 10:33', by: '系统超级管理员' },
      { id: 'api-bond-rating', name: '债券主体评级', desc: '按债券代码取主体评级、评级展望与历史变动。', source: '中信建投', state: 'ok', on: false, at: '2026-10-30 17:26', by: '系统超级管理员' }
    ],
    skills: [
      { id: 'sk-fin-check', name: '财报三表勾稽', scope: '仅自己', desc: '核对三表之间的勾稽关系，输出差异项与建议。', state: 'ok', on: true, at: '2026-11-04 14:08', by: '系统超级管理员' },
      { id: 'sk-contract', name: '合同条款比对', scope: '全平台', desc: '按标准条款库比对合同差异，标出缺失与偏离。', state: 'ok', on: true, at: '2026-11-03 09:40', by: '系统超级管理员' },
      { id: 'sk-invoice', name: '发票要素核验', scope: '仅自己', desc: '核验发票抬头、税号、金额与业务单据是否一致。', state: 'ok', on: false, at: '2026-11-01 18:22', by: '系统超级管理员' },
      { id: 'sk-dd', name: '尽调清单核验', scope: '仅自己', desc: '按尽调清单逐项核对底稿，缺件与超期单独列出。', state: 'fail', on: false, at: '2026-10-29 16:56', by: '系统超级管理员' }
    ]
  };

  /* 种子说明书：接口是给模型读的知识，列表里一句描述不够用，详情与生成上下文都要完整版。
     老数据（localStorage 里存过但没有 doc 的）在 load() 里按 id 自动补上。 */
  var DOCS = {
    'api-audit-tasks': {
      doc: '### 审核任务查询\n\n**用途**：按状态、时间与核心专家分页查询审核任务。\n\n**调用**：`GET /api/v1/audit/tasks?page=1&per_page=10&status=done`\n\n**入参**：page 页码；per_page 每页条数（≤50）；status 审核状态；expert 核心专家；start / end 审核开始时间区间。\n\n**返回**：`{ total, items: [{ taskNo, status, aiResult, humanResult, startedAt, finishedAt, duration }] }`',
      raw: "curl 'https://audit.example.com/api/v1/audit/tasks?page=1&per_page=10&status=done' -H 'Authorization: Bearer <token>'"
    },
    'api-audit-write': {
      doc: '### 审核结果回写\n\n**用途**：把人工复核结论回写到业务系统，支持单条与批量。\n\n**调用**：`POST /api/v1/audit/results`\n\n**入参**：taskNo 任务编号；result 结论（pass / reject / manual）；reason 说明；operator 复核人。\n\n**返回**：`{ ok, applied, failed: [{ taskNo, why }] }`',
      raw: 'POST /api/v1/audit/results  body: {"taskNo":"A20261104001","result":"reject","reason":"发票金额不符","operator":"admin"}'
    },
    'api-client-mdm': {
      doc: '### 客户主数据查询\n\n**用途**：按客户编号取主体信息、证照与风险等级。\n\n**调用**：`GET /api/v1/clients/{clientId}`\n\n**入参**：clientId 客户编号。\n\n**返回**：`{ clientId, name, licenses: [], riskLevel, updatedAt }`',
      raw: 'GET /api/v1/clients/C00012 —— 返回客户名称、证照清单、风险等级'
    },
    'api-contract-extract': {
      doc: '### 合同要素抽取\n\n**用途**：从合同正文抽取金额、期限、对手方与付款节点。\n\n**调用**：`POST /api/v1/contracts/extract`\n\n**入参**：fileId 文件编号，或 text 正文。\n\n**返回**：`{ amount, currency, term, counterparty, payments: [{ node, ratio, due }] }`',
      raw: '把合同 PDF 传上去，要能拿到金额、期限、对手方、付款节点'
    },
    'api-invoice-check': {
      doc: '### 发票验真\n\n**用途**：对接税务平台校验发票代码、号码与开票金额。\n\n**调用**：`POST /api/v1/invoices/verify`\n\n**入参**：code 发票代码；number 发票号码；date 开票日期；amount 金额。\n\n**返回**：`{ valid, taxNo, amount, message }`',
      raw: 'curl -X POST /api/v1/invoices/verify -d "code=033001900111&number=12345678"'
    },
    'api-supplier': {
      doc: '### 供应商准入查询\n\n**用途**：查询供应商准入状态、黑名单与授信额度。\n\n**调用**：`GET /api/v1/suppliers/{id}`\n\n**入参**：id 供应商编号。\n\n**返回**：`{ id, name, admitted, blacklisted, creditLimit }`',
      raw: 'GET /api/v1/suppliers/S0088 查准入、黑名单、授信额度'
    },
    'api-fin-report': {
      doc: '### 财报三表勾稽\n\n**用途**：资产负债表、利润表、现金流量表交叉勾稽，返回差异项。\n\n**调用**：`POST /api/v1/fin/check`\n\n**入参**：period 报告期；statements 三表数据。\n\n**返回**：`{ balanced, diffs: [{ item, expected, actual, gap }] }`',
      raw: 'POST /api/v1/fin/check  传报告期和三张表，返回是否勾稽、差异项'
    },
    'api-bond-rating': {
      doc: '### 债券主体评级\n\n**用途**：按债券代码取主体评级、评级展望与历史变动。\n\n**调用**：`GET /api/v1/bonds/{code}/rating`\n\n**入参**：code 债券代码。\n\n**返回**：`{ code, issuer, rating, outlook, history: [{ date, rating }] }`',
      raw: 'GET /api/v1/bonds/012345/rating'
    }
  };

  var cache = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try { cache = JSON.parse(raw); } catch (e) { cache = clone(SEED); }
    } else {
      cache = clone(SEED);
      save();
    }
    if (!cache.apis) cache.apis = [];
    if (!cache.skills) cache.skills = [];
    /* 老存档里没有说明书：按 id 从种子补一次，不覆盖用户自己写过的。 */
    cache.apis.forEach(function (a) {
      var d = DOCS[a.id];
      if (!d) return;
      if (!a.doc) a.doc = d.doc;
      if (!a.raw) a.raw = d.raw;
    });
    return cache;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* 写不进去也不阻断演示 */ }
  }

  function now() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function uid(prefix) { return prefix + '-' + Date.now().toString(36); }

  /* ── 接口 ─────────────────────────────────────────── */
  function apis() { return load().apis; }
  function apiById(id) { return load().apis.filter(function (x) { return x.id === id; })[0] || null; }
  function addApi(v) {
    var it = Object.assign({ id: uid('api'), state: 'ok', on: true, at: now(), by: '系统超级管理员' }, v);
    load().apis.unshift(it); save(); return it;
  }
  function updateApi(id, patch) {
    var it = apiById(id); if (!it) return null;
    Object.assign(it, patch, { at: now() }); save(); return it;
  }
  function removeApi(id) {
    var d = load(); d.apis = d.apis.filter(function (x) { return x.id !== id; });
    var m = compMap();
    Object.keys(m).forEach(function (k) { m[k] = m[k].filter(function (x) { return x !== id; }); });
    saveCompMap(m); save();
  }
  function toggleApi(id) { var it = apiById(id); if (it) { it.on = !it.on; it.at = now(); save(); } return it; }

  /* ── 技能 ─────────────────────────────────────────── */
  function skills() { return load().skills; }
  function addSkill(v) {
    var it = Object.assign({ id: uid('sk'), scope: '仅自己', state: 'ok', on: true, at: now(), by: '系统超级管理员' }, v);
    load().skills.unshift(it); save(); return it;
  }
  function removeSkill(id) { var d = load(); d.skills = d.skills.filter(function (x) { return x.id !== id; }); save(); }
  function updateSkill(id, patch) {
    var it = load().skills.filter(function (x) { return x.id === id; })[0];
    if (!it) return null;
    Object.assign(it, patch, { at: now() }); save(); return it;
  }
  function toggleSkill(id) { var it = load().skills.filter(function (x) { return x.id === id; })[0]; if (it) { it.on = !it.on; it.at = now(); save(); } return it; }
  function skillById(id) { return load().skills.filter(function (x) { return x.id === id; })[0] || null; }

  /* ── 组件 ↔ 接口 ───────────────────────────────────── */
  function compMap() {
    var raw = null;
    try { raw = localStorage.getItem(COMP_KEY); } catch (e) { raw = null; }
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  function saveCompMap(m) {
    try { localStorage.setItem(COMP_KEY, JSON.stringify(m)); } catch (e) { /* 同上 */ }
  }
  function compApis(compId) { return (compMap()[compId] || []).slice(); }
  function setCompApis(compId, ids) {
    var m = compMap();
    m[compId] = (ids || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
    saveCompMap(m); return m[compId];
  }

  window.CAP = {
    load: load, save: save,
    apis: apis, apiById: apiById, addApi: addApi, updateApi: updateApi, removeApi: removeApi, toggleApi: toggleApi,
    skills: skills, skillById: skillById, addSkill: addSkill, updateSkill: updateSkill, removeSkill: removeSkill, toggleSkill: toggleSkill,
    compApis: compApis, setCompApis: setCompApis,
    now: now
  };
})();
