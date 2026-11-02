/* ─────────────────────────────────────────────────────────────
   configurators/comp-dialog.js —— 内置配置器「对话装配式」（cfg-comp-dialog）

   形态：左边一句需求 + 一个「解析」，右边逐条给出「接受 / 改」。
   和「标准表单式」在**结构上**就不同：那边是一屏输入框 + 右侧预览卡，
   这边是"说一句 → 一条条决定"，字段不以输入框呈现（K12：换界面不是换标题）。

   ★ 解析是**本地关键词**，不调模型：这一轮要证明的是"换界面"，
     不是"接了模型"。文案里也不许说"已接入模型"。
   ★ 只声明 name / fields 两个键：表单式写的 scope / desc 不在这份契约里，
     §5 的合并按 sem 判断"认不认识"，这正是契约要求的隔离。
   ★ patch 是增量（§5.3）；块级节点都打 data-cfg-block（V1 的落点是属性，不是 class）。
   ★ 本文件碰不到 DB / localStorage（CONFIGURATOR.md §2.2）。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>';

  var MANIFEST = {
    id: 'cfg-comp-dialog',
    name: '对话装配式',
    kind: 'configurator',
    bindsTo: 'component',
    origin: 'builtin',
    version: '1.0.0',
    schemaVersion: 1,
    description: '说一句要做什么，逐条确认字段。适合还没想清楚的新组件。',
    icon: ICON,
    render: 'declarative',
    layout: { type: 'two-col' },
    isDefault: false,
    contract: {
      fields: [
        { key: 'name', name: '组件名', type: 'text', required: true },
        { key: 'fields', name: '字段', type: 'tags' }
      ],
      actions: [{ key: 'save' }, { key: 'publish' }, { key: 'cancel' }]
    }
  };

  /* 关键词表：命中就给字段建议。顺序有意义 —— 先命中的先出。 */
  var RULES = [
    { re: /列表|表格|筛选|分页|任务池/, add: ['任务编号', '状态', '处理人'] },
    { re: /详情|对照|原文|附件|抽取/, add: ['原件', '抽取结果'] },
    { re: /规则|审核|复核|结论|判定/, add: ['规则结论', '依据引用'] },
    { re: /表单|录入|填写|提交/, add: ['金额', '期限'] },
    { re: /金额|额度|本金|规模/, add: ['金额'] },
    { re: /客户|机构|主体/, add: ['客户名称', '机构代码'] }
  ];

  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;

  function mount(bd, o) {
    var v = o.value || {};
    var tags = Array.isArray(v.fields) ? v.fields.slice() : [];
    var cands = [];        /* { name, editing } */
    var parsed = false;

    bd.innerHTML =
      '<div class="cfg-split" data-cfg-block="cols">'
      + '<section class="cfg-say" data-cfg-block="group">'
      +   '<label class="cfg-label" for="cfg-d-say">一句话说明这个组件要做什么</label>'
      +   '<textarea class="bd-input cfg-ctl cfg-ta" id="cfg-d-say" rows="3" '
      +     'placeholder="例如：按状态筛任务，能看到金额和处理人"></textarea>'
      +   '<div class="cfg-say-ft" data-cfg-block="group">'
      +     '<button class="cfg-btn" type="button" id="cfg-d-parse">解析</button>'
      +     '<span class="cfg-hint" data-cfg-block="hint" id="cfg-d-hint">按关键词给建议，不联网</span>'
      +   '</div>'
      +   '<ul class="cfg-cands" data-cfg-block="group" id="cfg-d-cands"></ul>'
      + '</section>'
      + '<section class="cfg-out" data-cfg-block="group">'
      +   '<div class="bd-field cfg-field" data-cfg-block="field">'
      +     '<label class="cfg-label" for="cfg-d-name">组件名</label>'
      +     '<input class="bd-input cfg-ctl" id="cfg-d-name" type="text">'
      +   '</div>'
      +   '<div class="cfg-out-hd" data-cfg-block="hint">已确定的字段 <b id="cfg-d-n">0</b> 个</div>'
      +   '<ul class="cfg-picked" data-cfg-block="group" id="cfg-d-picked"></ul>'
      + '</section>'
      + '</div>';

    var q = function (s) { return bd.querySelector(s); };
    var $say = q('#cfg-d-say'), $hint = q('#cfg-d-hint');
    var $cands = q('#cfg-d-cands'), $picked = q('#cfg-d-picked'), $n = q('#cfg-d-n');
    var $name = q('#cfg-d-name');

    $name.value = v.name || '';
    /* 增量 patch：只发 name（§5.3） */
    $name.addEventListener('input', function () { o.onChange({ name: $name.value }); });

    function renderPicked() {
      $n.textContent = String(tags.length);
      if (!tags.length) {
        $picked.innerHTML = '<li class="cfg-none" data-cfg-block="hint">还没有字段。左边说一句，然后点解析。</li>';
        return;
      }
      $picked.innerHTML = tags.map(function (t, i) {
        return '<li data-cfg-block="group"><b>' + (i + 1) + '.</b><span>' + esc(t) + '</span>'
          + '<button class="cfg-btn cfg-x" type="button" data-rm="' + i + '">移除</button></li>';
      }).join('');
    }

    function renderCands() {
      if (!cands.length) {
        $cands.innerHTML = parsed
          ? '<li class="cfg-hint" data-cfg-block="hint">这句里没有能再加的字段了。</li>'
          : '';
        return;
      }
      $cands.innerHTML = cands.map(function (c, i) {
        if (c.editing) {
          return '<li class="cfg-cand" data-cfg-block="group"><input class="bd-input cfg-ctl" type="text" data-edit="'
            + i + '" value="' + esc(c.name) + '"><button class="cfg-btn" type="button" data-ok="' + i + '">确定</button></li>';
        }
        return '<li class="cfg-cand" data-cfg-block="group"><b>' + esc(c.name) + '</b>'
          + '<button class="cfg-btn" type="button" data-accept="' + i + '">接受</button>'
          + '<button class="cfg-btn" type="button" data-edit="' + i + '">改</button></li>';
      }).join('');
    }

    function accept(name) {
      var n = String(name || '').trim();
      if (!n) return;
      if (tags.indexOf(n) < 0) tags.push(n);
      cands = cands.filter(function (c) { return c.name !== n; });
      o.onChange({ fields: tags.slice() });      /* 增量：只发 fields */
      renderPicked(); renderCands();
    }

    q('#cfg-d-parse').addEventListener('click', function () {
      var text = $say.value.trim();
      parsed = true;
      if (!text) { $hint.textContent = '先写一句要做什么'; cands = []; renderCands(); return; }
      /* 把所有命中规则合起来取，而不是"第一条命中就停"：
         组件往往已经带着几个字段，只取第一条会得到一张空列表。 */
      var pool = [];
      RULES.forEach(function (r) {
        if (!r.re.test(text)) return;
        r.add.forEach(function (n) {
          if (pool.indexOf(n) < 0 && tags.indexOf(n) < 0) pool.push(n);
        });
      });
      if (!pool.length) {
        ['名称', '说明'].forEach(function (n) { if (tags.indexOf(n) < 0) pool.push(n); });
      }
      cands = pool.slice(0, 3).map(function (n) { return { name: n, editing: false }; });
      $hint.textContent = cands.length
        ? '给出 ' + cands.length + ' 条建议，逐条决定'
        : '这句里没有能再加的字段了';
      renderCands();
    });

    /* 事件代理：候选列表会整体重建，逐条 bind 会随重建失效 */
    $cands.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'BUTTON') return;
      var i;
      if (t.hasAttribute('data-accept')) {
        i = +t.getAttribute('data-accept');
        if (cands[i]) accept(cands[i].name);
      } else if (t.hasAttribute('data-edit')) {
        i = +t.getAttribute('data-edit');
        if (cands[i]) { cands[i].editing = true; renderCands(); }
      } else if (t.hasAttribute('data-ok')) {
        i = +t.getAttribute('data-ok');
        var inp = $cands.querySelector('[data-edit="' + i + '"]');
        if (cands[i] && inp) accept(inp.value);
      }
    });

    $picked.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'BUTTON' || !t.hasAttribute('data-rm')) return;
      var i = +t.getAttribute('data-rm');
      if (i < 0 || i >= tags.length) return;
      tags.splice(i, 1);
      o.onChange({ fields: tags.slice() });
      renderPicked(); renderCands();
    });

    renderPicked();
    renderCands();
  }

  window.CFG_COMP_DIALOG = { manifest: MANIFEST, mount: mount };
  window.__CFG_BUILTIN = window.__CFG_BUILTIN || [];
  window.__CFG_BUILTIN.push(window.CFG_COMP_DIALOG);
})();
