/* ai-search.js —— 用模型做检索：把用户的一句需求，翻成清单里的 id。
   只在人点「AI」时调用；失败（没代理 / 429 / 返回不合法）一律返回 null，
   由调用方回退到本地关键词匹配，不假装搜到了。 */
(function () {
  'use strict';
  function run(query, items, opt) {
    opt = opt || {};
    if (!window.Gen || !Gen.ask) return Promise.resolve(null);
    var q = String(query || '').trim();
    if (!q) return Promise.resolve(null);
    var list = (items || []).slice(0, 300).map(function (x) {
      return '- ' + x.id + ' ｜ ' + (x.name || x.label || '') + ' ｜ ' + (x.desc || '');
    }).join('\n');
    if (!list) return Promise.resolve(null);
    var msgs = [
      { role: 'system', content: '你是检索器。只输出 JSON：{"ids":["..."]}。只能从清单里挑 id，最多 10 个，不许发明。挑不出来就返回空数组。' },
      { role: 'user', content: '要找：' + q + '\n\n清单：\n' + list }
    ];
    return Gen.ask(msgs, { maxTokens: 300, temperature: 0 }).then(function (r) {
      var m = String((r && r.text) || '').match(/\{[\s\S]*\}/);
      if (!m) return null;
      var j = null;
      try { j = JSON.parse(m[0]); } catch (e) { return null; }
      var ids = (j && j.ids) || [];
      if (!Array.isArray(ids)) return null;
      var known = {};
      (items || []).forEach(function (x) { known[x.id] = 1; });
      return ids.filter(function (id) { return known[id]; }).slice(0, 10);
    }).catch(function () { return null; });
  }
  window.AISearch = { run: run };
})();
