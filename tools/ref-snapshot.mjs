#!/usr/bin/env node
/* ref-snapshot —— 把真源取值**冻结成带出处的样本文件**（tools/ref-snapshot.json）。
 *
 * 主体（这条判据量的是什么）：
 *   `tools/ref-parity.mjs` 的角色表（15 组：侧栏 / 菜单三级态 / 面包屑 / 主按钮 /
 *   图标钮 / 输入框 / 卡片四件 / 角标）在**真源**上的实测取值，逐角色冻结成一条样本。
 *
 * 为什么需要它（这是这条判据存在的唯一理由）：
 *   ref-parity 靠 bsk 连线上后台。线上连不上的时候它 SKIP —— 而 SKIP 在长时间里
 *   没人会去看，"真源对齐"这条最贵的判据就等于**长期没量**，而且看起来永远是绿的。
 *   冻一份带 {url, viewport, at} 的样本之后：没有 bsk 也能对着样本判，
 *   同时样本自己会过期 —— at 超过 30 天判红（过期等于没量）。
 *
 * 负控（怎么证明它会红）：
 *   把样本里一条 `at` 改成 100 天前 + 删掉另一条的 `source`，再跑同一个校验函数，
 *   必须同时抓到「样本过期」和「缺出处」。抓不到就是恒绿，判据作废。
 *
 * 用法：
 *   node tools/ref-snapshot.mjs --write     用 bsk 采一次真源，写样本（需要能连线上后台）
 *   node tools/ref-snapshot.mjs --check     只校验样本（不连网）：出处 / 新鲜度 / 角色对齐 / 可解析
 *   node tools/ref-snapshot.mjs --negctl    负控（★ 预期 rc=2）
 *   node tools/ref-snapshot.mjs --help
 * 退出码：0 通过 ｜ 2 判红（负控恒为 2）｜ 3 环境不可用（bsk 起不来 / 真源读不到）
 *
 * ⚠ 端口/基址：本工具只连真源（走 bsk），不开本地浏览器，所以不需要 base.mjs。
 *   以后如果要加"我方一侧"的采样，基址必须 `import { resolveBase } from './base.mjs'`，
 *   不许在这里写端口。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAMPLE = path.join(HERE, 'ref-snapshot.json');
const PARITY = path.join(HERE, 'ref-parity.mjs');

const BSK = process.env.BSK_BIN || 'bsk';
const REF_URL = process.env.REF_URL || 'http://172.26.26.61:10612/admin/#/AiWriting/AppManage';
const VIEW = { w: 1440, h: 900 };
const MAX_AGE_DAYS = 30;

const ARGS = process.argv.slice(2);
const HELP = ARGS.includes('--help') || ARGS.includes('-h') || ARGS.length === 0;
const DO_WRITE = ARGS.includes('--write');
const DO_CHECK = ARGS.includes('--check');
const NEGCTL = ARGS.includes('--negctl');

/* ── 角色表：**不复制一份**，直接从 ref-parity.mjs 的源码里读 ──────────
   复制一份的后果是这个项目踩过四次的同一个坑：两处各写一套，改一处另一处悄悄过期。
   读法：截出 `const ROLES = [ … ];` 那一段源码，用 Function 求值（里面有注释、单引号，
   正则抠 name 会漏；求值才是"就是那张表"）。 */
function loadRoles() {
  const src = fs.readFileSync(PARITY, 'utf8');
  const start = src.indexOf('const ROLES = [');
  if (start < 0) throw new Error('ref-parity.mjs 里找不到 `const ROLES = [`');
  let i = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('ROLES 数组没有闭合');
  const arr = new Function('return ' + src.slice(src.indexOf('[', start), end))();
  if (!Array.isArray(arr) || !arr.length) throw new Error('ROLES 解析结果不是数组');
  return arr;
}

/* ── bsk ─────────────────────────────────────────────────────────── */
function sh(args) { return spawnSync(BSK, args, { encoding: 'utf8' }); }
function sessions() {
  const out = sh(['session', 'list']).stdout || '';
  return out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((x) => x && x !== 'SESSION');
}
/* 会话列表里常有残留死 id，且顺序不代表新旧 —— 逐个探活，第一个真活着的才用。 */
function ensureSession() {
  for (const s of sessions()) {
    if ((sh(['evaluate', '--session', s, '1+1']).stdout || '').includes('2')) return s;
  }
  sh(['session', 'start', '--browser', process.env.DG_BSK_BROWSER || 'f8a0849e']);
  for (let i = 0; i < 5; i++) {
    spawnSync('sleep', ['1']);
    for (const s of sessions()) {
      if ((sh(['evaluate', '--session', s, '1+1']).stdout || '').includes('2')) return s;
    }
  }
  return null;
}
function bskJson(sess, js) {
  const r = sh(['evaluate', '--session', sess, '--json', js]);
  const txt = (r.stdout || '').trim();
  if (!txt) return null;
  try {
    const outer = JSON.parse(txt);
    if (outer.code) return null;
    return typeof outer.value === 'string' ? JSON.parse(outer.value) : outer;
  } catch (e) { return null; }
}

/* 在真源上按角色读一批属性。读不到的记 null，**不许猜**。 */
function measureRef(sess, roles) {
  sh(['navigate', '--session', sess, 'about:blank']);
  sh(['navigate', '--session', sess, REF_URL]);
  spawnSync('sleep', ['2']);
  const js = `JSON.stringify((function(){
    var ROLES = ${JSON.stringify(roles.map((r) => [r.name, r.ref]))};
    var N = function (v) { return Math.round(parseFloat(v) || 0); };
    var H = function (c) {
      c = String(c || '');
      if (c.indexOf('rgb(') === 0) {
        var m = c.match(/[\\d.]+/g) || [];
        return 'rgb(' + m.slice(0, 3).map(function (x) { return Math.round(+x); }).join(',') + ')';
      }
      return c;
    };
    var out = {};
    ROLES.forEach(function (r) {
      var name = r[0], sel = r[1], e = null;
      try { e = document.querySelector(sel); } catch (err) { e = null; }
      if (!e || !document.body.contains(e)) { out[name] = null; return; }
      var s = getComputedStyle(e), b = e.getBoundingClientRect();
      var pad = String(s.padding).split(/\\s+/).map(function (v) { return Math.round(parseFloat(v) || 0); });
      out[name] = {
        w: N(b.width), h: N(b.height), x: N(b.x), y: N(b.y),
        fs: N(s.fontSize), fw: N(s.fontWeight), br: N(s.borderTopLeftRadius), lh: N(s.lineHeight),
        color: H(s.color), bg: H(s.backgroundColor), bd: H(s.borderTopColor), bw: N(s.borderTopWidth),
        pad: String(s.padding),
        padTop: pad[0] || 0, padRight: pad[1] || 0, padBottom: pad[2] || 0, padLeft: pad[3] || 0,
        fontSize: N(s.fontSize), radius: N(s.borderTopLeftRadius)
      };
    });
    return { url: location.href, title: document.title, items: out };
  })())`;
  return bskJson(sess, js);
}

/* ── 样本读写 ───────────────────────────────────────────────────── */
function writeSample() {
  const roles = loadRoles();
  const sess = ensureSession();
  if (!sess) { failEnv('bsk 起不来（真源需要登录态）—— 没有采到任何真源取值，样本不写。'); }
  const got = measureRef(sess, roles);
  if (!got || !got.items) failEnv('真源页面读不到（登录态失效或站点不可达）—— 样本不写。');

  const at = new Date().toISOString();
  const ver = (sh(['--version']).stdout || '').trim().split(/\s+/).pop() || null;
  const items = [];
  const missing = [];
  for (const r of roles) {
    const v = got.items[r.name];
    if (!v) { missing.push(r.name); continue; }
    items.push({
      role: r.name,
      refSelector: r.ref,
      mineSelector: r.mine,
      props: r.props || null,
      values: v,
      source: { url: got.url || REF_URL, viewport: VIEW, at, tool: 'bsk', bskVersion: ver }
    });
  }
  if (missing.length) {
    /* 采不全就不写：半份样本比没有样本更危险 —— 它会让人以为"对齐过了"。 */
    failEnv('有 ' + missing.length + ' 个角色在真源上读不到：' + missing.join('、') + ' ⇒ 样本不写。');
  }
  const doc = {
    _why: '真源取值冻结样本。每条带 role/选择器/属性白名单/取值/出处(url,viewport,at,tool)。' +
          'ref-parity 在 bsk 不可用时可对着这份样本判；--check 保证它没过期、没漏角色、没缺出处。',
    meta: { generatedAt: at, tool: 'bsk', bskVersion: ver, refUrl: got.url || REF_URL, viewport: VIEW, roles: items.length },
    items
  };
  fs.writeFileSync(SAMPLE, JSON.stringify(doc, null, 2) + '\n');
  console.log('  已写入 ' + path.relative(ROOT, SAMPLE) + '：' + items.length + ' 条角色，采自 ' + doc.meta.refUrl);
  process.exit(0);
}

function failEnv(msg) {
  console.error('环境不可用：' + msg);
  process.exit(3);
}

/* ── 校验（--check 与 --negctl 共用这一份，负控不许另写一套）──────── */
function validate(file) {
  const reds = [];
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { reds: [{ k: '解析', msg: '样本不是合法 JSON：' + e.message }], count: 0 };
  }
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) reds.push({ k: '解析', msg: '样本里没有 items（空样本等于没量）' });

  const now = Date.now();
  for (const it of items) {
    const s = it.source || null;
    /* ① 每条都要有出处 */
    if (!s || !s.url || !s.viewport || !s.at || !s.tool) {
      reds.push({ k: '出处', msg: '「' + (it.role || '?') + '」缺 source（url/viewport/at/tool 四件必须齐）' });
      continue;
    }
    /* ② 新鲜度：超过 30 天等于没量 */
    const t = Date.parse(s.at);
    if (isNaN(t)) { reds.push({ k: '出处', msg: '「' + it.role + '」的 at 不是时间：' + s.at }); continue; }
    const days = (now - t) / 86400000;
    if (days > MAX_AGE_DAYS) {
      reds.push({ k: '过期', msg: '「' + it.role + '」采样于 ' + Math.floor(days) + ' 天前（上限 ' + MAX_AGE_DAYS + ' 天）→ 重跑 --write' });
    }
  }

  /* ③ 角色集合与 ref-parity 的表逐条对齐（多一条少一条都红） */
  let roles = [];
  try { roles = loadRoles(); } catch (e) {
    reds.push({ k: '对齐', msg: '读不到 ref-parity 的角色表：' + e.message });
  }
  if (roles.length) {
    const want = roles.map((r) => r.name);
    const have = items.map((it) => it.role);
    const miss = want.filter((n) => !have.includes(n));
    const extra = have.filter((n) => !want.includes(n));
    if (miss.length) reds.push({ k: '对齐', msg: '样本缺 ' + miss.length + ' 个角色：' + miss.join('、') });
    if (extra.length) reds.push({ k: '对齐', msg: '样本多出 ' + extra.length + ' 个角色：' + extra.join('、') + '（ref-parity 里没有）' });
    /* 选择器/白名单变了也算样本过期：表改了但没重采，样本就是"上一版真源" */
    for (const it of items) {
      const r = roles.find((x) => x.name === it.role);
      if (!r) continue;
      if (r.ref !== it.refSelector) {
        reds.push({ k: '对齐', msg: '「' + it.role + '」真源选择器变了：样本 ' + it.refSelector + ' → 现在 ' + r.ref });
      }
      if (JSON.stringify(r.props || null) !== JSON.stringify(it.props || null)) {
        reds.push({ k: '对齐', msg: '「' + it.role + '」属性白名单变了：样本 ' + JSON.stringify(it.props) + ' → 现在 ' + JSON.stringify(r.props) });
      }
    }
  }
  return { reds, count: items.length };
}

function report(file, res) {
  /* ④ 可解析这件事在 validate 里已经兜住（解析失败直接返回一条红） */
  const relRaw = path.relative(ROOT, file);
  const rel = relRaw.startsWith('..') ? path.basename(file) + '（临时副本）' : relRaw;
  if (!res.reds.length) {
    console.log('  ✓ ' + rel + '：' + res.count + ' 条角色，出处齐、未过期（≤' + MAX_AGE_DAYS + ' 天）、与 ref-parity 角色表逐条对齐');
    return true;
  }
  console.log('  ✗ ' + rel + '：' + res.reds.length + ' 条');
  for (const r of res.reds.slice(0, 12)) console.log('      [' + r.k + '] ' + r.msg);
  if (res.reds.length > 12) console.log('      …另 ' + (res.reds.length - 12) + ' 条');
  return false;
}

/* ── 三个入口 ───────────────────────────────────────────────────── */
if (HELP) {
  console.log(`ref-snapshot —— 真源取值冻结样本（tools/ref-snapshot.json）

用法：
  node tools/ref-snapshot.mjs --write     用 bsk 采一次真源并写样本（需要连得上线上后台）
  node tools/ref-snapshot.mjs --check     只校验样本，不连网（出处 / 新鲜度 / 角色对齐 / 可解析）
  node tools/ref-snapshot.mjs --negctl    负控：改旧时间 + 删出处，必须判红（rc=2）
  node tools/ref-snapshot.mjs --help

判什么：
  · 每条样本都带 source{url,viewport,at,tool}
  · at 不超过 ${MAX_AGE_DAYS} 天（样本过期等于没量）
  · 角色集合与 tools/ref-parity.mjs 的 ROLES 逐条对齐（多一条少一条都红；选择器/白名单变了也红）
  · JSON 能解析、items 非空

退出码：0 通过 ｜ 2 判红 ｜ 3 环境不可用（--write 时 bsk 或真源读不到）
样本：${path.relative(ROOT, SAMPLE)}`);
  process.exit(0);
}

if (DO_WRITE) {
  console.log('\n真源样本：采样\n');
  writeSample();
}

if (DO_CHECK) {
  console.log('\n真源样本：校验\n');
  if (!fs.existsSync(SAMPLE)) {
    console.log('  ✗ 没有样本文件 ' + path.relative(ROOT, SAMPLE) + ' ⇒ 跑一次 --write（需要线上后台可达）');
    process.exit(2);
  }
  const res = validate(SAMPLE);
  const ok = report(SAMPLE, res);
  console.log('');
  console.log(ok ? '  PASS：样本可用' : '  FAIL：样本不可用（过期/缺出处/与角色表不一致都算不可用）');
  process.exit(ok ? 0 : 2);
}

if (NEGCTL) {
  console.log('\n真源样本：负控\n');
  if (!fs.existsSync(SAMPLE)) {
    console.error('负控前置：样本不存在，无法做负控（先 --write）');
    process.exit(2);
  }
  const clean = validate(SAMPLE);
  if (clean.reds.length) {
    console.error('负控前置：正样本已判红 ' + clean.reds.length + ' 条，基线不干净，负控无意义');
    process.exit(2);
  }
  const base = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const bad = JSON.parse(JSON.stringify(base));
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  if (bad.items[0]) bad.items[0].source.at = old;                     /* 注入 1：过期 */
  if (bad.items[1]) delete bad.items[1].source;                       /* 注入 2：缺出处 */
  const tmp = path.join(os.tmpdir(), 'ref-snapshot-negctl-' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify(bad, null, 2));
  let res;
  try {
    res = validate(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  const kinds = new Set(res.reds.map((r) => r.k));
  const caughtAge = kinds.has('过期');
  const caughtSrc = kinds.has('出处');
  report(tmp, res);
  console.log('');
  console.log((caughtAge && caughtSrc)
    ? '负控成立：注入「100 天前」与「缺 source」分别被 过期 / 出处 两类抓住'
    : '负控失败：注入后没抓到（' + [...kinds].join('、') + '）⇒ 判据是摆设');
  process.exit(2);   /* ★ 负控恒为 2 */
}

console.error('未知参数。试试 --help');
process.exit(2);
