# 贡献指南

感谢你愿意改进 Canvas 课程管家！这个项目刻意保持 **零依赖、纯 Node.js**（不需要 npm install 任何东西），提交代码时请沿用这个原则。

## 环境准备

    git clone https://github.com/Asaph-L/canvas-hub.git
    cd canvas-hub
    node -v          # 需要 18 或更高

不需要安装依赖，直接运行：

    node cli.mjs demo        # 生成演示数据，不填 Token 也能看界面
    node cli.mjs dashboard   # 生成离线看板
    node server.mjs          # 启动 Web 看板（默认 http://127.0.0.1:8788）

## 提交前自检

    node scripts/selftest-pdf.mjs              # PDF 提取自检
    for f in $(git ls-files '*.mjs'); do node --check "$f"; done
    node cli.mjs doctor                        # 需要已配置真实 Token

CI 会在 macOS / Windows / Linux 和 Node 18/20/22 上跑同样的检查，包括在真实 Windows runner 上创建计划任务。

## 代码约定

- 不使用第三方依赖；只用 Node 内置模块
- 所有面向用户的文案同时支持中文与英文（网页端见 `out/web/index.html` 里的 I18N 字典）
- 涉及平台的代码走抽象层：定时任务在 `scripts/schedule.mjs`，跨平台打开文件/通知在 `src/util.mjs`
- 改动涉及飞书 / Canvas 接口时，注意失败要「优雅降级」，不能因为可选功能报错就中断主流程
- 提交信息用中文或英文都可以，说明「为什么」比「改了什么」更重要

## 新增文件放哪里

| 内容 | 位置 |
| --- | --- |
| 新的 CLI 子命令 | `cli.mjs` + `src/` 下的模块 |
| 平台适配 | `scripts/schedule.mjs`（调度）、`src/util.mjs`（通知/打开） |
| 抓取逻辑 | `src/canvas.mjs`（HTTP）、`src/sync.mjs`（流程） |
| 界面 | `out/web/index.html`（单文件，无构建步骤） |

## 报告问题

请附上 `node cli.mjs doctor` 的输出；界面问题最好附截图。注意 **不要** 粘贴 Canvas Token、DeepSeek Key 或 `data/` 里的内容。
