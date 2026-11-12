(function(){
 'use strict';
 var C=CAP,T=C.Templates,$=function(s){return document.querySelector(s);},esc=UIK.esc,id=new URLSearchParams(location.search).get('id'),pending=null,editId=null,scopeControl=null,kw='';
 var coverVersion=null,coverTemplate=null,coverImage='',coverRead=0;
 DB.load();T.initialize();
 function paintCover(){
  var preview=coverTemplate&&UIK.AssetCard.templateCover(coverTemplate,coverVersion,coverImage||T.automaticCover(coverTemplate),false);
  $('#tm-cover-preview').innerHTML=preview||'<span>暂无页面预览</span>';
  $('#tm-cover-default').setAttribute('aria-pressed',String(!coverImage));
  $('#tm-cover-upload').dataset.selected=String(!!coverImage);
 }
 async function readCover(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>4*1024*1024){
   throw new Error('请选择 4 MB 以内的 JPG、PNG 或 WebP 图片');
  }
  var url=URL.createObjectURL(file),image=new Image();
  try{
   image.src=url;
   await image.decode();
   var scale=Math.min(1,960/image.naturalWidth,540/image.naturalHeight);
   var canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
   canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   var ctx=canvas.getContext('2d');
   ctx.fillStyle='#fff';
   ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(var quality of [0.85,0.65,0.45]){
    var data=canvas.toDataURL('image/jpeg',quality);
    if(T.coverImage(data))return data;
   }
  }finally{URL.revokeObjectURL(url);}
  throw new Error('封面图片过大，请换一张');
 }
 async function coverChanged(){
  var input=$('#tm-cover-file'),file=input.files[0];
  if(!file)return;
  var request=++coverRead;
  input.value='';
  $('#tm-error').hidden=true;
  $('#tm-save').disabled=true;
  try{
   var image=await readCover(file);
   if(request!==coverRead)return;
   coverImage=image;
   paintCover();
  }catch(e){
   if(request!==coverRead)return;
   $('#tm-error').textContent=e.name==='EncodingError'?'这张图片无法读取，请换一张':e.message;
   $('#tm-error').hidden=false;
  }finally{
   if(request===coverRead)$('#tm-save').disabled=false;
  }
 }

 function notify(e){UIK.toast(e.message||String(e),'error');}
 function download(id){try{var t=T.byId(id),url=URL.createObjectURL(T.exportZip(id)),a=document.createElement('a');a.href=url;a.download=t.name+'.zip';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}catch(e){notify(e);}}
 function coverHint(){
  var text=esc('保存草稿或确认发布时，截取当前画布并更新封面。');
  return '<span class="seg-tip tm-cover-tip" tabindex="0" role="note" aria-label="'+text+'" data-tip="'+text+'">?</span>';
 }
 function closeEdit(){
  coverRead++;$('#tm-cover-preview').replaceChildren();UIK.Dialog.close($('#tm-mask'));
  pending=null;editId=null;coverTemplate=null;coverVersion=null;coverImage='';
 }
 function edit(t,pkg){
  if(!$('#tm-mask')){
   document.body.insertAdjacentHTML('beforeend',UIK.Dialog.html({id:'tm-mask',titleId:'tm-title',title:'编辑模版',closeId:'tm-close',hidden:true,body:'<div class="nf-row"><label for="tm-name">模版名称 <span class="nf-req">*</span></label><input id="tm-name" maxlength="80" required></div><div class="nf-row"><label for="tm-intro">说明</label><textarea id="tm-intro"></textarea></div><fieldset class="nf-row tm-cover-field" id="tm-cover-field"><legend>模版封面</legend><div class="tm-cover-preview" id="tm-cover-preview" inert></div><div class="nf-cover-act"><button type="button" class="btn quiet" id="tm-cover-default" aria-pressed="true">默认预览</button>'+coverHint()+'<label class="btn quiet tm-cover-upload" id="tm-cover-upload">本地上传<input type="file" id="tm-cover-file" accept="image/jpeg,image/png,image/webp"></label></div></fieldset><div id="tm-scope"></div><p id="tm-files-count" class="it-hint"></p><p id="tm-error" role="alert" class="nf-err" hidden></p>',footer:'<button type="button" class="btn quiet" id="tm-cancel">取消</button><button type="button" class="btn primary" id="tm-save">保存</button>'}));
   scopeControl=Scope.render($('#tm-scope'),{});
   $('#tm-cover-file').onchange=coverChanged;
   $('#tm-cover-default').onclick=function(){
    coverRead++;coverImage='';
    $('#tm-save').disabled=false;
    $('#tm-error').hidden=true;
    paintCover();
   };
   $('#tm-close').onclick=closeEdit;$('#tm-cancel').onclick=closeEdit;
   $('#tm-save').onclick=function(){try{var meta={name:$('#tm-name').value,intro:$('#tm-intro').value,useScope:scopeControl.get(),cover:coverImage};if(editId)T.update(editId,meta);else T.create(meta,pending.files);paint();closeEdit();UIK.toast('已保存');}catch(e){$('#tm-error').textContent=e.message;$('#tm-error').hidden=false;}};
  }
  coverRead++;
  coverTemplate=t;
  coverVersion=t?T.currentVersion(t.id):null;
  coverImage=T.coverImage(t?t.cover:pkg.cover);
  $('#tm-cover-field').hidden=!t;
  $('#tm-save').disabled=false;
  if(t)paintCover();
  editId=t?t.id:null;pending=pkg;$('#tm-title').textContent=t?'编辑模版':'导入模版';$('#tm-name').value=t?t.name:pkg.name;$('#tm-intro').value=t?t.intro:pkg.intro;scopeControl.set(t?t.useScope:{mode:'self'});$('#tm-files-count').hidden=true;$('#tm-error').hidden=true;UIK.Dialog.open($('#tm-mask'),{initialFocus:$('#tm-name'),onEscape:closeEdit,returnFocus:function(){return t?document.querySelector('[data-template-menu="'+CSS.escape(t.id)+'"]'):$('#tm-import');}});
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
  try{if(b.dataset.tplCopy){T.clone(b.dataset.tplCopy);paint();UIK.toast('已复制');}if(b.dataset.tplEdit)edit(T.byId(b.dataset.tplEdit));if(b.dataset.tplExport)download(b.dataset.tplExport);if(b.dataset.tplDelete){var t=T.byId(b.dataset.tplDelete);Confirm.ask({title:'删除模版？',body:esc(t.name),ok:'删除',danger:true,onOk:function(){T.remove(t.id);paint();}});}if(b.dataset.act==='toggle'){var t=T.byId(b.dataset.id);if(t){T.update(t.id,{on:t.on===false});paint();}}}catch(err){notify(err);}
 });
 $('#tm-file').onchange=inputChanged;
 if($('#tm-import'))$('#tm-import').onclick=function(){$('#tm-file').click();};
 if($('#tm-status'))$('#tm-status').onchange=paint;
 if($('#tm-search'))$('#tm-search').oninput=function(){kw=this.value.trim();paint();};
 if($('#tm-detail-export'))$('#tm-detail-export').onclick=function(){download(id);};
 UIK.Menu.bind($('#grid'),{
  trigger:'[data-template-menu]',
  panel:function(button){return button.nextElementSibling;}
 });
 document.addEventListener('click',function(e){var card=e.target.closest('[data-template-id]');if(card&&!e.target.closest('button,a,input,label,.k-menu,.ability-toggle'))location.href='template.html?id='+encodeURIComponent(card.dataset.templateId);});
 paint();window.addEventListener('storage',function(e){if(e.key==='ifas90:cap'){C.refresh();paint();}else if(e.key&&e.key.startsWith('ifas90:draft:template:'))paint();});
})();
