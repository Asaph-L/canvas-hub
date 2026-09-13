# v1.0.0 · 首个正式版（macOS / Windows / Linux）

把 Canvas 的课程资料、作业、成绩、公告自动抓到本地整理好，并在**网页看板 / 飞书 / 系统通知**里提醒你 —— 还能解析课程大纲的评分权重，告诉你「这门课期末要考多少分才安全」。

## 下载哪个？

| 你的系统 | 下载 | 安装 |
| --- | --- | --- |
| **Windows** | `canvas-hub-1.0.0-windows.zip` | 解压后在文件夹里打开 PowerShell：`powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS / Linux** | `canvas-hub-1.0.0-macos-linux.tar.gz` | `tar -xzf ... && cd canvas-hub-1.0.0 && bash install.sh` |

或者直接用 git：

    git clone https://github.com/Asaph-L/canvas-hub.git && cd canvas-hub && bash install.sh

> 没有 Canvas Token 也能先玩：安装时选择生成演示数据，或之后执行 `node cli.mjs demo`。

## 这个版本能做什么

**📥 抓取与归档** — 动态发现在读课程（新课程自动建文件夹）、增量下载、关键词 + DeepSeek 兜底分类

**📊 可视化** — Web 看板（课程卡片 / 10 天截止 / 新文件流 / 点击打开本地资料）、日历周视图、GitHub 风格截止热力图、中英双语、深色模式、移动端自适应

**🎯 学业分析** — 成绩追踪、大纲权重解析（从 syllabus PDF 读出「作业 30% / 期中 25% / 期末 40%」）、**安全线倒推**（期末要考多少分才安全）、按紧急度 × 权重排序的行动清单

**🔔 提醒与自动化** — 每天 08:00 同步 / 20:00 截止检查（错过会补跑）、每日摘要 + 周报、系统通知 / 飞书消息 / 飞书日历三渠道可开关

**🤖 AI 助手** — 网页里问「我哪门课最危险」「帮我更新一下」，支持工具调用与流式输出，也能一句话改评分权重

## 平台支持

| 功能 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 抓取 / 归档 / 看板 / 摘要 | ✅ | ✅ | ✅ |
| 系统通知 | ✅ 通知中心 | ✅ 原生 Toast | ✅ notify-send |
| 定时任务 | ✅ launchd | ✅ 任务计划程序 | ⚠️ 需手动配 crontab |
| 大纲 PDF 解析 | ✅ | ✅ 纯 JS，无需 Spotlight | ✅ 纯 JS |

## 隐私

- Canvas Token 存在本机 `secrets.json`（权限 600），DeepSeek Key 存在 `data/settings.json`
- 数据不经过本机以外的任何服务器；Web 服务只监听 `127.0.0.1`
- 每个人跑自己的一份，互不共享任何凭据

## 注意

- 需要 **Node.js 18+**；没装也没关系，安装向导会问你要不要自动装（Homebrew / winget）
- 本版本首次在 Windows 真机验证，修复了多个 Windows 相关问题（详见 CHANGELOG）
- 遇到问题先跑 `node cli.mjs doctor`，它会告诉你哪里不对以及怎么修
