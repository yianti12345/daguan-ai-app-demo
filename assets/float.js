/* float.js —— 配置页浮层的**唯一实现**：对话区（历史＋输入）/ 右下操作组 / 独立胶囊。
 *
 * ★ 2026-10-23 改（用户原话：「对话框大一些，然后再加个对话历史内容，可以收起来对话历史只显示对话框」）：
 *   对话区从「一条 56 高的输入条」变成「历史面板 + 输入条」。
 *   **收起的是历史，不是整个对话区** —— 输入条永远在。
 *   上一版的收起是整条缩成 64×4 短横，那是"把对话整个关掉"，跟用户要的不是一回事。
 *
 * 用法：
 *   Float.mount({
 *     dialog: { placeholder:'说要改什么', onSend(text){} },
 *     historyKey: 'comp:<id>',      // 可选，历史按 key 分开存（不传则共用一份）
 *     ops:    [...],                 // 可选，右下操作组（未传则不渲染）
 *     chip:   {...}                  // 可选，胶囊
 *   });
 *   返回挂在 mounted 上：addMsg(who, text) / setCollapsed(bool) / focusInput()
 *
 * 为什么历史存 localStorage 而不是内存：用户"边看边改"，一刷新就清空等于没历史。
 * 上限 60 条，超出丢最早的 —— 不设上限会让 localStorage 无限涨。
 */
(function () {
  'use strict';

  /* ★ 2026-10-28（体验官 F5）：这个键**只用于清理旧数据**，不再读写。
     它存的是"用户上次手动展开过"，于是跨页也会继承：在组件页展开一次，
     去组件库再回来，浮层仍是展开态、盖住 5 行表格。手动展开只算本页内的选择。 */
  var LS_COL = 'ifas90:histCollapsed';
  var MAX_MSG = 60;
  var MAX_CONV = 30;

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function sv(path, size) {
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  /* HTML 转义：唯一实现 assets/ui-kit.js（UIK.esc）；本文件只留别名，不再各写一份 */
  var esc = UIK.esc;

  var ICON = {
    send: sv('<path d="M12 19V5M5 12l7-7 7 7"/>', 15),
    up: sv('<path d="M6 15l6-6 6 6"/>', 15),
    down: sv('<path d="M6 9l6 6 6-6"/>', 15),
    /* 折叠条右侧的展开指示（F6）：面板向上展开，箭头朝上；12 是折叠条内字号档 */
    peekUp: sv('<path d="M6 15l6-6 6 6"/>', 15),
    /* 抓手 = 拖动把手，**不是 AI 标识**（2026-10-23 用户纠正）：
       小智是全局的操作代理，靠右下角那颗球进场；底部这条是「这一页的意图输入」，
       两者是完全不同的概念，视觉上必须能分开。
       六点网格（⠿）是拖动把手的标准符号，不会被看成 AI，也不会被看成菜单。 */
    grip: '<span class="fk-grip-ico"><i></i><i></i><i></i><i></i><i></i><i></i></span>',
    /* ★2026-11-04（m06113 需求三）：原生对话框也要能说，不只小智悬浮球。 */
    mic: sv('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>', 15)
  };

  /* ── 消息类型：决定"说完这句要不要收起"（2026-10-28 设计判定）──────
     判据不是篇幅，而是**末条要不要用户动作**：告知就收起，提问／报错就展开。
     只认关键词，不做语义猜测 —— 猜错的代价是浮层在用户正在读的时候自己合上。
     分类优先用调用方给的 kind（第三参）；没给才按正文判，app.js 那边不改也能用。 */
  var RE_ERR = /没搭成|没生成出来|没做成|没改成|失败|出错|连不上|没回应|超时|没法用|不完整|画布还是上一次/;
  var RE_ASK = /[？?]\s*$|要不要|是不是|还是先|选一个|哪一个|需要我|确认一下|可以吗|没听出|没说清/;
  var RE_RUN = /正在搭|正在生成|正在按你说|正在改|搭好直接看画布/;

  /* 返回 {kind, hold}：
     kind = notice（告知，可收）｜ask（提问，要答）｜error（报错）｜progress（进行中）。
     hold = 这句本身**带可点的下一步**（发布卡：查看这一版／恢复此版），收起来用户就够不着了。 */
  function classify(who, text, kind, hasCard) {
    var t = String(text == null ? '' : text).trim();
    if (kind) return { kind: kind, hold: kind === 'progress' || !!hasCard };
    if (who === 'me') return { kind: 'me', hold: true };
    if (hasCard) return { kind: 'notice', hold: true };
    if (RE_ERR.test(t)) return { kind: 'error', hold: false };
    if (RE_ASK.test(t)) return { kind: 'ask', hold: false };
    if (RE_RUN.test(t)) return { kind: 'progress', hold: true };
    return { kind: 'notice', hold: false };
  }

  var api = {
    mount: function (opts) {
      opts = opts || {};
      var dlg = opts.dialog || null;
      var ops = opts.ops || [];
      var chip = opts.chip || null;
      var histKey = opts.historyKey || 'ifas90:hist';
      var mounted = {};

      /* ── 对话区：历史 + 输入条 ─────────────────────────── */
      if (dlg) {
        var dock = el('div', 'fk-dock', { id: 'fk-dock' });
        var hist = el('div', 'fk-hist', { id: 'fk-hist' });

        /* 2026-10-30（用户：「直接在对话框上面展示有历史内容不行吗？有一个长条，
           可以收起展开」）：历史不再是一块"点开才出现、再点小箭头才收回"的面板。
           现在输入框上面永远有一条长条：左边末条摘要＋状态，右端一个箭头；
           展开时长条下面接列表，收起时整块只剩这条。 */
        var hd = el('div', 'fk-hist-hd');
        var col = el('button', 'fk-hist-col', { type: 'button', 'aria-label': '展开对话历史', title: '展开历史' });
        col.innerHTML = '<span class="js-fk-hist-col-tx">展开</span>' + ICON.up;
        hist.appendChild(hd);

        var list = el('div', 'fk-hist-list', { id: 'fk-hist-list', role: 'log', 'aria-live': 'polite' });
        hist.appendChild(list);

        var bar = el('div', 'fk-bar', { id: 'fk-bar', role: 'group', 'aria-label': '对话框' });

        /* ⚠ 抓手必须是 div[role=button]：drag.js 在 button/input/a/select/label 上直接 return，
           用 <button> 包一层的结果是"看起来有抓手、一丝都拖不动"（踩过两次）。 */
        var grip = el('div', 'fk-grip', { role: 'button', tabindex: '0', 'aria-label': '拖动对话区', title: '拖动' });
        /* 2026-10-30（用户：「拖拽操作没有样式」）：抓手原来只靠 cursor:grab 暗示，
           屏幕上是块空白，没人知道这里能拖。把六点网格画回来。 */
        grip.innerHTML = '<span class="fk-grip-ico" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
        /* 2026-10-25 用户：「别加多余的标注和描述，让布局自己说话」。
           原来这里画一颗六点方块，和右边的历史钮并排 —— 输入框左侧两个图标，
           用户分不清哪个是干什么，而且它占的是整条里最贵的视觉位置。
           拖动是次要操作：保留手势区（光标 grab）、不画图形，左侧只留历史一个入口。 */

        var ta = el('textarea', 'fk-ta', { id: 'fk-input', rows: '1', 'aria-label': dlg.placeholder || '说要改什么', placeholder: dlg.placeholder || '说要改什么' });
        var send = el('button', 'fk-send', { id: 'fk-send', type: 'button', 'aria-label': '发送', 'data-ready': 'false' });
        send.innerHTML = ICON.send;
        /* 2026-11-04 用户判定语音模式切换不好用，整颗按钮撤掉：
           语音只保留「说完转成文字 → 人确认点发送」这一种行为。 */
        var mic = el('button', 'fk-mic', {
          id: 'fk-mic', type: 'button', 'data-st': '', 'aria-label': '按下说话', 'aria-pressed': 'false', title: '按下说话'
        });
        mic.innerHTML = ICON.mic;

        /* ★ 2026-10-23：收起按钮在历史面板头部，而历史一收起整块就 display:none ——
           按钮跟着消失，于是"收起"之后再也打不开。用户原话：「对话历史的收起展开呢」。
           修法：输入条左侧常驻一个入口，收起时它是唯一入口；展开时隐藏（头部那个才是收起）。
           —— 收起与展开必须各有一个永远在场的入口，否则这个开关只有单向。
           ★ 2026-10-28：它从"一颗无字的图标钮"变成**折叠条**：常驻末条摘要 +
             状态（成功／待确认 N／失败）+ 未读点。收起态原来什么都没有，用户只能
             靠记忆判断"刚才那句做完没有"，于是每次都要点开看一眼再关上。
             折叠条长在输入条里、净增高 0 —— 收起态的全部意义是让表格能读，
             另起一行会再压住表格末几行（量过：多 32px 就落回行带上）。 */
        var histBtn = el('button', 'fk-hist-btn', {
          type: 'button', id: 'fk-hist-btn', 'aria-label': '对话历史', title: '对话历史',
          'aria-expanded': 'false', 'data-has': '0', 'data-st': 'ok', 'data-unread': '0'
        });
        /* ★2026-11-03（m05651）：这一行不再当“末条摘要 + 状态”的长条。
           用户要的是「历史对话」和「展开」并排的轻操作，不是一块占高度的描述条。
           状态/摘要保留在 DOM 里给读屏和旧逻辑用，视觉上隐藏。 */
        histBtn.innerHTML = '<span class="fk-peek-tt">历史对话</span>'
          + '<span class="fk-peek-st"><i class="fk-peek-dot" aria-hidden="true"></i><span class="js-fk-peek-stx"></span></span>'
          + '<span class="fk-peek-sum"></span>'
          + '<i class="fk-peek-unread" aria-hidden="true"></i>';
        /* 2026-10-30：这里原来还有一颗「⌃ 展开」，加上右端收起钮＝两个图标。
           用户要求（转述）：「为什么2个收起展开的图标」。现在整条只留右端那一个控件。 */
        var peekSt = histBtn.querySelector('.js-fk-peek-stx');
        var peekSum = histBtn.querySelector('.fk-peek-sum');
        var unread = 0;      /* 收起期间新到的条数；展开即清零 */
        var autoT = null;    /* 自动折叠的延迟句柄：中间有新消息/手动操作就作废 */

        hd.appendChild(histBtn); hd.appendChild(col);
        /* 2026-10-30（用户：「对话历史展开不应该向上吗？」）：列表放在长条**上面**。
           长条贴着输入框，展开时长出来的是上方历史 —— 原来列表在长条下面，
           视觉上就是从长条往下撑，方向和用户预期相反。 */
        hist.appendChild(list); hist.appendChild(hd);
        /* ★2026-11-03（m05651）：历史入口从输入条左侧的时钟图标移到上方
           「历史对话」文字，和「展开」并排；输入条左侧不再放第二个历史入口。 */
        bar.appendChild(grip); bar.appendChild(ta); bar.appendChild(mic); bar.appendChild(send);
        /* ★2026-11-04 附件：回形针占输入条里一个 28px 的横向槽位，不增高（这条 bar 净增高 0 是硬约束）。
           芯片区放在输入条上方，没选文件时 display:none，不占任何高度。 */
        var attBar = document.createElement('div');
        attBar.className = 'uik-att-bar';
        var att = UIK.Attach.create(attBar);
        bar.insertBefore(att.button, mic);
        att.onChange(sync);
        dock.appendChild(hist); dock.appendChild(attBar); dock.appendChild(bar);
        document.body.appendChild(dock);
        att.bindDrop(dock);
        mounted.bar = bar;
        mounted.dock = dock;

        /* ── 历史（2026-11-02：单条历史升级为多会话）──────────────
           用户要的和小智一致：时钟图标 → 一条条历史（每条有名字）→ 同一个弹窗里看详情。
           旧键 histKey（单条数组）继续写一份，别的页面/旧版本还能读；
           会话正文存 histKey + ':convs'，结构 {v:1,cur,convs:[{id,at,msgs}]}。
           ★ msgs 必须始终是当前会话的**同一个数组引用**：原来 slice 会换数组，
             后续 push 就写到一份脱钩的副本里，历史列表永远不动。 */
        var CONV_KEY = histKey + ':convs';
        var convs = [], curId = '', histView = 'chat', detailId = '';
        function uid(){ return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
        function blankConv(){ return { id:uid(), at:Date.now(), msgs:[] }; }
        function curConv(){
          for (var i = 0; i < convs.length; i++) if (convs[i].id === curId) return convs[i];
          return convs[0] || null;
        }
        function loadConvs(){
          var data = null;
          try { data = JSON.parse(localStorage.getItem(CONV_KEY) || 'null'); } catch (e) { data = null; }
          if (data && data.convs && data.convs.length){
            convs = data.convs.filter(function(c){ return c && Array.isArray(c.msgs); })
              .slice(0, MAX_CONV).map(function(c){
                return { id:String(c.id || uid()), at:+c.at || Date.now(), msgs:c.msgs.slice(-MAX_MSG) };
              });
            curId = data.cur || '';
          }
          if (!convs.length){
            var old = [];
            try { old = JSON.parse(localStorage.getItem(histKey) || '[]') || []; } catch (e) { old = []; }
            if (old.length) convs = [{ id:uid(), at:Date.now(), msgs:old.slice(-MAX_MSG) }];
          }
          if (!convs.length) convs = [blankConv()];
          var c = null;
          for (var i = 0; i < convs.length; i++) if (convs[i].id === curId) c = convs[i];
          if (!c) c = convs[0];
          curId = c.id;
          msgs = c.msgs;
        }
        var msgs = [];
        loadConvs();

        function save() {
          try {
            var payload = { v:1, cur:curId, convs:convs.slice(0, MAX_CONV).map(function(c){
              return { id:c.id, at:c.at, msgs:c.msgs.slice(-MAX_MSG) };
            }) };
            localStorage.setItem(CONV_KEY, JSON.stringify(payload));
            localStorage.setItem(histKey, JSON.stringify(msgs.slice(-MAX_MSG)));
          } catch (e) {}
        }
        function touchCur(){
          var c = curConv();
          if (!c) return;
          c.at = Date.now();
          var i = convs.indexOf(c);
          if (i > 0){ convs.splice(i, 1); convs.unshift(c); }
        }
        function visibleConvs(){
          return convs.filter(function(c){
            return (c.msgs || []).some(function(m){ return m && m.who === 'me'; });
          });
        }
        function newConv(){
          var c = curConv();
          if (c && !(c.msgs || []).some(function(m){ return m && m.who === 'me'; })){
            histView = 'chat'; detailId = '';
            return;
          }
          var n = blankConv();
          convs.unshift(n);
          curId = n.id;
          msgs = n.msgs;
          histView = 'chat'; detailId = '';
          save();
        }
        /* ★2026-11-06（用户：「历史里躺着你好/111 这种测试遗留」）：
           原来历史只能新建、不能删 —— 演示前敲错一句就永久留在列表里。
           删单条与清空全部都写回 localStorage，刷新后不再出现。 */
        function delConv(id){
          var i = -1;
          for (var j = 0; j < convs.length; j++) if (convs[j].id === id){ i = j; break; }
          if (i < 0) return;
          var wasCur = convs[i].id === curId;
          convs.splice(i, 1);
          if (!convs.length) convs = [blankConv()];
          /* 删的是当前会话：接管到第一条，msgs 必须跟着换引用，
             否则后面的 addMsg 会往一个已经不在列表里的数组写。 */
          if (wasCur){ curId = convs[0].id; msgs = convs[0].msgs; }
          if (detailId === id) detailId = '';
          save();
        }
        function clearConvs(){
          convs = [blankConv()];
          curId = convs[0].id;
          msgs = convs[0].msgs;
          detailId = '';
          histView = 'list';
          save();
        }
        function cardHtml(c, ro) {
          if (!c) return '';
          var v = c.v ? 'v' + esc(c.v) : '';
          var at = c.at ? '<span class="fk-card-at">' + esc(c.at) + '</span>' : '';
          /* ★2026-11-02：历史卡会活过版本台账（清过存档、换过机器、重建过库），
             卡上还留着「查看这一版 / 恢复此版」，点了才报"找不到 vN"。
             渲染时就向台账核一次：这一版不在了，动作一概不给，改说事实。 */
          var gone = !!(c.v && typeof opts.versionExists === 'function' && !opts.versionExists(c.v));
          if (gone) return '<div class="fk-card is-gone">'
            + '<div class="fk-card-hd"><span class="fk-card-v">v' + esc(c.v) + '</span>' + at + '</div>'
            + '<p class="fk-card-sum">这一版已经不在了（版本记录被清过），不能再查看或恢复。</p>'
            + '</div>';
          /* 2026-10-27：卡上不再印内容指纹（8eea44e3 那种串）。
             业务人员看不懂它，它也不帮他做任何判断 —— 只是把卡面搞脏。 */
          var href = c.viewHref ? esc(c.viewHref) : '';
          /* 客户地址（2026-10-28 E44）：发布回执原来只有"已发布 vN"，
             用户在手机上打开客户链接这个动作全站没有任何屏幕入口。
             这里把完整地址印出来，旁边一颗「复制」；地址与「查看这一版」同一个版本号。 */
          var urlRow = c.url
            ? '<div class="fk-card-url"><code>' + esc(c.url) + '</code>'
              + (ro ? '' : '<button class="fk-card-btn" type="button" data-copy="' + esc(c.url) + '">复制</button>')
              + '</div>'
            : '';
          /* ro=true 是历史详情：只还原当时那一版的文字与地址，不给任何会改到当前状态的按钮。 */
          var cardOps = ro ? '' : '<div class="fk-card-ops">'
            + (href ? '<a class="fk-card-link" href="' + href + '" target="_blank" rel="noopener">查看这一版</a>' : '')
            + (c.v ? '<button class="fk-card-btn" type="button" data-restore-v="' + esc(c.v) + '">恢复此版</button>' : '')
            /* 2026-11-05：发布后还有客户停在旧版本时，这里直接给出口。
               前滚（发新版→推给客户）比回滚干净：版本号只增，客户侧也不会来回收缩。 */
            + (c.push && c.push.href
                ? '<a class="fk-card-link fk-card-push" href="' + esc(c.push.href) + '">还有 ' + (Number(c.push.n) || 0) + ' 家客户在旧版本 · 去推送</a>'
                : '')
            + '</div>';
          return '<div class="fk-card">'
            + '<div class="fk-card-hd"><span class="fk-card-v">' + v + '</span>' + at + '</div>'
            + '<p class="fk-card-sum">' + esc(window.DB && DB.plain ? DB.plain(c.summary) : (c.summary || '')) + '</p>'
            + urlRow
            + cardOps
            + '</div>';
        }
        function msgHtml(m, ro) {
          /* ★2026-11-06（用户原话：这条框是跟大模型对话，不是跟小智）：
             原来这里把每条非「我」的回复都署名「小智」，等于把『配置页的意图输入』
             和『全局操作代理小智』画成同一个角色。署名按产品判断去掉：
             对话框本身就是这一页的 AI，不引入第二个助手名。 */
          var who = m.who === 'me' ? '我' : '';
          /* ★2026-11-04：只丢了一个附件、没打字的这一轮，原来照样输出一个空的 <span>，
             屏幕上就是一个空气泡（用户截图里「我」下面那块空白）。没正文就不出气泡。 */
          var say = (m.text || '').trim();
          var body = m.card ? cardHtml(m.card, ro)
            : (say ? '<span class="fk-say">' + esc(say) + '</span>' : '')
              + (m.atts ? UIK.Attach.msgHtml(m.atts) : '');
          return '<div class="fk-msg' + (m.who === 'me' ? ' is-me' : '') + (m.card ? ' is-card' : '') + '">' +
            (who ? '<b>' + who + '</b>' : '') + body + '</div>';
        }
        function threadHtml(arr) {
          return (arr || []).map(function (m) { return msgHtml(m, true); }).join('');
        }
        function syncHistMode() {
          var on = histView !== 'chat';
          dock.classList.toggle('is-hist', on);
          histBtn.setAttribute('aria-label', '对话历史');
          histBtn.title = '对话历史';
        }
        function render() {
          syncHistMode();
          /* 空态只管聊天态；看历史列表时面板必须出现，否则点「历史对话」什么都不会发生。 */
          dock.classList.toggle('is-empty', histView === 'chat' && !msgs.length);
          if (histView === 'list') {
            list.innerHTML = UIK.hist.listHtml(visibleConvs(), curId);
            return;
          }
          if (histView === 'detail') {
            var dc = null;
            for (var i = 0; i < convs.length; i++) if (convs[i].id === detailId) dc = convs[i];
            if (!dc) { histView = 'list'; return render(); }
            list.innerHTML = UIK.hist.detailHtml(dc, threadHtml(dc.msgs));
            return;
          }
          /* ★2026-11-04（用户：「提示文案也不对」）：原来空态会渲染一整块白卡，
             里面只有一句「还没有对话。说一句要改什么，小智边做边给你看。」
             —— 这是解释句，且把"这页的对话是干什么的"印在了对话区里。
             没话说的时候不该有面板：这块地方直接不出现，输入框的占位符已经说明了一切。 */
          dock.classList.toggle('is-empty', histView === 'chat' && !msgs.length);
          if (!msgs.length) { list.innerHTML = ''; return; }
          list.innerHTML = msgs.map(function (m) { return msgHtml(m, false); }).join('');
          list.scrollTop = list.scrollHeight;
        }
        function syncHistIco() {
          syncHistMode();
          histBtn.setAttribute('aria-pressed', histView === 'chat' ? 'false' : 'true');
        }
        function toggleHist() {
          histView = histView === 'chat' ? 'list' : 'chat';
          detailId = '';
          setCollapsed(false);
          render();
          syncHistIco();
          if (histView === 'chat') ta.focus();
          else setTimeout(function () {
            var f = list.querySelector('.hist-item');
            if (f) f.focus();
          }, 0);
        }
        /* ── 折叠条的内容：末条摘要 + 状态 + 未读点 ───────────────
           状态取**末条**，不取"最后一句话里的情绪"：末条是告知＝成功、是提问＝
           待确认 N（N＝最后一次说话之后还压着几个问）、是报错＝失败、进度中＝进行中。
           摘要取不到（只有卡、没写字）时退回「小智」+ 状态，不留一个空条。 */
        function pendingAsks() {
          var n = 0;
          for (var i = msgs.length - 1; i >= 0; i--) {
            var x = msgs[i];
            if (x.who === 'me') break;
            var k = x.kind || classify(x.who, x.text, null, !!x.card).kind;
            if (k === 'ask') n++;
          }
          return n;
        }
        function peekState() {
          if (!msgs.length) return null;
          var m = msgs[msgs.length - 1];
          var k = m.kind || classify(m.who, m.text, null, !!m.card).kind;
          var st = k === 'error' ? 'err' : (k === 'ask' ? 'ask' : (k === 'progress' ? 'run' : 'ok'));
          var sum = String(m.text || (m.card && m.card.summary) || '').replace(/\s+/g, ' ').trim();
          if (!sum) sum = '已回复';
          else if (m.who === 'me') sum = '我：' + sum;
          var label = st === 'err' ? '失败'
            : st === 'ask' ? ('待确认 ' + pendingAsks())
              : st === 'run' ? '进行中' : '成功';
          return { st: st, label: label, sum: sum };
        }
        function renderPeek() {
          var p = peekState();
          if (histView !== 'chat') {
            histBtn.setAttribute('data-has', '0');
            histBtn.setAttribute('data-unread', '0');
            syncHistMode();
            return;
          }
          histBtn.setAttribute('data-has', p ? '1' : '0');
          histBtn.setAttribute('data-unread', unread > 0 ? '1' : '0');
          if (!p) {
            histBtn.setAttribute('aria-label', '展开对话历史');
            histBtn.title = '对话';
            peekSt.textContent = '';
            peekSum.textContent = '';
            return;
          }
          histBtn.setAttribute('data-st', p.st);
          peekSt.textContent = p.label;
          peekSum.textContent = p.sum;
          /* 折叠条的读屏名＝眼睛看到的那三件，别只说"展开对话历史"让人还要点开才知道是什么状态 */
          histBtn.setAttribute('aria-label', '展开对话历史：' + p.label + ' · ' + p.sum);
          histBtn.title = p.label + ' · ' + p.sum;
        }

        /* 生成完先让最后一句真的落下来，再收 —— 同一帧就收，用户看到的是"闪了一下"。 */
        function scheduleCancel() {
          if (autoT) { clearTimeout(autoT); autoT = null; }
        }
        function scheduleCollapse(m) {
          scheduleCancel();
          /* ★2026-11-04（用户：「交互很诡异」）：原来任何一条回复都在 0.9 秒后自动收起。
             你刚打完一句话、自己那句还在面板里，回音一来面板就自己缩回去 —— 人还没读完，
             也来不及看见自己说了什么。现在只对「不是你问的」那种主动告知收起；
             你说过话的这一轮，面板留到你手动点收起或点「历史对话」为止。 */
          var prev = msgs[msgs.length - 2];
          if (prev && prev.who === 'me') return;
          autoT = setTimeout(function () {
            autoT = null;
            if (!m || msgs[msgs.length - 1] !== m) return;   /* 后面又来了新消息 ⇒ 以新的为准 */
            if (histView !== 'chat') return;                  /* 用户正在看历史，不许被自动折叠打断 */
            if (dock.getAttribute('data-hist') !== 'open') return;
            setCollapsed(true, 'auto');
          }, 900);
        }

        /* 每来一条消息判一次"该收还是该开"：
           告知 → 收起（把画布让出来）；提问／报错 → 展开（要用户动作）；
           进行中 → 不动（正在跑，收起反而看不见进度）；自己说的话 → 展开（先看见自己那句）。 */
        function applyArrival(m, c) {
          /* 历史列表/详情是只读视图：新消息只记账，不把用户从正在看的那一页拽走。 */
          if (histView !== 'chat') {
            if (m.who !== 'me') { unread++; renderPeek(); }
            return;
          }
          if (m.who === 'me') { setCollapsed(false); return; }
          var open = dock.getAttribute('data-hist') === 'open';
          if (c.hold || c.kind === 'ask' || c.kind === 'error') {
            setCollapsed(false);
            return;
          }
          if (c.kind === 'progress') {
            if (!open) { unread++; renderPeek(); }
            return;
          }
          if (!open) { unread++; renderPeek(); return; }
          scheduleCollapse(m);
        }

        /* ── 回到这一页时的默认态（F5）────────────────────────
           用户手动展开只算**本页内**的选择：跨页返回（含刷新）按末条重判，
           不继承上一页的展开状态 —— 展开的面板会盖住表格下半部，回来第一眼
           该看到画布，而不是上一次的对话。
           判据与 applyArrival 同一把尺：末条要用户动作（提问／报错／带可点
           下一步的卡）才展开；告知／进行中收起；自己刚说完那句留展开等回音。 */
        function defaultCollapsed() {
          if (!msgs.length) return true;
          var m = msgs[msgs.length - 1];
          var k = m.kind || classify(m.who, m.text, null, !!m.card).kind;
          if (m.who === 'me') return false;
          if (k === 'ask' || k === 'error') return false;
          if (m.card) return false;
          return true;
        }

        function addMsg(who, text, kind, atts) {
          if (!text && !(atts && atts.length)) return;
          var c = classify(who, text || '', kind, false);
          var m = { who: who, text: String(text || ''), kind: c.kind, t: Date.now() };
          if (atts && atts.length) m.atts = atts;
          msgs.push(m);
          if (msgs.length > MAX_MSG) msgs.splice(0, msgs.length - MAX_MSG);
          touchCur();
          save(); render();
          applyArrival(m, c);
        }
        /* 发布后的改动卡：版本号 + 一句人话 + 内容指纹 + 查看/恢复。
           存进同一条历史，刷新后还在；不是一条发完就散的 toast。
           ★ 2026-10-28：卡上带着「查看这一版／恢复此版／复制地址」，收起来就够不着了 ——
             它是**要用户点下一步**的那一类，永远不自动收。 */
        function addCard(card) {
          if (!card) return;
          var m = { who: 'cfg', text: card.summary || '', card: card, kind: 'notice', t: Date.now() };
          msgs.push(m);
          if (msgs.length > MAX_MSG) msgs.splice(0, msgs.length - MAX_MSG);
          touchCur();
          save(); render();
          applyArrival(m, { kind: 'notice', hold: true });
        }
        list.addEventListener('click', function (e) {
          /* 历史列表/详情里的动作先接住，再轮到普通消息里的复制/恢复。
             历史详情是只读的，所以这里只可能有 histOpen / histBack / histNew / histToggle，
             以及 2026-11-06 新加的 histDel（删这一条）/ histClear（清空全部）。 */
          var hb = e.target.closest ? e.target.closest('[data-act]') : null;
          if (hb) {
            var act = hb.getAttribute('data-act') || '';
            if (/^hist/.test(act)) {
              if (act === 'histOpen') {
                histView = 'detail'; detailId = hb.getAttribute('data-arg') || '';
                setCollapsed(false); render();
                var back = list.querySelector('.hist-back');
                if (back) back.focus();
              } else if (act === 'histBack') {
                histView = 'list'; detailId = ''; render();
                var first = list.querySelector('.hist-item');
                if (first) first.focus();
              } else if (act === 'histNew') {
                newConv(); setCollapsed(false); render(); syncHistIco(); ta.focus();
              } else if (act === 'histDel') {
                delConv(hb.getAttribute('data-arg') || detailId);
                histView = 'list'; detailId = '';
                render(); renderPeek(); syncHistIco();
                var it = list.querySelector('.hist-item');
                if (it) it.focus();
              } else if (act === 'histClear') {
                clearConvs();
                render(); renderPeek(); syncHistIco();
                var lg = list.querySelector('.hist-list');
                if (lg) lg.focus();
              } else if (act === 'histToggle') {
                toggleHist();
              }
              return;
            }
          }
          /* 复制客户地址：按钮文字当场变「已复制」——这是这条路径唯一的可见回执
             （组件配置页没有 #toast，不能靠轻提示）。 */
          var cp = e.target.closest ? e.target.closest('[data-copy]') : null;
          if (cp) {
            var label = cp.textContent;
            var done = function (ok) {
              cp.textContent = ok ? '已复制' : '复制失败';
              setTimeout(function () { cp.textContent = label; }, 1600);
            };
            if (window.UIK && UIK.copy) UIK.copy(cp.getAttribute('data-copy')).then(done);
            else done(false);
            return;
          }
          var b = e.target.closest ? e.target.closest('[data-restore-v]') : null;
          if (!b) return;
          if (opts.onRestore) opts.onRestore(b.getAttribute('data-restore-v'));
        });

        /* 收起只收历史：输入条永远在。状态只活在本页内（F5，不再落 localStorage）。
           cause='auto' 是"按规则自己收的"，与用户手点分开 —— 只有手点才作废待执行的自动折叠。 */
  function setCollapsed(v, cause) {
    if (cause !== 'auto') scheduleCancel();
    dock.setAttribute('data-hist', v ? 'closed' : 'open');
    /* 告诉画布"底部被面板占了"：面板 142 + 输入条 60 + 留白，需要 248 的下边距，
       否则页面底部的表格和分页会被压住。用 body class 而不是 :has()，
       因为 .fk-dock 是 fixed，class 的时机可控、也不会跟 CSS 支持度绑在一起。 */
    document.body.classList.toggle('fk-hist-open', !v);
          histBtn.setAttribute('aria-expanded', String(!v));
          col.setAttribute('aria-expanded', String(!v));
          col.innerHTML = '<span class="js-fk-hist-col-tx">' + (v ? '展开' : '收起') + '</span>' + (v ? ICON.up : ICON.down);
          col.title = v ? '展开对话历史' : '收起历史';
          col.setAttribute('aria-label', v ? '展开对话历史' : '收起对话历史');
          /* ★ 2026-10-28（F5）：这里原来写 localStorage，于是"手动展开"跨页继承。
             现在只在内存里 —— 离开这个页面，这个选择就不带走。
             展开＝这些消息都看过了；收起不清零（未读是"收起期间新到的"） */
          if (!v) {
            unread = 0;
            /* 历史列表/详情不许被"展开时滚到底"顶到末尾 —— 用户点开是要看第一条。 */
            if (histView === 'chat') setTimeout(function () { list.scrollTop = list.scrollHeight; }, 30);
          }
          renderPeek();
          var more = histBtn.querySelector('.fk-peek-more > span');
          if (more) more.textContent = v ? '展开' : '收起';
        }
        col.addEventListener('click', function () {
          setCollapsed(dock.getAttribute('data-hist') !== 'closed');
        });
        /* 同一个按钮管开和关。原来只写 setCollapsed(false) —— 实测点开之后
         再怎么点都不收，用户得去面板头部找那个很小的折叠箭头。
         一个按钮只管一个方向，是"我知道从哪下手吗"这道题最常见的失分点。 */
      /* 「历史对话」是历史列表入口；「展开/收起」才是面板开合。两件事不再挤在一个按钮里。 */
      histBtn.addEventListener('click', toggleHist);

        /* ── 语音（2026-11-04 统一成一种行为）────────────────────────
           识别结果只做一件事：转成文字落进输入框，等人确认再点发送。
           模式切换与自动发送已按用户要求撤掉，不再写 localStorage。 */
        function say(msg) { try { if (typeof window.hint === 'function') window.hint(msg, { ms: 5000 }); } catch (e) {} }
        var MIC = { st: '', mr: null, ch: [], stream: null, timer: 0, tick: 0, ctx: null };
        function micEndCleanup() {
          if (MIC.timer) { clearTimeout(MIC.timer); MIC.timer = 0; }
          if (MIC.tick) { clearInterval(MIC.tick); MIC.tick = 0; }
          if (MIC.ctx) { try { MIC.ctx.close(); } catch (e) {} MIC.ctx = null; }
          if (MIC.stream) { try { MIC.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} MIC.stream = null; }
        }
        function micUi() {
          mic.setAttribute('data-st', MIC.st);
          mic.setAttribute('aria-pressed', MIC.st === 'rec' ? 'true' : 'false');
          mic.setAttribute('aria-label', MIC.st === 'rec' ? '结束录音' : MIC.st === 'busy' ? '正在识别' : '按下说话');
          mic.title = MIC.st === 'rec' ? '正在听，说完停一下' : MIC.st === 'busy' ? '正在转成文字' : '按下说话';
          bar.setAttribute('data-rec', MIC.st === 'rec' ? '1' : '0');
        }
        function asrUrl() {
          var ep = window.XZ_CFG && window.XZ_CFG.endpoint;
          if (ep && /^https?:/.test(ep)) return ep.replace('/xz/plan', '/asr');
          var h = location.hostname;
          return (h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:')
            ? '/asr' : 'http://127.0.0.1:8941/asr';
        }
        function micDeliver(text) {
          var t = String(text || '').trim();
          if (!t) return;
          var cur = ta.value.replace(/\s+$/, '');
          ta.value = (cur ? cur + ' ' : '') + t;
          sync(); ta.focus();
          try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
        }
        function micStop() {
          if (MIC.st !== 'rec') return;
          if (MIC.timer) { clearTimeout(MIC.timer); MIC.timer = 0; }
          if (MIC.mr && MIC.mr.state !== 'inactive') { MIC.mr.stop(); return; }
          micEndCleanup(); MIC.st = ''; micUi();
        }
        function micStart() {
          if (MIC.st === 'rec') { micStop(); return; }
          if (MIC.st === 'busy') return;
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            say('这个浏览器不能录音，请用键盘输入', { ms: 5000 }); return;
          }
          /* ★2026-11-04：原来要等 getUserMedia 回来才亮"在听"——授权弹窗/取流那一下
             是一秒甚至几秒，这期间按钮毫无变化，用户以为点了没反应（穷举走查就是这么判的：
             点完 420ms DOM 一点没动）。先把状态亮起来，取流失败再退回去。 */
          MIC.st = 'rec'; micUi();
          navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
            .then(function (stream) {
              /* 取流期间用户又点了一下（点了停止）—— 流回来也别偷偷开录 */
              if (MIC.st !== 'rec') { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
              var mr = new MediaRecorder(stream);
              MIC.stream = stream; MIC.mr = mr; MIC.ch = [];
              mr.ondataavailable = function (e) { if (e.data && e.data.size) MIC.ch.push(e.data); };
              mr.onstop = function () {
                var blob = new Blob(MIC.ch, { type: mr.mimeType || 'audio/webm' });
                micEndCleanup(); MIC.mr = null; MIC.ch = [];
                if (!blob.size) { MIC.st = ''; micUi(); say('没有录到声音，再点一次', { ms: 5000 }); return; }
                MIC.st = 'busy'; micUi();
                fetch(asrUrl(), {
                  method: 'POST',
                  headers: { 'Content-Type': blob.type || 'application/octet-stream' },
                  body: blob
                })
                  .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j || {} }; }); })
                  .then(function (res) {
                    MIC.st = ''; micUi();
                    var t = res.ok ? String(res.j.text || '').trim() : '';
                    if (!t) { say(res.ok ? '没听清，再说一次' : '语音识别不可用，请用键盘输入', { ms: 5000 }); return; }
                    micDeliver(t);
                  })
                  .catch(function () { MIC.st = ''; micUi(); say('连不上识别服务，请用键盘输入', { ms: 5000 }); });
              };
              mr.start();
              MIC.st = 'rec'; micUi();
              /* 静默判停：检测到有人说过话之后，连续 1.2s 没声音就收。
                 60s 是硬上限，避免开着麦克风忘记点。 */
              var AC = window.AudioContext || window.webkitAudioContext;
              if (AC) {
                try {
                  MIC.ctx = new AC();
                  var src = MIC.ctx.createMediaStreamSource(stream);
                  var an = MIC.ctx.createAnalyser(); an.fftSize = 1024;
                  src.connect(an);
                  var buf = new Uint8Array(an.fftSize);
                  var spoke = false, lastLoud = 0, started = Date.now();
                  MIC.tick = setInterval(function () {
                    an.getByteTimeDomainData(buf);
                    var sum = 0;
                    for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
                    var rms = Math.sqrt(sum / buf.length);
                    var now = Date.now();
                    if (rms > 0.02) { spoke = true; lastLoud = now; }
                    if (spoke && now - lastLoud > 1200) micStop();
                    else if (!spoke && now - started > 10000) micStop();
                  }, 100);
                } catch (e) { MIC.ctx = null; }
              }
              MIC.timer = setTimeout(micStop, 60000);
            })
            .catch(function (err) {
              MIC.st = ''; micUi();
              var n = String((err && err.name) || '');
              say(n === 'NotAllowedError' ? '麦克风没被授权：点地址栏左侧的图标允许麦克风'
                : n === 'NotFoundError' ? '这台机器上没找到麦克风'
                : '打不开麦克风，请用键盘输入', { ms: 6000 });
            });
        }
        mic.addEventListener('click', micStart);

        function sync() { send.setAttribute('data-ready', (ta.value.trim() || att.count()) ? 'true' : 'false'); }
        ta.addEventListener('input', sync);
        ta.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); }
        });
        send.addEventListener('click', fire);
        function fire() {
          var t = ta.value.trim();
          /* ★2026-11-04：必须在 take() **之前**判 ready。take() 会清空附件并回调 sync()，
             sync() 立刻把 data-ready 置回 false —— 先取再判就是自己把自己的发送拦掉（实测踩过）。 */
          if ((!t && !att.count()) || send.getAttribute('data-ready') !== 'true') return;
          var atts = att.take();                 /* 附件本身也构成一条消息 */
          ta.value = ''; sync();
          /* 说话一定是回到当前对话说的：历史列表/详情只是"看一眼"，不接管输入。 */
          histView = 'chat'; detailId = ''; syncHistIco();
          /* ★ 2026-10-24 用户实测：「打完字按回车，画面上什么都没发生」。
             真因：历史默认收起（这是他自己要的"只显示输入框"），于是刚说完的那句
             被写进一个看不见的面板里，画布上又只有一条 2px 的进度条 —— 用户得到
             的反馈是零。**说话之后必须先看见自己说的那句**，所以发送即展开，
             收起的默认只作用于"还没开始说话"的状态。 */
          setCollapsed(false);
          addMsg('me', t, undefined, atts);
          /* 带附件的这一轮由附件逻辑接管，不再把（可能为空的）指令丢给主循环 ——
             实测：空指令进主循环会回一句「这一句没做成」，跟刚读到的附件并排出现，是脏数据。 */
          if (!atts.length && dlg.onSend) dlg.onSend(t, atts);
          /* 有附件时小智回一句「读到了什么」，引用的是真实文件名/包内清单，不是万能的「已读取」。 */
          var got = UIK.Attach.reply(atts);
          if (got) addMsg('cfg', got);
        }
        sync();
        /* ★ 默认态由**末条消息**决定（F5）：空历史／告知／进行中 → 收起；
           提问／报错／带可点下一步的卡／自己刚说完 → 展开。
           ★ 2026-10-28（体验官 F5）：不再读"上次手动展开过"的 localStorage ——
             那正是跨页继承的源头：组件页展开一次，去组件库再回来仍展开，盖住 5 行表格。
             手动展开只在本页内有效；回来按末条重判（见 defaultCollapsed）。 */
        try { localStorage.removeItem(LS_COL); } catch (e) {}   /* 清理旧版遗留键，不再读写 */
        setCollapsed(defaultCollapsed());
        render();

        /* bfcache 复活的页面不重跑挂载：离开再回来时在这里按末条重判一次（F5）。 */
        window.addEventListener('pageshow', function (e) {
          if (!e || !e.persisted) return;
          scheduleCancel();
          histView = 'chat'; detailId = ''; syncHistIco();
          setCollapsed(defaultCollapsed(), 'auto');
        });

        mounted.addMsg = addMsg;
        mounted.addCard = addCard;
        mounted.clearMsg = function () {
          /* 清空的是当前会话；不能 msgs=[] —— 那会让当前会话的数组引用脱钩。 */
          msgs.splice(0, msgs.length); touchCur(); save(); render(); renderPeek();
        };
        mounted.setCollapsed = setCollapsed;
        /* 历史里有没有说过**这句原话**（F7 用）：组件页的「未发布」提示跨页重载后
           不能再重复播报一次。只比 who=xz 的整句，不做模糊匹配。 */
        mounted.hasMsg = function (t) {
          var s = String(t == null ? '' : t);
          for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i] && msgs[i].who === 'cfg' && msgs[i].text === s) return true;
          }
          return false;
        };
        mounted.focusInput = function () {
          histView = 'chat'; detailId = ''; syncHistIco();
          render(); setCollapsed(false); ta.focus();
        };
        /* 把一句话填进输入框（只填文字，不发送）。给首屏空态的「起手示例」用：
           点了先看到文字进了输入框，还能改，再按发送 —— 比点了立刻生成更可控。
           必须派发 input 事件，否则发送钮的 data-ready 不会亮（它监听 input）。 */
        mounted.setInput = function (t) {
          /* ★ 不展开历史。这里原来调了 setCollapsed(false) —— 结果用户点一条起手示例，
             对话历史面板就自己弹出来压在空画布上（实测：点完第一条示例，整页中央被
             一块"对话 / 我 / 小智"盖住）。填输入框和展开历史是两件事，别顺手绑一起。 */
          ta.value = String(t == null ? '' : t);
          ta.focus();
          try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        };
        /* ★2026-11-06（用户截图里的对话历史）：说了一句、这一页的 AI 没接住时，
           把刚发的那条「我」从历史里撤回、文字放回输入框，让他改一改再发。
           原来这种情况会补一条「这句我没听出要改哪里…」，历史里就成了
           「你好 / 没听出」重复两遍 —— 客户点开历史看到的就是这个。 */
        mounted.undoSend = function (back) {
          for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i] && msgs[i].who === 'me') { msgs.splice(i, 1); break; }
          }
          touchCur(); save(); render(); renderPeek();
          if (back != null) {
            ta.value = String(back);
            ta.focus();
            try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          }
        };
      }

      /* ── 右下操作组（未传 ops 则不渲染）─────────────────── */
      if (ops.length) {
        var box = el('div', 'fk-ops', { id: 'fk-ops', role: 'group', 'aria-label': '操作' });
        ops.forEach(function (o) {
          var b = el('button', 'fk-op', { type: 'button', 'data-kind': o.kind || 'normal', id: 'fk-op-' + o.key });
          b.textContent = o.label;
          b.addEventListener('click', function () { if (o.onClick) o.onClick(); });
          box.appendChild(b);
        });
        document.body.appendChild(box);
        mounted.ops = box;
      }

      /* ── 独立胶囊 ──────────────────────────────────────── */
      if (chip) {
        var c = el('button', 'fk-chip', { type: 'button', id: 'fk-chip' });
        c.innerHTML = sv('<path d="M12 5v14M5 12h14"/>', 13) +
          '<span>' + (chip.label || '装配组件') + '</span>' +
          (typeof chip.count === 'number' ? '<b id="fk-chip-n">' + chip.count + '</b>' : '');
        c.addEventListener('click', function () { if (chip.onClick) chip.onClick(); });
        document.body.appendChild(c);
        mounted.chip = c;
        mounted.setChipCount = function (n) {
          var s = document.getElementById('fk-chip-n');
          if (s) s.textContent = n;
        };
      }

      /* 拖动：只认把手（.fk-grip），复用 drag.js */
      if (window.Draggable && mounted.dock) {
        window.Draggable(mounted.dock, { key: 'fk-dock', handle: '.fk-grip' });
      }
      return mounted;
    }
  };

  window.Float = api;
})();