#!/usr/bin/env node
/* check-publish-parity —— 本地改完有没有真的发到公网。
 *
 * 为什么有它（2026-11-03，用户 m01612「什么我看还是没变化？？？」）：
 *   顶栏收口在本地全绿、截图也看了，但用户打开的是
 *   https://yianti12345.github.io/daguan-ai-app-demo/app.html?id=zxjt-yy，
 *   而发布仓库 /tmp/daguan-site 自 09:30 起就没再同步过。
 *   本地绿 ≠ 用户能看到。这条判据只回答一件事：
 *   发布集里的每个文件，本地内容与发布仓库 HEAD 是否逐字节相同。
 *
 * 口径：
 *   - 发布集 = 七个页面 + assets/app.js + assets/sys.css（发布报告 2026-11-02 的收录面）
 *   - 比对对象是 git HEAD（已提交），不是工作区：工作区脏说明"同步了但没提交"
 *   - 发布仓库不存在 / HEAD 里没有该文件 → 红，并说清怎么补
 *
 * 用法：node tools/check-publish-parity.mjs ｜ --negctl
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE = process.env.PUBLISH_DIR || '/tmp/daguan-site';
const NEG = process.argv.includes('--negctl');
const PAGES = ['app.html', 'apps.html', 'versions.html', 'client-auth.html', 'downloads.html',
  'component.html', 'components.html'];
const EXTRA = ['assets/app.js', 'assets/sys.css'];
/* ★2026-11-03 独立盲审指出：原来只比 9 个文件，CSS 只收了 sys.css，而页面实际引用
   11 个 JS + 8 个 CSS —— 其余 6 个 CSS 变旧闸抓不到。现在从七个页面自身抽引用：
   href/src="assets/…"，去掉 ?v= 后去重，再并上两个页面模板之外但必须同步的文件。 */
function discoveredFiles() {
  const set = new Set(EXTRA);
  for (const p of PAGES) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) continue;
    const html = readFileSync(abs, 'utf8');
    const re = /(?:href|src)="((?:assets\/)[^"?#]+)(?:\?[^"#]*)?"/g;
    let m;
    while ((m = re.exec(html))) set.add(m[1]);
  }
  return [...set].sort();
}
const FILES = [...PAGES, ...discoveredFiles()];
const url = 'https://yianti12345.github.io/daguan-ai-app-demo/';
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const git = (args) => execFileSync('git', args, { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
/* 二进制（webp/png）不能按 utf8 解码再哈希：会让同一个文件的哈希对不上，
   2026-11-03 闸第一次跑就在 common_card.webp 上假红 —— 拿到 Buffer 再算。 */
const gitBuf = (args) => execFileSync('git', args, { cwd: SITE, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const fails = [];
if (!existsSync(join(SITE, '.git'))) {
  console.log('✗ 发布仓库不在 ' + SITE + '（公网 ' + url + '）');
  console.log('  处理：git clone https://github.com/yianti12345/daguan-ai-app-demo.git ' + SITE);
  process.exit(2);
}
let dirty = '';
try { dirty = git(['status', '--porcelain']).trim(); } catch (e) { dirty = '?'; }
if (dirty) fails.push('发布仓库有未提交改动（同步了但没 commit/push）：' + dirty.split('\n').length + ' 个文件');

for (const f of FILES) {
  const local = join(ROOT, f);
  if (!existsSync(local)) { fails.push(f + '：本地没有这个文件'); continue; }
  let head = '';
  try { head = sha(gitBuf(['show', 'HEAD:' + f])); } catch (e) { fails.push(f + '：发布仓库 HEAD 里没有这个文件'); continue; }
  const mine = sha(readFileSync(local));
  if (mine !== head) fails.push(f + '：本地 ' + mine + ' ≠ 公网 ' + head);
}
if (NEG) fails.push('负控：人为制造一条差异（证明判据会红）');

if (fails.length) {
  console.log('✗ 本地改动没有发布到公网 ' + fails.length + ' 条：');
  fails.forEach((x) => console.log('   ' + x));
  console.log('  处理：把发布集同步到 ' + SITE + ' → git commit/push → 等 Pages 构建，再验 ' + url);
  process.exit(2);
}
console.log('✓ 发布集与公网一致：' + FILES.length + ' 个文件（' + SITE + ' HEAD）');
