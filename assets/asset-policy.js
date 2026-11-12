/* 当前版本仅能力（接口）与模版两类资产。Skill 历史记录保留，不进入本版清单或模型上下文。 */
(function(){
 'use strict';
 var C=window.CAP,oldReady=C.isReady,oldAdd=C.addAbility,oldUpdate=C.updateAbility;
 function copy(v){return JSON.parse(JSON.stringify(v));}
 C.addAbility=function(v){if(v&&v.kind&&v.kind!=='api')throw new Error('本版仅支持接口能力');return oldAdd(Object.assign({},v,{kind:'api'}));};
 var oldImport=C.importAbilities;
 C.importAbilities=function(items,opt){if(items.some(function(b){return b.kind&&b.kind!=='api';}))throw new Error('本版仅支持接口能力');return oldImport(items,opt);};
 C.updateAbility=function(id,p){var b=C.abilityById(id);if(b&&b.kind!=='api')throw new Error('该历史能力类型本版仅可查看');return oldUpdate(id,p);};
 C.assetById=function(id){var b=C.abilityById(id);return b&&b.kind==='api'?b:C.Templates.byId(id);};
 C.isReady=function(b){return !!b&&(b.assetType==='template'?C.Templates.ready(b):b.kind==='api'&&oldReady(b));};
 C.visibleAbilities=function(){return C.abilities().filter(function(b){return b.kind==='api'&&(C.isGranted(b)||C.canManage(b));});};
 C.authorizedAbilities=function(){return C.abilities().filter(function(b){return b.kind==='api'&&b.name&&C.isGranted(b);});};
 C.authorizedAssets=function(){return C.authorizedAbilities().concat(C.Templates.all().filter(function(t){return C.isGranted(t);}));};
 C.availableAbilities=function(){return C.authorizedAbilities().filter(C.isReady);};
 C.assetCounts=function(){var all=C.authorizedAssets();return {total:all.length,enabled:enabledAssets(all).length,unavailable:all.filter(function(b){return !C.isReady(b);}).length};};C.capabilityCounts=C.assetCounts;
 C.unavailableReason=function(b){if(!b)return '资产不存在';if(b.on===false)return '管理端已禁用';return C.isReady(b)?'':'配置未完成';};
 function preferences(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
  catch (error) { return {}; }
 }
 function personalKey() { return 'ifas90:cap-prefs:' + C.actor().id; }
 function enabledAssets(assets) {
  var prefs = preferences(personalKey());
  return assets.filter(function (asset) { return prefs[asset.id] !== false && C.isReady(asset); });
 }
 C.setPersonalEnabled = function (ids,on) {
  var key = personalKey(), prefs = preferences(key);
  (ids || []).forEach(function (id) {
   var asset = C.assetById(id);
   if (!asset || !C.isGranted(asset)) throw new Error('资产授权已变更');
   if (on) delete prefs[id];
   else prefs[id] = false;
  });
  localStorage.setItem(key, JSON.stringify(prefs));
  window.dispatchEvent(new Event('capabilities-changed'));
 };
 function termsOf(phrase) {
  var words = phrase.match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]+/g) || [];
  var terms = new Set();
  words.forEach(function (word) {
   if (/^[\u3400-\u9fff]{2,}$/.test(word)) {
    for (var i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2));
   } else terms.add(word);
  });
  ['资产','能力','一个','需要','想要','帮我','可以','使用','哪些','哪个'].forEach(function (word) { terms.delete(word); });
  return Array.from(terms);
 }
 C.searchAuthorizedAssets = function (text, expanded) {
  var query = String(text || '').toLowerCase().trim();
  var phrases = Array.from(new Set((expanded || []).slice(0, 8).map(function (phrase) {
   return String(phrase).toLowerCase().trim();
  }))).filter(function (phrase) { return !!phrase && phrase !== query; });
  var terms = termsOf([query].concat(phrases).join(' '));
  return C.authorizedAssets().map(function (asset) {
   var name = asset.name.toLowerCase(), intro = (asset.intro || '').toLowerCase();
   var outline = (asset.assetType === 'template' ? asset.files.map(function (file) { return file.name; }).join(' ')
    : ((asset.doc || '').match(/^#{1,3} .+$/gm) || []).join(' ')).toLowerCase();
   var literal = query && (name === query ? 4 : (query.includes(name) ? 3 : (name.includes(query) ? 2 : (intro.includes(query) ? 1 : 0))));
   var phrase = phrases.reduce(function (best, term) {
    return Math.max(best, name === term ? 4 : (name.includes(term) ? 3 : (intro.includes(term) ? 2 : (outline.includes(term) ? 1 : 0))));
   }, 0);
   var words = terms.reduce(function (score, term) {
    return score + (name.includes(term) ? 5 : intro.includes(term) ? 2 : outline.includes(term) ? 1 : 0);
   }, 0);
   return {asset:asset, literal:literal, phrase:phrase, words:words};
  }).filter(function (row) {
   return (!query && !phrases.length) || row.literal || row.phrase || row.words;
  }).sort(function (a,b) {
   if (!query && !phrases.length) return String(b.asset.at || '').localeCompare(String(a.asset.at || ''));
   return b.literal-a.literal || b.phrase-a.phrase || b.words-a.words || a.asset.id.localeCompare(b.asset.id);
  }).map(function (row) { return row.asset; });
 };
 C.searchAuthorizedAbilities = C.searchAuthorizedAssets;
 function meta(b){return {id:b.id,name:b.name,kind:b.assetType==='template'?'template':'api',assetType:b.assetType==='template'?'template':'ability',description:b.intro||''};}
 C.catalog=function(){return enabledAssets(C.authorizedAssets()).map(meta);};
 C.discoverCandidates=function(text,limit,expanded){return enabledAssets(C.searchAuthorizedAssets(text,expanded)).slice(0,Math.min(limit||20,30)).map(meta);};
 C.contextFor=function(ids){var text=(ids||[]).map(function(id){var b=C.assetById(id);if(!b||!C.isGranted(b)||!C.isReady(b)||!C.isPersonalEnabled(b))throw new Error('资产授权或启用状态已变更，请重新生成');var content='## '+b.name+' ['+b.id+'@'+b.revision+']\n'+(b.assetType==='template'?'模版素材只作为生成参考，不携带接口调用权限。\n'+C.Templates.context(b):b.doc);if(content.length>60000)throw new Error('资产参考内容过长，请精简后重试');return content;}).join('\n\n');if(text.length>90000)throw new Error('本次参考内容过长，请缩小范围');return text;};
 C.templateReferenceSnapshot=function(ids){return (ids||[]).map(C.assetById).filter(function(b){return b&&b.assetType==='template';}).map(function(b){return {id:b.id,name:b.name,revision:b.revision,files:copy(b.files)};});};
})();
