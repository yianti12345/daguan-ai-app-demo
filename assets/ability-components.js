/* 能力界面的共享展示契约。权限计算仍由 ability-policy.js 唯一负责。 */
(function () {
  'use strict';
  var C=window.CAP, U=window.UIK;
  var kinds=Object.freeze({api:{label:'接口',editor:'ability.html'},skill:{label:'技能（skill）',editor:'skill-edit.html'}});
  function kind(v){return kinds[v] ? v : 'api';}
  function label(v){return kinds[kind(v)].label;}
  function tag(v){v=kind(v);return '<span class="ability-kind" data-kind="'+v+'">'+label(v)+'</span>';}
  function options(mode){return '<option value="">'+(mode==='required'?'请选择能力类型':'全部类型')+'</option>'+Object.keys(kinds).map(function(k){return '<option value="'+k+'">'+label(k)+'</option>';}).join('');}
  function copyNameButton(b){
    return '<button type="button" class="icon-btn av-copy" data-av-copy="'+U.esc(b.id)+'" title="复制名称" aria-label="复制名称：'+U.esc(b.name)+'"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></svg></button>';
  }
  function assetTag(b){var t=b.assetType==='template'?'template':'ability';return '<span class="ability-kind" data-kind="'+t+'">'+(t==='template'?'模版':'能力')+'</span>';}
  var assetKinds=[{value:'',label:'全部资产'},{value:'ability',label:'能力资产'},{value:'template',label:'模版资产'}];
  function assetOptions(){return assetKinds.map(function(k){return '<option value="'+k.value+'">'+k.label+'</option>';}).join('');}
  function assetTabs(){return '<div class="p-tabs" id="av-kind-tabs" role="tablist" aria-label="资产类型">'+assetKinds.map(function(k){return '<button type="button" class="p-tab" role="tab" aria-controls="available-list" id="av-tab-'+(k.value||'all')+'" data-asset-kind="'+k.value+'" aria-selected="'+(k.value==='')+'" tabindex="'+(k.value===''?'0':'-1')+'">'+k.label+'</button>';}).join('')+'</div>';}

  function enableSwitch(b,mode,opt){
    var personal=mode==='personal',on=personal?C.isReady(b)&&C.isPersonalEnabled(b):b.on!==false;
    var disabled=personal?(!C.isGranted(b)||!C.isReady(b)):!C.canManage(b);
    var button='<button type="button" class="sw" role="switch" aria-checked="'+on+'" aria-label="'+(on?'禁用':'启用')+U.esc(b.name)+'" '+(personal?'data-av-toggle="'+U.esc(b.id)+'"':'data-act="toggle" data-id="'+U.esc(b.id)+'"')+(disabled?' disabled':'')+'></button>';
    return opt&&opt.showLabel?'<span class="ability-toggle">'+button+'<span class="ability-toggle-state">'+(on?'已启用':'已禁用')+'</span></span>':button;
  }
  function feedback(el,phase){
    if(!el)return;
    var text={idle:'',dirty:'未保存',saving:'保存中…',generating:'生成中…',readonly:'仅查看'}[phase]||'';
    el.textContent=text;el.hidden=!text;el.removeAttribute('title');el.classList.remove('is-danger');el.setAttribute('role','status');
  }
  function mount(root){
    (root||document).querySelectorAll('[data-ability-kind]').forEach(function(el){el.innerHTML=tag(el.dataset.abilityKind);});
    (root||document).querySelectorAll('[data-ability-kind-select]').forEach(function(el){var value=el.value;el.innerHTML=options(el.dataset.abilityKindSelect);el.value=value;});
  }
  U.Ability=Object.freeze({kinds:kinds,kindLabel:label,kindTag:tag,kindOptions:options,copyNameButton:copyNameButton,assetTag:assetTag,assetOptions:assetOptions,assetTabs:assetTabs,enableSwitch:enableSwitch,editorFeedback:feedback,mount:mount});
  mount(document);
})();
