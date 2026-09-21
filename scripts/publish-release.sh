#!/usr/bin/env bash
# 知新 Zenew 一键发版：读版本 → 改名固定名 → 生成 latest.json → 创建 GitHub Release
# 用法：bash scripts/publish-release.sh
# 前置：已用 TAURI_SIGNING_PRIVATE_KEY 完成 npm run tauri build
set -euo pipefail

REPO="liixnglinb/Zenew"
# git-bash 下 pwd 给 /d/... 形式，Windows 原生 python/gh 不认，必须转成 D:/... 形式（并剥掉 pwd -W 带的 \r）
ROOT="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; } | tr -d '\r\n')"
CONF="$ROOT/app/src-tauri/tauri.conf.json"
BUNDLE="$ROOT/app/src-tauri/target/release/bundle/nsis"
OUT="$ROOT/release"

VERSION=$(python -c "import json,io;print(json.load(io.open(r'$CONF',encoding='utf-8'))['version'])")
TAG="v$VERSION"
SETUP_SRC="$BUNDLE/Zenew_${VERSION}_x64-setup.exe"
SIG_SRC="$SETUP_SRC.sig"

[ -f "$SETUP_SRC" ] || { echo "找不到安装包：$SETUP_SRC（先跑 npm run tauri build）"; exit 1; }
[ -f "$SIG_SRC" ]   || { echo "找不到签名文件：$SIG_SRC（构建时需设置 TAURI_SIGNING_PRIVATE_KEY）"; exit 1; }

mkdir -p "$OUT"
cp "$SETUP_SRC" "$OUT/Zenew-Setup.exe"          # ASCII 固定名，latest/download 直链永久有效
cp "$SIG_SRC"   "$OUT/Zenew-Setup.exe.sig"

# 生成更新清单 latest.json（signature 取自 .sig 文件内容）
# URL 同时给 GitHub 直链与自家 CDN 镜像（lxlrwxs.top），客户端可多端点容灾
python - "$OUT" "$VERSION" "$TAG" "$REPO" <<'PY'
import json, sys, io, datetime, os
out, version, tag, repo = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sig = io.open(os.path.join(out, 'Zenew-Setup.exe.sig'), encoding='utf-8').read().strip()
manifest = {
    "version": version,
    "notes": os.environ.get('RELEASE_NOTES', f'Zenew {tag}'),
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    "platforms": {
        "windows-x86_64": {
            "signature": sig,
            "url": f"https://lxlrwxs.top/zenew/dl/Zenew-Setup.exe",
        }
    },
}
with io.open(os.path.join(out, 'latest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print('latest.json 就绪：version', version)
PY

echo "→ 创建 Release $TAG"
gh release create "$TAG" \
  "$OUT/Zenew-Setup.exe" \
  "$OUT/Zenew-Setup.exe.sig" \
  "$OUT/latest.json" \
  --repo "$REPO" \
  --title "$TAG" \
  --notes "${RELEASE_NOTES:-Zenew $TAG}"

echo "✓ 发版完成：https://github.com/$REPO/releases/tag/$TAG"
echo "  直链：https://github.com/$REPO/releases/latest/download/Zenew-Setup.exe"
echo "  清单：https://github.com/$REPO/releases/latest/download/latest.json"
