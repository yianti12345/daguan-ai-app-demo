# components.spec.md · 组件规范（v1 · 2026-10-28）

> 对象：盘上现有的 12 类可复用单元。本件**只定契约**（插槽 / 取值 / 状态 / 唯一实现），
> 不改页面结构与 JS。改取值先改 `assets/tokens.css`，本件只引用语义层令牌。
> 状态十态口径见 `DESIGN.md` §12；本件逐件标"有规则 / 无规则（缺口）/ 不适用"。

## 0 三条 props 规则

1. **最多 1 个布尔**；其余一律枚举（`variant: primary|secondary|ghost|danger|quiet`、`size: md`、`state: on|off|draft`）。
2. 布尔用 `disabled` 或 `aria-*`；**不许用 `data-*` 再造第二个布尔**（如 `data-disabled` + `disabled` 并存）。
3. 枚举取值两端的组合要能同时成立（叠加态见 §13）；不许"两个枚举表达同一件事"。

---

## 1 按钮 Button

**现状实现**：`.btn`（sys.css:118）｜`.kbtn`（482，卡内动作）｜`.fk-op`（float.css:155，顶栏浮条）｜`.nf-ft .btn.quiet`（349，弹层里的"实心带框"）。

**anatomy**
```
.btn〔root: button | a〕
 ├─ .btn-i〔leading icon，可选〕
 ├─ 〔label 文本，必填〕
 └─ .btn-i〔trailing icon，可选〕
```

**props**
| prop | 取值 | 现状 |
|---|---|---|
| `variant` | `primary｜ghost｜danger｜quiet` | primary/ghost/danger 有；quiet 仅存在于 `.nf-ft` 局部覆盖 |
| `size` | `md`（32 高） | 只有一档；`.nf-ft .btn{height:32px}` 是重复声明，不是第二档 |
| `disabled` | boolean（`[disabled]` / `[aria-disabled]`） | 有 |

**状态**
| 态 | 规则 | 判 |
|---|---|---|
| hover | `.btn.primary:hover` 换投影；`.btn.ghost:hover` 换字色 + 影 | 有规则 |
| focus-visible | `outline:2px solid var(--brand)`（118–146 段） | 有规则（未走令牌，迁移项） |
| active | `.btn:active{transform:translateY(.5px)}` | 有规则 |
| disabled | `--sub-2` 底 + `--ink-2` 字 + 去影 | 有规则（`.nf-ft .btn[disabled]{opacity:.55}` 是**第二套**，见差异） |
| selected / read-only / warning / loading | — | 不适用 / 无规则（loading 缺口） |
| error | `.btn.danger`（红浅底 + 红字） | 有规则 |

**现状差异（可判定）**
1. 禁用两套：全局 token 化（`--sub-2` + `--ink-2`）vs 弹层内 `opacity:.55`（349）——同一语义两种表达，且 opacity 会把对比度再压一档。
2. `quiet` 不是一等变体：只写在 `.nf-ft` 下，离开弹层就没有"带框次要按钮"。
3. `.fk-op`（float.css:154）是第四份按钮实现（32 高 / r 6 / padding 14 / 自带投影），与 `.btn.ghost` 撞同一角色。

**决议**
- 合并为 **一个** `.btn`：`variant: primary|ghost|danger|quiet`，`size: md`。
- `quiet` 提为一等变体（= `.btn.ghost` 的"细框版"），删 `.nf-ft` 的局部覆盖；禁用一律用 L2 令牌，**不许 opacity**。
- `.fk-op` 停用 → 用 `.btn.ghost`（过渡期保留，标 deprecated）。
- 取值：`--size-control-h` / `--radius-control` / `--space-inline-lg` / `--font-size-body` / `--shadow-btn`。

---

## 2 列表卡 AppCard（`.kcard`）

**anatomy**（sys.css:381 root；412 热区；876 封面；885 信息区）
```
.kcard〔root〕
 ├─ ::before〔顶部光 --gradient-card-glow〕
 ├─ .kc-cover〔封面区〕
 │   ├─ .kc-cover-img〔可点锚，整卡热区〕
 │   └─ .kc-tag〔右上角标〕
 ├─ .kc-body〔信息区〕
 │   ├─ .card-tt〔标题，1 行省略〕
 │   └─ .card-ds〔描述 + 日期〕
 └─ .k-more〔⋮，绝对定位右上〕
```

**props**：`state: default|off`（`[data-off="1"]` 停用视觉）；无布尔。

**状态**：hover 有（`--shadow-card-hover`）；focus-visible 有（`.kcard-hit`，环内缩 -2px）；selected/active/disabled/read-only/error/warning/loading/empty 无规则或由 `.kcard[data-off]` 承担"停用"，**没有 disabled 语义**（卡仍可点）。

**现状差异**：停用卡同时用"描边 `--line-2` + 标题 `--ink-2` + 顶部光 opacity .25"三种信号；hover 只换阴影不换标题（标题变色挂在 `.kcard-hit:hover`，两者不同步）。

**决议**：停用只用 `state: off` 一个枚举；视觉信号固定为"标题降 `--color-text-secondary` + 收边环"；顶部光不参与状态表达。

---

## 3 组件卡 ComponentCard（`.crow.ccard`）

**anatomy**（sys.css:626 root；653 标题；719 运行带）
```
.crow.ccard〔root, data-on / data-st〕
 ├─ .cc-hd〔身份区〕
 │   ├─ .cc-dot〔类型点 6px〕
 │   └─ .cl-tt〔名称，1 行省略〕
 ├─ .cc-body〔说明，固定 2 行 = 2×19〕
 └─ .cc-ft〔运行带〕
     ├─ .cc-meta〔引用数，吃剩余宽〕
     └─ .cl-ops
         ├─ .kbtn.act〔配置〕
         └─ .k-more〔⋮〕
```

**props**：`state: on|off|draft`（`data-on` / `data-st` 两属性表达三态）；`disabled` boolean（只作用于"配置"这一颗，`aria-disabled` + `tabindex=-1`）。

**几何（由六个值推出，不许写 min-height）**：16(上内距) + 30(名称) + 8 + 38(说明两行) + 16+32+16(运行带) = **156**。

**状态**：hover 有（`--shadow-card-ring-hover`）；focus-visible 有（开关/配置/⋮ 三条）；disabled 有（`.kbtn.act[aria-disabled=true]`：`pointer-events:none` + `tabindex=-1` + 灰 + opacity .72）；selected=on、warning=draft 复用状态色；loading/error/read-only 无规则。

**现状差异**：名称在 `data-on=0` 时降 `--ink-3`，而"配置"禁用也降 `--ink-3`——两种不同原因用同一灰度，扫屏时分不清"卡停用"还是"这个动作停用"。

**决议**：卡级状态只用 `data-on/data-st`；动作级禁用只降该动作，且**卡停用时不再改名称色**（原因由开关文字承担）。

---

## 4 版本行 VersionRow（已退役·无选择器）

**anatomy**（sys.css:539）
```
.ver-row〔root, .is-now〕
 ├─ b〔版本号，16/600〕
 ├─ span〔说明，1 行省略〕
 └─ time〔日期，12〕
```

**props**：`current` boolean（`.is-now`）。grid 三列 `72px | 1fr | auto`，gap 10（非台阶，迁移项），padding 10/12，圆角 `--radius-panel`，底 `--sub-2`。

**状态**：selected=current 有；hover / focus-visible / active / disabled / read-only / error / warning / loading / empty 无规则（行不可点，hover 不适用）。**缺口**：行内"退回/查看"这类动作若加，需补 focus-visible。

**决议**：保持"整行不可点、动作外置"；`gap:10`、`padding:10px 12px` 下轮换成 `--space-*`。

---

## 5 表格 Table（`.tb` / `.tb-detail`）

**anatomy**（sys.css:292 / 301）
```
.tb〔root: table〕
 ├─ thead > tr > th〔文本 + 可选排序钮〕
 └─ tbody > tr > td〔单元格内容〕
```

**props**：`density: default|detail`（52 行高 vs auto；`detail` = 次级表格）。

**状态**：hover 有（`tbody tr:hover td` 换 `--sub`）；selected **无规则**（现无行选中）；focus-visible 无（行不可聚焦）；disabled/read-only/error/warning/loading/empty 无规则（empty 由 `.empty` 承担）。

**现状差异（本轮实测）**：表格渲染点共 **7 处**——静态 `<table class="tb">` 2 处（app.html、component.html）+ 脚本拼 `<table>` 5 处（`assets/app.js` 2、`assets/component.js` 3）；`grep -c '<table' assets/app.js assets/component.js` = 2 / 3。样式只有 `.tb` 一份，但"表头/行高/空态"由各脚本各自拼，容易再分叉。

**决议**：结构只留 `.tb` / `.tb-detail` 两个枚举；**表头不许在脚本里写内联样式**；空态复用 §12；行选中若要加，走 `aria-selected` + `--color-state-selected`，不新造色。

---

## 6 胶囊 Chip / Pill

**现状三份**：状态胶囊 `.cond`（308，padding 2/8、r-pill、12px）｜状态标签 `.tag`（250，height 22、r 6/`--r-sm`）｜动作胶囊 `.fk-chip`（float.css:157，height 36、r-pill、14px、固定右下）。

**anatomy**
```
.chip〔root〕
 ├─ i〔语义点，可选〕
 └─ 〔label 文本〕
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `kind` | `status｜action` | status 不可点；action 可点（`.fk-chip`） |
| `tone` | `neutral｜success｜warning｜danger｜brand` | 对应 L2 状态色对 |

**状态**：status：无交互态（不适用 hover/active/focus）；action：hover 有（`.fk-chip:hover` 换边/字色），focus-visible **无规则**（缺口），disabled/loading 无规则。

**现状差异**：同一个"胶囊"外形，三份实现三套几何（`.tag` 显式 22 高 / `.cond` 由 padding 2+8 与 12px 字推出约 22 / `.fk-chip` 36 高）；`.tag` 用 `--radius-sm`(6) 而 `.cond` 用 pill。

**决议**：`kind` 决定几何，**一个 kind 一套几何**：
- `status`：高 22、`--radius-tag`、`--font-size-caption`、底/字取 `--color-*-surface` / `--color-*`。
- `action`：高 `--size-control-h`（32，现 36 为过渡）、`--radius-pill`、`--font-size-body`。
- `.cond` 与 `.tag` 合并为 `status`（`.tag` 的 6 圆角退役）。

---

## 7 开关 Switch

**现状两份（结构不同）**：
- `.nf-sw button`（sys.css:340）：**36×20**，轨道 `--line-2`，圆点用 `::after`（16×16，left 2 → 18），无文字。
- `.cc-sw`（697）：**min-width 66 / 高 24**，圆点用独立元素 `.cc-sw-dot`（6×6），带文字（启用/禁用/未发布），三态定宽。

**anatomy（规范：一份结构）**
```
.sw〔root: button[role=switch]〕
 ├─ i.sw-dot〔圆点〕
 └─ span.sw-label〔可选：状态文字〕
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `kind` | `toggle｜status` | toggle=布尔开关；status=三态状态开关 |
| `state` | `on｜off｜draft` | toggle 只用 on/off；status 三值全用 |
| `disabled` | boolean | 唯一允许的布尔 |

**几何（按 kind）**：toggle 轨道 `--switch-track-w`(36)×`--switch-track-h`(20)，圆点 `--switch-knob`(16)；status 定宽 `--switch-status-w`(66)、高 `--space-24`、点 `--switch-status-dot`(6)。

**状态**：hover/active 有（`.cc-sw`）；focus-visible 有（`.page-components .cc-sw:focus-visible`，728）；disabled **无规则**（缺口）；selected=on；warning=draft；read-only/error/loading 无规则。

**决议**
1. 结构统一为 `button[role=switch] > i.sw-dot + span.sw-label`；**`.nf-sw button::after` 退役**，圆点一律是元素（可被量、可被截图核对）。
2. 两份合并成一个组件、两套几何（`kind` 枚举），不许再按页面各写一份。
3. 三态同宽只属于 `kind=status`；`kind=toggle` 不许带文字。

---

## 8 ⋯ 菜单 Menu（`.k-more` + `.k-menu` / `.k-pop`）

**anatomy**（sys.css:768 触发；780 面板；804 浮层）
```
.k-more〔root: button, aria-expanded〕
 └─ svg
.k-menu〔面板, hidden〕
 └─ .k-mi〔菜单项: svg + label〕
.k-pop〔浮层: b 标题 + ul>li(span) + p 说明〕
```

**props**：`open` boolean（`aria-expanded` / `hidden`）；菜单项无 variant 枚举（只有默认态）。

**状态**：hover 有（`.k-more:hover` / `.k-mi:hover`）；focus-visible 有（`.k-more` / `.k-mi`）；active 有（`.k-more:active`）；expanded 有（`[aria-expanded=true]` 换底）；disabled 无规则（缺口）；selected/read-only/error/warning/loading/empty 无规则。

**几何**：触发 `--size-control-h`(32) 命中区；面板 `--menu-min-width`(168)、项高 `--menu-item-h`(32)、`--radius-sm`、`--shadow-menu`；浮层 `--popover-w`(220) / `--tooltip-max-width`(236)。

**现状差异**：两页各有一份菜单定位——`.k-menu` 的 `top: calc(100% + 6px)` 与组件页 `.cl-ops .k-menu{top:calc(100% + var(--cc-menu-gap))}`（755）同值两写法；`.k-pop` 的宽 220 与 `--cc-pop-w` 236 是**两个浮层**（一为 `k-pop`，一为组件页引用浮层），不要合并。

**决议**：定位只用 `--space-menu-offset`；菜单项禁用态补齐（`aria-disabled` + `--color-text-secondary`）。

---

## 9 弹层 Dialog（`.nf-mask` + `.nf`）

**anatomy**（sys.css:319 / 320；页脚 347）
```
.nf-mask〔遮罩 --surface-overlay〕
 └─ .nf〔面板 --radius-panel + --shadow-dialog〕
     ├─ .nf-hd〔标题〕
     ├─ .nf-bd〔.nf-row: label + input/textarea + .nf-err〕
     └─ .nf-ft〔动作区: .btn.quiet + .btn.primary〕
```

**props**：`open` boolean；面板无 size 枚举（宽度 `min(480px, calc(100vw - 32px))`）。

**状态**：打开/关闭有；error 有（`.nf-err` + `aria-invalid`）；focus 进入有（v1 §9 口径）；Esc / 遮罩关闭由 JS 承担；loading **无规则**；read-only 无。

**现状差异**：`.nf-row input`（330）与 `.nf-in`（827）同形两写法（同 border 1px + `--radius-xs` + padding 8/11），后者用于"编辑信息弹窗"。

**决议**：输入统一走 §11 的 `variant: outlined`；弹层只保留 `.nf` 一份骨架。

---

## 10 提示条 Status / Toast

**anatomy**
```
.status〔行内条〕
 ├─ i〔6px 语义点〕
 ├─ b〔状态词〕
 └─ .note〔右侧说明〕
.toast〔浮动条〕
 └─ 〔单行文本，role=status|alert〕
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `kind` | `inline｜toast` | 行内常驻 vs 浮层瞬时 |
| `tone` | `ok｜error` | toast 仅这两种；status 由语义点取色 |

**状态**：toast 显隐有（`[data-on]`，opacity + translate 8px，`.16s`）；error 有（`[data-kind=error]` 换 `--warn` 底）；status 无交互态；loading 无；read-only 无。

**现状**：toast 已收口为**一份**实现（`assets/ui-kit.js:22`，2026-10-28 E44 合并了原本 4 份分叉）；页面只留别名。

**决议**：toast 时长/曲线改用 `--duration-fast` / `--ease-out`；`role` 与 `aria-live` 由 ui-kit 统一，不许页面自建。

---

## 11 输入 Input

**现状三份**：`.field`（163，32 高、无边框、`--sub-2` 底、padding 0/11）｜`.nf-row input`（330，1px 边框、`--radius-xs`、padding 8/11）｜`.nf-in`（826 段，同 `.nf-row input`）。

**anatomy**
```
.control〔root: input|textarea, 可选 leading icon〕
 ├─ input / textarea
 └─ .nf-err〔错误文案，可选〕
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `variant` | `filled｜outlined` | filled=`.field`；outlined=表单行 |
| `size` | `md` | 32 高（textarea 自适应高） |
| `disabled` / `readonly` | boolean（二选一，不许同时表达同一件事） | 现均无样式规则 |

**状态**：focus 有（`.nf-row input:focus` 边 + 光环；`.field:focus-within`（167）边 + 光环，但里面写的是裸 `2px`，迁移项）；error 有（`aria-invalid` + `.nf-err`）；disabled/read-only **无规则**；hover/loading 无。

**决议**：`variant` 两值各一套：filled 32 高无边框；outlined 32 高 1px 边框 + `--radius-control`（现 `--radius-xs` 上提一档，和按钮同族）。`disabled` 用 `--surface-sunken-2` 底 + `--color-text-secondary` 字；`readonly` 只换底不换字。

---

## 12 空态 Empty（`.empty`）

**anatomy**（sys.css:261）
```
.empty〔root, padding 64/16 居中〕
 ├─ b〔主句〕
 ├─ .empty-sub〔说明，必带出口〕
 └─ 〔动作按钮 `.btn`〕
```

**props**：`size: default`（无 compact；如要加，进枚举）。

**状态**：empty 本身即态；loading 无；error 由 §10 承担。

**决议**：空态**必须带至少一个可点出口**（sys.css:262 注释口径：造成空态的三个控件都要给出口）；`64px` / `16px` 上提为 `--space-page`/`--space-section` 的下轮迁移项（现值为裸 px）。

---

## 13 叠加态（D2：至少 2 例同时可见）

| # | 叠加 | 现状能否同时出现 | 判据 |
|---|---|---|---|
| 1 | 组件卡 `data-on="0"`（名称灰）+ 卡片 hover（收边环加深） | 能（两张规则互不覆盖） | 名称仍可读、hover 仍能识别"我在哪张卡上" |
| 2 | 开关 `aria-checked="true"`（绿底）+ `:focus-visible`（2px 环） | 能（`.cc-sw:focus-visible` 在 728 段） | 焦点环不被绿底吞掉（环色 `--color-focus-ring` 压 `--color-success-surface` 需 ≥3） |
| 3 | 表格行 hover（`--sub` 底）+ 状态胶囊 `data-k="done"`（绿浅底） | 能 | 胶囊自身底色不被行底替换 |

第 2 例的"环压绿底"对比度**未量**（本轮只算白底/侧栏底），标未量，不写"已过"。

---

## 14 缺口清单（本轮只登记，不修）

| 组件 | 缺口 |
|---|---|
| 按钮 / 开关 / 输入 / 胶囊 / 菜单项 | disabled 或 focus-visible 缺规则（逐件见上） |
| 表格 | 无行选中态 |
| 开关 | `.nf-sw` 圆点是伪元素，量不到、截图核对不到 |
| 全局 | `prefers-reduced-motion` 未实现 |
| 按钮 | `.fk-op` 第四份实现待退役 |

## 15 装配候选行 PickRow（`.row`）

> 2026-10-28 补登记（设计审查 C1）：装配面板里的候选/已装行一直没有进组件规范，
> 于是它和组件库卡片（§3 `ComponentCard`）各长各的：一个 538×113.69 横条、一个 379×156 卡片，
> 宽度差与信息顺序都没有书面理由。本节把它定下来。
>
> **解析面提示（2026-10-29）**：本节原为第二个 `## 8`，已改为 `## 15` 消除撞号。`tools/check-spec-contract.mjs` 当前只取 §1–§12，故本节暂不在其 S1/S2 射程；解析面扩到 §1–§22 由机制席另开单（到期 2026-11-30）。本节仍按 §1–§14 同格式维护，不因暂不在射程而降格。

**props**

| 属性 | 值 | 说明 |
|---|---|---|
| `data-comp` | 组件 id | 行与数据的唯一绑定；动作按钮靠它定位 |
| `data-upd` | `new` / `confirm` / `pending` / `done` / `error` | 只有更新视图才有；缺省＝普通候选行 |

**槽位（从上到下）**

| 槽 | 内容 | 与组件库卡片的差异 |
|---|---|---|
| `name` | 组件名（一行，超长省略） | 与 §3 一致 |
| `act` | 右侧动作组：装配 / 更新 / 确认更新+取消 / 已装配 / 退回 vN / 重试 | 卡片是 ⋮ 菜单；行是直给按钮，因为这里只有一件事要做 |
| `desc` | 一句话「装上后会怎样」 | 一致 |
| `meta` | 版本与引用：「v2 · 被 N 个应用使用」；更新行换成版本对比 `v2 → v3` | 卡片只有状态点，行要版本 |

**顺序**：普通行 `name → desc → meta`；更新行 `name → 版本对比 → desc`（版本是判断依据时前置）。
**等高**：`act` 槽 `min-height: var(--size-control-h)`，四行不得因按钮内容不同而差高。
**状态**：default / hover / 已装 / new / confirm / pending / done / error（八态，样式全部复用 §1 按钮与 §6 胶囊，不新增）。

---

> **§16–§22 为 2026-10-29 补录（P0 5 族 + P1 2 族）**。编号从 16 起；原有两个 `## 8` 中的装配候选行已于 2026-10-29 改为 §15，§15 断号补齐。契约要素与 §1–§15 同格式：anatomy / props / 状态（含不适用）/ 令牌 / Do-Don't / 判法。
> 令牌口径：**不新造任何 L3**；只用 `assets/tokens.css` 现盘 73 条 L3 与 L2 语义层。无匹配档位的值一律写「缺口」，不猜值。

## 16 装配面板 AssemblePanel（`.panel`）

> P0。族边界：根 `.panel`；**14 类** = `.panel` + `.p-hd` `.p-x` `.p-search` `.p-tabs` `.p-tab` `.p-filter` `.p-filter-n` `.p-list` `.p-ft` `.p-empty` + `.pending` `.genbar` `.err-strip`。
> 借件（不另立节、不重复计）：`.mask`（§9 Dialog 的遮罩实现）、`.row`（§15 PickRow）、`.btn-text` / `.btn-ghost-s`（§1 Button）。

**anatomy**
```
.mask[data-open][role=dialog][aria-modal=true][aria-labelledby=dlg-title]   ← 借 Dialog
└─ .panel                        面板面：min(1120px,82vw) × max min(80vh,760px)
   ├─ .p-hd                     头 64：标题 + 计数 + 搜索 + 关闭
   │  ├─ b#dlg-title            标题（JS 追加「· 应用名」）
   │  ├─ .cnt                   计数：「库里 N 个 · 已装 M 个」
   │  ├─ .p-search > input      唯一输入；placeholder「搜索组件名或介绍」
   │  └─ .p-x                   关闭，32×32
   ├─ .p-tabs[role=tablist]     范围页签（只有两个）
   │  └─ .p-tab[role=tab][aria-selected] ×2
   ├─ .p-filter[hidden]         更新筛选行（不是第三个页签）
   │  ├─ .p-filter-n            一行事实（现算）
   │  └─ .btn-text              显示全部（唯一退出）
   ├─ .p-list[role=tabpanel]    2 列网格；行由 PickRow 渲染
   │  ├─ .row ×N                §15
   │  └─ .p-empty               空态（三种文案，见状态表）
   └─ .p-ft                     底注 48：「装配后画布立刻更新，随时可卸下」
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `open` | boolean（`.mask[data-open]`） | 唯一布尔；关闭＝`display:none`，不是 opacity |
| `tab` | `avail｜on` | 落到两个 `.p-tab` 的 `aria-selected`；不新增第三值 |
| `filter` | `off｜updates` | `updates` 时 `.p-filter` 去 hidden；计数与文案由 JS 现算 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | 指针在 `.p-tab` / `.p-x` / 行上 | tab 字色→`--color-text-body`；p-x 底→`--surface-sunken-2`；行由 §15 | 不改布局 | 有规则 |
| focus-visible | 键盘进入 | 搜索框：1px `--color-brand` + 2px 环（inset -1）；`.p-x` / `.p-tab` **无规则**（UA 默认环） | Tab 圈禁 / Esc / 回焦由 JS，`check-dialog-focus` 41 项全过 | 部分有规则（2 处缺口） |
| active | 按下 p-x / tab | 无 `:active` | 原生 button 按下 | 不适用（瞬时动作） |
| disabled | — | 无禁用件 | 关闭入口永远可用 | 不适用 |
| selected | 页签切换 | `[aria-selected=true]`：底 `--color-state-selected` + 字 `--color-text-body` + 600 | 点/回车切换；**无方向键**（APG Tabs 缺口） | 有规则 |
| read-only | 客户视图 | 入口不渲染（`body[data-mode=view]`） | — | 不适用 |
| error | 行装配失败 | `.err-strip`（`--color-danger`）+ `.btn-undo` | `role=alert`；撤销回到失败前 | 有规则 |
| warning | — | — | — | 不适用 |
| loading | 行装配 / 更新中 | `.pending` + `.genbar` 450ms **确定**进度 | 行内按钮消失，不锁面板 | 有规则（面板级无 loading，故意） |
| empty | 搜索无果 / 无可装 / 无需更新 | `.p-empty`；搜索空带「清除搜索」，筛选空**不带按钮** | 焦点回搜索框 | 有规则 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 遮罩 | `.mask` · background | 无（现盘 `color-mix(--color-text-body 30%)`） | — | 缺口：`--surface-overlay` 是 52%，值不同，先登记不改值 |
| 面板面 | `.panel` | `--radius-overlay` / `--surface-page` / `--shadow-dialog` | L2 | 已接 |
| 面板尺寸 | `.panel` · width / max-height | 无（1120 / 760 / 82vw / 80vh） | — | 缺口（不新造） |
| 头 | `.p-hd` | 高 64 无令牌；`--space-inline-lg` / `--space-inline-md` | —/L2 | 头高缺口 |
| 标题 | `.p-hd b` | `--font-size-heading` / 600 / `--color-text-body` | L2 | 已接 |
| 计数 | `.p-hd .cnt` | `--font-size-caption` / `--color-text-subtle` | L2 | 已接 |
| 关闭 | `.p-x` | `--size-control-h`(32) / `--radius-sm` / `--color-text-tertiary`；hover `--surface-sunken-2` + `--color-text-body` | L2 | 尺寸借控件高 |
| 搜索 | `.p-search input` | 高 36 无令牌；`--color-border-card` / `--radius-sm` / `--space-inline-md` / `--font-size-body` | —/L2 | 高 36 与控件 32 两档，缺口 |
| 搜索焦点 | `:focus` | `--color-brand` + `--size-focus-ring-w` | L2 | 已接 |
| 页签 | `.p-tab` | 高 36 无令牌；`--space-inline-md` / `--radius-xs`；选中 `--color-state-selected` + `--color-text-body` | —/L2 | 高缺口 |
| 列表 | `.p-list` | `--space-inline-lg` / `--space-stack-md` | L2 | 已接；max-height 复写 760，耦合 |
| 底注 | `.p-ft` | 高 48 无令牌；`--font-size-caption` / `--color-text-tertiary` | —/L2 | 高缺口 |
| 空态 | `.p-empty` | 上内距 40 无令牌；`--space-section` / `--font-size-body` / `--color-text-tertiary` | —/L2 | 40 缺口 |
| 进行中 | `.pending` / `.genbar` | caption / tertiary / `--surface-sunken-2` / `--radius-pill` / `--color-brand`；450ms 无令牌 | L2 | 450ms 缺口 |
| 失败 | `.err-strip` / `.btn-undo` | `--color-danger` / `--font-size-caption`；undo 高 30 无令牌 | L2 | 部分缺口 |

**Do / Don't**
- Do：面板里一行只放一个主动作——候选行右侧只留「装配」；卸载只在已装行，且走确认。
- Do：搜索 / 页签 / 筛选固定为「头（含搜索）→ 页签 → 筛选行」三层；筛选行 `[hidden]` 时不占位。
- Don't：不要为筛选加第三个页签；筛选是行内说明（`.p-filter`），页签只有可装 / 已装。
- Don't：不要在面板里再写一份按钮样式；次要动作用 `.btn-text`，页签内按钮用 `.btn-ghost-s`。

**怎么判**
- 机器：`node tools/check-dialog-focus.mjs` ⇒ rc=0（2026-10-29 实测 41 项：焦点进入 / 圈禁 / Esc / 回焦 / inert 清理）。
- 机器：`grep -c 'aria-controls' app.html` 应=2，现=0 ⇒ 红；`grep -c 'ArrowRight' assets/app.js` 应≥1，现=0 ⇒ 红（APG Tabs 方向键；出处 https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ §Keyboard Interaction）。
- 人判：设计规范官 1 次键盘走查（搜索→关闭→页签→行→装配→回搜索）；体验官 1 次无 hover（触屏）走查。判的人＝设计规范官 + 体验官。

## 17 画布块 CanvasBlock（`.cv-blk`）

> P0。族边界：根 `.cv-blk`；**12 类** = `.cv-blk` `.cv-blk--head` `.cv-blk-bar` `.cv-blk-hd` `.cv-blk-tag` `.cv-blk-own` `.cv-blk-ops` `.cv-op` `.cv-op--off` `.cv-blk-edit` `.cv-blk-shared` `.cv-blk-more`。
> 排除：`.cv-empty` / `.cv-say*` 归 §12 Empty，不并入本族（防止重复计）。

**anatomy**
```
.cv-blk[data-comp][data-t][data-open?][data-hov?]
├─ i.cv-blk-bar                 左侧 2px 类型色竖条（真元素，非伪元素）
├─ .cv-blk-hd
│  ├─ span.cv-blk-tag > b       序号（01…）+「·」+ 组件名
│  ├─ .cv-blk-own               本应用单独改过（可选，warning 色）
│  ├─ .cv-blk-ops[role=group]   hover / 焦点 / data-open 才出
│  │  ├─ .cv-op[data-move=up|down]   首个上移、末个下移置 disabled
│  │  └─ .cv-op.cv-op--off[data-remove]  卸下（danger 色）
│  ├─ .cv-op.cv-blk-edit        常驻主操作「改这一块」
│  ├─ a.cv-op.cv-blk-shared     常驻「改共用件 · 影响 N 家」
│  └─ button.cv-blk-more[aria-expanded]  ⋯ 常驻，24×24，钉住操作带
└─ .blk                         块内容卡壳（§22 GenShell）
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `data-comp` | 组件 id | 块与数据的唯一绑定；动作按钮靠它定位 |
| `data-t` | `page｜cap｜data｜cfg｜slate` | 类型色枚举，只改 `--tc`，不新增第六值 |
| `open` | boolean（`data-open`） | 唯一公开布尔；`data-hov` 是 JS 的 hover 镜像，**不是 API**，作者不许写 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | `.cv-blk:hover` | 操作带 `visibility:visible;opacity:1`；`.cv-op:hover` 底 `--color-brand-surface` + 字 `--color-brand-ink`；`.cv-op--off:hover` 底 `--color-danger-surface` + 字 `--color-danger`；`.cv-blk-more:hover` 底 `--surface-sunken-2` | 不位移、不改基准（避 `transform`） | 有规则 |
| focus-visible | `.cv-blk:focus-within` / `.cv-blk-more` | 带出现；⋯ 换底；`.cv-op` / `.cv-blk-edit` / `.cv-blk-shared` 无规则（UA 默认） | Tab 可到 ⋯；操作带由 ⋯ 打开 | 部分有规则（3 处缺口） |
| active | 按下 cv-op | 无 `:active` | 原生按下 | 不适用（瞬时） |
| disabled | 首个上移 / 末个下移 | `.cv-op[disabled]`：`background:none` + `--color-text-tertiary` + `not-allowed`；hover 仍不变 | 不可点；**不隐藏**（隐藏会让整组宽度跳） | 有规则 |
| selected | — | 块不可选；`data-open` 是「展开」不是「选中」 | — | 不适用 |
| read-only | 客户视图 | `body[data-mode=view]` 隐藏 more / ops / edit / shared；块内容保留 | 只隐藏不重写渲染 | 有规则 |
| error | — | — | — | 不适用 |
| warning | 本应用改过 | `.cv-blk-own`：`--color-warning-surface` + `--color-warning` | 只提示，不可点 | 有规则 |
| loading | — | 块内容自管（如 §15 pending）；块壳无 loading | — | 不适用 |
| empty | 画布无块 | `.cv-empty`（§12） | — | 不适用（归 Empty） |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 竖条 | `.cv-blk-bar` | 宽 2px 无令牌（结构线，登记例外）；色 `var(--tc)` ← `--color-type-*` | —/L2 | 2px 不在 8 网格 |
| 类型色 | `[data-t]` ×5 | `--color-type-page` / `-cap` / `-data` / `-cfg` / `-slate` | L2 | 已接 |
| 块头 | `.cv-blk-hd` | 高 24 无令牌；`--space-inline-lg`；`--head` 用 `--space-section` | —/L2 | 高缺口 |
| 序号/名 | `.cv-blk-tag` | `--font-size-caption` / `--color-text-tertiary`；b 600 + `--color-text-secondary`；gap `--space-inline-xs` | L2 | 已接 |
| 单独改过 | `.cv-blk-own` | `--color-warning-surface` / `--color-warning` / `--font-size-caption` / `--radius-xs`；padding 6、margin 6、line-height 18 无令牌 | L2 | 3 处缺口 |
| 操作带 | `.cv-blk-ops` | gap `--space-inline-xs`；过渡 160ms → `--duration-fast`(150) | L2 | 值差 10ms |
| 操作件 | `.cv-op` | 高 24 无令牌；`--space-inline-sm` / `--radius-sm` / `--surface-sunken-2` / `--color-text-secondary` / `--font-size-caption` | —/L2 | 高缺口 |
| 主操作 | `.cv-blk-edit` | `flex:0 0 auto`（无视觉令牌） | — | 已接 |
| 更多 | `.cv-blk-more` | 24×24 无令牌；`--radius-sm` / `--color-text-tertiary`；hover/focus/open `--surface-sunken-2` + `--color-text-body` | —/L2 | 尺寸缺口（24 恰为 2.5.8 下限） |
| 块距 | `.cv-blk` | `--space-stack-md` | L2 | 已接 |

**Do / Don't**
- Do：块头一行只放一个常驻主操作（「改这一块」）；上移 / 下移 / 卸下进 hover 带或 ⋯。
- Do：显示条件必须三条并列（`:hover`、`:focus-within`、`[data-open="1"]`）；少一条就有用户到不了。
- Don't：不要用 `::before` 画左侧竖条；用 `.cv-blk-bar`（真元素，可量、可截图核对）。
- Don't：不要在客户视图另写一套块渲染；只隐藏管理控件（同一份 DOM）。

**怎么判**
- 机器：`grep -c 'aria-expanded' assets/app.js` ≥7（⋯ 的开合状态）；`grep -c 'cv-blk-more' assets/app.js` ≥1（常驻入口存在）。
- 机器：DOM 断言「每个 `.cv-blk` 恰有 1 个 `.cv-blk-bar` + 1 个 `.cv-blk-hd` + 1 个 `.cv-blk-more`」；现无工具 ⇒ 未量（rc=3，到期 2026-11-05）。
- 人判：设计规范官量 `.cv-blk-more` 24×24、`.cv-op` 24 高（WCAG 2.5.8）；体验官做触屏走查（无 hover 时 ⋯ 能否发现）。判的人＝设计规范官 + 体验官。

## 18 顶栏 Topbar（`.hdr`）

> P0。族边界：**骨架 8 类** = `.hdr` `.crumb` `.sep` `.me` `.topbar` `.float-hd` `.back` `.app-name`；**内容部件 2 类** = `.app-edit` `.count-badge`；合计 10 个类名。
> ★2026-11-03 退役 `.hd-sub` / `.app-meta`（用户 m00984：「左上角…就显示当前应用名称、版本号就行了」）：顶栏不再印「客户 · 发布态」。客户在客户授权页、发布态在应用卡与客户授权页，各自都有动作；顶栏里它们读得到却做不了。类名保留在 `tools/component-first.registry.json` 的 parts 里只为兼容旧页面，**新代码不许再用**。
> 两份实现定为一个族的两个 `kind`：`kind=page`（`.hdr`，列表页）｜`kind=canvas`（`.topbar > .float-hd`，应用配置页）。`component.html` 的 `#topbar` 是页面私有第三份，**记 merge，不另计族**（见 §14 缺口）。

**anatomy**
```
kind=page：.hdr（高 56，无底无边）
├─ nav.crumb
│  ├─ b｜a（非首页的前级可为链接；末级一律 b）
│  └─ span.sep（14×14 箭头）
└─ .me（右对齐）
   ├─ span（用户名）
   └─ u（头像 24 圆；语义待改，见 Don't）

kind=canvas：.topbar（fixed 16/16，pointer-events:none）
└─ .float-hd（min-height 48，单行 flex，veil 底 + 描边 + flat 影）
   ├─ a.back（32×32）
   ├─ h1.app-name
   ├─ .app-edit[data-dirty|data-err]（版本号；仅未保存/失败时追加文字）
   ├─ .count-badge（动作按钮内计数）
   └─ .tb-ops（按钮组，按钮归 §1）
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `kind` | `page｜canvas` | 决定骨架；一页只许一种，不许并存 |
| `ver` | `v0｜vN` | 落在 `.app-edit`；取**最新存档版**（不是"客户在用哪版"——那是一家客户一个答案） |
| `save` | `saved｜dirty｜error` | 落在 `.app-edit`；`dirty` 走 `[data-dirty="1"]`（琥珀），`error` 走 `[data-err="1"]`（红），不新增颜色。`dirty` 是**每次写盘重算**的派生量（`DB.onSave → paintSaveState()`），内容改回与存档一致即自动回到 `saved`，不是粘性标记 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | 面包屑链接 / .back | 链接字色→`--color-brand`；`.back:hover` 字色→`--color-text-body`（底色与默认同为 `--surface-subtle`，**无变化**） | 不改布局 | 有规则（back 底色为无效声明） |
| focus-visible | 键盘到链接 / back | 无规则（UA 默认环） | 原生 | 缺口 |
| active | — | 无 | — | 不适用 |
| disabled | — | 无禁用件 | — | 不适用 |
| selected | 当前页 | 末级 `b`：`--color-text-primary` / 400；前级 `--color-text-secondary` | 末级不可点 | 有规则 |
| read-only | 客户视图 | 隐藏 back / tb-ops / app-edit | — | 有规则 |
| dirty | 内容偏离最新存档版 | `.app-edit[data-dirty="1"]`：`--color-warning` + 600，文案「vN · 未保存」 | 不可点；下一步是右上「存成新版本」；**改回原样 → 下一次写盘自动消失** | 有规则 + 判据（TOPBARLEAN A5） |
| error | 保存失败 | `.app-edit[data-err="1"]`：`--color-danger` + 600，文案「保存失败」 | 文案由 JS 写；title 说明原因 | 有规则 |
| warning | — | — | — | 不适用 |
| loading | 保存中 | **无规则**；只有文案变化 | — | 缺口 |
| empty | 一版都没存过 | `.app-edit` 印 `v0`（数据层草稿 version=0，不另造词） | — | 有规则 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 栏高 | `.hdr` | 高 56 无令牌（7×8） | — | 缺口 |
| 面包屑 | `.crumb` | `--space-inline-sm` / `--font-size-body`；a `--color-text-secondary`；hover `--color-brand`；b `--color-text-primary` | L2 | 已接 |
| 分隔 | `.sep` | 14×14 无令牌 | — | 缺口 |
| 当前用户 | `.me` | `--space-inline-sm` / `--font-size-body` / `--color-text-secondary` | L2 | 已接 |
| 头像 | `.me u` | 24×24 无令牌；`--radius-pill` / `--color-border-card` / `--font-size-caption` | —/L2 | 尺寸缺口（24 恰为下限） |
| 浮条定位 | `.topbar` | `--space-inline-lg` ×3；z 20 无令牌 | L2/— | z 缺口 |
| 浮条面 | `.float-hd` | `--radius-panel` / `--surface-veil` / `--color-border-card` / `--shadow-flat`；min-height 48 无令牌；padding 6/16/6/4（6 无令牌） | L2/— | 两处缺口 |
| 返回 | `.back` | `--size-control-h`(32) / `--radius-control` / `--surface-subtle` / `--color-text-secondary`；hover `--color-text-body` | L2 | 已接 |
| 应用名 | `.app-name` | `--font-size-body` / 600 / `--color-text-body`；max-width 340 无令牌 | L2/— | 宽缺口 |
| 版本号 | `.app-edit` | `--font-size-caption` / `--color-text-tertiary` / `font-variant-numeric:tabular-nums`；dirty `--color-warning` / 600；err `--color-danger` / 600 | L2 | 已接 |
| 计数徽 | `.count-badge` | 18×18 / line-height 18 无令牌；`--radius-pill` / `--surface-sunken-2` / `--font-size-caption` | —/L2 | 尺寸缺口 |

**Do / Don't**
- Do：面包屑只写到当前页，最后一项用非链接 `b`；层级只说一次，不再加一行「返回」。
- Do：页面顶栏只放「位置 + 身份」；对象动作放对象页的 canvas 顶栏（`.tb-ops`）。
- Don't：不要在同一页同时出现 `.hdr` 与 `.topbar`；一页一种顶栏。
- Don't：不要用 `<u>` 承载头像语义；`u` 是下划线元素，读屏会读成强调（迁移项，不改结构前先登记）。

**怎么判**
- 机器：`grep -c '<header class="hdr">' apps.html components.html versions.html` ⇒ 各 1；`grep -c 'class="topbar"' app.html` ⇒ 1。
- 机器：`grep -c '<nav class="crumb"' apps.html components.html versions.html` ⇒ 各 1；末级用 `b`（非链接），当前级不强制 `aria-current`。
- 人判：体验官 320px 走查（面包屑换行/截断）；设计规范官核「一页一种顶栏」。判的人＝设计规范官 + 体验官。

## 19 批量指派 BatchAssign（`.tb-batch`）

> P0。族边界：根 `.tb-batch`；**7 类** = `.tb-batch` `.tb-batch-btn` `.tb-batch-cancel` `.tb-pick` `.tb-pick-list` `.tb-pick-row` `.tb-pick-ok`。
> `.tb-ck`（复选框列）归 §5 Table 的 `kind=select`，**不两边都算**；`.tb` 行体归 Table。

**anatomy**
```
.tb-batch[hidden?]                0 选时留 DOM 只加 hidden
├─ b#tb-batch-n                  「已选 N 条」
├─ button.tb-batch-btn#tb-assign[aria-expanded]
├─ button.tb-batch-btn.tb-batch-cancel
└─ .tb-pick（展开时）
   ├─ .tb-pick-list[role=group][aria-label=选择处理人]
   │  └─ label.tb-pick-row > input[type=radio][name=tb-assignee] + span
   └─ button.tb-pick-ok[disabled]  「确定」
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `selected` | 数量（派生） | 0 时整条 `hidden`；不单独存布尔 |
| `expanded` | boolean（`aria-expanded`） | 唯一布尔；展开＝选人区出现 |
| `assignee` | 人名（radio 值） | 无默认值；未选时「确定」disabled |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | 按钮 / 取消 | 指派钮底→`--color-brand-surface-2`；取消底→`--color-state-selected` | 不改布局 | 有规则 |
| focus-visible | 复选框 / 单选 | 2px `--color-focus-ring`，offset 2 | 原生 Space 勾选 | 有规则（按钮无，缺口） |
| active | — | 无 | — | 不适用 |
| disabled | 未选处理人 | `.tb-pick-ok[disabled]`：`--surface-subtle` + `--color-text-tertiary` + `not-allowed` | 选中一人后 JS 解禁 | 有规则 |
| selected | 行勾选 | 复选框 checked；**行底不变** | 表头三态（全选/半选/未选） | 缺口（行选中无视觉） |
| read-only | 客户视图 | `body[data-mode=view]` 隐藏 `.tb-ck` 与 `.tb-batch` | — | 有规则 |
| error | — | 无（同步写入） | — | 不适用 |
| warning | — | — | — | 不适用 |
| loading | — | 无（450ms 是行装配，不是批量） | — | 不适用 |
| empty | 0 选 | 整条 `hidden`（不是空文案） | 勾第一行即出现，不重画整块 | 有规则 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 条带 | `.tb-batch` | `--space-inline-sm` ×2；`flex-wrap` | L2 | 已接 |
| 计数 | `.tb-batch > b` | `--font-size-caption` / 600 / `--color-text-secondary` | L2 | 已接 |
| 动作钮 | `.tb-batch-btn` | 高 24 无令牌；`--space-inline-sm` / `--radius-sm` / `--color-brand-surface` / `--color-brand-ink` / `--font-size-caption`；hover `--color-brand-surface-2` | —/L2 | 高缺口（24 为下限） |
| 取消 | `.tb-batch-cancel` | `--surface-sunken-2` / `--color-text-secondary`；hover `--color-state-selected` | L2 | 已接 |
| 选人区 | `.tb-pick` | `--space-inline-sm` / `--space-inline-md` / `--space-inline-lg` / `--radius-sm` / `--surface-sunken-2` | L2 | 已接 |
| 选人列 | `.tb-pick-list` | `--space-inline-lg` | L2 | 已接 |
| 选人项 | `.tb-pick-row` | `--space-inline-xs` / `--font-size-caption` / `--color-text-body` | L2 | 已接 |
| 确定 | `.tb-pick-ok` | 高 24 无令牌；`--space-inline-md` / `--radius-sm` / `--color-brand-surface` / `--color-brand-ink`；disabled `--surface-subtle` + `--color-text-tertiary` | —/L2 | 高缺口 |
| 复选框 | `.tb-ck input` / `.tb-pick-row input` | 16×16 无令牌；`accent-color:--color-brand`；焦点环 2px + offset 2 | —/L2 | 尺寸缺口 |

**Do / Don't**
- Do：0 选时整条只加 `hidden`、留 DOM；勾第一行不替换 DOM，焦点不掉。
- Do：先选人、后启用「确定」；未选人时按钮 disabled，不弹错误提示。
- Don't：不要把批量指派做成第三个页签或独立页；它是表格上方的一条带。
- Don't：不要给勾选行另加背景色；行选中态在 §5 尚未定义，先加会与 `.cond` 胶囊底色打架。

**怎么判**
- 机器：`grep -c 'indeterminate' assets/app.js` =1（表头三态）；`grep -c 'class="tb-batch"' assets/app.js` =1。
- 机器：`grep -c 'tb-pick-ok:disabled' assets/sys.css` =1（禁用样式在盘）。
- 人判：设计规范官量 16×16 复选框是否满足 WCAG 2.5.8「Spacing 例外」（行高 52、列宽 40，24 圆不相交）；体验官走键盘勾选与「确定」解禁。判的人＝设计规范官 + 体验官。

## 20 侧栏 Sidebar（`.sider`）

> P0。族边界：根 `.sider`；**1 + 6 后代** = `.sider` `.grp` `.gt` `.gi` `.gn` `.gv` `.gs`。`.logo` / `.menu` 是骨架排版（布局，不计组件类）。

**anatomy**
```
.sider[data-active]
├─ .logo（品牌位，56；i 22×22）
└─ .menu
   └─ .grp[data-open]
      ├─ button.gt[aria-expanded]
      │  ├─ .gi 图标 18
      │  ├─ .gn 名称（1 行省略）
      │  └─ .gv 箭头 12（展开转 180）
      └─ .gs（max-height 0 → 320）
         └─ a[aria-current=page]
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `active` | 页面 key | 落 `data-active`，决定哪一组默认展开 |
| `open` | boolean（`.grp[data-open]` + `.gt[aria-expanded]`） | 唯一布尔；两处必须同步 |
| `current` | 派生（只读，调用方不可传） | 由路由决定 `aria-current="page"`；只允许一个当前项 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | 一级 / 二级项 | 一级字→`--color-text-primary`，图标→`--color-text-secondary`；二级底 `--color-state-hover` + 字 primary | 不改布局 | 有规则 |
| focus-visible | 一级 | 2px `--color-focus-ring`，inset -2；二级**无规则**（UA 默认） | 原生 | 部分有规则 |
| active | 按下 | 无 | — | 不适用 |
| disabled | — | 无禁用项（2026-10-28 起所有子项都有真页面） | — | 不适用 |
| selected | 当前页 | `a[aria-current=page]`：底 `--surface-page` + 字 `--color-brand-nav-active` + 600 | 点击跳转 | 有规则；**对比度 3.77:1，AA 红**（见下） |
| read-only | — | — | — | 不适用 |
| error / warning | — | — | — | 不适用 |
| loading | — | — | — | 不适用（导航静态） |
| empty | — | — | — | 不适用（NAV 固定） |
| expanded | 组展开 | `.grp[data-open=true]`：gt/gi/gv 全 `--color-brand-nav-active`；`.gs` max-height 320（200ms） | 点 gt 切换；aria-expanded 同步 | 有规则 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 栏体 | `.sider` | `--size-sider`(200) / `--surface-sider`；滚动条 6px 无令牌 | L2/— | 6px 缺口 |
| 品牌位 | `.logo` | 高 56 无令牌；`--space-inline-lg` / `--space-inline-sm` / `--font-size-body` / 600 / `--color-text-primary` | —/L2 | 高缺口 |
| 品牌块 | `.logo i` | 22×22 无令牌；`--radius-sm` / `--color-brand` / `--color-text-inverse` / `--font-size-caption` | —/L2 | 22 缺口 |
| 菜单内距 | `.menu` | `--space-4` / `--space-8` / `--space-12` | L2 | 已接 |
| 一级项 | `.gt` | 高 48 无令牌；padding 10/22 无令牌；gap 8；`--font-size-body` / `--color-text-nav` | —/L2 | 高与缩进缺口（对齐驱动） |
| 图标/箭头 | `.gi` / `.gv` | 18 / 12 无令牌；过渡 150ms → `--duration-fast` | —/L2 | 尺寸缺口 |
| 展开色 | `[data-open=true]` | `--color-brand-nav-active` | L2 | 已接；**3.77:1 红** |
| 二级区 | `.gs` | max-height 320 无令牌；`--space-inline-sm`；200ms → `--duration-base` | —/L2 | 高缺口 |
| 二级项 | `.gs a` | 高 48 无令牌；padding 10/54 无令牌；`--font-size-body` / `--color-text-nav`；hover `--color-state-hover` + `--color-text-primary` | —/L2 | 高与缩进缺口 |
| 当前项 | `[aria-current=page]` | `--surface-page` / `--color-brand-nav-active` / 600 | L2 | 对比度红（见判法） |

**Do / Don't**
- Do：当前项用 `aria-current="page"` + 白底通栏蓝字；这是与线上一致的那一套，不加左色条/圆点。
- Do：展开态 `data-open` 与 `aria-expanded` 必须同一次点击同步；收起用 `max-height` 过渡，不用 `display:none`。
- Don't：不要给没有落地页的子项留占位（`.stub` 已删，不留后路）。
- Don't：不要做第三级；侧栏只有「组 → 项」两层。

**怎么判**
- 机器：`grep -c 'aria-expanded' assets/shell.js` ≥2；`grep -c 'aria-current' assets/shell.js` =1；`grep -c 'display:none' assets/sys.css` 的侧栏段应为 0（收起靠 max-height）。
- 机器（对比度）：现盘 `--color-brand-nav-active` #517AFF 压 `--surface-page` #FFFFFF = **3.77:1**（sRGB 相对亮度，脚本见交付件件首）；14px/600 不属大字 ⇒ WCAG 1.4.3 AA 红。展开组标题压 `--surface-sider` #F3F4F7 同族，未量，到期 2026-11-05。
- 人判：键盘 Tab 顺序「组 → 项」、展开后焦点不丢；判的人＝设计规范官。

## 21 内容对照 ContentCompare（`.cmp`）

> P1。族边界：根 `.cmp`；**8 类** = `.cmp` `.cmp-side` `.lbl` `.orig` `.fx-wrap` `.fx` `.rule-row` `.rule-nm`。`.off-note` 是一次性说明（登记为页面私有，不入族）。

**anatomy**
```
.cmp（2 列网格）
├─ .cmp-side（左：原文）
│  ├─ span.lbl        「原文」
│  └─ p.orig ×N       法条式短句；可含 mark（命中片段）
└─ .cmp-side（右：抽取结果）
   ├─ span.lbl        「抽取结果」
   └─ .fx-wrap > span.fx ×N
.rule-row（逐条结论；同族另一种行）
├─ .rule-nm
└─ .cond             §6 Chip（借）
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `sides` | 固定 2 | 左原文 / 右结果；不提供 3 列 |
| `mark` | 片段（可选） | 原文命中用 `<mark>`；无第二套高亮 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | — | 无 | 内容不可点 | 不适用（只读对照） |
| focus-visible | — | 无 | 无可聚焦件 | 不适用 |
| active | — | 无 | — | 不适用 |
| disabled | — | 无 | — | 不适用 |
| selected | 命中片段 | `mark`：底 `--color-focus-halo` + 字 `--color-text-body` | 无 | 有规则（唯一「选中」语义） |
| read-only | 恒为只读 | 整族无编辑控件 | — | 设计即只读 |
| error / warning | — | 结论状态由 `.cond` 承担 | — | 不适用 |
| loading | — | 无（数据同步渲染） | — | 不适用 |
| empty | 0 段原文 / 0 个结果 | **无规则**（`.fx-wrap` 空、块只剩标签） | — | 缺口 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 两列 | `.cmp` | gap 14 无令牌（出档） | — | 缺口：候选 `--space-inline-md`(12) 或 `--space-stack-lg`(16)，值变 |
| 侧栏 | `.cmp-side` | `min-width:0`（无视觉） | — | — |
| 标签 | `.lbl` | `--font-size-caption` / `--color-text-tertiary` / `--space-inline-sm` | L2 | 已接 |
| 原文 | `.orig` | `--font-size-caption` / `--color-text-secondary`；line-height 1.75 无令牌；margin-bottom 10 无令牌 | L2/— | 两处缺口 |
| 命中 | `mark` | `--color-focus-halo` / `--color-text-body` / `--radius-xs`；padding 2 无令牌 | L2/— | padding 缺口 |
| 结果列 | `.fx-wrap` | `--space-inline-sm` | L2 | 已接 |
| 结果片 | `.fx` | padding 2/8；`--radius-sm` / `--surface-sunken-2` / `--font-size-caption` / `--color-text-secondary` | L2 | 与 §6 Chip 同形两实现（C1） |
| 结论行 | `.rule-row` | `--space-inline-sm` / `--color-border-hairline` | L2 | 已接 |
| 结论名 | `.rule-nm` | `--font-size-caption` / `--color-text-secondary` | L2 | 已接 |

**Do / Don't**
- Do：左侧只放原文原句（可含 `mark`），右侧只放抽取结果 token；两侧行数不必对齐。
- Do：逐条结论的状态一律用 `.cond`；不在 `.rule-row` 里自造颜色或第二套胶囊。
- Don't：不要用骨架条 `.sk` 假装原文（2026-10-23 已改法条式短句）。
- Don't：不要把 `.fx` 做成可点 chip；它是结果标记，不是动作。

**怎么判**
- 机器：`grep -c 'class="cmp"' assets/app.js` =1（唯一实现）；`grep -c 'class="fx"' assets/app.js` ≥1；`grep -c 'var(--color-focus-halo)' assets/sys.css` =1。
- 机器（对比度，已算）：secondary .65 压白 6.98；tertiary .58 压白 5.32；fx secondary 压 `--surface-sunken-2` 6.66 ⇒ 均 ≥4.5。
- 人判：体验官判「原文与结果能否一眼对上」；设计规范官判 `.fx` 是否并入 §6（C1 债）。判的人＝体验官 + 设计规范官。

## 22 生成块 GenShell（`.blk`）

> P1。族边界：根 `.blk`；**6 个落点** = `.blk` `.blk-hd` `.blk-hd>b` `.blk-hd>span` `.blk-bd` `.blk-bd--gen`。
> 进度 / 失败条借 §16（`.pending` / `.genbar` / `.err-strip` / `.btn-undo`），单份实现，不另立。

**anatomy**
```
.blk（白卡：圆角 + 阴影；无边框）
├─ .blk-hd
│  ├─ b        块标题（组件名或 spec.title）
│  └─ span     右侧注（可选，一句话口径）
└─ .blk-bd
   └─ .blk-bd--gen 变体：内层 .bd-group 去壳，只留排版
```

**props**
| prop | 取值 | 说明 |
|---|---|---|
| `variant` | `plain｜gen` | `gen` 去内层卡壳；不新增第三值 |
| `note` | 文本（可选） | 落在 `.blk-hd>span`；无则不占位 |

**状态**
| 态 | 触发 | 视觉 | 交互 | 判 |
|---|---|---|---|---|
| hover | — | 容器无 hover | — | 不适用（块壳不是控件） |
| focus-visible | — | 无自身可聚焦件 | — | 不适用 |
| active / disabled | — | 无 | — | 不适用 |
| selected | — | 无 | — | 不适用 |
| read-only | 客户视图 | 块保留；管理控件在 §17 隐藏 | — | 设计即只读 |
| error | 生成/装配失败 | `.err-strip`（danger，`role=alert`）+ `.btn-undo` | 撤销回到失败前 | 有规则（借 §16） |
| warning | — | — | — | 不适用 |
| loading | 生成中 | `.pending`「更新中…」+ `.genbar` 450ms 确定进度 | 不锁画布 | 有规则（借 §16） |
| empty | `.blk-bd` 无 section | **无规则**（白卡空腔） | — | 缺口 |

**令牌**
| 属性 | 选择器 | 令牌 | 层 | 现状 |
|---|---|---|---|---|
| 卡壳 | `.blk` | `--radius-panel` / `--surface-page` / `--shadow-card` / `--space-stack-md` | L2 | 已接 |
| 块头 | `.blk-hd` | padding 10/14 无令牌（出档）；`--surface-subtle` / `--color-border-hairline` / `--space-inline-sm` | —/L2 | 两处缺口 |
| 标题 | `.blk-hd b` | `--font-size-body` / 600 / `--color-text-body` | L2 | 已接 |
| 右注 | `.blk-hd span` | `--font-size-caption` / `--color-text-tertiary` | L2 | 已接 |
| 块体 | `.blk-bd` | `--space-inline-md` / 14 无令牌 | L2/— | 14 缺口 |
| 去壳 | `.blk-bd--gen` | `border:0` / `border-radius:0` / `background:transparent` | — | 已接（非令牌） |
| 生成段 | `.blk-bd--gen .bd-sec` | `--font-size-caption` / 600 / `--color-text-tertiary` / `--space-inline-sm` | L2 | 已接 |
| 段距 | `.bd-group + .bd-group` | 14 无令牌 | — | 缺口（外层无内距后放大） |

**Do / Don't**
- Do：一块只承担一个组件的生成结果；标题归 `.blk-hd`，生成内容里不再画页面标题。
- Do：内层已带白底/边框的生成卡，用 `.blk-bd--gen` 去壳，不叠两张白卡。
- Don't：不要在 `.cv-blk` 之外再包一层 `.blk`（画布块已有边界）。
- Don't：不要在页面里重写进度/失败条；用 §16 的 `.pending` / `.err-strip` 单份实现。

**怎么判**
- 机器：`grep -c 'blk-bd--gen' assets/app.js` =1；`grep -c 'class="blk"' assets/app.js` ≥5（五种块形态共用同一卡壳）。
- 机器：`grep -c 'class="err-strip"' assets/app.js` =1（失败条单份）。
- 人判：体验官看「生成中 → 完成 → 失败」三态切换的焦点与读屏播报；设计规范官核无「白卡套白卡」。判的人＝体验官 + 设计规范官。

## 23 视图切换 ViewMode（`.seg-view` / `.code-pane`）

> 2026-10-30 新建。用户要求（转述）：「右上角再加个操作，看下这个设计，需要切换，默认都是预览模式」＋「做文件树视角，把四个页面接成工程结构」。

**落点**：组件 `assets/viewmode.js` + `assets/viewmode.css`；由脚本注入到两页顶栏 `.tb-ops` 最左，页面不写死结构。代码视图覆盖画布区（top 取顶栏底边），不遮顶栏与底部对话区。

**结构**

```
.seg-view[role=group]
  ├ button[data-v=preview][aria-pressed]  预览（默认）
  └ button[data-v=code][aria-pressed]     代码
.code-pane
  ├ aside.code-tree
  │   ├ 运行时 → 画布（运行时组装）
  │   ├ 页面   → components / component / apps / app / versions
  │   └ assets → 按当前页 script[src]/link[rel=stylesheet] 现收集
  └ .code-main
      ├ .code-pane-hd（路径 · N 行 + 复制）
      └ pre > ol.lines（行号由 CSS counter 生成）
```

**状态**

| 态 | 触发 | 视觉 | 判据 |
|---|---|---|---|
| 默认 | 每次进页 | 预览项白底加粗 | `aria-pressed=true` 落在「预览」 |
| 悬停 | 鼠标 | 文字加深 | 不改选中态 |
| 焦点 | Tab | `--color-focus-ring` 环，offset 1 | 焦点不被顶栏遮挡 |
| 选中（文件项） | 点击文件 | `.on`：白底 + 品牌墨色 + 600 | 同一时刻只有一项 `.on` |
| 读取失败 | file:// 或 404 | 单元格内写明原因与出路 | 不假装读到 |

**令牌**：`--seg-h`（28）／`--seg-item-h`（24）／`--code-tree-w`（210），其余全部取语义层（间距档、字色、边框、焦点环、`--font-family-mono`）。

**做 / 不做**

- 做：真实文件读取（`fetch` + `cache:no-store`）、HTML 断行缩进、行号、复制、画布运行时条目单独一条。
- 不做：代码编辑（只读）、语法高亮（未接高亮库）、`file://` 下的源码读取（浏览器安全策略，界面明示）。

## 24 组件契约模板（生成前必填 · 2026-10-30）

每个组件小节都必须按这七格写；缺一格视为契约不成立，不许进代码。

| 格 | 要写什么 |
|---|---|
| 1 用户任务 | 谁、在什么场景、要完成哪个判断 |
| 2 结构 | 根节点 + 层级 + 每个子块职责 |
| 3 槽位 | 可变内容放哪；空槽长什么样 |
| 4 状态 | 十态逐条：默认/悬停/按下/聚焦/禁用/加载/空/错/选中/只读；缺的写原因 |
| 5 锚定与方向 | 贴着谁、往哪长；滚动与遮挡边界 |
| 6 可供性 | 一个动作只一个控件；入口与反馈各自在哪 |
| 7 运行边界 | `file://` vs `http`、无登录、离线、慢网下的行为与提示 |

## 25 对话浮条 FloatDock（`.fk-dock` / `.fk-hist` / `.fk-bar`）

| 格 | 内容 |
|---|---|
| 1 用户任务 | 配置人员说一句改一块；收起时也要能判断"上一句做完了没有" |
| 2 结构 | `.fk-dock` = `.fk-hist`（列表 + 长条）+ `.fk-bar`（抓手 + 输入 + 发送），整块贴底居中，宽 min(820, 100vw-144) |
| 3 槽位 | 列表：消息流（我 / 小智 / 改动卡）；长条：标签 + 状态 + 末条摘要 + 未读点；输入：单行自适应 |
| 4 状态 | 收起/展开、悬停、焦点环、空历史、未读、进行中/待确认/失败；禁用态不存在（输入恒可用） |
| 5 锚定与方向 | 贴视口底 24；**列表在长条上方，展开向上**；展开时画布补 248 下边距，不压表格末行 |
| 6 可供性 | 开合**只有一个控件**（右端「展开 ⌃ / 收起 ⌄」）；摘要区可点但不再画第二个箭头；发送=输入框右侧一颗 |
| 7 运行边界 | 历史存 localStorage（每 key 上限 60 条）；本地文件模式下输入与历史照常，只有代码视图取源码受限 |

**§23 补充 · 锚定与边界**（2026-10-30）：代码面板贴顶栏下沿（`top = 顶栏 bottom`），左右到边；文件树固定 210，代码区自适应；`file://` 下 `fetch` 同目录被浏览器拒绝，单元格内如实提示，不假装读到。

## 26 未判组件族的七格契约（2026-10-30 全量补齐 · 11 族）

> 这 11 族此前只在 `judgedFamilies.notJudged` 里有名字、没有契约。本轮逐条对照现盘取证后补齐。
> **契约 ≠ 判**：写满契约不等于组件闸开始强制"单一实现"；每一行末列写清现盘核对结果。

### 26.1 组件卡 ComponentCard（`.crow.ccard`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 运营判断"这个零件能不能装、影响谁、去哪配" | — |
| 结构 | `.crow.ccard` = `.cc-body`（`.cc-hd` 名称 + `.cl-desc` 简介）+ `.cc-ft`（开关 / 引用数 / 配置 / ⋮） | sys.css:437,655 |
| 槽位 | 名称（链接，禁用时降为文本）、简介两行截断、引用数（0 时纯文本） | components.html:521-545 |
| 状态 | 悬停（投影加深）、菜单展开（`z-index:10`）、启用/禁用/未发布（`data-on` / `data-st`） | sys.css:667,835 |
| 锚定与方向 | 三列网格；菜单与引用浮层锚在 ⋮ 下沿，视口内翻上避让 | float.css/Popover |
| 可供性 | 名称→详情；开关→启停；引用数→引用名单；配置→配置页；⋮→四动作。**无整卡热区** | — |
| 运行边界 | 禁用卡的配置不可执行，点击给原因；菜单/浮层被裁切的坑已修（2026-10-29） | components.html:720 |

**核对**：成立。缺口：无键盘可达的名称外入口（Tab 可到名称链接，成立）。

### 26.2 版本行 VersionRow（已退役 · 无选择器）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 在一串版本里认出"当前线上是哪一版" | — |
| 结构 | 三列网格：版本号 / 摘要 / 时间；当前版加 `.is-now` | sys.css:568-575 |
| 状态 | 当前版（`.is-now` 品牌底 + 内描边）；无悬停/焦点 | sys.css:574 |
| 锚定与方向 | 列表内平铺，gap 6 | sys.css:567 |
| 可供性 | 纯展示，无点击 | — |
| 运行边界 | — | — |

**核对：不成立 —— 全仓无消费者。** `grep -rn "ver-row" assets/*.js versions.html` 均为 0；版本面板改子页面后这块样式成了死代码。**处置：登记退役候选，到期 2026-11-30；退役前不许在新页面引用。**

### 26.3 开关 Switch（`.cc-sw`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 一眼看到"这个零件现在开没开"，一键启停 | — |
| 结构 | `button[role=switch]` + 圆点 + 状态文字 | components.html:531 |
| 状态 | 悬停/按下（选中底）、开（成功底）、未发布（警示底）、禁用（`data-st=off`）、焦点环 | sys.css:743-751,806 |
| 锚定与方向 | 卡片运行带最左；文字常显，状态不靠底色单独表达 | — |
| 可供性 | 单击切换；`aria-checked` 同步 | components.html |
| 运行边界 | 禁用件不可配置，但开关本身可达（用来恢复启用） | — |

**核对**：成立。缺口：无加载态（切换是同步的，成立）。

### 26.4 弹窗 Dialog（`.nf-mask` / `.panel`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 新建/编辑/确认这类"必须一次做完"的动作 | — |
| 结构 | 遮罩 + 面板（头 / 体 / 底）；确认框为 `.nf-confirm` | sys.css:362,915-917 |
| 状态 | 打开/关闭（`[hidden]`）、焦点圈禁（JS）、Esc 关闭 | check-dialog-focus.mjs |
| 锚定与方向 | 视口居中，宽 `min(420px, 100vw-32px)` | sys.css:915 |
| 可供性 | 主/次按钮各一；右上关闭（危险确认框除外，按用户 2026-11-02 平台标准件无关闭钮）；点遮罩不关闭（防误触） | — |
| 运行边界 | 焦点必须留在面板内；关闭后焦点回到触发元素 | check-dialog-focus |

**核对**：成立（焦点由 `check-dialog-focus` 守）。缺口：无进出场过渡（登记，不影响可用）。

### 26.5 状态胶囊 Status（`.comp-status` / `.card-tag` / `.bd-st-*`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 一眼分清"未发布 / 启用 / 禁用"（组件）或发布态（应用） | — |
| 结构 | 单行胶囊：`.comp-status`（配置页顶栏）、`.card-tag`（应用卡）、`.bd-st-*`（表格） | component.html:55-60；sys.css:471 |
| 状态 | 静态三色（绿/灰/橙），无交互 | sys.css:59-60 |
| 锚定与方向 | 跟随标题或卡片右上 | — |
| 可供性 | 纯展示 | — |
| 运行边界 | 组件状态词必须走 `DB.compState`（未发布/启用/禁用），不许各页自造 | component.js:776 |

**核对：部分成立。** 同一语义有三份样式实现（`.comp-status` / `.card-tag` / `.bd-st-*`）——取值靠令牌一致，但"改一处另两处不动"的风险仍在。**登记债：合并为一份胶囊，到期 2026-11-30。**

### 26.6 空态 Empty（`.empty`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 页面空了要知道"为什么空、下一步点什么" | — |
| 结构 | 一句主文案 + 可选副文案 + 出口说明 | sys.css:254-256 |
| 槽位 | 主文案必填；副文案可选；不带假数据 | — |
| 状态 | 静态；无交互 | — |
| 可供性 | 文案里点名出口对应的控件（不写"清空搜索词"这种唯一猜测） | sys.css:256 注释 |

**核对**：成立。缺口：无加载态与空态区分（列表加载中显示空态会误导，登记）。

### 26.7 选择行 PickRow（`.tb-pick` / `.tb-pick-row`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 勾几条 → 批量做一件事 | — |
| 结构 | 首列复选框 + 行内容 + 批量动作条（`.tb-pick-ok`） | sys.css:1509-1526 |
| 状态 | 复选框焦点环、动作条禁用（未选时）、`aria-disabled` | sys.css:1510,1795 |
| 锚定与方向 | 动作条随表格顶部；行高与表格一致 | — |
| 可供性 | 勾选 → 动作条启用；一点即明确"选了几条" | — |
| 运行边界 | 全选只在当前页；跨页选未实现（登记） | — |

**核对**：成立（含禁用态）。缺口：跨页选择未实现，文案不得暗示。

### 26.8 确认正文 ContentFlow（`.cf-body`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 在确认框里读懂"这次会改什么" | — |
| 结构 | 段落 + `<b>` 强调；`[hidden]` 可隐藏 | sys.css:917-919 |
| 文案 | 标题固定「操作确认」；正文一句「对象 + 后果 + 是否确认…？」；按钮「取消 / 确定」（确定蓝色主按钮）；危险动作用标题前红色感叹号，不用红色按钮 | DESIGN.md §11.9；用户 2026-11-02 平台标准件截图 |
| 状态 | 静态 | — |
| 可供性 | 纯文本，不放可点控件 | — |
| 运行边界 | 不放 JSON / 错误原文 | — |

**核对**：成立。

### 26.9 图标按钮 IconButton（`.icbtn`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 高频小动作（关闭、更多） | — |
| 结构 | 单图标按钮，必须有 `aria-label` | sys.css:218-227 |
| 状态 | 悬停、焦点环、禁用（`aria-disabled` / `.is-disabled`） | sys.css:226,227,1792 |
| 目标尺寸 | ≥24×24（CSS 现值按此） | — |
| 可供性 | 一图一事，不做双重语义 | — |

**核对**：成立。

### 26.10 骨架屏 Skeleton（无实现）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 列表加载时告诉用户"在加载"而不是"没有" | — |
| 现状 | **全仓 0 处实现**（`grep skeleton/sk-` 无命中） | — |
| 契约 | 加载态须与空态在视觉与文案上可区分；实现前不许用空态冒充加载态 | — |

**核对：未实现。登记到期 2026-11-30**：要么补骨架屏，要么在 spec 里删掉这一族（不许留一个空名字）。

### 26.11 分页 Pager（`.pager`）

| 格 | 内容 | 现盘证据 |
|---|---|---|
| 用户任务 | 知道"一共多少、现在第几页、能翻到哪" | — |
| 结构 | 左侧总数文案 + 右侧页码钮 | sys.css:247-253 |
| 状态 | 当前页（`aria-current`）；**缺悬停与禁用**（首页/末页的上一页/下一页） | sys.css:253 |
| 锚定与方向 | 列表底部右对齐 | — |
| 可供性 | 页码可点；当前页不可再点 | — |

**核对：部分成立。** 缺 hover 与首末页禁用态，**登记到期 2026-11-30**。

### 26.12 处置记录（2026-10-30 当日收口）

| 族 | 处置 | 读数 |
|---|---|---|
| versionrow | `.ver-app/.ver-list/.ver-row*` 整段删除（全仓 0 消费者） | 组件闸 rc=0 |
| status | 三处合并为 `sys.css` 一条分组声明；`component.html` 与 `generated.css` 的第二份已删 | 组件闸 rc=0 |
| pager | 补 hover / focus-visible / 禁用三态；删掉重复的 background 声明 | stylequick rc=0 |
| skeleton | 从族表删除（无实现，不留空名字） | judged 15 族 |
| floatdock | 登记进组件表；`.fk-dock` 五个跨层规则收进 `float.css` | 组件闸 rc=0 |
