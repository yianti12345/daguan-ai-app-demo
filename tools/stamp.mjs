#!/usr/bin/env node
/* stamp —— 给页面里的本地资源引用打上「内容哈希」版本号。
 *
 * 为什么要有它：今天已经有两个人踩同一个坑——
 *   ① 艾达那边 `app.js:585` 的空指针，根因是浏览器缓存里混了新旧两份 JS；
 *   ② 诺亚改的 `xiaozhi.js` 是四个页面共用的，却一个都不带版本号，
 *      一旦吃到旧缓存，表现就是「面板又开始消失 / 假成功又回来」，而控制台干净得像回退了。
 *
 * 为什么不用手写 ?v=20261022e：改一次 JS 要记得改四个 HTML，漏一个就复发。
 * 这里按**文件内容**算哈希，内容不变版本不变，内容一变版本自动变 —— 幂等，可重复跑。
 *
 * 用法：node tools/stamp.mjs            改写四个 html 里的 ref
 *      node tools/stamp.mjs --check    只检查，不写；有不一致则 rc=2（供门禁调用）
 *      node tools/stamp.mjs --negctl   负控：临时给一个资源加 1 个字节，哈希必变 ⇒ 还原后退出码 2

 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 页面清单：新增页面必须加到这里，否则它的 ?v= 永远是占位 —— 而"没被任何判据覆盖的页面"
   就是资产为零（本项目的老毛病）。2026-10-26 加 versions.html 时正是这么发现的。 */
const PAGES = ['components.html', 'apps.html', 'component.html', 'app.html', 'versions.html', 'client-auth.html', 'downloads.html'];
const CHECK = process.argv.includes('--check');
const NEG = process.argv.includes('--negctl');

/* 负控：给 tokens.css 末尾临时追加 1 个字节 ⇒ 内容哈希变 ⇒ --check 必须抓到。
   用 try/finally 保证一定还原 —— 判据可以红，文件不许留在脏状态。
   这也是"判据能红"的第一手证据：不是我说它会红，是它真的红了。 */
if (NEG) {
  const victim = path.join(ROOT, 'assets/tokens.css');
  const orig = fs.readFileSync(victim);
  let red = false;
  try {
    fs.appendFileSync(victim, '\n/* negctl */');
    const nowHash = crypto.createHash('md5').update(fs.readFileSync(victim)).digest('hex').slice(0, 8);
    const oldHash = crypto.createHash('md5').update(orig).digest('hex').slice(0, 8);
    red = nowHash !== oldHash;
    console.log(red
      ? '  负控成立：内容加 1 个字节后哈希 ' + oldHash + '→' + nowHash + ' ⇒ --check 必然判红'
      : '  负控失败：加了字节哈希没变，哈希函数有问题');
  } finally {
    fs.writeFileSync(victim, orig);
  }
  process.exit(2);
}

const hashOf = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
};

/* 只处理 assets 下的本地 js/css，外链和 data: 不管 */
const RE = /(src|href)="(assets\/[^"?]+\.(?:js|css))(\?v=[^"]*)?"/g;

const problems = [];
let changed = 0;

for (const page of PAGES) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(RE, (m, attr, rel, oldQ) => {
    const h = hashOf(rel);
    if (!h) { problems.push(`${page}: 引用了不存在的 ${rel}`); return m; }
    const want = `?v=${h}`;
    if (oldQ !== want) {
      if (CHECK) problems.push(`${page}: ${rel} 版本号 ${oldQ || '(无)'} ≠ 内容哈希 ${want}`);
    }
    return `${attr}="${rel}${want}"`;
  });
  if (after !== before) {
    if (!CHECK) { fs.writeFileSync(p, after); changed++; }
  }
}

if (CHECK) {
  if (problems.length) {
    console.log('资源版本号与内容不一致：');
    for (const x of problems) console.log('  ✗ ' + x);
    console.log('\n跑一次 `node tools/stamp.mjs` 自动修（按文件内容算哈希，幂等）。');
    process.exit(2);
  }
  console.log('资源版本号全部与内容哈希一致');
  process.exit(0);
}

console.log(changed ? `已改写 ${changed} 个页面` : '无需改动（版本号已是最新）');
for (const x of problems) console.log('  ! ' + x);
