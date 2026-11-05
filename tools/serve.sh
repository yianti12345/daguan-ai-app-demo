#!/bin/bash
# 起小智服务（静态页 + 模型转发 /xz/plan + 语音识别 /asr），幂等。
# 用户看到的现象：麦克风点了提示「连不上识别服务」＝这个服务没起。
# 重启电脑后不会自己回来，演示前跑一次本脚本。
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8941}"
UP="$HOME/.workbuddy/_tools/xz-up.py"

if [ ! -f "$UP" ]; then
  echo "[serve] 找不到启动器：$UP" >&2
  exit 2
fi

XZ_UP_ROOT="$HERE" python3 "$UP" "$PORT"
rc=$?

# 幂等：端口已在用是正常情况，不算失败
# 启动器是 double-fork，返回时端口可能还没 bind —— 给它最多 6 秒
for _ in 1 2 3 4 5 6; do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 1
done
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[serve] http://127.0.0.1:$PORT/ 已在听"
  echo "[serve] 自检："
  curl -s -o /dev/null -w '  app.html %{http_code}\n' "http://127.0.0.1:$PORT/app.html"
  curl -s -o /dev/null -w '  /xz/plan %{http_code}（POST 空体会 502，正常）\n' -X POST "http://127.0.0.1:$PORT/xz/plan" -H 'content-type: application/json' -d '{}'
  exit 0
fi

echo "[serve] 起不来，rc=${rc}（看 ~/.workbuddy/logs/xz-server.log）" >&2
exit 1
