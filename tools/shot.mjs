/* shot.mjs —— 批量截图（复用同一个浏览器）。

 * 为什么要单独一个文件（2026-10-23，用户问「为什么执行这么久」）：
 *   以前每次看效果都是临时写一段 `for (url of ...) { openMine(); shot(); close(); }`，
 *   每页 spawn 一个新 Chrome，单页 ~2.4s 启动 + 2.6s 等待 = 5s。
 *   看 6 页 = 30 秒，一天看十几轮 = 好几分钟纯等浏览器启动。
 *
 * 用法：
 *   node tools/shot.mjs 8973                     # 默认截列表页 + 两个空态
 *   node tools/shot.mjs 8973 "component.html?id=task-detail"
 *   node tools/shot.mjs 8973 "component.html?id=a,component.html?id=b"   # 逗号分隔，同一浏览器
 *   node tools/shot.mjs 8973 all                 # 全量状态（states.mjs）
 *
 * 输出：/tmp/shot-<slug>.png，并打印每页耗时。
 */
import { resolveBase } from './base.mjs';
import { openMineShared, closeMineShared } from './px-parity.mjs';
import { ALL_URLS, BASELINE_URLS } from './states.mjs';

const port = process.argv[2] || '8973';
const what = process.argv[3] || '';
let urls;
if (what === 'all') urls = BASELINE_URLS;
else if (what) urls = what.split(',').map(x => x.trim()).filter(Boolean);
else urls = ['apps.html', 'components.html', 'component.html', 'app.html?id=hx-zc'];

const BASE = await resolveBase([`http://127.0.0.1:${port}`]);
const slug = (p) => p.replace(/[^\w.-]+/g, '_');

const t0 = Date.now();
for (const u of urls) {
  const t = Date.now();
  const m = await openMineShared(`${BASE}/${u}`);
  const out = `/tmp/shot-${slug(u)}.png`;
  await m.shot(out);
  console.log(`${String(Date.now() - t).padStart(5)}ms  ${u}  →  ${out}`);
}
closeMineShared();
console.log(`\n共 ${urls.length} 页，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
