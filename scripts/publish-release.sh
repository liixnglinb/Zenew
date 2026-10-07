#!/usr/bin/env bash
# 知新 Zenew 双通道发版：安装版 + Windows 绿色版，共用 latest.json
set -euo pipefail

REPO="liixnglinb/Zenew"
ROOT="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; } | tr -d '\r\n')"
CONF="$ROOT/app/src-tauri/tauri.conf.json"
BUNDLE="$ROOT/app/src-tauri/target/release/bundle/nsis"
OUT="$ROOT/release"

VERSION=$(python -c "import json,io;print(json.load(io.open(r'$CONF',encoding='utf-8'))['version'])")
TAG="v$VERSION"
SETUP_SRC="$BUNDLE/Zenew_${VERSION}_x64-setup.exe"
SIG_SRC="$SETUP_SRC.sig"
GREEN_SRC="$OUT/Zenew_${VERSION}_x64_green.zip"
GREEN_SIG="$GREEN_SRC.sig"

[ -f "$SETUP_SRC" ] || { echo "找不到安装包：$SETUP_SRC"; exit 1; }
[ -f "$SIG_SRC" ] || { echo "找不到安装包签名：$SIG_SRC"; exit 1; }
[ -f "$GREEN_SRC" ] || { echo "找不到绿色版：$GREEN_SRC（先运行 python scripts/build-portable.py）"; exit 1; }
[ -f "$GREEN_SIG" ] || { echo "找不到绿色版签名：$GREEN_SIG（使用同一 minisign 私钥签名 ZIP）"; exit 1; }

mkdir -p "$OUT"
cp "$SETUP_SRC" "$OUT/Zenew-Setup.exe"
cp "$SIG_SRC" "$OUT/Zenew-Setup.exe.sig"

python "$ROOT/scripts/make-latest-json.py"

# GitHub 作为海外镜像；国内 CDN/OSS 由发布机或 CI 同步 release/ 目录。
echo "→ 创建 Release $TAG"
gh release create "$TAG" \
  "$OUT/Zenew-Setup.exe" \
  "$OUT/Zenew-Setup.exe.sig" \
  "$OUT/Zenew_${VERSION}_x64_green.zip" \
  "$OUT/Zenew_${VERSION}_x64_green.zip.sig" \
  "$OUT/latest.json" \
  --repo "$REPO" \
  --title "$TAG" \
  --notes "${RELEASE_NOTES:-Zenew $TAG}"

echo "✓ 发版完成：$TAG"
