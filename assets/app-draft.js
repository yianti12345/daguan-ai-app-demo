/* 共用草稿会话：保存、恢复基线、重置；不创建或激活正式版本。 */
(function(){
 'use strict';
 function clone(v){return JSON.parse(JSON.stringify(v));}
 window.AppDraft={read:function(storage,key,valid){try{var raw=storage.getItem(key),d=raw?JSON.parse(raw):null;return d&&typeof d==='object'&&(!valid||valid(d))?d:null;}catch(e){return null;}},create:function(opt){
  var baseline=clone(opt.snapshot());
  return {
   isDirty:function(){return JSON.stringify(opt.snapshot())!==JSON.stringify(baseline);},
   savedSnapshot:function(){return clone(baseline);},
   markSaved:function(){baseline=clone(opt.snapshot());},
   clear:function(){opt.storage.removeItem(opt.key);baseline=clone(opt.snapshot());},
   save:function(){var current=clone(opt.snapshot()),saved=Object.assign({},current,{at:opt.now()});opt.storage.setItem(opt.key,JSON.stringify(saved));baseline=current;return saved;},
   reset:function(target){
    var before=clone(opt.snapshot()),previous=clone(baseline);
    try{opt.restore(clone(target));if(opt.persist&&opt.persist()===false)throw new Error('重置未能保存');opt.storage.removeItem(opt.key);baseline=clone(opt.snapshot());}
    catch(e){try{opt.restore(before);if(opt.persist)opt.persist();}catch(ignored){}baseline=previous;throw e;}
   }
  };
 }};
})();
