#!/usr/bin/env node
/* check-gate-wiring —— **run-gates.sh 自己的接线判据**（2026-10-28 立，机制审查官）
 *
 * 族：gate-key-dup（tools/failures.tsv 第 25 行）。这是第三次复发，前两次：
 *   ① `want judgments` 行（E9-3）：组名不存在 ⇒ case 落空返回 0 ⇒ 恒真；
 *   ② `want value-provenance` 行：同一个脚本注册两个 key ⇒ 一次红被数成两次。
 *   ③ 本轮：`want cross-page` / `want list-rows` / `want card-uniform` 三行，组名都不在 want() 里。
 *
 * 病根（bash 语义，不是笔误）：
 *   `want() { case "$1" in style) … ;; px) … ;; esac; }`
 *   传进来的名字不在 case 里时，`case` **返回 0**，而它是函数的最后一条命令
 *   ⇒ 函数返回 0 ⇒ `want <不存在的组> && { run_one … }` **永远执行**。
 *   后果两面（都已实测过）：
 *     · 组开关失效：--changed 里该跳过的判据照跑（耗时，且把"没量"混进"量了"）；
 *     · 红被吞：`grp_of` 把未登记的 key 兜底成 browser 组，那一组本轮没跑时
 *       `if want browser` 为假 ⇒ 判红项直接跳过，门禁照样 exit 0。
 *   第二个病：同一个（脚本＋参数）注册成两个 key ⇒ 一次红进账两次、成本台账红项数翻倍。
 *
 * 判什么（只解析本脚本自身，不跑任何判据）：
 *   W1 每个 `want <组名>` 的组名，必须在 want() 的 case 里有显式分支
 *   W2 run_one 注册一一对应：同一（脚本＋参数）只许一个 key；同一个 key 只许一条命令
 *
 * 为什么不能靠人看：这两类错在盘面上**看起来完全正常** —— 脚本能跑、门禁会绿、日志一排 ✓。
 *   唯一能看见它的信号就是"组名与 case 对不上"这一条机器可核的事实。
 *
 * 用法：
 *   node tools/check-gate-wiring.mjs                 正控（解析 tools/run-gates.sh）
 *   node tools/check-gate-wiring.mjs --file <path>   解析指定文件（负控用它跑副本）
 *   node tools/check-gate-wiring.mjs --selftest      解析器自检（合成样例，不读盘）
 *   node tools/check-gate-wiring.mjs --negctl-want   负控：副本里注入不存在的组名 ⇒ 必须 rc=2
 *   node tools/check-gate-wiring.mjs --negctl-dup    负控：副本里注入重复注册   ⇒ 必须 rc=2
 *   node tools/check-gate-wiring.mjs --negctl        两条负控都跑，都成立才 rc=2（check-judgments 口径）
 * 退出码：0 绿 ｜ 1 未量/退化（读不到、解析出 0 样本、负控前提不成立或没判红）｜ 2 红（负控成立也是 2）
 *
 * ★退出码为什么是 1/2 这一对：派单口径「负控必须 rc=2；失败退化 rc=1，不与红同码」。
 *   这里 red=2、degraded=1，两者不同码；负控成立即进入 red 态（与 tools/negctl.tsv 的 pass 口径一致）。
 *   退化包括"解析出 0 条 want/0 条 run_one"——分母缺失时印 0 条不算绿。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(HERE, 'run-gates.sh');
const SELF = fileURLToPath(import.meta.url);

const RC = { GREEN: 0, DEGRADED: 1, RED: 2 };

/* ── 去注释 ────────────────────────────────────────────────────────
 * 必须做，不是洁癖：run-gates.sh 里存在**反例注释**（`# want judgments && { run_one … }`、
 * `# 本行原来是 run_one value-provenance …`）。不剥注释，判据会把注释里举的反例
 * 当成真注册 —— 第一版会因此报 2 条假红，然后人就会把整条判据关掉。
 * 规则：`#` 只有在引号外、且位于行首或空白之后才是注释；
 *   `${a#--only=}`（第 49 行）里的 `#` 不是注释，不许从这里截断。 */
function stripComments(src) {
  let out = '';
  let q = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (q) {
      out += ch;
      if (ch === '\\' && q === '"' && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
      if (ch === q) q = '';
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; out += ch; i++; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '\\' && i + 1 < src.length) { out += ch + src[i + 1]; i += 2; continue; }
    out += ch;
    i++;
  }
  return out;
}

/* ── want() 定义体 ─────────────────────────────────────────────────
 * 取 `want() {` 起、配对 `}` 止（引号内的括号不计）。 */
function findWantBody(src) {
  const m = /(?:^|\n)[ \t]*want[ \t]*\(\)[ \t]*\{/.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let q = '';
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

/* ── case 分支名 ───────────────────────────────────────────────────
 * 按 `;;` 切段，每段开头 `name)` 或 `a|b)` 即分支标签；`*)` 记作 catch-all。 */
function parseGroups(body) {
  if (!body) return null;
  const m = /case\b[\s\S]*?\bin\b([\s\S]*?)\besac\b/.exec(body);
  if (!m) return null;
  const groups = new Set();
  let catchAll = false;
  for (const seg of m[1].split(';;')) {
    const g = /^\s*([^)]+?)\)/.exec(seg);
    if (!g) continue;
    for (const raw of g[1].split('|')) {
      const name = raw.trim();
      if (!name) continue;
      if (name === '*') { catchAll = true; continue; }
      if (/^[A-Za-z0-9_.-]+$/.test(name)) groups.add(name);
    }
  }
  return { groups, catchAll };
}

/* ── `want <组名>` 调用 ────────────────────────────────────────────
 * 只认字面组名；`want "$g"`（变量）不是组名，不算 —— 否则汇总循环那行会被误报。 */
function parseWantCalls(src) {
  const calls = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(^|[^A-Za-z0-9_.-])want[ \t]+([A-Za-z0-9_.-]+)/g)) {
      calls.push({ group: m[2], line: i + 1 });
    }
  });
  return calls;
}

/* ── run_one 注册 ──────────────────────────────────────────────────
 * 取 `run_one <key> <命令>`，命令到第一个 `;` 止，空白折叠后当签名。
 * `run_one() {` 是定义，不是注册（后面紧跟 `(`，不匹配）。 */
function parseRunOne(src) {
  const regs = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(^|[^A-Za-z0-9_.-])run_one[ \t]+([A-Za-z0-9_.-]+)[ \t]+([^;]*)/g)) {
      const cmd = m[3].replace(/[ \t]+/g, ' ').trim();
      if (!cmd || cmd.startsWith('(')) continue;
      regs.push({ key: m[2], cmd, line: i + 1 });
    }
  });
  return regs;
}

/* ── 分析（纯函数：只吃源码字符串） ──────────────────────────────── */
function analyzeSource(rawSource, label) {
  const out = [];
  const red = [];
  const src = stripComments(rawSource);

  const wantBody = findWantBody(src);
  const parsed = parseGroups(wantBody);
  const calls = parseWantCalls(src);
  const regs = parseRunOne(src);

  if (!wantBody) return { rc: RC.DEGRADED, out: [`✗ 未量：${label} 里找不到 want() 定义 —— 解析器不认识这份脚本了`, '  这不等于通过：分母缺失时印 0 条是假绿'] };
  if (!parsed) return { rc: RC.DEGRADED, out: [`✗ 未量：want() 里找不到 case … esac —— 解析器不认识这份脚本了（rc=1）`] };
  if (calls.length === 0) return { rc: RC.DEGRADED, out: [`✗ 未量：${label} 里解析出 0 条 want 调用（rc=1）—— 文件不对或解析器坏了，不许当绿`] };
  if (regs.length === 0) return { rc: RC.DEGRADED, out: [`✗ 未量：${label} 里解析出 0 条 run_one 注册（rc=1）—— 文件不对或解析器坏了，不许当绿`] };

  const groups = parsed.groups;

  /* W1：组名必须在 case 里显式出现 */
  const missing = calls.filter((c) => !groups.has(c.group));

  /* W2：key ↔（脚本＋参数）一一对应 */
  const bySig = new Map();
  for (const r of regs) {
    if (!bySig.has(r.cmd)) bySig.set(r.cmd, []);
    bySig.get(r.cmd).push(r);
  }
  const byKey = new Map();
  for (const r of regs) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  const sigDup = [...bySig.entries()].filter(([, list]) => new Set(list.map((r) => r.key)).size > 1);
  const keyDup = [...byKey.entries()].filter(([, list]) => list.length > 1);

  out.push(`判据接线 @ ${label}`);
  out.push(`  want 调用 ${calls.length} 条 ｜ want() 分支 ${groups.size} 个（${[...groups].join(', ')}）${parsed.catchAll ? ' ｜ 含 *（任何组名都命中，测不出拼错）' : ''}`);
  out.push(`  run_one 注册 ${regs.length} 条 ｜ 命令签名 ${bySig.size} 个`);
  out.push('');

  for (const c of missing) {
    red.push(`W1 组名不存在：want ${c.group}（第 ${c.line} 行）—— want() 的 case 里没有这个分支，case 落空返回 0 ⇒ 这一行恒真`);
  }
  for (const [cmd, list] of sigDup) {
    red.push(`W2 同一命令两个 key：\`${cmd}\` → ${list.map((r) => `${r.key}（第 ${r.line} 行）`).join(' 与 ')}`);
  }
  for (const [key, list] of keyDup) {
    const same = new Set(list.map((r) => r.cmd)).size === 1;
    red.push(`W2 同一个 key 注册两次：${key}（第 ${list.map((r) => r.line).join(' / ')} 行）${same ? ' —— 同一命令跑两遍，rc 互相覆盖' : ' —— 两条不同命令，后者覆盖前者'}`);
  }

  if (red.length) {
    for (const r of red) out.push(`  ✗ ${r}`);
    out.push('');
    out.push('  修法二选一：①想跑 ⇒ 把组名补进 want() 的 case（并在 grp_of 里归到同一组，否则 --changed 的红会被吞）；');
    out.push('              ②不跑 ⇒ 删掉整行，并在 tools/not-gated.tsv 登记「为什么不跑 + 谁覆盖 + 到期日」。');
    out.push('              注册重复 ⇒ 只留一个 key（要保留哪个：在 grp_of 有归属、汇总 case 有标题的那个）。');
    out.push(`判据接线：红 ${red.length} 处（rc=2）—— 有判据没按组跑 / 被重复计数，后面的绿灯只覆盖跑过的那部分`);
    return { rc: RC.RED, out };
  }

  out.push('  ✓ 每个 want 组名都在 case 里有显式分支');
  out.push('  ✓ run_one 注册一一对应（没有同命令双 key、没有同 key 双命令）');
  out.push('');
  out.push(`判据接线：齐全 ✓（rc=0）—— ${calls.length} 条 want 调用全部落到真开关上`);
  return { rc: RC.GREEN, out };
}

function analyzeFile(file) {
  let src;
  try { src = readFileSync(file, 'utf8'); }
  catch (e) { return { rc: RC.DEGRADED, out: [`✗ 读不到 ${file}：${e.message}（rc=1，未量）`] }; }
  return analyzeSource(src, path.relative(process.cwd(), file) || file);
}

/* ── 解析器自检（合成样例，不读盘） ─────────────────────────────────
 * 每个样例都点名"要红/要绿"的那一条；样例里故意放了注释反例与 ${a#…}，
 * 因为真实脚本里就有这两样东西。 */
function selftest() {
  const head = 'want() { case "$1" in style) [ "$W_STYLE" = 1 ];; px) [ "$W_PX" = 1 ];; esac; }\n';
  const cases = [
    {
      name: '健康样例：want 与 run_one 都接对',
      src: head + 'want style && { run_one a node x.mjs $NEG; wait_slot; }\nwant px && { run_one b node y.mjs; wait_slot; }\n',
      rc: RC.GREEN, hit: null,
    },
    {
      name: '组名不存在 ⇒ 红（恒真的那一类）',
      src: head + 'want style && { run_one a node x.mjs $NEG; }\nwant nope && { run_one b node y.mjs; }\n',
      rc: RC.RED, hit: 'want nope',
    },
    {
      name: '注释里的 want/run_one 不算注册',
      src: head + 'want style && { run_one a node x.mjs $NEG; }\n# want ghost && { run_one ghost node ghost.mjs; }\n',
      rc: RC.GREEN, hit: null,
    },
    {
      name: '${a#--only=} 里的 # 不是注释（不许截断整行）',
      src: head + 'X="${a#--only=}"\nwant style && { run_one a node x.mjs $NEG; }\n',
      rc: RC.GREEN, hit: null,
    },
    {
      name: '同一命令两个 key ⇒ 红',
      src: head + 'want style && { run_one a node x.mjs $NEG; }\nwant style && { run_one b node x.mjs $NEG; }\n',
      rc: RC.RED, hit: '同一命令两个 key',
    },
    {
      name: '同一个 key 两条命令 ⇒ 红',
      src: head + 'want style && { run_one a node x.mjs; }\nwant style && { run_one a node y.mjs; }\n',
      rc: RC.RED, hit: '同一个 key 注册两次',
    },
    {
      name: 'want "$g"（变量）不是组名，不许误报',
      src: head + 'want style && { run_one a node x.mjs; }\nif want "$g"; then :; fi\n',
      rc: RC.GREEN, hit: null,
    },
    {
      name: '解析出 0 条 want ⇒ 未量（分母缺失不许印绿）',
      src: 'echo hi\n',
      rc: RC.DEGRADED, hit: '未量',
    },
  ];
  let bad = 0;
  console.log('── check-gate-wiring 解析器自检');
  for (const c of cases) {
    const r = analyzeSource(c.src, '样例');
    const text = r.out.join('\n');
    const okRc = r.rc === c.rc;
    const okHit = c.hit === null ? !text.includes('✗') : text.includes(c.hit);
    const ok = okRc && okHit;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}（rc=${r.rc}，应为 ${c.rc}${c.hit ? `；须点名「${c.hit}」` : ''}）`);
  }
  console.log(`自检：${cases.length - bad}/${cases.length}`);
  return bad ? RC.DEGRADED : RC.GREEN;
}

/* ── 负控：在副本上注入，必须 rc=2 且点名注入项 ────────────────────
 * 只"退出码是 2"不够：盘面本来就有别的红时，2 证明不了这一刀有效。
 * 所以三步：①注入前盘面必须绿；②注入后必须红；③红的输出必须点名注入项。 */
function negctlOne(kind) {
  const base = analyzeFile(DEFAULT_FILE);
  if (base.rc !== RC.GREEN) {
    console.error(`✗ 负控前提不成立：注入前盘面已是 ${base.rc === RC.RED ? '红' : '未量'}（rc=${base.rc}），先修绿再跑负控`);
    for (const l of base.out) console.error(l);
    return RC.DEGRADED;
  }

  const src = readFileSync(DEFAULT_FILE, 'utf8');
  const regs = parseRunOne(stripComments(src));
  if (!regs.length) { console.error('✗ 负控前提不成立：解析不到任何 run_one 注册，造不出"重复注册"'); return RC.DEGRADED; }

  const token = kind === 'want' ? '__negctl_missing_group__' : '__negctl_dup__';
  /* dup 用盘上真实的一条注册来复制：这样断言对象与真实签名永远一致，
     不会因为别人改了 gate-copy 的参数就让负控变成"注入了一条不存在的东西"。 */
  const inj = kind === 'want'
    ? `\n# 负控注入（副本，不落盘）：组名不在 want() 的 case 里\nwant ${token} && { :; }\n`
    : `\n# 负控注入（副本，不落盘）：同一命令换一个 key 再注册一次\nrun_one ${token} ${regs[0].cmd};\n`;

  const dir = mkdtempSync(path.join(os.tmpdir(), 'gatewire-'));
  const file = path.join(dir, 'run-gates.sh');
  writeFileSync(file, src + inj);
  let r;
  try { r = spawnSync(process.execPath, [SELF, '--file', file], { encoding: 'utf8' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }

  const text = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status !== RC.RED) {
    console.error(`✗ 负控失败：注入后 rc=${r.status}（应为 2）—— 这条断言是空的`);
    console.error(text.trim().split('\n').slice(-6).join('\n'));
    return RC.DEGRADED;
  }
  if (!text.includes(token)) {
    console.error(`✗ 负控失败：判红了，但输出里没有点名注入项 ${token} —— 说明红来自别处，这一刀没被证明`);
    return RC.DEGRADED;
  }
  console.log(`负控成立（rc=2）：${kind === 'want' ? '注入不存在的组名' : '注入重复注册'}后判红，且点名 ${token}`);
  return RC.RED;
}

/* ── 入口 ────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const fileArg = argv.indexOf('--file');

if (argv.includes('--selftest')) process.exit(selftest());

if (argv.includes('--negctl')) {
  const a = negctlOne('want');
  const b = negctlOne('dup');
  process.exit(a === RC.RED && b === RC.RED ? RC.RED : RC.DEGRADED);
}
if (argv.includes('--negctl-want')) process.exit(negctlOne('want'));
if (argv.includes('--negctl-dup')) process.exit(negctlOne('dup'));

const target = fileArg >= 0 ? path.resolve(argv[fileArg + 1] || '') : DEFAULT_FILE;
if (fileArg >= 0 && !argv[fileArg + 1]) {
  console.error('✗ --file 必须带路径');
  process.exit(RC.DEGRADED);
}
const res = analyzeFile(target);
for (const l of res.out) console.log(l);
process.exit(res.rc);
