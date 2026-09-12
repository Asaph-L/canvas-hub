#!/usr/bin/env bash
# 打包一份干净的可分发副本（不含任何个人数据与密钥）
set -u
cd "$(dirname "$0")"
STAMP="$(date +%Y%m%d)"
STAGE="dist/canvas-hub"
rm -rf dist
mkdir -p "$STAGE"
rsync -a \
  --exclude 'data' \
  --exclude 'logs' \
  --exclude 'dist' \
  --exclude 'secrets.json' \
  --exclude 'config.json' \
  --exclude 'out/dashboard' \
  --exclude 'out/digest' \
  --exclude 'out/web/*.png' \
  --exclude 'LaunchAgents' \
  --exclude '.DS_Store' \
  --exclude '.git' \
  --exclude 'node_modules' \
  ./ "$STAGE"/
mkdir -p "$STAGE/data" "$STAGE/logs" "$STAGE/out/dashboard" "$STAGE/out/digest"
printf '%s\n' '本目录保存本地运行数据（state.json / lark.json / settings.json），请勿提交到公开仓库。' > "$STAGE/data/README.txt"
( cd dist && zip -qr "canvas-hub-$STAMP.zip" canvas-hub )
echo "✅ 已生成 dist/canvas-hub-$STAMP.zip"
echo "   包含：源码 + 安装脚本 + 文档；不含：secrets.json / data / logs / 个人配置"
unzip -l "dist/canvas-hub-$STAMP.zip" | tail -3
