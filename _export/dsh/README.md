# 迁移到 DSH（DeepSeek Harness）

> 2026-11-02。把在 WorkBuddy 上跑出来的「判定 + 验证 + 省 token」三件事迁到 DSH。
> 本机环境：DSH `0.1.5-rc.2`，profile `web`，`patchReload: live`
> （在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile` 里，**不在** `cordis.yml`；`cordis.yml` 只有 `[]`）。

## 一、迁什么，不迁什么

| 原物 | 迁成 | 说明 |
|---|---|---|
| 15 条工作方式 + 页面验证 + token 预算 | **`AGENTS.md`** | 直接可用。DSH 每次请求都会带它，所以压到 3.3 KB |
| 真源基准 / 判据锁 / 修订台账 / 状态矩阵 | **`JUDGMENT-KIT.md`** | 与 harness 无关的方法，换哪个 agent 都能用 |
| 大文件不许整读、工具结果有界化 | **`cordis.patch.yml.sample`** 里挂现成插件 | DSH 原生有 `tools/post-execute`，能做真正折叠 |
| `card-metrics.json`、`state-matrix.json`、65 条判据脚本 | **不迁** | 它们量的是那个项目的页面，搬过去是废代码 |
| `tools/verify-ui.sh`（bsk 封装） | **不迁** | 换成 DSH 自己的浏览器通道 |
| 用户级 MEMORY.md（9.5 KB） | **不迁** | 太长，且大半是项目专属；可复用的已进 AGENTS.md |
| 专家 `impeccable` 的 30 篇设计方法论 | **`skills/impeccable/`** + **`design-notes/`** | 前者是可直接装的技能包（原件），后者是平铺副本 + 项目定制 INDEX |
| 专家另外 5 个 skill | **`skills/`**（6 个包整包） | 拷进 `~/.dsh/skills/` 即为 DSH 技能：热加载、按需加载，不占常驻上下文 |

## 一·五、专家的 6 个 skill：全迁了

上一版只迁了 30 篇，五个 skill 判成"没必要"。改成全迁，理由是**值不值由任务决定，不由体积决定**：
4 KB 的 `design-brief` 在需求模糊那一轮能省掉一次返工，而它常驻成本是 0。

| skill | 体积 | 状态 | 实际值多少 |
|---|---|---|---|
| `impeccable` | 264 KB / 183 行 + **30 篇** | ✅ 已装 | 最值钱。30 篇是具体判断标准，不是清单 |
| `frontend-dev` | 5.7 MB / 571 行 | ✅ 已装 | 5.5 MB 是 81 个 canvas 字体；素材脚本要外部 Key，没跑过 |
| `browser-use` | 20 KB / 253 行 | ✅ 已装 | 要 `~/.browser-use/config.json`，没配也没跑 |
| `design-brief` | 4 KB / 27 行 | ✅ 已装 | 短，但它是"先出简报与 token 再画"的开关 |
| `ui-audit` | 4 KB / 31 行 | ✅ 已装 | 审查清单，与 `JUDGMENT-KIT.md` 部分重叠 |
| `ui-implementation` | 4 KB / 26 行 | ✅ 已装 | 26 行执行纪律 |

**关键：装进去是按需加载的。** 30 篇 260 KB 只在磁盘上，只有 `skill impeccable` 之后才进上下文。
所以"都搬进来"和"每轮都付钱"是两件事 —— 前者一次性，后者为零。

## 二、装法（三步）

```bash
# 1. 规则层：放进项目根，或全局
cp AGENTS.md  <你的项目>/AGENTS.md
cp AGENTS.md  ~/.dsh/AGENTS.md            # 二选一，项目根优先

# 2. 能力层（设计/前端）：6 个技能，拷进去就生效，不用重启
bash skills/install.sh                     # 默认装到 ~/.dsh/skills，已存在则跳过

# 2.5 省 token 层：先装，再看要不要改配置
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
#    它自带补丁层（package.json 的 dsh.bundle.patch），装完自己进树，不用手写 insert。
#    默认值已是 16K / 8K / 30 条 / 2 行 —— 想改才需要碰 cordis.patch.yml。

# 3. 验证：看组合出来的树，不看文件在不在
dsh --version                              # 应为 0.1.5-rc.2 或更高
dsh --profile web --dump-config | grep -A6 'id: dsh-token-saver'
#    stderr 出现 patch: entry "dsh-token-saver" not found = 没装上。
#    这种情况 rc 仍是 0，只按退出码判会误判成通过。
```

## 三、装完怎么验证「真的生效」

不要看配置文件存不存在，要看行为：

```bash
# 规则层：让 agent 做一次页面验证，看它是否「先列可交互元素再点」
#   不合格的表现：只截一张图就下结论
# 折叠层：跑一条会吐很多行的命令，看输出是否被保头保尾 + 标注抑制行数
```

## 四、能力边界（实测，别重复踩）

| 能力 | WorkBuddy 0.x | DSH |
|---|---|---|
| 工具执行前**改写命令** | ❌ `updatedInput` / `modifiedInput` 都被忽略 | ✅ pre-execute 是 waterfall |
| 工具结果**事后折叠** | ❌ `PostToolUse` 不触发 | ✅ `tools/post-execute` |
| 超阈值**存侧车**（只放摘要+指针） | ❌ 没有 | ✅ spill 家族 |
| 工具执行前**拒绝** | ✅ 已实测生效 | ✅ 单调守卫 |

**结论：省 token 的重活应该在 DSH 上做，WorkBuddy 只能拦。**

## 五、还没验证的

- **已核到源码层，仍未安装运行**。2026-11-02 实测：
  · 仓库在（`git ls-remote` 有 HEAD），npm 无包（`npm view dsh-token-saver` → 404），只能 `github:` 前缀。
  · 它的 `package.json` 有 `dsh.bundle.patch: ./cordis.patch.yml`，那份补丁是 `- insert: [{id: dsh-token-saver, name: dsh-token-saver}]` ⇒ 装完自动进树。
  · `lib/types/config.d.ts` 的 `DEFAULTS` 就是 16K/8K/30/2 ⇒ 旧版 sample 里那几行等于抄默认值。
  · 旧版 sample 的 `id: token-saver` 是错的：补丁层里 id 匹配不到只打一行 warning、`rc=0`，实测输出 `patch: entry "token-saver" not found`。
  · 旧版 `excludeToolNames: ['interaction.ask_user','interaction.confirm']` 两个名字在 DSH 里 0 次命中（`ask_user_question` 有），写了不生效。
  ⇒ 仍**未装、未启动**，所以「装上之后折叠是否真的保留头尾、marker 长什么样」没跑过。
- `dsh plugin` 实测是把参数转给 pnpm（`dsh plugin --profile web --help` 打出的是 pnpm 帮助），
  不是自定义子命令，用法上按 pnpm 理解。
- DSH 的 skill 机制已查清并实测（2026-11-02）：`~/.dsh/skills/<name>/SKILL.md`，
  frontmatter 只要有 `name` + `description`，`description` 就是路由文本（模型靠它决定加载）。
  把 6 个包拷进去后，**本会话的技能目录当场刷新、不用重启**，`skill design-brief` 立刻返回 486 字正文。
  ⇒ 上一版"没查清所以只写单文件、不写 skill 包"的保守做法到此撤销。
- 只验证了"能被加载"，没验证"加载后真的做得更好"—— 那要靠实际交付检验。
- `browser-use` 要 `~/.browser-use/config.json`；`frontend-dev` 的素材脚本要外部 API Key。两个都没跑过。
