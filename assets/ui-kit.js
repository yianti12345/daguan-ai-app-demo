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
        /* ★2026-11-06：历史原来只能新建、不能删，演示前敲错一句就永久留着。
           清空全部与删除单条（详情页里）都走这里下发 data-act，由各自容器收口。 */
        + (list.length ? '<button type="button" class="hist-clr" data-act="histClear">清空全部</button>' : '')
        + '<button type="button" class="hist-new" data-act="histNew">新对话</button></div>'
        + '<div class="hist-list" tabindex="-1">' + rows + '</div></div>';
    },
    detailHtml: function (conv, threadHtml) {
      var n = hist.count(conv.msgs);
      return '<div class="hist-detail" role="region" aria-label="对话详情">'
        + '<button type="button" class="hist-back" data-act="histBack">'
        + '<span aria-hidden="true">←</span> 返回</button>'
        + '<p class="hist-dt">' + esc(hist.title(conv.msgs)) + '</p>'
        + '<p class="hist-dm">' + esc(hist.fmtAt(conv.at) + (n ? ' · ' + n + ' 条' : '')) + '</p>'
        + '<div class="hist-thread">' + (threadHtml || '') + '</div>'
        + '<button type="button" class="hist-del" data-act="histDel" data-arg="' + esc(conv.id) + '">'
        + '删除这个对话</button></div>';
    }
  };

  /* ── 附件：一处定义，浮条与小智面板共用（2026-11-04）────────────────────
   * demo 没有上传接口也没有模型后端，所以「让 AI 读」在浏览器里真读：
   *   压缩包 → 只读 central directory 列出内部文件名（不解压）；图片 → 缩略图；
   *   文本/代码 → 开头一段；其它文档 → 只记名字、类型、大小。
   * 这套是唯一实现，两处输入框都调它，不各写一份。 */
  var Attach = (function () {
    var MAX_FILES = 10, MAX_SIZE = 20 * 1024 * 1024, cssDone = false;
    /* 2026-11-06：同一个宿主容器只建一次控制器。
       根因是「绘制路径里挂载」—— 面板每次重画都调 create()，
       而 create 会 append 隐藏 input 和按钮，于是连画两次就多一枚回形针（实测 1→3）。 */
    var CTRL = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
    var CLIP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.05 12.3 20.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5"/></svg>';

    function css() {
      if (cssDone) return; cssDone = true;
      var s = document.createElement('style');
      s.textContent = [
        '.uik-att-bar{display:none;flex-wrap:wrap;gap:6px;padding:6px 4px 2px}',
        '.uik-att-bar.has{display:flex}',
        '.uik-atts{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}',
        '.uik-att{display:inline-flex;align-items:center;gap:6px;max-width:280px;padding:4px 8px;border:1px solid var(--line-2,#e5e7eb);border-radius:8px;background:#fff;font-size:12px;color:#333}',
        '.uik-att-thumb{width:22px;height:22px;object-fit:cover;border-radius:4px;flex:none}',
        '.uik-att-ic{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;background:#f1f2f6;color:#6b7280;font-size:12px;flex:none}',
        '.uik-att-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}',
        '.uik-att-mt{color:#8a909a;flex:none}',
        '.uik-att-x{border:0;background:none;cursor:pointer;color:#8a909a;padding:0 2px;font-size:15px;line-height:1}',
        '.uik-att-btn{width:28px;height:28px;border:0;background:none;color:#6b7280;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0}',
        '.uik-att-btn:hover{color:#111}',
        '.uik-att-drop{outline:2px dashed #4c8bf5;outline-offset:2px}'
      ].join('\n');
      document.head.appendChild(s);
    }
    function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
    function kind(f) {
      if (/\.(zip|rar|7z|tar|gz)$/i.test(f.name)) return 'zip';
      if (/^image\//.test(f.type)) return 'img';
      if (/^text\//.test(f.type) || /\.(txt|md|json|js|jsx|ts|tsx|css|html?|vue|py|xml|csv|ya?ml|sql|log)$/i.test(f.name)) return 'text';
      return 'doc';
    }
    /* ZIP 的目录在文件尾：找 EOCD(0x06054b50) → 读 central directory 条数/偏移 → 逐条取文件名。
       不解压任何内容，因此 20MB 的包也不会卡住页面。 */
    function zipNames(buf) {
      var dv = new DataView(buf), e = -1;
      for (var i = dv.byteLength - 22; i >= Math.max(0, dv.byteLength - 65558); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
      }
      if (e < 0) return [];
      var n = dv.getUint16(e + 10, true), off = dv.getUint32(e + 16, true), names = [];
      for (var k = 0; k < n && off + 46 <= dv.byteLength; k++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        var nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
        try { names.push(new TextDecoder('utf-8').decode(new Uint8Array(buf, off + 46, nl))); } catch (err) { /* 非 UTF-8 名字跳过 */ }
        off += 46 + nl + el + cl;
      }
      return names;
    }
    function parse(a, f, done) {
      var finish = function () { done(); };
      if (a.kind === 'img') {
        var r = new FileReader();
        r.onload = function () { a.thumb = r.result; finish(); }; r.onerror = finish;
        r.readAsDataURL(f); return;
      }
      if (a.kind === 'zip') {
        var z = new FileReader();
        z.onload = function () {
          try { a.files = zipNames(z.result); } catch (err) { a.files = []; }
          finish();
        }; z.onerror = finish;
        z.readAsArrayBuffer(f); return;
      }
      if (a.kind === 'text') {
        var t = new FileReader();
        t.onload = function () { a.head = String(t.result || '').slice(0, 240); finish(); }; t.onerror = finish;
        t.readAsText(f.slice(0, 64 * 1024)); return;
      }
      finish();
    }
    function meta(a) {
      var m = a.kind === 'zip' ? (a.files && a.files.length ? a.files.length + ' 个文件' : '压缩包')
        : a.kind === 'img' ? '图片' : a.kind === 'text' ? '文本' : '文档';
      return m + ' · ' + size(a.size);
    }
    function thumb(a) {
      if (a.thumb) return '<img class="uik-att-thumb" src="' + a.thumb + '" alt="">';
      var t = a.kind === 'zip' ? 'ZIP' : a.kind === 'img' ? '图' : a.kind === 'text' ? 'TXT' : 'DOC';
      return '<span class="uik-att-ic">' + t + '</span>';
    }
    function card(a, removable, i) {
      return '<div class="uik-att"><span title="' + esc(a.name) + '">' + thumb(a) + '</span>'
        + '<span class="uik-att-nm">' + esc(a.name) + '</span>'
        + '<span class="uik-att-mt">' + meta(a) + '</span>'
        + (removable ? '<button type="button" class="uik-att-x" data-i="' + i + '" aria-label="移除">×</button>' : '')
        + '</div>';
    }
    /* 消息里的附件：只读，不带删除钮 */
    function msgHtml(atts) {
      if (!atts || !atts.length) return '';
      return '<div class="uik-atts">' + atts.map(function (a) { return card(a, false, 0); }).join('') + '</div>';
    }
    /* 小智的回应只陈述「读到了什么」，不写解释句、不假装已经改完。
       ★2026-11-04（用户：「提示文案也不对」）：原来每条都是「读了 xx 的开头」这种半句，
       几份附件拼成「读了 A 的开头；看了 B」—— 主语含糊、动词被截断，读起来像内部日志。
       现在一句一条：名字在前，读到的东西在后，有片段就摆片段。 */
    function reply(atts) {
      var lines = (atts || []).map(function (a) {
        if (a.kind === 'zip' && a.files && a.files.length) {
          return a.name + '：包内 ' + a.files.length + ' 个文件 —— '
            + a.files.slice(0, 3).join('、') + (a.files.length > 3 ? ' 等' : '');
        }
        if (a.kind === 'text' && a.head) {
          var snip = String(a.head).replace(/\s+/g, ' ').slice(0, 40);
          return a.name + '：' + meta(a) + '，开头是「' + snip + '」';
        }
        return a.name + '：' + meta(a);
      });
      return lines.join('\n');
    }
    /* 一处控制器：按钮给调用方 append 到自己的输入区；chip 区由调用方给容器 */
    function create(barHost) {
      if (CTRL && barHost && CTRL.has(barHost)) return CTRL.get(barHost);
      css();
      var list = [], onChange = null;
      var input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.style.display = 'none';
      input.accept = '.zip,.rar,.7z,.tar,.gz,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.vue,.py,.xml,.csv,.yaml,.yml,.sql,.log,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
      /* 挂在 barHost 自身，不挂它的父级 —— 宿主被整块重画时 input 随旧树一起销毁，不会累积。 */
      barHost.appendChild(input);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'uik-att-btn';
      btn.setAttribute('aria-label', '添加附件'); btn.title = '添加附件';
      btn.innerHTML = CLIP;
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () { add(input.files); input.value = ''; });
      function render() {
        barHost.className = 'uik-att-bar' + (list.length ? ' has' : '');
        barHost.innerHTML = list.length
          ? '<div class="uik-atts">' + list.map(function (a, i) { return card(a, true, i); }).join('') + '</div>' : '';
        var xs = barHost.querySelectorAll('.uik-att-x');
        for (var j = 0; j < xs.length; j++) xs[j].addEventListener('click', function (e) {
          list.splice(+e.currentTarget.getAttribute('data-i'), 1); render();
        });
        if (onChange) onChange(list.length);
      }
      function add(fs) {
        var arr = Array.prototype.slice.call(fs || []);
        for (var i = 0; i < arr.length && list.length < MAX_FILES; i++) {
          var f = arr[i];
          if (!f || f.size > MAX_SIZE) continue;
          var a = { name: f.name, size: f.size, kind: kind(f) };
          list.push(a); render(); parse(a, f, render);
        }
      }
      var api = {
        button: btn,
        count: function () { return list.length; },
        all: function () { return list.slice(); },
        /* 小智面板每次 render 都重建 DOM，控制器要重建；附件列表靠 seed 跨重建带回来。 */
        seed: function (arr) { list = (arr || []).slice(); render(); return api; },
        take: function () { var out = list.slice(); list = []; render(); return out; },
        onChange: function (fn) { onChange = fn; return api; },
        bindDrop: function (el) {
          el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('uik-att-drop'); });
          el.addEventListener('dragleave', function () { el.classList.remove('uik-att-drop'); });
          el.addEventListener('drop', function (e) {
            e.preventDefault(); el.classList.remove('uik-att-drop');
            if (e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files);
          });
        }
      };
      if (CTRL && barHost) CTRL.set(barHost, api);
      return api;
    }
    return { create: create, msgHtml: msgHtml, reply: reply };
  })();

  /* ── 全文查看（2026-11-04）─────────────────────────────────────
     用户：「介绍太长了显示不全，然后一点击卡片直接进入配置了，看不到介绍全部内容」。
     一个轻量小弹窗，四页共用（组件库 / 应用管理 / 组件配置 / 应用配置）：
     标题 + 全文 + 关闭，点遮罩或 Esc 也关。*
     为什么不做成横条展开：卡是等高网格，展开会把整行撑高、下面的卡全跳位。 */
  var Full = (function () {
    var root = null, styled = false;
    function style() {
      if (styled) return; styled = true;
      var st = document.createElement('style');
      st.textContent = [
        '.uik-full{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center}',
        '.uik-full.is-on{display:flex}',
        '.uik-full-mask{position:absolute;inset:0;background:color-mix(in srgb,#0b1220 28%,transparent)}',
        '.uik-full-box{position:relative;width:min(520px,calc(100vw - 96px));max-height:min(60vh,420px);',
        '  display:flex;flex-direction:column;background:var(--surface-page,#fff);border-radius:12px;',
        '  box-shadow:0 24px 60px -20px rgba(16,24,40,.35),0 0 0 1px rgba(16,24,40,.06);padding:18px 20px 16px}',
        '.uik-full-hd{display:flex;align-items:flex-start;gap:12px;margin-bottom:8px}',
        '.uik-full-hd b{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:22px;color:rgba(0,0,0,.88)}',
        '.uik-full-x{flex:none;width:26px;height:26px;border:0;background:none;cursor:pointer;',
        '  border-radius:6px;color:rgba(0,0,0,.45);font-size:18px;line-height:1}',
        '.uik-full-x:hover{background:rgba(0,0,0,.05);color:rgba(0,0,0,.75)}',
        '.uik-full-bd{margin:0;overflow:auto;font-size:14px;line-height:22px;color:rgba(0,0,0,.65);white-space:pre-wrap}'
      ].join('\n');
      document.head.appendChild(st);
    }
    function open(title, body) {
      style();
      if (!root) {
        root = document.createElement('div');
        root.className = 'uik-full';
        root.innerHTML = '<div class="uik-full-mask"></div>'
          + '<div class="uik-full-box" role="dialog" aria-modal="true" aria-label="完整介绍">'
          + '<div class="uik-full-hd"><b></b><button type="button" class="uik-full-x" aria-label="关闭">\u00d7</button></div>'
          + '<p class="uik-full-bd"></p></div>';
        document.body.appendChild(root);
        root.addEventListener('click', function (e) {
          if (e.target.classList.contains('uik-full-mask') || e.target.classList.contains('uik-full-x')) close();
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      }
      root.querySelector('.uik-full-hd b').textContent = title || '';
      root.querySelector('.uik-full-bd').textContent = body || '';
      root.classList.add('is-on');
      root.querySelector('.uik-full-x').focus();
    }
    function close() { if (root) root.classList.remove('is-on'); }
    /* 说明被截断时挂一个「全文」角标 + 点击弹层。truncated 才挂，不截断就不出现 ——
       一个"点了没反应"的入口比没有入口更糟。 */
    function bindDesc(el, title, text) {
      if (!el || !text || el.dataset.fullBound) return;
      if (el.scrollHeight - el.clientHeight <= 1) return;
      el.dataset.fullBound = '1';
      el.classList.add('is-clip');
      el.style.cursor = 'pointer';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '查看完整介绍');
      function go(e) { e.preventDefault(); e.stopPropagation(); open(title, text); }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(title, text); }
      });
    }
    /* 单行省略（详情页顶栏那一行介绍）：横向溢出才算截断，判据是 scrollWidth。 */
    function bindLine(el, title, text) {
      if (!el || !text || el.dataset.fullBound) return;
      if (el.scrollWidth - el.clientWidth <= 1) return;
      el.dataset.fullBound = '1';
      el.classList.add('is-clip');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '查看完整介绍');
      el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(title || text, text); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(title || text, text); }
      });
    }
    return { open: open, close: close, bindDesc: bindDesc, bindLine: bindLine };
  })();

  /* ── 账号下拉（2026-11-06）─────────────────────────────────────────
     应用配置页与组件配置页都有这条平台条，开合 / 点外面关 / Esc 还焦三件事必须一样，
     所以只在这里写一份。菜单项是占位：接后端时替换各自的动作，形态不动。 */
  function userMenu() {
    var btn = document.getElementById('ab-user');   /* optional-id：只有带平台条的页才有 */
    var menu = document.getElementById('ab-menu');   /* optional-id：同上 */
    if (!btn || !menu) return;
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function open() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('.ab-mi');
      if (first) first.focus();
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (menu.hidden) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); }
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.ab-mi')) close();
    });
  }

  return { toast: toast, pickHtml: pickHtml, copy: copy, esc: esc,
           cardBadge: cardBadge, badgeLabel: badgeLabel, setDisabled: setDisabled, hist: hist,
           Attach: Attach, Full: Full, userMenu: userMenu };
})();

/* 两页都引 ui-kit，账号菜单在 DOM 就绪后自动挂上，调用方不用记。 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.UIK.userMenu(); });
else window.UIK.userMenu();

/* 应用与模版卡片菜单：唯一图标与条目结构，外观来自sys.css .k-mi。 */
(function(U){
 U.MenuIcons=Object.freeze({
    ver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7.5v5l3 1.8"/><circle cx="12" cy="12" r="8.5"/></svg>',
    /* ★2026-10-27：cfg 回来了。10-26 撤「配置」按钮时把图标一起删了，
       结果卡上零可见入口（零上下文评审 P0）。现在入口以「蓝色 + 图标」的形态回来，
       与组件库那颗「配置」完全同一套（那边实测 rgb(47,85,192) / 14px / 带 SVG），
       两页同一个动作长同一样。 */
    cfg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 8.9 19a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 8.9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    /* 2026-10-24 m01293：⋮ 回来了 —— 但这次里面放的是卡身放不下的真动作 */
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.6" r="1.7"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M7 12h10"/></svg>',
    on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg>',
    /* ★2026-10-29（refparity：卡底栏图标钮 真源有/我方缺失）：真源底栏第一颗 24×24 图标钮是
       Poweroff 形态（圆环上开口 + 一根竖线），hover 出「发布内测版 / 下架」。
       我方把它落成**一键上架/下架**（复用 menuAct('toggle') 的确认链），不做死图标。 */
    pow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 3.2v7.6"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11.8 7.2"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l1.2-1.2"/></svg>',
    /* 2026-10-30：复制 / 导出 —— 与组件页同一枚形状（同一个动作不许两页两样） */
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
    /* 2026-10-31（操作缺口）：删除。垃圾桶形，与上面几枚同一套 24 视图 / 1.7 描边 */
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.6h6V7"/><path d="M6.5 7l.9 12.4h9.2L17.5 7"/><path d="M10.2 11v5.2M13.8 11v5.2"/></svg>'
  });
 U.Menu={trigger:function(o){var a=o.attrs||{},attrs=Object.keys(a).map(function(k){return ' '+k+'="'+U.esc(a[k])+'"';}).join('');return '<button class="k-more" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作：'+U.esc(o.name)+'"'+attrs+'>'+U.MenuIcons.more+'</button>';},item:function(o){var a=o.attrs||{},attrs=Object.keys(a).map(function(k){return ' '+k+'="'+U.esc(a[k])+'"';}).join('');var tag=o.href?'a':'button';return '<'+tag+' class="k-mi'+(o.danger?' is-danger':'')+'" role="menuitem"'+(o.href?' href="'+U.esc(o.href)+'"':' type="button"')+attrs+'>'+(U.MenuIcons[o.icon]||'')+U.esc(o.label)+'</'+tag+'>';}};
})(window.UIK);

/* 统一弹窗结构；业务页只传内容，关闭、提交流程仍沿用各自控制器。 */
(function(U){
 U.Dialog={html:function(o){var e=U.esc,title=o.titleId||o.id+'-title';return '<div class="nf-mask" id="'+e(o.id)+'"'+(o.hidden?' hidden':'')+'><div class="nf'+(o.wide?' nf-wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="'+e(title)+'"><div class="nf-hd"><b id="'+e(title)+'">'+e(o.title)+'</b><button type="button" class="icon-btn" id="'+e(o.closeId||o.id+'-close')+'" aria-label="关闭"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'+(o.tabs||'')+'<div class="nf-bd"'+(o.bodyId?' id="'+e(o.bodyId)+'"':'')+'>'+(o.body||'')+'</div><div class="nf-ft">'+(o.footer||'')+'</div></div></div>';}};
})(window.UIK);
