#!/bin/bash
# verify-ui.sh —— **页面验证的唯一入口**（真浏览器，bsk）
#
# 为什么有这个脚本（2026-11-01 用户原话）：
#   「以后任何这种页面的操作必须使用 BSK 这个或者是使用 WorkBuddy 这种原生插件，
#     必须跟人一样真实的模拟点击操作去验证去看一下它设计的是不是合理。」
#
# 为什么不是"再写一条规矩"：规矩写在文档里，我下次照样会抓 /tmp/vp.mjs 那种自搓 CDP 脚本，
# 因为它抬手就跑、不用管 session。**让正确的路变成最省事的路，才是拦截。**
# 所以这里把 bsk 的 session / sync / step / evaluate / screenshot 五步压成四条命令。
#
# 用法：
#   tools/verify-ui.sh open   <url>                     打开页面，返回 VOM（像人第一眼看到的）
#   tools/verify-ui.sh click  <ref|selector>            真实点击（ref 来自上一条 open 的 @eN）
#   tools/verify-ui.sh measure <selector> [--all]       量元素几何（getBoundingClientRect + computed）
#   tools/verify-ui.sh shot    [out.png] [--full]       截图
#   tools/verify-ui.sh width  <1280|...> [900]          切视口宽度（open 默认 1440）
#   tools/verify-ui.sh js     '<js表达式>'               跑任意 JS（量不到时才用）
#   tools/verify-ui.sh reset                            丢弃当前 session
#
# 退出码：0 成功 ｜ 2 动作被拒（多半是 context 过期，重跑即可）｜ 3 bsk 不可用
#
# ⚠ 一条命令里做的事：sync → action → 自动 sync。bsk 的规矩是"每个 context 只授权一个动作"，
#   而页面上的时间/计数会自己跳（上一轮踩过：sync 完隔一个回合再点就被拒）。
set -u
BSK="$HOME/.local/bin/bsk"

# ── 门禁在跑时不许抢浏览器（2026-11-03）─────────────────────────────────
# 实账：全量门禁 403s/次，我在它跑浏览器批的时候用本脚本截了一张公网图，
#   浏览器批当场卡死到 600s 超时，一整轮白跑。门禁现在会写 tools/.gate.lock，
#   这里必须看它：抢不到就明说，别把一次 7 分钟的验证撞死。
_d=$(cd "$(dirname "$0")" && pwd)
if [ -f "$_d/.gate.lock" ]; then
  _p=$(cat "$_d/.gate.lock" 2>/dev/null || true)
  _age=$(( $(date +%s) - $(stat -f %m "$_d/.gate.lock" 2>/dev/null || echo 0) ))
  # 2026-11-04 解限：锁龄 ≥15 分钟 = 僵锁，直接忽略，不再让截图永远等下去（与 run-gates 的 TTL 对齐）。
  if [ -n "$_p" ] && kill -0 "$_p" 2>/dev/null && [ "$_age" -lt 900 ]; then
    echo "✗ 门禁正在跑（pid ${_p}，锁龄 ${_age}s），浏览器被它占着。等它结束再截图；rc=5"
    exit 5
  elif [ -f "$_d/.gate.lock" ] && [ "$_age" -ge 900 ]; then
    echo "· 忽略僵锁（pid ${_p:-?}，锁龄 ${_age}s）" >&2
  fi
fi
SESS_FILE=/tmp/bsk-verify-session
LAST_VOM=/tmp/bsk-verify-last-vom.txt

if [ ! -x "$BSK" ]; then echo "bsk 不可用：$BSK 不存在或不可执行（rc=3）"; exit 3; fi
if ! "$BSK" status 2>/dev/null | grep -q "browsers connected  1"; then
  echo "bsk 没有已连接的浏览器 ⇒ 打不开扩展就量不了。rc=3"
  echo "  · 开一个 Chrome 窗口、扩展 BrowserSkill 处于启用"
  echo "  · 或 $BSK doctor 看诊断"
  exit 3
fi

session_id() {
  if [ -f "$SESS_FILE" ]; then
    local s; s=$(cat "$SESS_FILE")
    if [ -n "$s" ] && "$BSK" cooperate sync --session "$s" >/dev/null 2>&1; then echo "$s"; return 0; fi
  fi
  local s
  s=$("$BSK" session start --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['session_id'])" 2>/dev/null)
  [ -z "$s" ] && return 1
  echo "$s" > "$SESS_FILE"
  echo "$s"
}

# bsk 0.4.1：每个动作必须携带「当次 sync 现取的、未用过的 observation_id」。
# 只传 context 会被拒（requires an unused strict observation）。2026-11-04 踩过一整轮。
# 输出两行：第 1 行 context_id，第 2 行 observation_id。
need_ctx() {
  "$BSK" cooperate sync --session "$1" 2>/dev/null \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('context_id','')); print(d.get('observation_id',''))
except Exception:
    print(''); print('')
" 2>/dev/null
}
# 从 need_ctx 的两行输出里取第 1 / 第 2 行
ctx_of() { echo "$1" | sed -n '1p'; }
obs_of() { echo "$1" | sed -n '2p'; }
# 给命令追加 observation（只有非空才加）
with_obs() { if [ -n "$2" ]; then echo "--observation $2"; else echo ""; fi; }

show_vom() {
  "$BSK" cooperate sync --session "$1" 2>/dev/null \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); o=d.get('observation') or {}
    t=o.get('text') or '(空)'
except Exception:
    t='(sync 没返回可读观察)'; d={}
print(t[:4000])
open('$LAST_VOM','w').write(t)
print('---CTX---', d.get('context_id',''))
" 2>/dev/null
}

CMD=${1:-}; shift || true

case "$CMD" in
  open)
    URL=${1:?用法: verify-ui.sh open <url>}
    S=$(session_id) || { echo "session 起不来（rc=3）"; exit 3; }
    # 新 session 的第一次 navigate 不需要 context；复用 session 时才走 step+context
    nav() {
      "$BSK" navigate "$URL" --session "$1" >/dev/null 2>&1 && return 0
      local pair ctx obs
      pair=$(need_ctx "$1"); ctx=$(ctx_of "$pair"); obs=$(obs_of "$pair")
      [ -z "$ctx" ] && return 2
      "$BSK" step --session "$1" --action navigate --params "{\"url\":\"$URL\"}" \
        --context "$ctx" $(with_obs x "$obs") --json >/dev/null 2>&1
    }
    nav "$S"; rc=$?
    # ★2026-11-05（用户原话：「反复给你真源，你却几乎从不看，自己瞎搞」）。
    #   根因不是我不看，是**旧 session 指向的标签页已经没了**：sync 报
    #   `Receiving end does not exist`，而我原来只是让"重跑一次"，重跑还是同一个死 session。
    #   所以这里补一步自愈：通道断了就丢掉旧 session、新开一个标签页再来一次。
    #   还不行就**明确报读不到并退出**，绝不退回"按截图猜"。
    if [ "$rc" != 0 ]; then
      echo "· 浏览器通道已断（旧标签页没了），重开一个新标签页再试" >&2
      "$BSK" session stop --session "$S" >/dev/null 2>&1
      rm -f "$SESS_FILE"
      S=$(session_id) || { echo "session 起不来（rc=3）"; exit 3; }
      nav "$S"; rc=$?
    fi
    if [ "$rc" != 0 ]; then
      echo "✗ 读不到这个页面：$URL" >&2
      echo "  ⇒ 不要凭截图猜。停下来告诉用户「真源读不到」，或让他给截图/重开浏览器。（rc=2）" >&2
      exit 2
    fi
    sleep 2
    # ★视口统一成 1440（项目规范：外部端桌面 1440）。
    #   BSK 的 Agent Window 默认只有 1280 宽，不设就会「尺寸永远差一档」——
    #   1280 下 4 列卡宽 233，1440 下 268.8，量出来的数和设计基准对不上。
    PAIR2=$(need_ctx "$S")
    CTX2=$(ctx_of "$PAIR2")
    OBS2=$(obs_of "$PAIR2")
    [ -n "$CTX2" ] && "$BSK" emulate --session "$S" --context "$CTX2" $(with_obs x "$OBS2") --width 1440 --height 900 >/dev/null 2>&1
    sleep 1
    show_vom "$S"
    ;;
  click)
    T=${1:?用法: verify-ui.sh click <ref|selector>}
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S")
    CTX=$(ctx_of "$PAIR")
    OBS=$(obs_of "$PAIR")
    if [[ "$T" == @* ]]; then P="{\"ref\":\"$T\"}"; else P="{\"selector\":\"$T\"}"; fi
    "$BSK" step --session "$S" --action click --params "$P" --context "$CTX" $(with_obs x "$OBS") --json 2>&1 \
      | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('ok:', d.get('ok'))
p=d.get('post') or {}
print((p.get('observation',{}).get('text') or '(无)')[:3000])
print('---CTX---', p.get('context_id'))
"
    ;;
  measure)
    SEL=${1:?用法: verify-ui.sh measure <selector>}
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S")
    CTX=$(ctx_of "$PAIR")
    OBS=$(obs_of "$PAIR")
    "$BSK" evaluate "(function(){var els=[].slice.call(document.querySelectorAll('$SEL'));if(!els.length)return JSON.stringify({count:0,sel:'$SEL'});var r=function(e){var b=e.getBoundingClientRect();return{w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,x:Math.round(b.x*10)/10,y:Math.round(b.y*10)/10};};var s=getComputedStyle(els[0]);return JSON.stringify({count:els.length,rects:els.slice(0,6).map(r),style:{fs:s.fontSize,lh:s.lineHeight,fw:s.fontWeight,pad:s.padding,radius:s.borderRadius,border:s.borderTopWidth+' '+s.borderTopColor,ar:s.aspectRatio,gap:s.gap,bg:s.backgroundSize},grid:(function(){var g=els[0].parentElement;if(!g)return null;var gs=getComputedStyle(g);return{cols:gs.gridTemplateColumns,gap:gs.gap,pad:gs.padding};})()});})()" \
      --context "$CTX" $(with_obs x "$OBS") --session "$S" 2>&1 | python3 -c "
import json,sys
raw=sys.stdin.read().strip()
try:
    v=json.loads(raw)
    if isinstance(v,str): v=json.loads(v)
    print(json.dumps(v,ensure_ascii=False,indent=2))
except Exception:
    print(raw[:800])
"
    ;;
  shot)
    OUT=""; FULL=""
    for a in "$@"; do
      case "$a" in
        --full) FULL="--full-page --scope follow" ;;
        *) OUT="$a" ;;
      esac
    done
    [ -z "$OUT" ] && OUT="/tmp/verify-$(date +%s).png"
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S")
    CTX=$(ctx_of "$PAIR")
    OBS=$(obs_of "$PAIR")
    "$BSK" screenshot --session "$S" --context "$CTX" $(with_obs x "$OBS") $FULL --out "$OUT" >/dev/null 2>&1
    if [ -f "$OUT" ]; then python3 -c "
from PIL import Image; print('$OUT', Image.open('$OUT').size)"; else echo "截图失败（rc=2）"; exit 2; fi
    ;;
  width)
    W=${1:-1280}
    H=${2:-900}
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S")
    CTX=$(ctx_of "$PAIR")
    OBS=$(obs_of "$PAIR")
    [ -z "$CTX" ] && { echo "拿不到 context（rc=2）"; exit 2; }
    "$BSK" emulate --session "$S" --context "$CTX" $(with_obs x "$OBS") --width "$W" --height "$H" >/dev/null 2>&1 || { echo "emulate 被拒（rc=2）"; exit 2; }
    sleep 1
    show_vom "$S"
    ;;
  js)
    EXPR=${1:?用法: verify-ui.sh js '<表达式>'}
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S")
    CTX=$(ctx_of "$PAIR")
    OBS=$(obs_of "$PAIR")
    "$BSK" evaluate "$EXPR" --context "$CTX" $(with_obs x "$OBS") --session "$S" 2>&1 | head -40
    ;;
  layout)
    # ★2026-11-05 根治：弹窗版式四问，一次答完。缺一项不算验过。
    #   背景：接入弹窗被退了六次，每次都只验"刚改的那一项"，缺陷全从没验的缝里漏出去。
    #   用法: verify-ui.sh layout [容器选择器，默认 .nf]
    SEL=${1:-.nf}
    S=$(session_id) || exit 3
    PAIR=$(need_ctx "$S"); CTX=$(ctx_of "$PAIR"); OBS=$(obs_of "$PAIR")
    read -r -d '' EXPR <<'JS' || true
(()=>{var SEL='__SEL__';var d=document.querySelector(SEL);
if(!d)return JSON.stringify({错误:'页面上没有 '+SEL+'（先把弹窗打开）'});
var R=function(e){return e.getBoundingClientRect()};
var bd=d.querySelector('.nf-bd')||d,rbd=R(bd);
var ctrls=[].slice.call(bd.querySelectorAll('input,textarea,select')).filter(function(e){return ['file','checkbox','radio','hidden'].indexOf(e.type)<0});
var bad=ctrls.filter(function(e){var r=R(e);return r.top<rbd.top-1||r.bottom>rbd.bottom+1}).map(function(e){return e.id||String(e.className)});
var ws=ctrls.map(function(e){return Math.round(R(e).width)}),uniq=ws.filter(function(w,i){return ws.indexOf(w)===i});
var ft=d.querySelector('.nf-ft'),rd=R(d),vh=window.innerHeight;
return JSON.stringify({
 '① 控件都在内容区内':bad.length===0, 溢出项:bad,
 '② 同宽（同一栏控件宽度一致）':ctrls.length?uniq.length===1:null, 各控件宽:ws,
 '③ 底栏不压内容':ft?R(ft).top>=rbd.bottom-1:null,
 '④ 弹窗不超视口':rd.top>=-1&&rd.bottom<=vh+1, 弹窗:[Math.round(rd.top),Math.round(rd.bottom)], 视口:vh,
 需要滚动:bd.scrollHeight>bd.clientHeight+1})})()
JS
    EXPR=${EXPR//__SEL__/$SEL}
    "$BSK" evaluate "$EXPR" --context "$CTX" $(with_obs x "$OBS") --session "$S" 2>&1 | head -20
    ;;
  reset)
    rm -f "$SESS_FILE"; echo "session 已丢弃"
    ;;
  *)
    sed -n '15,25p' "$0"
    exit 1
    ;;
esac
