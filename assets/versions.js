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
  var S = { scope: 'app', id: '', kw: '', pending: null };

  function $(s) { return document.querySelector(s); }
  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;
  /* 轻提示的唯一实现在 assets/ui-kit.js（2.5 秒 · 新消息替换旧 · 错误升级 alert）。
     本页只留别名，不再自己维护一份分叉的计时器。 */
  var toast = window.UIK.toast;

  function cfgHref() {
    return (S.scope === 'app' ? 'app.html?id=' : 'component.html?id=') + encodeURIComponent(S.id);
  }

  function owner() {
    return S.scope === 'app' ? DB.appById(S.id) : DB.compById(S.id);
  }

  /* ── 后果怎么说：只说会发生什么，不写"确认操作吗" ──
     ★2026-10-31（00e）：动作从"恢复此版"改成"回到这一版"后，后果也变了 ——
     它只覆盖画布内容，**不改客户被授权的那一版**。旧文案说"客户会立刻看到 vN"，
     那是旧模型（发布即上线）的话，与新动作不符。 */
  function impactOf(rec) {
    var cur = DB.versActive(S.scope, S.id);
    if (S.scope === 'app') {
      var has = !!(rec.snap && rec.snap.content);
      return '会把画布换成 <b>v' + rec.v + '</b> 这一版' +
        (has ? '：装配、每块的内容和应用信息一起覆盖。' : '：这一版当时没有存内容 —— 只有装配清单和应用信息换得回来，块里的内容不会还原。') +
        ' <b>还没保存的改动会丢</b>，没有第二份。' +
        /* 2026-11-02：用户把这件事说成「用某个版本的代码及数据再新建一版」。
           所以这里必须点破"这一下不改版本号"——替换本身不产版本，产版本的是「存成新版本」。 */
        ' 版本只往前走：这一下不改版本号，点「存成新版本」才会多出新的一版。' +
        /* 2026-11-01：原来后半句是「要客户看到这一版，必须去授权页升级」——
           这是教用户操作另一个页面，属提示性语言；而且它管那一页叫「授权页」，
           那页自己叫「客户授权」。删掉，只说这一下会动什么。 */
        /* ★2026-11-02（一应用多客户）：不再有"这个应用的授权版本"这一个数。
           替换只动画布，授权记录一条都不动 —— 各家客户还是各自那一版。 */
        ' 客户不受影响：授权记录一条都不动，各家客户还是各自那一版。';
    }
    var n = DB.APPS.filter(function (a) { return (a.comps || []).indexOf(S.id) >= 0; }).length;
    return '会把这一块的内容换成 <b>v' + rec.v + '</b> 的字段与规格，并把它标成当前可装配版本。' +
      ' 版本只往前走：这一下不改版本号。' +
      ' <b>还没保存的改动会丢</b>，没有第二份。' +
      (n
        ? '客户不受影响：装了它的 <b>' + n + '</b> 个应用各自留着当时的副本，不会跟着变；要让它们用上这一版，得在应用里更新组件、再重新授权升级。'
        : '客户不受影响：还没有应用装它。');
  }

  /* 「· N 家客户 · M 家待升级」—— 应用不再有单一授权版本，能说的事实就是家数。
     没有授权就不写，别在版本页喊"还没有客户"。 */
  function appAuthLine() {
    try {
      var list = DB.authRows(S.id).filter(function (r) { return r.status === '已授权'; });
      if (!list.length) return '';
      var behind = list.filter(function (r) { return r.behind; }).length;
      /* ★2026-11-02：一个应用可以授权给多家，各家停在自己那一版 ——
         "客户在用 vN" 这个单数说法是假话（华信 v3、中信还停 v2）。
         能说的事实是分布：v3×2、v2×1。 */
      var by = {}, keys = [];
      list.forEach(function (r) {
        var k = 'v' + r.version;
        if (!by[k]) { by[k] = 0; keys.push(k); }
        by[k]++;
      });
      keys.sort(function (x, y) { return parseInt(y.slice(1), 10) - parseInt(x.slice(1), 10); });
      var mix = keys.map(function (k) { return k + '×' + by[k]; }).join('、');
      return ' · 授权 ' + list.length + ' 家客户（' + mix + '）' + (behind ? ' · ' + behind + ' 家待升级' : '');
    } catch (e) { return ''; }
  }

  function statusLine(list) {
    var act = list.filter(function (r) { return r.kind === 'stable' && r.active; })[0] || null;
    var stables = list.filter(function (r) { return r.kind === 'stable'; });
    if (act) {
      var compImpact = '';
      if (S.scope === 'comp') {
        var u = DB.APPS.filter(function (a) { return (a.comps || []).indexOf(S.id) >= 0; }).length;
        compImpact = u ? ' · 它现在被 <b>' + u + '</b> 个应用装着' : ' · 还没有应用装它';
      }
      return { off: false, html: S.scope === 'app'
        /* ★2026-11-02：原来这里写「最新存档 v3」，而页头「最新 v4」是 latestVer —— 两个"最新"。
           现在分工写死：页头说**存档**最新（v4）；这里说**画布上编辑的是**哪一版（v3），
           客户各用哪版由 appAuthLine 给分布。 */
        ? ('编辑中的版本 <b>v' + act.v + '</b>' + appAuthLine())
        : '<b>v' + act.v + '</b> 是当前可装配的版本' + compImpact };
    }
    if (stables.length) {
      return { off: true, html: S.scope === 'app'
        ? '当前没有可装配版本 · 最近保存过的是 <b>v' + stables[0].v + '</b>'
        : '当前没有启用版本 · 最近一版是 <b>v' + stables[0].v + '</b>' };
    }
    return { off: true, html: S.scope === 'app'
      ? '还没保存过版本 · 画布改动已自动保存'
      : '还没有保存过版本' };
  }

  /* ── 一版改了什么（★2026-10-31 修"12 行全写第一版"）────────────────────
     只用快照里真实存在的东西：保存时算好的 summary、装配清单、字段表。
     ① 种子快照把每一版都写成「第一版」——v3 也叫第一版，这是假话，一律不显示；
     ② 有更早的版本可却没有摘要 ⇒ 差在哪算不出来，写「—」，不猜；
     ③ 没有更早的版本可比 ⇒ 只报这一版真实装了什么（这是事实，不是差异）。 */
  function changeOf(r, older) {
    var snap = r.snap || null;
    if (!snap) return '';
    var own = DB.plain(snap.summary ? String(snap.summary) : '');
    if (own && !/^第一版$/.test(own)) return own;
    var fact = '';
    if (S.scope === 'app') {
      if (Array.isArray(snap.comps)) fact = '装配 ' + snap.comps.length + ' 块';
    } else if (Array.isArray(snap.fields)) {
      fact = snap.fields.length + ' 个字段';
    }
    if (older) return '';
    return fact ? '' + fact : '';
  }

  function rowOf(r, older) {
    var cfAct = S.pending === ('act:' + r.v);
    var cf = '';
    if (cfAct) {
      cf = '<div class="vl-cf"><span class="vl-cf-t">' + impactOf(r) + '</span>' +
        '<button class="vl-btn is-primary" type="button" data-a="do-act" data-v="' + r.v + '">用 v' + r.v + ' 替换</button>' +
        '<button class="vl-btn" type="button" data-a="cancel">取消</button></div>';
    }

    /* ★2026-10-28（产品判断第 8 位 E6）：组件 scope 原来没有「查看这一版」，
       要看旧版只能先恢复——那就变成"为了看一眼而改掉线上"。 */
    var viewBtn = (S.scope === 'app')
      ? '<a class="vl-btn is-quiet" href="app.html?id=' + encodeURIComponent(S.id) + '&v=' + r.v + '&mode=view" target="_blank" rel="noopener">查看</a>'
      : '<a class="vl-btn is-quiet" href="component.html?id=' + encodeURIComponent(S.id) + '&v=' + r.v + '" target="_blank" rel="noopener">查看</a>';
    /* ★2026-10-31（第 5 条：缺"回到某一版"的入口）：每一行都给这个动作，
       包括当前那一行 —— 画布可能已经改得和它不一样了，"回到这一版"仍然是唯一的回头路。
       动作名统一叫「回到这一版」（原叫「恢复此版」，与别处三种叫法打架，见文件头命名说明）。 */
    var ops = cfAct ? '' : (
      viewBtn + '<button class="vl-btn is-main" type="button" data-a="act" data-v="' + r.v + '">替换</button>'
    );

    /* ★2026-11-02：老快照只能定到日，数据层补的是 "--:--:--"。那一串摆在页面上
       像坏掉的时间，用户第一眼就以为是 bug（"保存于 2026-10-30 --:--:--"）。
       数据层不改（不补 00:00:00，那等于编一个时刻），只改显示：说清楚时分没记。 */
    var atRaw = String(r.at || '');
    var atText = '保存于 ' + (atRaw ? atRaw.replace(/ --:--:--$/, '（时分未记）') : '—');
    /* ★2026-10-31（第 4 条：摘要全是「第一版」）：摘要＝版本号 · 保存人 · 这一版改了什么。
       ★2026-11-01（用户原话「什么叫保存人，最后编辑人不行吗」）：
       这一栏就叫**最后编辑人**。快照现在会写 snap.editor（app.js 存版时取 DB.editor()）；
       老快照没有这个字段就退回 actor，再取不到写「—」——**不拿「你」顶上，那是编的**。 */
    var who = (r.snap && (r.snap.editor || r.snap.actor)) || '';
    who = typeof who === 'string' && who ? who : '—';
    var summary = 'v' + r.v + ' · 最后编辑人 ' + who + ' · ' + (changeOf(r, older) || '—');

    /* ★2026-10-28（产品判断第 6 位 B9/D2）：摘要有数据，但原来只挂在悬停 title 上——
       "信息存在≠信息达"。改成行内可见的一行小字：这一版到底改了什么。 */
    return '<div class="vl-row gtable-row' + (r.active ? ' is-now' : '') + '" role="listitem" data-kind="stable"' +
             ' data-ver="' + r.v + '"' + (cfAct ? ' data-cf="1"' : '') + '>' +
        '<span class="vl-v"><b>v' + esc(r.v) + '</b></span>' +
        '<span>' + (r.active ? '<span class="vl-on">当前线上</span>' : '<span class="vl-off">历史</span>') + '</span>' +
        '<span class="vl-at">' + esc(atText) + '</span>' +
        '<span class="vl-o">' + ops + '</span>' +
        cf +
        '<p class="vl-sum">' + esc(summary) + '</p>' +
      '</div>';
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
    if (!DB.hasPending('app', S.id)) {
      DB.changesClear('app', S.id);
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (tip) tip.textContent = '（' + rows.length + ' 步）存成新版本后清零';
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
      if (!r) { toast('退回失败：这台电脑写不进去，内容没动', 'error'); return; }
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
    /* ★2026-11-02：副标题原来是 o.client —— 应用已不挂客户（一应用多家）。
       改成"最新 vN · M 家客户"，这一页真正在说的事。 */
    var topV = S.scope === 'app' ? (DB.latestVer(S.id) || 0) : 0;
    $('#owner-sub').textContent = o
      ? (S.scope === 'app'
          ? (topV ? ('存档最新 v' + topV + appAuthLine()) : ('还没存过版本' + appAuthLine()))
          : (o.desc || ''))
      : '';

    var st = statusLine(list);
    $('#now').setAttribute('data-off', st.off ? '1' : '0');
    $('#now-t').innerHTML = st.html;

    var go = $('#go-config');
    go.setAttribute('href', cfgHref());
    go.textContent = S.scope === 'app' ? '回到画布' : '去配置';

    var rows = list.filter(function (r) {
      if (!S.kw) return true;
      return ('v' + r.v).toLowerCase().indexOf(S.kw.toLowerCase()) >= 0;
    });

    var box = $('#list');
    if (!rows.length) {
      /* ★2026-10-31（第 2 条）：原来让用户去点「保存」，但画布页顶栏那颗按钮
         应用侧脸上写的是「发布给客户」（app.html:70）、组件侧写的是「保存」（component.html:316）。
         页面上找不到叫「保存」的按钮，用户只能猜 —— 这里改成那两颗按钮真实的字。 */
      box.innerHTML = '<div class="vl-empty"><b>' + (S.kw ? '没有符合条件的版本' : '还没有版本') + '</b>' +
        (S.kw ? '清掉搜索词，或换个版本号再试。'
              : (S.scope === 'app'
                  ? '在画布顶栏点「存成新版本」。'
                  : '在画布顶栏点「保存」，这里会出现第一个版本。')) + '</div>';
    } else {
      /* 摘要要跟"更早的那一版"比，所以把整张表（不受搜索影响）一起传下去 */
      box.innerHTML = rows.map(function (r) {
        var gi = list.indexOf(r);
        return rowOf(r, gi >= 0 ? list[gi + 1] : null);
      }).join('');
    }
    var totalText = S.kw
      ? '筛出 ' + rows.length + ' 个版本 · 共 ' + list.length + ' 个'
      : '共 ' + list.length + ' 个版本';
    var max = (window.DB && DB.MAX_VERS) || 60;
    if (list.length >= max) totalText += ' · 最多保留 ' + max + ' 份，更早的已自动清理';
    $('#total').textContent = totalText;
    paintChg();
  }

  function focusConfirm() {
    var b = document.querySelector('.vl-cf [data-a^="do-"]');
    if (b) { try { b.focus(); } catch (e) {} }
  }

  /* 「替换」＝把这一版的快照写回画布内容，**不动客户被授权的那一版**，也不改版本号。
     为什么不直接调 DB.versApply：它顺手把这一版设成 active（＝客户立刻看到），
     与 00e 模型相反 —— 这一页是"历史版本"的地方，"推给客户"只在授权页做。
     data.js 没有导出"只还原、不授权"的那一半，所以这一段只能在这里写：
     还原顺序与 versApply 的内容分支一致，唯一的差别是最后不调 versActivate。
     一次 DB.save() 写完：写不进去就整件事失败，绝不报"已回到"。 */
  function restoreContent(rec) {
    var snap = (rec && rec.snap) || null;
    if (!snap) return null;
    var a = DB.appById(S.id);
    if (!a) return null;
    if (Array.isArray(snap.comps)) {
      var ids = snap.comps.filter(function (x) { return !!DB.compById(x); });
      a.comps.length = 0;
      ids.forEach(function (x) { a.comps.push(x); });
    }
    if (snap.name != null) a.name = snap.name;
    if (snap.desc != null) a.desc = snap.desc;
    if (snap.client != null) a.client = snap.client;
    if (snap.content && typeof snap.content === 'object') {
      a.content = JSON.parse(JSON.stringify(snap.content));
    }
    /* "被 N 个应用装着"是组件卡上可见的数字：装配清单变了就要跟着重算
       （data.js 的 versApply 里由 recomputeRefs 做同一件事，但它没导出）。 */
    DB.COMPS.forEach(function (c) {
      c.refs = DB.APPS.filter(function (x) { return x.comps.indexOf(c.id) >= 0; }).length;
    });
    return DB.save() ? rec : null;
  }

  function act(what, v) {
    if (what === 'cancel') { S.pending = null; paint(); return; }
    if (what === 'act') { S.pending = 'act:' + v; paint(); focusConfirm(); return; }
    if (what === 'do-act') {
      var want = Number(v);
      var row = DB.versOf(S.scope, S.id).filter(function (x) { return x.kind === 'stable' && x.v === want; })[0] || null;
      if (!row) { S.pending = null; paint(); toast('这一版已经不在了', 'error'); return; }
      var rec = S.scope === 'comp' ? DB.compEnable(S.id, want) : restoreContent(row);
      S.pending = null;
      paint();
      if (!rec) {
        /* 两种失败分开说：没存内容 vs 写不进去 */
        toast((S.scope === 'app' && !row.snap)
          ? '这一版当时没有存内容，换不过去'
          : '没换成 v' + want + '：这台电脑写不进去，改动只在这次会话里', 'error');
        return;
      }
      /* compEnable 回的是组件对象（没有 .v），版本号用点的那一版，别拿对象去拼字符串 */
      if (S.scope === 'comp') { toast('已换成 v' + want + ' 的内容 · 现在是可装配版本'); return; }
      toast('已换成 v' + rec.v + ' 的内容 · 客户授权没动');
    }
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
      $('#owner').textContent = S.badScope ? '链接参数不对' : '这一项已经不在了';
      $('#owner-sub').textContent = '';
      $('#now-t').textContent = '';
      var hd = $('#head'); if (hd) hd.hidden = true;
      $('#list').innerHTML = '<div class="vl-empty">回' + (S.scope === 'app' ? '应用管理' : '组件库') + '重新选一项。</div>';
      $('#total').textContent = '';
      /* ★2026-10-31（第 1 条·阻断）：这里提前 return，paint() 里那段改写 href 的代码
         永远走不到，于是右上那颗按钮停在 HTML 的 href="#" —— 点下去页面纹丝不动。
         错误态下没有"画布"可回（这一项已经不在），所以改指向真实列表页，字也跟着改。 */
      var gone = $('#go-config');
      gone.setAttribute('href', S.scope === 'app' ? 'apps.html' : 'components.html');
      gone.textContent = S.scope === 'app' ? '回到应用管理' : '回到组件库';
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
      S.pending = null;
      paint();
    });

    /* 2026-10-27 用户口径：产品里没有"复制客户链接"这一步。
       搭好之后是「上架 / 下架」授权给客户，链接不是产品概念 —— 这个入口已撤。 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.pending) { e.stopPropagation(); S.pending = null; paint(); }
    });

    paint();
  }

  return { boot: boot };
})();
