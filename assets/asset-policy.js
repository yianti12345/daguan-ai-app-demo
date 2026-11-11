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
 C.assetCounts=function(){var all=C.authorizedAssets();return {total:all.length,enabled:all.filter(function(b){return C.isReady(b)&&C.isPersonalEnabled(b);}).length,unavailable:all.filter(function(b){return !C.isReady(b);}).length};};C.capabilityCounts=C.assetCounts;
 C.unavailableReason=function(b){if(!b)return '资产不存在';if(b.on===false)return '管理端已禁用';return C.isReady(b)?'':'配置未完成';};
 C.setPersonalEnabled=function(ids,on){var key='ifas90:cap-prefs:'+C.actor().id,p={};try{p=JSON.parse(localStorage.getItem(key)||'{}');}catch(e){}
  (ids||[]).forEach(function(id){var b=C.assetById(id);if(!b||!C.isGranted(b))throw new Error('资产授权已变更');});
  (ids||[]).forEach(function(id){if(on)delete p[id];else p[id]=false;});localStorage.setItem(key,JSON.stringify(p));window.dispatchEvent(new Event('capabilities-changed'));
 };
 C.searchAuthorizedAssets=function(text,expanded){
  var q=String(text||'').toLowerCase().trim(),terms=[],stop=['资产','能力','一个','需要','想要','帮我','可以','使用','哪些','哪个'];
  [q].concat((expanded||[]).slice(0,8)).forEach(function(raw){var words=String(raw).toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]+/g)||[];words.forEach(function(w){if(/[\u3400-\u9fff]/.test(w)){if(w.length===1)terms.push(w);for(var i=0;i<w.length-1;i++)terms.push(w.slice(i,i+2));}else terms.push(w);});});terms=terms.filter(function(t,i,a){return !stop.includes(t)&&a.indexOf(t)===i;});
  return C.authorizedAssets().map(function(b){var name=b.name.toLowerCase(),intro=(b.intro||'').toLowerCase(),outline=b.assetType==='template'?b.files.map(function(f){return f.name;}).join(' '):((b.doc||'').match(/^#{1,3} .+$/gm)||[]).join(' ');outline=outline.toLowerCase();var score=q&&q.includes(name)?1000:0;if(q&&name.includes(q))score+=100;if(q&&intro.includes(q))score+=30;terms.forEach(function(t){score+=name.includes(t)?5:intro.includes(t)?2:outline.includes(t)?1:0;});return {b:b,score:score};}).filter(function(x){return !q||x.score>0;}).sort(function(a,b){return q?b.score-a.score||a.b.id.localeCompare(b.b.id):String(b.b.at||'').localeCompare(String(a.b.at||''));}).map(function(x){return x.b;});
 };C.searchAuthorizedAbilities=C.searchAuthorizedAssets;
 function meta(b){return {id:b.id,name:b.name,kind:b.assetType==='template'?'template':'api',assetType:b.assetType==='template'?'template':'ability',description:b.intro||''};}
 C.catalog=function(){return C.authorizedAssets().filter(function(b){return C.isReady(b)&&C.isPersonalEnabled(b);}).map(meta);};
 C.discoverCandidates=function(text,limit){return C.searchAuthorizedAssets(text).filter(function(b){return C.isReady(b)&&C.isPersonalEnabled(b);}).slice(0,Math.min(limit||20,30)).map(meta);};
 C.contextFor=function(ids){var text=(ids||[]).map(function(id){var b=C.assetById(id);if(!b||!C.isGranted(b)||!C.isReady(b)||!C.isPersonalEnabled(b))throw new Error('资产授权或启用状态已变更，请重新生成');var content='## '+b.name+' ['+b.id+'@'+b.revision+']\n'+(b.assetType==='template'?'模版素材只作为生成参考，不携带接口调用权限。\n'+C.Templates.context(b):b.doc);if(content.length>60000)throw new Error('资产参考内容过长，请精简后重试');return content;}).join('\n\n');if(text.length>90000)throw new Error('本次参考内容过长，请缩小范围');return text;};
 C.templateReferenceSnapshot=function(ids){return (ids||[]).map(C.assetById).filter(function(b){return b&&b.assetType==='template';}).map(function(b){return {id:b.id,name:b.name,revision:b.revision,files:copy(b.files)};});};
})();
