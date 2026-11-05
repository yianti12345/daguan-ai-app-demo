#!/usr/bin/env node
/* ref-vs-mine —— 真源 vs 我方，按「角色」对照，不复用同一个选择器。
 *
 * 为什么不能直接用 spec-diff 的通用选择器：
 *   真源是 antd，我方是自建类。`document.querySelector('input')` 在两边命中的是
 *   完全不同的元素 —— 实测比出 2 条差异（fs 16 vs 13.33、color 0.65 vs 0），
 *   查下去两边都是零尺寸的垃圾 input，纯噪音。spec-diff 的注释里也写了这条口径限制。
 *
 * 本脚本的做法：两边各写一套定位策略（真源按文本锚点 + antd 类名，我方按自己的类名），
 *   命中后**输出同名的 key**，再并排比同一批属性。
 *
 * 用法：node tools/ref-vs-mine.mjs <真源URL> <我的URL>
 * 依赖：bsk（接管用户本人 Chrome，天然带登录态）。会话 id 用环境变量 BSK_SESSION 覆盖。
 */
import { execFileSync } from 'node:child_process';

const BSK = 'bsk';
const SESS = process.env.BSK_SESSION || 'hugw';
const [REF, MINE] = process.argv.slice(2);
if (!REF || !MINE) {
  console.log('用法: node tools/ref-vs-mine.mjs <真源URL> <我的URL>');
  process.exit(3);
}

const COMMON = `
  const N=v=>Math.round(parseFloat(v)||0);
  const R=e=>{const r=e.getBoundingClientRect();return {x:N(r.x),y:N(r.y),w:N(r.width),h:N(r.height)}};
  const G=(e,k)=>{try{const c=getComputedStyle(e);return k.indexOf('::')===0?c.getPropertyValue('color'):c.getPropertyValue(k)}catch(x){return null}};
  const T=t=>[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.textContent||'').trim()===t)[0];
  const P=(e,props)=>{if(!e)return null;const o=R(e);for(const k of props)o[k]=G(e,k);return o;};
`;

/* 真源（antd · #/claw/skills 技能管理页）：全部按可见文本锚点定位 */
const PROBE_REF = `(function(){${COMMON}
  const o={};
  o.sider = P([...document.querySelectorAll('div,aside,nav')].filter(e=>{const r=e.getBoundingClientRect();
      return r.width>150&&r.width<260&&r.height>innerHeight*0.5&&r.x<20}).sort((a,b)=>b.offsetHeight-a.offsetHeight)[0],
      ['background-color','border-right-width']);
  o.curMenu = P(T('技能管理'), ['color','font-weight','font-size']);
  const cb=T('技能管理'); let mu=cb?cb.parentElement:null;
  while(mu){if(getComputedStyle(mu).backgroundColor!=='rgba(0, 0, 0, 0)')break;mu=mu.parentElement;}
  o.curMenuBlock = mu?Object.assign(R(mu),{bg:G(mu,'background-color'),br:G(mu,'border-radius')}):null;
  o.normMenu = P(T('授权管理'), ['color','font-weight','font-size']);
  o.header = P([...document.querySelectorAll('div,header')].filter(e=>{const r=e.getBoundingClientRect();
      return r.y<12&&r.height>=36&&r.height<=72&&r.width>innerWidth*0.45}).sort((a,b)=>b.offsetWidth-a.offsetWidth)[0],
      ['background-color','border-bottom-width','border-bottom-color']);
  o.primaryBtn = P([...document.querySelectorAll('button')].filter(b=>/新增技能/.test(b.innerText||''))[0],
      ['background-color','border-radius','font-size','padding','color']);
  const cards=[...document.querySelectorAll('div')].filter(e=>{const r=e.getBoundingClientRect();
      return N(r.width)===410&&N(r.height)===193});
  o.card = cards[0]?P(cards[0],['border-radius','border-color','border-width','padding','background-color','box-shadow']):null;
  o.gridGapX = cards.length>1?N(cards[1].getBoundingClientRect().x-cards[0].getBoundingClientRect().x-410):null;
  o.cardCount = cards.length;
  o.cardTitle = P(T('自动化测试'), ['font-size','font-weight','color']);
  const sub=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.textContent||'').trim()==='工具'&&e.getBoundingClientRect().width>0)[0];
  o.cardSub = sub?{fs:G(sub,'font-size'),color:G(sub,'color'),h:N(sub.getBoundingClientRect().height)}:null;
  const desc=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^进行全流程自动化测试/.test((e.textContent||'').trim()))[0];
  o.cardDesc = desc?{fs:G(desc,'font-size'),color:G(desc,'color'),lh:G(desc,'line-height'),w:N(desc.getBoundingClientRect().width)}:null;
  o.tag = P(T('已上架'), ['background-color','color','font-size','border-radius','padding','border-color','border-width']);
  o.pager = P([...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/第\\s*1-10\\s*条/.test(e.textContent||''))[0], ['font-size','color']);
  o.searchBox = P([...document.querySelectorAll('input')].filter(i=>(i.placeholder||'').indexOf('搜索')>=0)[0]?.closest('.ant-input-affix-wrapper')
      || [...document.querySelectorAll('input')].filter(i=>(i.placeholder||'').indexOf('搜索')>=0)[0]?.parentElement,
      ['border-radius','border-color','background-color','border-width']);
  o.searchInput = P([...document.querySelectorAll('input')].filter(i=>(i.placeholder||'').indexOf('搜索')>=0)[0], ['font-size','color']);
  return JSON.stringify(o);})()`;

/* 我方（自建 .sider / .hdr / .card …）：按自己的类名定位 */
const PROBE_MINE = `(function(){${COMMON}
  const q=s=>document.querySelector(s);
  const o={};
  o.sider = P(q('.sider'), ['background-color','border-right-width']);
  o.curMenu = P(q('.sider a[aria-current="true"]'), ['color','font-weight','font-size']);
  o.curMenuBlock = q('.sider a[aria-current="true"]')?Object.assign(R(q('.sider a[aria-current="true"]')),{bg:G(q('.sider a[aria-current="true"]'),'background-color'),br:G(q('.sider a[aria-current="true"]'),'border-radius')}):null;
  o.normMenu = P(q('.sider a:not([aria-current])'), ['color','font-weight','font-size']);
  o.header = P(q('.hdr'), ['background-color','border-bottom-width','border-bottom-color']);
  o.primaryBtn = P(q('.btn.primary'), ['background-color','border-radius','font-size','padding','color']);
  o.card = P(q('.card'), ['border-radius','border-color','border-width','padding','background-color','box-shadow']);
  const cards=[...document.querySelectorAll('.card')];
  o.gridGapX = cards.length>1?N(cards[1].getBoundingClientRect().x-cards[0].getBoundingClientRect().x-cards[0].getBoundingClientRect().width):null;
  o.cardCount = cards.length;
  const titleEl = q('.card-tt, .kc-title');
  const subEl = q('.card-tt i');
  const descEl = q('.card-desc, .kc-desc');
  o.cardTitle = titleEl ? P(titleEl, ['font-size','font-weight','color']) : null;
  o.cardSub = subEl?{fs:G(subEl,'font-size'),color:G(subEl,'color'),h:N(subEl.getBoundingClientRect().height)}:null;
  o.cardDesc = descEl?{fs:G(descEl,'font-size'),color:G(descEl,'color'),lh:G(descEl,'line-height'),w:N(descEl.getBoundingClientRect().width)}:null;
  o.tag = P(q('.tag.ok'), ['background-color','color','font-size','border-radius','padding','border-color','border-width']);
  o.pager = P(q('.pager #total'), ['font-size','color']);
  o.searchBox = P(q('.field.w220'), ['border-radius','border-color','background-color','border-width']);
  o.searchInput = P(q('#f-kw'), ['font-size','color']);
  return JSON.stringify(o);})()`;

function run(url, probe) {
  execFileSync(BSK, ['navigate', '--session', SESS, 'about:blank'], { stdio: 'ignore' });
  execFileSync(BSK, ['navigate', '--session', SESS, url], { stdio: 'ignore' });
  execFileSync('sleep', ['2.5']);
  const raw = execFileSync(BSK, ['evaluate', '--session', SESS, probe], { encoding: 'utf8' });
  const line = raw.trim().split('\n').filter((l) => l.trim().startsWith('{"') || l.trim().startsWith('{')).pop();
  try { return JSON.parse(line); } catch (e) {
    console.log('读数失败：' + raw.slice(0, 200));
    process.exit(3);
  }
}

const a = run(REF, PROBE_REF);
const b = run(MINE, PROBE_MINE);

const keys = ['sider', 'siderBgPx', 'curMenu', 'curMenuBlock', 'normMenu', 'header', 'primaryBtn',
  'card', 'gridGapX', 'cardCount', 'cardTitle', 'cardSub', 'cardDesc', 'tag', 'pager', 'searchBox', 'searchInput'];
const PROPS = ['w', 'h', 'x', 'y', 'background-color', 'color', 'font-size', 'font-weight',
  'border-radius', 'border-width', 'border-color', 'border-bottom-width', 'border-bottom-color',
  'border-right-width', 'padding', 'box-shadow', 'fs', 'lh', 'bg', 'br'];

const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
const SIZE = ['w', 'h', 'x', 'y'];

console.log('\n真源 ' + REF);
console.log('我的 ' + MINE + '\n');
console.log(pad('角色', 14) + pad('属性', 20) + pad('真源', 22) + pad('我的', 22) + '判定');
console.log('-'.repeat(86));

let diffs = 0;
const same = [];
for (const k of keys) {
  const ea = a[k], eb = b[k];
  if (ea === undefined || eb === undefined) continue;
  if (ea === null || eb === null) {
    if (ea === eb) continue;
    diffs++;
    console.log(pad(k, 14) + pad('存在性', 20) + pad(ea ? '有' : '缺失', 22) + pad(eb ? '有' : '缺失', 22) + '差异');
    continue;
  }
  const props = new Set([...Object.keys(ea), ...Object.keys(eb)]);
  let hit = 0;
  for (const p of props) {
    if (!PROPS.includes(p)) continue;
    const va = ea[p], vb = eb[p];
    if (va === undefined || vb === undefined) continue;
    if (String(va) === String(vb)) continue;
    const n1 = parseFloat(va), n2 = parseFloat(vb);
    if (SIZE.includes(p) && !isNaN(n1) && !isNaN(n2) && Math.abs(n1 - n2) <= 2) continue;  // 亚像素/字体渲染容差
    hit++;
    console.log(pad(k, 14) + pad(p, 20) + pad(va, 22) + pad(vb, 22) + '差异');
  }
  diffs += hit;
  if (!hit) same.push(k);
}
console.log('-'.repeat(86));
console.log('差异项 ' + diffs + ' 条 ｜ 完全一致的角色 ' + same.length + ' 个：' + (same.join('、') || '无'));
process.exit(diffs ? 2 : 0);
