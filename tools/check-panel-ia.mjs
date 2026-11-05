#!/usr/bin/env node
/* check-panel-ia —— 配置页「装配/升级」这一处的信息架构与文案契约（静态判据，不拉浏览器）。
 *
 * 为什么单开这一条（2026-11-04，一轮里被用户连骂五次）：
 *   ① 升级被做成一枚顶栏按钮「一键升级 2」，而装配组件的入口反而被 hidden —— 用户找不到"我该点哪儿"；
 *   ② 进配置页带 panel=installed&updates=1 就自动弹装配抽屉，用户没让它开；
 *   ③ 「可装配」页签里挂着「2 个组件有新版本 / 全选 / 全部升级」—— 升级信息出现在"装新东西"的页签；
 *   ④ 同一行「已选 N」与动作「装配（N）」是同一个数说了两遍；
 *   ⑤ 内部状态词泄漏到界面：需手动 / 已自定义 / 已单独改过 / 当前可装配的版本 / 还没有应用装它。
 *   这五件的共同点不是"某一行文案不好"，而是**信息架构没有唯一落点**：
 *   升级该住装配面板的已装配页签，不该在顶栏、不该在可装配页签、不该自动弹。
 *
 * 断言（任意一条不成立即 rc=2）：
 *   IA1 顶栏不许有独立的升级按钮（app.html 不得出现 id="act-upgrade-all"）
 *   IA2 装配面板工具行不许再有重复计数（不得出现 id="p-batch-n"）
 *   IA3 进配置页不许自动展开装配抽屉（app.js 不得再消费 panel/updates 参数去 openDlg）
 *   IA4 「已装配」页签必须挂可升级角标（app.html 有 tab-upd-chip；app.js 有 tab-upd-n 写入）
 *   IA5 「全部升级」只允许在已装配页签出现（app.js 必须存在 `allNow.hidden = tab !== 'on'`）
 *   IA6 界面文案禁用内部状态词（见 BANNED；扫 7 页 html 与 assets/*.js）
 *   IA7 配置页顶栏的次要按钮＝描边（sys.css 的 .topbar .btn.ghost 必须 box-shadow:none）
 *
 * 用法：node tools/check-panel-ia.mjs            正控，全过 rc=0
 *      node tools/check-panel-ia.mjs --negctl   负控：把每条断言的"坏样本"喂给同一批检测函数，
 *                                               任何一条没被判红 ⇒ rc=2（证明判据不是恒绿）
 * 退出码：0 全过 ｜ 2 有断点 ｜ 3 读不到件
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEG = process.argv.includes('--negctl');

const read = (p) => {
  const f = join(ROOT, p);
  if (!existsSync(f)) { console.error('缺件：' + p); process.exit(3); }
  return readFileSync(f, 'utf8');
};

const appHtml = read('app.html');
const appJs = read('assets/app.js');
const sysCss = read('assets/sys.css');

/* 界面文案禁用词：都是"系统内部状态/设计过程"漏到用户眼前的那一类。
   每条附一句它为什么是禁用词，后来人加词也能照这个标准判。 */
const BANNED = [
  ['需手动', '把"应用改过这块"的内部判定直接印在状态列上；用户没有这个概念'],
  ['已自定义', '同一件事换了个名字，仍然是内部判定，不是用户能做的动作'],
  ['已单独改过', '同上；而且它会在"什么都没改"时被假状态触发（内容层整包灌入）'],
  ['当前可装配的版本', '版本管理的行内话术，不是版本状态'],
  ['还没有应用装它', '否定句当状态；0 引用时什么状态都不该印'],
  ['（时分未记）', '拿字段缺失当文案，等于把数据缺口印给用户看'],
  ['装上后，', '组件介绍被写成了操作指导（"等你填内容"），不是"这东西是干什么的"'],
  ['改这一块', '内部入口词：它区分的是"改应用私有副本/改共用件"，产品里没有这层说法'],
  ['改共用件', '同上'],
  ['语音确认', '术语黑话；已换成「转文字」，用户不需要先学一套说法'],
  ['免确认', '同上；已换成「直接发」'],
  ['当前可装配', '版本管理行内话术的变体，同样不是用户能判断的状态'],
];

const pages = ['apps.html', 'app.html', 'components.html', 'component.html',
  'versions.html', 'client-auth.html', 'downloads.html'];
const scripts = readdirSync(join(ROOT, 'assets')).filter((f) => f.endsWith('.js')).map((f) => 'assets/' + f);


let fails = 0;
const bad = (id, msg) => { fails++; console.log(`  ✗ ${id} ${msg}`); };
const ok = (id, msg) => console.log(`  ✓ ${id} ${msg}`);

/* 每条断言写成一对「检测函数 + 坏样本」，正控与负控跑同一批函数 —— 负控不绿＝判据恒绿。
   ★2026-11-04 独立复核指出：原版把"被骂的那句字面量"当负控样本，等于自证；
     而且只钉字面量 ⇒ 换个 id / 换个写法就能绕过。这一版改成：
       · 检测的是**行为痕迹**（顶栏出现"升级"、面板工具行出现"已选"、任何读 panel 参数的写法）；
       · 负控分两类：bad[] 必须判红（换写法的坏样本），alias[] 必须判绿（等价好写法，防假红）。 */
/* 只判"会执行/会显示的东西"：注释里出现"升级""panel"是在记录历史，不该判红。 */
const stripComments = (t) => t
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/[ \t]+\/\/[^\n]*$/gm, '');
const H = stripComments(appHtml), J = stripComments(appJs), C = stripComments(sysCss);
const topbarOf = (html) => (html.match(/<div class="tb-ops"[\s\S]*?<\/div>/) || [''])[0];
const batchOf  = (html) => (html.match(/<div class="p-batch"[\s\S]*?<\/div>/) || [''])[0];

const DETECT = {
  /* 顶栏不许出现"升级"二字（含改名成别的 id 的按钮/链接），也不许出现旧 id */
  IA1: (html) => !/act-upgrade-all/.test(html) && !/升级/.test(topbarOf(html)),
  /* 多选工具行不许出现"已选"这类第二个计数（旧 id 或新写法都算） */
  IA2: (html) => !/p-batch-n/.test(html) && !/已选/.test(batchOf(html)),
  /* 任何"读 panel/updates 参数"的写法都算（qs.get / URLSearchParams / includes 全兜住） */
  IA3: (js) => !/wantPanel/.test(js)
    && !/(?:qs\.get|get|includes|match)\(\s*['"](?:panel|updates)['"]\s*\)[\s\S]{0,120}?openDlg/.test(js)
    && !/stripEntryParams\(\)[^\n]*\n[\s\S]{0,160}?openDlg\(/.test(js),
  /* 角标必须真的挂在「已装配」页签里（不是别处放一个同 id 的空壳） */
  IA4: (html, js) => /id="tab-on"[\s\S]{0,240}?id="tab-upd-chip"/.test(html) && /tab-upd-n/.test(js) && !/upd-chip/.test(topbarOf(html)),
  /* 全部升级只在已装配页签：直写与 if 分支两种等价写法都认 */
  IA5: (js) => /allNow\.hidden\s*=\s*tab\s*!==\s*'on'/.test(js) || /if\s*\(\s*tab\s*!==\s*'on'\s*\)\s*\{?\s*allNow\.hidden/.test(js) || /tab\s*===\s*'on'\s*\?\s*[^:;]*allNow\.hidden/.test(js),
  /* 页签必须支持方向键切换（WAI-ARIA APG Tabs）：两处页签（装配面板 / 引用管理）都要有 */
  IA8: (a, r) => /ArrowRight/.test(a) && /\.p-tabs/.test(a) && /ArrowRight/.test(r) && /\.ru-tab/.test(r),
  /* 预览/代码切换：应用配置与组件配置页都必须有（用户 2026-11-04 点名"这么重要的东西"），
     且不许再出现"这两页不显示"的早退守卫；提示图标与文案也必须在。 */
  IA9: (aHtml, cHtml, vJs) => /viewmode\.js/.test(aHtml) && /viewmode\.js/.test(cHtml)
    && /seg-tip/.test(vJs) && /data-tip/.test(vJs)
    && !/if \(document\.querySelector\('#act-publish'\)\) return;/.test(vJs),
  /* ★2026-11-04 退役并反向：用户判定「语音模式的切换确实不好用，涉及的都改掉」。
     两处都不许再出现切换按钮/模式字样；语音只保留"转成文字 → 人确认点发送"。
     判据不删，改成防止这个功能被重新加回来。 */
  IA10: (fJs, xJs) => !/fk-vmode|xz-vmode|voiceMode|语音发送方式|直接发/.test(fJs + xJs),
  /* 顶栏次要按钮＝描边：必须同时有 --line-2 描边与无阴影（只删阴影＝不再是框） */
  IA7: (css) => /\.topbar\s+\.btn\.ghost\s*\{[^}]*border:[^;}]*(?:--line-2|1px solid)[^}]*box-shadow:\s*none/.test(css),
};

const BAD = {
  IA1: '<div class="tb-ops"><button class="btn ghost" id="act-upgrade">一键升级 <b>2</b></button></div>',
  IA2: '<div class="p-batch"><span class="p-batch-n">已选择 2 项</span></div>',
  IA3: "var p = new URLSearchParams(location.search); if (p.get('panel') === 'installed') openDlg('on');",
  IA4: '<button id="tab-on">已装配 <span id="n-on">0</span></button><span id="tab-upd-chip">2 个可升级</span>',
  IA5: 'updNow = updMap();',
  IA7: '.topbar .btn.ghost{background:transparent;box-shadow:none}',
  IA8: 'setTab(); // 只有点击，没有方向键',
  IA9: "<script src=\"assets/viewmode.js\"></script>",
  IA10: "<button class=\"fk-vmode\" data-mode=\"auto\">直接发</button><button class=\"xz-vmode\">转文字</button>",
};
/* 等价好写法：必须判绿，否则判据只会红不会用（假红也是缺陷） */
const ALIAS = {
  IA5: "if (tab !== 'on') { allNow.hidden = true; }",
  IA3: "stripEntryParams();",
  IA7: '.topbar  .btn.ghost {\n  background: transparent;\n  border: 1px solid var(--line-2);\n  box-shadow: none;\n}',
  IA8: "if (e.key === 'ArrowRight') setTab('on'); // .p-tabs .ru-tab ArrowRight",
};

/* 文案扫描：去掉空白再比 —— 用户看到的是"需 手动"还是"需手动"没有区别，
   判据也不该因为排版换了行/加了空格就判绿（这是复核指出的绕过口）。 */
const normalizeCopy = (t) => t.replace(/\s+/g, '');
function scanBanned(label, text, quiet) {
  const norm = normalizeCopy(text);
  const hits = BANNED.filter(([w]) => norm.includes(normalizeCopy(w))).map(([w]) => w);
  if (!quiet) {
    if (hits.length) bad('IA6', `${label} 出现禁用词：${hits.join('、')}`);
    else ok('IA6', `${label} 无禁用词`);
  }
  return hits.length;
}

if (NEG) {
  console.log('── 负控：坏样本必须判红，等价好写法必须判绿 ──');
  let n = 0;
  for (const [id, fn] of Object.entries(DETECT)) {
    const bad = fn(BAD[id], BAD[id], BAD[id]);
    if (bad === true) { console.log(`  ✗ ${id} 坏样本没被判红（判据恒绿）`); n++; }
    else console.log(`  ✓ ${id} 坏样本被判红`);
    const alias = ALIAS[id];
    if (alias != null) {
      const a = fn(alias, alias, alias);
      if (a !== true) { console.log(`  ✗ ${id} 等价好写法被误判红（假红）`); n++; }
      else console.log(`  ✓ ${id} 等价好写法判绿`);
    }
  }
  for (const [w] of BANNED) {
    const spaced = w.split('').join(' ');
    if (scanBanned('负控 ' + w, '文案里写：' + w + '。', true) === 0) { console.log('  ✗ IA6 扫不出：' + w); n++; }
    if (scanBanned('负控(间隔) ' + w, '文案里写：' + spaced + '。', true) === 0) {
      console.log('  ✗ IA6 加空格就绕过：' + w); n++;
    }
  }
  if (!n) console.log(`  ✓ IA6 ${BANNED.length} 条禁用词全部可扫出（含加空格写法）`);
  /* ⚠ 退出码是反直觉的，别"修"回 0（2026-11-04 踩过）：
     仓里约定 `--negctl` 的返回值就是**判据自己的红绿**——坏样本喂进来，判据该判红 ⇒ rc=2。
     所以 n=0（坏样本全被判红）时反而返回 2；n>0（有坏样本没红）时返回 0，表示"喂了坏样本也不红"。
     check-judgments 就是按 rc∈{1,2} 判"这条判据能红"；这里若返回 0，会被判成假绿。 */
  console.log(n ? `负控失败 ${n} 条：判据不能证明会红/会绿，不算判据` : '负控通过：坏样本全红、等价写法全绿');
  process.exit(n ? 0 : 2);
}

console.log('── 正控：装配/升级的落点与文案 ──');
DETECT.IA1(H) ? ok('IA1', '顶栏没有独立升级按钮') : bad('IA1', 'app.html 仍存在 id="act-upgrade-all"：升级回到顶栏了');
DETECT.IA2(H) ? ok('IA2', '工具行没有重复计数') : bad('IA2', 'app.html 仍有 id="p-batch-n"：已选 N 与动作按钮上的 N 重复');
DETECT.IA3(J) ? ok('IA3', '不会自动展开装配抽屉') : bad('IA3', 'app.js 仍在消费 panel/updates 参数自动开抽屉');
DETECT.IA4(H, J) ? ok('IA4', '已装配页签挂可升级角标') : bad('IA4', '缺少 tab-upd-chip / tab-upd-n：可升级数没有唯一落点');
DETECT.IA5(J) ? ok('IA5', '全部升级只在已装配页签出现') : bad('IA5', '缺少 allNow.hidden = tab !== \'on\'：全部升级会出现在可装配页签');
DETECT.IA7(C) ? ok('IA7', '顶栏次要按钮是描边态') : bad('IA7', '.topbar .btn.ghost 仍是白底+阴影');
const refJs = stripComments(read('assets/ref-upgrade.js'));
DETECT.IA8(J, refJs) ? ok('IA8', '两处页签支持方向键切换') : bad('IA8', '页签只有点击，没有方向键（APG Tabs 要求）');
const compHtml = read('component.html'), viewJs = read('assets/viewmode.js');
DETECT.IA9(H, stripComments(compHtml), viewJs) ? ok('IA9', '两页顶栏都有预览/代码切换与提示') : bad('IA9', '预览/代码缺失、被限制，或缺 ⓘ 提示');
const floatJs = read('assets/float.js'), xiaoJs = read('assets/xiaozhi.js');
DETECT.IA10(floatJs, xiaoJs) ? ok('IA10', '语音模式切换已撤：两处都没有 vmode / 模式字样') : bad('IA10', '语音模式切换被重新加回来了（用户 11-04 判定不好用，已撤）');

for (const p of pages) scanBanned(p, stripComments(read(p)));
for (const s of scripts) scanBanned(s, stripComments(read(s)));

console.log(fails ? `断点 ${fails} 条` : '全过');
process.exit(fails ? 2 : 0);
