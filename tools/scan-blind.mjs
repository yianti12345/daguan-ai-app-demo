#!/usr/bin/env node
/* scan-blind.mjs —— 「没人看的那几类」批量探针（2026-10-26）
 *
 * 起因：用户问「还有多少组件、样式、交互的问题」。上一轮我自己承认过，
 * 有五类东西**没有任何命令在看**：层叠遮挡 / 截断挤压 / 四态视觉 / sticky 冲突 / 信息密度。
 * 这个脚本先覆盖前三类里可机器判的四项，一次性遍历全部页面与展开态，输出可核对的清单。
 *
 * 每一项都写清「什么算问题」，避免变成又一份"看着绿"的报表：
 *   S1 文字被裁且没有省略号 —— 用户看不到完整内容，还不知道被裁了（最坏的一种）
 *   S2 元素溢出父容器 —— 内容跑出卡片/单元格，视觉上就是"排版散了"
 *   S3 浮层压住正文 —— 可见浮层的矩形盖住了不该盖的文字（这次菜单巨幅图标就是它）
 *   S4 点击目标 < 24×24 —— WCAG 2.5.8 下限；触控板用户会点不中
 *   S5 正文对比度 < 4.5:1 —— 要按实际叠出来的底色算，不能只看 token
 *   S6 同屏同类控件尺寸不一 —— 按钮高度混用是最刺眼的一种不统一
 *
 * 用法：node tools/scan-blind.mjs [baseUrl]
 * 退出码：0 无问题 ｜ 2 有问题（按类计数）
 */
import { resolveBase, debugPort } from './base.mjs';
import { spawn } from 'node:child_process';

const BASE = await resolveBase();
const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const STATES = [
  { name: 'apps 默认', url: 'apps.html', act: null },
  { name: 'apps 菜单开', url: 'apps.html', act: `document.querySelector('.kcard .k-more').click()` },
  { name: 'apps 停用确认', url: 'apps.html', act: `(function(){var c=document.querySelector('.kcard');c.querySelector('.k-more').click();setTimeout(function(){var b=c.querySelector('[data-act=toggle]');if(b)b.click();},60)})()` },
  { name: 'components 默认', url: 'components.html', act: null },
  { name: 'components 菜单开', url: 'components.html', act: `document.querySelector('.crow .k-more').click()` },
  { name: 'components 编辑弹层', url: 'components.html', act: `(function(){var c=document.querySelector('.crow');c.querySelector('.k-more').click();setTimeout(function(){var b=c.querySelector('[data-act=edit]');if(b)b.click();},60)})()` },
  { name: 'app 配置', url: 'app.html?id=hx-zc', act: null },
  { name: 'component 配置', url: 'component.html?id=task-list', act: null },
  { name: 'versions app', url: 'versions.html?scope=app&id=hx-zc', act: null },
  { name: 'versions comp', url: 'versions.html?scope=comp&id=task-list', act: null },
  { name: 'apps 1024', url: 'apps.html', act: null, vw: 1024, vh: 900 },
];

const PROBE = `(function(){
  var out = { S1:[], S2:[], S3:[], S4:[], S5:[], S6:[] };
  var VW = innerWidth, VH = innerHeight;
  function path(el){
    if(!el) return '?';
    var s = el.tagName.toLowerCase();
    if(el.id) return s + '#' + el.id;
    var c = (el.getAttribute('class')||'').trim().split(/\\s+/).filter(Boolean).slice(0,2);
    return s + (c.length ? '.' + c.join('.') : '');
  }
  function vis(el){
    var cs = getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity<0.05) return false;
    var r = el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  }
  function directText(el){
    var t='';
    for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3)t+=n.nodeValue;}
    return t.trim();
  }
  /* 往上找真正叠出来的底色 */
  function bgOf(el){
    var n = el;
    while(n && n !== document.documentElement){
      var c = getComputedStyle(n).backgroundColor;
      var m = c.match(/rgba?\\(([^)]+)\\)/);
      if(m){
        var p = m[1].split(',').map(function(x){return parseFloat(x)});
        var a = p.length>3 ? p[3] : 1;
        if(a > 0.55) return [p[0],p[1],p[2]];
      }
      n = n.parentElement;
    }
    return [255,255,255];
  }
  function lum(rgb){
    var c = rgb.map(function(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
  }
  function ratio(f,b){ var a=lum(f), d=lum(b); return (Math.max(a,d)+0.05)/(Math.min(a,d)+0.05); }
  function parseColor(c){
    var m = c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p = m[1].split(',').map(function(x){return parseFloat(x)});
    return p.slice(0,3);
  }

  var all = document.body.querySelectorAll('*');
  for(var i=0;i<all.length;i++){
    var el = all[i];
    if(!vis(el)) continue;
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var txt = directText(el);

    /* S1 文字被裁且无省略号 */
    if(txt && txt.length > 1){
      var ell = cs.textOverflow === 'ellipsis';
      var clamp = /line-clamp/.test(cs.webkitLineClamp ? 'line-clamp' : '');
      var clippedH = el.scrollHeight > el.clientHeight + 2;
      var clippedW = el.scrollWidth > el.clientWidth + 2;
      var ovH = cs.overflowY, ovW = cs.overflowX;
      if((clippedH && ovH !== 'visible' && !ell && !clamp) || (clippedW && ovW !== 'visible' && !ell && !clamp)){
        out.S1.push({ sel: path(el), text: txt.slice(0,26),
          sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth,
          ov: ovH + '/' + ovW });
      }
    }

    /* S2 溢出父容器（只查有明确尺寸的块，避免 inline 误报） */
    var par = el.parentElement;
    if(par && par !== document.body && cs.position !== 'fixed' && cs.position !== 'absolute'){
      var pr = par.getBoundingClientRect();
      var pcs = getComputedStyle(par);
      if(pr.width > 40 && pr.height > 20 && pcs.overflow === 'visible' && !/^(TD|TH|TR)$/.test(par.tagName)){
        var dx = Math.max(0, Math.round(r.right - pr.right), Math.round(pr.left - r.left));
        var dy = Math.max(0, Math.round(r.bottom - pr.bottom), Math.round(pr.top - r.top));
        if(dx > 3 || dy > 3){
          out.S2.push({ sel: path(el), parent: path(par), dx: dx, dy: dy,
            r:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
            p:[Math.round(pr.left),Math.round(pr.top),Math.round(pr.width),Math.round(pr.height)] });
        }
      }
    }

    /* S4 点击目标过小 */
    var tag = el.tagName;
    if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(tag) || el.getAttribute('role')==='button' || el.hasAttribute('onclick')){
      var label = (el.textContent||'').trim() || el.getAttribute('aria-label') || el.id || '';
      /* ★2026-10-26 口径修正：命中区要按**最近的可用祖先**算。
         实测 .field 外层 32px、里面 input 22px，点外层也能聚焦 —— 按自身尺寸判会误报。
         只有自己就是最终命中区、且没有更大的可点祖先才算真小。 */
      if(label && cs.pointerEvents !== 'none'){
        var box = r, n2 = el;
        while(n2 && n2 !== document.body){
          var bcs = getComputedStyle(n2);
          var br2 = n2.getBoundingClientRect();
          if(br2.width >= 24 && br2.height >= 24){ box = br2; break; }
          if(bcs.cursor === 'pointer' || /^(LABEL|A|BUTTON)$/.test(n2.tagName)){ box = br2; }
          n2 = n2.parentElement;
        }
        if(box.width < 24 || box.height < 24){
          out.S4.push({ sel: path(el), label: label.slice(0,16), w: Math.round(box.width), h: Math.round(box.height) });
        }
      }
    }

    /* S5 对比度（只查直接含文字的元素） */
    if(txt && txt.length > 2){
      var fg = parseColor(cs.color);
      if(fg){
        var bg = bgOf(el);
        var cr = ratio(fg, bg);
        var fs = parseFloat(cs.fontSize);
        var bold = +cs.fontWeight >= 600;
        var large = fs >= 24 || (fs >= 18.66 && bold);
        var need = large ? 3 : 4.5;
        if(cr < need){
          out.S5.push({ sel: path(el), text: txt.slice(0,20), fs: fs, cr: Math.round(cr*100)/100, need: need,
            fg:'rgb('+fg.join(',')+')', bg:'rgb('+bg.join(',')+')' });
        }
      }
    }
  }

  /* S3 可见浮层压住正文 */
  var layers = [];
  var cand = document.body.querySelectorAll('*');
  for(var k=0;k<cand.length;k++){
    var e = cand[k];
    if(!vis(e)) continue;
    var cs2 = getComputedStyle(e);
    if(cs2.position !== 'fixed' && cs2.position !== 'absolute') continue;
    var z = parseInt(cs2.zIndex,10);
    if(!(z > 0)) continue;
    var rr = e.getBoundingClientRect();
    if(rr.width < 40 || rr.height < 20) continue;
    layers.push({ el:e, rect:rr, z:z, sel:path(e) });
  }
  layers.forEach(function(L){
    if(/mask|nf-mask/.test(L.sel) && L.rect.width > VW*0.9) return; /* 全屏遮罩不算压正文 */
    var texts = document.body.querySelectorAll('p,span,b,strong,em,h1,h2,h3,h4,label,td,th,a');
    var hits = [];
    for(var t=0;t<texts.length;t++){
      var te = texts[t];
      if(L.el.contains(te) || te.contains(L.el)) continue;
      if(!vis(te)) continue;
      var tt = directText(te);
      if(tt.length < 2) continue;
      var tr = te.getBoundingClientRect();
      if(tr.right < L.rect.left || tr.left > L.rect.right || tr.bottom < L.rect.top || tr.top > L.rect.bottom) continue;
      /* 取重叠区中心，看最上层是谁 */
      var ox = Math.max(tr.left, L.rect.left), oy = Math.max(tr.top, L.rect.top);
      var ex = Math.min(tr.right, L.rect.right), ey = Math.min(tr.bottom, L.rect.bottom);
      if(ex-ox < 6 || ey-oy < 6) continue;
      var top = document.elementFromPoint((ox+ex)/2, (oy+ey)/2);
      if(top && (top === L.el || L.el.contains(top))){
        hits.push({ sel: path(te), text: tt.slice(0,18), cover: Math.round(((ex-ox)*(ey-oy))/(tr.width*tr.height)*100) });
      }
    }
    if(hits.length) out.S3.push({ layer: L.sel, z: L.z, hits: hits.slice(0,6), n: hits.length });
  });

  /* S6 同屏同类控件尺寸不一 */
  var groups = {};
  ['button','.btn','.k-more','.k-mi','.vs-btn','.vl-btn'].forEach(function(sel){   /* ★2026-11-04 .kbtn 不存在，卡上动作钮是 .k-more */
    var list = document.body.querySelectorAll(sel);
    var hs = [];
    for(var i2=0;i2<list.length;i2++){
      if(!vis(list[i2])) continue;
      var b2 = list[i2].getBoundingClientRect();
      hs.push(Math.round(b2.height));
    }
    if(hs.length >= 3){
      var mn = Math.min.apply(null,hs), mx = Math.max.apply(null,hs);
      if(mx - mn > 4) groups[sel] = { min:mn, max:mx, all:hs.slice(0,14), n:hs.length };
    }
  });
  if(Object.keys(groups).length) out.S6.push(groups);

  return out;
})()`;

const port = await debugPort();
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/scan-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
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
  setTimeout(() => rej(new Error('timeout ' + method)), 30000);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: x });
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

const totals = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, S6: 0 };
console.log('盲扫｜基址 ' + BASE + '\n');
for (const st of STATES) {
  await send('Emulation.setDeviceMetricsOverride', { width: st.vw || 1440, height: st.vh || 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/' + st.url });
  await SLEEP(1700);
  if (st.act) { await ev(st.act); await SLEEP(600); }
  const r = await ev(PROBE);
  if (!r || r.__err) { console.log('  ! ' + st.name + ' 探针失败：' + (r && r.__err)); continue; }
  const line = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((k) => k + '=' + (r[k] ? r[k].length : 0)).join(' ');
  console.log('■ ' + st.name.padEnd(22) + line);
  for (const k of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
    if (!r[k] || !r[k].length) continue;
    totals[k] += r[k].length;
    if (k === 'S3') {
      r[k].forEach((x) => console.log('    S3 浮层 ' + x.layer + ' z' + x.z + ' 压住 ' + x.n + ' 处正文 → ' +
        x.hits.map((h) => h.sel + '「' + h.text + '」' + h.cover + '%').join(' / ')));
    } else if (k === 'S6') {
      r[k].forEach((g) => Object.entries(g).forEach(([sel, v]) =>
        console.log('    S6 ' + sel + ' 高度 ' + v.min + '–' + v.max + '（' + v.all.join(',') + '）')));
    } else {
      r[k].slice(0, 8).forEach((x) => console.log('    ' + k + ' ' + JSON.stringify(x).slice(0, 190)));
      if (r[k].length > 8) console.log('    ' + k + ' …还有 ' + (r[k].length - 8) + ' 条');
    }
  }
}
console.log('\n合计：S1 截断 ' + totals.S1 + ' ｜ S2 溢出 ' + totals.S2 + ' ｜ S3 遮挡 ' + totals.S3 +
  ' ｜ S4 小目标 ' + totals.S4 + ' ｜ S5 对比度 ' + totals.S5 + ' ｜ S6 尺寸不一 ' + totals.S6);
ws.close(); chrome.kill();
const bad = Object.values(totals).reduce((a, b) => a + b, 0);
process.exit(bad ? 2 : 0);
