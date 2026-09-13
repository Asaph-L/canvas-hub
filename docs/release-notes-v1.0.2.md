# v1.0.2 · 安全加固 + 手机端更好找回来

这一版做了完整的**安全自查**，修掉两个严重问题（路径穿越读密钥、DNS 重绑定偷令牌），并把手机端「退出来之后怎么回去」这件事认真做了一遍。

## 建议所有 v1.0.1 用户升级

两个严重问题都**只影响局域网/浏览器场景**（不涉及数据外传，程序从不联网上传任何东西），但确实可被利用：

| 问题 | 影响 | 现在的做法 |
| --- | --- | --- |
| 路径穿越 | `GET /..%2f..%2fsecrets.json` 能直接读出 Canvas Token 与 DeepSeek Key（HTTP 200，实测确认） | 静态文件只按 basename 解析 + 目录包含校验，返回 404 |
| DNS 重绑定 | 恶意网页把域名解析到 `127.0.0.1`，就能读走 `/api/pair` 里的局域网令牌 | 校验 `Host` 头，只接受本机名 / 私有网段 IP / `.local`，其余 403 |

另外补上了 `X-Frame-Options: DENY`、CSP、`Permissions-Policy`，并在配对卡与安装页显示 **CA 证书的 SHA-256 指纹**，可对照手机系统设置核对，防止中间人替换证书。完整威胁模型见 [SECURITY.md](../SECURITY.md)。

## 手机端：扫完二维码之后怎么再打开

这是 v1.0.2 的另一半重点。以前只有「扫码」一条路，退出来就容易迷路；现在有三条：

1. **装到手机桌面（最推荐）** —— 打开看板后顶部会出现「把看板装到手机桌面」提示：Android 一键安装，iPhone 按提示「分享 → 添加到主屏幕」。之后**点桌面图标直接进看板，没网也能开**，不会在浏览器标签里迷路。
2. **存书签** —— 配对卡新增「固定地址」，形如 `https://your-mac.local:8789/`，换 WiFi、换 IP 都不变，比内网 IP 更适合收藏。
3. **6 位配对码兜底** —— 令牌失效（清了浏览器数据、换了手机、点过「重新生成」）时不用再找电脑扫码：打开看板地址，配对页会让你输入 6 位数字，把电脑看板「设置 → 手机配对」里显示的数字填进去即可。10 分钟内有效、用一次即废、每 IP 每 10 分钟最多试 10 次。

另外配对成功后令牌会同时存进浏览器存储并在请求头携带，Cookie 被清掉也不用重新配对。

## 下载哪个？

| 你的系统 | 下载 | 安装 |
| --- | --- | --- |
| **Windows** | `canvas-hub-1.0.2-windows.zip` | 解压后：`powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS / Linux** | `canvas-hub-1.0.2-macos-linux.tar.gz` | `tar -xzf ... && cd canvas-hub-1.0.2 && bash install.sh` |

## 从 v1.0.0 / v1.0.1 升级

    cd canvas-hub && git pull && node cli.mjs doctor

配置与数据都在本地，无需重装。升级后**重启一次 Web 服务**（macOS：`launchctl kickstart -k gui/$(id -u)/com.canvashub.web`；Windows：在任务计划程序里运行 `CanvasHub-Web`）即可生效 —— 这一步不能省，旧进程仍带着上述漏洞。

## 自检

    node scripts/selftest-pwa.mjs   # 46 项断言：PWA / 局域网 / 鉴权 / 安全回归

完整改动见 [CHANGELOG.md](../CHANGELOG.md)。
