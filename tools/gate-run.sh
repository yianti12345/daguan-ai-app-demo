#!/usr/bin/env bash
# gate-run —— 门禁的**唯一入口**（2026-10-25 立）
#
# 为什么要有这一层：run-gates.sh 本身没问题，出问题的是"怎么跑它"。实测栽过三次：
#   1. 长套件当 agent 后台 job 跑 → job 收尾时整套浏览器判据 Terminated: 15，rc 文件没落地，
#      表现成"输出只有表头"，让人误以为是输出缓冲，于是一遍遍重试；
#   2. 工作目录含中文，经 PTY 传路径会被截断（/Worktrees/达观 → /Worktrees/达），
#      命令在不存在的地方执行，判据自然全红；
#   3. 多组套件并发（各自 5 路 Chrome）互相拖死，谁都不出结果。
# 这一层把三件事一起做掉：独立会话脱离、一次只许一组、结果只落文件、终端只回摘要。
#
# 用法：
#   bash tools/gate-run.sh               前台：起跑 + 等完 + 出摘要（人在终端时用）
#   bash tools/gate-run.sh --bg          起跑后立刻返回（agent 用；跑的那份在独立会话里，杀不掉）
#   bash tools/gate-run.sh --wait        等最近一次跑完，出摘要
#   bash tools/gate-run.sh --report      只出最近一次的摘要（不启动、不等待）
#   bash tools/gate-run.sh --clean       清掉残留的 run-gates（起跑前的清场）
#   其余参数透传给 run-gates.sh：--fast / --negctl / --changed
#
# 产物：_reports/gate/<时间戳>.log（原始）+ <时间戳>.txt（摘要）；终端只回摘要，不回原文。
set -u
cd "$(dirname "$0")/.." || { echo "FATAL_CD"; exit 3; }
ROOT=$(pwd)
OUTD="$ROOT/_reports/gate"
mkdir -p "$OUTD"
TS=$(date +%Y%m%d-%H%M%S)
LOG="$OUTD/$TS.log"
SIDE_RUNGS="run-gates.sh"

# ★ 2026-10-25 抓到的真 bug：原来是 `grep -c "[r]${SIDE_RUNGS}"`，而 SIDE_RUNGS="run-gates.sh"，
#   拼出来是 `[r]run-gates.sh` —— 那是「r + run-gates.sh」= 只在有叫 rrun-gates.sh 的进程时才匹配。
#   后果不是报错，是**并发保护从来就没生效过**：清场前永远数到 0、`--bg` 的"已有 N 个在跑"永远不拦，
#   于是两次全量叠着跑（各自的 5 路 Chrome 互相拖死），Chrome 也越积越多。
#   现在改用 pgrep 直接匹配路径里的 "tools/run-gates.sh"（不会连 gate-run.sh 自己一起数进来）。
count_running() { local n; n=$(pgrep -f "tools/run-gates.sh" 2>/dev/null | wc -l); echo "$((n + 0))"; }
count_chrome() { local n; n=$(ps -Ao args 2>/dev/null | grep -c "[G]oogle Chrome.*--headless=new"); echo "${n:-0}"; }

# headless Chrome 只会由判据起；判据被 STEP_TIMEOUT 用 kill -9 收掉时，它起的 Chrome 会留下来。
# 2026-10-25 实测：反复起停门禁之后盘上积了 81 个 headless Chrome，每个都占内存与端口，
# 后面几轮"Chrome 起不来 / 未量"有一部分就是它们造成的。
# 只在没有 run-gates 存活时才扫，否则会误杀正在跑的判据浏览器。
sweep_chrome() {
  local n
  n=$(count_chrome)
  [ "${n:-0}" -gt 0 ] || return 0
  pkill -f 'Google Chrome.*--headless=new' 2>/dev/null
  sleep 1
  n=$(count_chrome)
  [ "${n:-0}" -gt 0 ] && pkill -9 -f 'Google Chrome.*--headless=new' 2>/dev/null
  echo "顺带清掉残留 headless Chrome"
}

clean_stale() {
  local n
  n=$(count_running)
  if [ "$n" -gt 0 ]; then
    echo "清场：有 $n 个 run-gates 在跑，全部结束"
    pkill -f "${SIDE_RUNGS}" 2>/dev/null
    sleep 2
    # SIGTERM 对 double-fork 出去的那份不总是有效（它的 ppid 已是 1），补一刀 SIGKILL
    n=$(count_running)
    [ "$n" -gt 0 ] && pkill -9 -f "${SIDE_RUNGS}" 2>/dev/null && sleep 1
  fi
  n=$(count_running)
  echo "清场后残留：$n"
  [ "$n" -eq 0 ] && sweep_chrome
  return "$n"
}

launch() {
  local log=$1; shift
  # 独立会话（setsid）+ 自己的 log；调用方被 SIGTERM 也不影响跑的这一份
  nohup python3 tools/_bg-exec.py "$log" -- \
    bash -c 'bash tools/run-gates.sh "$@" ; echo "GATE_EXIT=$?"' _ "$@" >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

report() {
  local log=$1
  local exit_line pass fail
  exit_line=$(grep -a 'GATE_EXIT=' "$log" 2>/dev/null | tail -1 | sed 's/.*GATE_EXIT=//')
  pass=$(grep -ac '^  ✓ ' "$log" 2>/dev/null || true)
  fail=$(grep -ac '^  ✗ ' "$log" 2>/dev/null || true)
  pass=${pass:-0}; fail=${fail:-0}
  # 没有 GATE_EXIT 有两种可能：还在跑 / 被杀了。不查进程就报"被中途杀过"是假话——
  # 2026-10-25 15:02 真的这么误报过一次（套件正跑到第二批浏览器判据，被当成"这次不算数"）。
  if [ -z "${exit_line:-}" ] && pgrep -f 'tools/run-gates.sh' >/dev/null 2>&1; then
    echo "── 门禁结果（$(basename "$log" .log)）──"
    echo "rc=?｜还在跑（已出 通过 ${pass}｜判红 ${fail}）｜等出 GATE_EXIT 再取，别当结果"
    echo "日志：$log"
    return 0
  fi
  echo "── 门禁结果（$(basename "$log" .log)）──"
  case "${exit_line:-}" in
    0) echo "rc=0｜通过 ${pass}｜判红 0｜GREEN" ;;
    2) echo "rc=2｜通过 ${pass}｜判红 ${fail}｜有红" ;;
    3) echo "rc=3｜未执行（服务没起 / FATAL）" ;;
    *) echo "rc=${exit_line:-?}｜通过 ${pass}｜判红 ${fail}｜无 GATE_EXIT 行 = 被中途杀过，这次不算数" ;;
  esac
  if [ "$fail" != "0" ]; then
    echo "判红项："
    grep -a '^  ✗ ' "$log" | head -20 | sed 's/^  /  /'
  fi
  grep -a 'ALL GREEN' "$log" | tail -1
  grep -a '有判红项' "$log" | tail -1
  grep -a 'FATAL' "$log" | tail -2
  echo "日志：$log"
  # 摘要落一份，别让人回头去翻原始 log
  { echo "gate-run $(basename "$log" .log)"
    echo "exit=${exit_line:-?} pass=$pass fail=$fail"
    grep -a '^  ✗ ' "$log" | head -20
  } > "${log%.log}.txt" 2>/dev/null
}

cmd="${1:-}"; [ $# -gt 0 ] && shift

# 默认只跑"改动会波及的组"（--changed），全量必须显式 --all 或 GATE_ALL=1。
# 2026-10-25 用户原话「太慢了…速度太慢了，效率太低了」：全量一次十分钟，
# 改一行 CSS 也要等十分钟不是严谨，是把不相关的判据也跑了一遍。
all=0; [ -n "${GATE_ALL:-}" ] && [ "$GATE_ALL" != 0 ] && all=1
changed=0; args=()
for a in "$@"; do
  case "$a" in
    --all) all=1 ;;
    --changed) changed=1; args+=("$a") ;;
    *) args+=("$a") ;;
  esac
done
[ "$all" = 0 ] && [ "$changed" = 0 ] && args+=(--changed)

case "$cmd" in
  --clean)
    clean_stale; echo "rc=$?"; exit 0;;
  --report)
    L=$(ls -1t "$OUTD"/*.log 2>/dev/null | head -1)
    [ -z "$L" ] && { echo "没有历史结果（_reports/gate 是空的）"; exit 3; }
    report "$L"; exit 0;;
  --wait)
    L=$(ls -1t "$OUTD"/*.log 2>/dev/null | head -1)
    [ -z "$L" ] && { echo "没有历史结果"; exit 3; }
    for _ in $(seq 1 300); do grep -qa 'GATE_EXIT=' "$L" && break; sleep 2; done
    report "$L"; exit 0;;
  --bg)
    n=$(count_running)
    [ "$n" -gt 0 ] && { echo "FATAL: 已有 $n 个 run-gates 在跑；先 bash tools/gate-run.sh --clean"; exit 3; }
    launch "$LOG" ${args[@]+"${args[@]}"}
    sleep 1
    echo "已起跑（独立会话）：$LOG"
    echo "取结果：bash tools/gate-run.sh --report"
    exit 0;;
  *)
    n=$(count_running)
    [ "$n" -gt 0 ] && { echo "FATAL: 已有 $n 个 run-gates 在跑；先 bash tools/gate-run.sh --clean"; exit 3; }
    launch "$LOG" ${args[@]+"${args[@]}"}
    for _ in $(seq 1 300); do grep -qa 'GATE_EXIT=' "$LOG" 2>/dev/null && break; sleep 2; done
    report "$LOG";;
esac
