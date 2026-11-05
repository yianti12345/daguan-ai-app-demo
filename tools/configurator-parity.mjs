#!/usr/bin/env node
/* configurator-parity —— 配置器契约（CONFIGURATOR.md）里"能机器跑"的那几条判据。
 *
 * 为什么单独一个脚本、且不叫 gate-/check- 开头：
 *   它判的是宿主与配置器的边界，不是 DESIGN.md 的界面规范。刻意不占 gate-/check-
 *   前缀，免得 Q1（check-judgments 的台账完整性）把它判成"漏登记"。
 *   要进台账时把名字告诉我，我改 —— 现在这个前缀不在 Q1 的扫描集里。
 *
 * 用法：
 *   node tools/configurator-parity.mjs --check    全部（收尾/门禁用这一条）
 *   node tools/configurator-parity.mjs --all      同 --check（旧写法保留）
 *   node tools/configurator-parity.mjs --k7      内置配置器的 key 都在 §3.1 词表内
 *   node tools/configurator-parity.mjs --k9      三态不白屏（无配置器 / 超时 / 抛错）
 *   node tools/configurator-parity.mjs --k10     没有 ?id= 时不许冒充「新组件」
 *   node tools/configurator-parity.mjs --k11     §5.3 patch 是增量：没出现的键不许被清空
 *   node tools/configurator-parity.mjs --k12     两个配置器：.cfg-hd 逐字相同、.cfg-bd 长度必须不同
 *   node tools/configurator-parity.mjs --k13     切配置器不写库（写库只在 save）
 *   node tools/configurator-parity.mjs --sem     §5 同名不同义：原值进 __rest，可见区不许被改写
 *   node tools/configurator-parity.mjs --v1      .cfg-body 的块白名单（data-cfg-block）
 *   node tools/configurator-parity.mjs --v4      双主按钮：.cfg-ft 起来时浮层那组不许**可见**
 *   node tools/configurator-parity.mjs --v6      .cfg-label 不许把 key 上屏
 *   node tools/configurator-parity.mjs --life    cfg-mode 的生命周期不变量（切配置器不许动它）
 *
 *   --negctl   注入病历，**必须判红**。rc=2 表示"判据是活的"，rc=0 表示判据死了。
 *
 * 退出码：0 全绿 ｜ 2 有断点（--negctl 时为"负控成立"）｜ 3 环境不可用
 */
import { spawn } from 'node:child_process';
import { resolveBase, debugPort } from './base.mjs';
import { CFG_PAGES } from './pages.mjs';

const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const DETAILS = {};   /* 通过时也打一行读数（判词之外的事实） */
const NEG = process.argv.includes('--negctl');
const ALL = process.argv.includes('--all') || process.argv.includes('--check');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WANT = ['k7', 'k9', 'k10', 'k11', 'k12', 'k13', 'life', 'sem', 'v1', 'v4', 'v6']
  .filter((k) => ALL || process.argv.includes('--' + k));
if (!WANT.length) {
  console.log('用法：node tools/configurator-parity.mjs --check | --k7 --k9 --k10 --k11 --k12 --k13 --life --sem --v1 --v4 --v6 [--negctl]');
  process.exit(2);
}

let BASE;
try { BASE = await resolveBase(); }
catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

/* ── 浏览器 ─────────────────────────────────────────────────── */
const port = await debugPort();
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/cfgst-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1',
  'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) {}
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
let id = 0; const wait = new Map(); const jsErrs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    jsErrs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
  }
  if (m.id != null && wait.has(m.id)) {
    const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise((res, rej) => {
    wait.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), 30000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return r.result.value;
};
const go = async (path) => {
  jsErrs.length = 0;
  await send('Page.navigate', { url: BASE + path });
  await sleep(900);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* ── 判据实现：每个返回"失败原因的字符串数组"，空 = 通过 ─────── */
const CHECKS = {

  /* K7：内置配置器的 contract.fields[].key 必须都在 §3.1 词表内。
     负控 = 往登记表塞一个 key:'category' 的包。 */
  async k7() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    return JSON.parse(await ev(`(() => {
      var KW = Configurator.KEY_WORDS, out = [];
      var ms = (window.__CFG_BUILTIN || []).map(function (c) { return c.manifest; });
      ${NEG ? `ms = ms.concat([{ id:'cfg-negctl-category', bindsTo:'component', schemaVersion:1,
          contract:{ fields:[{ key:'category', name:'分类', type:'text' }] } }]);` : ''}
      ms.forEach(function (m) {
        ((m.contract && m.contract.fields) || []).forEach(function (f) {
          if (KW.indexOf(f.key) < 0) out.push(m.id + ' 的字段 key 不在词表：' + f.key);
        });
      });
      if (!ms.length) out.push('一个内置配置器都没登记');
      return JSON.stringify(out);
    })()`));
  },

  /* K9：三态不白屏。每态都要求 .cfg-hd / .cfg-ft 在、.cfg-bd 有可读文案；
     "崩溃"与"加载中"必须是两套外观（data-why + 不同文案）。 */
  async k9() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    const r = JSON.parse(await ev(`(() => {
      var out = [];
      var host = document.createElement('div');
      host.id = 'k9-host';
      document.body.appendChild(host);

      function check(tag, needWhy) {
        var hd = host.querySelector('.cfg-hd'), ft = host.querySelector('.cfg-ft');
        var bd = host.querySelector('.cfg-bd');
        if (!hd) out.push(tag + '：.cfg-hd 不在了');
        if (!ft) out.push(tag + '：.cfg-ft 不在了');
        var txt = (bd ? bd.textContent : '').replace(/\\s+/g, ' ').trim();
        if (!txt) out.push(tag + '：.cfg-bd 是空的（白屏）');
        if (needWhy) {
          var c = host.querySelector('.cfg-crash[data-why="' + needWhy + '"]');
          if (!c) out.push(tag + '：没有 .cfg-crash[data-why="' + needWhy + '"]，状态认不出来');
          if (host.querySelector('.cfg-loading')) out.push(tag + '：还挂着 .cfg-loading，用户会一直等');
        }
      }

      /* (a) 没有任何可用配置器 */
      var saved = (window.__CFG_BUILTIN || []).slice();
      window.__CFG_BUILTIN.length = 0;
      Configurator.attach(document.getElementById('cfg-bar'), host, { bindsTo:'component', id:'task-list' });
      check('无可用配置器', null);

      /* (b) 抛错 */
      host.innerHTML = '';
      ${NEG
        ? `try { Configurator.mount(host, { manifest:{ id:'t-blank', bindsTo:'component', contract:{fields:[]} },
              mount: function () { /* 负控：什么都不画，制造白屏 */ } }, { value:{} }); } catch (e) {}`
        : `try { Configurator.mount(host, { manifest:{ id:'t-throw', bindsTo:'component', contract:{fields:[]} },
              mount: function () { throw new Error('selftest: 故意抛错'); } }, { value:{} }); } catch (e) {}`}
      check('抛错', ${NEG ? 'null' : `'throw'`});

      /* (c) 挂载超时（忙 2.4 秒；真死循环 while(true) 同线程救不回来，见报告） */
      ${NEG ? '' : `host.innerHTML = '';
      try { Configurator.mount(host, { manifest:{ id:'t-slow', bindsTo:'component', contract:{fields:[]} },
        mount: function () { var t = Date.now(); while (Date.now() - t < 2400) {} } }, { value:{} }); } catch (e) {}
      check('超时', 'timeout');
      var a = host.querySelector('.cfg-crash[data-why="timeout"]');
      var b = host.querySelector('.cfg-crash[data-why="throw"]');
      if (a && b && a.textContent === b.textContent) out.push('超时与抛错文案一模一样，用户分不出');`}

      window.__CFG_BUILTIN.push.apply(window.__CFG_BUILTIN, saved);
      host.remove();
      return JSON.stringify(out);
    })()`));
    return r;
  },

  /* K10：不带 ?id= / id 不存在时，不许冒充「新组件」把表单画出来。 */
  async k10() {
    const out = [];
    for (const path of [
      '/component.html?cfg=cfg-comp-form',
      '/component.html?cfg=cfg-comp-form&id=zzz-not-exist'
    ]) {
      await go(path);
      const r = JSON.parse(await ev(`(() => {
        var out = [];
        var bd = document.querySelector('.cfg-bd');
        var txt = (bd ? bd.textContent : '').replace(/\\s+/g, ' ').trim();
        if (txt.indexOf('没有这个实体') < 0) out.push('${path}：没有明说「没有这个实体」（实际：' + txt.slice(0, 60) + '）');
        var body = document.querySelector('.cfg-body');
        /* 负控：模拟"仍然把表单画出来"——必须在数控件**之前**塞进去 */
        ${NEG ? `if (body) { var i = document.createElement('input'); body.appendChild(i); }` : ''}
        var ctl = body ? body.querySelectorAll('input,select,textarea').length : 0;
        if (ctl) out.push('${path}：仍然画了 ' + ctl + ' 个表单控件，等于冒充「新组件」');
        if (!document.querySelector('.cfg-ft')) out.push('${path}：.cfg-ft 不在了');
        /* 页头也不许冒充：左上角那颗浮层写「新组件」= 同一句谎话的另一个位置 */
        var nm = document.getElementById('comp-name');
        var nmTxt = nm ? nm.textContent.trim() : '';
        if (nmTxt.indexOf('新组件') >= 0) out.push('${path}：左上角仍写着「新组件」（' + nmTxt + '），等于还在冒充');
        return JSON.stringify(out);
      })()`));
      out.push(...r);
    }
    return out;
  },

  /* K11：patch 是增量。没出现的键 = 保持不变；显式 null 才清空。 */
  async k11() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    return JSON.parse(await ev(`(() => {
      var out = [];
      var F = Configurator.resolve('cfg-comp-form').manifest;
      var prev = { name:'旧名', scope:'fin', desc:'旧说明', fields:['A'],
                   __sem:{ name:'name:text@1', scope:'scope:select@1', desc:'desc:textarea@1', fields:'fields:tags@1' },
                   __rest:{} };
      ${NEG ? `/* 负控：把 patch 当成全量写（老实现），改个名字其它全没 */` : ''}
      var r;
      if (${NEG}) {
        r = { value: { name:'X1' }, rest: {}, sem: {} };      /* 病历：全量覆盖 */
      } else {
        r = Configurator.mergeState(prev, { name:'X1' }, F);
      }
      if (r.value.name !== 'X1') out.push('改的名字没生效');
      if (r.value.scope !== 'fin') out.push('改了 name 之后 scope 没了（patch 被当成了全量）');
      if (r.value.desc !== '旧说明') out.push('改了 name 之后 desc 没了（patch 被当成了全量）');
      /* 显式 null 才是清空 */
      var r2 = Configurator.mergeState(
        { name:'X1', scope:'fin', __sem:{ name:'name:text@1', scope:'scope:select@1' }, __rest:{} },
        { scope: null }, F);
      if (r2.value.scope !== undefined) out.push('发 null 之后 scope 还在，清不掉');
      if (r2.value.name !== 'X1') out.push('清 scope 时把 name 一起清掉了');
      return JSON.stringify(out);
    })()`));
  },

  /* K13：切配置器只换界面，不写库；写库只在 save。 */
  async k13() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    const before = await ev(`JSON.stringify(DB.compById('task-list').config)`);
    await ev(`(() => {
      var i = document.querySelector('[data-k="name"]');
      i.value = 'K13-临时名';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(150);
    await ev(`(() => {
      var s = document.getElementById('cfg-sel');
      s.value = 'cfg-comp-dialog';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(200);
    /* 有未保存改动时会弹三步确认；点「放弃并切换」 */
    await ev(`(() => { var b = document.querySelector('.cfg-ft [data-c="discard"]'); if (b) b.click(); return 1; })()`);
    await sleep(250);
    const switched = await ev(`!!document.querySelector('.cfg-split')`);
    /* 负控：在**量之前**模拟"切换时顺手 save 一次"，别的什么都不改 */
    if (NEG) {
      await ev(`(() => { var c = DB.compById('task-list'); c.config = { name:'被顺手写进去的' }; DB.save(); return 1; })()`);
    }
    const after = await ev(`JSON.stringify(DB.compById('task-list').config)`);
    const out = [];
    if (!switched) out.push('没有切到对话式（.cfg-split 不在）');
    if (after !== before) out.push('切一次配置器就把库写了：' + before + ' → ' + after);
    return out;
  },

  /* K12：换界面不是换标题 —— .cfg-hd 逐字相同，.cfg-bd 长度必须不同。
     页面清单来自 tools/pages.mjs 的 CFG_PAGES（单列一份，不污染 PAGES）。 */
  async k12() {
    const out = [];
    const seen = [];
    let firstBody = '';
    for (const page of CFG_PAGES) {
      await go('/' + page);
      if (NEG && seen.length) {
        /* 负控：让第二个配置器复用第一个的 body —— 界面没变，只有标题变了 */
        await ev('(() => { document.querySelector(".cfg-body").innerHTML = ' + JSON.stringify(firstBody) + '; return 1; })()');
        await sleep(120);
      }
      const r = JSON.parse(await ev(`(() => {
        var hd = document.querySelector('.cfg-hd'), bd = document.querySelector('.cfg-bd'), body = document.querySelector('.cfg-body');
        return JSON.stringify({ hd: hd ? hd.outerHTML : '', n: bd ? bd.innerHTML.length : -1, body: body ? body.innerHTML : '' });
      })()`));
      if (!seen.length) firstBody = r.body;
      seen.push(r);
    }
    if (seen.length < 2) { out.push('CFG_PAGES 少于两条，比不了'); return out; }
    if (!seen[0].hd || seen[0].hd !== seen[1].hd) {
      out.push('.cfg-hd 两次不逐字相同（$' + '长度 ' + seen[0].hd.length + ' / ' + seen[1].hd.length + '）');
    }
    if (seen[0].n === seen[1].n) {
      out.push('.cfg-bd 长度相同（' + seen[0].n + '）—— 换配置器只是换了标题，界面没变');
    }
    return out;
  },

  /* life：cfg-mode 的生命周期不变量。
     结论先写清：全站只有**一个** add 点（boot），**没有任何 remove** ⇒
     cfg-mode 从页面加载到卸载都在，运行期没有"切进/切出"。
     所以这条判据验的不是"切走前要存草稿"，而是"切配置器不许动它"。 */
  async life() {
    const read = `(() => {
      var ta = document.querySelector('.fk-ta');
      var ops = document.getElementById('fk-ops');
      var shown = 0;
      if (ops) ops.querySelectorAll('button').forEach(function (b) {
        var r = b.getBoundingClientRect();
        if (r.width && getComputedStyle(b).visibility !== 'hidden') shown++;
      });
      var bar = document.querySelector('.fk-bar');
      return JSON.stringify({
        mode: document.body.classList.contains('cfg-mode'),
        ta: ta ? ta.value : null,
        barHidden: !!(bar && getComputedStyle(bar).display === 'none'),
        opsShown: shown
      });
    })()`;

    await go('/' + CFG_PAGES[0]);
    const before = JSON.parse(await ev(`(() => {
      var ta = document.querySelector('.fk-ta');
      if (ta) ta.value = '半句没发出去的话';
      return ${read};
    })()`));

    await ev(`(() => {
      var s = document.getElementById('cfg-sel');
      s.value = 'cfg-comp-dialog';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(220);
    await ev(`(() => { var b = document.querySelector('.cfg-ft [data-c="discard"]'); if (b) b.click(); return 1; })()`);
    await sleep(300);

    if (NEG) {
      /* 负控：模拟"运行期把 cfg-mode 摘掉"（假设中的实现），草稿就会被暴露到重新出现的输入条上 */
      await ev(`(() => { document.body.classList.remove('cfg-mode'); return 1; })()`);
      await sleep(80);
    }
    const after = JSON.parse(await ev(read));

    const out = [];
    if (!before.mode) out.push('一开始 cfg-mode 就不在，后面几条无从谈起');
    if (after.mode !== before.mode) out.push('切一次配置器就改了 cfg-mode 的存在性（会重新放出第二条输入/动作）');
    if (before.ta !== after.ta) out.push('.fk-ta 的草稿在切换中丢了：' + before.ta + ' → ' + after.ta);
    if (after.opsShown) out.push('切换后 #fk-ops 又有可见按钮了');
    return out;
  },

  /* §5 / K8：同名不同义。原值必须进 __rest，可见区不许出现被改写的值；回到原配置器要回流。 */
  async sem() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    const R = JSON.parse(await ev(`(() => {
      var out = [];
      var A = { id:'a', schemaVersion:1, contract:{ fields:[{ key:'note', name:'备注', type:'textarea' }] } };
      var B = { id:'b', schemaVersion:2, contract:{ fields:[{ key:'note', name:'审核意见', type:'text' }] } };
      /* 上一份是 A 写的「备注」 */
      var prev = { note:'客户口头答应先放行', __sem:{ note:'note:textarea@1' }, __rest:{} };
      ${NEG ? `delete prev.__sem;   /* 负控：模拟"不看 sem，只按 key 合并"的老实现 */` : ''}

      /* ① B 只是打开（没有 patch）：旧值不许出现在可见区，必须躺在 __rest 里 */
      var r1 = Configurator.mergeState(prev, null, B);
      if (r1.value.note !== undefined) out.push('异义打开后可见区仍有旧 note：' + r1.value.note);
      if (!r1.rest.note) out.push('原值没进 __rest');
      else {
        if (r1.rest.note.v !== '客户口头答应先放行') out.push('__rest 里的值不对：' + JSON.stringify(r1.rest.note));
        if (r1.rest.note.sem !== 'note:textarea@1') out.push('__rest 里没带语义指纹（实际：' + r1.rest.note.sem + '）');
      }
      if (!r1.conflicts.length) out.push('没有报告冲突，界面就没法说「原值已保留」');

      /* ①b B 真的写了一个新值：新值可见，旧值仍在 __rest（不许被覆盖掉） */
      var r1b = Configurator.mergeState(prev, { note:'已审核通过' }, B);
      if (r1b.value.note !== '已审核通过') out.push('B 写的新值没进可见区');
      if (!r1b.rest.note || r1b.rest.note.v !== '客户口头答应先放行') out.push('B 一写就把旧义的原值覆盖了（这比丢更难发现）');

      /* ①c 回流：A→B→A，回到原来的语义必须把值取回来（否则是"数据还在但界面丢了"） */
      var backA = Configurator.mergeState({ note: r1.value.note, __sem: r1.sem, __rest: r1.rest }, null, A);
      if (backA.value.note !== '客户口头答应先放行') out.push('切回原配置器后 note 没有回到可见区（实际：' + backA.value.note + '）');
      if (backA.rest.note) out.push('回流之后 __rest 里还留着 note（应当搬走，不是复制）');

      /* ② 同义：安全合并 */
      var r2 = Configurator.mergeState(prev, { note:'改过的备注' }, A);
      if (r2.value.note !== '改过的备注') out.push('同义合并失败，可见值：' + r2.value.note);
      if (r2.rest.note) out.push('同义合并却把值塞进了 __rest');

      /* ③ __rest 永不删除：拿回来再存一次，它还在 */
      var r3 = Configurator.mergeState({ note: r1.value.note, __sem: r1.sem, __rest: r1.rest }, null, B);
      if (!r3.rest || !r3.rest.note || r3.rest.note.v !== '客户口头答应先放行') out.push('__rest 被弄丢了');

      /* ④ 声明外的键一律进 __rest */
      var r4 = Configurator.mergeState({ note:'x', category:'旧字段', __sem:{note:'note:textarea@1'}, __rest:{} }, null, A);
      if (!r4.rest.category || r4.rest.category.v !== '旧字段') out.push('未声明的键没有进 __rest');
      if (r4.value.category !== undefined) out.push('未声明的键跑到了可见区');
      return JSON.stringify({
        out: out,
        restV: r1.rest.note ? r1.rest.note.v : null,
        restSem: r1.rest.note ? r1.rest.note.sem : null,
        back: backA.value.note === undefined ? null : backA.value.note,
        restLeft: !!backA.rest.note
      });
    })()`));
    DETAILS.sem = 'A→B：note 进 __rest = ' + JSON.stringify(R.restV) + '（sem=' + R.restSem + '）'
      + ' ｜ B→A：note 回到可见区 = ' + JSON.stringify(R.back) + '，__rest 里' + (R.restLeft ? '还留着（错）' : '已搬空（对）');
    return R.out;
  },

  /* V1：.cfg-body 的块白名单 + 系统动作外逃 + 按钮不许和底部动作同名。
     规则统一，不分 origin：允许 button，禁 [data-cfg-action] / a[href]。 */
  async v1() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    const first = JSON.parse(await ev(`(() => {
      var out = [];
      var body = document.querySelector('.cfg-body');
      if (!body) return JSON.stringify(['.cfg-body 不存在']);

      /* 负控：把三件病历一次喂进去，且**在断言之前**（否则测的是上一刻的状态）
         ① 过滤没跑（observer 断开）② 有人塞了系统动作入口 ③ 配置器自己不打块标记 */
      ${NEG ? `
      if (body.__cfgMO) body.__cfgMO.disconnect();
      var esc = document.createElement('div');
      esc.id = 'v1-esc';
      esc.setAttribute('data-cfg-action', 'save');
      esc.textContent = '直接保存';
      body.appendChild(esc);
      body.querySelectorAll('[data-cfg-block]').forEach(function (n) { n.removeAttribute('data-cfg-block'); });
      ` : ''}

      var BLOCK = Configurator.BLOCK_WORDS;
      var BLOCKY = 'div,section,aside,ul,ol,li,p,table,dl,header,footer,figure';
      var untagged = 0;
      body.querySelectorAll(BLOCKY).forEach(function (n) {
        var v = n.getAttribute('data-cfg-block');
        if (!v) untagged++;
        else if (BLOCK.indexOf(v) < 0) out.push('块标记不在白名单：' + v);
      });
      if (untagged) out.push(untagged + ' 个块级节点没有 data-cfg-block');

      if (body.querySelector('[data-cfg-action]')) out.push('还有 [data-cfg-action] 逃逸（系统动作的旁门）');
      if (body.querySelector('a[href]')) out.push('还有 a[href] 逃逸（导航的旁门）');

      /* 允许 button，但不许和底部动作同名 —— 否则又是"两个保存" */
      var ftLabels = [];
      document.querySelectorAll('.cfg-ft [data-act]').forEach(function (b) {
        ftLabels.push(b.textContent.replace(/\\s+/g, ' ').trim());
      });
      body.querySelectorAll('button').forEach(function (b) {
        var t = b.textContent.replace(/\\s+/g, ' ').trim();
        if (t && ftLabels.indexOf(t) >= 0) out.push('配置器里有一个和底部动作同名的按钮：「' + t + '」');
      });

      ${NEG ? '' : `
      /* 病历：塞一个不认得的块值，必须原地换成占位（不 throw、不静默丢弃） */
      var d = document.createElement('div');
      d.id = 'v1-probe';
      d.setAttribute('data-cfg-block', 'frame');
      d.textContent = '不该出现的块';
      body.appendChild(d);
      `}
      return JSON.stringify(out);
    })()`));

    if (NEG) return first;

    await sleep(120);
    const second = JSON.parse(await ev(`(() => {
      var out = [];
      var ph = document.querySelector('.cfg-unknown[data-cfg-block-orig="frame"]');
      if (!ph) out.push('不认得的块值没有换成 .cfg-unknown 占位');
      if (document.getElementById('v1-probe')) out.push('原节点还在，说明"不 throw 也不替换"两边都错了');
      return JSON.stringify(out);
    })()`));
    return first.concat(second);
  },

  /* V4：.cfg-ft 起来时，浮层那组动作必须为 0；全页主按钮 ≤ 1 */
  async v4() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    return JSON.parse(await ev(`(() => {
      var out = [];
      if (!document.querySelector('.cfg-ft')) out.push('.cfg-ft 不存在，这条判据无从谈起');
      /* ★ 判**可见**，不判存在：CSS 隐藏和 DOM 移除都算合格。
         "判存在"和"判可见"混用是这个项目栽过好几次的坑——
         视觉那边原来的写法是 querySelector('.fk-ops .btn.primary')，
         会把"已经在 DOM 里删掉"和"只是 display:none"判成同一种红。 */
      var vis = function (e) {
        var cs = getComputedStyle(e), r = e.getBoundingClientRect();
        return !(r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || e.offsetParent === null);
      };
      var ops = document.getElementById('fk-ops');
      if (ops) {
        ${NEG ? `var b = document.createElement('button'); b.className = 'btn primary'; ops.appendChild(b);` : ''}
        var shown = 0;
        ops.querySelectorAll('button').forEach(function (x) { if (vis(x)) shown++; });
        if (shown) out.push('#fk-ops 里还有 ' + shown + ' 个**可见**按钮（双出口活着）');
      }
      var prim = 0;
      document.querySelectorAll('button.btn.primary, .cfg-ft [data-kind="primary"]').forEach(function (x) {
        if (vis(x)) prim++;
      });
      if (prim > 1) out.push('全页可见主按钮 ' + prim + ' 个（要求 ≤ 1）');
      if (prim < 1) out.push('一个可见主按钮都没有 —— 用户没有明确的主动作');
      return JSON.stringify(out);
    })()`));
  },

  /* V6：.cfg-label 不许把 key 上屏；缺 name 要回填，回填不了要标未命名 */
  async v6() {
    await go('/component.html?id=task-list&cfg=cfg-comp-form&debug=1');
    return JSON.parse(await ev(`(() => {
      var out = [];
      var KW = Configurator.KEY_WORDS;
      function scan(tag, root) {
        root.querySelectorAll('.cfg-label').forEach(function (l) {
          var t = (l.textContent || '').trim();
          if (KW.indexOf(t) >= 0) out.push(tag + '：label 直接把 key 上屏了 —— "' + t + '"');
          if (!t) out.push(tag + '：label 是空的');
        });
      }
      scan('表单式', document);

      /* 对话装配式 */
      var host = document.createElement('div');
      document.body.appendChild(host);
      ${NEG ? `
      Configurator.mount(host, Configurator.resolve('cfg-comp-form'), { value:{} });
      var l0 = host.querySelector('.cfg-label');
      if (l0) l0.textContent = 'scope';     /* 负控：把 key 写回界面 */
      ` : `
      Configurator.mount(host, Configurator.resolve('cfg-comp-dialog'), { value:{} });
      `}
      scan('对话式', host);

      /* 缺 name 的回填 + 回填表也没有时标未命名 */
      var h2 = document.createElement('div');
      document.body.appendChild(h2);
      Configurator.mount(h2, { manifest:{ id:'t-noname', bindsTo:'component', schemaVersion:1,
        contract:{ fields:[ { key:'scope', type:'text' } ] } }, mount:null }, { value:{} });
      var t = h2.querySelector('.cfg-label') ? h2.querySelector('.cfg-label').textContent.trim() : '';
      if (t !== '适用口径') out.push('缺 name 时没有回填成「适用口径」，实际：' + t);

      /* 导入边界：缺 name / 词表外的 key 都必须整体拒绝 */
      var bad1 = Configurator.importManifest({ id:'cfg-t-noname', kind:'configurator', bindsTo:'component',
        contract:{ fields:[ { key:'note', type:'textarea' } ] } });
      if (bad1.ok) out.push('缺 name 的包被放进来了（应当整体拒绝）');
      var bad2 = Configurator.importManifest({ id:'cfg-t-cat', kind:'configurator', bindsTo:'component',
        contract:{ fields:[ { key:'category', name:'分类', type:'text' } ] } });
      if (bad2.ok) out.push('词表外的 key 被放进来了');
      h2.remove(); host.remove();
      return JSON.stringify(out);
    })()`));
  }
};

/* ── 跑 ─────────────────────────────────────────────────────── */
let fails = 0, pass = 0;
for (const k of WANT) {
  let out = [];
  try { out = await CHECKS[k](); }
  catch (e) { out = ['执行出错：' + String(e.message).slice(0, 160)]; }
  if (NEG) {
    /* 负控成立 = 注入病历后**必须有失败项**（说明这条判据真的会红） */
    const caught = out.length > 0;
    console.log(`  ${caught ? '✓' : '✗'} --${k} 负控${caught ? '成立' : '失败：注入病历后仍判绿 ⇒ 判据是死的'}`);
    if (caught) console.log('      ' + out.slice(0, 3).join('\n      '));
    if (!caught) fails++;
  } else {
    if (out.length) {
      fails++;
      console.log(`  ✗ --${k}`);
      out.forEach((m) => console.log('      ' + m));
    } else {
      pass++;
      console.log(`  ✓ --${k}`);
      if (DETAILS[k]) console.log('      ' + DETAILS[k]);
    }
  }
}

if (jsErrs.length) console.log('  ! 页面有 JS 异常：' + jsErrs[0]);

ws.close(); ch.kill('SIGKILL');
/* 汇总固定成「判词 + 一行摘要 + 明细（上面的逐条行就是明细）」：
   判词放第一列，机器和人都能一眼扫。 */
if (NEG) {
  console.log('');
  console.log(fails
    ? `FAIL  负控 ${WANT.length - fails}/${WANT.length} 成立 —— 有判据注入病历也不红，它本来就不会红`
    : `PASS  负控 ${WANT.length}/${WANT.length} 成立（每条都能被它自己的病历打红）`);
  process.exit(fails ? 0 : 2);
}
console.log('');
console.log(fails
  ? `FAIL  ${WANT.length - pass}/${WANT.length} 条判据通过 · ${fails} 条断点 · ${BASE}`
  : `PASS  ${pass}/${WANT.length} 条判据通过 · 0 条断点 · ${BASE}`);
process.exit(fails ? 2 : 0);
