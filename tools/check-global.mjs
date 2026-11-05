#!/usr/bin/env node
/* check-global —— 「全局元素必须真的全局」（2026-10-26 立）
 *
 * 为什么有它：用户定过一句话 ——「小智是全局的，就是小智可以跟人一样，操作我们 web 端全部的操作，
 * 跟组件配置的对话和应用配置的对话，是完全不同的概念」。而实测五页里断了两页：
 *   · component.html  内联样式写着 `#xz-host .xz-fab{display:none}`，浮球 0×0
 *     （理由是 10-25 盲评说"同屏两个 AI 入口"——那个前提把局部配置对话和全局操作者当成了同类）
 *   · versions.html   连 `#xz-host` 都没有，`xiaozhi.css` 也没引，浮球元素压根不存在
 * 两条都是**新建页面/改样式时顺手丢掉的**，而 35 个判据没有一个在问"全局元素还在不在"。
 *
 * 「全局」这个词如果不写成机器判据，它的实际含义就是"我记得的那几页"。
 *
 * 判据（遍历 tools/pages.mjs 的全部页面）：
 *   G1 每页 DOM 里有它的宿主（#xz-host）
 *   G2 每页渲染出来可见：display 非 none、尺寸 ≥ 40×40、中心点 elementFromPoint 命中它自己
 *   G3 每页的依赖齐全：引了 xiaozhi.js 和 xiaozhi.css（少一个就只是"看起来有"）
 *   G4 各页位置一致：rect 的 right/bottom 差值 ≤ 2px（否则用户会觉得它"在跳"）
 *
 * 负控 --negctl：给每页临时插一条 `#xz-host .xz-fab{display:none!important}`，
 *   G2 必须在每一页都红 —— 证明这条判据测的是"可见"，不是"元素存在"。
 *
 * 用法：node tools/check-global.mjs [baseUrl] [--negctl]
 * 退出码：0 全过 ｜ 2 有断点 ｜ 3 环境起不来
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = await resolveBase();
/* ★ 必须 decode：URL.pathname 会把中文目录编码成 %E8%BE%BE…，拿去 fs.existsSync 一定不认。
   这种失败会伪装成"文件不存在"，让人去查文件 —— 而不是查这行代码。 */
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const NEG = process.argv.includes('--negctl');

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (note ? '｜' + note : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (note ? '｜' + note : '')); }
}

/* ── 全局常驻元素清单：以后再加（比如预览胶囊）就往这里写一行 ── */
const GLOBALS = [
  {
    key: 'xz',
    label: '小智浮球',
    host: '#xz-host',
    sel: '.xz-fab',
    minW: 40, minH: 40,
  },
];

/* ── G3 依赖：静态读文件，不用开浏览器 ── */
const DEP = {
  'apps.html': ['assets/xiaozhi.js', 'assets/xiaozhi.css'],
  'components.html': ['assets/xiaozhi.js', 'assets/xiaozhi.css'],
  'component.html': ['assets/xiaozhi.js', 'assets/xiaozhi.css'],
  'app.html': ['assets/xiaozhi.js', 'assets/xiaozhi.css'],
  'versions.html': ['assets/xiaozhi.js', 'assets/xiaozhi.css'],
};
console.log('全局元素契约｜基址 ' + BASE + (NEG ? '｜负控模式' : '') + '\n');
for (const [page, deps] of Object.entries(DEP)) {
  const p = ROOT + page;
  if (!fs.existsSync(p)) { ok(page + ' 存在', false, '文件不在 ' + p); continue; }
  const src = fs.readFileSync(p, 'utf8');
  const miss = deps.filter((d) => !new RegExp(d.replace(/[.\/]/g, '\\$&')).test(src));
  const hasHost = GLOBALS.every((g) => src.includes('id="' + g.host.slice(1) + '"'));
  ok(page + ' 依赖齐全（G3）', miss.length === 0 && hasHost,
    miss.length ? '缺 ' + miss.join(' / ') : (hasHost ? '脚本与样式都在，宿主也在' : '宿主不在 HTML 里'));
}

/* ── G1/G2/G4：开浏览器量 ── */
const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/global-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 70; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t?.webSocketDebuggerUrl) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
  } catch (e) {}
  await SLEEP(200);
}
if (!ws) { console.log('SKIP: Chrome 起不来'); process.exit(3); }
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 25000);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: x });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const spots = [];
for (const g of GLOBALS) {
  for (const page of PAGES) {
    await send('Page.navigate', { url: BASE + '/' + page });
    await SLEEP(1700);
    if (NEG) {
      await ev(`(function(){var st=document.createElement('style');st.textContent='${g.host} ${g.sel}{display:none !important}';document.head.appendChild(st);return 1})()`);
      await SLEEP(150);
    }
    const r = await ev(`(function(){
      var host = document.querySelector('${g.host}');
      var el = document.querySelector('${g.sel}');
      if (!host) return { host:false, el:false };
      if (!el) return { host:true, el:false };
      var b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      var cx = b.left + b.width/2, cy = b.top + b.height/2;
      var hit = document.elementFromPoint(cx, cy);
      return { host:true, el:true,
        w:Math.round(b.width), h:Math.round(b.height),
        right:Math.round(innerWidth - b.right), bottom:Math.round(innerHeight - b.bottom),
        display:cs.display, visibility:cs.visibility, opacity:cs.opacity,
        hitSelf: !!(hit && (hit === el || el.contains(hit))),
        hitWhat: hit ? hit.tagName + '.' + String(hit.getAttribute('class')||'').split(' ')[0] : 'null' };
    })()`);

    const tag = page.padEnd(36);
    if (r && r.__err) { ok(`${g.label} · ${page}（量不到）`, false, r.__err); continue; }
    if (!r || !r.host) { ok(`${g.label} · ${page} G1 宿主存在`, false, '页面里没有 ' + g.host); continue; }
    ok(`${g.label} · ${page} G1 宿主存在`, true, g.host + ' 在');

    const visible = r.el && r.display !== 'none' && r.visibility !== 'hidden' && +r.opacity > 0.1
      && r.w >= g.minW && r.h >= g.minH && r.hitSelf;
    ok(`${g.label} · ${page} G2 真的可见可点`, visible,
      r.el
        ? `${r.w}×${r.h} display=${r.display} opacity=${r.opacity} 中心命中=${r.hitSelf ? '自己' : r.hitWhat}`
        : '元素不渲染（' + g.sel + ' 不存在）');
    if (visible) spots.push({ page, right: r.right, bottom: r.bottom });
  }
}

/* G4：各页位置一致 */
if (spots.length > 1 && !NEG) {
  const rs = spots.map((x) => x.right), bs = spots.map((x) => x.bottom);
  const dr = Math.max(...rs) - Math.min(...rs), db = Math.max(...bs) - Math.min(...bs);
  ok('G4 各页位置一致（右/下边距差 ≤2px）', dr <= 2 && db <= 2,
    '右 ' + rs.join('/') + '｜下 ' + bs.join('/') + '｜差 ' + dr + '/' + db);
}

console.log('\n通过 ' + pass + ' ｜ 断点 ' + fail);
ws.close(); chrome.kill();
process.exit(fail ? 2 : 0);
