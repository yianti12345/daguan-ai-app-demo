/* ─────────────────────────────────────────────────────────────
   drag.js —— 拖动 + 位置持久化。三个人共用这一个实现。

   接口（固定，别各写一遍）：
     window.Draggable(el, {
       key:      'xz-fab',       // localStorage key 实际写成 ifas90:pos:<key>
       handle:   '.dz-handle',   // 可拖动区选择器；不传则整个 el 可拖
       axis:     'both',         // 'both' | 'x' | 'y'
       onChange: function (pos) {}   // 拖完回调（可选）
     });

   行为约定：
   · 只用 pointer 事件（pointerdown/move/up + setPointerCapture），
     鼠标、触屏、手写笔走同一条路径，不额外绑 mouse/touch。
   · 起点落在 input / textarea / button / select / a 及其子节点上，直接不拖 ——
     否则点输入框会把整个底栏拽走。（所以把手请用 div/span，别用 <button>。）
   · 位置夹在 [0, innerWidth-w] × [0, innerHeight-h]；窗口 resize 时重新夹一次。
   · 落库到 localStorage，初始化时恢复；没记录过就保持元素当前的 CSS 位置。
   · 拖动期间 cursor:grabbing + body user-select:none，结束即还原。

   两个容易踩的坑，已经在代码里处理：
   ① 目标元素若是 position:fixed + right/bottom 定位（例如 .xz-fab），
      接管时要同时把 right/bottom 置 auto、把 transform 清掉，否则一碰就跳。
   ② 拖动结束浏览器还会补一个 click。不吞掉的话"拖小智"会顺手把面板打开。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STORE_PREFIX = 'ifas90:pos:';
  var THRESHOLD = 3;              /* 位移超过这个数才算"在拖"而不是"在点" */
  var CTRL = 'input,textarea,button,select,a,option,label';
  var instances = [];
  var suppressUntil = 0;

  function readPos(key) {
    try {
      var raw = localStorage.getItem(STORE_PREFIX + key);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
      return p;
    } catch (e) { return null; }
  }
  function writePos(key, p) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) })); } catch (e) {}
  }
  function clampPos(x, y, w, h) {
    var maxX = Math.max(0, window.innerWidth - w);
    var maxY = Math.max(0, window.innerHeight - h);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }

  /* 把"视口坐标"落到元素上。position:static 的元素 left/top 不起作用，明确提示。 */
  function apply(el, pos, opts) {
    var r = el.getBoundingClientRect();
    var p = clampPos(pos.x, pos.y, r.width, r.height);
    var cs = window.getComputedStyle(el);
    if (cs.position === 'static') {
      /* 不擅自改定位方式（会连带影响布局），但要让人知道拖动在这里不会生效 */
      console.warn('[Draggable] ' + (opts.key || 'el') + ' 是 position:static，left/top 不会生效');
    }
    if (opts.axis !== 'y') el.style.left = p.x + 'px';
    if (opts.axis !== 'x') el.style.top = p.y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    if (cs.transform && cs.transform !== 'none') el.style.transform = 'none';
    el.setAttribute('data-dragging-placed', '1');
    return p;
  }

  function Draggable(el, options) {
    if (!el) return null;
    var opts = {
      key: (options && options.key) || 'el',
      handle: (options && options.handle) || null,
      axis: (options && (options.axis === 'x' || options.axis === 'y')) ? options.axis : 'both',
      onChange: (options && typeof options.onChange === 'function') ? options.onChange : null
    };

    var drag = null;
    var inst = { el: el, opts: opts, reset: reset, destroy: destroy, pos: null };

    /* 恢复上次位置；没记录就交给 CSS */
    var saved = readPos(opts.key);
    if (saved) inst.pos = apply(el, saved, opts);

    el.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;            /* 只认左键 / 单指 */

      /* 硬要求：点在控件上不拖（含它们的子节点） */
      if (e.target.closest && e.target.closest(CTRL)) return;

      /* 指定了把手就只认把手 */
      if (opts.handle && !(e.target.closest && e.target.closest(opts.handle))) return;

      var r = el.getBoundingClientRect();
      drag = {
        dx: e.clientX - r.left, dy: e.clientY - r.top,
        sx: e.clientX, sy: e.clientY,
        moved: false, id: e.pointerId
      };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.sx) < THRESHOLD && Math.abs(e.clientY - drag.sy) < THRESHOLD) return;
        drag.moved = true;
      }
      inst.pos = apply(el, { x: e.clientX - drag.dx, y: e.clientY - drag.dy }, opts);
    });

    function end(e) {
      if (!drag || (e && e.pointerId != null && e.pointerId !== drag.id)) return;
      var moved = drag.moved;
      drag = null;
      el.style.cursor = '';
      document.body.style.userSelect = '';
      try { if (e && e.pointerId != null) el.releasePointerCapture(e.pointerId); } catch (err) {}

      if (!moved) return;
      /* ★2026-10-27 修（真实缺陷，不是判据问题）：
         原来在 pointerup 里**再读一次 getBoundingClientRect() 并重夹一次**。
         而同一个事件处理器里刚写过 el.style.left，rect 读到的可能是**上一步的旧布局** ——
         于是最后那一下会把位置拽回上一个中间态。
         实测：底栏从 310 拖 -120，move 每一步都对（280/250/220/190），
         pointerup 却把 190 拽回 257，净位移只剩 -53，表现为"拖不动"。
         拖动过程里每一步都已经 clampPos 过，结束时的位置本来就是合法的，
         所以这里直接用最后一步的 inst.pos，不再重读布局。 */
      var p = inst.pos || (function () {
        var r = el.getBoundingClientRect();
        return clampPos(r.left, r.top, r.width, r.height);
      })();
      apply(el, p, opts);
      inst.pos = p;
      writePos(opts.key, p);
      /* 拖完这一下 click 不该被当成点击 */
      suppressUntil = Date.now() + 250;
      if (opts.onChange) opts.onChange(p);
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.style.cursor = el.style.cursor || 'grab';

    function reset() {
      try { localStorage.removeItem(STORE_PREFIX + opts.key); } catch (e) {}
      el.style.left = '';
      el.style.right = '';
      el.style.top = '';
      el.style.bottom = '';
      el.style.transform = '';
      el.removeAttribute('data-dragging-placed');
      inst.pos = null;
    }
    function destroy() {
      var i = instances.indexOf(inst);
      if (i >= 0) instances.splice(i, 1);
      el.style.cursor = '';
    }

    instances.push(inst);
    return inst;
  }

  /* 拖动后的那一次 click：capture 挂在 window 上，早于页面里 document 级的手势处理器，
     只有这样才能拦住"拖动顺手点开面板"。 */
  window.addEventListener('click', function (e) {
    if (Date.now() > suppressUntil) return;
    var t = e.target;
    if (!t.closest) return;
    if (!t.closest('[data-dragging-placed="1"]')) return;
    suppressUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /* 窗口变了，已摆出去的东西重新夹回视口内 */
  window.addEventListener('resize', function () {
    instances.forEach(function (inst) {
      if (!inst.pos) return;
      var r = inst.el.getBoundingClientRect();
      var p = clampPos(r.left, r.top, r.width, r.height);
      if (p.x !== r.left || p.y !== r.top) {
        inst.pos = apply(inst.el, p, inst.opts);
        writePos(inst.opts.key, inst.pos);
      }
    });
  });

  window.Draggable = Draggable;
})();
