/* ─────────────────────────────────────────────────────────────
   gen.js —— 真·生成。调本机 WorkBuddy 的模型（同源 /xz/plan），
   模型只出「页面骨架 JSON」，落地由本文件用设计系统渲染。

   为什么不让模型直接吐 HTML：
     试过就会知道，它会给每个元素各写一套圆角、阴影、字号、颜色 ——
     那正是这套系统一直在治的病（同一件东西 N 份实现）。
     所以分工写死：**模型决定结构，契约决定样式**。
     模型唯一的自由度是「这一页由哪几块、每块说什么」，不是「长什么样」。

   为什么必须同源代理（/xz/plan）而不是前端直连模型：
     密钥会出现在源码里、跨域被拦、内网端点客户连不上。见 xz-server.py 头注释。

   失败一律显式：服务没起 → 明说哪一层不通；模型返回不是 JSON → 贴出前 200 字。
   不许静默降级成「本地规则假装生成」—— 今天早上刚修过一处假成功。
   ───────────────────────────────────────────────────────────── */
window.Gen = (function () {
  'use strict';

  var ENDPOINT = '/xz/plan';

  /* ── 服务探活：不花模型钱 ──────────────────────────────────
     GET /xz/plan 走静态处理器，实测会得到 "Empty reply"（不是 404），
     分不清"服务没起"和"路由没有"，所以不能拿 GET 当探针。
     改用 POST 一条**空 messages**：上游会立刻回 400（不产生 token），
     而 xz-server 把它包成 JSON 502 —— 收到 JSON 就说明代理活着；
     收到 501/HTML 说明这个端口只是 python -m http.server。
     一次探活 0.16 秒、0 token。 */
  var probeCache = null;
  function probe() {
    if (probeCache) return probeCache;
    probeCache = fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') < 0) {
        return { ok: false, why: '这个端口起的是纯静态服务（POST /xz/plan 返回 ' + r.status + '、不是 JSON），没有模型代理。用 xz-up.py 起服务才带模型。' };
      }
      return { ok: true, status: r.status };
    }).catch(function (e) {
      return { ok: false, why: '连不上本机服务：' + e.message };
    });
    return probeCache;
  }

  /* 重试一次（最多两次尝试）。
     为什么是 2 而不是 3：实测这个本地通道的单次响应 2–60 秒都有，
     三次尝试 + 每次 30 秒超时，实测把一句"改这一块"拖到 121 秒 ——
     用户看到的是一句话说完没反应。**重试是给偶发失败的，不是给慢的。**
     ★ 2026-10-23 从 3 次改回 2 次，并把超时从 30s 提到 75s：
       30s 会把本来会成功的慢请求砍掉，然后重试又砍 —— 慢被放大了三倍。 */
  var ASK_TRIES = 2;
  var ASK_TIMEOUT = 75000;
  /* 当前这次生成是哪个场景（app / component / skill）。用来在通用配置里
     取对应场景绑定的模型。演示站一次只跑一个生成，不做并发隔离。 */
  var GEN_SCENE = 'config';

  function ask(messages, opt) {
    opt = opt || {};
    if (!opt.model && typeof window !== 'undefined' && window.CAP && CAP.sceneModel) {
      var mm = CAP.sceneModel(GEN_SCENE);
      if (mm) opt.model = mm;
    }
    var tries = 0;
    function once() {
      tries++;
      return askOnce(messages, opt).catch(function (e) {
        var m = String((e && e.message) || e);
        if (/没有模型代理|找不到 \/xz\/plan|连不上本机服务/.test(m)) throw e;   /* 环境问题，重试无意义 */
        if (tries >= ASK_TRIES) throw e;
        return new Promise(function (r) { setTimeout(r, 400); }).then(once);
      });
    }
    return once();
  }

  function askOnce(messages, opt) {
    opt = opt || {};
    var body = {
      messages: messages,
      temperature: opt.temperature == null ? 0.2 : opt.temperature,
      max_tokens: opt.maxTokens || 5000
    };
    /* 代理实测接受 model 字段（三种请求只报上游 429，没有参数错），按场景带上。 */
    if (opt.model) body.model = opt.model;
    var t0 = Date.now();
    /* 单次调用超时。为什么要：deepseek-flash 的响应时间从 2 秒到 60 秒都有，
       实测一次"改这一块"能拖到 121 秒 —— 用户看到的是一句话说完没反应。
       与其干等一个可能已经挂住的连接，不如 30 秒断掉重来（重来通常 2-15 秒）。
       ⚠ 断掉的是前端这一侧的等待，上游可能还在算；这是可接受的：结果本来就不确定。 */
    var ctl = null, timer = null;
    try {
      ctl = new AbortController();
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, opt.timeout || ASK_TIMEOUT);
    } catch (e) {}
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (timer) { clearTimeout(timer); timer = null; }
      return r.text().then(function (txt) {
        if (!r.ok) throw new Error(httpWhy(r.status, txt));
        var j;
        try { j = JSON.parse(txt); } catch (e) { throw new Error('服务返回的不是 JSON：' + txt.slice(0, 160)); }
        if (j.error) throw new Error('模型调用失败：' + (j.error || '') + ' ' + (j.detail || ''));
        /* ★ 空内容必须当失败：实测 deepseek-flash 偶尔把 token 全花在推理上，
           content 回来是空串。上层要是把它当"模型不想说话"，画布就停在空态 ——
           用户看到的是「小智有时候不干活」。当成错误 → 触发一次重试。 */
        /* ⚠ 变量名不能叫 r：外层 `.then(function (r) {...})` 的 r 是 Response，
           内层再写 `var r` 会把它提升覆盖成 undefined，`r.ok` 立刻抛 TypeError。 */
        var body = (j.text || '').trim();
        if (!body) {
          var reas = ((j.usage || {}).completion_tokens_details || {}).reasoning_tokens;
          throw new Error('模型回了空内容' + (reas ? '（推理吃掉了 ' + reas + ' tokens）' : ''));
        }
        return { text: body, model: j.model || '?', ms: j.ms || (Date.now() - t0) };
      });
    }).catch(function (e) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (e && e.name === 'AbortError') throw new Error('模型 75 秒没回应');
      if (e && e.message && e.message.indexOf('模型') >= 0) throw e;
      throw new Error('请求模型失败：' + (e && e.message ? e.message : e));
    });
  }

  function httpWhy(code, body) {
    if (code === 501) return '这个端口没有模型代理（501 Unsupported method）—— 用 xz-up.py 起的服务才带 /xz/plan';
    if (code === 404) return '端口上找不到 /xz/plan（404）—— 服务不是 xz-server.py';
    if (code === 502) return '上游模型失败（502）：' + String(body).slice(0, 160);
    return '模型请求失败 HTTP ' + code + '：' + String(body).slice(0, 160);
  }

  /* ── JSON 提取：模型偶尔会包 ```json 或前后加解释 ─────────── */
  function pickJson(text) {
    var raw = String(text || '').trim();
    var t = raw;
    var f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (f) t = f[1].trim();
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    t = t.replace(/,\s*([}\]])/g, '$1');         /* 尾随逗号 */
    try { return JSON.parse(t); } catch (e) {}

    /* 截断容错：模型偶尔在 max_tokens 用尽时把 JSON 停在半句（实测一次"改一块"
       返回的正是这种）。按括号栈补齐再试一次 —— 补得齐就用，补不齐才报错。
       ★ 这里必须报错而不是返回半截：半截结构会被当成"模型给的就是这样"，
         页面上少了半页却没有任何提示，比直接失败更难查。 */
    var inStr = false, esc = false, stack = [];
    for (var k = 0; k < t.length; k++) {
      var ch = t[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
    }
    if (inStr) t += '"';
    while (stack.length) t += stack.pop();
    t = t.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(t); } catch (e2) {
      throw new Error('模型给的 JSON 不完整也补不齐（前 300 字：' + raw.slice(0, 300) + '）');
    }
  }

  /* ══ 一、页面骨架规格 ══════════════════════════════════════ */

  var BLOCK_TYPES = ['status', 'filters', 'table', 'form', 'cards', 'text'];

  /* 表格一页多少行。分页判据也用它：行数超过一页就该有分页，
     不依赖模型有没有给 pager —— "一页放不下"本身就是要分页的理由。 */
  var PAGE_SIZE = 10;

  var SPEC_DOC = [
    '你是一个后台页面结构生成器。根据用户一句话，输出这一页的骨架 JSON。',
    '只输出 JSON，不要解释、不要 markdown 代码块。',
    '形状：{"title":"页面标题","action":"右上角主按钮文字","blocks":[ ... ]}',
    'block 只有这六种：',
    '  {"type":"status","text":"审核中 · 12 条待处理"}',
    '  {"type":"filters","search":"搜索任务编号","chips":["全部","待复核"]}',
    '  {"type":"table","title":"任务列表","cols":["任务编号","业务类型","金额","状态"],"rows":[["DC-2026-1031","债券承做","8,000 万","待复核"]],"pager":true}',
    '  {"type":"form","title":"基本信息","mode":"edit","rows":[["任务编号","DC-2026-1031"],["业务类型","债券承做"]]}',
    '  {"type":"cards","title":"规则结论","items":[{"t":"主体资格","d":"第 2 页 3.1","s":"已通过"}]}',
    '  {"type":"text","text":"一句说明"}',
    '三种可选属性（按需给，不需要就不给）：',
    '  side: "L" 或 "R" —— 两块要左右并排时成对出现，各占一半宽。',
    '  pager: true —— 用户提到分页 / 翻页 / 共几条时才给。',
    '  mode: "edit" 或 "read" —— form 块专用。新建、编辑类页面给 edit；查看详情、对照类给 read。',
    '硬规则：',
    '1) 全用中文业务词，不许出现「组件/布局/画布/v1/装配/side」这类研发词。',
    '2) 数据必须具体可读：金额带单位（8,000 万 / 1.20 亿），编号像真编号，人名是中文名。',
    '3) table 给 6-10 行、3-6 列；用户提到分页时给 12-18 行。cards 给 3-6 条。',
    '4) 状态值只用：已通过 / 待复核 / 已驳回 / 已启用 / 已停用 / 草稿 / 进行中。',
    '5) 一页 2-5 个 block，顺序 status → filters → table|form|cards → text（可选）。',
    '6) 不要编造英文占位符、不要 lorem ipsum。',
    '7) block 的 title 里绝对不许写方位词（左侧/右侧/左栏/右栏/左边/右边）。要左右并排就用 side 表达，不许用文字描述位置。',
    '8) block 的 title 不要与页面 title 相同 —— 页面标题已经显示在上方；单个块构成整页时直接不给 title。',
    '9) 用户提到原文 / 原件 / 摘录 / 对照时，原文必须**单独成一个块**（type=text 或 cards），内容 3 条以上或 100 字以上。不许把它压成一句话摘要塞在状态条下面 —— 那是"说明"，不是"原文"。',
    '10) 输出的 JSON 必须完整闭合（括号、引号都配对）。写不完就减少表格行数或卡片条数，绝对不许输出半截 JSON。'
  ].join('\n');

  /* ── 没有模型代理时的本地结构器（2026-10-24 加）───────────────────────
     起因（用户原话）：「打字对话才能创建组件，为什么这都操作不了？跑不通」。
     实测真因：交付件里**没有模型代理** —— POST /xz/plan 在这个端口上回 501，
     probe() 早就识别得出，但 componentSpec 仍然直接去 ask()，于是画布永远停在
     「正在生成…」，用户看到的是死键。
     取舍：模型在的时候仍用模型（结构更好）；模型不在时用下面这个**确定性结构器**
     把同一句话落成真实可渲染的一页（块和样式仍走设计系统，不碰模型契约），
     并在对话里如实说明"这版是按规则搭的"。既不假装是模型产出，也不让发送变死键。 */
  var L_LEDGER = {
    ids: ['DC-2026-1031', 'DC-2026-1027', 'DC-2026-1019', 'DC-2026-1014', 'DC-2026-1008', 'DC-2026-1002'],
    biz: ['债券承做', '债券承做', '项目收益债', '债券承做', '中登查重', '项目收益债'],
    amt: ['2.40 亿', '8,000 万', '1.20 亿', '5,600 万', '—', '3,100 万'],
    st: ['待我审', '待我审', '已提交', '已提交', '已完结', '已驳回'],
    who: ['张启明', '张启明', '王立', '王立', '王立', '张启明']
  };

  function localSpec(text, ctx) {
    ctx = ctx || {};
    var q = String(text || '');
    var fields = arr(ctx.fields).filter(Boolean);
    var n = L_LEDGER.ids.length;

    var wantTable = /列表|表格|清单|队列|待办|批量|台账|分页|翻页|审查/.test(q);
    var wantForm = /表单|详情|字段|录入|填写|新增|新建|编辑|修改|配置/.test(q);
    var wantCards = /卡片|概览|看板|统计|汇总|指标/.test(q);
    var wantText = /原文|原件|摘录|条款|正文|对照/.test(q);
    var wantFilter = /筛选|搜索|过滤|条件|只看/.test(q);

    var title;
    if (wantTable && !wantForm) title = '审核任务列表';
    else if (wantForm && !wantTable) title = (ctx.name ? ctx.name + ' · 详情' : '任务详情');
    else if (wantCards) title = '审核概览';
    else if (wantText) title = '原文与规则对照';
    else if (ctx.name) title = ctx.name;
    else title = '审核页面';

    var blocks = [];

    /* 状态条：先说这页是什么状态的，再谈内容（同一套信息层级） */
    if (wantTable) blocks.push({ type: 'status', text: '审核中 · ' + n + ' 条待处理' });
    else if (wantForm) blocks.push({ type: 'status', text: '任务 ' + L_LEDGER.ids[0] + ' · 待复核' });
    else if (wantCards) blocks.push({ type: 'status', text: '本周新增 3 件 · 待复核 ' + n + ' 件' });

    if (wantFilter) {
      blocks.push({ type: 'filters', search: '搜索编号、业务类型或处理人',
        chips: ['全部', '待我审', '已提交', '已完结'] });
    }

    if (wantTable || (!wantForm && !wantCards && !wantText)) {
      var cols = fields.length >= 2 ? fields.slice(0, 5) : ['任务编号', '业务类型', '金额', '状态', '处理人'];
      var rows = [];
      for (var i = 0; i < n; i++) {
        var r = [];
        cols.forEach(function (c, ci) {
          if (/编号|单号|号/.test(c)) r.push(L_LEDGER.ids[i]);
          else if (/业务|类型/.test(c)) r.push(L_LEDGER.biz[i]);
          else if (/金额|额度|规模/.test(c)) r.push(L_LEDGER.amt[i]);
          else if (/状态/.test(c)) r.push(L_LEDGER.st[i]);
          else if (/人|负责|经办/.test(c)) r.push(L_LEDGER.who[i]);
          else r.push(fields[ci] ? String(fields[ci]).slice(0, 6) + ' ' + (i + 1) : '—');
        });
        rows.push(r);
      }
      blocks.push({ type: 'table', cols: cols, rows: rows, pager: /分页|翻页|共\s*\d/.test(q) });
    }

    if (wantText) {
      blocks.push({ type: 'text', title: '原文摘录',
        text: '本次债券发行规模不超过人民币 20 亿元，期限不超过 5 年，由主承销商余额包销；'
            + '发行人最近三年不存在重大违法行为，最近三年财务报表未被出具非标准审计意见；'
            + '募集资金拟用于偿还到期债务及补充流动资金，不用于房地产相关业务。' });
    }

    if (wantForm && fields.length) {
      blocks.push({ type: 'form', title: '字段对照',
        rows: fields.slice(0, 8).map(function (f) { return [String(f), '待核对']; }),
        mode: /详情|查看|对照/.test(q) ? 'read' : 'edit' });
    } else if (wantForm) {
      blocks.push({ type: 'form', title: '任务字段', rows: [
        ['任务编号', L_LEDGER.ids[0]], ['业务类型', L_LEDGER.biz[0]],
        ['金额', L_LEDGER.amt[0]], ['当前状态', L_LEDGER.st[0]], ['处理人', L_LEDGER.who[0]]
      ], mode: /详情|查看|对照/.test(q) ? 'read' : 'edit' });
    }

    if (wantCards) {
      blocks.push({ type: 'cards', title: '规则结论', items: [
        { t: '主体资格', d: '营业执照与承销资格齐备', s: '已通过' },
        { t: '关联交易', d: '披露口径与台账不一致', s: '待复核' },
        { t: '重大违法', d: '近三年有行政处罚记录', s: '已驳回' }
      ] });
    }

    /* 2026-11-05：本机没有模型代理时，装配的能力不能白装 —— 用既有的 cards 块
       出一块「可用能力」，人看得见这个组件能调什么。块类型没变，渲染契约没动。 */
    if (typeof window !== 'undefined' && window.CAP && ctx.compId) {
      var caps = CAP.compAbilities(ctx.compId).map(function (id) {
        var b = CAP.abilityById(id);
        return b ? { t: b.name, d: b.intro || '', s: (b.apiIds || []).length + ' 个接口' } : null;
      }).filter(Boolean);
      if (caps.length) blocks.push({ type: 'cards', title: '可用能力', items: caps.slice(0, 6) });
    }

    return validate({ title: title, blocks: blocks },
      { model: '本地结构器（本机无模型代理）', ms: 0 }, q);
  }

  /* ── 能力说明书（MD）────────────────────────────────────────
     装配到组件里的其实不是接口，是这份文档：模型读它才知道「什么时候该用、
     按什么方式调」。所以它必须在建能力的那一刻就存在，而不是事后手写。
     为什么不复用 componentSpec：那个的产物是页面骨架 JSON，这个是给人/模型
     读的业务说明 —— 产物不同、契约不同，混在一起两边都会走形。
     失败必须显式：没有模型代理就报错，绝不拿接口 summary 拼一份假装是 AI 写的。 */
  var DOC_SYS = [
    '你写给另一个 AI 读的能力说明书。它要靠这份文档判断「什么时候该用这个能力」，并按里面写的方式调接口。',
    '只输出 Markdown 正文。不要用代码块包住整篇，不要开场白，不要结尾客套。',
    '按这四节写，每节都要有：',
    '## 用途 —— 一两句话说清这个能力替人做完哪件事。',
    '## 什么时候用 —— 什么条件下该调用；什么情况下不要调。',
    '## 接口 —— 每个接口一节：方法与路径、干什么、入参、返回。入参和返回都用 ```json 代码块写，不要写成一句话。',
    '## 调用约定 —— 接口之间的依赖用句子写清（先查什么再写什么、拿不到哪个字段就停）。',
    '硬规则：',
    '1) 只能出现给定接口里有的方法、路径、字段，一个都不许编；缺的信息就不写，不要猜。',
    '2) 不要写「第一步 / 第二步」这种编号步骤，也不要把几个接口排成流程清单 —— 依赖关系用文字讲。',
    '3) 用中文业务词，不写「能力中枢 / 装配 / 接口包 / 节点」这类内部叫法。',
    '4) 不写「以下是」「本文档」「希望对你有帮助」这类废话。',
    '5) 接口少的就写短，不许为了凑长度编业务场景；名称和说明里已经说过的事不要重复。'
  ].join('\n');

  /* 没有模型时的兜底：只用接口自己写的文档拼，不改写、不发明。
     ⚠ 这不是"假装生成成功"—— 产物来源在界面上如实标出（「按接口文档拼的」），
     跟 componentSpec 走本地结构器时同一个口径。发布站是纯静态的，没有 /xz/plan，
     要是只认模型，那「建能力即生成 MD」在客户面前就是一句空话。 */
  function localAbilityDoc(b, apis) {
    var out = ['## 用途', b.intro || ('用下面这些接口完成「' + (b.name || '这件事') + '」。')];
    out.push('', '## 接口');
    apis.forEach(function (a) {
      out.push('', '### ' + (a.name || '未命名'));
      out.push('`' + (a.method || 'GET') + ' ' + (a.path || '（未标注）') + '`');
      /* 接口自己的文档开头常有一行标题，名字已经进了小标题，去掉免得同一句念两遍。 */
      var d = String(a.doc || a.summary || a.desc || '').trim().replace(/^#{1,4}\s+[^\n]*\n?/, '').trim();
      if (d) out.push('', d);
    });
    out.push('', '## 调用约定');
    out.push('只能用上面列出的接口和方法，没列出的不许编。参数按每个接口里写明的字段给，缺必填字段就停下来问，不要猜。');
    return out.join('\n');
  }

  /* 本地规则拆不动的原文，才交给模型：它只做一件事 —— 把内容读成接口清单。
     输出形状写死；抽不出来就 []，不许编接口（编了也过不了路径校验）。 */
  var API_SYS = [
    '你从一段接口文档或说明里抽接口清单。只输出 JSON 数组，不要解释、不要代码块。',
    '每项：{"name":"接口名（中文，动词开头）","method":"GET|POST|PUT|PATCH|DELETE","path":"/开头的资源路径","summary":"一句话干什么","params":"入参，没有就空串","returns":"返回什么，没有就空串"}',
    '规则：',
    '1) path 必须以 / 开头，不许带域名、不许带查询串。',
    '2) 原文没写方法就按语义判：查询 GET，提交/新建 POST，修改 PUT 或 PATCH，删除 DELETE。',
    '3) 同一个方法+路径只出现一次。',
    '4) 原文里压根没有接口（只是需求描述）就输出 []，不许凭想象编。'
  ].join('\n');

  function parseApis(text) {
    GEN_SCENE = 'config';
    var src = String(text || '').trim().slice(0, 8000);
    if (!src) return Promise.resolve([]);
    return probe().then(function (p) {
      if (!p.ok) throw new Error(p.why);
      return ask([
        { role: 'system', content: API_SYS },
        { role: 'user', content: src }
      ], { temperature: 0, maxTokens: 2000 });
    }).then(function (r) {
      var m = String(r.text || '').match(/\[[\s\S]*\]/);
      if (!m) throw new Error('模型没给出接口清单');
      var arr;
      try { arr = JSON.parse(m[0]); } catch (e) { throw new Error('模型给的清单不是合法 JSON'); }
      return (Array.isArray(arr) ? arr : []).map(function (x) {
        return {
          name: String(x.name || '').slice(0, 24),
          method: String(x.method || 'GET').toUpperCase(),
          path: String(x.path || '').trim(),
          summary: String(x.summary || '').slice(0, 60),
          params: String(x.params || ''), returns: String(x.returns || ''),
          project: '未标注', raw: String(x.method || 'GET') + ' ' + String(x.path || '')
        };
      }).filter(function (x) { return x.path && x.path.charAt(0) === '/'; });
    });
  }

  function abilityDoc(b) {
    GEN_SCENE = 'config';
    var apis = ((b && b.apiIds) || []).map(function (id) {
      return (window.CAP && CAP.apiById) ? CAP.apiById(id) : null;
    }).filter(Boolean);
    if (!apis.length) return Promise.reject(new Error('这个能力里还没有接口'));
    var facts = [
      '能力名称：' + (b.name || '未命名'),
      '说明：' + (b.intro || '（没写）'),
      '',
      '这个能力可以用的接口，只有这些：',
      ''
    ].concat(apis.map(function (a, i) {
      return (i + 1) + '. ' + (a.name || '未命名')
        + '\n   方法与路径：' + (a.method || 'GET') + ' ' + (a.path || '（未标注）')
        + '\n   一句说明：' + (a.summary || a.desc || '（没写）')
        + (a.doc ? '\n   原有文档：\n' + String(a.doc).split('\n').map(function (l) { return '     ' + l; }).join('\n') : '');
    })).join('\n');
    /* 三种结局都要说得清：模型写成了 / 模型不行按文档拼 / 连拼都拼不出来。 */
    return probe().then(function (p) {
      if (!p.ok) return { local: true, why: p.why };
      return ask([
        { role: 'system', content: DOC_SYS },
        { role: 'user', content: facts }
      ], { temperature: 0.15, maxTokens: 2000 }).then(function (r) {
        var txt = String(r.text || '').trim();
        if (!txt) throw new Error('模型回了空内容');
        return { text: txt, from: 'model' };
      }).catch(function (e) {
        return { local: true, why: String((e && e.message) || e) };
      });
    }).then(function (r) {
      if (!r.local) return r;
      var txt = localAbilityDoc(b, apis).trim();
      if (!txt) throw new Error('接口没有文档，拼不出 MD');
      return { text: txt, from: 'local', why: r.why };
    });
  }

  function componentSpec(text, ctx) {
    ctx = ctx || {};
    GEN_SCENE = 'config';
    /* 先探活再决定谁来搭：探到模型就用模型，探不到就用上面的确定性结构器。
       这一分支是"跑不通"的正面回答 —— 没有模型代理也不再是死键。 */
    /* 2026-11-05：装配能力的用途在这里落地——组件生成时，把已装能力的说明书
       作为上下文交给模型。能力是知识，不是运行时绑定；没装的能力不许编。 */
    var apiDocs = '';
    if (typeof window !== 'undefined' && window.CAP && ctx.compId) {
      var ids = CAP.compAbilities(ctx.compId);
      var docs = ids.map(function (id) {
        var b = CAP.abilityById(id);
        return b && b.doc ? ('## ' + b.name + '\n' + String(b.doc)) : '';
      }).filter(Boolean);
      if (docs.length) {
        apiDocs = '\n可用能力（这个组件装配的能力，需要时按每份能力说明书里写的调用方式调用；没列出的不许编）：\n' + docs.join('\n\n');
      }
    }
    var facts = [
      '所属应用：' + (ctx.app || '未指定'),
      '组件原名：' + (ctx.name || '（新建）'),
      '已有字段：' + ((ctx.fields && ctx.fields.length) ? ctx.fields.join('、') : '（无）'),
      '用户这句话：' + text
    ].join('\n') + apiDocs;
    /* 先探活再定谁来搭：探到模型走模型，探不到走确定性结构器。
       这是"打字对话跑不通"的正面回答 —— 没有模型代理也不再是死键。 */
    return probe().then(function (p) {
      if (!p.ok) { window.__genMode = 'local'; return localSpec(text, ctx); }
      window.__genMode = 'model';
      return ask([
        { role: 'system', content: SPEC_DOC },
        { role: 'user', content: facts }
      ]).then(function (r) {
        var spec;
        try { spec = pickJson(r.text); } catch (e) {
          /* 报错要能定位：把 pickJson 的原话、原文长度、尾部都带上。
             原来只给"前 120 字"—— 截断发生在尾部，看开头永远看不出问题在哪。 */
          throw new Error('模型没给出可用的 JSON：' + String((e && e.message) || e).slice(0, 90)
            + ' ｜ 原文 ' + r.text.length + ' 字，尾部：「' + r.text.slice(-90) + '」');
        }
        return validate(spec, r, text);
      });
    });
  }

  /* 校验 + 收敛：模型是概率的，落地前必须过一遍闸。
     不合规的块丢掉而不是整页报错 —— 但**丢了几块要说出来**（_dropped）。
     ★ 2026-10-23：加了"契约兜底" —— 模型漏掉的、但用户明确点名的能力（分页、
       只读态），在这里按页面语义补齐。实测模型会漏：让它做"带筛选和分页的列表"，
       它给了筛选、漏了分页。能力缺失不能靠模型自觉。 */
  function validate(spec, meta, ask) {
    if (!spec || typeof spec !== 'object') throw new Error('模型返回的不是对象');
    var out = {
      title: str(spec.title, '未命名页面', 24),
      action: str(spec.action, '', 12),
      blocks: [],
      _model: meta ? meta.model : null,
      _ms: meta ? meta.ms : null,
      _dropped: []
    };
    var blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
    blocks.forEach(function (b) {
      if (!b || BLOCK_TYPES.indexOf(b.type) < 0) { out._dropped.push(String(b && b.type)); return; }
      var blk = normalizeBlock(b);
      if (blk) out.blocks.push(blk); else out._dropped.push(b.type);
    });
    if (!out.blocks.length) throw new Error('模型给的结构里没有可识别的块（原样：' + JSON.stringify(spec).slice(0, 160) + '）');
    if (!out.action) out.action = defaultAction(out);

    /* 兜底一：用户点名要分页，但没有任何表带 pager ⇒ 补给第一个表。 */
    if (/分页|翻页|共\s*\d*\s*条|一页显示/.test(String(ask || ''))) {
      var hasPager = out.blocks.some(function (b) { return b.pager; });
      if (!hasPager) out.blocks.some(function (b) { if (b.type === 'table') { b.pager = true; return true; } return false; });
    }
    /* 兜底二：整页里所有 form 都没给 mode ⇒ 按页面标题判读写。
       详情/对照/查看 = read（值不该长成输入框）；新建/编辑 = edit。 */
    var readPage = /详情|明细|查看|对照|预览/.test(out.title) && !/新建|创建|编辑|新增|修改|配置/.test(out.title);
    out.blocks.forEach(function (b) {
      if (b.type === 'form' && !b.mode) b.mode = readPage ? 'read' : 'edit';
    });
    /* 兜底三：用户明确说了"左边…右边…"，就把它固化成页面级布局。
       ★ 为什么不信模型给的 side：实测同一句话，一次给了「（左侧）（右侧）」两个块，
         一次给成「一段摘要 + 一个字段表」，两次都没有 side。布局意图属于用户原话，
         属于契约，不能指望模型每次都记得转述。 */
    if (/左[边侧栏][^。；\n]{0,40}右[边侧栏]|右[边侧栏][^。；\n]{0,40}左[边侧栏]|左右并排|并排|双栏/.test(String(ask || ''))) {
      out.layout = 'two-col';
    }
    return out;
  }

  /* 方位词剥离。为什么要有：模型很容易把"左边原文右边对照"里的方位写进块标题，
     实测出过「抽取字段对照（右侧）」「原文段落核对（左侧）」—— 标题里带方位，
     等于把布局指令当文案念给用户看。这里把方位词从 title 里剥掉，
     并**升格为 side 信号**（模型没给 side 时正好用它兜住）。 */
  function splitSide(raw) {
    var s = String(raw == null ? '' : raw);
    var side = '';
    s = s.replace(/[（(]\s*左[（()）\s]*(侧|栏|边)?\s*[）)]/g, function () { side = 'L'; return ''; });
    s = s.replace(/[（(]\s*右[（()）\s]*(侧|栏|边)?\s*[）)]/g, function () { side = 'R'; return ''; });
    if (!side) {
      var m = s.match(/(左侧|左栏|左边|右侧|右栏|右边)/);
      if (m) side = /左/.test(m[1]) ? 'L' : 'R';
    }
    s = s.replace(/^\s*(左侧|左栏|左边|右侧|右栏|右边)\s*[:：·\-—]?\s*/, '');
    s = s.replace(/\s*[:：·\-—]?\s*(左侧|左栏|左边|右侧|右栏|右边)\s*$/, '');
    return { text: s.trim(), side: side };
  }

  function normalizeBlock(b) {
    var t = b.type;
    var side = (b.side === 'L' || b.side === 'R') ? b.side : '';
    if (t === 'text') {
      /* ★ 必须保留 title 与 side：原来这里只取 text，块标题被丢掉 ——
         并排后左栏是一段没有标题的裸字，读的人不知道那是"原文"还是"备注"。
         长度 400 → 900：原文段落本来就长，400 会把它从中间截断。 */
      var s = str(b.text, '', 900);
      if (!s) return null;
      var xt = splitSide(b.title);
      if (!side) side = xt.side;
      var tb = { type: 'text', text: s };
      var xtitle = str(xt.text, '', 24);
      if (xtitle) tb.title = xtitle;
      if (side) tb.side = side;
      return tb;
    }
    if (t === 'status') {
      var st = str(b.text, '', 60);
      return st ? { type: 'status', text: st } : null;
    }
    if (t === 'filters') {
      return {
        type: 'filters',
        search: str(b.search, '搜索', 24),
        chips: arr(b.chips).map(function (c) { return str(c, '', 12); }).filter(Boolean).slice(0, 5)
      };
    }
    if (t === 'table') {
      var cols = arr(b.cols).map(function (c) { return str(c, '', 14); }).filter(Boolean).slice(0, 8);
      if (cols.length < 2) return null;
      var maxRows = 18;   /* 12 → 18：分页要有第二页才成立，10 行一页时 12 行刚够两页，太紧 */
      var rows = arr(b.rows).slice(0, maxRows).map(function (r) {
        var cells = arr(r).slice(0, cols.length);
        while (cells.length < cols.length) cells.push('—');
        return cells.map(function (x) { return str(x, '—', 40); });
      });
      if (!rows.length) return null;
      var tt = splitSide(b.title);
      if (!side) side = tt.side;
      /* pager: 模型明确要 → 要；行数超过一页 → 也要（一页放不下就该翻页） */
      var blk = { type: 'table', title: str(tt.text, '', 24), cols: cols, rows: rows,
                  pager: b.pager === true || rows.length > PAGE_SIZE };
      if (side) blk.side = side;
      return blk;
    }
    if (t === 'form') {
      var rr = arr(b.rows).slice(0, 12).map(function (r) {
        var a = arr(r);
        return [str(a[0], '', 18), str(a[1], '—', 60)];
      }).filter(function (p) { return p[0]; });
      if (!rr.length) return null;
      var ft = splitSide(b.title);
      if (!side) side = ft.side;
      var fb = { type: 'form', title: str(ft.text, '', 24), rows: rr };
      /* mode 只认模型显式给的两个值；没给就留空，由 validate 按页面语义补 */
      if (b.mode === 'read' || b.mode === 'edit') fb.mode = b.mode;
      if (side) fb.side = side;
      return fb;
    }
    if (t === 'cards') {
      var items = arr(b.items).slice(0, 6).map(function (x) {
        return { t: str(x && x.t, '', 24), d: str(x && x.d, '', 80), s: str(x && x.s, '', 12) };
      }).filter(function (x) { return x.t; });
      if (!items.length) return null;
      var ct = splitSide(b.title);
      if (!side) side = ct.side;
      var cb = { type: 'cards', title: str(ct.text, '', 24), items: items };
      if (side) cb.side = side;
      return cb;
    }
    return null;
  }

  function defaultAction(spec) {
    var t = spec.title || '';
    if (/规则/.test(t)) return '新建规则';
    if (/复核|队列/.test(t)) return '新建复核';
    if (/抽取/.test(t)) return '新建抽取';
    if (/任务|审核/.test(t)) return '新建审核';
    return '新建';
  }

  /* 从骨架里反推「这个组件管哪些字段」—— 库里的 fields 就是它 */
  function specFields(spec) {
    var out = [];
    (spec.blocks || []).forEach(function (b) {
      if (b.type === 'table') out = out.concat(b.cols);
      else if (b.type === 'form') out = out.concat(b.rows.map(function (r) { return r[0]; }));
    });
    var seen = {};
    return out.filter(function (f) { if (!f || seen[f]) return false; seen[f] = 1; return true; }).slice(0, 8);
  }

  /* ══ 二、渲染：骨架 → 设计系统的组件 ══════════════════════ */

  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  function tone(v) {
    var s = String(v || '');
    if (/驳回|失败|停用|异常|逾期|拒绝|不通过/.test(s)) return 'bad';
    /* 草稿是中性的（还没进入流程），不能跟"待复核/进行中"用同一个暖色，
       否则一屏里所有不成功的项都在喊。 */
    if (/草稿/.test(s)) return 'mute';
    if (/待|未|进行|处理中|审核中/.test(s)) return 'wait';
    if (/已|通过|启用|完成|成功|一致/.test(s)) return 'done';
    return '';
  }
  function cell(v) {
    var k = tone(v);
    return k ? '<span class="cond" data-k="' + k + '">' + esc(v) + '</span>' : esc(v);
  }

  /* 返回 [{html, into}] 的步骤数组，交给调用方逐段落 —— 这样"边做边给你看"
     是真的（每落一段就是模型结构里的一块），不是假进度条。 */
  function renderComponent(spec, opt) {
    opt = opt || {};
    var pageTitle = spec.title || '';
    var head = '<div class="page-hd"><b>' + esc(pageTitle) + '</b>'
      + (spec.action ? '<button type="button" class="btn primary page-act">' + esc(spec.action) + '</button>' : '')
      + '</div>';
    var body = '';
    var rest = [];
    /* ★ 渲染前再过一遍 normalize（幂等）：spec 不只来自刚生成的模型返回，
       还可能来自存档、来自测试、来自旧版本的存档。契约必须在渲染这一层强制，
       不能假设"上游一定 normalize 过了" —— 实测存档读回来就没有 side/pager。 */
    var blocks = (spec.blocks || []).map(normalizeBlock).filter(Boolean);
    /* 页面级布局：用户说了左右，但模型一个 side 都没给 ⇒ 按块类型推导。
       左 = 原文类（text / 标题含原文·原件的 cards）；右 = 结构化字段（form / table）。
       推导出来把它们挪到相邻位置，交给下面的并排分支统一渲染。 */
    if (spec.layout === 'two-col' && !blocks.some(function (b) { return b.side; })) {
      var li = -1, ri = -1;
      blocks.forEach(function (b, k) {
        if (li < 0 && (b.type === 'text'
            || (b.type === 'cards' && /原文|原件|摘录|来源|段落|条款|依据/.test(b.title || '')))) li = k;
        if (ri < 0 && (b.type === 'form' || b.type === 'table')) ri = k;
      });
      if (li >= 0 && ri >= 0 && li !== ri) {
        var Lb = blocks[li], Rb = blocks[ri];
        Lb.side = 'L'; Rb.side = 'R';
        var at = Math.min(li, ri);
        blocks = blocks.filter(function (b) { return b !== Lb && b !== Rb; });
        blocks.splice(at, 0, Lb, Rb);
      }
    }
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === 'status') { body += statusHtml(b); continue; }
      if (b.type === 'filters') { body += filtersHtml(b); continue; }
      /* 左右并排：相邻两块 side 不同（L/R 或 R/L）⇒ 合成一行。
         按 L→R 排：模型给的块顺序不保证左先右后，视觉上左边那块必须在左。
         实测出过「抽取字段对照（右侧）」在前、「原文段落核对（左侧）」在后 ——
         直接按 DOM 顺序排的话，右栏会跑到左边。 */
      var nx = blocks[i + 1];
      if (b.side && nx && nx.side && nx.side !== b.side && nx.type !== 'status' && nx.type !== 'filters') {
        var L = b.side === 'L' ? b : nx;
        var R = b.side === 'L' ? nx : b;
        rest.push('<div class="bd-two-col">' + sectionHtml(L, pageTitle) + sectionHtml(R, pageTitle) + '</div>');
        i++;
        continue;
      }
      rest.push(sectionHtml(b, pageTitle));
    }
    return {
      head: head + body,
      sections: rest.filter(Boolean)
    };
  }

  function statusHtml(b) {
    return '<div class="status"><i></i><b>' + esc(b.text) + '</b></div>';
  }
  function filtersHtml(b) {
    return '<div class="bd-filters">'
      + '<span class="bd-search">' + esc(b.search) + '</span>'
      + b.chips.map(function (c, i) {
        return '<span class="bd-chip' + (i === 0 ? ' is-on' : '') + '">' + esc(c) + '</span>';
      }).join('')
      + '</div>';
  }

  /* 分页：真有行为 —— 每页 10 条，点页码真的切 tbody 里的行（见 component.js 的委托）。
     不做"看起来能翻但点了没反应"的死控件；也不编"共 128 条"这种不存在的总数。 */
  function pagerHtml(n) {
    /* 只有一页也照显示：用户点名要分页时，一个"共 8 条 · 第 1 页"的分页条
       是诚实的；直接不画则等于没做到他要的东西。页码最小 1 个，不编总数。 */
    var pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
    var ps = '';
    for (var p = 1; p <= pages; p++) {
      ps += '<button type="button" class="pg" data-pgto="' + p + '"'
        + (p === 1 ? ' aria-current="true"' : '') + '>' + p + '</button>';
    }
    return '<div class="bd-pager"><span>共 ' + n + ' 条</span>'
      + '<span class="pg-wrap">' + ps + '</span></div>';
  }

  function sectionHtml(b, pageTitle) {
    /* 块标题与页面标题重复时不画块头 —— 实测「审核任务列表」会连着出现两次，
       一次在页面标题、一次在卡片头，读起来像页面标题写重了。 */
    var title = b.title || '';
    if (title && pageTitle && (title === pageTitle
        || (title.length >= 4 && pageTitle.indexOf(title) >= 0))) {
      title = '';
    }
    if (b.type === 'table') {
      var th = b.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
      var tr = b.rows.map(function (r, ri) {
        var pg = Math.floor(ri / PAGE_SIZE) + 1;
        return '<tr' + (pg > 1 ? ' data-pg="' + pg + '" hidden' : '') + '>'
          + r.map(function (c) { return '<td>' + cell(c) + '</td>'; }).join('') + '</tr>';
      }).join('');
      var inner = '<div class="tb-wrap"><table class="tb"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></div>';
      if (b.pager) inner += pagerHtml(b.rows.length);
      return wrap(title, inner);
    }
    if (b.type === 'form') {
      var read = b.mode === 'read';
      var f = b.rows.map(function (r) {
        return '<div class="bd-field' + (read ? ' is-read' : '') + '">'
          + '<span class="bd-lbl">' + esc(r[0]) + '</span>'
          + (read
              ? '<span class="bd-ro">' + esc(r[1]) + '</span>'
              : '<span class="bd-input">' + esc(r[1]) + '</span>')
          + '</div>';
      }).join('');
      return wrap(title, '<div class="bd-fields">' + f + '</div>');
    }
    if (b.type === 'cards') {
      var c = b.items.map(function (x) {
        return '<div class="bd-card"><b>' + esc(x.t) + '</b>'
          + (x.d ? '<p>' + esc(x.d) + '</p>' : '')
          + (x.s ? '<span class="cond" data-k="' + (tone(x.s) || 'wait') + '">' + esc(x.s) + '</span>' : '')
          + '</div>';
      }).join('');
      return wrap(title, '<div class="bd-cards">' + c + '</div>');
    }
    if (b.type === 'text') {
      /* 并排里的原文要像"一份文档"，不能是一段裸字：裸 p 与旁边有边框的字段卡不齐，
         视觉上像掉在外面。复用 .bd-doc（浅底 + 描边 + 圆角），与规则结论同一套边界语言。 */
      if (b.side) {
        return wrap(title, '<div class="bd-doc"><p>' + esc(b.text) + '</p></div>');
      }
      return '<p class="bd-note">' + esc(b.text) + '</p>';
    }
    return '';
  }
  function wrap(title, inner) {
    return '<section class="bd-group">'
      + (title ? '<div class="bd-sec">' + esc(title) + '</div>' : '')
      + inner + '</section>';
  }

  /* ══ 三、应用装配：模型选模块，代码执行 ════════════════════ */

  function appPlan(text, ctx) {
    ctx = ctx || {};
    GEN_SCENE = 'config';
    /* 已装的和能装的分两段列。原来是一个清单加"已装配"标记 ——
       实测用户说"任务列表"，模型 edit 指到了"任务详情"（两个名字里都有"任务"）；
       分两段之后 edit 的目标只在"现在装着的"里面挑，可选集合小一半。 */
    var on = [], avail = [];
    (ctx.comps || []).forEach(function (c) {
      var line = '- ' + c.id + ' ｜ ' + c.name + (c.title ? '（当前标题：' + c.title + '）' : '');
      (c.installed ? on : avail).push(line);
    });
    var list = '这个应用现在装着的（可改、可卸）：\n' + (on.join('\n') || '（空）')
      + '\n\n还能加进来的（可装）：\n' + (avail.join('\n') || '（空）');
    /* 没有模型代理时也要能装/卸/改：按名字命中清单里的组件，做真实 DB 操作。
       不做"话术回复"——命不中就如实说没听出要改哪里（由调用方提示）。 */
    return probe().then(function (p) {
      if (!p.ok) return localPlan(text, ctx);
      return ask([
      {
        role: 'system',
        content: [
          '你是「达观智能审核平台」的应用装配器。',
          '给定这个应用和可用组件清单，判断用户这句话要做三件事里的哪一件：装组件、卸组件、改某个已装组件的呈现。',
          '只输出 JSON，不要解释、不要 markdown：',
          '{"say":"一句话说明你做了什么","install":["id"],"uninstall":["id"],"edit":{"id":"组件id","ask":"用一句话写清这块要怎么改"}}',
          '硬规则：',
          '1) id 只能来自清单，不许发明。',
          '2) 已经装了的不要再放进 install；没装的不许放进 uninstall。',
          '3) 用户说的话和装配无关（问问题、闲聊）时，install/uninstall 都给空数组，say 里直接回答。',
          '4) say 用客户能懂的话，不出现「装配/画布/令牌/状态机」这类研发词；说「组件」「页面」这两个界面里本来就有的词。',
          '5) 一页最多 5 个组件；宁少不多。',
          '6) **要改某块的样子**（改标题、增减列、只显示某种状态、换口径、加一行汇总…）时，不要装也不要卸，',
          '   用 edit 指到那个**已装配**的 id，ask 里写清"要改成什么样"（下游会据此重画这一块）。',
          '7) install / uninstall / edit 三者互斥：一次只做一件，最相关的那个。纯聊天三者都空。'
        ].join('\n')
      },
      {
        role: 'user',
        content: '应用：' + (ctx.app || '未命名') + '\n' + list + '\n\n用户：' + text
      }
    ]).then(function (r) {
      var j;
      try { j = pickJson(r.text); } catch (e) {
        throw new Error('模型没给出可用的 JSON（前 120 字：' + r.text.slice(0, 120) + '）');
      }
      var ids = {};
      (ctx.comps || []).forEach(function (c) { ids[c.id] = c; });
      var installed = {};
      (ctx.comps || []).forEach(function (c) { if (c.installed) installed[c.id] = 1; });
      var ins = arr(j.install).filter(function (id) { return ids[id] && !installed[id]; }).slice(0, 5);
      var un = arr(j.uninstall).filter(function (id) { return ids[id] && installed[id]; }).slice(0, 5);
      /* edit：改某一块的呈现。只接受**已装配**的 id —— 没装的应该走 install，
         这是和硬规则 2 同一件事的另一面；模型偶尔会把没装的放进 edit。 */
      var ed = null;
      if (j.edit && j.edit.id && ids[j.edit.id] && installed[j.edit.id]) {
        ed = { id: String(j.edit.id), ask: str(j.edit.ask, '', 200) };
        if (!ed.ask) ed = null;
      }
      /* 三者互斥：装/卸已经发生就不要再去改（一次只做一件，改动才可回滚、可解释） */
      if ((ins.length || un.length) && ed) ed = null;
      return { say: str(j.say, '', 160), install: ins, uninstall: un, edit: ed, ms: r.ms, model: r.model };
    });
    });
  }

  /* 本地装配解析器（无模型代理时用）。只做清单里真有的组件，绝不发明 id。 */
  function localPlan(text, ctx) {
    var q = String(text || '');
    var comps = (ctx && ctx.comps) || [];
    var hit = null, bestLen = 0;
    comps.forEach(function (c) {
      [c.name, c.title].forEach(function (nm) {
        if (!nm || String(nm).length < 2) return;
        if (q.indexOf(String(nm)) >= 0 && String(nm).length > bestLen) { bestLen = String(nm).length; hit = c; }
      });
    });
    var out = { say: '', install: [], uninstall: [], edit: null, ms: 0, model: '本地结构器（本机无模型代理）' };
    var wantOff = /卸|去掉|不要|删掉|移除|不显示/.test(q);
    var wantOn = /装上|加上|加个|加一个|装个|要一个|补一个|来一个|加上去/.test(q);
    var wantEdit = /只显示|只看|筛选|改成|换掉|标题|排序|汇总|增减|列/.test(q);
    if (hit) {
      if (wantOff) { if (hit.installed) out.uninstall = [hit.id]; }
      else if (wantEdit && hit.installed) out.edit = { id: hit.id, ask: q };
      else if (hit.installed) out.edit = { id: hit.id, ask: q };
      else out.install = [hit.id];
    } else if (wantEdit) {
      /* 没点名就改"第一个已装且能改"的那块 —— 用户说"只显示待复核的单子"时，
         指的就是页面上那张表。 */
      var first = null;
      comps.forEach(function (c) { if (!first && c.installed) first = c; });
      if (first) out.edit = { id: first.id, ask: q };
    } else if (wantOn) {
      var pick = null;
      comps.forEach(function (c) { if (!pick && !c.installed) pick = c; });
      if (pick) out.install = [pick.id];
    }
    return out;
  }

  /* ── 小工具 ─────────────────────────────────────────────── */
  function str(v, fb, max) {
    if (v == null) return fb;
    var s = String(v).replace(/\s+/g, ' ').trim();
    if (!s) return fb;
    return s.length > max ? s.slice(0, max) : s;
  }
  function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

  return {
    probe: probe,
    ask: ask,
    abilityDoc: abilityDoc,
    parseApis: parseApis,
    componentSpec: componentSpec,
    specFields: specFields,
    renderComponent: renderComponent,
    appPlan: appPlan,
    tone: tone,
    _validate: validate
  };
})();
