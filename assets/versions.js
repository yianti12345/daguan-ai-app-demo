/* 历史版本页（2026-10-31 按 00e《版本与授权模型》重写口径）
   ─ 用户口径（00e，逐条落地）────────────────────────────────────────────
   「配置完＝产出一个新版本，这个新版本不会自动给客户；
     要推给客户，必须去授权页手动升级，授权绑的是某一个具体版本。」

   所以这一页只做三件事：
   ① 把"存过的版本"画成一张真表（版本 / 状态 / 保存时间 / 操作）；
   ② 每行的动作叫「替换」：把这一版的内容写回画布，**不动客户被授权的那一版**，也不改版本号 ——
      新的一版要用户点「存成新版本」才产生；
   ③ 回到之前说清后果：覆盖什么、哪些改动会丢、客户为什么不受影响。

   ★命名（2026-10-31，同一个"冻住一版"的动作原来有四种叫法）：
     应用页叫「发布给客户」、组件页叫「保存」、列表页叫「版本管理」、这一页原来叫「恢复此版」。
     本页把它统一收在「版本」这一个词上 —— 页面叫「历史版本」，冻一版叫「保存为新版本」，
     回到旧的一版叫「回到这一版」；本页动作名里不再出现「发布」「恢复」。
     （空态要点名画布顶栏那颗按钮时，按它脸上真实的字写，那是"引用"不是"命名"。）

   ★2026-11-02（m00536 的判断：这不是「回到」某一版 —— 版本号不该往回走，
     这一下只是取用那一版的代码与数据，要留下新版本得另存）：
     动作名从「回到这一版」改成「替换」，查看那颗从「查看这一版」改成「查看」。
     两个理由：①「回到」暗示版本号会倒退，而模型里版本只往前走 —— 这一下只换画布内容，
     要留痕必须再点「存成新版本」；②一行里两颗按钮原来都四个字、只隔 6px，读起来分不出轻重。

   数据怎么写入、唯一 active 怎么保证，全在 data.js 的台账里（唯一写入口）。
*/
window.Versions = (function () {
  'use strict';
  var S = { scope: 'app', id: '', kw: '' };

  function $(s) { return document.querySelector(s); }
  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  /* 轻提示的唯一实现在 assets/ui-kit.js（2.5 秒 · 新消息替换旧 · 错误升级 alert）。
     本页只留别名，不再自己维护一份分叉的计时器。 */
  var toast = window.UIK.toast;

  function owner() {
    return S.scope === 'app' ? DB.appById(S.id) : DB.compById(S.id);
  }

  /* 未入档的改动：自动保存在背后一直写，用户看不到它写过什么。
     这里只做一件事——把"上次保存快照之后攒下的改动"列出来，每条能退回。
     只对应用有意义（组件页的改动本来就少，不铺这一层）。
     ★2026-10-28（E3c）：按钮的身份从时间戳换成 uid。同一毫秒连写两条时时间戳相同，
     点"最旧那条"会静默退掉最新一条 —— 身份必须是不可重复的键，不能是时间。
     uid 由 data.js 的改动流水在写入时给；老记录在 DB.changesOf 读的时候已补齐。 */
  function paintChg() {
    var box = $('#chg-box'), list = $('#chg-list'), tip = $('#chg-tip');
    if (!box) return;
    var rows = (S.scope === 'app' && S.id) ? DB.changesOf('app', S.id) : [];
    /* ★2026-11-02：流水条数不等于"有未保存内容"。改回原样后内容与最新快照一致，
       这些步骤已经没有可退的意义 —— 收起来，并把净零流水清掉（否则下次真改动会带着旧步数）。 */
    if (!rows.length) { box.hidden = true; return; }
    box.hidden = false;
    if (tip) tip.textContent = '（' + rows.length + ' 步）保存后清零';
    list.innerHTML = rows.map(function (r) {
      return '<div class="chg-row" role="listitem">' +
        '<span class="chg-t">' + esc(r.clock || '') + '</span>' +
        '<span class="chg-b">' + esc(r.label || '改了内容') + '<em>' + esc(r.actor || '你') + '</em></span>' +
        '<button class="vl-btn is-quiet" type="button" data-undo="' + esc(r.uid || '') + '">退回</button>' +
      '</div>';
    }).join('');
  }

  function undoTo(uid) {
    var list = DB.changesOf('app', S.id);
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].uid) === String(uid)) { idx = i; break; }
    if (idx < 0) { toast('这一步已经不在了', 'error'); return; }
    var run = function () {
      var r = DB.changeUndo('app', S.id, uid);
      if (!r) { toast('退回失败，内容没动', 'error'); return; }
      paint();
      toast(idx ? '已退回 · 之后 ' + idx + ' 步一起退掉' : '已退回上一步');
    };
    if (idx > 0) {
      Confirm.ask({
        title: '退回到这一步之前？',
        body: '这一步之后还有 ' + idx + ' 步改动，会一起退掉。',
        ok: '退回',
        onOk: run
      });
    } else run();
  }

  function paint() {
    var o = owner();
    var list = DB.versOf(S.scope, S.id);

    $('#owner').textContent = o ? o.name : '这一项已经不在了';
    /* ★2026-11-04 二改：副标题（介绍）与「当前版本 vN」状态行已按用户要求删除 ——
       表格里的高亮行 + 状态列已经在回答"哪一版是当前"。
       右上跳转按钮（go-config）也删了：这一页只做一件事，不放第二件事的入口。 */

    var rows = list.filter(function (r) {
      if (!S.kw) return true;
      return ('v' + r.v).toLowerCase().indexOf(S.kw.toLowerCase()) >= 0;
    });

    var box = $('#list');
    /* ★2026-11-04 根治 C 类（_reports/根因分析-20261104.md）：
       表头 / 列宽 / 行骨架 / 空态交给 List（assets/list.js）一处定义，
       这一页只声明四列各自取什么、行里有什么动作。 */
          /* ★2026-11-04 根治 C 类（_reports/根因分析-20261104.md）：
         表头 / 列宽 / 行骨架 / 空态交给 List（assets/list.js）一处定义，
         这一页只声明四列各自取什么、行里有什么动作。 */
      /* ★ 根治 C：列、列宽、主对象、状态机、真源全部来自 assets/spec.js 一处，
         本页只给「这一屏的数据」和「每格怎么画」。改规格先改 spec.js，页面自动跟。 */
      List.render(SPEC['versions.html'], {
        table: '.vl-table', head: '#head', body: '#list', total: '#total',
        rows: rows,
      /* 空态文案：让用户去点的按钮必须写页面上的真名（2026-10-31 第 2 条的教训）。 */
      empty: function () {
        return '<div class="vl-empty"><b>' + (S.kw ? '没有符合条件的版本' : '还没有版本') + '</b>' +
          (S.kw ? '清掉搜索词，或换个版本号再试。'
                : (S.scope === 'app'
                    ? '在画布顶栏点「保存新版本并发布」。'
                    : '在画布顶栏点「保存并发布版本」，这里会出现第一个版本。')) + '</div>';
      },
        rowClass: 'vl-row gtable-row',
        rowExtra: function (r) { return r.active ? 'is-now' : ''; },
        rowAttr: function (r) { return ' data-kind="stable" data-ver="' + r.v + '"'; },
        cell: function (key, r) {
          if (key === 'v') return '<b>v' + esc(r.v) + '</b>';
          if (key === 'st') return r.active
            ? '<span class="vl-on">当前版本</span>'
            : '<span class="vl-off">历史版本</span>';
          if (key === 'at') {
            var atRaw = String(r.at || '');
            /* 到分；老快照没有时分就只给日期，不在格子里补解释 */
            return atRaw ? atRaw.replace(/ --:--:--$/, '').replace(/:\d{2}$/, '') : '—';
          }
          if (key === 'ops') {
            var viewBtn = (S.scope === 'app')
              ? '<a class="vl-btn is-quiet" href="app.html?id=' + encodeURIComponent(S.id) + '&v=' + r.v + '&mode=view" target="_blank" rel="noopener">查看</a>'
              : '<a class="vl-btn is-quiet" href="component.html?id=' + encodeURIComponent(S.id) + '&v=' + r.v + '" target="_blank" rel="noopener">查看</a>';
            /* 用户定口径（2026-11-04）：升级与恢复都只改应用版本，不动客户授权；
               这个动作的真实行为是"拿旧版内容生成一个新版本"，按钮就叫它干的事。 */
            return viewBtn + (r.active ? '' :
              '<button class="vl-btn is-main" type="button" data-a="act" data-v="' + r.v + '">复制为新版本</button>');
          }
          return '';
        },
        empty: function () { return '<div class="vl-empty"><b>' + (S.kw ? '没有符合条件的版本' : '还没有版本') + '</b></div>'; },
      });

    /* ★2026-11-04（用户：「狗屎没意义的提示」）：
       「共 5 个版本」一屏数得出来，删掉。只剩两种真需要说的：筛出几个、有没有到保留上限。 */
    /* 2026-11-04 按真源改：表尾常驻「第 1-N 条/共 M 条」，右侧「10 条/页」。
       之前把「共 N 个版本」删掉是对的（一屏数得出来），但把整条表尾也 hidden 掉了，
       于是只有 1 行时页面下方是 600px 空白、列表没有收口 —— 真源不这样。
       分页统计不是冗余提示，它是列表的骨架；搜索时 N 变 M 不变，筛选结果自己说清。 */
    var msgs = ['第 1-' + rows.length + ' 条/共 ' + list.length + ' 条'];
    var max = (window.DB && DB.MAX_VERS) || 60;
    if (list.length >= max) msgs.push('最多保留 ' + max + ' 份，更早的已自动清理');
    var totalEl = $('#total');
    if (totalEl) {
      totalEl.textContent = msgs.join(' · ');
      if (totalEl.parentNode) totalEl.parentNode.hidden = false;
    }
    paintChg();
  }

  function doRestore(want) {
    var before = DB.versOf(S.scope, S.id).filter(function (x) { return x.kind === 'stable'; });
    var was = before.reduce(function (m, x) { return Math.max(m, x.v); }, 0);
    var out = DB.versRestoreForward(S.scope, S.id, want);
    paint();
    if (out.error) {
      /* 三种失败分开说：版本没了 / 没存内容 / 写不进去 */
      toast(out.error === 'gone' ? '这一版已经不在了'
        : out.error === 'no-snap' ? '这一版当时没有存内容，生成不了新版本'
        : '没生成新版本，改动只在这次会话里', 'error');
      return;
    }
    toast('已按 v' + out.from + ' 生成 v' + out.to + ' · 客户授权版本未动');
  }

  function act(what, v) {
    if (what !== 'act') return;
    var want = Number(v);
    var next = DB.versNext(S.scope, S.id);
    var latest = DB.versOf(S.scope, S.id).reduce(function (m, x) {
      return x.kind === 'stable' ? Math.max(m, x.v) : m;
    }, 0);
    /* ★2026-11-04（m06113 需求二）：用户要的是"弹窗"，不是行内第二行字。
       文案按需求原样：来源版 / 新版本号 / 旧版仍在历史里；确认后才生成。 */
    Confirm.ask({
      title: '把 v' + want + ' 复制成新版本？',
      /* ★2026-11-04：原文「系统将基于 vN 版本为您生成全新的 vM 版本并发布生效」是公文腔，
         还漏了最要紧的一句 —— 客户那边看到的就是 vM。现在说人话，把「什么时候生效、谁看见」讲清。 */
      /* ★2026-11-04（用户定口径）：升级与恢复都只改应用的版本存档，不动客户授权的版本。
         原文「客户打开应用看到的就是 vN」在多客户模型下是假话 —— 每家客户各停一版，
         一次复制不可能让所有人都变。这句必须删掉，换成"客户那边不受影响"。 */
      body: '确认后按 v' + want + ' 的内容生成当前版本 v' + next + '。'
          + '客户授权的版本不受影响 —— 要让客户用上 v' + next + '，到客户授权页升级。'
          + 'v' + latest + ' 仍留在历史里。',
      ok: '生成 v' + next,
      onOk: function () { doRestore(want); }
    });
  }

  function boot() {
    DB.load();
    var q = new URLSearchParams(location.search);
    var rawScope = q.get('scope');
    S.scope = rawScope === 'comp' ? 'comp' : 'app';
    /* ★2026-11-02（独立前端审计）：scope=zzz 原来静默退回应用视图，
       一条参数写错的链接会看起来"正常打开了另一个东西"。参数在场但不认识就报错。 */
    S.badScope = !!rawScope && rawScope !== 'app' && rawScope !== 'comp';
    S.id = q.get('id') || '';

    if (S.badScope || !S.id || !owner()) {
      /* 2026-11-01（体检 C12）：原来是四句话在说同一件事
         （标题「这一项已经不在了」+ 副标题「链接过期或被删除了」+ 空态标题「没有可显示的版本」
          + 空态正文「回到…重新选一项」）。合成一句。 */
      /* 2026-11-05 体检：这两行原来直接赋值，而 versions.html 里没有 #owner-sub / #now-t，
         boot 在这里抛 TypeError，后面的绑定全部不执行（页面看着在、点是死的）。 */
      var _o = $('#owner'); if (_o) _o.textContent = S.badScope ? '链接参数不对' : '这一项已经不在了';
      var _s = $('#owner-sub'); if (_s) _s.textContent = '';
      var _n = $('#now-t'); if (_n) _n.textContent = '';
      var hd = $('#head'); if (hd) hd.hidden = true;
      /* 2026-11-06：原来这里只有一句「回应用管理重新选一项。」—— 空态没有可点的出口，
         用户得自己翻左侧菜单找。R16 的要求是空态自带出口。 */
      var backTo = S.scope === 'app' ? 'app-manage.html' : 'components.html';
      var backName = S.scope === 'app' ? '应用管理' : '组件库';
      $('#list').innerHTML = '<div class="vl-empty">这一项已经不在了。<a href="' + backTo + '">回'
        + backName + '重新选一项</a>。</div>';
      var _t = $('#total'); if (_t) _t.textContent = '';
      /* 2026-11-04：原来这里还要把右上那颗按钮改成「回到应用管理」。
         按钮已删，回列表只剩空态里那一句 + 面包屑，两个入口都指向真实列表页。 */
      return;
    }

    document.addEventListener('click', function (e) {
      var u = e.target.closest('[data-undo]');
      /* uid 是字符串，不是数字 —— 原来 parseInt 把毫秒戳转成数字再比，
         既丢了"同毫秒"这个歧义，也让键彻底绑死在时间上。 */
      if (u) { undoTo(u.getAttribute('data-undo')); return; }
      var b = e.target.closest('[data-a]');
      if (!b) return;
      act(b.getAttribute('data-a'), b.getAttribute('data-v'));
    });

    $('#kw').addEventListener('input', function (e) {
      S.kw = (e.target.value || '').trim();
      paint();
    });

    /* 2026-10-27 用户口径：产品里没有"复制客户链接"这一步。
       搭好之后是「上架 / 下架」授权给客户，链接不是产品概念 —— 这个入口已撤。 */
    paint();
  }

  return { boot: boot };
})();