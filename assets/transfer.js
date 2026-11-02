/* ─────────────────────────────────────────────────────────────
   transfer.js —— 导入 / 导出的唯一实现（2026-10-30）

   为什么收成一份：应用页与组件页都要「存成文件 / 从文件恢复」，
   各写一份 Blob + FileReader 的结局是两处错误口径不一样（一处说"格式不对"、
   一处直接静默失败）。数据怎么组装在 data.js（DB.exportApp / DB.importPayload），
   这里只负责**文件和浏览器**这一段。

   浏览器边界（写清，免得下一个人以为是 bug）：
   · 导出走 Blob + <a download>，`file://` 下也能存；
   · 导入必须用户点一下选文件 —— 浏览器不许脚本静默读本地盘。
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var T = {};

  T.fileName = function (s) {
    return String(s || 'export').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) + '.json';
  };

  T.download = function (name, obj) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = T.fileName(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* 选一个 json → 解析 → cb(obj)；任何一步失败都走 onErr(人话) */
  T.pick = function (cb, onErr) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.hidden = true;
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(r.result)); } catch (e) { obj = null; }
        if (!obj) { onErr('这个文件不是本系统导出的（读不出 JSON）'); return; }
        cb(obj);
      };
      r.onerror = function () { onErr('文件没读出来，换一个再试'); };
      r.readAsText(f);
    });
    /* 用户取消选文件时 change 不会触发 —— 不接这条，每取消一次就在 body 里留一个孤儿 input */
    inp.addEventListener('cancel', function () { inp.remove(); });
    inp.click();
  };

  window.Transfer = T;
})();
