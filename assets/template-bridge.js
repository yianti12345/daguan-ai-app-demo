/* 原画布的模版仓储适配；草稿独立于正式版本，不写旧组件或应用。 */
(function(){
 'use strict';
 var C=CAP,T=C.Templates,id=new URLSearchParams(location.search).get('id'),key='ifas90:draft:template:'+id;
 window.DB.load();T.initialize();var source=T.byId(id);
 if(!source||!C.isGranted(source)){location.replace('templates.html');throw new Error('模版不可访问');}
 var query=new URLSearchParams(location.search),coverMode=query.get('cover')==='1';
 var view=Number(query.get('v'))||0,version=view&&T.versionsOf(id).find(function(r){return r.v===view;});
 if(coverMode&&!view){version=T.currentVersion(id);view=version?version.v:0;}
 var readOnly=!!view||coverMode;
 if(coverMode)document.body.setAttribute('data-template-cover','');
 if(view&&(!version||!version.snap))throw new Error('此历史版本没有可用内容快照');
 function copy(v){return JSON.parse(JSON.stringify(v));}
 function contents(files){var json=files.find(function(f){return f.name==='template.json'&&f.encoding!=='base64';}),p=json?JSON.parse(json.content):{};return {fields:p.fields||[],spec:p.spec||null,block:p.block||null,layout:p.layout||'full'};}
 function canManage(){return !readOnly&&C.canManage(T.byId(id));}
 function readDraft(){return T.readDraft(id);}
 function latestFormal(){var rows=T.versionsOf(id);return rows[0]&&rows[0].snap?rows[0]:null;}
 var savedFiles=copy(view?version.snap.files:source.files),payload={};try{payload=contents(savedFiles);}catch(e){UIK.toast('模版结构文件无效','error');}
 var loadedDraft=canManage()?readDraft():null;if(loadedDraft)Object.assign(payload,loadedDraft);
 var record=Object.assign({},payload,{id:id,name:source.name,desc:source.intro,enabled:true,status:'已上架',ver:'',refs:0});
 var session=null,controller=null,busy=false,saving=false,leaving=false;
 function header(){
  var t=T.byId(id);if(!t)return;document.title=t.name+' · 模版配置';var n=document.getElementById('comp-name'),d=document.getElementById('comp-desc'),v=document.getElementById('comp-ver'),meta=document.getElementById('comp-meta');
  if(n)n.textContent=t.name;if(d)d.textContent=t.intro||'';if(v)v.textContent='v'+(view||T.versionNumber(id));
  if(meta)meta.textContent=canManage()?(session&&session.isDirty()?'未保存':readDraft()?'草稿':''):'';
  ['act-draft','act-reset','act-publish'].forEach(function(k){var e=document.getElementById(k);if(e){e.hidden=!canManage();e.disabled=saving||busy;}});
  var reset=document.getElementById('act-reset');if(reset){var formal=latestFormal();reset.disabled=!canManage()||busy||saving||!session||!formal||(!readDraft()&&!session.isDirty());reset.title=formal?'':'暂无正式版本可恢复';}
 }
 var db={COMPS:[record],APPS:[],APP_COMPS:{},load:function(){return db;},compById:function(k){return k===id?record:null;},appById:function(){return null;},authRows:function(){return [];},canInstall:function(){return true;},compState:function(){return '';},compStateCls:function(){return '';},versOf:function(){return T.versionsOf(id);},save:function(expectedVersion,previewCover,snapshot){
  var t=T.byId(id);if(!t||!canManage())throw new Error('只有创建人和管理员可以维护模版');
  var content=snapshot||record;
  var next={name:t.name,fields:content.fields,spec:content.spec,block:content.block||null,layout:content.layout||'full'};
  var f={name:'template.json',encoding:'utf8',mime:'application/json',content:JSON.stringify(next,null,2)};
  T.saveVersion(id,t.files.filter(function(x){return x.name!=='template.json';}).concat([f]),expectedVersion,previewCover);savedFiles=copy(T.byId(id).files);
  try{if(session)session.clear();else localStorage.removeItem(key);}catch(e){header();throw new Error('版本已保存，但草稿未能清除');}header();return true;
 }};
 async function saveCanvas(commit){
  if(!canManage()||busy||saving||!session)return false;
  saving=true;
  header();
  try{
   C.refresh();
   if(!canManage())throw new Error('没有模版维护权限');
   var snapshot=copy(controller.snapshot()),previewCover='',captureFailed=false;
   if(!T.coverImage(T.byId(id).cover)){
    try{previewCover=await TemplateCover.capture(document.getElementById('canvas-inner'));}
    catch(e){captureFailed=true;}
   }
   if(JSON.stringify(snapshot)!==JSON.stringify(controller.snapshot())){
    throw new Error('画布已变化，请重新保存');
   }
   C.refresh();
   if(!canManage())throw new Error('没有模版维护权限');
   commit(snapshot,previewCover,captureFailed);
   return true;
  }catch(e){
   UIK.toast(e.message||'没保存上','error');
   return false;
  }finally{
   saving=false;
   header();
  }
 }
 function saveDraft(){
  return saveCanvas(function(snapshot,previewCover,captureFailed){
   session.save({previewCover:previewCover});
   UIK.toast(captureFailed?'草稿已保存，封面截图未更新':'草稿已保存',captureFailed?'error':undefined);
  });
 }
 function publish(expectedVersion){
  return saveCanvas(function(snapshot,previewCover,captureFailed){
   db.save(expectedVersion,previewCover,snapshot);
   var message='已发布 v'+expectedVersion;
   UIK.toast(captureFailed?message+'，封面截图未更新':message,captureFailed?'error':undefined);
  });
 }
 function reset(){var formal=latestFormal();if(!canManage()||!formal||busy||saving||!session)return;Confirm.ask({title:'重置为 v'+formal.v+'？',body:'当前修改和已保存的草稿将被清除。',ok:'重置',onOk:function(){try{if(!canManage())throw new Error('没有模版维护权限');var current=latestFormal();if(!current)throw new Error('没有可恢复的正式版本');var files=copy(current.snap.files),target=contents(files);session.reset(target);savedFiles=files;controller.restore(target);header();UIK.toast('已重置为 v'+current.v);}catch(e){UIK.toast(e.message||'重置失败','error');}}});}
 window.TemplateBridge={db:db,coverMode:coverMode,refreshHeader:header,canManage:canManage,saveDraft:saveDraft,publish:publish,isSaving:function(){return saving;},setBusy:function(v){busy=!!v;header();},previewHtml:function(){
  if(record.spec)return false;var html=savedFiles.find(function(f){return /\.html?$/i.test(f.name);});if(!html)return false;var canvas=document.getElementById('canvas-inner');canvas.classList.add('template-preview');AssetFileViewer.mount(canvas,[html].concat(savedFiles.filter(function(f){return f!==html;})),0);return true;
 },attach:function(access){
  controller=access;session=AppDraft.create({storage:localStorage,key:key,now:C.now,snapshot:access.snapshot,restore:function(s){Object.assign(record,copy(s));access.restore(s);}});
  var resetButton=document.getElementById('act-reset');if(resetButton)resetButton.onclick=reset;
  var back=document.querySelector('.back[href="templates.html"]');if(back)back.addEventListener('click',function(e){if(saving){e.preventDefault();return;}if(!canManage()||!session.isDirty())return;e.preventDefault();Confirm.ask({title:'保存草稿后退出？',body:'当前修改尚未保存。',ok:'保存草稿并退出',cancel:'不保存并退出',onOk:async function(){if(!await saveDraft())return;leaving=true;location.href='templates.html';},onCancel:function(){leaving=true;location.href='templates.html';}});});
  window.addEventListener('beforeunload',function(e){if(!leaving&&canManage()&&(saving||session.isDirty())){e.preventDefault();e.returnValue='';}});header();
 }};
 header();
})();
