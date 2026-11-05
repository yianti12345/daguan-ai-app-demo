#!/usr/bin/env bash
# 一键门禁。判据清单与含义见 DESIGN.md 第 10 节；台账见 tools/judgments.mjs。
#
# 用法：bash tools/run-gates.sh            全量（收尾必须跑这个）
#      bash tools/run-gates.sh --fast     快速档：17 条静态 + 卡底栏 computed（约 8 秒），干活中间用
#      bash tools/run-gates.sh --negctl   负控：每条判据都必须能被打红（预期 rc=2）
#      bash tools/run-gates.sh --only token,cardshape,icons   点名跑（改一类东西只跑相关几条）
#      bash tools/run-gates.sh --stylequick   样式快档＝卡形+卡底栏+图标+token+统一尺寸+内缘，约 45 秒
#
# ★ 2026-10-26 为什么加这两档：这一轮我十几次跑全量（7 分钟一次），
#   纯粹在等"跟这次改动无关"的判据。--fast 只有 7 条纯文件判据，
#   改样式时最需要的卡形/图标/尺寸一条都不在里面，所以我绕开了它。
#   三档的分工：改文案 → --fast（8 秒）｜改 CSS → --stylequick（45 秒）｜收尾 → 全量。
#   ★2026-11-02：--fast 不再是「纯文件」——卡底栏这条必须开浏览器量 computed；
#     静态绿而 computed 红，正是「卡片底部还是不一样」反复三轮的根因。
#
# ★ 2026-10-22 提速：判据之间没有依赖，改成并发跑（最多 3 路）。
#   之前串行 45-60 秒，其中绝大部分是各自 spawn headless Chrome 的启动等待；
#   并发后受最慢那条约束。卡 3 路是因为这台机器同时起 5 个以上 Chrome 会互相拖慢。
set -u
cd "$(dirname "$0")/.." || exit 1

# ── 判据判红时怎么打印它的日志（2026-10-28 加：起因是一次真实的证据丢失）───────
# 20261028-020647 全量门禁里 e2e 报「通过 67 ｜ 断点 3」，而当时的打印是 `tail -10`——
# 三个 ✗ 分别在第 15 / 49 / 61 行，全被截在窗口外；人看到的是一排 ✓ 加一句"断点 3"，
# 于是"哪三个断点"只存在于临时目录里，下一轮只能凭印象说"那大概是偶发"。
# 规矩：判红的日志**先印失败行**（宁多勿漏），再印尾部（尾部给上下文与汇总）。
# 负控见 `--negctl-print`：把 ✗ 埋到 tail -10 够不到的位置，必须仍被印出来。
_show_log() {
  local f=$1 n
  [ -f "$f" ] || return 0
  n=$(grep -cE '✗|FAIL|FAILED|Traceback|Error|error:|FATAL' "$f" 2>/dev/null)
  n=${n:-0}
  if [ "$n" -gt 0 ]; then
    echo "      ── 失败行 ${n} 条（先印：尾部窗口不许把失败证据截掉）──"
    grep -nE '✗|FAIL|FAILED|Traceback|Error|error:|FATAL' "$f" | head -15 | sed 's/^/      /'
  fi
  echo "      ── 日志尾部 10 行（上下文）──"
  tail -10 "$f" | sed 's/^/      /'
}

NEG=""
SKIP_REF="0"
FAST=0
CHANGED=0
FORCE=0
for a in "$@"; do
  [ "$a" = "--negctl" ] && NEG="--negctl"
  [ "$a" = "--force" ] && FORCE=1
  [ "$a" = "--fast" ] && FAST=1
  [ "$a" = "--changed" ] && CHANGED=1
  [ "$a" = "--stylequick" ] && GATE_ONLY="${GATE_ONLY:-token,cardshape,icons,uniform,inset,cardfooter}"
  case "$a" in --only=*) GATE_ONLY="${a#--only=}" ;; esac
done
# 并发度：这台机器 3 路时 CPU 利用率只有 38%（实测 user+sys 62s / real 161s），
# 说明瓶颈是等待不是算力。给一个可调口子，默认 5，出问题就 GATE_JOBS=3。
JOBS=${GATE_JOBS:-5}

# ── 全绿章的唯一写入点（2026-10-28 修 E9-3：只跑子集不许盖全绿章）────────────
# 原来收尾的 case 里有两处无条件盖时间戳，**不区分档位**。于是：
#   bash tools/run-gates.sh --only=quote   跑 1 条判据、3 秒、rc=0
#   ⇒ 全绿章的 mtime 变成现在 ⇒ 下一次 --changed 认为"自上次全绿以来没改动"，整组不跑。
# **把"只跑了一部分"记成"上次全绿"**，是最贵的一种假绿：它不伪造读数，
# 它伪造的是"哪些读数还存在"——此后所有 --changed 都在为一个从没验过的状态背书。
# 现在：只有「全量 + 不是 --changed + rc=0」才写全绿章；其余写 .gate-stamp-partial 并明说没盖章。
STAMP_FILE=.gate-stamp
PARTIAL_STAMP=.gate-stamp-partial
_stamp_gate() {
  local rc_now=$1 why
  if [ -n "${GATE_ONLY:-}" ] || [ "${CHANGED:-0}" = "1" ]; then
    if [ -n "${GATE_ONLY:-}" ]; then why="点名(${GATE_ONLY})"; else why="--changed"; fi
    printf '%s\t%s\trc=%s\t未盖全绿章\n' "$(date '+%F %T')" "$why" "$rc_now" >> "$PARTIAL_STAMP"
    echo "· 本轮是【${why}】，不盖全绿章：全绿章仍是上次全量的时刻（子集记录在 ${PARTIAL_STAMP}）"
    return 0
  fi
  [ "$rc_now" = "0" ] || return 0
  printf '%s 全量 rc=0\n' "$(date '+%F %T')" > "$STAMP_FILE"
}

# ── 本轮跑过的每一个判据都要进汇总（2026-10-28 修 E9-3 第二处）────────────
# 原来汇总/判红/计数三个循环各写一份**硬编码 key 名单**，而 run_one 实际跑过的 key
# 比名单多：editunit / cross-page / list-rows / card-uniform / judgments / value-provenance
# 跑了，rc 也写进了 $TMP，但三个循环都不看它们 —— 跑红也照样 exit 0。
# （实测：editunit rc=2「撤回后没有回到改列前」，门禁全绿，没有任何人知道。）
# 现在按 $TMP 里真实存在的 .rc 文件枚举：谁跑过谁进账，以后新加判据不必再改三处名单。
_keys() {
  local f
  [ -n "${TMP:-}" ] || return 0
  for f in "$TMP"/*.rc; do
    [ -e "$f" ] || continue
    basename "$f" .rc
  done | sort
}

# ── 全绿章自检（5 例 + 1 条接线）──
# 不跑任何判据，只验"该盖的盖、不该盖的不盖"。接线断言：全脚本只能有一个写全绿章的地方。
if [ "${1:-}" = "--selftest-stamp" ]; then
  _t=$(mktemp -d); STAMP_FILE="$_t/stamp"; PARTIAL_STAMP="$_t/partial"
  _bad=0
  _case() {   # $1 期望(有|无) $2 GATE_ONLY $3 CHANGED $4 退出码 $5 说法
    rm -f "$STAMP_FILE" "$PARTIAL_STAMP"
    GATE_ONLY="$2"; CHANGED="$3"
    _stamp_gate "$4" > /dev/null
    if [ -f "$STAMP_FILE" ]; then _got=有; else _got=无; fi
    if [ "$_got" = "$1" ]; then echo "  ✓ $5（章：${_got}）"; else echo "  ✗ $5（章：${_got}，应为 $1）"; _bad=$((_bad+1)); fi
  }
  echo "── 全绿章自检"
  _case 有 ""   0 0 "全量 + rc=0 ⇒ 盖章"
  _case 无 "token" 0 0 "--only=token + rc=0 ⇒ 不盖章"
  _case 无 "token,cardshape,icons,uniform,inset" 0 0 "--stylequick + rc=0 ⇒ 不盖章"
  _case 无 ""   0 2 "全量 + rc=2 ⇒ 不盖章"
  _case 无 ""   1 0 "--changed + rc=0 ⇒ 不盖章"
  # 接线：去掉注释行后，全脚本只能有一处写全绿章。
  _w=$(grep -vE '^[[:space:]]*#' "$0" | grep -cE '>[[:space:]]*"\$STAMP_FILE"|touch[^|]*\$STAMP_FILE|touch[^|]*\.gate-stamp' || true)
  if [ "$_w" = "1" ]; then echo "  ✓ 全绿章只有一个写入点"; else echo "  ✗ 全绿章有 ${_w} 个写入点（只许 1 个）"; _bad=$((_bad+1)); fi
  GATE_ONLY=""; CHANGED=0
  rm -rf "$_t"
  if [ "$_bad" = "0" ]; then echo "全绿章自检通过（5/5 + 接线 1/1）"; exit 0; fi
  echo "全绿章自检失败：${_bad} 处"; exit 1
fi

# ── 全绿章自检的负控：在脚本副本里多塞一个越界写点，自检必须红 ──
# 只测"该盖的不盖"不够 —— 真正的历史事故是**多出一个写点**（case 里那两处 touch）。
if [ "${1:-}" = "--negctl-stamp" ]; then
  _t=$(mktemp -d); cp "$0" "$_t/copy.sh"
  # 注入行用 %s 拼装：这一行本身不许被下面的接线断言数进去（否则断言永远差 1）。
  printf '\n# 负控注入：越界写点，模拟"又有人加了一处无条件盖章"\ntouch "$%s"\n' 'STAMP_FILE' >> "$_t/copy.sh"
  bash "$_t/copy.sh" --selftest-stamp > "$_t/out.txt" 2>&1; _rc=$?
  if [ "$_rc" != "0" ]; then
    echo "负控成立（rc=2）：副本里多一个写点 ⇒ 自检判红"
    grep '✗' "$_t/out.txt" | head -3
    rm -rf "$_t"; exit 2
  fi
  echo "负控失败：多了一个写点，自检仍然绿 ⇒ 那条接线断言是空的"; rm -rf "$_t"; exit 1
fi

# ── 判红日志打印的负控：✗ 埋在 tail -10 够不到的位置，必须仍被印出来 ──────
# 这条负控同时证明两件事：① 新打印会把失败行印出来；② 这个构造本来确实会被旧打印吞掉
# （所以它不是在验一个恒真的东西）。
if [ "${1:-}" = "--negctl-print" ]; then
  _t=$(mktemp -d)
  { for i in $(seq 1 5); do echo "  ✓ 前 $i"; done; echo "  ✗ 断点甲：埋在第 6 行"; } > "$_t/bad.log"
  for i in $(seq 1 20); do echo "  ✓ 后 $i" >> "$_t/bad.log"; done
  { for i in $(seq 1 30); do echo "  ✓ 第 $i 条"; done; } > "$_t/ok.log"
  if tail -10 "$_t/bad.log" | grep -q '断点甲'; then
    echo "负控构造无效：断点甲本来就在 tail -10 里，证明不了任何事"; rm -rf "$_t"; exit 3
  fi
  if ! _show_log "$_t/bad.log" | grep -q '断点甲'; then
    echo "负控失败：第 6 行的 ✗ 被 tail -10 截掉，失败行没印出来 ⇒ 打印等于没修"
    rm -rf "$_t"; exit 1
  fi
  if _show_log "$_t/ok.log" | grep -q '失败行'; then
    echo "正控不成立：全 ✓ 的日志也印了「失败行」标题 —— 会让人以为有失败"; rm -rf "$_t"; exit 1
  fi
  echo "负控成立（rc=2）：埋在第 6 行、tail -10 够不到的 ✗ 仍被印出来；全 ✓ 的日志不印「失败行」"
  rm -rf "$_t"; exit 2
fi

# ── 成本可见性（2026-10-26 加）──────────────────────────────
# 这轮我跑了 7 次全量门禁、49 分钟纯等，但**这个代价从来没有出现在结论里**。
# 看不到代价，就没法判断"这个需求值不值得这么做"。所以每跑一次记一行。
GATE_START=$(date +%s)
case "${GATE_ONLY:-}" in
  "")            GATE_MODE=全量 ;;
  *cardshape*)   GATE_MODE=样式快档 ;;
  *)             GATE_MODE="点名(${GATE_ONLY})" ;;
esac
COST_FILE=tools/cost.tsv

# ── 复用保护（2026-11-03）──────────────────────────────────────────────
# 用户原话：「这 17 分钟里 13 分钟是你自己重复验的」。事实：全量 403s/次，
#   同一轮我跑了 3 次 —— 第 1 次被自己同时开的浏览器截图撞死，第 2 次拿到
#   "72 绿 1 红"，第 3 次只为再确认一遍。重复验不是"严谨"，是把等待成本
#   从结论里藏起来。所以给全量档加一道闸：**刚跑过、源码没变 ⇒ 拒跑**。
#   要跑就明写 --force（说明为什么这次不一样）。
gate_lock() {
  local lk=tools/.gate.lock p
  if [ -f "$lk" ]; then
    p=$(cat "$lk" 2>/dev/null || true)
    # TTL：锁超过 15 分钟一律当过期（2026-11-04 由 40 分钟下调）。
    #   原 40 分钟＝一个卡死的门禁能把整轮工作锁死 40 分钟；全量正常 403s，15 分钟足够宽。
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null && [ $(( $(date +%s) - $(stat -f %m "$lk" 2>/dev/null || echo 0) )) -lt 900 ]; then
      echo "✗ 已有一个门禁在跑（pid ${p}）。门禁不许并发：浏览器会互相抢。"
      echo "  不等：先去干别的，或 bash tools/run-gates.sh --only=<组>。rc=8"
      exit 8
    fi
    # 僵锁接管：pid 已死 / 锁龄 ≥15 分钟 ⇒ 直接接管，不再让人等。
    echo "· 接管过期门禁锁：pid ${p:-?}"
  fi
  mkdir -p tools 2>/dev/null; echo $$ > "$lk"
}
guard_rerun() {
  [ "${FORCE:-0}" = "1" ] && return 0
  [ "${GATE_MODE:-}" = "全量" ] || return 0
  [ -f "$COST_FILE" ] || return 0
  local last last_s now_s newer
  last="${DG_GUARD_LAST:-$(awk -F'\t' '$3=="全量"{t=$1} END{print t}' "$COST_FILE" 2>/dev/null)}"
  [ -z "$last" ] && return 0
  last_s=$(date -j -f "%Y-%m-%d %H:%M" "$last" +%s 2>/dev/null || date -d "$last" +%s 2>/dev/null || true)
  # 测试钩子写成不可解析的值（如 now）时必须响亮失败：静默放行 = 负控变成假绿。
  # 独立盲验 2026-11-03 实测：DG_GUARD_LAST=now 原来 rc=0，看起来"闸没拦住"。
  if [ -z "$last_s" ] && [ -n "${DG_GUARD_LAST:-}" ]; then
    echo "✗ DG_GUARD_LAST 不是可解析时刻（\"${last}\"），要 \"YYYY-MM-DD HH:MM\"。rc=2"
    exit 2
  fi
  [ -z "$last_s" ] && return 0
  now_s=$(date +%s)
  [ $((now_s - last_s)) -gt 1200 ] && return 0
  newer=$(find . -maxdepth 2 \( -name '*.html' -o -path './assets/*.css' -o -path './assets/*.js' -o -path './assets/*.webp' -o -path './assets/*.png' -o -path './tools/*.mjs' -o -path './tools/*.sh' \) -newermt "$last" -print -quit 2>/dev/null)
  [ "${DG_GUARD_NOCHANGE:-0}" = "1" ] && newer=""
  if [ -z "$newer" ]; then
    echo "✗ 拒跑：${last} 刚跑过全量，之后源码没有变动。"
    echo "  全量一次 403s。改了什么就只跑相关的：bash tools/run-gates.sh --only=<组> 或 --changed。"
    echo "  确实要再跑一次全量：加 --force。rc=8"
    exit 8
  fi
}
gate_lock
# 早退分支（判据锁 rc=4 等）在下面的 EXIT trap 之前就 exit 了，锁会留在盘上 ⇒ 这里先挂一道。
trap '[ "$(cat tools/.gate.lock 2>/dev/null || true)" = "$$" ] && rm -f tools/.gate.lock' EXIT
if [ "${1:-}" = "--guard-check" ]; then guard_rerun; echo "guard: 通过（没有可比的全量记录，或源码有变动）"; exit 0; fi
guard_rerun

# ── 找服务（脚本内不写死端口；判据自己走 tools/base.mjs）──
if [ -z "${GATE_BASE:-}" ]; then
  # ★ 2026-10-23 加身份校验：光看 200 不够 —— 另一个 worktree 里同名的 component.html
  #   也会回 200，于是判据量的可能就是另一份拷贝（本项目栽过一次：改 A 量 B）。
  #   所以除 200 外，还要比**本机这份文件的 md5**与端口上取回的一致。
  LOCAL_MD5=$(md5 -q component.html 2>/dev/null || md5sum component.html | cut -d' ' -f1)
  for p in 8941 8977 8973 8961 8951; do
    a=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:$p/app.html" 2>/dev/null)
    b=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:$p/component.html" 2>/dev/null)
    [ "$a" = "200" ] && [ "$b" = "200" ] || continue
    R=$(curl -s --noproxy '*' "http://127.0.0.1:$p/component.html" 2>/dev/null | md5 2>/dev/null || true)
    if [ "$R" = "$LOCAL_MD5" ]; then GATE_BASE="http://127.0.0.1:$p/"; break; fi
    echo "· 跳过 127.0.0.1:${p}：回 200 但内容不是这一份（md5 不一致）"
  done
fi
if [ -z "${GATE_BASE:-}" ]; then
  echo "FATAL: 找不到服务（试过 8941/8977/8973/8961/8951）"
  echo "       起法：XZ_UP_ROOT=\"\$(pwd)\" python3 ~/.workbuddy/_tools/xz-up.py 8941"
  exit 3
fi
export GATE_BASE
echo "服务：$GATE_BASE"

# ── 判据锁（2026-10-26 立）：**所有档位的第一道** ────────────────
# 它管的是"判据有没有被悄悄改"。锁红了，后面所有判据的结论都不可信 ——
# 因为"把红变绿"最快的路是改判据，而这条路现在收费：改判据必须在
# amendments.tsv 留一条记录，理由要说清"原来那条错在哪"（禁写：调整/优化/完善/适配/放宽/临时）。
# 放在快速档之前，是因为它本身就是纯文件、0.1s，没有任何理由只在全量档跑。
# ⚠ 不能用 `if ! node ...; then CRITRC=$?` —— 那样 $? 拿的是 `!` 的返回值（恒 0），
#   于是报错行会印出「（rc=0）」。判据的判断照旧对，但**打印的读数是假的**。
#   今天反复犯的正是这一类：数字看起来有，其实是错的。
node tools/check-criteria-lock.mjs > /tmp/critlock.$$ 2>&1
CRITRC=$?
if [ "$CRITRC" -ne 0 ]; then
  if [ "$CRITRC" = "3" ]; then
    echo "✗ 判据锁：读不到 lock 或台账（rc=3，未量不等于通过）"; rm -f /tmp/critlock.$$; exit 3
  fi
  echo "✗ 判据锁：有未记录的判据改动（rc=${CRITRC}）—— 门禁结果不可信，后面的都不算数"
  sed 's/^/    /' /tmp/critlock.$$ | tail -8
  echo "    修法：tools/amendments.tsv 补一行（理由要说清原来那条错在哪），再 --accept 重签"
  rm -f /tmp/critlock.$$; exit 4
fi
echo "✓ 判据锁：$(grep -m1 '一致 ' /tmp/critlock.$$ 2>/dev/null || echo 齐全)"
rm -f /tmp/critlock.$$

# ── 判据接线（2026-10-28 立；族 gate-key-dup 第三次复发）────────────────
# 病：`want <组名>` 的组名不在 want() 的 case 里时，bash 的 case 落空返回 0 ⇒ 该行**恒真**：
#   组开关失效（--changed 该跳的不跳），红还会被 grp_of 兜底的 browser 分支吞掉；
#   同一个（脚本＋参数）注册成两个 key ⇒ 一次红被数成两次。
# 为什么不靠人看：这两类错在盘面上看起来完全正常 —— 脚本能跑、门禁会绿、日志一排 ✓，
#   而"某条判据没在它该跑的时候跑"这件事只有一个信号：组名和 case 对不上。
# 它 0.1s 解析本脚本自身（注释不算注册），所以放在所有档位的第一道。
node tools/check-gate-wiring.mjs > /tmp/gatewire.$$ 2>&1
WIRERC=$?
if [ "$WIRERC" -ne 0 ]; then
  sed 's/^/    /' /tmp/gatewire.$$ | tail -14
  rm -f /tmp/gatewire.$$
  if [ "$WIRERC" = "1" ]; then
    echo "✗ 判据接线：未量（rc=1）—— 解析不出 run-gates.sh，不等于通过"
    exit 3
  fi
  echo "✗ 判据接线：红（rc=${WIRERC}）—— 有判据没按组跑 / 被重复计数，后面的读数不算数"
  echo "    修法见上面的输出（补 case 分支或删行；同命令只留一个 key）"
  exit 4
fi
echo "✓ 判据接线：$(grep -m1 'want 调用' /tmp/gatewire.$$ 2>/dev/null || echo 齐全)"
rm -f /tmp/gatewire.$$

# ── 快速档：只跑纯文件判据（不开浏览器）──
if [ "$FAST" = "1" ]; then
  echo "== 快速档（只跑静态判据）=="
  node tools/gate-copy.mjs;      F1=$?
  node tools/gate-states.mjs;    F2=$?
  node tools/token-audit.mjs;    F3=$?
  node tools/stamp.mjs --check;  F4=$?
  node tools/check-solid.mjs --static-only; F5=$?
  # S6 语法自检：大段 Edit 留下旧函数体会出 SyntaxError，一秒可查；
  # 但若没有独立 rc，e2e 的红会让人往产品问题上想 —— 错误信息的归属地错了比没有检查更坏。
  S6=0
  # ⚠ 这里必须自己 mktemp：快速档在 TMP 定义**之前**就返回了，
  #   用 $TMP 会得到一个空路径 ⇒ 重定向失败 ⇒ node --check 判非零 ⇒ 整条门假红（刚踩到）。
  SYN=$(mktemp)
  for f in assets/*.js; do
    # ⚠ 不许 2>/dev/null：语法错的全部价值就在"第几行"，吞掉 stderr 只剩一个文件名，
    # 这条判据就从"能红且指到行"退化成"能红但不好查"。独立临时文件，别和别的门的日志混。
    if ! node --check "$f" 2>"$SYN"; then
      S6=2; echo "  ✗ 语法 $f"; sed 's/^/      /' "$SYN" | head -6
    fi
  done
  rm -f "$SYN"
  # E1 空结果判定器的自检：这一轮判错过两次"0 命中"（BSD grep 不支持 \| 交替，
  # 返回空被我读成"没人用"）。它验的不是页面，是"空能不能被区分成三种"。
  node tools/lib/empty.mjs --selftest; E1=$?
  # U1 锚点契约（静态路，0.12s）：判据和小智依赖的 id / class 还在不在源码里。
  # 2026-10-26 一天内漂移三次（.kcard / #fk-chip / 装配按钮文案），每次都是人肉发现，
  # 这条只查源码里的 id 与 class —— 挡「改名 / 删节点」，文案由浏览器路兜（--stylequick）。
  node tools/check-ui-contract.mjs --static; U1=$?
  # R1 盲审时序（纯文件，0.1s）。★2026-10-26：这条原来**根本没接进任何档位** ——
  # 于是「评审早于界面改动」红了一整天，没有任何人跑过它。判据不执行＝等于没有判据。
  # 红有两个出口：真评审（blind-inputs → 零上下文评审席 → review-log）或显式豁免
  # （--waive --why <为什么这轮不需要> --by <谁>）。永久红会被无视，所以必须有出口。
  node tools/check-review.mjs; R1=$?
  # R2 盲审时序 —— ★2026-10-30 退役。用户 2026-10-29 两次定调：盲审机制移除（不派盲审、
  #   不写报告、不要求豁免）。本条要求一份「晚于产品改动的盲审报告」，等于强制一条已废除的
  #   流程，会永久红，而永久红会被无视、连带把整条快速档变成噪音。
  #   判据文件 tools/check-ux-review.mjs 保留（判据锁与负控账仍在册，文件一字未动），只是不再调用；
  #   退役登记见 tools/not-gated.tsv。要恢复：把下面这行换成 node tools/check-ux-review.mjs; R2=$?
  R2=0
  # G1 判据覆盖闸（纯文件，0.1s）。★2026-10-26：60 个判据文件里 13 个从没被调用过，
  # 含全流程唯一判据与照真源对齐判据 —— 判据不执行是整条覆盖被静默抹掉，比判据写错严重一个量级。
  # 放快速档是因为它够便宜，且"谁没被跑"这件事每轮都该看得到。
  node tools/check-gate-coverage.mjs; G1=$?
  # A1 锚点普查（0.1s）：被 ≥3 个判据依赖的锚点必须在契约里有名字。
  # 覆盖闸问『谁没被跑』，这条问『被多处依赖的东西有没有人看着』—— 两个不同维度。
  node tools/check-anchor-coverage.mjs; A1=$?
  # N1 负控台账（0.1s）：不会红的判据等于没有判据。管缺账与 30 天过期。
  node tools/check-negctl.mjs; N1=$?
  # ★2026-11-01（用户：「生成器一侧和审查器一侧都重要，但生成逻辑没有好的工作流，以后永远在改」）：
  #   四席过一遍**必须进快速档**。它一直是纯文件判据（读 tsv + 比页面 hash），
  #   却被放在 --stylequick，而干活时我只跑 --fast ——
  #   于是 2026-11-01 这一整天改了 6 个页面、一条席位读数都没写，十几次 --fast 全绿。
  #   机制不是没建（2026-10-30 就建了，理由与今天一模一样），是**没在会跑的那一档里**。
  #   判据不执行＝等于没有判据。这一行就是把路收紧：改了页面不写读数，快速档就过不去。
  node tools/check-seat-pass.mjs; S1=$?
  # E2 实体模型（0.1s，第二击判据）。★2026-11-02 独立复核抓到假绿：ENTITY 原来只在全量档跑，
  #   --fast 在它之前就 exit 0 —— 干活时只跑 --fast ⇒ 判据不执行＝没有判据（与 11-01 四席同一条教训）。
  #   独立复核还给首版判了「没守住」：只判真源格式、切片外可绕、分支改名静默通过；本版已重写并实测四类绕过。
  node tools/check-entity-model.mjs; E2=$?
  # C1 组件优先（2026-11-02 用户指出「没有先建规范/组件/令牌」）：这条一直只在全量 style 组跑，
  #   干活只跑 --fast ⇒ 页面私写组件、规范小节对不上都不会红。判据不执行＝没有判据（同 11-01 四席、11-02 实体）。
  node tools/check-component-first.mjs; C1=$?
  # B1 组件绑定（2026-11-02）：组件→规范/根选择器/令牌/状态/判据/负控/页面 七项缺一判红。
  #   原来 registry 只绑 规范小节+根选择器+页面私货，令牌/状态/判据是散的，
  #   应用卡材质断言漏检、同一选择器两处定义都无人知道。先试点两张卡，allBy 2026-11-30 补齐。
  node tools/check-component-binding.mjs; B1=$?
  # F6 卡底栏状态契约（2026-11-02）：三态同宽同形、官网 24×24、草稿 disabled 占位。
  #   这条本该早就在快速档：用户连续三轮说「卡片底部还是不一样」，而 --fast 只跑静态，
  #   于是 24px ghost + 32px 真钮、整卡 opacity 这类 computed 差异永远绿。判据不执行＝没有判据。
  node tools/check-card-footer.mjs; F6=$?
  # L6 组件生命周期（2026-11-02）：状态/负责人/复审日/替代件；只进不退才叫治理。
  node tools/check-component-lifecycle.mjs; L6=$?
  # L7 令牌源台账（2026-11-02）：tokens.css 与 DTCG JSON 双向一致；只量不改，生成链后续再做。
  node tools/token-source.mjs; L7=$?
  # D1 死 CSS（2026-11-02）：选择器引用的类名必须在页面/JS 里出现；
  #   这条是「清死 CSS」的机器形态，否则删掉的 DOM 留下的规则会一代代叠下去。
  node tools/check-dead-css.mjs; D1=$?
  echo
  echo "汇总(快)：copy=$F1 states=$F2 token=$F3 stamp=$F4 solid静态=$F5 语法=$S6 空判定=$E1 锚点契约=$U1 评审时序=$R1 盲审时序=$R2 覆盖闸=$G1 锚点普查=$A1 负控台账=$N1 四席=$S1 实体=$E2 组件优先=$C1 组件绑定=$B1 卡底栏=$F6 生命周期=$L6 令牌源=$L7 死CSS=$D1"
  if [ $F1 -eq 0 ] && [ $F2 -eq 0 ] && [ $F3 -eq 0 ] && [ $F4 -eq 0 ] && [ $F5 -eq 0 ] && [ $S6 -eq 0 ] && [ $E1 -eq 0 ] && [ $U1 -eq 0 ] && [ $R1 -eq 0 ] && [ $R2 -eq 0 ] && [ $G1 -eq 0 ] && [ $A1 -eq 0 ] && [ $N1 -eq 0 ] && [ $S1 -eq 0 ] && [ $E2 -eq 0 ] && [ $C1 -eq 0 ] && [ $B1 -eq 0 ] && [ $F6 -eq 0 ] && [ $L6 -eq 0 ] && [ $L7 -eq 0 ] && [ $D1 -eq 0 ]; then
    echo "快速档通过（收尾仍需 bash tools/run-gates.sh 全量）"
exit 0
  fi
  echo "有判红项"; exit 2
fi

# ── 全量：并发（最多 3 路）──
TMP=$(mktemp -d)
# 2026-10-25 加固：失败时**保留现场**。原写法无条件 rm -rf，一旦主进程意外死掉（被按进程树清理、
# 被 OOM 收掉），还在跑的子判据写 $key.rc 就全部报 "No such file or directory"，
# 那串错看着像判据坏了，实际是现场被自己删了 —— 一个查错的坑。
# 退出一并清自己的锁：否则死 pid 的锁会一直留着，下一个人只能靠 TTL 猜。
trap 'r=$?; [ "$(cat tools/.gate.lock 2>/dev/null || true)" = "$$" ] && rm -f tools/.gate.lock; pkill -9 -f "user-data-dir=/tmp/ia-" 2>/dev/null || true; rm -rf /tmp/ia-* 2>/dev/null || true; if [ "$r" -eq 0 ]; then rm -rf "$TMP"; else echo "（现场已保留：${TMP}）"; fi' EXIT
# 子 shell 里再兜一层：万一父提前没了，自己把目录建回来，别让 rc 写失败冒充判据失败
# ★ 2026-10-25 加单条硬超时：实测 px-refcolors.mjs 卡在"等 Chrome 回话"上 —— CPU 0%、状态 S、
#   一直不返回，而套件在 `wait` 那里等它，于是**整套永远不出结果**（表现成"跑不完"，
#   跟"跑得慢"看起来一模一样）。凡是走浏览器的判据都可能这样挂。
#   rc=124 取 timeout(1) 的约定，一眼能认出这是超时不是判拒。
STEP_TIMEOUT=${GATE_STEP_TIMEOUT:-300}
run_one() { local key=$1; shift
  # ★2026-10-26：点名跑（--only / --stylequick）**唯一生效的位置**。
  #   执行是由 `want <组> && { run_one ... }` 这一串决定的，组开关一开就整组跑；
  #   我第一版把过滤写在最后的汇总循环里，结果只改了显示、没改执行 ——
  #   --stylequick 名义上跑 5 条，实际跑了整组（实测 348 秒，比全量只少 80 秒），
  #   那种"假档"比没有更坏：它让人以为已经提速了。
  if [ -n "${GATE_ONLY:-}" ]; then
    case ",${GATE_ONLY}," in
      *",${key},"*) ;;
      *) [ -d "$TMP" ] || mkdir -p "$TMP"; echo 9 > "$TMP/$key.rc"; return 0 ;;
    esac
  fi
  ( trap - EXIT; [ -d "$TMP" ] || mkdir -p "$TMP"
    "$@" > "$TMP/$key.log" 2>&1 &
    child=$!
    waited=0
    while kill -0 "$child" 2>/dev/null; do
      if [ "$waited" -ge "$STEP_TIMEOUT" ]; then
        kill -9 "$child" 2>/dev/null
        echo "    【判据超时】${STEP_TIMEOUT}s 未返回，已终止（rc=124）。CPU 0% + 状态 S 一般是等浏览器回话。" >> "$TMP/$key.log"
        echo 124 > "$TMP/$key.rc"

exit 0
      fi
      sleep 1; waited=$((waited + 1))
    done
    wait "$child"; echo $? > "$TMP/$key.rc" ) &
}
wait_slot() { while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$JOBS" ]; do sleep 0.15; done; }
rc() { cat "${TMP:-/nonexistent}/$1.rc" 2>/dev/null || echo 9; }
# 成本台账：时刻 / 耗时 / 档位 / 红项数 / rc
_gate_cost() {
  local rc_now=$1 nred=0 k
  for k in $(_keys); do
    [ "$(rc "$k")" = "0" ] || [ "$(rc "$k")" = "9" ] || nred=$((nred + 1))
  done
  [ -f "$COST_FILE" ] || printf '时刻\t耗时s\t档位\t红项数\trc\n' > "$COST_FILE"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$(( $(date +%s) - GATE_START ))" "$GATE_MODE" "$nred" "$rc_now" >> "$COST_FILE"
  # ★变量名后面紧跟全角字符时，bash 会把多字节字符吃进变量名（$GATE_MODE（ → GATE_MODE\xef...），
#   报 unbound variable。一律用 ${VAR} 显式界定。同类踩过两次：$TMP） 与这次 $GATE_MODE（。
echo "· 本轮成本已记账：$(( $(date +%s) - GATE_START ))s / ${GATE_MODE}（${COST_FILE}）"
}

# 每项属于哪一组（--changed 时没跑的组不该算红：rc=9 是"没量"，不是"判红"）
# ⚠ 2026-10-25 修：原定义写在汇总循环**之后**（第 290 行），而循环里第 278 行就调它 ——
#   bash 顺序执行，函数未定义时调用会打印 command not found 并返回空，
#   于是「rc=9 且该组本轮没跑」这个分支永远走不到，会掉进 else 当红处理。--changed 档必踩。
grp_of() { case "$1" in
  copy|states|token|ctokens|solidst|assets|deprecated|selfcheck|valueprov|compfirst|deadend|deadcss) echo style ;;
  tokens) echo style ;;
  pred|domain) echo style ;;
  cardcopy|ccon|promise|panelia|logicwire) echo style ;;
  quote) echo style ;;
  term) echo browser ;;
  dlgfocus|confirm|versions|icons|cardshape|focusobsc|disabled|cardmenu|canvas|econtrast|reversible|geometry|stateact|formhygiene) echo browser ;;
  inset) echo inset ;;
  # ★2026-10-28：显式归组。此前靠 `*` 兜底成 browser，而 want 侧那三行恒真 ——
  # 两侧不一致时，判红会被 `if want browser` 静默吞掉（同 E9-3 那族的第二个后果）。
  cross-page|list-rows|card-uniform) echo browser ;;
  review|chain) echo self ;;
  vislint) echo vis ;;
  doctruth) echo truth ;;
  stamp|docparity) echo doc ;;
  px|pxc|links) echo px ;;
  judge) echo self ;;
  *) echo browser ;;
esac; }

# ── --changed：只跑受这次改动影响的那几组 ──────────────────────
# 为什么要有它：改一行 CSS 也跑全量（实测 161 秒），一轮要跑十几次，
# 时间全花在"跟这次改动无关的判据"上。代价是"可能漏跑"，所以：
#   · 判不准的改动（页面/数据/契约）一律退回全量，不猜
#   · 每次只记「上次全绿的时刻」；没有任何改动时明说"没改动"，不装绿
W_STYLE=1; W_PX=1; W_BROWSER=1; W_DOC=1; W_SELF=1; W_VIS=1; W_TRUTH=1; W_INSET=1
STAMP_FILE=.gate-stamp
if [ "$CHANGED" = "1" ]; then
  if [ ! -f "$STAMP_FILE" ]; then
    echo "· --changed：还没有上次全绿的时间戳，按全量跑（跑通后会写 ${STAMP_FILE}）"
  else
    FILES=$(find . -type f -newer "$STAMP_FILE" \
      \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.mjs' -o -name '*.md' -o -name '*.json' \) \
      -not -path './tools/px-baseline/*' -not -path './node_modules/*' -not -name '.gate-stamp' | sed 's|^\./||' | sort)
    if [ -z "$FILES" ]; then
      echo "· --changed：自上次全绿以来没有任何改动（不是绿，是没量）"

exit 0
    fi
    W_STYLE=0; W_PX=0; W_BROWSER=0; W_DOC=0; W_SELF=0; W_VIS=0; W_TRUTH=0; W_INSET=0
    while IFS= read -r f; do
      case "$f" in
        *.css)              W_STYLE=1; W_PX=1; W_VIS=1; W_TRUTH=1; W_INSET=1 ;;        # 样式：静态档 + 像素回归 + 视觉 lint（对比度住在 CSS 里，改色必须重量）+ 规范对账
        assets/*.js|*.html) W_STYLE=1; W_PX=1; W_BROWSER=1; W_VIS=1; W_TRUTH=1; W_INSET=1 ;;  # 逻辑/结构：全组
        tools/px-baseline/*) W_PX=1 ;;
        tools/*.mjs)        W_SELF=1; W_BROWSER=1; W_STYLE=1; W_VIS=1; W_TRUTH=1 ;;    # 判据自己变了，自检 + 重跑（style 组里也有浏览器判据：layout）
        *.md)               W_DOC=1; W_TRUTH=1 ;;                      # 文档改了，先核它有没有对实现说谎
        *.json)             W_STYLE=1; W_SELF=1 ;;
        *)                  W_STYLE=1; W_PX=1; W_BROWSER=1; W_DOC=1; W_SELF=1; W_VIS=1; W_TRUTH=1 ;;
      esac
    done <<< "$FILES"
    echo "· --changed：改动 $(echo "$FILES" | wc -l | tr -d ' ') 个文件 → 样式=$W_STYLE 像素=$W_PX 浏览器=$W_BROWSER 文档=$W_DOC 自检=$W_SELF 视觉=$W_VIS 对账=$W_TRUTH 卡内=$W_INSET"
  fi
fi
# ★2026-10-28（机制审查官）：cross-page / list-rows / card-uniform 三个组名补进 case。
#   此前这三行 `want <组名>` 的组名都不在 case 里，bash 的 case 落空返回 0 ⇒ **恒真**：
#   组开关失效，且 grp_of 把它们兜底成 browser 组 —— --changed 里 browser 没跑时红会被吞。
#   它们量的是卡片几何，与 cardshape 同属浏览器组 ⇒ 挂在 W_BROWSER 上（真开关，不是恒真）。
want() { case "$1" in style) [ "$W_STYLE" = 1 ];; px) [ "$W_PX" = 1 ];; browser) [ "$W_BROWSER" = 1 ];; doc) [ "$W_DOC" = 1 ];; self) [ "$W_SELF" = 1 ];; vis) [ "$W_VIS" = 1 ];; truth) [ "$W_TRUTH" = 1 ];; inset) [ "$W_INSET" = 1 ];; cross-page|list-rows|card-uniform|stateact|formhygiene) [ "$W_BROWSER" = 1 ];; esac; }

# ★2026-10-26 曾把 UNIFORM / CROSSPAGE / LISTROWS 标成「退役」，承载者记为 check-card-shape 的
#   C8（同页卡宽两两相等）/ C10（左缘同一套栅格）/ C9′（跨页 gap 同值 + 卡宽差有上下界）。
#   ★2026-10-28 更正：那次只改了注释，三行调用**没删**；而三个脚本在 10-27/10-28 又各自
#   「重锚」到卡片形态并拿到新负控（tools/negctl.tsv：cross-page 6/6、card-uniform 9/9、
#   list-rows 8/8），实测正控 rc=0 ⇒ 它们是活的判据，不是退役。
#   保留它们是并集比 card-shape 大：list-rows R3（引用数逐字等于 DB.APPS）/ R4（⋮ 三动作 + Esc）/
#   R6（32 卡压测首屏 ≥9），card-uniform ⑩/⑪（格顶偏移、状态开关基线），cross-page ①d/②
#   （两页留白对称、操作带上下留白对称）在 card-shape 里没有对应断言。
#   ⇒ 处置是「补真组名」，不是「按注释删活判据」。
#
# 常驻 Chrome 池：试过，**没有收益，已撤**（2026-10-23 实测）
#   walk 34.5s(池) vs 34.9s(自起)｜hit 44.1 vs 41.2｜interact 池模式假红。
#   原因：这里的耗时在"逐元素点击/探测"，不在浏览器冷启动（本机冷启动约 1 秒，不是 3 秒）。
#   并发 5 路共用 1 个 Chrome 更糟：四项假红（各自单跑全绿）。
#   ⇒ 每条判据自己 spawn，别做池。省不了时间，只会换来随机假红。

echo "── 第一批：纯文件判据"
want style && { run_one copy    node tools/gate-copy.mjs $NEG;            wait_slot; }
want style && { run_one states  node tools/gate-states.mjs $NEG;          wait_slot; }
want style && { run_one token   node tools/token-audit.mjs $NEG;          wait_slot; }
# 令牌源台账：CSS 与 DTCG JSON 双向一致（2026-11-02 接闸；此前只跑过一遍没进闸）
want style && { run_one tokensrc node tools/token-source.mjs $NEG;        wait_slot; }
want style && { run_one deadcss node tools/check-dead-css.mjs $NEG;      wait_slot; }
# 规范 ⟷ 实现 对账：DESIGN.md 的令牌表不许和 tokens.css 各说各话（改文档、改令牌都要跑）
want truth && { run_one doctruth node tools/check-design-truth.mjs $NEG;  wait_slot; }
want truth && { run_one publishparity node tools/check-publish-parity.mjs $NEG; wait_slot; }
want doc && { run_one stamp   node tools/stamp.mjs --check;             wait_slot; }
# 已作废口径还在被使用（墓碑扫描器）：纯文件，剥注释后扫
want style && { run_one deprecated node tools/check-deprecated.mjs $NEG; wait_slot; }
# 判据自己的自检：过期选择器 / bash 函数定义顺序（防"同一模式又来一次"）
want style && { run_one selfcheck  node tools/check-selfcheck.mjs $NEG;  wait_slot; }
# 四席过一遍：改过页面就必须有 product/design/frontend/ux 四份读数（2026-10-30 用户第三次追问后加）
want style && { run_one seatpass  node tools/check-seat-pass.mjs $NEG;    wait_slot; }
# 2026-10-30："没有出口的入口/状态"——菜单项必须有 data-act；状态不许挂在站外角色上。
# 触发实例：应用卡「需客户确认 v3」+ 灰掉的「需客户确认后才能升级」被指出两次（走查 P0 未修）。
want style && { run_one deadend node tools/check-no-dead-end.mjs $NEG;  wait_slot; }
# 视觉值出处（纯静态 0.15s）：每个裸值必须能回答"从哪来"。ratchet：存量放过、新增才红。
want style && { run_one valueprov  node tools/check-value-provenance.mjs $NEG; wait_slot; }
# 内联覆盖共享件 / 内联裸 px（2026-11-05 立）：设计系统被绕过的头号形态。
# 触发实例：给 .p-tabs 加 padding:0、把 .nf 宽度写死 660、给 .nf-row 内联改 flex 方向，三处全绿。
want style && { run_one inlineov node tools/check-inline-override.mjs $NEG; wait_slot; }
# 品牌蓝只能给能点的东西（2026-11-05 立）：运行时量 computed color + 可点性，不做 CSS 源码猜测。
# 实测全站 14 页 8.4 秒（单页 1.8 秒），不再是"每次加 3~5 分钟"。
want style && { run_one blueok   node tools/check-blue-clickable.mjs --all $NEG; wait_slot; }
# 令牌裸值预算（2026-10-29 接闸）：check-tokens 是 DESIGN §8「184 处」读数的来源，
# 此前既不在闸内也没登记 —— 读数在文档里被引用，却没有任何东西替它保鲜。
# 不接 --strict（存量 184 条会常红），接 --max=184 的 ratchet：新增才红；债降后由机制席下调预算。
# ★2026-11-04 退役 TOKSCAN（ctokens）：它判的是「裸值总数 ≤184」这条存量预算，与 VALUEPROV
#   （裸值必须给出处、存量放过、新增判红）判的是同一件事，且存量预算只会随重构波动、必红且无产品含义。
#   留 VALUEPROV 一条即可覆盖「新加的裸值没人管」。要恢复：把下面这行换回
#   want style && { run_one ctokens node tools/check-tokens.mjs --max=184 $NEG; wait_slot; }
# （TOKSCAN 已退役，本条不调用；登记见 tools/not-gated.tsv）
want style && { run_one solidst node tools/check-solid.mjs --static-only; wait_slot; }
# 第 17 项 REF-SNAP：真源取值冻结成带出处的样本。
# 为什么必须有：ref-parity 需要登录态，接不上就 SKIP；而"SKIP"在长时间里
# 和"绿"看起来一样 —— 这个项目栽过四次的恒绿，都是这么长出来的。
want browser && { run_one refsnap node tools/ref-snapshot.mjs --check;      wait_slot; }
# 第 18 项 AST：资源引用的完整性。assets/app-cover.png 这种情况写在 JS 字符串里
# 拼 HTML，只看 .html 的 src/href 是看不见的；真 404 时它静默变成一个灰块。
want style && { run_one assets  node tools/asset-integrity.mjs;           wait_slot; }

# ── 2026-11-04 机制修复：开浏览器批之前先收僵尸浏览器 ─────────────────────
# 实账：10:38 那次 --changed 卡在第二批 5 分钟无输出。查下来 12 个 headless Chrome
#   （--user-data-dir=/tmp/ia-*）还活着，CDP 端口 57825 已不响应 —— 上一个跑死的门禁
#   把浏览器留在盘上，下一个门禁接着开、接着卡，越卡越慢。门禁是独占的（.gate.lock），
#   所以这里可以安全地把所有 ia-* 浏览器收掉，再开本轮自己的。
if pgrep -f "user-data-dir=/tmp/ia-" >/dev/null 2>&1; then
  _n=$(pgrep -f "user-data-dir=/tmp/ia-" | wc -l | tr -d " ")
  pkill -9 -f "user-data-dir=/tmp/ia-" 2>/dev/null || true
  rm -rf /tmp/ia-* 2>/dev/null || true
  echo "  · 收掉遗留浏览器 ${_n} 个（上一轮跑死留下的）"
fi

echo "── 第二批：浏览器判据（并发 ${JOBS} 路）"
want browser && { run_one walk   node tools/walk.mjs;                       wait_slot; }
# E22/E23/E33：加一列只改本应用副本、共用件与别家应用一字不动、撤回有屏幕按钮
#   且键盘可达、8 秒收起后移出 Tab 序（真机，约 25s，含 8 秒等它自己收）。
#   为什么必须常驻：这条链路曾是**死的** —— 加列读 spec.blocks，现盘 8 个组件 spec 全是
#   null、列在 fields 里，加列分支永不触发，于是"验证"三次都验不出一条读数。
# ★2026-11-02 退役：e33 六条断言里 V4-V6 验的是「撤回」（屏幕按钮/Tab/8 秒收起），
#   而 00e §4 已按用户决定删掉撤回功能。功能不在，判据永久红；改判单位那套（check-edit-unit）
#   已补「不许再长出撤回入口」，撤回本身不再重复判。判据文件留档，退役登记见 tools/not-gated.tsv。
# want browser && { run_one structundo node tools/e33-struct-undo.mjs;      wait_slot; }
# 字段单一真源的往返（2026-10-29 接闸）：schema 里有的字段，存下去必须读得回。
# 此前写死 8941（另一个 worktree），已改走 tools/base.mjs；否则接进 8953 的套件也是"量 B 判 A"。
want browser && { run_one schema    node tools/check-schema-roundtrip.mjs $NEG; wait_slot; }
want style && { run_one tokens      node tools/gate-tokens.mjs $NEG;        wait_slot; }
want px && { run_one links       node tools/gate-links.mjs $NEG;         wait_slot; }
want browser && { run_one preview     node tools/check-preview.mjs $NEG;      wait_slot; }
# 第 24 项 L1-L3：生成页面的版式契约。补"样式数值全对、看起来不对"那一格
#   （标题带方位词 / 块间距 12 与 18 并存 / 说左右却渲染成上下）。
#   它自己注入 spec 渲染，不依赖模型 —— 所以不会因模型偶发而假红。
want style && { run_one layout      node tools/check-layout.mjs $NEG;       wait_slot; }
# 第 25 项 NB：容器不许用 1px 描边表达边界（DESIGN §1.1 第 1 条）。
#   这条是用户 2026-10-23 定的审美原则落成的命令：层次靠底色差与阴影，不靠画线。
want style && { run_one noborder    node tools/check-noborder.mjs $NEG;     wait_slot; }
want style && { run_one solid       node tools/check-solid.mjs $NEG;        wait_slot; }
# 组件规范是不是纸：components.spec.md 点名的 12 类组件，CSS 里必须真有定义、
#   不许被定义两份、props 布尔不许超过 1 个。来源：独立盲审 BLIND-PRODUCT-20261028-01
#   第 12 条「规范件作为契约是否成立 —— 未量」。
want style && { run_one speccontract node tools/check-spec-contract.mjs;    wait_slot; }
want style && { run_one compfirst  node tools/check-component-first.mjs $NEG; wait_slot; }
want browser && { run_one drag        node tools/check-drag.mjs $NEG;         wait_slot; }
# 改版单位（2026-10-27 补；此前是 11 格里唯一零判据的一格）：改一处 → 其余块逐字不变、
# 表头只追加一列、其余组件 spec/fields 不变。版本（V1–V7）与回滚（R3）都假定"一次改版有边界"，这条就是那个边界。
want browser && { run_one editunit    node tools/check-edit-unit.mjs $NEG;    wait_slot; }
# 第 28b 项 APPINV（2026-11-04 接线）：对象级状态不变量——底层 status 只能投影成三态、
#   历史值「未发布/已下架」必须落「未上架」、筛选器只给三态。此前脚本存在但没进闸（gatecover 抓到的真洞）。
want browser && { run_one appinv node tools/check-app-invariants.mjs $NEG; wait_slot; }
want style && { run_one consistency node tools/check-consistency.mjs $NEG;  wait_slot; }
# 第 26 项 CC：卡面文案溯源（2026-10-24 用户 m04062 之后加）。
#   起因：门禁全绿，卡上却长出了「页面类 / 字段 5 项 / 装配 5 个应用」这些
#   没有产品背书的东西 —— 令牌、对比度、像素都量不出"这个字存在吗"。
#   现在卡面写死的中文必须逐条对得上白名单（= data.js 字段或用户原话）。
want style && { run_one cardcopy   node tools/check-card-copy.mjs $NEG;     wait_slot; }
want style && { run_one panelia   node tools/check-panel-ia.mjs $NEG;    wait_slot; }
# 第 45 项 LOGICWIRE：规范↔判据接线（2026-11-04 立）。
#   起因：`_docs/界面通用逻辑-20261104.md` 的 12 条逻辑写成了散文，盘面上没有任何机器形状；
#   同族第 2 次踩（10:38 check-app-invariants.mjs 写了判据从没进闸，靠 gatecover 才抓到）。
#   它判的是「规范里每句有没有机器的形状」，不判判据测得对不对（那是 PRED/NEGCTL）。
want style && { run_one logicwire  node tools/check-logic-wiring.mjs $NEG; wait_slot; }
# 第 27 项 CCON：卡面信息契约（2026-10-24 用户 m04536「写代码时就缺少准备」之后加）。
#   CARDCOPY 只看得见卡面上写死的中文；`c.fields` 这种字段访问不落一句中文，它拦不到。
#   这条把"这页卡片允许出现哪些字段"写成 tools/content-contract.json，
#   双向校验：契约字段必须在 data.js 真实存在 + 页面访问不得命中 forbidden + required 必须落地。
want style && { run_one ccon       node tools/check-content-contract.mjs $NEG; wait_slot; }
# 第 36 项 QUOTE：声明式引文（「用户原话／用户口径／用户要求／他说」）必须在真实会话转写里逐字找到。
#   ★2026-10-27 事故：我把自己的推断写成「用户口径：复制客户链接 → 客户打开 → 回滚」，45 门全绿。
#   ★2026-10-28 补（盲审条件 1）：这条闸当初只在盲审里被手跑过一次 —— 它根本没进本脚本，
#     于是 check-gate-coverage 与 check-negctl 同时报「没进闸 / 没有负控账」，而它红了也没人知道。
#     纯文件 + rg，1.5 秒，所以放第一批。
want style && { run_one quote     node tools/check-quote-provenance.mjs $NEG;   wait_slot; }
# ── 第 28–34 项：交付链上四个「原本没有实体」的环节（2026-10-24，用户 m04973 之后补）──
#    TERM 界面术语一致性 ｜ PRED 装配谓词唯一 ｜ DOMAIN 数据值域与外键
#    DLGFOCUS 模态焦点契约 ｜ FOCUSOBSC 焦点不被遮挡 ｜ REVIEW 独立评审留痕 ｜ CHAIN 八环节交接物
#    共同点：这些错法都能在 30 门全绿的界面上安静发生（实测：注入「已上线」后三道门仍绿）。
want style && { run_one pred      node tools/check-predicate.mjs $NEG;      wait_slot; }
# 第 30 项 PUBEMPTY（A5，2026-11-02 补）：一个组件都不用的纯定制应用必须能直接存版/发布。
#   规则一直写在 00-交付物定义 §二.5，判据栏却是「待补断言」——只写不判，下一个人还会加回拦截。
want style && { run_one pubempty  node tools/check-publish-empty.mjs $NEG;   wait_slot; }
# 第 31 项 M3GAPS（2026-11-02 补）：M3 十格里的 6 识别而非回忆 / 7 灵活与效率 / 10 帮助与文档。
#   这三格的「现有判据」列一直是「——」，尺子缺格就永远绿。只补每格最粗的一条，不假装覆盖整条。
want style && { run_one m3gaps    node tools/check-m3-gaps.mjs $NEG;          wait_slot; }
# 第 32 项 CLIENTREG（2026-11-02 补）：客户是台账实体，不是表单里手打的一行字（用户 m01099/m01130）。
#   用户原话「没有所属客户！！傻逼吗，去客户授权里面，去配置客户」——这句话要落成会红的闸，不是落成一句备注。
want style && { run_one clientreg node tools/check-client-registry.mjs $NEG;   wait_slot; }
# 第 33 项 ENTITY（2026-11-02 补，第二击）：实体关系必须先冻结成表，代码必须跟「1 — N」对得上。
#   product-analyst §3.1 已记 2026-10-30 同类失效（三态挂错实体走 9 轮），11-02 又犯：
#   一句话（「去客户授权里配置客户」）直跳数据模型，做出全局客户台账，被真实截图推翻。
#   第二次出现 ⇒ 不许只修个案，闸必须能拦住"模型编出来"这个动作本身。
want style && { run_one entity     node tools/check-entity-model.mjs $NEG;      wait_slot; }
want style && { run_one domain    node tools/check-data-domain.mjs $NEG;    wait_slot; }
want browser && { run_one term      node tools/check-terminology.mjs $NEG;     wait_slot; }
want browser && { run_one dlgfocus  node tools/check-dialog-focus.mjs $NEG;    wait_slot; }
# 不可逆动作的二次确认（C-02/C-03）：正控 18 项，负控把 Confirm.ask 换成直接执行必须红
want browser && { run_one confirm  node tools/check-confirm.mjs $NEG;           wait_slot; }
# 版本模型（10-26 用户定的极简模型）：唯一启用 / 原子切换 / 草稿无号 / 不可变；两条负控
want browser && { run_one versions node tools/check-versions.mjs $NEG;          wait_slot; }
# 图标尺寸契约（10-26 用户那张 ⋮ 菜单巨幅图标的教训）：8–32px + 显式尺寸来源 + 同图标同尺寸
want browser && { run_one icons    node tools/check-icon-size.mjs $NEG;         wait_slot; }
# 卡片形态契约（10-26 用户「这卡片太丑了」的教训）：等高/标题1行/描述2行/操作带贴底/状态带文字/
#   卡面身份锚点（类型点+阴影+单一底色，渐变已于 10-28 退役）/两页可分
want browser && { run_one cardshape node tools/check-card-shape.mjs $NEG;      wait_slot; }
# ★2026-11-01 状态×动作矩阵：每种状态下电源按钮与 ⋮ 菜单必须等于 tools/state-matrix.json。
#   它没有 --negctl（负控靠改表验红：给未发布菜单加一项 ⇒ 立刻红），登记在 tools/negctl.tsv。
# ★2026-11-04 退役 STATEMATRIX（check-state-matrix.mjs）：它读 tools/state-matrix.json，
#   而那份表还停留在旧状态词（未发布/已下架）与旧菜单文案（编辑应用/客户授权），与真机三态
#   两套事实并存 ⇒ 每次必红、且红的原因和产品无关。三态菜单/电源/确认已由 STATEACT 按
#   tools/truth-apps-menu.json（2026-11-03 bsk 从真系统抓的）逐状态验，单一真源，留那条即可。
#   要恢复：把下面这行换回来，并把 state-matrix.json 按 tri-state 重写。
# want browser && { run_one statematrix node tools/check-state-matrix.mjs;      wait_slot; }
# 卡底栏状态契约（2026-11-02）：官网 24×24、footer 49、三态同宽；草稿电源 disabled 占位。
#   state-matrix 管「该不该有」，这条管「长成什么样」；两条互补，不能互相替代。
want browser && { run_one cardfooter node tools/check-card-footer.mjs $NEG;    wait_slot; }
want browser && { run_one focusobsc node tools/check-focus-obscure.mjs $NEG;   wait_slot; }
want browser && { run_one disabled  node tools/check-disabled-state.mjs $NEG;   wait_slot; }
want browser && { run_one cardmenu  node tools/check-card-menu.mjs $NEG;       wait_slot; }
want browser && { run_one viewmode  node tools/check-view-mode.mjs $NEG;     wait_slot; }
# ★2026-11-03：三态×菜单×确认框，真实点击（74 条像素/文案判据量不出交互对错）
want stateact && { run_one stateact  node tools/check-state-actions.mjs $NEG; wait_slot; }
# 表单卫生（2026-11-03 m04152/m04268）：图标尺寸、静态说明句、字段间距必须同一节奏。
want formhygiene && { run_one formhygiene node tools/check-form-hygiene.mjs $NEG; wait_slot; }
# 顶栏只留名字 + 版本号（2026-11-03 用户 m00984「左上角，毫无意义…就显示当前应用名称、版本号」）。
# 同族第二次：10-25 已删过一次"多余标注"，客户/状态又留了下来 ⇒ 立判据，防"再拼一句"。
want browser && { run_one topbarlean node tools/check-topbar-lean.mjs $NEG;   wait_slot; }
# 反向路径：停用→启用 / 开关点两次 / 切版本→切回（用户卡住的地方全在反方向）
want browser && { run_one reversible node tools/check-reversible.mjs $NEG;    wait_slot; }
# 几何不变量：fixed 元素不许被 transform/filter 祖先捕获（containing block 陷阱）
want browser && { run_one geometry   node tools/check-geometry.mjs $NEG;      wait_slot; }
want browser && { run_one canvas    node tools/check-canvas-empty.mjs $NEG;    wait_slot; }
want browser && { run_one econtrast  node tools/check-empty-contrast.mjs $NEG; wait_slot; }
# 视觉 lint：外部 14 条默认做法 + 全站文字对比度（自查为权威，外部做交叉核对）。约 60s，排在浏览器组最后一位
want vis && { run_one vislint node tools/check-visual-lint.mjs $NEG; wait_slot; }
# 第 35 项 LISTROWS：组件库「单列行式列表」六条（2026-10-25 换形之后补）。
#   为什么必须要：页面从「4 列卡片阵列」整段换成「一张白面板 + 一行一个组件」之后，
#   UNIFORM / CROSSPAGE 量的是 .kcard 的卡几何 —— 卡壳没了，这两条在组件页面上**没有对象可量**，
#   于是页面可以长出「行高不等 / 表头与行列左缘错位 / 名称被截成…却无 title / 引用列写着不存在的应用名
#   / ⋮ 淡到看不见 / 30 条时一屏只剩 3 行」这些错法，而全量门依旧全绿（实测过）。
#   它量的是行，不是卡：R1 行高·列左缘·溢出｜R2 不截断｜R3 引用名逐字溯源｜R4 ⋮ 对比/盒子/菜单/Esc｜
#   R5 两页结构可分｜R6 32 行首屏 ≥9 行。
want self && { run_one review node tools/check-review.mjs $NEG; wait_slot; }
want self && { run_one chain  node tools/check-chain.mjs $NEG;  wait_slot; }
# 第 22 项 COVER：判据覆盖闸（纯文件，0.1s）。
#   ★2026-10-26 实测：tools/ 下 60 个判据文件，本脚本只调用 47 个，**13 个从来没跑过** ——
#   包括全流程唯一判据 e2e-flow、照真源对齐的 configurator-parity、可见性 visible-audit。
#   判据写错只错一条；判据不执行是整条覆盖被静默抹掉，而账面上完全看不出来。
#   没进闸可以，但必须在 tools/not-gated.tsv 登记「为什么不进闸 + 谁覆盖 + 到期日」。
want self && { run_one gatecover node tools/check-gate-coverage.mjs $NEG; wait_slot; }
# 第 23 项 E2E：全流程能不能走通（三条业务流程，只判"能不能从入口走到出口"，不管样式）。
#   ★2026-10-26：这条判据存在了很久，但从来没进闸 —— 于是"全流程 19 个断点"要等用户问才暴露。
#   它比任何单点判据都值钱：门禁全绿而流程断着，用户依然做不完一件事。
want browser && { run_one e2e node tools/e2e-flow.mjs $NEG; wait_slot; }
# 第 24 项 TOKSCALE：字号档位一致性（档位读自 tokens.css）。
want self && { run_one tokscale node tools/check-token-scale.mjs $NEG; wait_slot; }
# 第 25 项 STRUCT：结构树（区在不在）。★2026-10-26 零上下文盲审的 P0 原话：
#   「纯文字白卡之所以全绿，是因为它没有违反任何一条已列的轴 —— 它只是少了整整一个区」。
#   在此之前的判据全在量尺寸/颜色/间距，卡片少一个描述区/操作带/状态徽标时它们全部照旧通过。
#   每区判三条：found / visible / content（input 判 value，不判 textContent）。
want browser && { run_one struct node tools/check-structure.mjs $NEG; wait_slot; }
# 第 35 项 PR：卡面承诺兑现（29 句只兑现 5 句那次之后立）。卡面写什么，屏幕就得有什么。
want style && { run_one promise node tools/check-promise.mjs $NEG; wait_slot; }
# 第 19 项 PX：视觉回归（我的今天 vs 我的冻结基线）。
#   为什么单列：CSS 判据全绿而画面变了，只有像素能看出来。基线带 at，超 60 天判红。
want px && { run_one px          node tools/px-parity.mjs --check;       wait_slot; }
# 第 21 项 PXC：像素自证（computed 底色 vs 截图像素众数色）。
#   能抓 computed 说谎那类事故，单独成文件是为了有自己的一支负控。
want px && { run_one pxc         node tools/px-refcolors.mjs;            wait_slot; }
# 第 20 项 IA：按点击探哑控件。"点了没反应"是本项目复发率最高的毛病。
#   ⚠ 只覆盖 click 一种动作；hover 才出现的控件目前无人覆盖。
want browser && { run_one interact    node tools/interact-audit.mjs $NEG;     wait_slot; }
wait

# ── 判据自检单独跑，不与浏览器判据并发。
#   为什么挪出来：check-judgments 会用 --negctl 逐条跑所有工具，其中
#   asset-integrity 的负控要临时改名一个真实资源文件 —— 和 preview/solid
#   并发时会出现"某条浏览器判据突然红"的假现场，而那个红是自检造出来的。
want self && { run_one judge node tools/check-judgments.mjs --quick; wait_slot; }
wait

# ── 第 14 项：与真源的逐角色对齐（ref-parity）。
#    这一项和上面 13 项的性质不同：上面量的是"我自己的规范有没有被执行"，
#    这一项量的是"我的规范本身像不像线上"。没有它，规范偏了判据只会一起偏。
#    真源需要登录态、要连内网 ⇒ 连不上时明确打 SKIP，不算绿、不算红。
# ── 第 15 项：规范文档 vs 代码的对账（doc-parity）。
#    所有判据都拿 DESIGN.md 当输入，可它自己是唯一没被验过的资产 —— 实测当场漂了 5 处。
want doc && { run_one docparity node tools/doc-parity.mjs; wait_slot; }
# ── 第 16 项：不可见浮层吃点击（hit-audit）。e2e 与 walk 都抓不到这一类。
want browser && { run_one hit node tools/hit-audit.mjs; wait_slot; }
# ── 第 16b 项：卡内左缘（inset）。
#    盲评第八轮报「卡内内容左缘 228 与 234 差 6px」，实测是 4px（.kcard-hit 16 vs .card-ft 12）。
#    这类 1–10px 级偏差单卡看不出，六张并排就集体歪一条线；它纯几何，必须由判据管。
want inset && { run_one inset node tools/check-inset.mjs $NEG; wait_slot; }
want cross-page && { run_one cross-page node tools/check-cross-page.mjs $NEG; wait_slot; }
want list-rows && { run_one list-rows node tools/check-list-rows.mjs $NEG; wait_slot; }
want card-uniform && { run_one card-uniform node tools/check-card-uniform.mjs $NEG; wait_slot; }
# ★2026-10-28 删重复注册（本行原来是 `run_one value-provenance node tools/check-value-provenance.mjs $NEG`）：
#   与上面 `run_one valueprov node tools/check-value-provenance.mjs $NEG` 那一行是
#   **同一个脚本、同一组参数、两个 key** ⇒ 一次红被数成两次。
#   实测（--only=valueprov,value-provenance --negctl）：顶层 ✗ 2 条、成本台账红项数 2、实际只跑 1 个脚本。
#   存活的是 valueprov，因为它①在 grp_of 里归 style 组（--changed 能按组正确跳过）
#   ②汇总 case 里有自己的一行标题；被删的这条两个都没有。
#   第二个坑（同 E9-3 那行 judgments 同族）：`want value-provenance` 的组名在 want() 里**不存在**，
#   case 落空返回 0 ⇒ 恒真（实测 `W_BROWSER=0 want value-provenance` rc=0，`want browser` rc=1），
#   于是连「样式组本轮没跑」时它也照跑；而 grp_of 把它兜底成 browser 组，
#   红了在 --changed 档会被 `want browser` 分支直接吞掉 —— 既重复计数，又会静默吞红。
# ★2026-10-28 删（E9-3 第二处）：这里原来还有一行
#   `want judgments && { run_one judgments node tools/check-judgments.mjs $NEG; }`
# 两个问题叠在一起：
#   ① `want` 里根本没有 `judgments` 这个组名，case 落空 ⇒ 它恒真 ⇒ **每一次全量门禁都在跑**；
#   ② 它的 rc 不在任何汇总名单里 ⇒ 跑红也没人知道（本轮实测：REF 的负控 rc=3「未量」，
#      整条自检是红的，而门禁照样 exit 0）。
# 处理：全量去重。`judge`（--quick）已经覆盖台账+主体；每条工具的负控由本脚本
# `--negctl` 档逐个真跑（run-gates --negctl）。把"全部工具的负控"再嵌一层，
# 既重复又会让 ref-parity 这类需要登录态的负控把整轮门禁永久染红（永久红＝所有人学会无视它）。
wait

if [ "$SKIP_REF" = "1" ]; then
  echo "  － 真源对齐（ref-parity）：SKIP（本轮显式跳过，--no-ref）"
  REFRC=9
else
  run_one refparity node tools/ref-parity.mjs; wait_slot
  wait                      # 这一项要真跑完再读 rc：只 wait_slot 会读到还没写完的文件
  REFRC=$(rc refparity)
fi

echo
# ★2026-10-28（E9-3 第二处）：枚举 $TMP 里真实存在的 .rc，不按手写名单 ——
# 手写名单漏了 6 条实际在跑的判据（editunit 实测 rc=2，门禁照样全绿）。
# 这条与上面的 _keys 是同一份真源：打印、判红、计数、成本台账四处都读它。
KEYS=$(_keys)
NKEYS=$(printf '%s\n' "$KEYS" | grep -c . || true)
for k in $KEYS; do
  # ★2026-10-26：这里原来没有兜底，`set -u` 下只要漏写一个 case 就整条门禁停摆，
  #   而且崩在"第一批纯文件判据"之后 —— 跑起来的前半段看起来一切正常，最后只吐一句
  #   `title: unbound variable`。今天接 promise 判据时就撞了一次：判据一条没跑，
  #   却被当成"门禁在跑"。漏一个 case 不该关掉整条门禁，所以先给空值再兜底成 key 本身。
  title=""
  case $k in
    doctruth) title="DOCTRUTH 规范对账（DESIGN.md 令牌表 vs tokens.css 现值 + 对比度）";;
    inset) title="INSET 卡内左缘（标题/说明/元信息/底栏动作同一条线）";;
    vislint) title="VISLINT 视觉默认做法 + 全站文字对比度（可读性四项必须为零）";;
    cardcopy) title="CC 卡面文案溯源（每段中文必须指回字段或客户原话）";;
    panelia) title="PANELIA 装配/升级落点与内部话术（升级只住已装配页签，顶栏无独立升级）";;
    logicwire) title="LOGICWIRE 规范↔判据接线（每个 L# 有判据，或判定人+到期日）";;
    ccon) title="CCON 卡面信息契约（allowed/forbidden/required 双向校验）";;
    quote) title="QUOTE 声明式引文（用户原话必须在会话转写里逐字找到）";;
    pred) title="PRED 装配谓词唯一（DB.canInstall 一处定义）";;
    domain) title="DOMAIN 数据值域与外键（status/enabled/version/APP_COMPS）";;
    term) title="TERM 界面术语一致性（同义词不上屏）";;
    dlgfocus) title="DLGFOCUS 模态弹窗焦点契约（APG 四条）";;
    confirm) title="CONFIRM 不可逆动作先问一句（停用/发布）";;
    versions) title="VERSIONS 版本模型（草稿/正式/唯一启用 + 四条死命令）";;
    promise) title="PR 卡面承诺兑现（卡面写的话，画面上必须找得到对应物）";;
    icons) title="ICONS 内联 SVG 尺寸契约（8–32px / 显式来源 / 同图标同尺寸）";;
    cardshape) title="CARDSHAPE 卡片形态契约（等高/行数/操作带/渐变可见/间距档位）";;
    focusobsc) title="FOCUSOBSC 焦点不被浮层遮挡（WCAG 2.4.11）";;
    disabled) title="DISABLED 已禁用态（chip / canInstall 谓词 / 装配候选 三处同判）";;
    valueprov) title="VALUEPROV 视觉值出处（裸值必须有出处，存量放过、新增判红）";;
    selfcheck) title="SELFCHECK 判据自检（过期选择器 / 函数定义顺序）";;
    deprecated) title="DEPRECATED 已作废口径还在被使用（剥注释后扫）";;
    geometry) title="GEO fixed 元素没被 transform 祖先捕获（containing block）";;
    reversible) title="REVERSE 反向路径（停用→启用 / 开关可逆 / 切版本可回）";;
    cardmenu) title="CARDMENU 卡片 ⋮ 更多操作（悬停揭示 / 真结果 / 键盘）";;
    canvas) title="CANVAS 画布空态（有内容或带引导空态，不许纯空白）";;
    appinv) title="APPINV 对象级状态不变量（三态投影 / 历史值 / 筛选器）";;
    econtrast) title="ECONTRAST 首屏空态对比度（主句≥7 / 说明与示例≥4.5 / 输入占位≥3）";;
    review) title="REVIEW 独立评审留痕（评审晚于最后改动）";;
    chain) title="CHAIN 交付链八环节交接物";;
    copy) title="J4 词表";;
    states) title="J5 状态矩阵（DESIGN §4.7 缺失时记未量，不指错方向）";;
    token) title="T1 令牌映射完整性";;
    ctokens) title="TOKSCAN 令牌裸值预算（存量 184，超过即红）";;
    schema) title="SCHEMART 字段单一真源往返（存得下/读得回）";;
    stamp) title="S1 资源版本号";;
    solidst) title="R3/R5 静态";;
    tokens) title="J1/J2/J3/J6 取值·对比度·同构·骨架";;
    links) title="J7 跳转与可操作";;
    preview) title="P1 画布骨架";;
    layout) title="L1-L3 生成页版式契约（方位词/块间距/并排等宽）";;
    noborder) title="NB 容器不许用描边表达边界（层次靠底色差+阴影）";;
    viewmode) title="VIEWMODE 客户视图（?mode=view）不许漏出管理控件";;
    stateact) title="STATEACT 三态·菜单·反馈（真实点击，负控必红）";;
    formhygiene) title="FORMHYGIENE 表单卫生（图标/静态说明/间距，负控必红）";;
    topbarlean) title="TOPBARLEAN 顶栏只留应用名 + 版本号（含 A6 历史版本入口唯一）";;
    publishparity) title="PUBPARITY 本地改动已发布到公网（用户看到的就是最新的）";;
    solid) title="R1-R9 界面是不是实的";;
    drag) title="D1-D5 拖动与刷新保留";;
    consistency) title="C1-C4/C7 同类一致性";;
    judge) title="Q1 判据自检";;
    walk) title="W1 穷举走查（所有可点元素逐个点，找死控件与未定义样式）";;
    hit) title="H1 不可见浮层不许吃点击（elementFromPoint 实测）";;
    docparity) title="D2 规范文档 vs 代码对账（文档自己也要被验）";;
    refsnap) title="REF-SNAP 真源样本冻结（出处/新鲜度/角色对齐）";;
    assets) title="AST 资源完整性（含写在 JS 字符串里的引用）";;
    px) title="PX 视觉回归（对冻结基线，非对真源）";;
    interact) title="IA 按点击探哑控件（不等于界面没有哑控件）";;
    pxc) title="PXC 像素自证（computed 底色 vs 像素众数）";;
  esac
  title="${title:-$k}"
  r=$(rc "$k")
  if [ "$r" = "0" ]; then
    echo "  ✓ $title"
  elif [ "$r" = "9" ]; then
    # rc=9 的定义就是"没量"：--changed 跳过的组、--only/--stylequick 名单外的判据、
    # 以及根本没启动的，都落在这里。
    # ★2026-10-26 修：原来条件是「9 且该组没跑」，于是点名跑时名单外那几条
    #   走了 else 分支，被印成一排 ✗（rc=9）—— 看上去像"七条判红"，
    #   实际一条都没跑。**把"没量"显示成"判红"，比不显示更坏。**
    if [ -n "${GATE_ONLY:-}" ]; then
      echo "  － ${title}（本轮未跑：不在点名名单里）"
    else
      echo "  － ${title}（本轮未跑：--changed）"
    fi
  else
    echo "  ✗ ${title}（rc=${r}）"
    _show_log "$TMP/$k.log"
  fi
done

# ── fail-closed 哨兵（2026-10-26 加，依据调研 M4）────────────────
# 判据"一条都没跑"和"全跑完全绿"在退出码上长得一样。这里数真实跑过的条数，
# 低于下限就判**环境问题（rc=3）**而不是绿。
# 依据：调研指出「agent 能看见的唯一信号是 check 变绿」，所以"没跑"必须和"通过"分开。
NRUN=0
for k in $KEYS; do
  r=$(rc "$k")
  [ "$r" = "9" ] || NRUN=$((NRUN + 1))
done
GATE_MIN_RUN=${GATE_MIN_RUN:-18}
# 只在全量模式判：点名跑（--only / --stylequick / --fast）本来就只跑几条，
# 拿同一个下限去卡它，等于把"我故意少跑"当成"环境坏了"。
if [ -z "${GATE_ONLY:-}" ] && [ "$NRUN" -lt "$GATE_MIN_RUN" ]; then
  echo
  echo "✗ 哨兵：本轮只跑了 ${NRUN} 条判据（下限 ${GATE_MIN_RUN}）—— 这不是绿，是没量完"
  echo "  常见原因：服务没起、浏览器抢资源、点名跑漏了清单。"
  _gate_cost 3; exit 3
fi

echo
# ★2026-10-28：枚举的是 $TMP 里真实存在的 .rc，不是手写名单 —— 手写名单漏了 6 条
#   实际在跑的判据（editunit 实测 rc=2 也没人知道）。谁跑过谁进账。
KEYS=$(_keys)
echo "枚举 ${NKEYS} 个判据键 ｜ 实际跑过 ${NRUN} 条（其余 rc=9＝本轮未跑，不计入绿）"
for k in $KEYS; do
  r=$(rc "$k")
  [ "$r" = "0" ] && continue
  # 点名跑时，名单外的那几条 rc=9 是"本轮未跑"，不许算成红
  if [ -n "${GATE_ONLY:-}" ]; then
    case ",${GATE_ONLY}," in *",${k},"*) ;; *) continue ;; esac
  fi
  g=$(grp_of "$k")
  if want "$g"; then echo "有判红项（$k rc=${r}）"; _gate_cost 2; exit 2; fi
  # 这一组本轮没跑 —— 明说，不混进绿里
done
case "$REFRC" in
  0) if [ -n "${GATE_ONLY:-}" ]; then echo "点名跑通过（只跑了 ${GATE_ONLY}；**这不是全绿**，全量收尾仍需 bash tools/run-gates.sh）"; else echo "ALL GREEN（含真源对齐 0 差异）"; fi;;
  2) echo "有判红项：与真源的逐角色对齐有差异"; _gate_cost 2; exit 2;;
  9|*) if [ -n "${GATE_ONLY:-}" ]; then echo "点名跑结束（内部 rc 已判；真源对齐本轮未跑 —— 这不是全绿）"; else echo "ALL GREEN（内部 13 项）；真源对齐未执行 —— 这不是绿，是没量"; fi;;
esac
# ★2026-10-28（E9-3）：盖章只在 _stamp_gate 一处。全量且 rc=0 才写全绿章；
#   点名/--changed 只记 .gate-stamp-partial；真源未对齐（rc=9）不算全绿，不盖章。
_stamp_gate "$REFRC"
_gate_cost 0
exit 0
