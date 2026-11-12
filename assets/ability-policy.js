/* Capability V1: one policy for maintenance, discovery and generation.
   This static demo uses the existing local editor identity; production must enforce it server-side. */
(function () {
  'use strict';
  var C = window.CAP;
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function actor() {
    var a;
    try { a = JSON.parse(sessionStorage.getItem('ifas90:actor') || 'null'); } catch (_) {}
    if (a && a.id) return { id: String(a.id), name: a.name || a.id, roles: a.roles || [], depts: a.depts || [], admin: a.admin === true };
    var id = localStorage.getItem('ifas90:editor') || 'zheng';
    return { id: id, name: id, roles: id === 'zheng' || id === 'admin' ? ['系统管理员'] : [], depts: [], admin: id === 'zheng' || id === 'admin' };
  }
  function scope(v) {
    v = v || {};
    return { mode: ['self','public','custom'].indexOf(v.mode) >= 0 ? v.mode : 'self', roles: Array.isArray(v.roles) ? v.roles.slice() : [], depts: Array.isArray(v.depts) ? v.depts.slice() : [], users: Array.isArray(v.users) ? v.users.slice() : [] };
  }
  function normalize(b) {
    b.kind = b.kind === 'skill' ? 'skill' : 'api';
    b.ownerId = b.ownerId || 'zheng'; b.ownerName = b.ownerName || 'zheng';
    b.useScope = scope(b.useScope); b.files = b.files || []; b.revision = b.revision || 1;
    b.on = b.on !== false;
    return b;
  }
  function canManage(b) { var a = actor(); return !!b && (a.admin || b.ownerId === a.id); }
  function granted(b) {
    if (!b) return false;
    var a = actor(), s = scope(b.useScope);
    if (b.ownerId === a.id || a.admin) return true;
    if (s.mode === 'public') return true;
    if (s.mode !== 'custom') return false;
    return s.users.indexOf(a.id) >= 0 || s.users.indexOf(a.name) >= 0 || s.roles.some(function (r) { return a.roles.indexOf(r) >= 0; }) || s.depts.some(function (d) { return a.depts.indexOf(d) >= 0; });
  }
  function ready(b) {
    return !!(b && b.on !== false && b.docState !== 'none' && String(b.name || '').trim() && String(b.doc || '').trim() && (b.kind === 'skill' || ((b.apiIds || []).length && (b.apiIds || []).every(function (id) { var a = C.apiById(id); return a && a.on !== false; }))));
  }
  function available() { return C.abilities().filter(function (b) { return granted(b) && ready(b); }); }
  function assertManage(b) { if (!canManage(b)) throw new Error('只有创建人和管理员可以调整这个能力'); }
  var add = C.addAbility, update = C.updateAbility, remove = C.removeAbility, originalImport = C.importAbilities;
  C.abilities().forEach(normalize);
  // Preserve old standalone skills as unified skills, once; never repopulate deleted items.
  var d = C.load();
  if (!d.unifiedSkillsV1) {
    (d.skills || []).forEach(function (s) {
      if (!d.abilities.some(function (b) { return b.id === s.id; })) d.abilities.push(normalize({ id:s.id, kind:'skill', name:s.name, intro:s.desc || '', doc:s.content || ((s.files||[]).filter(function(f){return f.name==='SKILL.md';})[0]||{}).code || '# '+s.name+'\n\n'+(s.desc || ''), apiIds:[], files:(s.files||[]).filter(function(f){return f.name!=='SKILL.md';}).map(function(f){return {name:f.name,encoding:f.encoding||'utf8',mime:f.mime||'text/plain',content:f.content||f.code||''};}), docState:'ready', on:s.on !== false, useScope:{mode:s.scope === '全平台' ? 'public' : 'self'}, at:s.at }));
    });
    d.unifiedSkillsV1 = true;
  }
  C.save();
  C.addAbility = function (v) {
    var a = actor();
    v=Object.assign({},v);if(v.doc && v.docState===undefined)v.docState='ready';
    var list=C.load().abilities, count=list.length;
    try{return add(normalize(Object.assign({}, v, { ownerId:a.id, ownerName:a.name, useScope:scope(v && v.useScope) })));}catch(e){list.splice(count);throw e;}
  };
  C.updateAbility = function (id, patch) {
    var b = C.abilityById(id); assertManage(b);
    if ('kind' in patch && patch.kind !== b.kind) throw new Error('能力类型创建后不能切换');
    if ('ownerId' in patch || 'ownerName' in patch) throw new Error('不能转移能力创建人');
    if ('useScope' in patch) patch.useScope = scope(patch.useScope);
    if(patch.doc && patch.docState===undefined)patch.docState='ready';
    var prev=copy(b),out;
    try{out=update(id, Object.assign({}, patch, { revision:(b.revision || 1)+1 }));}catch(e){Object.keys(b).forEach(function(k){delete b[k];});Object.assign(b,prev);throw e;}
    window.dispatchEvent(new Event('capabilities-changed')); return out;
  };
  C.removeAbility = function (id) { assertManage(C.abilityById(id)); var r=remove(id); window.dispatchEvent(new Event('capabilities-changed')); return r; };
  C.commitAbilityEdit = function (id, revision, patch, edits) {
    var user = actor();
    var data = copy(patch);
    var name = String(data.name || '').trim();
    if (!name) throw new Error('填能力名称');
    if (!data.apiIds.length) throw new Error('先加接口');
    C.validateFiles(data.files || []);
    var saved = C.commitChanges(function (store) {
      var current = id && store.abilities.find(function (item) { return item.id === id; });
      if (id) {
        assertManage(current);
        if (current.kind !== 'api') throw new Error('该历史能力类型本版仅可查看');
        if (current.revision !== revision) throw new Error('能力已在其他页面修改，请重新打开后再编辑');
      }
      var record = current || {id:C.newId('ab'), ownerId:user.id, ownerName:user.name, kind:'api', on:true};
      var replacements = Object.create(null);
      data.apiIds = data.apiIds.map(function (apiId) {
        var edit = edits[apiId];
        var existing = store.apis.find(function (item) { return item.id === apiId; });
        if (!edit) return apiId;
        if (edit.before && JSON.stringify(existing) !== JSON.stringify(edit.before)) {
          throw new Error('接口已在其他页面修改，请重新打开后再编辑');
        }
        var shared = store.abilities.some(function (item) {
          return item.id !== id && (item.apiIds || []).includes(apiId);
        });
        var api = Object.assign({}, edit.after, {
          id: existing && !shared ? apiId : C.newId('api'),
          at: C.now()
        });
        replacements[apiId] = api.id;
        if (existing && !shared) Object.assign(existing, api);
        else store.apis.unshift(api);
        return api.id;
      });
      if (data.docApis) data.docApis = data.docApis.split(',').map(function (part) {
        var apiId = part.split('|')[0];
        return (replacements[apiId] || apiId) + part.slice(apiId.length);
      }).join(',');
      Object.assign(record, data, {
        id:record.id, kind:'api', name:name, ownerId:record.ownerId, ownerName:record.ownerName,
        useScope:scope(data.useScope), at:C.now(), revision:current ? (revision || 1) + 1 : 1
      });
      if (!current) store.abilities.push(record);
      return record;
    });
    window.dispatchEvent(new Event('capabilities-changed'));
    return saved;
  };
  function importOptions(items, opt) {
    if (!Array.isArray(items) || !items.length) throw new Error('能力文件格式不正确');
    items.forEach(function (item, index) {
      var label = '第 ' + (index + 1) + ' 条能力';
      if (!item || !String(item.name || '').trim() || !['api', 'skill', undefined].includes(item.kind)) {
        throw new Error(label + '格式不正确');
      }
      if (item.kind !== 'skill' && (!Array.isArray(item.apis) || !item.apis.length ||
          item.apis.some(function (api) { return !api || typeof api.path !== 'string' || !api.path.trim(); }))) {
        throw new Error(label + '「' + item.name + '」缺少有效接口');
      }
      C.validateFiles(item.files || []);
    });
    return Object.assign({mode:'merge'}, opt, {owner:actor(), canMerge:canManage});
  }
  C.previewAbilityImport = function (items) {
    return originalImport(items, importOptions(items, {mode:'new', preview:true}));
  };
  C.importAbilities = function (items, opt) {
    var result = originalImport(items, importOptions(items, opt));
    window.dispatchEvent(new Event('capabilities-changed'));
    return result;
  };
  C.validateFiles = function (files) {
    var names={}, total=0;
    files.forEach(function (f) {
      if (!f || typeof f.name !== 'string' || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(f.name) || names[f.name] || typeof f.content !== 'string') throw new Error('文件路径重复或格式不正确');
      names[f.name]=true; total += new Blob([f.content]).size;
    });
    if (total > 1024*1024) throw new Error('技能附件合计不能超过 1 MB');
  };
  C.actor=actor; C.canManage=canManage; C.isGranted=granted; C.isReady=ready; C.availableAbilities=available;
  C.authorizedAbilities=function(){return C.abilities().filter(function(b){return granted(b)&&String(b.name||'').trim();});};
  C.unavailableReason=function(b){if(b.on===false)return '创建人或管理员已停用';if(!String(b.doc||'').trim()||b.docState==='none')return '待完善使用说明';if(b.kind==='api'&&!(b.apiIds||[]).length)return '未配置接口';return !ready(b)?'关联接口不可用':'';};
  C.capabilityCounts=function(){var all=C.authorizedAbilities();return {total:all.length,enabled:all.filter(function(b){return ready(b)&&C.isPersonalEnabled(b);}).length,unavailable:all.filter(function(b){return !ready(b);}).length};};
  C.visibleAbilities=function () { return C.abilities().filter(function (b) { return granted(b) || canManage(b); }); };
  C.scopeLabel=function (b) { var s=scope(b.useScope); return s.mode==='public' ? '公开' : s.mode==='self' ? '仅自己' : [].concat(s.roles,s.depts,s.users).join('、') || '仅自己'; };
  function prefs(){try{return JSON.parse(localStorage.getItem('ifas90:cap-prefs:'+actor().id)||'{}');}catch(_){return {};}}
  C.isPersonalEnabled=function(b){return prefs()[typeof b==='string'?b:b.id]!==false;};
  C.setPersonalEnabled=function(ids,on){
    var p=prefs();
    (ids||[]).forEach(function(id){var b=C.abilityById(id);if(!granted(b))throw new Error('能力授权已变更，请重新查看清单');if(on)delete p[id];else p[id]=false;});
    localStorage.setItem('ifas90:cap-prefs:'+actor().id,JSON.stringify(p));window.dispatchEvent(new Event('capabilities-changed'));
  };
  C.catalog=function () { return available().filter(C.isPersonalEnabled).map(function (b) { return {id:b.id,name:b.name,kind:b.kind,description:b.intro || ''}; }); };
  // Generic retrieval shared by the user catalog and model discovery; no fixed business categories.
  C.searchAuthorizedAbilities=function(text,expanded){
    var q=String(text||'').toLowerCase().trim(),terms=[],stop=['能力','一个','需要','想要','帮我','可以','使用','哪些','哪个'];
    [q].concat((expanded||[]).slice(0,8)).forEach(function(raw){var words=String(raw).toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]+/g)||[];words.forEach(function(w){if(/[\u3400-\u9fff]/.test(w)){if(w.length===1)terms.push(w);for(var i=0;i<w.length-1;i++)terms.push(w.slice(i,i+2));}else terms.push(w);});});
    terms=terms.filter(function(t,i,a){return stop.indexOf(t)<0&&a.indexOf(t)===i;});
    return C.authorizedAbilities().map(function(b){var n=b.name.toLowerCase(),intro=(b.intro||'').toLowerCase(),outline=((b.doc||'').match(/^#{1,3} .+$/gm)||[]).join(' ').toLowerCase(),score=q&&q.indexOf(n)>=0?1000:0;
      if(q&&n.indexOf(q)>=0)score+=100;if(q&&intro.indexOf(q)>=0)score+=30;
      terms.forEach(function(t){if(n.indexOf(t)>=0)score+=5;else if(intro.indexOf(t)>=0)score+=2;else if(outline.indexOf(t)>=0)score+=1;});return {b:b,score:score};
    }).filter(function(x){return !q||x.score>0;}).sort(function(a,b){return q?(b.score-a.score||a.b.id.localeCompare(b.b.id)):String(b.b.at||'').localeCompare(String(a.b.at||''));}).map(function(x){return x.b;});
  };
  C.discoverCandidates=function(text,limit,expanded){return C.searchAuthorizedAbilities(text,expanded).filter(function(b){return ready(b)&&C.isPersonalEnabled(b);}).slice(0,Math.min(limit||20,30)).map(function(b){return {id:b.id,name:b.name,kind:b.kind,description:b.intro||''};});};
  C.contextFor=function (ids) {
    var combined=(ids || []).map(function (id) {
      var b=C.abilityById(id);
      if (!granted(b) || !ready(b) || !C.isPersonalEnabled(b)) throw new Error('能力授权或启用状态已变更，请重新生成');
      var text='## '+b.name+' ['+b.id+'@'+b.revision+']\n'+b.doc;
      if (b.kind==='skill') (b.files || []).forEach(function (f) { text+='\n### 附件 '+f.name+'\n'+(f.encoding==='base64' ? '二进制附件：'+f.mime+'，不能假装已读取或执行' : f.content); });
      if (text.length>60000) throw new Error('技能内容过长，请拆分参考文件后再使用');
      return text;
    }).join('\n\n');
    if(combined.length>90000)throw new Error('选用的能力内容过多，请缩小本次任务范围');
    return combined;
  };
})();
