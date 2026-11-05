#!/usr/bin/env node
/* check-topbar-lean —— 应用配置页顶栏只许回答一件事：**这是哪个应用的哪一版**。
 *
 * 为什么要有它（2026-11-03，用户 m00984 原话）：
 *   「左上角，毫无意义，懂吗？就显示当前应用名称、版本号就行了。不会简约简单一些吗？」
 *   改前顶栏第二行印「已上架」＋「已存成 v2 · 1 家客户 · 都是最新」：四件事、零个动作。
 *   这不是第一次 —— 2026-10-25 用户就说过「别加多余的标注和描述，让布局自己说话」，
 *   当时删的是"应用说明"，客户/状态又留了下来。**同一族第二次**，所以立判据，
 *   否则下一次加一个"最近更新 2 小时前"照样全绿。
 *
 * 判什么（同一页真实 DOM，不看源码字符串）：
 *   A1 版本号形状：`.app-edit` 文本只能是 v<N>，或 v<N> · 未保存/只读/保存失败
 *   A2 顶栏没有第二块文字：除应用名与版本号之外，.float-hd 里不许有可见文字
 *   A3 结构：.float-hd 的直接子元素恰好 3 个（返回 / 名字 / 版本号）
 *   A4 长度上限：顶栏文字总长 ≤ 名字长度 + 版本号长度 + 2（防"再拼一句"式回归）
 *   A6 入口唯一：配置页不许再出现指向 versions.html 的链接（用户 m01612：
 *      「应用管理不是已经有历史版本的入口了吗？再这里有什么意义？给我去掉」）
 *
 * 负控（--negctl）：往 .float-hd 注入「已上架 · 1 家客户 · 都是最新」，
 *   A2/A4 必须判红（rc=2）。注入点与断言点是同一个元素 —— 这条上一轮吃过亏。
 *
 * 用法：node tools/check-topbar-lean.mjs ｜ --negctl
 * 退出码：0 通过 ｜ 2 有断点 ｜ 3 未量（页面打不开 / 拿不到读数）
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BASE = process.env.XZ_BASE || 'http://127.0.0.1:8941';
const NEG = process.argv.includes('--negctl');
const APP = process.env.XZ_APP || 'zxjt-yy';

const SNIP = join(tmpdir(), 'xz-check-topbar-lean.js');
const NEG6 = process.argv.includes('--negctl=a6');
const INJECT = NEG6
  ? "var a=document.createElement('a');a.id='act-versions';a.href='versions.html?scope=app';a.textContent='历史版本';document.querySelector('.tb-ops').appendChild(a);"
  : NEG
    ? "var x=document.createElement('span');x.className='app-meta';x.textContent='已上架 · 1 家客户 · 都是最新';document.querySelector('.float-hd').appendChild(x);"
    : '';

const SCRIPT = `(function(){
  ${INJECT}
  var hd=document.querySelector('.float-hd');
  if(!hd) return JSON.stringify({missing:'float-hd'});
  function ownText(el){
    var s='';
    for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3) s+=n.nodeValue;}
    return s.replace(/\s+/g,' ').trim();
  }
  var nameEl=hd.querySelector('.app-name'), verEl=hd.querySelector('.app-edit');
  var extra='';
  for(var i=0;i<hd.children.length;i++){
    var c=hd.children[i];
    if(c===nameEl||c===verEl||c.classList.contains('back')) continue;
    extra+=' '+ownText(c);
  }
  /* A5 状态自清：改内容 → 未保存；改回原样 → 未保存自动消失。
     用户 m01455「收的更干净」——原报告把这行列为"REVERSE/状态机没覆盖"。
     读写口子只走 DB.setAppContent / DB.dropAppContent（内容层唯一写入口），
     跑完把这一块的内容覆盖原样恢复：原来没有覆盖就删掉，有就整块写回。 */
  var a5=null;
  try{
    var appKey=document.body.getAttribute('data-app');
    var appObj=DB.appById(appKey);
    var compId=appObj&&appObj.comps&&appObj.comps[0];
    if(compId){
      var hadOwn=!!(appObj.content&&appObj.content[compId]);
      var ownJson=hadOwn?JSON.stringify(appObj.content[compId]):null;
      var nm=DB.contentOf(appKey,compId).name;
      var base=verEl.textContent.trim();
      DB.setAppContent(appKey,compId,{name:nm+' \u4e34\u65f6'},true);
      var dirty=verEl.textContent.trim();
      DB.setAppContent(appKey,compId,{name:nm},true);
      var cleared=verEl.textContent.trim();
      if(hadOwn) DB.setAppContent(appKey,compId,JSON.parse(ownJson),true); else DB.dropAppContent(appKey,compId,true);
      a5={base:base,dirty:dirty,cleared:cleared,final:verEl.textContent.trim(),hadOwn:hadOwn};
    }
  }catch(err){a5={error:String(err&&err.message||err)};}
  var vlink=document.querySelector('a[href*="versions.html"]');
  return JSON.stringify({
    name: nameEl?nameEl.textContent.trim():'',
    ver: verEl?verEl.textContent.trim():'',
    vlink: vlink?vlink.textContent.trim():'',
    extra: extra.trim(),
    kids: hd.children.length,
    text: hd.innerText.replace(/\s+/g,' ').trim(),
    a5: a5
  });
})()`;

function read(url) {
  const out = execFileSync(process.execPath, [join(HERE, 'probe.mjs'), url, SNIP, '--wait=2000'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = out.trim().split('\n').filter(Boolean).pop();
  let v = JSON.parse(line);
  /* probe 约定：表达式返回字符串时会被序列化两次（这里是 JSON 字符串），解一层 */
  if (typeof v === 'string') v = JSON.parse(v);
  return v;
}

writeFileSync(SNIP, SCRIPT);
const url = `${BASE}/app.html?id=${APP}`;
let v;
try { v = read(url); } catch (e) { console.log('未量：打不开 ' + url + ' — ' + String(e.message).slice(0, 120)); process.exit(3); }
if (v.missing) { console.log('未量：页面没有 .float-hd'); process.exit(3); }

const VER = /^v\d+( · (未保存|只读|保存失败))?$/;
const fails = [];
if (!VER.test(v.ver)) fails.push('A1 版本号形状不符：「' + v.ver + '」');
if (v.extra) fails.push('A2 顶栏多出一块文字：「' + v.extra + '」');
if (v.kids !== 3) fails.push('A3 顶栏直接子元素 ' + v.kids + ' 个（应为 3：返回/名字/版本号）');
const cap = v.name.length + v.ver.length + 2;
if (v.text.length > cap) fails.push('A4 顶栏文字 ' + v.text.length + ' 字，超过上限 ' + cap + '：' + v.text);
/* A6：历史版本入口只在应用管理卡片菜单，配置页顶栏不许重复 */
if (v.vlink) fails.push('A6 配置页又出现「历史版本」入口：' + v.vlink);
/* A5 只在正控里判；负控注入的额外节点会让 base 不可比 */
if (!NEG) {
  const a = v.a5;
  if (!a) fails.push('A5 未量：页面没有可写的内容块（DB/comps 拿不到）');
  else if (a.error) fails.push('A5 未量：' + a.error);
  else {
    if (a.dirty !== a.base + ' · 未保存') fails.push('A5 改内容后顶栏应为「' + a.base + ' · 未保存」，实得「' + a.dirty + '」');
    if (/未保存/.test(a.cleared)) fails.push('A5 改回原样后「未保存」没消失：「' + a.cleared + '」');
    if (a.final !== a.base) fails.push('A5 复原后顶栏没回到原读数：「' + a.final + '」≠「' + a.base + '」');
  }
}

const head = NEG ? '【负控】注入「已上架 · 1 家客户 · 都是最新」后应判红' : '正控';
if (NEG) {
  if (!fails.length) { console.log('✗ 负控没打红：注入第二块文字后仍判绿 —— 这条判据证明不了自己会红'); process.exit(2); }
  console.log('✓ 负控成立（rc=2）：' + fails[0]);
  process.exit(2);
}
if (fails.length) {
  console.log('✗ 顶栏收口 ' + fails.length + ' 条：');
  fails.forEach((x) => console.log('   ' + x));
  console.log('  读数：名字「' + v.name + '」版本「' + v.ver + '」全文「' + v.text + '」');
  process.exit(2);
}
console.log('✓ 顶栏只留名字 + 版本号：' + v.text + '（' + v.kids + ' 个子元素）');
process.exit(0);
