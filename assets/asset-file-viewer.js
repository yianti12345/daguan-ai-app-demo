/* 模版文件查看组件：代码只读；HTML 在无脚本、无网络权限的 iframe 中预览。 */
(function(){
 'use strict';
 function mount(host,files){
  var selected=Math.max(0,files.findIndex(function(f){return /(^|\/)(index\.html|preview\.(png|jpg|webp)|design\.md)$/i.test(f.name);})),preview=true;
  host.innerHTML='<div class="af-tree"></div><div class="af-main"><div class="af-head"><span class="af-name"></span><span class="bar-sp"></span><button type="button" class="abt-op af-mode">代码</button><button type="button" class="abt-op af-download">下载</button></div><div class="af-content"></div></div>';
  var tree=host.querySelector('.af-tree'),body=host.querySelector('.af-content'),mode=host.querySelector('.af-mode');
  function data(f){return 'data:'+(f.mime||'text/plain')+';base64,'+(f.encoding==='base64'?f.content:btoa(unescape(encodeURIComponent(f.content||''))));}
  function html(f){var dir=f.name.split('/').slice(0,-1);function resolve(path){var bits=dir.concat(path.split('/')),out=[];bits.forEach(function(x){if(!x||x==='.')return;if(x==='..')out.pop();else out.push(x);});return files.find(function(x){return x.name===out.join('/');});}
   var source=f.content.replace(/(<link\b[^>]*href=)["']([^"']+)["']/gi,function(all,p,url){var local=resolve(url);return local?p+'"'+data(local)+'"':all;}).replace(/(<img\b[^>]*src=)["']([^"']+)["']/gi,function(all,p,url){var local=resolve(url);return local?p+'"'+data(local)+'"':all;});
   return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\' data:; img-src data:; font-src data:;">'+source;
  }
  function paint(){
   tree.innerHTML=files.map(function(f,i){return '<button type="button" class="af-file'+(i===selected?' is-on':'')+'" data-file="'+i+'" title="'+UIK.esc(f.name)+'">'+UIK.esc(f.name)+'</button>';}).join('');
   var f=files[selected];body.innerHTML='';if(!f)return;host.querySelector('.af-name').textContent=f.name;
   var image=f.encoding==='base64'&&/^image\/(png|jpeg|gif|webp)$/.test(f.mime||''),page=/\.html?$/i.test(f.name)&&f.encoding!=='base64';mode.hidden=!(image||page);mode.textContent=preview?'代码':'预览';
   if(preview&&image){var img=document.createElement('img');img.alt=f.name;img.src=data(f);body.appendChild(img);}
   else if(preview&&page){var frame=document.createElement('iframe');frame.title=f.name;frame.setAttribute('sandbox','');frame.srcdoc=html(f);body.appendChild(frame);}
   else{var code=document.createElement('pre');code.textContent=f.encoding==='base64'?'二进制文件':f.content;body.appendChild(code);}
  }
  tree.onclick=function(e){var b=e.target.closest('[data-file]');if(!b)return;selected=Number(b.dataset.file);preview=true;paint();};mode.onclick=function(){preview=!preview;paint();};
  host.querySelector('.af-download').onclick=function(){var f=files[selected],url=URL.createObjectURL(new Blob([CAP.Templates.bytes(f)],{type:f.mime||'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=f.name.split('/').pop();a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};paint();
 }
 window.AssetFileViewer={mount:mount};
})();
