# 更新日志

本项目遵循语义化版本（SemVer）。

## v1.0.0 — 2026-09-13

首个正式版本：macOS / Windows / Linux 三平台可用。

### 核心能力

- **抓取与归档**：动态发现 Canvas 在读课程（新课程自动建文件夹）、按文件 ID + 更新时间增量下载、关键词 + DeepSeek 双轨分类
- **可视化看板**：Web 看板（课程卡片 / 截止倒计时 / 新文件流 / 点击打开本地文件）、日历周视图、GitHub 风格截止热力图、中英双语、深色模式、移动端自适应
- **学业分析**：Canvas 成绩追踪、从 syllabus PDF 解析评分权重、**安全线倒推**（期末需要考多少分）、按「紧急度 × 权重」排序的行动清单
- **提醒与自动化**：每日 08:00 同步 / 20:00 截止检查、每日摘要与周报、macOS 通知中心 / Windows Toast / 飞书消息 / 飞书日历日程
- **AI 助手**：网页内对话，支持工具调用（会真的去同步、查成绩、改评分权重），SSE 流式输出
- **零第三方依赖**：只用 Node 内置模块，无需 npm install

### 跨平台

- macOS：launchd 定时任务、Spotlight + 纯 JS 双路 PDF 提取
- Windows：任务计划程序（隐藏窗口运行、每 5 分钟自愈看板）、原生 Toast、**纯 JS PDF 提取**（不依赖 Spotlight）
- Linux：crontab 配置指引、notify-send 通知

### 本次修复（来自 Windows 实机测试）

- 🐛 **Web 看板在 Windows 完全无法启动**：server.mjs 的 PORT 常量在 readJSON 定义之前调用它，命中暂时性死区；macOS 因 launchd 注入了 CANVAS_HUB_PORT 而短路了该分支，一直未暴露
- 🐛 **Windows 看板启动时机**：创建计划任务后立即触发一次，不再等下一个 5 分钟边界
- 🐛 **桌面通知开关命名**：改用 ENABLE_DESKTOP（兼容旧变量），默认开启
- 🐛 **安装器网络校验**：Token 校验与看板探活改用 Node fetch，不再依赖 curl / Invoke-RestMethod（部分 Windows 机器 schannel 损坏会误报失败）
- 🐛 **同步会冲掉大纲权重**：sync 重建课程对象时未继承 assessment / safety / grades
- 🐛 **空 url 文件下载失败**：Canvas 部分文件 url 字段为空，已加 /api/v1/files/<id>/download 兜底
- 🐛 **本地文件路径缺少课程前缀**，导致已有文件在看板里打不开
- 🔧 Windows 任务改为 .cmd 包装 + VBS 隐藏运行，输出写入 logs/launchd-*.log，可排查
- 🔧 schtasks 失败时保留退出码与原始输出，区分「权限不足」与「路径错误」

### 已知限制

- Canvas 上的视频（Panopto 等外链）无法通过 API 下载
- 部分 Canvas 文件受权限限制无法列出，会在日志中记录
- Linux 的定时任务需手动写入 crontab
