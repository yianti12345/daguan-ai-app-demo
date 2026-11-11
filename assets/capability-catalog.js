/* 可用资产唯一弹窗；勾选仅用于批量启停，不是能力调用或装配。 */
(function(){
 'use strict';
 var C=window.CAP,P=UIK.Ability,esc=UIK.esc,$=function(s){return document.querySelector(s);};
 var S={kw:'',terms:[],state:'',kind:'',page:1,size:12,batch:false,selected:{},turn:0,ctl:null};
 function rows(){return C.searchAuthorizedAssets(S.kw,S.terms).filter(function(b){var ready=C.isReady(b),on=ready&&C.isPersonalEnabled(b);return (!S.kind||S.kind===(b.assetType||'ability'))&&(!S.state||(S.state==='unavailable'?!ready:ready&&(S.state==='on')===on));});}
 function stopSearch(){S.turn++;if(S.ctl){S.ctl.userStopped=true;S.ctl.abort();S.ctl=null;}if($('#av-search'))$('#av-search').disabled=false;}
 function close(){stopSearch();var m=$('#available-mask');m.hidden=true;m.dataset.open='false';if($('#act-available'))$('#act-available').focus();}
 function card(b){
  var ready=C.isReady(b),check=S.batch?'<input type="checkbox" data-av-select="'+esc(b.id)+'" aria-label="批量管理 '+esc(b.name)+'"'+(S.selected[b.id]?' checked':'')+(!ready?' disabled':'')+'>':'';
  return '<article class="row av-card" data-ability="'+esc(b.id)+'"><div class="row-hd"><div class="av-choice">'+check+'<b title="'+esc(b.name)+'">'+esc(b.name)+'</b>'+P.copyNameButton(b)+'</div>'+P.assetTag(b)+(!ready?'<span class="av-card-state">不可用</span>':'')+P.enableSwitch(b,'personal')+'</div><p class="av-desc" id="av-intro-'+esc(b.id)+'">'+esc(b.intro||'暂无介绍')+'</p><div class="av-expand-slot"><button type="button" class="abt-op av-more" data-av-more="'+esc(b.id)+'" aria-controls="av-intro-'+esc(b.id)+'" aria-expanded="false" hidden>展开更多</button></div></article>';
 }
 function measureIntros(){
  if(!$('#available-list')||!$('#available-list').getClientRects().length)return;
  document.querySelectorAll('#available-list .av-card').forEach(function(card){var was=card.classList.contains('is-expanded'),p=card.querySelector('.av-desc'),button=card.querySelector('[data-av-more]');card.classList.remove('is-expanded');var long=p.scrollHeight>p.clientHeight+1;if(was&&long)card.classList.add('is-expanded');button.hidden=!long;button.setAttribute('aria-expanded',String(was&&long));button.textContent=was&&long?'收起':'展开更多';});
 }
 window.addEventListener('resize',measureIntros);
 function paint(){
  document.querySelectorAll('#av-kind-tabs [role=tab]').forEach(function(t){var active=t.dataset.assetKind===S.kind;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;if(active&&$('#available-list'))$('#available-list').setAttribute('aria-labelledby',t.id);});
  var all=C.authorizedAssets(),allowed={};all.forEach(function(b){if(C.isReady(b))allowed[b.id]=true;});Object.keys(S.selected).forEach(function(id){if(!allowed[id])delete S.selected[id];});
  var found=rows(),pages=Math.max(1,Math.ceil(found.length/S.size));S.page=Math.min(S.page,pages);var page=found.slice((S.page-1)*S.size,S.page*S.size),selected=Object.keys(S.selected);
  $('#available-list').innerHTML=page.length?page.map(card).join(''):'<div class="empty">'+(all.length?'没有匹配的资产':'暂无可用资产')+'</div>';
  measureIntros();
  var count=C.capabilityCounts();$('#av-summary').textContent=count.enabled+' / '+count.total;$('#av-total').textContent='共 '+all.length+' 项 · 匹配 '+found.length+' 项'+(S.batch&&selected.length?' · 已选 '+selected.length+' 项':'');
  $('#av-page').textContent=S.page+' / '+pages;$('#av-prev').disabled=S.page<=1;$('#av-next').disabled=S.page>=pages;
  var eligible=page.filter(C.isReady);$('#av-select-page').disabled=!eligible.length;$('#av-select-page').checked=!!eligible.length&&eligible.every(function(b){return S.selected[b.id];});$('#av-select-page').indeterminate=eligible.some(function(b){return S.selected[b.id];})&&!$('#av-select-page').checked;
  $('#av-page-choice').hidden=!S.batch;$('#av-batch-mode').textContent=S.batch?'退出批量管理':'批量管理';
  $('#av-batch-on').hidden=!S.batch||!selected.length;$('#av-batch-off').hidden=!S.batch||!selected.length;$('#av-batch-on').textContent='批量启用（'+selected.length+'）';$('#av-batch-off').textContent='批量停用（'+selected.length+'）';
  $('#av-all-on').disabled=!all.length||all.every(C.isPersonalEnabled);$('#av-all-off').disabled=!all.length||all.every(function(b){return !C.isPersonalEnabled(b);});
 }
 function apply(ids,on){try{C.setPersonalEnabled(ids,on);S.selected={};paint();}catch(e){UIK.toast(e.message,'error');}}
 async function search(){
  if(!S.kw)return;stopSearch();var turn=S.turn;S.ctl=new AbortController();$('#av-search').disabled=true;$('#av-search-state').textContent='查找中…';
  try{if(!window.Gen||!Gen.expandCapabilityQuery)throw new Error('搜索服务未连接');S.terms=await Gen.expandCapabilityQuery(S.kw,{controller:S.ctl});if(turn!==S.turn)return;S.page=1;paint();$('#av-search-state').textContent='';}
  catch(e){if(turn===S.turn)$('#av-search-state').textContent='智能查找暂不可用';}
  finally{if(turn===S.turn){$('#av-search').disabled=false;S.ctl=null;}}
 }
 function create(){
  document.body.insertAdjacentHTML('beforeend','<div class="mask" id="available-mask" hidden><div class="panel av-panel" role="dialog" aria-modal="true" aria-labelledby="available-title"><div class="p-hd"><b id="available-title">可用资产</b><span class="av-summary" id="av-summary"></span><span class="bar-sp"></span><button class="icon-btn" type="button" id="available-close" aria-label="关闭">×</button></div>'+P.assetTabs()+'<div class="av-filter"><label class="field"><input id="available-kw" placeholder="搜索名称，或描述要完成的任务" aria-label="搜索资产或任务"></label><button class="btn primary" id="av-search" type="button">按描述查找</button><label class="field"><select id="av-state" aria-label="个人启用状态"><option value="">全部状态</option><option value="on">已启用</option><option value="off">已停用</option><option value="unavailable">不可用</option></select></label></div><div id="av-search-state" class="av-search-state" role="status"></div><div class="av-batch"><button class="btn ghost" id="av-batch-mode" type="button">批量管理</button><label class="sc-opt" id="av-page-choice" hidden><input id="av-select-page" type="checkbox">全选本页</label><button class="btn ghost" id="av-batch-on" type="button" hidden>批量启用</button><button class="btn ghost" id="av-batch-off" type="button" hidden>批量停用</button><span class="bar-sp"></span><button class="btn ghost" id="av-all-on" type="button">全部启用</button><button class="btn ghost" id="av-all-off" type="button">全部停用</button></div><div class="p-list" id="available-list" role="tabpanel"></div><div class="av-footer"><span id="av-total"></span><span class="bar-sp"></span><button class="abt-op" type="button" id="av-prev">上一页</button><span id="av-page"></span><button class="abt-op" type="button" id="av-next">下一页</button></div></div></div>');
  var m=$('#available-mask');$('#available-close').onclick=close;m.onclick=function(e){if(e.target===m)close();};
  m.onkeydown=function(e){if(e.key==='Escape')close();if(e.key==='Tab'){var f=Array.from(m.querySelectorAll('button,input,select,summary')).filter(function(x){return !x.disabled&&x.getClientRects().length;});if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f[f.length-1].focus();}else if(!e.shiftKey&&document.activeElement===f[f.length-1]){e.preventDefault();f[0].focus();}}};
  $('#available-kw').oninput=function(){stopSearch();S.kw=this.value.trim();S.terms=[];S.page=1;$('#av-search-state').textContent='';paint();};$('#available-kw').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();search();}};$('#av-search').onclick=search;
  $('#av-state').onchange=function(){S.state=this.value;S.page=1;paint();};$('#av-kind-tabs').onclick=function(e){var t=e.target.closest('[data-asset-kind]');if(t){S.kind=t.dataset.assetKind;S.page=1;paint();}};
  $('#av-kind-tabs').onkeydown=function(e){var tabs=Array.from(this.querySelectorAll('[role=tab]')),index=tabs.indexOf(document.activeElement);if(index<0)return;var next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(next>=0){e.preventDefault();tabs[next].click();tabs[next].focus();}};
  $('#av-batch-mode').onclick=function(){S.batch=!S.batch;S.selected={};paint();};
  $('#available-list').onclick=function(e){var t=e.target.closest('[data-av-toggle],[data-av-copy],[data-av-more]');if(!t)return;
   if(t.hasAttribute('data-av-more')){var card=t.closest('.av-card'),expanded=card.classList.toggle('is-expanded');t.textContent=expanded?'收起':'展开更多';t.setAttribute('aria-expanded',String(expanded));return;}
   if(t.dataset.avToggle){try{C.setPersonalEnabled([t.dataset.avToggle],!C.isPersonalEnabled(t.dataset.avToggle));}catch(err){UIK.toast(err.message,'error');}return;}
   var b=C.assetById(t.dataset.avCopy);if(b&&C.isGranted(b))UIK.copy(b.name);
  };
  $('#available-list').onchange=function(e){var id=e.target.dataset.avSelect;if(!id||!S.batch)return;if(e.target.checked)S.selected[id]=true;else delete S.selected[id];paint();};
  $('#av-select-page').onchange=function(){var checked=this.checked;rows().slice((S.page-1)*S.size,S.page*S.size).filter(C.isReady).forEach(function(b){if(checked)S.selected[b.id]=true;else delete S.selected[b.id];});paint();};
  $('#av-prev').onclick=function(){S.page--;paint();};$('#av-next').onclick=function(){S.page++;paint();};$('#av-batch-on').onclick=function(){apply(Object.keys(S.selected),true);};$('#av-batch-off').onclick=function(){apply(Object.keys(S.selected),false);};
  function all(on){var ids=C.authorizedAssets().map(function(b){return b.id;});Confirm.ask({title:on?'全部启用？':'全部停用？',body:'共 '+ids.length+' 项资产',ok:on?'全部启用':'全部停用',onOk:function(){apply(ids,on);}});}
  $('#av-all-on').onclick=function(){all(true);};$('#av-all-off').onclick=function(){all(false);};
 }
 window.openAvailableAbilities=function(){if(!$('#available-mask'))create();stopSearch();S.kw='';S.terms=[];S.state='';S.kind='';S.page=1;S.batch=false;S.selected={};$('#available-kw').value='';$('#av-state').value='';$('#av-search-state').textContent='';var m=$('#available-mask');m.hidden=false;m.dataset.open='true';paint();$('#available-kw').focus();};
 window.CapabilityCatalog={refresh:function(){if($('#available-mask')&&!$('#available-mask').hidden)paint();}};
})();
