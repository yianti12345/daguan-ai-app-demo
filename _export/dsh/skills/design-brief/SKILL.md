---
name: design-brief
description: Use when a UI request begins with ambiguous requirements, screenshots, references, brand cues, or a need to define a design direction and reusable system before implementation.
---

# 需求炼金与设计系统

将零散需求变成可执行的设计简报和设计系统，而不是直接套用页面模板。

## 执行要点

1. 提取目标用户、核心任务、成功标准、内容优先级和技术约束。
2. 区分事实、假设和待确认问题；只询问会改变页面结构、视觉方向或技术方案的问题。
3. 从截图/参考稿拆解容器、网格、层级、字体、颜色、间距、组件、状态和交互线索。
4. 用一句设计命题约束风格，选一个有辨识度的方向，并说明取舍。
5. 输出语义 token：颜色用途、排版层级、间距阶梯、圆角/阴影、动效节奏、断点和无障碍要求。
6. 列出组件清单与状态矩阵，标记哪些模式适合复用、哪些只属于当前页面。

## 交付形态

- 产品需求不完整：`设计简报 + 关键问题 + 初版流程`。
- 已有截图：`视觉拆解 + 还原规则 + 偏差风险`。
- 需要规范沉淀：`DESIGN.md + tokens + 组件使用边界`。

## 质量线

设计系统必须使用语义命名，不能只堆色值；每个重要组件至少说明默认、焦点、禁用、加载、错误和空状态；配色应满足 WCAG AA 的常见文本对比要求。
