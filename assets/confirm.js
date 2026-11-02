/* 确认框 + 背景 inert（2026-10-25）
   ─ 为什么单独一个文件 ────────────────────────────────────────────────
   不可逆 / 对客户可见的动作需要"先问一句"：停用应用、发布新版本、停用组件。
   这三处如果各写一遍弹层，就有三份焦点陷阱、三份 inert、三种文案节奏 ——
   用户已经为"两套卡片"付过一次代价，同一件事不许再有两个定义处。
   这里只做两件事：把背景关掉（inertBg）、问一句拿是/否（ask）；文案由调用方给。

   ─ 遵循 ──────────────────────────────────────────────────────────
   DESIGN §4.1  danger = --err-bg 底 + --err 字，无阴影；其余层级照矩阵
   DESIGN §9    焦点不逃逸、Esc 可关、关闭后焦点回到触发元素、
                破坏性动作默认焦点落在「取消」

   ─ 用法 ──────────────────────────────────────────────────────────
   Confirm.inertBg(maskEl, true|false)      // 页面自己的弹层也用这一个
   Confirm.ask({
     title: '操作确认',                     // 平台口径：标题固定，对象与后果进正文
     body:  '下架后，客户将无法使用该应用，是否确认下架？',
     ok:    '确定',                         // 危险由标题前红色感叹号承担，按钮仍是蓝色
     danger: true,                          // true → 显示感叹号 + 焦点默认给取消
     onOk:  function () { ... }
   });
*/
window.Confirm = (function () {
  'use strict';
  var mask = null, cfg = null, ret = null;

  function q(sel) { return mask.querySelector(sel); }

  /* ── 背景 inert：按"祖先的兄弟"逐层关，而不是"把 body 子元素一律关掉" ──
     两种错法都踩过：
       ① 只列几个选择器（.sider/.bar/#grid…）—— 漏掉的 `.hdr`、`#xz-host` 仍可 Tab 到，
          焦点一旦跑到弹层外，挂在弹层上的 Tab 陷阱就再也接不到事件；
       ② body 子元素一律 inert —— 弹层通常包在页面容器里，这等于把弹层自己的祖先也关了，
          focus() 全部失效、Tab 一动不动。
     正确做法：从弹层往上走，每一层"关掉除自己这一支以外的兄弟"，
     到 body 为止（于是 #xz-host、脚本容器这些也一并关掉）。 */
  function inertBg(layer, on) {
    if (!layer) return;
    var node = layer;
    while (node && node !== document.body) {
      var p = node.parentNode;
      if (!p) break;
      Array.prototype.forEach.call(p.children, function (el) {
        if (el === node) return;
        /* 已经开着别的弹层时，那个弹层所在的支要留着，否则关掉这层也放不出那层 */
        if (el.querySelector && el.querySelector('.nf-mask:not([hidden])')) return;
        if (on) {
          if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); el.setAttribute('data-inert-by', 'dlg'); }
        } else if (el.getAttribute('data-inert-by') === 'dlg') {
          el.removeAttribute('inert'); el.removeAttribute('data-inert-by');
        }
      });
      node = p;
    }
  }

  function build() {
    mask = document.createElement('div');
    mask.className = 'nf-mask';
    mask.hidden = true;
    /* alertdialog 而不是 dialog：这里问的是"要不要做这件已经定好的事"，
       读屏在打开的一瞬间就该把问句念完，而不是让人再 Tab 进去找标题。 */
    mask.innerHTML =
      '<div class="nf nf-confirm" role="alertdialog" aria-modal="true" ' +
             'aria-labelledby="cf-title" aria-describedby="cf-body">' +
        '<div class="nf-hd"><span class="cf-ico" id="cf-ico" hidden aria-hidden="true">!</span><b id="cf-title"></b></div>' +
        '<div class="nf-bd"><p class="cf-body" id="cf-body"></p></div>' +
        '<div class="nf-ft">' +
          '<button class="btn quiet" type="button" data-cf="no"></button>' +
          '<button class="btn" type="button" data-cf="ok"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) {
      /* 点遮罩不关闭：确认框问的是「要不要做」，误触遮罩不该等于放弃（components.spec §26.4） */
      var b = e.target.closest('[data-cf]');
      if (b) close(b.getAttribute('data-cf') === 'ok', true);
    });
    /* capture 阶段：页面自己的 Esc 处理（关别的弹层）不该被这个框带响 */
    document.addEventListener('keydown', onKey, true);
  }

  function focusables() {
    return Array.prototype.filter.call(
      mask.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; }
    );
  }

  function onKey(e) {
    if (!mask || mask.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false, false); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!mask.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  function ask(o) {
    if (!mask) build();
    cfg = o || {};
    ret = document.activeElement;

    q('#cf-title').textContent = cfg.title || '操作确认';
    q('#cf-ico').hidden = !cfg.danger;
    var body = q('#cf-body');
    if (cfg.body) { body.innerHTML = cfg.body; body.hidden = false; }
    else { body.innerHTML = ''; body.hidden = true; }

    var okBtn = q('[data-cf="ok"]');
    okBtn.textContent = cfg.ok || '确定';
    /* 与平台标准件一致：危险由标题旁红点承担，主按钮仍是蓝色「确定」 */
    okBtn.className = 'btn primary';
    q('[data-cf="no"]').textContent = cfg.cancel || '取消';

    mask.hidden = false;
    inertBg(mask, true);
    /* 破坏性动作把焦点放在「取消」上：手一快敲回车不会把应用停掉。
       用 rAF 而不是定时器 —— 定时器在慢帧下会晚于用户的第一次 Tab，
       那一次 Tab 会从 body 起步，陷阱就白设了。 */
    var target = cfg.danger ? q('[data-cf="no"]') : okBtn;
    target.focus();
    if (document.activeElement !== target) {
      requestAnimationFrame(function () { if (mask && !mask.hidden) target.focus(); });
    }
  }

  /* viaBtn：这次关闭是「点了按钮」还是「点遮罩 / 按 Esc 放弃」。
     两者都不执行确定动作，但只有前者该触发 onCancel ——
     点遮罩放弃不该顺手把人带到别处去。 */
  function close(ok, viaBtn) {
    if (!mask || mask.hidden) return;
    mask.hidden = true;
    inertBg(mask, false);
    var c = cfg; cfg = null;
    if (ret && ret.focus) {
      try { ret.focus({ preventScroll: true }); } catch (e) { try { ret.focus(); } catch (e2) {} }
    }
    ret = null;
    if (ok && c && typeof c.onOk === 'function') c.onOk();
    else if (!ok && viaBtn && c && typeof c.onCancel === 'function') c.onCancel();
  }

  return { ask: ask, close: close, inertBg: inertBg };
})();
