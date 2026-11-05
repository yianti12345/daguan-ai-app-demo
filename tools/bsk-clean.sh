#!/bin/bash
# bsk-clean.sh —— 每次 BSK 取证后强制清场（2026-11-03 用户当场发火）
# 顺序很重要：先停 session，再停 daemon；否则 daemon 可能被下一条命令重新拉起。
set -u
BSK=/Users/zhengshiji/.local/bin/bsk
[ -x "$BSK" ] || exit 0
if [ -f "$HOME/.bsk/daemon.json" ]; then
  PID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid",""))' "$HOME/.bsk/daemon.json" 2>/dev/null || true)
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    "$BSK" session stop --all >/dev/null 2>&1 || true
  fi
fi
"$BSK" daemon stop >/dev/null 2>&1 || true
if [ -f "$HOME/.bsk/daemon.json" ]; then
  PID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid",""))' "$HOME/.bsk/daemon.json" 2>/dev/null || true)
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    echo "BSK 仍在运行：pid $PID" >&2
    exit 1
  fi
fi
echo "BSK 已清场"
