(function () {
  'use strict';
  var Parts=UIK.Ability;
  var C=window.CAP, $=function(s){return document.querySelector(s);};
  function esc(s){return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function toast(s){if(window.UIK) UIK.toast(s,'error');}
  if ($('#f-name')) {
    var id=new URLSearchParams(location.search).get('id'), b=C.abilityById(id), editable=!b || C.canManage(b);
    var files=JSON.parse(JSON.stringify((b && b.files)||[]));
    $('#f-name').insertAdjacentHTML('afterend','<div id="ability-scope"></div>');
    var sc=Scope.render($('#ability-scope'),{value:b && b.useScope});
    var fixedKind=b && b.kind || 'api';
    $('#api-list').insertAdjacentHTML('afterend','<section id="skill-files" hidden><div class="abt-sec"><b>技能附件</b><button type="button" class="btn ghost" id="skill-upload">添加文件</button><input type="file" id="skill-file-input" multiple hidden></div><p class="abt-hint">在能力说明书中编写 SKILL.md；可附参考资料、模板和素材，附件合计不超过 1 MB。</p><div class="api-list" id="skill-file-list"></div></section>');
    function dirty(){ $('#f-name').dispatchEvent(new Event('input')); }
    function paintFiles(){
      $('#skill-file-list').innerHTML=files.length ? files.map(function(f,i){return '<div class="api-card"><div class="api-hd"><span class="api-p">'+esc(f.name)+'</span><span class="abt-hint">'+(f.encoding==='base64'?'素材文件':'文本文件')+'</span></div><div class="api-sub"><span class="api-ops"><button class="abt-op" type="button" data-file-download="'+i+'">下载</button>'+(editable?'<button class="abt-op is-danger" type="button" data-file-remove="'+i+'">移除</button>':'')+'</span></div></div>';}).join('') : '<p class="abt-hint">还没有附件。技能说明可以独立使用。</p>';
    }
    function kindPaint(){
      var skill=fixedKind==='skill';
      $('#skill-files').hidden=!skill; $('#api-list').hidden=skill; $('#api-title').parentNode.hidden=skill;
      $('#act-gen').hidden=skill || !editable;
      $('#doc').setAttribute('aria-label',skill?'技能说明 SKILL.md':'能力说明书');
      $('#doc').placeholder=skill?'编写技能的适用任务、操作步骤、附件用途和输出要求':'点「生成」，或直接编写能力说明书';
      if(skill && !$('#doc').value && editable) $('#doc').value='---\nname: my-skill\ndescription: 描述技能用途与适用任务\n---\n\n# 使用方法\n\n说明执行步骤、附件用途和输出要求。';
    }
    window.AbilityEditor={kind:function(){return fixedKind;},scope:function(){return sc.get();},files:function(){return files;},editable:editable,paint:kindPaint};
    document.addEventListener('click',function(e){if(e.target.closest('.sc,.sc-menu'))setTimeout(dirty,0);});
    $('#skill-upload').onclick=function(){$('#skill-file-input').click();};
    $('#skill-file-input').onchange=async function(){
      var picked=Array.from(this.files), next=files.slice();
      try{
        for(var f of picked){
          if(f.size>1024*1024)throw new Error('技能附件合计不能超过 1 MB');
          var text=/\.(md|txt|json|ya?ml|csv|tsv|css|html|svg|js|mjs|py|xml)$/i.test(f.name);
          var content=text?await f.text():await new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(String(r.result).split(',')[1]);};r.onerror=reject;r.readAsDataURL(f);});
          next=next.filter(function(x){return x.name!==f.name;}); next.push({name:f.name,mime:f.type||'application/octet-stream',encoding:text?'utf8':'base64',content:content});
        }
        C.validateFiles(next);files=next;paintFiles();dirty();
      }catch(e){toast(e.message||'文件读取失败');} this.value='';
    };
    $('#skill-file-list').onclick=function(e){
      var rm=e.target.closest('[data-file-remove]'), dl=e.target.closest('[data-file-download]');
      if(rm && editable){files.splice(Number(rm.dataset.fileRemove),1);paintFiles();dirty();}
      if(dl){var f=files[Number(dl.dataset.fileDownload)];var a=document.createElement('a');a.download=f.name;a.href=f.encoding==='base64'?'data:'+f.mime+';base64,'+f.content:URL.createObjectURL(new Blob([f.content],{type:f.mime}));a.click();if(f.encoding!=='base64')setTimeout(function(){URL.revokeObjectURL(a.href);},0);}
    };
    paintFiles();
    window.addEventListener('load',function(){
      kindPaint();
      if(!editable){
        document.title=(b.name||'能力')+' · 查看能力';
        document.querySelectorAll('.main input,.main textarea,.main select').forEach(function(x){x.disabled=true;});
        $('#act-save').hidden=true;$('#act-gen').hidden=true;$('#skill-upload').hidden=true;
        document.querySelectorAll('#api-title ~ .abt-ops,#api-title + .abt-ops,.api-ops [data-act="edit"],.api-ops [data-act="rm"],#act-add,#act-testall').forEach(function(x){x.hidden=true;});
        document.addEventListener('click',function(e){if(e.target.closest('#act-add,#act-testall,#act-gen,#act-save,[data-act="rm"],[data-act="edit"],[data-act="test"]')){e.preventDefault();e.stopImmediatePropagation();}},true);
      }
    });
  }
  function paintCapabilityCount(){var b=$('#act-available');if(!b)return;var n=C.capabilityCounts();b.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/></svg><span>可用资产<span class="cap-ratio">（'+n.enabled+'/'+n.total+'）</span></span>';b.removeAttribute('title');b.setAttribute('aria-label',b.textContent);}
  paintCapabilityCount();
  window.addEventListener('capabilities-changed',function(){paintCapabilityCount();if(window.CapabilityCatalog)CapabilityCatalog.refresh();});
  window.addEventListener('storage',function(e){if(e.key==='ifas90:cap'){C.refresh();paintCapabilityCount();if(window.CapabilityCatalog)CapabilityCatalog.refresh();}else if(e.key==='ifas90:cap-prefs:'+C.actor().id ){paintCapabilityCount();if(window.CapabilityCatalog)CapabilityCatalog.refresh();}});
})();
