#!/usr/bin/env bash
# 把本目录下的 6 个专家技能装进 DSH。
# 用法：bash install.sh [目标目录]   （默认 ~/.dsh/skills）
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="${1:-$HOME/.dsh/skills}"

mkdir -p "$DST"
echo "源：$SRC"
echo "目标：$DST"

installed=0
skipped=0
for d in "$SRC"/*/; do
  name="$(basename "$d")"
  [ -f "$d/SKILL.md" ] || continue
  if [ -e "$DST/$name" ]; then
    echo "  跳过（已存在）：$name"
    skipped=$((skipped + 1))
    continue
  fi
  cp -R "$d" "$DST/$name"
  echo "  装上：$name"
  installed=$((installed + 1))
done

echo "完成：新装 $installed 个，跳过 $skipped 个。"
echo "验证：新开一个 DSH 会话，技能目录里应出现上述名字；或直接 skill <name>。"
