/* base.mjs —— 判据脚本的**唯一基址来源**。
 *
 * 为什么有它：这一轮有一条最贵的错 —— `check-preview` 偷偷连 8977，而门禁跑在 8941，
 * 于是「判绿的是另一份代码」，没人会去查。根因不是谁写错了，是**每个脚本各自写死一个默认端口**
 * （gate-tokens 8973、check-consistency 8977、check-solid 8941……），
 * 端口一变就必然有几个落在别处，而且落到 502 或旧服务上都长得像"通过/环境问题"。
 *
 * 规则：任何要开浏览器的判据都从这里取基址，不许自己写端口。
 * 解析顺序：命令行里的 http 地址 > 环境变量 GATE_BASE > 逐个探候选端口（能同时提供
 * app.html 与 component.html 的那个才算）> 解析不到就抛错（调用方据此 rc=3，不许当绿）。
 */
const CANDIDATES = [8941, 8977, 8973, 8961, 8951, 8971];

async function ok(port) {
  const one = async (p) => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/${p}`, { signal: AbortSignal.timeout(900) });
      return r.ok;
    } catch (e) { return false; }
  };
  return (await one('app.html')) && (await one('component.html'));
}

export async function resolveBase(argv = process.argv.slice(2)) {
  const fromArgv = argv.find((a) => /^https?:\/\//.test(a));
  if (fromArgv) return fromArgv.replace(/\/$/, '');
  if (process.env.GATE_BASE) return process.env.GATE_BASE.replace(/\/$/, '');
  for (const p of CANDIDATES) {
    if (await ok(p)) return `http://127.0.0.1:${p}`;
  }
  throw new Error('找不到服务：试过 ' + CANDIDATES.join(' / ') +
    '，没有一个同时提供 app.html 与 component.html。起法：' +
    'XZ_UP_ROOT=<交付目录> python3 ~/.workbuddy/_tools/xz-up.py 8941');
}

export const PAGES = ['apps.html', 'components.html', 'component.html', 'app.html?id=hx-zc'];

/* ── 调试端口分配（**唯一来源**）──────────────────────────────────
 * 为什么要有它：每个判据自己写 `9300 + random(90)`，于是：
 *   e2e-flow 与 check-judgments 都在 9300-9389；check-solid 与 check-consistency 都在 9500-9589；
 *   gate-tokens 一个就占了 9400-9699，横跨另外三个区间。
 *   并发跑时第二个 Chrome 会在 `/json/list` 里**看到第一个的页面**并连上去 ——
 *   判红判绿都不是自己的那份代码。这就是"check-preview 偷偷连 8977"那个病的编排层版本。
 * 做法：向操作系统要一个空闲端口（listen 0），拿到就关闭，再交给 Chrome。
 * 还有微小竞态窗口，但比"人工维护区间"低一个量级。
 */
export async function debugPort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}
