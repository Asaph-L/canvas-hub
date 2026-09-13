# v1.0.1 · 手机离线看板（PWA）

手机打开就是看板 —— **没网也能看**。这是 v1.0.1 的全部重点：把电脑上的看板装进手机，并保证地铁里、断网时照样能查下次截止。

## 下载哪个？

| 你的系统 | 下载 | 安装 |
| --- | --- | --- |
| **Windows** | `canvas-hub-1.0.1-windows.zip` | 解压后在文件夹里打开 PowerShell：`powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS / Linux** | `canvas-hub-1.0.1-macos-linux.tar.gz` | `tar -xzf ... && cd canvas-hub-1.0.1 && bash install.sh` |

或者直接用 git（升级只需 `git pull`）：

    git clone https://github.com/Asaph-L/canvas-hub.git && cd canvas-hub && bash install.sh

## 手机端怎么用（三步）

1. **电脑上看板 →「设置 → 手机配对」**：确认「局域网访问」已开启，页面会出现两个二维码
2. **手机连同一个 WiFi，先扫左边那个**：按提示安装根证书（iPhone 装完描述文件后，还要去「设置 → 通用 → 关于本机 → 证书信任设置」打开完全信任）
3. **再扫右边那个**：看板直接打开，令牌自动记住；然后在浏览器菜单里选「添加到主屏幕 / 安装应用」

装好之后：**断网也能打开看板**，显示的是最近一次同步的状态；联网后自动更新。

## 为什么值得单独发一版

**离线是真的离线。** Service Worker 缓存了看板外壳和最近一次状态数据，飞行模式、地铁隧道、教室没信号，打开就有内容。

**隐私没有妥协。** 局域网访问走本地自签 HTTPS（浏览器要求安全上下文才能离线），配一个 32 位随机令牌；令牌**只显示在电脑屏幕上**，扫码一次自动记住，安装页里不含令牌，手机访问配对接口直接 403。不放心可以随时一键重新生成令牌，旧手机立即失效；也能一键关掉局域网访问。

**不用装任何东西。** 证书是程序用 Node 内置模块现场生成的（没有 openssl 依赖，Windows 也能用）：一个本地根 CA + 一张服务器证书，自动覆盖你机器上所有内网地址。换 WiFi 换了 IP，只重签服务器证书，手机上的 CA 无需重装。

**只缓存状态数据。** 看板外壳 + `/api/state` 就这些，不碰课程文件（PDF / PPT 仍然只在电脑上），手机流量和存储开销可以忽略。

## 其它改动

- `node cli.mjs doctor` 新增手机端体检：局域网端口是否响应、证书是否就绪，并直接打印手机安装页地址
- 端口可配置：`config.json` 的 `web.lanPort` / `web.helperPort`（默认 8789 / 8790）
- 设置页开关即时生效，不需要重启服务
- 新增零依赖自检 `scripts/selftest-pwa.mjs`（31 项断言）并纳入 CI

## 已知限制

- 手机与电脑必须在同一局域网；部分校园网会隔离设备，可先用手机热点验证
- Windows 首次开启手机访问时防火墙会弹窗，需选「允许」
- 首次在手机上安装根证书会有一次系统级「不受信任」提示，这是自签证书的必然步骤，只需做一次

## 从 v1.0.0 升级

    cd canvas-hub && git pull && node cli.mjs doctor

配置与数据都在本地，无需重新安装；重启一次 Web 服务（macOS：`launchctl kickstart -k gui/$(id -u)/com.canvashub.web`；Windows：在任务计划程序里运行 `CanvasHub-Web`）即可用上手机端。

完整改动见 [CHANGELOG.md](../CHANGELOG.md)。
