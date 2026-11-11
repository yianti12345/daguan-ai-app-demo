/* 模版资产：独立文件包，旧组件只复制一次；不回写旧组件或已生成的应用。 */
(function(){
 'use strict';
 var C=window.CAP,MAX=1024*1024;
 function copy(v){return JSON.parse(JSON.stringify(v));}
 function scope(v){v=v||{};return {mode:['self','public','custom'].includes(v.mode)?v.mode:'self',roles:v.roles||[],depts:v.depts||[],users:v.users||[]};}
 function emit(){window.dispatchEvent(new Event('capabilities-changed'));}
 function save(list){var d=C.load(),old=d.templates;d.templates=list;try{C.save();}catch(e){d.templates=old;throw e;}emit();}
 function file(name,content){return {name:name,content:String(content),encoding:'utf8',mime:'text/plain'};}
 function init(){
  var d=C.load();if(!Array.isArray(d.templates))d.templates=[];
  if(d.templatesV1||!window.DB)return;
  if(!DB.APPS.length)DB.load();
  var old=d.templates.slice();
  DB.COMPS.filter(function(c){return c.id!=='app-header'&&!c.id.startsWith('app-private-');}).forEach(function(c){
   var id='tpl-legacy-'+c.id;if(d.templates.some(function(t){return t.id===id;}))return;
   var payload={name:c.name,fields:copy(c.fields||[]),spec:copy(c.spec||null),block:copy(c.block||null),layout:c.layout||'full'};
   d.templates.push({id:id,assetType:'template',kind:'template',name:c.name,intro:c.desc||c.intro||'页面结构与样式参考',ownerId:'zheng',ownerName:'zheng',useScope:scope(c.visScope),on:c.enabled!==false,revision:1,at:C.now(),files:[file('design.md','# '+c.name+'\n\n以 template.json 中的结构与样式为参考，结合用户任务生成独立应用。接口使用需单独取得能力授权。'),file('template.json',JSON.stringify(payload,null,2))]});
  });
  d.templatesV1=true;try{C.save();}catch(e){d.templates=old;delete d.templatesV1;throw e;}emit();
 }
 function all(){init();return C.load().templates||[];}
 function byId(id){return all().find(function(t){return t.id===id;})||null;}
 function validate(files){
  if(!Array.isArray(files)||!files.length)throw new Error('请导入模版文件');
  if(files.length>200)throw new Error('模版文件数超过限制');
  var names={};files.forEach(function(f){if(!f.name||f.name==='.'||/^[\\/]|^[a-z]:/i.test(f.name)||/[\\\x00-\x1f]/.test(f.name)||f.name.split('/').some(function(p){return !p||p==='.'||p==='..';}))throw new Error('文件路径无效');var n=f.name.toLowerCase();if(names[n])throw new Error('模版包含重复文件');names[n]=true;if(!['utf8','base64'].includes(f.encoding||'utf8'))throw new Error('文件编码无效');});
  C.validateFiles(files);return copy(files);
 }
 function create(meta,files){
  var actor=C.actor(),t={id:'tpl-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),assetType:'template',kind:'template',name:String(meta.name||'').trim(),intro:String(meta.intro||''),ownerId:actor.id,ownerName:actor.name,useScope:scope(meta.useScope),on:true,revision:1,at:C.now(),files:validate(files)};
  if(!t.name)throw new Error('填写模版名称');save(all().concat([t]));return t;
 }
 function update(id,patch){
  var list=all(),old=byId(id);if(!old||!C.canManage(old))throw new Error('只有创建人和管理员可以维护模版');
  var next=copy(old);['name','intro','on'].forEach(function(k){if(k in patch)next[k]=patch[k];});if('useScope'in patch)next.useScope=scope(patch.useScope);if('files'in patch)next.files=validate(patch.files);
  next.name=String(next.name||'').trim();if(!next.name)throw new Error('填写模版名称');next.revision++;next.at=C.now();save(list.map(function(t){return t.id===id?next:t;}));return next;
 }
 function remove(id){var t=byId(id);if(!t||!C.canManage(t))throw new Error('只有创建人和管理员可以维护模版');save(all().filter(function(x){return x.id!==id;}));}
 function bytes(f){if(f.encoding!=='base64')return new TextEncoder().encode(f.content||'');var raw=atob(f.content||'');return Uint8Array.from(raw,function(c){return c.charCodeAt(0);});}
 function fromBytes(name,data){
  var ext=name.split('.').pop().toLowerCase(),mimes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',css:'text/css',html:'text/html',md:'text/markdown',json:'application/json'};
  if(/^(png|jpg|jpeg|gif|webp|woff2?|ttf|otf|pdf|ico)$/.test(ext)){var raw='';for(var i=0;i<data.length;i+=16384)raw+=String.fromCharCode.apply(null,data.subarray(i,i+16384));return {name:name,encoding:'base64',content:btoa(raw),mime:mimes[ext]||'application/octet-stream'};}
  var text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch(e){throw new Error(name+' 不是有效的 UTF-8 文件');}return {name:name,encoding:'utf8',content:text,mime:mimes[ext]||'text/plain'};
 }
 async function unpack(input){
  var selected=Array.from(input||[]);if(!selected.length)throw new Error('请选择文件');var files=[],meta={},base=selected[0].name.replace(/\.[^.]+$/,'');
  if(selected.length===1&&/\.zip$/i.test(selected[0].name)){
   if(!window.fflate)throw new Error('压缩包读取组件未加载');if(selected[0].size>MAX)throw new Error('压缩包超过演示容量（1 MB）');
   var total=0,count=0,raw=fflate.unzipSync(new Uint8Array(await selected[0].arrayBuffer()),{filter:function(f){if(f.name.endsWith('/'))return false;total+=f.originalSize;count++;if(total>MAX||count>200)throw new Error('解压后的模版超过演示容量');return true;}});
   Object.keys(raw).forEach(function(n){if(/(^|\/)\.asset-manifest\.json$/.test(n)){meta=JSON.parse(new TextDecoder().decode(raw[n]));return;}if(!/(^|\/)__MACOSX\/|(^|\/)\.DS_Store$/.test(n))files.push(fromBytes(n,raw[n]));});
  }else if(selected.length===1&&/\.json$/i.test(selected[0].name)){
   var text=await selected[0].text(),j;try{j=JSON.parse(text);}catch(e){throw new Error('JSON 格式无效');}
   if(j.kind==='template-asset'){meta=j.template||j;files=meta.files||[];}else files=[file(selected[0].name,text)];
  }else{
   var size=selected.reduce(function(n,f){return n+f.size;},0);if(size>MAX)throw new Error('模版超过演示容量（1 MB）');
   for(var f of selected)files.push(fromBytes(f.webkitRelativePath||f.name,new Uint8Array(await f.arrayBuffer())));
  }
  return {name:meta.name||base,intro:meta.intro||'',files:validate(files)};
 }
 function exportZip(id){var t=byId(id);if(!t||!C.canManage(t))throw new Error('没有导出权限');var entries={};t.files.forEach(function(f){entries[f.name]=bytes(f);});entries['.asset-manifest.json']=new TextEncoder().encode(JSON.stringify({kind:'template-asset',schema:1,name:t.name,intro:t.intro},null,2));return new Blob([fflate.zipSync(entries)],{type:'application/zip'});}
 function context(t){
  var sorted=t.files.slice().sort(function(a,b){return (/design\.md$/i.test(a.name)?-1:0)-(/design\.md$/i.test(b.name)?-1:0);});
  return sorted.map(function(f){return '\n### '+f.name+'\n'+(f.encoding==='base64'?'二进制素材（'+f.mime+'），未读取图像内容':f.content);}).join('\n');
 }
 function snapshot(t,files){return {name:t.name,intro:t.intro,files:copy(files||t.files)};}
 function ensureVersions(id){
  var t=byId(id);if(!t)return [];if(Array.isArray(t.versions)&&t.versions.length)return t.versions;
  var legacy=id.indexOf('tpl-legacy-')===0?id.slice(11):'',comp=legacy&&window.DB&&DB.compById(legacy),old=comp?DB.versOf('comp',legacy).filter(function(r){return r.kind==='stable';}):[];
  var current=old.find(function(r){return r.active;});var number=current?current.v:((comp&&DB.verNum(comp.ver))||1);
  var versions=old.map(function(r){var snap=null;if(r.active||r.v===number)snap=snapshot(t);else if(r.snap){var files=copy(t.files).filter(function(f){return f.name!=='template.json';});files.push(file('template.json',JSON.stringify(r.snap,null,2)));snap=snapshot(t,files);}return {v:r.v,kind:'stable',active:r.v===number,at:r.at,createdById:r.createdById||'',createdBy:r.createdBy||(r.snap&&r.snap.editor)||'',snap:snap};});
  if(!versions.some(function(r){return r.v===number;}))versions.push({v:number,kind:'stable',active:true,at:t.at,createdById:legacy?'':t.ownerId,createdBy:legacy?'':t.ownerName,snap:snapshot(t)});
  var next=copy(t);next.versions=versions;save(all().map(function(x){return x.id===id?next:x;}));return next.versions;
 }
 function versionsOf(id){var t=byId(id);if(!t||!C.isGranted(t))return [];return copy(ensureVersions(id)).sort(function(a,b){return b.v-a.v;});}
 function versionNumber(id){var rows=versionsOf(id),active=rows.find(function(r){return r.active;});return active?active.v:0;}
 function saveVersion(id,files,expectedVersion){
  var t=byId(id);if(!t||!C.canManage(t))throw new Error('只有创建人和管理员可以保存模版版本');
  var checked=validate(files),rows=copy(ensureVersions(id)),number=rows.reduce(function(n,r){return Math.max(n,r.v);},0)+1;
  if(expectedVersion&&number!==Number(expectedVersion))throw new Error('版本已更新，请重新确认发布');
  var actor=C.actor();
  t=byId(id);var next=copy(t);next.files=checked;next.revision++;next.at=C.now();rows.forEach(function(r){r.active=false;});rows.push({v:number,kind:'stable',active:true,at:next.at,createdById:actor.id,createdBy:actor.name,snap:snapshot(next)});next.versions=rows;
  save(all().map(function(x){return x.id===id?next:x;}));return number;
 }
 function copyVersion(id,v){var r=versionsOf(id).find(function(x){return x.v===Number(v);});if(!r||!r.snap)throw new Error('此历史版本没有可用内容快照');return saveVersion(id,r.snap.files);}
 function clone(id){var t=byId(id);if(!t||!C.canManage(t))throw new Error('没有复制权限');var base=t.name+'（副本）',name=base,n=2;while(all().some(function(x){return x.name===name;}))name=base+n++;var copied=create({name:name,intro:t.intro,useScope:{mode:'self'}},copy(t.files));ensureVersions(copied.id);return byId(copied.id);}
 C.Templates={versionsOf:versionsOf,versionNumber:versionNumber,saveVersion:saveVersion,copyVersion:copyVersion,clone:clone,initialize:init,all:all,byId:byId,create:create,update:update,remove:remove,validate:validate,unpack:unpack,exportZip:exportZip,bytes:bytes,context:context,ready:function(t){return !!(t&&t.on!==false&&t.name&&Array.isArray(t.files)&&t.files.length);},visible:function(){return all().filter(function(t){return C.isGranted(t)||C.canManage(t);});}};
 if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',function(){try{init();}catch(e){UIK.toast(e.message,'error');}});
})();
