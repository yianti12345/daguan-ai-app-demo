---
name: ui-implementation
description: Use when a UI design must become production-ready frontend code or when an existing page needs a visual and interaction rebuild across responsive breakpoints.
---

# 前端体验落地

把设计决策落成可运行、可维护、可响应的页面或组件，并保留产品语义和品牌个性。

## 执行要点

1. 先识别项目框架、入口、现有组件、样式方案和脚本命令；沿用已有约定。
2. 先搭页面骨架和组件边界，再实现 token、排版、颜色、细节和动效。
3. 为关键流程实现默认、悬停、按下、焦点、禁用、加载、空、错误、成功和权限状态。
4. 使用 CSS 容器查询或项目已有响应式方案；窄屏时重排信息，不简单隐藏关键功能。
5. 动画优先使用 transform/opacity 等 GPU 友好属性；尊重 `prefers-reduced-motion`，避免持续消耗和布局抖动。
6. 媒体与图标优先使用本地资源；不使用 `unsplash`、`picsum`、`placeholder`、`lorem` 等占位地址。
7. 完成后运行项目真实入口，检查资源、控制台、主交互和至少三个视口；不能运行时写明原因和命令。

## 代码交付最低标准

- 组件可独立理解，状态由明确的数据或 props 驱动。
- 表单有 label、校验、错误关联和提交反馈。
- 动态更新使用合适的语义和 `aria-live`，焦点不会在弹层/导航后丢失。
- 图片有替代文本，装饰图形不会干扰读屏；交互区域适合触摸。
- 交付中说明改动文件、运行命令、验证结果和未验证事项。
