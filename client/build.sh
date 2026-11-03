#!/usr/bin/env bash
# 达观智能审核平台 · 桌面客户端打包
#
# 产出（写入 ../downloads/，该目录不入库）：
#   达观智能审核平台-<版本>-mac-arm64.dmg
#   达观智能审核平台-<版本>-windows-x64.zip
#   manifest.json   ← 下载页只认这一份，页面上不写死版本号/大小/校验值
#
# 为什么不用 electron-packager / electron-builder：
#   本机 Node 26 下 @electron/packager 会**打印一行就静默退出**（exit 0、无产物），
#   electron-builder 交叉打 Windows 还要 wine。这里直接拿 Electron 官方 zip 组装，
#   每一步都可控、可复现，也不依赖 Windows 工具链。
#
# 用法： bash build.sh            （两个平台都打）
#        bash build.sh mac|win    （只打一个）
set -euo pipefail
cd "$(dirname "$0")"

VER=$(node -p "require('./package.json').version")
MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
EVER="${ELECTRON_VERSION:-32.3.3}"
OUT="../downloads"
DIST="dist"
APPSRC=(main.js setup.html setup-preload.js package.json icon.png)

mkdir -p "$OUT" "$DIST"

say() { printf '\n▸ %s\n' "$*"; }

fetch() { # fetch <平台arch后缀> <解压目标>   —— 装过一次就落 .cache，重打不再下载
  local arch="$1" dest="$2" zip
  mkdir -p .cache
  zip=".cache/electron-v$EVER-$arch.zip"
  if [ ! -f "$zip" ]; then
    say "下载 electron-v$EVER-$arch.zip"
    curl -fsSL -o "$zip" "$MIRROR/$EVER/electron-v$EVER-$arch.zip"
  fi
  rm -rf "$dest"; mkdir -p "$dest"
  unzip -q "$zip" -d "$dest"
}

build_mac() {
  local app="dist/mac/达观智能审核平台.app"
  fetch darwin-arm64 "$DIST/mac"
  mv "$DIST/mac/Electron.app" "$app"
  rm -f "$app/Contents/Resources/default_app.asar"
  mkdir -p "$app/Contents/Resources/app"
  cp "${APPSRC[@]}" "$app/Contents/Resources/app/"
  cp icon.icns "$app/Contents/Resources/electron.icns"
  /usr/libexec/PlistBuddy \
    -c "Set :CFBundleDisplayName 达观智能审核平台" \
    -c "Set :CFBundleName 达观智能审核平台" \
    -c "Set :CFBundleIdentifier cn.daguan.review.client" \
    -c "Set :CFBundleShortVersionString $VER" \
    -c "Set :CFBundleVersion $VER" \
    "$app/Contents/Info.plist"
  # ad-hoc 签名：Apple 芯片上未签名的 app 打不开。正式发版需换开发者证书并做公证。
  codesign --force --deep --sign - "$app" >/dev/null 2>&1

  local dmg="$OUT/达观智能审核平台-$VER-mac-arm64.dmg"
  say "生成 dmg"
  rm -rf /tmp/dg-dmg && mkdir -p /tmp/dg-dmg
  cp -R "$app" /tmp/dg-dmg/
  ln -s /Applications /tmp/dg-dmg/Applications   # 拖进「应用程序」的落点
  hdiutil create -volname "达观智能审核平台" -srcfolder /tmp/dg-dmg -ov -format UDZO "$dmg" >/dev/null
  rm -rf /tmp/dg-dmg
}

build_win() {
  fetch win32-x64 "$DIST/win"
  rm -f "$DIST/win/resources/default_app.asar"
  mkdir -p "$DIST/win/resources/app"
  cp "${APPSRC[@]}" "$DIST/win/resources/app/"
  say "写 exe 图标与版本信息"
  # Electron 的 exe 默认长着 Electron 的脸；resedit 纯 JS 改 PE 资源，不需要 wine。
  node ./brand-win.cjs "$DIST/win"
  # 子 shell 里会 cd 到 dist/win，路径必须先转成绝对路径，否则 zip 会写到 dist/downloads 去
  local zip
  zip="$(cd "$OUT" && pwd)/达观智能审核平台-$VER-windows-x64.zip"
  say "打包 zip"
  # 用 Python 打：macOS 自带 zip 不给中文名写 UTF-8 标志位，Windows 上会解成乱码
  python3 ./pack-zip.py "$DIST/win" "$zip"
}

case "${1:-all}" in
  mac) build_mac ;;
  win) build_win ;;
  all) build_mac; build_win ;;
  *) echo "用法: bash build.sh [mac|win|all]"; exit 2 ;;
esac

say "写 manifest.json（下载页读它）"
node ./make-manifest.cjs "$VER" "$OUT"
ls -lh "$OUT"

# 下载页上的版本 / 大小 / 校验值是从**刚打出来的包**现算的 —— 每打一次包，这一页的像素就会变。
# 这是数据驱动，不是回归：看过差异、确认只是包变了之后，只重冻这一页（别整站重冻）。
cat <<'TIP'

提示：manifest 变了，下载页会与视觉基线不同。
     确认差异只是版本/大小/校验值之后，只重冻这一页：
       node ../tools/px-parity.mjs --page downloads.html --write-baseline
TIP
