/* ui-kit —— 跨页共用的两件小件：轻提示（toast）与「批量选人」HTML。
   ─ 为什么单独一件、不放进 data.js ───────────────────────────────
   data.js 是数据层（window.DB：种子、版本台账、状态折叠），
   把"长什么样"的 HTML 片段和 DOM 提示塞进去，会让"数据从哪来"和"屏上怎么长"混成一层。
   这一件只依赖 DOM（#toast）和调用方传进来的名字数组，五个页面都在自己的页面脚本之前引一次。
   ─ 合并了什么（2026-10-28 E44）────────────────────────────────
   ① pickHtml：app.js 与 component.js 里两份 494 字符逐字相同的实现，只留这一份；
      两个调用方各自算"谁在候选里"，本函数只负责长什么样。
   ② toast：apps.html / components.html / versions.js / component.js 四份已分叉的实现，
      行为统一为：2.5 秒自动收 · 新消息直接替换旧的 · 错误态 role="alert" + assertive。
      页面里只留一区别名（var toast = UIK.toast），不再各写一份。               */
window.UIK = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  var timer = 0;
  function toast(msg, kind) {
    var box = document.getElementById('toast');
    if (!box) return false;                 /* 没有 #toast 的页（app.html 用 #hint）静默跳过 */
    var err = kind === 'error';
    box.textContent = msg;
    box.setAttribute('data-kind', err ? 'error' : (kind || 'ok'));
    box.setAttribute('data-on', 'true');
    box.setAttribute('role', err ? 'alert' : 'status');
    box.setAttribute('aria-live', err ? 'assertive' : 'polite');
    clearTimeout(timer);
    timer = setTimeout(function () { box.setAttribute('data-on', 'false'); }, 2500);
    return true;
  }

  function pickHtml(names) {
    var rows = (names || []).map(function (nm) {
      return '<label class="tb-pick-row">'
        + '<input type="radio" name="tb-assignee" value="' + esc(nm) + '">'
        + '<span>' + esc(nm) + '</span></label>';
    }).join('');
    return '<div class="tb-pick" id="tb-pick">'
      + '<div class="tb-pick-list" role="group" aria-label="选择处理人">' + rows + '</div>'
      + '<button type="button" class="tb-pick-ok" id="tb-ok" disabled>确定</button>'
      + '</div>';
  }

  /* 复制到剪贴板：先试异步 API，失败再退回 textarea + execCommand。
     内网 http 不是安全上下文，navigator.clipboard 常常不可用，第二条是主路径而非兜底摆设。 */
  function copy(text) {
    var v = String(text == null ? '' : text);
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = v;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(v).then(function () { return true; }, fallback);
    }
    return Promise.resolve(fallback());
  }

  /* ── 只读状态胶囊（2026-10-28）────────────────────────────────
     同一枚胶囊在两处出现：应用卡左上「{N} 个组件有更新」、装配面板行内「有更新」。
     两处各拼一段 HTML 就会出现两套 class 与两套文案；这里只出这一份。
       variant  : 'count'（带数字，等宽数字）｜'warn'（短语，默认「有更新」）
       size     : 'md'（默认，= --chip-h，卡片角标）｜'sm'（行内紧凑）
       count    : variant='count' 时必填；≤0 ⇒ 返回空串（N=0 不渲染节点，不是 hidden）
       text     : variant='warn' 时的短语
       className: 使用方的定位钩子（卡片上的 kc-upd），长什么样仍写在 sys.css 的 .chip
     为什么 aria-hidden：它是锚点可读名的一部分，读屏靠锚点的 aria-label 获知这条状态；
     徽标自己再念一遍就是重复播报，而且它不可聚焦（不制造"看得见、停不上"的假焦点）。
     文案逐字（规格 §2.3）：`{N} 个组件有更新`，不列名、不补零、不加「约」、不写「等」。 */
  var UPD_TEXT = ' 个组件有更新';
  function badgeLabel(n) { return String(parseInt(n, 10) || 0) + UPD_TEXT; }
  function cardBadge(opt) {
    opt = opt || {};
    var kind = opt.variant === 'warn' ? 'warn' : 'count';
    var n = parseInt(opt.count, 10) || 0;
    if (kind === 'count' && n <= 0) return '';
    var label = kind === 'count' ? badgeLabel(n) : String(opt.text || '有更新');
    if (!label) return '';
    var cls = 'chip chip-' + kind
      + (opt.size === 'sm' ? ' chip-sm' : '')
      + (opt.className ? ' ' + opt.className : '');
    return '<span class="' + cls + '" aria-hidden="true">' + esc(label) + '</span>';
  }

  /* ── 禁用态：全站唯一入口（DESIGN §8.5 / §12.1；2026-10-29 四违约收口）────────
     一个类 `.is-disabled` + 一个属性 `aria-disabled="true"`，视觉配方只在 sys.css 末尾定义一次。
     原生 disabled 只是**机制**（阻止点击 / 表单提交），不是第二套表达；只对表单控件加。
     reason 必填：写进 title 与 aria-label —— 用户要能回答"为什么不能点、怎么才能点"。
     取消时把临时 title/aria-label 还原成原值（不抹掉调用方自己的标签）。 */
  function setDisabled(el, on, reason) {
    if (!el) return;
    el.classList.toggle('is-disabled', !!on);
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.toggleAttribute('disabled', !!on);
    if (on) {
      el.setAttribute('aria-disabled', 'true');
      if (reason) {
        if (el.dataset.disTitle == null) el.dataset.disTitle = el.getAttribute('title') || '';
        if (el.dataset.disAria == null) el.dataset.disAria = el.getAttribute('aria-label') || '';
        el.setAttribute('title', reason);
        el.setAttribute('aria-label', reason);
      }
    } else {
      el.removeAttribute('aria-disabled');
      if (el.dataset.disTitle != null) {
        if (el.dataset.disTitle) el.setAttribute('title', el.dataset.disTitle); else el.removeAttribute('title');
        delete el.dataset.disTitle;
      }
      if (el.dataset.disAria != null) {
        if (el.dataset.disAria) el.setAttribute('aria-label', el.dataset.disAria); else el.removeAttribute('aria-label');
        delete el.dataset.disAria;
      }
    }
  }

  /* ── 对话历史（小智 / 装配对话框共用，2026-11-02）────────────────
     两处对话面各有一套消息数据，但"历史"这件事必须长得一样、叫法一样：
     同一个时钟图标、同样的一条一个名字、同样点进去看只读详情。
     这里只出**结构**，消息正文由调用方传进来（小智有步骤/授权卡，装配对话框有版本卡）。
     动作名固定为 histOpen / histBack / histNew / histToggle，
     由各自的容器代理处理；两边都监听 document 时，靠 closest 限定作用域。 */
  var hist = {
    icon: function (size) {
      var s = size || 15;
      return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
        + 'aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/>'
        + '<path d="M12 7v5l3.5 2"/></svg>';
    },
    title: function (msgs) {
      var list = msgs || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].who === 'me') {
          var t = String(list[i].text || '').replace(/\s+/g, ' ').trim();
          if (t) return t.length > 26 ? t.slice(0, 26) + '…' : t;
        }
      }
      return '新对话';
    },
    fmtAt: function (ts) {
      var d = new Date(Number(ts) || 0);
      if (!isFinite(d.getTime()) || !d.getTime()) return '';
      var now = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
      var sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      if (sameDay) return '今天 ' + hm;
      var y = new Date(now.getTime() - 86400000);
      if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) {
        return '昨天 ' + hm;
      }
      if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    count: function (msgs) {
      return (msgs || []).filter(function (m) { return m && m.who === 'me'; }).length;
    },
    listHtml: function (convs, curId) {
      var list = convs || [];
      var rows = list.map(function (c) {
        var isCur = c.id === curId;
        var meta = hist.fmtAt(c.at) + (hist.count(c.msgs) ? ' · ' + hist.count(c.msgs) + ' 条' : '') + (isCur ? ' · 当前' : '');
        return '<button type="button" class="hist-item' + (isCur ? ' is-cur' : '') + '"'
          + ' data-act="histOpen" data-arg="' + esc(c.id) + '"'
          + ' aria-label="' + esc(hist.title(c.msgs) + '，' + meta) + '">'
          + '<span class="hist-name">' + esc(hist.title(c.msgs)) + '</span>'
          + '<span class="hist-meta">' + esc(meta) + '</span></button>';
      }).join('');
      if (!rows) rows = '<p class="hist-empty">还没有对话。说一句要做什么，这里会一条条记下来。</p>';
      return '<div class="hist-pane" role="region" aria-label="对话历史">'
        + '<div class="hist-bar"><span class="hist-count">' + list.length + ' 个对话</span>'
        + '<button type="button" class="hist-new" data-act="histNew">新对话</button></div>'
        + '<div class="hist-list">' + rows + '</div></div>';
    },
    detailHtml: function (conv, threadHtml) {
      var n = hist.count(conv.msgs);
      return '<div class="hist-detail" role="region" aria-label="对话详情">'
        + '<button type="button" class="hist-back" data-act="histBack">'
        + '<span aria-hidden="true">←</span> 返回</button>'
        + '<p class="hist-dt">' + esc(hist.title(conv.msgs)) + '</p>'
        + '<p class="hist-dm">' + esc(hist.fmtAt(conv.at) + (n ? ' · ' + n + ' 条' : '')) + '</p>'
        + '<div class="hist-thread">' + (threadHtml || '') + '</div></div>';
    }
  };

  return { toast: toast, pickHtml: pickHtml, copy: copy, esc: esc,
           cardBadge: cardBadge, badgeLabel: badgeLabel, setDisabled: setDisabled, hist: hist };
})();
