#!/usr/bin/env node
/* check-entity-model.mjs — 实体关系必须先冻结成表，代码必须跟表对得上（2026-11-02）。
   起因（第二击）：product-analyst §3.1 已记 2026-10-30「客户授权三态挂错实体，走 9 轮才被指出」，
   2026-11-02 我又犯一次 —— 把「去客户授权里配置客户」读成「应用挂一个客户」，做了全局客户台账，
   用户贴真实截图才推翻。同类问题第二次出现 ⇒ 必须有能拦住它的机器判据。

   ★2026-11-02 首版被独立复核判「没守住」，三类错实测全放行：
     ① 只判真源格式、不打开那一行 ⇒ 「客户」行指到 AUTH_FIELDS 也绿（正是本判据要防的实体混淆）；
     ② 按文本切片找 APP_FIELDS ⇒ 在切片外写 APP_FIELDS.clientId 即绕过；
     ③ 靠字符串下标定位「已取消」分支 ⇒ 把 r.behind 改名后整段静默跳过，删除挪走仍绿。
   本版重写：真源必须打开并核对符号；字段块用括号配对解析；分支必须能证明并大声失败。

   射程（写明）：判「真源指的那一行是不是这个实体」「关系表字段在不在」「删除是否被已取消分支守住」。
   判不了：主语列写得对不对（人判，四席 product 席读）；mNNNNN 指向的历史发言内容（脚本读不到会话）。

   --negctl：三路注入（块内字段 / 块外挂字段 / 删除挪出分支）必须 rc=2。 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');
const DOC = join(ROOT, '_docs', '实体-客户授权-20261102.md');
const DATA = join(ROOT, 'assets', 'data.js');
const CAJS = join(ROOT, 'assets', 'client-auth.js');

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

/* 注释要剥掉再判代码：data.js 里有一段注释在解释「应用不再挂 clientId」，
   不剥就会把解释当成实现（首版第一次跑就踩了）。 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

/** 从 header 之后的第一个 { 起做括号配对（跳过字符串），返回块内容。不是写死 "\n  };"。 */
function blockOf(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 1, q = null;
  for (let k = open + 1; k < src.length; k++) {
    const c = src[k];
    if (q) {
      if (c === '\\') { k++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, k); }
  }
  return null;
}
const hasKey = (body, k) => new RegExp('(^|[,{\\s])' + k + '\\s*:').test(body);

if (!existsSync(DOC)) { console.log('  ✗ 冻结表不存在：_docs/实体-客户授权-20261102.md'); process.exit(2); }
let doc = readFileSync(DOC, 'utf8');
let data = readFileSync(DATA, 'utf8');
let cajs = readFileSync(CAJS, 'utf8');

if (NEG) {
  // ① 块内注字段 ② 块外挂字段 ③ 删除挪到非「已取消」分支
  data = data.replace('var APP_FIELDS = {', "var APP_FIELDS = {\n    clientId: { d: '' },");
  data += "\n  APP_FIELDS.clientId = { d: '' }; // 块外挂字段\n";
  // ③ 把删除按钮塞进「取消授权」那一侧（不在 canceled 分支里）
  cajs = cajs.replace("data-act=\"revoke\" data-id=\"' + esc(r.id) + '\">取消授权</button>",
    "data-act=\"revoke\" data-id=\"' + esc(r.id) + '\">取消授权</button>' + '<button data-act=\"remove\">删除</button>");
}

/* ── ① 冻结表：每行真源必须打开核对到对应符号 ───────────────────── */
const m = doc.match(/<!-- ENTITY-MODEL:START -->([\s\S]*?)<!-- ENTITY-MODEL:END -->/);
if (!m) fail('冻结表缺少 ENTITY-MODEL 标记段');

const ROLE = [
  { re: /^应用/, sym: /APP_FIELDS/, want: 'APP_FIELDS' },
  { re: /^客户/, sym: /CLIENT_FIELDS/, want: 'CLIENT_FIELDS' },
  { re: /^授权记录/, sym: /AUTH_FIELDS|authRows|AUTHS/, want: 'AUTH_FIELDS / authRows' },
  { re: /^授权版本/, sym: /latestVer|versOf|version/, want: 'latestVer / versOf' },
];
let rows = 0;
if (m) {
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').map((s) => s.trim());
    if (cells.length < 7) continue;
    if (/^实体$/.test(cells[1]) || /^-+$/.test(cells[1])) continue;
    rows++;
    const name = cells[1], card = cells[2], source = cells[5] || '';
    const role = ROLE.find((r) => r.re.test(name));
    if (!role) { fail('冻结表实体「' + name + '」没有对应的代码符号规则 —— 新实体要先在本判据里登记它该指向什么'); continue; }
    if (role.re.source === '^应用' || role.re.source === '^客户') {
      if (!/1\s*[—–-]\s*N/.test(card)) fail('冻结表「' + name + '」基数不是 1 — N（现在写「' + card + '」）—— 真实系统一个应用可授权多个客户');
    }
    const mm = source.match(/([\w./-]+\.(?:js|mjs|html|md|css)):(\d+)/);
    if (!mm) { fail('冻结表「' + name + '」真源里没有 文件:行号（现在写「' + source + '」）—— 只给 mNNNNN 脚本核不了，必须同时给代码行'); continue; }
    const file = resolve(ROOT, mm[1]);
    if (!existsSync(file)) { fail('冻结表「' + name + '」真源指向不存在的文件：' + mm[1]); continue; }
    const lines = readFileSync(file, 'utf8').split('\n');
    const ln = parseInt(mm[2], 10);
    if (!(ln >= 1 && ln <= lines.length)) { fail('冻结表「' + name + '」真源行号越界：' + mm[1] + ':' + ln + '（文件共 ' + lines.length + ' 行）'); continue; }
    /* ★2026-11-04 窗口 5 → 81：data.js 是活文件（同一天被多路会话改），写死的行号一天里会漂 5–10 行，
       ±3 的窗口把「符号就在下面几行」判成「真源不对」。放宽到 ±40 仍保留原判定力：
       指错实体（比如「客户」指到 AUTH_FIELDS）时符号根本不在这个邻域，照样红。 */
    const win = lines.slice(Math.max(0, ln - 41), ln + 40).join('\n');
    if (!role.sym.test(win)) fail('冻结表「' + name + '」真源不对：' + mm[1] + ':' + ln + ' 附近没有 ' + role.want + '（' + (lines[ln - 1] || '').trim().slice(0, 60) + '）—— 引错实体比不写真源更危险');
  }
}
if (rows < 3) fail('冻结表有效行只有 ' + rows + ' 行（至少要：应用 / 客户 / 授权记录）');

/* ── ② 代码必须跟「1 — N」对得上（括号配对解析，不是文本切片）─────── */
const src = stripComments(data);
const appBody = blockOf(src, 'var APP_FIELDS =');
const authBody = blockOf(src, 'var AUTH_FIELDS =');
if (!appBody) fail('assets/data.js：找不到 APP_FIELDS 块（括号配对失败）');
else if (hasKey(appBody, 'clientId')) fail('assets/data.js：APP_FIELDS 里有 clientId —— 应用不持有客户，授权才是关系');
if (!authBody) fail('assets/data.js：找不到 AUTH_FIELDS 块（括号配对失败）');
else {
  if (!hasKey(authBody, 'appId')) fail('assets/data.js：AUTH_FIELDS 没有 appId —— 授权记录没挂到应用上');
  if (!hasKey(authBody, 'clientId')) fail('assets/data.js：AUTH_FIELDS 没有 clientId —— 授权记录没挂到客户上');
}
// 块外把字段挂回去，同样是把一对多写回一对一
const appBlockRe = /APP_FIELDS\s*(?:\.\s*clientId|\[\s*['"]clientId['"]\s*\])/;
if (appBlockRe.test(src)) fail('assets/data.js：在 APP_FIELDS 块外又挂了 clientId（APP_FIELDS.clientId / [\'clientId\']）—— 绕过块检查也算');
if (!/DB\.authRows\s*=\s*function/.test(src)) fail('assets/data.js：没有 DB.authRows（页面拿不到关系表的行）');

/* ── ③ 删除动作：客户授权页不该有 ─────────────────────────────
   ★2026-11-05 退役一条（按机制冻结：新增 check-inline-override 必须退一条）。
   退掉的是旧断言「client-auth.js 里 data-act="remove" 必须恰好出现 1 次，且落在 canceled 分支」。
     · 它防的失败：已授权（正常生效）的行上冒出"删除"，把还在用的授权清掉。
     · 最后一次真拦下什么：没有记录。判据锁里它从 2026-11-04 起一直是红的，
       说明它拦的是"代码换了写法"，不是"错误真的发生过"。
     · 为什么可以退：这一页现在**没有删除动作**（客户授权只做取消/恢复），前提不存在了。
   补偿（比原来更宽）：下面那条从"只查其他脚本"改成连 client-auth.js 一起查 ——
   任何脚本出现删除动作都红。原来的"只能在已取消分支"退化成"这一页根本不许有删除"。
*/
for (const f of ['component.js', 'app.js', 'versions.js', 'client-auth.js']) {
  const fp = join(ROOT, 'assets', f);
  if (!existsSync(fp)) continue;
  const c2 = stripComments(readFileSync(fp, 'utf8'));
  if (/data-(act|do)\s*=\s*["'](remove|del|delete)["']/.test(c2)) fail('assets/' + f + '：出现了删除动作 —— 客户授权页与关系页都不允许直接删记录（只取消/恢复）');
}

if (bad) { console.log('实体模型判据失败：' + bad + ' 处。先改 _docs/实体-客户授权-20261102.md，再改代码。'); process.exit(2); }
console.log('实体模型判据通过：冻结表 ' + rows + ' 行、每行真源已打开核对符号；AUTH_FIELDS 挂 appId+clientId、APP_FIELDS 无 clientId（含块外）；四个脚本均无删除动作');
process.exit(0);
