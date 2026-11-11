(function(){
 'use strict';
 var C=CAP,T=C.Templates,$=function(s){return document.querySelector(s);},esc=UIK.esc,id=new URLSearchParams(location.search).get('id'),pending=null,editId=null,scopeControl=null,kw='';
 DB.load();T.initialize();
 function notify(e){UIK.toast(e.message||String(e),'error');}
 function download(id){try{var t=T.byId(id),url=URL.createObjectURL(T.exportZip(id)),a=document.createElement('a');a.href=url;a.download=t.name+'.zip';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}catch(e){notify(e);}}
 function edit(t,pkg){
  if(!$('#tm-mask')){
   document.body.insertAdjacentHTML('beforeend',UIK.Dialog.html({id:'tm-mask',titleId:'tm-title',title:'编辑模版',closeId:'tm-close',hidden:true,body:'<div class="nf-row"><label for="tm-name">模版名称 <span class="nf-req">*</span></label><input id="tm-name" maxlength="80" required></div><div class="nf-row"><label for="tm-intro">说明</label><textarea id="tm-intro"></textarea></div><div id="tm-scope"></div><p id="tm-files-count" class="it-hint"></p><p id="tm-error" role="alert" class="nf-err" hidden></p>',footer:'<button type="button" class="btn quiet" id="tm-cancel">取消</button><button type="button" class="btn primary" id="tm-save">保存</button>'}));
   scopeControl=Scope.render($('#tm-scope'),{});function close(){$('#tm-mask').hidden=true;pending=null;editId=null;}
   $('#tm-close').onclick=close;$('#tm-cancel').onclick=close;$('#tm-mask').onkeydown=function(e){if(e.key==='Escape')close();};
   $('#tm-save').onclick=function(){try{var meta={name:$('#tm-name').value,intro:$('#tm-intro').value,useScope:scopeControl.get()};if(editId)T.update(editId,meta);else T.create(meta,pending.files);close();paint();UIK.toast('已保存');}catch(e){$('#tm-error').textContent=e.message;$('#tm-error').hidden=false;}};
  }
  editId=t?t.id:null;pending=pkg;$('#tm-title').textContent=t?'编辑模版':'导入模版';$('#tm-name').value=t?t.name:pkg.name;$('#tm-intro').value=t?t.intro:pkg.intro;scopeControl.set(t?t.useScope:{mode:'self'});$('#tm-files-count').hidden=true;$('#tm-error').hidden=true;$('#tm-mask').hidden=false;$('#tm-name').focus();
 }
 async function inputChanged(e){var input=e.target;if(!input.files.length)return;input.disabled=true;try{var pkg=await T.unpack(input.files);edit(null,pkg);}catch(err){notify(err);}finally{input.disabled=false;input.value='';}}
 function paint(){
  if(document.body.hasAttribute('data-template-editor')){TemplateBridge.refreshHeader();return;}
  if($('#template-files')){
   var t=T.byId(id);if(!t||!C.isGranted(t)){location.replace('templates.html');return;}
   document.title=t.name+' · 模版管理';$('#tm-detail-name').textContent=t.name;$('#tm-desc').textContent=t.intro||'';$('#tm-range').textContent=C.scopeLabel(t);$('#tm-detail-files').textContent=t.files.length+' 个文件';document.querySelectorAll('[data-template-write]').forEach(function(e){e.hidden=!C.canManage(t);});AssetFileViewer.mount($('#template-files'),t.files);return;
  }
  var status=$('#tm-status').value;
  var rows=T.visible().filter(function(t){return (!kw||(t.name+' '+t.intro).toLowerCase().includes(kw.toLowerCase()))&&(!status||(status==='on')===(t.on!==false));});
  $('#grid').innerHTML=rows.length?rows.map(UIK.AssetCard.template).join(''):'<div class="empty">暂无模版</div>';
  $('#total').textContent='共 '+rows.length+' 个模版';

 }
 document.addEventListener('click',function(e){var b=e.target.closest('[data-tpl-edit],[data-tpl-copy],[data-tpl-export],[data-tpl-delete],[data-act="toggle"]');if(!b)return;
  try{if(b.dataset.tplCopy){T.clone(b.dataset.tplCopy);paint();UIK.toast('已复制');}if(b.dataset.tplEdit)edit(T.byId(b.dataset.tplEdit));if(b.dataset.tplExport)download(b.dataset.tplExport);if(b.dataset.tplDelete){var t=T.byId(b.dataset.tplDelete);Confirm.ask({title:'删除模版？',body:esc(t.name),ok:'删除',onOk:function(){T.remove(t.id);paint();}});}if(b.dataset.act==='toggle'){var t=T.byId(b.dataset.id);if(t){T.update(t.id,{on:t.on===false});paint();}}}catch(err){notify(err);}
 });
 $('#tm-file').onchange=inputChanged;
 if($('#tm-import'))$('#tm-import').onclick=function(){$('#tm-file').click();};
 if($('#tm-status'))$('#tm-status').onchange=paint;
 if($('#tm-search'))$('#tm-search').oninput=function(){kw=this.value.trim();paint();};
 if($('#tm-detail-export'))$('#tm-detail-export').onclick=function(){download(id);};
 document.addEventListener('click',function(e){var btn=e.target.closest('[data-template-menu]');document.querySelectorAll('.k-menu:not([hidden])').forEach(function(m){if(!btn||m!==btn.nextElementSibling)m.hidden=true;});if(btn){var menu=btn.nextElementSibling;menu.hidden=!menu.hidden;btn.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden){Popover.place(btn,menu);var first=menu.querySelector('button');if(first)first.focus();}}else if(!e.target.closest('.k-menu'))document.querySelectorAll('[data-template-menu]').forEach(function(b){b.setAttribute('aria-expanded','false');});});
 document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.k-menu').forEach(function(m){m.hidden=true;});});
 document.addEventListener('click',function(e){var card=e.target.closest('[data-template-id]');if(card&&!e.target.closest('button,a,input,label,.k-menu,.ability-toggle'))location.href='template.html?id='+encodeURIComponent(card.dataset.templateId);});
 paint();window.addEventListener('storage',function(e){if(e.key==='ifas90:cap'){C.refresh();paint();}});
})();
