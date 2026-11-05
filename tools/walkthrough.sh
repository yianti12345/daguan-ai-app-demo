#!/bin/bash
# walkthrough.sh —— 交付前「专家走查」的取景器（2026-11-02 立）
#
# 为什么不是再写一条规矩：规矩写在文档里，下一轮照样只检查自己改的那一块。
# 这个脚本把「整页截下来 + 把页面骨架读出来」压成一条命令，交付前对每个改动页跑一次。
# 它不判断好坏，只保证**你看见的是整页**，而不是你以为自己改对的那一小块。
#
# 用法：
#   tools/walkthrough.sh apps.html client-auth.html
# 产物：
#   _reports/shots/walkthrough/<page>.png（1440×900 视口）
#   终端打印每页的 title / 面包屑 / H1 / 侧栏高亮 / 主按钮，再接六问。
#
# 六问（逐条回答，答不上来＝没走查）：
#   1 第一眼该看到什么？现在第一眼看到的是什么？
#   2 每个可点元素点下去发生什么？有没有点了报错/没反应的？
#   3 同一个动作有几个入口、几种叫法？
#   4 哪一列/哪一块是占位数据（—、空、重复），删掉会不会丢信息？
#   5 标题 / 面包屑 / 返回路径自洽吗？
#   6 和标准件（员工管理页）比，表头、行高、操作列、分页哪里不一样？
set -u
cd "$(dirname "$0")/.." || exit 3
OUT=_reports/shots/walkthrough
mkdir -p "$OUT"
[ $# -eq 0 ] && set -- apps.html components.html client-auth.html downloads.html
for p in "$@"; do
  slug=$(printf '%s' "$p" | sed 's/[^A-Za-z0-9._-]/_/g')
  echo "── $p"
  tools/verify-ui.sh open "http://127.0.0.1:8941/$p" >/dev/null 2>&1 || { echo "  打不开（rc=$?）"; continue; }
  sleep 0.6   # 弹层/页面有 180ms 入场动画，立刻截会把动画帧当成最终态（2026-11-02 踩过）
  tools/verify-ui.sh js 'JSON.stringify((function(){var q=function(s){var e=document.querySelector(s);return e?e.textContent.replace(/\s+/g," ").trim():""};var b=[].slice.call(document.querySelectorAll(".bar .btn.primary,.au-bar .btn.primary,.toolbar .btn.primary"));return {title:document.title,crumb:q(".crumb"),h1:q("h1"),navOn:q(".sider .is-on"),primary:b.map(function(x){return x.textContent.trim()})}})(),function(k,v){return v})' 2>&1 | tail -n 2 | head -n 1
  tools/verify-ui.sh shot "$OUT/$slug.png" >/dev/null 2>&1 && echo "  截图 $OUT/$slug.png"
done
cat <<'TXT'

六问（逐条回答；一条都答不出＝没走查）：
 1 第一眼该看到什么？现在第一眼看到的是什么？
 2 每个可点元素点下去发生什么？有没有点了报错/没反应的？
 3 同一个动作有几个入口、几种叫法？
 4 哪一列/哪一块是占位数据（—、空、重复），删掉会不会丢信息？
 5 标题 / 面包屑 / 返回路径自洽吗？
 6 和标准件（员工管理页）比，表头、行高、操作列、分页哪里不一样？
TXT
