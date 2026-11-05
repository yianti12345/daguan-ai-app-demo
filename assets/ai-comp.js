/* ai-comp.js —— 应用配置页「装配组件」面板的 AI 检索
   结果放 window.__aiIds，app.js 的列表过滤优先读它；再点一次清除，回到关键词。 */
(function () {
  'use strict';
  var btn = document.getElementById('ai-comp');
  var inp = document.getElementById('dlg-search');
  if (!btn || !inp) return;
  var setting = false;
  var SPARK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"/><path d="M19 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>';

  function toast(m, k) { if (window.UIK && UIK.toast) UIK.toast(m, k); }
  function repaint() { inp.dispatchEvent(new Event('input', { bubbles: true })); }

  /* 两态：空闲「AI 搜索」/ 生效「退出 AI」。文字换了才看得出点它会怎样。 */
  function setAi(on) {
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = SPARK + (on ? '退出 AI' : 'AI 搜索');
  }

  btn.addEventListener('click', function () {
    if (window.__aiIds) {
      window.__aiIds = null; setAi(false); repaint(); return;
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
      window.__aiIds = ids; setAi(true);
      setting = true; repaint(); setting = false;
    });
  });

  inp.addEventListener('input', function () {
    if (setting) return;
    if (window.__aiIds) { window.__aiIds = null; setAi(false); }
  });

  /* 回车＝按关键词筛，顺便退出 AI 结果。没有单独的「搜索」按钮，就是它。 */
  inp.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (window.__aiIds) { window.__aiIds = null; setAi(false); }
    repaint();
  });
})();
