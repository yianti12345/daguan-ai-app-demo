# skills/ — 6 个专家技能，DSH 直接可用

来源：WorkBuddy 专家「UI 设计炼金师」的 6 个 skill 原包（Impeccable 系，Apache 2.0，基于 Anthropic frontend-design）。
2026-11-02 实测：拷进 `~/.dsh/skills/` 后，本会话的技能目录当场刷新，`skill` 工具能直接加载 —— **不用重启**。

## 六个包

| 技能 | 体积 | 什么时候该触发 | 里面是什么 |
|---|---|---|---|
| `impeccable` | 264 KB | 做界面/组件/页面/海报，任何"要好看"的活 | SKILL.md（183 行）+ **30 篇 reference**（字阶、间距、配色、认知负荷、反 AI Slop 审计…） |
| `frontend-dev` | 5.7 MB | 落地页/营销站/仪表盘、动效、生成素材、转化文案 | SKILL.md（571 行）+ references(100K) + scripts(32K) + templates(32K) + canvas-fonts(**5.5 MB，81 个字体**) |
| `browser-use` | 20 KB | 要真的开浏览器点、填、截图、抓数据 | SKILL.md（253 行），依赖 `~/.browser-use/config.json` |
| `ui-audit` | 4 KB | 审已有界面：层级、响应式、无障碍、交互态 | 31 行检查表 |
| `ui-implementation` | 4 KB | 设计稿变生产代码、响应式重建 | 26 行执行纪律 |
| `design-brief` | 4 KB | 需求模糊/只有截图/要立设计系统 | 27 行：先出简报与 token，再谈页面 |

**体积说明**：`frontend-dev` 的 5.5 MB 全是 canvas 字体，只做常规页面可以删掉 `canvas-fonts/`，技能照常工作。

## DSH 的技能机制（本轮实测，不是猜）

1. **位置**：`~/.dsh/skills/<name>/SKILL.md`。目录名与 frontmatter 的 `name` 必须相同。
2. **frontmatter 就是路由**：`name` + `description`。模型只看 `description` 决定要不要加载 —— 所以它写的是"什么时候用我"，不是简介。
3. **随 SKILL.md 一起读**：同目录的 `references/`、`scripts/`、`templates/` 都能被正文相对路径引用。
4. **热加载**：本会话实测，拷进去后系统提示里的技能目录立即出现这 6 个，`skill design-brief` 当场返回 486 字正文。不需要重启 DSH。
5. 加载是**按需**的：30 篇 reference 常驻磁盘 260 KB，但只有 `skill impeccable` 之后才会进上下文。

## 装法

```bash
bash install.sh                    # 装到 ~/.dsh/skills
bash install.sh /custom/skills     # 装到别处
```

幂等：目标已存在就跳过，不覆盖本地改过的版本。卸载就是 `rm -rf ~/.dsh/skills/<name>`。

## 和 `../design-notes/` 的关系

同一批 30 篇的两处副本，用途不同：

- `skills/impeccable/references/` —— **原件**，内部相对链接按 `references/` 前缀解析。装成技能后走这里。
- `../design-notes/` —— **平铺副本**，多一份 `INDEX.md`（按"我遇到什么问题"路由，还标了本项目最常用的六篇）。不装技能、想直接读文件时用它。

两份内容已核对：30 篇逐字节一致。装完技能后以技能为准，`design-notes` 只当离线索引。

## 没验证的

- `browser-use` 要 `~/.browser-use/config.json` 才能真跑，本轮没配、没跑。
- `frontend-dev` 的素材生成脚本要外部 API Key，没跑过。
- 本轮只验证了"能被加载"（`skill design-brief` 返回正文），没验证"加载后真的做得更好"——那要靠实际交付检验。
