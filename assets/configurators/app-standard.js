/* ─────────────────────────────────────────────────────────────
   configurators/app-standard.js —— 内置配置器「应用标准配置」（cfg-app-standard）

   形态：单列四段（应用名 / 客户 / 装哪些组件 / 是否可装配）。
   这一轮只登记、不接页面（CONFIGURATOR.md §6：应用类型的第二个变体还没定，别硬造）。

   ★「装哪些组件」现在用 opts.choices.comps 做真多选（§2.2 补的只读候选通道）。
     值来自宿主读 DB 后深拷贝，配置器改了不影响库；本文件仍然碰不到 DB。
   ★ key 全部取自 §3.1 词表：name / client / comps / enabled。
   ★ patch 是增量（§5.3）；块级节点都打 data-cfg-block。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/>'
    + '<rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>';

  var MANIFEST = {
    id: 'cfg-app-standard',
    name: '应用标准配置',
    kind: 'configurator',
    bindsTo: 'app',
    origin: 'builtin',
    version: '1.0.0',
    schemaVersion: 1,
    description: '一个应用的基本信息与装配清单，单列填完。',
    icon: ICON,
    render: 'declarative',
    layout: { type: 'stack' },
    isDefault: true,            /* 应用类型目前只有这一个内置 */
    contract: {
      fields: [
        { key: 'name', name: '应用名', type: 'text', required: true },
        { key: 'client', name: '客户', type: 'text' },
        { key: 'comps', name: '装哪些组件', type: 'list' },
        { key: 'enabled', name: '是否可装配', type: 'switch' }
      ],
      actions: [{ key: 'save' }, { key: 'publish' }, { key: 'cancel' }]
    }
  };

  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;

  function mount(bd, o) {
    var v = o.value || {};
    var picked = Array.isArray(v.comps) ? v.comps.slice() : [];
    var choices = (o.choices && o.choices.comps) ? o.choices.comps : [];

    bd.innerHTML =
      '<div class="cfg-fields" data-cfg-block="group">'
      + '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label" for="cfg-a-name">应用名</label>'
      +   '<input class="bd-input cfg-ctl" id="cfg-a-name" type="text" value="' + esc(v.name || '') + '"></div>'
      + '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label" for="cfg-a-client">客户</label>'
      +   '<input class="bd-input cfg-ctl" id="cfg-a-client" type="text" value="' + esc(v.client || '') + '"></div>'
      + '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label">装哪些组件</label>'
      +   (choices.length
            ? '<div class="cfg-tags" data-cfg-block="group" id="cfg-a-tags"></div>'
              + '<span class="cfg-hint" data-cfg-block="hint">点一下装上，再点一下卸下；顺序按组件库里的顺序</span>'
            /* 没有候选清单时**不许静默退化成纯文本**：用户看不出这是降级，会以为这就是设计 */
            : '<input class="bd-input cfg-ctl" id="cfg-a-text" type="text" value="' + esc(picked.join('、')) + '">'
              + '<span class="cfg-hint" data-cfg-block="hint">候选项未提供，暂以顿号分隔的文本编辑</span>')
      + '</div>'
      + '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label">是否可装配</label>'
      +   '<label class="cfg-switch"><input type="checkbox" id="cfg-a-enabled"><span class="cfg-switch-track"></span>'
      +   '<span class="cfg-hint" data-cfg-block="hint">关掉之后，装配面板里不再出现这个应用的组件</span></label></div>'
      + '</div>';

    var q = function (s) { return bd.querySelector(s); };
    var $tags = q('#cfg-a-tags'), $text = q('#cfg-a-text');
    var $name = q('#cfg-a-name'), $client = q('#cfg-a-client'), $en = q('#cfg-a-enabled');

    /* 读时兼容：老数据里这个键叫 scopeAll（上一版的名字），新键是 enabled。
       改名不许把老值丢掉 —— 缺 enabled 就回落到 scopeAll，两个都没有才算 true。
       写回时只写 enabled；旧的 scopeAll 会被宿主按"未声明的键"原样收进 __rest，
       所以我们既不认错、也不替人删。 */
    var en = (v.enabled === undefined) ? v.scopeAll : v.enabled;
    $en.checked = (en === false) ? false : true;

    /* 选中态只能来自 value[key]（picked 是它的本地镜像）——
       不许拿 choices 当状态改：改了不报错也不生效，下次渲染又变回去，比报错更难查。 */
    function renderTags() {
      if (!$tags) return;
      $tags.innerHTML = choices.map(function (c) {
        var on = picked.indexOf(c.v) >= 0;
        return '<button type="button" class="cfg-tag' + (on ? ' is-on' : '') + '"'
          + ' data-v="' + esc(c.v) + '" aria-pressed="' + on + '">' + esc(c.t) + '</button>';
      }).join('');
    }

    /* 增量 patch：只发改动的那一个键（§5.3） */
    $name.addEventListener('input', function () { o.onChange({ name: $name.value }); });
    $client.addEventListener('input', function () { o.onChange({ client: $client.value }); });
    $en.addEventListener('change', function () { o.onChange({ enabled: $en.checked }); });

    if ($tags) {
      $tags.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'BUTTON' || !t.hasAttribute('data-v')) return;
        var id = t.getAttribute('data-v');
        var i = picked.indexOf(id);
        if (i >= 0) picked.splice(i, 1); else picked.push(id);
        o.onChange({ comps: picked.slice() });
        renderTags();
      });
    }
    if ($text) {
      $text.addEventListener('input', function () {
        picked = $text.value.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
        o.onChange({ comps: picked.slice() });
      });
    }

    renderTags();
  }

  window.CFG_APP_STANDARD = { manifest: MANIFEST, mount: mount };
  window.__CFG_BUILTIN = window.__CFG_BUILTIN || [];
  window.__CFG_BUILTIN.push(window.CFG_APP_STANDARD);
})();
