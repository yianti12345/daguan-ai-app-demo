#!/usr/bin/env node
/* check-judgments —— 判据的判据：验「判据本身是不是活的」。
 *
 * 为什么有它（这是这一轮真正的根因）：
 *   坏了四个地方（画布空白、组件清单两份、内部用语上界面、面板口径不对），
 *   而门禁 9 项全绿、e2e 22 项全绿。也就是说——**绿不说明界面能用，只说明"代码里有那一行"**。
 *   更糟的是判据自己也在骗人：L5 的对象 `.toast` 早被 `#hint` 取代（找不到就跳过 ⇒ 恒绿）；
 *   R2 的验证样本改的是别名数组（量到的是正常页面 ⇒ 恒绿）；
 *   check-preview 连的是 8977（门禁跑 8941 ⇒ 判绿的是另一份代码）。
 *   三次都是同一个病：**判据的对象消失了，判据不报错，只安静地变绿。**
 *
 * 所以这个脚本只做三件事，逐条对着 tools/judgments.mjs 的台账跑：
 *   1. 主体还在吗 —— 台账里写的选择器在真实页面上必须命中 ≥1；命中 0 ⇒ 判红（对象没了）
 *   2. 负控能红吗 —— 每条判据的 `--negctl` 必须真的以 rc=2 退出；跑不出红 ⇒ 判红（判据失效）
 *   3. 台账齐不齐 —— tools/ 下的每个判据脚本都必须在台账里有一条，反之亦然（防"加了判据没登记"）
 *
 * 用法：node tools/check-judgments.mjs [base] [--quick]   （--quick 只验主体，不跑负控）
 *      node tools/check-judgments.mjs --negctl             负控：给本判据自己的三套判定喂坏输入，
 *                                                        每套都必须判红（不起浏览器、秒级）
 * 退出码：0 通过 ｜ 2 有断点 ｜ 3 环境不可用 / 负控没抓住坏输入 ｜ 4 负控档：坏输入确实被抓
 *
 * ★2026-10-27 补 --negctl：此前本判据**没有负控分支**，`--negctl` 被当成普通参数吞掉，
 *   于是"跑一次 --negctl"＝跑全量（浏览器 + 50 个工具的负控），90 秒必超时、永远进不了 pass。
 *   现在负控档只验本判据自己的判定逻辑（缺登记 / 幽灵条目 / 主体命中 0 / 负控 rc 语义），
 *   不启浏览器、不跑别人的负控；全量那一路另挂 240s 看门狗，卡住就明说卡在哪（rc=3），不装作还在跑。
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBase, debugPort } from './base.mjs';
import { CRITERIA, EXEMPT } from './judgments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const QUICK = process.argv.includes('--quick');
const NEG = process.argv.includes('--negctl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';

/* ══ 本判据自己的三套判定（纯函数；负控档直接喂坏输入验它们） ═══════════
 * 抽成函数的唯一目的是"可被证伪"：判定写在循环里就只能靠读代码相信它，
 * 抽出来之后负控可以喂「缺一条 / 多一条 / 命中 0 / rc 各种值」看它抓不抓。 */
function ledgerGaps(diskTools, registeredTools, existsFn) {
  const missingInLedger = diskTools.filter((f) => !registeredTools.has(f) && existsFn(f));
  const ghostInLedger = [...registeredTools].filter((f) => !existsFn(f));
  return { missingInLedger, ghostInLedger };
}
/* 主体命中 0 ⇒ 对象没了（判据在空转）；命中 ≥1 ⇒ 这条主体还在 */
const subjectAlive = (n) => Number(n) > 0;
/* 负控退出码 → 结论。0=没红（真问题）；3=未量；4=前提不成立；1/2=有断点（能红） */
function rcVerdict(code) {
  if (code === 0) return 'fail-0';
  if (code === 3) return 'fail-3';
  if (code === 4) return 'fail-4';
  return 'pass';
}

if (NEG) {
  /* 负控：四个坏输入，每一个都必须被本判据的判定函数抓住；抓不住 ⇒ rc=3（判据是空的） */
  const cases = [];
  const t = (name, caught, detail) => cases.push({ name, caught, detail });
  const disk = ['check-a.mjs', 'check-b.mjs'];
  const reg = new Set(['check-a.mjs']);
  const g1 = ledgerGaps(disk, reg, () => true);
  t('缺登记：盘上有 check-b.mjs 但台账没有', g1.missingInLedger.length === 1, JSON.stringify(g1.missingInLedger));
  const g2 = ledgerGaps(disk, new Set(['check-a.mjs', 'check-ghost.mjs']), (f) => f !== 'check-ghost.mjs');
  t('幽灵条目：台账写了 check-ghost.mjs 但盘上没有', g2.ghostInLedger.length === 1 && g2.ghostInLedger[0] === 'check-ghost.mjs', JSON.stringify(g2.ghostInLedger));
  t('主体命中 0：选择器一个都找不到', subjectAlive(0) === false, 'subjectAlive(0)=' + subjectAlive(0));
  t('主体命中 1：真的还在', subjectAlive(1) === true, 'subjectAlive(1)=' + subjectAlive(1));
  const want = { 0: 'fail-0', 1: 'pass', 2: 'pass', 3: 'fail-3', 4: 'fail-4' };
  const gotRc = Object.fromEntries([0, 1, 2, 3, 4].map((c) => [c, rcVerdict(c)]));
  t('负控 rc 语义：0/3/4 判红、1/2 判过', JSON.stringify(gotRc) === JSON.stringify(want), JSON.stringify(gotRc));

  console.log('负控（本判据自己的判定逻辑，不起浏览器）');
  let missed = 0;
  for (const c of cases) {
    if (c.caught) console.log(`  ✓ ${c.name} ⇒ 被抓住（${c.detail}）`);
    else { missed++; console.log(`  ✗ ${c.name} ⇒ 没被抓住（${c.detail}）—— 这一格没在量`); }
  }
  console.log('');
  if (missed) {
    console.log(`负控 ${cases.length - missed}/${cases.length} 命中：有 ${missed} 格没被抓住 ⇒ 本判据在这几格证明不了自己会红（rc=3 未量）`);
    process.exit(3);
  }
  console.log(`负控 ${cases.length}/${cases.length} 命中 ⇒ 本判据的判定逻辑是活的（rc=2：坏输入被抓＝有断点，与 tools/negctl.tsv 的 pass 口径一致）`);
  process.exit(2);
}

let BASE;
try { BASE = await resolveBase(); }
catch (e) { console.log('FATAL: ' + e.message); process.exit(3); }

/* 看门狗（2026-10-27 加）：全量这一路要起浏览器 + 逐工具跑负控，实测 90 秒跑不完。
   没有它的时候，外面按 90 秒掐断只会得到一个 TIMEOUT —— 那既不是绿也不是红，是没人知道卡在哪。
   卡住就明说卡在哪个阶段（rc=3 未量），并留下最后一行进度。
   ★10-27 晚：先设 240s，实测全量（浏览器 + 全部工具的负控）240s 跑不完、600s 也只跑到第 32/47 个工具，
   于是把一次"慢但会跑完"的自检误判成未量 —— 看门狗只能当保险丝，不能比正常耗时更短，改 1200s（按实测每家耗时推算约 880s，留 4 成余量）。 */
let stage = '启动';
setTimeout(() => {
  console.log(`GATE TIMEOUT: 1200s 内没跑完，最后阶段＝${stage}；这不是绿，是没量（rc=3）`);
  try { chrome?.kill('SIGKILL'); } catch (e) {}
  process.exit(3);
}, 1200000);

let pass = 0, fail = 0;
const out = (ok, msg, detail = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + msg + (detail ? ' → ' + detail : ''));
};

/* ══ 3. 台账齐不齐 ═══════════════════════════════════════════ */
console.log('── 台账完整性');
/* ⚠ 2026-10-23 改：原来按文件名前缀 `gate-`/`check-` 筛，于是
   walk / hit-audit / doc-parity 三个真判据从来没被点名过 —— "判据齐不齐"这条判据
   自己按名字认人，漏了三个。现在改成**按名单**：tools/ 下所有 .mjs，
   要么在台账里，要么在 EXEMPT 里（且 EXEMPT 必须写理由）。 */
const allMjs = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
const unknown = allMjs.filter((f) => !EXEMPT[f]);
const gateTools = unknown.filter((f) => f !== 'stamp.mjs');
/* 台账里出现的工具集合，必须与 tools/ 下的判据脚本集合一致（stamp 也在这套里） */
const registered = new Set(CRITERIA.map((c) => c.tool));
const onDisk = new Set(gateTools.concat(['stamp.mjs']));
/* 判定走与负控档同一个函数：负控喂的是坏输入，正控喂的是盘上真值 */
const { missingInLedger, ghostInLedger } = ledgerGaps([...onDisk], registered, (f) => existsSync(join(HERE, f)));
out(missingInLedger.length === 0, '每个判据脚本都在台账里', missingInLedger.join(' / ') || '无遗漏');
out(ghostInLedger.length === 0, '台账里没有指向不存在脚本的条目', ghostInLedger.join(' / ') || '无幽灵');

/* ══ 1. 主体还在吗（真浏览器） ═══════════════════════════════ */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null && this.wait.has(m.id)) {
        const w = this.wait.get(m.id); this.wait.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.wait.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), 20000);
    });
  }
}

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/jdg-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=1',
  'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起 */ }
  await sleep(200);
}
if (!wsUrl) { console.log('FATAL: Chrome 起不来'); process.exit(3); }
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
const c = new CDP(ws);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await c.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160));
  return r.result.value;
};

stage = '主体在不在';
console.log('── 判据主体是否还活着（命中 0 条 = 对象没了，判据在空转）');
/* ⚠ 这里第一版是"同一页只导航一次"的缓存，结果后面几条全量到了**上一个页面**上：
   台账顺序是 components → component → components，缓存让第二次回 components 时没导航，
   于是在 component.html 上找 #grid 和 .sider ⇒ 命中 0 ⇒ 报"主体消失"的假红。
   这正是它自己要防的那个病（判据量错目标），只不过这次发生在判据的判据里。
   ⇒ 不复用，每次按 page 现导航；页面只有 4 个，慢一点换正确。 */
let currentPage = '';
async function hitCount(page, sel) {
  if (currentPage !== page) {
    await c.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(700);
    currentPage = page;
  }
  return ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
}

for (const crit of CRITERIA) {
  /* ★2026-10-27：没有 subject 的条目直接跳过。
     subject 是「这条判据要在页面/文件上取样哪些点」——纯文件判据（判据锁、覆盖闸、负控台账、
     promise 的输入表）本来就没有页面取样点。此前 CRITERIA 里每条都写了 subject，
     于是这段默认它必有；本轮补齐 19 条台账后第一次遇到无 subject 的条目，直接崩了。
     缺 subject 不等于缺判据：它只是没有取样点，不该让整条判据自检停摆。 */
  if (!Array.isArray(crit.subject)) continue;
  for (const s of crit.subject) {
    if (s.file) {
      const p = join(ROOT, s.file);
      const txt = existsSync(p) ? readFileSync(p, 'utf8') : '';
      /* file 型主体：`file:'index-of-assets'` 表示"这个资源文件存在"，
         其余情况是"这个文件里出现了某段代码/文本"。第一版把这两个判断写反了，
         于是 S1 的主体永远命中 0。 */
      const n = s.file === 'index-of-assets'
        ? readdirSync(join(ROOT, 'assets')).filter((f) => s.sel.endsWith('/' + f)).length
        : (txt.split(s.sel).length - 1);
      out(subjectAlive(n), `${crit.id} 主体 · ${s.file} 含「${s.sel}」`, `命中 ${n}`);
      continue;
    }
    let n = 0, err = '';
    try { n = await hitCount(s.page, s.sel); } catch (e) { err = String(e.message).slice(0, 80); }
    out(subjectAlive(n) && !err, `${crit.id} 主体 · ${s.page} → ${s.sel}`, err || `命中 ${n}`);
  }
}

/* ══ 2. 负控能红吗 ═══════════════════════════════════════════ */
if (QUICK) {
  console.log('── 负控（--quick 跳过）');
} else {
  stage = '各工具负控';
  console.log('── 每条判据能否证明会红（跑各自的 --negctl，必须 rc=2）');
  const run = (tool, args) => new Promise((res) => {
    const p = spawn(process.execPath, [join(HERE, tool), ...args], {
      cwd: ROOT, env: { ...process.env, GATE_BASE: BASE + '/' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (code) => res({ code, buf }));
    setTimeout(() => { try { p.kill(); } catch (e) {} res({ code: -1, buf: 'timeout' }); }, 180000);
  });
  /* ⚠ 按工具去重：同一个脚本里有多条判据（check-solid 现在有 R1-R8 八条），
     负控是脚本级的，跑一次就够了。上一版按"判据条数"跑，同一个脚本被起了 8 次 Chrome。 */
  const byTool = new Map();
  const skipped = [];
  for (const c of CRITERIA) {
    /* negctl:'external' = 这条判据的自证太重（reach-walk 单轮 1-2 分钟），
       放进这里会让 Q1 从 40 秒变成 3 分钟，且一超时就把整个自检判红。
       代价要说清：**它的负控从此不自动跑**，靠收尾手工。这是明账，不是漏。 */
    if (c.negctl === 'external') { out(true, `${c.id} · ${c.tool} --negctl 由收尾手工跑（negctl:'external'）`, '未自动验'); continue; }
    /* negctl:'none' = 这条工具不是"判绿判红"的判据（出图、探索性扫描），没有可证伪的断言。
       它既不进通过、也不进断点 —— 打印一行明账，不假装绿也不制造永久红。
       想让其中某条变成真判据，就给它写 --negctl 并把这里改成 'flag'。 */
    if (c.negctl === 'none') { skipped.push(`${c.id}(${c.tool})`); continue; }
    if (!byTool.has(c.tool)) byTool.set(c.tool, []);
    byTool.get(c.tool).push(c.id);
  }
  /* ★2026-10-27 改（这一条此前判的是形式，不是实质）：
     原来只认 `rc === 2` 为"红了"。而实际跑出来 rc 有 0/1/2/3/4 五种含义：
       0 = 没红（判据不能证伪）   ← 这是**唯一的真问题**
       1 = 有断点（有几条判据用它，与 2 同义）
       2 = 有断点（多数判据用它）
       3 = 未量（负控中途缺数据，比如 shoot 起不来）  ← 不许当绿，但也不是"不能红"
       4 = 前提不成立（注入前已经是红的）
     按 "必须等于 2" 判，27 条里 9 条因为"用 1 不用 2"被判红 —— 那 9 条其实都能红。
     **形式不统一被当成判据失效**，与今天反复出现的"判错对象"是同一类错。
     现在：0 判红；3 单列为"负控未量"（不算通过，也不算失败，进未量账）；
     4 判红（前提本身就不成立，等于这次自证没跑成）；1/2 都算红。 */
  if (skipped.length) console.log(`  · 无负控（不是判据，无可证伪断言，不计入通过/断点）：${skipped.join(' / ')}`);
  for (const [tool, ids] of byTool) {
    stage = '负控：' + tool;
    const r = await run(tool, ['--negctl']);
    const tail = r.buf.split('\n').slice(-2).join(' ').slice(0, 90);
    const v = rcVerdict(r.code);
    if (v === 'fail-0') {
      out(false, `${ids.join(' / ')} · ${tool} --negctl 能红`, `rc=0（负控没红 ⇒ 这条判据证明不了自己会红）${tail}`);
    } else if (v === 'fail-3') {
      out(false, `${ids.join(' / ')} · ${tool} --negctl 能红（未量）`, `rc=3 负控未量，不许当绿${tail}`);
    } else if (v === 'fail-4') {
      out(false, `${ids.join(' / ')} · ${tool} --negctl 能红`, `rc=4 前提不成立（注入前已经是红的）${tail}`);
    } else {
      out(true, `${ids.join(' / ')} · ${tool} --negctl 能红`, r.code === 1 ? 'rc=1（与 2 同义：有断点）' : '');
    }
  }
}

console.log('');
console.log(`通过 ${pass} ｜ 断点 ${fail}`);
chrome.kill();
process.exit(fail ? 2 : 0);
