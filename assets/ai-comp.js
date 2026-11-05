/* ai-comp.js —— 应用配置页「装配组件」面板的 AI 检索
   结果放 window.__aiIds，app.js 的列表过滤优先读它；再点一次清除，回到关键词。 */
(function () {
  'use strict';
  var btn = document.getElementById('ai-comp');
  var inp = document.getElementById('dlg-search');
  if (!btn || !inp) return;
  var setting = false;

  function toast(m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); }
  function repaint() { inp.dispatchEvent(new Event('input', { bubbles: true })); }

  btn.addEventListener('click', function () {
    if (window.__aiIds) {
      window.__aiIds = null; btn.classList.remove('is-on'); repaint(); return;
    }
    var q = String(inp.value || '').trim();
    if (!q) { toast('先说要找什么', 'error'); inp.focus(); return; }
    if (!window.DB || !DB.COMPS) return;
    btn.classList.add('is-busy');
    AISearch.run(q, DB.COMPS.map(function (c) {
      return { id: c.id, name: c.name, desc: c.desc || '' };
    })).then(function (ids) {
      btn.classList.remove('is-busy');
      if (ids === null) { toast('AI 检索没连上，按关键词找', 'error'); return; }
      window.__aiIds = ids; btn.classList.add('is-on');
      setting = true; repaint(); setting = false;
    });
  });

  inp.addEventListener('input', function () {
    if (setting) return;
    if (window.__aiIds) { window.__aiIds = null; btn.classList.remove('is-on'); }
  });
})();
