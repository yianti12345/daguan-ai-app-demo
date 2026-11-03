# PROPOSAL · 工程并行（睿克斯-2 / 前端工程与编排）

结论：慢不是"判据太多"，是**判据把"工作区在动"误读成"代码是红的"**，于是用重跑来买确定性。四条都指向同一件事：让"这次读数算不算数"变成机器结论。

## 1 冻结窗口：先判"读数作废"，再判"代码红"

现状只有绿/红两种结局，"工作区在跑期间被改"没有出口，只能靠人隔 20 秒重跑。本轮我为分辨真假红重跑了 4 次，每次约 70 秒。

改法（都在既有文件里）：
1. 新增 `tools/ws-fp.mjs`：输出指纹 = `sha1(所有 .html/.css/.js/.mjs 的 路径+内容哈希)`（用内容哈希，不用 mtime —— checkout 后 mtime 会假变）。
2. `run-gates.sh`：第 12 行后 `F0=$(node tools/ws-fp.mjs)`；汇总前 `F1=…`；`[ "$F0" != "$F1" ] && { echo "ABORT 工作区在跑期间被修改（$F0→$F1），本轮读数作废"; exit 4; }`。**必须打印在任何 ✓/✗ 之前**——先给判词就成了新的假红源。
3. 冻结信号（命令，不是约定）：新增 `tools/ws-wait.mjs --quiet 20 --timeout 180`，连续 20 秒无写入且无 `.gate.lock` 才 rc=0；否则打印"最近写入：<文件> <距今秒>"、rc=3。agent 开工前/收尾前各跑一次。
4. 失败长相必须可区分：`ABORT …（rc=4）` = 没量；`✗ J1 …（rc=2）` = 量了且红。人不用再判断。

省：~280 秒/轮（4 次误判重跑 × 70 秒）

## 2 判据共享一个浏览器

22 项各 spawn 一个 Chrome，每项 ~1.8 秒启动；为防互相拖慢又限 3 路，墙钟被最慢那条串住。

1. 新增 `tools/browser-pool.mjs`：起**一个** Chrome（`--remote-debugging-port=0`，读 `DevToolsActivePort` 拿端口），导出 `WS`；`newPage(url)` 用 `Target.createTarget` + `Target.attachToTarget{flatten:true}` 拿独立 session。
2. `tools/base.mjs` 加 `export async function connect()`：有 `env.CDP_WS` 就 attach，没有就维持现在的自己 spawn（**默认路径不变**，先不冒险）。
3. `run-gates.sh`：`node tools/browser-pool.mjs --serve &` → `export CDP_WS=…`；并发上限 3 → 8（启动开销没了，剩下的是内存）。
4. 兜底：单条判据崩 → `Target.closeTarget` 只关它那个 target，池子继续；健康检查 `1+1` 每 5 秒，连挂两次 ⇒ 后续判据自动退回自 spawn（读数仍有效，只是慢回去）。

省：~38 秒/轮（22×1.8 → 1.8）；并发 3→8 再降 ~25 秒墙钟

## 3 量测缓存层：只缓存"纯读、无副作用、有内容哈希"

可缓存（key 一律内容哈希，不用 mtime；命中即跳过"量"但不跳过"判"）：
- 真源实测（ref-parity 的 15 组 ROLES）：key = REF_URL + 视口 + 角色表 hash，TTL 24h。`ref-snapshot.json` 已有雏形，补一条：**命中缓存也必须跑一次负控**。
- 页面快照（J1/J2/J3/J6 与 PX/PXC 在重复量同一批页面）：key = URL + 该页全部 assets 的 hash 集合。

**绝不能缓存**：
- 有副作用或依赖运行时状态的：D1-D5 拖动、R7 收起、K13 往返、e2e、walk/interact/hit —— 缓存等于把"这次没跑"记成"这次过了"。
- 负控结果：负控是"判据还活着"的唯一证据，它死了不会自己喊。
- 真源侧任何超过 TTL 的读数（真源天天在改）。

省：~15 秒/轮（真源 2 断点 × 2 次导航 + 页面快照 4 项 × 2 秒），并消掉一半"再跑一次确认"的动机

## 4 把 team-lead 从接线员位置拆下来

1. 新增 `tools/gate-manifest.json` 做唯一清单（id / script / args / negctl / 覆盖页 / owner）。`run-gates.sh` 的三个循环（跑、展示、判定）与 `judgments.mjs` 全部从它派生——**只留一份**。本轮"展示循环漏 hit/docparity""`for k in` 双份""台账按名字前缀认人漏三个"三件事，都是这一条能一次挡掉的。
2. 新增 `tools/gate-manifest.mjs --verify`，逐条机检：脚本存在 / 台账有条目且写了 subject+negctl / `--negctl` 真能 rc=2（带 60s 超时）/ 覆盖页都在 `pages.mjs` 里 / 三处键集合一致。任一不满足 → rc=2 并打印"谁没做完哪一步"。
3. agent 加判据的收口动作从"报给 team-lead 请帮我接"变成"跑 `--verify` 到 0"。没跑完就是红的，不需要人来检查。

省：~200 秒/轮（3 个往返 × 70 秒 + 人工确认）

## 先做哪一条

**第 1 条**（指纹 + ABORT + ws-wait）。它不依赖任何人改判据，三个文件、半小时，直接堵住本轮最大的时间黑洞（重跑）；第 2、3 条都建立在"读数可信"之上，顺序不能反。
