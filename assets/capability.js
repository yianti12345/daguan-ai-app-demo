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

  /* ── 从一段原始材料里抽出方法 / 路径：老数据只有 id 和一段文本 ── */
  function pickMethodPath(raw) {
    var t = String(raw || '');
    var m = (t.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD)\b/) || [])[1] || 'GET';
    /* 先摘出完整地址再取路径。之前的正则会让「https://host/a/b/c」只剩下 /c ——
       因为协议段是贪婪匹配，回头只吐出最短的尾段。 */
    var u = (t.match(/https?:\/\/[^\s'"]+/) || [])[0];
    var path = '';
    if (u) {
      path = u.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0];
    } else {
      var m2 = t.match(/(?:^|\s)(\/[A-Za-z0-9_\-./{}:]+)/);
      path = m2 ? m2[1].split(/[?#]/)[0] : '';
    }
    return { method: m, path: path };
  }

  /* 接口指纹：同一份文档贴两次不会长出两条。老数据保留原 id，新导入才用指纹。 */
  function fingerprint(method, path, host) {
    var str = (method || '').toUpperCase() + ' ' + (host || '') + (path || '');
    var h = 5381, i;
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
    return 'api-' + (h >>> 0).toString(36);
  }

  /* ── v1 → v2：一条记录=一个接口  变成  能力(容器) + 接口(原子)
     迁移原则：老 id 一律保留（装配关系不断），每个老接口都变成一个「只含自己的」能力。 */
  function migrateV2(c) {
    c.apis = c.apis || [];
    c.apis.forEach(function (a) {
      if (!a.summary) a.summary = a.desc || '';
      if (!a.project) a.project = a.source || '未标注';
      if (!a.method || !a.path) {
        var mp = pickMethodPath(a.raw);
        if (!a.method) a.method = mp.method;
        if (!a.path) a.path = mp.path;
      }
    });
    if (!c.abilities) {
      c.abilities = c.apis.map(function (a) {
        return {
          id: 'ab-' + String(a.id).replace(/^api-/, ''),
          name: a.name || '未命名能力',
          intro: a.desc || '',
          apiIds: [a.id],
          doc: a.doc || '',
          docState: a.doc ? 'ready' : 'fail',
          docAt: a.at || '',
          project: a.project || '未标注',
          at: a.at || now()
        };
      });
    }
    /* 装配关系：老的是 apiId，新的是 abilityId，按「能力里只有一个接口」反查 */
    var map = {}, nx = {}, m = compMap(), known = {};
    c.abilities.forEach(function (b) {
      known[b.id] = 1;
      (b.apiIds || []).forEach(function (aid) { if (!map[aid]) map[aid] = b.id; });
    });
    Object.keys(m || {}).forEach(function (k) {
      nx[k] = (m[k] || []).map(function (aid) { return map[aid]; })
        .filter(function (bid) { return bid && known[bid]; })
        .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    });
    saveCompMap(nx);
    c.schemaVersion = 2;
    save();
  }

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
    if (!cache.models) cache.models = JSON.parse(JSON.stringify(MODEL_SEED));
    if (!cache.scenes || !cache.scenes.some(function (x) { return x.key === 'config'; })) {
      cache.scenes = JSON.parse(JSON.stringify(SCENE_SEED));
    }
    /* ★顺序有讲究：必须**先补文档再迁移**。
       迁移要从 raw 里解析方法与路径，而种子的 apis 里根本没有 raw —— 先迁移的话
       每个接口都解析成 "GET + 空路径"，界面上「接口清单」的方法路径整列是「—」，
       新浏览器第一次打开就是这样（2026-11-05 在发布站上实测发现）。 */
    var fixed = false;
    cache.apis.forEach(function (a) {
      var d = DOCS[a.id];
      if (d) {
        if (!a.doc) { a.doc = d.doc; fixed = true; }
        if (!a.raw) { a.raw = d.raw; fixed = true; }
      }
      /* 已经迁移过、路径却还是空的老存档，这里补一次（幂等）。 */
      if (!a.path) {
        var mp = pickMethodPath(a.raw);
        if (mp.path) { a.path = mp.path; if (!a.method) a.method = mp.method; fixed = true; }
      }
    });
    if (fixed) save();
    /* ★2026-11-05：数据分两层。老存档（一条记录=一个接口）在这里自动变成
       「能力 + 接口池」，装配关系一并换 id。跑一次写 schemaVersion=2，之后不再跑。 */
    if (!cache.schemaVersion || cache.schemaVersion < 2) migrateV2(cache);
    /* 「生成中」只在页面开着的时候成立。刷新或关页之后还挂着 run，
       说明那次生成没跑完 —— 记账成失败，别让清单里永远转圈。 */
    var stale = false;
    (cache.abilities || []).forEach(function (b) {
      if (b.docState === 'run') { b.docState = 'fail'; b.docErr = '上次生成没跑完'; stale = true; }
      /* 老存档迁移出来的空壳：只有一个接口时，接口自己的文档就是这份能力的说明书
         （内容是真的，不是编的）。补上，别让清单里一直挂着"生成失败"。 */
      if (!b.doc && (b.apiIds || []).length === 1) {
        var only = cache.apis.filter(function (x) { return x.id === b.apiIds[0]; })[0];
        if (only && only.doc) {
          b.doc = only.doc; b.docState = 'ready'; b.docFrom = ''; b.docErr = '';
          if (!b.docAt) b.docAt = b.at || '';
          stale = true;
        }
      }
      /* 既没内容也没原因的「失败」，其实是"还没生成"—— 状态要说实话。 */
      if (b.docState === 'fail' && !b.doc && !b.docErr) { b.docState = 'none'; stale = true; }
    });
    if (stale) save();
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

  /* ── 模型与场景绑定 ──────────────────────────────────
     场景决定"在哪儿用哪个模型"：应用配置对话、组件配置对话、技能生成。
     模型清单是资产，场景是绑定；默认模型不可删除（真源同一口径）。 */
  var MODEL_SEED = [
    { id: 'm-ds-flash', name: 'deepseek-flash', label: 'DeepSeek Flash', vendor: 'DeepSeek', kind: 'chat', temp: 0.2, react: 50, outMax: 32768, ctx: 200000, isDefault: true, on: true },
    { id: 'm-qwen-max', name: 'qwen3-max', label: '通义千问 Max', vendor: '阿里云', kind: 'chat', temp: 0.1, react: 10, outMax: 32768, ctx: 128000, isDefault: false, on: true },
    { id: 'm-ds-vl', name: 'deepseek-vl', label: 'DeepSeek VL', vendor: 'DeepSeek', kind: 'vision', temp: 0.1, react: 10, outMax: 16384, ctx: 64000, isDefault: false, on: true },
    { id: 'm-embed', name: 'text-embedding-v4', label: 'Embedding v4', vendor: '阿里云', kind: 'embed', temp: 0, react: 0, outMax: 0, ctx: 8192, isDefault: false, on: true },
    { id: 'm-rerank', name: 'qwen3-rerank', label: 'Rerank', vendor: '阿里云', kind: 'rerank', temp: 0, react: 0, outMax: 0, ctx: 8192, isDefault: false, on: true }
  ];
  /* 2026-11-05（用户定稿）：「只需要一个就行，不需要多选切换，所以也就没有默认了」。
     场景只有两条：小智用哪个模型、配置页（应用/组件配置的对话）用哪个模型。
     一条场景一个模型，没有默认这回事，也就不需要"默认不可删"。 */
  var SCENE_SEED = [
    { key: 'xz', name: '小智使用模型', desc: '客户在应用里跟小智对话时用', model: 'm-ds-flash' },
    { key: 'config', name: '配置页使用模型', desc: '应用配置、组件配置的对话用', model: 'm-ds-flash' }
  ];


  function models() { return load().models || []; }
  function modelById(id) { return models().filter(function (x) { return x.id === id; })[0] || null; }
  function addModel(v) {
    var it = Object.assign({ id: uid('m'), kind: 'chat', temp: 0.2, react: 10, outMax: 32768, ctx: 128000, isDefault: false, on: true }, v);
    load().models.push(it); save(); return it;
  }
  function updateModel(id, patch) {
    var it = modelById(id); if (!it) return null;
    Object.assign(it, patch); save(); return it;
  }
  function removeModel(id) {
    var it = modelById(id);
    if (!it) return { error: '没有这个模型' };
    var d = load();
    d.models = d.models.filter(function (x) { return x.id !== id; });
    d.scenes.forEach(function (s) { if (s.model === id) s.model = (models()[0] || {}).id || ''; });
    save(); return { ok: true };
  }
  function toggleModel(id) {
    var it = modelById(id);
    if (!it) return { error: '没有这个模型' };
    it.on = !it.on; save(); return { ok: true };
  }
  function scenes() { return load().scenes || []; }
  function setSceneModel(key, modelId) {
    var s = (load().scenes || []).filter(function (x) { return x.key === key; })[0];
    if (s) { s.model = modelId; save(); }
    return s;
  }
  function sceneModel(key) {
    var s = (load().scenes || []).filter(function (x) { return x.key === key; })[0];
    var m = s ? modelById(s.model) : null;
    return m ? m.name : '';
  }

  /* 整包导出/导入：接后端前，至少让数据能跟着人走。 */
  function exportAll() {
    return { v: 1, at: now(), apis: load().apis, skills: load().skills,
             models: load().models, scenes: load().scenes, compApis: compMap() };
  }
  function importAll(obj) {
    if (!obj || typeof obj !== 'object') return { error: '不是有效的 JSON' };
    var d = load();
    if (Array.isArray(obj.apis)) d.apis = obj.apis;
    if (Array.isArray(obj.skills)) d.skills = obj.skills;
    if (Array.isArray(obj.models)) d.models = obj.models;
    if (Array.isArray(obj.scenes)) d.scenes = obj.scenes;
    save();
    if (obj.compApis && typeof obj.compApis === 'object') saveCompMap(obj.compApis);
    return { ok: true };
  }

  /* 小智的系统提示词（人设）。跟接口、技能存在同一份数据里，一起导出导入。 */
  function prompt() { return load().prompt || ''; }
  function setPrompt(v) { load().prompt = String(v == null ? '' : v); save(); return prompt(); }

  /* ── 能力：容器。序列只表示添加顺序，不是"步骤"；顺序说明由 MD 的文字承担。 ── */
  function abilities() { return load().abilities || []; }
  function abilityById(id) {
    return abilities().filter(function (x) { return x.id === id; })[0] || null;
  }
  function addAbility(v) {
    var it = Object.assign({
      id: uid('ab'), name: '未命名能力', intro: '', apiIds: [],
      doc: '', docState: 'none', docFrom: '', docErr: '', docAt: '', project: '', at: now()
    }, v);
    load().abilities.push(it); save(); return it;
  }
  function updateAbility(id, patch) {
    var it = abilityById(id); if (!it) return null;
    Object.assign(it, patch, { at: now() }); save(); return it;
  }
  function removeAbility(id) {
    var d = load();
    d.abilities = d.abilities.filter(function (x) { return x.id !== id; });
    save();
    var m = compMap();
    Object.keys(m).forEach(function (k) { m[k] = m[k].filter(function (x) { return x !== id; }); });
    saveCompMap(m);
    return { ok: true };
  }
  /* 能力里的接口明细（按 apiIds 顺序展开，找不到的给占位，界面显示「已失效」） */
  function abilityApis(id) {
    var b = abilityById(id); if (!b) return [];
    return (b.apiIds || []).map(function (aid) {
      var a = apiById(aid);
      return a ? { id: aid, api: a, missing: false } : { id: aid, api: null, missing: true };
    });
  }
  function compAbilities(compId) { return (compMap()[compId] || []).slice(); }
  function setCompAbilities(compId, ids) {
    var m = compMap();
    m[compId] = (ids || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
    saveCompMap(m);
  }

  window.CAP = {
    load: load, save: save,
    apis: apis, apiById: apiById, addApi: addApi, updateApi: updateApi, removeApi: removeApi, toggleApi: toggleApi,
    skills: skills, skillById: skillById, addSkill: addSkill, updateSkill: updateSkill, removeSkill: removeSkill, toggleSkill: toggleSkill,
    compApis: compApis, setCompApis: setCompApis, prompt: prompt, setPrompt: setPrompt, exportAll: exportAll, importAll: importAll,
    abilities: abilities, abilityById: abilityById, addAbility: addAbility,
    updateAbility: updateAbility, removeAbility: removeAbility, abilityApis: abilityApis,
    compAbilities: compAbilities, setCompAbilities: setCompAbilities,
    fingerprint: fingerprint, pickMethodPath: pickMethodPath,
    models: models, modelById: modelById, addModel: addModel, updateModel: updateModel,
    removeModel: removeModel, toggleModel: toggleModel,
    scenes: scenes, setSceneModel: setSceneModel, sceneModel: sceneModel,
    now: now
  };
})();
