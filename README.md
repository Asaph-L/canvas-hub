# Canvas 课程管家（canvas-hub）

把 Canvas 上的课程资料、作业、成绩、公告自动抓到本地，整理成文件夹，并在网页看板 + 飞书 + 系统通知里提醒你。

**每个人跑自己的一份**：你填自己的 Canvas Token，数据只存在你自己的电脑上，不经过任何第三方服务器。

## 能力总览

- 动态课程发现：每次同步从 Canvas 拉取在读课程（不写死），新课程出现自动建「课程号 课程名 / 讲义·作业·阅读·其他」文件夹
- 增量下载：按文件 id + 更新时间增量，本地已有同名文件不重复下载
- 智能分类：关键词规则 + DeepSeek 兜底（把拿不准的文件归类）
- 成绩追踪：抓课程当前分数，解析课程大纲 PDF 里的评分权重，倒推「这场考试要考多少分才安全」
- 行动清单：未完成作业按「紧急度 × 大纲权重」排序，告诉你先做什么
- 可视化看板：Web 端（日历周视图、截止热力图、课程卡片、文件直达）+ 离线 HTML 仪表盘
- 提醒：macOS 系统通知 / 飞书消息 / 飞书日历日程（提前 1 天 + 1 小时）
- 每日摘要：Markdown 归档，周日追加周报
- 定时任务：每天 08:00 同步、20:00 检查次日截止（错过的任务开机后补跑）

---

## 🚀 部署（5 分钟）

### 前置要求

- macOS（Windows / Linux 上核心功能可用，但没有定时任务与系统通知）
- Node.js 18 或更高：**没装也没关系**，安装向导会问你要不要用 Homebrew 自动装；没有 Homebrew 时会提示到 nodejs.org 下载 LTS 版

### 第 1 步：拿到程序

把同学给你的 canvas-hub 文件夹解压到任意位置（例如桌面）。

### 第 2 步：准备 Canvas Token

1. 浏览器打开 Canvas（如 https://canvas.cityu.edu.hk）并登录
2. 右上角头像 → 账户 / Account → 设置 / Settings
3. 找到 已批准集成 / Approved Integrations → 点 + New Access Token
4. 用途随便填（如 canvas-hub），点生成，复制那串字符（形如 1839~xxxx）
   - 这串字符只保存在你电脑的 secrets.json 里，权限 600，不会外传

### 第 3 步：一条命令安装

    cd 你解压出来的 canvas-hub 目录
    bash install.sh

向导会依次问你：

| 问题 | 说明 |
| --- | --- |
| 程序安装到哪个目录 | 默认 ~/Desktop/canvas-hub；直接回车即可 |
| 课程文件保存到哪个目录 | 默认 ~/Desktop/CityU-Courses（会自动创建）；也可以指向你现有的课程文件夹 |
| Canvas 地址 | 港城大同学直接回车（canvas.cityu.edu.hk）；其他学校填自己的 |
| Canvas Token | 粘贴第 2 步复制的字符串（输入时不显示） |
| DeepSeek API Key | 可选，直接回车跳过；填了才能用对话助手和大纲解析（按量计费，日常大概每月几毛到几块钱） |
| 启用 macOS 系统通知 | 推荐 y |
| 启用 Web 看板 | 推荐 y |
| 启用定时任务 | 推荐 y（可自定义每天几点同步 / 几点提醒） |
| 界面语言 | 1) 中文（默认） 2) English，之后随时可切换 |
| 生成演示数据 | 没填 Canvas Token 时询问，可先看界面效果 |
| 启用飞书集成 | 默认 n（见下方「可选功能 · 飞书」） |

安装完成后会自动：执行首次同步 → 安装后台任务 → 打开网页看板 http://127.0.0.1:8788 → 跑一次体检。

### 第 4 步：用起来

- 📊 看板：课程卡片、下一步做什么、10 天截止、最近新文件（点文件名直接打开本地文件）
- 📅 日历：周历 + 截止热力图 + 未来 30 天清单
- 💬 对话：问「我哪门课最危险」「帮我更新一下」，它会真的去同步并汇报
- ⚙️ 设置：填 DeepSeek Key / 换 Canvas Token / 手动触发同步

### 无人值守安装（可选）

供批量部署或脚本化使用：

    NONINTERACTIVE=1 \
      CANVAS_TOKEN=你的token \
      FILES_DIR="$HOME/Desktop/CityU 课程" \
      DEEPSEEK_KEY=sk-xxx \
      ENABLE_MACOS=1 ENABLE_WEB=1 ENABLE_SCHEDULE=1 ENABLE_LARK=0 \
      bash install.sh

---

## 🧩 可选功能

### 先看演示数据（不需要 Canvas Token）

    node cli.mjs demo          # 生成 3 门假课程 + 成绩与安全线示例
    node cli.mjs demo --off    # 退出演示，恢复真实数据

安装时如果没填 Canvas Token，向导也会问你要不要生成演示数据，方便先看界面再决定是否接入。

### DeepSeek（对话助手 / 大纲解析 / 智能分类）

在网页「设置」里填入 API Key 即可（在 platform.deepseek.com 创建）。不填也能正常同步、归档、提醒，只是没有对话和大纲解析。

> 费用：按量计费，日常使用大概每月几毛到几块钱；首次解析课程大纲时会一次性消耗稍多。感觉贵可以只用关键词规则，不影响其它功能。

### 界面语言

网页看板右上角按钮可在中文 / English 之间切换（会记住选择）；安装时也可以直接选 English。默认语言写在 config.json 的 web.lang。

### 飞书（日历 + 多维表格 + 消息推送）

**装上会更好用吗？** 会：截止日期会自动变成飞书日历日程（带提前 1 天 / 1 小时提醒），所有课程数据在飞书多维表格里可筛选可统计，每天摘要直接推到飞书消息。**不装也完全不影响**：macOS 系统通知 + 网页看板一样能用。

需要先装官方的 lark-cli，并用自己的飞书账号授权一次：

    npx @larksuite/cli@latest install     # 安装 lark-cli
    node cli.mjs lark-setup               # 按提示在浏览器/飞书里完成授权
    node cli.mjs lark-init                # 创建「Canvas 课程中心」多维表格并绑定

之后每天的摘要会发到飞书机器人会话，截止日期会自动建日历日程，数据同步进多维表格。

> 注意：飞书的应用归属于你授权时使用的飞书组织（租户），个人账号无法授权其他组织的应用。

### macOS 系统通知

零配置，默认开启。没有飞书也能收到每日摘要与截止提醒。

---

## 🛠 命令一览

    node cli.mjs doctor              # 环境体检（出问题先跑这个）
    node cli.mjs daily               # 完整流程（定时任务同款）
    node cli.mjs evening             # 晚间同步 + 截止提醒
    node cli.mjs sync                # 只同步下载
    node cli.mjs analyze [--force]   # 重新解析大纲评分组成
    node cli.mjs classify [--all]    # 智能分类（默认只处理「其他」）
    node cli.mjs due 10              # 看 10 天内截止
    node cli.mjs status              # 本地统计
    node cli.mjs dashboard           # 生成离线 HTML 看板
    node cli.mjs server              # 前台启动 Web 看板

## 定时任务管理

    launchctl list | grep canvashub                                  # 查看任务
    launchctl kickstart -k gui/$(id -u)/com.canvashub.morning        # 立刻跑一次早间任务
    launchctl bootout gui/$(id -u)/com.canvashub.morning             # 停用
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.canvashub.morning.plist   # 重新启用

日志：logs/launchd-morning.log、logs/launchd-evening.log、logs/launchd-web.log

## 📦 分发给其他人

    bash package.sh

会生成 dist/canvas-hub-日期.zip（源码 + 安装脚本 + 文档），**不含**你的 secrets.json、data/、logs/ 和个人配置。同学解压后跑 bash install.sh 即可。

---

## 📁 目录结构

    canvas-hub/
    ├── install.sh / uninstall.sh / package.sh   # 安装 / 卸载 / 打包
    ├── cli.mjs                 # 命令入口
    ├── server.mjs              # Web 看板服务（含对话与流式接口）
    ├── config.json             # 所有开关与规则（安装时生成）
    ├── secrets.json            # Canvas Token（chmod 600，勿外传）
    ├── src/                    # 核心模块
    │   ├── sync.mjs canvas.mjs          # 抓取与增量下载
    │   ├── classify.mjs smartclassify.mjs  # 分类
    │   ├── syllabus.mjs                 # 大纲权重解析 + 安全线计算
    │   ├── digest.mjs dashboard.mjs     # 摘要与离线看板
    │   ├── notify.mjs                   # macOS / 飞书推送
    │   ├── calendar.mjs base.mjs        # 飞书日历与多维表格
    │   ├── larkrun.mjs larkinit.mjs larksetup.mjs  # 飞书工具
    │   └── doctor.mjs                   # 环境体检
    ├── out/web/                # Web 看板前端
    ├── out/digest/ out/dashboard/       # 生成的摘要与离线看板
    ├── data/                   # state.json（增量状态）、lark.json、settings.json
    ├── logs/                   # 运行日志
    └── scripts/                # 安装辅助脚本

## ⚙️ 配置说明（config.json）

- channels：macos / larkIM / larkBase / larkCalendar / dashboard 各渠道开关
- web.port：Web 看板端口（默认 8788，被占用时改这里）
- download.root：课程资料保存目录；download.maxFileSizeMB：超过则跳过（默认 300MB）
- courses.include / exclude：按课程号或名称子串过滤；courses.names 可固定文件夹名
- classify：关键词分类规则，可自行增删
- grades.targetPercent：成绩安全线的目标分（默认 60）
- schedule.morning / evening：定时时间

## ❓ 常见问题

**Q：提示 Token 无效（HTTP 401）？**
Canvas Token 过期或复制不全。Canvas → 账户 → 设置 → 已批准集成里重新生成，然后编辑 secrets.json 替换，或直接在网页「设置」页粘贴新的。

**Q：Web 看板打不开？**
先看端口是否被占用：lsof -nP -i :8788。被占用就改 config.json 的 web.port，然后重启服务：
launchctl kickstart -k gui/$(id -u)/com.canvashub.web

**Q：定时任务没跑？**
运行 node cli.mjs doctor 看提示；日志在 logs/launchd-morning.log。手动触发一次：
launchctl kickstart -k gui/$(id -u)/com.canvashub.morning

**Q：我的课程文件在别的地方，能直接用吗？**
可以。把 config.json 的 download.root 改成你的课程目录，重新同步时系统会自动识别已有同名文件（不会重复下载）。

**Q：新加的课没有自动出现？**
同步时从 Canvas 动态拉取，课程一发布就会自动建文件夹。也可以手动跑 node cli.mjs sync。

**Q：大纲权重不对 / 解析不出来？**
把 syllabus PDF 放到对应课程文件夹（文件名含 syllabus），然后 node cli.mjs analyze --force。也可以在网页对话里直接说「把 5002 的评分组成设为 作业 40%、期末 60%」。

**Q：怎么完全卸载？**
bash uninstall.sh 会移除定时任务与常驻服务（不会删你的课程资料）；然后删除程序目录即可。

## 🔒 隐私与安全

- Canvas Token 存在本机 secrets.json（权限 600），DeepSeek Key 存在本机 data/settings.json（权限 600）
- 数据不经过本机以外的任何服务器；Web 服务只监听 127.0.0.1，局域网内其他人访问不到
- 不要把 secrets.json / data/ 发给别人，也不要把它们提交到公开仓库（.gitignore 已处理）

## 技术细节与已知限制

- CityU Canvas 禁用了课程级公告接口，本系统改用全局公告接口（context_codes 过滤）
- Canvas 上的视频（Panopto 等外链）无法通过 API 下载，只能记录链接
- 分类走「关键词优先 + DeepSeek 兜底」；拿不准的文件会留在「其他」
- 文件下载走 Canvas 官方接口，遇到 url 字段为空时用 /api/v1/files/<id>/download 兜底
- 飞书能力依赖 lark-cli 与你的飞书授权；未授权时相关步骤会自动跳过，不影响其它功能

## 开源与许可

- License：MIT（见 LICENSE），可自由使用、修改、分发
- 发布到 GitHub 前请确认没有把 secrets.json / data/ / logs/ 提交上去（.gitignore 已屏蔽）
- 想给同学发离线包：bash package.sh 生成 dist/canvas-hub-日期.zip，不含任何个人数据
- 英文说明见 README.en.md

## 更新记录

- P1：日历周视图 + 截止热力图、流式对话、深色模式、移动端适配
- P0：成绩追踪、大纲权重解析与安全线倒推、行动清单、DeepSeek 智能分类
- 修复：sync 冲掉大纲权重、空 url 文件下载失败、统计口径提示
