#!/usr/bin/env node
/* check-inset —— 卡内左缘（"一张卡里的每一行是不是从同一条线开始"）
 *
 * 为什么有它：2026-10-25 第八轮盲评（零上下文席）看图指出「卡片内部内容左缘 228 与 234 相差 6px」。
 *   实测（本判据首跑）是 4px：`.kcard-hit` 内距 16（标题/说明/元信息在 232），
 *   `.card-ft` 内距 12（底栏「配置」按钮在 228）。
 *   这类偏差单卡看不出，六张并排时底栏按钮会集体比正文左出一条线，整页显脏。
 *   它是纯几何量：能被量出来的，就不该靠"看仔细点"。
 *
 * 判定：一张卡内部所有"读者从左往右读的行"（标题 / 说明 / 元信息 / 底栏动作）
 *   左缘最大差 <= 1px。容差 1px 是渲染取整，不是审美余量。
 * 例外：显式要错开的行（缩进行、时间轴行）落到 tools/inset-allow.tsv 并写理由。
 * 退出码：0 过 ｜ 2 有偏差 ｜ 3 未量（服务没起 / Chrome 起不来 / 量不到卡）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOW = join(HERE, 'inset-allow.tsv');
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

/* 被抓的行：选择器 → 人话名字。只收"同一张卡里应该同起点的行"。 */
const ROWS = [
  /* ★2026-11-02：应用卡的标题/说明类名在 2026-11-01 改版时换成 kc-*，这里没跟 ——
     于是 apps.html 一行都没量到，判据报"不足两行"，看起来像版式崩了。 */
  ['.kc-title', '标题'],
  ['.kc-desc', '说明'],
  /* ★2026-10-30 删掉 `.kc-meta`（元信息）：用户当面否掉卡脚那行「v3 → v4 · 10-20」，
     卡上不再显示当前版本号与日期（只剩"要不要动它"的一条动作说明，且只在需要时出现）。
     测量表只收**每张卡都存在的行**，一个时有时无的节点会让"没量到"变成常态噪音。 */
];
const PAGE = 'apps.html';

let fail = 0, pass = 0;
const ok = (t, d) => { pass++; console.log(`  ✓ ${t}${d ? ' · ' + d : ''}`); };
const bad = (t, d) => { fail++; console.log(`  ✗ ${t}${d ? ' · ' + d : ''}`); };

function allowed(sel) {
  if (!existsSync(ALLOW)) return '';
  for (const line of readFileSync(ALLOW, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [pat, reason] = line.split('\t');
    if (pat && reason && reason.trim() && sel.includes(pat.trim())) return reason.trim();
  }
  return '';
}

const MEASURE = `(function(){
  var card = document.querySelector('.kcard');
  if (!card) return { err: 'no .kcard' };
  var out = [];
  var rows = ${JSON.stringify(ROWS)};
  for (var i = 0; i < rows.length; i++) {
    var el = card.querySelector(rows[i][0]);
    if (!el) { out.push({ sel: rows[i][0], name: rows[i][1], left: null, why: '页面上没有这个元素' }); continue; }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) { out.push({ sel: rows[i][0], name: rows[i][1], left: null, why: '尺寸为 0' }); continue; }
    out.push({ sel: rows[i][0], name: rows[i][1], left: Math.round(r.left * 10) / 10 });
  }
  return { rows: out, cardLeft: Math.round(card.getBoundingClientRect().left * 10) / 10 };
})()`;

let BASE = '';
try { BASE = await resolveBase(); } catch (e) { console.log('  ! 未量：' + e.message.slice(0, 60)); process.exit(3); }
if (!BASE) { console.log('  ! 未量：服务没起来'); process.exit(3); }
const PORT = await debugPort();

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/ci-' + Date.now(), '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await SLEEP(120);
  try {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch (e) {}
}
if (!target) { console.log('  ! 未量：Chrome 起不来'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 20000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
};

setTimeout(() => { console.log('GATE TIMEOUT: 卡内距判据 90s 没跑完'); try { chrome.kill('SIGKILL'); } catch (e) {} process.exit(3); }, 90000);
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

try {
  await send('Page.navigate', { url: BASE + '/' + PAGE });
  await SLEEP(1200);
  if (NEG) {
    /* 负控：把**仍在测量表里**的一行（说明 .card-desc）往右推 5px —— 判据必须抓到它，否则"容差"是假的。
       注入点必须与断言点同一个元素（10-27 踩过：注入 .kbtn、断言已不含它 ⇒ 负控恒绿）。 */
    await ev(`(function(){var b=document.querySelector('.kc-desc'); if(b) b.style.marginLeft='5px'; return !!b;})()`);
    await SLEEP(120);
  }
  const res = await ev(MEASURE);
  if (!res || res.err) { bad(PAGE, '量不到卡'); }
  else {
    const measured = res.rows.filter((r) => r.left != null && !allowed(r.sel));
    const missing = res.rows.filter((r) => r.left == null);
    for (const m of missing) console.log(`     · ${m.name}（${m.sel}）没量到：${m.why}`);
    if (measured.length < 2) {
      bad(PAGE, `只有 ${measured.length} 行可量，不足两行无法判断`);
    } else {
      const L = measured.map((r) => r.left);
      const d = Math.round((Math.max(...L) - Math.min(...L)) * 10) / 10;
      const detail = measured.map((r) => `${r.name} L=${r.left}`).join(' · ');
      if (d <= 1) ok(PAGE, `${measured.length} 行同一条线（L=${L[0]}，容差 1px）· ${detail}`);
      else { bad(PAGE, `左缘最大差 ${d}px（容差 1px）`); console.log('     ' + detail); }
    }
  }
} catch (e) { bad(PAGE, '未量：' + e.message.slice(0, 50)); }
try { chrome.kill('SIGKILL'); } catch (e) {}

console.log(`\n通过 ${pass} ｜ 偏差 ${fail}${NEG ? '（负控：应判红）' : ''}`);
process.exit(fail ? 2 : 0);
