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

  /* ── 把一段原文拆成接口（本地规则，不花模型钱）───────────────────
     客户给的东西就三种：OpenAPI/Swagger 的 JSON、OpenAPI 的 YAML、一段段接口说明（含 curl）。
     前两种能精确拆；第三种按空行/--- 分块，块里找方法+路径。全都拆不出来就返回空数组，
     由调用方决定要不要交给模型 —— 这里绝不猜。 */
  /* 入参、返回一律按 JSON 写（用户 2026-11-05 定）：参数名做键，描述做示例值。 */
  function paramJson(ps) {
    if (!Array.isArray(ps) || !ps.length) return '';
    var o = {};
    ps.forEach(function (p) {
      if (!p || !p.name) return;
      o[p.name] = p.description ? String(p.description).replace(/\s+/g, ' ') : '';
    });
    return Object.keys(o).length ? JSON.stringify(o, null, 2) : '';
  }

  function parseApis(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];
    var out = [];

    /* 1｜JSON：OpenAPI / Swagger，一条 path 下的每个方法算一个接口 */
    var j = null;
    try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (j && j.paths && typeof j.paths === 'object') {
      var proj = (j.info && j.info.title) || '未标注';
      Object.keys(j.paths).forEach(function (p) {
        ['get', 'post', 'put', 'patch', 'delete'].forEach(function (m) {
          var op = j.paths[p] && j.paths[p][m];
          if (!op) return;
          out.push({
            name: op.summary || op.operationId || (m.toUpperCase() + ' ' + p),
            method: m.toUpperCase(), path: p, project: proj,
            summary: String(op.description || op.summary || p).replace(/\s+/g, ' ').slice(0, 60),
            params: paramJson(op.parameters), returns: '',
            raw: m.toUpperCase() + ' ' + p + (op.summary ? '\n' + op.summary : '')
          });
        });
      });
      if (out.length) return out;
    }

    /* 2｜YAML：不引解析库，只认缩进里的「/路径:」和它下面的方法行 */
    var cur = null, hit = 0;
    raw.split('\n').forEach(function (ln) {
      var p = ln.match(/^(\s*)(\/[A-Za-z0-9_\-./{}:]*)\s*:\s*$/);
      if (p) { cur = p[2]; return; }
      var m = ln.match(/^(\s+)(get|post|put|patch|delete)\s*:\s*$/i);
      if (m && cur) {
        out.push({
          name: m[2].toUpperCase() + ' ' + cur, method: m[2].toUpperCase(), path: cur,
          project: '未标注', summary: '', params: '', returns: '', raw: m[2].toUpperCase() + ' ' + cur
        });
        hit++;
      }
    });
    if (hit) return out;

    /* 3｜一段段说明：空行或 --- 分隔；名字取第一行，第一行只有路径时取第二行 */
    var parts = /\n\s*---+\s*\n/.test(raw) ? raw.split(/\n\s*---+\s*\n/) : raw.split(/\n\s*\n/);
    return parts.filter(function (b) { return b.trim(); }).map(function (b) {
      var mp = pickMethodPath(b);
      var lines = b.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var first = lines[0] || '';
      var nm = first.replace(/^(curl\s+)?(-X\s+)?(GET|POST|PUT|PATCH|DELETE)\s+/i, '')
        .replace(/^(https?:\/\/\S+|\/\S*)\s*/, '').trim();
      if (!nm && lines[1]) nm = lines[1];
      return {
        name: nm.slice(0, 24) || (mp.method + ' ' + mp.path),
        method: mp.method, path: mp.path, project: '未标注',
        summary: b.replace(/\s+/g, ' ').slice(0, 60), params: '', returns: '', raw: b.trim()
      };
    }).filter(function (x) { return x.path; });
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
    /* ★2026-11-09：老存档的模型缺 source/headers/vision，kind 可能还是 'vision'。
       幂等补齐，跑多少次结果都一样。种子本身也过一遍，保证两条来路一致。 */
    cache.models = cache.models.map(normModel);
    /* ★2026-11-09：老存档里一个语音模型都没有，语音绑定就永远空着。
       整类补一条 —— 只补 asr，不逐条复活别的种子（删过的不能被塞回来）。 */
    /* ★2026-11-09 盲审：原来写成「没有 asr 就补」，删掉后一刷新又回来，删除是假的。
       改成只补一次（seededAsr 标记）：补过就不再补，删了就真没了。 */
    if (!cache.seededAsr) {
      cache.seededAsr = 1;
      if (!cache.models.some(function (m) { return m.kind === 'asr'; })) {
        var asrSeed = MODEL_SEED.filter(function (m) { return m.kind === 'asr'; })[0];
        if (asrSeed) cache.models.push(JSON.parse(JSON.stringify(asrSeed)));
      }
      save();
    }
    /* ★2026-11-09：新增语音/向量/重排三条绑定后，老存档里只有 xz、config 两条。
       逐条补齐而不是整体重置 —— 重置会把他已经选过的模型冲回种子值。
       已有条目只同步文案与类型（name/desc/kind），model 保留他选的那个，
       所以「默认语音模型」改名「语音模型」在老存档上也会生效。 */
    if (!cache.scenes) cache.scenes = [];
    SCENE_SEED.forEach(function (s) {
      var hit = cache.scenes.filter(function (x) { return x.key === s.key; })[0];
      if (!hit) {
        cache.scenes.push(JSON.parse(JSON.stringify(s)));
        save();
      } else if (hit.name !== s.name || hit.desc !== s.desc || hit.kind !== s.kind) {
        hit.name = s.name; hit.desc = s.desc; hit.kind = s.kind;
        save();
      }
    });
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
    try { localStorage.setItem(KEY, JSON.stringify(cache)); return true; } catch (e) { throw new Error('没保存上，请减少附件大小后重试'); }
  }

  function now() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7); }

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
    var it = Object.assign({ id: uid('sk'), state: 'ok', on: true, at: now(), by: '系统超级管理员' }, v);
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
    { id: 'm-ds-vl', name: 'deepseek-vl', label: 'DeepSeek VL', vendor: 'DeepSeek', kind: 'chat', vision: true, temp: 0.1, react: 10, outMax: 16384, ctx: 64000, isDefault: false, on: true },
    { id: 'm-embed', name: 'text-embedding-v4', label: 'Embedding v4', vendor: '阿里云', kind: 'embed', temp: 0, react: 0, outMax: 0, ctx: 8192, isDefault: false, on: true },
    { id: 'm-rerank', name: 'qwen3-rerank', label: 'Rerank', vendor: '阿里云', kind: 'rerank', temp: 0, react: 0, outMax: 0, ctx: 8192, isDefault: false, on: true },
    { id: 'm-asr', name: 'paraformer-v2', label: 'Paraformer 语音识别', vendor: '阿里云', kind: 'asr', temp: 0, react: 0, outMax: 0, ctx: 0, isDefault: false, on: true }
  ];
  /* 2026-11-05（用户定稿）：「只需要一个就行，不需要多选切换，所以也就没有默认了」。
     ★2026-11-09（用户）：上面两条对话绑定之后，再加默认语音、向量、重排序三条。
     kind 决定这条绑定从哪一类模型里挑，不是一个模型能同时占三类。 */
  var SCENE_SEED = [
    { key: 'xz', name: '小智使用模型', desc: '客户在应用里跟小智对话时用', model: 'm-ds-flash', kind: 'chat' },
    { key: 'config', name: '配置页使用模型', desc: '应用与技能配置的生成、调整使用', model: 'm-ds-flash', kind: 'chat' },
    { key: 'asr', name: '语音模型', desc: '语音输入转成文字时用', model: 'm-asr', kind: 'asr' },
    { key: 'embed', name: '向量模型', desc: '知识切片入库时生成向量用', model: 'm-embed', kind: 'embed' },
    { key: 'rerank', name: '重排序模型', desc: '检索结果重排序时用', model: 'm-rerank', kind: 'rerank' }
  ];


  /* ★2026-11-09：模型字段的唯一规范化入口，种子与老存档共用一套规则。
     为什么要有它：类型回到表单之后，模型对象多了 source / headers / vision 三个字段，
     老存档里一个都没有；如果只在 addModel 里给默认值，老数据永远缺这三项，
     界面上一会儿有值一会儿没有。
     - kind 沿用旧值域（chat/embed/rerank）并扩出 asr/tts，不新立 type
     - 视觉从「独立类型」降为 chat 的属性：老数据的 kind:'vision' → kind:'chat' + vision:true
     - 这个函数必须幂等：load() 每次都会跑，不能越跑越变 */
  function normModel(m) {
    if (!m || typeof m !== 'object') return m;
    if (m.kind === 'vision') { m.kind = 'chat'; m.vision = true; }
    if (!m.kind) m.kind = 'chat';
    if (typeof m.vision !== 'boolean') m.vision = false;
    if (!m.source) m.source = 'api';
    if (!Array.isArray(m.headers)) m.headers = [];
    return m;
  }

  /* ★2026-11-09：配置指纹。测试结果只有绑住"测的是哪一版配置"才有意义 ——
     改了地址或 Key 之后绿点还亮着，就是假通过（真源官方规则也要求改完重测）。
     影响连接的字段只有这五个，别的字段（温度、上下文）变了不必重测。 */
  function fpOf(parts) {
    var str = parts.join('|'), h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return 'fp' + (h >>> 0).toString(36);
  }
  function modelFp(m) {
    if (!m) return '';
    return fpOf([m.source || 'api', m.url || '', m.name || '', m.key || '', JSON.stringify(m.headers || [])]);
  }

  function models() { return load().models || []; }
  function modelById(id) { return models().filter(function (x) { return x.id === id; })[0] || null; }
  function addModel(v) {
    var it = Object.assign({ id: uid('m'), kind: 'chat', vision: false, source: 'api', headers: [], temp: 0.2, react: 10, outMax: 32768, ctx: 128000, isDefault: false, on: true }, v);
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
    /* ★2026-11-09：回退原来是 models()[0] —— 不看类型。
       场景绑的是对话模型，删掉最后一个对话模型时，会把它绑到一个向量或重排模型上。
       有了 asr 之后更糟（删语音模型会把「默认语音模型」绑到对话模型）。
       改成同类型优先；同类型一个都没有就置空，界面显示「该场景暂无可用模型」。 */
    var sameKind = d.models.filter(function (x) { return x.id !== id && x.kind === it.kind; });
    d.models = d.models.filter(function (x) { return x.id !== id; });
    d.scenes.forEach(function (s) { if (s.model === id) s.model = sameKind[0] ? sameKind[0].id : ''; });
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
  /* ★2026-11-09：导入能力包（interfaces 页「导入」用）。
     口径：接口进池按 host+method+path 去重（同一个接口被两个能力引用不算两份）；
     能力同名则合并（追加接口），不新建 —— 客户重发一版不会把清单撑成两份。 */
  function importAbilities(items, opts) {
    /* ★2026-11-09 盲审：导入要能选「新建」还是「合并」——
       原来同名一律静默合并，用户以为新建了一条，实际清单条数没变。
       mode='new' 时即使同名也建新的一条；默认 merge，保持老调用不变。 */
    var mode = (opts && opts.mode === 'new') ? 'new' : 'merge';
    var d = load();
    var nAb = 0, nApi = 0, nSkip = 0;
    (items || []).forEach(function (b) {
      if (!b || !b.name) return;
      var apiIds = [];
      (b.apis || []).forEach(function (a) {
        if (!a || !a.path) return;
        /* ★2026-11-09：host 在种子里普遍是空串，只用 method+path 做键会把
           「A 项目的 /api/v1/verify」和「B 项目的 /api/v1/verify」判成同一个接口，
           静默合并成一条。host 缺失时用项目名占位，宁可多一条也不误合并。 */
        var hk = a.host || ('project:' + (b.project || '未标注'));
        var key = hk + ' ' + (a.method || 'GET') + ' ' + a.path;
        var hit = d.apis.filter(function (x) {
          var xk = (x.host || ('project:' + (x.project || '未标注'))) + ' ' + (x.method || 'GET') + ' ' + x.path;
          return xk === key;
        })[0];
        if (hit) { apiIds.push(hit.id); nSkip++; return; }
        var nid = 'api-imp-' + (nApi++) + '-' + Date.now().toString(36);
        d.apis.push({
          id: nid, name: a.name || a.path, desc: a.summary || '',
          source: b.project || '未标注', project: b.project || '未标注',
          state: 'ok', on: true, at: now(),
          method: a.method || 'GET', path: a.path || '', host: a.host || '',
          params: a.params || '', returns: a.returns || '', raw: a.raw || ''
          /* ★2026-11-09：这里原来写 doc: b.doc —— 把能力的说明书塞给每一个接口。
             接口的说明和能力的说明是两回事，导进来之后接口详情会显示一段跟它无关的文字。 */
        });
        apiIds.push(nid);
      });
      var same = mode === 'merge' ? d.abilities.filter(function (x) { return x.name === b.name; })[0] : null;
      if (same) {
        apiIds.forEach(function (id) { if ((same.apiIds || []).indexOf(id) < 0) same.apiIds.push(id); });
        /* ★2026-11-09 盲审：原来只在 same.doc 为空时写，导出的说明书永远进不来 ——
           验收「导出→导入→详情能看到完整说明书」在合并这条路上不成立。以文件为准。 */
        if (b.doc && b.doc !== same.doc) {
          same.doc = b.doc;
          same.docState = 'ready';
          same.docFrom = b.docFrom || same.docFrom || '';
          same.docAt = b.docAt || same.docAt || '';
        }
        same.at = now();
      } else {
        d.abilities.push({
          id: 'ab-imp-' + (nAb++) + '-' + Date.now().toString(36),
          name: b.name, intro: b.intro || '', project: b.project || '未标注',
          apiIds: apiIds, doc: b.doc || '',
          docState: b.doc ? 'ready' : 'none', docFrom: b.docFrom || '', docAt: b.docAt || '',
          at: now()
        });
      }
    });
    save();
    return { abilities: nAb, apis: nApi, skipped: nSkip };
  }

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
    load: load, save: save, refresh: function(){cache=null;return load();},
    apis: apis, apiById: apiById, addApi: addApi, updateApi: updateApi, removeApi: removeApi, toggleApi: toggleApi,
    skills: skills, skillById: skillById, addSkill: addSkill, updateSkill: updateSkill, removeSkill: removeSkill, toggleSkill: toggleSkill,
    compApis: compApis, setCompApis: setCompApis, prompt: prompt, setPrompt: setPrompt, exportAll: exportAll, importAll: importAll,
    abilities: abilities, abilityById: abilityById, addAbility: addAbility,
    updateAbility: updateAbility, removeAbility: removeAbility, abilityApis: abilityApis,
    compAbilities: compAbilities, setCompAbilities: setCompAbilities,
    fingerprint: fingerprint, pickMethodPath: pickMethodPath, parseApis: parseApis,
    models: models, modelById: modelById, addModel: addModel, updateModel: updateModel, modelFp: modelFp,
    removeModel: removeModel, toggleModel: toggleModel, importAbilities: importAbilities,
    scenes: scenes, setSceneModel: setSceneModel, sceneModel: sceneModel,
    now: now
  };
  // Reflect the real local backend, without copying any CLI credential to the browser.
  if(typeof fetch==='function')fetch('/xz/status').then(function(r){if(!r.ok)return null;return r.json();}).then(function(runtime){
    if(!runtime || runtime.backend!=='codex-cli')return;
    var d=load(),id='m-local-codex',m=d.models.filter(function(x){return x.id===id;})[0],changed=false;
    if(!m){m={id:id,name:runtime.model,label:'本机 Codex',kind:'chat',source:'cli',backend:'cli',on:true,temp:0.2,outMax:8192,ctx:200000,headers:[]};d.models.push(m);changed=true;}
    if(m.name!==runtime.model){m.name=runtime.model;changed=true;}
    d.scenes.forEach(function(s){if(['xz','config'].indexOf(s.key)<0)return;var old=d.models.filter(function(x){return x.id===s.model;})[0];if(s.model!==id){s.model=id;changed=true;}});
    if(changed){save();if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('models-ready'));}
  }).catch(function(){});
})();
