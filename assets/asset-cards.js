/* 模版沿用原组件库的 crow/ccard 结构与 sys.css，不另造卡片样式。 */
(function(){
 'use strict';
 var esc=UIK.esc;
 UIK.AssetCard={template:function(t){
  var manage=CAP.canManage(t),on=t.on!==false,url='template.html?id='+encodeURIComponent(t.id);
  var menu=manage?'<div class="cl-ops">'+UIK.Menu.trigger({name:t.name,attrs:{'data-template-menu':t.id}})+'<div class="k-menu" role="menu" hidden>'+
   UIK.Menu.item({label:'编辑',icon:'cfg',attrs:{'data-tpl-edit':t.id}})+
   UIK.Menu.item({label:'复制',icon:'copy',attrs:{'data-tpl-copy':t.id}})+
   UIK.Menu.item({label:'版本管理',icon:'ver',href:'versions.html?scope=template&id='+encodeURIComponent(t.id)})+
   UIK.Menu.item({label:'导出',icon:'down',attrs:{'data-tpl-export':t.id}})+
   UIK.Menu.item({label:'删除',icon:'del',danger:true,attrs:{'data-tpl-delete':t.id}})+'</div></div>':'';
  return '<article class="crow ccard" role="listitem" data-template-id="'+esc(t.id)+'" data-on="'+(on?'1':'0')+'" data-st="'+(on?'on':'off')+'"><div class="cc-body"><div class="cc-hd"><b class="cl-tt" title="'+esc(t.name)+'"><a class="cl-nm" href="'+url+'">'+esc(t.name)+'</a></b></div><p class="cl-desc" title="'+esc(t.intro||'')+'">'+esc(t.intro||'')+'</p></div><div class="cc-ft"><div class="cc-run">'+UIK.Ability.enableSwitch(t,'management',{showLabel:true})+menu+'</div><div class="cc-spec"><span class="cc-ver">v'+CAP.Templates.versionNumber(t.id)+'</span><span class="cc-upd">'+esc(t.at)+'</span><span class="cc-meta" title="'+esc(CAP.scopeLabel(t))+'">'+esc(CAP.scopeLabel(t))+'</span></div></div></article>';
 }};
})();
