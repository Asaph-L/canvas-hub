#!/usr/bin/env bash
# 构建发布产物：
#   dist/canvas-hub-<版本>-windows.zip           （Windows：解压后跑 install.ps1）
#   dist/canvas-hub-<版本>-macos-linux.tar.gz    （macOS/Linux：保留可执行权限，跑 bash install.sh）
#   dist/SHA256SUMS.txt                          （校验和）
#
# 用法：bash release.sh [版本号]     # 不传则读取 VERSION 文件

set -u
cd "$(dirname "$0")"

VERSION="$(cat VERSION 2>/dev/null | tr -d '[:space:]')"
if [ -n "${1:-}" ]; then VERSION="$1"; fi
if [ -z "$VERSION" ]; then VERSION="0.0.0"; fi
NAME="canvas-hub-$VERSION"

echo "📦 构建 $NAME …"
rm -rf dist
mkdir -p "dist/$NAME"

rsync -a \
  --exclude 'data' --exclude 'logs' --exclude 'dist' \
  --exclude 'secrets.json' --exclude 'config.json' --exclude '.git' \
  --exclude 'LaunchAgents' --exclude '.DS_Store' --exclude 'node_modules' \
  --exclude 'out/dashboard' --exclude 'out/digest' --exclude 'out/web/*.png' \
  ./ "dist/$NAME/"

mkdir -p "dist/$NAME/data" "dist/$NAME/logs" "dist/$NAME/out/dashboard" "dist/$NAME/out/digest"
printf '%s\n' '本目录保存本地运行数据（state.json / lark.json / settings.json），请勿提交到公开仓库。' > "dist/$NAME/data/README.txt"
chmod +x "dist/$NAME/install.sh" "dist/$NAME/uninstall.sh" "dist/$NAME/package.sh" "dist/$NAME/release.sh" 2>/dev/null || true

( cd dist && zip -qr "$NAME-windows.zip" "$NAME" )
( cd dist && tar -czf "$NAME-macos-linux.tar.gz" "$NAME" )
( cd dist && shasum -a 256 "$NAME-windows.zip" "$NAME-macos-linux.tar.gz" > SHA256SUMS.txt )

echo ""
echo "✅ 产物已生成："
ls -lh dist/*.zip dist/*.tar.gz | awk '{print "   " $9 "  " $5}'
echo ""
cat dist/SHA256SUMS.txt
