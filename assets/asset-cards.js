/* 模版沿用原组件库的 crow/ccard 结构与 sys.css，不另造卡片样式。 */
(function(){
 'use strict';
 var esc=UIK.esc;
 function previewable(version){
  var files=version&&version.snap&&version.snap.files;
  if(!Array.isArray(files))return false;
  if(files.some(function(file){return /\.html?$/i.test(file.name)&&file.encoding!=='base64'&&typeof file.content==='string'&&file.content.trim();}))return true;
  var structure=files.find(function(file){return file.name==='template.json'&&file.encoding!=='base64';});
  if(!structure)return false;
  try{
   var parsed=JSON.parse(structure.content);
   return !!(parsed&&(parsed.fields?.length||parsed.spec?.blocks?.length));
  }catch(e){return false;}
 }
 function templateCover(t,version,image,lazy){
  var cover=CAP.Templates.coverImage(image),loading=lazy===false?'':' loading="lazy"';
  if(cover)return '<img src="'+esc(cover)+'" alt=""'+loading+' decoding="async">';
  if(!previewable(version))return '';
  var src='template.html?id='+encodeURIComponent(t.id)+'&v='+encodeURIComponent(version.v)+'&cover=1';
  return '<iframe src="'+esc(src)+'" title="'+esc(t.name)+'页面预览"'+loading+' tabindex="-1"></iframe>';
 }
 UIK.AssetCard={templateCover:templateCover,template:function(t){
  var manage=CAP.canManage(t),on=t.on!==false,url='template.html?id='+encodeURIComponent(t.id);
  var version=CAP.Templates.currentVersion(t.id);
  var cover=templateCover(t,version,t.cover||CAP.Templates.automaticCover(t));
  var menu=manage?'<div class="cl-ops">'+UIK.Menu.trigger({name:t.name,attrs:{'data-template-menu':t.id}})+'<div class="k-menu" role="menu" hidden>'+
   UIK.Menu.item({label:'编辑',icon:'cfg',attrs:{'data-tpl-edit':t.id}})+
   UIK.Menu.item({label:'复制',icon:'copy',attrs:{'data-tpl-copy':t.id}})+
   UIK.Menu.item({label:'版本管理',icon:'ver',href:'versions.html?scope=template&id='+encodeURIComponent(t.id)})+
   UIK.Menu.item({label:'导出',icon:'down',attrs:{'data-tpl-export':t.id}})+
   UIK.Menu.item({label:'删除',icon:'del',danger:true,attrs:{'data-tpl-delete':t.id}})+'</div></div>':'';
  return '<article class="crow ccard" role="listitem" data-template-id="'+esc(t.id)+'" data-on="'+(on?'1':'0')+'" data-st="'+(on?'on':'off')+'">'+'<div class="cc-cover" aria-hidden="true" inert>'+cover+'</div><div class="cc-body"><div class="cc-hd"><b class="cl-tt" title="'+esc(t.name)+'"><a class="cl-nm" href="'+url+'">'+esc(t.name)+'</a></b></div><p class="cl-desc" title="'+esc(t.intro||'')+'">'+esc(t.intro||'')+'</p></div><div class="cc-ft"><div class="cc-run">'+UIK.Ability.enableSwitch(t,'management',{showLabel:true})+menu+'</div><div class="cc-spec"><span class="cc-ver">v'+CAP.Templates.versionNumber(t.id)+'</span><span class="cc-upd">'+esc(t.at)+'</span><span class="cc-meta" title="'+esc(CAP.scopeLabel(t))+'">'+esc(CAP.scopeLabel(t))+'</span></div></div></article>';
 }};
})();
