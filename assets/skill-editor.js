/* Skill abilities use the existing file-tree editor, not the API form. */
(function(){
 'use strict';
 var C=window.CAP,$=function(s){return document.querySelector(s);},id=new URLSearchParams(location.search).get('id'),b=C.abilityById(id);
 if(!b || !C.isGranted(b)){location.replace('abilities.html');return;}
 if(b.kind!=='skill'){location.replace('ability.html?id='+encodeURIComponent(id));return;}
 var writable=false,files=JSON.parse(JSON.stringify(b.files||[])),folders=(b.folders||[]).slice(),doc=b.doc||'',cur='SKILL.md',dirty=false,preview=false,closed={},busy=false,turn=0;
 var original=JSON.stringify({name:b.name,intro:b.intro,doc:doc,files:files,folders:folders,scope:b.useScope,on:b.on});
 function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function notify(s,error){UIK.toast(s,error?'error':'info');}
 if($('#se-actor'))$('#se-actor').textContent=C.actor().name;
 $('#crumb-name').textContent=b.name || '新建技能';document.title=(b.name||'新建技能')+' · 技能能力';
 $('#se-name').value=b.name||'';$('#se-desc').value=b.intro||'';
 var scope=Scope.render($('#se-scope'),{value:b.useScope});
 function scopeLabel(){var x={useScope:scope.get()};$('#se-range').textContent='可用范围：'+C.scopeLabel(x);}
 function current(){return cur==='SKILL.md'?{name:cur,encoding:'utf8',content:doc,mime:'text/markdown'}:files.filter(function(f){return f.name===cur;})[0];}
 function changed(){dirty=true;UIK.Ability.editorFeedback($('#se-state'),'dirty');$('#se-save').disabled=!writable;}
 function stash(){var f=current();if(!f || f.encoding==='base64' || preview)return;if(cur==='SKILL.md')doc=$('#se-code').value;else f.content=$('#se-code').value;}
 function fileTree(){
  var names=['SKILL.md'].concat(files.map(function(f){return f.name;})),dirs={};
  folders.forEach(function(f){dirs[f]=true;});names.forEach(function(n){var p=n.split('/');p.pop();while(p.length){dirs[p.join('/')]=true;p.pop();}});
  var all=Object.keys(dirs).map(function(n){return {path:n,folder:true};}).concat(names.map(function(n){return {path:n,folder:false};}));
  all.sort(function(a,b){return a.path==='SKILL.md'?-1:b.path==='SKILL.md'?1:a.path.localeCompare(b.path);});
  $('#se-files').innerHTML=all.filter(function(x){return !Object.keys(closed).some(function(p){return closed[p]&&x.path.indexOf(p+'/')===0;});}).map(function(x){var depth=x.path.split('/').length-1;return '<button type="button" class="'+(x.folder?'se-folder':'se-file')+(x.path===cur?' is-on':'')+'" data-path="'+esc(x.path)+'" data-folder="'+(x.folder?'1':'0')+'" aria-expanded="'+(!closed[x.path])+'" style="padding-left:calc(var(--space-12) + '+depth+' * var(--space-16))">'+(x.folder?(closed[x.path]?'▸ ':'▾ '):'')+esc(x.path.split('/').pop())+'</button>';}).join('');
 }
 function paintEditor(){
  var f=current();if(!f){cur='SKILL.md';f=current();}
  $('#se-fname').textContent=cur;$('#se-code').value=f.content||'';$('#se-code').readOnly=!writable||busy;
  $('#se-rename').hidden=!writable||cur==='SKILL.md';$('#se-delete').hidden=!writable||cur==='SKILL.md';
  $('#se-code').hidden=preview||f.encoding==='base64';$('#se-preview').hidden=!preview&&f.encoding!=='base64';
  $('#se-view').textContent=preview?'编辑':'预览';$('#se-view').hidden=f.encoding==='base64';
  var p=$('#se-preview');p.innerHTML='';
  if(f.encoding==='base64'){
   if(/^image\/(png|jpeg|webp|gif)$/.test(f.mime||'')){var im=document.createElement('img');im.alt=f.name;im.src='data:'+f.mime+';base64,'+f.content;p.appendChild(im);}else p.textContent='此文件暂不支持在线预览，可下载查看。';
  }else if(preview){var pre=document.createElement('pre');pre.textContent=f.content||'';p.appendChild(pre);}
  fileTree();
 }
 $('#se-files').onclick=function(e){var t=e.target.closest('[data-path]');if(!t)return;stash();if(t.dataset.folder==='1'){closed[t.dataset.path]=!closed[t.dataset.path];fileTree();return;}cur=t.dataset.path;preview=false;paintEditor();};
 $('#se-code').oninput=function(){stash();changed();};$('#se-name').oninput=changed;$('#se-desc').oninput=changed;
 $('#se-view').onclick=function(){stash();preview=!preview;paintEditor();};
 $('#se-range').onclick=function(){if(!writable)return;$('#se-scope-mask').hidden=false;};
 function closeScope(){$('#se-scope-mask').hidden=true;scopeLabel();changed();$('#se-range').focus();}
 $('#se-scope-ok').onclick=closeScope;$('#se-scope-close').onclick=closeScope;
 $('#se-scope-mask').onkeydown=function(e){if(e.key==='Escape')closeScope();};
 function validPath(p){return !!p && !/(^\/|\\|(^|\/)\.\.(\/|$)|\/\/)/.test(p) && p!=='SKILL.md' && !files.some(function(f){return f.name===p;}) && folders.indexOf(p)<0;}
 var mode='file';
 function openName(kind){mode=kind;$('#se-name-mask').hidden=false;$('#se-path-title').textContent=kind==='folder'?'新建文件夹':kind==='rename'?'重命名文件':'新建文件';$('#se-path').value=kind==='rename'?cur:'';$('#se-path-error').textContent='';$('#se-path').focus();}
 $('#se-add').onclick=function(){openName('file');};$('#se-folder').onclick=function(){openName('folder');};$('#se-rename').onclick=function(){openName('rename');};
 function closeName(){$('#se-name-mask').hidden=true;}
 $('#se-path-cancel').onclick=closeName;$('#se-path-close').onclick=closeName;
 $('#se-path-confirm').onclick=function(){
  var p=$('#se-path').value.trim();
  if(mode==='rename'&&p===cur){closeName();return;}
  if(!validPath(p)){$('#se-path-error').textContent='请输入未重复的相对路径，例如 references/design.md';return;}
  stash();
  if(mode==='folder')folders.push(p);else if(mode==='rename'){current().name=p;cur=p;}else{files.push({name:p,encoding:'utf8',mime:'text/plain',content:''});cur=p;preview=false;}
  closeName();changed();paintEditor();
 };
 $('#se-path').onkeydown=function(e){if(e.key==='Enter')$('#se-path-confirm').click();if(e.key==='Escape')closeName();};
 $('#se-delete').onclick=function(){Confirm.ask({title:'删除文件',body:'删除「'+esc(cur)+'」？请同步检查技能说明中的文件引用。',ok:'删除',danger:true,onOk:function(){files=files.filter(function(f){return f.name!==cur;});cur='SKILL.md';changed();paintEditor();}});};
 $('#se-upload').onclick=function(){$('#se-input').click();};
 $('#se-input').onchange=async function(){
  stash();var next=JSON.parse(JSON.stringify(files)),nextDoc=doc;
  try{
   for(var f of Array.from(this.files)){
    if(f.size>1024*1024)throw new Error('技能附件合计不能超过 1 MB');
    var name=f.webkitRelativePath||f.name,text=/\.(md|txt|json|ya?ml|csv|tsv|css|html|svg|js|mjs|py|xml)$/i.test(name);
    var content=text?await f.text():await new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(String(r.result).split(',')[1]);};r.onerror=reject;r.readAsDataURL(f);});
    if(name==='SKILL.md'){nextDoc=content;continue;}
    next=next.filter(function(x){return x.name!==name;});next.push({name:name,encoding:text?'utf8':'base64',mime:f.type||'application/octet-stream',content:content});
   }
   C.validateFiles(next);files=next;doc=nextDoc;changed();paintEditor();
  }catch(e){notify(e.message||'文件读取失败',true);}this.value='';
 };
 $('#se-download').onclick=function(){stash();var f=current(),a=document.createElement('a');a.download=f.name.split('/').pop();a.href=f.encoding==='base64'?'data:'+f.mime+';base64,'+f.content:URL.createObjectURL(new Blob([f.content],{type:f.mime}));a.click();if(f.encoding!=='base64')setTimeout(function(){URL.revokeObjectURL(a.href);},0);};
 $('#se-save').onclick=function(){
  if(!C.canManage(C.abilityById(id))){notify('只有创建人和管理员可以调整能力',true);return;}
  stash();var name=$('#se-name').value.trim();if(!name){$('#se-name').focus();notify('填写能力名称',true);return;}if(!doc.trim()){cur='SKILL.md';paintEditor();notify('填写 SKILL.md 技能说明',true);return;}
  try{C.validateFiles(files);C.updateAbility(id,{name:name,intro:$('#se-desc').value.trim(),doc:doc,files:files,folders:folders,useScope:scope.get(),docState:'ready',docFrom:'manual',docAt:C.now()});dirty=false;UIK.Ability.editorFeedback($('#se-state'),'idle');$('#se-save').disabled=true;$('#crumb-name').textContent=name;notify('已保存');}catch(e){notify(e.message||'没保存上',true);}
 };
 function leave(){if(!dirty){location.href='abilities.html';return;}Confirm.ask({title:'离开技能编辑？',body:'有未保存的修改，离开后将丢弃。',ok:'离开',onOk:function(){dirty=false;location.href='abilities.html';}});}
 $('#se-cancel').onclick=leave;document.querySelectorAll('a[href="abilities.html"]').forEach(function(a){a.onclick=function(e){e.preventDefault();leave();};});
 window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
 // The conversation edits the SAME draft shown by the file tree and editor.
 var historyKey='ifas90:skill-chat:'+id+':'+C.actor().id,history=[];
 try{history=JSON.parse(sessionStorage.getItem(historyKey)||'[]');}catch(_){}
 function paintChat(){
  $('#se-messages').innerHTML=history.length?history.map(function(m){return '<div class="se-message" data-role="'+m.role+'"><b>'+(m.role==='user'?'我':'助手')+'</b><p>'+esc(m.text)+'</p>'+(m.paths?m.paths.map(function(p){return '<button class="se-change" type="button" data-open-file="'+esc(p)+'">'+esc(p)+'</button>';}).join(''):'')+(m.error?'<p class="se-chat-error">'+esc(m.error)+'</p><button class="abt-op" data-retry="1">重试</button>':'')+'</div>';}).join(''):'<div class="se-chat-empty">描述要生成的技能，或提出修改方向。对话可以同步调整 SKILL.md 和相关文件。</div>';
  $('#se-messages').scrollTop=$('#se-messages').scrollHeight;
  try{sessionStorage.setItem(historyKey,JSON.stringify(history.slice(-30)));}catch(_){}
 }
 function setBusy(v){
  busy=v;$('#se-chat-state').textContent=v?'生成中':'';$('#se-send').textContent=v?'停止':'发送';
  $('#se-code').readOnly=v||!writable;
  document.querySelectorAll('#se-save,#se-add,#se-folder,#se-upload,#se-rename,#se-delete,#se-name,#se-desc,#se-new-chat,#se-range').forEach(function(e){e.disabled=v||!writable; if(e.id==='se-save')e.disabled=v||!writable||!dirty;});
 }
 function applyChatResult(result){
  if(!result || !Array.isArray(result.files) || !Array.isArray(result.remove||[]))throw new Error('模型没有返回可用的文件修改');
  var next=JSON.parse(JSON.stringify(files)),nextDoc=doc,paths=[];
  (result.remove||[]).forEach(function(path){if(path==='SKILL.md')throw new Error('不能删除 SKILL.md');next=next.filter(function(f){return f.name!==path;});});
  result.files.forEach(function(f){
   if(!f || typeof f.name!=='string' || typeof f.content!=='string')throw new Error('模型返回的文件格式不正确');
   if(f.name==='SKILL.md'){if(!f.content.trim())throw new Error('SKILL.md 不能为空');nextDoc=f.content;}
   else{
    if(!/\.(md|txt|json|ya?ml|csv|tsv|css|html|svg|js|mjs|py|xml)$/i.test(f.name))throw new Error('对话只能生成文本文件，素材请上传');
    var old=next.filter(function(x){return x.name===f.name;})[0];if(old&&old.encoding==='base64')throw new Error('不能用文本覆盖素材文件');
    next=next.filter(function(x){return x.name!==f.name;});next.push({name:f.name,encoding:'utf8',mime:'text/plain',content:f.content});
   }
   paths.push(f.name);
  });
  C.validateFiles(next);if(!paths.length && !(result.remove||[]).length)throw new Error('没有生成文件修改');
  // Commit atomically after all validation. Never save or change grants from a model response.
  files=next;doc=nextDoc;cur=paths[0]||'SKILL.md';preview=false;changed();paintEditor();
  return paths;
 }
 async function sendChat(retry){
  if(busy){turn++;if(window.Gen)Gen.abort();if(history.length)history[history.length-1].error='已停止生成';paintChat();setBusy(false);return;}
  if(!writable||!C.canManage(C.abilityById(id)))return;
  var text=retry||$('#se-prompt').value.trim();if(!text)return;
  stash();$('#se-prompt').value='';
  if(!retry)history.push({role:'user',text:text});else if(history.length)delete history[history.length-1].error;
  paintChat();setBusy(true);var token=++turn;
  try{
   var requestFiles=[{name:'SKILL.md',content:doc}].concat(files.map(function(f){return {name:f.name,content:f.encoding==='base64'?'[二进制素材，未读取内容]':f.content};}));
   if(JSON.stringify(requestFiles).length>100000)throw new Error('技能文本内容过长，请精简后重试');
   var result=await Gen.skillEdit(text,{name:$('#se-name').value,description:$('#se-desc').value,currentFile:cur,files:requestFiles,history:history.slice(-8)});
   if(token!==turn)return;
   if(!C.canManage(C.abilityById(id)))throw new Error('维护权限已变更');
   var paths=applyChatResult(result);
   history.push({role:'assistant',text:result.say||'已更新技能文件，保存后生效。',paths:paths});paintChat();
  }catch(e){if(token===turn){history[history.length-1].error=/401|登录/.test(e.message||'')?'模型登录已失效，请在本机重新登录 Codex':/超时/.test(e.message||'')?'生成超时，请缩小修改范围后重试':'生成失败，请重试';paintChat();}}
  finally{if(token===turn)setBusy(false);}
 }
 $('#se-send').onclick=function(){sendChat();};
 $('#se-messages').onclick=function(e){var f=e.target.closest('[data-open-file]');if(f){stash();cur=f.dataset.openFile;preview=false;paintEditor();}if(e.target.closest('[data-retry]'))sendChat(history[history.length-1].text);};
 $('#se-new-chat').onclick=function(){history=[];paintChat();$('#se-prompt').focus();};
 if(!writable){$('#se-chat-compose').hidden=true;$('#se-new-chat').hidden=true;}
 paintChat();
 if(!writable){document.querySelectorAll('[data-write],#se-save,#se-add,#se-folder,#se-upload,#se-name,#se-desc').forEach(function(e){if(/INPUT|TEXTAREA/.test(e.tagName))e.disabled=true;else e.hidden=true;});$('#se-range').disabled=true;UIK.Ability.editorFeedback($('#se-state'),'readonly');$('#se-code').readOnly=true;}
 $('#se-save').disabled=true;scopeLabel();paintEditor();
})();
