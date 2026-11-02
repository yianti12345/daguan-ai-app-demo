/* ─────────────────────────────────────────────────────────────
   configurator.js —— 配置器**宿主**（host）。契约见 CONFIGURATOR.md（v1 修订版）。

   一句话：宿主是唯一碰得到 DB / localStorage / URL 的一方；
   配置器只拿「快照 + 增量回调 + 取值表 + 候选清单」，画不出边界以外的东西。

   ★ 六条硬边界，任何一条破了这个架构就退化成"两套页面"：
     ① 配置器拿不到 DB。挂载期间 window.DB 被临时摘掉（K2），传进去的 value 是深拷贝。
     ② 顶栏 / 底部动作区由宿主画（.cfg-hd / .cfg-ft），配置器只往 .cfg-bd > .cfg-body 里填。
        一致性靠"配置器没有权限破坏它"，不靠"作者记得别破坏"（K6）。
     ③ 合并只有一个实现（本文件）。依据不是 key，是**语义指纹 sem**（§5.1-5.2）：
        sem = key + ':' + type + '@' + schemaVersion。同名不同义绝不改写，原值进 __rest。
     ④ patch 是**增量**（§5.3）：没出现的键 = 保持不变；要清空必须显式发 null（K11）。
     ⑤ 切换配置器归宿主：有未保存改动时由宿主给「保存并切换 / 放弃并切换 / 取消」，
        配置器收不到"要被换掉了"的通知（收到就会有人自己存一份 ⇒ 两套持久化）。
     ⑥ 三态不白屏（K9）：无可用配置器 / 挂载超时 / 配置器抛错，都必须留下 .cfg-hd、
        .cfg-ft 和一句人话，且"崩溃"与"加载中"视觉可区分。

   ★ 数据边界：window.__cfgLog（只在 ?debug=1 挂）是动作元数据流水，
     只记 谁 / 哪个键 / 成没成，**绝不记字段值** —— 与 assets/xiaozhi.js 的 __xzLog 同口径。
     config 里可能装着客户名、规则口径这类业务内容，不进日志。

   契约 API（名字固定，见 §2.1）：
     Configurator.list(bindsTo)  getDefault(bindsTo)  mount(hostEl, cfg, opts)
     importManifest(json)  setDefault(id)  actionWhitelist
   宿主内部口子（页面与判据用，不属于契约 API）：
     attach(barEl, shellEl, {bindsTo, id, cfgId})
     mergeState(prevConfig, patch, manifest)  → {value, rest, sem, conflicts}   §5 的唯一实现
     semOf(field, manifest)  KEY_WORDS  FIELD_TYPES
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ══ 0. 常量（契约里写死的东西，只在这里出现一次）══════════════ */
  var LS_PREFIX = 'ifas90:cfg:';          /* 导入的配置器：ifas90:cfg:<id>，与种子数据分离 */
  var LS_DEFAULT = 'ifas90:cfgDefault:';  /* 每类型的默认配置器 id（内置也要能设默认，§8.4） */

  var ACTIONS = ['save', 'publish', 'cancel', 'test'];
  var ACT_LABEL = { save: '保存当前配置', publish: '保存', cancel: '取消', test: '试运行' };
  var ACT_KIND = { save: 'normal', publish: 'primary', cancel: 'normal', test: 'normal' };
  var FALLBACK_ACTS = ['save', 'publish', 'cancel'];

  /* §3.1 字段 key 词表 —— 键是跨配置器的公共语言，label 才是各家自由发挥的地方 */
  var KEYS = ['name', 'desc', 'scope', 'fields', 'client', 'comps', 'enabled', 'note'];
  /* label 回填表：manifest 没写 name 时用它，**永远不把 key 显示到界面上**（V6）
     —— 直接上屏 'scope' 这种事不会报错，用户只会觉得这系统没做完。 */
  var KEY_LABEL = {
    name: '名称', desc: '说明', scope: '适用口径', fields: '字段',
    client: '客户', comps: '组件', enabled: '启用', note: '备注'
  };
  var TYPES = ['text', 'textarea', 'number', 'select', 'switch', 'tags', 'list'];
  var TYPE_T = {
    text: '单行文本', textarea: '多行文本', number: '数字', select: '下拉',
    switch: '开关', tags: '标签', list: '列表'
  };
  /* 块白名单：.cfg-body 里的块级节点只认这五种（V1） */
  var BLOCKS = ['group', 'field', 'cols', 'preview', 'hint'];
  /* K9 的"2s 超时" = **mount 返回耗时 > 2s**。同步挂载把线程卡死（while(true)）不在 v1 的
     防守范围 —— 那需要 iframe/Worker 隔离，属 render:'code' 那个量级，留 v2。
     所以下面的 watchdog + 返回后补一次耗时判定，防的是"慢"，不是"死"。 */
  var MOUNT_TIMEOUT = 2000;

  /* ══ 1. 调试流水 ═══════════════════════════════════════════════ */
  var DEBUG = (function () {
    try { if (localStorage.getItem('xz:debug') === '1') return true; } catch (e) {}
    var hay = String(location.href || '');
    try {
      var nav = (window.performance && performance.getEntriesByType)
        ? performance.getEntriesByType('navigation')[0] : null;
      if (nav && nav.name) hay += ' ' + nav.name;
    } catch (e) {}
    return /(?:^|[?&#\s])debug=1(?:[&#]|$)/.test(hay);
  })();
  var LOG = [];
  if (DEBUG) window.__cfgLog = LOG;
  var SEQ = 0;
  function log(ev, p) {
    if (!DEBUG) return;
    var e = { seq: ++SEQ, at: Date.now(), ev: ev };
    if (p) for (var k in p) e[k] = p[k];      /* 只放 id / key / 计数，不放值 */
    LOG.push(e);
    if (LOG.length > 200) LOG.shift();
  }

  /* ══ 2. 小工具 ═════════════════════════════════════════════════ */
  function deepCopy(o) {
    if (o == null) return o;
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
  }
  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function dedupe(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (c) { if (c && !seen[c.key]) { seen[c.key] = 1; out.push(c); } });
    return out;
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ══ 3. 配置器登记表 ═══════════════════════════════════════════ */
  function builtinCfgs() {
    var r = window.__CFG_BUILTIN;
    return (r && r.length) ? r.slice() : [];
  }
  function normBuiltin(cfg) {
    var m = deepCopy(cfg && cfg.manifest) || {};
    m.origin = 'builtin';                 /* origin 由宿主写，不信包里自述 */
    m.isDefault = !!(cfg && cfg.manifest && cfg.manifest.isDefault);
    return { manifest: m, mount: (cfg && typeof cfg.mount === 'function') ? cfg.mount : null };
  }
  function importedCfgs() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(LS_PREFIX) !== 0) continue;
        var m = null;
        try { m = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
        if (!m || !m.id) continue;
        m.origin = 'imported';
        m.isDefault = false;              /* §4：导入后恒为 false */
        out.push({ manifest: m, mount: null });
      }
    } catch (e) {}
    return out;
  }
  function allCfgs() { return builtinCfgs().map(normBuiltin).concat(importedCfgs()); }

  /* ══ 4. list / getDefault / setDefault ════════════════════════ */
  function list(bindsTo) {
    var all = allCfgs();
    if (bindsTo) all = all.filter(function (c) { return c.manifest.bindsTo === bindsTo; });
    var defId = null;
    try { defId = bindsTo ? localStorage.getItem(LS_DEFAULT + bindsTo) : null; } catch (e) {}
    if (defId && all.some(function (c) { return c.manifest.id === defId; })) {
      all.forEach(function (c) { c.manifest.isDefault = (c.manifest.id === defId); });
    }
    /* §8.4 内置 ≠ 不能替换：内置排在前面只是"出厂顺序"，不是权限。
       两者在选项里长得一样，只有角标文字不同（渲染见 renderBar）。 */
    return all.map(function (c) { return c.manifest; });
  }
  function resolve(id) {
    var all = allCfgs();
    for (var i = 0; i < all.length; i++) if (all[i].manifest.id === id) return all[i];
    return null;
  }
  function manifestOf(id) {
    var all = allCfgs();
    var rec = null;
    for (var i = 0; i < all.length; i++) if (all[i].manifest.id === id) rec = all[i];
    if (!rec) return null;
    var ms = list(rec.manifest.bindsTo);
    for (var j = 0; j < ms.length; j++) if (ms[j].id === id) return ms[j];
    return rec.manifest;
  }
  function getDefault(bindsTo) {
    var ms = list(bindsTo);
    for (var i = 0; i < ms.length; i++) if (ms[i].isDefault) return ms[i];
    for (var j = 0; j < ms.length; j++) if (ms[j].origin === 'builtin') return ms[j];
    return null;
  }
  function setDefault(id) {
    var rec = resolve(id);
    if (!rec) { log('setDefault', { ok: false, id: String(id) }); return false; }
    try { localStorage.setItem(LS_DEFAULT + rec.manifest.bindsTo, id); } catch (e) { return false; }
    log('setDefault', { ok: true, id: id, bindsTo: rec.manifest.bindsTo });
    return true;
  }

  /* ══ 5. sem：语义指纹（§5.1）═════════════════════════════════
     sem 由宿主算，配置器不声明也改不了 —— 作者没法靠"我觉得一样"绕过。 */
  function semOf(field, manifest) {
    var f = field || {};
    var sv = (manifest && manifest.schemaVersion) || 1;
    return String(f.key) + ':' + String(f.type || 'text') + '@' + sv;
  }
  function fieldsOf(manifest) {
    var f = manifest && manifest.contract && manifest.contract.fields;
    return Array.isArray(f) ? f.filter(function (x) { return x && x.key; }) : [];
  }
  function declaredKeys(manifest) {
    return fieldsOf(manifest).map(function (f) { return f.key; });
  }

  /* ══ 6. 合并（§5.2 / §5.3 的唯一实现）═════════════════════════
     prevConfig 是**整份**存下来的 config（含 __sem / __rest）；
     patch 是**增量**：没出现的键保持不变，显式 null 才清空。 */
  function mergeState(prevConfig, patch, manifest) {
    var raw = (prevConfig && typeof prevConfig === 'object') ? prevConfig : {};
    var prevSem = (raw.__sem && typeof raw.__sem === 'object') ? raw.__sem : {};
    var prevRest = (raw.__rest && typeof raw.__rest === 'object') ? deepCopy(raw.__rest) : {};
    var fields = fieldsOf(manifest);
    var declared = fields.map(function (f) { return f.key; });
    var curSem = {};
    fields.forEach(function (f) { curSem[f.key] = semOf(f, manifest); });

    var value = {}, rest = {}, conflicts = [], semMissing = [];

    /* __rest 归一：新形 {v, sem}；老形（裸值）也能读 —— sem 从 __sem 里补。
       sem 必须跟着值一起躺在 __rest 里，否则"这份旧值是哪套语义写的"就没处查，
       回流和"原值已保留"的说明都做不出来。 */
    Object.keys(prevRest).forEach(function (k) {
      var r = prevRest[k];
      if (r && typeof r === 'object' && has(r, 'v')) rest[k] = { v: deepCopy(r.v), sem: r.sem || null };
      else rest[k] = { v: deepCopy(r), sem: prevSem[k] || null };
    });

    /* ① 分拣已存的值：同义 → 可见；异义 → __rest；未声明的键 → __rest */
    Object.keys(raw).forEach(function (k) {
      if (k === '__sem' || k === '__rest') return;
      /* undefined 不算"有值"：它一旦参与判定，就会把 __rest 里那份真值盖成 undefined，
         而界面上看起来只是"这项是空的"。没值就当它没出现。 */
      if (raw[k] === undefined) return;
      if (declared.indexOf(k) < 0) { rest[k] = { v: deepCopy(raw[k]), sem: prevSem[k] || null }; return; }
      var ps = prevSem[k];
      if (ps === undefined) {
        /* 老数据 / 第一次用这套配置器：按同名合并，但要留痕（§5.2） */
        value[k] = deepCopy(raw[k]); semMissing.push(k);
      } else if (ps === curSem[k]) {
        value[k] = deepCopy(raw[k]);
      } else {
        /* ★ 同名不同义：**绝不改写**。原值（连同它当年的 sem）进 __rest。 */
        rest[k] = { v: deepCopy(raw[k]), sem: ps };
        conflicts.push({ key: k, prevSem: ps, curSem: curSem[k] });
      }
    });

    /* ①b 回流（契约 §5）：__rest 里那份的 sem 正好等于当前配置器 ⇒ 取回可见区。
       值一个字节没变，只是回到它该在的地方 —— 否则用户切走再切回会看到空表单，
       而值其实还躺在 __rest 里："数据还在但界面丢了"和"数据丢了"一样坏。 */
    declared.forEach(function (k) {
      var r = rest[k];
      if (value[k] === undefined && r && r.sem && r.sem === curSem[k]) {
        value[k] = deepCopy(r.v);
        delete rest[k];
      }
    });

    /* ② 再叠 patch：增量语义，出现才改，null 才清 */
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        if (declared.indexOf(k) < 0) { log('patchUnsupportedKey', { key: k }); return; }
        if (patch[k] === undefined) return;          /* 没值 = 没出现（§5.3） */
        if (patch[k] === null) { delete value[k]; return; }
        value[k] = deepCopy(patch[k]);
      });
    }
    if (semMissing.length) log('semMissing', { keys: semMissing.join(',') });

    /* sem 快照要**连 __rest 里的键一起留着**：不留就永远不知道那份旧值的语义指纹，
       复活和"原值已保留"的说明都做不出来。 */
    var semOut = {};
    Object.keys(prevSem).forEach(function (k) { semOut[k] = prevSem[k]; });
    declared.forEach(function (k) { if (value[k] !== undefined) semOut[k] = curSem[k]; });

    return { value: value, rest: rest, sem: semOut, conflicts: conflicts };
  }

  /* ══ 7. 取值表 / 候选清单 ═════════════════════════════════════
     choices 是 §2.2 唯一的取数例外：只注入声明为 list 且 key 在词表内的字段，
     值来自宿主读 DB 后深拷贝。目前白名单只有 comps。 */
  function tokensSnap() {
    var out = {};
    try {
      var cs = getComputedStyle(document.documentElement);
      for (var i = 0; i < cs.length; i++) {
        var p = cs[i];
        if (p && p.indexOf('--') === 0) out[p] = String(cs.getPropertyValue(p)).trim();
      }
    } catch (e) {}
    try { Object.freeze(out); } catch (e) {}
    return out;
  }
  function choicesFor(manifest) {
    var out = {};
    var keys = fieldsOf(manifest)
      .filter(function (f) { return f.type === 'list' && f.key === 'comps'; })
      .map(function (f) { return f.key; });
    if (!keys.length) return out;
    var DBx = window.DB;
    if (!DBx || !DBx.COMPS) return out;
    keys.forEach(function (k) {
      out[k] = DBx.COMPS
        .filter(function (c) { return c.enabled !== false && c.status !== '已下架'; })
        .map(function (c) { return { v: c.id, t: c.name }; });
    });
    return deepCopy(out) || {};
  }

  /* ══ 8. 动作 ═══════════════════════════════════════════════════ */
  function actionsOf(manifest) {
    var a = (manifest && manifest.contract && manifest.contract.actions) || [];
    var keys = [];
    a.forEach(function (x) {
      var k = x && x.key;
      if (k && ACTIONS.indexOf(k) >= 0 && keys.indexOf(k) < 0) keys.push(k);
    });
    if (!keys.length) keys = FALLBACK_ACTS.slice();
    return keys;
  }
  function fireAction(key, manifest, opts) {
    if (ACTIONS.indexOf(key) < 0) {
      log('rejected', { key: String(key), by: manifest && manifest.id });
      if (opts && opts.onReject) opts.onReject(key);
      return false;
    }
    log('action', { key: key, by: manifest && manifest.id });
    if (opts && opts.onAction) opts.onAction(key, manifest);
    return true;
  }

  /* ══ 9. 导入（§4：失败整体拒绝，不做"尽力而为"）═════════════════ */
  function importManifest(input) {
    var errors = [];
    var m = input;
    if (typeof input === 'string') {
      try { m = JSON.parse(input); } catch (e) { errors.push('这不是合法的 JSON'); m = null; }
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      errors.push('manifest 必须是一个对象');
    } else {
      if (!m.id || typeof m.id !== 'string') errors.push('缺 id');
      else if (!/^cfg-[a-z0-9][a-z0-9-]*$/.test(m.id)) errors.push('id 要以 cfg- 开头，只含小写字母/数字/连字符：' + m.id);
      if (m.kind !== 'configurator') errors.push('kind 必须是 "configurator"');
      if (m.bindsTo !== 'component' && m.bindsTo !== 'app') errors.push('bindsTo 只认 "component" 或 "app"');
      if (m.render && m.render !== 'declarative') errors.push('这一版只收 render: "declarative"（code 模式等于往后台注入第三方 JS，§8.2）');
      var fields = (m.contract && Array.isArray(m.contract.fields)) ? m.contract.fields : null;
      if (!fields) errors.push('缺 contract.fields');
      else if (!fields.length) errors.push('contract.fields 是空的');
      else {
        var okN = 0;
        fields.forEach(function (f) {
          if (!f || !f.key) { errors.push('有一个字段缺 key'); return; }
          /* §3.1：key 只能取词表里的八个 —— 词表外的 key 会让同一实体长出两套语义 */
          if (KEYS.indexOf(f.key) < 0) {
            errors.push('字段 key 不在词表里：' + f.key + '（只认 ' + KEYS.join(' / ') + '）');
          } else if (!f.name) {
            /* name 必填：缺了界面上就只剩机器词，见 V6 */
            errors.push('字段「' + f.key + '」缺 name（label）');
          }
          if (TYPES.indexOf(f.type) >= 0) okN++;
        });
        if (!okN) errors.push('字段类型全都不支持（认 ' + TYPES.join(' / ') + '）');
      }
      if (m.id && resolve(m.id)) errors.push('id 与已有配置器重名：' + m.id);
    }
    if (errors.length) {
      log('import', { ok: false, n: errors.length });
      return { ok: false, errors: errors };      /* ★ ok=false 时一个字节都不写 */
    }
    var out = deepCopy(m) || {};
    out.origin = 'imported';
    out.isDefault = false;
    out.name = out.name || out.id;
    out.version = out.version || '1.0.0';
    out.schemaVersion = out.schemaVersion || 1;
    try { localStorage.setItem(LS_PREFIX + out.id, JSON.stringify(out)); }
    catch (e) { return { ok: false, errors: ['这台电脑存不进去（隐私模式？）'] }; }
    log('import', { ok: true, id: out.id });
    return { ok: true, errors: [] };
  }

  /* ══ 10. 外壳（.cfg-hd / .cfg-bd / .cfg-ft 三块由宿主画到底）═══ */
  function shell(hostEl, o) {
    o = o || {};
    var stale = hostEl.querySelector('.cfg-body');
    if (stale && stale.__cfgMO) { try { stale.__cfgMO.disconnect(); } catch (e) {} }
    hostEl.innerHTML = '';
    var box = el('div', 'cfg-box');
    var hd = el('div', 'cfg-hd');
    /* .cfg-hd 只由**实体**决定，不由配置器决定 ⇒ 换配置器时逐字相同（K6/K12）；
       也不含任何业务字段名（K1）。 */
    hd.innerHTML = '<b>' + esc(o.title || '') + '</b>'
      + (o.tag ? '<span class="cfg-tag">' + esc(o.tag) + '</span>' : '')
      + '<span class="cfg-sp"></span>'
      + (o.meta ? '<span class="cfg-tag">' + esc(o.meta) + '</span>' : '');

    var bd = el('div', 'cfg-bd');
    bd.setAttribute('data-cfg-block', 'group');
    var notices = el('div', 'cfg-notices');
    var body = el('div', 'cfg-body');
    body.setAttribute('data-cfg-block', 'group');
    bd.appendChild(notices);
    bd.appendChild(body);

    var ft = el('div', 'cfg-ft');
    box.appendChild(hd); box.appendChild(bd); box.appendChild(ft);
    hostEl.appendChild(box);

    var api = { box: box, hd: hd, bd: bd, body: body, notices: notices, ft: ft, memo: null,
      actions: function (acts, disabled) {
        ft.innerHTML = '';
        var memo = el('span', 'cfg-memo');
        memo.setAttribute('role', 'status');
        memo.setAttribute('aria-live', 'polite');
        ft.appendChild(memo);
        ft.appendChild(el('span', 'cfg-sp'));
        (acts || []).forEach(function (k) {
          var b = el('button', 'cfg-btn');
          b.type = 'button';
          b.setAttribute('data-act', k);
          b.setAttribute('data-kind', ACT_KIND[k] || 'normal');
          b.textContent = ACT_LABEL[k] || k;
          if (disabled) { b.disabled = true; b.title = '当前没有可用的配置界面'; }
          else b.addEventListener('click', function () { fireAction(k, o.manifest, o.opts); });
          ft.appendChild(b);
        });
        api.memo = memo;
        return api;
      } };
    return api;
  }

  /* ══ 11. 块白名单过滤（V1）═══════════════════════════════════
     规则**统一**，不按 origin 分档（契约 §2.2 / §8.4：内置与导入在视觉与能力上等强）：
       · .cfg-bd 里**允许** button —— "接受这条 / 移除 / 展开"是配置器该有的局部动作
       · **禁止** [data-cfg-action] 与 a[href] —— 系统动作与导航的入口，出现即移除 + 记 action-escaped
       · .cfg-bd 里的按钮**不许和 .cfg-ft 的动作同名** —— 否则又出现"两个保存"
     分层是自然发生的：内置是命令式挂载、能画按钮；v1 的导入是声明式渲染、本来就不产生按钮。
     所以这里不需要"谁更能干"的第二套身份。
     跑的是"属性"，不是 class —— class 是排版的事，能不能干什么是宿主说了算。 */
  function sanitize(body, manifest, ftLabels) {
    if (!body) return;
    var labels = ftLabels || [];
    /* ① 系统动作 / 导航外逃：一律摘 */
    body.querySelectorAll('[data-cfg-action], a[href]').forEach(function (n) {
      log('action-escaped', { by: manifest && manifest.id, tag: n.tagName.toLowerCase() });
      n.parentNode && n.parentNode.removeChild(n);
    });
    /* ② 和底部动作同名的按钮：摘掉（同一条数据两个入口 = 迟早两条路径） */
    body.querySelectorAll('button').forEach(function (n) {
      var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || labels.indexOf(t) < 0) return;
      log('action-dup', { by: manifest && manifest.id, text: t });
      n.parentNode && n.parentNode.removeChild(n);
    });
    /* ③ 块标记：不认的值换占位（不 throw、不静默丢弃） */
    body.querySelectorAll('[data-cfg-block]').forEach(function (n) {
      var v = n.getAttribute('data-cfg-block');
      if (BLOCKS.indexOf(v) >= 0) return;
      log('block-unknown', { v: String(v) });
      var ph = el('div', 'cfg-unknown');
      ph.setAttribute('data-cfg-block', 'group');
      ph.textContent = '这段内容当前版本不认识，已原样收起';
      ph.setAttribute('data-cfg-block-orig', String(v));
      n.parentNode && n.parentNode.replaceChild(ph, n);
    });
    /* ④ 没标的块级节点补 group（"宿主打属性"，不是要求作者记得打） */
    var BLOCKY = 'div,section,aside,ul,ol,p,table,dl,header,footer,figure';
    body.querySelectorAll(BLOCKY).forEach(function (n) {
      if (n.hasAttribute('data-cfg-block')) return;
      if (n.closest('.cfg-unknown')) return;
      n.setAttribute('data-cfg-block', 'group');
    });
  }

  /* ══ 12. mount ════════════════════════════════════════════════ */
  function labelOf(f) {
    /* ★ 永远不把 key 上屏（V6）：name → 回填表 → 「未命名字段」+ .cfg-label-unknown */
    if (f && f.name) return { text: String(f.name), unknown: false };
    if (f && KEY_LABEL[f.key]) return { text: KEY_LABEL[f.key], unknown: false };
    return { text: '未命名字段', unknown: true };
  }

  function mount(hostEl, cfg, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('Configurator.mount 需要一个挂载点');
    var rec = (cfg && cfg.manifest) ? cfg : { manifest: cfg || {}, mount: null };
    var m = rec.manifest || {};

    var ui = shell(hostEl, {
      title: opts.title, tag: opts.tag, meta: opts.meta,
      manifest: m, opts: opts
    });
    ui.actions(actionsOf(m));

    var safe = {
      value: deepCopy(opts.value) || {},
      tokens: tokensSnap(),
      choices: choicesFor(m),
      actions: actionsOf(m).map(function (k) {
        return { key: k, label: ACT_LABEL[k] || k, kind: ACT_KIND[k] || 'normal' };
      }),
      onChange: function (patch) { if (opts.onChange) opts.onChange(patch, m); },
      onAction: function (key) { fireAction(key, m, opts); }
    };

    var done = false, failed = false;
    function degrade(why, detail) {
      if (failed) return;
      failed = true;
      ui.body.innerHTML = '';
      var box = el('div', 'cfg-crash');
      box.setAttribute('data-why', why);
      box.setAttribute('data-cfg-block', 'hint');
      box.innerHTML = '<b>' + (why === 'timeout' ? '这套配置界面加载超时' : '这套配置界面没能打开') + '</b>'
        + '<span>' + (why === 'timeout'
          ? '已经等了两秒还没出来，先关掉它；动作区还能用。'
          : '它自身出错了，页面其它部分不受影响。') + '</span>'
        + (detail ? '<code>' + esc(String(detail).slice(0, 120)) + '</code>' : '');
      ui.body.appendChild(box);
      log('mount-degraded', { why: why, by: m && m.id });
    }

    /* 加载中：先落地一句，慢挂载时用户不会面对一块空白（与"崩溃"是两套外观） */
    var loading = el('div', 'cfg-loading');
    loading.setAttribute('data-cfg-block', 'hint');
    loading.textContent = '正在打开配置界面…';
    ui.body.appendChild(loading);

    var t0 = now();
    var watchdog = setTimeout(function () { if (!done) degrade('timeout'); }, MOUNT_TIMEOUT);
    try {
      if (typeof rec.mount === 'function') {
        /* ★ K2：挂载期间把 window.DB 摘掉 —— 装配里读 DB 只能读到 undefined。
           同步返回后立刻还原。边界写清楚：这覆盖"挂载那一刻"，
           异步回调里再读拦不住，那是纪律不是这一行能保的。 */
        var saved = window.DB;
        try { window.DB = undefined; rec.mount(ui.body, safe); }
        finally { window.DB = saved; }
      } else {
        renderDeclarative(ui.body, m, safe);
      }
      done = true;
    } catch (e) {
      done = true;
      degrade('throw', e && e.message ? e.message : e);
    }
    clearTimeout(watchdog);
    if (!failed && (now() - t0) > MOUNT_TIMEOUT) degrade('timeout');
    if (loading.parentNode) loading.parentNode.removeChild(loading);

    var ftLabels = actionsOf(m).map(function (k) { return ACT_LABEL[k] || k; });
    sanitize(ui.body, m, ftLabels);
    watchBody(ui.body, m, ftLabels);
    return ui;
  }

  /* 动态重渲染（对话式会整块重建列表）也要过白名单，不能只过滤一次 */
  function watchBody(body, manifest, ftLabels) {
    if (!window.MutationObserver) return;
    var busy = false;
    var mo = new MutationObserver(function () {
      if (busy) return;
      busy = true;
      try { sanitize(body, manifest, ftLabels); } finally { busy = false; }
    });
    mo.observe(body, { childList: true, subtree: true });
    body.__cfgMO = mo;
  }

  /* ══ 13. 声明式渲染（导入的配置器只走这条路）═════════════════ */
  function renderDeclarative(body, manifest, safe) {
    var fields = fieldsOf(manifest);
    var wrap = el('div', 'cfg-fields');
    wrap.setAttribute('data-cfg-block', 'group');
    var val = safe.value || {};

    /* §5.3：patch 是增量 —— 只发这一个键；清空要显式发 null */
    function put(key, v) {
      var p = {}; p[key] = v;
      safe.onChange(p);
      val[key] = v;
    }

    fields.forEach(function (f) {
      var box = el('div', 'bd-field cfg-field');
      box.setAttribute('data-cfg-block', 'field');
      var lab = el('label', 'cfg-label');
      var L = labelOf(f);
      lab.textContent = L.text;
      if (L.unknown) { lab.className += ' cfg-label-unknown'; box.className += ' cfg-unknown'; }
      var id = 'cfg-f-' + f.key;
      lab.setAttribute('for', id);
      box.appendChild(lab);

      var type = TYPES.indexOf(f.type) >= 0 ? f.type : 'text';
      var degraded = type !== f.type;
      var cur = (val[f.key] === undefined) ? '' : val[f.key];

      if (type === 'textarea') {
        var ta = el('textarea', 'bd-input cfg-ctl cfg-ta');
        ta.id = id; ta.rows = f.rows || 3;
        ta.value = String(cur || '');
        ta.addEventListener('input', function () { put(f.key, ta.value); });
        box.appendChild(ta); box.className += ' cfg-wide';
      } else if (type === 'select') {
        var se = el('select', 'bd-input cfg-ctl');
        se.id = id;
        (f.options || []).forEach(function (o) {
          var op = document.createElement('option');
          op.value = o.v; op.textContent = o.t;
          if (String(o.v) === String(cur)) op.selected = true;
          se.appendChild(op);
        });
        se.addEventListener('change', function () { put(f.key, se.value); });
        box.appendChild(se);
      } else if (type === 'switch') {
        box.appendChild(switchEl(id, !!cur, function (v) { put(f.key, v); }));
      } else if (type === 'list' && safe.choices && safe.choices[f.key]) {
        /* 有候选清单 ⇒ 胶囊多选（§2.2c）。不用勾选框：16 的方框和胶囊语言不搭。
           未选 = .tag 的样子；已选 = 品牌浅底 + 品牌字 + 品牌描边。 */
        var opts = safe.choices[f.key];
        var sel = Array.isArray(cur) ? cur.slice() : [];
        var wrapTags = el('div', 'cfg-tags');
        wrapTags.setAttribute('data-cfg-block', 'group');
        function paintTags() {
          wrapTags.innerHTML = opts.map(function (c) {
            var on = sel.indexOf(c.v) >= 0;
            return '<button type="button" class="cfg-tag' + (on ? ' is-on' : '') + '" data-v="'
              + esc(c.v) + '" aria-pressed="' + on + '">' + esc(c.t) + '</button>';
          }).join('');
        }
        wrapTags.addEventListener('click', function (e) {
          var b = e.target;
          if (!b || b.tagName !== 'BUTTON' || !b.hasAttribute('data-v')) return;
          var v = b.getAttribute('data-v');
          var i = sel.indexOf(v);
          if (i >= 0) sel.splice(i, 1); else sel.push(v);
          put(f.key, sel.slice());
          paintTags();
        });
        paintTags();
        box.appendChild(wrapTags);
      } else if (type === 'tags' || type === 'list') {
        var ti = el('input', 'bd-input cfg-ctl');
        ti.id = id; ti.type = 'text';
        ti.value = Array.isArray(cur) ? cur.join('、') : String(cur || '');
        ti.addEventListener('input', function () {
          put(f.key, ti.value.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean));
        });
        box.appendChild(ti);
        if (type === 'list') {
          /* 降级必须看得见（SOP 第 17 条）：否则用户会以为这就是设计 */
          var hint = el('span', 'cfg-hint');
          hint.setAttribute('data-cfg-block', 'hint');
          hint.textContent = '候选项未提供，暂以顿号分隔的文本编辑';
          box.appendChild(hint);
        }
      } else {
        var ip = el('input', 'bd-input cfg-ctl');
        ip.id = id;
        ip.type = (type === 'number') ? 'number' : 'text';
        ip.value = String(cur == null ? '' : cur);
        ip.addEventListener('input', function () {
          put(f.key, type === 'number' ? Number(ip.value) : ip.value);
        });
        box.appendChild(ip);
      }

      if (degraded) {
        var d = el('span', 'cfg-hint cfg-unknown');
        d.setAttribute('data-cfg-block', 'hint');
        d.textContent = '此字段类型当前版本不支持：' + (f.type || '（空）');
        box.appendChild(d);
      }
      wrap.appendChild(box);
    });
    body.appendChild(wrap);
  }

  /* switch 的形态与真源一致：44×22 圆轨道（token 驱动，只在 configurator.css 定义一次） */
  function switchEl(id, checked, onChange) {
    var lab = el('label', 'cfg-switch');
    var inp = el('input');
    inp.type = 'checkbox'; inp.id = id; inp.checked = !!checked;
    var track = el('span', 'cfg-switch-track');
    lab.appendChild(inp); lab.appendChild(track);
    inp.addEventListener('change', function () { onChange(inp.checked); });
    return lab;
  }

  /* ══ 14. attach：契约 §2.1 的六步 ════════════════════════════ */
  /* 冲突 = "躺在 __rest 里、语义指纹又和这套配置器对不上"的那些键。
     每次都从现状推，而不是攒一个数组 —— 攒的会过期（复活之后提示还挂着）。 */
  function conflictsFrom(rest, manifest) {
    var cur = {};
    fieldsOf(manifest).forEach(function (f) { cur[f.key] = semOf(f, manifest); });
    var out = [];
    Object.keys(rest || {}).forEach(function (k) {
      var r = rest[k];
      if (!cur[k]) return;                       /* 未声明的键只是"别人的"，不算冲突 */
      var s = r && typeof r === 'object' ? r.sem : null;
      if (s && s !== cur[k]) out.push({ key: k, prevSem: s, curSem: cur[k] });
    });
    return out;
  }

  function conflictNote(c) {
    var keyCn = KEY_LABEL[c.key] || '这一项';
    /* prevSem 形如 'note:textarea@1'，拆出来是为了说人话，而不是把机器串甩给用户 */
    var parts = String(c.prevSem).split(':');
    var t = parts[1] || '';
    var sv = (parts[2] || '').replace(/^@/, '');
    return '「' + keyCn + '」上次是按「' + (TYPE_T[t] || t || '未知控件') + '，schema v' + (sv || '1')
      + '」录入的，本界面不展示它，原值已保留。';
  }

  function attach(bar, shellEl, opts) {
    opts = opts || {};
    var DBx = window.DB;
    var bindsTo = opts.bindsTo || 'component';
    var id = opts.id || '';

    /* ① 实体存在性（K10）：不存在的实体绝不许冒充「新组件」把表单画出来 */
    var entity = null;
    if (DBx) entity = (bindsTo === 'app') ? DBx.appById(id) : DBx.compById(id);

    function paintShell(cfg) {
      var ui = shell(shellEl, cfg);
      return ui;
    }

    if (!id || !entity) {
      var ui0 = paintShell({
        title: '没有这个实体',
        tag: id ? id : '未指定 id',
        meta: '',
        manifest: null,
        opts: opts
      });
      ui0.notices.innerHTML = '<div class="cfg-empty-note">'
        + '没有这个实体：'
        + (id ? '找不到「' + esc(id) + '」这条记录，可能已经被删了。' : '这个地址没有指明要配置哪条记录。')
        + '</div><div class="cfg-empty-act"><a class="cfg-link" href="components.html">回组件库</a></div>';
      ui0.body.innerHTML = '';
      ui0.actions(FALLBACK_ACTS, true);
      log('attach', { ok: false, why: id ? 'no-entity' : 'no-id', id: id });
      return null;
    }

    /* ② 选配置器：?cfg=<id> 指定 > 默认 > 第一个内置 > 没有 */
    var want = opts.cfgId || '';
    var rec = want ? resolve(want) : null;
    var fallback = null;
    if (rec && rec.manifest.bindsTo !== bindsTo) {
      /* ★ 错配必须可见：原来这里直接 rec = null 静默回落，
         结果"应用配置器根本没接上"这件事藏了整整一轮 —— 页面照样画得好好的，
         只是画的是另一个配置器。静默回落是这次事故能活这么久的唯一原因。 */
      fallback = { why: 'bindsTo', want: want, wantFor: rec.manifest.bindsTo };
      rec = null;
    } else if (!rec && want) {
      fallback = { why: 'missing', want: want };
    }
    if (!rec) {
      var dm = getDefault(bindsTo);
      rec = dm ? resolve(dm.id) : null;
    }
    if (fallback && rec) {
      fallback.use = rec.manifest.id;
      log('fallback', { why: fallback.why, want: fallback.want, use: fallback.use, page: bindsTo });
    }

    /* ③ 取实体数据 + 选配置器之前先算一遍（无配置器也要有外壳，K9） */
    if (!rec) {
      var ui1 = paintShell({
        title: entity.name || id, tag: entity.type || '', meta: entity.status || '',
        manifest: null, opts: opts
      });
      ui1.notices.innerHTML = '<div class="cfg-empty-note">未安装可用配置器：这条记录暂时没有配置界面。</div>';
      ui1.body.innerHTML = '';
      ui1.actions(FALLBACK_ACTS, true);
      if (bar) { bar.hidden = false; renderBar(bar, bindsTo, null, function () {}, null, opts); }
      log('attach', { ok: false, why: 'no-configurator', bindsTo: bindsTo });
      return null;
    }

    var state = { value: {}, rest: {}, sem: {}, conflicts: [], rec: rec, dirty: false, ui: null, entity: entity };
    var merged = mergeState(entity.config, null, rec.manifest);
    state.value = merged.value;
    state.rest = merged.rest;
    state.sem = merged.sem;
    state.conflicts = conflictsFrom(state.rest, rec.manifest);

    /* 首次使用（config 里一个声明键都没有）：从实体同名字段播种。
       键来自 manifest、值来自同名字段 —— 宿主里不出现任何业务字段名（K1）。 */
    if (!Object.keys(state.value).length && !Object.keys(entity.config || {}).length) {
      declaredKeys(rec.manifest).forEach(function (k) {
        if (has(entity, k) && entity[k] !== undefined) state.value[k] = deepCopy(entity[k]);
      });
    }

    function memo(text) { if (state.ui && state.ui.memo) state.ui.memo.textContent = text || ''; }

    function conflictHtml() {
      if (!state.conflicts.length) return '';
      return state.conflicts.map(function (c) {
        return '<p class="cfg-conflict" data-cfg-block="hint">' + esc(conflictNote(c)) + '</p>';
      }).join('');
    }

    function paint(msg) {
      var ui = mount(shellEl, state.rec, {
        title: entity.name || id,
        tag: entity.type || (bindsTo === 'app' ? '应用' : ''),
        meta: entity.status || '',
        value: state.value,
        onChange: function (patch, m) {
          /* ★ 增量 patch：只改它发的那几个键（§5.3 / K11） */
          var r = mergeState(
            Object.assign({}, state.value, { __sem: state.sem, __rest: state.rest }),
            patch, m || state.rec.manifest
          );
          state.value = r.value;
          state.rest = r.rest;
          state.sem = r.sem;
          state.conflicts = conflictsFrom(state.rest, state.rec.manifest);
          state.dirty = true;
          memo('已改，尚未保存');
        },
        onAction: function (key) { doAction(key); },
        onReject: function (key) { memo('这个动作不在白名单里：' + key); }
      });
      state.ui = ui;
      /* .cfg-hd / .cfg-ft 由 mount 画好；冲突提示落在宿主自己的 .cfg-notices 里 */
      ui.notices.innerHTML = conflictHtml() + (msg ? '<p class="cfg-conflict">' + esc(msg) + '</p>' : '');
      if (msg) memo(msg);
    }

    /* ⑤ 动作语义：只这四个 */
    function persist(status, msg) {
      entity.config = Object.assign({}, deepCopy(state.value) || {}, {
        __sem: deepCopy(state.sem) || {},
        __rest: deepCopy(state.rest) || {}
      });
      entity.configBy = {
        id: state.rec.manifest.id,
        version: state.rec.manifest.version || '',
        schemaVersion: state.rec.manifest.schemaVersion || 1
      };
      if (status) entity.status = status;
      /* 名字/字段是它在库里的身份：库里那一份跟着配置器走，列表页才看得到同一个名字 */
      if (typeof state.value.name === 'string' && state.value.name) entity.name = state.value.name;
      if (Array.isArray(state.value.fields)) entity.fields = state.value.fields.slice();
      var ok = true;
      if (DBx && typeof DBx.save === 'function') ok = DBx.save();
      state.dirty = false;
      memo(ok ? (msg || '已保存') : '保存失败：这台电脑存不进去');
      log('write', { by: state.rec.manifest.id, status: status || '', ok: ok !== false });
      return ok !== false;
    }

    function doAction(key) {
      if (key === 'save') {
        persist('', '已保存到这条记录');
      } else if (key === 'publish') {
        if (!entity.id || !window.DB || !DB.pushCompVer) { memo('先保存组件，再保存版本'); return; }
        var st = DB.versOf('comp', entity.id).filter(function (r) { return r.kind === 'stable'; });
        var next = (st.length ? Math.max.apply(null, st.map(function (r) { return r.v; })) : 0) + 1;
        var snap = { spec: entity.spec || null, fields: (entity.fields || []).slice(), desc: entity.desc, name: entity.name };
        var v = null;
        try { v = DB.pushCompVer(entity.id, 'v' + next, snap); } catch (e) { v = null; }
        if (!v) { memo('没保存上：这台电脑写不进去'); return; }
        persist('已上架', '已保存 v' + v);
      } else if (key === 'cancel') {
        var back = mergeState(entity.config, null, state.rec.manifest);
        state.value = back.value; state.rest = back.rest; state.sem = back.sem;
        state.conflicts = conflictsFrom(state.rest, state.rec.manifest);
        state.dirty = false;
        paint('已放弃本次修改');
      } else if (key === 'test') {
        memo('试运行要接后端，这一版没有接');
      }
    }

    /* ⑥ 切换归宿主（§2.1-6）：有未保存改动时三步确认，默认焦点在「取消」。
       配置器收不到任何"要被换掉"的通知 —— 它连这个事件都不知道。 */
    function switchTo(newId) {
      if (!newId || newId === state.rec.manifest.id) return;
      var next = resolve(newId);
      if (!next || next.manifest.bindsTo !== bindsTo) { memo('这个配置器不适用于当前记录'); return; }
      if (!state.dirty) { doSwitch(next); return; }
      confirmSwitch(next);
    }

    function confirmSwitch(next) {
      var ui = state.ui;
      var ft = ui.ft;
      ft.innerHTML = '';
      var memoEl = el('span', 'cfg-memo');
      memoEl.setAttribute('role', 'status');
      memoEl.textContent = '有未保存的改动';
      ft.appendChild(memoEl);
      ft.appendChild(el('span', 'cfg-sp'));

      var bCancel = el('button', 'cfg-btn');
      bCancel.type = 'button'; bCancel.setAttribute('data-c', 'cancel');
      bCancel.textContent = '取消';
      var bDrop = el('button', 'cfg-btn');
      bDrop.type = 'button'; bDrop.setAttribute('data-c', 'discard');
      bDrop.textContent = '放弃并切换';
      var bSave = el('button', 'cfg-btn');
      bSave.type = 'button'; bSave.setAttribute('data-c', 'save');
      bSave.setAttribute('data-kind', 'primary');
      bSave.textContent = '保存并切换';

      bCancel.addEventListener('click', function () {
        state.ui.actions(actionsOf(state.rec.manifest));
        restoreMemo();
        renderBar(bar, bindsTo, state.rec.manifest.id, switchTo, state.rec.manifest, opts);
        memo('没有切换，改动还在');
      });
      bDrop.addEventListener('click', function () {
        state.dirty = false;
        doSwitch(next);
      });
      bSave.addEventListener('click', function () {
        if (!persist('', '已保存')) {        /* 保存失败 ⇒ 不切换，并说出原因 */
          state.ui.actions(actionsOf(state.rec.manifest));
          memo('保存失败，所以没有切换：本地存储写不进去');
          renderBar(bar, bindsTo, state.rec.manifest.id, switchTo, manifestOf(state.rec.manifest.id), opts);
          return;
        }
        doSwitch(next);
      });

      ft.appendChild(bCancel); ft.appendChild(bDrop); ft.appendChild(bSave);
      state.ui.memo = memoEl;
      bCancel.focus();                        /* 默认焦点在安全项 */
      log('switch-confirm', { to: next.manifest.id });
    }

    function restoreMemo() { if (state.ui && state.ui.memo) state.ui.memo.textContent = ''; }

    function doSwitch(next) {
      /* 只换界面，不写库：state.value 在内存里带着走（K13） */
      state.rec = next;
      var m2 = mergeState(
        Object.assign({}, state.value, { __sem: state.sem, __rest: state.rest }),
        null, next.manifest
      );
      state.value = m2.value; state.rest = m2.rest; state.sem = m2.sem;
      state.conflicts = conflictsFrom(state.rest, next.manifest);
      paint('已切换配置界面，改动还在');
      renderBar(bar, bindsTo, next.manifest.id, switchTo, manifestOf(next.manifest.id), opts);
      log('switch', { to: next.manifest.id });
    }

    if (bar) {
      bar.hidden = false;
      renderBar(bar, bindsTo, state.rec.manifest.id, switchTo, manifestOf(state.rec.manifest.id), opts);
    }
    /* 回落要说人话：为什么回落、落到哪一套，而不是假装什么都没发生 */
    var fbMsg = '';
    if (fallback && rec) {
      fbMsg = fallback.why === 'bindsTo'
        ? ('「' + fallback.want + '」是给' + (fallback.wantFor === 'app' ? '应用' : '组件') + '用的配置器，这个页面用不了，已回落到「' + rec.manifest.name + '」')
        : ('没有「' + fallback.want + '」这个配置器，已回落到「' + rec.manifest.name + '」');
    }
    paint(fbMsg);
    log('attach', { ok: true, id: id, cfg: state.rec.manifest.id });
    return { state: state, switchTo: switchTo, paint: paint };
  }

  /* ══ 15. 配置器条（§4 + §8.4）═════════════════════════════════ */
  function optionLabel(m) {
    /* §8.4：内置与导入**长得一样**，只有角标文字不同；不许把内置做成灰掉/不可选 */
    var badge = m.origin === 'builtin' ? '内置' : '导入';
    var tail = m.isDefault ? '默认' : (m.origin === 'imported' ? '未生效' : '');
    return m.name + ' · ' + badge + (tail ? ' · ' + tail : '');
  }

  function renderBar(bar, bindsTo, curId, onSwitch, curManifest, opts) {
    var cands = list(bindsTo);
    bar.innerHTML = '';

    var lb = el('span', 'cfg-lb');
    lb.textContent = '配置器';
    bar.appendChild(lb);

    if (cands.length) {
      var se = el('select', 'cfg-sel');
      se.id = 'cfg-sel';
      se.setAttribute('aria-label', '选择配置器');
      cands.forEach(function (m) {
        var op = document.createElement('option');
        op.value = m.id;
        op.textContent = optionLabel(m);
        if (m.id === curId) op.selected = true;
        se.appendChild(op);
      });
      se.addEventListener('change', function () { onSwitch(se.value); });
      bar.appendChild(se);
    }

    var file = el('input');
    file.type = 'file';
    file.id = 'cfg-file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { showImport(bar, bindsTo, String(rd.result), onSwitch, curId, opts); };
      rd.readAsText(f);
      file.value = '';
    });
    bar.appendChild(file);

    var imp = el('button', 'cfg-btn');
    imp.type = 'button';
    imp.id = 'cfg-import';
    imp.textContent = '导入配置器';
    imp.addEventListener('click', function () { file.click(); });
    bar.appendChild(imp);

    /* §4：设默认是一次显式动作；内置也能被设成默认（§8.4 机制能不能成立就在这一条） */
    var dft = el('button', 'cfg-btn');
    dft.type = 'button';
    dft.id = 'cfg-default';
    if (curManifest && curManifest.isDefault) {
      dft.textContent = '已是默认';
      dft.disabled = true;
    } else {
      dft.textContent = '设为默认';
      dft.addEventListener('click', function () {
        if (!curId) return;
        if (setDefault(curId)) {
          dft.disabled = true;
          dft.textContent = '已是默认';
          note('已设为默认：以后打开这条记录就是这套界面');
          renderBar(bar, bindsTo, curId, onSwitch, manifestOf(curId), opts);
        }
      });
    }
    bar.appendChild(dft);

    bar.appendChild(el('span', 'cfg-sp'));

    var memo = el('span', 'cfg-memo');
    memo.id = 'cfg-bar-memo';
    memo.setAttribute('role', 'status');
    memo.setAttribute('aria-live', 'polite');
    bar.appendChild(memo);

    function note(t) { memo.textContent = t || ''; }
  }

  /* 导入成功 ≠ 生效（§4 三处说明）：成功条 + 行内「未生效」+ 主按钮「试用一次」 */
  function showImport(bar, bindsTo, text, onSwitch, curId, opts) {
    var r = importManifest(text);
    renderBar(bar, bindsTo, curId, onSwitch, curId ? manifestOf(curId) : null, opts);
    var memo = document.getElementById('cfg-bar-memo');
    if (!r.ok) {
      if (memo) memo.textContent = '导入被拒绝：' + r.errors.join('；');
      return;
    }
    var m = null;
    try { m = JSON.parse(localStorage.getItem(LS_PREFIX + (JSON.parse(text) || {}).id)); } catch (e) {}
    var id = m && m.id;
    if (memo) memo.textContent = '已导入，尚未生效';
    if (!id) return;

    /* 成功条：试用一次（主）+ 设为默认（次） */
    var strip = el('span', 'cfg-importok');
    var tryBtn = el('button', 'cfg-btn');
    tryBtn.type = 'button';
    tryBtn.setAttribute('data-kind', 'primary');
    tryBtn.id = 'cfg-try';
    tryBtn.textContent = '试用一次';
    tryBtn.addEventListener('click', function () { onSwitch(id); });
    var defBtn = el('button', 'cfg-btn');
    defBtn.type = 'button';
    defBtn.id = 'cfg-make-default';
    defBtn.textContent = '设为默认';
    defBtn.addEventListener('click', function () {
      setDefault(id);
      renderBar(bar, bindsTo, id, onSwitch, manifestOf(id), opts);
      var mm = document.getElementById('cfg-bar-memo');
      if (mm) mm.textContent = '已设为默认：以后打开这条记录就是这套界面';
    });
    strip.appendChild(tryBtn);
    strip.appendChild(defBtn);
    bar.appendChild(strip);
  }

  /* ══ 16. 双主按钮（V4）: .cfg-ft 起来时，页面自带的浮层主按钮必须摘掉 ═══
     归属是宿主，不是 float.js —— float.js 四个页面共用，改它会破掉
     "不带 ?cfg= 时行为一字不变"这条硬约束。 */
  function stripFloatPrimary() {
    var box = document.getElementById('fk-ops');
    if (!box) return function () {};
    var removed = [];
    Array.prototype.slice.call(box.querySelectorAll('button')).forEach(function (b) {
      removed.push({ node: b, next: b.nextSibling });
      b.parentNode.removeChild(b);
    });
    /* 全摘，不止主按钮：页面自带那组走 component.js 的 upsert，
       宿主这组走 persist —— 同一份数据两个写入口，迟早分叉。
       容器留着（§8.4 的"可以是空的"）。 */
    log('float-ops-stripped', { n: removed.length });
    return function restore() {
      removed.forEach(function (r) { box.insertBefore(r.node, r.next || null); });
    };
  }

  /* ══ 17. 暴露 ═══════════════════════════════════════════════════ */
  window.Configurator = {
    list: list,
    getDefault: getDefault,
    mount: mount,
    importManifest: importManifest,
    setDefault: setDefault,
    actionWhitelist: ACTIONS.slice(),
    /* 宿主内部口子 */
    attach: attach,
    mergeState: mergeState,
    semOf: semOf,
    labelOf: labelOf,
    resolve: resolve,
    KEY_WORDS: KEYS.slice(),
    KEY_LABEL: KEY_LABEL,
    FIELD_TYPES: TYPES.slice(),
    BLOCK_WORDS: BLOCKS.slice()
  };

  /* ══ 18. 自举：只有 ?cfg=<id> 或 ?cfgbar=1 才接管 ══════════════
     不带参数时这一段直接 return，DOM 与拆分前逐像素一致 ——
     现有门禁和 e2e 是照着那个行为写的，不许一次性全推翻。 */
  var RESTORE_FLOAT = null;
  function boot() {
    var bar = document.getElementById('cfg-bar');
    if (!bar) return;
    var shellEl = document.getElementById('canvas-inner');
    if (!shellEl) return;

    var q = {};
    try {
      var sp = new URLSearchParams(location.search || '');
      q = { id: sp.get('id') || '', cfg: sp.get('cfg') || '', cfgbar: sp.get('cfgbar') || '' };
    } catch (e) {}
    if (!q.cfg && q.cfgbar !== '1') return;      /* 不是配置器模式：什么都不做 */

    /* 这一页配的是哪一类实体：body[data-app] 是 app.html 的既有标记，
       component.html 没有它 —— 不另造一套页面级别的配置。 */
    var bindsTo = document.body.hasAttribute('data-app') ? 'app' : 'component';
    /* ?cfg=1 = "用这个页面的默认配置器"；?cfg=<id> = 点名要哪个 */
    var cfgId = (q.cfg === '1' || q.cfg === 'true') ? '' : q.cfg;

    /* 配置模式下把 legacy 画布让位：只在它是配置器容器的**兄弟**时才隐藏
       （component.html 里 #canvas 包着 #canvas-inner，那种情况不能藏父节点）。 */
    var legacy = document.getElementById('canvas');
    if (legacy && !legacy.contains(shellEl) && legacy.parentNode) {
      legacy.hidden = true;
      legacy.setAttribute('data-cfg-hidden', 'true');
    }
    shellEl.hidden = false;

    /* ── body.cfg-mode 的生命周期：**从页面加载到卸载，没有运行期切换** ──────
       全站只有这一个 add 点，没有任何 remove（grep `cfg-mode` 只有两处：这一行和
       configurator.css 的一条规则）。切换配置器走的是 attach/doSwitch，不碰它。
       所以"运行期摘掉 cfg-mode 会丢草稿"这个担心不成立：草稿只会在导航时丢，
       而导航丢草稿是全站既有行为，不是这条改动引入的。 */
    document.body.classList.add('cfg-mode');
    RESTORE_FLOAT = stripFloatPrimary();

    var got = attach(bar, shellEl, { bindsTo: bindsTo, id: q.id, cfgId: cfgId });
    /* 左上角那颗浮层是页面身份：有实体就写「名字 · 配置」；
       没有实体时**不许留着 legacy 的「新组件」** —— 那等于告诉用户"你正在创建一个新组件"，
       而实际上这个地址指向一条不存在的记录。 */
    var nm = document.getElementById('comp-name') || document.getElementById('app-name');
    var ver = document.getElementById('comp-ver');
    var e = bindsTo === 'app'
      ? (window.DB && window.DB.appById ? window.DB.appById(q.id) : null)
      : (window.DB && window.DB.compById ? window.DB.compById(q.id) : null);
    if (nm) nm.textContent = got && e ? (e.name + ' · 配置') : '未指定实体';
    /* 版本那栏必须闭嘴：legacy 的 paintInitial() 会写「v3 · 已发布」，
       而你此刻是在改配置、不是在看线上那一版。留着它就是一句谎话。
       真实状态在卡片头右侧的 .cfg-hd 里（来自实体数据，不是 legacy 的模块变量）。 */
    if (ver) { ver.textContent = ''; ver.hidden = true; }
  }

  window.__cfgRestoreFloat = function () { if (RESTORE_FLOAT) { RESTORE_FLOAT(); RESTORE_FLOAT = null; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
