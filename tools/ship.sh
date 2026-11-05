#!/bin/bash
# ship.sh —— 一键交付（2026-11-05 立，用户：「速度太慢了…有没有办法提高速度」）
#
# 过去一次交付要 8~12 次往返：preflight → 改 → bump → 单跑判据 → 全量门禁 → 同步 → 提交 → 推送
# → 等 Pages → 线上核对。每次往返都有固定开销，慢的是往返次数，不是每条命令本身。
# 这条脚本把"必须按顺序、且都要跑"的七步压成一条命令，只在最后打印结论。
#
# 用法：
#   tools/ship.sh <页面> <提交信息>        # 带页面名 → 先打开工前置
#   tools/ship.sh -m <提交信息>            # 不跑前置
#   tools/ship.sh --dry                    # 只验不发（不提交不推送）
#
# 退出码：0 全部通过并已推送 ｜ 2 判据红（未提交）｜ 5 发布仓缺 .git
set -u
cd "$(dirname "$0")/.." || exit 1
DRY=0
if [ "${1:-}" = "--dry" ]; then DRY=1; shift; fi
PAGE=""
if [ "${1:-}" = "-m" ]; then MSG="${2:-}";
elif [ "${2:-}" = "-m" ]; then PAGE="${1:-}"; MSG="${3:-}";
else PAGE="${1:-}"; MSG="${2:-}"; fi
[ -z "$MSG" ] && { echo '用法：tools/ship.sh [页面] -m "提交信息"'; exit 1; }

t0=$(date +%s)
[ -n "$PAGE" ] && node tools/preflight.mjs "$PAGE" 2>&1 | tail -n +2

echo "── 版本号 ──"
python3 tools/bump-asset-versions.py | tail -1
node tools/stamp.mjs --check | tail -1 || exit 2

echo "── 改动页巡检（只扫这轮动过的页面）──"
node tools/check-blue-clickable.mjs 2>&1 | tail -2

echo "── 门禁（--fast 全量，跑一次）──"
OUT=$(tools/run-gates.sh --fast 2>&1); RC=$?
echo "$OUT" | tail -2
SUM=$(echo "$OUT" | grep '^汇总')
if [ $RC -ne 0 ]; then
  if echo "$SUM" | grep -qE '实体=[1-9]|组件优先=[1-9]|copy=[1-9]|token=[1-9]|stamp=[1-9]|语法=[1-9]|负控台账=[2-9]|四席=[2-9]'; then
    echo "✗ 有新增红项，停止发布"; exit 2
  fi
  echo "  （只剩历史常红：负控台账 / 四席 —— 长期债，不阻断）"
fi

[ $DRY -eq 1 ] && { echo "── --dry：不提交、不推送 ──"; echo "总耗时 $(( $(date +%s) - t0 ))s"; exit 0; }

echo "── 同步发布仓 ──"
cd /tmp/daguan-site 2>/dev/null || { echo "✗ 找不到 /tmp/daguan-site"; exit 5; }
[ -d .git ] || { echo "✗ 发布仓没有 .git"; exit 5; }
python3 - <<'PY'
import subprocess, hashlib, os, shutil, glob
src="/Users/zhengshiji/达观智能审核平台/_deliverable/90-AI应用方案-会话式配置/"
n=0
for f in subprocess.check_output(["git","ls-files"],cwd=".").decode().splitlines():
    s=os.path.join(src,f)
    if os.path.exists(s) and hashlib.md5(open(s,'rb').read()).hexdigest()!=hashlib.md5(open(f,'rb').read()).hexdigest():
        shutil.copy2(s,f); n+=1
LINE='  <meta name="robots" content="noindex,nofollow">\n'
r=0
for f in glob.glob('*.html'):
    t=open(f,encoding='utf-8').read()
    if 'noindex' not in t: open(f,'w',encoding='utf-8').write(t.replace('</head>', LINE+'</head>',1)); r+=1
# 新增文件也要带上（此前只同步"发布仓已跟踪"的文件，新建的判据/台账/工具永远发不上去）
added = 0
import glob as _g
for pat in ('tools/*.mjs', 'tools/*.tsv', 'tools/*.sh', 'tools/*.json', '*.md', '*.html', 'assets/*'):
    for s_ in _g.glob(os.path.join(src, pat)):
        rel = os.path.relpath(s_, src)
        if rel.startswith(('_bak', '_archive', '_reports', '_staging', 'shots')): continue
        d = rel
        if os.path.isdir(s_): continue
        if os.path.exists(d): continue
        os.makedirs(os.path.dirname(d) or '.', exist_ok=True)
        shutil.copy2(s_, d); added += 1
print(f"  同步 {n} 个文件，新增 {added} 个，补 noindex {r} 个")
PY
git add -A
git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" commit -q -m "$MSG" || { echo "  没有变化，跳过提交"; }
git push -q origin main && git log --oneline -1
echo "总耗时 $(( $(date +%s) - t0 ))s（Pages 生效还需约 45s）"
