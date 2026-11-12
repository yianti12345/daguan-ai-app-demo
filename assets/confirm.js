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
  var mask = null, cfg = null;

  function q(sel) { return mask.querySelector(sel); }

  function inertBg(layer, on) { UIK.Dialog.inertBg(layer, on); }

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
        '<div class="nf-bd"><p class="cf-body" id="cf-body"></p>' +
          '<label class="cf-field" id="cf-field" hidden><span class="cf-label" id="cf-label"></span>' +
            '<input class="cf-input" id="cf-input" type="text" autocomplete="off" spellcheck="false">' +
            '<span class="cf-err" id="cf-err" role="alert"></span></label>' +
        '</div>' +
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
  }

  function ask(o) {
    if (!mask) build();
    cfg = o || {};

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

    /* 名称输入（复制/导入）：同一个骨架里多一格，不再造第二套弹层。
       空名 / 重名都当场挡在按钮上，并把原因写在输入框下面 ——
       不要等点了确定再 toast，用户还得重新打开一次。 */
    var field = q('#cf-field'), input = q('#cf-input'), err = q('#cf-err');
    if (cfg.input) {
      field.hidden = false;
      q('#cf-label').textContent = cfg.label || '名称';
      input.value = cfg.value == null ? '' : String(cfg.value);
      input.placeholder = cfg.placeholder || '输入新名称';
      input.setAttribute('aria-invalid', 'false');
      err.textContent = '';
      var check = function () {
        var v = input.value.trim();
        var msg = '';
        if (!v) msg = '名称不能为空';
        else if (typeof cfg.validate === 'function') msg = cfg.validate(v) || '';
        err.textContent = msg;
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        okBtn.disabled = !!msg;
      };
      input.oninput = check;
      input.onkeydown = function (e) {
        if (e.key === 'Enter' && !okBtn.disabled) { e.preventDefault(); close(true, true); }
      };
      check();
    } else {
      field.hidden = true;
      input.value = '';
      input.oninput = null;
      input.onkeydown = null;
      /* 上一次若是重名提示，确定键会是 disabled；普通确认不能再继承这个状态。 */
      okBtn.disabled = false;
    }

    var target = cfg.input ? input : (cfg.danger ? q('[data-cf="no"]') : okBtn);
    UIK.Dialog.open(mask, { initialFocus: target, onEscape: function () { close(false, false); } });
  }

  /* viaBtn：这次关闭是「点了按钮」还是「点遮罩 / 按 Esc 放弃」。
     两者都不执行确定动作，但只有前者该触发 onCancel ——
     点遮罩放弃不该顺手把人带到别处去。 */
  function close(ok, viaBtn) {
    if (!mask || mask.hidden) return;
    var c = cfg; cfg = null;
    UIK.Dialog.close(mask);
    if (ok && c && typeof c.onOk === 'function') {
      c.onOk(c.input ? q('#cf-input').value.trim() : undefined);
    }
    else if (!ok && viaBtn && c && typeof c.onCancel === 'function') c.onCancel();
  }

  return { ask: ask, close: close, inertBg: inertBg };
})();
