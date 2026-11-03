# 提案：判据可信度与返工成本

慢的根因不是判据少，是**判据的可信度靠人肉兜**：一次读数错了，要有人第二次量、第三次量，才敢信。
下面四条都是"把人工兜底换成机器关卡"，每条给落点文件、检查内容、失败长什么样。

## 1. 一条判据可信的验收清单（阻断登记）

落点：`tools/judgments.mjs` + `tools/check-judgments.mjs`。
每条台账新增两个必填字段，缺则整条判红：
- `negctlForms: ['subject-gone','empty-result','wrong-build']` —— **按失效形态列举**，不是只写"能红"。
- `readings: 'e2e-flow.mjs --print-readings'` —— 一条能复算本次读数的命令。

`check-judgments.mjs` 加三关（现有"每脚本都在台账里"已能防漏登记，闸门挂在这三关上）：
1. `negctlForms.length >= 1`，且每一形都能被执行（`node tools/<tool> --negctl=<form>` 必须 rc=2）。
2. `readings` 命令可跑，输出 JSON 的键必须覆盖断言 detail 里出现的数字；对不上 ⇒ 红。
3. 台账的 `about`/`subject` 里出现 `/tmp/`、`curl -s`、`|` 手搓管道 ⇒ 红（复算不许依赖手搓命令）。

失败长什么样：`✗ C1 E2E 缺 negctlForms`、`✗ C1 E2E negctlForm=empty-result 跑出 rc=0（该形态杀不死它）`、
`✗ C1 E2E readings 复算不一致 ok=1 vs detail=2`。
阻断方式：`check-judgments` 已在 run-gates 全量里，它 rc=2 ⇒ 全量红 ⇒ 没人能把不过关的判据当"绿的"登记。
省：每轮 1–2 次返工，约 30–60 分钟/判据。

## 2. 空结果必须判红（这轮两次错都在这）

落点：新增 `tools/lib/empty.mjs`（12 行），所有判据统一调用：

```js
export function expectNonEmpty(what, arr, allow = []) {
  if (arr.length === 0 && !allow.includes(what)) {
    throw new Error(`EMPTY:${what} 返回 0 条 —— 空结果默认判红；确属正常须登记 allowlist 并写理由`);
  }
  return arr;
}
```

区分规则（写进 `SOP.md` 判据一节）：
- 0 命中 = **主体消失**（选择器改名/元素被删）⇒ 红。这轮的 `.toast`→`#hint`、用户提的 `--focus-ring` 都属此类。
- 0 命中 = **合法空集**（如"当前无空态元素"）⇒ 必须进 allowlist，且 allowlist 自身要有一条 subject 判据看着它，否则它会成长为新的恒绿。

一条 grep 纪律，进 `--fast`：`grep -n "\.length === 0\|grep -c" tools/*.mjs` 的每一处，必须要么调用
`expectNonEmpty`，要么带 `/* allow-empty: 理由 */` 注释；两者皆无 ⇒ 红。
失败长什么样：`✗ EMPTY:.toast 返回 0 条 —— 主体可能已改名/删除`、`✗ tools/px-parity.mjs:88 裸 0 命中未声明`。
省：本轮 focus-ring 2 轮 + 像素色差 2 轮 ≈ 120 分钟。

## 3. 破坏-红-恢复-绿做成一条命令

落点：新增 `tools/negctl.mjs`；注入器按 `negctlForms` 注册（`tools/negctl/<form>.mjs`）。
命令 `node tools/negctl.mjs --all`，对每条判据的每一形：注入 → 跑 → 要求 rc=2 → 恢复 → 跑 → 要求 rc=0。
注入方式限定为**运行期注入**（改 DOM/改返回体/临时删字段），不许改 `assets/`，与我这轮事故段的做法一致。
输出：`✓ e2e-flow/role-alert 红→绿 9.2s`、`✗ e2e-flow/role-alert 注入后仍 rc=0（断言是假的）`。
挂载：`run-gates.sh --negctl`（现有开关）+ `--fast` 里只跑纯静态注入那几条（约 40s）。
省：本次我手工做 3 处注入 ≈ 25 分钟/轮，常驻后人工 0。

## 4. 基准 → 判据的依赖账

落点：新增 `tools/deps.json` + `tools/deps.mjs`。
```json
{ "tools/ref-snapshot.json": ["ref-parity.mjs","ref-vs-mine.mjs"],
  "tools/px-baseline/": ["px-parity.mjs","px-refcolors.mjs"],
  "tools/must-see.json": ["visible-audit.mjs","reach-walk.mjs"],
  "tools/walk-allow.json": ["walk.mjs"], "tools/interact-allow.json": ["interact-audit.mjs"] }
```
`deps.mjs --check`：基准文件记 sha256，写入 `tools/deps.lock.json`（基准 hash ↔ 依赖工具上次运行时的 hash 快照）。
- 基准变了、依赖工具未重跑 ⇒ 红，并打印该跑哪条 `--bless`。
- 工具变了、基准没动 ⇒ 只打印提示，不红（工具侧改动本来就该自己负责）。
挂载：run-gates 全量**第一步**跑它，先于所有浏览器判据。
失败长什么样：`✗ must-see.json 已变（a1b2→c3d4），visible-audit.mjs 未重算 —— 跑 node tools/visible-audit.mjs --bless`。
省：一次基准变更要人肉找下游 ≈ 20–40 分钟；漏找一次 = 整轮验的是旧基准。
