#!/bin/bash
# xz-health.sh —— 小智「有时候跑不起来」的三层自检，一条命令看清是哪一层。
#
# 为什么要有它：这套东西有四层可能坏（端口没起 / 起了但不是代理 / 代理通但模型失败 / 前端缓存了旧脚本），
# 每一层的表现都是同一句「小智不动了」。不区分层次就只能靠猜，而猜错的代价是改错地方。
#
# 用法：bash tools/xz-health.sh [端口]      默认 8973
# rc：0 全绿｜2 有红层｜3 连不上

PORT="${1:-8973}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RED=0

echo "── 小智自检 @ $PORT ────────────────────────────────"

# 层 1：端口有没有人在听
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t | head -1)
  echo "L1 端口    OK  监听中  pid=$PID"
else
  echo "L1 端口    ✗ 没有服务在 $PORT"
  echo "           修复：XZ_UP_ROOT=\"$ROOT\" python3 ~/.workbuddy/_tools/xz-up.py $PORT"
  exit 3
fi

# 层 2：这个端口有没有模型代理（纯 http.server 会给 501）
CODE=$(curl -s --noproxy '*' -o /tmp/.xzhealth -w "%{http_code}" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"1+1"}]}' \
  "http://127.0.0.1:$PORT/xz/plan" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  MODEL=$(python3 -c 'import json;d=json.load(open("/tmp/.xzhealth"));print(d.get("model","?")," %.1fs"%(d.get("ms",0)/1000))' 2>/dev/null)
  echo "L2 代理    OK  /xz/plan 200  $MODEL"
elif [ "$CODE" = "501" ]; then
  echo "L2 代理    ✗ 这个端口是纯静态服务（501 Unsupported method）"
  echo "           这就是「小智按本地规则走」的原因：前端拿不到模型就降级。"
  echo "           修复：kill $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t | head -1) 然后 XZ_UP_ROOT=\"$ROOT\" python3 ~/.workbuddy/_tools/xz-up.py $PORT"
  RED=2
else
  echo "L2 代理    ✗ /xz/plan 返回 ${CODE}（上游模型失败，等一会儿再试）"
  head -c 160 /tmp/.xzhealth 2>/dev/null; echo
  RED=2
fi

# 层 3：前端资源有没有被缓存成旧版（改完不生效最常见的原因）
echo "L3 缓存"
for f in float.js float.css xiaozhi.js sys.css tokens.css; do
  DISK=$(md5 -q "$ROOT/assets/$f" 2>/dev/null | cut -c1-8)
  PAGE=$(curl -s --noproxy '*' "http://127.0.0.1:$PORT/component.html" 2>/dev/null \
         | grep -o "$f?v=[0-9a-f]*" | head -1 | cut -d= -f2)
  if [ "$DISK" = "$PAGE" ]; then
    echo "   $f ✓ $DISK"
  else
    echo "   $f ✗ 盘=$DISK 页=$PAGE —— 页面引的是旧版，改了不起作用"
    RED=2
  fi
done

# 层 4：页面自己有没有 JS 报错（需要 bsk，没有就跳过，不假装绿）
if command -v bsk >/dev/null 2>&1 && bsk session list 2>/dev/null | grep -qv "no active sessions"; then
  echo "L4 控制台   （bsk 可用，用 bsk console 看）"
else
  echo "L4 控制台   — 未量（bsk 无会话；这不是绿，是没查）"
fi

echo "────────────────────────────────────────────────────"
if [ "$RED" = "0" ]; then echo "结论：可用"; exit 0; else echo "结论：有红层，按上面提示修"; exit 2; fi
