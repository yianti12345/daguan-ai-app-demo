/* scope.js —— 可用范围 / 可配置范围（2026-11-03 用户 m03263 点名加）
 *
 * 为什么单独一件：应用与组件、新建与编辑，四个弹窗都要同一套「谁可见 / 谁能改」，
 * 各写一遍就会出现四种口径、四种文案。这里只定义一次，四个入口调用它。
 *
 * 口径（与真源同一句）：角色、部门、用户为并集，满足其一即可；默认创建者可用。
 * 指定用户组已按用户要求改成「指定部门」——组织架构里部门比用户组稳定，
 * 用户调岗时不用回来改授权。
 */
(function () {
  'use strict';

  /* 演示目录：接组织架构后替换这里即可，页面与存储格式不用动。
     存名称不存 id —— 这是原型，换真实目录时只需把数组换成接口返回值。 */
  var DIR = {
    roles: ['系统管理员', '应用管理员', '配置员', '审核员', '查看者'],
    depts: ['风险管理部', '合规部', '业务部', '信息技术部', '运营管理部'],
    users: ['张伟', '李娜', '王强', '陈静', '刘洋']
  };
  var FIELD_LABEL = { roles: '角色', depts: '部门', users: '用户' };
  var UID = 0;
  var MENU = null;
  var ACTIVE = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v.slice() : []; }
  function norm(v) {
    v = v || {};
    var mode = v.mode === 'public' || v.mode === 'custom' ? v.mode : 'self';
    return { mode: mode, roles: arr(v.roles), depts: arr(v.depts), users: arr(v.users) };
  }
  function closeMenu() {
    if (MENU && MENU.parentNode) MENU.parentNode.removeChild(MENU);
    if (ACTIVE && ACTIVE.btn) ACTIVE.btn.setAttribute('aria-expanded', 'false');
    MENU = null;
    ACTIVE = null;
  }
  document.addEventListener('mousedown', function (e) {
    if (!MENU) return;
    if (MENU.contains(e.target)) return;
    if (ACTIVE && ACTIVE.btn && ACTIVE.btn.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && MENU) { e.stopPropagation(); closeMenu(); }
  });
  window.addEventListener('scroll', function () { if (MENU) closeMenu(); }, true);
  window.addEventListener('resize', function () { if (MENU) closeMenu(); });

  function pickLabel(values, field) {
    if (!values.length) return '请选择' + FIELD_LABEL[field] + '，支持多选';
    if (values.length <= 2) return values.join('、');
    return values.slice(0, 2).join('、') + ' 等 ' + values.length + ' 项';
  }

  function Scope(host, opt) {
    opt = opt || {};
    var self = this;
    var kind = opt.kind === 'cfg' ? 'cfg' : 'vis';
    var id = 'sc' + (++UID);
    /* ★2026-11-03（用户 m03707）：两段统一成三档「仅自己 / 公开 / 指定」，
       字段名用真源里的「可用范围」；问号和必填星号都去掉 —— 默认已选中，
       再标必填是假精度，问号更是纯占位。 */
    var title = kind === 'vis' ? '可用范围' : '可配置范围';
    var hint = kind === 'vis'
      ? '角色、部门、用户满足其一即可用；都不选时，仅自己可用。'
      : '角色、部门、用户满足其一即可修改配置；都不选时，仅自己可改。';
    this.kind = kind;
    this.host = host;
    this.value = norm(opt.value);
    this.id = id;

    var modes = [['self', '仅自己'], ['public', '公开'], ['custom', '指定']];
    var modeHtml = modes.map(function (m) {
      return '<label class="sc-opt"><input type="radio" name="' + id + '-mode" value="' + m[0] + '">' + m[1] + '</label>';
    }).join('');
    var fields = ['roles', 'depts', 'users'].map(function (f) {
      return '<div class="sc-field">' +
        '<span class="sc-fl">指定' + FIELD_LABEL[f] + '</span>' +
        '<button class="sc-pick" type="button" data-f="' + f + '" aria-haspopup="listbox" aria-expanded="false">' +
        pickLabel(self.value[f], f) + '</button>' +
        '</div>';
    }).join('');

    host.innerHTML =
      '<div class="sc" data-kind="' + kind + '">' +
        '<div class="sc-top">' +
          '<span class="sc-title">' + title + '</span>' +
          '<div class="sc-opts" role="radiogroup" aria-label="' + title + '">' + modeHtml + '</div>' +
        '</div>' +
        '<div class="sc-body" hidden>' + fields + '<p class="sc-hint">' + hint + '</p></div>' +
      '</div>';

    this.el = host.querySelector('.sc');
    this.body = host.querySelector('.sc-body');
    this.opts = host.querySelector('.sc-opts');
    this.radios = [].slice.call(host.querySelectorAll('input[type="radio"]'));
    this.picks = [].slice.call(host.querySelectorAll('.sc-pick'));

    this.radios.forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        self.value.mode = r.value;
        self.paintBody();
        /* ★2026-11-03 m03795：弹窗固定高度后，选「指定」会展开三行；
           不把这一段滚进视野，用户只看到标题被底栏切住，以为坏了。 */
        if (r.value === 'custom') {
          /* 直接把这一组的底边顶进滚动区，而不是 scrollIntoView：
             后者只要顶部露着就判定「已可见」，展开出来的三行仍藏在底栏下面。
             延后 30ms：radio 的焦点滚动在事件结束后才发生，同步设的 scrollTop 会被拉回 0。 */
          setTimeout(function () {
            var bd = self.el.closest('.nf-bd');
            if (!bd) return;
            var over = self.el.getBoundingClientRect().bottom - bd.getBoundingClientRect().bottom + 12;
            if (over > 0) bd.scrollTop += over;
          }, 30);
        }
        closeMenu();
      });
    });
    this.picks.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (MENU && ACTIVE && ACTIVE.btn === b) { closeMenu(); return; }
        self.openMenu(b);
      });
    });
    this.paint();
  }
  Scope.prototype.paintBody = function () {
    this.body.hidden = this.value.mode !== 'custom';
  };
  Scope.prototype.paintPicks = function () {
    var v = this.value;
    this.picks.forEach(function (b) {
      var f = b.getAttribute('data-f');
      var list = v[f] || [];
      b.textContent = pickLabel(list, f);
      b.setAttribute('data-empty', list.length ? '0' : '1');
      b.title = list.length ? list.join('、') : '请选择' + FIELD_LABEL[f] + '，支持多选';
    });
  };
  Scope.prototype.paint = function () {
    var self = this;
    var found = false;
    this.radios.forEach(function (r) {
      r.checked = r.value === self.value.mode;
      if (r.checked) found = true;
    });
    if (!found) {
      this.value.mode = 'self';
      this.radios[0].checked = true;
    }
    this.paintBody();
    this.paintPicks();
  };
  Scope.prototype.get = function () { return norm(this.value); };
  Scope.prototype.set = function (v) {
    this.value = norm(v);
    this.paint();
  };
  Scope.prototype.close = closeMenu;

  Scope.prototype.openMenu = function (btn) {
    var self = this;
    var field = btn.getAttribute('data-f');
    closeMenu();
    ACTIVE = { btn: btn, scope: this, field: field };
    btn.setAttribute('aria-expanded', 'true');

    var menu = document.createElement('div');
    menu.className = 'sc-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '选择' + FIELD_LABEL[field]);
    menu.innerHTML =
      '<input class="sc-search" type="search" placeholder="搜索' + FIELD_LABEL[field] + '" aria-label="搜索' + FIELD_LABEL[field] + '">' +
      '<div class="sc-list" role="listbox" aria-multiselectable="true"></div>';
    document.body.appendChild(menu);
    MENU = menu;

    function renderList(q) {
      q = String(q || '').trim().toLowerCase();
      var list = (DIR[field] || []).filter(function (x) {
        return !q || x.toLowerCase().indexOf(q) >= 0;
      });
      var box = menu.querySelector('.sc-list');
      if (!list.length) {
        box.innerHTML = '<p class="sc-empty">没有匹配的' + FIELD_LABEL[field] + '</p>';
        return;
      }
      box.innerHTML = list.map(function (x) {
        var on = self.value[field].indexOf(x) >= 0;
        return '<label class="sc-item"><input type="checkbox" value="' + esc(x) + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(x) + '</span></label>';
      }).join('');
    }
    renderList('');

    var r = btn.getBoundingClientRect();
    menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))) + 'px';
    menu.style.width = Math.round(r.width) + 'px';
    var h = menu.offsetHeight;
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 6 - h);
    menu.style.top = Math.round(top) + 'px';

    var search = menu.querySelector('.sc-search');
    search.addEventListener('input', function () { renderList(search.value); });
    menu.querySelector('.sc-list').addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      var v = cb.value;
      var idx = self.value[field].indexOf(v);
      if (cb.checked && idx < 0) self.value[field].push(v);
      if (!cb.checked && idx >= 0) self.value[field].splice(idx, 1);
      self.paintPicks();
    });
    search.focus();
  };

  window.Scope = {
    render: function (host, opt) { return host ? new Scope(host, opt) : null; },
    close: closeMenu
  };
})();
