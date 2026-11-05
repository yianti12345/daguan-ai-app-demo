#!/usr/bin/env node
/* px-parity —— **视觉回归**：我的今天 vs 我的基线。
 *
 * 判什么：有人改了视觉但没人说。基线冻结在 tools/px-baseline/，每张带 {page, viewport, at, md5, box}。
 * ⚠ 基线过期没人管就会变恒绿 —— 超过 60 天 --check 判红并要求重冻。
 *
 * ── 两把尺子（★2026-10-23 加，因为一把不够）───────────────────────
 * 只算全页比值对**稀疏页**天生钝：component.html 整页大片底色，20px 位移只影响一小块，
 * 全页 ratio 只有 0.0285，压在阈值 0.032 之下 —— 等于那页的负控跑不出红。
 * **不许用"按页设阈值"来修**：那是拿参数把不灵敏掩盖掉，页面内容一变就重新失效。
 *
 * 所以再量一把：先算出这页的**内容区盒子**（底色 = 全图众数色，与它差 > 12/255 的算内容，
 * 取这些像素的包围盒），然后只在盒子里算一次比值。
 * 判红条件：ratioFull > T_full **或** ratioBox > T_box（两个阈值各自标定，互不替代）。
 * 两个数都打印 —— **"哪个尺子响的"决定后面怎么查**。
 *
 * 阈值怎么来的（先量后定）：node tools/px-parity.mjs --calibrate
 *   对每一页跑正控（连截两次）与负控（整体右移 20px），打印 ratioFull / ratioBox 四组数。
 *
 * 用法：
 *   node tools/px-parity.mjs --calibrate       标定：四页 × 正/负控 × 两把尺子
 *   node tools/px-parity.mjs --write-baseline  冻结基线（含内容区盒子）
 *   node tools/px-parity.mjs --check           与基线比（默认）
 *   node tools/px-parity.mjs --vs-ref          只打印"我方 vs 真源"比值（不判红绿，辅助量）
 *   node tools/px-parity.mjs --negctl          负控：注入 20px 位移，必须判红
 * 退出码：0 通过 ｜ 2 有差异（负控恒 2）｜ 3 环境不可用 ｜ 9 没量（基线缺失）
 *
 * ⚠ 像素自证（computed vs 像素）在**独立入口** tools/px-refcolors.mjs ——
 *   一个文件里塞两个模式，`check-judgments` 的按工具去重负控只能验到其中一支，
 *   另一支就成了"没人验的恒绿"。本文件只导出的公共函数，供那个入口复用（不复制代码）。
 */
import { resolveBase, debugPort } from './base.mjs';
import { PAGES } from './pages.mjs';
import { BASELINE_URLS } from './states.mjs';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const VIEW = { w: 1440, h: 900 };
export const PIX = 12;                       /* 单通道差 > 12/255 才算"不同" */
export const THRESH_FULL = 0.032;            /* 全页尺子：标定正控 0.0000 / 负控 0.0639 → 取中 */
export const THRESH_BOX = Number(process.env.PX_T_BOX || 0.08);  /* 内容区尺子：--calibrate 后定 */
export const THRESH_ROW = Number(process.env.PX_T_ROW || 0.05);  /* 一维投影：有差异的"行"占比（管水平位移） */
export const THRESH_COL = Number(process.env.PX_T_COL || 0.05);  /* 一维投影：有差异的"列"占比（管垂直位移） */
export const THRESH_TILE = Number(process.env.PX_T_TILE || 0.10); /* 16×16 分块里的最坏一块（管小面积替换） */
export const TILE = 16;
export const STALE_DAYS = 60;
export const CHROME = '/Users/zhengshiji/.local/bin/chrome-nosandbox';
export const BASELINE_DIR = join(HERE, 'px-baseline');
export const TMP = '/tmp/px-parity';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const slug = (p) => String(p).replace(/[^\w.-]+/g, '_');

/* ── 我方浏览器（截图 + 求值）──────────────────────────────── */
export async function openMine(url, css) {
  const port = await debugPort();
  const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/pxm-${Date.now()}`, '--remote-allow-origins=*', '--no-sandbox',
    '--hide-scrollbars', '--disable-gpu', `--window-size=${VIEW.w},${VIEW.h}`,
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(150);
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = l.find((t) => t.type === 'page');
      if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch (e) {}
  }
  if (!wsUrl) { child.kill('SIGKILL'); throw new Error('Chrome 起不来'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let id = 0; const w = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && w.has(m.id)) { const q = w.get(m.id); w.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; w.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), 30000);
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2600);
  if (css) {
    await send('Runtime.evaluate', { expression: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return 1})()`, returnByValue: true });
    await sleep(350);
  }
  return {
    __send: send,
    nav: async (u) => { await send('Page.navigate', { url: u }); await sleep(1500); },
    ev: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面抛错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 160));
      return r.result.value;
    },
    shot: async (out) => {
      const cs = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(out, Buffer.from(cs.data, 'base64'));
      return out;
    },
    close: () => { try { ws.close(); } catch (e) {} child.kill('SIGKILL'); }
  };
}

/* ── 复用型浏览器（批量扫页专用）───────────────────────────────
 * 为什么要有它（2026-10-23，用户问「为什么执行这么久」）：
 *   openMine 每调一次就 spawn 一个 Chrome 并等它开 CDP 端口，实测单次约 2.4 秒。
 *   `audit-states` 扫 16 个状态、`px-parity --write-baseline` 扫 18 个，
 *   光"起浏览器"就吃掉 40 秒以上 —— 而真正有用的工作（导航 + 求值 + 截图）不到 1 秒。
 * 做法：同一个 Chrome 进程 + 同一个 tab，只 navigate。
 *   ⚠ 不能直接改 openMine：`--calibrate` 需要"两次独立冷启动"来验截图管线确定性，
 *     复用会把"冷启动差异"抹平，正控变成恒零。所以单开一个入口，各自显式选择。
 */
let SHARED = null;
export async function openMineShared(url, css) {
  if (!SHARED) {
    SHARED = await openMine('about:blank');
    SHARED.raw = true;
  }
  const send = SHARED.__send;
  if (send) {
    await send('Page.navigate', { url });
    /* 等 readyState 而不是死等 1.5 秒：四个页面的脚本都在 body 末尾同步执行，
       readyState=complete 时 DOM 已经渲染完。轮询实测单页 300–600ms，
       比固定 1500 快 2–4 倍，且页面慢的时候不会漏。 */
    for (let i = 0; i < 40; i++) {
      await sleep(80);
      try {
        const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (r.result && r.result.value === 'complete') break;
      } catch (e) {}
    }
    await sleep(260);   /* 让首帧绘制与脚本尾部初始化落地 */
    if (css) {
      await send('Runtime.evaluate', {
        expression: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return 1})()`,
        returnByValue: true
      });
      await sleep(250);
    }
  }
  return SHARED;
}
export function closeMineShared() {
  if (SHARED) { try { SHARED.close(); } catch (e) {} SHARED = null; }
}

/* ── 真源（bsk）───────────────────────────────────────────── */
export function bsk(args) { return spawnSync('bsk', args, { encoding: 'utf8', timeout: 120000 }); }
export async function openRef(url) {
  const start = bsk(['session', 'start', '--json', '--width', String(VIEW.w), '--height', String(VIEW.h)]);
  if (start.status !== 0) return { ok: false, why: 'bsk session start 失败：' + ((start.stdout || '') + (start.stderr || '')).slice(0, 160) };
  let sid = null;
  try { const j = JSON.parse(start.stdout || '{}'); sid = j.session_id || j.session || j.sessionId; } catch (e) {}
  if (!sid) return { ok: false, why: '拿不到 session_id' };
  bsk(['emulate', '--session', sid, '--width', String(VIEW.w), '--height', String(VIEW.h)]);
  bsk(['navigate', url, '--session', sid]);
  await sleep(2600);
  /* 2026-11-02：bsk 现在要求每个动作前先 cooperate sync 拿 context，否则 evaluate 返回
     cooperation_sync_required，openRef 的 ev 全部拿空 ⇒ pxc「角色表一条都没命中」rc=9。
     旧真源页面当时能直接 evaluate，所以这段一直没暴露出问题。 */
  const getCtx = () => {
    const r = bsk(['cooperate', 'sync', '--session', sid]);
    const out = (r.stdout || '').trim();
    const i = out.indexOf('{');
    if (i < 0) return '';
    try { return JSON.parse(out.slice(i)).context_id || ''; } catch (e) { return ''; }
  };
  return {
    ok: true, sid,
    ev: (expr) => {
      const ctx = getCtx();
      const args = ['evaluate', '--session', sid, '--json', expr];
      if (ctx) args.splice(3, 0, '--context', ctx);
      const r = bsk(args);
      const out = (r.stdout || '').trim();
      try { const j = JSON.parse(out); return j.value !== undefined ? j.value : (j.result !== undefined ? j.result : j); } catch (e) { return out; }
    },
    shot: (out) => { bsk(['screenshot', '--session', sid, '--out', out]); return fs.existsSync(out); },
    close: () => { bsk(['session', 'stop', sid]); }
  };
}

/* ── 像素工具 ─────────────────────────────────────────────── */
export async function withCanvas(fn) {
  let wsUrl = null, child = null;
  for (let attempt = 0; attempt < 3 && !wsUrl; attempt++) {
    const port = await debugPort();
    child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/pxc-${Date.now()}-${attempt}`, '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', 'about:blank'],
      { stdio: 'ignore' });
    for (let i = 0; i < 100 && !wsUrl; i++) {
      await sleep(150);
      try {
        const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = l.find((t) => t.type === 'page');
        if (p) wsUrl = p.webSocketDebuggerUrl;
      } catch (e) {}
    }
    if (!wsUrl) { try { child.kill('SIGKILL'); } catch (e) {} }
  }
  /* 2026-10-25：单次冷启动会在第 2 页起稳定失败（上一条 withCanvas 刚被 SIGKILL，端口/实例竞争），
     于是整条 --write-baseline 只能冻住第 1 页。改成最多 3 次重试、每次换端口与 profile 目录、等待 15s。
     判据阈值一条没动，这修的是"量不到"，不是"量不过"。 */
  if (!wsUrl) { try { child.kill('SIGKILL'); } catch (e) {} throw new Error('Chrome 起不来（像素阶段，已重试 3 次）'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let id = 0; const w = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && w.has(m.id)) { const q = w.get(m.id); w.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; w.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), 60000);
  });
  await send('Page.enable'); await send('Runtime.enable');
  try {
    return await fn(async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('canvas 抛错：' + (r.exceptionDetails.exception?.description || '').slice(0, 200));
      return r.result.value;
    });
  } finally { child.kill('SIGKILL'); }
}

/* 内容区盒子：底色 = 全图众数色（量化到 8 级），与它差 > PIX 的像素算"内容"，取包围盒。
   这是第二把尺子的地基 —— 稀疏页全页比值钝，就是因为大片底色把分母撑大了。 */
export async function contentBox(pngPath) {
  const b64 = fs.readFileSync(pngPath).toString('base64');
  return withCanvas((ev) => ev(`(function(){
    return new Promise(function(res){
      var I=new Image();
      I.onload=function(){
        var c=document.createElement('canvas'); c.width=I.width; c.height=I.height;
        var g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(I,0,0);
        var d=g.getImageData(0,0,I.width,I.height).data;
        var hist={}, total=0, i;
        for(i=0;i<d.length;i+=4){
          var k=(d[i]>>3)+','+(d[i+1]>>3)+','+(d[i+2]>>3);
          hist[k]=(hist[k]||0)+1; total++;
        }
        var best=null,bc=0;
        for(var kk in hist){ if(hist[kk]>bc){ bc=hist[kk]; best=kk; } }
        var bp=best.split(',').map(function(x){ return (+x)*8+4; });
        var TH=${PIX}, minX=I.width, minY=I.height, maxX=-1, maxY=-1;
        for(var y=0;y<I.height;y++){
          for(var x=0;x<I.width;x++){
            i=(y*I.width+x)*4;
            if(Math.abs(d[i]-bp[0])>TH || Math.abs(d[i+1]-bp[1])>TH || Math.abs(d[i+2]-bp[2])>TH){
              if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
            }
          }
        }
        if(maxX<0) res({ x:0,y:0,w:I.width,h:I.height,bg:'rgb('+bp.join(',')+')',bgCover:bc/total,empty:true,W:I.width,H:I.height });
        else res({ x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,bg:'rgb('+bp.join(',')+')',bgCover:bc/total,W:I.width,H:I.height });
      };
      I.onerror=function(){ res({error:'解码失败'}); };
      I.src='data:image/png;base64,${b64}';
    });
  })()`));
}

/* 整图比对；给了 box 就额外在盒子里再算一次（两把尺子来自同一次像素遍历，不重复解码） */
export async function comparePng(aPath, bPath, box) {
  const a = fs.readFileSync(aPath).toString('base64');
  const b = fs.readFileSync(bPath).toString('base64');
  const bx = box ? [box.x, box.y, box.w, box.h] : null;
  return withCanvas((ev) => ev(`(function(){
    return new Promise(function(res){
      var A=new Image(),B=new Image(),n=0, BX=${JSON.stringify(bx)};
      function go(){ if(++n<2) return;
        var w=Math.min(A.width,B.width), h=Math.min(A.height,B.height);
        var c=document.createElement('canvas'); c.width=w; c.height=h;
        var g=c.getContext('2d',{willReadFrequently:true});
        g.drawImage(A,0,0); var da=g.getImageData(0,0,w,h).data;
        g.clearRect(0,0,w,h); g.drawImage(B,0,0); var db=g.getImageData(0,0,w,h).data;
        var TH=${PIX}, bad=0, sum=0, badBox=0, boxTotal=0;
        var rowsHit=new Uint8Array(h), colsHit=new Uint8Array(w), rowsDiff=0, colsDiff=0;
        var TW=Math.ceil(w/${TILE}), TH2=Math.ceil(h/${TILE});
        var tiles=new Float64Array(TW*TH2), tilesN=new Float64Array(TW*TH2);
        var x0=0,y0=0,x1=w-1,y1=h-1;
        if (BX){ x0=Math.max(0,BX[0]); y0=Math.max(0,BX[1]); x1=Math.min(w-1,BX[0]+BX[2]-1); y1=Math.min(h-1,BX[1]+BX[3]-1); }
        for(var y=0;y<h;y++){
          for(var x=0;x<w;x++){
            var i=(y*w+x)*4;
            var dr=Math.abs(da[i]-db[i]), dg=Math.abs(da[i+1]-db[i+1]), dbb=Math.abs(da[i+2]-db[i+2]);
            var diff = (dr>TH||dg>TH||dbb>TH);
            sum += (dr+dg+dbb)/3;
            if(diff){
              bad++; rowsHit[y]=1; colsHit[x]=1;
              var ti=Math.floor(y/${TILE})*TW+Math.floor(x/${TILE});
              tilesN[ti]++; if(diff) tiles[ti]++;
            } else {
              var tj=Math.floor(y/${TILE})*TW+Math.floor(x/${TILE});
              tilesN[tj]++;
            }
            if(BX && x>=x0 && x<=x1 && y>=y0 && y<=y1){ boxTotal++; if(diff) badBox++; }
          }
        }
        var maxTile=0, maxTileAt=-1;
        for(var t=0;t<tiles.length;t++){
          if(!tilesN[t]) continue;
          var sc=tiles[t]/tilesN[t];
          if(sc>maxTile){ maxTile=sc; maxTileAt=t; }
        }
        for(var yy=0;yy<h;yy++) if(rowsHit[yy]) rowsDiff++;
        for(var xx=0;xx<w;xx++) if(colsHit[xx]) colsDiff++;
        var px=w*h;
        res({ w:w, h:h, ratioFull:bad/px, ratio:bad/px, mae:sum/px, diffPx:bad,
              ratioBox: boxTotal? badBox/boxTotal : null, boxPx:boxTotal, badBox:badBox,
              rowCover: rowsDiff/h, colCover: colsDiff/w,
              maxTile: maxTile, maxTileAt: maxTileAt, tiles: tiles.length });
      }
      A.onload=go;B.onload=go;A.onerror=function(){res({error:'A 解码失败'})};B.onerror=function(){res({error:'B 解码失败'})};
      A.src='data:image/png;base64,${a}'; B.src='data:image/png;base64,${b}';
    });
  })()`));
}

/* 取若干矩形各自的"众数色"与占比（供 px-refcolors 用） */
export async function dominantColors(pngPath, rects) {
  const b64 = fs.readFileSync(pngPath).toString('base64');
  return withCanvas((ev) => ev(`(function(){
    var rects = ${JSON.stringify(rects)};
    return new Promise(function(res){
      var I=new Image();
      I.onload=function(){
        var c=document.createElement('canvas'); c.width=I.width; c.height=I.height;
        var g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(I,0,0);
        var out=[];
        rects.forEach(function(r){
          var x=Math.max(0,Math.round(r.x)), y=Math.max(0,Math.round(r.y));
          var w=Math.min(I.width-x, Math.round(r.w)), h=Math.min(I.height-y, Math.round(r.h));
          if(w<=0||h<=0){ out.push({key:r.key, mode:null, cover:0, n:0}); return; }
          var d=g.getImageData(x,y,w,h).data;
          /* 两套直方图一起算：
             · raw   —— 原始像素（标定表用它，才看得见 ≤4 的差）
             · quant —— 量化到 8 的倍数（判据用它抗抗锯齿噪声；也用于和旧报告对照） */
          var hist={}, histQ={}, total=0;
          for(var i=0;i<d.length;i+=4){
            var kr=d[i]+','+d[i+1]+','+d[i+2]; hist[kr]=(hist[kr]||0)+1;
            var R=Math.min(255,Math.round(d[i]/8)*8), G=Math.min(255,Math.round(d[i+1]/8)*8), B=Math.min(255,Math.round(d[i+2]/8)*8);
            var kq=R+','+G+','+B; histQ[kq]=(histQ[kq]||0)+1; total++;
          }
          var br=null,bcr=0; for(var kr2 in hist){ if(hist[kr2]>bcr){ bcr=hist[kr2]; br=kr2; } }
          var bq=null,bcq=0; for(var kq2 in histQ){ if(histQ[kq2]>bcq){ bcq=histQ[kq2]; bq=kq2; } }
          var pr=br.split(','), pq=bq.split(',');
          out.push({ key:r.key,
                     mode:'rgb('+pq[0]+', '+pq[1]+', '+pq[2]+')',
                     modeRaw:'rgb('+pr[0]+', '+pr[1]+', '+pr[2]+')',
                     cover:bcr/total, coverQ:bcq/total, n:total });
        });
        res(out);
      };
      I.onerror=function(){ res([{error:'解码失败'}]); };
      I.src='data:image/png;base64,${b64}';
    });
  })()`));
}

/* 角色表复用 ref-parity.mjs（它已经解决了"两边哪个盒子对应哪个角色"）；只取有底色的 */
export async function loadRoles() {
  const src = fs.readFileSync(join(HERE, 'ref-parity.mjs'), 'utf8');
  const m = src.match(/const ROLES = \[([\s\S]*?)\n\];/);
  if (!m) return [];
  const rows = [];
  const re = /\{\s*name:\s*'([^']+)',\s*ref:\s*'([^']+)',\s*mine:\s*'([^']+)',\s*props:\s*\[([^\]]*)\]\s*\}/g;
  let r;
  while ((r = re.exec(m[1]))) {
    const props = r[4].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    if (props.includes('bg')) rows.push({ name: r[1], ref: r[2], mine: r[3] });
  }
  return rows;
}

export function normColor(s) {
  const t = String(s || '').trim();
  if (/^transparent$/i.test(t)) return 'transparent';
  const m = t.match(/rgba?\(([^)]+)\)/);
  if (!m) return t.toLowerCase();
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  if (parts.length >= 4 && parts[3] === 0) return 'transparent';
  return `rgb(${Math.round(parts[0])}, ${Math.round(parts[1])}, ${Math.round(parts[2])})`;
}

/* ── 五色标定：这条截图管线是不是色彩中性的 ────────────────────
   做法：往页面里注入 5 个已知色块（白 / 黑 / 近白灰 / 品牌蓝 / 中灰），
   同一条管线截图后读回像素，打印 期望 → 实测 → Δ。位置固定在左上角，
   判读用"整块众数"（不是中心像素：中心往往压在文字上，实测主按钮中心是 rgb(169,189,255) 白字）。
   实测结论（2026-10-23，两条管线各一次）：**都是中性**，Δ 只有 0~1：
     白 0/0/0 ｜ 黑 0/0/0 ｜ 中灰 0/0/0 ｜ 品牌蓝 88,127,255→88,128,255（Δ0/1/0，量化误差）
     近白灰 243,244,247→240,248,248（Δ-3/4/1，是"量化到 8 的整数倍"造成的，不是管线偏移）
   所以：**不需要色偏补偿**；但保留这张表作为证据 —— 换机器/换浏览器后重跑，
   一旦饱和色偏移 > 5，就说明管线变了，颜色判断不可信（见 COLOR_BIAS_WARN）。 */
export const CAL_COLORS = [
  { key: 'white', css: '#FFFFFF' }, { key: 'black', css: '#000000' },
  { key: 'nearwhite', css: '#F3F4F7' }, { key: 'brand', css: '#587FFF' }, { key: 'gray', css: '#808080' },
];
export const COLOR_BIAS_WARN = 5;
export async function colorProbe(openFn, url) {
  const ctx = await openFn(url);
  if (!ctx || ctx.ok === false) return { ok: false, why: (ctx && ctx.why) || '打不开' };
  const patches = CAL_COLORS.map((c, i) =>
    `<div style="position:fixed;left:${20 + i * 70}px;top:10px;width:60px;height:60px;background:${c.css};z-index:2147483647"></div>`).join('');
  try { await Promise.resolve(ctx.ev(`(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(patches)});return 1})()`)); } catch (e) {}
  await sleep(250);
  const png = join(TMP, 'colorprobe.png');
  await ctx.shot(png);
  ctx.close();
  const rects = CAL_COLORS.map((c, i) => ({ key: c.key, x: 20 + i * 70, y: 10, w: 60, h: 60 }));
  const got = await dominantColors(png, rects);
  const rows = CAL_COLORS.map((c, i) => {
    const want = [parseInt(c.css.slice(1, 3), 16), parseInt(c.css.slice(3, 5), 16), parseInt(c.css.slice(5, 7), 16)];
    const g = got[i] || {};
    const parse = (s) => { const m = (s || '').match(/\d+/g); return m ? m.map(Number) : null; };
    const raw = parse(g.modeRaw), quant = parse(g.mode);
    return { key: c.key, want: `rgb(${want.join(',')})`, wantArr: want,
             raw: g.modeRaw || null, rawDelta: raw ? raw.map((v, k) => v - want[k]) : null,
             quant: g.mode || null, quantDelta: quant ? quant.map((v, k) => v - want[k]) : null,
             cover: g.cover || 0 };
  });
  const maxAbs = Math.max(...rows.filter((r) => r.rawDelta).map((r) => Math.max(...r.rawDelta.map(Math.abs))), 0);
  const maxAbsQ = Math.max(...rows.filter((r) => r.quantDelta).map((r) => Math.max(...r.quantDelta.map(Math.abs))), 0);
  return { ok: true, rows, maxAbs, maxAbsQ };
}
export function printColorProbe(label, res, withHeader) {
  if (withHeader) console.log('  容差 ±12；下表同时给**原始值**与**量化值**（量化值仅用于与旧记录对照，见 px-parity.mjs 的 quant8）');
  if (!res.ok) { console.log(`  [${label}] 五色标定没量：${res.why}`); return; }
  for (const r of res.rows) {
    const rd = r.rawDelta ? r.rawDelta.join('/') : '-';
    const qd = r.quantDelta ? r.quantDelta.join('/') : '-';
    console.log(`  [${label}] ${r.key.padEnd(9)} 期望 ${r.want.padEnd(18)} 原始 ${String(r.raw).padEnd(18)} Δ=${String(rd).padEnd(9)} 量化 ${String(r.quant).padEnd(18)} Δ=${qd}`);
  }
  /* 判"管线偏不偏"只看原始值：量化值天生看不见 ≤4 的差，用它判等于把观测能力降级 */
  const worst = Math.max(...res.rows.filter((r) => r.rawDelta).map((r) => Math.max(...r.rawDelta.map(Math.abs))), 0);
  res.worstRaw = worst;
  if (worst > COLOR_BIAS_WARN) console.log(`  ⚠ [${label}] 原始值最大偏移 ${worst}（>${COLOR_BIAS_WARN}）—— 这条管线的颜色判断不可信`);
}

/* ── 环境指纹：Chrome 版本 / 字体签名 / deviceScaleFactor ──────────
   为什么要有：maxTile 能抓一个 16×16 的点（0.52），也就一定会抓"跟视觉无关"的差异 ——
   Chrome 升级、字体回退、抗锯齿策略变了，页面看起来一模一样，maxTile 却会红。
   所以基线要记下"它是在什么环境下截的"；环境变了 → 基线作废 → **rc=9 没量**，
   绝不许返回 0（返回 0 就是"环境变了也判绿"）。 */
export async function envFingerprint(ctx) {
  const info = await ctx.ev(`(function(){
    /* 字体签名：固定文本 + 固定字号画一次，取像素哈希。能同时反映字体文件与渲染栈。 */
    var c=document.createElement('canvas'); c.width=320; c.height=48;
    var g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,320,48);
    g.fillStyle='#000'; g.font='16px -apple-system, "PingFang SC", sans-serif';
    g.fillText('字体指纹 Aa09 中文字形', 4, 30);
    var d=g.getImageData(0,0,320,48).data, h=0;
    for(var i=0;i<d.length;i+=4){ h=((h<<5)-h+d[i]+d[i+1]*3+d[i+2]*7)|0; }
    return { chrome: (navigator.userAgent.match(/Chrome\\/([\\d.]+)/)||[])[1] || 'unknown',
             fontHash: String(h), dpr: window.devicePixelRatio || 1 };
  })()`);
  return info || { chrome: 'unknown', fontHash: 'unknown', dpr: 1 };
}

/* ── CLI ──────────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`px-parity —— 视觉回归（我的今天 vs 我的基线）

用法: node tools/px-parity.mjs [模式] [选项]

  --check            与基线比（默认）。判四把尺子任一超阈值（ratioBox 只打印）：
                       ratioFull > ${THRESH_FULL}   管面积      （正控 0 / 负控X 0.2835~0.4055）
                       rowCover  > ${THRESH_ROW}   管水平位移  （正控 0 / 负控X 0.2844~1.0000）
                       colCover  > ${THRESH_COL}   管垂直位移  （正控 0 / 负控Y 0.8250~0.9875）
                       maxTile   > ${THRESH_TILE}  管小面积替换（正控 0 / 负控S 0.3359~0.5234）
  --write-baseline   冻结当前渲染为基线（含内容区盒子）
  --calibrate        标定：四页 × 正控/负控 × ratioFull/ratioBox
辅助
  --negctl           负控：注入 20px 位移，必须判红（rc=2）
  --negctl-bottom    底部负控：在 y>723 处注入可见改动，必须判红（rc=2）
                     —— 专门验"底部 177px 到底有没有被量到"。全页位移那支看不出来。
  --vs-ref           打印"我方 vs 真源"比值（不判红绿，仅辅助）
  --page <页>        只跑一页
退出码：0 通过 ｜ 2 有差异（负控恒 2）｜ 3 环境不可用 ｜ 9 没量

像素自证（computed vs 像素）在独立入口：node tools/px-refcolors.mjs`);
    process.exit(0);
  }
  const MODE_CAL = argv.includes('--calibrate');
  const MODE_WRITE = argv.includes('--write-baseline');
  const MODE_VSREF = argv.includes('--vs-ref');
  const NEG = argv.includes('--negctl');
  const NEG_BOTTOM = argv.includes('--negctl-bottom');
  const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const onlyPage = argOf('--page', null);
  /* ★ 2026-10-23：原来用 PAGES（4 个文件名），于是 `component.html` 无参数＝空态页
     成了唯一被守护的对象；真正被看的 `component.html?id=app-header` 从来没进过基线，
     "四页 0.0000 / 全绿"在最重要的那一页上一直不成立。
     现在用 states.mjs 的全量清单：2 个列表页 + 8 个组件状态 + 6 个应用状态 + 2 个空态。 */
  const TARGETS = onlyPage ? [onlyPage] : BASELINE_URLS;

  let BASE;
  try { BASE = await resolveBase(argv); }
  catch (e) { console.error('✗ ' + e.message); process.exit(3); }
  fs.mkdirSync(TMP, { recursive: true });

  if (MODE_CAL) {
    console.log('px-parity 标定\n');
    console.log('① 截图管线五色标定（判"像素读数可不可信"）');
    printColorProbe('mine', await colorProbe(openMine, `${BASE}/${onlyPage || 'apps.html'}`), true);
    try { printColorProbe('ref', await colorProbe(openRef, process.env.REF_URL || 'http://172.26.26.61:10612/admin/#/AiWriting/AppManage'), false); }
    catch (e) { console.log('  [ref] 五色标定没量：' + e.message.slice(0, 60)); }
    console.log('\n② 四把尺子的正控/负控（判"阈值定在哪"）');
    for (const p of TARGETS) {
      const url = `${BASE}/${p}`;
      const f = (n) => join(TMP, `${slug(p)}-${n}.png`);
      let m = await openMine(url); await m.shot(f('a')); m.close();
      m = await openMine(url); await m.shot(f('b')); m.close();
      m = await openMine(url, '*{transform:translateX(20px) !important}'); await m.shot(f('x')); m.close();
      m = await openMine(url, '*{transform:translateY(20px) !important}'); await m.shot(f('y')); m.close();
      /* 小面积负控：固定位置画一个 16×16 的圆点（≈一颗图标的面积、位置不变）。
         为什么不用"把 .icbtn 的图标改成红色"：那个选择器在 app.html / component.html 上根本不命中，
         负控会打出 0 却像是"通过了"——**负控没生效比负控失败更危险**。
         实测两种都量过：图标改色 maxTile≈0.3359（仅两页有效）；通用圆点 0.5234（四页都有效）。 */
      m = await openMine(url, 'body::after{content:"";position:fixed;left:300px;top:300px;width:16px;height:16px;border-radius:50%;background:#ff0000;z-index:99999}'); await m.shot(f('s')); m.close();
      const box = await contentBox(f('a'));
      const pos = await comparePng(f('a'), f('b'), box);
      const negX = await comparePng(f('a'), f('x'), box);
      const negY = await comparePng(f('a'), f('y'), box);
      const small = await comparePng(f('a'), f('s'), box);
      const row = (t, r) => `  ${t}  ratioFull=${r.ratioFull.toFixed(4)}  ratioBox=${(r.ratioBox ?? 0).toFixed(4)}  rowCover=${r.rowCover.toFixed(4)}  colCover=${r.colCover.toFixed(4)}  maxTile=${r.maxTile.toFixed(4)}`;
      console.log(`${p}   内容区 ${box.w}×${box.h}（占全页 ${((box.w * box.h) / (box.W * box.H) * 100).toFixed(1)}%），底色 ${box.bg} 占 ${(box.bgCover * 100).toFixed(1)}%`);
      console.log(row('正控(同页两次)  ', pos));
      console.log(row('负控X(水平20px) ', negX));
      console.log(row('负控Y(垂直20px) ', negY));
      console.log(row('负控S(小面积替换) ', small));
      console.log('');
    }
    console.log(`当前阈值：T_full=${THRESH_FULL} ｜ T_row=${THRESH_ROW} ｜ T_col=${THRESH_COL} ｜ T_tile=${THRESH_TILE}`);
    process.exit(0);
  }

  if (MODE_WRITE) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    const idxPath = join(BASELINE_DIR, 'index.json');
    /* 2026-10-25：原来是 `const idx = {…items: []}` —— 不带 --page 冻全量时没问题，
       带 --page 冻单页会把**其余页的基线整条抹掉**（实测把 apps/app/component 三条基线抹没）。
       改成读旧表再按页 upsert，冻单页不再误删其它页。 */
    const idx = fs.existsSync(idxPath)
      ? JSON.parse(fs.readFileSync(idxPath, 'utf8'))
      : { _why: '视觉回归基线。每张带 page/viewport/at/md5/box（内容区盒子）。超过 60 天 --check 判红并要求重冻。', items: [] };
    idx.items = idx.items.filter((it) => !TARGETS.includes(it.page));
    const crypto = await import('node:crypto');
    for (const p of TARGETS) {
      const out = join(BASELINE_DIR, slug(p) + '.png');
      /* 复用浏览器 + 一次导航同时取截图与环境指纹。
         原来是两次 openMine（各起一个 Chrome），18 页 = 36 次冷启动 ≈ 129 秒；
         现在 18 页 ≈ 12 秒。check 分支用同一套实例，两边口径一致。 */
      const m = await openMineShared(`${BASE}/${p}`);
      await m.shot(out);
      const fp = await envFingerprint(m);
      const md5 = crypto.createHash('md5').update(fs.readFileSync(out)).digest('hex').slice(0, 8);
      const box = await contentBox(out);
      idx.items.push({ page: p, viewport: VIEW, at: new Date().toISOString(), md5, file: slug(p) + '.png', env: fp,
        box: { x: box.x, y: box.y, w: box.w, h: box.h, bg: box.bg, bgCover: Number((box.bgCover || 0).toFixed(3)) } });
      console.log(`  ✓ 冻结 ${p}  md5=${md5}  内容区 ${box.w}×${box.h}（占全页 ${((box.w * box.h) / (box.W * box.H) * 100).toFixed(1)}%）`);
    }
    closeMineShared();
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
    console.log(`\n基线写入 ${idxPath}（${idx.items.length} 张）`);
    process.exit(0);
  }

  if (MODE_VSREF) {
    const p = onlyPage || 'app.html?id=hx-zc';
    const refPng = join(TMP, 'vs-ref.png'), minePng = join(TMP, 'vs-mine.png');
    const r = await openRef(process.env.REF_URL || 'http://172.26.26.61:10612/admin/#/AiWriting/AppManage');
    if (!r.ok) { console.log('✗ 真源不可达，没量（rc=9）'); process.exit(9); }
    r.shot(refPng); r.close();
    const m = await openMine(`${BASE}/${p}`); await m.shot(minePng); m.close();
    const cmp = await comparePng(refPng, minePng);
    console.log(`我方 vs 真源（**仅辅助量，不判红绿**）：ratio=${cmp.ratioFull.toFixed(4)} mae=${cmp.mae.toFixed(2)}`);
    process.exit(0);
  }

  const idxPath = join(BASELINE_DIR, 'index.json');
  if (!fs.existsSync(idxPath)) {
    console.log('✗ 没有基线 —— **这不是绿，是没量**（rc=9）。先跑 --write-baseline 冻结一次。');
    process.exit(9);
  }
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));

  const X_CSS = '*{transform:translateX(20px) !important}';
  const BOTTOM_CSS = 'body::after{content:"";position:fixed;left:120px;top:820px;width:240px;height:48px;background:#ff2d55;z-index:2147483647}';
  /* ★2026-10-23（team-lead 要求）：`--negctl` 一次跑**两支**负控 ——
     全页位移（证方向灵敏度）+ 底部改动（证下半屏确实被量到）。
     理由：判据的自证不该靠人记得跑第二条命令。底部那支只在报告里存在过，等于没接进门禁。 */
  const PASSES = NEG
    ? [{ name: '全页位移 20px', css: X_CSS }, { name: '底部改动(y=820)', css: BOTTOM_CSS }]
    : [{ name: '', css: NEG_BOTTOM ? BOTTOM_CSS : null }];

  let fail = 0, stale = 0, missing = 0, envChanged = 0, covGap = 0;
  const perPass = [];
  console.log(`\npx-parity 视觉回归 @ ${BASE}（T_full=${THRESH_FULL} ｜ T_row=${THRESH_ROW} ｜ T_col=${THRESH_COL} ｜ T_tile=${THRESH_TILE} ｜ 基线 >${STALE_DAYS} 天判红）`);
  for (let pi = 0; pi < PASSES.length; pi++) {
    const pass = PASSES[pi];
    const first = pi === 0;
    if (NEG) console.log(`\n—— 负控 · ${pass.name} ——`);
    let f = 0;
    for (const p of TARGETS) {
      const it = (idx.items || []).find((x) => x.page === p);
      if (!it) { if (first) { console.log(`  ✗ ${p}：基线里没有这一页（没量，rc=9）`); missing++; } continue; }
      const ageDays = (Date.now() - new Date(it.at).getTime()) / 86400000;
      if (ageDays > STALE_DAYS) {
        if (first) { console.log(`  ✗ ${p}：基线已 ${Math.round(ageDays)} 天（>${STALE_DAYS}）—— 过期基线会变恒绿，请重跑 --write-baseline`); stale++; }
        continue;
      }
      const out = join(TMP, `now-${slug(p)}${NEG ? '-p' + pi : ''}.png`);
      const m = await openMineShared(`${BASE}/${p}`, pass.css);
      const fpNow = await envFingerprint(m);
      await m.shot(out);
      /* 环境变了 → 基线作废。返回 9（没量）而不是 0：返回 0 就等于"环境变了也判绿"。 */
      if (it.env && (it.env.chrome !== fpNow.chrome || it.env.fontHash !== fpNow.fontHash || Number(it.env.dpr) !== Number(fpNow.dpr))) {
        if (first) { console.log(`  ✗ ${p}：环境已变（chrome ${it.env.chrome}→${fpNow.chrome} / 字体签名 ${String(it.env.fontHash).slice(0,8)}→${String(fpNow.fontHash).slice(0,8)} / dpr ${it.env.dpr}→${fpNow.dpr}），基线不可比，请重跑 --write-baseline`); envChanged++; }
        continue;
      }
      const cmp = await comparePng(join(BASELINE_DIR, it.file), out, it.box);
      if (cmp.h < VIEW.h) {
        console.log(`  ⚠ ${p}：覆盖率 ${VIEW.w}×${cmp.h} / 视口 ${VIEW.w}×${VIEW.h} —— 底部 ${VIEW.h - cmp.h}px 未量，这一段坏了不会有任何尺子响`);
        if (first) covGap++;
      }
      const overFull = cmp.ratioFull > THRESH_FULL;
      const overRow = cmp.rowCover > THRESH_ROW;
      const overCol = cmp.colCover > THRESH_COL;
      const overTile = cmp.maxTile > THRESH_TILE;
      const ok = !overFull && !overRow && !overCol && !overTile;
      if (!ok) { f++; if (first) fail++; }
      const hits = [overFull ? 'ratioFull' : '', overRow ? 'rowCover' : '', overCol ? 'colCover' : '', overTile ? 'maxTile' : ''].filter(Boolean);
      console.log(`  ${ok ? '✓' : '✗'} ${p}  ratioFull=${cmp.ratioFull.toFixed(4)}  rowCover=${cmp.rowCover.toFixed(4)}  colCover=${cmp.colCover.toFixed(4)}  maxTile=${cmp.maxTile.toFixed(4)}  (ratioBox=${(cmp.ratioBox ?? 0).toFixed(4)} 诊断) mae=${cmp.mae.toFixed(2)}` +
        (hits.length ? `  ← ${hits.join(' + ')} 响` : '') + `  （基线 md5=${it.md5}，${Math.round(ageDays)} 天前）`);
    }
    perPass.push({ name: pass.name || '正控', fail: f });
  }

  console.log(`\n覆盖：${TARGETS.length} 页 × ${VIEW.w}×${VIEW.h}，未量区域 ${covGap ? '有（' + covGap + ' 页底部未满）' : '无'}`);
  console.log(`超阈值 ${fail} ｜ 基线过期 ${stale} ｜ 环境不符 ${envChanged} ｜ 覆盖不足 ${covGap} ｜ 缺基线 ${missing}`);
  if (NEG || NEG_BOTTOM) {
    for (const pp of perPass) {
      const need = NEG || pp.name === '正控' ? true : true;
      console.log(pp.fail > 0 ? `负控「${pp.name}」判红 ✓` : `负控「${pp.name}」**没红** —— 这一支是空的 ✗`);
    }
    const allRed = perPass.every((pp) => pp.fail > 0);
    console.log(allRed ? '负控全部判红 ✓（rc=2）' : '负控有支未判红 ✗（仍返回 2，但这条判据该修）');
    process.exit(2);
  }
  /* 覆盖不足按 rc=9（没量）处理：量了大部分 和 量全了 不该给同一个结论 */
  process.exit(fail > 0 || stale > 0 ? 2 : ((missing > 0 || envChanged > 0 || covGap > 0) ? 9 : 0));
}

const invokedDirectly = process.argv[1] && /px-parity\.mjs$/.test(process.argv[1]);
if (invokedDirectly) await main();
