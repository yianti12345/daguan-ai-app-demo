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

  return { toast: toast, pickHtml: pickHtml, copy: copy, esc: esc,
           cardBadge: cardBadge, badgeLabel: badgeLabel, setDisabled: setDisabled };
})();
