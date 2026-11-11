/* 新建能力的页面草稿：进入页面不创建资产；保存时复用现有能力仓储。 */
(function(){
 'use strict';
 function copy(v){return JSON.parse(JSON.stringify(v));}
 window.AbilityDraft={create:function(C){
  var actor=C.actor(),b={id:'new',kind:'api',name:'',intro:'',apiIds:[],files:[],doc:'',docState:'none',on:true,ownerId:actor.id,ownerName:actor.name,useScope:{mode:'self',roles:[],depts:[],users:[]}};
  return {record:function(){return b;},update:function(p){Object.assign(b,copy(p));return b;},apis:function(){return b.apiIds.map(C.apiById).filter(Boolean);},commit:function(p){
   var data=Object.assign({},copy(b),copy(p));delete data.id;
   if(!String(data.name||'').trim())throw new Error('填能力名称');
   if(!data.apiIds.length)throw new Error('先加接口');
   return C.addAbility(data);
  }};
 }};
})();
