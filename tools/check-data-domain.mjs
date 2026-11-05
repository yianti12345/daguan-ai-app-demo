/* check-data-domain.mjs —— 值域与主客关系（第 32 门；S6 调研的产物）
 *
 * 起因（用户 m04973「逐个环节都要优化」；S6 结论）：
 *   项目有 27 道门，没有一道量「数据里的值是否在值域内」和「外键是否指向存在的实体」。
 *   实测：把 status 写成「已上线」之后，content-contract / card-copy / consistency **全部 rc=0**，
 *   而筛选器的四个选项都筛不到那张卡；把 APP_COMPS 注入一个不存在的组件 id，
 *   `assets/data.js:173` 静默丢弃，盘面 4 条装配、加载后 3 条 —— 无日志、无红。
 *
 * 判什么：
 *   1. 枚举值域：status ∈ {已上架, 未发布, 已下架}（现役三档）+ 草稿（老存档读回兜底）；
 *      enabled 必须是布尔或未定义；应用 version 必须是 ≥0 的整数。
 *   2. 外键完整：APP_COMPS[appId] 的每个 compId 必须存在于 COMPS；键必须是存在的应用 id。
 *   3. 无孤儿：每个组件至少被 1 个应用装配。
 * rc：0 通过；2 有违规；--negctl 注入「已上线」与孤儿外键必须 rc=2；
 *     --negctl-status 只注入「已上线」，枚举那一条必须自己判红（rc=2）。
 *
 * ★2026-10-28（机制审查官）：发布态 10-27 由「草稿」改名为「未发布」（data.js:49/55 与
 *   DB.compState 都按新名派生），枚举表没跟 ⇒ 两条现役应用被判成值域外（假红）。
 *   「草稿」只留给老存档读回兜底（与 tools/check-card-copy.mjs:55 同一处口径），
 *   不等于放行任意状态：不在表内的值仍判红 —— 这就是 --negctl 注入「已上线」要证的事。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'assets/data.js');
const NEG = process.argv.includes('--negctl');
const TMPD = join(HERE, '.dotmp');
const tmp = join(TMPD, 'domain-neg.js');

if (!existsSync(DATA)) { console.log('FATAL: assets/data.js 不存在'); process.exit(3); }
/* 现役四档 + 两个老存档值（读回时不许判红）。
   ★2026-11-04 校正：「内测中」是 2026-11-03 三态动作引入的现役状态
   （apps.html:305「未上架→发布内测版→内测中→上架正式版→已上架」；data.js:105 东方证券那条就是内测中），
   原枚举只列 已上架/未发布/已下架/草稿，把现役状态判成越界 —— 判据写旧了，不是数据坏了。 */
const STATUSES = ['未上架', '内测中', '已上架', '已下架', '未发布', '草稿'];

let fail = 0;
const out = (ok, label, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`); if (!ok) fail++; };

function loadDB(file) {
  const src = readFileSync(file, 'utf8');
  const store = new Map();
  const fakeWindow = {};
  const sandbox = {
    window: fakeWindow,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'data.js' });
  const db = fakeWindow.DB;
  /* ★ 数据是懒加载的：`DB.load()` 才把种子灌进 APPS/COMPS（data.js:116）。
     不调它就量到 0 应用 / 0 组件 —— 第一版就是这么假绿的（正控 rc=0 但分母 0）。 */
  if (db && typeof db.load === 'function') db.load();
  return db;
}

let DB;
/* 两把刀分开口子：--negctl-status 只注入值域外 status（证明枚举那一条真会红），
   --negctl 同时注入 status + 孤儿外键（旧口径，保留）。合成一刀会让"red"有两个来源，
   删掉枚举检查后照样 rc=2 —— 那是负控互相顶罪的假红。 */
const NEG_STATUS = process.argv.includes('--negctl-status');
const NEG_ANY = NEG || NEG_STATUS;
if (NEG_ANY) {
  mkdirSync(TMPD, { recursive: true });
  const patched = readFileSync(DATA, 'utf8')
    /* 值域外状态：种子里第一处 '已上架' */
    .replace("'已上架'", "'已上线'");
  writeFileSync(tmp, patched);
  console.log('· 负控：已注入 status=「已上线」' + (NEG ? '；孤儿外键在 load() 之后注入（见下）' : '（只此一处）'));
}

try {
  DB = loadDB(NEG_ANY ? tmp : DATA);
} catch (e) {
  console.log('FATAL: 数据层加载失败 · ' + e.message);
  if (NEG_ANY) { try { unlinkSync(tmp); } catch {} }
  process.exit(3);
}
if (!DB) { console.log('FATAL: data.js 没有暴露 window.DB'); process.exit(3); }

/* 孤儿外键必须在 load() 之后注入：种子里 apps[i].comps 是空的，装配关系由 load()
   从存档/种子装配层派生（data.js:184-191）。原来在源码里 replace `comps: [...]`
   会命中最先出现的 COMPS 组件定义数组（data.js:58），根本不是装配关系 ——
   于是孤儿外键一刀从来没真注入过，旧版靠 status 那一刀的红冒充"两刀都成立"。
   ★2026-10-28（机制审查官）拆成两把刀后当场暴露，改为注入到 load() 之后的 APPS[0].comps。 */
if (NEG) {
  const first = (DB.APPS || [])[0];
  if (!first) { console.log('FATAL: 负控无处注入（DB.APPS 为空）'); try { unlinkSync(tmp); } catch {} process.exit(3); }
  first.comps.push('ghost-comp');       /* APP_COMPS[appId] 与它是同一个数组 */
  console.log('· 负控：已给「' + first.name + '」塞入不存在的组件 id ghost-comp');
}

/* 1. 枚举值域 */
const badStatus = [], badVer = [];
for (const a of DB.APPS || []) {
  if (!STATUSES.includes(a.status)) badStatus.push(`应用「${a.name}」status=${a.status}`);
  if (!(Number.isInteger(a.version) && a.version >= 0)) badVer.push(`应用「${a.name}」version=${JSON.stringify(a.version)}`);
}
for (const c of DB.COMPS || []) {
  if (!STATUSES.includes(c.status)) badStatus.push(`组件「${c.name}」status=${c.status}`);
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') badStatus.push(`组件「${c.name}」enabled=${JSON.stringify(c.enabled)}`);
}
out(badStatus.length === 0, `枚举值域（status ∈ ${STATUSES.join('/')}；enabled 布尔）`, badStatus.join(' ；') || `${(DB.APPS || []).length} 应用 / ${(DB.COMPS || []).length} 组件`);
out(badVer.length === 0, '应用版本号是 ≥0 的整数', badVer.join(' ；') || 'ok');

/* 2. 外键完整 + 3. 无孤儿 */
const appIds = new Set((DB.APPS || []).map(a => a.id));
const compIds = new Set((DB.COMPS || []).map(c => c.id));
const pairs = [];
const badKeys = [];
for (const [appId, comps] of Object.entries(DB.APP_COMPS || {})) {
  if (!appIds.has(appId)) badKeys.push(appId);
  for (const cid of comps || []) pairs.push({ appId, compId: cid });
}
const badRefs = pairs.filter(p => !compIds.has(p.compId));
out(badKeys.length === 0 && badRefs.length === 0, 'APP_COMPS 外键都指向存在的实体',
  [...badKeys.map(k => '孤儿 appId=' + k), ...badRefs.map(p => `${p.appId}→${p.compId}`)].join(' ；') || `${pairs.length} 条装配`);

const used = new Set(pairs.map(p => p.compId));
const unused = (DB.COMPS || []).filter(c => !used.has(c.id)).map(c => c.name);
/* ★ 第一版把「有组件没被任何应用装配」判成红，跑出两条孤儿（规则配置 / 规则配置（医药口径））。
   复查后判定是**判据写错了**，不是数据错：组件库允许存在「还没人用」的组件，
   卡面上也确实写着「还没有应用使用」。真正的不变量是 refs 必须等于真实装配数
   （data.js:101 的注释就是这么写的：「refs 不手写：有几个应用装着它，就是几个」）。 */
const refsBad = (DB.COMPS || []).filter(c => {
  const real = pairs.filter(p => p.compId === c.id).length;
  return typeof c.refs === 'number' && c.refs !== real;
}).map(c => `${c.name} refs=${c.refs} 实际=${pairs.filter(p => p.compId === c.id).length}`);
out(refsBad.length === 0, `refs 与真实装配数一致（${unused.length} 个组件暂无人用，属正常）`,
  refsBad.join(' ；') || (unused.length ? `暂无人用：${unused.join('/')}` : 'ok'));

if (NEG_ANY) { try { unlinkSync(tmp); } catch {} }
console.log('');
if (NEG_ANY) {
  const statusCaught = badStatus.length > 0;
  const fkCaught = badKeys.length + badRefs.length > 0;
  if (NEG_STATUS) {
    console.log(statusCaught ? '负控成立（值域外 status ⇒ rc=2）' : '负控失败：注入值域外 status 后仍判绿');
    process.exit(statusCaught ? 2 : 1);
  }
  const ok = statusCaught && fkCaught;
  console.log(ok ? '负控成立（值域外 + 孤儿外键 ⇒ rc=2）'
    : '负控失败：' + (!statusCaught ? '值域外 status 没抓到' : '孤儿外键没抓到'));
  process.exit(ok ? 2 : 1);
}
console.log(`通过 ${4 - fail} ｜ 断点 ${fail}`);
process.exit(fail ? 2 : 0);
