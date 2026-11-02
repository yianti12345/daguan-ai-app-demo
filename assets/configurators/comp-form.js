/* ─────────────────────────────────────────────────────────────
   configurators/comp-form.js —— 内置配置器「标准表单式」（cfg-comp-form，组件类型出厂默认）

   形态：左边一屏字段（两列成组），右边一张即时预览卡。

   ★ 边界（CONFIGURATOR.md §2.2）：本文件碰不到 DB / localStorage。
     只拿 value 快照 + onChange(patch) + onAction(key) + actions + tokens + choices。
     顶栏 / 底部动作区不在这里画 —— 那是宿主的。
   ★ patch 是**增量**（§5.3）：每次只发改动的那一个键；清空要显式发 null。
   ★ 每个块级节点都打 data-cfg-block（group / field / cols / preview / hint），
     这是 V1 的落点：宿主认属性、不认 class。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M5 4h9l5 5v11H5z"/><path d="M8 12h8M8 16h5"/></svg>';

  var MANIFEST = {
    id: 'cfg-comp-form',
    name: '标准表单式',
    kind: 'configurator',
    bindsTo: 'component',
    origin: 'builtin',
    version: '1.0.0',
    schemaVersion: 1,
    description: '一屏填完，右侧即时预览。适合字段少、口径固定的组件。',
    icon: ICON,
    render: 'declarative',
    layout: { type: 'two-col' },
    isDefault: true,            /* 组件类型的出厂默认 */
    contract: {
      /* key 只能取 §3.1 那八个；label（name）随便写 */
      fields: [
        { key: 'name', name: '组件名', type: 'text', required: true },
        {
          key: 'scope', name: '适用口径', type: 'select',
          options: [{ v: 'fin', t: '金融' }, { v: 'med', t: '医药' }, { v: 'all', t: '通用' }]
        },
        { key: 'fields', name: '字段', type: 'tags' },
        { key: 'desc', name: '说明', type: 'textarea', rows: 3 }
      ],
      actions: [{ key: 'save' }, { key: 'publish' }, { key: 'cancel' }]
    }
  };

  var SCOPE_T = { fin: '金融', med: '医药', all: '通用' };

  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  function splitTags(s) {
    return String(s || '').split(/[、,，]/).map(function (x) { return x.trim(); })
      .filter(function (x) { return !!x; });
  }

  function mount(bd, o) {
    var v = o.value || {};
    var tags = Array.isArray(v.fields) ? v.fields.slice() : [];
    var scope = v.scope || 'fin';

    bd.innerHTML =
      '<div class="cfg-two" data-cfg-block="cols">'
      + '<div class="cfg-fields" data-cfg-block="group">'
      +   '<div class="bd-field cfg-field" data-cfg-block="field"><label class="cfg-label" for="cfg-f-name">组件名</label>'
      +     '<input class="bd-input cfg-ctl" id="cfg-f-name" data-k="name" type="text" value="' + esc(v.name || '') + '"></div>'
      +   '<div class="bd-field cfg-field" data-cfg-block="field"><label class="cfg-label" for="cfg-f-scope">适用口径</label>'
      +     '<select class="bd-input cfg-ctl" id="cfg-f-scope" data-k="scope">'
      +       ['fin', 'med', 'all'].map(function (k) {
                return '<option value="' + k + '"' + (k === scope ? ' selected' : '') + '>' + SCOPE_T[k] + '</option>';
              }).join('')
      +     '</select></div>'
      +   '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label" for="cfg-f-fields">字段</label>'
      +     '<input class="bd-input cfg-ctl" id="cfg-f-fields" data-k="fields" type="text" value="' + esc(tags.join('、')) + '">'
      +     '<span class="cfg-hint" data-cfg-block="hint">按顺序写，用顿号或逗号分隔</span></div>'
      +   '<div class="bd-field cfg-field cfg-wide" data-cfg-block="field"><label class="cfg-label" for="cfg-f-desc">说明</label>'
      +     '<textarea class="bd-input cfg-ctl cfg-ta" id="cfg-f-desc" data-k="desc" rows="3">' + esc(v.desc || '') + '</textarea></div>'
      + '</div>'
      + '<aside class="cfg-pv" data-cfg-block="preview">'
      +   '<div class="cfg-pv-hd">预览</div>'
      +   '<div class="cfg-pv-row"><span class="idc" data-idc>组</span>'
      +     '<div><div class="cfg-pv-name" data-pv-name></div><div class="cfg-pv-meta" data-pv-meta></div></div>'
      +   '</div>'
      +   '<div class="cfg-chips" data-pv-chips></div>'
      +   '<p class="cfg-pv-desc" data-pv-desc></p>'
      + '</aside>'
      + '</div>';

    var q = function (s) { return bd.querySelector(s); };
    var $name = q('[data-k="name"]'), $scope = q('[data-k="scope"]');
    var $tags = q('[data-k="fields"]'), $desc = q('[data-k="desc"]');

    function pv() {
      var nm = $name.value.trim();
      q('[data-idc]').textContent = (nm.replace(/[（）()]/g, '').slice(0, 1) || '组');
      q('[data-pv-name]').textContent = nm || '未命名组件';
      q('[data-pv-meta]').textContent = SCOPE_T[$scope.value] + '口径 · ' + tags.length + ' 个字段';
      q('[data-pv-chips]').innerHTML = tags.map(function (t) {
        return '<span class="cfg-chip">' + esc(t) + '</span>';
      }).join('');
      q('[data-pv-desc]').textContent = $desc.value.trim();
    }

    /* 增量 patch：只发这一个键（§5.3）。合并、语义指纹、__rest 都是宿主的事。 */
    $name.addEventListener('input', function () { o.onChange({ name: $name.value }); pv(); });
    $scope.addEventListener('change', function () { o.onChange({ scope: $scope.value }); pv(); });
    $tags.addEventListener('input', function () {
      tags = splitTags($tags.value);
      o.onChange({ fields: tags.slice() });
      pv();
    });
    $desc.addEventListener('input', function () { o.onChange({ desc: $desc.value }); pv(); });

    pv();
  }

  window.CFG_COMP_FORM = { manifest: MANIFEST, mount: mount };
  window.__CFG_BUILTIN = window.__CFG_BUILTIN || [];
  window.__CFG_BUILTIN.push(window.CFG_COMP_FORM);
})();
