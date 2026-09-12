#!/usr/bin/env bash
# 卸载 Canvas 课程管家的定时任务与常驻服务（不会删除课程资料）
set -u
UID_NUM="$(id -u)"
for label in com.canvashub.morning com.canvashub.evening com.canvashub.web; do
  if launchctl bootout "gui/$UID_NUM/$label" >/dev/null 2>&1; then
    echo "✅ 已停止 $label"
  else
    echo "（$label 未在运行）"
  fi
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo ""
echo "定时任务与常驻服务已移除。"
echo "程序目录可以直接删除；课程资料目录不会被删除。"
