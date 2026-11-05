#!/bin/bash
# Chrome 启动包装（2026-11-01）
# 为什么需要它：本机 headless Chrome 在受限环境里报
#   "sandbox initialization failed: Operation not permitted"
# 子进程反复崩 ⇒ oil-ui 的 shoot.mjs 连上 DevTools 后立刻断开，
# 于是视觉 lint 的 A 部分 7 页一页都量不到（rc=1），判据被算成"未量"。
# 这里只补一个 --no-sandbox（本机是本地预览，不加载外部页面），
# 不改 oil-ui 的脚本本身 —— 那是全局技能，动了会影响别的项目。
REAL="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
exec "$REAL" "$@" --no-sandbox --disable-dev-shm-usage
