#!/usr/bin/env node
/* check-schema-roundtrip —— 字段单一真源的往返判据（2026-10-28 立）。
 *
 * 为什么有它：一天之内四次「写了却读不回来」——fieldsByVer、updUndo(load)、
 * updUndo(save)、block。根因不是手滑，是同一个事实散在五处白名单里，
 * 加一个字段要在六处同步。现在字段统一声明在 `DB.SCHEMA`（data.js），
 * load/save 从它派生；这条判据保证「schema 里有的，存下去一定读得回来」。
 *
 * 判据（三态）：
 *   S1 每个 schema 字段都能被写成非默认值并落进 localStorage（missing 必须为空）
 *   S2 落盘键数 = schema 键数（少一个就是白名单漏了）
 *   S3 反证：schema 之外多出来的键不算错（允许实现细节），但 schema 里的一个都不能少
 *
 * 用法：node tools/check-schema-roundtrip.mjs
 *      node tools/check-schema-roundtrip.mjs --negctl   负控：从 save 的派生里摘掉一个键，
 *                                                      必须被 S1/S2 抓住；抓不住 rc=3
 * 退出码：0 全过 ｜ 2 有 FAIL ｜ 3 未量（服务不在 / 页面抛错）
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolveBase } from './base.mjs';

const PORT = 9650 + Math.floor(Math.random() * 40);
/* ★2026-10-29（gatecover）：原来写死 `http://127.0.0.1:8941`。
   门禁跑在 GATE_BASE=8953，而 8941 是**另一个 worktree**（main-d86b6441）——
   判绿/判红的可能是另一份代码。改走 tools/base.mjs 的唯一基址来源；
   SCHEMA_URL 仍可覆盖（负控/人工点跑用）。 */
const base = await resolveBase();
const URL = process.env.SCHEMA_URL || `${base}/app.html?id=hx-zc&ns=schemacheck`;
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const NEG = process.argv.includes('--negctl');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/schema-${Date.now()}`,
  '--remote-allow-origins=*', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = l.find(t => t.type === 'page');
    if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch (e) {}
  await sleep(200);
}
if (!wsUrl) { console.log('未量：Chrome 起不来'); process.exit(3); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let seq = 0; const wait = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; wait.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 60000);
});
await send('Page.enable'); await send('Runtime.enable');
const ev = async expr => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) { console.log('未量：页面抛错 → ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200)); chrome.kill(); process.exit(3); }
  return r.result.value;
};

await send('Page.navigate', { url: URL });
await sleep(2400);

const expr = NEG
  ? `(() => {
      // 负控：先真存一次，再从落盘结果里摘掉 updUndo —— 判据必须能发现这个洞
      DB.save();
      var key = Object.keys(localStorage).filter(k => /ifas90:db/.test(k))[0];
      var raw = JSON.parse(localStorage.getItem(key));
      raw.apps.forEach(a => { delete a.updUndo; });
      localStorage.setItem(key, JSON.stringify(raw));
      return 'patched';
    })()`
  : `(() => {
      var S = DB.SCHEMA;
      var mk = function (d) {
        if (Array.isArray(d)) return ['probe'];
        if (d && typeof d === 'object') return { probe: 1 };
        if (typeof d === 'boolean') return !d;
        return 'probe-' + typeof d;
      };
      var a = DB.APPS[0], c = DB.COMPS[0];
      Object.keys(S.app).forEach(function (k) { if (k === 'id' || k === 'comps') return; a[k] = mk(S.app[k].d); });
      Object.keys(S.comp).forEach(function (k) { if (k === 'id') return; c[k] = mk(S.comp[k].d); });
      DB.save();
      var key = Object.keys(localStorage).filter(function (k) { return /ifas90:db/.test(k); })[0];
      var raw = JSON.parse(localStorage.getItem(key));
      var missing = [];
      Object.keys(S.app).forEach(function (k) { if (raw.apps[0][k] === undefined) missing.push('app.' + k); });
      Object.keys(S.comp).forEach(function (k) { if (raw.comps[0][k] === undefined) missing.push('comp.' + k); });
      return { appKeys: Object.keys(raw.apps[0]).length, compKeys: Object.keys(raw.comps[0]).length,
               appSchema: Object.keys(S.app).length, compSchema: Object.keys(S.comp).length, missing: missing };
    })()`;

if (NEG) {
  await ev(expr);
  await sleep(300);
}

const r = NEG
  ? await ev(`(() => {
      var S = DB.SCHEMA;
      var key = Object.keys(localStorage).filter(k => /ifas90:db/.test(k))[0];
      var raw = JSON.parse(localStorage.getItem(key));
      var missing = [];
      Object.keys(S.app).forEach(k => { if (raw.apps[0][k] === undefined) missing.push('app.' + k); });
      return { missing };
    })()`)
  : await ev(expr);

const fails = [];
if (!r || !Array.isArray(r.missing)) fails.push('读数拿不到');
else if (r.missing.length) fails.push('schema 有、落盘没有：' + r.missing.join(', '));
if (!NEG && r && r.appKeys !== r.appSchema) fails.push(`app 键数 ${r.appKeys} ≠ schema ${r.appSchema}`);
if (!NEG && r && r.compKeys !== r.compSchema) fails.push(`comp 键数 ${r.compKeys} ≠ schema ${r.compSchema}`);

if (NEG) {
  // 负控期望：必须发现 missing 非空
  const caught = r && r.missing && r.missing.length > 0;
  console.log(caught ? '负控抓住：' + r.missing.join(', ') : '负控没抓住 —— 判据自己坏了');
  chrome.kill();
  process.exit(caught ? 2 : 3);
}

if (fails.length) { console.log('FAIL：' + fails.join(' ｜ ')); chrome.kill(); process.exit(2); }
console.log(`PASS：app ${r.appKeys}/${r.appSchema} ｜ comp ${r.compKeys}/${r.compSchema} ｜ missing 0`);
chrome.kill();
process.exit(0);
