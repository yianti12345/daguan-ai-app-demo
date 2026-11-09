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

  /* ══ ZIP：只写 STORE（不压缩），不引第三方库 ══════════════════════════════
     为什么手写而不引库：全站目前没有任何打包依赖，为了一个导出功能引一个 zip 库，
     体量、离线可用性、供应链都是新成本；而"不压缩的 zip"格式足够简单（CRC32 + 两个头）。
     为什么用 zip 而不是两个文件：浏览器不许脚本一次存多个文件，只能一个个弹下载。
     放进 zip 就能"一次拿到：可导回的 JSON + 每个能力的说明书 MD"。 */

  var CRC_TABLE = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) { return new TextEncoder().encode(str); }

  /* files: [{ name, text }] → Blob(zip) */
  T.zip = function (files) {
    var chunks = [], central = [], offset = 0, i;
    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

    for (i = 0; i < files.length; i++) {
      var nameB = utf8(files[i].name);
      var dataB = utf8(files[i].text == null ? '' : String(files[i].text));
      var crc = crc32(dataB);
      /* 本地文件头：签名 + 版本 + 标志(bit11=UTF-8 名) + 方法 0(STORE) + 时间日期 + crc + 大小 + 名长 + 扩展长 */
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameB, dataB);
      central.push({ nameB: nameB, crc: crc, size: dataB.length, offset: offset });
      offset += local.length + nameB.length + dataB.length;
    }

    var cdStart = offset, cdSize = 0, cds = [];
    for (i = 0; i < central.length; i++) {
      var c = central[i];
      var hdr = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.nameB.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
      );
      cds.push(new Uint8Array(hdr), c.nameB);
      cdSize += hdr.length + c.nameB.length;
    }
    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(cdSize), u32(cdStart), u16(0)
    ));
    return new Blob(chunks.concat(cds, [eocd]), { type: 'application/zip' });
  };

  /* 解 STORE zip → { 文件名: 文本 }。只支持方法 0（我们自己写的就是 0）。 */
  T.unzip = function (buf) {
    var b = new Uint8Array(buf), out = {}, i = 0;
    var u16 = function (p) { return b[p] | (b[p + 1] << 8); };
    var u32 = function (p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; };
    while (i < b.length - 4) {
      if (u32(i) !== 0x04034b50) { i++; continue; }
      var method = u16(i + 8), size = u32(i + 18), nl = u16(i + 26), el = u16(i + 28);
      if (method !== 0) return null;                    /* deflate 不认，交给上层说人话 */
      var nameStart = i + 30, dataStart = nameStart + nl + el;
      var name = new TextDecoder('utf-8').decode(b.subarray(nameStart, nameStart + nl));
      out[name] = new TextDecoder('utf-8').decode(b.subarray(dataStart, dataStart + size));
      i = dataStart + size;
    }
    return out;
  };

  T.downloadZip = function (name, files) {
    var url = URL.createObjectURL(T.zip(files));
    var a = document.createElement('a');
    a.href = url;
    a.download = String(name || 'export').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  };

  /* 选一个 json → 解析 → cb(obj)；任何一步失败都走 onErr(人话) */
  T.pick = function (cb, onErr) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.zip,application/json,application/zip';
    inp.hidden = true;
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      /* ★2026-11-09：导出现在给的是 zip（里面同时有 JSON 和说明书 MD），
         所以这里要能吃 zip：按字节判断，PK 开头就解包，从里面找 .json 那条。
         只认 STORE（我们自己写的），别人用 deflate 压的包会说人话拒绝，不静默失败。 */
      var r = new FileReader();
      r.onload = function () {
        var text = null;
        try {
          var bytes = new Uint8Array(r.result);
          var isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4B;
          if (isZip) {
            var files = T.unzip(r.result);
            if (!files) { onErr('这个 zip 是压缩过的，解不开。用本系统导出的包'); return; }
            var key = Object.keys(files).filter(function (k) { return /\.json$/i.test(k); })[0];
            if (!key) { onErr('zip 里没有能力包 JSON'); return; }
            text = files[key];
          } else {
            text = new TextDecoder('utf-8').decode(bytes);
          }
        } catch (e) { text = null; }
        var obj = null;
        try { obj = JSON.parse(String(text)); } catch (e) { obj = null; }
        if (!obj) { onErr('这个文件不是本系统导出的（读不出 JSON）'); return; }
        cb(obj);
      };
      r.onerror = function () { onErr('文件没读出来，换一个再试'); };
      r.readAsArrayBuffer(f);
    });
    /* 用户取消选文件时 change 不会触发 —— 不接这条，每取消一次就在 body 里留一个孤儿 input */
    inp.addEventListener('cancel', function () { inp.remove(); });
    inp.click();
  };

  window.Transfer = T;
})();
