/* 视图切换：预览 / 代码（2026-10-30 二版 · 文件树）
   用户要求（转述）：「做文件树视角，把四个页面接成工程结构」。
   - 代码视图 = 左文件树 + 右源码：页面（components/component/apps/app/versions）与 assets 分两组；
   - 第一项固定是「画布（运行时）」：展示当前画布组装后的 DOM，跟真实文件区分开；
   - 每个文件点开现取源码（fetch），带行号、可复制；
   - 默认预览；file:// 下浏览器禁止读取同目录源码 ⇒ 给明确提示，不假装读到了。 */
(function () {
  var ops = document.querySelector('.tb-ops');
  if (!ops) return;
  /* ★2026-11-04（用户）：「预览/代码要的啊，这么重要的东西…不论是组件配置还是应用配置，
     都给我放到右上角操作区的第一个。然后这个样式有些丑，而且没提示，用户不懂，
     可以文字后有个提示的图标，光标悬浮显示这个操作代表什么意思」。
     ⇒ 撤掉 2026-11-03 那条"这两页不显示"的限制，两页都放回操作区第一位；
       形态与顶栏描边按钮同一套，文字后挂一枚 ⓘ，悬浮/聚焦给解释。 */
  var seg = document.createElement('div');
  seg.className = 'seg-view';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', '视图切换');
  seg.innerHTML = '<button type="button" data-v="preview" aria-pressed="true">预览</button>'
    + '<button type="button" data-v="code" aria-pressed="false">代码</button>'
    + '<span class="seg-tip" tabindex="0" role="note" aria-label="预览看页面成品；代码看这个页面与组件的源码文件"'
    + ' data-tip="预览：看页面做出来的样子。代码：看这个页面与组件的源码文件。">i</span>';
  ops.insertBefore(seg, ops.firstChild);

  var PAGES = ['components.html', 'component.html', 'apps.html', 'app.html', 'versions.html'];
  var CANVAS_KEY = '__canvas__';
  var pane = null, mode = 'preview', selected = null;

  function canvasEl() {
    return document.getElementById('canvas-inner') || document.getElementById('canvas');
  }
  function topOf() {
    var tb = document.querySelector('#topbar') || document.querySelector('.topbar');
    return tb ? Math.round(tb.getBoundingClientRect().bottom) : 0;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  function formatHtml(html) {
    var lines = String(html).replace(/>\s*</g, '>\n<').split('\n');
    var out = [], depth = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var opens = (line.match(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g) || []).filter(function (t) {
        return !/\/>$/.test(t) && !VOID.test(t.replace(/^</, '').split(/[\s>]/)[0]);
      }).length;
      var closes = (line.match(/<\/[a-zA-Z][a-zA-Z0-9-]*>/g) || []).length;
      var before = Math.max(0, depth - closes);
      out.push(new Array(before + 1).join('  ') + line);
      depth = Math.max(0, depth + opens - closes);
    }
    return out;
  }
  function assetList() {
    var out = [], seen = {};
    var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"]');
    for (var i = 0; i < nodes.length; i++) {
      var raw = nodes[i].getAttribute('src') || nodes[i].getAttribute('href') || '';
      var p = raw.split('?')[0];
      if (!p || p.indexOf('assets/') !== 0 || seen[p]) continue;
      seen[p] = 1; out.push(p);
    }
    return out;
  }
  function fileLabel(p) {
    return p.split('/').pop();
  }

  function ensurePane() {
    if (pane) return pane;
    pane = document.createElement('section');
    pane.className = 'code-pane';
    pane.id = 'code-pane';
    pane.setAttribute('aria-label', '代码视图');
    pane.innerHTML = '<aside class="code-tree" aria-label="项目文件">'
      + '<div class="code-tree-hd">项目文件</div>'
      + '<div class="code-tree-group">运行时</div>'
      + '<button type="button" class="code-file" data-f="' + CANVAS_KEY + '">画布（运行时）</button>'
      + '<div class="code-tree-group">页面</div>'
      + PAGES.map(function (p) {
        return '<button type="button" class="code-file" data-f="' + p + '">' + p + '</button>';
      }).join('')
      + '<div class="code-tree-group">assets</div>'
      + assetList().map(function (p) {
        return '<button type="button" class="code-file" data-f="' + p + '">' + fileLabel(p) + '</button>';
      }).join('')
      + '</aside>'
      + '<div class="code-main">'
      + '<div class="code-pane-hd"><span id="code-title">源码</span>'
      + '<button type="button" class="code-copy" id="code-copy">复制</button></div>'
      + '<pre><ol class="lines" id="code-lines"></ol></pre>'
      + '</div>';
    document.body.appendChild(pane);

    pane.querySelector('.code-tree').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.code-file') : null;
      if (!b) return;
      openFile(b.getAttribute('data-f'));
    });
    var btn = pane.querySelector('#code-copy');
    btn.addEventListener('click', function () {
      var text = pane.querySelector('#code-lines').innerText || '';
      var done = function (ok) {
        btn.textContent = ok ? '已复制' : '复制失败';
        setTimeout(function () { btn.textContent = '复制'; }, 1600);
      };
      if (window.UIK && UIK.copy) UIK.copy(text).then(done); else done(false);
    });
    return pane;
  }

  function paint(lines, title) {
    var box = ensurePane();
    box.querySelector('#code-title').textContent = title;
    box.querySelector('#code-lines').innerHTML = lines.map(function (line) {
      return '<li>' + esc(line) + '</li>';
    }).join('');
    box.querySelector('#code-lines').parentNode.scrollTop = 0;
  }

  function markSelected(p) {
    selected = p;
    var all = pane.querySelectorAll('.code-file');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('on', all[i].getAttribute('data-f') === p);
    }
  }

  function openFile(p) {
    markSelected(p);
    if (p === CANVAS_KEY) {
      var el = canvasEl();
      var html = el ? String(el.innerHTML || '').replace(/^\s+|\s+$/g, '') : '';
      paint(formatHtml(html), (document.title.split(' · ')[0] || '页面') + ' · 画布（运行时组装）');
      return;
    }
    paint(['读取中…'], p);
    fetch(p, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var lines = text.replace(/\s+$/, '').split('\n');
      var isHtml = /\.html$/.test(p);
      paint(isHtml ? formatHtml(lines.join('\n')) : lines, p + ' · ' + lines.length + ' 行');
    }).catch(function (err) {
      var tip = location.protocol === 'file:'
        ? '本地文件方式读不到源码，用 http 打开（WorkBuddy 预览或本地服务）。'
        : '读取失败：' + err.message;
      paint([tip], p + ' · 未读到');
    });
  }

  function render() {
    var box = ensurePane();
    box.style.top = topOf() + 'px';
    if (!selected) openFile(CANVAS_KEY);
    else if (selected === CANVAS_KEY) openFile(CANVAS_KEY);
  }

  function set(v) {
    mode = v;
    document.body.setAttribute('data-view', v);
    Array.prototype.forEach.call(seg.children, function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v));
    });
    if (v === 'code') { ensurePane().hidden = false; render(); }
    else if (pane) { pane.hidden = true; }
  }

  seg.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-v]') : null;
    if (!b) return;
    set(b.getAttribute('data-v'));
  });
  window.addEventListener('resize', function () {
    if (mode === 'code' && pane) pane.style.top = topOf() + 'px';
  });

  /* 画布重画时，只有停在「画布（运行时）」这一项才刷新；看真实文件时不打断 */
  var t = null;
  var el = canvasEl();
  if (el && window.MutationObserver) {
    new MutationObserver(function () {
      if (mode !== 'code' || selected !== CANVAS_KEY) return;
      clearTimeout(t); t = setTimeout(function () { openFile(CANVAS_KEY); }, 250);
    }).observe(el, { childList: true, subtree: true });
  }

  set('preview');
  window.ViewMode = { set: set, refresh: function () { if (mode === 'code') render(); } };
})();
