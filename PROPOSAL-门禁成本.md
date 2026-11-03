# PROPOSAL · 门禁成本（改前 155.1s → 目标 ≤65s）

## 0 改前基线（本机、GATE_BASE=8941、并发 3，2026-10-23 实测一次）
- 全量 `bash tools/run-gates.sh` = **155.1s**，rc=0，21 项全绿。
- 串行总和 237.7s ⇒ 并发只回收 35%。原因：21 项里 **11 项各起一个无头 Chrome**，而它们访问的是同一份 `PAGES` 4 页。
- 单项实测（串行，秒）：静态 7 项 `copy .1 / states .1 / token .1 / stamp .4 / refsnap .1 / assets .3 / docparity .3` + `consistency 1.3 / solidst 1.3` = **4.0**
- 浏览器 11 项：`vsa 3.9 / links 5.8 / preview 6.5 / tokens 6.9 / solid 11.2 / drag 15.1 / px 17.6 / walk 33.7 / interact 38.5 / hit 42.2 / pxc 21.4` = **202.8**
- 另：`judge(--quick) 22.9`、`refparity 8.0`（bsk 会话已活着时；冷启 +20s）

## 1 分级表（直接落进 run-gates.sh）
| 档 | 何时跑 | 判据 | 实测 |
|---|---|---|---|
| **T0 每次** | 任何改动、任何时刻 | copy states token stamp solidst refsnap assets docparity consistency vsa | **7.9s** |
| **T1 收尾** | 提交前 / 给人看之前 | walk solid drag links preview tokens px pxc interact hit judge refparity | **147.2s**（并发后） |
| **T2 按改动面** | 由 changed 决定（见下） | 视觉组 px pxc refparity / 遍历组 walk interact hit | 视改动 |

**T2 触发条件（保守取值，宁可多跑）**
| 改动面 | 跳过 | 为什么能跳 |
|---|---|---|
| 只有 `tools/**`、`*.md`、`tools/*.json` | 全部浏览器判据 | 这些文件不进浏览器 |
| 只有 `assets/*.css` | walk interact hit | 可点元素集合由 HTML/JS 决定，CSS 不新增元素 |
| `assets/*.js` 或 `*.html` | 什么都不跳 | **注意**：apps.html/app.js 用内联样式建 DOM，改 JS 会改像素 —— 所以 px/pxc 不能按"只改 JS"跳 |

跑法（run-gates.sh 增 2 个开关）：`--fast`=T0（已有）、`--changed`=T0+T2、无参=T0+T1（收尾）。
**改动面怎么算（此目录无 git）**，两步走：
1. **mtime（0 新文件）**：`find assets -name '*.css' -newer tools/.gate-stamp` / `-name '*.js'` / `find . -maxdepth 1 -name '*.html'`。T1 跑完 `touch tools/.gate-stamp`。run-gates.sh +5 行。
2. mtime 会被 `cp -p`/`tar` 重置，不可靠时升级为 `tools/changed.mjs`：复用 `stamp.mjs` 的 md5，写 `tools/.gate-hashes.json`，与上次比对输出三类布尔。+1 文件，`--changed` 改调它。
- **省**：① 只改 `tools/` 或文档的一轮：155.1 → **8s（省 147s）**，这类改动在最近两天占了一半以上；② 只改 `assets/*.css` 的一轮：省 ~40s（跳过 walk 33.7+interact 38.5+hit 42.2 的并发份额）。

## 2 成本上限（超过就必整改）
- **单条 ≤ 20s**。依据：T0 最慢 3.9s、T1 中位数 6.9s；>20s 说明它做的是"遍历"不是"取证"。**现有超标 3 项**：hit 42.2 / interact 38.5 / walk 33.7 —— 三项都必须在 §4 里降到 ≤20s。
- **全量 ≤ 90s**（wall，并发 3）。依据：改前 155.1s；§3+§4 后预计 55–65s，留 25s 余量。
- **管总时长的新判据 `tools/gate-budget.mjs`**（防它在合并后又涨回去）：
  run-gates.sh 的 `run_one` 里记 `START=$(date +%s)`、结束后写 `$TMP/<key>.sec`；汇总前 `node tools/gate-budget.mjs "$TMP"`：任一条 >20s 或总和 >90s ⇒ rc=2 并打印超时项与超出量。run-gates.sh 改 3 处（run_one、汇总前调用、结果并入汇总行）。
  **省：0s（它省的是未来）。没有这条，上面两条只是一次性优化。**

## 3 共享浏览器会话
事实：11 个浏览器判据各自 `spawn Chrome(debugPort())`，每个都按 `PAGES` 走 4 页 ⇒ **11 次冷启 + 44 次导航**。
数字来源：`vsa` 一进程走 7 个页面状态用了 3.9s ⇒ 冷启 1.5s + 导航 0.34s×7 = 3.88 ✓（用它反推的）。
- **`tools/harness.mjs`**：`withPages(PAGES, suites)` 起 1 个 Chrome，每页导航 1 次，把该页所有 suite 的量测表达式**合成一次 `Runtime.evaluate`**，结果按 suite 名分组返回。
  **省：冷启 10×1.5=15s + 导航 (44−4)×0.34=13.6s ⇒ 28s。**
- **失败隔离**：每个 suite 单独 try/catch，结果写 `{suite, page, ok, err}`；一崩只红它自己（现在是一崩全崩，日志被最后一个异常盖掉）。
  **省：0s（可靠性）。**
- **截图复用**：px 与 pxc 截同一批 4 页。改成 harness 内截一次存 `$TMP/shot/<page>.png`，两边读同一张；pxc 因此不再走 bsk 单程。
  **省：15s**（pxc 21.4 → ~6s）。

## 4 可合并（点名 + 覆盖不减的前提）
1. **`interact-audit` 并入 `walk`**（38.5 + 33.7）：两者都是"把 PAGES 上每个可点元素点一遍"。walk 看"点了之后 DOM/样式变没变 + 死控件"，interact 看"点了之后 state/副作用变没变"。
   覆盖不减的前提：合并前先 `diff` 两边的元素集合（都是 `a,button,[role=button],input,select,textarea` 的并集），**差集必须为空**才许删 interact 的独立遍历；两条断言各自保留，输出两段结果。
   **省：33s**（去掉一次完整遍历，只多 ~5s 记录开销）。
2. **`hit-audit`(42.2) 与 walk 共用坐标采样**：hit 用 `elementFromPoint` 取"这个点实际命中谁"，与 walk 同一次遍历采坐标。
   覆盖不减：hit 的断言（命中元素 ≠ 目标且不是其后代）与 walk 的断言（点击后无变化）相互独立，只共用循环。
   **省：22s**（42.2 → ~20s）。
3. **`px-parity`(17.6) + `px-refcolors`(21.4) 共用截图**：输入同一批 PNG，断言不同（"今天 vs 冻结基线" / "computed vs 像素众数"）。
   **省：15s**（见 §3 截图复用，同一件事的重复计入）。
4. **`check-preview`(6.5) 并入 `gate-tokens`(6.9)**：两者都在 component.html / app.html 上量骨架与取值，导航重复 2 次以上。
   **省：4s**。
5. **不合并（理由）**：`check-drag`(15.1) 要 reload 验位置保留，会打断同页其它量测；`check-consistency`(1.3) 已静态；`check-judgments`(22.9) 会跑别人的 `--negctl`，放进共享会话会互相干扰 —— run-gates.sh 第 108-111 行已记过 `asset-integrity` 负控临时改名造成的假红。
合计：28（会话）+ 33 + 22 + 15 + 4 = **102s**；wall 从 155.1 → 预计 **55–65s**（并发不线性叠加，取保守值 65s）。

## 5 一条否决过的想法
"给每个判据加超时 kill" —— 不采用：现在 155s 里没有一项是挂死，全是真在跑；kill 只会把慢藏成红。
