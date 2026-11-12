/* 能力详情的编辑会话。顶栏保存前，能力和接口均只保存在当前页面。 */
(function () {
  'use strict';

  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  window.AbilityDraft = {
    create: function (C, existing) {
      var actor = C.actor();
      var original = existing ? copy(existing) : {
        id: 'new', kind: 'api', name: '', intro: '', apiIds: [], files: [], doc: '',
        docState: 'none', on: true, ownerId: actor.id, ownerName: actor.name,
        useScope: {mode: 'self', roles: [], depts: [], users: []}
      };
      var record = copy(original);
      var originals = Object.create(null);
      var edits = Object.create(null);
      var sequence = 0;

      original.apiIds.forEach(function (id) {
        var api = C.apiById(id);
        if (api) originals[id] = copy(api);
      });

      function apiById(id) {
        return edits[id] ? edits[id].after : originals[id] || C.apiById(id);
      }

      function endpointOf(api) { return C.endpoint(api, record.project || api.project); }

      function hasEndpoint(api, exceptId) {
        var key = endpointOf(api).key;
        return record.apiIds.some(function (id) {
          var other = apiById(id);
          return id !== exceptId && other && endpointOf(other).key === key;
        });
      }

      function updateApi(id, values) {
        var before = apiById(id);
        if (!before) throw new Error('接口不存在');
        var after = Object.assign({}, before, values);
        var endpoint = endpointOf(after);
        if (hasEndpoint(after, id)) throw new Error('这个能力已有相同地址、方法和路径的接口');
        Object.assign(after, { host: endpoint.host, path: endpoint.path, method: endpoint.method });
        edits[id] = { before: originals[id] || null, after: after };
      }

      return {
        record: function () { return record; },
        update: function (patch) { Object.assign(record, copy(patch)); return record; },
        apiById: apiById,
        hasEndpoint: hasEndpoint,
        updateApi: updateApi,
        addApi: function (api) {
          if (hasEndpoint(api)) return false;
          var id = 'draft-api-' + (++sequence);
          var endpoint = endpointOf(api);
          edits[id] = { before: null, after: Object.assign({}, api, {
            id: id, host: endpoint.host, path: endpoint.path, method: endpoint.method
          }) };
          record.apiIds.push(id);
          return true;
        },
        apis: function () {
          return record.apiIds.map(function (id) {
            var api = apiById(id);
            return { id: id, api: api || null, missing: !api };
          });
        },
        commit: function (patch) {
          return C.commitAbilityEdit(existing ? original.id : null, original.revision,
            Object.assign({}, record, patch), edits);
        }
      };
    }
  };
})();
